#!/usr/bin/env node
/** Build/deployment-time asset acquisition CLI. Exit codes: 0 success, 1 failure, 2 usage, 130 SIGINT, 143 SIGTERM.
 * @packageDocumentation
 */
import { asError } from './errors.js';
import { installAssets } from './install.js';
import { manifest } from './inventory.js';

const help = `@tiny-stt/whistle ${manifest.sdkVersion} — prepare pinned local inference assets

Usage: whistle download --out <directory> [--offline]
       whistle --help | --version

Downloads whistle.cact, copies bundled runtime/workers and license notices,
verifies SHA-256, and publishes manifest.json last. Existing valid files are reused.
--offline copies bundled files and verifies assets without making network requests.
No downloads occur at npm install or during Node inference.

Examples:
  whistle download --out ./vendor/whistle
  whistle download --offline --out ./public/whistle
`;
async function main() {
  const args = process.argv.slice(2);
  if (
    (args.length === 1 && ['--help', '-h'].includes(args[0])) ||
    (args[0] === 'download' && args.length === 2 && args[1] === '--help')
  ) {
    console.log(help);
    return;
  }
  if (args.length === 1 && args[0] === '--version') {
    console.log(manifest.sdkVersion);
    return;
  }
  let out: string | undefined,
    offline = false,
    invalid = args[0] !== 'download';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--out' && !out && args[i + 1] && !args[i + 1].startsWith('--'))
      out = args[++i];
    else if (args[i] === '--offline' && !offline) offline = true;
    else invalid = true;
  }
  if (invalid || !out) {
    console.error(help);
    process.exitCode = 2;
    return;
  }
  const controller = new AbortController();
  let interrupted = 0;
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted = signal === 'SIGINT' ? 130 : 143;
    controller.abort();
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    await installAssets({
      out,
      offline,
      signal: controller.signal,
      progress: (message) => console.error(message),
    });
  } catch (error) {
    const e = asError(error, 'ASSET_DOWNLOAD_FAILED');
    console.error(`${e.code}: ${e.message}`);
    process.exitCode = interrupted || 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
await main();
