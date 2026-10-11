import { createWhistle } from '@tiny-stt/whistle';
import { decodeAudio } from '@tiny-stt/whistle/audio';

/** Transcribe an application-selected file using a complete self-hosted asset directory. */
export async function transcribeFile(file: File, assetsUrl: string | URL, signal?: AbortSignal) {
  const whistle = await createWhistle({ assetsUrl, signal });
  try {
    const pcm = await decodeAudio(file, { signal });
    return await whistle.transcribe(pcm, { signal, wordTimestamps: true });
  } finally {
    await whistle.dispose();
  }
}
