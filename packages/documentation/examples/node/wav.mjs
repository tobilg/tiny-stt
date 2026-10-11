import { readFileSync } from 'node:fs';
export function readWav(path) {
  const wav = readFileSync(path);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw Error('Expected WAV');
  let fmt, data;
  for (let o = 12; o + 8 <= wav.length; ) {
    const size = wav.readUInt32LE(o + 4),
      id = wav.toString('ascii', o, o + 4);
    if (o + 8 + size > wav.length) throw Error('Truncated WAV');
    if (id === 'fmt ') fmt = wav.subarray(o + 8, o + 8 + size);
    if (id === 'data') data = wav.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  if (
    fmt?.readUInt16LE(0) !== 1 ||
    fmt.readUInt16LE(2) !== 1 ||
    fmt.readUInt32LE(4) !== 16000 ||
    fmt.readUInt16LE(14) !== 16 ||
    !data ||
    data.length % 2
  )
    throw Error('Example accepts only mono 16 kHz PCM16 WAV');
  const pcm = new Float32Array(data.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2) / 32768;
  return pcm;
}
