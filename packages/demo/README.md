# Whistle demo

Private `@tiny-stt/demo` workspace package, migrated from the SDK's browser example.
React **19.3.0**, React DOM **19.3.0**, Vite **8.3.4** and the React Vite plugin
**6.1.2** are pinned to the latest stable releases checked on 2026-10-10.
The SDK remains independent of React; this app imports its public exports using
`@tiny-stt/whistle: workspace:*`.

## Run locally

Use Node **22.12+** or 24 and pnpm **12.4.2**. From the workspace root:

```sh
pnpm install --frozen-lockfile
pnpm demo:prepare
pnpm demo:dev
```

Open **http://127.0.0.1:5173/** (Vite prints another port if needed). Click
**Prepare model**, then choose an audio file or hold **Hold to talk** with a pointer, Space or
Enter. Release to transcribe; recording stops automatically at 30 seconds. Cancel
discards an operation. Word timestamps are optional. **Spoken language** defaults
to automatic detection; you can select Dutch, English, French, German, Italian,
Polish or Spanish as a language hint for both files and recordings. The transcript
shows the language returned by the model, or “No speech detected” for silence. No microphone access occurs
until explicitly holding the recording control, and no audio is uploaded.

The demo uses the SDK's default `cache: 'auto'`. Its status distinguishes downloading
files, loading verified files from the browser cache, and initializing the speech
engine. Download percentages describe the model file, not overall initialization.
Refreshing the page reuses saved files when available but still initializes a new
engine. If browser storage is unavailable or cleared, files are fetched again;
the browser's HTTP cache may still satisfy these requests.

`demo:prepare` builds Whistle and uses its CLI to prepare the full asset layout at
`packages/demo/public/whistle/`. Valid local files are reused after integrity checks.
Model weights are ignored by Git and are absent from the SDK tarball. For a fully
offline recheck, after preparing assets:

```sh
pnpm --filter @tiny-stt/demo exec whistle download --offline --out public/whistle
```

## Build and preview

```sh
pnpm demo:build
pnpm demo:preview
```

Open **http://127.0.0.1:4173/**. Serve the entire `packages/demo/dist` directory
at `/`. `demo:build` builds the public packages, prepares and verifies the model/runtime
assets in `public/whistle`, then includes them in the build. This is the same build
used for deployment. To use another base, set `base` in `vite.config.ts`, or use
`pnpm --filter @tiny-stt/demo exec vite build --base /your-path/` after building the
SDK. `import.meta.env.BASE_URL` keeps the asset directory aligned with Vite's base.
For that custom build, pass the same `--base /your-path/` to Vite preview.

Microphone access requires HTTPS or localhost. Production is tested with a CSP
allowing same-origin scripts, workers, assets and WebAssembly compilation
(`script-src 'self' 'wasm-unsafe-eval'`). Vite development also requires its normal
React Refresh/WebSocket setup. See the SDK's
[deployment guide](../documentation/guides/deployment.md) for full requirements.
Self-hosting does not cache the application for offline reopening; this demo is
not a PWA. Build and preview commands only run locally.

Run `pnpm --filter @tiny-stt/demo run test:build` to check the
upload directory's hashes, size limits and real speech transcription with external
hosts blocked.

After [local Cloudflare setup](../documentation/guides/releasing.md#manual-local-deployment),
run `pnpm demo:deploy` from the workspace root to rebuild and **upload to production**
in `tiny-stt-demo` on branch `main`. This includes the model and license notices.
The guide covers custom project names, preview branches and uploading an existing
build. The release workflow can also deploy CI's tested artifact independently.

## Development and validation

`src/App.tsx` retains the demo's layout and controls. `useWhistleDemo.ts` consumes
`useWhistle` and `useWhistleRecorder` from the public `@tiny-stt/react` package.
Only Vite asset URLs, display strings and UI interaction choices live in the demo.
The hooks own model state, file/PCM queues, recording and cancellation. Abort signals cancel
loading, decoding, inference and capture. Cleanup on unmount, pagehide and module
replacement disposes the worker and cancels capture; stale completions cannot
overwrite a newer operation. React StrictMode is enabled in development.

```sh
pnpm check
pnpm typecheck
pnpm --filter @tiny-stt/demo exec playwright install chromium firefox webkit
pnpm test:demo
BROWSER=firefox pnpm test:demo
BROWSER=webkit pnpm test:demo
pnpm assets:prepare
pnpm test:consumer
```

Demo tests build production at `/` and also run the Vite development server.
They exercise real model transcription, word bounds, repeated file selection,
invalid files, initialization cancellation/retry, pointer/keyboard recording,
permission denial and late grants, auto-stop, cancellation, and resource cleanup.
They also check download/cache/initialization wording and reload with model and
WASM requests blocked to verify persistent-cache reuse.
The development check also triggers Fast Refresh, verifies that the transcript
survives while the worker is released, reloads the model, and unmounts during a
pending permission request.
Public-hook tests also exercise independent instances, equivalent-option rerenders,
configuration changes, mixed file/PCM FIFO and snapshots, active/queued abort with
recovery, auto-stop and unmount during pending transcription.
External hosts are blocked. Capture uses the SDK's
[licensed speech fixture](../whistle/tests/fixtures/README.md) with a deterministic
MediaRecorder, never personal microphone audio. Browser evidence is written to
`.cache/<browser>.json`. The SDK consumer test installs the actual demo offline
in an isolated directory with both packed public packages instead of workspace links, then builds
and transcribes under `/demo/`; it uses dependencies cached by the initial workspace
installation. It derives a frozen consumer lockfile from the workspace, replaces
both public package links with their tarballs, and installs with an empty metadata cache.
That temporary offline installation trusts the already-checked dependency graph;
the workspace install retains pnpm's normal registry policy checks. CI runs demo
checks in Chromium, Firefox and WebKit.

Locally verified on macOS arm64 with Chromium 156.0.8078.4, Firefox 157.0 and
WebKit 27.2, with no page errors or external requests. Remote CI has not been run.

Original demo code uses the repository's MIT license. The CLI-prepared runtime
and model distribution include their upstream licenses and notices.
`public/REACT-LICENSE` preserves the identical MIT license supplied by React,
React DOM and Scheduler, and is copied into the production distribution.
