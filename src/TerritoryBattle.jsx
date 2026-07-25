import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Flag } from 'lucide-react';

// ==========================================
// じんとりバトル(TERRITORY)モード
//   - 7x7盤面の定義・コスト計算・自動ターゲット選択 (ホスト権威ロジックが使う純関数)
//   - 盤面UI/スコアバー/イベント演出/結果画面 (全端末が terr_state スナップショットから描画)
//
// ルール:
//   - あか/あおの2チームにわかれ、正解するたびに「ねらっているマス」へ1ぬり(フィーバー中は2ぬり)
//   - マスごとに必要ぬり数(コスト)があり、たまると自分のチームの色にぬれる
//   - 敵のマスをうばうには +1、自陣にとなり合っていないマスも +1 かかる(前線を広げるほうが安い)
//   - ★マスとまんなかのマスはコストが高いかわりに、終了時のポイントが大きい
//   - 制限時間終了時(または全マスがうまった時)に合計ポイントが多いチームの勝ち
// ==========================================

export const TERRITORY_CONSTANTS = {
  COLS: 7,
  ROWS: 7,
  BASE_COST: 2,     // ふつうのマスに必要なぬり数
  STAR_COST: 3,     // ★マスに必要なぬり数
  CENTER_COST: 4,   // まんなかのマスに必要なぬり数
  STEAL_EXTRA: 1,   // 敵のマスをうばうときの追加コスト
  REMOTE_EXTRA: 1,  // 自陣にとなり合っていないマスの追加コスト
  FEVER_CHARGE: 2,  // フィーバー(5コンボ以上)中の1正解あたりのぬり数
  HEARTBEAT_MS: 2000,
  END_BANNER_MS: 1500, // 盤面が全部うまってから結果画面へ移るまでの演出時間
};

export const TEAMS = {
  red: { id: 'red', label: 'あか', color: '#EF4444', soft: 'rgba(239,68,68,0.18)' },
  blue: { id: 'blue', label: 'あお', color: '#3B82F6', soft: 'rgba(59,130,246,0.18)' },
};

export const otherTeam = (team) => (team === 'red' ? 'blue' : 'red');

const N = TERRITORY_CONSTANTS.COLS * TERRITORY_CONSTANTS.ROWS;
const HOME_CELLS = { 0: 'red', [N - 1]: 'blue' }; // 左上=あか本陣 / 右下=あお本陣(うばえない)
const CENTER_IDX = Math.floor(N / 2);             // 24
const STAR_SET = new Set([6, 16, 32, 42]);        // 180度回転対称に配置(両チーム公平)

// マスの静的定義(全端末で同一)。home はうばえない本陣
export const CELL_DEFS = Array.from({ length: N }, (_, i) => {
  if (HOME_CELLS[i]) return { cost: 0, value: 1, star: false, center: false, home: HOME_CELLS[i] };
  if (i === CENTER_IDX) return { cost: TERRITORY_CONSTANTS.CENTER_COST, value: 3, star: true, center: true, home: null };
  if (STAR_SET.has(i)) return { cost: TERRITORY_CONSTANTS.STAR_COST, value: 2, star: true, center: false, home: null };
  return { cost: TERRITORY_CONSTANTS.BASE_COST, value: 1, star: false, center: false, home: null };
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

export const computeScores = (cells) => {
  const scores = { red: 0, blue: 0 };
  cells.forEach((cell, i) => { if (cell.owner) scores[cell.owner] += CELL_DEFS[i].value; });
  return scores;
};

// たまったぬり数がコストに達したマスの所有権を確定する(ホスト専用)。
// マスがぬられると隣接コストが変わり連鎖でぬりきりが成立することがあるため、変化がなくなるまで回す
export const resolveCaptures = (cells) => {
  const captured = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < cells.length; i++) {
      if (CELL_DEFS[i].home) continue;
      for (const team of ['red', 'blue']) {
        if (cells[i].owner === team) continue;
        if (cells[i].charge[team] >= effectiveCost(cells, i, team)) {
          captured.push({ idx: i, team, steal: !!cells[i].owner, value: CELL_DEFS[i].value });
          cells[i].owner = team;
          cells[i].charge.red = 0; cells[i].charge.blue = 0;
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

// ゲーム画面上部のチームスコアバー。バーは盤面全体の価値(TOTAL_VALUE)に対する占有率
export const TerritoryScoreBar = ({ terrState, myTeam }) => {
  const s = terrState?.scores || { red: 0, blue: 0 };
  const neutral = terrState?.cells ? terrState.cells.filter(c => !c.owner).length : 0;
  const leader = s.red > s.blue ? 'red' : s.blue > s.red ? 'blue' : null;
  return (
    <div className="w-full bg-[var(--panel)] border-b-2 border-[var(--text)] px-3 py-1.5 shrink-0 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-black text-sm text-white rounded-full px-2.5 py-0.5 border-2 border-[var(--text)] tabular-nums" style={{ background: TEAMS.red.color }}>
          あか {s.red}{leader === 'red' && ' 👑'}
        </span>
        <div className="flex-grow h-4 rounded-full overflow-hidden border-2 border-[var(--text)] bg-gray-300 flex">
          <motion.div className="h-full shrink-0" initial={{ width: '0%' }} animate={{ width: `${(s.red / TOTAL_VALUE) * 100}%` }} transition={{ duration: 0.4 }} style={{ background: TEAMS.red.color }} />
          <div className="h-full flex-grow" />
          <motion.div className="h-full shrink-0" initial={{ width: '0%' }} animate={{ width: `${(s.blue / TOTAL_VALUE) * 100}%` }} transition={{ duration: 0.4 }} style={{ background: TEAMS.blue.color }} />
        </div>
        <span className="shrink-0 font-black text-sm text-white rounded-full px-2.5 py-0.5 border-2 border-[var(--text)] tabular-nums" style={{ background: TEAMS.blue.color }}>
          {leader === 'blue' && '👑 '}{s.blue} あお
        </span>
      </div>
      <div className="flex justify-center items-center gap-2 mt-0.5 text-[10px] font-black">
        {myTeam && <span style={{ color: TEAMS[myTeam].color }}>あなたは {TEAMS[myTeam].label}チーム！</span>}
        <span className="text-[var(--text)] opacity-50">のこり {neutral} マス</span>
      </div>
    </div>
  );
};

// マスの所有権が変わった瞬間の白フラッシュ
const CaptureFlash = ({ owner }) => (
  <AnimatePresence>
    {owner && (
      <motion.div key={owner} className="absolute inset-0 rounded-md bg-white pointer-events-none"
        initial={{ opacity: 0.9, scale: 0.4 }} animate={{ opacity: 0, scale: 1.4 }} transition={{ duration: 0.5 }} />
    )}
  </AnimatePresence>
);

// 7x7盤面。タップで「ねらうマス」を選ぶ。terr_state スナップショットだけから描画する
export const TerritoryBoard = ({ terrState, myTeam, myId, targetIdx, onSelect }) => {
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
    <div className="grid grid-cols-7 grid-rows-[repeat(7,minmax(0,1fr))] gap-[3px] aspect-square h-full max-h-full max-w-full md:h-auto md:w-full mx-auto select-none">
      {cells.map((cell, i) => {
        const def = CELL_DEFS[i];
        const selectable = isSelectable(cells, i, myTeam);
        const cost = selectable ? effectiveCost(cells, i, myTeam) : 0;
        const remain = selectable ? Math.max(1, cost - cell.charge[myTeam]) : 0;
        const myProg = selectable && cost > 0 ? Math.min(1, cell.charge[myTeam] / cost) : 0;
        const enemyCost = !CELL_DEFS[i].home && cell.owner !== enemy ? effectiveCost(cells, i, enemy) : 0;
        const enemyProg = enemyCost > 0 ? Math.min(1, cell.charge[enemy] / enemyCost) : 0;
        const isMyTarget = targetIdx === i;
        const stealing = selectable && !!cell.owner; // 敵のマス(うばう対象)
        return (
          <motion.button
            key={i}
            whileTap={selectable ? { scale: 0.85 } : {}}
            onPointerDown={(e) => { e.preventDefault(); if (selectable) onSelect?.(i); }}
            className={`relative rounded-md overflow-hidden flex items-center justify-center outline-none touch-manipulation ${isMyTarget ? 'ring-[3px] ring-[var(--accent)] z-10' : ''} ${selectable ? '' : 'cursor-default'}`}
            style={{
              background: cell.owner ? TEAMS[cell.owner].color : 'var(--bg)',
              border: cell.owner ? '2px solid rgba(0,0,0,0.25)' : '2px dashed rgba(128,128,128,0.45)',
            }}
            aria-label={`マス${i}`}
          >
            {/* 自チームのぬり進み(下から) / 敵チームのぬり進み(上の細いバー) */}
            {myProg > 0 && <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ height: `${myProg * 100}%`, background: TEAMS[myTeam].color, opacity: 0.45 }} />}
            {enemyProg > 0 && <div className="absolute top-0 left-0 h-[22%] pointer-events-none" style={{ width: `${enemyProg * 100}%`, background: TEAMS[enemy].color, opacity: 0.8 }} />}

            {/* マスの中身 */}
            {def.home ? (
              <span className="text-sm md:text-base leading-none">🏠</span>
            ) : cell.owner && !selectable ? (
              def.star && <span className="text-[10px] md:text-xs leading-none text-yellow-200">★</span>
            ) : (
              <span className="relative flex flex-col items-center leading-none pointer-events-none">
                {def.star && <span className="text-[8px] md:text-[10px] text-amber-500 font-black">{def.center ? '★3' : '★2'}</span>}
                <span className={`font-black tabular-nums ${def.star ? 'text-[10px] md:text-xs' : 'text-[11px] md:text-sm'} ${cell.owner ? 'text-white' : 'text-[var(--text)] opacity-80'}`}>
                  {stealing ? '⚡' : ''}{remain}
                </span>
              </span>
            )}

            {/* ほかのプレイヤーのねらいドット */}
            {targetMarks[i] && (
              <span className="absolute top-[2px] right-[2px] flex gap-[2px] pointer-events-none">
                {targetMarks[i].slice(0, 3).map((t, j) => (
                  <span key={j} className="w-[6px] h-[6px] rounded-full border border-white" style={{ background: TEAMS[t].color }} />
                ))}
              </span>
            )}

            <CaptureFlash owner={cell.owner} />
          </motion.button>
        );
      })}
    </div>
  );
};

// 全画面イベント演出(うばった / ボーナスマス確保 / 盤面うまった)
export const TerritoryEventOverlay = ({ lastEvent }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lastEvent) return;
    const id = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(id);
  }, [lastEvent?.at]);
  if (!lastEvent) return null;
  const show = now < lastEvent.at + 1800;
  const notable = lastEvent.kind === 'board_full' || (lastEvent.kind === 'capture' && (lastEvent.steal || lastEvent.value >= 2));
  const banner = (content, color) => (
    <motion.div key={`${lastEvent.kind}-${lastEvent.at}`} className="absolute inset-x-0 top-[22%] z-[60] flex justify-center pointer-events-none px-4"
      initial={{ opacity: 0, scale: 0.6, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: 'spring', bounce: 0.5 }}>
      <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-2xl px-6 py-3 font-black text-lg md:text-xl shadow-[4px_4px_0_var(--text)] text-center" style={{ color }}>{content}</div>
    </motion.div>
  );
  return (
    <AnimatePresence>
      {show && notable && lastEvent.kind === 'board_full' && banner(<>🏁 ばんめんが ぜんぶ うまった！</>, 'var(--text)')}
      {show && notable && lastEvent.kind === 'capture' && lastEvent.steal && banner(<>⚡ {lastEvent.name} が マスを うばった！</>, TEAMS[lastEvent.team]?.color)}
      {show && notable && lastEvent.kind === 'capture' && !lastEvent.steal && banner(<>⭐ {lastEvent.name} が ボーナスマスを ゲット！</>, TEAMS[lastEvent.team]?.color)}
    </AnimatePresence>
  );
};

// ==========================================
// 結果画面: チーム勝敗 + 貢献度パネル
// ==========================================

const MVP_DEFS = [
  { key: 'captures', label: 'ぬりMVP', emoji: '🖌', min: 1 },
  { key: 'charges', label: 'こうけんMVP', emoji: '💪', min: 1 },
  { key: 'maxCombo', label: 'コンボMVP', emoji: '🔥', min: 2 },
];

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
      <motion.h3 initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5 }}
        className="font-black text-2xl mb-1 flex items-center gap-2" style={{ color: winner ? TEAMS[winner].color : 'var(--text)' }}>
        {winner ? <><Trophy size={26} className="text-yellow-400" /> {TEAMS[winner].label}チームの かち！</> : <><Flag size={26} /> ひきわけ！</>}
      </motion.h3>
      {myTeam && (
        <p className="font-bold text-sm mb-3 text-[var(--text)] opacity-80">
          {winner ? (iWon ? '🎉 あなたのチームが かった！' : 'ざんねん…つぎは かてる！') : 'いいしょうぶだった！'}
        </p>
      )}

      {/* 最終スコアバー */}
      <div className="flex items-center gap-2 w-full mb-4">
        <span className="shrink-0 font-black text-sm text-white rounded-full px-2.5 py-0.5 border-2 border-[var(--text)] tabular-nums" style={{ background: TEAMS.red.color }}>あか {scores.red}</span>
        <div className="flex-grow h-4 rounded-full overflow-hidden border-2 border-[var(--text)] bg-gray-300 flex">
          <motion.div className="h-full shrink-0" initial={{ width: '0%' }} animate={{ width: `${(scores.red / TOTAL_VALUE) * 100}%` }} transition={{ duration: 0.8 }} style={{ background: TEAMS.red.color }} />
          <div className="h-full flex-grow" />
          <motion.div className="h-full shrink-0" initial={{ width: '0%' }} animate={{ width: `${(scores.blue / TOTAL_VALUE) * 100}%` }} transition={{ duration: 0.8 }} style={{ background: TEAMS.blue.color }} />
        </div>
        <span className="shrink-0 font-black text-sm text-white rounded-full px-2.5 py-0.5 border-2 border-[var(--text)] tabular-nums" style={{ background: TEAMS.blue.color }}>{scores.blue} あお</span>
      </div>

      {/* 最終盤面のミニ表示 */}
      {cells.length > 0 && (
        <div className="grid grid-cols-7 gap-[2px] w-40 mb-4">
          {cells.map((cell, i) => (
            <div key={i} className="aspect-square rounded-[3px] flex items-center justify-center text-[7px]"
              style={{ background: cell.owner ? TEAMS[cell.owner].color : 'var(--bg)', border: '1px solid rgba(128,128,128,0.4)' }}>
              {CELL_DEFS[i].home ? '🏠' : CELL_DEFS[i].star ? <span className="text-yellow-200">★</span> : null}
            </div>
          ))}
        </div>
      )}

      {mvps.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 mb-4 w-full">
          {mvps.map(m => (
            <motion.div key={m.key} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5, delay: 0.3 }}
              className="bg-[var(--accent)] border-2 border-[var(--text)] rounded-full px-3 py-1.5 font-black text-xs text-[var(--text)] flex items-center gap-1">
              {m.emoji} {m.label}: {m.winner.name}
            </motion.div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 w-full">
        {list.map((p, idx) => (
          <div key={p.id} className={`rounded-xl border-2 px-3 py-2 bg-[var(--bg)] ${p.id === myId ? 'border-[var(--primary)]' : 'border-[var(--text)]'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-[var(--text)]" style={{ background: TEAMS[p.team]?.color || '#999' }} />
              <span className="font-bold text-sm truncate flex-grow">{p.name}{p.id === myId && <span className="text-[10px] text-[var(--primary)] ml-1">(あなた)</span>}</span>
              <span className="font-black text-sm text-[var(--text)] shrink-0">🖌{p.captures || 0}</span>
              <span className="font-black text-xs shrink-0" style={{ color: TEAMS[p.team]?.color }}>⚡{p.steals || 0}</span>
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
