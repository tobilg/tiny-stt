/**
 * Node speech-to-text using worker threads and explicitly prepared local assets.
 * There is no remote fallback or import-time initialization.
 * @module @tiny-stt/whistle/node
 * @group API
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Client } from './client.js';
import { checkAbort, validateSignal, WhistleError } from './errors.js';
import { manifest } from './inventory.js';
import type { NodeWhistleOptions, Whistle } from './types.js';

export type { WhistleErrorCode } from './errors.js';
export { WhistleError } from './errors.js';
export * from './types.js';
/**
 * Initialize a local-only Node worker and keep its model ready for repeated clips.
 *
 * @param options - Required CLI-generated asset directory, progress and initialization signal.
 * @returns A ready isolated engine. Dispose it to await worker termination.
 * @throws {@link WhistleError} for invalid paths/options, missing or corrupt files,
 * incompatible assets, cancellation, allocation failure or runtime initialization failure.
 * @remarks Every deployment file is verified before loading executable code. Initialization,
 * repeated calls and cancellation recovery use local files only and work with networking denied.
 * @example
 * ```ts
 * import { createWhistle } from '@tiny-stt/whistle/node';
 * const engine = await createWhistle({ assetsPath: './vendor/whistle' });
 * try {
 *   console.log(await engine.transcribe(new Float32Array(16000)));
 * } finally {
 *   await engine.dispose();
 * }
 * ```
 */
export async function createWhistle(options: NodeWhistleOptions): Promise<Whistle> {
  if (!options || !(typeof options.assetsPath === 'string' || options.assetsPath instanceof URL))
    throw new WhistleError('INVALID_OPTIONS', 'assetsPath is required.');
  validateSignal(options.signal);
  checkAbort(options.signal);
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function')
    throw new WhistleError('INVALID_OPTIONS', 'onProgress must be a function.');
  let assetsPath: string;
  try {
    const input = options.assetsPath;
    if (input instanceof URL || /^file:/i.test(input)) assetsPath = fileURLToPath(input);
    else {
      if (!input || (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[a-z]:[\\/]/i.test(input)))
        throw Error('Expected local path');
      assetsPath = resolve(input);
    }
  } catch (cause) {
    throw new WhistleError(
      'INVALID_OPTIONS',
      'assetsPath must be a local directory or file: URL.',
      { cause },
    );
  }
  const client = new Client(
    () => {
      // stdin/eval callers may use --input-type; file workers cannot inherit it.
      // Otherwise let Node apply its own inheritance rules (not every process flag
      // is valid in an explicit worker execArgv, notably in Node 24's test runner).
      const hasInputType = process.execArgv.some((arg) => arg.startsWith('--input-type'));
      const execArgv = hasInputType
        ? process.execArgv.filter(
            (arg, i, args) => !arg.startsWith('--input-type') && args[i - 1] !== '--input-type',
          )
        : undefined;
      const worker = new Worker(new URL('./assets/node-worker.js', import.meta.url), { execArgv });
      let stopped = false;
      return {
        post: (message, transfer) => worker.postMessage(message, transfer),
        listen: (message, failure) => {
          worker.on('message', message);
          worker.on('messageerror', failure);
          worker.on('error', failure);
          worker.on('exit', (code) => {
            if (!stopped) failure(new Error(`Worker exited (${code}).`));
          });
        },
        terminate: async () => {
          stopped = true;
          await worker.terminate();
        },
      };
    },
    { assetsPath, manifest },
    options.onProgress,
  );
  try {
    await client.initialize(options.signal);
    return client;
  } catch (error) {
    await client.dispose();
    throw error;
  }
}
