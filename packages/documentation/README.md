# Whistle documentation

Private `@tiny-stt/documentation` workspace package. TypeDoc renders Whistle's four
public entry points and the separate `@tiny-stt/react` package directly from TypeScript comments, with handwritten guides and
typechecked examples. This package also owns the runnable Node example and the
measured compatibility evidence. The comments ship in Whistle's `.d.ts` files for
editors. Building or viewing the documentation needs no model download.

The layout follows the
[georeferencing documentation package](https://github.com/tobilg/georeferencing/tree/7fd1b551ecf9fefe286462abc0e0c49c048e8177/packages/documentation):
TypeDoc HTML, import-path navigation, guides, embedded examples, strict validation,
and a static-site browser check. Configuration and scripts here are written for
Whistle; this package contains no copied upstream application code.

## Local commands

Use Node 22/24 and pnpm 12.4.2. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

Open **http://127.0.0.1:4174/**. The command builds Whistle's declarations, generates
the site, then starts a TypeDoc watcher and Vite server. Source comments and guides
rebuild automatically. Configuration changes restart the watcher. Ctrl+C terminates
the watcher and server; the port is strict, so conflicts fail visibly.

| Command | Result |
| --- | --- |
| `pnpm docs:build` | Build Whistle and emit `packages/documentation/dist` |
| `pnpm docs:check` | Build Whistle, typecheck embedded examples, validate API coverage and links |
| `pnpm docs:preview` | Serve the existing static build on port 4174 |
| `pnpm docs:deploy` | Rebuild and upload to the production `tiny-stt-api-docs` Pages project on branch `main` |
| `pnpm test:docs` | Build/check, traverse all generated links/assets/anchors, test navigation and search under `/api/` |
| `pnpm check` | Biome formatting, recommended lint rules and import organization across the workspace |
| `pnpm example:node` | Build Whistle and run this package's Node example against prepared local assets |

For the runnable example, first prepare assets with `pnpm assets:prepare` after a
SDK build. See [examples/node](examples/node/README.md) for custom input and
installed-package usage. It loads a model only when explicitly executed; rendering
the documentation does not run inference or access a microphone.

The browser check uses Playwright Chromium. If needed:

```sh
pnpm --filter @tiny-stt/documentation exec playwright install chromium
```

`PLAYWRIGHT_BROWSERS_PATH` can point at an existing compatible browser installation.
The check writes `.cache/validation.json` inside this package, blocks external hosts,
and verifies source links, embedded snippets and representative APIs from both public packages. It does not request microphone access or load an inference engine.

## Editing and coverage

- Edit API comments in `../whistle/src` and `../react/src`. Document units, ownership, defaults,
  cancellation, cleanup, parameters, results and errors, not just symbol names.
- `typedoc.json` lists all five public source entries. Module names match their
  import paths, and strict coverage explicitly targets `@tiny-stt/whistle` and `@tiny-stt/react`.
- Public functions, classes, constructors, methods, interfaces, properties and
  aliases must have documentation; missing docs or broken TypeDoc links fail builds.
- `WhistleErrorCode` documents every stable failure code. Internal engine and hook
  controllers are not public APIs and are excluded with `@internal`.
- `guides/` supplies the website guides, while `landing.md` is the website homepage.
  This README describes operating the private docs package rather than the SDK API.
- Embed `examples/*.ts` and `examples/*.tsx` with TypeDoc's `includeCode` directive. These files import
  built package exports and are checked independently of the source comments.
- `guides/api-behavior.md`, `guides/deployment.md` and `guides/compatibility.md`
  own the full contract/deployment guides and release evidence; the SDK README
  provides a quick start and links here. `evidence.json` retains the original
  measurements. Generated `dist/` files should not be edited.
- `examples/node/` contains the runnable Node CLI and its small WAV reader. The
  SDK's clean-consumer tests copy these files and run them against the installed
  tarball, without requiring a workspace SDK link.

TypeDoc 0.28.20 supports TypeScript through version 6. This package uses TypeScript
5.9.3, matching the reference's compatible compiler; Whistle retains TypeScript 7.
The tools are private development dependencies and never enter the SDK runtime.

## Static hosting and evidence

Serve the entire `dist/` directory, including search data and scripts. Links are
relative and directory URLs must resolve to `index.html`. A non-root `/api/` base
is tested without rebuilding. Builds and previews do not publish or deploy.
For manual uploads from your machine, follow the
[local Cloudflare setup](guides/releasing.md#manual-local-deployment), then run
`pnpm docs:deploy` from the workspace root. It rebuilds and uploads independently
of npm releases or GitHub Actions. That guide also covers preview branches,
custom project names and uploading an already-reviewed build.

`pnpm --filter @tiny-stt/documentation run test:build` checks the same output at
`/`, as served by its dedicated Cloudflare Pages project. The release workflow
uploads CI's tested `dist/` artifact to `tiny-stt-api-docs` by default; see
[Releases and Cloudflare Pages](guides/releasing.md) for account configuration,
trusted npm publishing, triggers and dry runs.
Source links point to the repository's `main` branch and become available after
the owner separately commits/pushes the implementation.

Locally verified on macOS arm64 with Chromium 156.0.8078.4: 46 generated pages,
all internal links/assets at both `/api/` and `/`, source links for every entry point, embedded guide
examples, the measurement JSON download, navigation and search with external hosts
blocked. The dev server's guide rebuild and shutdown also passed; removing a public
property comment was confirmed to fail the coverage gate before the source was
restored. Remote CI is configured, not reported as executed. Original documentation
uses the repository's MIT license.
