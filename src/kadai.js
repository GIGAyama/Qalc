/* 「さっきと おなじ」と「かだいリンク」で使う、ひとりで遊ぶ設定のあつかい。
 *
 * 設定 = { mode, courses, minutes, shuffle }
 *   mode     … 'SCORE_ATTACK' | 'TIME_ATTACK' | 'SUDDEN_DEATH'
 *   courses  … ドリルの名前の列（にがて克服ボックスは 'mistakes'）
 *   minutes  … スコアアタックの時間（1〜10分）
 *   shuffle  … 問題をランダムに出すか
 *
 * かだいリンクは、先生が選んだ設定を URL の「#kadai=…」に入れたもの。
 * 「#」から後ろはサーバーへ送られないので、リンクを開いても中身はどこにも届かない。
 * プリセットのドリルは名前だけを入れる（どの端末でも同じ問題になる。problems.js の PRESET_SEED）。
 * 自作のドリルと、書きかえたプリセットは、問題ごと入れる。
 *
 * リンクは だれでも作れて だれでも書きかえられるので、読むときは必ず形をたしかめる。
 * 画面の都合とまぜずに、node から直接テストできるようにしている（scripts/kadai.test.mjs）。
 */
import { sanitizeCourseName, validateProblems, toBase64Url, fromBase64Url } from './courseShare.js';

export const SOLO_MODES = ['SCORE_ATTACK', 'TIME_ATTACK', 'SUDDEN_DEATH'];
const MINUTES_MIN = 1;
const MINUTES_MAX = 10;
const MINUTES_DEFAULT = 3;
export const KADAI_TITLE_MAX = 20;
const COURSES_MAX = 200;
const PROBLEMS_TOTAL_MAX = 2000;   // 1つのかだいに入れる自作の問題の合計（みんなであそぶで配れる上限と同じ）
const CODE_MAX = 400000;           // これより長いリンクは読まない（こわれた・いたずらのリンクで固まらないように）
export const KADAI_HASH_KEY = 'kadai';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const toMinutes = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isFinite(n) ? Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, Math.round(n))) : MINUTES_DEFAULT;
};

// にがて克服ボックス（'mistakes'）は その子のまちがいなので、名前のチェックをとおらない。ここだけ通す
const cleanCourseList = (list) => {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    const name = v === 'mistakes' ? 'mistakes' : sanitizeCourseName(v);
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= COURSES_MAX) break;
  }
  return out;
};

/** 保存してあった設定（さっきと おなじ）をそろえる。使えなければ null */
export const normalizePlayConfig = (raw) => {
  if (!isObj(raw) || !SOLO_MODES.includes(raw.mode)) return null;
  const courses = cleanCourseList(raw.courses);
  if (courses.length === 0) return null;
  return { mode: raw.mode, courses, minutes: toMinutes(raw.minutes), shuffle: raw.shuffle !== false };
};

/** タイトルをそろえる（制御文字をのぞき、前後の空白を取り、20文字まで） */
export const sanitizeKadaiTitle = (v) => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, ' ').trim().slice(0, KADAI_TITLE_MAX) : '');

/**
 * かだいを、リンクに入れる文字にする。
 * custom は { ドリルの名前: [{q, a}] }。プリセットのまま使うドリルは入れない
 */
export const encodeKadai = ({ title = '', mode, courses, minutes, shuffle = true, custom = {} }) => {
  const names = cleanCourseList(courses).filter((n) => n !== 'mistakes');
  const p = names.filter((n) => Array.isArray(custom[n])).map((n) => [n, custom[n].map((r) => [String(r.q), String(r.a)])]);
  const data = { v: 1, m: mode, c: names, n: toMinutes(minutes), r: shuffle ? 1 : 0 };
  const t = sanitizeKadaiTitle(title);
  if (t) data.t = t;
  if (p.length) data.p = p;
  return toBase64Url(JSON.stringify(data));
};

/**
 * リンクの文字を読む。読めなければ null。
 * isPreset(name) … その名前がプリセットのドリルか（問題を入れずに名前だけで出せるか）
 * 返すもの: { title, mode, courses, minutes, shuffle, custom }
 *   courses には、プリセットか、リンクに問題が入っているドリルだけを残す（ほかは どの端末でも出せない）
 */
export const decodeKadai = (code, isPreset) => {
  try {
    const s = String(code ?? '').trim();
    if (!s || s.length > CODE_MAX) return null;
    const data = JSON.parse(fromBase64Url(s));
    if (!isObj(data) || data.v !== 1 || !SOLO_MODES.includes(data.m)) return null;

    const custom = {};
    let total = 0;
    for (const entry of Array.isArray(data.p) ? data.p : []) {
      if (!Array.isArray(entry) || !Array.isArray(entry[1])) continue;
      const name = sanitizeCourseName(entry[0]);
      if (!name || custom[name]) continue;
      const rows = entry[1].map((x) => (Array.isArray(x) ? { q: x[0], a: x[1] } : null)).filter(Boolean);
      const { ok } = validateProblems(rows);
      const room = PROBLEMS_TOTAL_MAX - total;
      if (ok.length === 0 || room <= 0) continue;
      custom[name] = ok.slice(0, room);
      total += custom[name].length;
    }

    const courses = cleanCourseList(data.c).filter((n) => n !== 'mistakes' && (custom[n] || isPreset(n)));
    if (courses.length === 0) return null;
    // 名前の列にないのに問題だけ入っているものは使わない
    for (const n of Object.keys(custom)) if (!courses.includes(n)) delete custom[n];

    return {
      title: sanitizeKadaiTitle(data.t),
      mode: data.m,
      courses,
      minutes: toMinutes(data.n),
      shuffle: data.r !== 0,
      custom,
    };
  } catch (e) {
    return null;
  }
};

/** かだいリンクの URL。base はアプリの場所（例: https://qalc.giga-school.com/） */
export const kadaiUrl = (base, code) => `${String(base).split('#')[0]}#${KADAI_HASH_KEY}=${code}`;

/** location.hash から、かだいの文字を取りだす。無ければ null */
export const readKadaiHash = (hash) => {
  const m = String(hash ?? '').match(new RegExp(`^#${KADAI_HASH_KEY}=([A-Za-z0-9_-]+)$`));
  return m ? m[1] : null;
};

/** 同じかだいかを見分ける短い印（FNV-1a）。同じリンクを開きなおしても、やった回数を消さないため */
export const kadaiId = (code) => {
  let h = 0x811c9dc5;
  const s = String(code);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
};
