/**
 * Optional React 19 hooks for local completed-clip transcription and recording.
 * No engine, network request or microphone is started by importing or rendering hooks.
 * @module @tiny-stt/react
 * @group API
 */
'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { RecorderController, WhistleController } from './controller.js';
import type {
  UseWhistleOptions,
  UseWhistleRecorderOptions,
  UseWhistleRecorderReturn,
  UseWhistleReturn,
} from './types.js';

export { WhistleError } from '@tiny-stt/whistle';
export type {
  UseWhistleOptions,
  UseWhistleRecorderOptions,
  UseWhistleRecorderReturn,
  UseWhistleReturn,
  WhistleRecorderState,
  WhistleRecorderStatus,
  WhistleState,
  WhistleStatus,
} from './types.js';

// Resource identity is state, not a memoization hint. Construction is pure: no
// workers, browser APIs or subscriptions. Fast Refresh can preserve the last result.
function useController<K, T>(key: K, create: () => T): T {
  const [owned, setOwned] = useState(() => ({ key, controller: create() }));
  if (owned.key !== key) {
    const next = { key, controller: create() };
    setOwned(next);
    return next.controller;
  }
  return owned.controller;
}

function useLifetime(controller: { activate(): void; release(): void }) {
  // A discarded memo (including Fast Refresh) restarts resource ownership, but
  // the controller's state survives. Never allocate resources in this memo.
  const lifetime = useMemo(() => ({ controller }), [controller]);
  useEffect(() => {
    const { controller } = lifetime;
    controller.activate();
    const hide = () => {
      controller.release();
      controller.activate();
    };
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      controller.release();
    };
  }, [lifetime]);
}

/**
 * Own one browser engine with explicit loading and a FIFO of PCM/file requests.
 *
 * @param options - Asset URLs and cache preference. Equivalent string/URL values keep the
 * same instance across renders; changed values release the old engine and require load again.
 * @returns Reactive state and stable actions for this configuration. Observe rejected action
 * promises, even when displaying the returned error state.
 * @remarks React 19 and @tiny-stt/whistle are peer dependencies of this package. SSR produces idle state without
 * browser API access. Unmount, configuration changes, pagehide and effect replay cancel work,
 * discard stale completions and dispose the engine. Page restoration/effect replay permits an
 * explicit reload. Keep the hook mounted for model reuse. Per-call signals cancel only that
 * request; cancel aborts all pending work owned by this hook. Cancelling active inference can
 * reload the worker before subsequent work. No global model or context provider is used.
 */
export function useWhistle(options: UseWhistleOptions = {}): UseWhistleReturn {
  const assetsUrl = options.assetsUrl?.toString();
  const modelUrl = options.modelUrl?.toString();
  const wasmUrl = options.wasmUrl?.toString();
  const workerUrl = options.workerUrl?.toString();
  const cache = options.cache ?? 'auto';
  const controller = useController(
    JSON.stringify([assetsUrl, modelUrl, wasmUrl, workerUrl, cache]),
    () => new WhistleController({ assetsUrl, modelUrl, wasmUrl, workerUrl, cache }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useLifetime(controller);
  return {
    ...state,
    load: controller.load,
    transcribe: controller.transcribe,
    transcribeFile: controller.transcribeFile,
    cancel: controller.cancel,
  };
}

/**
 * Record and transcribe using a useWhistle engine, without creating a second model.
 *
 * @param whistle - The current return value of useWhistle. Load it before recording.
 * @param options - Capture preferences and transcription hints, snapshotted when start is called.
 * Changes apply to the next recording, without interrupting the current one.
 * @returns Capture state plus start, stop and cancel. start/stop promises settle only after
 * transcription; observe rejection, including user cancellation.
 * @remarks Call start from a user gesture. Automatic stop is at most 30 seconds. Stopping
 * while permission is pending cancels; late granted tracks are stopped. Unmount, engine
 * replacement, pagehide and effect replay release capture and cancel its transcription.
 * Other queued calls on the supplied engine survive recorder cancellation. Pointer, keyboard
 * and focus behavior belong to the application; the hook supplies no display strings or UI.
 */
export function useWhistleRecorder(
  whistle: UseWhistleReturn,
  options: UseWhistleRecorderOptions = {},
): UseWhistleRecorderReturn {
  const controller = useController(
    whistle.transcribe,
    () => new RecorderController(whistle.transcribe),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useLifetime(controller);
  const start = useCallback(
    () => controller.start(whistle.ready, options),
    [controller, whistle.ready, options],
  );
  return { ...state, start, stop: controller.stop, cancel: controller.cancel };
}
