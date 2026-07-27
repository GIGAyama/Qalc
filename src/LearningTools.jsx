import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Lightbulb, LayoutGrid, Cherry, PencilLine, Table2, Clock, Ruler, GlassWater, Circle,
  Grid3x3, PieChart, Gauge, MoveHorizontal, Shapes, Users, ListOrdered,
  Timer, ArrowLeftRight, Percent, Sigma, Sparkles, Triangle, BarChart3,
  Table, ScatterChart, GitBranch
} from 'lucide-react';

// ==========================================
// 学習補助ツール（算数ブロック・さくらんぼ計算・筆算・位取り表）
// 問題の内容（数の大きさ・演算の種類）から使えるどうぐを自動判定し、
// ゲーム中にボトムシートでさっと開けるようにする。
// ==========================================

// 「12+7」「0.2 × 3」「123×4」のような単純な2項演算をパースする
const parseArith = (qText) => {
  if (!qText) return null;
  const s = String(qText).replace(/\s/g, '').replace(/[xX*]/g, '×');
  const m = s.match(/^(\d+(?:\.\d+)?)([+\-−×÷])(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[3]);
  const op = m[2] === '−' ? '-' : m[2];
  return { a, b, op, aStr: m[1], bStr: m[3], isInt: Number.isInteger(a) && Number.isInteger(b) };
};

const extractNumbers = (qText) => (String(qText).match(/\d+(?:\.\d+)?/g) || []).slice(0, 2);

// ---- 図で見る系（時計・長さ・かさ・円）の問題文パース ----
const parseClock = (q) => {
  let m = q.match(/みじかい はりが (\d+)。ながい はりが 12/);
  if (m) return { hour: +m[1], minute: 0 };
  m = q.match(/みじかい はりが (\d+)と \d+の あいだ。ながい はりが 6/);
  if (m) return { hour: +m[1], minute: 30 };
  m = q.match(/いま (\d+)じ です/);
  if (m) return { hour: +m[1], minute: 0 };
  m = q.match(/ながい はりが 12から (\d+)まで うごきました/);
  if (m) return { minute: +m[1] * 5, noHour: true, arc: [0, +m[1] * 5] };
  m = q.match(/ながい はりが (\d+)の ところから、(\d+)つ すすみました/);
  if (m) {
    const start = +m[1] * 5;
    return { minute: (start + +m[2] * 5) % 60, noHour: true, ghostMinute: start, arc: [start, start + +m[2] * 5] };
  }
  m = q.match(/ながい はりが (\d+)の とき/);
  if (m) return { minute: +m[1] * 5, noHour: true };
  return null;
};

const parseTape = (q) => {
  let m = q.match(/(\d+)cmの テープと (\d+)cmの テープを つなぐと/);
  if (m) return { type: 'join', a: +m[1], b: +m[2] };
  m = q.match(/(\d+)cmの ひもから (\d+)cm きりとると/);
  if (m) return { type: 'cut', a: +m[1], b: +m[2] };
  return null;
};

const parseKasa = (q) => {
  let m = q.match(/(\d+)Lの 水と (\d+)Lの 水を あわせると/);
  if (m) return { type: 'join', a: +m[1], b: +m[2], unit: 'L' };
  m = q.match(/(\d+)dLの ジュースから (\d+)dL のむと/);
  if (m) return { type: 'cut', a: +m[1], b: +m[2], unit: 'dL' };
  return null;
};

const parseCircle = (q) => {
  let m = q.match(/はんけいが (\d+)cmの えん/);
  if (m) return { kind: 'radius', v: +m[1] };
  m = q.match(/ちょっけいが (\d+)cmの えん/);
  if (m) return { kind: 'diameter', v: +m[1] };
  // 6年: 円周・円の面積
  m = q.match(/半径 (\d+)cm の 円の面積/);
  if (m) return { kind: 'radius', v: +m[1], formula: '円の面積 ＝ 半径 × 半径 × 3.14' };
  m = q.match(/半径 (\d+)cm の 円周/);
  if (m) return { kind: 'radius', v: +m[1], formula: '円周 ＝ 直径 × 3.14（直径 ＝ 半径 × 2）' };
  m = q.match(/直径 (\d+)cm の 円周/);
  if (m) return { kind: 'diameter', v: +m[1], formula: '円周 ＝ 直径 × 3.14' };
  return null;
};

// 角の大きさ（4年）・図形の角（5年）
const POLY_KANJI = { 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const parseKaku = (q) => {
  const s = String(q).replace(/\s/g, '');
  let m = s.match(/^(三|四|五|六|七|八|九|十一|十二|十)角形の内角の和/) || s.match(/^正(三|四|五|六|七|八|九|十一|十二|十)角形の内角の和/);
  if (m) return { polygon: POLY_KANJI[m[1]] };
  m = s.match(/^正(三|四|五|六|七|八|九|十一|十二|十)角形の1つの角は/);
  if (m) return { polygon: POLY_KANJI[m[1]], one: true };
  if (/^直角はなんど/.test(s)) return { turn: 0.25, note: '直角 ＝ 1かいてんの 4分の1' };
  if (/^半かいてんはなんど/.test(s)) return { turn: 0.5, note: '半かいてん ＝ 直角 2つぶん' };
  if (/^1かいてんはなんど/.test(s)) return { turn: 1, note: '1かいてん ＝ 直角 4つぶん' };
  if (/^直角の半分/.test(s)) return { turn: 0.125, note: '直角(90ど)の 半分' };
  m = s.match(/^直角(\d)つぶんはなんど/);
  if (m) return { turn: +m[1] / 4, note: `直角が ${m[1]}つぶん` };
  m = s.match(/^(\d+)どは直角いくつぶん/);
  if (m) return { turn: +m[1] / 360, note: `${m[1]}どを 直角(90ど)で 分けよう`, askUnits: true };
  m = s.match(/^垂直にまじわる/);
  if (m) return { turn: 0.25, note: '垂直に まじわる ところは 直角' };
  return null;
};

// 平均（5年）: ぼうグラフを ならして 平均を つかむ
const parseHeikin = (q) => {
  const m = String(q).replace(/\s/g, '').match(/^(\d+)と(\d+)と(\d+)の平均は/);
  return m ? { values: [+m[1], +m[2], +m[3]] } : null;
};

// 小数のしくみ（4年）: 1を◯こ、0.1を◯こ…
const parseShosuShikumi = (q) => {
  const m = String(q).replace(/\s/g, '').match(/^1を(\d+)こ、0\.1を(\d+)こ(?:、0\.01を(\d+)こ)?あわせた数は/);
  if (!m) return null;
  const rows = [['一', +m[1]], ['1/10', +m[2]]];
  if (m[3]) rows.push(['1/100', +m[3]]);
  return { rows };
};

// 大きな数（4年）: 一・万・億・兆は4けたずつ
const parseOokiiKazu = (q) => {
  const m = String(q).replace(/\s/g, '').match(/^(\d+)(億|兆|万)[+\-−](\d+)(億|兆|万)は/);
  return m ? { unit: m[2] } : null;
};

// アレイ図: かけ算・わり算・あまりを「◯こずつ ◯れつ」の点の並びで見る
const parseArrayFig = (q) => {
  const s = String(q).replace(/\s/g, '');
  let m = s.match(/^(\d)×(\d)$/);
  if (m) return { per: +m[1], total: +m[1] * +m[2], caption: `${m[1]}こずつ ${m[2]}れつ ならべたよ` };
  m = s.match(/^(\d)×\?=(\d+)$/);
  if (m) return { per: +m[1], total: +m[2], caption: `${m[1]}こずつ ならべたよ。なんれつ できたかな？` };
  m = s.match(/^\?×(\d)=(\d+)$/);
  if (m && +m[2] % +m[1] === 0) return { per: +m[2] / +m[1], total: +m[2], caption: `${m[1]}れつに おなじかずずつ ならべたよ。1れつは なんこかな？` };
  m = s.match(/^(\d+)÷(\d)$/);
  if (m && +m[1] <= 90 && +m[1] % +m[2] === 0 && +m[1] / +m[2] <= 10) {
    return { per: +m[2], total: +m[1], caption: `${m[1]}こを ${m[2]}こずつ ならべたよ。なんれつ できたかな？` };
  }
  m = s.match(/^(\d+)÷(\d)のあまり$/);
  if (m && +m[1] <= 90 && Math.floor(+m[1] / +m[2]) < 10) {
    return { per: +m[2], total: +m[1], remainder: true, caption: `${m[2]}こずつ ならべると、いくつ あまるかな？` };
  }
  // 文章題（かけ算・わり算・あまり）
  m = q.match(/^1(\S+?)に (\d+)\S*? ?(?:ずつ)?[^。]*。(\d+)\1では/);
  if (m) return { per: +m[2], total: +m[2] * +m[3], caption: `1${m[1]}ぶんが ${m[2]}。それが ${m[3]}${m[1]}ぶん` };
  m = q.match(/^(\d+)この .+を (\d+)にんで おなじ/);
  if (m) return { per: +m[2], total: +m[1], caption: `${m[2]}にんに 1こずつ じゅんばんに くばると…（たてに 1にんぶん）` };
  m = q.match(/^(\d+)まいの .+を 1にんに (\d+)まいずつ/);
  if (m) return { per: +m[2], total: +m[1], caption: `${m[2]}まいずつ ならべたよ。なんれつ＝なんにんぶん かな？` };
  m = q.match(/^(\d+)こ の .+1つの はこに (\d+)こ ずつ/);
  if (m) return { per: +m[2], total: +m[1], remainder: true, caption: `${m[2]}こずつの れつが はこの かず。あまりの ぶんにも はこが いるね` };
  m = q.match(/^(\d+)にん で .+1だいに (\d+)にん/);
  if (m) return { per: +m[2], total: +m[1], remainder: true, caption: `${m[2]}にんずつの れつが くるまの かず。あまりの ひとにも くるまが いるね` };
  // かけ算のきまり（2年）
  m = s.match(/^(\d)×(\d)と答えがおなじになるのは/);
  if (m) return { per: +m[1], total: +m[1] * +m[2], caption: `${m[1]}こずつ ${m[2]}れつ。よこから みても かずは かわらないよ` };
  m = s.match(/^(\d)を(\d)こたした数はいくつ/);
  if (m) return { per: +m[1], total: +m[1] * +m[2], caption: `${m[1]}が ${m[2]}つ分。たし算は かけ算で かけるね` };
  m = s.match(/^(\d)×(\d)は(\d)×(\d)よりいくつ大きい/);
  if (m) return { per: +m[1], total: +m[1] * +m[2], caption: `1れつ ふえると ${m[1]}こ ふえるよ（したの れつが ふえたぶん）` };
  return null;
};

// 分数: 同分母・異分母のたしひき、○つに分けた1つ分、仮分数と帯分数、通分、分数と小数
const parseFraction = (q) => {
  const s = String(q).replace(/\s/g, '');
  let m = s.match(/^(\d+)\/(\d+)([+\-])(\d+)\/(\d+)$/);
  if (m) {
    const spec = { type: 'op', n1: +m[1], d1: +m[2], op: m[3], n2: +m[4], d2: +m[5] };
    if (spec.d1 <= 12 && spec.d2 <= 12 && spec.n1 <= 24 && spec.n2 <= 24) return spec;
    return null;
  }
  m = s.match(/^1([+\-])(\d+)\/(\d+)$/);
  if (m && +m[3] <= 12) return { type: 'op', n1: +m[3], d1: +m[3], op: m[1], n2: +m[2], d2: +m[3] };
  // 仮分数 ⇔ 帯分数（4年）
  m = s.match(/^(\d+)\/(\d+)を帯分数にすると/);
  if (m && +m[2] <= 12 && +m[1] <= 60) return { type: 'improper', n: +m[1], d: +m[2] };
  m = s.match(/^(\d+)と(\d+)\/(\d+)を仮分数にすると/);
  if (m && +m[3] <= 12) return { type: 'improper', n: +m[1] * +m[3] + +m[2], d: +m[3] };
  m = s.match(/^(\d+)\/(\d+)を整数にすると/);
  if (m && +m[2] <= 12 && +m[1] <= 48) return { type: 'improper', n: +m[1], d: +m[2] };
  // 通分・分数の大小（5年）
  m = s.match(/^1\/(\d+)と1\/(\d+)を通分すると/);
  if (m) return { type: 'compare', n1: 1, d1: +m[1], n2: 1, d2: +m[2], lcm: true };
  m = s.match(/^1\/(\d+)と1\/(\d+)、大きいほうは/);
  if (m) return { type: 'compare', n1: 1, d1: +m[1], n2: 1, d2: +m[2] };
  m = s.match(/^1\/(\d+)を分母が(\d+)の分数にすると/);
  if (m && +m[2] % +m[1] === 0) return { type: 'compare', n1: 1, d1: +m[1], n2: +m[2] / +m[1], d2: +m[2] };
  // 分数と小数（3・5年）
  m = s.match(/^(\d+)\/(\d+)を小数[にで](?:すると|かくと)/);
  if (m && +m[2] <= 20 && +m[1] <= +m[2]) return { type: 'toDecimal', n: +m[1], d: +m[2] };
  m = s.match(/^([\d.]+)を分数[にで](?:すると|かくと)□\/(\d+)/);
  if (m && +m[2] <= 20) return { type: 'toDecimal', n: Math.round(parseFloat(m[1]) * +m[2]), d: +m[2] };
  m = s.match(/^0\.(\d)は0\.1がいくつ分/) || s.match(/^0\.1を(\d)こあつめた数は/);
  if (m) return { type: 'toDecimal', n: +m[1], d: 10 };
  m = s.match(/^0\.1が(\d)こと0\.1が(\d)こ/);
  if (m && +m[1] + +m[2] <= 10) return { type: 'toDecimal', n: +m[1] + +m[2], d: 10 };
  m = s.match(/^(\d+)÷(\d+)を分数であらわすと/);
  if (m && +m[2] <= 12 && +m[1] <= +m[2]) return { type: 'divide', n: +m[1], d: +m[2] };
  // 約分（5年）
  m = s.match(/^(\d+)\/(\d+)を約分すると/);
  if (m && +m[2] <= 60) return { type: 'reduce', n: +m[1], d: +m[2] };
  // 分数のかけ算・わり算（6年）。面積図でみる
  const asFrac = (t) => {
    if (t.includes('/')) { const [n, d] = t.split('/'); return { n: +n, d: +d }; }
    if (t.includes('.')) { const p = t.split('.')[1].length; return { n: Math.round(parseFloat(t) * 10 ** p), d: 10 ** p }; }
    return { n: +t, d: 1 };
  };
  m = s.match(/^([\d./]+)([×÷])([\d./]+)$/);
  if (m && (m[1].includes('/') || m[3].includes('/'))) {
    const A = asFrac(m[1]); const B = asFrac(m[3]);
    const spec = { type: 'mul', op: m[2], n1: A.n, d1: A.d, n2: B.n, d2: B.d };
    // グリッドが大きくなりすぎるものは図にしない
    const cols = m[2] === '×' ? spec.d2 : spec.n2;
    const rows = spec.d1;
    if (cols >= 1 && cols <= 12 && rows >= 1 && rows <= 12 && spec.n1 <= 24) return spec;
    return null;
  }
  m = q.match(/(\d+)つに 分けた 1つ分/);
  if (m && +m[1] <= 12) return { type: 'unit', n: +m[1] };
  return null;
};

// 時こくと時間（2年）: 「9時20分の30分後」「9時20分から9時50分まで」など
const parseJikoku = (q) => {
  const s = String(q).replace(/\s/g, '');
  const norm = (h, mm) => { const t = (((h * 60 + mm) % 720) + 720) % 720; return { h: Math.floor(t / 60) || 12, m: t % 60 }; };
  let m = s.match(/^(\d+)時(\d+)分の(\d+)分後は/);
  if (m) return { type: 'clock', from: norm(+m[1], +m[2]), to: norm(+m[1], +m[2] + +m[3]), span: +m[3], ask: 'to' };
  m = s.match(/^(\d+)時(\d+)分の(\d+)分前は/);
  if (m) return { type: 'clock', from: norm(+m[1], +m[2] - +m[3]), to: norm(+m[1], +m[2]), span: +m[3], ask: 'from' };
  m = s.match(/^(\d+)時(\d+)分から(\d+)時(\d+)分までは/);
  if (m) return { type: 'clock', from: norm(+m[1], +m[2]), to: norm(+m[3], +m[4]), span: (+m[3] * 60 + +m[4]) - (+m[1] * 60 + +m[2]), ask: 'span' };
  m = s.match(/^(\d+)時から(\d+)時までは/);
  if (m) return { type: 'clock', from: norm(+m[1], 0), to: norm(+m[2], 0), span: (+m[2] - +m[1]) * 60, ask: 'span' };
  m = s.match(/^午前(\d+)時から午後(\d+)時までは/);
  if (m) return { type: 'line', fromH: +m[1], toH: (+m[2] % 12) + 12 };
  m = s.match(/^1時間(\d+)分はなん分/);
  if (m) return { type: 'convert', total: 60 + +m[1], ask: 'minutes' };
  m = s.match(/^(\d+)分は1時間なん分/);
  if (m) return { type: 'convert', total: +m[1], ask: 'rest' };
  return null;
};

// たんいのはしご: 長さ・かさ・重さ・面積・時間の単位換算
const TANI_LADDERS = [
  { label: 'ながさ', units: ['km', 'm', 'cm', 'mm'], factors: [1000, 100, 10] },
  { label: 'かさ', units: ['kL', 'L', 'dL', 'mL'], factors: [1000, 10, 100] },
  { label: 'おもさ', units: ['t', 'kg', 'g'], factors: [1000, 1000] },
  { label: 'めんせき', units: ['㎢', 'ha', 'a', '㎡', '㎠'], factors: [100, 100, 100, 10000] },
  { label: 'じかん', units: ['日', '時間', '分', '秒'], factors: [24, 60, 60] },
];
// 表記ゆれ（ひらがな）を正式な単位に読みかえる。長いものから順に取り出す
const UNIT_TOKENS = [
  ['㎢', '㎢'], ['㎡', '㎡'], ['㎠', '㎠'], ['じかん', '時間'], ['びょう', '秒'], ['にち', '日'],
  ['ha', 'ha'], ['kL', 'kL'], ['mL', 'mL'], ['dL', 'dL'], ['km', 'km'], ['mm', 'mm'], ['cm', 'cm'],
  ['kg', 'kg'], ['時間', '時間'], ['ぷん', '分'], ['ふん', '分'], ['日', '日'], ['分', '分'], ['秒', '秒'],
  ['a', 'a'], ['L', 'L'], ['m', 'm'], ['g', 'g'], ['t', 't'],
];

const parseTaniLadder = (q) => {
  let s = String(q);
  const found = [];
  for (const [token, unit] of UNIT_TOKENS) {
    if (s.includes(token)) {
      if (!found.includes(unit)) found.push(unit);
      s = s.split(token).join(' ');
    }
  }
  for (const ladder of TANI_LADDERS) {
    const hit = ladder.units.filter((u) => found.includes(u));
    if (hit.length >= 2) {
      const from = ladder.units.indexOf(hit[0]);
      const to = ladder.units.indexOf(hit[hit.length - 1]);
      return { ladder, from: Math.min(from, to), to: Math.max(from, to) };
    }
  }
  return null;
};

// 割合・単位量あたり: 二重数直線でくらべる量ともとにする量を見る
const parseWariai = (q) => {
  const s = String(q).replace(/\s/g, '');
  let m = s.match(/^(\d+)(円|人|g|m|こ|まい)の(\d+)%はなん/);
  if (m) return { kind: 'percent', base: +m[1], pct: +m[3], part: null, unit: m[2] };
  m = s.match(/^(\d+)は(\d+)のなん%？$/);
  if (m) return { kind: 'percent', base: +m[2], part: +m[1], pct: null, unit: '' };
  m = s.match(/^ある数の(\d+)%が(\d+)です/);
  if (m) return { kind: 'percent', base: null, pct: +m[1], part: +m[2], unit: '' };
  m = s.match(/^(\d+)(円|人)の(\d+)割はなん/);
  if (m) return { kind: 'percent', base: +m[1], pct: +m[3] * 10, part: null, unit: m[2], buai: +m[3] };
  m = s.match(/^割合の([\d.]+)を百分率\(%\)でこたえると/) || s.match(/^([\d.]+)→\?%$/);
  if (m) return { kind: 'percent', base: 1, pct: null, part: parseFloat(m[1]), unit: '', ratio: true };
  // 単位量あたりの大きさ
  m = s.match(/^(\d+)こで(\d+)円のおかし/);
  if (m) return { kind: 'per', count: +m[1], amount: +m[2], unitA: 'こ', unitB: '円', ask: 'per' };
  m = s.match(/^ガソリン(\d+)Lで(\d+)km走る/);
  if (m) return { kind: 'per', count: +m[1], amount: +m[2], unitA: 'L', unitB: 'km', ask: 'per' };
  m = s.match(/^面積(\d+)k㎡に(\d+)人が/);
  if (m) return { kind: 'per', count: +m[1], amount: +m[2], unitA: 'k㎡', unitB: '人', ask: 'per' };
  m = s.match(/^1mのねだんが(\d+)円のリボン。(\d+)mでは/);
  if (m) return { kind: 'per', count: +m[2], amount: null, per: +m[1], unitA: 'm', unitB: '円', ask: 'total' };
  // 歩合（割・分・厘）
  m = s.match(/^(\d+)割(?:(\d+)分)?はなん%/);
  if (m) return { kind: 'buai', pct: +m[1] * 10 + (m[2] ? +m[2] : 0) };
  m = s.match(/^(\d+)%は(?:なん割|(\d+)割なん分)/);
  if (m) return { kind: 'buai', pct: +m[1] };
  m = s.match(/^(\d+)(割|分)は小数であらわすと/);
  if (m) return { kind: 'buai', pct: m[2] === '割' ? +m[1] * 10 : +m[1] };
  m = s.match(/^(\d+)分はなん%/);
  if (m) return { kind: 'buai', pct: +m[1] };
  // 比（6年）
  m = s.match(/^(\d+):(\d+)の比の値は/);
  if (m) return { kind: 'ratio', a: +m[1], b: +m[2], mode: 'value' };
  m = s.match(/^(\d+):(\d+)=(\d+):\?$/);
  if (m) return { kind: 'ratio', a: +m[1], b: +m[2], mode: 'equal', scaled: +m[3], side: 'a' };
  m = s.match(/^(\d+):(\d+)=\?:(\d+)$/);
  if (m) return { kind: 'ratio', a: +m[1], b: +m[2], mode: 'equal', scaled: +m[3], side: 'b' };
  m = s.match(/^(\d+):(\d+)をいちばん簡単な整数の比に/);
  if (m) return { kind: 'ratio', a: +m[1], b: +m[2], mode: 'simplify' };
  return null;
};

// 倍数・約数: 数の表でぬりわけて見る
const parseBaisuu = (q) => {
  const s = String(q).replace(/\s/g, '');
  let m = s.match(/^(\d+)の倍数を小さいほうから(\d+)ばんめは/) || s.match(/^(\d+)のいちばん小さい倍数は/);
  if (m) return { kind: 'multiple', a: +m[1] };
  m = s.match(/^(\d+)の約数/);
  if (m && +m[1] <= 100) return { kind: 'divisor', a: +m[1] };
  m = s.match(/^(\d+)と(\d+)の最小公倍数は/);
  if (m) return { kind: 'multiple', a: +m[1], b: +m[2] };
  m = s.match(/^(\d+)と(\d+)の最大公約数は/);
  if (m && Math.max(+m[1], +m[2]) <= 100) return { kind: 'divisor', a: +m[1], b: +m[2] };
  m = s.match(/^1から(\d+)までに(偶数|奇数)は/);
  if (m) return { kind: 'parity', upto: +m[1], odd: m[2] === '奇数' };
  // 約分・比を簡単にする（どちらも公約数さがし）
  m = s.match(/^(\d+)\/(\d+)を約分すると/);
  if (m && +m[2] <= 100) return { kind: 'divisor', a: +m[1], b: +m[2] };
  m = s.match(/^(\d+):(\d+)をいちばん簡単な/);
  if (m && Math.max(+m[1], +m[2]) <= 100) return { kind: 'divisor', a: +m[1], b: +m[2] };
  return null;
};

// □（x）を使った式: テープ図で「なにを もとめるか」を見る
const parseShiki = (q) => {
  const s = String(q).replace(/\s/g, '').replace(/[xX]/g, '□');
  let m = s.match(/^□([+\-×÷])([\d./]+)=([\d./]+)(?:。|$)/);
  if (m) return { unknown: 'left', op: m[1], b: +m[2], c: +m[3], bStr: m[2], cStr: m[3] };
  m = s.match(/^([\d./]+)([+\-×÷])□=([\d./]+)(?:。|$)/);
  if (m) return { unknown: 'right', a: +m[1], op: m[2], c: +m[3], aStr: m[1], cStr: m[3] };
  // 変わり方（4年）: □と○を たすと ◯に なります
  m = s.match(/^□と○をたすと(\d+)になります。□が(\d+)のとき/);
  if (m) return { unknown: 'right', a: +m[2], op: '+', c: +m[1], aStr: m[2], cStr: m[1] };
  return null;
};

// 比例・反比例（6年）: 表で x と y の 対応を見る
const parseHirei = (q) => {
  const s = String(q).replace(/\s/g, '');
  const m = s.match(/^yはxに(比例|反比例)します。xが(\d+)のときyは(\d+)です。xが(\d+)のとき/);
  if (!m) return null;
  return { inverse: m[1] === '反比例', x1: +m[2], y1: +m[3], x2: +m[4] };
};

// データの代表値（6年）: ならべた 点で 中央値・最頻値を さがす
const parseData = (q) => {
  const m = String(q).match(/^([\d,\s]+) の (中央値\(メジアン\)|最頻値\(モード\))は？$/);
  if (!m) return null;
  const values = m[1].split(',').map((t) => parseInt(t.trim(), 10)).filter((v) => !Number.isNaN(v));
  if (values.length === 0) return null;
  return { values, median: m[2].startsWith('中央値') };
};

// 場合の数（6年）: 樹形図・組み合わせの表
const parseBaai = (q) => {
  const s = String(q).replace(/\s/g, '');
  let m = s.match(/^(\d+)人を1列にならべる/);
  if (m) return { kind: 'permutation', n: +m[1] };
  m = s.match(/^(\d+)人から(\d+)人をえらぶ/);
  if (m) return { kind: 'combination', n: +m[1], k: +m[2] };
  m = s.match(/^コインを(\d+)回なげます/);
  if (m) return { kind: 'coin', n: +m[1] };
  if (/^さいころを1回なげます/.test(s)) return { kind: 'dice' };
  return null;
};

// 速さ: み（道のり）・は（速さ）・じ（時間）の関係図
const parseHayasa = (q) => {
  let m = q.match(/^(時速|分速|秒速)([\d.]+)(km|m)で([\d.]+)(時間|分間|分|秒)/);
  if (m) return { speed: `${m[1]}${m[2]}${m[3]}`, time: `${m[4]}${m[5].replace('分間', '分')}`, dist: null };
  m = q.match(/^([\d.]+)(km|m)を([\d.]+)(時間|分|秒)で → (時速|分速|秒速)/);
  if (m) return { dist: `${m[1]}${m[2]}`, time: `${m[3]}${m[4]}`, speed: null };
  m = q.match(/^([\d.]+)(km|m)を((?:時速|分速|秒速)[\d.]+(?:km|m))で → \?(時間|分|秒)/);
  if (m) return { dist: `${m[1]}${m[2]}`, speed: m[3], time: null };
  return null;
};

// がい数: 四捨五入を数直線で見る
const parseGaisuLine = (q) => {
  const m = q.match(/^(\d+)を (十|百|千|万)の位までの がい数にすると？$/);
  if (!m) return null;
  const unit = { '十': 10, '百': 100, '千': 1000, '万': 10000 }[m[2]];
  return { n: +m[1], unit };
};

// 面積・体積: 図形のスケッチ
const parseZukei = (q) => {
  let m = q.match(/1辺が (\d+)cmの 正方形の 面積/);
  if (m) return { kind: 'square', a: +m[1] };
  m = q.match(/たてが (\d+)cm、よこが (\d+)cmの 長方形/);
  if (m) return { kind: 'rect', a: +m[1], b: +m[2] };
  m = q.match(/底辺 (\d+)cm、高さ (\d+)cmの 平行四辺形/);
  if (m) return { kind: 'para', b: +m[1], h: +m[2] };
  m = q.match(/底辺 (\d+)cm、高さ (\d+)cmの 三角形/);
  if (m) return { kind: 'tri', b: +m[1], h: +m[2] };
  m = q.match(/1辺が (\d+)cmの 立方体/);
  if (m) return { kind: 'cube', a: +m[1] };
  m = q.match(/たて (\d+)cm、よこ (\d+)cm、高さ (\d+)cmの 直方体/);
  if (m) return { kind: 'cuboid', a: +m[1], b: +m[2], c: +m[3] };
  m = q.match(/底面積が (\d+)㎠、高さが (\d+)cm の (角柱|円柱)/);
  if (m) return { kind: m[3] === '角柱' ? 'prism' : 'cylinder', s: +m[1], h: +m[2] };
  m = q.match(/上底 (\d+)cm、下底 (\d+)cm、高さ (\d+)cmの 台形/);
  if (m) return { kind: 'trapezoid', a: +m[1], b: +m[2], h: +m[3] };
  m = q.match(/たいかく線が (\d+)cmと (\d+)cmの ひし形/);
  if (m) return { kind: 'rhombus', p: +m[1], q: +m[2] };
  // まわりの長さ（4・5年）
  m = q.match(/たて (\d+)cm、よこ (\d+)cmの 長方形の まわりの 長さ/);
  if (m) return { kind: 'rect', a: +m[1], b: +m[2], perimeter: true };
  const POLY = { 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  m = q.match(/1辺が (\d+)cmの 正(三|四|五|六|七|八|九|十一|十二|十)角形の まわりの 長さ/);
  if (m) return { kind: 'regular', n: POLY[m[2]], a: +m[1], perimeter: true };
  m = q.match(/1辺が (\d+)cmの (正三角形|正方形|ひし形)の まわりの 長さ/);
  if (m) return { kind: 'regular', n: m[2] === '正三角形' ? 3 : 4, a: +m[1], perimeter: true, name: m[2] };
  m = q.match(/正(三|四|五|六|七|八|九|十一|十二|十)角形を 円の 中心から わけたとき/);
  if (m) return { kind: 'regular', n: POLY[m[1]], center: true };
  m = q.match(/正(三|四|五|六|七|八|九|十一|十二|十)角形の (1つの 角|内角の和|辺は)/);
  if (m) return { kind: 'regular', n: POLY[m[1]], angle: true };
  // 線対称な図形（6年）
  m = q.match(/^(正三角形|正方形|正五角形|正六角形|正八角形|長方形|ひし形|二等辺三角形)の 対称の軸/);
  if (m) return { kind: 'symmetry', shape: m[1] };
  // 拡大図（6年）
  m = q.match(/^長さ (\d+)cm の (\d+)倍の 拡大図/);
  if (m) return { kind: 'scale', a: +m[1], k: +m[2] };
  // 四角形の性質（4年）: 図をみて 辺や 角の きまりを たしかめる
  m = q.match(/^(平行四辺形|台形|ひし形|長方形|正方形)(で|の|は)/);
  if (m) return { kind: 'quad', shape: m[1] };
  m = q.match(/^四角形の たいかく線/);
  if (m) return { kind: 'quad', shape: '長方形' };
  return null;
};

// ならび: 「まえから◯ばんめ」などの順序を図で見る
const parseNarabi = (q) => {
  let m = q.match(/^まえから (\d+)ばんめ。うしろに (\d+)にん/);
  if (m) return { type: 'behind', i: +m[1], j: +m[2] };
  m = q.match(/^ひだりから (\d+)ばんめ。みぎから (\d+)ばんめ/);
  if (m) return { type: 'overlap', i: +m[1], j: +m[2] };
  m = q.match(/^(\d+)にん ならんでいます。まえから (\d+)ばんめ/);
  if (m) return { type: 'total', total: +m[1], i: +m[2] };
  return null;
};

// 計算のじゅんばん: さきに計算する部分をハイライト
const parseJunban = (q) => {
  const s = String(q).replace(/\s/g, '');
  if (!/^[\d+\-×÷().]+$/.test(s)) return null;
  if (/^\d+(?:\.\d+)?[+\-×÷]\d+(?:\.\d+)?$/.test(s)) return null; // 2項だけなら順序で迷わない
  let m = s.match(/\(([^()]+)\)/);
  if (m) return { expr: s, start: m.index, end: m.index + m[0].length, why: 'カッコの 中を さきに けいさんしよう' };
  m = s.match(/\d+(?:\.\d+)?(?:[×÷]\d+(?:\.\d+)?)+/);
  if (m && m[0].length < s.length) return { expr: s, start: m.index, end: m.index + m[0].length, why: '×と÷は ＋−より さきに けいさんしよう' };
  return null;
};

// 10フレーム: あわせて10（◯+?=10）
const parseTenFrame = (q) => {
  const s = String(q).replace(/\s/g, '');
  let m = s.match(/^(\d+)\+\?=10$/);
  if (m) return { known: +m[1] };
  m = s.match(/^\?\+(\d+)=10$/);
  if (m) return { known: +m[1] };
  return null;
};

export const TOOL_META = {
  tokei: { Icon: Clock, label: 'とけい' },
  jikoku: { Icon: Timer, label: 'じかん' },
  narabi: { Icon: Users, label: 'ならび' },
  nagasa: { Icon: Ruler, label: 'ながさ' },
  kasa: { Icon: GlassWater, label: 'かさ' },
  tani: { Icon: ArrowLeftRight, label: 'たんい' },
  en: { Icon: Circle, label: 'えん' },
  array: { Icon: Grid3x3, label: 'アレイ' },
  bunsuu: { Icon: PieChart, label: 'ぶんすう' },
  kaku: { Icon: Triangle, label: 'かく' },
  heikin: { Icon: BarChart3, label: 'へいきん' },
  hayasa: { Icon: Gauge, label: 'みはじ' },
  wariai: { Icon: Percent, label: 'わりあい' },
  baisuu: { Icon: Sigma, label: 'ばいすう' },
  shiki: { Icon: Sparkles, label: 'しき' },
  hyou: { Icon: Table, label: 'ひょう' },
  data: { Icon: ScatterChart, label: 'データ' },
  baai: { Icon: GitBranch, label: 'ばあい' },
  suchoku: { Icon: MoveHorizontal, label: 'すうちょくせん' },
  zukei: { Icon: Shapes, label: 'ずけい' },
  junban: { Icon: ListOrdered, label: 'じゅんばん' },
  blocks: { Icon: LayoutGrid, label: 'ブロック' },
  sakuranbo: { Icon: Cherry, label: 'さくらんぼ' },
  hissan: { Icon: PencilLine, label: 'ひっ算' },
  kurai: { Icon: Table2, label: 'くらい' },
};

// 問題文とコース名から、この問題で役に立つどうぐの一覧を返す
export const getAvailableTools = (courseName = '', qText = '') => {
  const p = parseArith(qText);
  const tools = [];
  // 複数ドリル選択時は「、」区切りで連結されるので、どれか1つでも低学年ドリルなら低学年向けどうぐを出す
  const isLowGrade = /(^|、)[12]年/.test(courseName);

  // 図で見る系は問題文そのものを図にするので、使えるときは先頭（初期タブ）にする
  if (parseClock(qText)) tools.push('tokei');
  if (parseJikoku(qText)) tools.push('jikoku');
  if (parseNarabi(qText)) tools.push('narabi');
  if (parseTape(qText)) tools.push('nagasa');
  if (parseKasa(qText)) tools.push('kasa');
  if (parseCircle(qText)) tools.push('en');
  if (parseArrayFig(qText)) tools.push('array');
  if (parseFraction(qText)) tools.push('bunsuu');
  if (parseKaku(qText)) tools.push('kaku');
  if (parseHeikin(qText)) tools.push('heikin');
  if (parseHayasa(qText)) tools.push('hayasa');
  if (parseWariai(qText)) tools.push('wariai');
  if (parseBaisuu(qText)) tools.push('baisuu');
  if (parseShiki(qText)) tools.push('shiki');
  if (parseHirei(qText)) tools.push('hyou');
  if (parseData(qText)) tools.push('data');
  if (parseBaai(qText)) tools.push('baai');
  if (parseGaisuLine(qText)) tools.push('suchoku');
  if (parseZukei(qText)) tools.push('zukei');
  if (parseTaniLadder(qText)) tools.push('tani');
  if (parseJunban(qText)) tools.push('junban');
  const hasGraphic = tools.length > 0;

  if (p && p.isInt && (p.op === '+' || p.op === '-')) {
    const result = p.op === '+' ? p.a + p.b : p.a - p.b;
    if (p.a <= 20 && p.b <= 20 && result >= 0 && result <= 20) tools.push('blocks');
  } else if (parseTenFrame(qText)) {
    // あわせて10（◯+?=10）は10フレーム表示のブロックを出す
    tools.push('blocks');
  } else if (!p && isLowGrade && !hasGraphic) {
    // 1・2年の文章題などは自由に数えられるブロックを出す
    tools.push('blocks');
  }

  if (p && p.isInt) {
    if (p.op === '+' && p.a < 10 && p.b < 10 && p.a + p.b > 10) tools.push('sakuranbo');
    if (p.op === '-' && p.a > 10 && p.a < 20 && p.b < 10 && p.a % 10 < p.b) tools.push('sakuranbo');
  }

  if (p) {
    if (p.isInt) {
      if ((p.op === '+' || p.op === '-') && p.a >= 10 && p.b >= 10) tools.push('hissan');
      if ((p.op === '×' || p.op === '÷') && p.a >= 10) tools.push('hissan');
    } else if (p.op === '+' || p.op === '-') {
      // 小数のたし算・ひき算は「小数点をそろえる」のがポイント（4年）
      tools.push('hissan');
    }
  }

  const nums = extractNumbers(qText);
  if (parseShosuShikumi(qText) || parseOokiiKazu(qText)) tools.push('kurai');
  else if (nums.some((n) => parseFloat(n) >= 100 || n.includes('.'))) tools.push('kurai');

  return tools;
};

const ToolHint = ({ children }) => (
  <p className="text-center text-xs font-bold text-[var(--text)] opacity-60 leading-relaxed">{children}</p>
);

// ---- 算数ブロック ----
const Block = ({ color, marked, crossed, onClick }) => (
  <button
    onClick={onClick}
    className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-lg border-2 border-[var(--text)] shadow-[0_2px_0_var(--text)] active:translate-y-[2px] active:shadow-none transition-all select-none touch-manipulation ${color} ${crossed ? 'opacity-30' : ''} ${marked ? 'ring-4 ring-[var(--accent)]' : ''}`}
  >
    {crossed && <span className="absolute inset-0 flex items-center justify-center text-xl font-black text-[var(--text)]">✕</span>}
  </button>
);

const BlockGrid = ({ count, color, states, onToggle }) => (
  <div className="grid grid-cols-5 gap-1.5 justify-items-center">
    {Array.from({ length: count }).map((_, i) => (
      <Block key={i} color={color} marked={states?.[i] === 'marked'} crossed={states?.[i] === 'crossed'} onClick={() => onToggle && onToggle(i)} />
    ))}
  </div>
);

const BlocksTool = ({ p, qText, onFx }) => {
  const [states, setStates] = useState({});
  const [freeCount, setFreeCount] = useState(5);
  const tf = !p ? parseTenFrame(qText || '') : null;

  if (tf) {
    return (
      <div className="flex flex-col items-center gap-3">
        <ToolHint>10の へやが いっぱいに なるには あと いくつかな？<br />あいている へやを タップして たしかめよう</ToolHint>
        <div className="grid grid-cols-5 gap-1.5 p-2 border-[3px] border-[var(--text)] rounded-xl bg-[var(--bg)]">
          {Array.from({ length: 10 }).map((_, i) => {
            const filled = i < tf.known;
            const marked = states[`t_${i}`];
            return (
              <button
                key={i}
                disabled={filled}
                onClick={() => { onFx?.(); setStates((s) => ({ ...s, [`t_${i}`]: !s[`t_${i}`] })); }}
                className={`w-10 h-10 rounded-lg border-2 border-[var(--text)] transition-colors touch-manipulation ${filled ? 'bg-orange-400' : marked ? 'bg-sky-400' : 'bg-[var(--panel)]'}`}
              />
            );
          })}
        </div>
        <span className="font-black text-sm text-[var(--text)] opacity-70">いま {tf.known}こ はいっているよ</span>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="flex flex-col items-center gap-4">
        <ToolHint>ブロックを ふやしたり へらしたりして かんがえよう</ToolHint>
        <div className="flex items-center gap-4">
          <button onClick={() => { onFx?.(); setFreeCount((c) => Math.max(0, c - 1)); }} className="w-14 h-14 rounded-2xl bg-[var(--bg)] border-[3px] border-[var(--text)] font-black text-3xl text-[var(--primary)] shadow-[0_3px_0_var(--text)] active:translate-y-[2px] active:shadow-none touch-manipulation">−</button>
          <div className="font-black text-4xl text-[var(--text)] w-16 text-center">{freeCount}</div>
          <button onClick={() => { onFx?.(); setFreeCount((c) => Math.min(20, c + 1)); }} className="w-14 h-14 rounded-2xl bg-[var(--bg)] border-[3px] border-[var(--text)] font-black text-3xl text-[var(--secondary)] shadow-[0_3px_0_var(--text)] active:translate-y-[2px] active:shadow-none touch-manipulation">＋</button>
        </div>
        <BlockGrid count={freeCount} color="bg-orange-400" />
      </div>
    );
  }

  const toggle = (group) => (i) => {
    onFx?.();
    const key = `${group}_${i}`;
    setStates((s) => ({ ...s, [key]: s[key] ? null : p.op === '-' && group === 'a' ? 'crossed' : 'marked' }));
  };

  if (p.op === '+') {
    return (
      <div className="flex flex-col items-center gap-4">
        <ToolHint>ブロックを タップしながら かぞえてみよう</ToolHint>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-6">
          <div className="flex flex-col items-center gap-2">
            <span className="font-black text-2xl text-orange-500">{p.a}</span>
            <BlockGrid count={p.a} color="bg-orange-400" states={Object.fromEntries(Array.from({ length: p.a }).map((_, i) => [i, states[`a_${i}`]]))} onToggle={toggle('a')} />
          </div>
          <span className="font-black text-3xl text-[var(--text)]">＋</span>
          <div className="flex flex-col items-center gap-2">
            <span className="font-black text-2xl text-sky-500">{p.b}</span>
            <BlockGrid count={p.b} color="bg-sky-400" states={Object.fromEntries(Array.from({ length: p.b }).map((_, i) => [i, states[`b_${i}`]]))} onToggle={toggle('b')} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <ToolHint>ひくかずのぶんだけ タップして けしてみよう</ToolHint>
      <div className="flex flex-col items-center gap-2">
        <span className="font-black text-2xl text-orange-500">{p.a} − {p.b}</span>
        <BlockGrid count={p.a} color="bg-orange-400" states={Object.fromEntries(Array.from({ length: p.a }).map((_, i) => [i, states[`a_${i}`]]))} onToggle={toggle('a')} />
      </div>
    </div>
  );
};

// ---- さくらんぼ計算 ----
const CherryCircle = ({ value, revealed, onReveal }) => (
  <button
    onClick={onReveal}
    className={`w-14 h-14 rounded-full border-[3px] border-[var(--text)] font-black text-2xl flex items-center justify-center shadow-[0_3px_0_var(--text)] active:translate-y-[2px] active:shadow-none transition-all touch-manipulation ${revealed ? 'bg-[var(--accent)] text-[var(--text)]' : 'bg-[var(--bg)] text-[var(--text)] opacity-70'}`}
  >
    {revealed ? value : '?'}
  </button>
);

const SakuranboTool = ({ p, onFx }) => {
  const [revealed, setRevealed] = useState([false, false]);
  if (!p) return null;

  const isAdd = p.op === '+';
  // たし算: 後ろの数を「10になる数」とのこりに分ける ／ ひき算(減加法): 前の数を10とのこりに分ける
  const split = isAdd ? [10 - p.a, p.b - (10 - p.a)] : [10, p.a - 10];
  const hint = isAdd
    ? `${p.a} は あといくつで 10 に なるかな？`
    : `10 の まとまりから ${p.b} を ひいてみよう`;

  const reveal = (i) => {
    onFx?.();
    setRevealed((r) => r.map((v, idx) => (idx === i ? true : v)));
  };

  const NumberBox = ({ n, isTarget }) => (
    <div className="flex flex-col items-center">
      <span className={`font-black text-5xl ${isTarget ? 'text-[var(--primary)]' : 'text-[var(--text)]'}`}>{n}</span>
      {isTarget && (
        <>
          <svg width="90" height="26" className="mt-1" aria-hidden="true">
            <line x1="45" y1="0" x2="16" y2="26" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
            <line x1="45" y1="0" x2="74" y2="26" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div className="flex gap-4 mt-1">
            <CherryCircle value={split[0]} revealed={revealed[0]} onReveal={() => reveal(0)} />
            <CherryCircle value={split[1]} revealed={revealed[1]} onReveal={() => reveal(1)} />
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-4">
      <ToolHint>{hint}<br />？をタップすると さくらんぼが ひらくよ</ToolHint>
      <div className="flex items-start justify-center gap-3">
        <NumberBox n={p.a} isTarget={!isAdd} />
        <span className="font-black text-4xl text-[var(--text)] mt-1">{isAdd ? '＋' : '−'}</span>
        <NumberBox n={p.b} isTarget={isAdd} />
      </div>
    </div>
  );
};

// ---- 筆算表示 ----
const HissanTool = ({ p }) => {
  if (!p) return null;
  const aStr = String(p.a);
  const bStr = String(p.b);

  const DigitCell = ({ ch }) => (
    <div className="w-10 h-12 sm:w-12 sm:h-14 flex items-center justify-center font-black text-3xl sm:text-4xl text-[var(--text)]">{ch}</div>
  );
  const EmptyCell = () => <div className="w-10 h-12 sm:w-12 sm:h-14" />;
  // 数字セルと同じ幅にして、答えのマスが けたの まっすぐ下に そろうようにする
  const AnswerCell = () => (
    <div className="w-10 h-12 sm:w-12 sm:h-14 p-0.5">
      <div className="w-full h-full rounded-lg border-2 border-dashed border-[var(--text)] opacity-40" />
    </div>
  );

  if (p.op === '÷') {
    return (
      <div className="flex flex-col items-center gap-4">
        <ToolHint>メモに かきうつして けいさんしてみよう</ToolHint>
        <div className="flex items-end">
          <span className="font-black text-4xl sm:text-5xl text-[var(--text)] pr-2 pb-1">{bStr}</span>
          <div className="border-l-4 border-t-4 border-[var(--text)] rounded-tl-lg pl-3 pt-1 pr-2">
            <span className="font-black text-4xl sm:text-5xl text-[var(--text)]">{aStr}</span>
          </div>
        </div>
      </div>
    );
  }

  const DotCell = () => <div className="w-4 h-12 sm:h-14 flex items-end justify-center pb-2 font-black text-3xl text-[var(--primary)] leading-none">.</div>;
  const DotSpacer = () => <div className="w-4 h-12 sm:h-14" />;

  const opChar = p.op === '×' ? '×' : p.op === '+' ? '＋' : '−';
  const split = (str) => { const [i, f = ''] = str.split('.'); return { i, f }; };
  const A = split(aStr); const B = split(bStr);
  const intW = Math.max(A.i.length, B.i.length) + 1;
  const fracW = Math.max(A.f.length, B.f.length);

  // 小数点の位置をそろえて1行分のセルを組み立てる
  const buildRow = ({ i, f }, withOp) => {
    const cells = [];
    const pad = intW - i.length;
    for (let k = 0; k < pad; k++) cells.push(withOp && k === 0 ? { t: 'op' } : { t: 'empty' });
    i.split('').forEach((ch) => cells.push({ t: 'digit', ch }));
    if (fracW > 0) {
      cells.push({ t: f ? 'dot' : 'dotSpace' });
      for (let k = 0; k < fracW; k++) cells.push(f[k] ? { t: 'digit', ch: f[k] } : { t: 'empty' });
    }
    return cells;
  };
  const renderRow = (cells) => cells.map((c, i) => {
    if (c.t === 'op') return <DigitCell key={i} ch={opChar} />;
    if (c.t === 'digit') return <DigitCell key={i} ch={c.ch} />;
    if (c.t === 'dot') return <DotCell key={i} />;
    if (c.t === 'dotSpace') return <DotSpacer key={i} />;
    return <EmptyCell key={i} />;
  });

  const answerLen = p.op === '×' ? Math.max(String(p.a * p.b).length, intW) : intW;
  const hint = fracW > 0
    ? '小数点を たてに そろえて かこう。答えの 小数点も 同じ ところ'
    : 'メモに かきうつして けいさんしてみよう';

  return (
    <div className="flex flex-col items-center gap-4">
      <ToolHint>{hint}</ToolHint>
      <div className="inline-flex flex-col bg-[var(--bg)] rounded-2xl border-2 border-[var(--text)] px-4 py-3">
        <div className="flex">{renderRow(buildRow(A, false))}</div>
        <div className="flex border-b-4 border-[var(--text)] pb-1">{renderRow(buildRow(B, true))}</div>
        <div className="flex justify-end pt-1">
          {Array.from({ length: answerLen }).map((_, i) => <AnswerCell key={`a${i}`} />)}
          {fracW > 0 && <DotCell />}
          {Array.from({ length: fracW }).map((_, i) => <AnswerCell key={`f${i}`} />)}
        </div>
      </div>
    </div>
  );
};

// ---- 位取り表 ----
const INT_LABELS = ['億', '千万', '百万', '十万', '万', '千', '百', '十', '一'];
const FRAC_LABELS = ['1/10', '1/100', '1/1000'];

// 大きな数（万・億・兆）は4けたずつ区切ると読みやすい
const OokiiKazuView = ({ unit }) => {
  const groups = [['兆', '一千兆〜一兆'], ['億', '一千億〜一億'], ['万', '一千万〜一万'], ['一', '千〜一']];
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>「一・万・億・兆」は 4けたずつ。<br />おなじ たんい どうしは、そのまま たしひきできるよ</ToolHint>
      <div className="flex gap-1 overflow-x-auto no-scrollbar max-w-full pb-1">
        {groups.map(([g, sub]) => (
          <div key={g} className={`shrink-0 w-20 rounded-xl border-[3px] border-[var(--text)] overflow-hidden ${g === unit ? 'bg-[var(--accent)]' : 'bg-[var(--bg)] opacity-60'}`}>
            <div className="py-1 font-black text-lg text-center text-[var(--text)] border-b-2 border-[var(--text)]">{g}</div>
            <div className="flex">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="flex-1 h-8 border-r border-[var(--text)] border-opacity-40 last:border-r-0" />)}
            </div>
            <div className="py-0.5 text-[9px] font-bold text-center text-[var(--text)] opacity-70">{sub}</div>
          </div>
        ))}
      </div>
      <span className="font-black text-sm text-[var(--text)]">1{unit} の 位が {unit === '兆' ? 13 : unit === '億' ? 9 : 5}けためだよ</span>
    </div>
  );
};

// 小数のしくみ: 1が◯こ、0.1が◯こ… を位取り表にならべる
const ShosuShikumiView = ({ rows }) => (
  <div className="flex flex-col items-center gap-3">
    <ToolHint>それぞれの くらいに いくつ あるかを 表に いれてみよう</ToolHint>
    <div className="inline-flex flex-col border-2 border-[var(--text)] rounded-xl overflow-hidden">
      <div className="flex bg-[var(--bg)]">
        {rows.map(([label]) => (
          <div key={label} className="w-16 py-1.5 border border-[var(--text)] text-center font-bold text-xs text-[var(--text)]">{label}の位</div>
        ))}
      </div>
      <div className="flex">
        {rows.map(([label, count], i) => (
          <div key={label} className={`w-16 h-14 border border-[var(--text)] flex items-center justify-center font-black text-2xl text-[var(--text)] ${i === 0 ? 'bg-[var(--accent)]' : 'bg-[var(--panel)]'}`}>{count}</div>
        ))}
      </div>
    </div>
    <span className="font-black text-sm text-[var(--text)] opacity-70">一の位の つぎに 小数点を うつよ</span>
  </div>
);

const KuraiTool = ({ qText }) => {
  const shikumi = parseShosuShikumi(qText);
  if (shikumi) return <ShosuShikumiView rows={shikumi.rows} />;
  const ookii = parseOokiiKazu(qText);
  if (ookii) return <OokiiKazuView unit={ookii.unit} />;
  const nums = extractNumbers(qText);
  if (nums.length === 0) return null;

  const maxInt = Math.max(...nums.map((n) => n.split('.')[0].length), 2);
  const maxFrac = Math.max(...nums.map((n) => (n.split('.')[1] || '').length), 0);
  const intLabels = INT_LABELS.slice(Math.max(0, INT_LABELS.length - Math.min(maxInt, 9)));
  const fracLabels = FRAC_LABELS.slice(0, Math.min(maxFrac, 3));

  const cellsFor = (n) => {
    const [intPart, fracPart = ''] = n.split('.');
    const intDigits = intPart.slice(-9).padStart(intLabels.length, ' ').split('');
    const fracDigits = fracLabels.map((_, i) => fracPart[i] ?? ' ');
    return { intDigits, fracDigits };
  };

  const Cell = ({ ch, highlight }) => (
    <div className={`w-10 h-11 sm:w-12 sm:h-12 border border-[var(--text)] flex items-center justify-center font-black text-2xl text-[var(--text)] ${highlight ? 'bg-[var(--accent)]' : 'bg-[var(--panel)]'}`}>
      {ch.trim()}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>それぞれの すうじが どの「くらい」に あるか みてみよう</ToolHint>
      <div className="overflow-x-auto max-w-full pb-1">
        <div className="inline-flex flex-col border-2 border-[var(--text)] rounded-xl overflow-hidden">
          <div className="flex bg-[var(--bg)]">
            {intLabels.map((l, i) => (
              <div key={`h${i}`} className={`w-10 sm:w-12 py-1.5 border border-[var(--text)] text-center font-bold text-xs text-[var(--text)] ${l === '一' ? 'bg-[var(--accent)]' : ''}`}>{l}</div>
            ))}
            {fracLabels.length > 0 && <div className="w-4 border border-[var(--text)] bg-[var(--bg)]" />}
            {fracLabels.map((l, i) => (
              <div key={`f${i}`} className="w-10 sm:w-12 py-1.5 border border-[var(--text)] text-center font-bold text-[10px] text-[var(--text)]">{l}</div>
            ))}
          </div>
          {nums.map((n, row) => {
            const { intDigits, fracDigits } = cellsFor(n);
            return (
              <div key={row} className="flex">
                {intDigits.map((ch, i) => <Cell key={`i${i}`} ch={ch} highlight={intLabels[i] === '一' && ch.trim() !== ''} />)}
                {fracLabels.length > 0 && (
                  <div className="w-4 border border-[var(--text)] flex items-end justify-center pb-1 font-black text-[var(--text)] bg-[var(--panel)]">.</div>
                )}
                {fracDigits.map((ch, i) => <Cell key={`d${i}`} ch={ch} />)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ---- とけい（アナログ時計SVG） ----
const ClockTool = ({ spec }) => {
  if (!spec) return null;
  const cx = 100, cy = 100;
  const pt = (deg, r) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];
  const minuteDeg = (spec.minute ?? 0) * 6;
  const hourDeg = ((spec.hour ?? 0) % 12) * 30 + (spec.minute ?? 0) * 0.5;
  const [mx, my] = pt(minuteDeg, 60);
  const [hx, hy] = pt(hourDeg, 38);
  const arcPath = () => {
    const [a1, a2] = spec.arc.map((m) => m * 6);
    const [x1, y1] = pt(a1, 72); const [x2, y2] = pt(a2, 72);
    return `M ${x1} ${y1} A 72 72 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const hint = spec.arc
    ? 'ながいはりが どれだけ うごいたかな（1めもり＝5ふん）'
    : spec.noHour
      ? 'ながいはりの めもりを よもう（1めもり＝5ふん）'
      : 'みじかいはりと ながいはりを よく みよう';
  return (
    <div className="flex flex-col items-center gap-2">
      <ToolHint>{hint}</ToolHint>
      <svg viewBox="0 0 200 200" className="w-52 h-52 sm:w-60 sm:h-60" aria-label="とけい">
        <circle cx={cx} cy={cy} r={92} fill="var(--panel)" stroke="var(--text)" strokeWidth="5" />
        {Array.from({ length: 60 }).map((_, i) => {
          const major = i % 5 === 0;
          const [x1, y1] = pt(i * 6, major ? 80 : 85);
          const [x2, y2] = pt(i * 6, 89);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text)" strokeWidth={major ? 3 : 1.5} opacity={major ? 0.8 : 0.35} />;
        })}
        {Array.from({ length: 12 }).map((_, i) => {
          const [x, y] = pt((i + 1) * 30, 66);
          return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="bold" fill="var(--text)">{i + 1}</text>;
        })}
        {spec.arc && <path d={arcPath()} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" />}
        {spec.ghostMinute != null && (() => { const [gx, gy] = pt(spec.ghostMinute * 6, 60); return <line x1={cx} y1={cy} x2={gx} y2={gy} stroke="var(--secondary)" strokeWidth="5" strokeLinecap="round" strokeDasharray="6 6" opacity="0.6" />; })()}
        {!spec.noHour && <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="var(--text)" strokeWidth="9" strokeLinecap="round" />}
        <line x1={cx} y1={cy} x2={mx} y2={my} stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6} fill="var(--text)" />
      </svg>
      <div className="flex gap-4 text-xs font-bold text-[var(--text)]">
        <span className="flex items-center gap-1"><span className="inline-block w-5 h-1.5 rounded-full bg-[var(--primary)]" /> ながいはり</span>
        {!spec.noHour && <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 rounded-full bg-[var(--text)]" /> みじかいはり</span>}
        {spec.ghostMinute != null && <span className="flex items-center gap-1"><span className="inline-block w-5 h-1.5 rounded-full bg-[var(--secondary)] opacity-60" /> うごくまえ</span>}
      </div>
    </div>
  );
};

// ---- ながさ（テープ図） ----
const TapeTool = ({ spec }) => {
  if (!spec) return null;
  if (spec.type === 'join') {
    const total = spec.a + spec.b;
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <ToolHint>2ほんの テープを つないだ ながさを かんがえよう</ToolHint>
        <div className="w-full max-w-sm">
          <div className="flex w-full">
            <div className="flex flex-col items-center" style={{ width: `${(spec.a / total) * 100}%` }}>
              <span className="font-black text-sm text-orange-500">{spec.a}cm</span>
              <div className="w-full h-10 bg-orange-400 border-[3px] border-[var(--text)] rounded-l-xl" />
            </div>
            <div className="flex flex-col items-center" style={{ width: `${(spec.b / total) * 100}%` }}>
              <span className="font-black text-sm text-sky-500">{spec.b}cm</span>
              <div className="w-full h-10 bg-sky-400 border-[3px] border-l-0 border-[var(--text)] rounded-r-xl" />
            </div>
          </div>
          <div className="mx-1 h-3 border-x-[3px] border-b-[3px] border-[var(--text)] rounded-b" />
          <div className="text-center font-black text-[var(--text)] mt-1">ぜんぶで ?cm</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <ToolHint>きりとった のこりの ながさを かんがえよう</ToolHint>
      <div className="w-full max-w-sm">
        <div className="text-center font-black text-[var(--text)] mb-1">はじめは {spec.a}cm</div>
        <div className="flex w-full">
          <div className="h-10 bg-orange-400 border-[3px] border-[var(--text)] rounded-l-xl flex items-center justify-center font-black text-white" style={{ width: `${((spec.a - spec.b) / spec.a) * 100}%` }}>?</div>
          <div className="h-10 bg-[var(--bg)] border-[3px] border-l-0 border-dashed border-[var(--text)] rounded-r-xl flex items-center justify-center" style={{ width: `${(spec.b / spec.a) * 100}%` }}>
            <span className="font-black text-xs text-[var(--text)] opacity-70 whitespace-nowrap">✂ {spec.b}cm</span>
          </div>
        </div>
        <div className="flex w-full text-xs font-bold text-[var(--text)] opacity-60 mt-1">
          <div className="text-center" style={{ width: `${((spec.a - spec.b) / spec.a) * 100}%` }}>のこり</div>
          <div className="text-center" style={{ width: `${(spec.b / spec.a) * 100}%` }}>きりとる</div>
        </div>
      </div>
    </div>
  );
};

// ---- かさ（ますの図） ----
const KasaBeaker = ({ value, denom, unit, drink = 0 }) => (
  <div className="flex flex-col items-center gap-1">
    <span className="font-black text-sky-500">{value}{unit}</span>
    <div className="relative w-16 h-28 border-[3px] border-t-2 border-[var(--text)] rounded-b-xl overflow-hidden bg-[var(--bg)]">
      <div className="absolute bottom-0 left-0 right-0 bg-sky-400" style={{ height: `${Math.min(100, (value / denom) * 100)}%` }}>
        {drink > 0 && (
          <div className="absolute top-0 left-0 right-0 bg-sky-200 border-b-2 border-dashed border-[var(--text)] flex items-center justify-center" style={{ height: `${(drink / value) * 100}%` }}>
            <span className="font-black text-[10px] text-[var(--text)] opacity-70">のむ</span>
          </div>
        )}
      </div>
      {/* 1単位ごとの めもり */}
      {Array.from({ length: denom - 1 }).map((_, i) => (
        <div key={i} className="absolute left-0 w-2.5 h-[2px] bg-[var(--text)] opacity-40" style={{ bottom: `${((i + 1) / denom) * 100}%` }} />
      ))}
    </div>
  </div>
);

const KasaTool = ({ spec }) => {
  if (!spec) return null;
  if (spec.type === 'join') {
    const denom = Math.max(10, spec.a, spec.b);
    return (
      <div className="flex flex-col items-center gap-3">
        <ToolHint>2つの ますの 水を あわせると どれだけかな（1めもり＝1{spec.unit}）</ToolHint>
        <div className="flex items-end gap-3">
          <KasaBeaker value={spec.a} denom={denom} unit={spec.unit} />
          <span className="font-black text-3xl text-[var(--text)] pb-10">＋</span>
          <KasaBeaker value={spec.b} denom={denom} unit={spec.unit} />
        </div>
      </div>
    );
  }
  const denom = Math.max(15, spec.a);
  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>うすい ところが のむ ぶん。のこりは どれだけかな（1めもり＝1{spec.unit}）</ToolHint>
      <KasaBeaker value={spec.a} denom={denom} unit={spec.unit} drink={spec.b} />
      <span className="font-black text-sm text-[var(--text)] opacity-70">{spec.b}{spec.unit} のむと のこりは ?{spec.unit}</span>
    </div>
  );
};

// ---- えん（半径と直径） ----
const CircleTool = ({ spec }) => {
  if (!spec) return null;
  const isRadius = spec.kind === 'radius';
  return (
    <div className="flex flex-col items-center gap-2">
      <ToolHint>{spec.formula || 'ちょっけいは はんけいの 2つぶん だよ'}</ToolHint>
      <svg viewBox="0 0 200 170" className="w-56 h-48" aria-label="えん">
        <circle cx="100" cy="90" r="70" fill="var(--bg)" stroke="var(--text)" strokeWidth="4" />
        {/* 直径（よこ） */}
        <line x1="30" y1="90" x2="170" y2="90" stroke={isRadius ? 'var(--secondary)' : 'var(--primary)'} strokeWidth="5" strokeLinecap="round" strokeDasharray={isRadius ? '7 7' : 'none'} />
        <text x="100" y="112" textAnchor="middle" fontSize="14" fontWeight="bold" fill={isRadius ? 'var(--secondary)' : 'var(--primary)'}>
          ちょっけい {isRadius ? '?' : spec.v}cm
        </text>
        {/* 半径（たて）。ラベルは線の左側に2行で置き、見切れを防ぐ */}
        <line x1="100" y1="90" x2="100" y2="20" stroke={isRadius ? 'var(--primary)' : 'var(--secondary)'} strokeWidth="5" strokeLinecap="round" strokeDasharray={isRadius ? 'none' : '7 7'} />
        <text x="93" y="44" textAnchor="end" fontSize="13" fontWeight="bold" fill={isRadius ? 'var(--primary)' : 'var(--secondary)'}>はんけい</text>
        <text x="93" y="60" textAnchor="end" fontSize="13" fontWeight="bold" fill={isRadius ? 'var(--primary)' : 'var(--secondary)'}>{isRadius ? spec.v : '?'}cm</text>
        <circle cx="100" cy="90" r="5" fill="var(--text)" />
      </svg>
    </div>
  );
};

// ---- アレイ図（かけ算・わり算の点の並び） ----
const ArrayTool = ({ spec }) => {
  if (!spec) return null;
  const fullRows = Math.floor(spec.total / spec.per);
  const rest = spec.total % spec.per;
  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>{spec.caption}</ToolHint>
      <div className="flex flex-col gap-1.5 p-3 border-[3px] border-[var(--text)] rounded-xl bg-[var(--bg)]">
        {Array.from({ length: fullRows }).map((_, r) => (
          <div key={r} className="flex gap-1.5">
            {Array.from({ length: spec.per }).map((_, c) => (
              <span key={c} className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[var(--secondary)] border-2 border-[var(--text)]" />
            ))}
          </div>
        ))}
        {rest > 0 && (
          <div className="flex gap-1.5">
            {Array.from({ length: rest }).map((_, c) => (
              <span key={c} className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 border-[var(--text)] ${spec.remainder ? 'bg-[var(--primary)]' : 'bg-[var(--secondary)]'}`} />
            ))}
          </div>
        )}
      </div>
      {spec.remainder && rest > 0 && <span className="font-black text-sm text-[var(--primary)]">あかい ●が あまりだよ</span>}
    </div>
  );
};

// ---- ぶんすう（分数バー・分けた図） ----
const FractionBar = ({ n, d, color }) => {
  const rows = [];
  let remaining = n;
  while (remaining > 0 || rows.length === 0) {
    rows.push(Math.min(d, Math.max(0, remaining)));
    remaining -= d;
    if (rows.length > 4) break;
  }
  return (
    <div className="flex flex-col gap-1 w-full max-w-[240px]">
      {rows.map((filled, r) => (
        <div key={r} className="flex w-full h-8 border-[3px] border-[var(--text)] rounded-lg overflow-hidden bg-[var(--panel)]">
          {Array.from({ length: d }).map((_, i) => (
            <div key={i} className={`flex-1 ${i < filled ? color : ''} ${i > 0 ? 'border-l-2 border-[var(--text)]' : ''}`} />
          ))}
        </div>
      ))}
    </div>
  );
};

// 仮分数 → 帯分数。1のまとまりが いくつ できるかを行で見せる
const ImproperFractionView = ({ n, d }) => {
  const whole = Math.floor(n / d);
  const rest = n % d;
  const rows = Array.from({ length: whole }, () => d).concat(rest > 0 ? [rest] : []);
  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>1つ分は {d}こ。{d}こ そろうと 1に なるよ</ToolHint>
      <div className="flex flex-col gap-1.5 w-full max-w-[260px]">
        {rows.map((filled, r) => (
          <div key={r} className="flex items-center gap-2">
            <span className={`font-black text-xs w-10 text-right ${filled === d ? 'text-[var(--primary)]' : 'text-[var(--text)] opacity-60'}`}>
              {filled === d ? '1' : `${filled}/${d}`}
            </span>
            <div className="flex flex-grow h-8 border-[3px] border-[var(--text)] rounded-lg overflow-hidden bg-[var(--panel)]">
              {Array.from({ length: d }).map((_, i) => (
                <div key={i} className={`flex-1 ${i < filled ? (filled === d ? 'bg-orange-400' : 'bg-sky-400') : ''} ${i > 0 ? 'border-l-2 border-[var(--text)]' : ''}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className="font-black text-sm text-[var(--text)]">
        {n}/{d} ＝ 1が {whole}つ{rest > 0 ? ` と のこり ${rest}/${d}` : ''}
      </span>
    </div>
  );
};

// 分数 ⇔ 小数。数直線の 0〜1 の どこに あるかで つかむ
const FractionDecimalView = ({ n, d }) => {
  const v = n / d;
  const x0 = 20; const x1 = 280;
  const px = x0 + (x1 - x0) * Math.min(1, v);
  const decStr = parseFloat(v.toPrecision(10)).toString();
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <ToolHint>1を {d}こに 分けた うちの {n}こ分。1 ÷ {d} × {n} で 小数に なるよ</ToolHint>
      <div className="flex w-full max-w-[300px] h-8 border-[3px] border-[var(--text)] rounded-lg overflow-hidden bg-[var(--panel)]">
        {Array.from({ length: d }).map((_, i) => (
          <div key={i} className={`flex-1 ${i < n ? 'bg-orange-400' : ''} ${i > 0 ? 'border-l-2 border-[var(--text)]' : ''}`} />
        ))}
      </div>
      <svg viewBox="0 0 300 60" className="w-full max-w-[300px]" aria-label="すうちょくせん">
        <line x1={x0} y1="30" x2={x1} y2="30" stroke="var(--text)" strokeWidth="3" />
        {Array.from({ length: 11 }).map((_, i) => {
          const x = x0 + ((x1 - x0) * i) / 10;
          return <line key={i} x1={x} y1={i % 5 === 0 ? 20 : 24} x2={x} y2={i % 5 === 0 ? 40 : 36} stroke="var(--text)" strokeWidth={i % 5 === 0 ? 3 : 1.5} opacity={i % 5 === 0 ? 0.9 : 0.4} />;
        })}
        <text x={x0} y="55" textAnchor="middle" fontSize="12" fontWeight="bold" fill="var(--text)">0</text>
        <text x={(x0 + x1) / 2} y="55" textAnchor="middle" fontSize="12" fontWeight="bold" fill="var(--text)" opacity="0.6">0.5</text>
        <text x={x1} y="55" textAnchor="middle" fontSize="12" fontWeight="bold" fill="var(--text)">1</text>
        <circle cx={px} cy="30" r="7" fill="var(--primary)" stroke="var(--panel)" strokeWidth="2" />
        <text x={Math.min(Math.max(px, 30), 270)} y="14" textAnchor="middle" fontSize="13" fontWeight="bold" fill="var(--primary)">{decStr}</text>
      </svg>
    </div>
  );
};

// わり算を分数で: n この ものを d 人で 分けた 1人分
const DivideFractionView = ({ n, d }) => (
  <div className="flex flex-col items-center gap-3">
    <ToolHint>{n}この ピザを {d}人で 分けると、1人分は {n}/{d}。<br />わり算は そのまま 分数に できるよ</ToolHint>
    <div className="flex flex-wrap justify-center gap-2">
      {Array.from({ length: n }).map((_, k) => (
        <svg key={k} viewBox="0 0 100 100" className="w-16 h-16">
          {Array.from({ length: d }).map((_, i) => {
            const a1 = (i / d) * 2 * Math.PI - Math.PI / 2;
            const a2 = ((i + 1) / d) * 2 * Math.PI - Math.PI / 2;
            const r = 44;
            const x1 = 50 + r * Math.cos(a1), y1 = 50 + r * Math.sin(a1);
            const x2 = 50 + r * Math.cos(a2), y2 = 50 + r * Math.sin(a2);
            return <path key={i} d={`M 50 50 L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`} fill={i === 0 ? 'var(--accent)' : 'var(--panel)'} stroke="var(--text)" strokeWidth="3" />;
          })}
        </svg>
      ))}
    </div>
    <span className="font-black text-sm text-[var(--text)] opacity-70">きいろが 1人分の 1こ分（ぜんぶで {n}こ分）</span>
  </div>
);

// 約分: 同じ長さのまま、めもりを あらくする
const ReduceFractionView = ({ n, d }) => {
  const g = (x, y) => (y === 0 ? x : g(y, x % y));
  const k = g(n, d);
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>{n}も {d}も {k} で わりきれるよ。<br />ながさは かえずに めもりを あらくしよう</ToolHint>
      <div className="flex items-center gap-3 w-full justify-center">
        <span className="font-black text-sm text-orange-500 w-14 text-right">{n}/{d}</span>
        <div className="flex h-9 w-full max-w-[240px] border-[3px] border-[var(--text)] rounded-lg overflow-hidden bg-[var(--panel)]">
          {Array.from({ length: d }).map((_, i) => (
            <div key={i} className={`flex-1 ${i < n ? 'bg-orange-400' : ''} ${i > 0 ? `border-l ${i % k === 0 ? 'border-[var(--text)] border-l-[3px]' : 'border-[var(--text)] border-opacity-30'}` : ''}`} />
          ))}
        </div>
      </div>
      <span className="font-black text-2xl text-[var(--text)]">↓ {k}こずつ まとめると</span>
      <div className="flex items-center gap-3 w-full justify-center">
        <span className="font-black text-sm text-[var(--primary)] w-14 text-right">{n / k}/{d / k}</span>
        <div className="flex h-9 w-full max-w-[240px] border-[3px] border-[var(--text)] rounded-lg overflow-hidden bg-[var(--panel)]">
          {Array.from({ length: d / k }).map((_, i) => (
            <div key={i} className={`flex-1 ${i < n / k ? 'bg-[var(--primary)]' : ''} ${i > 0 ? 'border-l-[3px] border-[var(--text)]' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
};

// 分数のかけ算・わり算を面積図で見る（÷はかける数をひっくり返す）
const FractionAreaView = ({ spec }) => {
  const flip = spec.op === '÷';
  const bn = flip ? spec.d2 : spec.n2;
  const bd = flip ? spec.n2 : spec.d2;
  const rows = spec.d1; const cols = bd;
  const fillRows = Math.min(spec.n1, rows); const fillCols = Math.min(bn, cols);
  const over = spec.n1 > rows || bn > cols; // 1をこえる分は図に入りきらない
  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>
        {flip && <>÷{spec.n2}/{spec.d2} は ×{spec.d2}/{spec.n2} と おなじ。<br /></>}
        たてに {spec.n1}/{spec.d1}、よこに {bn}/{bd}。かさなった ところが 答えだよ
      </ToolHint>
      <div className="inline-flex flex-col border-[3px] border-[var(--text)] rounded-lg overflow-hidden">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex">
            {Array.from({ length: cols }).map((_, c) => {
              const inRow = r < fillRows; const inCol = c < fillCols;
              return (
                <div
                  key={c}
                  className={`w-6 h-6 sm:w-7 sm:h-7 border border-[var(--text)] border-opacity-40 ${inRow && inCol ? 'bg-[var(--accent)]' : inRow ? 'bg-orange-300' : inCol ? 'bg-sky-300' : 'bg-[var(--panel)]'}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <span className="font-black text-sm text-[var(--text)] opacity-70">
        ぜんぶで {rows * cols}こ。きいろは {fillRows * fillCols}こ{over ? '（1をこえる分は図の外）' : ''}
      </span>
      <span className="font-black text-base text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">
        分子どうし・分母どうしを かけよう
      </span>
    </div>
  );
};

const FractionTool = ({ spec }) => {
  if (!spec) return null;
  if (spec.type === 'reduce') return <ReduceFractionView n={spec.n} d={spec.d} />;
  if (spec.type === 'mul') return <FractionAreaView spec={spec} />;
  if (spec.type === 'improper') return <ImproperFractionView n={spec.n} d={spec.d} />;
  if (spec.type === 'toDecimal') return <FractionDecimalView n={spec.n} d={spec.d} />;
  if (spec.type === 'divide') return <DivideFractionView n={spec.n} d={spec.d} />;
  if (spec.type === 'compare') {
    const g = (x, y) => (y === 0 ? x : g(y, x % y));
    const lcm = (spec.d1 * spec.d2) / g(spec.d1, spec.d2);
    return (
      <div className="flex flex-col items-center gap-3 w-full">
        <ToolHint>1めもりの 大きさが ちがうね。<br />分母を {lcm} に そろえると くらべられるよ</ToolHint>
        <div className="flex items-center gap-3 w-full justify-center">
          <span className="font-black text-lg text-orange-500 w-12 text-right">{spec.n1}/{spec.d1}</span>
          <FractionBar n={spec.n1} d={spec.d1} color="bg-orange-400" />
        </div>
        <div className="flex items-center gap-3 w-full justify-center">
          <span className="font-black text-lg text-sky-500 w-12 text-right">{spec.n2}/{spec.d2}</span>
          <FractionBar n={spec.n2} d={spec.d2} color="bg-sky-400" />
        </div>
        <div className="w-full max-w-[240px] border-t-2 border-dashed border-[var(--text)] opacity-40 my-1" />
        <div className="flex items-center gap-3 w-full justify-center">
          <span className="font-black text-xs text-[var(--text)] opacity-70 w-12 text-right">{lcm}に そろえると</span>
          <div className="flex flex-col gap-1 w-full max-w-[240px]">
            <div className="flex w-full h-6 border-[3px] border-[var(--text)] rounded-lg overflow-hidden bg-[var(--panel)]">
              {Array.from({ length: lcm }).map((_, i) => (
                <div key={i} className={`flex-1 ${i < (spec.n1 * lcm) / spec.d1 ? 'bg-orange-400' : ''} ${i > 0 ? 'border-l border-[var(--text)]' : ''}`} />
              ))}
            </div>
            <div className="flex w-full h-6 border-[3px] border-[var(--text)] rounded-lg overflow-hidden bg-[var(--panel)]">
              {Array.from({ length: lcm }).map((_, i) => (
                <div key={i} className={`flex-1 ${i < (spec.n2 * lcm) / spec.d2 ? 'bg-sky-400' : ''} ${i > 0 ? 'border-l border-[var(--text)]' : ''}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (spec.type === 'unit') {
    const r = 70;
    return (
      <div className="flex flex-col items-center gap-2">
        <ToolHint>おなじ おおきさに {spec.n}つに 分けた 1つ分だよ</ToolHint>
        <svg viewBox="0 0 180 180" className="w-44 h-44">
          {Array.from({ length: spec.n }).map((_, i) => {
            const a1 = (i / spec.n) * 2 * Math.PI - Math.PI / 2;
            const a2 = ((i + 1) / spec.n) * 2 * Math.PI - Math.PI / 2;
            const x1 = 90 + r * Math.cos(a1), y1 = 90 + r * Math.sin(a1);
            const x2 = 90 + r * Math.cos(a2), y2 = 90 + r * Math.sin(a2);
            return (
              <path key={i} d={`M 90 90 L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`} fill={i === 0 ? 'var(--accent)' : 'var(--panel)'} stroke="var(--text)" strokeWidth="3" />
            );
          })}
        </svg>
      </div>
    );
  }
  const sameD = spec.d1 === spec.d2;
  const hint = sameD
    ? (spec.op === '+' ? 'いろの ついた ところを あわせると いくつ分かな？' : 'いろの ついた ところの ちがいは いくつ分かな？')
    : '1めもりの おおきさが ちがうね。そろえてから くらべよう';
  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>{hint}</ToolHint>
      <div className="flex flex-col items-center gap-2 w-full">
        <div className="flex items-center gap-3 w-full justify-center">
          <span className="font-black text-lg text-orange-500 w-12 text-right">{spec.n1}/{spec.d1}</span>
          <FractionBar n={spec.n1} d={spec.d1} color="bg-orange-400" />
        </div>
        <span className="font-black text-2xl text-[var(--text)]">{spec.op === '+' ? '＋' : '−'}</span>
        <div className="flex items-center gap-3 w-full justify-center">
          <span className="font-black text-lg text-sky-500 w-12 text-right">{spec.n2}/{spec.d2}</span>
          <FractionBar n={spec.n2} d={spec.d2} color="bg-sky-400" />
        </div>
      </div>
    </div>
  );
};

// ---- みはじ（速さ・時間・道のりの関係図） ----
const HayasaTool = ({ spec }) => {
  if (!spec) return null;
  const Value = ({ v }) => v
    ? <tspan fontSize="12" fontWeight="bold" fill="var(--text)">{v}</tspan>
    : <tspan fontSize="18" fontWeight="bold" fill="var(--primary)">？</tspan>;
  return (
    <div className="flex flex-col items-center gap-2">
      <ToolHint>もとめたい「？」を ゆびで かくすと、つかう しきが みえるよ<br />（よこの線は ÷、たての線は ×）</ToolHint>
      <svg viewBox="0 0 200 170" className="w-52 h-44" aria-label="みはじの図">
        <circle cx="100" cy="85" r="78" fill="var(--panel)" stroke="var(--text)" strokeWidth="4" />
        <line x1="25" y1="85" x2="175" y2="85" stroke="var(--text)" strokeWidth="3" />
        <line x1="100" y1="85" x2="100" y2="162" stroke="var(--text)" strokeWidth="3" />
        <text x="100" y="45" textAnchor="middle" fontSize="20" fontWeight="bold" fill="var(--text)">み</text>
        <text x="100" y="68" textAnchor="middle"><Value v={spec.dist} /></text>
        <text x="62" y="112" textAnchor="middle" fontSize="20" fontWeight="bold" fill="var(--text)">は</text>
        <text x="62" y="136" textAnchor="middle"><Value v={spec.speed} /></text>
        <text x="138" y="112" textAnchor="middle" fontSize="20" fontWeight="bold" fill="var(--text)">じ</text>
        <text x="138" y="136" textAnchor="middle"><Value v={spec.time} /></text>
      </svg>
      <span className="text-xs font-bold text-[var(--text)] opacity-60">み＝みちのり ／ は＝はやさ ／ じ＝じかん</span>
    </div>
  );
};

// ---- すうちょくせん（がい数・四捨五入） ----
const GaisuLineTool = ({ spec }) => {
  if (!spec) return null;
  const lower = Math.floor(spec.n / spec.unit) * spec.unit;
  const upper = lower + spec.unit;
  const mid = lower + spec.unit / 2;
  const x0 = 25, x1 = 275;
  const px = x0 + (x1 - x0) * ((spec.n - lower) / spec.unit);
  const labelX = Math.min(Math.max(px, 45), 255);
  return (
    <div className="flex flex-col items-center gap-2">
      <ToolHint>まんなか（{mid.toLocaleString()}）より どっちに ちかいかな？</ToolHint>
      <svg viewBox="0 0 300 95" className="w-full max-w-sm" aria-label="すうちょくせん">
        <line x1={x0} y1="55" x2={x1} y2="55" stroke="var(--text)" strokeWidth="3" />
        {Array.from({ length: 11 }).map((_, i) => {
          const x = x0 + ((x1 - x0) * i) / 10;
          const major = i === 0 || i === 5 || i === 10;
          return <line key={i} x1={x} y1={55 - (major ? 12 : 7)} x2={x} y2={55 + (major ? 12 : 7)} stroke="var(--text)" strokeWidth={major ? 3 : 1.5} opacity={major ? 0.9 : 0.4} />;
        })}
        <text x={x0} y="86" textAnchor="middle" fontSize="13" fontWeight="bold" fill="var(--text)">{lower.toLocaleString()}</text>
        <text x={(x0 + x1) / 2} y="86" textAnchor="middle" fontSize="11" fontWeight="bold" fill="var(--text)" opacity="0.6">{mid.toLocaleString()}</text>
        <text x={x1} y="86" textAnchor="middle" fontSize="13" fontWeight="bold" fill="var(--text)">{upper.toLocaleString()}</text>
        <circle cx={px} cy="55" r="7" fill="var(--primary)" stroke="var(--panel)" strokeWidth="2" />
        <text x={labelX} y="25" textAnchor="middle" fontSize="15" fontWeight="bold" fill="var(--primary)">{spec.n.toLocaleString()}</text>
        <line x1={px} y1="30" x2={px} y2="45" stroke="var(--primary)" strokeWidth="2" />
      </svg>
    </div>
  );
};

// ---- ずけい（面積・体積のスケッチ） ----
const ZukeiTool = ({ spec }) => {
  if (!spec) return null;
  const L = ({ x, y, children, color = 'var(--text)', anchor = 'middle' }) => (
    <text x={x} y={y} textAnchor={anchor} fontSize="13" fontWeight="bold" fill={color}>{children}</text>
  );
  const dash = { stroke: 'var(--primary)', strokeWidth: 3, strokeDasharray: '6 5' };
  let body = null; let formula = '';
  if (spec.kind === 'symmetry') {
    // 線対称な図形。対称の軸を点線で かさねて 見せる
    const REG = { 正三角形: 3, 正方形: 4, 正五角形: 5, 正六角形: 6, 正八角形: 8 };
    const n = REG[spec.shape];
    formula = '半分に おって ぴったり かさなる 線が 対称の軸';
    const axesAt = (angles, pts) => (
      <>
        <polygon points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="var(--accent)" fillOpacity="0.35" stroke="var(--text)" strokeWidth="4" />
        {angles.map((a, i) => (
          <line key={i} x1={100 - 82 * Math.cos(a)} y1={78 - 82 * Math.sin(a)} x2={100 + 82 * Math.cos(a)} y2={78 + 82 * Math.sin(a)} stroke="var(--primary)" strokeWidth="2.5" strokeDasharray="6 5" />
        ))}
      </>
    );
    if (n) {
      const r = 62;
      const pts = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * 2 * Math.PI - Math.PI / 2;
        return [100 + r * Math.cos(a), 78 + r * Math.sin(a)];
      });
      body = axesAt(Array.from({ length: n }, (_, i) => -Math.PI / 2 + (i * Math.PI) / n), pts);
    } else if (spec.shape === '長方形') {
      body = axesAt([0, Math.PI / 2], [[40, 30], [160, 30], [160, 126], [40, 126]]);
    } else if (spec.shape === 'ひし形') {
      body = axesAt([0, Math.PI / 2], [[100, 18], [165, 78], [100, 138], [35, 78]]);
    } else {
      body = axesAt([Math.PI / 2], [[100, 22], [160, 130], [40, 130]]);
    }
  } else if (spec.kind === 'scale') {
    formula = `拡大図の 長さ ＝ もとの 長さ × ${spec.k}`;
    const w = Math.min(150, 30 * spec.k);
    body = (
      <>
        <rect x="20" y="95" width="30" height="24" fill="var(--secondary)" fillOpacity="0.5" stroke="var(--text)" strokeWidth="3" />
        <L x={35} y={136}>{spec.a}cm</L>
        <rect x={20} y={95 - 24 * spec.k > 8 ? 95 - 24 * spec.k : 8} width={w} height={Math.min(80, 24 * spec.k)} fill="none" stroke="var(--primary)" strokeWidth="3" strokeDasharray="7 5" />
        <L x={20 + w / 2} y={80} color="var(--primary)">{spec.k}倍に すると ?cm</L>
      </>
    );
  } else if (spec.kind === 'quad') {
    const SHAPES = {
      平行四辺形: { pts: '45,120 155,120 185,35 75,35', note: '向かい合う 辺は 2組とも 平行で 長さも 同じ' },
      台形: { pts: '35,120 165,120 135,35 70,35', note: '平行な 辺は 1組だけ' },
      ひし形: { pts: '100,25 170,78 100,131 30,78', note: '4つの 辺の 長さが ぜんぶ 同じ。たいかく線は 垂直' },
      長方形: { pts: '40,35 165,35 165,122 40,122', note: '4つの 角が ぜんぶ 直角。たいかく線の 長さは 同じ' },
      正方形: { pts: '58,32 148,32 148,122 58,122', note: '4つの 角が 直角で、4つの 辺の 長さも 同じ' },
    };
    const S = SHAPES[spec.shape] || SHAPES['長方形'];
    formula = `${spec.shape}: ${S.note}`;
    const isRight = spec.shape === '長方形' || spec.shape === '正方形';
    body = (
      <>
        <polygon points={S.pts} fill="var(--accent)" fillOpacity="0.35" stroke="var(--text)" strokeWidth="4" />
        {(spec.shape === 'ひし形' || isRight) && (
          <>
            <line x1={S.pts.split(' ')[0].split(',')[0]} y1={S.pts.split(' ')[0].split(',')[1]} x2={S.pts.split(' ')[2].split(',')[0]} y2={S.pts.split(' ')[2].split(',')[1]} stroke="var(--primary)" strokeWidth="2.5" strokeDasharray="6 5" />
            <line x1={S.pts.split(' ')[1].split(',')[0]} y1={S.pts.split(' ')[1].split(',')[1]} x2={S.pts.split(' ')[3].split(',')[0]} y2={S.pts.split(' ')[3].split(',')[1]} stroke="var(--primary)" strokeWidth="2.5" strokeDasharray="6 5" />
          </>
        )}
        {isRight && <rect x="40" y="35" width="14" height="14" fill="none" stroke="var(--primary)" strokeWidth="2.5" />}
        <L x={100} y={150}>{spec.shape}</L>
      </>
    );
  } else if (spec.kind === 'regular') {
    // 正多角形。中心から分けた図（中心角）と、まわりの長さの両方に使う
    const n = spec.n; const r = 62;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2;
      return [100 + r * Math.cos(a), 78 + r * Math.sin(a)];
    });
    formula = spec.perimeter
      ? `まわりの 長さ ＝ 1辺 × ${n}`
      : spec.center
        ? `中心の 角 ＝ 360 ÷ ${n}`
        : `内角の和 ＝ (${n} − 2) × 180`;
    body = (
      <>
        {(spec.center || !spec.perimeter) && <circle cx="100" cy="78" r={r} fill="none" stroke="var(--text)" strokeWidth="2" strokeDasharray="5 5" opacity="0.5" />}
        <polygon points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="var(--accent)" fillOpacity="0.4" stroke="var(--text)" strokeWidth="4" />
        {spec.center && pts.map(([x, y], i) => <line key={i} x1="100" y1="78" x2={x} y2={y} stroke="var(--primary)" strokeWidth="2" strokeDasharray="4 4" />)}
        {spec.center && <circle cx="100" cy="78" r="4" fill="var(--text)" />}
        {spec.center && <L x={100} y={62} color="var(--primary)">？ど</L>}
        {spec.perimeter && <L x={100} y={155}>1辺 {spec.a}cm が {n}本</L>}
      </>
    );
  } else if (spec.kind === 'trapezoid') {
    formula = '面積 ＝ (上底 ＋ 下底) × 高さ ÷ 2';
    const topW = Math.max(40, (spec.a / spec.b) * 130);
    body = (
      <>
        <polygon points={`${100 - topW / 2},30 ${100 + topW / 2},30 165,125 35,125`} fill="var(--accent)" fillOpacity="0.45" stroke="var(--text)" strokeWidth="4" />
        <line x1="70" y1="30" x2="70" y2="125" {...dash} />
        <rect x="70" y="113" width="12" height="12" fill="none" stroke="var(--primary)" strokeWidth="2" />
        <L x={100} y={22}>上底 {spec.a}cm</L>
        <L x={100} y={145}>下底 {spec.b}cm</L>
        <L x={62} y={78} color="var(--primary)" anchor="end">高さ {spec.h}cm</L>
      </>
    );
  } else if (spec.kind === 'rhombus') {
    formula = '面積 ＝ たいかく線 × たいかく線 ÷ 2';
    body = (
      <>
        <polygon points="100,20 170,78 100,136 30,78" fill="var(--accent)" fillOpacity="0.45" stroke="var(--text)" strokeWidth="4" />
        <line x1="100" y1="20" x2="100" y2="136" {...dash} />
        <line x1="30" y1="78" x2="170" y2="78" {...dash} />
        <rect x="100" y="66" width="12" height="12" fill="none" stroke="var(--primary)" strokeWidth="2" />
        <L x={106} y={44} color="var(--primary)" anchor="start">{spec.p}cm</L>
        <L x={100} y={155} color="var(--primary)">もう1本 {spec.q}cm</L>
      </>
    );
  } else if (spec.kind === 'square' || spec.kind === 'rect') {
    const isSq = spec.kind === 'square';
    const ratio = isSq ? 1 : Math.min(1.6, Math.max(0.45, spec.a / spec.b));
    const w = ratio > 1 ? 110 / ratio : 110;
    const h = ratio > 1 ? 110 : 110 * ratio;
    const x = 100 - w / 2, y = 75 - h / 2;
    formula = spec.perimeter
      ? 'まわりの 長さ ＝ (たて ＋ よこ) × 2'
      : isSq ? '面積 ＝ 1辺 × 1辺' : '面積 ＝ たて × よこ';
    body = (
      <>
        <rect x={x} y={y} width={w} height={h} fill="var(--accent)" fillOpacity={spec.perimeter ? '0.15' : '0.45'} stroke="var(--text)" strokeWidth={spec.perimeter ? 6 : 4} />
        <L x={100} y={y + h + 20}>{isSq ? `1辺 ${spec.a}cm` : `よこ ${spec.b}cm`}</L>
        <L x={x - 8} y={77} anchor="end">{isSq ? `${spec.a}cm` : `たて ${spec.a}cm`}</L>
      </>
    );
  } else if (spec.kind === 'para' || spec.kind === 'tri') {
    const isTri = spec.kind === 'tri';
    formula = isTri ? '面積 ＝ 底辺 × 高さ ÷ 2' : '面積 ＝ 底辺 × 高さ';
    body = isTri ? (
      <>
        <polygon points="45,125 175,125 120,25" fill="var(--accent)" fillOpacity="0.45" stroke="var(--text)" strokeWidth="4" />
        <line x1="120" y1="25" x2="120" y2="125" {...dash} />
        <rect x="120" y="113" width="12" height="12" fill="none" stroke="var(--primary)" strokeWidth="2" />
        <L x={110} y={145}>底辺 {spec.b}cm</L>
        <L x={128} y={70} color="var(--primary)" anchor="start">高さ {spec.h}cm</L>
      </>
    ) : (
      <>
        <polygon points="45,125 155,125 185,30 75,30" fill="var(--accent)" fillOpacity="0.45" stroke="var(--text)" strokeWidth="4" />
        <line x1="155" y1="30" x2="155" y2="125" {...dash} />
        <rect x="143" y="113" width="12" height="12" fill="none" stroke="var(--primary)" strokeWidth="2" />
        <L x={100} y={145}>底辺 {spec.b}cm</L>
        <L x={160} y={70} color="var(--primary)" anchor="start">高さ {spec.h}cm</L>
      </>
    );
  } else if (spec.kind === 'cube' || spec.kind === 'cuboid') {
    const isCube = spec.kind === 'cube';
    formula = isCube ? '体積 ＝ 1辺 × 1辺 × 1辺' : '体積 ＝ たて × よこ × 高さ';
    const [ta, yo, ta2] = isCube ? [spec.a, spec.a, spec.a] : [spec.a, spec.b, spec.c];
    body = (
      <>
        <polygon points="50,55 140,55 170,28 80,28" fill="var(--bg)" stroke="var(--text)" strokeWidth="3" />
        <polygon points="140,55 170,28 170,108 140,135" fill="var(--bg)" stroke="var(--text)" strokeWidth="3" />
        <rect x="50" y="55" width="90" height="80" fill="var(--accent)" fillOpacity="0.45" stroke="var(--text)" strokeWidth="3" />
        <L x={95} y={152}>{isCube ? `1辺 ${spec.a}cm` : `よこ ${yo}cm`}</L>
        <L x={44} y={100} anchor="end">{isCube ? `${spec.a}cm` : `高さ ${ta2}cm`}</L>
        <L x={168} y={16} anchor="middle">{isCube ? `${spec.a}cm` : `たて ${ta}cm`}</L>
      </>
    );
  } else {
    const isCyl = spec.kind === 'cylinder';
    formula = '体積 ＝ 底面積 × 高さ';
    body = isCyl ? (
      <>
        <ellipse cx="100" cy="120" rx="55" ry="16" fill="var(--accent)" fillOpacity="0.6" stroke="var(--text)" strokeWidth="3" />
        <line x1="45" y1="35" x2="45" y2="120" stroke="var(--text)" strokeWidth="3" />
        <line x1="155" y1="35" x2="155" y2="120" stroke="var(--text)" strokeWidth="3" />
        <ellipse cx="100" cy="35" rx="55" ry="16" fill="var(--panel)" stroke="var(--text)" strokeWidth="3" />
        <L x={100} y={125}>底面積 {spec.s}㎠</L>
        <L x={162} y={82} color="var(--primary)" anchor="start">高さ {spec.h}cm</L>
      </>
    ) : (
      <>
        <polygon points="55,120 145,120 175,98 85,98" fill="var(--accent)" fillOpacity="0.6" stroke="var(--text)" strokeWidth="3" />
        <polygon points="55,35 145,35 145,120 55,120" fill="var(--bg)" fillOpacity="0.7" stroke="var(--text)" strokeWidth="3" />
        <polygon points="145,35 175,13 175,98 145,120" fill="var(--bg)" fillOpacity="0.7" stroke="var(--text)" strokeWidth="3" />
        <polygon points="55,35 145,35 175,13 85,13" fill="var(--panel)" stroke="var(--text)" strokeWidth="3" />
        <L x={100} y={140}>底面積 {spec.s}㎠</L>
        <L x={180} y={65} color="var(--primary)" anchor="start">高さ {spec.h}cm</L>
      </>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <ToolHint>{formula}</ToolHint>
      <svg viewBox="-32 0 280 160" className="w-64 h-48">{body}</svg>
    </div>
  );
};

// ---- ならび（順序の図） ----
const NarabiTool = ({ spec }) => {
  if (!spec) return null;
  let people = []; let note = '';
  if (spec.type === 'behind') {
    people = [...Array(spec.i - 1).fill('plain'), 'me', ...Array(spec.j).fill('other')];
    note = `●が まえから ${spec.i}ばんめの ひと。うしろに ${spec.j}にん いるよ`;
  } else if (spec.type === 'overlap') {
    people = [...Array(spec.i - 1).fill('plain'), 'me', ...Array(spec.j - 1).fill('other')];
    note = `●は ひだりから ${spec.i}ばんめ、みぎから ${spec.j}ばんめ。かさなりに 気をつけて`;
  } else {
    people = Array.from({ length: spec.total }, (_, k) => (k === spec.i - 1 ? 'me' : 'plain'));
    note = `${spec.total}にんの うち、●が まえから ${spec.i}ばんめの ひとだよ`;
  }
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>{note}</ToolHint>
      <div className="w-full overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5 px-2 w-max mx-auto">
          <span className="text-xs font-black text-[var(--text)] opacity-60 whitespace-nowrap mr-1">{spec.type === 'overlap' ? 'ひだり→' : 'まえ→'}</span>
          {people.map((kind, k) => (
            <span key={k} className={`shrink-0 w-6 h-6 rounded-full border-2 border-[var(--text)] ${kind === 'me' ? 'bg-[var(--primary)]' : kind === 'other' ? 'bg-[var(--secondary)]' : 'bg-[var(--panel)]'}`} />
          ))}
        </div>
      </div>
    </div>
  );
};

// ---- じゅんばん（計算の順序ハイライト） ----
const JunbanTool = ({ spec }) => {
  if (!spec) return null;
  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>{spec.why}</ToolHint>
      <div className="font-black text-3xl sm:text-4xl text-[var(--text)] tracking-wide flex items-center flex-wrap justify-center">
        <span>{spec.expr.slice(0, spec.start)}</span>
        <span className="bg-[var(--accent)] border-2 border-[var(--text)] rounded-xl px-2 py-0.5 mx-0.5">{spec.expr.slice(spec.start, spec.end)}</span>
        <span>{spec.expr.slice(spec.end)}</span>
      </div>
      <span className="text-xs font-bold text-[var(--text)] opacity-60">きいろの ところから けいさんしよう</span>
    </div>
  );
};

// ---- じかん（時こくと時間） ----
const MiniClock = ({ h, m, unknown, label }) => {
  const pt = (deg, r) => [60 + r * Math.sin((deg * Math.PI) / 180), 60 - r * Math.cos((deg * Math.PI) / 180)];
  const [mx, my] = pt(m * 6, 38);
  const [hx, hy] = pt((h % 12) * 30 + m * 0.5, 24);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-black text-xs text-[var(--text)] opacity-60">{label}</span>
      <svg viewBox="0 0 120 120" className="w-24 h-24 sm:w-28 sm:h-28">
        <circle cx="60" cy="60" r="55" fill={unknown ? 'var(--bg)' : 'var(--panel)'} stroke="var(--text)" strokeWidth="4" strokeDasharray={unknown ? '6 5' : 'none'} />
        {Array.from({ length: 12 }).map((_, i) => {
          const [x1, y1] = pt(i * 30, 46); const [x2, y2] = pt(i * 30, 52);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text)" strokeWidth="2.5" opacity="0.7" />;
        })}
        {Array.from({ length: 4 }).map((_, i) => {
          const [x, y] = pt((i + 1) * 90, 38);
          return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="bold" fill="var(--text)">{(i + 1) * 3}</text>;
        })}
        {unknown ? (
          <text x="60" y="66" textAnchor="middle" fontSize="34" fontWeight="bold" fill="var(--primary)">?</text>
        ) : (
          <>
            <line x1="60" y1="60" x2={hx} y2={hy} stroke="var(--text)" strokeWidth="6" strokeLinecap="round" />
            <line x1="60" y1="60" x2={mx} y2={my} stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
            <circle cx="60" cy="60" r="4" fill="var(--text)" />
          </>
        )}
      </svg>
      <span className={`font-black text-sm ${unknown ? 'text-[var(--primary)]' : 'text-[var(--text)]'}`}>
        {unknown ? '？時？分' : `${h}時${String(m).padStart(2, '0')}分`}
      </span>
    </div>
  );
};

const JikokuTool = ({ spec }) => {
  if (!spec) return null;

  if (spec.type === 'line') {
    return (
      <div className="flex flex-col items-center gap-3 w-full">
        <ToolHint>正午（お昼の12時）を こえるよ。<br />午前の ぶんと 午後の ぶんに 分けて かぞえよう</ToolHint>
        <svg viewBox="-12 0 344 90" className="w-full max-w-sm" aria-label="じかんの直線">
          <line x1="15" y1="55" x2="305" y2="55" stroke="var(--text)" strokeWidth="3" />
          {Array.from({ length: 25 }).map((_, i) => {
            const x = 15 + (290 * i) / 24;
            const major = i % 6 === 0;
            return <line key={i} x1={x} y1={55 - (major ? 10 : 5)} x2={x} y2={55 + (major ? 10 : 5)} stroke="var(--text)" strokeWidth={major ? 3 : 1} opacity={major ? 0.9 : 0.35} />;
          })}
          {[0, 6, 12, 18, 24].map((hh) => (
            <text key={hh} x={15 + (290 * hh) / 24} y="80" textAnchor="middle" fontSize="11" fontWeight="bold" fill="var(--text)" opacity="0.7">
              {hh === 0 || hh === 24 ? 'よる12' : hh === 12 ? '正午' : hh < 12 ? `午前${hh}` : `午後${hh - 12}`}
            </text>
          ))}
          <rect x={15 + (290 * spec.fromH) / 24} y="42" width={(290 * (12 - spec.fromH)) / 24} height="13" fill="var(--secondary)" opacity="0.75" />
          <rect x={15 + (290 * 12) / 24} y="42" width={(290 * (spec.toH - 12)) / 24} height="13" fill="var(--primary)" opacity="0.75" />
          <text x="160" y="26" textAnchor="middle" fontSize="14" fontWeight="bold" fill="var(--primary)">
            午前 {12 - spec.fromH}時間 ＋ 午後 {spec.toH - 12}時間
          </text>
        </svg>
        <span className="font-black text-sm text-[var(--text)] opacity-70">2つの ぶんを たすと ぜんぶの 時間だよ</span>
      </div>
    );
  }

  if (spec.type === 'convert') {
    const hours = Math.floor(spec.total / 60);
    const rest = spec.total % 60;
    return (
      <div className="flex flex-col items-center gap-3 w-full">
        <ToolHint>1時間＝60分。60分の まとまりが いくつ できるかな？</ToolHint>
        <div className="flex flex-col gap-2 w-full max-w-sm">
          <div className="flex w-full h-10 rounded-xl border-[3px] border-[var(--text)] overflow-hidden">
            {Array.from({ length: hours }).map((_, i) => (
              <div key={i} className="bg-orange-400 border-r-[3px] border-[var(--text)] flex items-center justify-center font-black text-sm text-[var(--text)]" style={{ width: `${(60 / spec.total) * 100}%` }}>60分</div>
            ))}
            {rest > 0 && <div className="bg-sky-400 flex items-center justify-center font-black text-sm text-[var(--text)]" style={{ width: `${(rest / spec.total) * 100}%` }}>{rest}分</div>}
          </div>
          <div className="flex justify-between text-xs font-bold text-[var(--text)] opacity-70">
            <span>0分</span><span>{spec.total}分</span>
          </div>
        </div>
        <span className="font-black text-sm text-[var(--text)]">{spec.total}分 ＝ {hours}時間{rest > 0 ? ` と ${rest}分` : ''}</span>
      </div>
    );
  }

  const hint = spec.ask === 'span'
    ? 'ながいはりが どれだけ すすんだかな（1めもり＝5分）'
    : spec.ask === 'to'
      ? `はじめの 時こくから ${spec.span}分 すすめてみよう`
      : `おわりの 時こくから ${spec.span}分 もどしてみよう`;
  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>{hint}</ToolHint>
      <div className="flex items-center justify-center gap-1 sm:gap-3">
        <MiniClock h={spec.from.h} m={spec.from.m} unknown={spec.ask === 'from'} label="はじめ" />
        <div className="flex flex-col items-center pb-6">
          <span className="font-black text-sm text-[var(--primary)] whitespace-nowrap">{spec.ask === 'span' ? '？分' : `${spec.span}分`}</span>
          <span className="font-black text-2xl text-[var(--text)]">→</span>
        </div>
        <MiniClock h={spec.to.h} m={spec.to.m} unknown={spec.ask === 'to'} label="おわり" />
      </div>
    </div>
  );
};

// ---- たんい（単位のはしご） ----
const TaniTool = ({ spec }) => {
  if (!spec) return null;
  const { ladder, from, to } = spec;
  let total = 1;
  for (let i = from; i < to; i++) total *= ladder.factors[i];
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>となりの たんいへ うつるときの かけ算・わり算を たしかめよう</ToolHint>
      <div className="flex items-stretch gap-1 overflow-x-auto no-scrollbar max-w-full px-1 py-1">
        {ladder.units.map((u, i) => (
          <React.Fragment key={u}>
            {i > 0 && (
              <div className="flex flex-col items-center justify-center px-0.5 shrink-0">
                <span className={`font-black text-[10px] leading-tight ${i - 1 >= from && i <= to ? 'text-[var(--primary)]' : 'text-[var(--text)] opacity-40'}`}>×{ladder.factors[i - 1]}</span>
                <span className={`text-lg leading-none ${i - 1 >= from && i <= to ? 'text-[var(--primary)]' : 'text-[var(--text)] opacity-30'}`}>→</span>
              </div>
            )}
            <div className={`shrink-0 w-14 py-2 rounded-xl border-[3px] flex items-center justify-center font-black text-base ${i === from || i === to ? 'bg-[var(--accent)] border-[var(--text)] text-[var(--text)]' : 'bg-[var(--bg)] border-[var(--text)] border-opacity-30 text-[var(--text)] opacity-50'}`}>
              {u}
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="font-black text-lg text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-4 py-2">
        1{ladder.units[from]} ＝ {total.toLocaleString()}{ladder.units[to]}
      </div>
      <span className="text-xs font-bold text-[var(--text)] opacity-60">
        小さい たんいへは ×{total.toLocaleString()}、大きい たんいへは ÷{total.toLocaleString()}
      </span>
    </div>
  );
};

// ---- わりあい（二重数直線） ----
const DoubleNumberLine = ({ topLabel, topValues, bottomLabel, bottomValues, markRatio }) => {
  // 目もりの値は線の外がわ（上段は上・下段は下）に、ラベルは線の左に置いて重なりを防ぐ
  const x0 = 56; const x1 = 288;
  const at = (r) => x0 + (x1 - x0) * Math.min(1, Math.max(0, r));
  return (
    <svg viewBox="0 0 320 128" className="w-full max-w-sm" aria-label="二重数直線">
      <text x="2" y="52" fontSize="10" fontWeight="bold" fill="var(--text)" opacity="0.7">{topLabel}</text>
      <line x1={x0} y1="48" x2={x1} y2="48" stroke="var(--text)" strokeWidth="3" />
      <text x="2" y="96" fontSize="10" fontWeight="bold" fill="var(--text)" opacity="0.7">{bottomLabel}</text>
      <line x1={x0} y1="92" x2={x1} y2="92" stroke="var(--text)" strokeWidth="3" />
      {[0, markRatio, 1].map((r, i) => (
        <g key={i}>
          <line x1={at(r)} y1="40" x2={at(r)} y2="100" stroke={i === 1 ? 'var(--primary)' : 'var(--text)'} strokeWidth={i === 1 ? 3 : 2} opacity={i === 1 ? 1 : 0.4} strokeDasharray={i === 1 ? '5 4' : 'none'} />
          <circle cx={at(r)} cy="48" r="4" fill={i === 1 ? 'var(--primary)' : 'var(--text)'} />
          <circle cx={at(r)} cy="92" r="4" fill={i === 1 ? 'var(--primary)' : 'var(--text)'} />
        </g>
      ))}
      {[0, markRatio, 1].map((r, i) => (
        <text key={`t${i}`} x={at(r)} y="30" textAnchor="middle" fontSize="13" fontWeight="bold" fill={i === 1 ? 'var(--primary)' : 'var(--text)'}>{topValues[i]}</text>
      ))}
      {[0, markRatio, 1].map((r, i) => (
        <text key={`b${i}`} x={at(r)} y="116" textAnchor="middle" fontSize="13" fontWeight="bold" fill={i === 1 ? 'var(--primary)' : 'var(--text)'}>{bottomValues[i]}</text>
      ))}
    </svg>
  );
};

// 歩合・百分率・小数の割合の対応表
const BuaiTable = ({ pct }) => {
  // 列が多いと横にはみ出すので、代表的な値＋いま出ている値だけを見せる
  const BASE = [1, 10, 25, 50, 100];
  const list = BASE.includes(pct) ? BASE : [...BASE, pct].sort((a, b) => a - b);
  const buaiOf = (p) => {
    const w = Math.floor(p / 10); const b = Math.round(p % 10);
    return `${w > 0 ? `${w}割` : ''}${b > 0 ? `${b}分` : ''}` || '0';
  };
  const COLS = [['わりあい', (p) => parseFloat((p / 100).toFixed(4)).toString()], ['百分率', (p) => `${p}%`], ['歩合', buaiOf]];
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>1割＝10%＝0.1、1分＝1%＝0.01。<br />%を 10で わると 割、あまりが 分だよ</ToolHint>
      <div className="w-full max-w-sm overflow-x-auto no-scrollbar">
        <div className="inline-flex flex-col border-2 border-[var(--text)] rounded-xl overflow-hidden min-w-full">
          {COLS.map(([label, fn]) => (
            <div key={label} className="flex">
              <div className="w-16 shrink-0 py-1.5 px-1 border border-[var(--text)] bg-[var(--bg)] font-bold text-[10px] text-[var(--text)] flex items-center justify-center">{label}</div>
              {list.map((p) => (
                <div key={p} className={`flex-1 min-w-[48px] py-1.5 border border-[var(--text)] text-center font-black text-[11px] text-[var(--text)] ${p === pct ? 'bg-[var(--accent)]' : 'bg-[var(--panel)]'}`}>
                  {fn(p)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// 比: おなじ 大きさの まとまり いくつ分かで くらべる
const RatioView = ({ spec }) => {
  const gcd2 = (x, y) => (y === 0 ? x : gcd2(y, x % y));
  const k = gcd2(spec.a, spec.b);
  const ua = spec.a / k; const ub = spec.b / k;
  const unit = 100 / Math.max(spec.a, spec.b);
  const hint = spec.mode === 'simplify'
    ? `${spec.a}も ${spec.b}も ${k}で わりきれるね。まとまりの 数で くらべよう`
    : spec.mode === 'value'
      ? '比の値は「a ÷ b」。もとにする ほうで わるよ'
      : `どちらにも おなじ 数を かけると、比は かわらないよ（${spec.scaled / (spec.side === 'a' ? spec.a : spec.b)}倍）`;
  const Bar = ({ v, color }) => (
    <div className="flex items-center gap-2 w-full">
      <span className="font-black text-sm w-8 text-right text-[var(--text)]">{v}</span>
      <div className="flex h-8 rounded-lg border-[3px] border-[var(--text)] overflow-hidden" style={{ width: `${v * unit}%` }}>
        {Array.from({ length: v }).map((_, i) => (
          <div key={i} className={`flex-1 ${color} ${i > 0 ? (i % k === 0 ? 'border-l-[3px] border-[var(--text)]' : 'border-l border-[var(--text)] border-opacity-30') : ''}`} />
        ))}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>{hint}</ToolHint>
      <div className="flex flex-col gap-2 w-full max-w-sm">
        <Bar v={spec.a} color="bg-orange-400" />
        <Bar v={spec.b} color="bg-sky-400" />
      </div>
      <span className="font-black text-base text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">
        {spec.mode === 'value'
          ? `${spec.a} ÷ ${spec.b}`
          : spec.mode === 'equal'
            ? `？ ＝ ${spec.side === 'a' ? spec.b : spec.a} × ${spec.scaled / (spec.side === 'a' ? spec.a : spec.b)}`
            : `${spec.a}:${spec.b} ＝ ${ua}:${ub}`}
      </span>
    </div>
  );
};

const WariaiTool = ({ spec }) => {
  if (!spec) return null;
  if (spec.kind === 'buai') return <BuaiTable pct={spec.pct} />;
  if (spec.kind === 'ratio') return <RatioView spec={spec} />;

  if (spec.kind === 'per') {
    const perKnown = spec.ask === 'total';
    const per = perKnown ? spec.per : null;
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <ToolHint>
          {perKnown
            ? `1${spec.unitA}ぶんが ${per}${spec.unitB}。${spec.count}${spec.unitA}ぶんは その ${spec.count}こ分`
            : `${spec.count}${spec.unitA}ぶんを ${spec.count}で わると 1${spec.unitA}ぶんに なるよ`}
        </ToolHint>
        <DoubleNumberLine
          topLabel={spec.unitB}
          topValues={[0, perKnown ? `${per}` : '？', perKnown ? '？' : `${spec.amount}`]}
          bottomLabel={spec.unitA}
          bottomValues={[0, '1', `${spec.count}`]}
          markRatio={1 / spec.count}
        />
        <span className="font-black text-sm text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">
          {perKnown
            ? `？ ＝ ${per} × ${spec.count}`
            : `？ ＝ ${spec.amount} ÷ ${spec.count}`}
        </span>
      </div>
    );
  }

  if (spec.ratio) {
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <ToolHint>もとにする量を 100% と みるよ。<br />小数の 割合を 100倍すると 百分率(%)</ToolHint>
        <DoubleNumberLine
          topLabel="わりあい"
          topValues={[0, `${spec.part}`, '1']}
          bottomLabel="百分率"
          bottomValues={['0%', '？%', '100%']}
          markRatio={Math.min(1, spec.part)}
        />
        <span className="font-black text-sm text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">？ ＝ {spec.part} × 100</span>
      </div>
    );
  }

  const base = spec.base; const pct = spec.pct; const part = spec.part;
  const ratio = pct != null ? Math.min(1, pct / 100) : base ? Math.min(1, part / base) : 0.5;
  const hint = part == null
    ? 'もとにする量の いくつ分かな。もとにする量 × 割合 で くらべる量'
    : base == null
      ? 'もとにする量が わからないとき。くらべる量 ÷ 割合 で もとにする量'
      : 'くらべる量 ÷ もとにする量 で 割合（それを 100倍して %）';
  const shiki = part == null
    ? `？ ＝ ${base} × ${pct} ÷ 100`
    : base == null
      ? `？ ＝ ${part} ÷ ${pct} × 100`
      : `？ ＝ ${part} ÷ ${base} × 100`;
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <ToolHint>{hint}{spec.buai ? <><br />{spec.buai}割 ＝ {spec.buai * 10}%</> : null}</ToolHint>
      <DoubleNumberLine
        topLabel={spec.unit || 'りょう'}
        topValues={[0, part == null ? '？' : `${part}`, base == null ? '？' : `${base}`]}
        bottomLabel="わりあい"
        bottomValues={['0%', pct == null ? '？%' : `${pct}%`, '100%']}
        markRatio={ratio}
      />
      <span className="font-black text-sm text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">{shiki}</span>
    </div>
  );
};

// ---- かく（角の大きさ・図形の角） ----
const KakuTool = ({ spec }) => {
  if (!spec) return null;

  if (spec.polygon) {
    const n = spec.polygon; const r = 62;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2;
      return [100 + r * Math.cos(a), 80 + r * Math.sin(a)];
    });
    return (
      <div className="flex flex-col items-center gap-2">
        <ToolHint>1つの ちょうてんから 線を ひくと、三角形が {n - 2}つに 分かれるよ<br />三角形 1つの 角の 和は 180ど</ToolHint>
        <svg viewBox="0 0 200 165" className="w-52 h-44" aria-label="多角形の角">
          <polygon points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="var(--accent)" fillOpacity="0.35" stroke="var(--text)" strokeWidth="4" />
          {pts.slice(2, n - 1).map(([x, y], i) => (
            <line key={i} x1={pts[0][0]} y1={pts[0][1]} x2={x} y2={y} stroke="var(--primary)" strokeWidth="2.5" strokeDasharray="5 4" />
          ))}
          {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill="var(--text)" />)}
        </svg>
        <span className="font-black text-base text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">
          180 × {n - 2}{spec.one ? ` ÷ ${n}` : ''}
        </span>
      </div>
    );
  }

  const deg = Math.round(spec.turn * 360);
  const end = spec.turn * 2 * Math.PI - Math.PI / 2;
  const R = 66;
  const ex = 100 + R * Math.cos(end); const ey = 85 + R * Math.sin(end);
  const large = spec.turn > 0.5 ? 1 : 0;
  const arc = spec.turn >= 1
    ? `M 100 19 A ${R} ${R} 0 1 1 99.9 19`
    : `M 100 ${85 - R} A ${R} ${R} 0 ${large} 1 ${ex} ${ey}`;
  return (
    <div className="flex flex-col items-center gap-2">
      <ToolHint>{spec.note}<br />1かいてん＝360ど、直角＝90ど</ToolHint>
      <svg viewBox="0 0 200 175" className="w-52 h-44" aria-label="かくの大きさ">
        <circle cx="100" cy="85" r={R} fill="var(--panel)" stroke="var(--text)" strokeWidth="2" strokeDasharray="4 4" opacity="0.5" />
        <path d={spec.turn >= 1 ? arc : `M 100 85 L 100 ${85 - R} A ${R} ${R} 0 ${large} 1 ${ex} ${ey} Z`} fill="var(--accent)" fillOpacity="0.6" stroke="var(--primary)" strokeWidth="3" />
        {[0, 1, 2, 3].map((k) => {
          const a = (k / 4) * 2 * Math.PI - Math.PI / 2;
          return <line key={k} x1="100" y1="85" x2={100 + R * Math.cos(a)} y2={85 + R * Math.sin(a)} stroke="var(--text)" strokeWidth="2" opacity="0.4" />;
        })}
        <line x1="100" y1="85" x2="100" y2={85 - R} stroke="var(--text)" strokeWidth="4" strokeLinecap="round" />
        <line x1="100" y1="85" x2={ex} y2={ey} stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="100" cy="85" r="5" fill="var(--text)" />
        {[90, 180, 270].map((d, i) => {
          const a = (d / 360) * 2 * Math.PI - Math.PI / 2;
          return <text key={i} x={100 + (R + 13) * Math.cos(a)} y={85 + (R + 13) * Math.sin(a) + 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill="var(--text)" opacity="0.5">{d}</text>;
        })}
      </svg>
      <span className="font-black text-sm text-[var(--text)] opacity-70">
        {spec.askUnits ? `${deg}ど は 90ど いくつぶん？` : 'ぬられた ところの 大きさは？'}
      </span>
    </div>
  );
};

// ---- へいきん（ならして そろえる） ----
const HeikinTool = ({ spec }) => {
  if (!spec) return null;
  const { values } = spec;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const max = Math.max(...values, avg) * 1.15;
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <ToolHint>でこぼこを ならして、みんな 同じ 高さに すると 平均。<br />ぜんぶ たして、こ数で わろう</ToolHint>
      <div className="relative flex items-end justify-center gap-4 h-40 w-full max-w-xs border-b-[3px] border-[var(--text)]">
        {values.map((v, i) => (
          <div key={i} className="flex flex-col items-center justify-end h-full" style={{ width: '22%' }}>
            <span className="font-black text-sm text-[var(--text)] mb-1">{v}</span>
            <div className="w-full bg-orange-400 border-[3px] border-b-0 border-[var(--text)] rounded-t-lg" style={{ height: `${(v / max) * 100}%` }} />
          </div>
        ))}
        <div className="absolute left-0 right-0 border-t-[3px] border-dashed border-[var(--primary)]" style={{ bottom: `${(avg / max) * 100}%` }}>
          <span className="absolute top-1 right-0 font-black text-xs text-[var(--primary)] bg-[var(--panel)] border border-[var(--primary)] rounded px-1">ならした 高さ ＝ ？</span>
        </div>
      </div>
      <span className="font-black text-base text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">
        ？ ＝ ({values.join(' ＋ ')}) ÷ {values.length}
      </span>
    </div>
  );
};

// ---- ばいすう（倍数・約数の数の表） ----
const BaisuuTool = ({ spec }) => {
  if (!spec) return null;
  // 約数さがしは その数までで十分。倍数さがしは いくつか先まで見せる
  const max = spec.kind === 'parity' ? Math.min(spec.upto, 60)
    : spec.kind === 'divisor' ? Math.min(60, Math.max(spec.a, spec.b || 0))
      : Math.max(48, Math.min(60, (spec.b || spec.a) * 2));
  const isA = (n) => (spec.kind === 'divisor' ? spec.a % n === 0 : spec.kind === 'parity' ? (n % 2 === 1) === !!spec.odd : n % spec.a === 0);
  const isB = (n) => (!spec.b ? false : spec.kind === 'divisor' ? spec.b % n === 0 : n % spec.b === 0);
  const hint = spec.kind === 'divisor'
    ? spec.b ? `${spec.a}の 約数(オレンジ)と ${spec.b}の 約数(あお)。どちらも ぬれた 数が 公約数だよ` : `${spec.a}を わりきれる 数を さがそう`
    : spec.kind === 'parity'
      ? `${spec.odd ? '奇数' : '偶数'}に なる 数を ぬったよ`
      : spec.b ? `${spec.a}の 倍数(オレンジ)と ${spec.b}の 倍数(あお)。どちらも ぬれた 数が 公倍数だよ` : `${spec.a}ずつ ふえていく 数が 倍数だよ`;
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>{hint}</ToolHint>
      <div className="grid grid-cols-10 gap-[3px] w-full max-w-sm">
        {Array.from({ length: max }).map((_, i) => {
          const n = i + 1;
          const a = isA(n); const b = isB(n);
          const cls = a && b ? 'bg-[var(--accent)] text-[var(--text)]'
            : a ? 'bg-orange-400 text-[var(--text)]'
              : b ? 'bg-sky-400 text-[var(--text)]'
                : 'bg-[var(--bg)] text-[var(--text)] opacity-40';
          return (
            <div key={n} className={`aspect-square rounded-md border-2 border-[var(--text)] flex items-center justify-center font-black text-[11px] sm:text-xs ${cls}`}>{n}</div>
          );
        })}
      </div>
    </div>
  );
};

// ---- しき（□を使った式のテープ図） ----
const ShikiTool = ({ spec }) => {
  if (!spec) return null;
  const { op, unknown } = spec;
  let total = null; let parts = []; let hint = ''; let answer = '';

  if (op === '+') {
    total = spec.c;
    parts = unknown === 'left' ? [{ label: '□', size: null }, { label: `${spec.b}`, size: spec.b }] : [{ label: `${spec.a}`, size: spec.a }, { label: '□', size: null }];
    hint = 'ぜんぶの 大きさから わかっている ぶんを ひこう';
    answer = `□ ＝ ${spec.c} − ${unknown === 'left' ? spec.b : spec.a}`;
  } else if (op === '-' && unknown === 'left') {
    total = null;
    parts = [{ label: `${spec.c}`, size: spec.c }, { label: `${spec.b}`, size: spec.b }];
    hint = '□が ぜんぶの 大きさ。のこりと ひいた ぶんを たそう';
    answer = `□ ＝ ${spec.c} ＋ ${spec.b}`;
  } else if (op === '-') {
    total = spec.a;
    parts = [{ label: `${spec.c}`, size: spec.c }, { label: '□', size: null }];
    hint = 'ぜんぶの 大きさから のこりを ひこう';
    answer = `□ ＝ ${spec.a} − ${spec.c}`;
  } else if (op === '×') {
    const groups = unknown === 'left' ? spec.b : spec.a;
    total = spec.c;
    parts = Array.from({ length: Math.min(groups, 12) }, () => ({ label: '□', size: 1 }));
    hint = `おなじ 大きさが ${groups}つ分で ${spec.c}に なるよ`;
    answer = `□ ＝ ${spec.c} ÷ ${groups}`;
  } else {
    if (unknown === 'left') {
      total = null;
      parts = Array.from({ length: Math.min(spec.b, 12) }, () => ({ label: `${spec.c}`, size: 1 }));
      hint = `${spec.c}の まとまりが ${spec.b}つ分で □に なるよ`;
      answer = `□ ＝ ${spec.c} × ${spec.b}`;
    } else {
      total = spec.a;
      parts = Array.from({ length: Math.min(Math.round(spec.a / spec.c), 12) }, () => ({ label: `${spec.c}`, size: 1 }));
      hint = `${spec.a}を ${spec.c}ずつ 分けると、いくつ できるかな`;
      answer = `□ ＝ ${spec.a} ÷ ${spec.c}`;
    }
  }

  const known = parts.reduce((s, x) => s + (x.size || 0), 0);
  const widthOf = (x) => (x.size == null ? Math.max(18, 100 / (parts.length + 1)) : (x.size / Math.max(known, 1)) * (parts.some((y) => y.size == null) ? 70 : 100));

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>{hint}</ToolHint>
      <div className="w-full max-w-sm">
        <div className="text-center font-black text-sm text-[var(--text)] mb-1">
          ぜんたい ＝ {total == null ? '□' : total}
        </div>
        <div className="flex w-full h-12 rounded-xl border-[3px] border-[var(--text)] overflow-hidden">
          {parts.map((x, i) => (
            <div
              key={i}
              className={`flex items-center justify-center font-black text-sm ${x.label === '□' ? 'bg-[var(--primary)] text-[var(--panel)]' : 'bg-[var(--accent)] text-[var(--text)]'} ${i > 0 ? 'border-l-[3px] border-[var(--text)]' : ''}`}
              style={{ width: `${widthOf(x)}%` }}
            >
              {x.label}
            </div>
          ))}
        </div>
      </div>
      <div className="font-black text-xl text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-4 py-2">{answer}</div>
    </div>
  );
};

// ---- ひょう（比例・反比例の対応表） ----
const HireiTool = ({ spec }) => {
  if (!spec) return null;
  const k = spec.x2 / spec.x1;
  const kStr = Number.isInteger(k) ? `${k}` : `${spec.x2}/${spec.x1}`;
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>
        {spec.inverse
          ? 'xが □倍に なると、yは □分の1 倍。x × y は いつも おなじ'
          : 'xが □倍に なると、yも おなじだけ □倍に なるよ'}
      </ToolHint>
      <div className="inline-flex flex-col border-2 border-[var(--text)] rounded-xl overflow-hidden">
        <div className="flex">
          <div className="w-12 py-2 border border-[var(--text)] bg-[var(--bg)] font-black text-center text-[var(--text)]">x</div>
          <div className="w-20 py-2 border border-[var(--text)] bg-[var(--panel)] font-black text-center text-[var(--text)]">{spec.x1}</div>
          <div className="w-20 py-2 border border-[var(--text)] bg-[var(--accent)] font-black text-center text-[var(--text)]">{spec.x2}</div>
        </div>
        <div className="flex">
          <div className="w-12 py-2 border border-[var(--text)] bg-[var(--bg)] font-black text-center text-[var(--text)]">y</div>
          <div className="w-20 py-2 border border-[var(--text)] bg-[var(--panel)] font-black text-center text-[var(--text)]">{spec.y1}</div>
          <div className="w-20 py-2 border border-[var(--text)] bg-[var(--accent)] font-black text-center text-[var(--primary)]">？</div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="font-black text-sm text-[var(--text)]">よこは ×{kStr}</span>
        <span className="font-black text-base text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">
          {spec.inverse ? `？ ＝ ${spec.x1} × ${spec.y1} ÷ ${spec.x2}` : `？ ＝ ${spec.y1} × ${kStr}`}
        </span>
      </div>
    </div>
  );
};

// ---- データ（ドットプロットで代表値をさがす） ----
const DataTool = ({ spec }) => {
  if (!spec) return null;
  const sorted = [...spec.values].sort((a, b) => a - b);
  const counts = {};
  sorted.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  const midIdx = Math.floor(sorted.length / 2);
  const maxCount = Math.max(...Object.values(counts));
  const uniq = Object.keys(counts).map(Number).sort((a, b) => a - b);
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <ToolHint>
        {spec.median
          ? '小さい じゅんに ならべて、まんなかの 数を さがそう'
          : 'いちばん たくさん ある 数を さがそう'}
      </ToolHint>
      <div className="flex items-end justify-center gap-2 w-full flex-wrap">
        {uniq.map((v) => {
          const hot = spec.median ? v === sorted[midIdx] : counts[v] === maxCount;
          return (
            <div key={v} className="flex flex-col items-center gap-1">
              <div className="flex flex-col-reverse gap-1">
                {Array.from({ length: counts[v] }).map((_, i) => (
                  <span key={i} className={`w-5 h-5 rounded-full border-2 border-[var(--text)] ${hot ? 'bg-[var(--primary)]' : 'bg-[var(--secondary)]'}`} />
                ))}
              </div>
              <span className={`font-black text-sm ${hot ? 'text-[var(--primary)]' : 'text-[var(--text)] opacity-70'}`}>{v}</span>
            </div>
          );
        })}
      </div>
      <div className="w-full max-w-sm border-t-[3px] border-[var(--text)]" />
      <span className="font-black text-sm text-[var(--text)]">
        ならべると: {sorted.map((v, i) => (
          <span key={i} className={spec.median && i === midIdx ? 'text-[var(--primary)]' : ''}>{v}{i < sorted.length - 1 ? ', ' : ''}</span>
        ))}
      </span>
      <span className="text-xs font-bold text-[var(--text)] opacity-60">
        {spec.median ? `ぜんぶで ${sorted.length}こ → まんなかは ${midIdx + 1}ばんめ` : 'たかく つみあがった ところが 最頻値'}
      </span>
    </div>
  );
};

// ---- ばあい（場合の数: 樹形図・組み合わせ表） ----
const BaaiTool = ({ spec }) => {
  if (!spec) return null;

  if (spec.kind === 'permutation') {
    return (
      <div className="flex flex-col items-center gap-3">
        <ToolHint>1ばんめを きめると、2ばんめの えらび方は 1つ へるよ</ToolHint>
        <div className="flex items-center gap-1 flex-wrap justify-center">
          {Array.from({ length: spec.n }).map((_, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="font-black text-xl text-[var(--text)]">×</span>}
              <div className="w-16 rounded-xl border-[3px] border-[var(--text)] bg-[var(--bg)] overflow-hidden">
                <div className="py-1 text-[10px] font-bold text-center text-[var(--text)] opacity-70 border-b-2 border-[var(--text)]">{i + 1}ばんめ</div>
                <div className="py-2 font-black text-2xl text-center text-[var(--primary)]">{spec.n - i}</div>
              </div>
            </React.Fragment>
          ))}
        </div>
        <span className="text-xs font-bold text-[var(--text)] opacity-60">それぞれの えらび方を かけ算しよう</span>
      </div>
    );
  }

  if (spec.kind === 'combination') {
    if (spec.k === 2) {
      return (
        <div className="flex flex-col items-center gap-3">
          <ToolHint>2人の 組を 表で さがそう。<br />（A-B と B-A は おなじ 組だから、かたほうだけ）</ToolHint>
          <div className="inline-flex flex-col">
            {Array.from({ length: spec.n }).map((_, r) => (
              <div key={r} className="flex">
                {Array.from({ length: spec.n }).map((_, c) => (
                  <div key={c} className={`w-7 h-7 border border-[var(--text)] flex items-center justify-center text-[10px] font-black ${c > r ? 'bg-[var(--accent)] text-[var(--text)]' : 'bg-[var(--bg)] opacity-25'}`}>
                    {c > r ? '●' : ''}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <span className="font-black text-sm text-[var(--text)]">きいろい ●の かずが 答えだよ</span>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3">
        <ToolHint>
          {spec.n}人から {spec.k}人 えらぶのは、<br />のこる {spec.n - spec.k}人を えらぶのと おなじ こと
        </ToolHint>
        <div className="flex gap-1.5 flex-wrap justify-center max-w-xs">
          {Array.from({ length: spec.n }).map((_, i) => (
            <span key={i} className={`w-8 h-8 rounded-full border-2 border-[var(--text)] flex items-center justify-center font-black text-xs ${i < spec.k ? 'bg-[var(--accent)]' : 'bg-[var(--bg)] opacity-50'}`}>{i + 1}</span>
          ))}
        </div>
        <span className="font-black text-base text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">
          ならべ方 ÷ 同じ組の ならべ方
        </span>
      </div>
    );
  }

  if (spec.kind === 'coin') {
    const n = Math.min(spec.n, 3);
    const leaves = 2 ** n;
    const paths = Array.from({ length: leaves }, (_, i) =>
      Array.from({ length: n }, (_, k) => ((i >> (n - 1 - k)) & 1 ? '裏' : '表')).join('')
    );
    return (
      <div className="flex flex-col items-center gap-3">
        <ToolHint>1回ごとに 「表」「裏」の 2つに 分かれるよ（樹形図）</ToolHint>
        <div className="flex flex-wrap justify-center gap-1.5 max-w-xs">
          {paths.map((p) => (
            <span key={p} className="px-2 py-1 rounded-lg border-2 border-[var(--text)] bg-[var(--accent)] font-black text-xs text-[var(--text)]">{p}</span>
          ))}
        </div>
        <span className="font-black text-base text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-1.5">
          2 {Array.from({ length: n - 1 }).map(() => '× 2').join(' ')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>さいころの 目を ぜんぶ かぞえてみよう</ToolHint>
      <div className="flex gap-2 flex-wrap justify-center">
        {[1, 2, 3, 4, 5, 6].map((v) => (
          <span key={v} className="w-10 h-10 rounded-lg border-[3px] border-[var(--text)] bg-[var(--panel)] flex items-center justify-center font-black text-xl text-[var(--text)]">{v}</span>
        ))}
      </div>
    </div>
  );
};

// ---- どうぐパネル（ボトムシート） ----
export const LearningToolPanel = ({ open, onClose, courseName, qText, onFx, onToolUse }) => {
  const tools = useMemo(() => getAvailableTools(courseName, qText), [courseName, qText]);
  const [active, setActive] = useState(tools[0] || null);
  const p = useMemo(() => parseArith(qText), [qText]);

  useEffect(() => {
    if (!tools.includes(active)) setActive(tools[0] || null);
  }, [qText, tools, active]);

  // 学習ログ用: どのどうぐを見ながら解いたかを呼び出し側へ知らせる（その問題は hint 扱いになる）
  useEffect(() => {
    if (open && active) onToolUse?.(active);
  }, [open, active, onToolUse]);

  return (
    <>
      {/* 背景は常設して CSS で開閉する。AnimatePresence の終了アニメーション中も全画面の
          オーバーレイがタップを吸ってしまい、閉じた直後にどうぐボタンが反応しなくなるのを防ぐ */}
      <div
        className={`fixed inset-0 z-[75] bg-black/30 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: { type: 'spring', damping: 28, stiffness: 300 } }}
            exit={{ y: '100%', transition: { duration: 0.15, ease: 'easeIn' } }}
            className="fixed bottom-0 left-0 right-0 z-[80] mx-auto max-w-2xl bg-[var(--panel)] border-[3px] border-b-0 border-[var(--text)] rounded-t-3xl flex flex-col max-h-[70vh] shadow-[0_-4px_20px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center gap-2 p-3 pb-2 shrink-0">
              <Lightbulb size={22} className="text-[var(--secondary)] shrink-0" />
              <div className="flex gap-1.5 flex-grow overflow-x-auto no-scrollbar">
                {tools.map((t) => {
                  const { Icon, label } = TOOL_META[t];
                  return (
                    <button
                      key={t}
                      onClick={() => { onFx?.(); setActive(t); }}
                      className={`px-3 py-1.5 rounded-full font-bold text-sm whitespace-nowrap border-2 transition-colors touch-manipulation flex items-center gap-1.5 ${active === t ? 'bg-[var(--text)] text-[var(--panel)] border-[var(--text)]' : 'bg-[var(--bg)] text-[var(--text)] border-transparent'}`}
                    >
                      <Icon size={16} /> {label}
                    </button>
                  );
                })}
              </div>
              <button onClick={onClose} className="w-9 h-9 shrink-0 rounded-full bg-[var(--bg)] border-2 border-[var(--text)] flex items-center justify-center text-[var(--text)] active:scale-90 transition-transform touch-manipulation" aria-label="とじる">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-6 pt-2">
              {tools.length === 0 && (
                <p className="text-center font-bold text-[var(--text)] opacity-60 py-8">このもんだいで つかえる どうぐは ないよ</p>
              )}
              {/* key に問題文を含めて、次の問題に進んだらどうぐの状態をリセットする */}
              {active === 'tokei' && <ClockTool key={`t_${qText}`} spec={parseClock(qText)} />}
              {active === 'jikoku' && <JikokuTool key={`jk_${qText}`} spec={parseJikoku(qText)} />}
              {active === 'narabi' && <NarabiTool key={`nb_${qText}`} spec={parseNarabi(qText)} />}
              {active === 'nagasa' && <TapeTool key={`n_${qText}`} spec={parseTape(qText)} />}
              {active === 'kasa' && <KasaTool key={`ks_${qText}`} spec={parseKasa(qText)} />}
              {active === 'tani' && <TaniTool key={`tn_${qText}`} spec={parseTaniLadder(qText)} />}
              {active === 'en' && <CircleTool key={`e_${qText}`} spec={parseCircle(qText)} />}
              {active === 'array' && <ArrayTool key={`ar_${qText}`} spec={parseArrayFig(qText)} />}
              {active === 'bunsuu' && <FractionTool key={`f_${qText}`} spec={parseFraction(qText)} />}
              {active === 'kaku' && <KakuTool key={`kk_${qText}`} spec={parseKaku(qText)} />}
              {active === 'heikin' && <HeikinTool key={`hk_${qText}`} spec={parseHeikin(qText)} />}
              {active === 'hayasa' && <HayasaTool key={`hy_${qText}`} spec={parseHayasa(qText)} />}
              {active === 'wariai' && <WariaiTool key={`wa_${qText}`} spec={parseWariai(qText)} />}
              {active === 'baisuu' && <BaisuuTool key={`bs_${qText}`} spec={parseBaisuu(qText)} />}
              {active === 'shiki' && <ShikiTool key={`sk_${qText}`} spec={parseShiki(qText)} />}
              {active === 'hyou' && <HireiTool key={`hi_${qText}`} spec={parseHirei(qText)} />}
              {active === 'data' && <DataTool key={`dt_${qText}`} spec={parseData(qText)} />}
              {active === 'baai' && <BaaiTool key={`ba_${qText}`} spec={parseBaai(qText)} />}
              {active === 'suchoku' && <GaisuLineTool key={`g_${qText}`} spec={parseGaisuLine(qText)} />}
              {active === 'zukei' && <ZukeiTool key={`z_${qText}`} spec={parseZukei(qText)} />}
              {active === 'junban' && <JunbanTool key={`j_${qText}`} spec={parseJunban(qText)} />}
              {active === 'blocks' && <BlocksTool key={`b_${qText}`} qText={qText} p={p && p.isInt && (p.op === '+' || p.op === '-') ? p : null} onFx={onFx} />}
              {active === 'sakuranbo' && <SakuranboTool key={`s_${qText}`} p={p} onFx={onFx} />}
              {active === 'hissan' && <HissanTool key={`h_${qText}`} p={p} />}
              {active === 'kurai' && <KuraiTool key={`k_${qText}`} qText={qText} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
