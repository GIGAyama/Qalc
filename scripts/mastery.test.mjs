// マスター判定と報酬の減衰（src/mastery.js）のテスト。
//   実行: npm run test:mastery
import { DECAY, masteryPace, recordCourseSession, computeRewardDecay, sessionAccuracy } from '../src/mastery.js';
import { getParsedDefaultProblems } from '../src/data/problems.js';
import { dateKey } from '../src/statsStore.js';

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('NG', name, '\n  got :', JSON.stringify(got), '\n  want:', JSON.stringify(want)); }
  else console.log('ok', name);
};

// --- 目安の速さ ---
eq('ふつうの計算は5秒・10問', masteryPace([{ q: '3+4', a: ['7'] }, { q: '8-5', a: ['3'] }, ...Array.from({ length: 10 }, (_, i) => ({ q: `${i}+1`, a: [String(i + 1)] }))]), { sec: 5, minCorrect: 10 });
eq('長い文章題は、読むぶん長い（30字 → 2 + 9 + 1.2）', masteryPace([{ q: 'りんごが 12こ あります。3こ たべると、のこりは なんこ ですか。', a: ['9'] }]).sec, 12.2);
eq('答えが長いと、打つぶん長い（7字・答え3字 → 2 + 2.1 + 3.6）', masteryPace([{ q: '1/4+5/4', a: ['6/4', '3/2'] }]).sec, 7.7);
eq('30秒より長くはしない', masteryPace([{ q: 'あ'.repeat(200), a: ['1'] }]).sec, 30);
eq('9問しかないコースは9問でよい', masteryPace(Array.from({ length: 9 }, (_, i) => ({ q: `2×${i + 1}`, a: [String(2 * (i + 1))] }))).minCorrect, 9);
eq('同じ問題がくりかえし出ても、ちがう問題の数で数える', masteryPace([...Array(30)].map(() => ({ q: '2×3', a: ['6'] }))).minCorrect, 1);
eq('答えが「|」でつながった文字でも読める', masteryPace([{ q: '1/4+5/4', a: '6/4|3/2' }]).sec, 7.7);
eq('問題が無ければ以前と同じ5秒・10問', masteryPace([]), { sec: 5, minCorrect: 10 });

// --- マスター判定 ---
const blank = () => ({ courseStats: {}, repeat: null });
const play = (stats, name, session) => recordCourseSession(stats, [name], { gameMode: 'TIME_ATTACK', wrongCount: 0, ...session });
{
  const s = blank();
  const r = [1, 2, 3].map(() => play(s, 'ことば', { correctCount: 10, elapsedSec: 120, paceSec: 13, minCorrect: 10 }).newlyMastered);
  eq('文章題: 目安（13秒）以内を3回でマスター', r, [null, null, 'ことば']);
}
{
  const s = blank();
  [1, 2, 3].forEach(() => play(s, 'ことば', { correctCount: 10, elapsedSec: 120 }));
  eq('目安を渡さなければ以前と同じ5秒（文章題はマスターにならない）', s.courseStats['ことば'].mastered, false);
}
{
  const s = blank();
  const r = [1, 2, 3].map(() => play(s, '二の段', { correctCount: 9, elapsedSec: 30, paceSec: 5, minCorrect: 9 }).newlyMastered);
  eq('9問のコース: タイムアタック9問全問正解を3回でマスター', r, [null, null, '二の段']);
}
{
  const s = blank();
  play(s, 'a', { correctCount: 10, elapsedSec: 40, paceSec: 5, minCorrect: 10 });
  play(s, 'a', { correctCount: 10, elapsedSec: 60, paceSec: 5, minCorrect: 10 });
  eq('目安より遅い回があると、連続がとぎれる', s.courseStats.a.streak, 0);
}

// --- 全プリセットで: 目安どおりに解ける子はマスターでき、遅い子はマスターにならない ---
{
  const all = getParsedDefaultProblems();
  const notMasterable = []; const tooEasy = []; const oldNot = [];
  for (const [name, raw] of Object.entries(all)) {
    // タイムアタックと同じく、先頭から20問まで（答えは配列）
    const set = raw.slice(0, 20).map((p) => ({ q: p.q, a: String(p.a).split('|') }));
    const pace = masteryPace(set);
    const correct = set.length;
    const fast = blank(); const slow = blank(); const old = blank();
    for (let i = 0; i < 3; i++) {
      play(fast, name, { correctCount: correct, elapsedSec: correct * pace.sec * 0.95, paceSec: pace.sec, minCorrect: pace.minCorrect });
      play(slow, name, { correctCount: correct, elapsedSec: correct * pace.sec * 1.2, paceSec: pace.sec, minCorrect: pace.minCorrect });
      play(old, name, { correctCount: correct, elapsedSec: correct * pace.sec * 0.95 }); // 以前の決まり（5秒・10問）
    }
    if (!fast.courseStats[name].mastered) notMasterable.push(name);
    if (slow.courseStats[name].mastered) tooEasy.push(name);
    if (!old.courseStats[name].mastered) oldNot.push(name);
  }
  eq(`全${Object.keys(all).length}コース: 目安どおりに解ける子はマスターできる`, notMasterable, []);
  eq('全コース: 目安より2割遅い子はマスターにならない', tooEasy, []);
  console.log(`  （以前の決まり「10問・1問5秒」では、同じ子が ${oldNot.length} コースでマスターできなかった）`);
  eq('以前はマスターできないコースがあった', oldNot.length > 0, true);
}

// --- 報酬の減衰（動きは変えていない） ---
{
  const today = dateKey();
  const s = { courseStats: { a: { plays: 3, streak: 3, mastered: true } }, repeat: { date: today, counts: { a: 2 } } };
  const d = computeRewardDecay(s, ['a'], { gameMode: 'SCORE_ATTACK', correctCount: 20, wrongCount: 0 });
  eq('同じ日の3回目で、マスターずみを楽々 → 0.5 × 0.2', [d.repeatMult, d.masteredApplied, d.mult], [0.5, true, 0.1]);
  eq('にがて克服ボックスは減らさない', computeRewardDecay(s, ['mistakes'], { gameMode: 'SCORE_ATTACK', correctCount: 20, wrongCount: 0 }).mult, 1);
  eq('サドンデスの正答率は、終わりのきっかけの1ミスを除く', sessionAccuracy({ gameMode: 'SUDDEN_DEATH', correctCount: 9, wrongCount: 1 }).acc, 1);
  eq('決まった値', [DECAY.MASTER_MIN_CORRECT, DECAY.MASTER_MIN_ACC, DECAY.MASTER_MAX_SPQ, DECAY.MASTER_STREAK], [10, 0.95, 5, 3]);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
