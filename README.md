# tiny-stt

A pnpm 12 workspace for local speech-to-text in browsers and Node.js:

| Package | Purpose |
| --- | --- |
| [@tiny-stt/whistle](packages/whistle/README.md) | Independent TypeScript/ESM SDK and CLI |
| [@tiny-stt/react](packages/react/README.md) | React 19 hooks, with the SDK and React as peers |
| [@tiny-stt/documentation](packages/documentation/README.md) | Private TypeDoc website for both public packages |
| [@tiny-stt/demo](packages/demo/README.md) | Private React 19 / Vite 8 browser demo |

The SDK, CLI, tests, and licensed runtime assets live in `packages/whistle`.
Guides, compatibility evidence, and Node examples live in `packages/documentation`;
the browser application lives in `packages/demo`.
The CLI executable is `whistle`. Model weights are downloaded
explicitly and are excluded from the package tarball.

## Development

Use Node **22.12+** or 24 and pnpm **12.4.2**, pinned in `packageManager`.
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm assets:prepare
pnpm example:node
```

The asset command prepares `packages/whistle/.cache/assets`. The documentation
package's [Node example](packages/documentation/examples/node/README.md)
transcribes the licensed test fixture. To run the browser example:

```sh
pnpm demo:prepare
pnpm demo:dev
```

Open **http://127.0.0.1:5173/demo/** (or the printed URL if that port is busy).
Recording starts only when you use the recording
control; file transcription does not require microphone access. Production builds
use `/demo/`: run `pnpm demo:build`, then `pnpm demo:preview`.
The former `example:browser*` root commands remain aliases to the demo package.

## Verification and packaging

```sh
pnpm check
pnpm test:integration
pnpm test:abi
pnpm --filter @tiny-stt/whistle exec playwright install chromium firefox webkit
pnpm test:browser
pnpm test:consumer
pnpm demo:prepare
pnpm test:demo
pnpm pack:whistle
pnpm pack:react
pnpm test:packed-node
```

Integration/browser tests require prepared assets and a prior build. Set
`BROWSER=firefox` or `BROWSER=webkit` to select another browser. The consumer tests
install the public package tarballs in isolated projects: npm for Node, and an offline pnpm
installation of the React demo for the production browser build.
`pnpm pack:whistle` writes `packages/whistle/tiny-stt-whistle-0.1.0.tgz`;
`pnpm pack:react` writes `packages/react/tiny-stt-react-0.1.0.tgz`. Neither publishes.
`pnpm release:check` packs both into `artifacts/` with a shared integrity receipt. SDK scripts delegate to the Whistle package, so
`pnpm --filter @tiny-stt/whistle <script>` works as well. The demo has its own
manifest and consumes both public packages through `workspace:*`. The core SDK has
no React dependency. Dependencies use one `pnpm-lock.yaml`;
pnpm's local store and metadata cache are under the ignored `.cache/` directory.

## Documentation and code quality

`pnpm docs:dev` builds and serves the generated API website at
**http://127.0.0.1:4174/** with source/guide watching. `pnpm docs:build` emits the
static site, `pnpm docs:preview` serves an existing build, and `pnpm docs:check`
validates API coverage plus the embedded TypeScript examples. `pnpm test:docs`
also verifies links, navigation and search in Chromium under `/api/`.
See the [documentation package guide](packages/documentation/README.md).

**Biome 2.5.15** handles supported source/config formatting, recommended linting and
import organization. Run `pnpm check` for the combined CI check, `pnpm check:fix`
for safe fixes, `pnpm lint` for linting, and `pnpm format` to format. The existing
`pnpm format:check` command remains available. Vendored runtime bytes, integrity
metadata, generated output, caches and historical plans are excluded. Markdown
and YAML are maintained manually; no Prettier dependency remains.

## CI, releases and Pages

The reusable [CI workflow](.github/workflows/ci.yml) checks the workspace, real-model
Node/browser inference, installed tarball consumers, demo and documentation.
The [release workflow](.github/workflows/release.yml) calls CI for matching `v*`
tags, publishes its verified SDK and React tarballs with npm trusted publishing, uploads both
sites to Cloudflare Pages, and creates a GitHub release. Manual release runs
default to `npm publish --dry-run`.

Pages projects default to `tiny-stt-api-docs` and `tiny-stt-demo`. The demo has a
separate root-path build: `pnpm demo:prepare && pnpm demo:build:pages` produces
`packages/demo/dist-pages`. Follow the [release guide](packages/documentation/guides/releasing.md) for the required
npm trusted publishers, Cloudflare secrets/project variables, and release checks.
These workflows are configured locally; no live release or deployment is implied.

See the [SDK usage and API](packages/whistle/README.md),
[deployment guide](packages/documentation/guides/deployment.md), and
[compatibility evidence](packages/documentation/guides/compatibility.md).
The [asset lock](packages/whistle/asset-lock.json) records pinned upstream hashes;
[license notices](packages/whistle/NOTICE) ship with the SDK and prepared assets.
The original product specification remains in `plans/whistle-sdk-prd.md`.
