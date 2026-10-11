# @tiny-stt/whistle

Independent TypeScript/ESM integration of Cactus Compute's Whistle speech model
with its official JS/WASM runtime. Transcribe completed clips of up to **30 seconds**
locally in a browser Web Worker or Node worker thread. No hosted inference,
telemetry, audio uploads, native build tools, or installation-time model download.
This project is not official Cactus software.

## Install and prepare assets

Install the SDK and prepare its inference assets:

```sh
pnpm add @tiny-stt/whistle
pnpm exec whistle download --out public/whistle
```

For Node applications, use a local directory such as `vendor/whistle` instead of
`public/whistle`. The CLI prepares the model, runtime, workers, integrity manifest,
and license notices. The **16,919,407-byte** `whistle.cact` model is excluded from
the npm tarball; `needle.js` and `needle.wasm` are the shared runtime engine.
The Needle text model is never used for transcription.

Valid files are integrity-checked and reused. Run
`whistle download --offline --out vendor/whistle` to verify an already prepared
directory without downloading. Missing or corrupt required files fail clearly.
Run `whistle download --help` for CLI usage. npm users can install with
`npm install @tiny-stt/whistle` and prepare assets with
`npx whistle download --out public/whistle`.

To test an unpublished checkout, run `pnpm install --frozen-lockfile` and
`pnpm release:check` from the repository root, then install
`artifacts/tiny-stt-whistle-0.1.0.tgz` in your application instead of the registry
package. These local commands do not publish anything.

## Browser

```ts
import { createWhistle } from '@tiny-stt/whistle';
import { decodeAudio } from '@tiny-stt/whistle/audio';

async function transcribeFile(file: File) {
  const whistle = await createWhistle({ assetsUrl: '/whistle/' });
  try {
    const pcm = await decodeAudio(file);
    return await whistle.transcribe(pcm, { wordTimestamps: true });
  } finally {
    await whistle.dispose();
  }
}
```

Serve the full CLI-generated directory at `assetsUrl`. Calling `createWhistle()`
without options instead uses the packaged runtime and a pinned official model
download, with optional persistent caching. Self-hosting alone does not make the
application an offline PWA; the application and its support files must also be
available. The optional `@tiny-stt/whistle/microphone` entry supplies push-to-talk
capture with manual stop, automatic stop, cancellation, and resource cleanup.

## Node: local assets only

```ts
import { createWhistle } from '@tiny-stt/whistle/node';

async function transcribePcm(pcm16k: Float32Array) {
  const whistle = await createWhistle({ assetsPath: './vendor/whistle' });
  try {
    return await whistle.transcribe(pcm16k, { wordTimestamps: true });
  } finally {
    await whistle.dispose();
  }
}
```

Node 22 and 24 are the initial targets. `assetsPath` is required and accepts a
filesystem directory or `file:` URL. Initialization, transcription, and cancellation
recovery work with networking denied; missing assets never trigger a remote fallback.

Core input is **16 kHz mono `Float32Array` PCM**, 1–480,000 finite samples in
`[-1, 1]`. Encoded WAV/MP3 bytes are not PCM. Input is snapshotted immediately;
caller buffers retain ownership. Keep an instance for repeated clips: calls run
FIFO and the model remains loaded. Abort signals cancel requests, and active
inference cancellation reloads the worker before subsequent work. Disposal is
idempotent and terminal. `WhistleError.code` provides stable error codes.

## Documentation and examples

The [documentation package](https://github.com/tobilg/tiny-stt/tree/main/packages/documentation)
owns the guides, compatibility evidence, and runnable examples:

- [Getting started](https://github.com/tobilg/tiny-stt/blob/main/packages/documentation/guides/getting-started.md)
- [API behavior and errors](https://github.com/tobilg/tiny-stt/blob/main/packages/documentation/guides/api-behavior.md)
- [Deployment, offline assets and CSP](https://github.com/tobilg/tiny-stt/blob/main/packages/documentation/guides/deployment.md)
- [Compatibility, measurements and limitations](https://github.com/tobilg/tiny-stt/blob/main/packages/documentation/guides/compatibility.md)
- [Runnable Node example](https://github.com/tobilg/tiny-stt/tree/main/packages/documentation/examples/node)
- [React browser demo](https://github.com/tobilg/tiny-stt/tree/main/packages/demo)

In a repository checkout, `pnpm docs:dev` serves the generated API website at
http://127.0.0.1:4174/. Every public entry point, type and member is documented in
source; those comments also ship with declarations for editor help. Run
`pnpm build && pnpm assets:prepare && pnpm example:node` for the licensed fixture example, or
`pnpm demo:prepare && pnpm demo:dev` for the browser app. See the
[workspace README](https://github.com/tobilg/tiny-stt/blob/main/README.md) for build
and verification commands.

## Provenance and licenses

[asset-lock.json](asset-lock.json) records immutable upstream revisions, real
SHA-256 hashes, sizes and provenance. `dist/assets/manifest.json` also covers
generated support files. Original code retains this repository's MIT license;
official artifacts retain their Apache-2.0 licenses under `vendor/upstream/`.
The [NOTICE](NOTICE) identifies the minimal loader adaptation. Required licenses
and notices are included in both the tarball and CLI output.

## React

React 19 applications can use the separate [`@tiny-stt/react` package](https://github.com/tobilg/tiny-stt/tree/main/packages/react)
for `useWhistle` and `useWhistleRecorder`. The core SDK has no React dependency.
See the [React guide](https://github.com/tobilg/tiny-stt/blob/main/packages/documentation/guides/react.md)
for installation, lifecycle and cancellation behavior.
