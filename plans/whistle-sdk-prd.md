# @tiny-stt/whistle — Product Requirements Document

**Document version:** 1.1  
**Date:** 2026-10-10  
**Status:** Ready for implementation, with an initial upstream compatibility check  
**Package name:** `@tiny-stt/whistle`  
**Companion document:** [Codex implementation prompt](plans/codex-implementation-prompt.md)

The owner has chosen `@tiny-stt/whistle` as the package name. Set `package.json`’s `name` field to this exact value and use it consistently in imports, installation commands, and documentation. Publication and final branding are separate decisions; choosing the name does not establish npm availability or publishing access.

## 1. Product summary

Build an independently written, framework-independent TypeScript npm package that makes Cactus Compute's **Whistle speech-to-text model** usable in browsers and Node.js through Cactus's official JavaScript/WebAssembly inference runtime.

The package should provide a small asynchronous transcription API, predictable resource management, browser audio helpers, and a build/deployment-time asset preparation command. Node applications must be able to transcribe with networking disabled after assets have been prepared. Browser applications should support both a convenient model download and completely self-hosted assets.

This is an SDK and packaging project around an existing inference engine. Do not implement a new speech model, port the Python package, substitute `needle-rs`, or copy Cactus's website application code.

### 1.1 What the names mean

- **Whistle** is the speech-recognition model. It turns audio into a transcript and can provide word timestamps.
- **Needle** is the related text/tool-calling model. Its official runtime is shared with Whistle; a filename such as `needle.wasm` does not mean that Needle text-model weights are required.
- **The official runtime plus `whistle.cact` is sufficient for STT.** Do not download `needle3.cact` for this product.
- Neither this product nor the discussed Whistle/Needle configuration provides text-to-speech. Spoken responses require a separate TTS system.

## 2. Decisions and their authority

This document consolidates the conversation and supplies implementable defaults where the conversation left details open. Distinguish settled direction from newly specified implementation defaults.

| Decision | Status | Consequence |
| --- | --- | --- |
| Build an original TypeScript npm wrapper for Whistle | Agreed direction | Use official runtime interfaces; author SDK code independently |
| Name the package `@tiny-stt/whistle` | Explicit user decision | Use this exact npm identity, including for all exported subpaths |
| Support browser and Node usage | Agreed direction | Separate environment adapters with the same core transcription contract |
| Support offline Node inference from local assets | Agreed direction | Explicit local asset paths; no runtime network fallback |
| Provide a build-time asset download command | Explicit user priority | Treat the CLI as a v1 deliverable |
| Include JS/WASM runtime in the package; keep weights separate by default | Established design | No approximately 16.9 MB model in the main npm tarball |
| Support configurable/self-hosted browser assets | Established design | Applications control hosting and deployment |
| Begin with completed clips and push-to-talk | Established initial scope | Maximum 30-second core input; no continuous dictation in v1 |
| Make microphone and file decoding optional helpers | Established design | PCM transcription remains independent of browser capture |
| Use a worker and serialize inference per instance | Established design | UI/event loop stays responsive; one engine is not called concurrently |
| Use Apache-2.0 for our original SDK | Recommended default adopted by this PRD | Preserve upstream licensing separately and verify pinned artifacts |
| Public ESM exports, explicit `/node` entry point | Implementation default | Do not spend v1 on a public CommonJS API unless the existing repo requires it |
| Node 22 and 24 test targets; current desktop browser engines | Implementation default | Confirm compatibility in the initial spike; report unsupported targets explicitly |
| Cancellation, progress, manifest, cache, and error contracts below | Implementation defaults | Implement these consistently; do not leave their semantics implicit |

A justified internal implementation change is acceptable if observable behavior and acceptance criteria remain intact. If a pinned upstream runtime makes a required behavior impossible, document the evidence and propose a narrow specification change; do not silently remove the requirement.

## 3. Evidence and starting assumptions

These findings were inspected on 2026-10-09. They are starting evidence, not a guarantee that future upstream releases retain the same ABI or behavior.

### 3.1 Verified upstream facts

- Cactus publishes `needle.js`, `needle.wasm`, and `needle.h` in the `Cactus-Compute/needle3` Hugging Face repository.
- Whistle weights are published separately as `Cactus-Compute/whistle/whistle.cact`, described as approximately 16.9 MB.
- Whistle accepts 16 kHz mono floating-point audio and supports clips of up to 30 seconds.
- Documented languages are English, German, French, Spanish, Italian, Dutch, and Polish, with automatic detection as an option.
- The speech API includes `needle_load`, `needle_transcribe`, and error reporting. Current distributions also expose streaming functions, but streaming is not a v1 requirement.
- The official runtime uses global, non-thread-safe state. Isolate each SDK instance in its own worker/runtime and serialize its calls.
- Published repository licenses for Needle, the Needle 3 artifact distribution, and Whistle were Apache-2.0. The demo-pinned revisions below carried the same Apache-2.0 license text.
- `needle-rs` npm 0.3.1 is an independent text/tool-calling runtime. Its inspected API did not expose Whistle speech transcription. It is not the implementation dependency for this SDK.

### 3.2 What the website demo taught us

The inspected demo uses `MediaRecorder`, decodes audio through a 16 kHz `OfflineAudioContext`, mixes channels to mono, and transfers a `Float32Array` to a dedicated worker. The worker downloads pinned runtime/model files, initializes the runtime, loads model bytes into WASM memory, calls `needle_transcribe`, parses JSON, and sends back the result.

It transcribes **after recording stops**. Its visible microphone animation is not evidence of live incremental transcription. The worker keeps its model loaded between calls and frees temporary per-request allocations. The demo disables word timestamps in its transcription call. It has no explicit application-managed persistent asset cache or download progress contract.

The demo also requests a model `config.json` for download counting. **Our SDK must not reproduce that counting request or add telemetry.**

Use these observations as an architectural reference. Do not copy the site's worker or frontend implementation into the package. The website code's availability is not a license grant for that code.

### 3.3 Candidate revision pair for the initial compatibility spike

These immutable revisions were read from the demo's public worker:

| Artifact | Repository | Candidate revision |
| --- | --- | --- |
| `wasm/needle.js`, `wasm/needle.wasm`, license | `Cactus-Compute/needle3` | `c7c415a3d1b3d929014bc6e866d51ebb971f7089` |
| `whistle.cact`, license | `Cactus-Compute/whistle` | `b358ddadd89b7a713b5aa131f23032d3cca1b251` |

Begin with this pair, or select a newer immutable pair if a concrete compatibility reason requires it. Verify a real transcription before committing to a pair. Record exact revisions, byte sizes, SHA-256 hashes, licenses, and provenance in a checked-in asset lock manifest. Do not ship floating `main` or `latest` artifact URLs. Hashes are not supplied in this PRD and must not be invented.

## 4. Users, goals, and non-goals

### 4.1 Primary users and jobs

1. A web developer adds private, on-device push-to-talk transcription without managing WASM pointers.
2. A Node developer processes local PCM recordings in a CLI, service, or desktop application without runtime internet access.
3. An application maintainer prepares a reproducible set of inference assets during CI or deployment and serves/packages those assets with the application.
4. A TypeScript developer wants typed errors, language options, timestamps, and explicit lifecycle behavior.

### 4.2 Goals

- Make first successful transcription possible with a small amount of application code.
- Keep speech inference local after assets are available.
- Avoid Python, native compilation, GPUs, and external STT services as runtime prerequisites.
- Keep model acquisition separate from npm installation and application inference.
- Support auditable, version-pinned assets and offline Node deployments.
- Make loading, cancellation, memory cleanup, errors, and unsupported inputs predictable.
- Demonstrate browser and Node usage from the **packed npm artifact**, not only workspace imports.

### 4.3 Explicit v1 non-goals

- Text-to-speech, Needle tool calling, text embeddings, and Whistle audio embeddings.
- Continuous dictation, live partial transcripts, voice activity detection, diarization, or speaker identification.
- Automatic chunking of arbitrarily long recordings.
- Model training, fine-tuning, model conversion, or a custom inference backend.
- A hosted transcription endpoint, user accounts, analytics, or billing.
- Node microphone capture or universal Node audio codec decoding.
- Framework-specific React/Vue hooks, React Native integration, or an Electron-specific SDK.
- Public CommonJS support, WASI components, WebGPU, or multithreaded WASM as separate deliverables.
- An automatic npm `postinstall` model download.
- Automatic publication to npm, deployment of a public website, or reserving package names.

## 5. Deliverables and package structure

Deliver one npm package containing original SDK code, TypeScript declarations, worker code, a compatible official JS/WASM runtime, the CLI, and all required licenses/notices. Model weights remain outside the main tarball.

| Export or executable | Responsibility |
| --- | --- |
| `@tiny-stt/whistle` | Browser `createWhistle`, shared public types and errors |
| `@tiny-stt/whistle/node` | Node `createWhistle`, same transcription/result contract |
| `@tiny-stt/whistle/audio` | Browser `decodeAudio(File | Blob)` helper |
| `@tiny-stt/whistle/microphone` | Browser `startRecording()` helper |
| Package CLI, working binary name `whistle` | `download`, `--help`, and `--version` |

Also deliver a small browser example, a Node local-assets example, tests, CI configuration, a README/API reference, and a compatibility/evidence note. Respect an existing repository's structure if one is provided; do not introduce a monorepo solely for this task.

Importing an entry point must not download files, start recording, instantiate a worker, or initialize a model. Browser-specific APIs must not be touched at module import time; importing code during SSR should not crash merely because `window` is absent. Calling the browser factory in an unsupported environment should produce a clear error. The Node entry point must not depend on DOM APIs.

## 6. Public API contract

All names below describe the new package, not an existing upstream SDK. Small naming improvements are acceptable if applied consistently to declarations, examples, tests, and documentation.

### 6.1 Shared types

```ts
export type WhistleLanguage =
  | "en" | "de" | "fr" | "es" | "it" | "nl" | "pl";

export interface WhistleWord {
  text: string;
  start: number;       // seconds from the beginning of this input clip
  end: number;
  probability: number;
}

export interface WhistleTranscript {
  text: string;
  language: WhistleLanguage | null;
  words?: WhistleWord[];
  timings: {
    firstTokenMs: number;           // engine-reported ttft_ms
    decodeTokensPerSecond: number; // engine-reported decode_tps
    totalMs: number;               // worker service time; see section 8
  };
}

export interface TranscribeOptions {
  language?: WhistleLanguage | "auto"; // default "auto"
  keywords?: string[];
  wordTimestamps?: boolean;             // default false
  signal?: AbortSignal;
}

export interface Whistle {
  transcribe(
    audio: Float32Array,
    options?: TranscribeOptions,
  ): Promise<WhistleTranscript>;
  dispose(): Promise<void>;
}

export interface LoadProgress {
  stage: "loading-runtime" | "loading-model" | "initializing" | "ready";
  asset?: "loader" | "wasm" | "model";
  loadedBytes?: number;
  totalBytes?: number;
  fraction?: number; // 0..1 for the identified transfer when total is known
  fromCache?: boolean;
}
```

Progress is per asset/stage, not a fabricated whole-operation percentage. Unknown totals remain undefined. Initialization does not claim a numeric percentage that the engine cannot report. A successful initialization emits `ready` once. Cached or local assets must not be reported as network downloads.

### 6.2 Browser factory

```ts
export interface BrowserWhistleOptions {
  assetsUrl?: string | URL;
  modelUrl?: string | URL;
  wasmUrl?: string | URL;
  workerUrl?: string | URL;
  cache?: "auto" | "none"; // default "auto"
  onProgress?: (progress: LoadProgress) => void;
  signal?: AbortSignal;    // initialization only
}

export function createWhistle(
  options?: BrowserWhistleOptions,
): Promise<Whistle>;
```

Asset selection rules:

1. With no options, use the package-bundled compatible runtime and fetch the pinned official Whistle model. No unrelated model or config download is allowed.
2. `modelUrl` overrides the hosting location of the pinned weights; `wasmUrl` is a bundler/deployment escape hatch for the compatible runtime binary. In v1, these are mirrors/self-hosting overrides, not arbitrary model-version selectors.
3. `assetsUrl` selects a complete directory generated by the asset preparation command. Resolve its manifest and runtime/model files from that directory. Do not fall back to upstream URLs if anything is missing or incompatible.
4. Reject ambiguous combinations of `assetsUrl` with `modelUrl` or `wasmUrl`. A `workerUrl` override can remain available for deployment constraints; its code must be the package's matching worker.
5. Resolve relative URLs against the document base URL and retain directory semantics. Handle application base paths and non-root deployments.
6. `cache: "none"` disables SDK-managed persistent caching; it does not promise to disable the browser's ordinary HTTP cache. In-memory reuse within a live instance still applies.

Browser example:

```ts
import { createWhistle } from "@tiny-stt/whistle";

const whistle = await createWhistle({
  assetsUrl: "/whistle/",
  onProgress: ({ stage, fraction }) => updateStatus(stage, fraction),
});

try {
  const result = await whistle.transcribe(pcm16k, {
    language: "auto",
    keywords: ["Kraków", "Cactus"],
    wordTimestamps: true,
  });
  displayTranscript(result);
} finally {
  await whistle.dispose();
}
```

The UI functions and `pcm16k` in examples are application-owned values, not SDK exports.

### 6.3 Node factory

```ts
export interface NodeWhistleOptions {
  assetsPath: string | URL; // filesystem directory or file: URL
  onProgress?: (progress: LoadProgress) => void;
  signal?: AbortSignal;
}

export function createWhistle(
  options: NodeWhistleOptions,
): Promise<Whistle>;
```

- `assetsPath` is required. Relative paths resolve against `process.cwd()` at factory invocation; resolve to an absolute path before creating the worker.
- Accept filesystem paths and `file:` URLs. Reject HTTP(S) URLs in the Node factory.
- Load local assets and their manifest. Fail clearly for missing files, integrity failure, or an incompatible runtime/model pair.
- **The Node runtime must not make network requests**, including on first inference, after cancellation, or during error recovery. Model acquisition belongs to the CLI.
- Execute inference in `worker_threads` so synchronous WASM computation does not block the main event loop.

```ts
import { createWhistle } from "@tiny-stt/whistle/node";

const whistle = await createWhistle({ assetsPath: "./vendor/whistle" });
try {
  const result = await whistle.transcribe(pcm16k, { language: "de" });
  console.log(result.text);
} finally {
  await whistle.dispose();
}
```

Do not reinterpret a Node `Buffer` of encoded audio as PCM. Node callers supply decoded `Float32Array` audio. A documented example may decode a narrowly specified PCM WAV format or use a clearly identified optional dependency, but this does not make universal decoding a core capability.

## 7. Functional requirements

### 7.1 Input and transcription — FR-01

- Core input is a mono `Float32Array` sampled at exactly 16,000 Hz. Sampling rate cannot be inferred from an array; document this contract prominently.
- Accept 1 through 480,000 samples inclusive. Reject empty and longer arrays; do not silently truncate or chunk.
- Validate finite values in `[-1, 1]`. Reject NaN, infinity, and out-of-range samples rather than hiding malformed input through implicit clipping.
- Support views with non-zero byte offsets. Never copy unrelated bytes from their backing buffers.
- Snapshot input at method invocation. The caller's array remains attached and usable, and later caller mutations do not alter a queued request.
- Pass language, keyword bias, and the timestamp flag through to the engine. The default language is automatic detection.
- Validate language identifiers and option types before inference. Normalize keyword entries by trimming, removing empty entries, and deduplicating without changing case. Reject embedded CR/LF because the engine represents separate phrases with newlines. Encode text as UTF-8.
- One successful request returns one normalized result. Silence is a normal result with empty text and `language: null`, not an exception.
- Map upstream word fields to `WhistleWord`. If timestamps are requested, return an array, including `[]` for silence. Otherwise omit `words`.
- Trim transcript boundary whitespace while preserving internal content and punctuation.
- Do not invent confidence values or timings. Unexpected/malformed upstream output is an explicit failure.

### 7.2 Lifecycle, isolation, and cancellation — FR-02

- The factory resolves only after runtime initialization and model loading succeed.
- Each SDK instance owns an isolated worker, WASM memory, and engine state. Distinct instances do not share mutable inference state.
- Reuse one loaded model for sequential requests on the same instance.
- Queue concurrent requests FIFO and run only one inference at a time per instance.
- An already-aborted request rejects without entering the queue. Aborting a queued request removes only that request.
- If the engine lacks cooperative interruption, aborting an in-flight request terminates its worker. Reject that request as `ABORTED`; recreate/reload the engine before processing surviving queued requests. Document the reload cost. Never claim a posted worker message can interrupt a blocking WASM call by itself.
- Use request IDs and worker-generation IDs so late events from retired workers cannot resolve current promises.
- Initialization abort rejects and cleans up partially initialized resources. Its signal does not become a lifetime cancellation signal after the factory resolves.
- `dispose()` is idempotent and terminal: reject queued/in-flight work as `DISPOSED`, terminate workers, release resources, and do not reinitialize automatically afterward.
- Worker crashes reject affected work deterministically. Permit an explicit subsequent request to trigger recovery only if this is documented and cannot retry completed work. Do not silently retry failed inference.
- Never leave pending promises or live worker threads after an error or disposal.

### 7.3 Browser file decoding — FR-03

```ts
export function decodeAudio(
  input: Blob, // File is a Blob subtype
  options?: { signal?: AbortSignal },
): Promise<Float32Array>;
```

- Decode using browser audio capabilities, downmix to mono, and resample to 16 kHz.
- Return valid PCM within the core contract, or a typed error. Reject clips over 30 seconds after decoding; do not hide duration loss.
- Formats depend on browser decoder support. Document/test a concrete subset and fail clearly for unsupported/corrupt files; do not advertise all codecs.
- Release audio contexts and temporary resources on success, error, or cancellation.
- The helper does not upload audio or invoke a remote decoder.
- Tests must verify sample count, channels, resampling, and valid output range, including non-16-kHz stereo input.

### 7.4 Browser recording — FR-04

```ts
export interface RecordingOptions {
  maxDurationSeconds?: number; // default 30; > 0 and <= 30
  echoCancellation?: boolean;  // default true
  noiseSuppression?: boolean;  // default true
  signal?: AbortSignal;
}

export interface Recording {
  readonly result: Promise<Float32Array>;
  stop(): Promise<Float32Array>;
  cancel(): void;
}

export function startRecording(
  options?: RecordingOptions,
): Promise<Recording>;
```

- Request microphone permission only when the application calls `startRecording()`, normally from a user gesture. Importing or initializing STT never requests microphone permission.
- `startRecording()` resolves once capture has started. Produce 16 kHz mono PCM on completion.
- Enforce the recording limit at the final PCM sample boundary, since a browser timer or recorder event may arrive late. Discard only samples beyond the explicitly requested recording limit; this bounded capture behavior is distinct from silently truncating a caller-provided file or PCM array.
- `stop()` is idempotent and resolves to the same result as `result`. Automatic stop at the duration limit resolves `result` even if the application never calls `stop()`.
- `cancel()` is idempotent, discards captured audio, releases the device, and rejects the result as `ABORTED` if recording is not already complete. Applications must observe `result`; document how to handle cancellation rejection.
- Stop all microphone tracks and timers on every terminal path, including late permission resolution after abort. Release decoder contexts and temporary object URLs when applicable.
- Document secure-context requirements and permissions. Denial, no usable device, and unsupported APIs must be distinguishable from inference failures.
- No always-on microphone, automatic restart, or background recording.
- The demo's 30-second time limit and completed-clip approach are the initial behavior; live partial transcripts are not simulated.

### 7.5 Assets, integrity, and caching — FR-05

- Keep an asset lock manifest in source control with a versioned schema, compatibility ID, immutable repository revisions, relative filenames, byte sizes, SHA-256 hashes, and license provenance.
- Ship JS/WASM and workers in the npm tarball. Do not require consumer-side C++, Rust, Python, Emscripten, or model compilation.
- Acquisition and inference use the same compatibility manifest. Do not mix a loader from one revision with a binary from another.
- Verify official downloads and configured mirrors against checked-in expected hashes. V1 supports the locked base model; custom fine-tuned models and arbitrary model versions are deferred. A checksum establishes consistency with the trusted lock manifest, not an independent claim of cryptographic publisher authentication.
- If the loader is adapted during packaging, retain provenance and hashes for both the fetched original and the packaged artifact. Runtime manifests must identify the files actually consumed.
- `cache: "auto"` uses an explicit browser persistent cache when available. Key it by immutable identity/hash; check integrity before reuse. Never cache a partial or rejected download as valid.
- Cache API denial, quota failure, or eviction must not make otherwise possible online inference fail solely because persistence is unavailable. Fall back to uncached loading and report cache status truthfully.
- A corrupt cached asset can be evicted and re-fetched from the configured source; an offline/missing source still produces an actionable error. Never switch sources silently.
- Keep the active model in memory per instance regardless of persistent cache settings. A browser cache is not a shared live engine.
- No SDK analytics, audio upload, transcript upload, download-count request, or unrelated configuration fetch.
- First-use browser networking is limited to explicitly selected/pinned inference assets and necessary application/worker code. Explicit self-hosted mode never contacts upstream hosts.

### 7.6 Build/deployment-time CLI — FR-06

```bash
npx @tiny-stt/whistle download --out ./vendor/whistle
npx @tiny-stt/whistle download --out ./public/whistle
```

The command downloads the pinned Whistle model and copies the compatible bundled runtime, required worker assets, manifest, and license/attribution files. It prepares files; it does not transcribe, publish, install system software, or run at npm install time.

Expected directory contract:

| Entry | Requirement |
| --- | --- |
| `whistle.cact` | Verified pinned model |
| `needle.js` | Compatible official runtime loader or documented adapted loader |
| `needle.wasm` | Matching inference binary |
| `manifest.json` | Versioned artifact inventory and integrity metadata |
| `LICENSE` and applicable notices | Upstream redistribution terms and attribution |
| Worker files, when required | Copied from this package and referenced consistently |

The implementation may organize worker support files in a subdirectory. Both runtime adapters must consume the generated layout; applications must not manually patch worker or WASM paths. Include every required support file in the manifest.

CLI requirements:

- `--out <directory>` is required and resolves relative to the invocation working directory. Support spaces and file paths on Windows, macOS, and Linux.
- Provide `download --help` and `--version` with clear descriptions and examples.
- Skip existing files only after their content matches expected hashes. Repair missing/corrupt managed assets without deleting unrelated files.
- Download to temporary files in the destination filesystem, verify size/hash, and atomically rename each completed asset. Publish the manifest last. On a first-time interrupted run, never leave a seemingly complete manifest for an incomplete asset set; on updates, an old manifest may remain and must detect mismatches.
- Use bounded, cancellable retries for transient download failures. Never accept a failed integrity check as success.
- A repeated run over a complete valid destination succeeds without network access.
- Provide `download --offline --out <directory>` to copy any available bundled files and validate the prepared model/assets without networking; fail if a required external asset is unavailable. This flag is a verification/preparation mode, not a request to download without connectivity.
- Exit 0 for a complete verified asset set, nonzero for failure. Use exit 2 for usage errors and conventional interruption behavior where supported. Error messages identify the failed asset and next action.
- Progress belongs on stderr so future machine-readable output is possible. A JSON output mode is optional, not a v1 gate.
- Use the installed package's locked asset versions. No floating `latest`, arbitrary revision flag, or silent upstream upgrade in v1.
- Preserve required notices if generated loader files differ from upstream originals.

Example application build:

```json
{
  "scripts": {
    "prepare:whistle": "whistle download --out public/whistle",
    "build": "npm run prepare:whistle && vite build"
  }
}
```

`whistle` is the working executable name supplied by the installed package. Resolve naming conflicts before publication. A deployment pipeline should use a lockfile-pinned package installation; unversioned `npx` examples are introductory usage, not the reproducibility mechanism.

### 7.7 Offline behavior — FR-07

**Node:** Prepare assets on a connected machine or in CI, deploy the npm package and asset directory together, then initialize through `assetsPath`. Inference, repeated calls, and cancellation recovery must succeed with outbound networking denied. The CLI can require networking for initial acquisition; the Node SDK cannot.

**Browser:** `assetsUrl` enables self-hosting without runtime dependency on Hugging Face. Actual disconnected PWA use additionally requires the application shell, SDK/worker code, and inference assets to be cached or otherwise locally served. The SDK alone cannot make an uncached website available offline. Provide integration guidance and a repeat-load/cache test, not an entire PWA framework.

## 8. Result semantics, observability, and errors

### 8.1 Timings

- `firstTokenMs` maps to the engine's reported first-token metric; it is not microphone-to-caption latency.
- `decodeTokensPerSecond` maps to the engine's decode metric.
- `totalMs` measures service time once a ready worker begins handling this request, including PCM copy, inference, and result normalization. Exclude initial model load, FIFO queue wait, microphone recording, and file decoding. Reinitialization after cancellation also occurs before this timer begins.
- Document measurement boundaries. Cold-start download/initialization timing belongs in benchmark output separately.
- Preserve finite engine values, including zero for silence where returned. Treat missing/non-finite required metrics as invalid engine output rather than fabricating a benchmark.

### 8.2 Typed errors

Expose `WhistleError` with a stable `code`, useful `message`, and optional `cause`. Transport a safe serialized error shape across workers and reconstruct the public error in the caller environment. Applications should not need to parse messages.

Minimum codes:

| Code | Meaning |
| --- | --- |
| `UNSUPPORTED_ENVIRONMENT` | Required platform capability is unavailable |
| `INVALID_OPTIONS` | Conflicting asset settings, invalid language, or invalid helper settings |
| `INVALID_AUDIO` | Empty, malformed, non-finite, or out-of-range PCM |
| `AUDIO_TOO_LONG` | Clip exceeds the supported duration |
| `AUDIO_DECODE_FAILED` | Browser decoder cannot decode the provided file |
| `MICROPHONE_DENIED` | User/browser denied microphone access |
| `MICROPHONE_UNAVAILABLE` | No usable input device or capture failure |
| `ASSET_NOT_FOUND` | Required local/self-hosted file is missing |
| `ASSET_DOWNLOAD_FAILED` | Network/HTTP acquisition failed |
| `ASSET_INTEGRITY_FAILED` | Size/hash verification failed |
| `ASSET_INCOMPATIBLE` | Manifest/schema/runtime/model pairing is unsupported |
| `MODEL_LOAD_FAILED` | Engine rejected the model |
| `INFERENCE_FAILED` | Engine returned a failure status |
| `INVALID_ENGINE_OUTPUT` | Malformed, truncated, or unsupported result JSON |
| `WORKER_FAILED` | Worker failed to start or crashed |
| `OUT_OF_MEMORY` | An allocation failed or runtime memory was exhausted |
| `ABORTED` | Caller cancelled initialization, recording, decoding, or transcription |
| `DISPOSED` | Work targeted a disposed instance or was rejected by disposal |

Map recoverable platform errors deliberately. Preserve useful engine last-error text where available without logging private audio, keywords, or transcripts automatically. Any debug logging must be explicit and avoid user content by default.

## 9. Runtime and packaging engineering requirements

### 9.1 Initial spike must prove the ABI

Before building the full API, verify real speech transcription with the selected JS/WASM/model pair in Node and a browser. Inspect the pinned loader and header instead of assuming ordinary Emscripten options are exported.

The inspected demo used these calls; they are **verification targets**, not an excuse to skip ABI checks:

```ts
engine._needle_load(modelPointer, BigInt(modelByteLength));
engine._needle_transcribe(
  pcmPointer,
  sampleCount,
  languagePointer,
  keywordsPointer,
  wordTimestamps ? 1 : 0,
  outputPointer,
  outputCapacity,
);
```

Confirm integer widths, return conventions, required exports, text encoding, output buffer behavior, model-buffer ownership, and supported Node/browser initialization paths. The model-length argument in the inspected build used a JavaScript `BigInt`; do not guess a numeric signature.

### 9.2 Memory safety and cleanup

- Check every allocation and engine return value; use `needle_last_error` where available.
- Copy exactly the typed-array view requested. Acquire current heap views after allocations that could grow WASM memory; do not hold detached views across growth.
- Keep the model buffer alive as long as required by the pinned engine. Do not assume `needle_load` copies or takes ownership; verify/document the contract or conservatively retain it until worker destruction.
- Free per-request audio and UTF-8 allocations in `finally` blocks. Null-terminate strings correctly and support non-ASCII keywords.
- Allocate a bounded result buffer large enough for the maximum supported transcript and word timestamps. The website's 16 KiB buffer is a demo detail, not the SDK limit to copy blindly.
- Read output with a capacity bound. Detect truncation/missing termination/invalid JSON and reject rather than returning partial success. Verify whether an upstream overflow signal allows safe resizing; do not blindly rerun a stateful operation.
- Worker termination is the definitive instance cleanup mechanism. Memory need not shrink between transcriptions, but must plateau after warmup rather than growing per request without bound.

### 9.3 Browser packaging

- Support a production Vite build and a self-hosted/plain browser ESM example or smoke fixture from packed artifacts.
- Browser bundles must not accidentally import Node `fs`, `path`, or `worker_threads`.
- Make worker/WASM asset resolution explicit and test non-root base paths. Do not rely on the development server's source tree.
- Avoid `eval`, `new Function`, and executing loader text fetched at runtime. Prefer packaged static loader/worker files. If an upstream packaging adaptation is necessary, keep it minimal, versioned, documented, and marked as modified.
- Document required CSP directives and WASM support. Do not advertise strict-CSP, Safari, or mobile compatibility without evidence. SharedArrayBuffer/COOP/COEP requirements must be verified; do not impose them merely because the engine is WASM.
- No browser microphone permission is needed to load the engine or transcribe provided PCM.

### 9.4 Node packaging

- Target Node 22 and 24 in CI initially; record actual results. Use ESM for the public Node API, with an internal adapter for the official loader's format as necessary.
- Locate worker and bundled files relative to installed module URLs, not repository-relative paths or the process working directory. Only user-provided relative `assetsPath` is cwd-relative.
- Handle local WASM bytes directly; do not route `file:` assets through a browser-style `fetch()` path that may not work in Node.
- Prove install-from-tarball behavior on at least Linux, with path/unit coverage and CI smoke coverage for macOS/Windows where available. Report any untested platform honestly.

## 10. Licensing and attribution

Our original SDK should use Apache-2.0 unless an existing repository has a compatible established license requiring a documented decision. The checked upstream Needle repository, official Needle 3 artifact distribution, and Whistle weights carry Apache-2.0.

For each pinned distribution, retain the actual license file, applicable copyright/attribution notices, and any upstream `NOTICE` content. Mark modified upstream loader files. Include notices in the npm tarball and in CLI-prepared redistributions, not just in the repository README. Identify the project as an independent integration and do not imply Cactus endorsement or use official branding as our own.

Do not copy the website's frontend/worker source. Inspecting its behavior informed the design; the implementation must be original. The official distributable JS/WASM assets are the intended vendored dependency.

This PRD records a practical reading of published license terms, not legal advice or an exhaustive third-party dependency audit. Verify the licenses of the exact files actually shipped. A concrete conflicting notice must be raised; hypothetical concerns alone should not block ordinary implementation.

## 11. Quality and validation strategy

Use tests to verify observable risks and contracts, not to mirror each helper implementation. Favor a compact suite that exercises real integration boundaries. Keep a small deterministic unit suite and a separately identified real-model integration suite.

### 11.1 Unit/contract coverage

- PCM validation, 480,000-sample boundary, non-zero offsets, caller buffer preservation, option validation, and result normalization.
- FIFO serialization, queued abort, in-flight abort/reinitialization, stale-worker event rejection, idempotent disposal, and rejected work after disposal.
- Progress events with known/unknown sizes and cache/local hits.
- Manifest compatibility, hash mismatch, atomic download behavior, interruption, repeated invocation, and unrelated-file preservation.
- Microphone stop/auto-stop/cancel semantics and track cleanup; decode helper downmix/resampling behavior.
- Safe handling of malformed worker messages, allocation failure, engine error status, and truncated output.

### 11.2 Real-model integration coverage

Use a small licensed or self-created speech fixture with a recorded expected transcript. Document its origin, license, sample rate, and preprocessing. Avoid downloading a large speech corpus. Do not use personal microphone recordings without explicit authorization. At least one English fixture is required; a small German fixture is desirable and becomes required before claiming German quality was tested.

Run real transcription on the pinned model in Node and a headless browser using injected/prepared PCM, so CI does not depend on microphone permission or hardware. Check non-empty normalized text against a reasonable fixture-specific expectation, language when appropriate, finite timing fields, and timestamp bounds/order when enabled. Silence should produce an empty result on the pinned pair; investigate any contradiction instead of inventing results.

Use a separate local deterministic capture fixture for microphone flow if needed. Distinguish testing the recorder from testing model accuracy.

### 11.3 Offline and distribution gates

- Install the `npm pack` tarball into a clean consumer project and execute the Node example.
- Prepare assets first, then deny outbound network access and run Node initialization/transcription/repeated requests. Also test worker recreation after an aborted request without enabling networking.
- Start a browser consumer with generated self-hosted assets and block external hosts. Transcription must work, with requests limited to the application's origin.
- Verify browser persistent-cache reuse and a cache-unavailable fallback. A full offline PWA is optional; do not claim it from a same-origin test alone.
- Inspect tarball contents: include declarations, exports, CLI executable, workers, loader, WASM, licenses, and lock metadata; exclude model weights, recordings, caches, and temporary downloads.
- Build and run the browser consumer under a non-root base URL to expose asset-path bugs.

### 11.4 Performance evidence

Record cold asset preparation/loading time, warm initialization where applicable, warm transcription wall time, engine metrics, and approximate memory behavior. State hardware, runtime/browser version, model/runtime revisions, clip duration, and timestamp setting.

The upstream 11 ms headline was a native Apple M4 Pro benchmark; it is **not** an SDK browser SLA. Do not promise real-time performance or a numerical browser latency target without measurement. Run a bounded repeated-transcription check after warmup to catch leaks, and document the method and results rather than assuming WASM memory must shrink.

## 12. Acceptance criteria

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC-01 | An original SDK uses the official Whistle-compatible runtime and no Needle text-model weights | Dependency/asset inventory and reviewed initialization path |
| AC-02 | Browser and Node factories perform real speech transcription through the pinned pair | Real-model integration results in both environments |
| AC-03 | Shared input, language, result, timestamp, and error contracts match this PRD | Public declarations and contract tests |
| AC-04 | Node local-assets mode makes no network requests, including recovery | Network-denied integration test |
| AC-05 | CLI creates a complete verified deployable asset directory | Manifest plus clean consumer startup |
| AC-06 | CLI is repeatable, checksum-aware, interruption-safe, and preserves unrelated files | CLI contract/integration tests |
| AC-07 | Default browser loading uses only pinned required assets; self-hosted loading has no external fallback | Recorded/request-asserted network behavior |
| AC-08 | Model stays loaded between calls; inference is isolated and serialized | Worker lifecycle tests and repeated-call integration |
| AC-09 | Abort and disposal release resources and settle all promises predictably | Cancellation and worker cleanup tests |
| AC-10 | Caller PCM is not detached or changed; later mutation cannot change queued input | Typed-array ownership tests |
| AC-11 | Audio-file helper downmixes/resamples and rejects unsupported/oversized inputs | Browser audio helper tests |
| AC-12 | Recorder supports manual/automatic stop and cancellation without leaving mic tracks open | Capture helper tests and documented manual check if available |
| AC-13 | Cached assets are versioned/verified; unavailable persistence degrades gracefully | Cache tests |
| AC-14 | Production browser bundles and the Node entry work from the packed package | Clean tarball consumer tests, including browser base path |
| AC-15 | Npm installation triggers no model download; weights are absent from main tarball | Tarball/install inspection |
| AC-16 | All distributed assets include correct license/notice information | Tarball and CLI output inspection |
| AC-17 | Documentation explains local inference, offline limits, supported formats, cancellation costs, and environment requirements | README/API/examples review |
| AC-18 | No continuous STT, TTS, telemetry, hosted API, or unrequested publishing is added | Scope review |

## 13. Implementation sequence

1. **Inspect the workspace.** Read `AGENTS.md` and existing package conventions, preserve user changes, and identify any existing project structure. Do not publish or overwrite unrelated work.
2. **Prove compatibility.** Retrieve and inspect the pinned assets/licenses, verify the ABI, and get one real transcription running in Node and a browser. Record revisions/hashes and any constraints. This is a short, concrete risk-reduction step, not an excuse to stop at a plan.
3. **Build the core.** Define public types/errors, original runtime adapter, worker protocol, transcription, isolation, queueing, cancellation, cleanup, and result normalization.
4. **Build asset preparation and Node offline flow.** Implement manifest/integrity checks, CLI acquisition, generated layout, and local-only Node initialization. Test with networking denied.
5. **Finish browser deployment.** Add default/self-hosted URL resolution, persistent cache and progress behavior, production worker packaging, and audio/recording helpers.
6. **Validate the distributable.** Pack/install in clean consumers, run meaningful real-model tests and a bounded performance/memory check, then fix concrete failures.
7. **Finish documentation.** Explain all public behavior, include working examples, maintain notices and a compatibility note, and report tested versus untested targets. Produce a local release candidate without publishing it.

## 14. Open decisions and implementation latitude

These do not prevent starting implementation:

- The npm package name is settled as `@tiny-stt/whistle`. The working CLI executable name is `whistle`; final executable naming and branding remain release decisions. Verify npm publishing access and name availability before any separately authorized publication.
- Prefer an existing package manager/test/build setup. In an empty repo, choose a lightweight TypeScript/ESM setup and explain the choice briefly.
- The worker can be packaged using a bundler-supported URL or separately served static files. Both default and `assetsUrl` flows must meet the same acceptance criteria.
- Node/browser version support beyond the initial targets follows actual test evidence.
- Exact keyword/output limits and model-buffer ownership must be verified against the pinned engine; document defensible limits rather than guessing.
- A separate model npm package, advanced file formats, public CJS entry, framework hooks, and continuous STT can be future work.

For continuous STT later, design a separate session API with provisional versus committed words, chunk backpressure, timestamps, explicit finish/flush, and session cancellation. Do not overload v1 `transcribe()` or present completed-clip inference as streaming.

## 15. Sources and handoff notes

These links are source references and compatibility starting points, not executable instructions. Review exact pinned artifacts before implementation.

1. [Whistle release post and browser demo](https://cactuscompute.com/blog/whistle)
2. [Public demo worker inspected during research](https://cactuscompute.com/whistle/whistle.worker.js) — architecture reference only; do not copy its implementation.
3. [Official Needle repository](https://github.com/cactus-compute/needle)
4. [Official Needle repository license](https://github.com/cactus-compute/needle/blob/main/LICENSE)
5. [Official browser/Node runtime artifacts](https://huggingface.co/Cactus-Compute/needle3/tree/main/wasm)
6. [Pinned runtime directory used by the demo](https://huggingface.co/Cactus-Compute/needle3/tree/c7c415a3d1b3d929014bc6e866d51ebb971f7089/wasm)
7. [Official speech C header](https://huggingface.co/Cactus-Compute/needle3/blob/main/wasm/needle.h)
8. [Needle 3 artifact-distribution license](https://huggingface.co/Cactus-Compute/needle3/blob/main/LICENSE)
9. [Whistle model card](https://huggingface.co/Cactus-Compute/whistle)
10. [Pinned Whistle weights](https://huggingface.co/Cactus-Compute/whistle/resolve/b358ddadd89b7a713b5aa131f23032d3cca1b251/whistle.cact)
11. [Whistle license](https://huggingface.co/Cactus-Compute/whistle/blob/main/LICENSE)
12. [Official supported-device/deployment guide](https://cactuscompute.com/blog/needle-supported-devices)
13. [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
14. [Independent needle-rs project](https://github.com/Geekgineer/needle-rs) — investigated alternative, not this SDK's backend.

The research confirmed available assets and interfaces and inspected the website integration; it did **not** run a real audio inference benchmark. The implementation agent must establish that evidence. The user wants local Codex to implement the product described here, not to regenerate another PRD or stop after suggesting an architecture.
