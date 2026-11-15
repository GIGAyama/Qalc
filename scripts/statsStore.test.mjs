// 保存データのそろえかた（src/statsStore.js）のテスト。
//   実行: npm run test:stats
// どれも「壊れた・古い形の保存データで画面がまっ白になる」を止めるためのもの。
import { normalizeStats, normalizeMistakes, normalizeResume, dateKey, addDays, localeDateOrder, toDateKey, rolloverDay, currentStreak } from '../src/statsStore.js';
import { seededRandom } from '../src/random.js';

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('NG', name, '\n  got :', JSON.stringify(got), '\n  want:', JSON.stringify(want)); }
  else console.log('ok', name);
};

// 画面が成績に期待している形（これが守られていれば、ホーム・ショップ・結果で例外にならない）
const shapeProblems = (s) => {
  const bad = [];
  const fin = (k) => { if (!(typeof s[k] === 'number' && Number.isFinite(s[k]) && s[k] >= 0)) bad.push(k); };
  ['totalExp', 'streak', 'maxComboRecord', 'suddenDeathRecord', 'timeAttackRecord', 'bossRaidRecord', 'territoryWins', 'coins'].forEach(fin);
  if (typeof s.lastDate !== 'string') bad.push('lastDate');
  if (typeof s.theme !== 'string' || !s.theme) bad.push('theme');
  for (const cat of ['bases', 'hats', 'faces', 'props', 'themes', 'backgrounds', 'effects', 'titles']) {
    if (!Array.isArray(s.inventory?.[cat]) || s.inventory[cat].some((x) => typeof x !== 'string')) bad.push(`inventory.${cat}`);
  }
  if (!s.inventory.bases.includes('b_dog') || !s.inventory.themes.includes('default')) bad.push('inventory.defaults');
  for (const slot of ['base', 'hat', 'face', 'prop', 'background', 'effect', 'title']) {
    const v = s.equipped?.[slot]; if (!(v === null || typeof v === 'string')) bad.push(`equipped.${slot}`);
  }
  if (s.missions !== null && !(typeof s.missions.date === 'string' && Array.isArray(s.missions.list) && s.missions.list.every((m) => typeof m.id === 'string' && Number.isFinite(m.current) && Number.isFinite(m.target) && typeof m.claimed === 'boolean'))) bad.push('missions');
  if (typeof s.daily !== 'object' || Array.isArray(s.daily) || Object.values(s.daily).some((d) => !Number.isFinite(d.exp) || !Number.isFinite(d.count))) bad.push('daily');
  if (typeof s.courseStats !== 'object' || Array.isArray(s.courseStats) || Object.values(s.courseStats).some((c) => !Number.isFinite(c.plays) || !Number.isFinite(c.streak) || typeof c.mastered !== 'boolean')) bad.push('courseStats');
  if (s.repeat !== null && !(typeof s.repeat.date === 'string' && Object.values(s.repeat.counts).every(Number.isFinite))) bad.push('repeat');
  return bad;
};

// --- 何も無い・成績ではないもの → はじめの成績（コイン100枚） ---
for (const [label, raw] of [['無い', null], ['undefined', undefined], ['文字', 'abc'], ['数', 123], ['配列', [1, 2]], ['true', true]]) {
  const s = normalizeStats(raw);
  eq(`${label} → はじめの成績`, [s.totalExp, s.coins, s.inventory.bases, s.equipped.base, s.theme, s.missions], [0, 100, ['b_dog'], 'b_dog', 'default', null]);
  eq(`${label} → 形がそろう`, shapeProblems(s), []);
}

// --- 成績がまとまる前の版の値（別々のキー）を引きつぐ ---
eq('旧キーの EXP・連続日数・最後の日', (({ totalExp, streak, lastDate }) => ({ totalExp, streak, lastDate }))(normalizeStats(null, { exp: '1200', streak: '3', lastDate: '2026/11/14' })), { totalExp: 1200, streak: 3, lastDate: '2026-11-14' });
eq('成績に値があれば旧キーは使わない', normalizeStats({ totalExp: 50, inventory: {} }, { exp: '1200' }).totalExp, 50);

// --- ふつうの成績は1つも変えない ---
const real = {
  totalExp: 5321, streak: 4, lastDate: '2026-11-15', maxComboRecord: 37, suddenDeathRecord: 22, timeAttackRecord: 41.3, bossRaidRecord: 2, territoryWins: 1,
  bestPlayExp: 1500, lastMultiplayerDate: '2026-11-10',
  coins: 640, inventory: { bases: ['b_dog', 'b_cat'], hats: ['h_cap'], faces: [], props: [], themes: ['default', 'dark'], backgrounds: [], effects: [], titles: ['t_star'] },
  equipped: { base: 'b_cat', hat: 'h_cap', face: null, prop: null, background: null, effect: null, title: 't_star' }, theme: 'dark',
  missions: { date: '2026-11-15', list: [{ id: 'play_3', type: 'play', target: 3, reward: 50, desc: '今日 3回 プレイする', current: 1, claimed: false }] },
  daily: { '2026-11-14': { exp: 300, count: 2 }, '2026-11-15': { exp: 120, count: 1 } },
  courseStats: { '2年_九九': { plays: 5, streak: 2, mastered: false }, '1年_たし算': { plays: 9, streak: 3, mastered: true, masteredAt: '2026-11-10' } },
  repeat: { date: '2026-11-15', counts: { '2年_九九': 1 } },
  futureField: { keep: true },
};
eq('ふつうの成績はそのまま（知らない項目も残す）', normalizeStats(real), real);

// --- 一部だけ壊れている → そこだけ はじめの値 ---
const broken = normalizeStats({
  totalExp: 'abc', streak: -3, coins: NaN, maxComboRecord: '12',
  inventory: { bases: { 0: 'b_cat' }, hats: ['h_cap', 'h_cap', 7, null], themes: 'dark', weird: ['x'] },
  equipped: { base: 5, hat: 'h_cap', face: {}, title: '' },
  theme: 42,
  missions: { date: '2026/11/15', list: [{ id: 'combo_5', type: 'combo', target: 5, reward: 30, current: 'x', claimed: 'yes' }, 'garbage', { id: 'x' }] },
  daily: { '2026/11/15': { exp: 'NaN', count: 2 }, bad: 5, '2026/11/14': null },
  courseStats: { a: { plays: 'x', streak: 2, mastered: 'yes' }, b: 3 },
  repeat: { date: '2026/11/15', counts: { a: 'x', b: 2 } },
});
eq('壊れた数は 0、数だけの文字は数に', [broken.totalExp, broken.streak, broken.coins, broken.maxComboRecord], [0, 0, 0, 12]);
eq('品の入れもの: 配列でないものは はじめの品、重なり・品でないものは消す', [broken.inventory.bases, broken.inventory.hats, broken.inventory.themes, broken.inventory.weird], [['b_dog'], ['h_cap'], ['default'], ['x']]);
eq('身につけている品: 形が合わないものは はじめの値', broken.equipped, { base: 'b_dog', hat: 'h_cap', face: null, prop: null, background: null, effect: null, title: null });
eq('テーマ', broken.theme, 'default');
eq('ミッション: 読めるものだけ残す', broken.missions.list, [{ id: 'combo_5', type: 'combo', target: 5, reward: 30, current: 0, claimed: false, desc: '' }]);
eq('日ごとの記録', broken.daily, { '2026-11-15': { exp: 0, count: 2 } });
eq('コースの記録', broken.courseStats, { a: { plays: 0, streak: 2, mastered: false } });
eq('周回の数', broken.repeat, { date: '2026-11-15', counts: { b: 2 } });
eq('一部が壊れていても形がそろう', shapeProblems(broken), []);
eq('はずしたベースは、はずしたまま', normalizeStats({ inventory: {}, equipped: { base: null } }).equipped.base, null);
eq('ミッションが1つも読めなければ作りなおす（null）', normalizeStats({ inventory: {}, missions: { date: 'x', list: [1, 2] } }).missions, null);
eq('ショップの前の成績にはコイン100枚', normalizeStats({ totalExp: 10 }).coins, 100);
eq('ショップのあとの成績でコインが壊れていたら 0（ふやさない）', normalizeStats({ inventory: {}, coins: 'x' }).coins, 0);

// --- でたらめな形を たくさん入れても、例外にならず形がそろう ---
{
  const rand = seededRandom(7);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const junk = (depth = 0) => {
    const r = rand();
    if (depth > 3 || r < 0.3) return pick([null, undefined, 0, -1, 1.5, NaN, Infinity, '', 'x', '12', true, false]);
    if (r < 0.6) return Array.from({ length: Math.floor(rand() * 4) }, () => junk(depth + 1));
    const o = {};
    const keys = ['totalExp', 'streak', 'lastDate', 'coins', 'inventory', 'equipped', 'theme', 'missions', 'daily', 'courseStats', 'repeat', 'bases', 'hats', 'list', 'date', 'counts', 'base', 'id', 'type', 'target', 'current', 'exp', 'count', 'plays', 'mastered'];
    for (let i = 0; i < 1 + Math.floor(rand() * 6); i++) o[pick(keys)] = junk(depth + 1);
    return o;
  };
  let thrown = 0; let badShape = 0; let first = '';
  for (let i = 0; i < 3000; i++) {
    const raw = junk();
    try {
      const s = normalizeStats(raw, { exp: junk(3), streak: junk(3), lastDate: junk(3) });
      const bad = shapeProblems(s);
      if (bad.length) { badShape++; if (!first) first = `${JSON.stringify(raw)} → ${bad}`; }
      normalizeMistakes(raw); normalizeResume(raw);
    } catch (e) { thrown++; if (!first) first = `${JSON.stringify(raw)} → ${e.message}`; }
  }
  eq('でたらめな成績3000とおり: 例外0・形の崩れ0', { thrown, badShape }, { thrown: 0, badShape: 0 });
  if (first) console.log('  例:', first.slice(0, 300));
}

// --- 日付のキー（言語の設定によらない） ---
eq('YYYY-MM-DD', dateKey(new Date(2026, 0, 5)), '2026-01-05');
eq('月・年のさかいめ', [addDays('2026-03-01', -1), addDays('2025-12-31', 1), addDays('2024-03-01', -1)], ['2026-02-28', '2026-01-01', '2024-02-29']);
eq('端末の言語の年月日の順', [localeDateOrder((d) => d.toLocaleDateString('ja-JP')), localeDateOrder((d) => d.toLocaleDateString('en-US')), localeDateOrder((d) => d.toLocaleDateString('en-GB')), localeDateOrder((d) => d.toLocaleDateString('de-DE')), localeDateOrder((d) => d.toLocaleDateString('ko-KR')), localeDateOrder(() => { throw new Error('x'); })], ['YMD', 'MDY', 'DMY', 'DMY', 'YMD', 'YMD']);
eq('古い形の日付を読みかえる', ['2026/11/15', '11/15/2026', '15/11/2026', '15.11.2026', '2026. 11. 15.', '2026-11-15'].map((x) => toDateKey(x, 'YMD')), Array(6).fill('2026-11-15'));
eq('どちらとも読める日は端末の言語の順', [toDateKey('11/12/2026', 'MDY'), toDateKey('11/12/2026', 'DMY')], ['2026-11-12', '2026-12-11']);
eq('読めない日付は null', ['x', '2026/2/30', '13/13/2026', '', null, '1/2'].map((x) => toDateKey(x)), [null, null, null, null, null, null]);
{
  // 英語の端末で書いた成績を、日本語の端末で読む（言語を変えた）
  const old = normalizeStats({
    inventory: {}, streak: 6, lastDate: '11/14/2026',
    missions: { date: '11/15/2026', list: [{ id: 'play_1', type: 'play', target: 1, reward: 20, current: 1, claimed: false }] },
    daily: { '11/14/2026': { exp: 100, count: 1 }, '2026/11/14': { exp: 50, count: 1 }, 'こわれた': { exp: 1, count: 1 } },
    repeat: { date: '11/15/2026', counts: { a: 1 } },
    courseStats: { a: { plays: 3, streak: 3, mastered: true, masteredAt: '11/10/2026' } },
  }, {}, { dateOrder: 'YMD' });
  eq('言語を変えても: 最後の日・ミッション・周回の日付', [old.lastDate, old.missions.date, old.repeat.date, old.courseStats.a.masteredAt], ['2026-11-14', '2026-11-15', '2026-11-15', '2026-11-10']);
  eq('言語を変えても: 同じ日の2つの書きかたは足しあわせる（読めないキーは残す）', old.daily, { '2026-11-14': { exp: 150, count: 2 }, 'こわれた': { exp: 1, count: 1 } });
  eq('言語を変えても: 連続日数がつづく', currentStreak(old, '2026-11-15'), 6);
}

// --- 日のかわりめ ---
{
  const base = normalizeStats({ inventory: {}, coins: 10, streak: 2, lastDate: '2026-11-14', missions: { date: '2026-11-14', list: [
    { id: 'play_1', type: 'play', target: 1, reward: 20, current: 1, claimed: false },
    { id: 'combo_5', type: 'combo', target: 5, reward: 30, current: 7, claimed: true },
    { id: 'score_300', type: 'score', target: 300, reward: 30, current: 100, claimed: false },
  ] }, repeat: { date: '2026-11-14', counts: { a: 3 } } });
  const same = rolloverDay(base, '2026-11-14', () => { throw new Error('作らない'); });
  eq('同じ日なら何も変えない（同じものを返す）', same.stats === base && same.autoClaimed === 0, true);
  const next = rolloverDay(base, '2026-11-15', () => [{ id: 'new', type: 'play', target: 1, reward: 20, current: 0, claimed: false }]);
  eq('日がかわったら その日のミッションと周回の数', [next.stats.missions.date, next.stats.missions.list.map((m) => m.id), next.stats.repeat], ['2026-11-15', ['new'], { date: '2026-11-15', counts: {} }]);
  eq('受けとりわすれた達成ずみミッションのコインはわたす（未達成・受けとりずみは数えない）', [next.autoClaimed, next.stats.coins], [20, 30]);
  eq('もとの成績は書きかえない', [base.missions.date, base.coins], ['2026-11-14', 10]);
  eq('連続日数: きょう・きのう遊んでいれば つづいている', [currentStreak(base, '2026-11-14'), currentStreak(base, '2026-11-15'), currentStreak(base, '2026-11-16')], [2, 2, 0]);
}

// --- にがて ---
eq('配列でなければ空', normalizeMistakes({ q: '1+1', a: '2' }), []);
eq('問題と答えがそろったものだけ', normalizeMistakes([{ q: '1+1', a: '2' }, { q: '', a: '1' }, { q: '2+2' }, 'x', null, { q: '3+3', a: 6 }]), [{ q: '1+1', a: '2' }, { q: '3+3', a: '6' }]);
eq('50件まで', normalizeMistakes(Array.from({ length: 80 }, (_, i) => ({ q: `${i}+1`, a: String(i + 1) }))).length, 50);

// --- 中断データ ---
const resume = { problemSet: [{ q: '1+1', a: ['2'] }, { q: '2+2', a: '4|04' }, { q: 'bad' }], timeLimitSec: 120, courseName: 'たし算', courseNames: ['たし算'], gameMode: 'SCORE_ATTACK', qIndex: 7, score: 300, combo: 2, maxCombo: 3, correctCount: 3, wrongCount: 1, elapsedMs: 4000, mistakes: [{ q: '3+3', a: '6' }], savedAt: 1 };
const r = normalizeResume(resume);
eq('中断データ: 読めない問題は外し、答えは配列に', r.problemSet, [{ q: '1+1', a: ['2'] }, { q: '2+2', a: ['4', '04'] }]);
eq('中断データ: いまの問題の番号は問題の数におさめる', r.qIndex, 1);
eq('中断データ: そのほかはそのまま', [r.timeLimitSec, r.score, r.correctCount, r.mistakes], [120, 300, 3, [{ q: '3+3', a: '6' }]]);
eq('知らないモードは再開しない', normalizeResume({ ...resume, gameMode: 'BOSS_RAID' }), null);
eq('問題が1問も読めなければ再開しない', normalizeResume({ ...resume, problemSet: [{ q: 'x' }] }), null);
eq('問題の列が無ければ再開しない', normalizeResume({ gameMode: 'TIME_ATTACK' }), null);
eq('制限時間が壊れていたら3分', normalizeResume({ ...resume, timeLimitSec: 'x' }).timeLimitSec, 180);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
