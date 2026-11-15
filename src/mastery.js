/* マスター判定と報酬の減衰（App.jsx から切りだした）。
 *
 * 画面の都合とまぜずに、node から直接テストできるようにしている（scripts/mastery.test.mjs）。
 */
import { dateKey } from './statsStore.js';
import { normalizeStr } from './data/problems.js';

// ==========================================
// マスター判定 & 報酬減衰（コイン・EXP稼ぎ目的の周回対策）
// 方針: プレイ自体は制限しない（復習は自由）。ただし
//  1) 高正答率・高速で安定してクリアできる＝「マスター済み」コースを楽々クリアしたとき
//  2) 同じコースを同じ日に何度も繰り返したとき（難易度によらず。自作コース悪用対策も兼ねる）
// はEXP・コイン・ミッション進捗が減衰し、代わりに「つぎのドリルへ挑戦しよう」と促す。
export const DECAY = {
  REPEAT_SCHEDULE: [1, 1, 0.5, 0.25], // その日すでに遊んだ回数 → 倍率（3回目から半減）
  REPEAT_FLOOR: 0.1,                  // 5回目以降の倍率
  MASTERED_MULT: 0.2,                 // マスター済みコースを楽々クリアしたときの倍率
  FLOOR: 0.05,                        // 合成倍率の下限（ゼロにはしない）
  MASTER_MIN_CORRECT: 10,             // マスター判定に必要な1セッションの正解数（問題が10問より少ないコースは、その全問）
  MASTER_MIN_ACC: 0.95,               // マスター判定に必要な正答率
  MASTER_MAX_SPQ: 5,                  // マスター判定: 1問あたりの秒数上限の いちばん短い値（指折り計算では届かない速さ）
  MASTER_MAX_SPQ_CAP: 30,             // 長い文章題でも、これより長くはしない
  MASTER_STREAK: 3,                   // 連続何セッション条件を満たせばマスターか
  DEMOTE_ACC: 0.8,                    // マスター済みでもこれを下回ったら「忘れていた」として解除
  EASY_ACC: 0.9,                      // マスター減衰が発動する正答率（苦戦した復習は減衰しない）
  MIN_ATTEMPTS_FOR_REPEAT: 5          // これ未満の回答数のセッションは周回カウントに入れない（誤タップ即終了の救済）
};

// セッションの正答率。サドンデスは終了のきっかけになった1ミスを除外して評価する
export const sessionAccuracy = (session) => {
  const wrongAdj = session.gameMode === 'SUDDEN_DEATH' ? Math.max(0, session.wrongCount - 1) : session.wrongCount;
  const attempts = session.correctCount + wrongAdj;
  return { attempts, acc: attempts > 0 ? session.correctCount / attempts : 0 };
};


// にがて克服ボックス('mistakes')は常に減衰対象外（まちがい直しはいつでも全額）
export const realCoursesOf = (courseNames) => (courseNames || []).filter(n => n !== 'mistakes');

export const isCourseMastered = (stats, name) => !!(stats.courseStats && stats.courseStats[name] && stats.courseStats[name].mastered);

// 減衰倍率を計算する（stats は変更しない。今セッションを記録する「前」の値で呼ぶこと）
export const computeRewardDecay = (stats, courseNames, session) => {
  const real = realCoursesOf(courseNames);
  if (real.length === 0) return { mult: 1, masteredApplied: false, repeatPlays: 0, repeatMult: 1 };
  const today = dateKey();
  const counts = (stats.repeat && stats.repeat.date === today) ? stats.repeat.counts : {};
  // 複数ドリル選択時は「いちばん周回されているコース」に合わせる（稼ぎコースに新規1つ混ぜる抜け道の防止）
  const repeatPlays = Math.max(...real.map(n => counts[n] || 0));
  const repeatMult = repeatPlays < DECAY.REPEAT_SCHEDULE.length ? DECAY.REPEAT_SCHEDULE[repeatPlays] : DECAY.REPEAT_FLOOR;
  const { acc } = sessionAccuracy(session);
  // マスター減衰は「選んだ全コースがマスター済み」かつ「今回も楽々だった」ときだけ。苦戦したなら復習が必要だった証拠なので全額
  const masteredApplied = real.every(n => isCourseMastered(stats, n)) && acc >= DECAY.EASY_ACC;
  const mult = Math.max(DECAY.FLOOR, repeatMult * (masteredApplied ? DECAY.MASTERED_MULT : 1));
  return { mult, masteredApplied, repeatPlays, repeatMult };
};

/**
 * マスターの目安（その回に出た問題から決める）。
 *   sec        … 1問あたりの秒数の上限。ふつうの計算（「3+4」）は5秒。
 *                問題文を読むのと答えを打つのにかかる分だけ長くする（問題文1字0.3秒・答え1字1.2秒、30秒まで）
 *   minCorrect … 1回に必要な正解数。10問。ただし問題が10問より少ないコースは、その全問
 * 以前は どのコースも「10問以上・1問5秒以内」で、問題文が平均20字以上の文章題33本は
 * 読むだけで5秒をこえて、どんなに得意な子もマスターできなかった。
 * タイムアタック（同じ問題は1回しか出ない）では、9問しかない九九の各段など15本が
 * 10問に届かず、マスターの対象外になっていた。
 */
export const masteryPace = (problems) => {
  const list = (problems || []).filter((p) => p && typeof p.q === 'string');
  if (list.length === 0) return { sec: DECAY.MASTER_MAX_SPQ, minCorrect: DECAY.MASTER_MIN_CORRECT };
  let total = 0;
  const distinct = new Set();
  for (const p of list) {
    const qLen = p.q.replace(/\s/g, '').length;
    const alts = (Array.isArray(p.a) ? p.a : String(p.a ?? '').split('|')).map(normalizeStr).filter(Boolean);
    const aLen = alts.length > 0 ? Math.min(...alts.map((a) => a.length)) : 1;
    total += 2 + 0.3 * qLen + 1.2 * aLen;
    distinct.add(p.q);
  }
  const sec = Math.min(DECAY.MASTER_MAX_SPQ_CAP, Math.max(DECAY.MASTER_MAX_SPQ, total / list.length));
  return { sec: Math.round(sec * 10) / 10, minCorrect: Math.min(DECAY.MASTER_MIN_CORRECT, distinct.size) };
};

// 今セッションを周回カウント・マスター判定に記録する（stats を直接変更する）
// session.paceSec / session.minCorrect は masteryPace の値（無ければ 5秒・10問）
// 戻り値: { newlyMastered: 新しくマスターになったコース名 | null }
export const recordCourseSession = (stats, courseNames, session) => {
  const real = realCoursesOf(courseNames);
  if (real.length === 0) return { newlyMastered: null };
  const today = dateKey();
  if (!stats.repeat || stats.repeat.date !== today) stats.repeat = { date: today, counts: {} };
  const { attempts, acc } = sessionAccuracy(session);
  if (attempts >= DECAY.MIN_ATTEMPTS_FOR_REPEAT) {
    real.forEach(n => { stats.repeat.counts[n] = (stats.repeat.counts[n] || 0) + 1; });
  }
  if (!stats.courseStats) stats.courseStats = {};
  let newlyMastered = null;
  // 複数ドリル混合ではコース別の正答率が分からないため、単一コースのセッションだけを判定の証拠にする
  if (real.length === 1) {
    const name = real[0];
    const cs = stats.courseStats[name] || (stats.courseStats[name] = { plays: 0, streak: 0, mastered: false });
    cs.plays += 1;
    const spq = session.correctCount > 0 ? session.elapsedSec / session.correctCount : Infinity;
    const minCorrect = session.minCorrect ?? DECAY.MASTER_MIN_CORRECT;
    const paceSec = session.paceSec ?? DECAY.MASTER_MAX_SPQ;
    const qualifies = session.correctCount >= minCorrect && acc >= DECAY.MASTER_MIN_ACC && spq <= paceSec;
    if (qualifies) {
      cs.streak += 1;
      if (!cs.mastered && cs.streak >= DECAY.MASTER_STREAK) { cs.mastered = true; cs.masteredAt = today; newlyMastered = name; }
    } else {
      cs.streak = 0;
      // 久しぶりに遊んで正答率が落ちていたらマスター解除（忘れていた復習は全額で報いる）
      if (cs.mastered && attempts >= DECAY.MIN_ATTEMPTS_FOR_REPEAT && acc < DECAY.DEMOTE_ACC) cs.mastered = false;
    }
  }
  return { newlyMastered };
};
