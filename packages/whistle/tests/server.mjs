import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
export async function serve(root = process.cwd(), { base = '/', csp = false } = {}) {
  const requests = [];
  const originRoot = resolve(root);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    requests.push(path);
    try {
      if (!path.startsWith(base)) throw Error();
      const file = resolve(originRoot, `.${path.slice(base.length - 1)}`);
      if (!file.startsWith(`${originRoot}/`) && file !== originRoot) throw Error();
      if (csp)
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; media-src 'self' blob:",
        );
      const name = path.endsWith('/') ? `${file}/index.html` : file;
      const types = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.json': 'application/json',
        '.css': 'text/css',
        '.wav': 'audio/wav',
      };
      res.setHeader('Content-Type', types[extname(name)] ?? 'application/octet-stream');
      res.end(await readFile(name));
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
  await new Promise((r, j) => {
    server.once('error', j);
    server.listen(0, '127.0.0.1', r);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${base}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}
