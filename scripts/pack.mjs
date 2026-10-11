import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'artifacts');
await mkdir(destination, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const receipts = [];
for (const name of ['whistle', 'react']) {
  const output = execFileSync(
    npm,
    ['pack', '--json', '--pack-destination', destination, '--cache', resolve(root, '.cache/npm')],
    {
      cwd: resolve(root, `packages/${name}`),
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );
  const [info] = JSON.parse(output.slice(output.indexOf('[\n')));
  assert.equal(info.name, `@tiny-stt/${name}`);
  const pkg = JSON.parse(await readFile(resolve(root, `packages/${name}/package.json`), 'utf8'));
  assert.equal(info.version, pkg.version);
  assert.equal(info.filename, `tiny-stt-${name}-${pkg.version}.tgz`);
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.ok(!pkg.private && !pkg.scripts.postinstall);
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  const files = new Set(info.files.map((file) => file.path));
  if (name === 'whistle') {
    assert.ok(!pkg.peerDependencies);
    assert.ok(!pkg.exports['./react']);
    for (const file of [
      'dist/browser.js',
      'dist/node.js',
      'dist/audio.js',
      'dist/microphone.js',
      'dist/browser.d.ts',
      'dist/node.d.ts',
      'dist/audio.d.ts',
      'dist/microphone.d.ts',
      'dist/cli.js',
      'dist/assets/browser-worker.js',
      'dist/assets/node-worker.js',
      'dist/assets/needle.js',
      'dist/assets/needle.wasm',
      'dist/assets/manifest.json',
      'asset-lock.json',
      'LICENSE',
      'NOTICE',
      'README.md',
      'vendor/upstream/NEEDLE-LICENSE',
      'vendor/upstream/WHISTLE-LICENSE',
    ])
      assert.ok(files.has(file), `Missing ${file}`);
  } else {
    assert.equal(pkg.peerDependencies.react, '^19.0.0');
    assert.equal(pkg.peerDependencies['@tiny-stt/whistle'], `^${pkg.version}`);
    for (const file of [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/types.d.ts',
      'LICENSE',
      'README.md',
    ])
      assert.ok(files.has(file), `Missing ${file}`);
    assert.match(
      await readFile(resolve(root, 'packages/react/dist/index.js'), 'utf8'),
      /['"]use client['"];/,
    );
    assert.ok(![...files].some((file) => /\.(wasm|cact)$|vendor\//.test(file)));
  }
  for (const file of files)
    assert.ok(
      !/\.cact$|\.wav$|\.flac$|(^|\/)(\.cache|tests|docs|examples|node_modules)\//.test(file),
      `Unexpected ${file}`,
    );
  const integrity = `sha512-${createHash('sha512')
    .update(await readFile(resolve(destination, info.filename)))
    .digest('base64')}`;
  assert.equal(integrity, info.integrity);
  receipts.push({ name: info.name, version: info.version, filename: info.filename, integrity });
  console.log(
    JSON.stringify(
      { filename: info.filename, bytes: info.size, files: files.size, integrity },
      null,
      2,
    ),
  );
}
assert.equal(receipts[0].version, receipts[1].version, 'Public packages release in lockstep.');
await writeFile(
  resolve(destination, 'release.json'),
  `${JSON.stringify({ schemaVersion: 1, packages: receipts }, null, 2)}\n`,
);
