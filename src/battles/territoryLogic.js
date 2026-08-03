/* じんとりバトルの「決まりごと」と計算（TerritoryBattle.jsx から切りだした）
 *
 * 盤面の定義・ぬりのコスト計算・スペシャルやラッキーマスの抽選など、
 * ホストが正解として持つロジックだけを置く。絵は入っていない。
 *
 * 画面（盤面・インクのはねる演出・結果発表）は ../TerritoryBattle.jsx にあり、
 * そちらは「みんなであそぶ」を選ぶまで読みこまれない（Part I §5）。
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// ==========================================
// じんとりバトル(TERRITORY)モード
//   - 7x7盤面の定義・コスト計算・スペシャル/ラッキーマスの純関数 (ホスト権威ロジックが使う)
//   - 盤面UI/スコアバー/イベント演出/結果画面 (全端末が terr_state スナップショットから描画)
//
// ルール:
//   - あか/あおの2チームにわかれ、正解するたびに「ねらっているマス」へ1ぬり(フィーバー中は2ぬり)
//   - マスごとに必要ぬり数(コスト)があり、たまると自分のチームの色にぬれる
//   - マスをぬると、となりのマスにもインクがはねる(+1) → れんさでいっきに ぬれることがある
//   - 敵のマスをうばうには +1、自陣にとなり合っていないマスも +1 かかる(前線を広げるほうが安い)
//   - ★マスとまんなかのマスはコストが高いかわりに、終了時のポイントが大きい
//   - ？マス(ラッキーマス)をとると、スペシャルチャージ / インクばくはつ / ラッシュ のどれかが起きる
//   - 正解でスペシャルゲージがたまり、満タンで スーパーチャクチ / スプラッシュライン / インクラッシュ を発動
//   - のこり30秒は「ラストスパート」でぬりが2ばい(逆転のチャンス)
//   - 盤面が全部うまっても試合はつづく(ここからは全マスのうばいあい)
//   - 制限時間終了時に合計ポイントが多いチームの勝ち
// ==========================================

export const TERRITORY_CONSTANTS = {
  COLS: 7,
  ROWS: 7,
  BASE_COST: 2,      // ふつうのマスに必要なぬり数
  STAR_COST: 4,      // ★マスに必要なぬり数(高いぶん ポイントも大きい)
  CENTER_COST: 6,    // まんなかのマスに必要なぬり数(盤面いちばんの目標)
  LUCKY_COST: 2,     // ？マス(ラッキーマス)に必要なぬり数
  STEAL_EXTRA: 1,    // 敵のマスをうばうときの追加コスト
  REMOTE_EXTRA: 1,   // 自陣にとなり合っていないマスの追加コスト
  FEVER_CHARGE: 2,   // フィーバー(5コンボ以上)中の1正解あたりのぬり数
  SPLASH: 1,         // マスをぬった瞬間、となりのマスへはねるインクの量
  SPECIAL_MAX: 10,   // スペシャルゲージが満タンになるまでのぬり数
  SPECIAL_FEVER_GAIN: 2, // フィーバー中のゲージ増加量
  RUSH_MS: 12000,    // インクラッシュ(自分のぬりが3ばい)のつづく時間
  RUSH_MULT: 3,
  LAST_SPURT_SEC: 30, // のこりこの秒数から ラストスパート(ぬり2ばい)
  LAST_SPURT_MULT: 2,
  HEARTBEAT_MS: 2000,
  EVENT_MS: 2000,      // イベントバナーの表示時間
  MAX_RESOLVE_LOOPS: 24, // れんさ(連鎖)の安全上限
};

export const TEAMS = {
  red: { id: 'red', label: 'あか', color: '#EF4444', deep: '#B91C1C', soft: 'rgba(239,68,68,0.18)' },
  blue: { id: 'blue', label: 'あお', color: '#3B82F6', deep: '#1D4ED8', soft: 'rgba(59,130,246,0.18)' },
};

export const otherTeam = (team) => (team === 'red' ? 'blue' : 'red');

const N = TERRITORY_CONSTANTS.COLS * TERRITORY_CONSTANTS.ROWS;
const HOME_CELLS = { 0: 'red', [N - 1]: 'blue' }; // 左上=あか本陣 / 右下=あお本陣(うばえない)
const CENTER_IDX = Math.floor(N / 2);             // 24
const STAR_SET = new Set([6, 16, 32, 42]);        // 180度回転対称に配置(両チーム公平)
const LUCKY_SET = new Set([10, 20, 28, 38]);      // ？マスも180度回転対称

// マスの静的定義(全端末で同一)。home はうばえない本陣
export const CELL_DEFS = Array.from({ length: N }, (_, i) => {
  if (HOME_CELLS[i]) return { cost: 0, value: 1, star: false, center: false, lucky: false, home: HOME_CELLS[i] };
  if (i === CENTER_IDX) return { cost: TERRITORY_CONSTANTS.CENTER_COST, value: 5, star: true, center: true, lucky: false, home: null };
  if (STAR_SET.has(i)) return { cost: TERRITORY_CONSTANTS.STAR_COST, value: 3, star: true, center: false, lucky: false, home: null };
  if (LUCKY_SET.has(i)) return { cost: TERRITORY_CONSTANTS.LUCKY_COST, value: 1, star: false, center: false, lucky: true, home: null };
  return { cost: TERRITORY_CONSTANTS.BASE_COST, value: 1, star: false, center: false, lucky: false, home: null };
});

export const TOTAL_VALUE = CELL_DEFS.reduce((s, d) => s + d.value, 0);

// 上下左右のとなりマス(前計算)
const NEIGHBORS = Array.from({ length: N }, (_, i) => {
  const c = i % TERRITORY_CONSTANTS.COLS; const r = Math.floor(i / TERRITORY_CONSTANTS.COLS);
  const list = [];
  if (c > 0) list.push(i - 1);
  if (c < TERRITORY_CONSTANTS.COLS - 1) list.push(i + 1);
  if (r > 0) list.push(i - TERRITORY_CONSTANTS.COLS);
  if (r < TERRITORY_CONSTANTS.ROWS - 1) list.push(i + TERRITORY_CONSTANTS.COLS);
  return list;
});

// ななめもふくむ8方向(インクばくはつ用)
const NEIGHBORS8 = Array.from({ length: N }, (_, i) => {
  const c = i % TERRITORY_CONSTANTS.COLS; const r = Math.floor(i / TERRITORY_CONSTANTS.COLS);
  const list = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr; const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= TERRITORY_CONSTANTS.ROWS || nc >= TERRITORY_CONSTANTS.COLS) continue;
      list.push(nr * TERRITORY_CONSTANTS.COLS + nc);
    }
  }
  return list;
});

export const createTerritoryCells = () => Array.from({ length: N }, (_, i) => ({
  owner: CELL_DEFS[i].home || null,
  charge: { red: 0, blue: 0 },
}));

export const adjacentToTeam = (cells, idx, team) => NEIGHBORS[idx].some(n => cells[n].owner === team);

// ねらえるマスか(本陣と自分のチームのマスはねらえない)
export const isSelectable = (cells, idx, team) => !CELL_DEFS[idx].home && cells[idx].owner !== team;

// そのチームがこのマスをぬりきるのに必要な合計ぬり数
export const effectiveCost = (cells, idx, team) => {
  let cost = CELL_DEFS[idx].cost;
  if (cells[idx].owner && cells[idx].owner !== team) cost += TERRITORY_CONSTANTS.STEAL_EXTRA;
  if (!adjacentToTeam(cells, idx, team)) cost += TERRITORY_CONSTANTS.REMOTE_EXTRA;
  return cost;
};

export const remainingFor = (cells, idx, team) => Math.max(1, effectiveCost(cells, idx, team) - cells[idx].charge[team]);

// ターゲット未選択(またはねらいが無効になった)ときの自動選択: 残りぬり数が少なく、価値が高いマスを優先
export const autoPickTarget = (cells, team) => {
  let best = null; let bestRemain = Infinity; let bestValue = -1;
  for (let i = 0; i < cells.length; i++) {
    if (!isSelectable(cells, i, team)) continue;
    const remain = remainingFor(cells, i, team);
    const value = CELL_DEFS[i].value;
    if (remain < bestRemain || (remain === bestRemain && value > bestValue)) {
      best = i; bestRemain = remain; bestValue = value;
    }
  }
  return best;
};

// ねらっていたマスがぬり終わったときの次のねらい。まずは「となり」から選び、前線が自然に広がるようにする
export const pickNearTarget = (cells, team, prevIdx) => {
  if (prevIdx != null && cells[prevIdx]) {
    let best = null; let bestRemain = Infinity; let bestValue = -1;
    for (const n of NEIGHBORS[prevIdx]) {
      if (!isSelectable(cells, n, team)) continue;
      const remain = remainingFor(cells, n, team);
      const value = CELL_DEFS[n].value;
      if (remain < bestRemain || (remain === bestRemain && value > bestValue)) { best = n; bestRemain = remain; bestValue = value; }
    }
    if (best != null) return best;
  }
  return autoPickTarget(cells, team);
};

export const computeScores = (cells) => {
  const scores = { red: 0, blue: 0 };
  cells.forEach((cell, i) => { if (cell.owner) scores[cell.owner] += CELL_DEFS[i].value; });
  return scores;
};

// ==========================================
// スペシャル(正解でたまるゲージが満タンになると発動できる必殺技)
// ==========================================
export const SPECIALS = {
  drop: {
    id: 'drop', name: 'スーパーチャクチ', emoji: '💥', color: '#F59E0B',
    desc: 'ねらったマスに ドーン！まわりにも インクがとぶ',
  },
  line: {
    id: 'line', name: 'スプラッシュライン', emoji: '🌈', color: '#8B5CF6',
    desc: 'たてとよこ 一直線に インクをまきちらす',
  },
  rush: {
    id: 'rush', name: 'インクラッシュ', emoji: '⚡', color: '#10B981',
    desc: '12びょうかん じぶんのぬりが 3ばい！',
  },
};
const SPECIAL_IDS = Object.keys(SPECIALS);
export const rollSpecial = () => SPECIAL_IDS[Math.floor(Math.random() * SPECIAL_IDS.length)];

// スペシャルで盤面にのせるぬり量。rush は盤面に効果がない(発動した本人のバフ)
export const specialCharges = (idx, kind) => {
  if (idx == null) return [];
  if (kind === 'drop') {
    return [{ idx, amount: 6 }, ...NEIGHBORS[idx].map(n => ({ idx: n, amount: 2 }))];
  }
  if (kind === 'line') {
    const col = idx % TERRITORY_CONSTANTS.COLS; const row = Math.floor(idx / TERRITORY_CONSTANTS.COLS);
    const list = [{ idx, amount: 4 }];
    for (let c = 0; c < TERRITORY_CONSTANTS.COLS; c++) { const t = row * TERRITORY_CONSTANTS.COLS + c; if (t !== idx) list.push({ idx: t, amount: 3 }); }
    for (let r = 0; r < TERRITORY_CONSTANTS.ROWS; r++) { const t = r * TERRITORY_CONSTANTS.COLS + col; if (t !== idx) list.push({ idx: t, amount: 3 }); }
    return list;
  }
  return [];
};

// ？マス(ラッキーマス)の効果。special/rush はとった本人へのごほうび(クライアント側で処理)
export const LUCKY_EFFECTS = {
  special: { id: 'special', emoji: '✨', label: 'スペシャル まんタン！' },
  blast: { id: 'blast', emoji: '💣', label: 'インクばくはつ！まわりに ドバー！' },
  rush: { id: 'rush', emoji: '⚡', label: 'ラッシュ！ぬりが 3ばい！' },
};
const LUCKY_IDS = Object.keys(LUCKY_EFFECTS);
export const rollLucky = () => LUCKY_IDS[Math.floor(Math.random() * LUCKY_IDS.length)];

// インクばくはつ: そのマスのまわり8マスへぬりを足す(ホスト専用)
export const applyBlast = (cells, idx, team) => {
  NEIGHBORS8[idx].forEach(n => {
    if (CELL_DEFS[n].home) return;
    if (cells[n].owner === team) return;
    cells[n].charge[team] += 2;
  });
};

// ぬりを1マスに足す(ホスト専用)。本陣・自チームのマスには入らない
export const addCharge = (cells, idx, team, amount) => {
  if (idx == null || !cells[idx]) return false;
  if (CELL_DEFS[idx].home) return false;
  if (cells[idx].owner === team) return false;
  cells[idx].charge[team] += amount;
  return true;
};

// たまったぬり数がコストに達したマスの所有権を確定する(ホスト専用)。
// マスがぬられると隣接コストが変わり、さらにインクがはねる(SPLASH)ため、変化がなくなるまで回す。
// インクがはねるのは「直接ぬって取れたマス」の1回だけ(はねたインクがさらにはねると盤面が一瞬でうまってしまう)。
export const resolveCaptures = (cells) => {
  const captured = [];
  let changed = true;
  let loops = 0;
  while (changed && loops < TERRITORY_CONSTANTS.MAX_RESOLVE_LOOPS) {
    changed = false;
    const canSplash = loops === 0; // 最初の確定だけインクがはねる
    loops += 1;
    for (let i = 0; i < cells.length; i++) {
      if (CELL_DEFS[i].home) continue;
      for (const team of ['red', 'blue']) {
        if (cells[i].owner === team) continue;
        if (cells[i].charge[team] >= effectiveCost(cells, i, team)) {
          captured.push({ idx: i, team, steal: !!cells[i].owner, value: CELL_DEFS[i].value, lucky: CELL_DEFS[i].lucky });
          cells[i].owner = team;
          cells[i].charge.red = 0; cells[i].charge.blue = 0;
          // インクがはねる: となりのマスへ少しだけぬりが入り、れんさが生まれる
          if (canSplash) {
            NEIGHBORS[i].forEach(n => {
              if (CELL_DEFS[n].home || cells[n].owner === team) return;
              cells[n].charge[team] += TERRITORY_CONSTANTS.SPLASH;
            });
          }
          changed = true;
        }
      }
    }
  }
  return captured;
};

// ==========================================
// バトルUIコンポーネント
// ==========================================

// ==========================================
// おうえんキャラクター「ペンキー」
//   じんとりバトルの相棒。回答・盤面イベント・のこり時間に合わせて4まいの絵を出しわけ、
//   いま何がおきているのかを ことばと表情で伝える(小さい子でも戦況がわかるように)。
//   画像は public/characters/ に置き、ボスのドット絵と同じく URL 直参照で読む。
// ==========================================

// import.meta.env はビルドしたときにだけ入る。
// このファイルは決まりごとの検証(scripts/battleLogic.test.mjs)から
// Node で直接読みこむので、無いときは '/' に落とす
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
const CHARACTER_DIR = `${BASE}characters/`;

export const TERRITORY_CHARACTER_NAME = 'ペンキー';

// きもち(mood)ごとの絵とゆれ方。4まいとも同じ大きさの正方形にそろえてあるので入れかえてもズレない
export const CHARACTER_MOODS = {
  idle: {
    file: 'painter-idle.png',
    anim: { y: [0, -5, 0] },
    transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
  },
  fight: {
    file: 'painter-fight.png',
    anim: { rotate: [-3.5, 3.5, -3.5], scale: [1, 1.06, 1] },
    transition: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' },
  },
  win: {
    file: 'painter-win.png',
    anim: { y: [0, -12, 0], rotate: [-6, 6, -6] },
    transition: { duration: 0.7, repeat: Infinity, ease: 'easeInOut' },
  },
  sad: {
    file: 'painter-sad.png',
    anim: { y: [0, 3, 0], rotate: [-1.5, 1.5, -1.5] },
    transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
  },
};

export const territoryCharacterUrl = (mood) => CHARACTER_DIR + (CHARACTER_MOODS[mood] || CHARACTER_MOODS.idle).file;

// 表情が切りかわる瞬間に白ぬけしないよう、4まいまとめて先読みする
export const preloadTerritoryCharacters = () => {
  if (typeof window === 'undefined') return;
  Object.values(CHARACTER_MOODS).forEach(m => { const img = new window.Image(); img.src = CHARACTER_DIR + m.file; });
};

// セリフ。漢字はつかわず、1・2年生でも読めるみじかい応援にする
const CHARACTER_LINES = {
  capture: ['ナイスぬり！', 'いいね その ちょうし！', 'ぬれた ぬれた！'],
  steal: ['よこどり せいこう！', 'うばいかえした！'],
  lostCell: ['うばわれた…！', 'とりかえそう！'],
  chain: ['れんさ さいこう！', 'いっきに ぬれた！'],
  lucky: ['ラッキーマス ゲット！', 'なにが でるかな？'],
  special: ['スペシャル いくよー！', 'どっかーん！'],
  lead: ['リード したよ！'],
  behind: ['おいこされた…！', 'まだ まけてない！'],
  boardFull: ['ぜんぶ うまった！ ここから しょうぶ！'],
  miss: ['ドンマイ！ つぎ いこう', 'あわてない あわてない'],
};
const pickLine = (key) => {
  const list = CHARACTER_LINES[key];
  return list[Math.floor(Math.random() * list.length)];
};

const CHARACTER_REACT_MS = 2200; // 反応を見せておく時間。すぎたら ふだんのきもちへもどる

// 盤面イベント1件をキャラの反応(mood + セリフ)に変える。自分のチームに関係ないものは null
const reactionForEvent = (ev, myTeam) => {
  switch (ev.kind) {
    case 'capture':
      if (ev.team === myTeam) return { mood: 'win', line: pickLine(ev.steal ? 'steal' : 'capture') };
      return ev.steal ? { mood: 'sad', line: pickLine('lostCell') } : null;
    case 'chain':
      return ev.team === myTeam ? { mood: 'win', line: pickLine('chain') } : null;
    case 'lucky':
      return ev.team === myTeam ? { mood: 'win', line: pickLine('lucky') } : null;
    case 'special':
      return ev.team === myTeam ? { mood: 'fight', line: pickLine('special') } : null;
    case 'lead':
      return ev.team === myTeam ? { mood: 'win', line: pickLine('lead') } : { mood: 'sad', line: pickLine('behind') };
    case 'board_full':
      return { mood: 'fight', line: pickLine('boardFull') };
    default:
      return null;
  }
};

// キャラのきもちを決める。イベント直後はその反応を優先し、おちついたら いまの戦況を映す
export const useTerritoryMood = ({ terrState, myTeam, combo = 0, lastSpurt = false, rushActive = false, missAt = 0 }) => {
  const [reaction, setReaction] = useState(null);
  const tokenRef = useRef(0);
  const timerRef = useRef(null);
  const seenRef = useRef(new Set());

  // 新しい反応が来たら古いタイマーの後始末を待たずに差しかえる(token で自分のぶんだけ消す)
  const fire = useCallback((r) => {
    if (!r) return;
    const token = ++tokenRef.current;
    setReaction({ ...r, token });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setReaction(cur => (cur && cur.token === token ? null : cur)), CHARACTER_REACT_MS);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // まちがえた瞬間は はげましにまわる
  useEffect(() => { if (missAt) fire({ mood: 'sad', line: pickLine('miss') }); }, [missAt, fire]);

  // 盤面イベント: まだ見ていないものだけを拾い、そのうち最後の1件に反応する
  useEffect(() => {
    let latest = null;
    (terrState?.events || []).forEach(ev => {
      if (seenRef.current.has(ev.id)) return;
      seenRef.current.add(ev.id);
      const r = reactionForEvent(ev, myTeam);
      if (r) latest = r;
    });
    fire(latest);
  }, [terrState?.events, myTeam, fire]);

  if (reaction) return { mood: reaction.mood, line: reaction.line };

  // 反応がないときの ふだんのきもち(戦況しだいで表情がかわる)
  if (rushActive) return { mood: 'fight', line: 'ラッシュちゅう！ ぬりまくれ！' };
  if (lastSpurt) return { mood: 'fight', line: 'ラストスパート！ ぬり2ばい！' };
  if (combo >= 5) return { mood: 'fight', line: `${combo}コンボ！ フィーバーちゅう！` };
  const scores = terrState?.scores;
  if (scores && myTeam) {
    const diff = scores[myTeam] - scores[otherTeam(myTeam)];
    if (diff >= 4) return { mood: 'win', line: 'リードしてる！ このまま いこう' };
    if (diff <= -4) return { mood: 'fight', line: 'まだ いける！ おいつこう！' };
    return { mood: 'idle', line: 'せっせん！ 1もんずつ ぬろう' };
  }
  return { mood: 'idle', line: 'いっしょに ぬろう！' };
};

// キャラクター本体。ふきだし + 絵。大きさは親から className(w-…)でわたす。
// ふきだしは絵よりも横にはみ出せるので、せまい場所に置くときは bubbleClassName で幅をしぼる
