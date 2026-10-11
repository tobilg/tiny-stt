# Codex implementation prompt — @tiny-stt/whistle

## How to use

Place `plans/whistle-sdk-prd.md` in your target repository, ideally alongside this file. Open local Codex in that repository and paste the prompt below. If the PRD is elsewhere, update its path in the first paragraph. The package name is `@tiny-stt/whistle`; no npm publication is requested.

---

## Prompt to give Codex

Implement **`@tiny-stt/whistle`**, the npm package described in **`plans/whistle-sdk-prd.md`** in this workspace. Read that document in full, along with any applicable `AGENTS.md` files and existing repository instructions. The PRD is the product specification. Your task is to build and verify the SDK, CLI, examples, and documentation—not to write another PRD, stop at a plan, or deliver only a scaffold.

### Product intent

We want an independently written TypeScript wrapper around **Cactus Compute's official Whistle-compatible JS/WASM runtime** for local speech-to-text in browsers and Node.js.

- Whistle is the speech model; the runtime files are named `needle.js` and `needle.wasm` because the engine is shared with Needle.
- STT requires `whistle.cact`, not the Needle text model. Do not download `needle3.cact` for inference.
- Do not use `needle-rs` as the backend: the version inspected during planning supported text/tool calling, not Whistle STT.
- Do not copy the website's worker or frontend source. Write our SDK independently against the official runtime API. Vendoring licensed official runtime assets is intended.
- Ship the compatible loader/WASM/worker code in the npm package, but leave the roughly 16.9 MB model weights out of its tarball.
- Support a build/deployment-time `download --out <directory>` command that prepares the model, runtime/support files, a versioned integrity manifest, and license notices.
- Node must load explicitly configured local assets and operate with outbound networking denied. Missing assets must cause a clear error, never an automatic remote fallback.
- Browser use must support the convenient pinned-model download and fully self-hosted assets.
- V1 is completed-clip transcription and push-to-talk, up to 30 seconds. Continuous transcription, TTS, hosted APIs, and model training are out of scope.

### Work autonomously within the specification

Start with repository inspection and preserve existing user changes. Reuse the repository's package manager, tooling, layout, and conventions when appropriate. If the workspace is empty, establish a small maintainable TypeScript/ESM package. The owner has chosen `@tiny-stt/whistle`. Set the package’s `package.json` `name` to exactly `@tiny-stt/whistle` and use that identity consistently in imports, exported subpaths, installation commands, examples, and documentation. Do not substitute a temporary scope or ask the owner to choose the package name again. The CLI executable remains `whistle` as specified in the PRD.

Make routine implementation choices yourself and document significant choices concisely. Do not repeatedly ask for approval for reversible local work, normal tests, or required asset downloads. Respect any actual environment permission boundary. If blocked, explain the exact blocker and finish other independent work that remains possible.

Do not publish to npm, push to a remote, deploy a public site, reserve a name, send messages, or make unrelated changes. Produce a locally verified release candidate. Do not record personal microphone audio without explicit authorization; use a small licensed or self-created fixture and deterministic browser capture tests.

### First milestone: prove the actual upstream integration

Before spending time on an elaborate abstraction, verify a real transcription with a pinned compatible loader/WASM/Whistle pair in Node and a browser.

The candidate revisions from the official demo are:

- Runtime repository `Cactus-Compute/needle3`: `c7c415a3d1b3d929014bc6e866d51ebb971f7089`, files under `wasm/`.
- Model repository `Cactus-Compute/whistle`: `b358ddadd89b7a713b5aa131f23032d3cca1b251`, file `whistle.cact`.

Inspect the pinned `needle.h`, JS exports, initialization conventions, and license files. Verify `needle_load`, `needle_transcribe`, error returns, output capacity behavior, and the model-buffer lifetime. The inspected demo passed the model length as a `BigInt`; do not assume an ordinary number is ABI-compatible.

Record immutable revisions, actual sizes, SHA-256 hashes, provenance, and licenses in a checked-in asset lock manifest. Compute and verify real hashes; never invent them. A newer immutable pair is acceptable only for a concrete compatibility reason, with the change documented and both environments retested. Do not ship floating `main` URLs.

This milestone is a compatibility check, not the final deliverable. Continue through the full PRD after it succeeds. If a required behavior genuinely conflicts with the pinned engine, report the evidence and propose the smallest necessary change rather than silently dropping it.

### Implementation priorities

1. **Shared typed core:** `Whistle`, result/options types, stable `WhistleError` codes, option/PCM validation, and upstream result normalization.
2. **Environment adapters:** browser Web Worker and Node worker thread, isolated engine state, FIFO requests, ready initialization, predictable abort behavior, and idempotent terminal disposal.
3. **Offline assets and CLI:** pinned acquisition, integrity checks, atomic installation, valid-file reuse, offline verification, clear failures, and no npm postinstall download.
4. **Browser loading:** configurable/default/self-hosted assets, deployable worker paths, persistent cache with graceful fallback, and truthful progress.
5. **Optional browser helpers:** decode files to 16 kHz mono PCM and record the microphone with manual stop, automatic stop, cancellation, and full resource cleanup.
6. **Consumer examples and documentation:** browser push-to-talk/file flow and Node local-assets inference, working from installed package artifacts.
7. **Validation and packaging:** real-model tests, lifecycle/CLI risk tests, a clean tarball consumer, licenses, and an evidence-based compatibility note.

The public entry points should follow the PRD: browser root, `/node`, `/audio`, and `/microphone`. Prefer public ESM and TypeScript declarations; adapt the official loader internally as needed. Do not add a public CommonJS surface just for completeness.

### Critical behavioral details

- Core `transcribe()` consumes 16 kHz mono `Float32Array` PCM. Reject empty input, invalid numeric samples, and more than 480,000 samples. Do not silently truncate or chunk.
- Preserve caller buffer ownership and snapshot queued input so later mutations do not affect a request. Respect non-zero typed-array offsets.
- Keep the model loaded per instance and serialize inference. Multiple instances must not share mutable engine state.
- A normal worker message cannot interrupt blocking WASM inference. If cancellation requires termination, reject the aborted request, retire stale worker events, and reload before surviving queued work. Node recovery remains local-only.
- Dispose must settle all pending promises and release workers/resources. No worker should keep a Node process alive after disposal.
- Check allocation failures and engine return statuses. Avoid stale heap views after memory growth. Do not free model bytes prematurely or read result strings beyond their allocated buffer.
- The demo's fixed output buffer and disabled timestamps are not the product contract. Support the PRD's timestamp output and detect truncation/malformed JSON.
- No telemetry, audio/transcript uploads, download-count requests, hidden remote fallback, or network inference.
- Browser `assetsUrl` and Node `assetsPath` must consume the CLI-generated layout without manual path surgery.
- Static, packaged loader/worker files are preferable to fetching and evaluating JavaScript text. Verify and document CSP/bundler requirements instead of assuming compatibility.
- Browser offline use requires an available/cached app as well as model assets. Do not equate self-hosting with a fully offline PWA.

### Validation requirements

Use meaningful tests at the risky boundaries; avoid a large suite that merely mirrors helper implementation details. Follow the PRD acceptance criteria AC-01 through AC-18.

At minimum:

- Run real speech transcription in Node and a browser using the selected official model; mocks alone are insufficient.
- Record the test fixture's source/license and verify a sensible transcript expectation, silence handling, and timestamp bounds when enabled.
- Exercise invalid PCM, caller ownership, FIFO ordering, queued and active abort, stale events, disposal, and worker cleanup.
- Verify CLI checksum failure, interrupted writes, valid-file reuse without networking, and preservation of unrelated files.
- Prepare assets, deny outbound networking, then prove Node initialization, transcription, repeated calls, and cancellation recovery work.
- Prove browser self-hosted inference with external hosts blocked, plus persistent-cache reuse and cache-unavailable behavior.
- Test file downmix/resampling and microphone auto-stop/cancellation cleanup without requiring CI microphone hardware.
- Create `npm pack`, install it in a clean consumer, and test Node and a production browser build, including a non-root application base path.
- Inspect the tarball for required workers/runtime/types/CLI/notices and the absence of model weights, recordings, and temporary caches.
- Run the configured typecheck, build, and relevant test suites. Broaden testing only to resolve a remaining risk or required gate.
- Record measured cold/warm behavior and a bounded repeated-call memory check. Do not present the upstream native 11 ms benchmark as our browser performance.

Use the initial Node 22/24 targets and current desktop browser targets from the PRD. If the environment cannot execute a required platform, still provide the test and report precisely what was not run. Never label an unexecuted test as passed or treat mock-only validation as real inference.

### Licensing and project boundaries

Use Apache-2.0 for our original code unless repository instructions establish a compatible alternative. Preserve the exact upstream licenses and applicable notices, identify any adapted upstream files, and include required attribution in both the npm tarball and CLI-generated asset distribution. Present the SDK as independent rather than official Cactus software.

Keep changes limited to this product. Do not introduce a hosted service, Python runtime dependency, native compiler requirement, alternative model backend, or continuous-STT API to make a demo appear complete.

### Finish with a reviewable handoff

Complete implementation and documentation before returning. In your final response, provide:

1. What was implemented and any material deviation from the PRD.
2. Exact local commands to install/build, prepare assets, run the Node example, and run the browser example.
3. Test results, distinguishing real-model tests, offline/network-denied tests, packed-consumer tests, and checks that could not run.
4. Selected upstream revisions, where the integrity manifest and license notices live, and measured performance context.
5. A concise acceptance-criteria status list and remaining concrete limitations.
6. Any remaining owner decision needed before publication, such as final CLI executable naming or branding. The package name `@tiny-stt/whistle` is already decided. Do not publish it yourself.

Do the work now; continue beyond planning until the specified local release candidate is implemented and sufficiently verified, or a concrete external blocker prevents completion.

---

## Expected files to provide to the agent

- Required: `whistle-sdk-prd.md`.
- Optional: this prompt file for reference after pasting.
- Optional: an existing repository and its normal instructions. No website source code, pre-existing model download, or API key is required to begin.

## Interpretation note

Here, “build the PRD” means **implement the product specified by the PRD**. The agent should not spend the task creating another requirements document.
