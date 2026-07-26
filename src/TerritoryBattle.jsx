import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Flag } from 'lucide-react';

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

const CHARACTER_DIR = `${import.meta.env.BASE_URL}characters/`;

export const TERRITORY_CHARACTER_NAME = 'ペンキー';

// きもち(mood)ごとの絵とゆれ方。4まいとも同じ大きさの正方形にそろえてあるので入れかえてもズレない
const CHARACTER_MOODS = {
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
export const TerritoryCharacter = ({ mood = 'idle', line, team, bubble = true, bubbleClassName = 'max-w-[150px] text-[10px]', className = '' }) => {
  const m = CHARACTER_MOODS[mood] || CHARACTER_MOODS.idle;
  const glow = TEAMS[team]?.color || 'var(--primary)';
  return (
    <div className={`relative flex flex-col items-center pointer-events-none select-none ${className}`}>
      {bubble && (
        <AnimatePresence mode="wait">
          {line && (
            <motion.div key={line}
              initial={{ opacity: 0, y: 8, scale: 0.7 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
              transition={{ type: 'spring', bounce: 0.5, duration: 0.35 }}
              className={`relative z-10 mb-1 bg-[var(--panel)] border-2 border-[var(--text)] rounded-xl px-2 py-1 text-center font-black leading-tight text-[var(--text)] shadow-[2px_2px_0_var(--text)] ${bubbleClassName}`}>
              {line}
              <span className="absolute left-1/2 -bottom-[8px] -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[8px] border-t-[var(--text)]" />
            </motion.div>
          )}
        </AnimatePresence>
      )}
      <div className="relative w-full aspect-square">
        {/* チームカラーのやわらかい光。どのテーマ背景でもキャラが浮きたつ */}
        <span className="absolute inset-[10%] rounded-full blur-md opacity-70" style={{ background: `radial-gradient(circle, ${glow}55, transparent 70%)` }} />
        <AnimatePresence mode="wait">
          <motion.div key={mood} className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.2 }}>
            <motion.img src={territoryCharacterUrl(mood)} alt={TERRITORY_CHARACTER_NAME} draggable={false}
              className="w-full h-full object-contain"
              style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.3))' }}
              animate={m.anim} transition={m.transition} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

// インクのしぶき(不定形なブロブ)。マスをぬった瞬間にはじける
const SPLAT_SHAPES = [
  '58% 42% 45% 55% / 50% 45% 55% 50%',
  '42% 58% 60% 40% / 55% 40% 60% 45%',
  '50% 50% 38% 62% / 42% 58% 42% 58%',
];

// ゲーム画面上部のチームスコアバー。バーは盤面全体の価値(TOTAL_VALUE)に対する占有率
export const TerritoryScoreBar = ({ terrState, myTeam, lastSpurt }) => {
  const s = terrState?.scores || { red: 0, blue: 0 };
  const hasCells = !!terrState?.cells;
  const neutral = hasCells ? terrState.cells.filter(c => !c.owner).length : 0;
  const leader = s.red > s.blue ? 'red' : s.blue > s.red ? 'blue' : null;
  const redPct = (s.red / TOTAL_VALUE) * 100;
  const bluePct = (s.blue / TOTAL_VALUE) * 100;
  const diff = Math.abs(s.red - s.blue);
  const close = diff <= 2; // せっせん!
  return (
    <div className={`w-full bg-[var(--panel)] border-b-2 border-[var(--text)] px-3 py-1.5 shrink-0 shadow-sm relative overflow-hidden ${lastSpurt ? 'ring-2 ring-red-500 ring-inset' : ''}`}>
      {lastSpurt && (
        <motion.div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg, rgba(239,68,68,0.18), transparent, rgba(239,68,68,0.18))' }}
          animate={{ opacity: [0.3, 0.9, 0.3] }} transition={{ duration: 1, repeat: Infinity }} />
      )}
      <div className="flex items-center gap-2 relative">
        <motion.span
          className="shrink-0 font-black text-sm text-white rounded-full px-2.5 py-0.5 border-2 border-[var(--text)] tabular-nums"
          style={{ background: TEAMS.red.color }}
          animate={leader === 'red' ? { scale: [1, 1.07, 1] } : { scale: 1 }}
          transition={leader === 'red' ? { duration: 1.2, repeat: Infinity } : {}}
        >
          {leader === 'red' && '👑'}あか {s.red}
        </motion.span>
        <div className="flex-grow h-5 rounded-full overflow-hidden border-2 border-[var(--text)] bg-gray-300 flex relative">
          <motion.div className="h-full shrink-0 relative" initial={{ width: '0%' }} animate={{ width: `${redPct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 18 }} style={{ background: `linear-gradient(180deg, ${TEAMS.red.color}, ${TEAMS.red.deep})` }}>
            <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/40" />
          </motion.div>
          <div className="h-full flex-grow bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.35)_0_6px,transparent_6px_12px)]" />
          <motion.div className="h-full shrink-0 relative" initial={{ width: '0%' }} animate={{ width: `${bluePct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 18 }} style={{ background: `linear-gradient(180deg, ${TEAMS.blue.color}, ${TEAMS.blue.deep})` }}>
            <div className="absolute left-0 top-0 bottom-0 w-2 bg-white/40" />
          </motion.div>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-[var(--text)] drop-shadow-[0_1px_0_rgba(255,255,255,0.8)] pointer-events-none">
            {close ? 'せっせん！' : `${Math.round(redPct)}% - ${Math.round(bluePct)}%`}
          </span>
        </div>
        <motion.span
          className="shrink-0 font-black text-sm text-white rounded-full px-2.5 py-0.5 border-2 border-[var(--text)] tabular-nums"
          style={{ background: TEAMS.blue.color }}
          animate={leader === 'blue' ? { scale: [1, 1.07, 1] } : { scale: 1 }}
          transition={leader === 'blue' ? { duration: 1.2, repeat: Infinity } : {}}
        >
          {s.blue} あお{leader === 'blue' && '👑'}
        </motion.span>
      </div>
      <div className="flex justify-center items-center gap-2 mt-0.5 text-[10px] font-black relative">
        {myTeam && <span style={{ color: TEAMS[myTeam].color }}>あなたは {TEAMS[myTeam].label}チーム！</span>}
        {!hasCells || neutral > 0
          ? <span className="text-[var(--text)] opacity-50">しろいマス のこり {neutral}</span>
          : <span className="text-[var(--primary)]">⚔ ぜんめん うばいあい！</span>}
        {lastSpurt && <span className="text-red-500">⏰ ラストスパート ぬり2ばい！</span>}
      </div>
    </div>
  );
};

// マスの所有権が変わった瞬間の インクスプラット演出
const InkSplat = ({ owner }) => (
  <AnimatePresence>
    {owner && (
      <motion.span key={owner} className="absolute inset-0 pointer-events-none" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.span
          className="absolute inset-0 block"
          style={{ background: '#fff', borderRadius: SPLAT_SHAPES[0] }}
          initial={{ opacity: 0.95, scale: 0.2 }} animate={{ opacity: 0, scale: 1.5 }} transition={{ duration: 0.45 }}
        />
        <motion.span
          className="absolute inset-0 block"
          style={{ background: TEAMS[owner]?.color, borderRadius: SPLAT_SHAPES[1] }}
          initial={{ opacity: 0.9, scale: 0.1, rotate: -25 }} animate={{ opacity: 0, scale: 1.9, rotate: 15 }} transition={{ duration: 0.6, ease: 'easeOut' }}
        />
        {[0, 1, 2, 3].map(d => (
          <motion.span
            key={d}
            className="absolute left-1/2 top-1/2 w-1.5 h-1.5 rounded-full block"
            style={{ background: TEAMS[owner]?.color }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: (d % 2 ? 1 : -1) * (10 + d * 5), y: (d < 2 ? -1 : 1) * (10 + d * 4), opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        ))}
      </motion.span>
    )}
  </AnimatePresence>
);

// 7x7盤面。タップで「ねらうマス」を選ぶ。terr_state スナップショットだけから描画する
export const TerritoryBoard = ({ terrState, myTeam, myId, targetIdx, onSelect, lastSpurt }) => {
  const cells = terrState?.cells;
  if (!cells || !myTeam) {
    return <div className="flex items-center justify-center h-full font-bold text-sm text-[var(--text)] opacity-60">ばんめんを じゅんびちゅう…</div>;
  }
  const enemy = otherTeam(myTeam);

  // 仲間・敵が今ねらっているマス(小さいドットで表示。作戦の分担・かぶり防止に使う)
  const targetMarks = {};
  Object.entries(terrState.targets || {}).forEach(([pid, idx]) => {
    if (pid === myId || idx == null || !cells[idx]) return;
    const t = terrState.teams?.[pid]?.team;
    if (!t) return;
    (targetMarks[idx] = targetMarks[idx] || []).push(t);
  });

  return (
    // モバイル(上段配置)は高さ基準・PC(左カラム配置)は幅基準で正方形を保つ。行を1frで固定してマスを均等にする
    <div className={`grid grid-cols-7 grid-rows-[repeat(7,minmax(0,1fr))] gap-[3px] aspect-square h-full max-h-full max-w-full md:h-auto md:w-full mx-auto select-none rounded-lg p-[3px] transition-shadow ${lastSpurt ? 'shadow-[0_0_18px_rgba(239,68,68,0.7)]' : ''}`}>
      {cells.map((cell, i) => {
        const def = CELL_DEFS[i];
        const selectable = isSelectable(cells, i, myTeam);
        const cost = selectable ? effectiveCost(cells, i, myTeam) : 0;
        const remain = selectable ? Math.max(1, cost - cell.charge[myTeam]) : 0;
        const myProg = selectable && cost > 0 ? Math.min(1, cell.charge[myTeam] / cost) : 0;
        const enemyCost = !def.home && cell.owner !== enemy ? effectiveCost(cells, i, enemy) : 0;
        const enemyProg = enemyCost > 0 ? Math.min(1, cell.charge[enemy] / enemyCost) : 0;
        const isMyTarget = targetIdx === i;
        const stealing = selectable && !!cell.owner;   // 敵のマス(うばう対象)
        const almost = selectable && remain === 1;     // あと1回でぬれる!
        const frontier = selectable && !cell.owner && adjacentToTeam(cells, i, myTeam); // 前線(安くぬれる)
        const enemyAlmost = enemyCost > 0 && enemyCost - cell.charge[enemy] <= 1 && cell.owner === myTeam; // うばわれそう!
        return (
          <motion.button
            key={i}
            whileTap={selectable ? { scale: 0.85 } : {}}
            animate={almost ? { scale: [1, 1.06, 1] } : { scale: 1 }}
            transition={almost ? { duration: 0.9, repeat: Infinity } : { duration: 0.2 }}
            onPointerDown={(e) => { e.preventDefault(); if (selectable) onSelect?.(i); }}
            className={`relative rounded-md overflow-hidden flex items-center justify-center outline-none touch-manipulation ${isMyTarget ? 'z-10' : ''} ${selectable ? '' : 'cursor-default'}`}
            style={{
              background: cell.owner
                ? `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.42), rgba(255,255,255,0) 58%), ${TEAMS[cell.owner].color}`
                : 'var(--bg)',
              border: cell.owner
                ? '2px solid rgba(0,0,0,0.25)'
                : frontier ? `2px solid ${TEAMS[myTeam].color}` : '2px dashed rgba(128,128,128,0.45)',
              boxShadow: isMyTarget ? `0 0 0 3px var(--accent), 0 0 10px ${TEAMS[myTeam].color}` : enemyAlmost ? '0 0 0 2px #F59E0B' : 'none',
            }}
            aria-label={`マス${i}`}
          >
            {/* 自チームのぬり進み(下からインクがたまる) / 敵チームのぬり進み(上の細いバー) */}
            {myProg > 0 && (
              <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ height: `${myProg * 100}%`, background: TEAMS[myTeam].color, opacity: 0.5 }}>
                <div className="absolute -top-[5px] inset-x-[-10%] h-[10px] rounded-[50%]" style={{ background: TEAMS[myTeam].color, opacity: 0.9 }} />
              </div>
            )}
            {enemyProg > 0 && <div className="absolute top-0 left-0 h-[22%] pointer-events-none" style={{ width: `${enemyProg * 100}%`, background: TEAMS[enemy].color, opacity: 0.85 }} />}

            {/* マスの中身 */}
            {def.home ? (
              <span className="text-sm md:text-base leading-none">🏠</span>
            ) : cell.owner && !selectable ? (
              def.star ? <span className="text-[11px] md:text-sm leading-none text-yellow-200 drop-shadow">★</span>
                : def.lucky ? <span className="text-[10px] md:text-xs leading-none text-white opacity-80">✓</span> : null
            ) : (
              <span className="relative flex flex-col items-center leading-none pointer-events-none">
                {def.star && <span className="text-[8px] md:text-[10px] text-amber-500 font-black">{def.center ? '★5' : '★3'}</span>}
                {def.lucky && (
                  <motion.span className="text-[10px] md:text-xs font-black" style={{ color: '#D946EF' }}
                    animate={{ scale: [1, 1.25, 1], rotate: [-8, 8, -8] }} transition={{ duration: 1.4, repeat: Infinity }}>？</motion.span>
                )}
                <span className={`font-black tabular-nums ${def.star || def.lucky ? 'text-[10px] md:text-xs' : 'text-[11px] md:text-sm'} ${cell.owner ? 'text-white' : almost ? 'text-[var(--primary)]' : 'text-[var(--text)] opacity-80'}`}>
                  {stealing ? '⚡' : ''}{remain}
                </span>
              </span>
            )}

            {/* ねらっているマスのマーカー */}
            {isMyTarget && (
              <motion.span className="absolute inset-0 pointer-events-none rounded-md border-2 border-[var(--accent)]"
                animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity }} />
            )}

            {/* ほかのプレイヤーのねらいドット */}
            {targetMarks[i] && (
              <span className="absolute top-[2px] right-[2px] flex gap-[2px] pointer-events-none">
                {targetMarks[i].slice(0, 3).map((t, j) => (
                  <span key={j} className="w-[6px] h-[6px] rounded-full border border-white" style={{ background: TEAMS[t].color }} />
                ))}
              </span>
            )}

            <InkSplat owner={cell.owner} />
          </motion.button>
        );
      })}
    </div>
  );
};

// ==========================================
// スペシャルボタン(正解でたまるゲージ / 満タンでタップして発動)
// ==========================================
export const TerritorySpecialButton = ({ gauge, kind, onFire }) => {
  const ready = gauge >= TERRITORY_CONSTANTS.SPECIAL_MAX;
  const ratio = Math.min(1, gauge / TERRITORY_CONSTANTS.SPECIAL_MAX);
  const sp = SPECIALS[kind] || SPECIALS.drop;
  const RADIUS = 26; const CIRC = 2 * Math.PI * RADIUS;
  return (
    <div className="absolute top-0 right-0 z-30 flex flex-row-reverse items-center gap-1">
      <motion.button
        className={`w-16 h-16 rounded-full flex flex-col items-center justify-center border-[3px] border-[var(--text)] shadow-[0_3px_0_var(--text)] select-none touch-manipulation outline-none ${ready ? '' : 'bg-[var(--bg)] opacity-80'}`}
        style={ready ? { background: sp.color } : undefined}
        animate={ready ? { scale: [1, 1.14, 1] } : { scale: 1 }} transition={ready ? { duration: 0.6, repeat: Infinity } : {}}
        whileTap={ready ? { scale: 0.85 } : {}}
        onPointerDown={(e) => { e.preventDefault(); if (ready) onFire?.(kind); }}
        aria-label="スペシャル"
      >
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r={RADIUS} fill="none" stroke="var(--text)" strokeWidth="4" opacity="0.15" />
          <circle cx="30" cy="30" r={RADIUS} fill="none" stroke={ready ? '#fff' : 'var(--secondary)'} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - ratio)} style={{ transition: 'stroke-dashoffset 0.3s' }} />
        </svg>
        <span className={`leading-none ${ready ? 'text-3xl drop-shadow' : 'text-xl opacity-40 grayscale'}`}>{sp.emoji}</span>
        {!ready && <span className="text-[9px] font-black text-[var(--text)] opacity-50 tabular-nums">{gauge}/{TERRITORY_CONSTANTS.SPECIAL_MAX}</span>}
      </motion.button>
      {ready && (
        <motion.span initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
          className="px-2 py-0.5 rounded-full text-[10px] font-black text-white border-2 border-[var(--text)] whitespace-nowrap shadow-[2px_2px_0_var(--text)]"
          style={{ background: sp.color }}>{sp.name}</motion.span>
      )}
    </div>
  );
};

// じぶんがインクラッシュ中のあいだ、画面ふちに出すバッジ
export const TerritoryRushBadge = ({ until }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [until]);
  if (!until || now >= until) return null;
  const left = Math.ceil((until - now) / 1000);
  return (
    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
      className="absolute left-0 top-0 z-30 px-2 py-1 rounded-full border-2 border-[var(--text)] font-black text-[10px] text-white flex items-center gap-1"
      style={{ background: SPECIALS.rush.color }}>
      ⚡ ラッシュ {left}
    </motion.div>
  );
};

// ==========================================
// ラストスパート演出(のこり時間はクライアントで計算する)
// ==========================================
export const TerritoryLastSpurtFx = ({ startTime, timeLimitSec, onCue, onSpurtChange }) => {
  const [remain, setRemain] = useState(() => Math.max(0, Math.ceil(timeLimitSec - (Date.now() - startTime) / 1000)));
  const onCueRef = useRef(onCue);
  useEffect(() => { onCueRef.current = onCue; }, [onCue]);
  const onSpurtChangeRef = useRef(onSpurtChange);
  useEffect(() => { onSpurtChangeRef.current = onSpurtChange; }, [onSpurtChange]);
  useEffect(() => {
    if (!timeLimitSec) return;
    let id; let last = -1;
    const tick = () => {
      const sec = Math.max(0, Math.ceil(timeLimitSec - (Date.now() - startTime) / 1000));
      if (sec !== last) { last = sec; setRemain(sec); }
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [startTime, timeLimitSec]);

  useEffect(() => {
    if (!timeLimitSec) return;
    if (remain === TERRITORY_CONSTANTS.LAST_SPURT_SEC) onCueRef.current?.('spurt');
    else if (remain > 0 && remain <= 5) onCueRef.current?.('tick');
  }, [remain, timeLimitSec]);

  // ぬり2ばいの判定はゲーム本体(正解処理)でも使うので、切りかわりを親へ伝える
  const spurt = !!timeLimitSec && remain > 0 && remain <= TERRITORY_CONSTANTS.LAST_SPURT_SEC;
  useEffect(() => { onSpurtChangeRef.current?.(spurt); }, [spurt]);

  if (!timeLimitSec) return null;
  return (
    <>
      {spurt && (
        <motion.div className="fixed inset-0 z-[45] pointer-events-none"
          style={{ boxShadow: 'inset 0 0 90px rgba(239,68,68,0.55)' }}
          animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.1, repeat: Infinity }} />
      )}
      <AnimatePresence>
        {remain <= TERRITORY_CONSTANTS.LAST_SPURT_SEC && remain > TERRITORY_CONSTANTS.LAST_SPURT_SEC - 3 && (
          <motion.div key="spurt-banner" className="fixed inset-x-0 top-[34%] z-[62] flex justify-center pointer-events-none px-4"
            initial={{ opacity: 0, scale: 0.5, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: -3 }} exit={{ opacity: 0, scale: 1.4 }}
            transition={{ type: 'spring', bounce: 0.6 }}>
            <div className="bg-red-500 border-[5px] border-[var(--text)] rounded-2xl px-7 py-4 font-black text-2xl md:text-4xl text-white shadow-[6px_6px_0_var(--text)] text-center">
              ⏰ ラストスパート！<br /><span className="text-lg md:text-2xl">ぬりが 2ばい！</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {remain > 0 && remain <= 5 && (
          <motion.div key={`cd-${remain}`} className="fixed inset-0 z-[61] flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0, scale: 2.4 }} animate={{ opacity: 0.9, scale: 1 }} exit={{ opacity: 0, scale: 0.4 }} transition={{ duration: 0.35 }}>
            <span className="font-black text-[9rem] text-red-500 drop-shadow-[0_6px_0_var(--text)]">{remain}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

// ==========================================
// 全画面イベント演出(うばった / れんさ / ラッキーマス / スペシャル / ぎゃくてん / 盤面うまった)
// ==========================================
export const TerritoryEventOverlay = ({ events }) => {
  const [now, setNow] = useState(() => Date.now());
  const live = (events || []).filter(e => now < e.at + (e.kind === 'special' ? 1800 : TERRITORY_CONSTANTS.EVENT_MS));
  useEffect(() => {
    const last = events && events[events.length - 1];
    if (!last) return;
    // 表示中だけ tick する(最後のイベントが切れたら自分でとまる)
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t > last.at + 2400) clearInterval(id);
    }, 180);
    return () => clearInterval(id);
  }, [events]);

  const cutIn = live.find(e => e.kind === 'special');
  const banners = live.filter(e => e.kind !== 'special').slice(-2);

  const bannerContent = (e) => {
    if (e.kind === 'board_full') return { color: 'var(--text)', node: <>🏁 ばんめん ぜんぶ うまった！ここからは うばいあい！</> };
    if (e.kind === 'lead') return { color: TEAMS[e.team]?.color, node: <>🔥 ぎゃくてん！ {TEAMS[e.team]?.label}チームが リード！</> };
    if (e.kind === 'chain') return { color: TEAMS[e.team]?.color, node: <>🌊 れんさ！ {e.count}マス いっきに ぬった！</> };
    if (e.kind === 'lucky') return { color: '#D946EF', node: <>🎁 ラッキーマス！ {LUCKY_EFFECTS[e.effect]?.emoji} {LUCKY_EFFECTS[e.effect]?.label}</> };
    if (e.kind === 'capture' && e.steal) return { color: TEAMS[e.team]?.color, node: <>⚡ {e.name} が マスを うばった！</> };
    if (e.kind === 'capture') return { color: TEAMS[e.team]?.color, node: <>⭐ {e.name} が ボーナスマスを ゲット！</> };
    return null;
  };

  return (
    <>
      <AnimatePresence>
        {cutIn && (
          <motion.div key={cutIn.id} className="fixed inset-0 z-[64] flex items-center justify-center pointer-events-none overflow-hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <motion.div className="absolute h-28 w-[160%] -skew-y-6 opacity-95"
              style={{ background: SPECIALS[cutIn.effect]?.color || '#F59E0B' }}
              initial={{ x: '-130%' }} animate={{ x: ['-130%', '0%', '0%', '130%'] }} transition={{ duration: 1.7, times: [0, 0.2, 0.7, 1], ease: 'easeOut' }} />
            <motion.div className="relative z-10 flex flex-col items-center"
              initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: [0.4, 1.15, 1, 1, 0.9], opacity: [0, 1, 1, 1, 0] }}
              transition={{ duration: 1.7, times: [0, 0.22, 0.4, 0.75, 1] }}>
              <span className="text-6xl md:text-7xl drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]">{SPECIALS[cutIn.effect]?.emoji}</span>
              <div className="mt-1 bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-2xl px-5 py-2 shadow-[4px_4px_0_var(--text)] text-center">
                <div className="font-black text-lg md:text-2xl" style={{ color: TEAMS[cutIn.team]?.color }}>{cutIn.name}</div>
                <div className="font-black text-sm md:text-lg text-[var(--text)]">{SPECIALS[cutIn.effect]?.name}！</div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-x-0 top-[20%] z-[60] flex flex-col items-center gap-1.5 pointer-events-none px-4">
        <AnimatePresence>
          {banners.map(e => {
            const c = bannerContent(e);
            if (!c) return null;
            return (
              <motion.div key={e.id}
                initial={{ opacity: 0, scale: 0.6, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: 'spring', bounce: 0.5 }}>
                <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-2xl px-6 py-3 font-black text-base md:text-xl shadow-[4px_4px_0_var(--text)] text-center" style={{ color: c.color }}>
                  {c.node}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </>
  );
};

// ==========================================
// 結果画面: チーム勝敗 + 貢献度パネル
// ==========================================

const MVP_DEFS = [
  { key: 'captures', label: 'ぬりMVP', emoji: '🖌', min: 1 },
  { key: 'charges', label: 'こうけんMVP', emoji: '💪', min: 1 },
  { key: 'steals', label: 'うばいMVP', emoji: '⚡', min: 1 },
  { key: 'specials', label: 'スペシャルMVP', emoji: '💥', min: 1 },
  { key: 'maxCombo', label: 'コンボMVP', emoji: '🔥', min: 2 },
];

// 0 から目標値へ数字がカウントアップする表示(結果発表のドキドキ用)
const CountUp = ({ to, duration = 900, className, suffix = '' }) => {
  const [v, setV] = useState(0);
  useEffect(() => {
    let id; const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [to, duration]);
  return <span className={className}>{v}{suffix}</span>;
};

export const TerritoryResultPanel = ({ territoryResult, myId }) => {
  const { scores = { red: 0, blue: 0 }, cells = [], contributions = {}, teams = {} } = territoryResult || {};
  const myTeam = teams[myId]?.team;
  const winner = scores.red > scores.blue ? 'red' : scores.blue > scores.red ? 'blue' : null;
  const iWon = winner && myTeam === winner;
  const list = Object.entries(contributions).map(([id, c]) => ({ id, ...c })).sort((a, b) => (b.charges || 0) - (a.charges || 0));
  const maxCharges = Math.max(1, ...list.map(p => p.charges || 0));
  const mvps = MVP_DEFS.map(def => {
    const best = list.reduce((acc, p) => ((p[def.key] || 0) > (acc?.[def.key] || 0) ? p : acc), null);
    return best && (best[def.key] || 0) >= def.min ? { ...def, winner: best } : null;
  }).filter(Boolean);

  return (
    <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] p-4 w-full mb-6 shrink-0 relative overflow-hidden flex flex-col items-center shadow-[4px_4px_0_var(--text)]">
      {winner && (
        <motion.div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(circle at 50% 0%, ${TEAMS[winner].soft}, transparent 70%)` }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
      )}
      <motion.h3 initial={{ scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.6 }}
        className="font-black text-2xl mb-1 flex items-center gap-2 relative" style={{ color: winner ? TEAMS[winner].color : 'var(--text)' }}>
        {winner ? <><Trophy size={26} className="text-yellow-400" /> {TEAMS[winner].label}チームの かち！</> : <><Flag size={26} /> ひきわけ！</>}
      </motion.h3>

      {/* ペンキーも いっしょに よろこぶ / くやしがる */}
      <motion.div initial={{ scale: 0, y: 10 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', bounce: 0.5, delay: 0.2 }} className="relative">
        <TerritoryCharacter
          mood={!winner || !myTeam ? 'idle' : iWon ? 'win' : 'sad'}
          line={!winner ? 'いい しょうぶ だったね！' : !myTeam ? 'おつかれさま！' : iWon ? 'やったー！ ぬりまくったね！' : 'くやしい…！ つぎは かとうね'}
          team={myTeam}
          bubbleClassName="max-w-[180px] md:max-w-[240px] text-[11px]"
          className="w-32 md:w-40 mb-1"
        />
      </motion.div>

      {myTeam && (
        <p className="font-bold text-sm mb-3 text-[var(--text)] opacity-80 relative">
          {winner ? (iWon ? '🎉 あなたのチームが かった！' : 'ざんねん…つぎは かてる！') : 'いいしょうぶだった！'}
        </p>
      )}

      {/* 最終スコアバー + ぬり率カウントアップ */}
      <div className="flex items-center gap-2 w-full mb-1 relative">
        <span className="shrink-0 font-black text-sm text-white rounded-full px-2.5 py-0.5 border-2 border-[var(--text)] tabular-nums" style={{ background: TEAMS.red.color }}>あか {scores.red}</span>
        <div className="flex-grow h-5 rounded-full overflow-hidden border-2 border-[var(--text)] bg-gray-300 flex">
          <motion.div className="h-full shrink-0" initial={{ width: '0%' }} animate={{ width: `${(scores.red / TOTAL_VALUE) * 100}%` }} transition={{ duration: 1, ease: 'easeOut' }} style={{ background: `linear-gradient(180deg, ${TEAMS.red.color}, ${TEAMS.red.deep})` }} />
          <div className="h-full flex-grow" />
          <motion.div className="h-full shrink-0" initial={{ width: '0%' }} animate={{ width: `${(scores.blue / TOTAL_VALUE) * 100}%` }} transition={{ duration: 1, ease: 'easeOut' }} style={{ background: `linear-gradient(180deg, ${TEAMS.blue.color}, ${TEAMS.blue.deep})` }} />
        </div>
        <span className="shrink-0 font-black text-sm text-white rounded-full px-2.5 py-0.5 border-2 border-[var(--text)] tabular-nums" style={{ background: TEAMS.blue.color }}>{scores.blue} あお</span>
      </div>
      <div className="flex justify-between w-full text-[11px] font-black mb-3 relative">
        <CountUp to={Math.round((scores.red / TOTAL_VALUE) * 100)} suffix="%" className="text-[#EF4444]" />
        <span className="text-[var(--text)] opacity-50">ぬり率</span>
        <CountUp to={Math.round((scores.blue / TOTAL_VALUE) * 100)} suffix="%" className="text-[#3B82F6]" />
      </div>

      {/* 最終盤面のミニ表示(1マスずつ ぱらぱらと開く) */}
      {cells.length > 0 && (
        <div className="grid grid-cols-7 gap-[2px] w-44 mb-4 relative">
          {cells.map((cell, i) => (
            <motion.div key={i} className="aspect-square rounded-[3px] flex items-center justify-center text-[7px]"
              initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.15 + i * 0.012, type: 'spring', bounce: 0.5 }}
              style={{ background: cell.owner ? TEAMS[cell.owner].color : 'var(--bg)', border: '1px solid rgba(128,128,128,0.4)' }}>
              {CELL_DEFS[i].home ? '🏠' : CELL_DEFS[i].star ? <span className="text-yellow-200">★</span> : CELL_DEFS[i].lucky ? <span className="text-white opacity-70">？</span> : null}
            </motion.div>
          ))}
        </div>
      )}

      {mvps.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 mb-4 w-full relative">
          {mvps.map((m, i) => (
            <motion.div key={m.key} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5, delay: 0.4 + i * 0.1 }}
              className="bg-[var(--accent)] border-2 border-[var(--text)] rounded-full px-3 py-1.5 font-black text-xs text-[var(--text)] flex items-center gap-1">
              {m.emoji} {m.label}: {m.winner.name}
            </motion.div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 w-full relative">
        {list.map((p, idx) => (
          <div key={p.id} className={`rounded-xl border-2 px-3 py-2 bg-[var(--bg)] ${p.id === myId ? 'border-[var(--primary)]' : 'border-[var(--text)]'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-[var(--text)]" style={{ background: TEAMS[p.team]?.color || '#999' }} />
              <span className="font-bold text-sm truncate flex-grow">{p.name}{p.id === myId && <span className="text-[10px] text-[var(--primary)] ml-1">(あなた)</span>}</span>
              <span className="font-black text-sm text-[var(--text)] shrink-0">🖌{p.captures || 0}</span>
              <span className="font-black text-xs shrink-0" style={{ color: TEAMS[p.team]?.color }}>⚡{p.steals || 0}</span>
              <span className="font-black text-xs text-purple-500 shrink-0">💥{p.specials || 0}</span>
              <span className="font-black text-xs text-orange-500 shrink-0">🔥{p.maxCombo || 0}</span>
            </div>
            <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden border border-[var(--text)]">
              <motion.div className="h-full origin-left" initial={{ scaleX: 0 }} animate={{ scaleX: (p.charges || 0) / maxCharges }} transition={{ duration: 0.8, delay: 0.2 + idx * 0.12, ease: 'easeOut' }} style={{ width: '100%', background: TEAMS[p.team]?.color || 'var(--primary)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
