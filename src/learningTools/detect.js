/* どの「かんがえるどうぐ」が使えるかの判定（LearningTools.jsx から切りだした）
 *
 * ここは問題文を読んで種類を見わけるだけで、絵は描かない。
 * どうぐの絵(ブロック・筆算・分数バーなど)は ../LearningTools.jsx にあり、
 * そちらは電球ボタンを押すまで読みこまれない（Part I §5）。
 *
 * 電球を出すかどうかは毎問きめる必要があるので、この判定だけは最初から手もとに置く。
 */
import {
  LayoutGrid, Cherry, PencilLine, Table2, Clock, Ruler, GlassWater, Circle,
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
export const parseArith = (qText) => {
  if (!qText) return null;
  const s = String(qText).replace(/\s/g, '').replace(/[xX*]/g, '×');
  const m = s.match(/^(\d+(?:\.\d+)?)([+\-−×÷])(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[3]);
  const op = m[2] === '−' ? '-' : m[2];
  return { a, b, op, aStr: m[1], bStr: m[3], isInt: Number.isInteger(a) && Number.isInteger(b) };
};

export const extractNumbers = (qText) => (String(qText).match(/\d+(?:\.\d+)?/g) || []).slice(0, 2);

// ---- 図で見る系（時計・長さ・かさ・円）の問題文パース ----
export const parseClock = (q) => {
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

export const parseTape = (q) => {
  let m = q.match(/(\d+)cmの テープと (\d+)cmの テープを つなぐと/);
  if (m) return { type: 'join', a: +m[1], b: +m[2] };
  m = q.match(/(\d+)cmの ひもから (\d+)cm きりとると/);
  if (m) return { type: 'cut', a: +m[1], b: +m[2] };
  return null;
};

export const parseKasa = (q) => {
  let m = q.match(/(\d+)Lの 水と (\d+)Lの 水を あわせると/);
  if (m) return { type: 'join', a: +m[1], b: +m[2], unit: 'L' };
  m = q.match(/(\d+)dLの ジュースから (\d+)dL のむと/);
  if (m) return { type: 'cut', a: +m[1], b: +m[2], unit: 'dL' };
  return null;
};

export const parseCircle = (q) => {
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
export const parseKaku = (q) => {
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
export const parseHeikin = (q) => {
  const m = String(q).replace(/\s/g, '').match(/^(\d+)と(\d+)と(\d+)の平均は/);
  return m ? { values: [+m[1], +m[2], +m[3]] } : null;
};

// 小数のしくみ（4年）: 1を◯こ、0.1を◯こ…
export const parseShosuShikumi = (q) => {
  const m = String(q).replace(/\s/g, '').match(/^1を(\d+)こ、0\.1を(\d+)こ(?:、0\.01を(\d+)こ)?あわせた数は/);
  if (!m) return null;
  const rows = [['一', +m[1]], ['1/10', +m[2]]];
  if (m[3]) rows.push(['1/100', +m[3]]);
  return { rows };
};

// 大きな数（4年）: 一・万・億・兆は4けたずつ
export const parseOokiiKazu = (q) => {
  const m = String(q).replace(/\s/g, '').match(/^(\d+)(億|兆|万)[+\-−](\d+)(億|兆|万)は/);
  return m ? { unit: m[2] } : null;
};

// アレイ図: かけ算・わり算・あまりを「◯こずつ ◯れつ」の点の並びで見る
export const parseArrayFig = (q) => {
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
export const parseFraction = (q) => {
  const s = String(q).replace(/\s/g, '');
  let m = s.match(/^(\d+)\/(\d+)([+-])(\d+)\/(\d+)$/);
  if (m) {
    const spec = { type: 'op', n1: +m[1], d1: +m[2], op: m[3], n2: +m[4], d2: +m[5] };
    if (spec.d1 <= 12 && spec.d2 <= 12 && spec.n1 <= 24 && spec.n2 <= 24) return spec;
    return null;
  }
  m = s.match(/^1([+-])(\d+)\/(\d+)$/);
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
export const parseJikoku = (q) => {
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

export const parseTaniLadder = (q) => {
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
export const parseWariai = (q) => {
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
export const parseBaisuu = (q) => {
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
export const parseShiki = (q) => {
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
export const parseHirei = (q) => {
  const s = String(q).replace(/\s/g, '');
  const m = s.match(/^yはxに(比例|反比例)します。xが(\d+)のときyは(\d+)です。xが(\d+)のとき/);
  if (!m) return null;
  return { inverse: m[1] === '反比例', x1: +m[2], y1: +m[3], x2: +m[4] };
};

// データの代表値（6年）: ならべた 点で 中央値・最頻値を さがす
export const parseData = (q) => {
  const m = String(q).match(/^([\d,\s]+) の (中央値\(メジアン\)|最頻値\(モード\))は？$/);
  if (!m) return null;
  const values = m[1].split(',').map((t) => parseInt(t.trim(), 10)).filter((v) => !Number.isNaN(v));
  if (values.length === 0) return null;
  return { values, median: m[2].startsWith('中央値') };
};

// 場合の数（6年）: 樹形図・組み合わせの表
export const parseBaai = (q) => {
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
export const parseHayasa = (q) => {
  let m = q.match(/^(時速|分速|秒速)([\d.]+)(km|m)で([\d.]+)(時間|分間|分|秒)/);
  if (m) return { speed: `${m[1]}${m[2]}${m[3]}`, time: `${m[4]}${m[5].replace('分間', '分')}`, dist: null };
  m = q.match(/^([\d.]+)(km|m)を([\d.]+)(時間|分|秒)で → (時速|分速|秒速)/);
  if (m) return { dist: `${m[1]}${m[2]}`, time: `${m[3]}${m[4]}`, speed: null };
  m = q.match(/^([\d.]+)(km|m)を((?:時速|分速|秒速)[\d.]+(?:km|m))で → \?(時間|分|秒)/);
  if (m) return { dist: `${m[1]}${m[2]}`, speed: m[3], time: null };
  return null;
};

// がい数: 四捨五入を数直線で見る
export const parseGaisuLine = (q) => {
  const m = q.match(/^(\d+)を (十|百|千|万)の位までの がい数にすると？$/);
  if (!m) return null;
  const unit = { '十': 10, '百': 100, '千': 1000, '万': 10000 }[m[2]];
  return { n: +m[1], unit };
};

// 面積・体積: 図形のスケッチ
export const parseZukei = (q) => {
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
export const parseNarabi = (q) => {
  let m = q.match(/^まえから (\d+)ばんめ。うしろに (\d+)にん/);
  if (m) return { type: 'behind', i: +m[1], j: +m[2] };
  m = q.match(/^ひだりから (\d+)ばんめ。みぎから (\d+)ばんめ/);
  if (m) return { type: 'overlap', i: +m[1], j: +m[2] };
  m = q.match(/^(\d+)にん ならんでいます。まえから (\d+)ばんめ/);
  if (m) return { type: 'total', total: +m[1], i: +m[2] };
  return null;
};

// 計算のじゅんばん: さきに計算する部分をハイライト
export const parseJunban = (q) => {
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
export const parseTenFrame = (q) => {
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
