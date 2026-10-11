import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateManifest } from '../dist/assets.js';
import { manifest } from '../dist/inventory.js';
import { createWhistle } from '../dist/node.js';

test('manifest schema and generated support files are part of compatibility', () => {
  for (const broken of [
    null,
    {},
    { ...manifest, schemaVersion: 2 },
    { ...manifest, compatibilityId: 'other' },
    { ...manifest, files: { ...manifest.files, 'node-worker.js': { bytes: 1, sha256: 'fake' } } },
  ])
    assert.throws(() => validateManifest(broken, manifest), { code: 'ASSET_INCOMPATIBLE' });
  validateManifest(structuredClone(manifest), manifest);
});
test('Node rejects corrupt executable bytes before importing them', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'whistle bad assets '));
  t.after(() => rm(out, { recursive: true, force: true }));
  await cp('dist/assets/manifest.json', join(out, 'manifest.json'));
  await writeFile(join(out, 'needle.js'), 'throw new Error("untrusted code must never run")');
  await assert.rejects(createWhistle({ assetsPath: out }), { code: 'ASSET_INTEGRITY_FAILED' });
});
test('public ESM imports perform no downloads or worker initialization during SSR', async () => {
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      new URL('./deny-network.mjs', import.meta.url).href,
      '--input-type=module',
      '-e',
      `await import('@tiny-stt/whistle');await import('@tiny-stt/whistle/node');await import('@tiny-stt/whistle/audio');await import('@tiny-stt/whistle/microphone');const {createWhistle}=await import('@tiny-stt/whistle');try{await createWhistle();process.exitCode=1;}catch(e){if(e.code!=='UNSUPPORTED_ENVIRONMENT')throw e;}`,
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(child.status, 0, child.stderr);
});
