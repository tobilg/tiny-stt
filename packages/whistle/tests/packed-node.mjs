import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = resolve(process.argv[2] ?? '.'),
  consumer = await mkdtemp(join(tmpdir(), 'whistle packed '));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const { version } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
try {
  await writeFile(
    join(consumer, 'package.json'),
    '{"name":"whistle-clean-consumer","private":true,"type":"module"}',
  );
  execFileSync(
    npm,
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(source, `tiny-stt-whistle-${version}.tgz`),
    ],
    {
      cwd: consumer,
      stdio: 'pipe',
      shell: process.platform === 'win32',
      env: { ...process.env, npm_config_cache: join(consumer, 'npm-cache') },
    },
  );
  const installed = JSON.parse(
    await readFile(join(consumer, 'node_modules/@tiny-stt/whistle/package.json'), 'utf8'),
  );
  assert.ok(
    !installed.peerDependencies && !installed.dependencies && !installed.exports['./react'],
  );
  await assert.rejects(readFile(join(consumer, 'node_modules/react/package.json')), {
    code: 'ENOENT',
  });
  await mkdir(join(consumer, 'local assets'));
  await cp(join(source, '.cache/assets/whistle.cact'), join(consumer, 'local assets/whistle.cact'));
  await cp(join(source, 'tests/fixtures/jfk.wav'), join(consumer, 'jfk.wav'));
  await cp(join(source, '../documentation/examples/node/wav.mjs'), join(consumer, 'wav.mjs'));
  const cli = join(consumer, 'node_modules/@tiny-stt/whistle/dist/cli.js');
  execFileSync(process.execPath, [cli, 'download', '--offline', '--out', 'local assets'], {
    cwd: consumer,
    stdio: 'pipe',
  });
  await writeFile(
    join(consumer, 'check.mjs'),
    `import assert from 'node:assert/strict';import {createWhistle} from '@tiny-stt/whistle/node';import {readWav} from './wav.mjs';
const w=await createWhistle({assetsPath:new URL('./local assets/',import.meta.url)});try{const pcm=readWav(new URL('./jfk.wav',import.meta.url));for(let i=0;i<3;i++)assert.match((await w.transcribe(pcm,{wordTimestamps:true})).text,/ask not what your country/);const ac=new AbortController();const a=w.transcribe(pcm,{signal:ac.signal}),b=w.transcribe(pcm);const rejected=assert.rejects(a,{code:'ABORTED'});setTimeout(()=>ac.abort(),25);await rejected;assert.ok((await b).text);console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,packedInference:'passed',repeatedCalls:3,cancellationRecovery:'passed'}));}finally{await w.dispose();}`,
  );
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(join(source, 'tests/deny-network.mjs')).href,
      join(consumer, 'check.mjs'),
    ],
    { cwd: tmpdir(), encoding: 'utf8', timeout: 30000 },
  );
  assert.match(output, /passed/);
  console.log(output.trim());
} finally {
  await rm(consumer, { recursive: true, force: true });
}
