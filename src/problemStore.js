/* コースの保存のしかた（App.jsx の StorageAPI が使う）。
 *
 * プリセットのコースは毎回コードから作り、端末には保存しない。
 * 端末に保存するのは「自作コース」と「書きかえたプリセット」だけ（qalc_courses）。
 *
 * 以前（qalc_problems）は、はじめて開いた日にプリセット119コースをまるごと保存し、
 * それを使いつづけていた。そのため
 *   ・問題の直し（答えの別解など）が、すでに使っている端末に届かなかった
 *   ・乱数で作る文章題が端末ごとにちがった
 *   ・保存容量を約40万文字つかっていた（容量がいっぱいになる原因の1つ）
 *
 * 旧データは、いちどだけ新しい形へ移す。手を入れていないプリセットの写しは捨て、
 * 先生が書きかえたプリセットと自作コースは残す。
 * 変更したら `npm run test:store` を通すこと。
 */

export const COURSES_KEY = 'qalc_courses';
export const LEGACY_KEY = 'qalc_problems';
export const LEGACY_VERSION_KEY = 'qalc_defaults_version';

const isProblem = (p) => !!p && typeof p === 'object' && typeof p.q === 'string'
  && (typeof p.a === 'string' || typeof p.a === 'number');

/** 保存されていたコースの集まりを、使える形だけにしぼる（配列でない値・形のちがう問題は捨てる） */
export const cleanCourses = (raw) => {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, list] of Object.entries(raw)) {
    if (!name || !Array.isArray(list)) continue;
    const probs = list.filter(isProblem).map((p) => ({ q: p.q, a: String(p.a) }));
    if (probs.length) out[name] = probs;
  }
  return out;
};

const questionSig = (list) => list.map((p) => p.q).sort().join('\u0000');

/**
 * 旧データにあったプリセットが、手を入れていない写しかどうか。
 *  ・乱数で中身が変わらないコース: 問題文の集まりが いまのプリセットと同じなら写し。
 *    答えは比べない（この版で別解を足したコースがある。たとえば 3/3）
 *  ・乱数で中身が変わるコース（文章題など）: 以前は端末ごとに ちがう問題が選ばれたので
 *    中身では比べられない。問題の数が同じなら写しとみなす
 *    （先生が問題を足したり消したりしていれば、数が変わる）
 * presetAlt は、ほかの種で作った同じコース。いまのものと問題文がちがえば「乱数で変わるコース」
 */
export const isUneditedLegacyCopy = (stored, presetNow, presetAlt) => {
  if (!Array.isArray(stored) || !Array.isArray(presetNow)) return false;
  const randomDependent = questionSig(presetNow) !== questionSig(presetAlt || presetNow);
  if (randomDependent) return stored.length === presetNow.length;
  return questionSig(stored) === questionSig(presetNow);
};

/**
 * 旧データ（qalc_problems）を新しい形へ移す。
 *   current: すでに新しい形で保存されているもの（こちらを優先し、上書きしない）
 *   legacyNames: 改名する前のプリセットの名前（捨てる）
 * 戻り値: { courses: 新しく保存するもの, dropped: 捨てたプリセットの写し, kept: 書きかえとして残したプリセット }
 */
export const migrateLegacyCourses = (legacyRaw, current, presetsNow, presetsAlt, legacyNames = []) => {
  const legacy = cleanCourses(legacyRaw);
  const courses = { ...cleanCourses(current) };
  const dropped = [];
  const kept = [];
  for (const [name, list] of Object.entries(legacy)) {
    if (Object.prototype.hasOwnProperty.call(courses, name)) continue;
    if (legacyNames.includes(name)) { dropped.push(name); continue; }
    if (!presetsNow[name]) { courses[name] = list; continue; }
    if (isUneditedLegacyCopy(list, presetsNow[name], presetsAlt[name])) { dropped.push(name); continue; }
    courses[name] = list;
    kept.push(name);
  }
  return { courses, dropped, kept };
};

/** プリセットに、自作コースと書きかえたプリセットを重ねる（書きかえが勝つ） */
export const mergeCourses = (presets, courses) => ({ ...presets, ...courses });
