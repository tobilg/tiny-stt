import { useWhistle, useWhistleRecorder } from '@tiny-stt/react';
import type { WhistleLanguage } from '@tiny-stt/whistle';
import { useEffect, useState } from 'react';

// Only demo presentation and interaction choices live here; the SDK owns resources.
export function useWhistleDemo() {
  const [wordTimestamps, setWordTimestamps] = useState(false);
  const [language, setLanguage] = useState<WhistleLanguage | 'auto'>('auto');
  const [intent, setIntent] = useState<'load' | 'file' | 'record'>('load');
  const whistle = useWhistle({ assetsUrl: `${import.meta.env.BASE_URL}whistle/` });
  const recorder = useWhistleRecorder(whistle, { transcribeOptions: { language, wordTimestamps } });
  const { stop } = recorder;
  useEffect(() => {
    const blur = () => {
      void stop().catch(() => {});
    };
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, [stop]);

  const phase = recorder.status !== 'idle' ? recorder.status : whistle.status;
  const error = intent === 'record' ? recorder.error : whistle.error;
  let status: string;
  if (phase === 'loading') {
    const progress = whistle.progress;
    if (!progress) status = 'Preparing model files…';
    else if (progress.stage === 'initializing')
      status = 'Initializing speech engine… Model files are ready.';
    else if (progress.stage === 'ready') status = 'Model ready. Hold to talk or select a file.';
    else {
      const asset = progress.stage === 'loading-model' ? 'speech model' : 'speech engine files';
      if (progress.fromCache) status = `Loading ${asset} from browser cache…`;
      else if (progress.fromCache === false) {
        const percent =
          progress.stage === 'loading-model' && progress.fraction !== undefined
            ? ` ${Math.round(progress.fraction * 100)}%`
            : '';
        status = `Downloading ${asset}…${percent}`;
      } else status = `Loading ${asset}…`;
    }
  } else if (phase === 'permission') status = 'Requesting microphone…';
  else if (phase === 'recording')
    status = 'Recording. Release to transcribe. Stops automatically after 30 seconds.';
  else if (phase === 'stopping') status = 'Finishing recording…';
  else if (phase === 'decoding') status = 'Decoding file…';
  else if (phase === 'transcribing') status = 'Transcribing locally…';
  else if (error)
    status = error.code === 'ABORTED' ? 'Cancelled.' : `${error.code}: ${error.message}`;
  else if (!whistle.ready) status = 'Ready to load. Saved model files are reused when available.';
  else if (intent !== 'load' && whistle.result)
    status = `Done in ${Math.round(whistle.result.timings.totalMs)} ms of worker time.`;
  else status = 'Model ready. Hold to talk or select a file.';

  // Failures are displayed from hook state; event handlers observe every promise.
  const observe = (promise: Promise<unknown>) => {
    void promise.catch(() => {});
  };
  return {
    ready: whistle.ready,
    phase,
    status,
    result: whistle.result,
    language,
    setLanguage,
    wordTimestamps,
    setWordTimestamps,
    load: () => {
      setIntent('load');
      observe(whistle.load());
    },
    transcribeFile: (file: File) => {
      setIntent('file');
      observe(whistle.transcribeFile(file, { language, wordTimestamps }));
    },
    beginRecording: () => {
      setIntent('record');
      observe(recorder.start());
    },
    stopRecording: () => observe(recorder.stop()),
    cancel: () => {
      recorder.cancel();
      whistle.cancel();
    },
  };
}
