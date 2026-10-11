import { type TranscribeOptions, WhistleError } from '@tiny-stt/whistle';
// Validate before queueing/capture and snapshot hints. Keep these input checks aligned
// with the SDK contract; the SDK independently validates every inference request.
/** Model-supported language codes used by option and result validation. */
export const languages = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl'];
/** Enforce Float32 PCM shape, 30-second duration and finite normalized samples without changing input. */
export function validateAudio(audio: Float32Array): void {
  if (!(audio instanceof Float32Array) || !audio.length)
    throw new WhistleError('INVALID_AUDIO', 'Expected nonempty Float32Array mono 16 kHz PCM.');
  if (audio.length > 480000)
    throw new WhistleError(
      'AUDIO_TOO_LONG',
      'Audio exceeds 480,000 samples (30 seconds at 16 kHz).',
    );
  for (const sample of audio)
    if (!Number.isFinite(sample) || sample < -1 || sample > 1)
      throw new WhistleError('INVALID_AUDIO', 'PCM samples must be finite and within [-1, 1].');
}
/** Validate and snapshot per-call hints into allocation-bounded engine options. */
export function validateOptions(options: TranscribeOptions = {}): TranscribeOptions {
  const fail = (message: string): never => {
    throw new WhistleError('INVALID_OPTIONS', message);
  };
  if (!options || typeof options !== 'object') fail('Expected transcription options.');
  validateSignal(options.signal);
  const language = options.language === undefined ? 'auto' : options.language;
  if (language !== 'auto' && !languages.includes(language)) fail('Unsupported language.');
  if (options.wordTimestamps !== undefined && typeof options.wordTimestamps !== 'boolean')
    fail('wordTimestamps must be boolean.');
  const keywords = options.keywords === undefined ? [] : options.keywords;
  if (
    !Array.isArray(keywords) ||
    keywords.some((k) => typeof k !== 'string' || /[\r\n\0]/u.test(k))
  )
    fail('keywords must be strings without CR, LF or NUL.');
  const normalized = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  // Bound allocations and upstream prompt work, including multibyte UTF-8.
  if (normalized.length > 128 || new TextEncoder().encode(normalized.join('\n')).length > 8192)
    fail('Use at most 128 keywords and 8,192 UTF-8 bytes.');
  return { language, keywords: normalized, wordTimestamps: options.wordTimestamps ?? false };
}

/** Create the standard cancellation error without retaining the signal or caller data. */
export const aborted = () => new WhistleError('ABORTED', 'Operation cancelled.');
/** Throw ABORTED if an optional signal has already been cancelled. */
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted();
}
/** Validate the minimal AbortSignal contract before registering lifecycle listeners. */
export function validateSignal(signal?: AbortSignal): void {
  if (
    signal !== undefined &&
    (!signal ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function')
  )
    throw new WhistleError('INVALID_OPTIONS', 'signal must be an AbortSignal.');
}
/** Normalize unknown failures, preserving SDK codes and mapping RangeError to OUT_OF_MEMORY. */
export function asError(error: unknown): WhistleError {
  if (error instanceof WhistleError) return error;
  return new WhistleError(
    error instanceof RangeError ? 'OUT_OF_MEMORY' : 'WORKER_FAILED',
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}
