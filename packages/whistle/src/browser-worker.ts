/** Browser module-worker bootstrap. Imports the verified static loader URL without evaluating fetched source.
 * @packageDocumentation
 */
import { browserAssets } from './browser-assets.js';
import { workerService } from './worker-service.js';

const handle = workerService(
  (value) => globalThis.postMessage(value),
  async (config, progress) => {
    const { wasm, model } = await browserAssets(config, progress);
    // Static ESM module URL: no eval, Function, or loader-source execution.
    const { default: create } = await import(/* @vite-ignore */ config.loaderUrl);
    return { runtime: await create({ wasmBinary: wasm }), model };
  },
);
globalThis.onmessage = (event) => {
  void handle(event.data);
};
