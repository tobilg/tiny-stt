import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';
import { serve } from './server.mjs';

const target = process.env.BROWSER ?? 'chromium';
const engines = { chromium, firefox, webkit };
const options = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const server = await serve(process.cwd(), { csp: true });
const browser = await engines[target].launch({ headless: true, ...options });
const context = await browser.newContext();
const external = [];
await context.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (u.origin !== new URL(server.url).origin) {
    external.push(u.href);
    return route.abort();
  }
  return route.continue();
});
try {
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('PAGE ERROR', error));
  await page.goto(`${server.url}tests/`);
  const result = await page.evaluate(async () => {
    const { createWhistle } = await import('/dist/browser.js');
    const { decodeAudio } = await import('/dist/audio.js');
    const pcm = await decodeAudio(await (await fetch('/tests/fixtures/jfk.wav')).blob());
    const progress = [];
    const start = performance.now();
    const w = await createWhistle({
      assetsUrl: '../.cache/assets',
      onProgress: (p) => progress.push(p),
    });
    const coldMs = performance.now() - start;
    try {
      const speech = await w.transcribe(pcm, {
        wordTimestamps: true,
        keywords: ['Kraków', 'Cactus'],
      });
      const silence = await w.transcribe(new Float32Array(16000), { wordTimestamps: true });
      const controller = new AbortController();
      const a = w.transcribe(pcm, { signal: controller.signal }).then(
        () => ({ code: 'WRONG' }),
        (e) => ({ code: e.code }),
      );
      const b = w.transcribe(pcm);
      setTimeout(() => controller.abort(), 25);
      const aborted = await a;
      const recovered = await b;
      return {
        coldMs,
        speech,
        silence,
        aborted,
        recovered,
        progress,
        isolated: crossOriginIsolated,
      };
    } finally {
      await w.dispose();
    }
  });
  assert.match(result.speech.text, /ask not what your country can do for you/i);
  assert.equal(result.speech.language, 'en');
  let end = 0;
  for (const word of result.speech.words) {
    assert.ok(word.start >= end && word.end <= 11);
    end = word.end;
  }
  assert.deepEqual(result.silence.words, []);
  assert.equal(result.silence.text, '');
  assert.equal(result.silence.language, null);
  assert.equal(result.aborted.code, 'ABORTED');
  assert.ok(result.recovered.text);
  assert.equal(result.progress.filter((p) => p.stage === 'ready').length, 1);
  assert.equal(result.isolated, false);
  assert.deepEqual(external, []);
  // New worker/instance: model and WASM network unavailable, persistent cache remains.
  await context.route('**/.cache/assets/whistle.cact', (r) => r.abort());
  await context.route('**/.cache/assets/needle.wasm', (r) => r.abort());
  const warm = await page.evaluate(async () => {
    const { createWhistle } = await import('/dist/browser.js');
    const progress = [];
    const start = performance.now();
    const w = await createWhistle({
      assetsUrl: '/.cache/assets/',
      onProgress: (p) => progress.push(p),
    });
    try {
      return {
        ms: performance.now() - start,
        progress,
        result: await w.transcribe(new Float32Array(16000)),
      };
    } finally {
      await w.dispose();
    }
  });
  assert.ok(warm.progress.filter((p) => p.asset).every((p) => p.fromCache === true));
  assert.equal(warm.result.text, '');
  await context.unroute('**/.cache/assets/whistle.cact');
  await context.unroute('**/.cache/assets/needle.wasm');
  // Corrupt persistent bytes must be evicted and replaced from the selected source.
  const repaired = await page.evaluate(async () => {
    const { manifest } = await import('/dist/inventory.js');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('tiny-stt-whistle-v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction('assets', 'readwrite');
        tx.objectStore('assets').put(
          new Uint8Array([1, 2, 3]).buffer,
          manifest.files['whistle.cact'].sha256,
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const { createWhistle } = await import('/dist/browser.js');
    const progress = [];
    const w = await createWhistle({
      assetsUrl: '/.cache/assets/',
      onProgress: (p) => progress.push(p),
    });
    try {
      return { progress, result: await w.transcribe(new Float32Array(16000)) };
    } finally {
      await w.dispose();
    }
  });
  assert.ok(repaired.progress.some((p) => p.asset === 'model' && p.fromCache === false));
  assert.equal(repaired.result.text, '');
  // Browser worker with denied persistence, keeping real loader/model/inference.
  const originalWorker = await readFile('.cache/assets/browser-worker.js', 'utf8');
  await context.route('**/.cache/assets/browser-worker.js', (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `Object.defineProperty(globalThis,'indexedDB',{get(){throw new DOMException('Denied','SecurityError')}});\n${originalWorker}`,
    }),
  );
  const fallback = await page.evaluate(async () => {
    const { createWhistle } = await import('/dist/browser.js');
    const progress = [];
    const w = await createWhistle({
      assetsUrl: '/.cache/assets/',
      onProgress: (p) => progress.push(p),
    });
    try {
      return { progress, result: await w.transcribe(new Float32Array(16000)) };
    } finally {
      await w.dispose();
    }
  });
  assert.ok(fallback.progress.filter((p) => p.asset).every((p) => p.fromCache === false));
  assert.equal(fallback.result.text, '');
  await context.unroute('**/.cache/assets/browser-worker.js');
  const helpers = await page.evaluate(async () => {
    const { decodeAudio } = await import('/dist/audio.js');
    const { startRecording } = await import('/dist/microphone.js');
    function wav(seconds = 1) {
      const frames = 48000 * seconds,
        b = new ArrayBuffer(44 + frames * 4),
        v = new DataView(b);
      const s = (o, t) => {
        for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
      };
      s(0, 'RIFF');
      v.setUint32(4, b.byteLength - 8, true);
      s(8, 'WAVEfmt ');
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 2, true);
      v.setUint32(24, 48000, true);
      v.setUint32(28, 192000, true);
      v.setUint16(32, 4, true);
      v.setUint16(34, 16, true);
      s(36, 'data');
      v.setUint32(40, frames * 4, true);
      for (let i = 0; i < frames; i++) {
        v.setInt16(44 + i * 4, 8192, true);
        v.setInt16(46 + i * 4, 24576, true);
      }
      return new Blob([b], { type: 'audio/wav' });
    }
    const stereo = wav();
    const mono = await decodeAudio(stereo);
    const corrupt = await decodeAudio(new Blob(['bad'])).then(
      () => '',
      (e) => e.code,
    );
    const long = await decodeAudio(wav(31)).then(
      () => '',
      (e) => e.code,
    );
    const ac = new AbortController();
    const decoding = decodeAudio(stereo, { signal: ac.signal }).then(
      () => '',
      (e) => e.code,
    );
    ac.abort();
    const decodeAborted = await decoding;
    let stops = 0;
    const track = () => ({
      readyState: 'live',
      stop() {
        stops++;
        this.readyState = 'ended';
      },
    });
    const stream = () => {
      const t = track();
      return { getTracks: () => [t], getAudioTracks: () => [t] };
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream() },
    });
    globalThis.MediaRecorder = class {
      state = 'inactive';
      mimeType = 'audio/wav';
      start() {
        this.state = 'recording';
        queueMicrotask(() => this.onstart?.());
      }
      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        queueMicrotask(() => {
          this.ondataavailable?.({ data: stereo });
          this.onstop?.();
        });
      }
    };
    const auto = await startRecording({ maxDurationSeconds: 0.02 });
    const autoPcm = await auto.result;
    const same = auto.stop() === auto.result;
    const manual = await startRecording();
    const manualPcm = await manual.stop();
    const manualSame = manual.stop() === manual.result;
    const cancelled = await startRecording();
    const rejected = cancelled.result.then(
      () => '',
      (e) => e.code,
    );
    cancelled.cancel();
    cancelled.cancel();
    const cancelledCode = await rejected;
    let permission;
    navigator.mediaDevices.getUserMedia = () => new Promise((r) => (permission = r));
    const lateAbort = new AbortController();
    const late = startRecording({ signal: lateAbort.signal }).then(
      () => '',
      (e) => e.code,
    );
    lateAbort.abort();
    const lateCode = await late;
    const before = stops;
    permission(stream());
    await new Promise((r) => setTimeout(r, 0));
    const lateTracksStopped = stops > before;
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('denied', 'NotAllowedError');
    };
    const denied = await startRecording().then(
      () => '',
      (e) => e.code,
    );
    return {
      sampleCount: mono.length,
      mean: mono.slice(100, 15900).reduce((a, b) => a + b, 0) / 15800,
      corrupt,
      long,
      decodeAborted,
      autoSamples: autoPcm.length,
      manualSamples: manualPcm.length,
      same,
      manualSame,
      cancelledCode,
      lateCode,
      lateTracksStopped,
      denied,
      stops,
    };
  });
  assert.equal(helpers.sampleCount, 16000);
  assert.ok(Math.abs(helpers.mean - 0.5) < 0.001);
  assert.equal(helpers.corrupt, 'AUDIO_DECODE_FAILED');
  assert.equal(helpers.long, 'AUDIO_TOO_LONG');
  assert.equal(helpers.decodeAborted, 'ABORTED');
  assert.equal(helpers.autoSamples, 320);
  assert.equal(helpers.manualSamples, 16000);
  assert.ok(helpers.same && helpers.manualSame && helpers.lateTracksStopped);
  assert.equal(helpers.cancelledCode, 'ABORTED');
  assert.equal(helpers.lateCode, 'ABORTED');
  assert.equal(helpers.denied, 'MICROPHONE_DENIED');
  assert.deepEqual(external, []);
  // Default asset selection: assert exact pinned model request, supply the verified real model.
  const defaultContext = await browser.newContext();
  const lock = JSON.parse(await readFile('asset-lock.json', 'utf8'));
  const defaultRequests = [];
  await defaultContext.route('**/*', async (route) => {
    const u = route.request().url();
    if (new URL(u).origin === new URL(server.url).origin) {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers['content-security-policy'];
      return route.fulfill({ response, headers });
    }
    defaultRequests.push(u);
    if (u === lock.files.model.url)
      return route.fulfill({
        body: await readFile('.cache/assets/whistle.cact'),
        contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
      });
    return route.abort();
  });
  const defaultPage = await defaultContext.newPage();
  await defaultPage.goto(`${server.url}tests/`);
  // Override test page CSP only for this explicit upstream acquisition test.
  await defaultPage.route('**/tests/', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['content-security-policy'];
    await route.fulfill({ response, headers });
  });
  await defaultPage.reload();
  const defaultResult = await defaultPage.evaluate(async () => {
    const { createWhistle } = await import('/dist/browser.js');
    const w = await createWhistle({ cache: 'none' });
    try {
      return await w.transcribe(new Float32Array(16000));
    } finally {
      await w.dispose();
    }
  });
  assert.equal(defaultResult.text, '');
  assert.deepEqual(defaultRequests, [lock.files.model.url]);
  await defaultContext.close();
  console.log(
    JSON.stringify(
      {
        browser: await browser.version(),
        target,
        coldMs: result.coldMs,
        warmCacheMs: warm.ms,
        speech: result.speech,
        helpers,
        externalRequests: external,
        checks:
          'self-hosted, CSP, real speech/timestamps/silence, abort recovery, persistent cache, denied cache, helpers, pinned default',
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
