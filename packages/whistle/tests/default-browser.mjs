// Connected acquisition gate: only the exact pinned model and its HTTP redirect chain.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serve } from './server.mjs';

const lock = JSON.parse(await readFile('asset-lock.json', 'utf8')),
  server = await serve(),
  browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(),
    external = [];
  await context.route('**/*', (route) => {
    const request = route.request();
    if (new URL(request.url()).origin === new URL(server.url).origin) return route.continue();
    let first = request;
    while (first.redirectedFrom()) first = first.redirectedFrom();
    assert.equal(first.url(), lock.files.model.url);
    external.push(new URL(request.url()).origin);
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${server.url}tests/`);
  const result = await page.evaluate(async () => {
    const { createWhistle } = await import('/dist/browser.js');
    const { decodeAudio } = await import('/dist/audio.js');
    const pcm = await decodeAudio(await (await fetch('/tests/fixtures/jfk.wav')).blob());
    const start = performance.now();
    const w = await createWhistle({ cache: 'none' });
    try {
      return {
        coldMs: performance.now() - start,
        result: await w.transcribe(pcm, { wordTimestamps: true }),
      };
    } finally {
      await w.dispose();
    }
  });
  assert.match(result.result.text, /ask not what your country/);
  assert.ok(external.length);
  console.log(
    JSON.stringify({
      browser: await browser.version(),
      modelUrl: lock.files.model.url,
      externalOrigins: [...new Set(external)],
      coldMs: result.coldMs,
      serviceMs: result.result.timings.totalMs,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
