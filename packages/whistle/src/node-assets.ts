import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateManifest, verify } from './assets.js';
import { WhistleError } from './errors.js';
import type { LoadProgress, Manifest } from './types.js';
/** Read one deployment file with filesystem APIs; missing reads become ASSET_NOT_FOUND. */
export async function readLocal(path: string, name: string): Promise<Uint8Array> {
  try {
    return await readFile(join(path, name));
  } catch (cause) {
    throw new WhistleError(
      'ASSET_NOT_FOUND',
      `Cannot read ${join(path, name)}; run whistle download --out <directory>.`,
      { cause },
    );
  }
}
/** Verify every local inventory entry before exposing model/WASM bytes or importing the loader. */
export async function loadLocal(
  path: string,
  expected: Manifest,
  progress: (p: LoadProgress) => void,
) {
  let actual: unknown;
  try {
    actual = JSON.parse(new TextDecoder().decode(await readLocal(path, 'manifest.json')));
  } catch (cause) {
    if (cause instanceof WhistleError) throw cause;
    throw new WhistleError('ASSET_INCOMPATIBLE', 'Invalid manifest JSON.', { cause });
  }
  validateManifest(actual, expected);
  let wasm!: Uint8Array, model!: Uint8Array;
  for (const [name, asset] of Object.entries(expected.files)) {
    const bytes = await readLocal(path, name);
    await verify(bytes, asset, name);
    if (name === 'needle.wasm') wasm = bytes;
    if (name === 'whistle.cact') model = bytes;
    if (['needle.js', 'needle.wasm', 'whistle.cact'].includes(name))
      progress({
        stage: name === 'whistle.cact' ? 'loading-model' : 'loading-runtime',
        asset: name === 'whistle.cact' ? 'model' : name === 'needle.wasm' ? 'wasm' : 'loader',
        loadedBytes: bytes.length,
        totalBytes: bytes.length,
        fraction: 1,
        fromCache: true,
      });
  }
  return { wasm, model };
}
