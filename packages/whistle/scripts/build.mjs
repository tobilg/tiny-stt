import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const lock = JSON.parse(await readFile('asset-lock.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const digest = (bytes) => ({
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
for (const [key, asset] of Object.entries(lock.files)) {
  if (key === 'model') continue;
  const actual = digest(await readFile(asset.file));
  if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256)
    throw Error(`Locked upstream artifact mismatch: ${asset.file}`);
}
await rm('dist', { recursive: true, force: true });
execFileSync(process.execPath, [join(require.resolve('typescript/package.json'), '../bin/tsc')], {
  stdio: 'inherit',
});
await mkdir('dist/assets', { recursive: true });
await build({
  entryPoints: ['src/browser-worker.ts'],
  outfile: 'dist/assets/browser-worker.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  legalComments: 'inline',
});
await build({
  entryPoints: ['src/node-worker.ts'],
  outfile: 'dist/assets/node-worker.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'inline',
});
const copies = {
  'needle.js': 'vendor/needle.js',
  'needle.wasm': 'vendor/upstream/needle.wasm',
  LICENSE: 'LICENSE',
  NOTICE: 'NOTICE',
  'NEEDLE-LICENSE': 'vendor/upstream/NEEDLE-LICENSE',
  'WHISTLE-LICENSE': 'vendor/upstream/WHISTLE-LICENSE',
};
for (const [name, source] of Object.entries(copies)) await cp(source, `dist/assets/${name}`);
await writeFile('dist/assets/package.json', '{"type":"module","private":true}\n');
await cp('asset-lock.json', 'dist/assets/asset-lock.json');
const files = {};
for (const name of [
  ...Object.keys(copies),
  'package.json',
  'asset-lock.json',
  'browser-worker.js',
  'node-worker.js',
])
  files[name] = digest(await readFile(`dist/assets/${name}`));
files['whistle.cact'] = {
  bytes: lock.files.model.bytes,
  sha256: lock.files.model.sha256,
  source: lock.files.model.url,
};
const manifest = {
  schemaVersion: 1,
  compatibilityId: lock.compatibilityId,
  sdkVersion: pkg.version,
  files,
};
await writeFile('dist/assets/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  'dist/inventory.js',
  `// Generated from verified inputs and built support files.\nexport const manifest = ${JSON.stringify(manifest, null, 2)};\n`,
);
await cp('src/inventory.d.ts', 'dist/inventory.d.ts');
await chmod('dist/cli.js', 0o755);
