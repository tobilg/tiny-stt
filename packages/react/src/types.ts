import type {
  BrowserWhistleOptions,
  LoadProgress,
  TranscribeOptions,
  WhistleError,
  WhistleTranscript,
} from '@tiny-stt/whistle';
import type { RecordingOptions } from '@tiny-stt/whistle/microphone';

/** Browser asset options for a hook. Loading is explicit; progress is returned as state. */
export type UseWhistleOptions = Omit<BrowserWhistleOptions, 'signal' | 'onProgress'>;

/** Current engine/queue activity. Read `ready` separately to determine whether a model is loaded. */
export type WhistleStatus = 'idle' | 'loading' | 'decoding' | 'transcribing';

/** Reactive snapshot for one hook-owned engine. */
export interface WhistleState {
  /** Current loading or active request stage; idle also includes an unloaded engine. */
  readonly status: WhistleStatus;
  /** Whether load has completed. Active inference cancellation may require worker recovery. */
  readonly ready: boolean;
  /** Number of active and queued transcription requests; excludes model loading and recording. */
  readonly pending: number;
  /** Most recent truthful per-asset initialization progress, or undefined before loading. */
  readonly progress: LoadProgress | undefined;
  /** Last successful transcript; retained across cancellation and pagehide/effect replay. */
  readonly result: WhistleTranscript | undefined;
  /** Latest failure, including ABORTED; cleared when starting new work or on success. */
  readonly error: WhistleError | undefined;
}

/** State and actions returned by useWhistle. Actions reject typed errors; observe their promises. */
export interface UseWhistleReturn extends WhistleState {
  /**
   * Explicitly load the configured engine. Concurrent calls share initialization.
   * @returns Readiness; resolves immediately if already loaded.
   * @throws WhistleError for asset/runtime failure, ABORTED after cancel, or DISPOSED after unmount.
   */
  load(): Promise<void>;
  /**
   * Queue one completed clip after loading.
   * @param audio - 1–480,000 finite mono 16 kHz samples in [-1, 1], copied at invocation.
   * @param options - Per-request hints, timestamps and cancellation; also snapshotted at invocation.
   * @returns The transcript once earlier surviving requests finish.
   * @throws WhistleError for invalid input, MODEL_LOAD_FAILED before readiness, ABORTED,
   * DISPOSED or engine failures. Caller buffers stay attached and owned by the caller.
   */
  transcribe(audio: Float32Array, options?: TranscribeOptions): Promise<WhistleTranscript>;
  /**
   * Queue browser decoding and transcription in the same FIFO as PCM calls.
   * @param file - Encoded File/Blob; decoder support depends on the browser.
   * @param options - Per-request hints, timestamps and a signal covering both decode and inference.
   * @returns The completed transcript; files exceeding 30 seconds reject without truncation.
   * @throws WhistleError for decode, readiness, inference, cancellation or disposal failures.
   */
  transcribeFile(file: Blob, options?: TranscribeOptions): Promise<WhistleTranscript>;
  /**
   * Cancel loading and all active/queued requests with ABORTED. Keeps a loaded instance reusable.
   * Does not stop a separate recorder's capture; use that recorder's cancel as well.
   */
  cancel(): void;
}

/** Recording preferences applied at the next start; changes do not alter an active recording. */
export interface UseWhistleRecorderOptions extends Omit<RecordingOptions, 'signal'> {
  /** Hints and word timestamps snapshotted at start. Cancellation is owned by the recorder. */
  transcribeOptions?: Omit<TranscribeOptions, 'signal'>;
}

/** Recorder activity. `stopping` covers a manual stop and final audio decoding. */
export type WhistleRecorderStatus =
  | 'idle'
  | 'permission'
  | 'recording'
  | 'stopping'
  | 'transcribing';

/** Reactive snapshot for one recorder; it never owns a second model. */
export interface WhistleRecorderState {
  /** Current activity. Automatic stop advances to transcribing after PCM decoding completes. */
  readonly status: WhistleRecorderStatus;
  /** Last successful recorded-clip transcript, retained on cancellation. */
  readonly result: WhistleTranscript | undefined;
  /** Latest capture/transcription failure, including ABORTED; cleared at the next start. */
  readonly error: WhistleError | undefined;
}

/** Recording actions using the engine supplied to useWhistleRecorder. */
export interface UseWhistleRecorderReturn extends WhistleRecorderState {
  /**
   * Start capture from a user gesture after the supplied hook reports ready.
   * @returns The eventual transcript after manual/automatic stop, not merely capture readiness.
   * Repeated starts during an operation return that operation's completion promise.
   * @throws WhistleError for microphone, readiness, decoding, inference, cancellation or disposal.
   */
  start(): Promise<WhistleTranscript>;
  /**
   * Stop and transcribe; repeated calls during an operation share its completion.
   * Releasing before permission arrives cancels and stops any late granted tracks.
   * @returns The operation's transcript, or undefined if idle. Cancellation rejects with ABORTED.
   */
  stop(): Promise<WhistleTranscript | undefined>;
  /** Discard this recording or cancel its queued/active transcription without cancelling other calls. */
  cancel(): void;
}
