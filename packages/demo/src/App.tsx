import type { WhistleLanguage } from '@tiny-stt/whistle';
import { useWhistleDemo } from './useWhistleDemo';

const languageNames: Record<WhistleLanguage, string> = {
  nl: 'Dutch',
  en: 'English',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pl: 'Polish',
  es: 'Spanish',
};

export function App() {
  const demo = useWhistleDemo();
  const capturing = demo.phase === 'permission' || demo.phase === 'recording';
  const busy = demo.phase !== 'idle';

  return (
    <main>
      <p className="eyebrow">@tiny-stt/whistle - SDK example</p>
      <h1>
        Your voice,
        <br />
        on your device.
      </h1>
      <p>Transcribe a completed clip of up to 30 seconds. Inference runs here, in your browser.</p>
      <button
        type="button"
        id="load"
        aria-describedby="model-help"
        disabled={demo.ready || busy}
        onClick={() => void demo.load()}
      >
        {demo.ready ? 'Model ready' : demo.phase === 'loading' ? 'Preparing…' : 'Prepare model'}
      </button>
      <p id="model-help" className="model-help">
        Saved model files are reused when available. The speech engine still needs to initialize
        after each page refresh.
      </p>
      <p id="status" role="status" aria-live="polite">
        {demo.status}
      </p>
      <div className="controls">
        <button
          type="button"
          id="record"
          disabled={!demo.ready || (busy && !capturing)}
          aria-pressed={demo.phase === 'recording'}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            void demo.beginRecording();
          }}
          onPointerUp={demo.stopRecording}
          onPointerCancel={demo.cancel}
          onBlur={demo.stopRecording}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              if (!event.repeat) void demo.beginRecording();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              demo.stopRecording();
            }
          }}
        >
          Hold to talk
        </button>
        <button type="button" id="cancel" disabled={!busy} onClick={demo.cancel}>
          Cancel
        </button>
        <label>
          Or choose an audio file{' '}
          <input
            id="file"
            type="file"
            accept="audio/*"
            disabled={!demo.ready || busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              // Allow selecting the same file again, including after an error or cancellation.
              event.currentTarget.value = '';
              if (file) void demo.transcribeFile(file);
            }}
          />
        </label>
      </div>
      <div className="settings">
        <label className="setting" htmlFor="language">
          Spoken language
          <span className="select-control">
            <select
              id="language"
              value={demo.language}
              disabled={busy}
              onChange={(event) =>
                demo.setLanguage(event.currentTarget.value as WhistleLanguage | 'auto')
              }
            >
              <option value="auto">Detect automatically</option>
              {Object.entries(languageNames).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="setting">
          <input
            id="timestamps"
            type="checkbox"
            checked={demo.wordTimestamps}
            disabled={busy}
            onChange={(event) => demo.setWordTimestamps(event.currentTarget.checked)}
          />{' '}
          Include word timestamps
        </label>
      </div>
      <h2>Transcript</h2>
      {demo.result && (
        <p id="language-result" className="transcript-language" aria-live="polite">
          {demo.result.language
            ? `Detected language: ${languageNames[demo.result.language]}`
            : 'No speech detected.'}
        </p>
      )}
      <output id="transcript">
        {demo.result ? demo.result.text || '(Silence)' : 'Your transcript will appear here.'}
      </output>
      <pre id="words" hidden={!demo.result?.words}>
        {demo.result?.words ? JSON.stringify(demo.result.words, null, 2) : ''}
      </pre>
      <footer>
        Microphone access begins only when you hold the button. No audio or transcript is uploaded.
        This example is self-hosted; disconnected use also needs a cached application.
      </footer>
    </main>
  );
}
