/* 端末に保存してある成績・にがて・中断データを、画面が使える形にそろえる。
 *
 * 保存データは、古い版のアプリが書いたもの・途中で書きこみが切れたもの・
 * 手で書きかえられたものでも読めなければならない。以前は形をたしかめずに使っていたので、
 * たとえば成績の inventory.bases が配列でないだけで、ホームを描くところで例外になり、
 * 画面がまっ白のまま何もできなくなった（にげ道は、端末の保存データを消すことだけだった）。
 *
 * ここでは「読めたものは残し、読めないものは はじめの値にもどす」。
 * 形が合わないからといって、成績まるごとを捨てることはしない。
 *
 * 画面の都合とまぜずに、node から直接テストできるようにしている（scripts/statsStore.test.mjs）。
 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 数として読めて、min 以上の有限の値ならそれを、そうでなければ def を返す。
// 古い版は数を文字で書いていたことがあるので、数だけの文字も数として読む
const num = (v, def, min = 0) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min ? n : def;
};
const int = (v, def, min = 0) => {
  const n = num(v, null, min);
  return n === null ? def : Math.floor(n);
};
const str = (v, def) => (typeof v === 'string' ? v : def);
const strList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x !== ''))] : []);

// ── 成績（qalc_stats）──────────────────────────────

// ショップの品の入れもの。はじめから持っている品（いぬ・ふつうの色）は、かならず入れておく
const INVENTORY_DEFAULTS = { bases: ['b_dog'], hats: [], faces: [], props: [], themes: ['default'], backgrounds: [], effects: [], titles: [] };
const EQUIPPED_DEFAULTS = { base: 'b_dog', hat: null, face: null, prop: null, background: null, effect: null, title: null };

const normalizeInventory = (raw) => {
  const src = isObj(raw) ? raw : {};
  const out = {};
  // 知らない入れもの（新しい版で足されたもの）も、品の名前の列なら残す
  for (const [cat, list] of Object.entries(src)) if (Array.isArray(list)) out[cat] = strList(list);
  for (const [cat, defaults] of Object.entries(INVENTORY_DEFAULTS)) {
    out[cat] = [...new Set([...defaults, ...(out[cat] || [])])];
  }
  return out;
};

const normalizeEquipped = (raw) => {
  const src = isObj(raw) ? raw : {};
  const out = {};
  for (const [slot, def] of Object.entries(EQUIPPED_DEFAULTS)) {
    const v = src[slot];
    // null は「はずした」というえらんだ結果なので残す（ベースも、えらんだ品をもう一度おすと はずせる）
    out[slot] = (typeof v === 'string' && v !== '') || v === null ? v : def;
  }
  return out;
};

const normalizeMission = (m) => {
  if (!isObj(m) || typeof m.id !== 'string' || typeof m.type !== 'string') return null;
  const target = num(m.target, null, 1);
  if (target === null) return null;
  return { ...m, target, reward: int(m.reward, 0), current: num(m.current, 0), claimed: m.claimed === true, desc: str(m.desc, '') };
};

const normalizeMissions = (raw) => {
  if (!isObj(raw) || typeof raw.date !== 'string' || !Array.isArray(raw.list)) return null;
  const list = raw.list.map(normalizeMission).filter(Boolean);
  // 1つも読めなければ、その日のミッションを作りなおしてもらう（null）
  return list.length > 0 ? { ...raw, list } : null;
};

const normalizeDaily = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [day, v] of Object.entries(raw)) {
    if (!isObj(v)) continue;
    out[day] = { ...v, exp: num(v.exp, 0), count: int(v.count, 0) };
  }
  return out;
};

const normalizeCourseStats = (raw) => {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [name, v] of Object.entries(raw)) {
    if (!isObj(v)) continue;
    out[name] = { ...v, plays: int(v.plays, 0), streak: int(v.streak, 0), mastered: v.mastered === true };
  }
  return out;
};

const normalizeRepeat = (raw) => {
  if (!isObj(raw) || typeof raw.date !== 'string') return null;
  const counts = {};
  if (isObj(raw.counts)) for (const [name, c] of Object.entries(raw.counts)) { const n = int(c, null); if (n !== null) counts[name] = n; }
  return { date: raw.date, counts };
};

/**
 * 成績をそろえる。
 * legacy は、成績がひとつのキーにまとまる前の版が別々に残したもの
 * （qalc_exp / qalc_streak / qalc_last_date）。成績に値が無いときだけ使う。
 */
export const normalizeStats = (raw, legacy = {}) => {
  const src = isObj(raw) ? raw : {};
  // ショップができる前の成績には品の入れものが無い。そのときは はじめのコイン100枚をわたす（以前の版と同じ）
  const hadShop = isObj(src.inventory);
  return {
    ...src,
    totalExp: num(src.totalExp, num(legacy.exp, 0)),
    streak: int(src.streak, int(legacy.streak, 0)),
    lastDate: str(src.lastDate, str(legacy.lastDate, '')),
    maxComboRecord: int(src.maxComboRecord, 0),
    suddenDeathRecord: int(src.suddenDeathRecord, 0),
    timeAttackRecord: num(src.timeAttackRecord, 0),
    bossRaidRecord: int(src.bossRaidRecord, 0),
    territoryWins: int(src.territoryWins, 0),
    coins: int(src.coins, hadShop ? 0 : 100),
    inventory: normalizeInventory(src.inventory),
    equipped: normalizeEquipped(src.equipped),
    theme: typeof src.theme === 'string' && src.theme !== '' ? src.theme : 'default',
    missions: normalizeMissions(src.missions),
    daily: normalizeDaily(src.daily),
    courseStats: normalizeCourseStats(src.courseStats),
    repeat: normalizeRepeat(src.repeat),
  };
};

// ── にがて克服ボックス（qalc_mistakes）────────────────

const MISTAKES_MAX = 50;

const isAnswer = (a) => typeof a === 'string' || (typeof a === 'number' && Number.isFinite(a));

/** にがての一覧をそろえる。問題文と答えのそろったものだけを残す */
export const normalizeMistakes = (raw, max = MISTAKES_MAX) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => isObj(m) && typeof m.q === 'string' && m.q !== '' && isAnswer(m.a))
    .map((m) => ({ q: m.q, a: String(m.a) }))
    .slice(0, max);
};

// ── 中断データ（qalc_resume）──────────────────────────

// とちゅうから再開できるのは ひとりで遊ぶ3つのモードだけ
const RESUME_MODES = new Set(['SCORE_ATTACK', 'TIME_ATTACK', 'SUDDEN_DEATH']);
const DEFAULT_TIME_LIMIT_SEC = 180;

const normalizeProblem = (p) => {
  if (!isObj(p) || typeof p.q !== 'string' || p.q === '') return null;
  const alts = (Array.isArray(p.a) ? p.a : (isAnswer(p.a) ? String(p.a).split('|') : []))
    .filter(isAnswer).map(String).filter((s) => s !== '');
  return alts.length > 0 ? { q: p.q, a: alts } : null;
};

/**
 * 中断データをそろえる。再開できない形（問題が1問も読めない・知らないモード）なら null。
 * null のときは、呼んだ側がキーを消す（ホームに「つづきから」を出さない）
 */
export const normalizeResume = (raw) => {
  if (!isObj(raw) || !RESUME_MODES.has(raw.gameMode) || !Array.isArray(raw.problemSet)) return null;
  const problemSet = raw.problemSet.map(normalizeProblem).filter(Boolean);
  if (problemSet.length === 0) return null;
  return {
    ...raw,
    problemSet,
    qIndex: Math.min(int(raw.qIndex, 0), problemSet.length - 1),
    timeLimitSec: num(raw.timeLimitSec, DEFAULT_TIME_LIMIT_SEC, 1),
    courseName: str(raw.courseName, ''),
    courseNames: strList(raw.courseNames),
    score: num(raw.score, 0),
    combo: int(raw.combo, 0),
    maxCombo: int(raw.maxCombo, 0),
    correctCount: int(raw.correctCount, 0),
    wrongCount: int(raw.wrongCount, 0),
    elapsedMs: num(raw.elapsedMs, 0),
    mistakes: normalizeMistakes(raw.mistakes, Infinity),
    savedAt: num(raw.savedAt, 0),
  };
};
