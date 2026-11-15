// デイリーミッションのえらびかた（src/data/missions.js）のテスト。
//   実行: npm run test:missions
import { getRandomMissions, missionProfile, isReachable, MISSION_STRETCH } from '../src/data/missions.js';

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('NG', name, '\n  got :', JSON.stringify(got), '\n  want:', JSON.stringify(want)); }
  else console.log('ok', name);
};

const DAYS = 20000;
const MULTI = new Set(['play_boss_raid', 'play_territory']);
const draw = (profile, streak = 0) => Array.from({ length: DAYS }, () => getRandomMissions(3, streak, profile));

// --- はじめたばかりの子（記録なし・ひとりで遊ぶ） ---
const beginner = { maxCombo: 0, suddenDeath: 0, bestPlayExp: 0, maxDailyPlays: 0, multiplayerRecent: false };
{
  const days = draw(beginner);
  const all = days.flat();
  eq('毎日3つ出る', days.every((d) => d.length === 3), true);
  eq('同じ種類は1日に1つまで', days.every((d) => new Set(d.map((m) => m.type)).size === d.length), true);
  eq('ひとりで遊ぶ子には「みんなであそぶ」のミッションを出さない', all.filter((m) => MULTI.has(m.type)).length, 0);
  eq('記録が無いうちは「10コンボ」「500pt」「サドンデス10問」「3回プレイ」まで', all.filter((m) => !isReachable(m, beginner)).length, 0);
  eq('いちばん大きい目標', {
    combo: Math.max(...all.filter((m) => m.type === 'combo').map((m) => m.target)),
    score: Math.max(...all.filter((m) => m.type === 'score').map((m) => m.target)),
    play: Math.max(...all.filter((m) => m.type.startsWith('play')).map((m) => m.target)),
  }, { combo: 10, score: 500, play: 3 });
  const perDay = all.reduce((a, m) => a + m.reward, 0) / DAYS;
  console.log(`  （はじめたばかりの子: ミッション3つ全部で1日 平均 ${perDay.toFixed(0)} コイン）`);
}

// --- 以前のえらびかた（記録を見ない） ---
{
  const days = draw(null);
  const withMulti = days.filter((d) => d.some((m) => MULTI.has(m.type))).length / DAYS;
  console.log(`  （以前のえらびかたでは ${(withMulti * 100).toFixed(1)}% の日に「みんなであそぶ」のミッションがまざった）`);
  eq('以前は ひとりでは達成できない日があった', withMulti > 0.1, true);
}

// --- さいきん みんなで遊んだ子には出る ---
{
  const all = draw({ ...beginner, multiplayerRecent: true }).flat();
  eq('みんなで遊んだ子には「みんなであそぶ」のミッションも出る', all.some((m) => MULTI.has(m.type)), true);
}

// --- 記録の高い子には ぜんぶ出る ---
{
  const strong = { maxCombo: 80, suddenDeath: 40, bestPlayExp: 8000, maxDailyPlays: 15, multiplayerRecent: true };
  const ids = new Set(draw(strong, 30).flat().map((m) => m.id));
  eq('記録の高い子には49しゅるい ぜんぶ出る', ids.size, 49);
  eq(`目標は記録の${MISSION_STRETCH}倍まで（30コンボの子に「50コンボ」は出ない）`, [isReachable({ type: 'combo', target: 45 }, { ...beginner, maxCombo: 30 }), isReachable({ type: 'combo', target: 50 }, { ...beginner, maxCombo: 30 })], [true, false]);
}

// --- 記録のあつめかた ---
{
  const stats = {
    maxComboRecord: 12, suddenDeathRecord: 7, bestPlayExp: 900, lastMultiplayerDate: '2026-11-10',
    daily: { '2026-11-15': { exp: 0, count: 2 }, '2026-11-12': { exp: 0, count: 6 }, '2026-11-01': { exp: 0, count: 20 } },
  };
  const last7 = ['2026-11-15', '2026-11-14', '2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09'];
  eq('この7日のいちばん多いプレイ回数・みんなで遊んだか', missionProfile(stats, '2026-11-15', last7), { maxCombo: 12, suddenDeath: 7, bestPlayExp: 900, maxDailyPlays: 6, multiplayerRecent: true });
  eq('8日前より前は数えない', missionProfile({ ...stats, lastMultiplayerDate: '2026-11-08' }, '2026-11-15', last7).multiplayerRecent, false);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
