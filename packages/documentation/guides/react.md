---
title: React hooks
group: Guides
---

Import `useWhistle` and `useWhistleRecorder` from `@tiny-stt/react`.
The separate `@tiny-stt/react` package has **React 19** and `@tiny-stt/whistle` as
required peer dependencies. Install both in the application to share one SDK and
React instance. The core SDK has no React dependency or `/react` export. React DOM
belongs to the application's renderer, not the hook package.

Install with `pnpm add @tiny-stt/react @tiny-stt/whistle react@^19`.
To test an unpublished checkout, run `pnpm release:check` in the repository, then
install both tarballs in your React application's directory:

```sh
pnpm add /path/to/tiny-stt/artifacts/tiny-stt-whistle-0.1.0.tgz /path/to/tiny-stt/artifacts/tiny-stt-react-0.1.0.tgz react@^19
```

## File and microphone input

Prepare the full CLI asset directory with `whistle download --out public/whistle`
and pass its served URL as `assetsUrl`. The URL belongs to your application, so
include its deployment base path when needed. Omitting the options uses the same
pinned official model download as the browser factory.

This example uses explicit start/stop buttons. For pointer/keyboard push-to-talk,
see the [demo](https://github.com/tobilg/tiny-stt/tree/main/packages/demo).
The React component is compiled against the package exports during documentation checks:

{@includeCode ../examples/react.tsx}

`load()` explicitly initializes the engine and reports per-asset `progress`.
Rendering or importing never starts downloads, inference, audio contexts or capture.
`ready` indicates a loaded instance; `status` describes loading, decoding or
transcription. `pending` counts active and queued file/PCM calls. `result` retains
the latest successful transcript, including silence as an empty string.

Action promises reject with `WhistleError`, and the hooks also expose `error` for
rendering. Observe rejections even when using that state; a `void` prefix alone
does not handle a rejected promise. Cancellation uses `ABORTED`, not a partial
transcript. Each hook owns its own error state; applications combining file and
recording controls can select the error for the most recent user action, as the
demo does. Display strings, styling and input events remain application-owned.

## Ownership, rerenders and cleanup

Each `useWhistle` invocation owns one engine. Keep the component mounted to reuse
it; another invocation creates a separate engine. `useWhistleRecorder(whistle)`
uses the supplied hook's engine and never loads another model. Pass the hook return
value through props or your own context when components should use that engine.

Inline options objects and URL objects with unchanged string values do not reload
the model. Changing an asset URL or `cache` releases the old instance, rejects its
work with `DISPOSED`, resets state, and requires another explicit `load()`. Actions
from the old configuration become unusable. Recording preferences and hints are
snapshotted at `start()`; changing them affects the next recording.

Unmount, configuration changes, pagehide and React effect cleanup release workers,
capture, timers and decoder resources. Late initialization, permission grants or
results cannot revive a retired operation. React Strict Mode and Fast Refresh may
replay effects; a replay or back/forward restoration returns to unloaded state and
requires `load()` again. The previous transcript is retained for the same hook
configuration. These lifecycle rules follow React's
[effect cleanup model](https://react.dev/reference/react/useEffect).

The ESM `@tiny-stt/react` entry preserves `'use client'`. Server rendering a Client Component
produces idle state without accessing browser APIs; event-driven loading occurs in
the browser. Do not call these hooks in a React Server Component. Vite 8/React 19
and React DOM server rendering are tested; a Next.js application is not an executed
compatibility claim.

## Queue and cancellation

- Call `load()` and wait for readiness before transcription/recording. Early calls
  reject with `MODEL_LOAD_FAILED`. Concurrent load calls share initialization.
- `transcribe(pcm, options)` copies PCM and hints at invocation. It preserves offsets
  and caller buffer ownership. `transcribeFile(blob, options)` queues decoding plus
  inference; both methods share one FIFO. Inputs retain the core 30-second limits.
- Per-call `signal` cancels only that request, including decoding. Cancelling active
  WASM inference terminates its worker; surviving work waits for recovery.
- `whistle.cancel()` cancels initialization and every pending file/PCM request owned
  by that hook. A loaded instance remains reusable. It does not cancel microphone
  capture owned by a recorder; cancel both for a whole-form Cancel button.
- A worker crash or failed asset/model reload retires the engine and rejects its
  queue. Fix the cause, then call `load()` explicitly before retrying.
- `recorder.start()` resolves to the final transcript after stop/automatic stop.
  Repeated starts during the same operation return the same promise. `stop()` shares
  that completion while busy and returns `undefined` when idle. Stopping during a
  permission prompt cancels; tracks from a late grant are stopped immediately.
- `recorder.cancel()` discards capture or cancels only its queued/active transcription.
  Other calls on the engine survive. The helper auto-stops within its configured
  limit, at most 30 seconds; no continuous listening or automatic restart is added.

Microphones require HTTPS or localhost and an explicit user action. Focus and
pointer behavior are application choices; the demo stops on loss of focus. The
core [deployment](deployment.md) and [offline](deployment.md#browser-production-builds)
requirements apply unchanged.

## Executed validation

Locally verified on 2026-10-10 with React 19.3.0, Vite 8.3.4, Chromium
156.0.8078.4, Firefox 157.0 and WebKit 27.2 on macOS arm64. Eight hook/controller
tests cover SSR, initialization, snapshots, FIFO, cancellation, stale completions,
recording ownership and worker failure/reload. Browser checks use the real model
and licensed speech fixture, with external hosts blocked and deterministic capture
instead of microphone hardware. They cover Strict Mode, Fast Refresh, multiple
engines, configuration changes, file/PCM queueing, active/queued cancellation,
automatic stop, late permission grants and complete cleanup.

Both npm tarballs passed a clean offline pnpm install, declaration checks, SSR
with networking denied, and production Vite inference under `/demo/`. The core SDK
also installed without React and passed repeated inference/cancellation recovery
in Node 22.12.0 and 24.21.0 Linux arm64 containers using `--network none`.
The adapter tarball contains 11 files, about 10 kB compressed, with no bundled
React, model or WASM. Live npm trusted publishing, Windows execution and Next.js
were not part of these local checks.
