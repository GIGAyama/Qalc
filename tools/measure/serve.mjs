// dist/ を GitHub Pages と同じ /Qalc/ の下に置いて配る。
// 本番と同じ絶対パス（/Qalc/sw.js など）で測るために必要。
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.argv[2] || '../../dist';
const PORT = Number(process.argv[3] || 4180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith('/Qalc/')) {
    if (p === '/Qalc') { res.writeHead(302, { Location: '/Qalc/' }); return res.end(); }
    res.writeHead(404); return res.end('outside scope');
  }
  let rel = p.slice('/Qalc/'.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Content-Length': body.length,
    // 校内フィルタと同じ状態で測るため外部への口は開けない。
    // CORS だけは付ける（SRI 検証つきの資産を測るときに要る・§7-4）
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
});

server.listen(PORT, () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/Qalc/`));
