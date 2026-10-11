---
title: Getting started
group: Guides
---

Use Node 22 or 24 and the repository's pinned pnpm 12.4.2. From a checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm assets:prepare
pnpm example:node
```

The last command transcribes the licensed development fixture. It records no
personal microphone audio. To try the browser UI:

```sh
pnpm demo:prepare
pnpm demo:dev
```

The private `@tiny-stt/demo` package uses React 19 and Vite 8. Open the localhost
URL, load the model, then choose a file or explicitly start
recording. The [browser guide](./browser.md) explains the helper APIs.

## Install into another application

Install the SDK and prepare the model and runtime files:

```sh
pnpm add @tiny-stt/whistle
pnpm exec whistle download --out public/whistle
```

For Node applications, choose a private local directory such as `vendor/whistle`
instead of `public/whistle`. `download` has no postinstall hook; it is an explicit
preparation step. See [Deployment](./deployment.md) for integrity checks and offline
verification. Documentation builds do not publish, deploy or acquire a model.

To test an unpublished checkout, run `pnpm release:check` in the repository,
then install `artifacts/tiny-stt-whistle-0.1.0.tgz` in your application in place of
the registry package. For React applications, install the accompanying
`artifacts/tiny-stt-react-0.1.0.tgz` as well; see [React hooks](./react.md).

## Core input contract

Both factories return the same {@link "@tiny-stt/whistle".Whistle} interface.
Core input is decoded **16 kHz mono Float32Array PCM**, with 1–480,000 finite samples
within `[-1, 1]`. Encoded bytes are not PCM. Calls snapshot their input immediately,
respect typed-array offsets and retain caller buffer ownership.

The SDK rejects clips over 30 seconds; it does not split or truncate them.
Keep an instance for repeated clips and dispose it when finished. Continuous STT,
TTS, training and hosted APIs are outside this package's scope.
