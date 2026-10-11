import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installAssets } from '../dist/install.js';

const data = new Uint8Array([1, 2, 3, 4]);
const asset = {
  bytes: 4,
  sha256: createHash('sha256').update(data).digest('hex'),
  source: 'https://invalid.test/model',
};
const manifest = {
  schemaVersion: 1,
  compatibilityId: 'test',
  sdkVersion: 'test',
  files: { 'whistle.cact': asset },
};
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'whistle test '));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
test('checksum failure never publishes model/manifest, preserves unrelated files', async (t) => {
  const out = await directory(t);
  await writeFile(join(out, 'keep'), 'mine');
  await assert.rejects(
    installAssets(
      { out },
      { manifest, bundledPath: out, fetch: async () => new Response(new Uint8Array([4, 3, 2, 1])) },
    ),
    { code: 'ASSET_INTEGRITY_FAILED' },
  );
  assert.deepEqual(await readdir(out), ['keep']);
});
test('atomic interruption cleans partial writes and leaves no manifest', async (t) => {
  const out = await directory(t);
  const controller = new AbortController();
  let pulls = 0;
  const body = new ReadableStream({
    pull(c) {
      if (pulls++ === 0) c.enqueue(data.subarray(0, 2));
      else {
        controller.abort();
        c.close();
      }
    },
  });
  await assert.rejects(
    installAssets(
      { out, signal: controller.signal },
      { manifest, bundledPath: out, fetch: async () => new Response(body) },
    ),
    { code: 'ABORTED' },
  );
  assert.deepEqual(await readdir(out), []);
});
test('valid-file reuse and offline mode never fetch; corrupt managed files repaired', async (t) => {
  const out = await directory(t);
  let calls = 0;
  await installAssets(
    { out },
    {
      manifest,
      bundledPath: out,
      fetch: async () => {
        calls++;
        return new Response(data);
      },
    },
  );
  assert.equal(calls, 1);
  await writeFile(join(out, 'unrelated'), 'safe');
  const noNetwork = async () => {
    throw Error('Network forbidden');
  };
  await installAssets({ out }, { manifest, bundledPath: out, fetch: noNetwork });
  await installAssets({ out, offline: true }, { manifest, bundledPath: out, fetch: noNetwork });
  assert.equal(await readFile(join(out, 'unrelated'), 'utf8'), 'safe');
  await writeFile(join(out, 'whistle.cact'), 'wrong');
  await assert.rejects(
    installAssets(
      { out, offline: true },
      { manifest, bundledPath: join(out, 'missing'), fetch: noNetwork },
    ),
    { code: 'ASSET_NOT_FOUND' },
  );
  await installAssets(
    { out },
    { manifest, bundledPath: join(out, 'missing'), fetch: async () => new Response(data) },
  );
  assert.deepEqual(new Uint8Array(await readFile(join(out, 'whistle.cact'))), data);
});
test('transient retries are bounded; usage errors exit 2', async (t) => {
  const out = await directory(t);
  let calls = 0;
  await assert.rejects(
    installAssets(
      { out },
      {
        manifest,
        bundledPath: out,
        fetch: async () => {
          calls++;
          return new Response('', { status: 503 });
        },
      },
    ),
    { code: 'ASSET_DOWNLOAD_FAILED' },
  );
  assert.equal(calls, 3);
  const { spawnSync } = await import('node:child_process');
  assert.equal(spawnSync(process.execPath, ['dist/cli.js', 'download']).status, 2);
  assert.equal(
    spawnSync(process.execPath, ['dist/cli.js', '--version'], { encoding: 'utf8' }).stdout.trim(),
    '0.1.0',
  );
});
