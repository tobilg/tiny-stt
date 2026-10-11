// Low-level, reproducible evidence for the pinned binary. Not the public API.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import create from '../vendor/needle.js';
import { readWav } from './helpers.mjs';

const e = await create({ wasmBinary: await readFile('vendor/upstream/needle.wasm') });
const p = e._malloc(480000 * 4),
  out = e._malloc(1024 * 1024);
assert.ok(p && out);
const unloadedStatus = e._needle_transcribe(p, 16000, 0, 0, 0, out, 1024 * 1024);
assert.equal(unloadedStatus, -1);
const unloadedError = e.UTF8ToString(e._needle_last_error());
assert.match(unloadedError, /no speech model/);
assert.equal(e._needle_load(p, 1n), -1);
assert.match(e.UTF8ToString(e._needle_last_error()), /invalid .cact/);
const model = await readFile('.cache/assets/whistle.cact');
const mp = e._malloc(model.length);
assert.ok(mp);
e.HEAPU8.set(model, mp);
assert.throws(() => e._needle_load(mp, model.length), TypeError);
assert.equal(e._needle_load(mp, BigInt(model.length)), 0);
assert.equal(e._needle_models(), 2);
const pcm = readWav();
new Float32Array(e.HEAPU8.buffer, p, pcm.length).set(pcm);
e.HEAPU8.fill(255, out, out + 32);
const overflow = e._needle_transcribe(p, pcm.length, 0, 0, 1, out, 32);
assert.ok(overflow >= 0);
assert.equal(e.HEAPU8[out + 31], 0);
assert.throws(() => JSON.parse(e.UTF8ToString(out)));
const heaps = [];
for (let i = 0; i < 10; i++) {
  assert.ok(e._needle_transcribe(p, pcm.length, 0, 0, 1, out, 1024 * 1024) >= 0);
  assert.match(JSON.parse(e.UTF8ToString(out)).text, /fellow Americans/);
  heaps.push(e.HEAPU8.byteLength);
}
assert.equal(new Set(heaps.slice(2)).size, 1);
for (const samples of [1, 480000]) {
  new Float32Array(e.HEAPU8.buffer, p, samples).fill(0);
  assert.ok(e._needle_transcribe(p, samples, 0, 0, 1, out, 1024 * 1024) >= 0);
  assert.equal(JSON.parse(e.UTF8ToString(out)).text, '');
}
console.log(
  JSON.stringify({
    numberModelLength: 'TypeError',
    loadStatus: 0,
    models: 2,
    overflowStatus: overflow,
    overflowNulIndex: 31,
    unloadedStatus,
    unloadedError,
    heapBytes: heaps,
    modelLifetime: 'retained until worker exit; ownership not documented by upstream',
  }),
);
e._free(p);
e._free(out);
e._free(mp);
