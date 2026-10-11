# Releasing Whistle

The [release and Pages guide](packages/documentation/guides/releasing.md) covers
the GitHub workflows, npm trusted publishers, Cloudflare projects/secrets, first
publication, dry runs and recovery. It is also rendered in the documentation site.

Quick local checks (no publishing):

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:release
pnpm typecheck
pnpm test
pnpm release:check
pnpm demo:build
pnpm --filter @tiny-stt/demo run test:build
pnpm test:docs
pnpm --filter @tiny-stt/documentation run test:build
```

Browser checks need Playwright Chromium. `release:check` writes the SDK and React tarballs
and their integrity receipt to `artifacts/`. A GitHub **Release** workflow dispatch
defaults to a dry run; only a pushed matching `v*` tag deploys the two Pages sites
and creates a GitHub release. Complete the guide's account setup before releasing.
