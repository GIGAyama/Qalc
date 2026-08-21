#!/usr/bin/env node
/**
 * 【正本】standards/sw/build-sw-vite.mjs — Vite 系アプリ用
 * 各リポジトリへは tools/build-sw.mjs としてコピーする（中身は変えない）。
 * リポジトリ固有の値は sw-build.config.json に置く。
 *
 * ビルド後に dist/sw.js の APP_VERSION と PRECACHE_URLS を実体で埋める。
 *
 * なぜ手で書かないか
 *   - Vite の出力するファイル名にはハッシュが付く（index-ti_VyL6O.js）。
 *     手で並べた一覧は次のビルドで必ず古くなり、
 *     「圏外で開いたら真っ白」という形で初めて気づくことになる。
 *   - APP_VERSION の更新漏れは「更新が反映されない」の最大の原因。
 *     リリース手順書に書いて人間に覚えさせるより、中身から作るほうが漏れない。
 *     （2026-08-21、12 リポジトリで同時に上げ忘れる事故が実際に起きた）
 *
 * APP_VERSION は先読み対象ファイルの中身から作るので、
 * 中身が1バイトでも変われば必ず変わり、変わらなければ変わらない。
 *
 * sw-build.config.json（リポジトリ直下、無ければ既定値）:
 *   {
 *     "distDir": "dist",
 *     "maxBytes": 1048576,
 *     "precache": ["index.html", "offline.html", "manifest.webmanifest",
 *                  "install-hook.js", "assets/", "icons/icon-192.png", "icons/icon-512.png"],
 *     "assetsFromIndexHtml": false
 *   }
 *   precache の項目は、"/" で終わればディレクトリ前方一致、それ以外は完全一致。
 *   assetsFromIndexHtml を true にすると、"assets/" を丸ごと入れるかわりに
 *   dist/index.html が参照している JS/CSS だけを先読みに入れる。
 *   遅延読みこみの塊やフォントを持つアプリ向け（先読みが重いと初回表示が止まる）。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const DEFAULTS = {
  distDir: 'dist',
  maxBytes: 1024 * 1024, // 40人が同時に開く回線で初回表示が止まらない目安
  precache: [
    'index.html', 'offline.html', 'manifest.webmanifest', 'install-hook.js',
    'assets/', 'icons/icon-192.png', 'icons/icon-512.png',
  ],
};

const config = existsSync('sw-build.config.json')
  ? { ...DEFAULTS, ...JSON.parse(readFileSync('sw-build.config.json', 'utf8')) }
  : DEFAULTS;

const DIST = config.distDir;
const SW = join(DIST, 'sw.js');

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const matches = (rel) => config.precache.some((rule) =>
  rule.endsWith('/') ? rel.startsWith(rule) : rel === rule);

const all = walk(DIST);

// 圏外でアプリが起動するのに要るものだけ。
// favicon やスクリーンショットは無くても起動するので runtime キャッシュに任せる。
const wanted = all.filter((p) => {
  const rel = relative(DIST, p).split('\\').join('/');
  if (rel === 'sw.js') return false; // 自分自身は入れない
  if (rel.endsWith('.map')) return false; // ソースマップは重いだけで表示に要らない
  return matches(rel);
});

// index.html が直接読む本体の JS/CSS だけを拾うモード。
// 初回訪問では <script>/<link> は Service Worker より先に読み込まれ、
// fetch を通らず runtime キャッシュに入らない。先読みに入れないと
// 「圏外で開くとまっ白」になる。一方で遅延読みこみの塊まで入れると
// 40人同時の校内 Wi-Fi で初回表示が止まるので、参照されているものに絞る。
if (config.assetsFromIndexHtml) {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  if (refs.length === 0) {
    console.error('[build-sw] ❌ dist/index.html から本体の JS/CSS を見つけられませんでした。');
    process.exit(1);
  }
  for (const rel of new Set(refs)) {
    const p = join(DIST, rel);
    if (!existsSync(p)) {
      console.error(`[build-sw] ❌ dist/index.html が参照する ${rel} が dist にありません。`);
      process.exit(1);
    }
    if (!wanted.includes(p)) wanted.push(p);
  }
}

const urls = ['./', ...wanted.map((p) => './' + relative(DIST, p).split('\\').join('/'))];

const total = wanted.reduce((n, p) => n + statSync(p).size, 0);
if (total > config.maxBytes) {
  console.warn(`[build-sw] ⚠️ 先読みが ${(total / 1024).toFixed(0)}KB あります（目安 ${config.maxBytes / 1024}KB）。`);
  console.warn('           40人が同時に開く回線では初回表示が止まります。大きい塊を外してください。');
}

// 版は「先読みするものの中身」から作る。ファイル名だけでなく中身も混ぜる。
const h = createHash('sha256');
for (const p of wanted.sort()) {
  h.update(relative(DIST, p));
  h.update(readFileSync(p));
}
const version = 'v' + h.digest('hex').slice(0, 12);

let src = readFileSync(SW, 'utf8');
const before = src;

src = src.replace(
  /^const APP_VERSION = .*; \/\* __APP_VERSION__ \*\/$/m,
  `const APP_VERSION = '${version}'; /* __APP_VERSION__ */`,
);
src = src.replace(
  /^const PRECACHE_URLS = .*; \/\* __PRECACHE_URLS__ \*\/$/m,
  `const PRECACHE_URLS = ${JSON.stringify(urls)}; /* __PRECACHE_URLS__ */`,
);

// 置換できていなければ、黙って「dev」のまま配ることになる。
// それは「更新が反映されない」と「圏外で真っ白」を同時に起こすので、必ず落とす。
if (src === before || src.includes("APP_VERSION = 'dev'")) {
  console.error('[build-sw] ❌ dist/sw.js の目印を書き換えられませんでした。');
  console.error('           public/sw.js の __APP_VERSION__ / __PRECACHE_URLS__ の行を確かめてください。');
  process.exit(1);
}

writeFileSync(SW, src);
console.log(`[build-sw] APP_VERSION = ${version}`);
console.log(`[build-sw] 先読み ${urls.length} 件 / ${(total / 1024).toFixed(1)} KB`);
