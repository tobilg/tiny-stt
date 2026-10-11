import { validateManifest, verify } from './assets.js';
import { openAssetCache } from './cache.js';
import { WhistleError } from './errors.js';
import type { Asset, LoadProgress, Manifest } from './types.js';
/** Fetch one locked asset, verifying both persistent-cache hits and complete network responses. */
export async function fetchAsset(
  url: string,
  expected: Asset,
  name: string,
  cacheMode: 'auto' | 'none',
  progress: (p: LoadProgress) => void,
): Promise<Uint8Array> {
  const asset = name === 'needle.js' ? 'loader' : name === 'needle.wasm' ? 'wasm' : 'model';
  const stage = asset === 'model' ? 'loading-model' : 'loading-runtime';
  const report = (loadedBytes: number, fromCache: boolean) =>
    progress({
      stage,
      asset,
      loadedBytes,
      totalBytes: expected.bytes,
      fraction: loadedBytes / expected.bytes,
      fromCache,
    });
  let cache: Awaited<ReturnType<typeof openAssetCache>> | undefined;
  const key = expected.sha256;
  if (cacheMode === 'auto') {
    try {
      cache = await openAssetCache();
      const bytes = await cache.get(key);
      if (bytes) {
        try {
          await verify(bytes, expected, name);
          report(bytes.length, true);
          cache.close();
          return bytes;
        } catch {
          await cache.delete(key);
        }
      }
    } catch {
      cache?.close();
      cache = undefined;
    }
  }
  try {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (cause) {
      throw new WhistleError(
        'ASSET_DOWNLOAD_FAILED',
        `${name}: fetch failed at ${url}. Check hosting/CORS or prepare local assets.`,
        { cause },
      );
    }
    if (!response.ok)
      throw new WhistleError(
        response.status === 404 ? 'ASSET_NOT_FOUND' : 'ASSET_DOWNLOAD_FAILED',
        `${name}: HTTP ${response.status} at ${url}.`,
      );
    const bytes = new Uint8Array(expected.bytes);
    let loaded = 0;
    report(0, false);
    try {
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (loaded + value.length > bytes.length)
              throw new WhistleError(
                'ASSET_INTEGRITY_FAILED',
                `${name}: asset exceeds locked size.`,
              );
            bytes.set(value, loaded);
            loaded += value.length;
            report(loaded, false);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } else {
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.length > bytes.length)
          throw new WhistleError('ASSET_INTEGRITY_FAILED', `${name}: asset exceeds locked size.`);
        bytes.set(body);
        loaded = body.length;
      }
    } catch (cause) {
      if (cause instanceof WhistleError) throw cause;
      throw new WhistleError('ASSET_DOWNLOAD_FAILED', `${name}: download interrupted.`, { cause });
    }
    await verify(bytes.subarray(0, loaded), expected, name);
    if (cache) {
      try {
        await cache.put(key, bytes);
      } catch {
        /* quota/denial must not break loading */
      }
    }
    report(loaded, false);
    return bytes;
  } finally {
    cache?.close();
  }
}
/** Load a matching browser manifest, loader bytes, WASM and model without remote fallback in self-hosted mode. */
export async function browserAssets(
  config: {
    manifest: Manifest;
    assetsUrl?: string;
    loaderUrl: string;
    wasmUrl: string;
    modelUrl: string;
    cache: 'auto' | 'none';
  },
  progress: (p: LoadProgress) => void,
) {
  if (config.assetsUrl) {
    let response: Response;
    try {
      response = await fetch(new URL('manifest.json', config.assetsUrl));
    } catch (cause) {
      throw new WhistleError('ASSET_DOWNLOAD_FAILED', 'Cannot load self-hosted manifest.', {
        cause,
      });
    }
    if (!response.ok)
      throw new WhistleError('ASSET_NOT_FOUND', `Self-hosted manifest: HTTP ${response.status}.`);
    let value: unknown;
    try {
      value = await response.json();
    } catch (cause) {
      throw new WhistleError('ASSET_INCOMPATIBLE', 'Invalid manifest JSON.', { cause });
    }
    validateManifest(value, config.manifest);
  }
  await fetchAsset(
    config.loaderUrl,
    config.manifest.files['needle.js'],
    'needle.js',
    config.cache,
    progress,
  );
  const wasm = await fetchAsset(
    config.wasmUrl,
    config.manifest.files['needle.wasm'],
    'needle.wasm',
    config.cache,
    progress,
  );
  const model = await fetchAsset(
    config.modelUrl,
    config.manifest.files['whistle.cact'],
    'whistle.cact',
    config.cache,
    progress,
  );
  return { wasm, model };
}
