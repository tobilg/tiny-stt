import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createWhistle } from '../../dist/node.js';
import { readWav } from '../helpers.mjs';
import { assertBoundedRssGrowth } from '../memory.mjs';

const assets = process.env.WHISTLE_ASSETS ?? '.cache/assets';
test('real model: speech, silence, keywords, timestamps, repeated memory, isolation', async () => {
  const start = performance.now(),
    progress = [];
  const w = await createWhistle({
    assetsPath: pathToFileURL(resolve(assets)),
    onProgress: (p) => progress.push(p),
  });
  const coldMs = performance.now() - start;
  const pcm = readWav();
  const times = [],
    rss = [];
  try {
    assert.equal(progress.filter((p) => p.stage === 'ready').length, 1);
    assert.ok(progress.filter((p) => p.asset).every((p) => p.fromCache === true));
    // Regression: this malformed signal previously reached worker cleanup and
    // caused an uncaught TypeError that terminated the Node process.
    await assert.rejects(w.transcribe(pcm, { signal: { aborted: false, addEventListener() {} } }), {
      code: 'INVALID_OPTIONS',
    });
    for (let i = 0; i < 10; i++) {
      const result = await w.transcribe(pcm, {
        wordTimestamps: true,
        keywords: [' Cactus ', 'Kraków'],
      });
      assert.match(result.text, /ask not what your country can do for you/i);
      assert.equal(result.language, 'en');
      assert.ok(result.words.length > 10);
      let end = 0;
      for (const word of result.words) {
        assert.ok(word.start >= end && word.end >= word.start && word.end <= pcm.length / 16000);
        end = word.end;
      }
      for (const v of Object.values(result.timings)) assert.ok(Number.isFinite(v) && v >= 0);
      times.push(result.timings);
      rss.push(process.memoryUsage().rss);
    }
    const silence = await w.transcribe(new Float32Array(16000), { wordTimestamps: true });
    assert.equal(silence.text, '');
    assert.equal(silence.language, null);
    assert.deepEqual(silence.words, []);
    const memory = assertBoundedRssGrowth(rss);
    const second = await createWhistle({ assetsPath: assets });
    try {
      const [a, b] = await Promise.all([
        w.transcribe(pcm),
        second.transcribe(new Float32Array(16000)),
      ]);
      assert.ok(a.text);
      assert.equal(b.text, '');
    } finally {
      await second.dispose();
    }
    console.log(
      JSON.stringify({
        node: process.version,
        coldMs,
        clipSeconds: pcm.length / 16000,
        timestamps: true,
        times,
        rss,
        memory,
      }),
    );
  } finally {
    await w.dispose();
    await w.dispose();
  }
});
test('real active abort and queued abort recover locally; disposal settles pending requests', async () => {
  const w = await createWhistle({ assetsPath: assets });
  try {
    const pcm = readWav(),
      ac = new AbortController(),
      queued = new AbortController();
    const a = w.transcribe(pcm, { signal: ac.signal }),
      b = w.transcribe(pcm, { signal: queued.signal }),
      c = w.transcribe(pcm);
    const ar = assert.rejects(a, { code: 'ABORTED' }),
      br = assert.rejects(b, { code: 'ABORTED' });
    queued.abort();
    setTimeout(() => ac.abort(), 30);
    await Promise.all([ar, br]);
    assert.match((await c).text, /fellow Americans/i);
    const d = w.transcribe(pcm),
      e = w.transcribe(pcm);
    const dr = assert.rejects(d, { code: 'DISPOSED' }),
      er = assert.rejects(e, { code: 'DISPOSED' });
    await w.dispose();
    await Promise.all([dr, er]);
  } finally {
    await w.dispose();
  }
});
test('missing assets and remote paths fail clearly', async () => {
  await assert.rejects(createWhistle({ assetsPath: '.cache/no-assets' }), {
    code: 'ASSET_NOT_FOUND',
  });
  await assert.rejects(createWhistle({ assetsPath: 'https://example.com' }), {
    code: 'INVALID_OPTIONS',
  });
});
test('network-denied subprocess: initialization, repeated calls, recovery and clean exit', () => {
  const child = spawnSync(
    process.execPath,
    ['--import', resolve('tests/deny-network.mjs'), resolve('tests/offline-node.mjs')],
    { encoding: 'utf8', timeout: 30000, env: { ...process.env, WHISTLE_ASSETS: resolve(assets) } },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /OFFLINE_OK/);
});
