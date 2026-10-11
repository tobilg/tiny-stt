/**
 * Optional browser decoding helpers; imports never open an audio context.
 * @module @tiny-stt/whistle/audio
 * @group API
 */
import { aborted, checkAbort, validateSignal, WhistleError } from './errors.js';
import { validateAudio } from './validation.js';

export { WhistleError } from './errors.js';
/**
 * Decode a completed audio File/Blob into 16 kHz mono PCM for transcription.
 *
 * @param input - Nonempty encoded audio; supported codecs depend on the browser.
 * @param options - Optional cancellation for decoding and rendering.
 * @returns Newly owned finite PCM samples in [-1, 1], at most 480,000 samples.
 * @throws {@link WhistleError} with AUDIO_DECODE_FAILED for invalid/unsupported input,
 * AUDIO_TOO_LONG for files over 30 seconds, ABORTED on cancellation, or
 * UNSUPPORTED_ENVIRONMENT when Web Audio is unavailable.
 * @remarks Web Audio decodes at 16 kHz independently of the output device's rate,
 * then channels are averaged equally. This function
 * never truncates long files. Cancellation closes the live context promptly and discards
 * late output; a bounded offline render may finish before its source can be disconnected.
 * @example
 * ```ts
 * import { decodeAudio } from '@tiny-stt/whistle/audio';
 * async function decodeSelection(file: File) {
 *   return decodeAudio(file);
 * }
 * ```
 */
export async function decodeAudio(
  input: Blob,
  options: { /** Cancel and discard pending decoding output. */ signal?: AbortSignal } = {},
): Promise<Float32Array> {
  return decodeClip(input, options);
}
/**
 * Decode audio with the recorder's optional explicit capture-duration bound.
 *
 * @param input - Nonempty encoded audio captured by MediaRecorder or selected as a file.
 * @param options - Cancellation options shared with {@link decodeAudio}.
 * @param captureLimit - Internal recording limit in seconds, validated by startRecording
 * to be greater than zero and at most 30. Omit this for ordinary file decoding.
 * @returns Newly owned 16 kHz mono PCM with only an explicitly bounded capture tail discarded.
 * @throws {@link WhistleError} for decoding, duration, validation or cancellation failures.
 * @remarks This low-level export supports the microphone helper. Applications should use
 * decodeAudio for files and startRecording for capture; it is not a general clip editor.
 */
export async function decodeClip(
  input: Blob,
  options: { /** Cancel and discard pending decoding output. */ signal?: AbortSignal } = {},
  captureLimit?: number,
): Promise<Float32Array> {
  if (!options || typeof options !== 'object')
    throw new WhistleError('INVALID_OPTIONS', 'Expected decode options.');
  validateSignal(options.signal);
  checkAbort(options.signal);
  if (typeof Blob === 'undefined' || !(input instanceof Blob) || !input.size)
    throw new WhistleError('AUDIO_DECODE_FAILED', 'Expected a nonempty audio Blob or File.');
  if (typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined')
    throw new WhistleError('UNSUPPORTED_ENVIRONMENT', 'Browser Web Audio decoding is unavailable.');
  let context: AudioContext;
  try {
    // decodeAudioData resamples to the context's rate. Avoid converting through
    // a device-dependent intermediate rate (for example 48 kHz -> 44.1 kHz -> 16 kHz).
    context = new AudioContext({ sampleRate: 16000 });
  } catch (cause) {
    throw new WhistleError('UNSUPPORTED_ENVIRONMENT', 'Cannot create a browser AudioContext.', {
      cause,
    });
  }
  let cancel!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => {
      void context.close().catch(() => {});
      reject(aborted());
    };
  });
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await Promise.race([
      cancelled,
      (async () => {
        const buffer = await context.decodeAudioData(await input.arrayBuffer());
        checkAbort(options.signal);
        if (!buffer.length || !buffer.numberOfChannels)
          throw new WhistleError('AUDIO_DECODE_FAILED', 'Decoded audio is empty.');
        if (captureLimit === undefined && buffer.duration > 30)
          throw new WhistleError('AUDIO_TOO_LONG', 'Decoded file exceeds 30 seconds.');
        const duration = Math.min(buffer.duration, captureLimit ?? 30);
        // Decoding already produced 16 kHz frames. Preserve their integer count;
        // duration -> samples floating-point round trips can lose another frame.
        const length = Math.min(buffer.length, Math.floor((captureLimit ?? 30) * 16000));
        if (!length) throw new WhistleError('AUDIO_DECODE_FAILED', 'Decoded audio is too short.');
        // Equal-weight downmix of every channel, independent of speaker layout.
        const mono = context.createBuffer(
          1,
          Math.min(buffer.length, Math.ceil(duration * buffer.sampleRate)),
          buffer.sampleRate,
        );
        const mixed = mono.getChannelData(0);
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const channel = buffer.getChannelData(c);
          for (let i = 0; i < mixed.length; i++) mixed[i] += channel[i] / buffer.numberOfChannels;
        }
        const offline = new OfflineAudioContext(1, length, 16000);
        const source = offline.createBufferSource();
        source.buffer = mono;
        source.connect(offline.destination);
        source.start();
        try {
          const rendered = await offline.startRendering();
          checkAbort(options.signal);
          const pcm = new Float32Array(rendered.getChannelData(0));
          // Resampling filters can overshoot valid decoded peaks slightly.
          for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]));
          validateAudio(pcm);
          return pcm;
        } finally {
          source.disconnect();
        }
      })(),
    ]);
  } catch (cause) {
    if (cause instanceof WhistleError) throw cause;
    throw new WhistleError('AUDIO_DECODE_FAILED', 'Browser could not decode this audio file.', {
      cause,
    });
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    await context.close().catch(() => {});
  }
}
