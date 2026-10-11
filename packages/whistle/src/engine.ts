import { asError, WhistleError } from './errors.js';
import type { EngineOptions, WhistleTranscript } from './types.js';
import { normalizeResult } from './validation.js';
/** Minimal official Emscripten exports used by the independently written engine adapter. */
export interface Runtime {
  /** Current WASM heap view; reacquire it after any allocation that can grow memory. */
  HEAPU8: Uint8Array;
  /** Allocate WASM bytes; zero indicates failure. */
  _malloc(n: number): number;
  /** Release one adapter-owned allocation. */
  _free(p: number): void;
  /** Load retained model bytes; the size_t ABI requires bigint. Negative status means failure. */
  _needle_load(p: number, n: bigint): number;
  /** Bitmask of loaded model capabilities; Whistle speech is bit 2. */
  _needle_models(): number;
  /** Pointer to the engine-owned last-error C string, or zero. */
  _needle_last_error(): number;
  /** Run synchronous PCM inference into a bounded UTF-8 buffer; negative status is failure. */
  _needle_transcribe(
    p: number,
    n: number,
    language: number,
    keywords: number,
    times: number,
    out: number,
    capacity: number,
  ): number;
}
const OUTPUT_CAPACITY = 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
/** Validate allocation success and bounds against the current heap. */
function allocate(e: Runtime, n: number): number {
  const p = e._malloc(n);
  if (!p || p + n > e.HEAPU8.byteLength)
    throw new WhistleError('OUT_OF_MEMORY', 'WASM allocation failed.');
  return p;
}
/** Decode only within the allocated range, rejecting missing/full terminators and invalid UTF-8. */
function readString(e: Runtime, pointer: number, capacity: number): string {
  if (!pointer || pointer + capacity > e.HEAPU8.byteLength)
    throw new WhistleError('INVALID_ENGINE_OUTPUT', 'Invalid output pointer.');
  const bytes = e.HEAPU8.subarray(pointer, pointer + capacity);
  const end = bytes.indexOf(0);
  if (end < 0 || end === capacity - 1)
    throw new WhistleError('INVALID_ENGINE_OUTPUT', 'Engine output exceeded its bounded buffer.');
  try {
    return decoder.decode(bytes.subarray(0, end));
  } catch (cause) {
    throw new WhistleError('INVALID_ENGINE_OUTPUT', 'Engine returned invalid UTF-8.', { cause });
  }
}
/** Best-effort bounded engine error text; never scan an unbounded C string. */
function lastError(e: Runtime): string {
  try {
    const p = e._needle_last_error();
    return p ? readString(e, p, Math.min(4096, e.HEAPU8.byteLength - p)) : '';
  } catch {
    return 'No readable engine error.';
  }
}
/** One worker's loaded WASM engine; owns model bytes for its full worker lifetime. */
export class Engine {
  // Ownership is not specified by the header: retain model bytes until worker destruction.
  private readonly modelPointer: number;
  /** Allocate and retain model bytes, requiring the official speech capability after loading. */
  constructor(
    private readonly runtime: Runtime,
    model: Uint8Array,
  ) {
    this.modelPointer = allocate(runtime, model.length);
    runtime.HEAPU8.set(model, this.modelPointer);
    if (
      runtime._needle_load(this.modelPointer, BigInt(model.length)) < 0 ||
      !(runtime._needle_models() & 2)
    )
      throw new WhistleError(
        'MODEL_LOAD_FAILED',
        `Whistle model load failed: ${lastError(runtime)}`,
      );
  }
  /** Allocate per-call input/output buffers, normalize checked results and free temporary memory. */
  transcribe(audio: Float32Array, options: EngineOptions): WhistleTranscript {
    const start = performance.now(),
      e = this.runtime,
      allocations: number[] = [];
    const alloc = (n: number) => {
      const p = allocate(e, n);
      allocations.push(p);
      return p;
    };
    const string = (s: string) => {
      if (!s) return 0;
      const bytes = new TextEncoder().encode(s);
      const p = alloc(bytes.length + 1);
      e.HEAPU8.set(bytes, p);
      e.HEAPU8[p + bytes.length] = 0;
      return p;
    };
    try {
      const pcm = alloc(audio.byteLength);
      const language = string(options.language === 'auto' ? '' : options.language);
      const keywords = string(options.keywords.join('\n'));
      const output = alloc(OUTPUT_CAPACITY);
      // Every allocation can grow memory; obtain views only after allocations.
      new Float32Array(e.HEAPU8.buffer, pcm, audio.length).set(audio);
      e.HEAPU8.fill(255, output, output + OUTPUT_CAPACITY);
      const status = e._needle_transcribe(
        pcm,
        audio.length,
        language,
        keywords,
        +options.wordTimestamps,
        output,
        OUTPUT_CAPACITY,
      );
      if (status < 0)
        throw new WhistleError('INFERENCE_FAILED', `Whistle inference failed: ${lastError(e)}`);
      let raw: unknown;
      try {
        raw = JSON.parse(readString(e, output, OUTPUT_CAPACITY));
      } catch (cause) {
        throw new WhistleError('INVALID_ENGINE_OUTPUT', 'Truncated or malformed engine JSON.', {
          cause,
        });
      }
      const result = normalizeResult(raw, options.wordTimestamps, audio.length / 16000, 0);
      result.timings.totalMs = performance.now() - start;
      return result;
    } catch (error) {
      throw asError(error, 'INFERENCE_FAILED');
    } finally {
      for (const p of allocations) e._free(p);
    }
  }
}
