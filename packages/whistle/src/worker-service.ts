import type { Runtime } from './engine.js';
import { Engine } from './engine.js';
import { serializeError, WhistleError } from './errors.js';
import type { LoadProgress } from './types.js';
import { validateAudio, validateOptions } from './validation.js';
/**
 * Bind one worker's transport to an isolated engine lifecycle.
 * @param send - Post a structured-clone response to the owning client.
 * @param load - Environment adapter that supplies verified runtime/model bytes.
 * @returns An initialization/inference handler; generation tags retire stale responses.
 * @remarks Inference blocks WASM synchronously. Active cancellation is implemented by
 * client-side worker termination, not by sending an interrupt message to this handler.
 */
export function workerService(
  send: (value: unknown) => void,
  load: (
    // biome-ignore lint/suspicious/noExplicitAny: Each adapter validates its own environment-specific configuration.
    config: any,
    progress: (p: LoadProgress) => void,
  ) => Promise<{ runtime: Runtime; model: Uint8Array }>,
) {
  let engine: Engine | undefined,
    generation = 0,
    initialized = false;
  // biome-ignore lint/suspicious/noExplicitAny: Raw structured-clone input is checked below before inference.
  return async (message: any) => {
    if (message?.type === 'init' && !initialized) {
      initialized = true;
      generation = message.generation;
      try {
        const { runtime, model } = await load(message.config, (progress) =>
          send({ type: 'progress', generation, progress }),
        );
        send({ type: 'progress', generation, progress: { stage: 'initializing' } });
        engine = new Engine(runtime, model);
        send({ type: 'ready', generation });
      } catch (error) {
        send({ type: 'fatal', generation, error: serializeError(error) });
      }
    } else if (message?.type === 'transcribe' && engine && message.generation === generation) {
      try {
        validateAudio(message.audio);
        const options = validateOptions(message.options);
        send({
          type: 'result',
          generation,
          id: message.id,
          result: engine.transcribe(message.audio, options),
        });
      } catch (error) {
        send({ type: 'error', generation, id: message.id, error: serializeError(error) });
      }
    } else
      send({
        type: 'fatal',
        generation,
        error: serializeError(new WhistleError('WORKER_FAILED', 'Invalid worker request.')),
      });
  };
}
