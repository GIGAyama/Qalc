#!/usr/bin/env node
/* 実ブラウザでの測定をまとめて走らせる（Part I §7 / Part III P1 の検証）
 *
 *   npm run build && npm run measure
 *
 * dist/ を本番と同じドメイン直下に配ってから、Chromium を実際に起動して測る。
 * 静的に読むだけでは分からないものだけを、ここに置いてある。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '../../dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist が無い。先に npm run build を走らせること。');
  process.exit(1);
}

const run = (file, env = {}) => new Promise((res) => {
  const c = spawn(process.execPath, [join(here, file)], { stdio: 'inherit', env: { ...process.env, ...env } });
  c.on('exit', (code) => res(code ?? 1));
});

// 2つ立てる。PWA の検査はキャッシュと Service Worker を触るので、
// 表示の検査と同じオリジンでやると互いに干渉する
const servers = [4180, 4181].map((port) =>
  spawn(process.execPath, [join(here, 'serve.mjs'), dist, String(port)], { stdio: 'ignore' }));
await new Promise((r) => setTimeout(r, 1200));

const steps = [
  ['表示（画面ごと・375x667）', 'routes.mjs', { W: '375', H: '667' }],
  ['表示（画面ごと・320x568）', 'routes.mjs', { W: '320', H: '568' }],
  ['圏外ページ', 'offline.mjs', {}],
  ['アイコン', 'icons.mjs', {}],
  ['PWA の挙動', 'pwa.mjs', {}],
];

const failed = [];
for (const [name, file, env] of steps) {
  console.log(`\n──── ${name} ────`);
  if (await run(file, env)) failed.push(name);
}

servers.forEach((s) => s.kill());

console.log('\n════ まとめ ════');
if (failed.length) {
  console.log(`❌ 落ちた: ${failed.join(' / ')}`);
  console.log('検査をゆるめて通さないこと。数字は AUDIT.md に残すこと。');
  process.exit(1);
}
console.log('✅ すべて合格');
