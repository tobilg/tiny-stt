import type { TranscribeOptions, Whistle, WhistleTranscript } from '@tiny-stt/whistle';
import { createWhistle, WhistleError } from '@tiny-stt/whistle';
import { decodeAudio } from '@tiny-stt/whistle/audio';
import { type Recording, startRecording } from '@tiny-stt/whistle/microphone';
import type {
  UseWhistleOptions,
  UseWhistleRecorderOptions,
  WhistleRecorderState,
  WhistleState,
} from './types.js';
import { aborted, asError, checkAbort, validateAudio, validateOptions } from './validation.js';

// Internal observable state keeps asynchronous ownership independent of React renders.
class Store<T> {
  private listeners = new Set<() => void>();
  constructor(protected state: T) {}
  snapshot = (): T => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  protected update(patch: Partial<T>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: WhistleError) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const disposed = () => new WhistleError('DISPOSED', 'This hook is no longer mounted.');
const notReady = () =>
  new WhistleError('MODEL_LOAD_FAILED', 'Call load() and wait for readiness before transcribing.');

interface Job {
  input: Float32Array | Blob;
  options: TranscribeOptions;
  controller: AbortController;
  completion: ReturnType<typeof deferred<WhistleTranscript>>;
  unlink: () => void;
  settled: boolean;
}
interface Loading {
  controller: AbortController;
  completion: ReturnType<typeof deferred<void>>;
}

/** @internal Per-hook engine ownership, FIFO decoding/inference and cancellation. */
export class WhistleController extends Store<WhistleState> {
  private mounted = true;
  private engine?: Whistle;
  private loading?: Loading;
  private jobs: Job[] = [];
  private active?: Job;

  constructor(
    private options: UseWhistleOptions,
    private factory = createWhistle,
    private decode = decodeAudio,
  ) {
    super({
      status: 'idle',
      ready: false,
      pending: 0,
      progress: undefined,
      result: undefined,
      error: undefined,
    });
  }

  activate = () => {
    this.mounted = true;
  };
  load = (): Promise<void> => {
    if (!this.mounted) return Promise.reject(disposed());
    if (this.engine) return Promise.resolve();
    if (this.loading) return this.loading.completion.promise;
    const operation: Loading = { controller: new AbortController(), completion: deferred<void>() };
    this.loading = operation;
    this.update({ status: 'loading', error: undefined, progress: undefined });
    // The async boundary also handles a synchronously throwing custom platform adapter.
    void (async () => {
      try {
        const engine = await this.factory({
          ...this.options,
          signal: operation.controller.signal,
          onProgress: (progress) => {
            if (this.loading === operation) this.update({ progress });
          },
        });
        if (this.loading !== operation || !this.mounted) {
          await engine.dispose();
          return;
        }
        this.loading = undefined;
        this.engine = engine;
        this.update({ ready: true, status: 'idle', error: undefined });
        operation.completion.resolve();
      } catch (cause) {
        if (this.loading !== operation) return;
        this.loading = undefined;
        const error = asError(cause);
        this.update({ status: 'idle', error });
        operation.completion.reject(error);
      }
    })();
    return operation.completion.promise;
  };

  transcribe = (audio: Float32Array, options: TranscribeOptions = {}) =>
    this.enqueue(audio, options);
  transcribeFile = (file: Blob, options: TranscribeOptions = {}) =>
    this.enqueue(file, options, true);

  private enqueue(
    input: Float32Array | Blob,
    options: TranscribeOptions,
    file = false,
  ): Promise<WhistleTranscript> {
    try {
      if (!this.mounted) throw disposed();
      const normalized = validateOptions(options);
      checkAbort(options.signal);
      if (!this.engine) throw notReady();
      if (file) {
        if (typeof Blob === 'undefined' || !(input instanceof Blob) || !input.size)
          throw new WhistleError('AUDIO_DECODE_FAILED', 'Expected a nonempty audio Blob or File.');
      } else {
        validateAudio(input as Float32Array);
        input = new Float32Array(input as Float32Array);
      }
      const job: Job = {
        input,
        options: normalized,
        controller: new AbortController(),
        completion: deferred<WhistleTranscript>(),
        unlink: () => {},
        settled: false,
      };
      const cancel = () => {
        job.controller.abort();
        this.finish(job, undefined, aborted());
      };
      options.signal?.addEventListener('abort', cancel, { once: true });
      job.unlink = () => options.signal?.removeEventListener('abort', cancel);
      this.jobs.push(job);
      this.update({ pending: this.jobs.length, error: undefined });
      this.pump();
      return job.completion.promise;
    } catch (cause) {
      const error = asError(cause);
      if (this.mounted) this.update({ error });
      return Promise.reject(error);
    }
  }

  private pump() {
    if (!this.mounted || this.active || !this.engine) return;
    const job = this.jobs[0];
    if (!job) return;
    this.active = job;
    const engine = this.engine;
    this.update({ status: job.input instanceof Float32Array ? 'transcribing' : 'decoding' });
    void (async () => {
      try {
        const pcm =
          job.input instanceof Float32Array
            ? job.input
            : await this.decode(job.input, { signal: job.controller.signal });
        if (job.settled) return;
        this.update({ status: 'transcribing' });
        const result = await engine.transcribe(pcm, {
          ...job.options,
          signal: job.controller.signal,
        });
        this.finish(job, result);
      } catch (cause) {
        const error = asError(cause);
        const terminal =
          error.code === 'WORKER_FAILED' ||
          error.code === 'DISPOSED' ||
          error.code === 'MODEL_LOAD_FAILED' ||
          error.code.startsWith('ASSET_');
        if (!job.settled && terminal && this.engine === engine) {
          // A crash or failed cancellation recovery makes the SDK client terminal.
          // Release it so explicit load can retry after assets/environment are fixed.
          this.engine = undefined;
          this.update({ ready: false });
          this.cancelWork(error);
          void engine.dispose().catch(() => {});
        } else this.finish(job, undefined, error);
      }
    })();
  }

  private finish(job: Job, result?: WhistleTranscript, error?: WhistleError) {
    if (job.settled) return;
    job.settled = true;
    job.unlink();
    this.jobs = this.jobs.filter((item) => item !== job);
    if (this.active === job) this.active = undefined;
    this.update({
      pending: this.jobs.length,
      ...(!this.active ? { status: 'idle' as const } : {}),
      ...(result ? { result, error: undefined } : { error }),
    });
    if (error) job.completion.reject(error);
    else job.completion.resolve(result as WhistleTranscript);
    this.pump();
  }

  private cancelWork(error: WhistleError) {
    const loading = this.loading;
    this.loading = undefined;
    if (loading) {
      loading.controller.abort();
      loading.completion.reject(error);
    }
    // Prevent cancellation of one job from pumping another that is also being cancelled.
    const mounted = this.mounted;
    this.mounted = false;
    for (const job of [...this.jobs]) {
      job.controller.abort();
      this.finish(job, undefined, error);
    }
    this.mounted = mounted;
    if (loading) this.update({ status: 'idle', error });
  }
  cancel = () => {
    this.cancelWork(aborted());
  };
  release = () => {
    this.mounted = false;
    this.cancelWork(disposed());
    const engine = this.engine;
    this.engine = undefined;
    // Browser disposal terminates synchronously; async failures remain observable in state.
    void engine?.dispose().catch((cause) => {
      if (!this.mounted) this.update({ error: asError(cause) });
    });
    this.update({
      status: 'idle',
      ready: false,
      pending: 0,
      progress: undefined,
      error: undefined,
    });
  };
}

interface Capture {
  controller: AbortController;
  recording?: Recording;
  completion: ReturnType<typeof deferred<WhistleTranscript>>;
}

/** @internal A recorder cancels only its own capture and signal-scoped transcription. */
export class RecorderController extends Store<WhistleRecorderState> {
  private mounted = true;
  private operation?: Capture;
  constructor(
    private transcribe: Whistle['transcribe'],
    private capture = startRecording,
  ) {
    super({ status: 'idle', result: undefined, error: undefined });
  }
  activate = () => {
    this.mounted = true;
  };
  start = (ready: boolean, options: UseWhistleRecorderOptions): Promise<WhistleTranscript> => {
    if (!this.mounted) return Promise.reject(disposed());
    if (this.operation) return this.operation.completion.promise;
    const operation: Capture = {
      controller: new AbortController(),
      completion: deferred<WhistleTranscript>(),
    };
    this.operation = operation;
    this.update({ status: 'permission', error: undefined });
    void (async () => {
      try {
        if (!ready) throw notReady();
        const transcription = validateOptions(options.transcribeOptions);
        const recording = await this.capture({
          maxDurationSeconds: options.maxDurationSeconds,
          echoCancellation: options.echoCancellation,
          noiseSuppression: options.noiseSuppression,
          signal: operation.controller.signal,
        });
        if (this.operation !== operation) {
          recording.cancel();
          void recording.result.catch(() => {});
          return;
        }
        operation.recording = recording;
        this.update({ status: 'recording' });
        const pcm = await recording.result;
        if (this.operation !== operation) return;
        operation.recording = undefined;
        this.update({ status: 'transcribing' });
        const result = await this.transcribe(pcm, {
          ...transcription,
          signal: operation.controller.signal,
        });
        this.finish(operation, result);
      } catch (cause) {
        this.finish(operation, undefined, asError(cause));
      }
    })();
    return operation.completion.promise;
  };
  private finish(operation: Capture, result?: WhistleTranscript, error?: WhistleError) {
    if (this.operation !== operation) return;
    this.operation = undefined;
    if (error) {
      operation.controller.abort();
      operation.recording?.cancel();
    }
    this.update({ status: 'idle', ...(result ? { result, error: undefined } : { error }) });
    if (error) operation.completion.reject(error);
    else operation.completion.resolve(result as WhistleTranscript);
  }
  stop = (): Promise<WhistleTranscript | undefined> => {
    const operation = this.operation;
    if (!operation) return Promise.resolve(undefined);
    if (this.state.status === 'permission') this.cancel();
    else if (operation.recording) {
      this.update({ status: 'stopping' });
      void operation.recording
        .stop()
        .catch((cause) => this.finish(operation, undefined, asError(cause)));
    }
    return operation.completion.promise;
  };
  cancel = () => {
    if (this.operation) this.finish(this.operation, undefined, aborted());
  };
  release = () => {
    this.mounted = false;
    if (this.operation) this.finish(this.operation, undefined, disposed());
    this.update({ status: 'idle', error: undefined });
  };
}
