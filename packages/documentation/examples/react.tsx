import { useWhistle, useWhistleRecorder } from '@tiny-stt/react';
import { useState } from 'react';

export function SpeechInput({ assetsUrl }: { assetsUrl: string }) {
  const [source, setSource] = useState<'engine' | 'recorder'>('engine');
  const whistle = useWhistle({ assetsUrl });
  const recorder = useWhistleRecorder(whistle, {
    maxDurationSeconds: 30,
    transcribeOptions: { wordTimestamps: true },
  });
  const recording = recorder.status !== 'idle';
  const busy = whistle.status !== 'idle' || recording;
  const error = source === 'recorder' ? recorder.error : whistle.error;
  // Rejections are also exposed in hook state. Always observe the action promises.
  const observe = (promise: Promise<unknown>) => {
    void promise.catch(() => {});
  };

  return (
    <section>
      <button
        type="button"
        disabled={whistle.ready || busy}
        onClick={() => {
          setSource('engine');
          observe(whistle.load());
        }}
      >
        Load speech model
      </button>
      <input
        type="file"
        accept="audio/*"
        disabled={!whistle.ready || busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) {
            setSource('engine');
            observe(whistle.transcribeFile(file, { wordTimestamps: true }));
          }
        }}
      />
      <button
        type="button"
        disabled={!whistle.ready || busy}
        onClick={() => {
          setSource('recorder');
          observe(recorder.start());
        }}
      >
        Record
      </button>
      <button type="button" disabled={!recording} onClick={() => observe(recorder.stop())}>
        Stop and transcribe
      </button>
      <button
        type="button"
        disabled={!busy}
        onClick={() => {
          recorder.cancel();
          whistle.cancel();
        }}
      >
        Cancel
      </button>
      <p role="status">{recording ? recorder.status : whistle.status}</p>
      {error && (
        <p role="alert">
          {error.code}: {error.message}
        </p>
      )}
      <output>{whistle.result?.text}</output>
    </section>
  );
}
