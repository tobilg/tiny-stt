---
title: Browser files and recording
group: Guides
---

Prepare static assets with `whistle download --out public/whistle`, then pass that
directory's served URL. This example is typechecked against the package exports:

{@includeCode ../examples/browser-file.ts}

Decoding averages channels and resamples through Web Audio. Supported codecs depend
on the browser; PCM WAV is tested. Decode errors use `AUDIO_DECODE_FAILED` and files
over 30 seconds use `AUDIO_TOO_LONG`. An application that handles many files should
keep one engine across files and dispose it when the UI closes.

Calling {@link "@tiny-stt/whistle".createWhistle} without options uses the packaged
worker/runtime plus the immutable official model URL. `modelUrl` and `wasmUrl` accept
mirrors of those exact bytes. For fully self-hosted deployment, use `assetsUrl`.
The [deployment guide](./deployment.md) covers CSP, worker paths and caching.

## Push to talk

Microphone access requires HTTPS or localhost. Call the helper from a user action,
not on page load. These functions are examples, not actions executed by the docs:

{@includeCode ../examples/recording.ts}

Await `completed` and handle non-cancellation errors. Manual stop and automatic stop
settle the same recording result. Cancelling discards captured audio; tracks, timers
and decoder resources are released, including tracks from late permission grants.
Permission dialogs cannot themselves be dismissed by the SDK.

Default recording length is 30 seconds. The example explicitly limits capture to
10 seconds. This is completed-clip recording, not continuous transcription.
