import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAudio } from '../dist/audio.js';
import { createWhistle as browserWhistle } from '../dist/browser.js';
import { Client } from '../dist/client.js';
import { Engine } from '../dist/engine.js';
import { startRecording } from '../dist/microphone.js';
import { createWhistle as nodeWhistle } from '../dist/node.js';
import { normalizeResult, validateAudio, validateOptions } from '../dist/validation.js';
import { tick } from './helpers.mjs';

const code = (c) => (e) => e.code === c;
function harness() {
  const workers = [];
  const client = new Client(() => {
    const w = {
      messages: [],
      terminated: 0,
      post(m) {
        this.messages.push(m);
        if (m.type === 'init') {
          this.g = m.generation;
          queueMicrotask(() => this.message({ type: 'ready', generation: this.g }));
        }
      },
      listen(message, failure) {
        this.message = message;
        this.failure = failure;
      },
      async terminate() {
        this.terminated++;
      },
      reply(r) {
        this.message({
          type: 'result',
          generation: this.g,
          id: r.id,
          result: {
            text: String(r.audio[0]),
            language: 'en',
            timings: { firstTokenMs: 0, decodeTokensPerSecond: 0, totalMs: 1 },
          },
        });
      },
    };
    workers.push(w);
    return w;
  }, {});
  return { client, workers };
}
test('PCM limits, finite samples, offsets, options and result schema', () => {
  for (const value of [
    new Float32Array(),
    [0],
    new Float32Array([NaN]),
    new Float32Array([Infinity]),
    new Float32Array([1.1]),
  ])
    assert.throws(() => validateAudio(value), code('INVALID_AUDIO'));
  validateAudio(new Float32Array(480000));
  assert.throws(() => validateAudio(new Float32Array(480001)), code('AUDIO_TOO_LONG'));
  assert.deepEqual(validateOptions({ keywords: [' Cactus ', '', 'Cactus', 'cactus', 'Kraków'] }), {
    language: 'auto',
    keywords: ['Cactus', 'cactus', 'Kraków'],
    wordTimestamps: false,
  });
  for (const options of [
    { language: 'xx' },
    { keywords: ['bad\nword'] },
    { keywords: ['\0'] },
    { wordTimestamps: 1 },
    { signal: {} },
    { signal: { aborted: false, addEventListener() {} } },
    { signal: { aborted: false, addEventListener() {}, removeEventListener: true } },
    null,
  ])
    assert.throws(() => validateOptions(options), code('INVALID_OPTIONS'));
  const raw = {
    text: '  Hi!  ',
    language: 'en',
    words: [{ word: 'Hi!', start: 0, end: 0.1, probability: 0.9 }],
    ttft_ms: 0,
    decode_tps: 2,
  };
  assert.deepEqual(normalizeResult(raw, true, 1, 5).words, [
    { text: 'Hi!', start: 0, end: 0.1, probability: 0.9 },
  ]);
  assert.equal(normalizeResult(raw, false, 1, 5).text, 'Hi!');
  assert.equal('words' in normalizeResult(raw, false, 1, 5), false);
  for (const r of [
    { ...raw, ttft_ms: NaN },
    { ...raw, words: [{ ...raw.words[0], end: 2 }] },
    { ...raw, language: 'xx' },
    {},
  ])
    assert.throws(() => normalizeResult(r, true, 1, 1), code('INVALID_ENGINE_OUTPUT'));
});
test('malformed signals reject before loading, decoding, capture or queueing', async () => {
  const { client, workers } = harness();
  await client.initialize();
  try {
    for (const signal of [
      { aborted: false, addEventListener() {} },
      { aborted: false, addEventListener() {}, removeEventListener: true },
    ]) {
      await assert.rejects(browserWhistle({ signal }), code('INVALID_OPTIONS'));
      await assert.rejects(nodeWhistle({ assetsPath: '.', signal }), code('INVALID_OPTIONS'));
      await assert.rejects(decodeAudio(new Blob(['audio']), { signal }), code('INVALID_OPTIONS'));
      await assert.rejects(startRecording({ signal }), code('INVALID_OPTIONS'));
      await assert.rejects(
        client.transcribe(new Float32Array([0]), { signal }),
        code('INVALID_OPTIONS'),
      );
    }
    assert.equal(workers[0].messages.length, 1, 'Invalid calls must not reach the worker.');
    const result = client.transcribe(new Float32Array([0.5]));
    workers[0].reply(workers[0].messages[1]);
    assert.equal((await result).text, '0.5');
  } finally {
    await client.dispose();
  }
});
test('FIFO snapshots caller view without detachment; queued abort; terminal disposal', async () => {
  const { client, workers } = harness();
  await client.initialize();
  const w = workers[0],
    buffer = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const a = client.transcribe(buffer.subarray(1, 2));
  const b = client.transcribe(buffer.subarray(2, 3));
  buffer.fill(1);
  assert.equal(buffer.byteLength, 16);
  assert.equal(w.messages.length, 2);
  assert.equal(w.messages[1].audio.length, 1);
  assert.equal(w.messages[1].audio[0], Math.fround(0.2));
  const controller = new AbortController();
  const c = client.transcribe(new Float32Array([0]), { signal: controller.signal });
  controller.abort();
  await assert.rejects(c, code('ABORTED'));
  w.reply(w.messages[1]);
  await a;
  assert.equal(w.messages[2].audio[0], Math.fround(0.3));
  w.reply(w.messages[2]);
  await b;
  const pending = client.transcribe(new Float32Array([0]));
  const rejection = assert.rejects(pending, code('DISPOSED'));
  const disposal = client.dispose();
  assert.equal(client.dispose(), disposal);
  await disposal;
  await rejection;
  assert.equal(w.terminated, 1);
  await assert.rejects(client.transcribe(buffer), code('DISPOSED'));
});
test('active abort retires worker events and reloads surviving work, init signal is detached', async () => {
  const { client, workers } = harness(),
    init = new AbortController();
  await client.initialize(init.signal);
  init.abort();
  const ctrl = new AbortController(),
    a = client.transcribe(new Float32Array([0.1]), { signal: ctrl.signal }),
    b = client.transcribe(new Float32Array([0.2]));
  const rejected = assert.rejects(a, code('ABORTED'));
  ctrl.abort();
  await rejected;
  await tick();
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, 1);
  workers[0].reply(workers[0].messages[1]);
  workers[0].failure(Error('late crash'));
  assert.equal(workers[1].messages.length, 2);
  workers[1].reply(workers[1].messages[1]);
  assert.equal((await b).text, String(Math.fround(0.2)));
  await client.dispose();
});
test('already aborted and invalid calls do not queue; crashes settle all work', async () => {
  const { client, workers } = harness();
  await client.initialize();
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    client.transcribe(new Float32Array([0]), { signal: c.signal }),
    code('ABORTED'),
  );
  assert.equal(workers[0].messages.length, 1);
  const a = client.transcribe(new Float32Array([0])),
    b = client.transcribe(new Float32Array([0]));
  const failures = Promise.all([
    assert.rejects(a, code('WORKER_FAILED')),
    assert.rejects(b, code('WORKER_FAILED')),
  ]);
  workers[0].failure(Error('crash'));
  await failures;
  assert.equal(workers[0].terminated, 1);
  await client.dispose();
});
test('malformed worker messages reject pending promises', async () => {
  const { client, workers } = harness();
  await client.initialize();
  const p = client.transcribe(new Float32Array([0]));
  const rejected = assert.rejects(p, code('WORKER_FAILED'));
  workers[0].message(null);
  await rejected;
  await client.dispose();
});
test('initialization abort terminates partially loaded worker', async () => {
  let stopped = 0;
  const c = new Client(
    () => ({
      post() {},
      listen() {},
      async terminate() {
        stopped++;
      },
    }),
    {},
  );
  const ac = new AbortController();
  const p = c.initialize(ac.signal);
  ac.abort();
  await assert.rejects(p, code('ABORTED'));
  await c.dispose();
  assert.equal(stopped, 1);
});
test('allocation/status/unterminated/truncated/invalid JSON boundary handling and freeing', () => {
  for (const mode of ['allocation', 'status', 'unterminated', 'truncated', 'json', 'good']) {
    let next = 16,
      frees = 0;
    const e = {
      HEAPU8: new Uint8Array(3 * 1024 * 1024),
      _malloc(n) {
        if (mode === 'allocation' && next > 20) return 0;
        const p = next;
        next += Math.ceil(n / 8) * 8;
        return p;
      },
      _free() {
        frees++;
      },
      _needle_load(_p, n) {
        assert.equal(typeof n, 'bigint');
        return 0;
      },
      _needle_models() {
        return 2;
      },
      _needle_last_error() {
        return 0;
      },
      _needle_transcribe(_p, _n, _l, _k, _t, o, cap) {
        if (mode === 'status') return -1;
        if (mode === 'unterminated') return 1;
        const bytes = new TextEncoder().encode(
          mode === 'good' ? ' {"text":"","language":"","ttft_ms":0,"decode_tps":0}' : 'bad',
        );
        this.HEAPU8.set(bytes, o);
        this.HEAPU8[o + (mode === 'truncated' ? cap - 1 : bytes.length)] = 0;
        return 1;
      },
    };
    const engine = new Engine(e, new Uint8Array(16));
    const run = () =>
      engine.transcribe(new Float32Array([0]), {
        language: 'auto',
        keywords: [],
        wordTimestamps: false,
      });
    if (mode === 'good') assert.equal(run().text, '');
    else
      assert.throws(
        run,
        code(
          mode === 'allocation'
            ? 'OUT_OF_MEMORY'
            : mode === 'status'
              ? 'INFERENCE_FAILED'
              : 'INVALID_ENGINE_OUTPUT',
        ),
      );
    if (mode !== 'allocation') assert.equal(frees, 2);
  }
});
