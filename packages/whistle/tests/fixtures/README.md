# English speech fixture

`jfk.wav` is an 11-second excerpt of President John F. Kennedy's 1961 inaugural
address ("And so, my fellow Americans…"). It was obtained from the OpenAI Whisper
repository's small test fixture at immutable revision
`9f70a352f9f8630ab3aa0d06af5cb9532bd8c21d`:
https://raw.githubusercontent.com/openai/whisper/9f70a352f9f8630ab3aa0d06af5cb9532bd8c21d/tests/jfk.flac

The source repository distributes its materials under MIT; its exact license is
preserved in WHISPER-LICENSE. The speech is a US federal government address.
No personal microphone recording was made. The fixture is development-only and
excluded from the npm tarball and CLI assets.

Preprocessing (development only; ffmpeg is not a package/runtime dependency):

```sh
ffmpeg -i jfk.flac -ar 16000 -ac 1 -c:a pcm_s16le jfk.wav
```

Result: 176,000 samples, 16 kHz mono PCM16 WAV, 352,078 bytes.
SHA-256: `b1b461fa65350cbf2f880e367265519b6b4f9ca6597c3b1904a71704a464d7cb`.
Expected substring: “ask not what your country can do for you”.
The deterministic stereo WAV and capture fixtures in browser tests are generated
from constant samples by our original test code; they contain no recorded speech.
German quality has not been tested.
