---
title: Releases and Cloudflare Pages
group: Guides
---

## Workflow structure

The workflows follow the
[georeferencing workflow layout](https://github.com/tobilg/georeferencing/tree/main/.github/workflows),
adapted to the public SDK and React hook packages, the React demo and the TypeDoc website.

| Workflow | Trigger | Result |
| --- | --- | --- |
| `ci.yml` | PR/push to `main`, manual dispatch, reusable call | Lint, build, typecheck, release guards, SDK tests, real-model Node/browser tests, packed consumers, demo and documentation artifacts |
| `release.yml` | Pushed `v*` tag or manual dispatch | Validate version, call all CI jobs, publish both tested npm artifacts; pushed tags also deploy both Pages sites and create a GitHub release |

CI covers Node 22/24 on Linux, macOS and Windows, Chromium/Firefox/WebKit, and
Linux packed inference with Docker `--network none`. Demo capture tests use a
licensed fixture instead of microphone hardware. Documentation tests check strict
API coverage, examples, links and search at `/api/` and `/`. The demo is tested at
`/demo/` and built separately at `/` for Pages. The isolated React consumer installs
both CI tarballs and transcribes with external hosts blocked.

`check` packs both public packages once into the `npm-packages` artifact, together with
`release.json` recording each package identity and SHA-512 integrity. Packed consumer jobs
test those artifacts. Publication verifies both receipts before publishing the SDK,
then `@tiny-stt/react`. It does not rebuild or run package lifecycle scripts.
The public packages release in lockstep with the same version/tag.
The demo and documentation packages stay private. Model weights are excluded from
npm and included in the self-hosted demo's static files.

Release CI disables dependency caching and uses the frozen pnpm lockfile. Artifact
retention is seven days. GitHub releases attach both tarballs and the receipt.
Normal CI and dry runs do not deploy sites or create releases.

## One-time npm setup

Make `tobilg/tiny-stt` public and ensure the release owner can publish in the
`@tiny-stt` npm scope. Each public package's `repository` metadata identifies this repository
and its `packages/whistle` or `packages/react` directory; keep it aligned if the repository moves.

For each package that has never been published, an owner must make the first publication
before configuring its package-level trusted publisher. Run CI on the reviewed
commit, download its `npm-packages` artifact, and use that exact tarball with an
interactive npm login and 2FA. For the current initial version, the owner commands
are `npm publish ./tiny-stt-whistle-0.1.0.tgz --access public --ignore-scripts`, then
`npm publish ./tiny-stt-react-0.1.0.tgz --access public --ignore-scripts`.
This is an actual publication, not part of local verification. The workflow fails
early with setup instructions when npm reports the package is absent.

Configure a GitHub Actions trusted publisher on npm for **each** package
(`@tiny-stt/whistle` and `@tiny-stt/react`) using the same settings:

| Setting | Value |
| --- | --- |
| Organization or user | `tobilg` |
| Repository | `tiny-stt` |
| Workflow filename | `release.yml` (filename only) |
| Environment | Leave blank; this workflow has no GitHub environment |
| Allowed actions | Enable direct `npm publish` |

New configurations default to staged publishing; direct publication must be
enabled. Configure it close to the next release: an unused new publisher expires
after two days. The workflow uses GitHub-hosted Ubuntu, Node 24, npm 11.6.2 and
job-scoped `id-token: write`. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed.
OIDC publication of a public package from a public repository automatically
includes npm provenance. See the current
[npm trusted publishing instructions](https://docs.npmjs.com/trusted-publishers/).

The already-published initial version can be skipped only when its registry
integrity matches the CI tarball exactly. A skip does not exercise OIDC; validate
the new trusted publisher with the next unpublished version before it expires.

## One-time Cloudflare setup

Create two **Direct Upload** Pages projects in the intended Cloudflare account
with production branch `main`. Configure these GitHub repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with Account → Cloudflare Pages → Edit for that account |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID that owns both projects |

Project names have defaults and can be overridden with repository **variables**:

| Site | Default project | Optional variable | CI output |
| --- | --- | --- | --- |
| Documentation | `tiny-stt-api-docs` | `CLOUDFLARE_DOCS_PROJECT` | `packages/documentation/dist` |
| Demo | `tiny-stt-demo` | `CLOUDFLARE_DEMO_PROJECT` | `packages/demo/dist-pages` |

The workflow uses `cloudflare/wrangler-action@v4` with Wrangler 4.147.0 to upload
the exact CI artifacts, using `--branch main`. It prints each resulting deployment
URL in the job summary. Project names are checked before use. No Cloudflare account
IDs or credentials belong in source control. These are static sites with no Pages
Functions, bindings or Worker backend, so no Wrangler runtime configuration is
required. See Cloudflare's
[Direct Upload CI guide](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

The demo prepares assets before Vite builds. Its 16,919,407-byte model fits the
[25 MiB Pages file limit](https://developers.cloudflare.com/pages/platform/limits/);
CI verifies every asset hash and file size in the upload directory. Runtime,
model and React notices accompany it. Assets load from `/whistle/` on the same
origin. The docs contain no model. Static hosting does not make either app a PWA
or guarantee offline reopening.

## Releasing and dry runs

1. Update `packages/whistle/package.json` and `packages/react/package.json` to the
   same release version, and set React's SDK peer range to `^<version>` (including
   a prerelease suffix when applicable). Update the lockfile with `pnpm install`.
   Review the generated packages/assets together. Private package versions are independent.
2. Commit the reviewed changes and run CI. `pnpm release:check` locally creates
   `artifacts/tiny-stt-whistle-<version>.tgz`, `artifacts/tiny-stt-react-<version>.tgz`
   and `release.json` without publishing.
3. For rehearsal, dispatch **Release** with `dry_run: true` on the branch or matching
   tag. It runs all CI and `npm publish --dry-run`, even before the packages exist.
   A dry run cannot verify live OIDC credentials, provenance or Cloudflare access.
4. When ready for a real release, push the tag `v<version>` pointing to the reviewed
   commit. The tag must exactly match both public package versions. Successful CI gates npm;
   successful npm publication/identical-version skip gates both Pages uploads and
   the GitHub release.

Stable versions use npm's `latest` tag. Prereleases use `alpha`, `beta`, `rc` or
`next`; other identifiers map to `next`. They never update `latest`. As in the
reference workflow, **all pushed release tags, including prereleases, update the
production Pages sites**. GitHub marks prerelease versions accordingly.

A manual dispatch with `dry_run: false` requires a matching tag and can publish npm;
it does not deploy Pages or create a GitHub release. Use the pushed-tag run or
rerun its failed jobs for the full release flow.

Only an npm HTTP 404 is treated as missing. Authentication, rate-limit, server and
network errors fail the release. An existing version of either package with different tarball bytes
fails rather than silently skipping. Do not replace a published version or move a
released tag: fix the issue and release a new version. If a Pages upload fails
after npm succeeds, rerun that job while the tested artifact is retained. GitHub
release creation and the two site uploads are independent after npm succeeds;
a failure in one does not roll back the others.

Local checks validate packaging, release guards and the rendered sites. A successful
live GitHub/OIDC/Pages release still requires the owner account setup and a real
tag-triggered run; local tests must not be reported as that live validation.

The original SDK/platform evidence is recorded in [Compatibility and licensing](compatibility.md).
The React extraction adds hook lifecycle tests, SSR, real-model browser recording/file
flows and a clean consumer of both tarballs. See [React hooks](react.md) and the demo
README for the current executed checks. GitHub-hosted execution, Windows, live npm
OIDC/provenance and Cloudflare uploads have not been executed locally.
