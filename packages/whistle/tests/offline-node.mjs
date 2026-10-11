import assert from 'node:assert/strict';
import { createWhistle } from '../dist/node.js';
import { readWav } from './helpers.mjs';

const w = await createWhistle({ assetsPath: process.env.WHISTLE_ASSETS ?? '.cache/assets' });
try {
  const pcm = readWav();
  for (let i = 0; i < 2; i++) assert.match((await w.transcribe(pcm)).text, /your country/i);
  const controller = new AbortController();
  const a = w.transcribe(pcm, { signal: controller.signal }),
    b = w.transcribe(pcm);
  const rejected = assert.rejects(a, { code: 'ABORTED' });
  setTimeout(() => controller.abort(), 30);
  await rejected;
  assert.ok((await b).text);
  console.log('OFFLINE_OK');
} finally {
  await w.dispose();
}
