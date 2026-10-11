import { createWhistle } from '@tiny-stt/whistle/node';

/** Call with decoded 16 kHz mono PCM and assets prepared before networking is disabled. */
export async function transcribeLocally(pcm: Float32Array, assetsPath: string | URL) {
  const whistle = await createWhistle({ assetsPath });
  try {
    return await whistle.transcribe(pcm, { wordTimestamps: true });
  } finally {
    await whistle.dispose();
  }
}
