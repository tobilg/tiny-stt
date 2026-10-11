/**
 * Shared contracts used by both environment adapters.
 * @packageDocumentation
 */

/** Language codes recognized by the pinned Whistle model. Use `auto` in options for detection. */
export type WhistleLanguage = 'en' | 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pl';

/** One engine-aligned word, available only when timestamps are requested. */
export interface WhistleWord {
  /** Word text and punctuation, mapped from the engine's `word` field. */
  text: string;
  /** Start offset in seconds from the beginning of the input clip. */
  start: number;
  /** End offset in seconds; never before `start` or beyond the clip duration. */
  end: number;
  /** Engine confidence in the inclusive range 0–1; not a calibrated accuracy guarantee. */
  probability: number;
}

/** Normalized completed-clip result. Silence has empty text and a null language. */
export interface WhistleTranscript {
  /** Transcript with boundary whitespace removed and internal punctuation preserved. */
  text: string;
  /** Detected language, or `null` for silence. */
  language: WhistleLanguage | null;
  /** Present only with `wordTimestamps: true`; an empty array for silence. */
  words?: WhistleWord[];
  /** Worker and engine metrics; these exclude recording, loading and queue wait. */
  timings: {
    /** Engine-reported time to first token, in milliseconds. */
    firstTokenMs: number;
    /** Engine-reported decoder throughput, in tokens per second. */
    decodeTokensPerSecond: number;
    /** Worker copy, inference and normalization time, in milliseconds. */
    totalMs: number;
  };
}

/** Options for one queued inference; defaults do not persist across calls. */
export interface TranscribeOptions {
  /** Language hint or automatic detection. @defaultValue `'auto'` */
  language?: WhistleLanguage | 'auto';
  /**
   * Optional recognition hints, trimmed and deduplicated case-sensitively.
   * At most 128 unique phrases and 8,192 UTF-8 bytes including separators.
   * CR, LF and NUL characters are rejected; hints do not force a transcript.
   * @defaultValue `[]`
   */
  keywords?: string[];
  /** Request aligned words with second-based offsets and probabilities. @defaultValue `false` */
  wordTimestamps?: boolean;
  /** Cancels this request. Active inference cancellation terminates and reloads its worker. */
  signal?: AbortSignal;
}

/**
 * A ready, isolated speech engine with a FIFO inference queue.
 *
 * Each factory call owns its model and worker. Keep an instance for repeated clips
 * and always dispose it when finished. Continuous transcription is not supported.
 */
export interface Whistle {
  /**
   * Transcribe one completed clip of 16 kHz mono PCM.
   *
   * @param audio - 1–480,000 finite samples in `[-1, 1]` (at most 30 seconds).
   * Nonzero view offsets are respected. Samples are copied immediately, so the
   * caller retains its attached buffer and may mutate it after invocation.
   * @param options - Per-request hints, timestamps and cancellation.
   * @returns A normalized transcript after earlier surviving requests complete.
   * @throws {@link WhistleError} for invalid PCM/options, cancellation, disposal,
   * worker failure, allocation failure or invalid engine output.
   * @remarks
   * Invalid input is rejected, never silently chunked or truncated. Queued aborts
   * remove only that request. Active aborts terminate the blocking WASM worker;
   * surviving queued requests wait for a fresh local/model load. Failed inference
   * is not retried. The PCM sample rate is the caller's responsibility.
   */
  transcribe(audio: Float32Array, options?: TranscribeOptions): Promise<WhistleTranscript>;
  /**
   * Permanently close the instance and release its worker/model resources.
   *
   * @returns The same completion promise on repeated calls; Node worker exit is awaited.
   * @remarks All active and queued work rejects with `DISPOSED`. Later calls to
   * `transcribe` also reject; disposing does not clear persistent browser assets.
   */
  dispose(): Promise<void>;
}

/** Progress for one asset or initialization stage; there is no overall estimated percentage. */
export interface LoadProgress {
  /** Current operation. `ready` is emitted once per factory, including after later recovery. */
  stage: 'loading-runtime' | 'loading-model' | 'initializing' | 'ready';
  /** Asset being transferred/verified, absent during initialization and readiness. */
  asset?: 'loader' | 'wasm' | 'model';
  /** Bytes received or verified for this asset. */
  loadedBytes?: number;
  /** Expected locked byte length when known. */
  totalBytes?: number;
  /** Per-asset completion in `[0, 1]`; absent when no numeric estimate is available. */
  fraction?: number;
  /** True for a verified persistent browser hit or a local Node read. */
  fromCache?: boolean;
}

/** Browser factory configuration; all URLs resolve relative to `document.baseURI`. */
export interface BrowserWhistleOptions {
  /**
   * CLI-generated asset directory, including its manifest and workers.
   * Enables self-hosting with no upstream fallback. Cannot be combined with
   * `modelUrl` or `wasmUrl`. A trailing slash is added when necessary.
   */
  assetsUrl?: string | URL;
  /** Mirror of the exact pinned model bytes. Defaults to the immutable official model URL. */
  modelUrl?: string | URL;
  /** Mirror of the exact pinned WASM bytes. Defaults to packaged `needle.wasm`. */
  wasmUrl?: string | URL;
  /** Matching module-worker URL; normally same-origin. Defaults to the packaged/asset-directory worker. */
  workerUrl?: string | URL;
  /**
   * Use verified IndexedDB asset persistence or disable SDK persistence.
   * Storage unavailability falls back to ordinary loading. `none` does not disable HTTP caching.
   * @defaultValue `'auto'`
   */
  cache?: 'auto' | 'none';
  /** Observer for asset loading and readiness; exceptions in the callback are ignored. */
  onProgress?: (progress: LoadProgress) => void;
  /** Initialization-only cancellation; detached when the factory resolves. */
  signal?: AbortSignal;
}

/** Required local-asset configuration for the Node factory; never enables networking. */
export interface NodeWhistleOptions {
  /**
   * CLI-generated directory as a filesystem path or `file:` URL.
   * Relative paths resolve against the working directory at factory invocation.
   * HTTP(S) URLs are rejected; absent/corrupt files cause an explicit error.
   */
  assetsPath: string | URL;
  /** Observer for verification and readiness; local reads set `fromCache: true`. */
  onProgress?: (progress: LoadProgress) => void;
  /** Initialization-only cancellation; detached when the factory resolves. */
  signal?: AbortSignal;
}

/** Locked integrity metadata for one deployable file. Custom model revisions are unsupported. */
export interface Asset {
  /** Exact expected byte length. */
  bytes: number;
  /** Lowercase hexadecimal SHA-256 of the complete file. */
  sha256: string;
  /** Immutable acquisition URL, present for externally distributed model weights. */
  source?: string;
}

/** Versioned CLI distribution inventory, compared with the SDK's compiled inventory on loading. */
export interface Manifest {
  /** Manifest format version; this release only accepts version 1. */
  schemaVersion: 1;
  /** Identifier for the pinned compatible runtime/model pair. */
  compatibilityId: string;
  /** SDK version that produced the support files. */
  sdkVersion: string;
  /** Flat file names mapped to integrity metadata; excludes the manifest itself. */
  files: Record<string, Asset>;
}

/** Fully normalized per-call options passed to the worker engine by the SDK. */
export interface EngineOptions {
  /** Explicit language hint or automatic detection. */
  language: WhistleLanguage | 'auto';
  /** Trimmed, nonempty and deduplicated keyword phrases. */
  keywords: string[];
  /** Whether the engine should return word timing information. */
  wordTimestamps: boolean;
}
