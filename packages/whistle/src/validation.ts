import { validateSignal, WhistleError } from './errors.js';
import type {
  EngineOptions,
  TranscribeOptions,
  WhistleLanguage,
  WhistleTranscript,
} from './types.js';
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
export function validateOptions(options: TranscribeOptions = {}): EngineOptions {
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
/**
 * Convert untrusted upstream JSON into the public result contract.
 * @param raw - Parsed output from the engine's bounded UTF-8 buffer.
 * @param timestamps - Whether word output was requested.
 * @param duration - Clip length in seconds, used to reject out-of-bounds words.
 * @param totalMs - Worker service time in milliseconds.
 * @returns A normalized transcript; silence has empty text and null language.
 * @throws WhistleError with INVALID_ENGINE_OUTPUT for invalid shapes, languages or metrics.
 */
export function normalizeResult(
  raw: unknown,
  timestamps: boolean,
  duration: number,
  totalMs: number,
): WhistleTranscript {
  const fail = (): never => {
    throw new WhistleError('INVALID_ENGINE_OUTPUT', 'Malformed or unsupported engine result.');
  };
  if (!raw || typeof raw !== 'object') return fail();
  const r = raw as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (
    typeof r.text !== 'string' ||
    typeof r.language !== 'string' ||
    !finite(r.ttft_ms) ||
    !finite(r.decode_tps) ||
    !finite(totalMs)
  )
    return fail();
  const text = r.text.trim();
  if ((text && !languages.includes(r.language)) || (!text && r.language !== '')) return fail();
  const result: WhistleTranscript = {
    text,
    language: text ? (r.language as WhistleLanguage) : null,
    timings: { firstTokenMs: r.ttft_ms, decodeTokensPerSecond: r.decode_tps, totalMs },
  };
  if (timestamps) {
    if (!Array.isArray(r.words)) return fail();
    let previous = 0;
    result.words = r.words.map((word: unknown) => {
      if (!word || typeof word !== 'object') return fail();
      const w = word as Record<string, unknown>;
      if (
        !w ||
        typeof w.word !== 'string' ||
        !finite(w.start) ||
        !finite(w.end) ||
        w.end < w.start ||
        w.start < previous ||
        w.end > duration ||
        !finite(w.probability) ||
        w.probability > 1
      )
        return fail();
      previous = w.end;
      return { text: w.word, start: w.start, end: w.end, probability: w.probability };
    });
    if (!text && result.words.length) return fail();
  }
  return result;
}
