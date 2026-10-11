/** Stable SDK error identifiers used for safe cross-worker serialization. */
export const errorCodes = [
  'UNSUPPORTED_ENVIRONMENT',
  'INVALID_OPTIONS',
  'INVALID_AUDIO',
  'AUDIO_TOO_LONG',
  'AUDIO_DECODE_FAILED',
  'MICROPHONE_DENIED',
  'MICROPHONE_UNAVAILABLE',
  'ASSET_NOT_FOUND',
  'ASSET_DOWNLOAD_FAILED',
  'ASSET_INTEGRITY_FAILED',
  'ASSET_INCOMPATIBLE',
  'MODEL_LOAD_FAILED',
  'INFERENCE_FAILED',
  'INVALID_ENGINE_OUTPUT',
  'WORKER_FAILED',
  'OUT_OF_MEMORY',
  'ABORTED',
  'DISPOSED',
] as const;
/**
 * Machine-readable failure category; messages may include environment-specific detail.
 *
 * | Code | Meaning |
 * | --- | --- |
 * | UNSUPPORTED_ENVIRONMENT | Required browser APIs are unavailable. |
 * | INVALID_OPTIONS | Invalid path, URL, language, limit or option value. |
 * | INVALID_AUDIO | Empty/wrong PCM type or non-finite/out-of-range samples. |
 * | AUDIO_TOO_LONG | Input or decoded file exceeds 30 seconds. |
 * | AUDIO_DECODE_FAILED | Invalid or unsupported encoded audio. |
 * | MICROPHONE_DENIED | Permission or secure-context policy denied capture. |
 * | MICROPHONE_UNAVAILABLE | No usable device, or capture failed. |
 * | ASSET_NOT_FOUND | Required prepared asset is absent or unreadable. |
 * | ASSET_DOWNLOAD_FAILED | Asset acquisition failed after bounded retries. |
 * | ASSET_INTEGRITY_FAILED | Expected size or SHA-256 does not match. |
 * | ASSET_INCOMPATIBLE | Manifest or SDK/runtime compatibility mismatch. |
 * | MODEL_LOAD_FAILED | Engine rejected the model or lacks speech capability. |
 * | INFERENCE_FAILED | Engine returned a negative status or runtime failure. |
 * | INVALID_ENGINE_OUTPUT | Truncated, malformed or unsupported engine output. |
 * | WORKER_FAILED | Worker startup, transport, crash or protocol failure. |
 * | OUT_OF_MEMORY | WASM allocation failure or a runtime RangeError. |
 * | ABORTED | Caller cancelled the operation. |
 * | DISPOSED | Operation was attempted or pending on a disposed instance. |
 */
export type WhistleErrorCode = (typeof errorCodes)[number];
/**
 * SDK failure with a stable code and optional local cause.
 *
 * Branch on code instead of parsing messages. Worker transport retains the code and
 * message but does not copy arbitrary stacks, causes, audio or transcript objects.
 * @example
 * ```ts
 * import { WhistleError } from '@tiny-stt/whistle';
 * function wasCancelled(error: unknown) {
 *   return error instanceof WhistleError && error.code === 'ABORTED';
 * }
 * ```
 */
export class WhistleError extends Error {
  /** Error name used by diagnostics and native Error tooling. */
  readonly name = 'WhistleError';
  /**
   * Construct an SDK error or attach a local underlying cause.
   * @param code - Stable machine-readable failure category.
   * @param message - Human-readable context; never include caller audio or transcripts.
   * @param options - Optional native Error cause (not preserved across workers).
   */
  constructor(
    /** Stable category for application branching. */
    public readonly code: WhistleErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
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
export function asError(error: unknown, code: WhistleErrorCode = 'WORKER_FAILED'): WhistleError {
  if (error instanceof WhistleError) return error;
  return new WhistleError(
    error instanceof RangeError ? 'OUT_OF_MEMORY' : code,
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}
/** Retain only a normalized code/message pair for worker transport. */
export function serializeError(error: unknown) {
  const e = asError(error);
  return { code: e.code, message: e.message };
}
/** Decode a worker error, replacing unsupported codes/shapes with WORKER_FAILED. */
export function deserializeError(value: unknown): WhistleError {
  const e = value as { code?: WhistleErrorCode; message?: string } | null;
  return e && e.code !== undefined && errorCodes.includes(e.code) && typeof e.message === 'string'
    ? new WhistleError(e.code, e.message)
    : new WhistleError('WORKER_FAILED', 'Invalid worker error message.');
}
