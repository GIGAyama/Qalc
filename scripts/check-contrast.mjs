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
import { RANK_TEXT, TEAM_TEXT, TOOL_TEXT, isLightSurface } from '../src/colorTables.js';
import { RARITY_INFO } from '../src/data/shop.js';

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
  { label: 'ボタン on-primary on primary', fg: 'on-primary', bg: 'primary', alpha: 1, min: 4.5 },
  { label: 'ボタン on-secondary on secondary', fg: 'on-secondary', bg: 'secondary', alpha: 1, min: 4.5 },
];

/* ── 変数ではない色（Part I §2-8 / v5 の実測で見つかった穴）─────────────
 *
 * 上の CASES はテーマの CSS 変数どうしの組み合わせだけを測る。
 * それだけでは足りなかった。実ブラウザで測ると 110件が基準未満で、
 * 落ちたものはすべて「変数ではない色」だった。
 *
 *   JS のデータに直書きした色  RARITY_INFO / ランク / チーム / どうぐ
 *   変数に opacity を掛けたもの --primary-d 単体 4.85 → opacity-80 の中で 4.18
 *
 * 表そのものを import して測る。regex で読むと、表を直したのに
 * 検査が古いまま通る、ということが起きるため。 */
const surfaces = Object.entries(themes).map(([name, v]) => ({ name, panel: v.panel, bg: v.bg }));
const lightPanels = surfaces.filter((s) => isLightSurface(s.panel));
const darkPanels = surfaces.filter((s) => !isLightSurface(s.panel));

const tableRows = [];
/** { light, dark } の組を、明るい面・暗い面それぞれで測る */
const checkPair = (label, pair, min = 4.5) => {
  for (const s of lightPanels) {
    tableRows.push({ theme: s.name, label: `${label}（明るい面）`, min, shown: pair.light, bgHex: s.panel, r: ratio(pair.light, s.panel) });
  }
  for (const s of darkPanels) {
    tableRows.push({ theme: s.name, label: `${label}（暗い面）`, min, shown: pair.dark, bgHex: s.panel, r: ratio(pair.dark, s.panel) });
  }
};

for (const [name, pair] of Object.entries(RANK_TEXT)) checkPair(`ランク ${name}`, pair);
for (const [key, pair] of Object.entries(TEAM_TEXT)) checkPair(`チーム ${key}`, pair);
for (const [key, pair] of Object.entries(TOOL_TEXT)) checkPair(`どうぐ ${key}`, pair);

/* レアリティのバッジは「面(塗り)＋その上に載る文字」で、テーマに関係なく同じ色。
 * 塗りの色は変えず、載せる文字(on)が読めることだけを見る。 */
for (const [key, v] of Object.entries(RARITY_INFO)) {
  if (!v.on) {
    tableRows.push({ theme: '(共通)', label: `レアリティ ${key}`, min: 4.5, shown: '(文字用の色がない)', bgHex: v.color, r: 0 });
    continue;
  }
  tableRows.push({ theme: '(共通)', label: `レアリティ ${key} の文字`, min: 4.5, shown: v.on, bgHex: v.color, r: ratio(v.on, v.color) });
}

const rows = [];
for (const [name, v] of Object.entries(themes)) {
  for (const c of CASES) {
    if (!v[c.fg] || !v[c.bg]) continue;
    const shown = c.alpha === 1 ? v[c.fg] : blend(v[c.fg], v[c.bg], c.alpha);
    rows.push({ theme: name, ...c, shown, bgHex: v[c.bg], r: ratio(shown, v[c.bg]) });
  }
}

rows.push(...tableRows);

const bad = rows.filter((r) => r.r < r.min);
const large = bad.filter((r) => r.r >= 3);   // 本文には足りないが、大きな文字なら通る
const hard = bad.filter((r) => r.r < 3);     // 大きな文字にしても足りない

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const line = (r) => `  ${pad(r.theme, 12)} ${pad(r.label, 26)} ${r.shown} on ${r.bgHex}  ${r.r.toFixed(2)}:1`;

console.log(`\nコントラスト実測 — テーマ ${Object.keys(themes).length}種 × 変数 ${CASES.length}通り ＋ 変数でない色 ${tableRows.length}件 = 合計 ${rows.length}件\n`);

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
 * いまはすべての組み合わせに「文字用の色」が用意してあるので、
 * 1件でも落ちていたら直しわすれ。全部を失敗あつかいにする。
 *
 *   本文と補足     → opacity を 80% 以上にする
 *   強調の文字     → --primary-d / --secondary-d を使う
 *   accent の上    → --on-accent を使う
 *   塗りの上の文字 → --on-primary / --on-secondary を使う
 *
 * テーマを足したときは、これらの変数も一緒に足すこと。
 * 面の色（--primary そのもの）はボタンの塗りに使うだけなので、ここでは測らない。 */
const textFailures = bad;

if (bad.length) {
  const themesBad = [...new Set(bad.map((r) => r.theme))];
  console.log(`\n関係するテーマ: ${themesBad.join(', ')}`);
  console.log('直しかたは Part I §2-8 のとおり「面用と文字用の2段階」。');
  console.log('落ちている組み合わせに対応する --*-d / --on-* を、そのテーマに足すこと。');
}

if (textFailures.length) {
  console.log(`\n${textFailures.length}件が基準を割っている。文字用の色を足して直すこと。`);
  process.exit(1);
}
