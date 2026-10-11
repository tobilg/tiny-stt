import { createWhistle } from '@tiny-stt/whistle/node';
import { readWav } from './wav.mjs';

const [assetsPath, file] = process.argv.slice(2);
if (!assetsPath || !file) {
  console.error('Usage: node transcribe.mjs <assets-directory> <mono-16k-pcm16.wav>');
  process.exitCode = 2;
} else {
  const whistle = await createWhistle({ assetsPath });
  try {
    console.log(
      JSON.stringify(await whistle.transcribe(readWav(file), { wordTimestamps: true }), null, 2),
    );
  } finally {
    await whistle.dispose();
  }
}
