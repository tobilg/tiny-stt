/**
 * Browser speech-to-text: module workers, pinned assets and optional IndexedDB persistence.
 * Imports perform no work and are safe during SSR; call the factory only in a browser.
 * @module @tiny-stt/whistle
 * @group API
 */
import { Client } from './client.js';
import { checkAbort, validateSignal, WhistleError } from './errors.js';
import { manifest } from './inventory.js';
import type { BrowserWhistleOptions, Whistle } from './types.js';

export type { WhistleErrorCode } from './errors.js';
export { WhistleError } from './errors.js';
export * from './types.js';
/**
 * Load an isolated browser worker and model, resolving only when inference is ready.
 *
 * @param options - Self-hosted assets, pinned-byte mirrors, caching and loading callbacks.
 * @returns A ready engine whose model remains loaded until disposal or active cancellation.
 * @throws {@link WhistleError} for unsupported APIs, invalid options, aborted initialization,
 * missing/incompatible assets, integrity mismatch or model/worker initialization failure.
 * @remarks With no options, runtime/worker code comes from the package and model weights
 * from the immutable official URL. Inference remains local. Self-hosting does not cache
 * the application shell: offline websites need their own deployment/cache strategy.
 * @example
 * ```ts
 * import { createWhistle } from '@tiny-stt/whistle';
 * const engine = await createWhistle({ assetsUrl: '/whistle/' });
 * try {
 *   const silence = await engine.transcribe(new Float32Array(16000));
 *   console.log(silence.text); // ''
 * } finally {
 *   await engine.dispose();
 * }
 * ```
 */
export async function createWhistle(options: BrowserWhistleOptions = {}): Promise<Whistle> {
  if (!options || typeof options !== 'object')
    throw new WhistleError('INVALID_OPTIONS', 'Expected browser options.');
  validateSignal(options.signal);
  checkAbort(options.signal);
  if (
    typeof Worker === 'undefined' ||
    typeof document === 'undefined' ||
    typeof WebAssembly === 'undefined' ||
    !globalThis.crypto?.subtle
  )
    throw new WhistleError(
      'UNSUPPORTED_ENVIRONMENT',
      'Whistle needs browser module workers, WebAssembly, and Web Crypto in a secure context.',
    );
  if (
    options.assetsUrl !== undefined &&
    (options.modelUrl !== undefined || options.wasmUrl !== undefined)
  )
    throw new WhistleError(
      'INVALID_OPTIONS',
      'assetsUrl cannot be combined with modelUrl or wasmUrl.',
    );
  if (options.cache !== undefined && !['auto', 'none'].includes(options.cache))
    throw new WhistleError('INVALID_OPTIONS', 'cache must be auto or none.');
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function')
    throw new WhistleError('INVALID_OPTIONS', 'onProgress must be a function.');
  const url = (value: string | URL): string => {
    try {
      if (!(typeof value === 'string' || value instanceof URL)) throw Error('Invalid URL');
      const u = new URL(value, document.baseURI);
      if (!['http:', 'https:'].includes(u.protocol)) throw Error('Expected HTTP(S)');
      return u.href;
    } catch (cause) {
      throw new WhistleError('INVALID_OPTIONS', 'Asset URLs must resolve to HTTP(S).', { cause });
    }
  };
  let base: string | undefined;
  if (options.assetsUrl !== undefined) {
    const u = new URL(url(options.assetsUrl));
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    u.search = '';
    u.hash = '';
    base = u.href;
  }
  const config = {
    manifest,
    assetsUrl: base,
    cache: options.cache ?? 'auto',
    loaderUrl: base
      ? new URL('needle.js', base).href
      : new URL('./assets/needle.js', import.meta.url).href,
    wasmUrl: base
      ? new URL('needle.wasm', base).href
      : options.wasmUrl !== undefined
        ? url(options.wasmUrl)
        : new URL('./assets/needle.wasm', import.meta.url).href,
    modelUrl: base
      ? new URL('whistle.cact', base).href
      : options.modelUrl !== undefined
        ? url(options.modelUrl)
        : // biome-ignore lint/style/noNonNullAssertion: The build always includes the immutable model source in its inventory.
          manifest.files['whistle.cact'].source!,
  };
  const workerUrl =
    options.workerUrl !== undefined
      ? url(options.workerUrl)
      : base
        ? new URL('browser-worker.js', base).href
        : undefined;
  const client = new Client(
    () => {
      const worker = workerUrl
        ? new Worker(workerUrl, { type: 'module' })
        : new Worker(new URL('./assets/browser-worker.js', import.meta.url), { type: 'module' });
      return {
        post: (message, transfer) => worker.postMessage(message, transfer ?? []),
        listen: (message, failure) => {
          worker.onmessage = (event) => message(event.data);
          worker.onerror = () =>
            failure(
              new WhistleError(
                'WORKER_FAILED',
                'Browser worker failed; check worker URL, CSP and module MIME types.',
              ),
            );
          worker.onmessageerror = failure;
        },
        terminate: async () => {
          worker.terminate();
        },
      };
    },
    config,
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
