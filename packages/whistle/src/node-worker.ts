/** Node worker-thread bootstrap. Loads only verified local files and never accesses the network.
 * @packageDocumentation
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parentPort } from 'node:worker_threads';
import { loadLocal } from './node-assets.js';
import { workerService } from './worker-service.js';

const port = parentPort;
if (!port) throw new Error('Whistle must run inside a worker thread.');
const handle = workerService(
  (value) => port.postMessage(value),
  async (config, progress) => {
    const { wasm, model } = await loadLocal(config.assetsPath, config.manifest, progress);
    const { default: create } = await import(
      pathToFileURL(join(config.assetsPath, 'needle.js')).href
    );
    return { runtime: await create({ wasmBinary: wasm }), model };
  },
);
port.on('message', (message) => {
  void handle(message);
});
