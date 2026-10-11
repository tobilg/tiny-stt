---
title: Deployment
group: Guides
---

## Prepare and verify assets

Use the CLI from the installed, lockfile-pinned SDK during build/deployment:

```sh
pnpm exec whistle download --out public/whistle
pnpm exec whistle download --out vendor/whistle
pnpm exec whistle download --offline --out vendor/whistle
pnpm exec whistle download --help
```

The browser typically serves `public/whistle`; Node reads a private local directory
such as `vendor/whistle`. A production build should prepare assets before bundling
the application. No npm postinstall download is performed.

Valid files are hash-checked and reused without network access. Corrupt managed
files are repaired, unrelated files are preserved, and temporary downloads are
verified before atomic rename. `manifest.json` is published last. `--offline`
never fetches and fails if required model bytes are missing or corrupt. Transient
failures have at most three attempts, a 60-second request timeout, and cancellable
backoff. Progress goes to stderr. Exit codes: 0 success, 1 operational failure,
2 usage error, 130 SIGINT, 143 SIGTERM where supported.

## Asset layout and integrity

Run the installed `whistle download --out <directory>` during build/deployment.
The flat directory includes `whistle.cact`, `needle.js`, `needle.wasm`, both worker
bundles, a `package.json` marking ESM, `asset-lock.json`, `manifest.json`, `LICENSE`,
`NOTICE`, `NEEDLE-LICENSE`, and `WHISTLE-LICENSE`. No manual worker/WASM path surgery
is needed: use this directory as `assetsPath` or `assetsUrl`.

`asset-lock.json` schema 1 records the immutable upstream pair, original and adapted
loader hashes, header, licenses and model metadata. The build verifies vendored
inputs against that lock. The generated `manifest.json` schema 1 records the SDK
version, compatibility ID, and size/SHA-256 of **every** deployment file except
itself. Both adapters compare the supplied manifest with their compiled inventory.
Ship a package and assets from the same build; different generated worker hashes
are intentionally incompatible even if the upstream pair stayed the same.

These digests establish consistency with the trusted checked-in lock; they are not
a separate publisher signature. Treat the application and static executable code
as trusted deployment material. Browser ESM loading does not offer subresource
integrity for dynamic imports: the SDK checks loader bytes before importing the
static URL, but a server that changes JS between requests is outside this integrity
model. Never serve executable assets from an untrusted writable origin. No fetched
source is evaluated with `eval`, `Function`, or a blob loader.

CLI renames are atomic per file; the whole directory is not a multi-file transaction.
On first-install failure, no completion manifest is created. On interrupted repair,
an older manifest may remain; adapters still verify against the installed package,
so mismatched files cannot silently load. SIGINT/SIGTERM remove this process's
temporary writes. SIGKILL/power loss may leave uniquely named `.tmp` files; they are
never accepted as assets and a later run ignores them. Unrelated files are not deleted.
Avoid concurrent deployments to the same output directory; deploy a new directory
and switch your application's pointer if zero-downtime upgrades are needed.

## Browser production builds

The root entry has no Node imports. Vite production builds are tested from an
installed tarball, including a `/demo/` base. Default workers use the recognizable
`new Worker(new URL(..., import.meta.url), { type: 'module' })` pattern. Loader/WASM
URLs use module-relative static assets. Other bundlers are not claimed tested.
If your build rewrites assets differently, prepare a static directory and pass
`assetsUrl`; `workerUrl` and `wasmUrl` are explicit escape hatches. A worker override
must run the package's matching protocol/code, not an arbitrary implementation.

Serve `.js` as JavaScript and `.wasm` as `application/wasm`. Use HTTPS or localhost
for Web Crypto, IndexedDB and microphone APIs. The runtime requires WebAssembly
SIMD and BigInt integration; it does not use WebGPU or WASM threads. Our browser
checks ran with `crossOriginIsolated === false`: SharedArrayBuffer and COOP/COEP
are not required for this pinned engine.

For a same-origin static application and CLI assets, this tested CSP is sufficient:

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self';
connect-src 'self';
style-src 'self';
media-src 'self' blob:;
```

Apply suitable policy to worker script responses as well as the page. There is no
JavaScript `unsafe-eval` requirement. A policy that prohibits WebAssembly compilation
will not work. Default official-model acquisition additionally needs `connect-src`
permission for the pinned Hugging Face URL and its CDN/storage redirect hosts;
those third-party hosts can change. Self-host assets when you require a fixed
same-origin CSP. Cross-origin mirrors also need CORS. Module workers are normally
same-origin, so serve the packaged worker on your application origin.

IndexedDB stores verified complete bytes by immutable SHA-256. Transactions complete
before assets are reported loaded. It is optional: denial, private-mode restrictions,
quota exhaustion and eviction cause uncached loading. Cache is per browser origin;
there is no global audio/model service. To clear SDK persistence, delete the
`tiny-stt-whistle-v1` database after disposing active instances. The SDK never
persists recordings or transcripts. Cache hits are rehashed before use.

`cache: 'none'` disables SDK-managed persistence, not the browser's HTTP cache.

Offline websites also need their HTML, application bundle, module worker, loader,
and self-hosted manifest to remain available. Use your application's service worker
or a local static server as appropriate. An HTTP/self-hosted success with external
hosts blocked is not proof that an uncached browser can open your site offline.

## Node packaging

Use `/node` and an explicit local asset directory. The worker reads files directly,
verifies all inventory entries, then supplies WASM bytes to the adapted static ESM
loader. No `file:` URL is passed to browser-style fetch. The adapted loader disables
its original Node filesystem/process-exit hooks; it still uses the unchanged engine
binary. Model bytes are kept alive for the lifetime of the worker.

Node 22 and 24 are the initial targets. Linux arm64 and macOS arm64 have executed
packed-package evidence; Windows is configured in CI but not executed locally.
No CommonJS entry, native addon, compiler or Python is required. The npm package
has no production dependencies and no postinstall script.

Release preparation must check publishing access and the `whistle` executable's
potential command-name conflicts. The package identity is already settled as
`@tiny-stt/whistle`. The [release workflow](releasing.md) publishes the SDK using
npm trusted publishing and deploys the documentation and demo to Cloudflare Pages
after a matching release tag is pushed and all CI checks pass. Local build and
preview commands do not publish or deploy.
