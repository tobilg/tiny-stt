# @tiny-stt/react

React 19 hooks for local speech-to-text with [`@tiny-stt/whistle`](https://github.com/tobilg/tiny-stt/tree/main/packages/whistle).
Independent software, not an official Cactus package. ESM and TypeScript declarations;
no bundled React, runtime assets or model weights. MIT licensed.

`react@^19` and `@tiny-stt/whistle@^0.1.0` are required peers. The core SDK remains
usable without React. Install all three:

```sh
pnpm add @tiny-stt/react @tiny-stt/whistle react@^19
```

To test an unpublished checkout, run `pnpm release:check` in the workspace
and install both `artifacts/tiny-stt-*.tgz` tarballs into your React application.
Nothing is published by that command.

```tsx
import { useWhistle, useWhistleRecorder } from '@tiny-stt/react';

function SpeechInput() {
  const whistle = useWhistle({ assetsUrl: '/whistle/' });
  const recorder = useWhistleRecorder(whistle);
  const observe = (action: Promise<unknown>) => void action.catch(() => {});
  return <>
    <button disabled={whistle.ready || whistle.status === 'loading'}
      onClick={() => observe(whistle.load())}>Load model</button>
    <button disabled={!whistle.ready || recorder.status !== 'idle'}
      onClick={() => observe(recorder.start())}>Record</button>
    <button onClick={() => observe(recorder.stop())}>Stop</button>
    <button onClick={() => recorder.cancel()}>Cancel recording</button>
    <p>{recorder.error?.message ?? whistle.error?.message}</p>
    <p>{whistle.result?.text}</p>
  </>;
}
```

Prepare self-hosted assets with `whistle download --out public/whistle` and serve
that complete directory. Asset URLs belong to your app; include any deployment
base path. Omit options to use the SDK's pinned browser model download.

`useWhistle` provides explicit loading, progress, PCM/file transcription and a
shared FIFO. `useWhistleRecorder` uses that engine, supports manual/automatic stop
and cancels only its own recording/transcription. Calls reject typed `WhistleError`
instances; observe their promises. Recording requires a user gesture and HTTPS or
localhost. Clips remain limited to 30 seconds.

Rendering and SSR do not download assets or request microphone access. Unmount,
asset changes and pagehide dispose resources. Strict Mode/effect replay requires
an explicit reload. The ESM entry preserves `'use client'` for client boundaries;
Next.js itself is not a tested target.

See the [React guide](https://github.com/tobilg/tiny-stt/blob/main/packages/documentation/guides/react.md)
for the complete contract and file/recording example, and the
[demo](https://github.com/tobilg/tiny-stt/tree/main/packages/demo) for push-to-talk UI.
TypeDoc generates both packages' API reference in `packages/documentation`.

From the workspace root: `pnpm build`, `pnpm test`, `pnpm test:demo`, `pnpm pack:react`.
