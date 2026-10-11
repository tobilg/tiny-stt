/**
 * Optional push-to-talk capture in secure browser contexts. Microphone access is requested
 * only when startRecording is called, never by importing or loading a model.
 * @module @tiny-stt/whistle/microphone
 * @group API
 */
import { decodeClip } from './audio.js';
import { aborted, checkAbort, validateSignal, WhistleError } from './errors.js';

export { WhistleError } from './errors.js';
/** One manual-stop or automatically bounded microphone recording. */
export interface RecordingOptions {
  /** Maximum duration, greater than 0 and at most 30 seconds. @defaultValue 30 */
  maxDurationSeconds?: number;
  /** Request browser echo cancellation; device support varies. @defaultValue true */
  echoCancellation?: boolean;
  /** Request browser noise suppression; device support varies. @defaultValue true */
  noiseSuppression?: boolean;
  /** Cancel permission acquisition, active capture or final decoding; late tracks are stopped. */
  signal?: AbortSignal;
}
/** Handle for one recording. Always observe result, including its cancellation rejection. */
export interface Recording {
  /** Resolves after manual/automatic stop and decoding, or rejects on cancellation/capture failure. */
  readonly result: Promise<Float32Array>;
  /** Stop capture and return the same promise as result; repeated calls are idempotent. */
  stop(): Promise<Float32Array>;
  /** Discard capture, stop tracks and reject unfinished result with ABORTED; harmless after completion. */
  cancel(): void;
}
/**
 * Request microphone access and start one bounded completed-clip recording.
 *
 * @param options - Duration, browser processing preferences and cancellation.
 * @returns A recording handle after capture has started; result settles even with automatic stop.
 * @throws {@link WhistleError} with MICROPHONE_DENIED for permission/security denial,
 * MICROPHONE_UNAVAILABLE for device/capture failure, INVALID_OPTIONS for invalid limits,
 * UNSUPPORTED_ENVIRONMENT for missing APIs, or ABORTED for cancellation.
 * @remarks Call from a user action on HTTPS or localhost. Tracks, timers and decoder
 * resources are cleaned up on stop/error/cancel. An explicit recording limit cuts timer
 * overshoot, but this is not a continuous transcription API. Permission dialogs themselves
 * cannot be dismissed programmatically; late granted streams are immediately stopped.
 * @example
 * ```ts
 * import { startRecording } from '@tiny-stt/whistle/microphone';
 * async function recordBriefly() {
 *   const recording = await startRecording({ maxDurationSeconds: 5 });
 *   return recording.result; // Observe automatic completion and errors.
 * }
 * ```
 */
export async function startRecording(options: RecordingOptions = {}): Promise<Recording> {
  if (!options || typeof options !== 'object')
    throw new WhistleError('INVALID_OPTIONS', 'Expected recording options.');
  const limit = options.maxDurationSeconds === undefined ? 30 : options.maxDurationSeconds;
  if (
    !Number.isFinite(limit) ||
    limit <= 0 ||
    limit > 30 ||
    (['echoCancellation', 'noiseSuppression'] as const).some(
      (k) => options[k] !== undefined && typeof options[k] !== 'boolean',
    )
  )
    throw new WhistleError(
      'INVALID_OPTIONS',
      'Recording duration must be > 0 and <= 30; audio processing options must be boolean.',
    );
  validateSignal(options.signal);
  checkAbort(options.signal);
  if (!globalThis.navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
    throw new WhistleError(
      'UNSUPPORTED_ENVIRONMENT',
      'Microphone capture requires a secure context, mediaDevices and MediaRecorder.',
    );
  let stream: MediaStream | undefined,
    recorder: MediaRecorder | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let done = false,
    stopping = false,
    started = false;
  const chunks: Blob[] = [],
    decoder = new AbortController();
  let resolve!: (pcm: Float32Array) => void, reject!: (e: unknown) => void;
  const result = new Promise<Float32Array>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Capture may fail before startRecording can return result to its caller.
  void result.catch(() => {});
  const cleanup = () => {
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    options.signal?.removeEventListener('abort', cancel);
  };
  const fail = (error: unknown) => {
    if (done) return;
    done = true;
    decoder.abort();
    cleanup();
    if (recorder?.state === 'recording') {
      try {
        recorder.stop();
      } catch {}
    }
    chunks.length = 0;
    reject(error);
  };
  const cancel = () => fail(aborted());
  const stop = () => {
    if (!done && !stopping) {
      stopping = true;
      clearTimeout(timer);
      try {
        if (!recorder) throw new Error('Recorder has not started.');
        recorder.stop();
      } catch (cause) {
        fail(new WhistleError('MICROPHONE_UNAVAILABLE', 'Cannot stop recorder.', { cause }));
      } finally {
        stream?.getTracks().forEach((track) => {
          track.stop();
        });
      }
    }
    return result;
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const permission = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: options.echoCancellation ?? true,
        noiseSuppression: options.noiseSuppression ?? true,
      },
    });
    // Permission dialogs cannot be programmatically dismissed. Stop late streams.
    void permission.then(
      (value) => {
        if (done)
          value.getTracks().forEach((t) => {
            t.stop();
          });
      },
      () => {},
    );
    stream = await Promise.race([
      permission,
      result.then(() => {
        throw aborted();
      }),
    ]);
    checkAbort(options.signal);
    if (!stream.getAudioTracks().some((t) => t.readyState === 'live'))
      throw new WhistleError('MICROPHONE_UNAVAILABLE', 'No live microphone audio track.');
    const activeRecorder = new MediaRecorder(stream);
    recorder = activeRecorder;
    activeRecorder.ondataavailable = (event) => {
      if (!done && event.data.size) chunks.push(event.data);
    };
    activeRecorder.onerror = () =>
      fail(new WhistleError('MICROPHONE_UNAVAILABLE', 'Microphone recording failed.'));
    activeRecorder.onstop = async () => {
      if (done) return;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      try {
        const pcm = await decodeClip(
          new Blob(chunks, { type: activeRecorder.mimeType }),
          { signal: decoder.signal },
          limit,
        );
        if (!done) {
          done = true;
          cleanup();
          chunks.length = 0;
          resolve(pcm);
        }
      } catch (cause) {
        fail(cause);
      }
    };
    await new Promise<void>((yes, no) => {
      activeRecorder.onstart = () => {
        started = true;
        yes();
      };
      void result.catch(no);
      activeRecorder.start();
    });
    if (done)
      return await result.then(() => {
        throw aborted();
      });
    timer = setTimeout(() => {
      void stop();
    }, limit * 1000);
    return { result, stop, cancel };
  } catch (cause) {
    const name = (cause as Error)?.name;
    const error =
      cause instanceof WhistleError
        ? cause
        : new WhistleError(
            name === 'NotAllowedError' || name === 'SecurityError'
              ? 'MICROPHONE_DENIED'
              : 'MICROPHONE_UNAVAILABLE',
            started ? 'Microphone capture failed.' : 'Cannot start microphone capture.',
            { cause },
          );
    fail(error);
    throw error;
  }
}
