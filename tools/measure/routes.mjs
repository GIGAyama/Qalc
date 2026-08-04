/* 画面ごとに、まっさらな状態から入り直して測る。
 *
 * 総当たりの探索は、モーダルが開いたままの画面と本来の画面を
 * 「同じ画面」と取りちがえて数を取りこぼした（実際にそうなった）。
 * どこを見たいかを明示して、毎回いちから入り直すほうが数字が信用できる。
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

import { CHROME } from './env.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:4180/Qalc/';
const INPAGE = readFileSync(new URL('./inpage.js', import.meta.url), 'utf8');
const W = Number(process.env.W || 375);
const H = Number(process.env.H || 667);

// 「押すボタンの並び」で画面を指定する。空配列＝さいしょの画面
const ROUTES = [
  ['さいしょの画面', []],
  ['ていじモードのせってい', ['ていじモードのせってい']],
  ['スコアアタック（したく）', ['スコアアタック']],
  ['タイムアタック（したく）', ['タイムアタック']],
  ['サドンデス（したく）', ['サドンデス']],
  ['きせかえ（ショップ）', ['きせかえ']],
  ['きせかえ → ガチャ', ['きせかえ', 'ガチャ']],
  ['コース管理', ['コース管かん理り']],
  ['へやをつくる', ['みんなであそぶ（へやをつくる）']],
  ['へやに入る', ['へやに入はいる']],
  ['きろく', ['きろく']],
  ['がくしゅうどうぐ', ['がくしゅうどうぐ']],
  ['せってい', ['せってい']],
];

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'ja-JP' });
await ctx.addInitScript(INPAGE);
await ctx.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations.push({ directive: e.violatedDirective, blocked: String(e.blockedURI).slice(0, 100), source: `${e.sourceFile}:${e.lineNumber}` });
  });
});
const page = await ctx.newPage();
const js = [];
page.on('console', (m) => { if (m.type() === 'error') js.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => js.push('pageerror: ' + String(e).slice(0, 200)));

const problems = { contrast: [], tap: [], overflow: [], ruby: [], csp: [] };
const reached = [];

const clickByText = (t) => page.evaluate((label) => {
  const cands = [...document.querySelectorAll('button, a[href], [role="button"], summary')]
    .filter((e) => e.getBoundingClientRect().width > 4 && e.getBoundingClientRect().height > 4);
  const norm = (e) => (e.textContent || e.getAttribute('aria-label') || '').replace(/\s+/g, '').trim();
  const el = cands.find((e) => norm(e).startsWith(label.replace(/\s+/g, '')))
    || cands.find((e) => norm(e).includes(label.replace(/\s+/g, '')));
  if (!el) return false;
  el.click();
  return true;
}, t);

for (const [name, steps] of ROUTES) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  let ok = true;
  for (const s of steps) {
    if (!(await clickByText(s))) { ok = false; break; }
    await page.waitForTimeout(2200); // アニメーションが終わりきるまで待つ
  }
  if (!ok) { console.log(`  — ${name}：たどりつけなかった（ボタンが見つからない）`); continue; }
  const r = await page.evaluate(() => ({
    contrast: window.__giga.contrast(),
    tap: window.__giga.tapTargets(),
    overflow: window.__giga.overflow(),
    ruby: window.__giga.ruby(),
    csp: window.__cspViolations.splice(0),
  }));
  reached.push(name);
  for (const b of r.contrast.bad) problems.contrast.push({ screen: name, ...b });
  for (const b of r.tap.bad) problems.tap.push({ screen: name, ...b });
  if (r.overflow.wide.length) problems.overflow.push({ screen: name, ...r.overflow });
  for (const b of r.ruby) problems.ruby.push({ screen: name, ...b });
  for (const c of r.csp) problems.csp.push({ screen: name, ...c });
  console.log(`  [${name}] 文字${r.contrast.checked}件 不足${r.contrast.bad.length} / 押せるもの${r.tap.checked}件 44px未満${r.tap.bad.length} / 横スクロール${r.overflow.wide.length ? 'あり(' + r.overflow.scrollWidth + '>' + r.overflow.clientWidth + ')' : 'なし'} / rt${r.ruby.length}件`);
}

const summary = {
  viewport: `${W}x${H}`,
  たどりついた画面: reached.length,
  JSエラー: js.length,
  CSP違反: problems.csp.length,
  コントラスト不足: problems.contrast.length,
  タップ44px未満: problems.tap.length,
  横スクロールの出た画面: problems.overflow.length,
  ふりがなの最小比: problems.ruby.length ? Math.min(...problems.ruby.map((r) => r.ratio)) : null,
};
console.log('\n=== まとめ ===');
console.log(JSON.stringify(summary, null, 2));
if (js.length) console.log('JSエラー:', JSON.stringify(js, null, 1));
writeFileSync(process.env.OUT || new URL('./routes-result.json', import.meta.url).pathname, JSON.stringify({ summary, reached, problems, js }, null, 2));
// 落ちていたら終了コードを立てる。JS エラーは作業環境の制約で出るものがあるので数えない
// （PeerJS のシグナリングへ出られないなど。詳しくは AUDIT.md の「測れなかったもの」）
if (problems.contrast.length || problems.tap.length || problems.overflow.length || problems.csp.length) process.exitCode = 1;
await browser.close();
