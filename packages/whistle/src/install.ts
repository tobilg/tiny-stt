import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { verify } from './assets.js';
import { asError, checkAbort, WhistleError } from './errors.js';
import { manifest } from './inventory.js';
import type { Asset, Manifest } from './types.js';

/** Internal CLI acquisition settings; runtime initialization never calls the installer. */
interface InstallOptions {
  /** Destination directory; unrelated files are preserved. */
  out: string;
  /** Permit only existing verified files and bundled support assets. */
  offline?: boolean;
  /** Abort acquisition and remove this process's incomplete temporary files. */
  signal?: AbortSignal;
  /** Human-readable progress for the CLI stderr stream. */
  progress?: (message: string) => void;
}
// Dependency injection is internal to permit deterministic interruption/integrity tests.
interface Dependencies {
  manifest?: Manifest;
  bundledPath?: string;
  fetch?: typeof fetch;
}
async function valid(path: string, asset: Asset) {
  try {
    await verify(await readFile(path), asset, path);
    return true;
  } catch {
    return false;
  }
}
async function atomic(
  path: string,
  write: (temporary: string) => Promise<void>,
  signal?: AbortSignal,
) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    checkAbort(signal);
    await write(temporary);
    checkAbort(signal);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function writeBytes(path: string, bytes: Uint8Array) {
  const file = await open(path, 'wx');
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function download(
  path: string,
  asset: Asset,
  name: string,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    checkAbort(signal);
    try {
      const timeout = AbortSignal.timeout(60000);
      // biome-ignore lint/style/noNonNullAssertion: installAssets checks the source before calling download.
      const response = await fetcher(asset.source!, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) {
        const error = new WhistleError(
          'ASSET_DOWNLOAD_FAILED',
          `${name}: HTTP ${response.status}; retry asset preparation.`,
        );
        await response.body?.cancel();
        if (response.status !== 408 && response.status !== 429 && response.status < 500)
          throw Object.assign(error, { permanent: true });
        throw error;
      }
      const body = response.body;
      if (!body) throw new WhistleError('ASSET_DOWNLOAD_FAILED', `${name}: response has no body.`);
      await atomic(
        path,
        async (temporary) => {
          const file = await open(temporary, 'wx');
          const hash = createHash('sha256');
          let size = 0;
          const reader = body.getReader();
          try {
            while (true) {
              checkAbort(signal);
              const { value, done } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > asset.bytes)
                throw new WhistleError(
                  'ASSET_INTEGRITY_FAILED',
                  `${name}: download exceeds expected size.`,
                );
              hash.update(value);
              await file.writeFile(value);
            }
            if (size !== asset.bytes || hash.digest('hex') !== asset.sha256)
              throw new WhistleError(
                'ASSET_INTEGRITY_FAILED',
                `${name}: checksum/size mismatch; no file installed.`,
              );
            await file.sync();
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
            await file.close();
          }
        },
        signal,
      );
      return;
    } catch (error) {
      checkAbort(signal);
      if (
        (error as { permanent?: unknown } | null)?.permanent ||
        (error instanceof WhistleError && error.code === 'ASSET_INTEGRITY_FAILED') ||
        attempt === 2
      )
        throw asError(error, 'ASSET_DOWNLOAD_FAILED');
      try {
        await delay(250 * 2 ** attempt, undefined, { signal });
      } catch {
        checkAbort(signal);
      }
    }
  }
}
/**
 * Prepare a complete CLI asset distribution with per-file atomic verified writes.
 * @param options - Destination, offline mode, cancellation and progress observer.
 * @param dependencies - Internal test seams for integrity, fetch and interruption tests.
 * @returns Completion after all files are valid and the inventory is committed last.
 * @throws WhistleError for unavailable offline files, bounded download failures or checksum mismatch.
 * @remarks Valid files are reused without networking. Only missing/corrupt externally
 * sourced bytes are fetched; model weights are never part of the npm package.
 */
export async function installAssets(
  options: InstallOptions,
  dependencies: Dependencies = {},
): Promise<void> {
  const expected = dependencies.manifest ?? manifest;
  const bundledPath =
    dependencies.bundledPath ?? fileURLToPath(new URL('./assets/', import.meta.url));
  const out = resolve(options.out);
  await mkdir(out, { recursive: true });
  for (const [name, asset] of Object.entries(expected.files)) {
    checkAbort(options.signal);
    const path = join(out, name);
    if (await valid(path, asset)) {
      options.progress?.(`Verified ${name} (existing)`);
      continue;
    }
    let bundled: Uint8Array | undefined;
    try {
      bundled = await readFile(join(bundledPath, name));
    } catch {
      /* model is deliberately external */
    }
    if (bundled) {
      await verify(bundled, asset, name);
      const bytes = bundled;
      await atomic(path, (temporary) => writeBytes(temporary, bytes), options.signal);
      options.progress?.(`Installed ${name} (bundled)`);
    } else {
      if (options.offline || !asset.source)
        throw new WhistleError(
          'ASSET_NOT_FOUND',
          `${name}: missing or corrupt. Run whistle download --out "${out}" while connected, then retry --offline.`,
        );
      options.progress?.(`Downloading ${name} (${asset.bytes} bytes)`);
      await download(path, asset, name, options.signal, dependencies.fetch ?? fetch);
    }
  }
  // The complete inventory is committed last. No manifest on incomplete first installs.
  const bytes = new TextEncoder().encode(`${JSON.stringify(expected, null, 2)}\n`);
  await atomic(
    join(out, 'manifest.json'),
    (temporary) => writeBytes(temporary, bytes),
    options.signal,
  );
  options.progress?.(`Verified complete asset set at ${out}`);
}
