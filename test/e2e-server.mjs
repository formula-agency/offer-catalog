import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
  const pathname = path.resolve(root, relative);
  if (!pathname.startsWith(root) || !statSafe(pathname)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(pathname).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(pathname).pipe(response);
}).listen(4173, '127.0.0.1');

function statSafe(pathname) {
  try { return statSync(pathname).isFile(); } catch { return false; }
}
