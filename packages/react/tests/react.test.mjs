import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { RecorderController, WhistleController } from '../dist/controller.js';
import { useWhistle, useWhistleRecorder, WhistleError } from '../dist/index.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const transcript = (text) => ({
  text,
  language: 'en',
  timings: { firstTokenMs: 0, decodeTokensPerSecond: 0, totalMs: 1 },
});
function fakeEngine() {
  const calls = [];
  let disposed = 0;
  return {
    calls,
    get disposed() {
      return disposed;
    },
    async dispose() {
      disposed++;
    },
    transcribe(pcm, options) {
      const completion = deferred();
      calls.push({ pcm, options, ...completion });
      return completion.promise;
    },
  };
}

test('React SSR renders idle hooks without browser APIs, loading or capture', () => {
  function Example() {
    const whistle = useWhistle({ assetsUrl: '/whistle/' });
    const recorder = useWhistleRecorder(whistle);
    assert.equal(whistle.ready, false);
    assert.equal(whistle.pending, 0);
    return createElement('p', null, `${whistle.status}/${recorder.status}`);
  }
  assert.equal(renderToString(createElement(Example)), '<p>idle/idle</p>');
});

test('explicit deduplicated load, cancellation, late initialization, cleanup and effect replay', async () => {
  const loads = [];
  const hook = new WhistleController({}, (options) => {
    const completion = deferred();
    loads.push({ options, ...completion });
    return completion.promise;
  });
  assert.equal(loads.length, 0);
  const first = hook.load();
  assert.equal(hook.load(), first);
  const cancelled = assert.rejects(first, { code: 'ABORTED' });
  hook.cancel();
  await cancelled;
  assert.ok(loads[0].options.signal.aborted);
  const second = hook.load();
  const stale = fakeEngine();
  loads[0].resolve(stale);
  loads[0].options.onProgress({ stage: 'ready' });
  await tick();
  assert.equal(stale.disposed, 1);
  assert.equal(hook.snapshot().ready, false);
  assert.equal(hook.snapshot().progress, undefined);
  const engine = fakeEngine();
  loads[1].resolve(engine);
  await second;
  await hook.load();
  assert.equal(loads.length, 2);
  hook.release();
  hook.release();
  assert.equal(engine.disposed, 1);
  await assert.rejects(hook.load(), { code: 'DISPOSED' });
  hook.activate();
  const third = hook.load();
  const rejected = assert.rejects(third, { code: 'DISPOSED' });
  hook.release();
  await rejected;
  const late = fakeEngine();
  loads[2].resolve(late);
  await tick();
  assert.equal(late.disposed, 1);
  assert.equal(hook.snapshot().ready, false);
});

test('mixed file/PCM FIFO snapshots offsets and hints; queued abort never reaches inference', async () => {
  const engine = fakeEngine(),
    decoding = deferred();
  const hook = new WhistleController(
    {},
    async () => engine,
    () => decoding.promise,
  );
  await hook.load();
  const a = hook.transcribeFile(new Blob(['fixture']));
  const source = new Float32Array([0.9, 0.25, 0.5, 0.9]);
  const options = { keywords: ['before'], wordTimestamps: true };
  const b = hook.transcribe(source.subarray(1, 3), options);
  source.fill(0);
  options.keywords[0] = 'after';
  options.wordTimestamps = false;
  const ac = new AbortController();
  const c = hook.transcribe(new Float32Array([0]), { signal: ac.signal });
  const rejected = assert.rejects(c, { code: 'ABORTED' });
  ac.abort();
  await rejected;
  assert.equal(engine.calls.length, 0);
  assert.equal(hook.snapshot().pending, 2);
  decoding.resolve(new Float32Array([0.1]));
  await tick();
  engine.calls[0].resolve(transcript('first'));
  await a;
  assert.deepEqual([...engine.calls[1].pcm], [0.25, 0.5]);
  assert.deepEqual(engine.calls[1].options.keywords, ['before']);
  assert.equal(engine.calls[1].options.wordTimestamps, true);
  assert.equal(source.buffer.byteLength, 16);
  engine.calls[1].resolve(transcript('second'));
  await b;
  assert.equal(hook.snapshot().result.text, 'second');
  assert.equal(hook.snapshot().pending, 0);
  for (const pcm of [
    new Float32Array(),
    new Float32Array([NaN]),
    new Float32Array([Infinity]),
    new Float32Array([2]),
  ]) {
    await assert.rejects(hook.transcribe(pcm), { code: 'INVALID_AUDIO' });
  }
  await assert.rejects(hook.transcribe(new Float32Array(480001)), { code: 'AUDIO_TOO_LONG' });
  assert.equal(engine.calls.length, 2);
  hook.release();
});

test('malformed signals cannot disrupt active work or enter the PCM/file queue', async () => {
  const engine = fakeEngine();
  let decodes = 0;
  const hook = new WhistleController(
    {},
    async () => engine,
    async () => {
      decodes++;
      return new Float32Array([0]);
    },
  );
  await hook.load();
  try {
    const active = hook.transcribe(new Float32Array([0]));
    for (const signal of [
      { aborted: false, addEventListener() {} },
      { aborted: false, addEventListener() {}, removeEventListener: true },
    ]) {
      await assert.rejects(hook.transcribe(new Float32Array([0]), { signal }), {
        code: 'INVALID_OPTIONS',
      });
      await assert.rejects(hook.transcribeFile(new Blob(['fixture']), { signal }), {
        code: 'INVALID_OPTIONS',
      });
    }
    assert.equal(hook.snapshot().pending, 1);
    assert.equal(engine.calls.length, 1);
    assert.equal(decodes, 0);
    engine.calls[0].resolve(transcript('surviving'));
    assert.equal((await active).text, 'surviving');
    assert.equal(hook.snapshot().pending, 0);
    assert.equal(hook.snapshot().error, undefined);
  } finally {
    hook.release();
  }
});

test('active abort survives late results, cancel-all settles the queue, unmount settles everything', async () => {
  const engine = fakeEngine();
  const hook = new WhistleController({}, async () => engine);
  await hook.load();
  const ac = new AbortController();
  const a = hook.transcribe(new Float32Array([0]), { signal: ac.signal });
  const b = hook.transcribe(new Float32Array([0]));
  const rejected = assert.rejects(a, { code: 'ABORTED' });
  ac.abort();
  await rejected;
  assert.ok(engine.calls[0].options.signal.aborted);
  engine.calls[1].resolve(transcript('surviving'));
  await b;
  engine.calls[0].resolve(transcript('stale'));
  await tick();
  assert.equal(hook.snapshot().result.text, 'surviving');
  const promises = [hook.transcribe(new Float32Array([0])), hook.transcribe(new Float32Array([0]))];
  const settled = promises.map((p) => assert.rejects(p, { code: 'ABORTED' }));
  hook.cancel();
  await Promise.all(settled);
  assert.equal(hook.snapshot().pending, 0);
  assert.ok(hook.snapshot().ready);
  const last = hook.transcribe(new Float32Array([0]));
  const released = assert.rejects(last, { code: 'DISPOSED' });
  hook.release();
  await released;
  assert.equal(engine.disposed, 1);
  assert.equal(hook.snapshot().ready, false);
});

test('recorder cancels pending permission, ignores late grants and deduplicates start/stop', async () => {
  const permission = deferred(),
    audio = deferred();
  let cancelled = 0,
    starts = 0;
  const recorder = new RecorderController(
    async () => transcript('voice'),
    () => {
      starts++;
      return permission.promise;
    },
  );
  const started = recorder.start(true, {});
  assert.equal(recorder.start(true, {}), started);
  const rejected = assert.rejects(started, { code: 'ABORTED' });
  assert.equal(recorder.stop(), started);
  await rejected;
  permission.resolve({
    result: audio.promise,
    stop: () => audio.promise,
    cancel: () => {
      cancelled++;
      audio.reject(new Error('cancelled'));
    },
  });
  await tick();
  assert.equal(cancelled, 1);
  assert.equal(starts, 1);
  assert.equal(recorder.snapshot().result, undefined);
  assert.equal(await recorder.stop(), undefined);
  recorder.release();
  await assert.rejects(recorder.start(true, {}), { code: 'DISPOSED' });
});

test('recorder cancellation cancels only its own queued transcription', async () => {
  const engine = fakeEngine();
  const whistle = new WhistleController({}, async () => engine);
  await whistle.load();
  const file = whistle.transcribe(new Float32Array([0]));
  const audio = deferred();
  const recorder = new RecorderController(whistle.transcribe, async () => ({
    result: audio.promise,
    stop: () => audio.promise,
    cancel() {},
  }));
  const options = { transcribeOptions: { keywords: ['before'] } };
  const voice = recorder.start(true, options);
  options.transcribeOptions.keywords[0] = 'after';
  await tick();
  assert.equal(recorder.stop(), voice);
  audio.resolve(new Float32Array([0]));
  await tick();
  const after = whistle.transcribe(new Float32Array([0]));
  const rejected = assert.rejects(voice, { code: 'ABORTED' });
  recorder.cancel();
  await rejected;
  assert.equal(whistle.snapshot().pending, 2);
  engine.calls[0].resolve(transcript('file'));
  await file;
  assert.equal(engine.calls.length, 2);
  engine.calls[1].resolve(transcript('after'));
  await after;
  assert.equal(whistle.snapshot().result.text, 'after');
  recorder.release();
  whistle.release();
});

test('worker crash and recovery asset failures settle queues and permit reload', async () => {
  for (const code of ['WORKER_FAILED', 'ASSET_NOT_FOUND', 'MODEL_LOAD_FAILED']) {
    const first = fakeEngine(),
      second = fakeEngine();
    let loads = 0;
    const hook = new WhistleController({}, async () => (loads++ ? second : first));
    await hook.load();
    const a = hook.transcribe(new Float32Array([0]));
    const b = hook.transcribe(new Float32Array([0]));
    const failures = [a, b].map((p) => assert.rejects(p, { code }));
    first.calls[0].reject(new WhistleError(code, 'worker failed'));
    await Promise.all(failures);
    assert.equal(hook.snapshot().ready, false);
    assert.equal(hook.snapshot().pending, 0);
    assert.equal(first.disposed, 1);
    await hook.load();
    const recovered = hook.transcribe(new Float32Array([0]));
    second.calls[0].resolve(transcript('recovered'));
    assert.equal((await recovered).text, 'recovered');
    hook.release();
  }
});

test('recorder snapshots hints before permission and stop resolves after transcription', async () => {
  const audio = deferred(),
    completion = deferred();
  const calls = [];
  const recorder = new RecorderController(
    (_pcm, options) => {
      calls.push(options);
      return completion.promise;
    },
    async () => ({ result: audio.promise, stop: () => audio.promise, cancel() {} }),
  );
  const options = { transcribeOptions: { keywords: ['before'], wordTimestamps: true } };
  const started = recorder.start(true, options);
  options.transcribeOptions.keywords[0] = 'after';
  options.transcribeOptions.wordTimestamps = false;
  await tick();
  assert.equal(recorder.stop(), started);
  audio.resolve(new Float32Array([0]));
  await tick();
  assert.equal(recorder.snapshot().status, 'transcribing');
  assert.deepEqual(calls[0].keywords, ['before']);
  assert.equal(calls[0].wordTimestamps, true);
  completion.resolve(transcript('recorded'));
  assert.equal((await started).text, 'recorded');
  recorder.release();
});
