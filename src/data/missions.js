/* デイリーミッションの定義（App.jsx から切りだした） */

const MISSION_POOL = [
  { id: 'play_1', type: 'play', target: 1, reward: 20, desc: '今日 1回 プレイする' },
  { id: 'play_2', type: 'play', target: 2, reward: 30, desc: '今日 2回 プレイする' },
  { id: 'play_3', type: 'play', target: 3, reward: 50, desc: '今日 3回 プレイする' },
  { id: 'play_5', type: 'play', target: 5, reward: 100, desc: '今日 5回 プレイする' },
  { id: 'play_7', type: 'play', target: 7, reward: 150, desc: '今日 7回 プレイする' },
  { id: 'play_10', type: 'play', target: 10, reward: 200, desc: '今日 10回 プレイする' },
  { id: 'play_15', type: 'play', target: 15, reward: 300, desc: '今日 15回 プレイする' },
  { id: 'play_20', type: 'play', target: 20, reward: 400, desc: '今日 20回 プレイする' },
  { id: 'play_score_attack_1', type: 'play_score_attack', target: 1, reward: 30, desc: 'スコアアタックを 1回 プレイ' },
  { id: 'play_score_attack_3', type: 'play_score_attack', target: 3, reward: 80, desc: 'スコアアタックを 3回 プレイ' },
  { id: 'play_time_attack_1', type: 'play_time_attack', target: 1, reward: 30, desc: 'タイムアタックを 1回 プレイ' },
  { id: 'play_time_attack_3', type: 'play_time_attack', target: 3, reward: 80, desc: 'タイムアタックを 3回 プレイ' },
  { id: 'play_time_attack_5', type: 'play_time_attack', target: 5, reward: 150, desc: 'タイムアタックを 5回 プレイ' },
  { id: 'play_sudden_death_1', type: 'play_sudden_death', target: 1, reward: 30, desc: 'サドンデスを 1回 プレイ' },
  { id: 'play_sudden_death_3', type: 'play_sudden_death', target: 3, reward: 80, desc: 'サドンデスを 3回 プレイ' },
  { id: 'play_sudden_death_5', type: 'play_sudden_death', target: 5, reward: 150, desc: 'サドンデスを 5回 プレイ' },
  { id: 'combo_5', type: 'combo', target: 5, reward: 30, desc: '1プレイで 5コンボ' },
  { id: 'combo_7', type: 'combo', target: 7, reward: 40, desc: '1プレイで 7コンボ' },
  { id: 'combo_10', type: 'combo', target: 10, reward: 50, desc: '1プレイで 10コンボ' },
  { id: 'combo_15', type: 'combo', target: 15, reward: 80, desc: '1プレイで 15コンボ' },
  { id: 'combo_20', type: 'combo', target: 20, reward: 100, desc: '1プレイで 20コンボ' },
  { id: 'combo_25', type: 'combo', target: 25, reward: 120, desc: '1プレイで 25コンボ' },
  { id: 'combo_30', type: 'combo', target: 30, reward: 150, desc: '1プレイで 30コンボ' },
  { id: 'combo_40', type: 'combo', target: 40, reward: 200, desc: '1プレイで 40コンボ' },
  { id: 'combo_50', type: 'combo', target: 50, reward: 300, desc: '1プレイで 50コンボ' },
  { id: 'combo_60', type: 'combo', target: 60, reward: 400, desc: '1プレイで 60コンボ' },
  { id: 'combo_70', type: 'combo', target: 70, reward: 500, desc: '1プレイで 70コンボ' },
  { id: 'combo_100', type: 'combo', target: 100, reward: 1000, desc: '1プレイで 100コンボ' },
  { id: 'score_300', type: 'score', target: 300, reward: 30, desc: '1プレイで 300pt 獲得' },
  { id: 'score_400', type: 'score', target: 400, reward: 40, desc: '1プレイで 400pt 獲得' },
  { id: 'score_500', type: 'score', target: 500, reward: 50, desc: '1プレイで 500pt 獲得' },
  { id: 'score_700', type: 'score', target: 700, reward: 70, desc: '1プレイで 700pt 獲得' },
  { id: 'score_800', type: 'score', target: 800, reward: 80, desc: '1プレイで 800pt 獲得' },
  { id: 'score_1000', type: 'score', target: 1000, reward: 100, desc: '1プレイで 1000pt 獲得' },
  { id: 'score_1200', type: 'score', target: 1200, reward: 120, desc: '1プレイで 1200pt 獲得' },
  { id: 'score_1500', type: 'score', target: 1500, reward: 150, desc: '1プレイで 1500pt 獲得' },
  { id: 'score_2000', type: 'score', target: 2000, reward: 200, desc: '1プレイで 2000pt 獲得' },
  { id: 'score_2500', type: 'score', target: 2500, reward: 250, desc: '1プレイで 2500pt 獲得' },
  { id: 'score_3000', type: 'score', target: 3000, reward: 300, desc: '1プレイで 3000pt 獲得' },
  { id: 'score_4000', type: 'score', target: 4000, reward: 400, desc: '1プレイで 4000pt 獲得' },
  { id: 'score_5000', type: 'score', target: 5000, reward: 500, desc: '1プレイで 5000pt 獲得' },
  { id: 'score_7000', type: 'score', target: 7000, reward: 700, desc: '1プレイで 7000pt 獲得' },
  { id: 'score_10000', type: 'score', target: 10000, reward: 1000, desc: '1プレイで 10000pt 獲得' },
  { id: 'sudden_death_correct_10', type: 'sudden_death_correct', target: 10, reward: 50, desc: 'サドンデスで 10問 正解' },
  { id: 'sudden_death_correct_20', type: 'sudden_death_correct', target: 20, reward: 150, desc: 'サドンデスで 20問 正解' },
  { id: 'sudden_death_correct_30', type: 'sudden_death_correct', target: 30, reward: 300, desc: 'サドンデスで 30問 正解' },
  { id: 'sudden_death_correct_50', type: 'sudden_death_correct', target: 50, reward: 500, desc: 'サドンデスで 50問 正解' },
  { id: 'play_boss_raid_1', type: 'play_boss_raid', target: 1, reward: 50, desc: 'みんなでボスバトルを 1回 プレイ' },
  { id: 'play_territory_1', type: 'play_territory', target: 1, reward: 50, desc: 'みんなでじんとりバトルを 1回 プレイ' },
];

// 「みんなであそぶ」でしか進まないミッション
const MULTIPLAYER_TYPES = new Set(['play_boss_raid', 'play_territory']);

// ミッションの目標は、その子の記録の1.5倍まで（記録がまだ低くても、下の値までは出す）
export const MISSION_STRETCH = 1.5;
const FLOOR = { combo: 10, sudden_death_correct: 10, score: 500, play: 3 };

/**
 * その子の記録から、ミッションの目標の上限を決めるための材料をあつめる。
 * daily のキーは YYYY-MM-DD（statsStore.js）。today も同じ形
 */
export const missionProfile = (stats, today, recentKeys) => {
  const recent = new Set(recentKeys);
  let maxDailyPlays = 0;
  for (const [day, d] of Object.entries(stats.daily || {})) if (recent.has(day)) maxDailyPlays = Math.max(maxDailyPlays, d.count || 0);
  return {
    maxCombo: stats.maxComboRecord || 0,
    suddenDeath: stats.suddenDeathRecord || 0,
    bestPlayExp: stats.bestPlayExp || 0,
    maxDailyPlays,
    multiplayerRecent: !!stats.lastMultiplayerDate && recent.has(stats.lastMultiplayerDate),
  };
};

/** その子に出してよいミッションか（ひとりで達成できる・記録から遠すぎない） */
export const isReachable = (m, p) => {
  if (MULTIPLAYER_TYPES.has(m.type)) return p.multiplayerRecent;
  const cap = (floor, record) => Math.max(floor, Math.ceil(record * MISSION_STRETCH));
  if (m.type === 'combo') return m.target <= cap(FLOOR.combo, p.maxCombo);
  if (m.type === 'sudden_death_correct') return m.target <= cap(FLOOR.sudden_death_correct, p.suddenDeath);
  if (m.type === 'score') return m.target <= cap(FLOOR.score, p.bestPlayExp);
  if (m.type.startsWith('play')) return m.target <= cap(FLOOR.play, p.maxDailyPlays);
  return true;
};

/**
 * その日のミッションを count こ えらぶ。
 * profile（missionProfile）をわたすと、
 *   ・「みんなであそぶ」のミッションは、さいきん（7日のうちに）みんなで遊んだ子にだけ出す
 *     （以前は ひとりで遊ぶ子にも出て、およそ6日に1日は 達成できないミッションがまざった）
 *   ・目標は その子の記録の1.5倍まで（はじめたばかりの子に「1プレイで100コンボ」を出さない）
 *   ・同じ種類は1日に1つまで（「3回プレイ」と「5回プレイ」が同じ日に出ない）
 * 報酬の高いものほど出にくく、連続日数が長いほど 高いものが出やすい（以前と同じ）
 */
export const getRandomMissions = (count = 3, streak = 0, profile = null) => {
  let pool = profile ? MISSION_POOL.filter((m) => isReachable(m, profile)) : [...MISSION_POOL];
  const selected = [];

  for (let i = 0; i < count; i++) {
    if (pool.length === 0) break;
    const weights = pool.map(m => {
      const baseWeight = 1000 / m.reward;
      const streakBonus = 1 + (m.reward / 100) * (streak * 0.05);
      return baseWeight * streakBonus;
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    let selectedIdx = pool.length - 1;

    for (let j = 0; j < weights.length; j++) {
      r -= weights[j];
      if (r <= 0) { selectedIdx = j; break; }
    }

    const picked = pool[selectedIdx];
    selected.push({ ...picked, current: 0, claimed: false });
    pool = profile ? pool.filter((m) => m.type !== picked.type) : pool.filter((_, j) => j !== selectedIdx);
  }

  return selected;
};
