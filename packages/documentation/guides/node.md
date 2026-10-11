---
title: Node and local assets
group: Guides
---

Run the installed CLI during your build/deployment, then deny outbound networking:

```sh
pnpm exec whistle download --out vendor/whistle
pnpm exec whistle download --offline --out vendor/whistle
```

`--offline` verifies and reuses files; it cannot acquire a missing model. Load the
result with the `/node` entry point:

{@includeCode ../examples/node.ts}

`assetsPath` accepts a local filesystem directory or `file:` URL, including paths
with spaces. Relative paths resolve at factory invocation. HTTP(S) locations are
rejected and missing/corrupt files fail explicitly. Initialization, inference and
cancellation recovery never fall back to a remote download.

Each instance owns one worker and retains its model. Calls are FIFO; an active abort
terminates blocking WASM and reloads from local assets before surviving requests run.
`dispose()` settles pending work and awaits worker termination, allowing the process
to exit. Use `try/finally` even when inference fails.

The SDK accepts decoded PCM, not Node Buffer or encoded WAV/MP3 bytes. The repository's
Node example in `packages/documentation/examples/node` includes a small reader
for mono 16 kHz PCM16 WAV. General audio format
conversion is the host application's responsibility; no native compiler or Python
runtime is required by the SDK.

## Runnable example

From the repository root:

```sh
pnpm build
pnpm assets:prepare
pnpm example:node
```

This transcribes the licensed fixture with timestamps. To supply your own prepared
assets and compatible WAV file:

```sh
node packages/documentation/examples/node/transcribe.mjs ./vendor/whistle ./clip.wav
```

The example imports the public `/node` entry and disposes its worker in `finally`:

{@includeCode ../examples/node/transcribe.mjs}

Copy both `transcribe.mjs` and `wav.mjs` into an application with the SDK installed
to run outside this workspace. The WAV reader is deliberately limited to mono,
16 kHz, signed PCM16 audio; it is not a general-purpose audio decoder.
