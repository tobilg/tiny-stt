import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
const prefix = process.argv.includes('--root') ? '/' : '/api/';
const localOrigin = 'http://localhost';
const pages = new Map();
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (file.endsWith('.html')) pages.set(file, await readFile(file, 'utf8'));
    assert.ok(!/\.(?:wasm|cact|wav|tgz)$/.test(file), `Unexpected inference asset: ${file}`);
  }
}
await collect(output);
const routes = [
  '_tiny-stt/whistle',
  '_tiny-stt/whistle/createWhistle',
  '_tiny-stt/whistle/Whistle',
  '_tiny-stt/whistle/WhistleTranscript',
  '_tiny-stt/whistle/WhistleWord',
  '_tiny-stt/whistle/WhistleError',
  '_tiny-stt/whistle/node/createWhistle',
  '_tiny-stt/whistle/audio/decodeAudio',
  '_tiny-stt/whistle/microphone/startRecording',
  '_tiny-stt/whistle/microphone/Recording',
  '_tiny-stt/react/useWhistle',
  '_tiny-stt/react/useWhistleRecorder',
  '_tiny-stt/react/UseWhistleReturn',
];
for (const route of routes) assert.ok(pages.has(join(output, route, 'index.html')), route);
assert.ok(pages.get(join(output, 'index.html')).includes('Getting started'));

const decodeAttribute = (text) => text.replaceAll('&amp;', '&').replaceAll('&quot;', '"');
async function targetFor(url) {
  assert.ok(url.pathname.startsWith(prefix), `Link escapes ${prefix}: ${url}`);
  let file = resolve(output, decodeURIComponent(url.pathname.slice(prefix.length)));
  assert.ok(file.startsWith(`${output}${sep}`) || file === output, `Invalid path: ${url}`);
  if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  assert.ok((await stat(file)).isFile(), `Missing file: ${url}`);
  return file;
}
let links = 0;
const sources = new Set();
for (const [file, html] of pages) {
  assert.ok(!html.includes('{@include'), `Unexpanded guide include: ${file}`);
  const url = new URL(`${prefix}${relative(output, file).split(sep).join('/')}`, localOrigin);
  for (const [, raw] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const link = new URL(decodeAttribute(raw), url);
    if (link.origin !== localOrigin) {
      if (/\/blob\/main\/packages\/(whistle|react)\/src\//.test(link.href)) sources.add(link.href);
      continue;
    }
    const target = await targetFor(link);
    if (link.hash && pages.has(target)) {
      assert.ok(
        pages.get(target).includes(`id="${decodeURIComponent(link.hash.slice(1))}"`),
        `Broken anchor ${link} from ${file}`,
      );
    }
    links++;
  }
}
for (const file of [
  'browser.ts',
  'node.ts',
  'audio.ts',
  'microphone.ts',
  'types.ts',
  'errors.ts',
  'index.ts',
]) {
  assert.ok(
    [...sources].some((url) => url.includes(`/${file}#L`)),
    `Missing source links: ${file}`,
  );
}

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const server = createServer(async (request, response) => {
  try {
    const file = await targetFor(new URL(request.url, localOrigin));
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end('Not found');
  }
});
let browser;
try {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = `${origin}${prefix}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const failures = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== origin) {
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
  await page.goto(base);
  await page.getByRole('heading', { level: 1, name: 'Whistle API', exact: true }).waitFor();
  assert.equal(await page.locator('.col-content h1').count(), 1);
  await page
    .locator('.col-content')
    .getByRole('link', { name: 'Getting started', exact: true })
    .first()
    .click();
  assert.match(await page.locator('.col-content').innerText(), /pnpm assets:prepare/);
  await page.goto(`${base}Browser_files_and_recording/`);
  assert.match(await page.locator('pre').first().innerText(), /async function transcribeFile/);
  await page.goto(`${base}Node_and_local_assets/`);
  assert.match(await page.locator('.col-content').innerText(), /Usage: node transcribe.mjs/);
  await page.goto(`${base}Compatibility_and_licensing/`);
  await page.getByRole('heading', { name: /^Acceptance criteria/ }).waitFor();
  const evidenceUrl = await page
    .getByRole('link', { name: 'evidence.json', exact: true })
    .getAttribute('href');
  const evidence = await page.request.get(new URL(evidenceUrl, page.url()).href);
  assert.equal(evidence.status(), 200);
  assert.deepEqual(
    await evidence.json(),
    JSON.parse(await readFile(join(root, 'evidence.json'), 'utf8')),
  );
  await page.locator('#tsd-search-trigger').click();
  await page.locator('#tsd-search-input').fill('WhistleTranscript');
  const hit = page
    .locator('#tsd-search-results a')
    .filter({ hasText: 'WhistleTranscript' })
    .first();
  await hit.waitFor();
  await hit.click();
  assert.match(page.url(), /WhistleTranscript/);
  await page.locator('#timings').waitFor({ state: 'attached' });
  for (const route of routes) {
    await page.goto(`${base}${route}/`);
    await page.locator('.col-content h1').waitFor();
  }
  assert.deepEqual(
    failures,
    [],
    'Documentation must work without external requests or browser errors',
  );
  const report = {
    pages: pages.size,
    checkedLinks: links,
    sourceLinks: sources.size,
    browser: browser.version(),
    base: prefix,
    navigation: 'passed',
    search: 'passed',
    embeddedExamples: 'passed',
    externalRequests: 0,
  };
  await mkdir(join(root, '.cache'), { recursive: true });
  await writeFile(join(root, '.cache/validation.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
}
