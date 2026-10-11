import type { Whistle } from '@tiny-stt/whistle';
import { WhistleError } from '@tiny-stt/whistle';
import { startRecording } from '@tiny-stt/whistle/microphone';

/** Invoke from a user action; the application owns and later disposes the supplied engine. */
export async function beginPushToTalk(whistle: Whistle) {
  const controller = new AbortController();
  const recording = await startRecording({ maxDurationSeconds: 10, signal: controller.signal });
  // Observe result immediately, so auto-stop and cancellation are both handled.
  const completed = recording.result
    .then((pcm) => whistle.transcribe(pcm, { signal: controller.signal }))
    .catch((error: unknown) => {
      if (error instanceof WhistleError && error.code === 'ABORTED') return null;
      throw error;
    });
  return {
    completed, // Observe this promise for transcript output and non-cancellation errors.
    stop: () => recording.stop(), // Bind to pointer/key release; repeated stop is harmless.
    cancel: () => controller.abort(), // Cancels capture, decoding or active transcription.
  };
}
