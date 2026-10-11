---
title: API behavior
group: Guides
---

All public entry points are ESM with TypeScript declarations. They have no import-time
side effects. Root is the browser entry; use `/node` explicitly for Node applications.

```ts
import { createWhistle, WhistleError } from '@tiny-stt/whistle';
import { createWhistle as createNodeWhistle } from '@tiny-stt/whistle/node';
import { decodeAudio } from '@tiny-stt/whistle/audio';
import { startRecording } from '@tiny-stt/whistle/microphone';
```

## Factories

Both factories resolve `Promise<Whistle>` only when inference is ready.

| Browser option                           | Default                         | Contract                                                               |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `assetsUrl?: string \| URL`              | unset                           | CLI-generated directory; relative to document base; no remote fallback |
| `modelUrl?: string \| URL`               | pinned official URL             | Mirror of exact locked model; integrity verified                       |
| `wasmUrl?: string \| URL`                | packaged binary                 | Mirror of exact locked WASM; integrity verified                        |
| `workerUrl?: string \| URL`              | packaged/asset directory worker | Matching browser module worker, usually same-origin                    |
| `cache?: 'auto' \| 'none'`               | `auto`                          | SDK-managed IndexedDB persistence                                      |
| `signal?: AbortSignal`                   | unset                           | Initialization only; termination cleans up aborted loading             |
| `onProgress?: (p: LoadProgress) => void` | unset                           | Observer; throwing does not fail initialization                        |

`assetsUrl` conflicts with `modelUrl` and `wasmUrl`. HTTP(S) URL resolution is
required in the browser. Custom model versions are not accepted by URL override.

| Node option                              | Contract                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `assetsPath: string \| URL`              | Required local directory; `file:` URLs supported; relative to cwd at invocation |
| `signal?: AbortSignal`                   | Initialization only                                                             |
| `onProgress?: (p: LoadProgress) => void` | Same progress type; local reads use `fromCache: true`                           |

`assetsPath` never accepts an HTTP(S) location. Every inventory file is verified
before the local loader is imported. File paths are resolved independently of the
package installation directory. The package's Node worker is located by module URL.

## Shared contract

```ts
type WhistleLanguage = 'en' | 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pl';
interface WhistleWord {
  text: string;
  start: number;
  end: number;
  probability: number;
}
interface WhistleTranscript {
  text: string;
  language: WhistleLanguage | null;
  words?: WhistleWord[];
  timings: {
    firstTokenMs: number;
    decodeTokensPerSecond: number;
    totalMs: number;
  };
}
interface TranscribeOptions {
  language?: WhistleLanguage | 'auto';
  keywords?: string[];
  wordTimestamps?: boolean;
  signal?: AbortSignal;
}
interface Whistle {
  transcribe(audio: Float32Array, options?: TranscribeOptions): Promise<WhistleTranscript>;
  dispose(): Promise<void>;
}
interface LoadProgress {
  stage: 'loading-runtime' | 'loading-model' | 'initializing' | 'ready';
  asset?: 'loader' | 'wasm' | 'model';
  loadedBytes?: number;
  totalBytes?: number;
  fraction?: number;
  fromCache?: boolean;
}
```

PCM is 16 kHz mono, 1–480,000 samples, finite and in `[-1,1]`. Validation and copying
happen at invocation, before queueing. Caller buffers are never transferred. A
nonzero typed-array offset is respected. Sampling rate is the caller's responsibility.

Languages default to `auto`; timestamps default to false. Keyword entries are
trimmed, empty entries removed, and case-sensitive duplicates removed. CR, LF and
NUL are rejected. The SDK bounds keyword allocations to **128 unique phrases and
8,192 UTF-8 bytes**, including newline separators. The header declares no keyword
size guarantee; the engine may still reject overly complex prompts. These are SDK
allocation limits, not advertised engine quality guarantees.

Words map the engine's `word` field to `text`; times/probabilities are not synthesized.
Silence becomes `{ text: '', language: null }` with `words: []` when requested.
Metrics must be finite; malformed/unsupported output is an explicit error. Transcript
boundary whitespace is trimmed, preserving internal punctuation/content.

`totalMs` starts in the ready worker before PCM allocation/copy and ends after
normalization. It excludes queue delay, cold loading/reloading, recording, decoding,
and main-thread delivery. First-token and decoder throughput values come from the
engine; they are not microphone-to-caption metrics.

Each instance owns one worker and engine. Calls run FIFO and the model stays loaded.
A queued abort does not disturb another request. An active abort retires that
worker generation and reloads before queued work resumes; old events cannot resolve
new requests. Failed inference is not automatically retried. A worker crash is
terminal (`WORKER_FAILED` for subsequent work); create a new instance explicitly.
Disposal is terminal, idempotent and settles all active/queued work with `DISPOSED`.

Progress is per asset. Locked byte sizes are known for transfers; initialization
has no numeric estimate. Cache/local completion is marked `fromCache: true`.
`ready` occurs once per factory, even if a later abort requires reloading.

## Browser helpers

```ts
decodeAudio(input: Blob, options?: { signal?: AbortSignal }): Promise<Float32Array>;

interface RecordingOptions {
  maxDurationSeconds?: number; // > 0 and <= 30; default 30
  echoCancellation?: boolean; // default true
  noiseSuppression?: boolean; // default true
  signal?: AbortSignal;
}
interface Recording {
  readonly result: Promise<Float32Array>;
  stop(): Promise<Float32Array>;
  cancel(): void;
}
startRecording(options?: RecordingOptions): Promise<Recording>;
```

Decoding averages all channels equally and resamples through Web Audio. Resampling
filter overshoot is bounded to `[-1,1]`. File clips exceeding 30 seconds are rejected.
No remote decoder is used. Browser decoding/rendering has no cooperative abort API:
cancellation rejects promptly, closes the live AudioContext, and discards any late
decoder/render output; the bounded offline render disconnects its source when done.

`startRecording` resolves after capture starts. Manual stop and automatic stop use
the same `result`; repeated `stop()` calls return that same promise. Cancellation
rejects `result` with `ABORTED` until completion, including during final decoding.
A late permission grant after abort has all its tracks stopped. Permission prompts
themselves cannot be programmatically dismissed. Timer/event delay cannot expand
output beyond the explicitly requested sample limit. Capture is completed-clip,
not continuous transcription. Always observe `recording.result` rejection.

## Errors

`WhistleError` extends `Error` with a stable `code`, message and optional `cause`.
Errors transported from workers preserve a safe code/message pair, not arbitrary
engine objects or stack/cause internals. SDK code does not log audio, keywords or
transcripts. The upstream loader may write runtime diagnostics on a WASM failure.

| Code                      | Meaning                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `UNSUPPORTED_ENVIRONMENT` | Required browser capability unavailable                       |
| `INVALID_OPTIONS`         | Invalid language, URL combination or option type/value        |
| `INVALID_AUDIO`           | Empty/wrong PCM type, non-finite or out-of-range sample       |
| `AUDIO_TOO_LONG`          | More than 480,000 samples or decoded file over 30 seconds     |
| `AUDIO_DECODE_FAILED`     | Invalid/unsupported encoded audio                             |
| `MICROPHONE_DENIED`       | Permission/security denial                                    |
| `MICROPHONE_UNAVAILABLE`  | No usable device, failed start or capture                     |
| `ASSET_NOT_FOUND`         | Required local/self-hosted asset missing/unreadable           |
| `ASSET_DOWNLOAD_FAILED`   | Network/HTTP transfer failed                                  |
| `ASSET_INTEGRITY_FAILED`  | Locked size/SHA-256 mismatch                                  |
| `ASSET_INCOMPATIBLE`      | Unsupported/malformed manifest or release mismatch            |
| `MODEL_LOAD_FAILED`       | Engine rejected model or did not load speech capability       |
| `INFERENCE_FAILED`        | Negative engine status or runtime inference failure           |
| `INVALID_ENGINE_OUTPUT`   | Truncated, malformed or unsupported engine output             |
| `WORKER_FAILED`           | Worker startup/crash/protocol failure                         |
| `OUT_OF_MEMORY`           | Allocation failure or allocation RangeError                   |
| `ABORTED`                 | Caller cancellation                                           |
| `DISPOSED`                | Operation on a disposed instance or work rejected by disposal |
