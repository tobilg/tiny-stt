# Node transcription example

Runnable documentation for `@tiny-stt/whistle/node`. This example reads a **mono,
16 kHz, signed PCM16 WAV**, transcribes it with word timestamps, and disposes the
worker. `wav.mjs` is a small example reader, not a general audio decoder.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm assets:prepare
pnpm example:node
```

The last command transcribes the SDK's
[licensed fixture](../../../whistle/tests/fixtures/README.md) using
`packages/whistle/.cache/assets`. It records no microphone audio. It works with
outbound networking denied once those assets have been prepared.

For your own compatible WAV and prepared asset directory:

```sh
node packages/documentation/examples/node/transcribe.mjs ./vendor/whistle ./clip.wav
```

Paths are relative to the current working directory. Missing assets fail explicitly;
the example never downloads a model or falls back to remote inference.

Outside the workspace, install the SDK tarball, copy `transcribe.mjs` and `wav.mjs`
into your application, and run the CLI before inference:

```sh
pnpm add /path/to/tiny-stt-whistle-0.1.0.tgz
pnpm exec whistle download --out vendor/whistle
node transcribe.mjs ./vendor/whistle ./clip.wav
```

`pnpm test:consumer` tests these files against a clean tarball installation with
networking denied during Node inference. See the [Node guide](../../guides/node.md)
for the typed API and [deployment guide](../../guides/deployment.md) for asset
integrity and offline packaging requirements.
