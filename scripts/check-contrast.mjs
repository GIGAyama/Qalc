#!/usr/bin/env node
/* テーマごとのコントラスト比を測る（Part I §2-8 / 監査 D8）
 *
 * Chromebook の液晶は安価で、視野角もコントラストも弱い。
 * 手もとの高品質なディスプレイで「読める」と思った配色が、教室では読めないことがある。
 * だから目で見るのではなく、WCAG の比を機械で測る。
 *
 * 測るのは「実際に画面に出ている色」。
 * このアプリは薄い文字に opacity をかけて出しているところが多く、
 * --text をそのまま測っても意味がない。背景と混ぜたあとの色で判定する。
 *
 * 判定: 本文 4.5:1 以上／大きな文字(18.66px 太字 または 24px 以上) 3:1 以上
 *
 *   node scripts/check-contrast.mjs          … 4.5:1 を割っているものだけ
 *   node scripts/check-contrast.mjs --all    … 全部
 */
import { readFileSync } from 'node:fs';

const showAll = process.argv.includes('--all');
const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

// themeVars = `--bg: #xxxxxx; ...` の行からテーマを取り出す
const themes = {};
const reTheme = /stats\.theme === '([\w-]+)'\)?\s*themeVars = `([^`]+)`/g;
let m;
while ((m = reTheme.exec(src))) {
  const vars = {};
  for (const [, k, v] of m[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[k] = v;
  themes[m[1]] = vars;
}
// 既定テーマ（どの if にも当たらなかったときの値）
const base = src.match(/let themeVars = `([^`]+)`/);
if (base) {
  const vars = {};
  for (const [, k, v] of base[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[k] = v;
  themes['(きほん)'] = vars;
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// sRGB の相対輝度（WCAG 2.x の定義）
const lum = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
// opacity をかけた文字は、背景と混ざった色として見えている
const blend = (fg, bg, alpha) => {
  const [f, b] = [hex(fg), hex(bg)];
  return '#' + f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha))
    .toString(16).padStart(2, '0')).join('');
};

/* 実際に使われている組み合わせ。
 * opacity-70 / -60 / -50 は本文の補足に多用されているので、本文あつかいで測る。 */
const CASES = [
  { label: '本文 text on bg', fg: 'text', bg: 'bg', alpha: 1, min: 4.5 },
  { label: '本文 text on panel', fg: 'text', bg: 'panel', alpha: 1, min: 4.5 },
  // 補足の文字は opacity-80 が下限（77% で全テーマが 4.5:1 を満たすので、切りのよい 80 にした）
  { label: '補足 text/80% on panel', fg: 'text', bg: 'panel', alpha: 0.8, min: 4.5 },
  { label: '補足 text/80% on bg', fg: 'text', bg: 'bg', alpha: 0.8, min: 4.5 },
  /* 強調の文字は --primary-d / --secondary-d（文字用の濃いほう）を使う。
   * --primary / --secondary は「面」用で、そのまま文字にすると読めない（Part I §2-8）。
   * ソース側も text-[var(--primary-d)] に置きかえてある。 */
  { label: '強調 primary-d on panel', fg: 'primary-d', bg: 'panel', alpha: 1, min: 4.5 },
  { label: '強調 primary-d on bg', fg: 'primary-d', bg: 'bg', alpha: 1, min: 4.5 },
  { label: '強調 secondary-d on panel', fg: 'secondary-d', bg: 'panel', alpha: 1, min: 4.5 },
  { label: '強調 secondary-d on bg', fg: 'secondary-d', bg: 'bg', alpha: 1, min: 4.5 },
  // accent の面の上に載る文字。もとの文字色で足りているテーマでは --text と同じ値になる
  { label: '見出し on-accent on accent', fg: 'on-accent', bg: 'accent', alpha: 1, min: 4.5 },
  /* 塗りつぶしたボタンの上に載る文字。
   * 「面の色 vs ページの背景」は測っていない。このアプリのボタンは
   * border-[3px] border-[var(--text)] で濃い枠がついており、
   * どこからどこまでがボタンかは枠で分かるため（WCAG 1.4.11 は枠でも満たせる）。
   * 実際に読めるかどうかを決めるのは、塗りの上に載る文字のほう。 */
  { label: 'ボタン panel文字 on primary', fg: 'panel', bg: 'primary', alpha: 1, min: 4.5 },
  { label: 'ボタン panel文字 on secondary', fg: 'panel', bg: 'secondary', alpha: 1, min: 4.5 },
];

const rows = [];
for (const [name, v] of Object.entries(themes)) {
  for (const c of CASES) {
    if (!v[c.fg] || !v[c.bg]) continue;
    const shown = c.alpha === 1 ? v[c.fg] : blend(v[c.fg], v[c.bg], c.alpha);
    rows.push({ theme: name, ...c, shown, bgHex: v[c.bg], r: ratio(shown, v[c.bg]) });
  }
}

const bad = rows.filter((r) => r.r < r.min);
const large = bad.filter((r) => r.r >= 3);   // 本文には足りないが、大きな文字なら通る
const hard = bad.filter((r) => r.r < 3);     // 大きな文字にしても足りない

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const line = (r) => `  ${pad(r.theme, 12)} ${pad(r.label, 26)} ${r.shown} on ${r.bgHex}  ${r.r.toFixed(2)}:1`;

console.log(`\nコントラスト実測 — テーマ ${Object.keys(themes).length}種 × ${CASES.length}通り = ${rows.length}件\n`);

if (showAll) {
  for (const r of rows) console.log(`${r.r >= r.min ? '✅' : r.r >= 3 ? '⚠️ ' : '❌'}${line(r)}`);
} else {
  if (hard.length) {
    console.log(`❌ 4.5:1 も 3:1 も割っている（大きな文字にしても足りない）— ${hard.length}件`);
    for (const r of hard) console.log(line(r));
    console.log('');
  }
  if (large.length) {
    console.log(`⚠️  4.5:1 は割るが 3:1 は満たす（大きな文字なら可・本文なら要修正）— ${large.length}件`);
    for (const r of large) console.log(line(r));
    console.log('');
  }
}

console.log(`合格 ${rows.length - bad.length} / 要確認 ${large.length} / 不足 ${hard.length}`);
/* 終了コードの決めかた
 *
 * 「本文と補足の文字」が落ちたら失敗にする。ここは opacity を直せば必ず満たせるので、
 * 落ちている＝直しわすれ。CI で止める価値がある。
 *
 * --primary / --secondary を文字に使っている箇所は、色そのものを濃くしないと満たせない。
 * これは配色の変更にあたり、改修モードの規則6で禁じられている（別途、人の判断が要る）。
 * 毎回 CI を落としても直せないので、報告だけして終了コードには反映しない。
 * 直すときは Part I §2-8 のとおり、面用と文字用の2段階を用意する。 */
/* 終了コードに反映するのは「こちらの直しかたが確立していて、落ちている＝直しわすれ」のものだけ。
 *   - 本文と補足   → opacity を上げれば必ず満たせる
 *   - 強調の文字   → --primary-d / --secondary-d を使えば満たせる
 *   - accent の上  → --on-accent を使えば満たせる
 * ボタンの塗りの上の文字は、塗りの色そのものか文字の色を変えることになり、
 * アプリの見た目が大きく変わる。人の判断が要るので報告だけにする（規則6）。 */
const textFailures = bad.filter((r) => r.bg !== 'primary' && r.bg !== 'secondary');

if (bad.length) {
  const themesBad = [...new Set(bad.map((r) => r.theme))];
  console.log(`\n関係するテーマ: ${themesBad.join(', ')}`);
  const textCases = bad.filter((r) => r.fg === 'text' && r.alpha < 1);
  if (textCases.length) {
    console.log('補足の文字が落ちている → opacity を上げれば直る（配色は据えおきでよい）。');
  } else {
    console.log('落ちているのは「塗りつぶしたボタンの上に載る文字」だけ。');
    console.log('--panel（ほぼ白）の文字を、明るい塗りの上に置いているため。');
    console.log('直すには 塗りの色を濃くするか、文字を濃い色にするかのどちらかで、');
    console.log('どちらもアプリの見た目が変わる。人の判断が要るため報告に留めている（規則6）。');
  }
}

if (textFailures.length) {
  console.log(`\n本文・補足の文字が ${textFailures.length}件 基準を割っている。opacity を上げて直すこと。`);
  process.exit(1);
}
