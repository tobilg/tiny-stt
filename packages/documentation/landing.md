Transcribe completed speech clips locally in browsers and Node.js with
`@tiny-stt/whistle`. The independent TypeScript SDK wraps Cactus Compute's official
Whistle-compatible JS/WASM runtime. It has no hosted inference, telemetry or audio
uploads, and supports clips of up to **30 seconds**.

## Start here

Read [Getting started](./guides/getting-started.md), then choose an environment.
The guide covers package installation, asset preparation and testing a local checkout.

| Import | Purpose |
| --- | --- |
| {@link "@tiny-stt/whistle" @tiny-stt/whistle} | Browser workers, pinned-model loading and self-hosted assets |
| {@link "@tiny-stt/whistle/node" @tiny-stt/whistle/node} | Local-only Node worker threads |
| {@link "@tiny-stt/whistle/audio" @tiny-stt/whistle/audio} | File decoding, channel downmixing and 16 kHz resampling |
| {@link "@tiny-stt/whistle/microphone" @tiny-stt/whistle/microphone} | Push-to-talk recording with manual stop, auto-stop and cancellation |
| {@link "@tiny-stt/react" @tiny-stt/react} | Optional React 19 hooks for engine ownership and recording |

Each entry point includes its exported functions, options, result fields and error
contracts, generated from the source comments that also ship in TypeScript declarations.

## Guides

- [Getting started](./guides/getting-started.md): install, prepare model assets and run examples.
- [Browser files and recording](./guides/browser.md): self-hosting, file input and explicit microphone capture.
- [React hooks](./guides/react.md): loading, file transcription, recording and component cleanup.
- [Node and local assets](./guides/node.md): offline inference and buffer ownership.
- [API behavior](./guides/api-behavior.md): queues, cancellation, timestamps, limits and every error code.
- [Deployment](./guides/deployment.md): CLI layout, integrity, cache, CSP and production bundling.
- [Compatibility and licensing](./guides/compatibility.md): measured evidence, provenance and limitations.

Whistle is the speech model; `needle.js` and `needle.wasm` are its shared engine.
The required model is `whistle.cact`, not the Needle text model. Runtime code ships
in the package, while the 16.9 MB model is acquired explicitly at build time or by
the configured browser loader. This SDK is not official Cactus software.
