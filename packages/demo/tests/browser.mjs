import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { createServer, normalizePath } from 'vite';
import { serve } from '../../whistle/tests/server.mjs';

const browserName = process.env.BROWSER ?? 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(browserName)) throw Error('Unknown BROWSER.');
const browser = await { chromium, firefox, webkit }[browserName].launch({ headless: true });
const server = await serve(resolve('dist'), { csp: true });
const fixture = resolve('../whistle/tests/fixtures/jfk.wav');
const wav = (await readFile(fixture)).toString('base64');
let devServer;
const errors = [],
  external = [];

async function openPage(url, selector = '#load') {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== new URL(url).origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((encoded) => {
    const capture = {
      requests: 0,
      languages: [],
      activeTracks: 0,
      contexts: new Set(),
      workers: new Set(),
      permission: 'allow',
      grants: [],
    };
    globalThis.capture = capture;
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        capture.workers.add(this);
      }
      postMessage(message, ...options) {
        if (message?.type === 'transcribe') capture.languages.push(message.options.language);
        super.postMessage(message, ...options);
      }
      terminate() {
        capture.workers.delete(this);
        super.terminate();
      }
    };
    const NativeAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        capture.contexts.add(this);
      }
      async close() {
        if (this.state !== 'closed') {
          await super.close();
          capture.contexts.delete(this);
        }
      }
    };
    function stream() {
      capture.activeTracks++;
      const track = {
        readyState: 'live',
        stop() {
          if (this.readyState === 'live') capture.activeTracks--;
          this.readyState = 'ended';
        },
      };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          capture.requests++;
          if (capture.permission === 'deny') throw new DOMException('denied', 'NotAllowedError');
          if (capture.permission === 'pending') {
            return new Promise((resolve) => capture.grants.push(() => resolve(stream())));
          }
          return stream();
        },
      },
    });
    // Replace hardware capture only; decoding, resampling, workers and inference stay real.
    const clip = new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], {
      type: 'audio/wav',
    });
    globalThis.fixtureBlob = clip;
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
          this.ondataavailable?.({ data: clip });
          this.onstop?.();
        });
      }
    };
  }, wav);
  await page.goto(url);
  await page.locator(selector).waitFor();
  return { context, page };
}

async function status(page, prefix) {
  await page
    .waitForFunction(
      (value) => document.getElementById('status').textContent.startsWith(value),
      prefix,
      { timeout: 30000 },
    )
    .catch(async (error) => {
      throw new Error(
        `Expected ${prefix}; observed ${await page.locator('#status').textContent()}`,
        { cause: error },
      );
    });
}

async function load(page) {
  await page.click('#load');
  await status(page, 'Model ready');
}

async function watchLoadingStatus(page) {
  await page.evaluate(() => {
    const element = document.getElementById('status');
    capture.statuses = [];
    new MutationObserver(() => {
      const text = element.textContent.replace(/\d+%/g, '%');
      if (!capture.statuses.includes(text)) capture.statuses.push(text);
    }).observe(element, { childList: true, characterData: true, subtree: true });
  });
}

async function released(page, workers = 1) {
  await page.waitForFunction(
    (count) =>
      capture.activeTracks === 0 && capture.contexts.size === 0 && capture.workers.size === count,
    workers,
  );
}

try {
  const { context, page } = await openPage(server.url);
  assert.equal(await page.locator('#record').isDisabled(), true);
  assert.equal(await page.evaluate(() => capture.requests), 0);
  assert.equal(await page.locator('#language').inputValue(), 'auto');
  assert.equal(await page.locator('#language-result').count(), 0);
  assert.equal(await page.locator('#load').textContent(), 'Prepare model');

  // Cancellation while the model is still loading must permit another load.
  let held;
  let release;
  const requested = new Promise((resolve) => {
    held = resolve;
  });
  const resume = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/manifest.json', async (route) => {
    held();
    await resume;
    await route.continue().catch(() => {});
  });
  await page.click('#load');
  await requested;
  await status(page, 'Preparing model files');
  assert.equal(await page.locator('#load').textContent(), 'Preparing…');
  await page.click('#cancel');
  await status(page, 'Cancelled.');
  release();
  await page.unroute('**/manifest.json');
  assert.equal(await page.locator('#load').isEnabled(), true);
  await watchLoadingStatus(page);
  await load(page);
  const downloadStatuses = await page.evaluate(() => capture.statuses);
  assert.ok(downloadStatuses.some((text) => text.startsWith('Downloading speech model…')));
  assert.ok(downloadStatuses.includes('Initializing speech engine… Model files are ready.'));
  assert.ok(!downloadStatuses.some((text) => text.includes('from browser cache')));
  assert.equal(await page.locator('#load').textContent(), 'Model ready');
  assert.equal(await page.evaluate(() => capture.requests), 0);

  // A page refresh must report a verified cache hit, even with model/WASM requests denied.
  const blockedAssets = /\/(whistle\.cact|needle\.wasm)(?:\?|$)/;
  const cacheMisses = [];
  await context.route(blockedAssets, (route) => {
    cacheMisses.push(route.request().url());
    return route.abort();
  });
  await page.reload();
  await page.locator('#load').waitFor();
  await watchLoadingStatus(page);
  await load(page);
  const cachedStatuses = await page.evaluate(() => capture.statuses);
  assert.ok(cachedStatuses.includes('Loading speech model from browser cache…'));
  assert.ok(cachedStatuses.includes('Initializing speech engine… Model files are ready.'));
  assert.ok(!cachedStatuses.some((text) => text.startsWith('Downloading')));
  assert.deepEqual(cacheMisses, []);
  await context.unroute(blockedAssets);

  await page.check('#timestamps');
  await page.setInputFiles('#file', fixture);
  await status(page, 'Done in');
  assert.match(await page.locator('#transcript').textContent(), /fellow Americans/);
  const words = JSON.parse(await page.locator('#words').textContent());
  assert.ok(words.length > 10);
  assert.ok(words.every((word) => word.start >= 0 && word.end >= word.start && word.end <= 11));
  assert.equal(await page.locator('#file').inputValue(), '');
  assert.equal(await page.locator('#language-result').textContent(), 'Detected language: English');
  assert.equal(await page.evaluate(() => capture.languages.at(-1)), 'auto');
  // Selecting the same file again with an explicit language must use the new hint.
  await page.selectOption('#language', 'en');
  await page.setInputFiles('#file', fixture);
  await status(page, 'Done in');
  await released(page);
  assert.equal(await page.evaluate(() => capture.languages.at(-1)), 'en');
  await page.selectOption('#language', 'fr');
  assert.equal(await page.locator('#language-result').textContent(), 'Detected language: English');
  await page.selectOption('#language', 'en');
  await page.setInputFiles('#file', {
    name: 'invalid.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('invalid'),
  });
  await status(page, 'AUDIO_DECODE_FAILED');
  assert.equal(await page.locator('#file').isEnabled(), true);

  // Pointer hold/release, using fixture-backed MediaRecorder events.
  await page.locator('#record').hover();
  await page.mouse.down();
  await status(page, 'Recording.');
  assert.equal(await page.locator('#language').isDisabled(), true);
  await page.mouse.up();
  await status(page, 'Done in');
  assert.match(await page.locator('#transcript').textContent(), /fellow Americans/);
  await released(page);

  assert.equal(await page.evaluate(() => capture.languages.at(-1)), 'en');
  assert.equal(await page.locator('#language-result').textContent(), 'Detected language: English');
  await page.selectOption('#language', 'auto');

  // A pending permission grant after key release must stop its late tracks.
  await page.evaluate(() => {
    capture.permission = 'pending';
  });
  await page.focus('#record');
  await page.keyboard.down('Space');
  await status(page, 'Requesting microphone');
  await page.keyboard.up('Space');
  await status(page, 'Cancelled.');
  await page.evaluate(() => {
    capture.grants.shift()();
    capture.permission = 'allow';
  });
  await released(page);

  // Cancel active capture; the previous transcript survives.
  await page.keyboard.down('Space');
  await status(page, 'Recording.');
  await page.click('#cancel');
  await page.keyboard.up('Space');
  await status(page, 'Cancelled.');
  await released(page);
  assert.match(await page.locator('#transcript').textContent(), /fellow Americans/);

  await page.evaluate(() => {
    capture.permission = 'deny';
  });
  await page.focus('#record');
  await page.keyboard.down('Enter');
  await status(page, 'MICROPHONE_DENIED');
  await page.keyboard.up('Enter');
  await page.evaluate(() => {
    capture.permission = 'allow';
  });

  // Advance just the page's clock to test the genuine 30-second SDK auto-stop.
  await page.clock.install();
  await page.keyboard.down('Space');
  await status(page, 'Recording.');
  await page.clock.fastForward(30050);
  await status(page, 'Done in');
  await page.keyboard.up('Space');
  await released(page);

  // Navigating away must release active capture and the loaded WASM worker.
  await page.focus('#record');
  await page.keyboard.down('Space');
  await status(page, 'Recording.');
  await page.evaluate(() =>
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await page.keyboard.up('Space');
  await released(page, 0);
  await status(page, 'Ready to load');
  assert.equal(await page.locator('#load').isEnabled(), true);
  await load(page);
  const silence = Buffer.alloc(44 + 32000);
  silence.write('RIFF');
  silence.writeUInt32LE(silence.length - 8, 4);
  silence.write('WAVEfmt ', 8);
  silence.writeUInt32LE(16, 16);
  silence.writeUInt16LE(1, 20);
  silence.writeUInt16LE(1, 22);
  silence.writeUInt32LE(16000, 24);
  silence.writeUInt32LE(32000, 28);
  silence.writeUInt16LE(2, 32);
  silence.writeUInt16LE(16, 34);
  silence.write('data', 36);
  silence.writeUInt32LE(32000, 40);
  await page.setInputFiles('#file', {
    name: 'silence.wav',
    mimeType: 'audio/wav',
    buffer: silence,
  });
  await status(page, 'Done in');
  assert.equal(await page.locator('#language-result').textContent(), 'No speech detected.');
  assert.equal(await page.locator('#transcript').textContent(), '(Silence)');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  await released(page, 0);
  await context.close();

  // Development must work through Vite/React Refresh and StrictMode's effect replay.
  devServer = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await devServer.listen();
  const devUrl = `http://127.0.0.1:${devServer.httpServer.address().port}/`;
  const dev = await openPage(`${devUrl}tests/lifecycle.html`);
  await load(dev.page);
  assert.equal(await dev.page.evaluate(() => capture.requests), 0);
  await dev.page.setInputFiles('#file', fixture);
  await status(dev.page, 'Done in');
  assert.match(await dev.page.locator('#transcript').textContent(), /fellow Americans/);
  await released(dev.page);
  // Trigger a real Refresh boundary without editing source files. State is retained,
  // while effect cleanup must release the model and offer a usable reload button.
  const appModule = devServer.moduleGraph.getModuleById(normalizePath(resolve('src/App.tsx')));
  assert.ok(appModule);
  await devServer.reloadModule(appModule);
  await status(dev.page, 'Ready to load');
  await released(dev.page, 0);
  assert.match(await dev.page.locator('#transcript').textContent(), /fellow Americans/);
  await load(dev.page);
  await dev.page.evaluate(() => {
    capture.permission = 'pending';
  });
  await dev.page.focus('#record');
  await dev.page.keyboard.down('Space');
  await status(dev.page, 'Requesting microphone');
  // Avoid a blur event so cleanup is driven by unmount itself.
  await dev.page.evaluate(() => document.getElementById('unmount').click());
  await dev.page.keyboard.up('Space');
  await dev.page.evaluate(() => {
    capture.grants.shift()();
  });
  await released(dev.page, 0);
  assert.equal(await dev.page.locator('#load').count(), 0);
  await dev.context.close();

  // Use the public hooks directly to exercise behavior the demo UI serializes.
  const hooks = await openPage(`${devUrl}tests/hooks.html`, '#state');
  await hooks.page.waitForFunction(() => hookTest.whistle !== undefined);
  assert.deepEqual(
    await hooks.page.evaluate(() => [capture.workers.size, capture.requests]),
    [0, 0],
  );
  await hooks.page.evaluate(async () => {
    const first = hookTest.whistle.load();
    if (first !== hookTest.whistle.load())
      throw Error('Concurrent loads must share initialization');
    await Promise.all([first, hookTest.second.load()]);
    hookTest.originalTranscribe = hookTest.whistle.transcribe;
    hookTest.render({ assetsUrl: new URL('/whistle/', location.href) });
  });
  // Relative and absolute URLs are different configurations; wait for disposal,
  // then use equivalent absolute URL objects to verify stable render ownership.
  await hooks.page.waitForFunction(() => !hookTest.whistle.ready && capture.workers.size === 1);
  await hooks.page.evaluate(() => hookTest.whistle.load());
  await hooks.page.waitForFunction(() => hookTest.whistle.ready);
  await hooks.page.evaluate(() => {
    hookTest.originalTranscribe = hookTest.whistle.transcribe;
    hookTest.render({ assetsUrl: new URL('/whistle/', location.href) });
  });
  await hooks.page.waitForFunction(
    () => hookTest.whistle.transcribe === hookTest.originalTranscribe && hookTest.whistle.ready,
  );
  await released(hooks.page, 2);
  const queue = await hooks.page.evaluate(async () => {
    const pcm = await hookTest.pcm();
    const order = [];
    const file = hookTest.whistle.transcribeFile(fixtureBlob).then((r) => {
      order.push('file');
      return r;
    });
    const clip = hookTest.whistle.transcribe(pcm).then((r) => {
      order.push('pcm');
      return r;
    });
    pcm.fill(0);
    const [a, b] = await Promise.all([file, clip]);
    return { order, first: a.text, snapshot: b.text, bytes: pcm.byteLength };
  });
  assert.deepEqual(queue.order, ['file', 'pcm']);
  assert.match(queue.first, /fellow Americans/);
  assert.match(queue.snapshot, /fellow Americans/);
  assert.ok(queue.bytes > 0);
  const recovered = await hooks.page.evaluate(async () => {
    const pcm = await hookTest.pcm();
    const active = new AbortController(),
      queued = new AbortController();
    const a = hookTest.whistle.transcribe(pcm, { signal: active.signal }).catch((e) => e.code);
    const b = hookTest.whistle.transcribe(pcm, { signal: queued.signal }).catch((e) => e.code);
    const c = hookTest.whistle.transcribe(pcm);
    queued.abort();
    setTimeout(() => active.abort(), 20);
    return [
      await a,
      await b,
      (await c).text,
      (await hookTest.second.transcribe(new Float32Array(16000))).text,
    ];
  });
  assert.deepEqual(recovered.slice(0, 2), ['ABORTED', 'ABORTED']);
  assert.match(recovered[2], /fellow Americans/);
  assert.equal(recovered[3], '');
  // Config replacement cancels the old recorder, including a late permission grant.
  await hooks.page.evaluate(() => {
    capture.permission = 'pending';
    hookTest.captureResult = hookTest.recorder.start().catch((e) => e.code);
    hookTest.previous = hookTest.whistle;
    hookTest.render({ assetsUrl: '/whistle/', cache: 'none' });
  });
  await hooks.page.waitForFunction(() => !hookTest.whistle.ready && capture.workers.size === 1);
  assert.equal(await hooks.page.evaluate(() => hookTest.captureResult), 'DISPOSED');
  await hooks.page.evaluate(() => {
    capture.grants.shift()();
    capture.permission = 'allow';
  });
  await released(hooks.page, 1);
  assert.equal(
    await hooks.page.evaluate(() =>
      hookTest.previous.transcribe(new Float32Array([0])).catch((e) => e.code),
    ),
    'DISPOSED',
  );
  await hooks.page.evaluate(() => hookTest.whistle.load());
  await hooks.page.waitForFunction(() => hookTest.whistle.ready);
  // Automatic stop uses the recorder's real timer; capture itself is fixture-backed.
  await hooks.page.clock.install();
  await hooks.page.evaluate(() => {
    hookTest.voice = hookTest.recorder.start();
  });
  await hooks.page.waitForFunction(() => hookTest.recorder.status === 'recording');
  await hooks.page.clock.fastForward(12050);
  const voice = await hooks.page.evaluate(() => hookTest.voice);
  assert.match(voice.text, /fellow Americans/);
  await released(hooks.page, 2);
  const unmounted = await hooks.page.evaluate(async () => {
    const a = hookTest.whistle.transcribeFile(fixtureBlob).catch((e) => e.code);
    const b = hookTest.whistle.transcribe(new Float32Array(16000)).catch((e) => e.code);
    hookTest.unmount();
    return Promise.all([a, b]);
  });
  assert.deepEqual(unmounted, ['DISPOSED', 'DISPOSED']);
  await released(hooks.page, 0);
  await hooks.context.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const evidence = {
    browser: `${browserName} ${browser.version()}`,
    production: '/; self-hosted real speech, timestamps, same-file repeat, invalid file',
    language:
      'automatic detection, explicit file/recording hints, result language independent of selection, silence',
    loading: { downloadStatuses, cachedStatuses, cacheMisses },
    capture:
      'fixture only; pointer, keyboard, pending permission, cancellation, denial, 30s auto-stop',
    lifecycle: 'initialization abort/retry, pagehide/reload, track/context/worker cleanup',
    development:
      'StrictMode; real speech; Fast Refresh cleanup/reload; unmount during pending capture',
    publicHooks:
      'independent engines, equivalent options, configuration retirement, file/PCM FIFO, PCM snapshot, active/queued abort and recovery, auto-stop, unmount cleanup',
    externalRequests: external,
    pageErrors: errors,
  };
  await mkdir('.cache', { recursive: true });
  await writeFile(`.cache/${browserName}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
  await devServer?.close();
  await server.close();
}
