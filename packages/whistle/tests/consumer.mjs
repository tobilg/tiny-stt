import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { parseAllDocuments, stringify } from 'yaml';
import { serve } from './server.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const require = createRequire(import.meta.url);
// CI supplies its release artifact; local runs can build one first.
// tests/packed-node.mjs separately covers installation using npm itself.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const usePacked = process.argv.includes('--packed');
const archive = resolve(`tiny-stt-whistle-${version}.tgz`);
const hash = async () =>
  createHash('sha512')
    .update(await readFile(archive))
    .digest('base64');
const before = usePacked ? await hash() : undefined;
const packed = execFileSync(
  npm,
  [
    'pack',
    ...(usePacked ? [archive, '--dry-run', '--ignore-scripts', '--offline'] : []),
    '--json',
    '--cache',
    resolve('.cache/npm'),
  ],
  {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  },
);
const start = packed.indexOf('[\n');
const info = JSON.parse(packed.slice(start))[0];
assert.equal(info.filename, `tiny-stt-whistle-${version}.tgz`);
if (usePacked) assert.equal(await hash(), before, 'CI artifact must not be repacked.');
const reactArchive = resolve(`tiny-stt-react-${version}.tgz`);
const reactHash = async () =>
  createHash('sha512')
    .update(await readFile(reactArchive))
    .digest('base64');
const reactBefore = usePacked ? await reactHash() : undefined;
const reactPacked = execFileSync(
  npm,
  [
    'pack',
    ...(usePacked
      ? [reactArchive, '--dry-run', '--ignore-scripts', '--offline']
      : ['../react', '--pack-destination', '.']),
    '--json',
    '--cache',
    resolve('.cache/npm'),
  ],
  { encoding: 'utf8', shell: process.platform === 'win32' },
);
const [reactInfo] = JSON.parse(reactPacked.slice(reactPacked.indexOf('[\n')));
assert.equal(reactInfo.name, '@tiny-stt/react');
assert.equal(reactInfo.version, version);
if (usePacked) assert.equal(await reactHash(), reactBefore, 'React artifact must not be repacked.');
const reactFiles = reactInfo.files.map((file) => file.path);
for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/types.d.ts', 'LICENSE', 'README.md'])
  assert.ok(reactFiles.includes(file));
assert.ok(
  !reactFiles.some((file) => /\.(cact|wasm|wav)$|(^|\/)(tests|node_modules|vendor)\//.test(file)),
);
const files = info.files.map((f) => f.path);
for (const f of [
  'dist/assets/browser-worker.js',
  'dist/assets/node-worker.js',
  'dist/assets/needle.js',
  'dist/assets/needle.wasm',
  'dist/browser.d.ts',
  'dist/node.d.ts',
  'dist/audio.d.ts',
  'dist/microphone.d.ts',
  'dist/cli.js',
  'asset-lock.json',
  'LICENSE',
  'NOTICE',
  'vendor/upstream/NEEDLE-LICENSE',
  'vendor/upstream/WHISTLE-LICENSE',
])
  assert.ok(files.includes(f), f);
assert.ok(
  !files.some((f) =>
    /\.cact$|\.wav$|\.flac$|(^|\/)(\.cache|tests|docs|examples|node_modules)\//.test(f),
  ),
);
assert.ok(!JSON.parse(await readFile('package.json', 'utf8')).scripts.postinstall);
const consumer = await mkdtemp(join(tmpdir(), 'whistle consumer '));
const browser = await chromium.launch({ headless: true });
let server, plainServer;
try {
  await cp('../demo', consumer, {
    recursive: true,
    filter: (path) =>
      !/(^|[/\\])(node_modules|dist|tests|\.cache)([/\\]|$)/.test(path) &&
      !/[/\\]public[/\\]whistle([/\\]|$)/.test(path),
  });
  const demo = JSON.parse(await readFile('../demo/package.json', 'utf8'));
  const manifest = {
    ...demo,
    name: 'packed-whistle-consumer',
    dependencies: {
      ...demo.dependencies,
      '@tiny-stt/whistle': 'file:sdk.tgz',
      '@tiny-stt/react': 'file:react.tgz',
    },
  };
  await writeFile(join(consumer, 'package.json'), JSON.stringify(manifest));
  await cp(archive, join(consumer, 'sdk.tgz'));
  await cp(reactArchive, join(consumer, 'react.tgz'));
  // Frozen workspace installs need no registry metadata. Reuse their dependency
  // graph, replacing the SDK and React links with the tarballs under test. pnpm 12 has
  // separate YAML documents for its package manager and application dependencies.
  const documents = parseAllDocuments(await readFile('../../pnpm-lock.yaml', 'utf8'));
  for (const document of documents) assert.deepEqual(document.errors, []);
  const lock = documents
    .map((document) => document.toJSON())
    .find((doc) => doc.importers?.['packages/demo']);
  assert.ok(lock, 'Missing demo importer in workspace lockfile.');
  const importer = lock.importers['packages/demo'];
  importer.dependencies['@tiny-stt/whistle'] = {
    specifier: 'file:sdk.tgz',
    version: 'file:sdk.tgz',
  };
  const reactVersion = 'file:react.tgz(@tiny-stt/whistle@file:sdk.tgz)(react@19.3.0)';
  importer.dependencies['@tiny-stt/react'] = { specifier: 'file:react.tgz', version: reactVersion };
  lock.packages['@tiny-stt/react@file:react.tgz'] = {
    resolution: { integrity: `sha512-${await reactHash()}`, tarball: 'file:react.tgz' },
    version,
    peerDependencies: { '@tiny-stt/whistle': `^${version}`, react: '^19.0.0' },
  };
  lock.snapshots[`@tiny-stt/react@${reactVersion}`] = {
    dependencies: { '@tiny-stt/whistle': 'file:sdk.tgz', react: '19.3.0' },
  };
  lock.importers = { '.': importer };
  lock.packages['@tiny-stt/whistle@file:sdk.tgz'] = {
    resolution: { integrity: `sha512-${await hash()}`, tarball: 'file:sdk.tgz' },
    version,
    engines: { node: '>=22' },
    hasBin: true,
  };
  lock.snapshots['@tiny-stt/whistle@file:sdk.tgz'] = {};
  await writeFile(join(consumer, 'pnpm-lock.yaml'), stringify(lock));
  // pnpm 12 configures its metadata cache through workspace YAML, not --cache-dir.
  // The workspace install already verified these locked versions against registry
  // policy. This isolated OFFLINE install trusts that graph and its checksums;
  // it cannot resolve or download anything new. Keep normal workspace CI checks on.
  await writeFile(
    join(consumer, 'pnpm-workspace.yaml'),
    `packages: []\ntrustLockfile: true\nstoreDir: ${JSON.stringify(resolve('../../.cache/pnpm-store'))}\ncacheDir: ${JSON.stringify(join(consumer, 'empty-metadata-cache'))}\n`,
  );
  execFileSync(pnpm, ['install', '--frozen-lockfile', '--offline', '--ignore-scripts'], {
    cwd: consumer,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  await writeFile(
    join(consumer, 'types.ts'),
    `import {createWhistle,WhistleError,type WhistleTranscript} from '@tiny-stt/whistle';import {createWhistle as node} from '@tiny-stt/whistle/node';import {decodeAudio} from '@tiny-stt/whistle/audio';import {startRecording} from '@tiny-stt/whistle/microphone';const w=await node({assetsPath:'.'});const result:WhistleTranscript=await w.transcribe(new Float32Array([0]),{language:'en',wordTimestamps:true});await w.dispose();void [createWhistle,WhistleError,decodeAudio,startRecording,result];import {useWhistle,useWhistleRecorder,type UseWhistleReturn,type UseWhistleRecorderReturn} from '@tiny-stt/react';const hook:()=>UseWhistleReturn=useWhistle;const recorder:(w:UseWhistleReturn)=>UseWhistleRecorderReturn=useWhistleRecorder;void [hook,recorder];`,
  );
  await writeFile(
    join(consumer, 'tsconfig.consumer.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2022', 'DOM'],
        types: [],
        strict: true,
        noEmit: true,
      },
      files: ['types.ts'],
    }),
  );
  execFileSync(
    process.execPath,
    [
      join(require.resolve('typescript/package.json'), '../bin/tsc'),
      '-p',
      join(consumer, 'tsconfig.consumer.json'),
    ],
    { cwd: consumer, stdio: 'pipe' },
  );
  await cp('../documentation/examples/node', join(consumer, 'node-example'), { recursive: true });
  await cp('tests/fixtures/jfk.wav', join(consumer, 'jfk.wav'));
  await mkdir(join(consumer, 'public/whistle'), { recursive: true });
  await cp('.cache/assets/whistle.cact', join(consumer, 'public/whistle/whistle.cact'));
  const cli = join(consumer, 'node_modules/@tiny-stt/whistle/dist/cli.js');
  execFileSync(
    process.execPath,
    [
      '--import',
      resolve('tests/deny-network.mjs'),
      cli,
      'download',
      '--offline',
      '--out',
      join(consumer, 'public/whistle'),
    ],
    { stdio: 'pipe' },
  );
  const node = spawnSync(
    process.execPath,
    [
      '--import',
      resolve('tests/deny-network.mjs'),
      join(consumer, 'node-example/transcribe.mjs'),
      join(consumer, 'public/whistle'),
      join(consumer, 'jfk.wav'),
    ],
    { cwd: tmpdir(), encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(node.status, 0, node.stderr);
  assert.match(JSON.parse(node.stdout).text, /fellow Americans/);
  await writeFile(
    join(consumer, 'smoke.js'),
    `import {createWhistle} from '@tiny-stt/whistle'; globalThis.bundledSmoke=async()=>{const w=await createWhistle({modelUrl:new URL('./whistle/whistle.cact',document.baseURI),cache:'none'});try{return await w.transcribe(new Float32Array(16000));}finally{await w.dispose();}};`,
  );
  await writeFile(
    join(consumer, 'src/main.tsx'),
    `${await readFile(join(consumer, 'src/main.tsx'), 'utf8')}\nimport '../smoke.js';\n`,
  );
  const consumerRequire = createRequire(join(consumer, 'package.json'));
  // The public adapter must resolve through the installed tarball and render on
  // the server without browser globals, model loading, or duplicate React copies.
  await writeFile(
    join(consumer, 'ssr.mjs'),
    `import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToString} from 'react-dom/server';import {useWhistle,useWhistleRecorder} from '@tiny-stt/react';function Example(){const w=useWhistle();const r=useWhistleRecorder(w);return createElement('p',null,w.status+'/'+r.status);}assert.equal(renderToString(createElement(Example)),'<p>idle/idle</p>');`,
  );
  execFileSync(
    process.execPath,
    ['--import', resolve('tests/deny-network.mjs'), join(consumer, 'ssr.mjs')],
    { cwd: consumer, stdio: 'pipe' },
  );
  assert.match(
    await readFile(join(consumer, 'node_modules/@tiny-stt/react/dist/index.js'), 'utf8'),
    /['"]use client['"];/,
  );
  const core = JSON.parse(
    await readFile(join(consumer, 'node_modules/@tiny-stt/whistle/package.json'), 'utf8'),
  );
  assert.ok(!core.peerDependencies && !core.exports['./react']);

  // Exercise a non-root deployment without changing the demo's default build.
  execFileSync(
    process.execPath,
    [
      join(consumerRequire.resolve('vite/package.json'), '../bin/vite.js'),
      'build',
      '--base',
      '/demo/',
    ],
    { cwd: consumer, stdio: 'pipe' },
  );
  server = await serve(join(consumer, 'dist'), { base: '/demo/', csp: true });
  const context = await browser.newContext();
  const external = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== new URL(server.url).origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.click('#load');
  await page.waitForFunction(
    () => document.getElementById('status').textContent.startsWith('Model ready'),
    {},
    { timeout: 30000 },
  );
  await page.check('#timestamps');
  await page.setInputFiles('#file', resolve('tests/fixtures/jfk.wav'));
  await page.waitForFunction(
    () => document.getElementById('transcript').textContent.includes('fellow Americans'),
    {},
    { timeout: 30000 },
  );
  assert.match(await page.locator('#words').textContent(), /probability/);
  assert.equal((await page.evaluate(() => globalThis.bundledSmoke())).text, '');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await context.close();
  // Plain browser ESM from the installed package, without Vite.
  await writeFile(join(consumer, 'plain.html'), '<!doctype html><title>Plain packed ESM</title>');
  plainServer = await serve(consumer, { csp: true });
  const plain = await browser.newPage();
  await plain.goto(`${plainServer.url}plain.html`);
  const plainResult = await plain.evaluate(async () => {
    const { createWhistle } = await import('/node_modules/@tiny-stt/whistle/dist/browser.js');
    const w = await createWhistle({ assetsUrl: '/public/whistle/' });
    try {
      return await w.transcribe(new Float32Array(16000));
    } finally {
      await w.dispose();
    }
  });
  assert.equal(plainResult.text, '');
  await plain.close();
  console.log(
    JSON.stringify(
      {
        tarball: info.filename,
        reactTarball: reactInfo.filename,
        reactPackedBytes: reactInfo.size,
        reactFiles: reactFiles.length,
        reactSSR: 'passed with networking denied',
        packedBytes: info.size,
        unpackedBytes: info.unpackedSize,
        fileCount: files.length,
        consumer,
        node: 'real speech with networking denied; installed CLI --offline',
        browser:
          'React demo installed offline from tarball; production Vite /demo/ self-hosted real speech; default bundled worker/WASM mirror; plain ESM',
        externalRequests: external,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server?.close();
  await plainServer?.close();
  await rm(consumer, { recursive: true, force: true });
}
