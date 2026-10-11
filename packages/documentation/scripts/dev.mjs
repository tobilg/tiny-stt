import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
// Run the CLI directly: its bin wrapper forks a child that would outlive our watcher handle.
const cli = fileURLToPath(new URL('cli.js', import.meta.resolve('typedoc')));
let watcher;
let server;
let closing = false;

async function close(code = 0) {
  if (closing) return;
  closing = true;
  process.exitCode = code;
  if (watcher && watcher.exitCode === null) {
    watcher.kill('SIGTERM');
    const deadline = setTimeout(() => watcher?.kill('SIGKILL'), 5000);
    deadline.unref();
    watcher.once('exit', () => clearTimeout(deadline));
  }
  await server?.close();
}

function watch() {
  watcher = spawn(process.execPath, [cli, '--watch'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, TYPEDOC_FORCE_WATCH: '1' },
  });
  watcher.once('error', (error) => {
    console.error(error);
    void close(1);
  });
  watcher.once('exit', (code) => {
    if (closing) return;
    // TypeDoc requests a fresh process when its configuration changes.
    if (code === 7) watch();
    else void close(code ?? 1);
  });
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
try {
  server = await createServer({
    root: fileURLToPath(new URL('../dist/', import.meta.url)),
    server: { host: '127.0.0.1', port: 4174, strictPort: true },
    clearScreen: false,
  });
  if (!closing) {
    await server.listen();
    watch();
    console.log('Whistle documentation: http://127.0.0.1:4174/ (watching source and guides)');
  } else await server.close();
} catch (error) {
  console.error(error);
  await close(1);
}
