import { aborted, asError, checkAbort, deserializeError, WhistleError } from './errors.js';
import type {
  EngineOptions,
  LoadProgress,
  TranscribeOptions,
  Whistle,
  WhistleTranscript,
} from './types.js';
import { validateAudio, validateOptions } from './validation.js';
/** Internal browser/thread transport; owns the worker listeners and termination resource. */
export interface Transport {
  /** Send a request, transferring only SDK-owned snapshots when requested. */
  post(message: unknown, transfer?: ArrayBuffer[]): void;
  /** Attach response and fatal-failure observers for this worker generation. */
  // biome-ignore lint/suspicious/noExplicitAny: Raw worker envelopes are validated in Client.start before use.
  listen(message: (value: any) => void, failure: (error: unknown) => void): void;
  /** Stop blocking inference and resolve when transport resources are released. */
  terminate(): Promise<void>;
}
interface Request {
  id: number;
  audio: Float32Array<ArrayBuffer>;
  options: EngineOptions;
  resolve: (r: WhistleTranscript) => void;
  reject: (e: unknown) => void;
  cleanup: () => void;
}
/** Shared FIFO, cancellation and terminal-disposal controller for one isolated engine. */
export class Client implements Whistle {
  private worker?: Transport;
  private generation = 0;
  private nextId = 0;
  private queue: Request[] = [];
  private active?: Request;
  private ready = false;
  private boot?: { resolve: () => void; reject: (e: unknown) => void };
  private starting?: Promise<void>;
  private terminal?: WhistleError;
  private terminations = new Set<Promise<void>>();
  private disposal?: Promise<void>;
  private emittedReady = false;
  /** Retain the adapter factory/configuration without creating a worker until initialize. */
  constructor(
    private readonly spawn: () => Transport,
    private readonly config: unknown,
    private readonly onProgress?: (p: LoadProgress) => void,
  ) {}
  /** Report readiness once while isolating exceptions from application observers. */
  private progress(p: LoadProgress) {
    if (p.stage === 'ready') {
      if (this.emittedReady) return;
      this.emittedReady = true;
    }
    // Application progress callbacks cannot strand worker lifecycle promises.
    try {
      this.onProgress?.(p);
    } catch {
      /* observer only */
    }
  }
  /** Start the first worker and detach initialization cancellation after readiness. */
  async initialize(signal?: AbortSignal): Promise<void> {
    checkAbort(signal);
    const cancel = () => {
      this.fail(aborted());
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await this.start();
      checkAbort(signal);
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }
  /** Start or join one generation's initialization and validate all incoming responses. */
  private start(): Promise<void> {
    if (this.terminal) return Promise.reject(this.terminal);
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    const promise = new Promise<void>((resolve, reject) => {
      this.boot = { resolve, reject };
    });
    this.starting = promise;
    const generation = ++this.generation;
    try {
      const worker = this.spawn();
      this.worker = worker;
      worker.listen(
        (value) => {
          if (generation !== this.generation || this.terminal) return;
          if (!value || value.generation !== generation || typeof value.type !== 'string') {
            this.fail(new WhistleError('WORKER_FAILED', 'Malformed worker message.'));
            return;
          }
          if (value.type === 'progress') {
            const p = value.progress;
            if (
              !p ||
              !['loading-runtime', 'loading-model', 'initializing', 'ready'].includes(p.stage) ||
              (p.fraction !== undefined &&
                (!Number.isFinite(p.fraction) || p.fraction < 0 || p.fraction > 1))
            ) {
              this.fail(new WhistleError('WORKER_FAILED', 'Malformed worker progress.'));
              return;
            }
            this.progress(p);
            return;
          }
          if (value.type === 'ready' && this.boot) {
            this.ready = true;
            this.starting = undefined;
            const boot = this.boot;
            this.boot = undefined;
            this.progress({ stage: 'ready' });
            boot.resolve();
            return;
          }
          if (value.type === 'fatal') {
            this.fail(deserializeError(value.error));
            return;
          }
          const request = this.active;
          if (!request || value.id !== request.id || !['result', 'error'].includes(value.type)) {
            this.fail(new WhistleError('WORKER_FAILED', 'Unexpected worker response.'));
            return;
          }
          this.active = undefined;
          request.cleanup();
          if (value.type === 'error') request.reject(deserializeError(value.error));
          else if (
            !value.result ||
            typeof value.result.text !== 'string' ||
            !Number.isFinite(value.result.timings?.totalMs)
          ) {
            request.reject(new WhistleError('WORKER_FAILED', 'Malformed worker result.'));
            this.fail(new WhistleError('WORKER_FAILED', 'Malformed worker result.'));
            return;
          } else request.resolve(value.result);
          this.pump();
        },
        (error) => {
          if (generation === this.generation && !this.terminal) this.fail(asError(error));
        },
      );
      worker.post({ type: 'init', generation, config: this.config });
    } catch (error) {
      this.fail(asError(error));
    }
    return promise;
  }
  /** Invalidate old events before terminating a worker; retain pending exits for disposal. */
  private retire() {
    ++this.generation;
    this.ready = false;
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      const termination = worker.terminate();
      this.terminations.add(termination);
      // Retain pending/failed terminations for dispose, not every past abort.
      void termination.then(
        () => this.terminations.delete(termination),
        () => {},
      );
    }
  }
  /** Enter terminal failure and settle every active, queued and initialization promise. */
  private fail(error: WhistleError) {
    this.terminal = error;
    this.boot?.reject(error);
    this.boot = undefined;
    this.starting = undefined;
    const requests = [...(this.active ? [this.active] : []), ...this.queue];
    this.active = undefined;
    this.queue = [];
    for (const r of requests) {
      r.cleanup();
      r.reject(error);
    }
    this.retire();
  }
  /** Snapshot caller PCM immediately, then queue one independently cancellable request. */
  transcribe(audio: Float32Array, options: TranscribeOptions = {}): Promise<WhistleTranscript> {
    // Validate and snapshot synchronously before returning, including queued calls.
    try {
      if (this.terminal) throw this.terminal;
      const normalized = validateOptions(options);
      checkAbort(options.signal);
      validateAudio(audio);
      const snapshot = new Float32Array(audio);
      return new Promise((resolve, reject) => {
        const request: Request = {
          id: ++this.nextId,
          audio: snapshot,
          options: normalized,
          resolve,
          reject,
          cleanup: () => options.signal?.removeEventListener('abort', cancel),
        };
        const cancel = () => {
          const queued = this.queue.indexOf(request);
          if (queued >= 0) this.queue.splice(queued, 1);
          else if (this.active === request) {
            this.active = undefined;
            this.retire();
          } else return;
          request.cleanup();
          reject(aborted());
          this.pump();
        };
        this.queue.push(request);
        options.signal?.addEventListener('abort', cancel, { once: true });
        this.pump();
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  /** Run the next FIFO request, reloading a terminated worker before surviving queued work. */
  private pump() {
    if (this.terminal || this.active || !this.queue.length) return;
    if (!this.ready) {
      void this.start().then(
        () => this.pump(),
        () => {},
      );
      return;
    }
    // biome-ignore lint/style/noNonNullAssertion: The synchronous queue-length check above guarantees an item.
    const request = this.queue.shift()!;
    this.active = request;
    try {
      // biome-ignore lint/style/noNonNullAssertion: ready is set only after this worker initializes and cleared on retirement.
      this.worker!.post(
        {
          type: 'transcribe',
          generation: this.generation,
          id: request.id,
          audio: request.audio,
          options: request.options,
        },
        [request.audio.buffer],
      );
    } catch (error) {
      this.fail(asError(error));
    }
  }
  /** Permanently settle all work and return one idempotent worker-exit promise. */
  dispose(): Promise<void> {
    if (!this.disposal) {
      this.fail(new WhistleError('DISPOSED', 'Whistle instance has been disposed.'));
      this.disposal = Promise.all(this.terminations).then(() => {});
    }
    return this.disposal;
  }
}
