import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../../whistle/tests/server.mjs';

// Check the exact directory uploaded by CI, including Pages' per-file limit.
const output = resolve('dist');
let fileCount = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(file);
    else {
      fileCount++;
      assert.ok(
        (await stat(file)).size <= 25 * 1024 * 1024,
        `Exceeds Pages' 25 MiB limit: ${file}`,
      );
      assert.ok(!/\.(?:wav|flac|tgz)$/.test(file), `Unexpected test artifact: ${file}`);
    }
  }
}
await inspect(output);
assert.ok(fileCount < 20000);
const manifest = JSON.parse(await readFile(join(output, 'whistle/manifest.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(join(output, 'whistle', name));
  assert.equal(bytes.length, expected.bytes, name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
}
assert.ok((await readFile(join(output, 'REACT-LICENSE'), 'utf8')).includes('MIT License'));

const server = await serve(output, { csp: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const failures = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== new URL(server.url).origin) {
      failures.push(`External request: ${route.request().url()}`);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  // File-only smoke check: requesting a physical microphone is a test failure.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new Error('This test must not access microphone hardware.');
    };
  });
  await page.goto(server.url);
  await page.click('#load');
  await page.waitForFunction(
    () => document.getElementById('status').textContent.startsWith('Model ready'),
    null,
    { timeout: 30000 },
  );
  await page.check('#timestamps');
  await page.setInputFiles('#file', resolve('../whistle/tests/fixtures/jfk.wav'));
  await page.waitForFunction(
    () => document.getElementById('status').textContent.startsWith('Done in'),
    null,
    { timeout: 30000 },
  );
  assert.match(await page.locator('#transcript').textContent(), /fellow Americans/);
  assert.equal(await page.locator('#language-result').textContent(), 'Detected language: English');
  const words = JSON.parse(await page.locator('#words').textContent());
  assert.ok(words.length > 10);
  assert.ok(words.every((word) => word.start >= 0 && word.end >= word.start && word.end <= 11));
  for (const name of [
    'manifest.json',
    'browser-worker.js',
    'needle.js',
    'needle.wasm',
    'whistle.cact',
  ]) {
    assert.ok(server.requests.includes(`/whistle/${name}`), `Missing self-hosted request: ${name}`);
  }
  assert.ok(server.requests.every((path) => !path.startsWith('/demo/')));
  assert.deepEqual(failures, []);
  const report = {
    base: '/',
    files: fileCount,
    browser: browser.version(),
    realSpeech: 'passed',
    timestamps: 'passed',
    integrity: 'passed',
    externalRequests: 0,
    csp: 'passed',
  };
  await mkdir('.cache', { recursive: true });
  await writeFile('.cache/build.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
