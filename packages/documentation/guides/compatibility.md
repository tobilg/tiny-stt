---
title: Compatibility and licensing
group: Guides
---

Verified locally on 2026-10-10. This is a release candidate, not a published npm
release. Tests distinguish real model inference from deterministic lifecycle and
capture doubles. No personal microphone audio was recorded.

## pnpm workspace verification

The initial pnpm 12.4.2 refactor was verified on the same date, placing the SDK
in `packages/whistle` (`@tiny-stt/whistle`); at that stage, examples shared its tooling.
The existing dependency versions were imported without upgrades. Frozen installs,
including reuse with `--offline`, formatting, typecheck, build, all 14 contract
tests, and all four real-model integration tests on both Node 22 and 24 passed.
Chromium, Firefox, and WebKit passed the relocated browser suite. The Node example,
the browser example's `/demo/` production build, the clean npm-installed consumer,
and a pnpm-produced tarball's network-denied Node consumer also passed. No engine,
model, public API, or asset-lock changes were needed. The detailed measurements
below and in `evidence.json` remain the original pre-refactor baseline.
Windows and remote CI were not executed locally.

## Biome and generated documentation

The follow-up migration replaced Prettier with Biome 2.5.15 and added the private
`@tiny-stt/documentation` workspace. All public APIs now carry TypeDoc comments,
including properties, defaults, units, cancellation, ownership and cleanup contracts.
TypeDoc 0.28.20 validates the four entry points and renders the static site; its
compiler is isolated from Whistle's compiler. A deliberate missing-comment probe
confirmed the strict public coverage gate fails correctly, then restored the source.

Biome lint/format/import checks, SDK typechecking/build, 14 contract tests, four
Node 22 real-model integration tests, and Chromium's real-model/cache/capture-helper
suite passed after the lint changes. The clean installed-tarball Node/network-denied
and production-browser `/demo/` consumer passed again. Vendored runtime and model
hashes are unchanged; generated support files were rebuilt and prepared assets refreshed.
The previous platform/performance measurements below remain the original baseline.

The docs check typechecked the embedded examples and traversed 33 generated pages
and 1,378 local links/assets. Chromium navigation/search passed under `/api/` with
external requests blocked. The dev server's guide watch and termination were tested.
The documentation job is configured in CI; remote CI has not been run here.

## React demo workspace

The browser example now lives in the private `@tiny-stt/demo` package, using React
and React DOM 19.3.0, Vite 8.3.4 and `@vitejs/plugin-react` 6.1.2 (stable versions
checked on 2026-10-10). It consumes Whistle's public exports through `workspace:*`;
React is not an SDK dependency. The Node example now lives in `packages/documentation/examples/node`.

On macOS arm64, Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2 passed real
speech/file transcription and timestamp bounds in the production `/demo/` build
with external hosts blocked. Fixture-backed capture tests passed pointer/keyboard
control, manual and 30-second automatic stop, pending/denied permission,
cancellation, pagehide/reload, and track/context/worker cleanup. Development tests
exercise StrictMode, real inference and unmount while permission is pending.
All three also verified actual Vite Fast Refresh, retained transcript state, worker
disposal and model reload. These checks never access physical microphone hardware.

The updated consumer test installs the React app with the packed SDK in a temporary
project using pnpm's offline store, then builds and runs real speech under `/demo/`.
It also retains installed-CLI offline preparation, network-denied Node speech,
default bundled browser worker/WASM and plain browser ESM checks. npm installation
coverage remains in `test:packed-node`. Model/runtime revisions and the performance
baseline below are unchanged. CI includes the demo in its desktop-browser matrix;
remote CI remains unexecuted locally.

## Upstream pair and ABI

The requested candidate pair worked; no revision change was needed:

| Artifact               | Immutable revision                         |      Bytes | SHA-256                                                            |
| ---------------------- | ------------------------------------------ | ---------: | ------------------------------------------------------------------ |
| Official `needle.js`   | `c7c415a3d1b3d929014bc6e866d51ebb971f7089` |     62,823 | `f3f7366dcad9555b792ee519d2518f3c506038bcb2ffd179e76e850000749359` |
| Official `needle.wasm` | same runtime revision                      |    903,655 | `c19b9ddf9c7de4eb4f37e5f1811c5bbea9f099041d2a27284daf89789ee8523d` |
| `whistle.cact`         | `b358ddadd89b7a713b5aa131f23032d3cca1b251` | 16,919,407 | `b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb` |

[asset-lock.json](https://github.com/tobilg/tiny-stt/blob/main/packages/whistle/asset-lock.json) contains immutable official URLs, repository
names, header/license hashes and the adapted loader hash. Source distributions:
[Needle runtime](https://huggingface.co/Cactus-Compute/needle3/tree/c7c415a3d1b3d929014bc6e866d51ebb971f7089/wasm),
[Whistle model](https://huggingface.co/Cactus-Compute/whistle/tree/b358ddadd89b7a713b5aa131f23032d3cca1b251).
No `needle3.cact` was acquired. No website worker/frontend was copied.

The pinned header and loader exports were inspected. `tests/abi.mjs` reproduces:

- `needle_load(pointer, BigInt(byteLength))` returns 0; a JS number throws TypeError.
- `needle_models()` returns 2 (speech). Bad model bytes return -1 with last-error text.
- Transcription before model load returns -1 and “no speech model loaded”.
- Real speech generates 27 tokens; timestamp JSON uses `word`, `start`, `end`,
  `probability`, `ttft_ms` and `decode_tps`. Silence returns empty language/text.
- A 32-byte output buffer still returns success (27), writes a terminator at byte 31,
  and contains incomplete JSON. There is no usable required-size return. The SDK
  uses a bounded 1 MiB output allocation and detects full/missing terminators,
  malformed UTF-8/JSON and unsupported result schemas. It does not rerun inference
  blindly on overflow.
- The engine itself accepts zero samples as silence; the SDK rejects empty input
  as the PRD requires. One-sample and 480,000-sample silence boundaries passed.
- The header does not specify model-buffer ownership. The adapter conservatively
  retains the model allocation until worker destruction; it does not claim that
  `needle_load` copies or takes ownership.

The only loader adaptation is disabling original Node filesystem/process hooks
and adding an ESM default export. Verified WASM bytes are always passed through
`wasmBinary`. Original/adapted files and exact licenses are retained. The deployed
loader is 62,960 bytes. There is no runtime fetching/evaluation of JavaScript text.

## Executed tests

| Environment/gate                           | Actual result                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS arm64 Node 22.22.2                   | Real speech, timestamps, silence, repeated calls, instance isolation, abort/recovery, disposal, local paths and typed failures passed                                                                         |
| macOS arm64 Node 24.21.0                   | Same four integration tests passed; a Node 24 test-runner flag inheritance issue was found and fixed                                                                                                          |
| Linux arm64 Node 22.12.0, Debian container | Clean tarball install, installed CLI offline preparation, real speech/repeated calls and cancellation recovery passed with Docker `--network none`                                                            |
| Linux arm64 Node 24.21.0, Alpine container | Same packed-consumer test passed with Docker `--network none`                                                                                                                                                 |
| Chromium 156.0.8078.4                      | Real model, self-hosted external-host blockade, CSP, cache reuse/corruption/denial, active abort recovery and helpers passed                                                                                  |
| Firefox 157.0 (Playwright)                 | Real model, self-hosting, CSP, cache reuse/denial and helpers passed                                                                                                                                          |
| WebKit 27.2 (Playwright)                   | Real model, self-hosting, CSP, IndexedDB reuse/corruption/denial and helpers passed                                                                                                                           |
| Installed Chrome 155.0.8059.40             | Initial direct-runtime real-speech compatibility spike passed                                                                                                                                                 |
| Production Vite 8 consumer                 | Installed tarball under `/demo/`, self-hosted real speech/file helper/timestamps, bundled default worker/WASM with model mirror, no external hosts passed                                                     |
| Plain browser ESM consumer                 | Installed package modules and CLI directory initialize/transcribe silence without a bundler                                                                                                                   |
| Consumer TypeScript                        | All four installed public entry points compile with strict declarations                                                                                                                                       |
| Contract/installer suite                   | 14 tests passed: validation, snapshots/offsets, queue/abort/stale events, allocation/output failures, manifest checks, import safety, checksums, interruption, retries, reuse and unrelated-file preservation |
| Connected acquisition                      | Actual CLI first download passed; actual default browser model download and speech passed, with requests restricted to the pinned model's redirect chain                                                      |
| Tarball                                    | Required loader/WASM/workers/types/CLI/lock/notices present; no weights, fixture recordings, caches, postinstall or production dependencies                                                                   |

Node API-denied subprocess tests terminate immediately if fetch, HTTP(S), TCP/TLS,
DNS, UDP or WebSocket APIs are attempted; worker threads inherit that preload. The
Linux containers additionally enforce an OS-level networking ban. Asset preparation
happened before denial. A clean child process exits after disposal, which checks
that no worker keeps Node alive.

The browser tests block external origins in self-hosted mode and assert zero such
requests. Persistence tests make model/WASM URLs unavailable after an initial load,
then create another instance. Corrupt model bytes in IndexedDB are replaced from
the configured source. Denied persistence is injected into a real worker; inference
still uses the official model. The default-URL contract test serves verified model
bytes through a route fixture; `test:browser:download` separately verifies an actual
connected download without that fixture.

Audio tests decode a generated 48 kHz stereo PCM16 WAV, average channels to about
0.5, and assert exactly 16,000 output samples for one second. Corrupt/31-second files
and decoding aborts are checked. Capture tests use an injected MediaRecorder and
stream with real Web Audio decoding: manual stop, 20 ms automatic stop (320 samples),
cancellation, permission denial, and late permission cleanup. These do not test
physical microphone hardware or all browser recorder codecs.

## Performance context

Host: Apple M2, 16 GiB RAM, macOS arm64. Fixture: 11-second English JFK excerpt,
176,000 samples, word timestamps enabled; all figures are individual local runs,
not an SLA or an accuracy benchmark. Browser and Node processes may have shared
host load. [evidence.json](../evidence.json) records representative measurements.

| Measurement                                                             | Observed                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Fresh CLI directory, actual pinned-model transfer + verification/copies | 1.16 s wall time on this connection/CDN state           |
| Node 22 cold local initialization                                       | approximately 69 ms in the first SDK run                |
| Node 22 warm service time                                               | approximately 527–681 ms across 10 requests in that run |
| Node 24 cold local initialization                                       | 103 ms                                                  |
| Node 24 warm service time                                               | 507–600 ms across 10 requests                           |
| Chromium self-hosted cold / persisted warm initialization               | 115 / 51 ms                                             |
| Chromium speech worker service                                          | 538 ms; first-token 276 ms; decoder 129 tokens/s        |
| Firefox self-hosted cold / persisted warm initialization                | 196 / 129 ms                                            |
| Firefox speech worker service                                           | 663 ms                                                  |
| WebKit self-hosted cold / persisted warm initialization                 | 134 / 55 ms                                             |
| WebKit speech worker service                                            | 563 ms                                                  |
| Chromium actual upstream download + initialization                      | 954 ms; subsequent speech service 545 ms                |

The ABI harness retained the model, allocated maximum-size PCM plus a 1 MiB output,
and transcribed the fixture ten times. WASM memory stayed at **76,808,192 bytes** for
all ten calls. The original spike with a smaller PCM allocation plateaued at
70,647,808 bytes. Memory growth need not shrink. The SDK Node integration also
samples process RSS after every call. After three warmup calls, it requires growth
from any earlier measured minimum to remain below 64 MiB. Decreases from garbage
collection are not counted as growth; later increases after a decrease still count.
Failures include every RSS sample, the measured growth, budget, Node version and
platform. This replaces an unordered maximum-minus-minimum check that could fail
when memory was reclaimed. The separate ABI check still requires WASM memory to
plateau. RSS includes main/worker V8 overhead and is not a precise allocation/leak
profiler. Disposal destroys the worker's entire runtime.

The upstream native “11 ms” headline is not a browser SDK result and is not used
as a performance promise here.

## Acceptance criteria

All criteria have passing evidence on the executed targets, with platform/codec
coverage bounded by the limitations below.

| ID    | Status and evidence                                                                          |
| ----- | -------------------------------------------------------------------------------------------- |
| AC-01 | Pass — independent source, official locked runtime, only Whistle weights                     |
| AC-02 | Pass — actual speech on both adapters and three browser engines                              |
| AC-03 | Pass — public declarations, validation/result/error tests and real timestamps                |
| AC-04 | Pass — network API denial plus Linux containers with networking disabled, including recovery |
| AC-05 | Pass — real CLI acquisition and both adapters consume its directory directly                 |
| AC-06 | Pass — checksum/interruption/retry/reuse/unrelated-file tests                                |
| AC-07 | Pass — default pinned source assertion and actual download; self-hosted external-host block  |
| AC-08 | Pass — FIFO lifecycle tests, repeated model calls, separate real instances                   |
| AC-09 | Pass — abort/recovery/stale events/disposal tests and clean child exits                      |
| AC-10 | Pass — invocation-time snapshots, offsets, caller buffer tests                               |
| AC-11 | Pass — stereo 48 kHz to mono 16 kHz, corrupt/oversized decode rejection                      |
| AC-12 | Pass — deterministic manual/automatic/cancel and late-permission cleanup; no hardware claim  |
| AC-13 | Pass — hash-keyed verified persistence, reuse, corruption and storage-denial fallback        |
| AC-14 | Pass — clean tarball Node/Linux, production Vite `/demo/`, plain ESM and types               |
| AC-15 | Pass — tarball and package scripts inspected; no weights/postinstall                         |
| AC-16 | Pass — exact upstream licenses, original/adapted provenance, tarball and output notices      |
| AC-17 | Pass — README, API, deployment guide, examples and measured compatibility note               |
| AC-18 | Pass — no continuous API, TTS, telemetry, hosted service or publication                      |

## Choices, limits and remaining release work

- Original code keeps the repository's pre-existing MIT license under the PRD's
  compatible-existing-license exception. Upstream assets retain Apache-2.0.
- IndexedDB was chosen after WebKit's test session discarded dedicated-worker
  CacheStorage contents on worker termination. Complete IndexedDB transactions
  persisted across replacement workers in all three tested engines.
- The 128-keyword/8,192-byte bound is an explicit SDK allocation limit; arbitrary
  model versions and extremely large keyword prompts are not v1 functionality.
- A bounded 1 MiB result buffer fails explicitly on overflow. There is no reliable
  upstream overflow-size signal to support safe automatic resizing/retry.
- Windows, Linux x64, shipping Safari/Edge applications and mobile devices were not
  executed locally. CI is provided for Windows/macOS/Linux Node 22/24 and the three
  Playwright desktop engines. CI configuration is not a claim that those jobs ran.
- Only English fixture quality and PCM WAV decoding were tested. German language
  quality, physical microphones, permission UX and browser-specific MediaRecorder
  formats need application/device testing before making broader claims.
- Browser decoding/rendering is not cooperatively interruptible; cancellation
  discards late output and cleans up contexts/tracks. Active inference cancellation
  terminates and reloads, with the documented cold-load cost.
- No PWA application shell, continuous transcription, TTS, CJS API, native compiler,
  Python dependency, or remote service was added. No publication/push/deployment ran.
- Owner work before a separately authorized publication: verify npm publishing
  access/availability and final branding, and review the `whistle` command name for
  collisions. `@tiny-stt/whistle` is already the decided package identity.

## Documentation distribution

The API/deployment guides, runnable Node example, and this compatibility evidence
live in `packages/documentation`. `evidence.json` is preserved byte-for-byte; its
fixture path is relative to `packages/whistle`. The SDK tarball retains its
quick-start README, documented declarations, asset lock, licenses and notices.

After this move, TypeDoc's strict check and generated-site browser test passed:
33 pages, 1,408 local links/assets, embedded Node code and the JSON evidence download.
The relocated Node example transcribed the licensed fixture. All 14 SDK contract
tests, workspace typechecks, Biome checks and clean consumers passed. The packed
SDK contains 60 files with no `docs/` or `examples/`; Node 22/24 Linux containers
passed repeated inference and cancellation recovery with `--network none` using
the revised package mount. These structural checks do not replace the original
performance measurements above.

Original SDK and documentation code retain this repository's MIT license.
Official runtime and model artifacts retain their exact Apache-2.0 licenses and
notices in the package and CLI-generated distribution. See the
[SDK notice](https://github.com/tobilg/tiny-stt/blob/main/packages/whistle/NOTICE).
The SDK is independently written and is not official Cactus software.

Generated documentation has no inference engine, model weights, recording controls,
analytics or third-party font/CDN dependencies. Viewing it never requests microphone
access or downloads speech assets. Repository links become available after the
owner separately commits and pushes the local implementation.
