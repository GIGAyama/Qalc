// dist/ を本番と同じ「ドメイン直下」で配る。
// 独自ドメイン qalc.giga-school.com ではアプリがドメイン直下に置かれるので、
// ここを旧構成の /Qalc/ の下にすると、本番では 404 になるパスが
// 測定環境でだけ通ってしまい、壊れているのに「合格」と出る。
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
  if (!p.startsWith('/')) { res.writeHead(404); return res.end('outside scope'); }
  let rel = p.slice(1);
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

server.listen(PORT, () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/`));
