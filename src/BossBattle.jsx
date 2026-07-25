import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Swords, Heart, Crown, Sparkles, AlertTriangle } from 'lucide-react';

// ==========================================
// ボスバトル(BOSS_RAID)モード
//   - ボス定義・数値バランス・純関数 (ホスト権威ロジックが使う)
//   - ボスSVGアバター/バトルUI (全端末が raid_state スナップショットから描画)
// ==========================================

export const RAID_CONSTANTS = {
  TEAM_HP_MAX: 100,
  GAUGE_MAX: 8,
  CHEER_HEAL: 25,
  CHEER_DURATION_MS: 8000,
  DEFEAT_LOCK_MS: 2500,
  GRACE_MS: 12000,
  TELEGRAPH_MS: 3000,
  HEARTBEAT_MS: 2000,
  STAGE_CLEAR_HEAL: 10,
  TEAM_DOWN_RECOVER_HP: 50,
  TEAM_DOWN_BOSS_HEAL_RATE: 0.3,
};

// ボス定義: attacks は重み付き抽選。kind = ink(問題隠し) / blackout(問題??化) / shuffle(テンキー混乱) / freeze(入力凍結) / hp(チームHP攻撃)
export const BOSSES = [
  {
    id: 'purun', name: 'スライムキング・プルン', color: '#56AB2F',
    attackName: { ink: 'ぷるぷるスプラッシュ', hp: 'たいあたり' },
    attacks: [
      { kind: 'ink', weight: 7, durationMs: 4000 },
      { kind: 'hp', weight: 3 },
    ],
  },
  {
    id: 'goron', name: 'カウントドラゴン・ゴロン', color: '#3B4FD8',
    attackName: { blackout: 'かずかくしブレス', hp: 'しっぽアタック' },
    attacks: [
      { kind: 'blackout', weight: 6, durationMs: 3000 },
      { kind: 'hp', weight: 4 },
    ],
  },
  {
    id: 'nyaruru', name: 'まじょねこ・ニャルル', color: '#7C3AED',
    attackName: { shuffle: 'シャッフルマジック', freeze: 'こおりのまなざし', hp: 'ネコパンチ' },
    attacks: [
      { kind: 'shuffle', weight: 5, durationMs: 6000 },
      { kind: 'freeze', weight: 3, durationMs: 2500 },
      { kind: 'hp', weight: 2 },
    ],
  },
  {
    id: 'calculon', name: 'メカボス・カリキュロン', color: '#64748B',
    attackName: { hp: 'ロックオンレーザー', freeze: 'システムジャック', blackout: 'ノイズジャミング' },
    attacks: [
      { kind: 'hp', weight: 4, extraDamage: 5 },
      { kind: 'freeze', weight: 3, durationMs: 2000, targetAll: true },
      { kind: 'blackout', weight: 3, durationMs: 3000 },
    ],
  },
];

export const bossForStage = (stage) => {
  const idx = (stage - 1) % BOSSES.length;
  const superMode = stage > BOSSES.length;
  return { bossIndex: idx, superMode, name: (superMode ? 'スーパー' : '') + BOSSES[idx].name };
};

export const bossMaxHp = (stage, n) => Math.round((50 + 50 * Math.max(1, n)) * Math.pow(1.3, stage - 1));

export const calcRaidDamage = (combo, cheerActive) => {
  let dmg = 10 + 2 * Math.min(combo, 10);
  if (combo >= 5) dmg *= 1.5; // フィーバー
  if (cheerActive) dmg *= 2; // おうえんタイム
  return Math.round(dmg);
};

export const attackIntervalMs = (stage) => {
  const base = Math.max(8000, 20000 - 2000 * (stage - 1));
  return Math.round(base * (0.85 + Math.random() * 0.3));
};

export const bossAttackDamage = (stage, extraDamage = 0) => Math.min(20, 10 + 2 * stage) + extraDamage;

// ボスの攻撃を重み付き抽選する(ホスト専用)。targets は 'all' か peerId の配列
export const pickBossAttack = (bossIndex, stage, participantIds) => {
  const boss = BOSSES[bossIndex];
  const total = boss.attacks.reduce((s, a) => s + a.weight, 0);
  let roll = Math.random() * total;
  let atk = boss.attacks[0];
  for (const a of boss.attacks) { roll -= a.weight; if (roll <= 0) { atk = a; break; } }

  const result = { kind: atk.kind, targets: 'all', durationMs: atk.durationMs || 0, damage: 0, shuffleSeed: 0, bossIndex };
  if (atk.kind === 'hp') result.damage = bossAttackDamage(stage, atk.extraDamage || 0);
  if (atk.kind === 'shuffle') result.shuffleSeed = Math.floor(Math.random() * 1e9);
  if (atk.kind === 'freeze' && !atk.targetAll && participantIds.length > 0) {
    result.targets = [participantIds[Math.floor(Math.random() * participantIds.length)]];
  }
  return result;
};

// 決定論的シャッフル(全端末で同じ並びになるよう seed から生成)
export const makeShuffledLayout = (seed) => {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const layout = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'];
  for (let i = layout.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [layout[i], layout[j]] = [layout[j], layout[i]];
  }
  return layout;
};

// 自分に効いているデバフの一覧。失効タイミングで自動再レンダーする
export const useRaidDebuffs = (raidState, myId) => {
  const [, forceTick] = useState(0);
  const debuffs = (raidState?.activeDebuffs || []).filter(d =>
    d.expiresAt > Date.now() && (d.targets === 'all' || (Array.isArray(d.targets) && d.targets.includes(myId)))
  );
  useEffect(() => {
    if (debuffs.length === 0) return;
    const next = Math.min(...debuffs.map(d => d.expiresAt)) - Date.now();
    const id = setTimeout(() => forceTick(t => t + 1), Math.max(50, next + 50));
    return () => clearTimeout(id);
  });
  return debuffs;
};

// 入力を受け付けるか(凍結デバフ or 撃破演出中)。ref 経由でイベントハンドラから呼ばれるため純関数にする
export const raidInputLocked = (raidState, myId) => {
  if (!raidState) return false;
  const now = Date.now();
  if (raidState.lastEvent?.kind === 'boss_defeated' && now < raidState.lastEvent.at + RAID_CONSTANTS.DEFEAT_LOCK_MS) return true;
  return (raidState.activeDebuffs || []).some(d =>
    d.kind === 'freeze' && d.expiresAt > now && (d.targets === 'all' || (Array.isArray(d.targets) && d.targets.includes(myId)))
  );
};

// ==========================================
// ボスSVGアバター (viewBox 0 0 200 200)
// ==========================================

// 各ボス共通: 被弾時の白フラッシュ
const HitFlash = ({ active }) => (
  <AnimatePresence>
    {active && <motion.rect x="0" y="0" width="200" height="200" rx="30" fill="#ffffff" initial={{ opacity: 0.7 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />}
  </AnimatePresence>
);

// --- ボス1: スライムキング・プルン ---
const PurunBoss = ({ animState }) => {
  const hit = animState === 'hit';
  const attack = animState === 'attack';
  const defeat = animState === 'defeat';
  return (
    <motion.g animate={attack ? { y: [0, -30, 0] } : { y: 0 }} transition={{ duration: 0.5 }}>
      {/* 攻撃時に飛び散る液滴 */}
      {attack && [...Array(6)].map((_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return <motion.circle key={i} cx="100" cy="150" r="7" fill="#7BC950" initial={{ opacity: 1, x: 0, y: 0 }} animate={{ opacity: 0, x: Math.cos(a) * 70, y: Math.sin(a) * 45 - 20 }} transition={{ duration: 0.6 }} />;
      })}
      <motion.g
        style={{ originX: '100px', originY: '185px' }}
        animate={defeat
          ? { scaleY: 0.08, scaleX: 1.4 }
          : hit ? { scaleX: [1, 1.25, 0.9, 1], scaleY: [1, 0.8, 1.05, 1] }
            : { scaleY: [1, 0.92, 1], scaleX: [1, 1.06, 1] }}
        transition={defeat ? { duration: 0.8 } : hit ? { duration: 0.35 } : { duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* ぷるぷるボディ */}
        <defs>
          <linearGradient id="purunGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A8E063" /><stop offset="100%" stopColor="#56AB2F" />
          </linearGradient>
        </defs>
        <path d="M100 45 C 145 70, 168 110, 168 145 C 168 175, 150 185, 130 182 C 120 180, 115 186, 100 186 C 85 186, 80 180, 70 182 C 50 185, 32 175, 32 145 C 32 110, 55 70, 100 45 Z" fill="url(#purunGrad)" stroke="var(--text)" strokeWidth="4" />
        <ellipse cx="72" cy="90" rx="16" ry="24" fill="#ffffff" opacity="0.5" transform="rotate(-20 72 90)" />
        {/* 顔 */}
        {defeat || hit ? (
          <g stroke="var(--text)" strokeWidth="4" strokeLinecap="round" fill="none">
            <path d="M68 118 L84 132 M84 118 L68 132" /><path d="M116 118 L132 132 M132 118 L116 132" />
          </g>
        ) : (
          <g>
            <circle cx="76" cy="122" r="13" fill="#ffffff" stroke="var(--text)" strokeWidth="3" /><circle cx="79" cy="125" r="6" fill="var(--text)" />
            <circle cx="124" cy="122" r="13" fill="#ffffff" stroke="var(--text)" strokeWidth="3" /><circle cx="121" cy="125" r="6" fill="var(--text)" />
          </g>
        )}
        <circle cx="58" cy="145" r="8" fill="#FF9AA2" opacity="0.6" /><circle cx="142" cy="145" r="8" fill="#FF9AA2" opacity="0.6" />
        <path d={defeat ? 'M85 158 Q100 150 115 158' : 'M85 152 Q100 166 115 152'} stroke="var(--text)" strokeWidth="4" fill="none" strokeLinecap="round" />
      </motion.g>
      {/* 王冠(撃破時にぽとっと落ちる) */}
      <motion.g animate={defeat ? { y: 130, rotate: 110, x: 25 } : { y: 0, rotate: 0 }} transition={defeat ? { duration: 0.9, ease: 'easeIn' } : {}} style={{ originX: '100px', originY: '40px' }}>
        <polygon points="72,45 78,18 92,38 100,12 108,38 122,18 128,45" fill="#FFD93D" stroke="var(--text)" strokeWidth="4" strokeLinejoin="round" />
        <circle cx="100" cy="30" r="5" fill="#FF6B6B" stroke="var(--text)" strokeWidth="2" />
      </motion.g>
    </motion.g>
  );
};

// --- ボス2: カウントドラゴン・ゴロン ---
const GoronBoss = ({ animState }) => {
  const hit = animState === 'hit';
  const attack = animState === 'attack';
  const defeat = animState === 'defeat';
  return (
    <motion.g animate={defeat ? { rotate: 20, y: 15, opacity: 0 } : hit ? { x: [-8, 8, -5, 0] } : { x: 0 }} transition={defeat ? { duration: 1.1, opacity: { delay: 0.5, duration: 0.6 } } : { duration: 0.35 }} style={{ originX: '100px', originY: '120px' }}>
      <defs>
        <linearGradient id="goronGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5B7CFA" /><stop offset="100%" stopColor="#3B4FD8" />
        </linearGradient>
      </defs>
      {/* 漂う数字ルーン */}
      {['3', '7', '5'].map((n, i) => (
        <motion.text key={n} x={[30, 168, 22][i]} y={[60, 90, 130][i]} fontSize="20" fontWeight="900" fill="#5B7CFA" opacity="0.35"
          animate={{ y: [[60, 90, 130][i], [60, 90, 130][i] - 10, [60, 90, 130][i]] }} transition={{ duration: 2.4 + i * 0.5, repeat: Infinity, ease: 'easeInOut' }}>{n}</motion.text>
      ))}
      {/* 翼 */}
      <motion.g style={{ originX: '62px', originY: '95px' }} animate={{ rotate: [0, -14, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
        <polygon points="62,95 12,60 30,100 8,95 45,125" fill="#3B4FD8" stroke="var(--text)" strokeWidth="4" strokeLinejoin="round" />
      </motion.g>
      <motion.g style={{ originX: '138px', originY: '95px' }} animate={{ rotate: [0, 14, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
        <polygon points="138,95 188,60 170,100 192,95 155,125" fill="#3B4FD8" stroke="var(--text)" strokeWidth="4" strokeLinejoin="round" />
      </motion.g>
      {/* しっぽ */}
      <path d="M120 168 L145 178 L138 186 L162 190 L152 197" stroke="var(--text)" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* 胴体 */}
      <motion.g animate={attack ? { rotate: -8 } : { scale: [1, 1.03, 1] }} transition={attack ? { duration: 0.3 } : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} style={{ originX: '100px', originY: '150px' }}>
        <path d="M100 40 C 140 45, 155 80, 152 120 C 150 155, 135 175, 100 178 C 65 175, 50 155, 48 120 C 45 80, 60 45, 100 40 Z" fill="url(#goronGrad)" stroke="var(--text)" strokeWidth="4" />
        <ellipse cx="100" cy="140" rx="30" ry="32" fill="#C7D2FE" stroke="var(--text)" strokeWidth="3" />
        <path d="M85 125 H115 M85 140 H115 M88 155 H112" stroke="var(--text)" strokeWidth="2.5" opacity="0.4" />
        {/* 角 */}
        <polygon points="72,52 60,20 84,44" fill="#F1F5F9" stroke="var(--text)" strokeWidth="3.5" strokeLinejoin="round" />
        <polygon points="128,52 140,20 116,44" fill="#F1F5F9" stroke="var(--text)" strokeWidth="3.5" strokeLinejoin="round" />
        {/* 目(オレンジ発光の吊り目) */}
        {defeat ? (
          <g stroke="var(--text)" strokeWidth="4" strokeLinecap="round" fill="none">
            <path d="M66 78 L84 90 M84 78 L66 90" /><path d="M116 78 L134 90 M134 78 L116 90" />
          </g>
        ) : (
          <g>
            <path d="M62 72 L88 80 L64 92 Z" fill="#FFB703" stroke="var(--text)" strokeWidth="3" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 4px #FFB703)' }} />
            <path d="M138 72 L112 80 L136 92 Z" fill="#FFB703" stroke="var(--text)" strokeWidth="3" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 4px #FFB703)' }} />
          </g>
        )}
        {/* 鼻先と口 */}
        <path d="M88 102 Q100 112 112 102" stroke="var(--text)" strokeWidth="4" fill="none" strokeLinecap="round" />
        <circle cx="93" cy="99" r="2.5" fill="var(--text)" /><circle cx="107" cy="99" r="2.5" fill="var(--text)" />
      </motion.g>
      {/* 攻撃時の炎ブレス */}
      {attack && (
        <motion.g initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: [0, 1, 1, 0] }} transition={{ duration: 0.6 }} style={{ originX: '105px', originY: '108px' }}>
          <polygon points="105,100 195,85 185,108 198,120 105,116" fill="#FB8500" stroke="#DC2F02" strokeWidth="3" strokeLinejoin="round" opacity="0.9" />
          <polygon points="105,104 170,96 165,108 172,115 105,112" fill="#FFD166" opacity="0.9" />
        </motion.g>
      )}
      {/* 被弾時の煙 */}
      {hit && [...Array(3)].map((_, i) => (
        <motion.circle key={i} cx={70 + i * 30} cy="70" r="8" fill="#94A3B8" initial={{ opacity: 0.8, y: 0 }} animate={{ opacity: 0, y: -25 }} transition={{ duration: 0.5, delay: i * 0.08 }} />
      ))}
      {/* 撃破時の星の飛散 */}
      {defeat && [...Array(8)].map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <motion.path key={i} d="M0,-9 L2.6,-2.8 L9,-2.8 L4,1.5 L6,8 L0,4 L-6,8 L-4,1.5 L-9,-2.8 L-2.6,-2.8 Z" fill="#FDE047" stroke="#F59E0B" strokeWidth="1.5"
            initial={{ x: 100, y: 110, scale: 0.6, opacity: 1 }} animate={{ x: 100 + Math.cos(a) * 85, y: 110 + Math.sin(a) * 85, scale: 1.3, opacity: 0, rotate: 180 }} transition={{ duration: 0.9, delay: 0.3 }} />
        );
      })}
    </motion.g>
  );
};

// --- ボス3: まじょねこ・ニャルル ---
const NyaruruBoss = ({ animState }) => {
  const hit = animState === 'hit';
  const attack = animState === 'attack';
  const defeat = animState === 'defeat';
  return (
    <g>
      {/* 紫のオーラ */}
      {[46, 62, 78].map((r, i) => (
        <motion.circle key={r} cx="100" cy="115" r={r} fill="#A78BFA" opacity="0.13" animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.4, ease: 'easeInOut' }} style={{ originX: '100px', originY: '115px' }} />
      ))}
      <motion.g
        animate={defeat ? { rotate: 720, opacity: 0 } : { y: [0, -8, 0] }}
        transition={defeat ? { duration: 0.8, ease: 'easeIn' } : { duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        style={{ originX: '100px', originY: '120px' }}
      >
        {/* しっぽ(先がくるん) */}
        <motion.path d="M138 165 C 168 170, 172 150, 160 142 C 152 137, 148 146, 156 149" stroke="var(--text)" strokeWidth="5" fill="none" strokeLinecap="round"
          animate={{ rotate: [0, 10, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} style={{ originX: '138px', originY: '165px' }} />
        {/* 体(黒猫) */}
        <motion.g animate={hit ? { scale: [1, 1.15, 1] } : { scale: 1 }} transition={{ duration: 0.3 }} style={{ originX: '100px', originY: '130px' }}>
          <path d="M100 70 C 130 70, 148 95, 148 130 C 148 160, 130 178, 100 178 C 70 178, 52 160, 52 130 C 52 95, 70 70, 100 70 Z" fill="#2D2A3E" stroke="var(--text)" strokeWidth="4" />
          {/* 耳 */}
          <polygon points="66,84 56,52 88,68" fill="#2D2A3E" stroke="var(--text)" strokeWidth="4" strokeLinejoin="round" />
          <polygon points="134,84 144,52 112,68" fill="#2D2A3E" stroke="var(--text)" strokeWidth="4" strokeLinejoin="round" />
          <polygon points="68,78 63,62 80,70" fill="#F0ABFC" />
          <polygon points="132,78 137,62 120,70" fill="#F0ABFC" />
          {/* 目: ふだんは黄色い三日月、被弾でまんまる */}
          {hit || defeat ? (
            <g>
              <circle cx="80" cy="115" r="10" fill="#FDE047" stroke="var(--text)" strokeWidth="2.5" /><circle cx="80" cy="115" r="4" fill="var(--text)" />
              <circle cx="120" cy="115" r="10" fill="#FDE047" stroke="var(--text)" strokeWidth="2.5" /><circle cx="120" cy="115" r="4" fill="var(--text)" />
            </g>
          ) : (
            <g fill="#FDE047" style={{ filter: 'drop-shadow(0 0 3px #FDE047)' }}>
              <path d="M68 112 Q80 100 92 112 Q80 108 68 112 Z" /><path d="M108 112 Q120 100 132 112 Q120 108 108 112 Z" />
            </g>
          )}
          {/* 鼻・口・ヒゲ */}
          <polygon points="96,128 104,128 100,134" fill="#F0ABFC" />
          <path d="M100 134 Q94 142 86 138 M100 134 Q106 142 114 138" stroke="#F0ABFC" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <g stroke="#94A3B8" strokeWidth="2" strokeLinecap="round">
            <line x1="52" y1="126" x2="76" y2="130" /><line x1="52" y1="138" x2="76" y2="136" />
            <line x1="148" y1="126" x2="124" y2="130" /><line x1="148" y1="138" x2="124" y2="136" />
          </g>
        </motion.g>
        {/* とんがり帽子(撃破で上に飛ぶ) */}
        <motion.g animate={defeat ? { y: -120, rotate: -40, opacity: 0 } : hit ? { rotate: [0, -20, 0] } : { rotate: 0 }} transition={defeat ? { duration: 0.7 } : { duration: 0.4 }} style={{ originX: '100px', originY: '60px' }}>
          <polygon points="58,62 100,2 122,58" fill="#7C3AED" stroke="var(--text)" strokeWidth="4" strokeLinejoin="round" />
          <path d="M50 62 Q100 76 130 58" stroke="var(--text)" strokeWidth="4" fill="#6D28D9" />
          <rect x="88" y="42" width="16" height="12" rx="2" fill="#FDE047" stroke="var(--text)" strokeWidth="2.5" />
        </motion.g>
        {/* 杖 */}
        <motion.g animate={attack ? { rotate: [0, -45, 25, 0] } : { rotate: 0 }} transition={{ duration: 0.7 }} style={{ originX: '160px', originY: '150px' }}>
          <line x1="160" y1="150" x2="178" y2="95" stroke="#92400E" strokeWidth="6" strokeLinecap="round" />
          <motion.path d="M178,84 L181.4,92 L190,92.5 L183.5,98 L185.5,106.5 L178,102 L170.5,106.5 L172.5,98 L166,92.5 L174.6,92 Z" fill="#FDE047" stroke="var(--text)" strokeWidth="2.5" strokeLinejoin="round"
            animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: 'linear' }} style={{ originX: '178px', originY: '95px' }} />
        </motion.g>
      </motion.g>
      {/* 攻撃時の紫の星が下(テンキー方向)へ流れる */}
      {attack && [...Array(6)].map((_, i) => (
        <motion.path key={i} d="M0,-7 L2,-2 L7,-2 L3,1.5 L4.5,6.5 L0,3.5 L-4.5,6.5 L-3,1.5 L-7,-2 L-2,-2 Z" fill="#C084FC" stroke="#7C3AED" strokeWidth="1.5"
          initial={{ x: 170, y: 95, opacity: 1, scale: 0.8 }} animate={{ x: 30 + i * 28, y: 210, opacity: 0, scale: 1.4, rotate: 240 }} transition={{ duration: 0.8, delay: i * 0.06 }} />
      ))}
      {/* 撃破後: 帽子の下から小さい白猫 */}
      {defeat && (
        <motion.g initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.7, type: 'spring', bounce: 0.6 }} style={{ originX: '100px', originY: '160px' }}>
          <motion.circle cx="100" cy="158" r="26" fill="#C4B5FD" initial={{ opacity: 0.6 }} animate={{ opacity: 0, scale: 1.8 }} transition={{ delay: 0.7, duration: 0.7 }} style={{ originX: '100px', originY: '158px' }} />
          <circle cx="100" cy="160" r="18" fill="#F8FAFC" stroke="var(--text)" strokeWidth="3.5" />
          <polygon points="88,148 84,134 98,142" fill="#F8FAFC" stroke="var(--text)" strokeWidth="3" strokeLinejoin="round" />
          <polygon points="112,148 116,134 102,142" fill="#F8FAFC" stroke="var(--text)" strokeWidth="3" strokeLinejoin="round" />
          <circle cx="94" cy="158" r="2" fill="var(--text)" /><circle cx="106" cy="158" r="2" fill="var(--text)" />
          <path d="M97 164 Q100 167 103 164" stroke="var(--text)" strokeWidth="2" fill="none" strokeLinecap="round" />
        </motion.g>
      )}
    </g>
  );
};

// --- ボス4: メカボス・カリキュロン ---
const CalculonBoss = ({ animState }) => {
  const hit = animState === 'hit';
  const attack = animState === 'attack';
  const defeat = animState === 'defeat';
  const Gear = ({ cx, cy, reverse }) => (
    <motion.g animate={{ rotate: reverse ? -360 : 360 }} transition={{ duration: 5, repeat: Infinity, ease: 'linear' }} style={{ originX: `${cx}px`, originY: `${cy}px` }}>
      {[...Array(8)].map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <rect key={i} x={cx - 4} y={cy - 24} width="8" height="10" rx="2" fill="#475569" stroke="var(--text)" strokeWidth="2" transform={`rotate(${(a * 180) / Math.PI} ${cx} ${cy})`} />;
      })}
      <circle cx={cx} cy={cy} r="16" fill="#94A3B8" stroke="var(--text)" strokeWidth="3.5" />
      <circle cx={cx} cy={cy} r="6" fill="#334155" stroke="var(--text)" strokeWidth="2" />
    </motion.g>
  );
  return (
    <motion.g animate={hit ? { x: [-4, 4, -4, 4, 0] } : defeat ? { x: [-3, 3, -5, 5, -8, 8, 0] } : { y: [0, -2, 0] }}
      transition={hit ? { duration: 0.3 } : defeat ? { duration: 0.9 } : { duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}>
      {/* 肩の歯車 */}
      <motion.g animate={defeat ? { x: -90, y: -60, rotate: -180, opacity: 0 } : {}} transition={{ duration: 0.8, delay: 0.9 }}><Gear cx={38} cy={92} /></motion.g>
      <motion.g animate={defeat ? { x: 90, y: -60, rotate: 180, opacity: 0 } : {}} transition={{ duration: 0.8, delay: 0.9 }}><Gear cx={162} cy={92} reverse /></motion.g>
      {/* 腕とクロー */}
      <motion.g animate={defeat ? { x: -110, y: 70, rotate: -120, opacity: 0 } : attack ? { rotate: -12 } : {}} transition={defeat ? { duration: 0.8, delay: 1 } : { duration: 0.3 }} style={{ originX: '40px', originY: '110px' }}>
        <rect x="26" y="108" width="22" height="42" rx="8" fill="#64748B" stroke="var(--text)" strokeWidth="3.5" />
        <polygon points="30,150 24,170 34,158 37,172 44,156 52,168 48,150" fill="#94A3B8" stroke="var(--text)" strokeWidth="3" strokeLinejoin="round" />
      </motion.g>
      <motion.g animate={defeat ? { x: 110, y: 70, rotate: 120, opacity: 0 } : {}} transition={{ duration: 0.8, delay: 1 }}>
        <rect x="152" y="108" width="22" height="42" rx="8" fill="#64748B" stroke="var(--text)" strokeWidth="3.5" />
        <polygon points="156,150 150,170 160,158 163,172 170,156 178,168 174,150" fill="#94A3B8" stroke="var(--text)" strokeWidth="3" strokeLinejoin="round" />
      </motion.g>
      {/* 胴体 */}
      <motion.g animate={defeat ? { y: 40, opacity: 0 } : {}} transition={{ duration: 0.7, delay: 1.2 }}>
        <rect x="55" y="80" width="90" height="95" rx="12" fill="#64748B" stroke="var(--text)" strokeWidth="4" />
        {[[64, 88], [136, 88], [64, 166], [136, 166], [64, 127], [136, 127]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.5" fill="#CBD5E1" stroke="var(--text)" strokeWidth="1.5" />
        ))}
        {/* 胸の液晶 */}
        <rect x="72" y="100" width="56" height="34" rx="4" fill="#0F172A" stroke="var(--text)" strokeWidth="3" />
        <motion.text x="100" y="123" textAnchor="middle" fontSize="16" fontWeight="900" fill="#39FF14" fontFamily="monospace"
          animate={hit ? { skewX: 15, opacity: [1, 0.2, 1, 0.4, 1] } : { opacity: [1, 1, 0.6, 1] }} transition={hit ? { duration: 0.3 } : { duration: 2, repeat: Infinity }}>
          {hit ? 'ERR0R' : '1+1=?'}
        </motion.text>
        <rect x="72" y="142" width="56" height="22" rx="4" fill="#475569" stroke="var(--text)" strokeWidth="2.5" />
        {[0, 1, 2].map(i => <motion.circle key={i} cx={84 + i * 16} cy="153" r="4" fill={['#EF4444', '#F59E0B', '#22C55E'][i]} stroke="var(--text)" strokeWidth="1.5" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.4 }} />)}
      </motion.g>
      {/* 頭部 */}
      <motion.g animate={defeat ? { y: -140, rotate: 60, opacity: 0 } : attack ? { y: -4 } : {}} transition={defeat ? { duration: 0.8, delay: 0.8 } : { duration: 0.3 }}>
        <line x1="100" y1="30" x2="100" y2="14" stroke="var(--text)" strokeWidth="3.5" />
        <motion.circle cx="100" cy="11" r="5" fill="#EF4444" stroke="var(--text)" strokeWidth="2" animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />
        <rect x="68" y="30" width="64" height="50" rx="10" fill="#94A3B8" stroke="var(--text)" strokeWidth="4" />
        <rect x="76" y="42" width="48" height="18" rx="6" fill="#1E293B" stroke="var(--text)" strokeWidth="3" />
        {/* バイザー内を左右スキャンする赤LED */}
        <motion.circle cy="51" r="5" fill="#EF4444" style={{ filter: 'drop-shadow(0 0 4px #EF4444)' }} animate={{ cx: [84, 116, 84] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />
        <rect x="88" y="66" width="24" height="7" rx="2" fill="#334155" stroke="var(--text)" strokeWidth="2" />
      </motion.g>
      {/* 攻撃: 照準サークル→レーザー */}
      {attack && (
        <g>
          <motion.circle cx="100" cy="185" r="18" fill="none" stroke="#EF4444" strokeWidth="3" strokeDasharray="6 5"
            initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: [0, 1, 1, 0] }} transition={{ duration: 0.7 }} style={{ originX: '100px', originY: '185px' }} />
          <motion.rect x="94" y="80" width="12" height="110" fill="#EF4444" opacity="0.85"
            initial={{ scaleY: 0 }} animate={{ scaleY: [0, 1, 1, 0] }} transition={{ duration: 0.6, delay: 0.25 }} style={{ originX: '100px', originY: '80px' }} />
        </g>
      )}
      {/* 被弾: 火花 */}
      {hit && [...Array(4)].map((_, i) => (
        <motion.polyline key={i} points="0,0 6,-4 10,2 16,-3" fill="none" stroke="#FDE047" strokeWidth="3" strokeLinecap="round"
          initial={{ x: 70 + i * 20, y: 95, opacity: 1 }} animate={{ y: 75, opacity: 0 }} transition={{ duration: 0.4, delay: i * 0.05 }} />
      ))}
      {/* 撃破: 白フラッシュ+ネジが飛ぶ */}
      {defeat && (
        <g>
          <motion.circle cx="100" cy="110" r="30" fill="#ffffff" initial={{ opacity: 1, scale: 0.5 }} animate={{ opacity: 0, scale: 3.2 }} transition={{ duration: 0.8, delay: 0.9 }} style={{ originX: '100px', originY: '110px' }} />
          {[...Array(10)].map((_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return <motion.circle key={i} r="4" fill="#CBD5E1" stroke="var(--text)" strokeWidth="1.5"
              initial={{ cx: 100, cy: 110, opacity: 1 }} animate={{ cx: 100 + Math.cos(a) * 95, cy: 110 + Math.sin(a) * 95, opacity: 0 }} transition={{ duration: 1, delay: 1 }} />;
          })}
        </g>
      )}
    </motion.g>
  );
};

const BOSS_COMPONENTS = [PurunBoss, GoronBoss, NyaruruBoss, CalculonBoss];

// ボスの見た目。superMode(2周目以降)は色相を回して「スーパー」個体らしくする
export const BossAvatar = ({ bossIndex, animState = 'idle', superMode = false, className = '' }) => {
  const Boss = BOSS_COMPONENTS[bossIndex] || PurunBoss;
  return (
    <motion.svg viewBox="0 0 200 200" className={className} style={superMode ? { filter: 'hue-rotate(140deg) saturate(1.4)' } : undefined}
      initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.5 }}>
      <Boss animState={animState} />
      <HitFlash active={animState === 'hit'} />
    </motion.svg>
  );
};

// ==========================================
// バトルUIコンポーネント
// ==========================================

const hpBarColor = (ratio) => (ratio > 0.5 ? '#22C55E' : ratio > 0.25 ? '#F59E0B' : '#EF4444');

// ゲーム画面上部のボスパネル。raid_state スナップショットだけから描画する
export const BossPanel = ({ raidState, compact = false }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const prevHpRef = useRef(null);
  const hitAtRef = useRef(0);

  if (!raidState) {
    return (
      <div className="flex justify-center items-center p-3 shrink-0 w-full bg-[var(--panel)] border-b-2 border-[var(--text)] shadow-sm font-bold text-sm text-[var(--text)] opacity-60">
        ボスがあらわれる…
      </div>
    );
  }

  const { stage = 1, bossHp = 0, bossMaxHp: maxHp = 1, teamHp = 0, teamHpMax = 100, defeated = 0, telegraphAt = 0, lastAttack, lastEvent, cheerUntil = 0 } = raidState;
  const { bossIndex, superMode, name } = bossForStage(stage);

  if (prevHpRef.current !== null && bossHp < prevHpRef.current) hitAtRef.current = Date.now();
  prevHpRef.current = bossHp;

  const defeatActive = lastEvent?.kind === 'boss_defeated' && now < lastEvent.at + RAID_CONSTANTS.DEFEAT_LOCK_MS;
  const attackActive = lastAttack && now < (lastAttack.at || 0) + 900;
  const hitActive = now < hitAtRef.current + 380;
  const animState = defeatActive ? 'defeat' : attackActive ? 'attack' : hitActive ? 'hit' : 'idle';
  const telegraphActive = !defeatActive && telegraphAt > 0 && now >= telegraphAt;
  const cheerActive = now < cheerUntil;
  const bossRatio = Math.max(0, bossHp / maxHp);
  const teamRatio = Math.max(0, teamHp / teamHpMax);

  return (
    <div className={`flex items-center gap-3 px-3 ${compact ? 'py-1' : 'py-2'} shrink-0 w-full bg-[var(--panel)] border-b-2 border-[var(--text)] shadow-sm relative overflow-hidden`}>
      {cheerActive && <motion.div className="absolute inset-0 bg-[var(--accent)] pointer-events-none" animate={{ opacity: [0.1, 0.35, 0.1] }} transition={{ duration: 0.8, repeat: Infinity }} />}
      {!compact && (
        <motion.div key={stage} animate={telegraphActive ? { x: [0, -2, 2, 0] } : {}} transition={{ duration: 0.3, repeat: telegraphActive ? Infinity : 0 }} className="shrink-0">
          <BossAvatar bossIndex={bossIndex} animState={animState} superMode={superMode} className="w-24 h-24 md:w-28 md:h-28" />
        </motion.div>
      )}
      <div className="flex-grow min-w-0 relative">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-black text-sm md:text-base text-[var(--text)] truncate">{name}</span>
            <span className="shrink-0 text-[10px] font-black bg-[var(--primary)] text-white rounded-full px-2 py-0.5 border border-[var(--text)]">{stage}たいめ</span>
          </div>
          <span className="shrink-0 font-black text-xs text-[var(--text)] flex items-center gap-1"><Crown size={14} className="text-yellow-500" />×{defeated}</span>
        </div>
        {/* ボスHP */}
        <div className="flex items-center gap-1.5 mb-1">
          <Swords size={13} className="shrink-0 text-[var(--text)] opacity-60" />
          <div className="flex-grow h-3.5 bg-gray-200 rounded-full overflow-hidden border-2 border-[var(--text)]">
            <motion.div className="h-full origin-left" animate={{ scaleX: bossRatio, backgroundColor: hpBarColor(bossRatio) }} transition={{ duration: 0.3 }} style={{ width: '100%' }} />
          </div>
          <span className="shrink-0 font-black text-[10px] text-[var(--text)] w-16 text-right tabular-nums">{Math.max(0, Math.ceil(bossHp))}/{maxHp}</span>
        </div>
        {/* チームHP */}
        <div className="flex items-center gap-1.5">
          <Heart size={13} className="shrink-0 text-pink-500" fill="currentColor" />
          <div className="flex-grow h-3.5 bg-gray-200 rounded-full overflow-hidden border-2 border-[var(--text)]">
            <motion.div className="h-full origin-left bg-pink-400" animate={{ scaleX: teamRatio }} transition={{ duration: 0.3 }} style={{ width: '100%' }} />
          </div>
          <span className="shrink-0 font-black text-[10px] text-[var(--text)] w-16 text-right tabular-nums">{Math.max(0, Math.ceil(teamHp))}/{teamHpMax}</span>
        </div>
        <AnimatePresence>
          {telegraphActive && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: [1, 0.4, 1] }} exit={{ opacity: 0 }} transition={{ duration: 0.5, repeat: Infinity }}
              className="absolute -top-0.5 right-0 flex items-center gap-1 font-black text-[11px] text-red-500">
              <AlertTriangle size={13} /> ためている…！
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

// おうえんボタン(テンキー横のフローティング円ボタン)。円周ゲージが満タンで発動可能
export const SupportButton = ({ gauge, onFire }) => {
  const ready = gauge >= RAID_CONSTANTS.GAUGE_MAX;
  const ratio = Math.min(1, gauge / RAID_CONSTANTS.GAUGE_MAX);
  const RADIUS = 26; const CIRC = 2 * Math.PI * RADIUS;
  return (
    <motion.button
      className={`absolute top-0 right-0 w-16 h-16 rounded-full z-30 flex flex-col items-center justify-center border-[3px] border-[var(--text)] shadow-[0_3px_0_var(--text)] select-none touch-manipulation outline-none ${ready ? 'bg-[var(--accent)]' : 'bg-[var(--bg)] opacity-80'}`}
      animate={ready ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={ready ? { duration: 0.7, repeat: Infinity } : {}}
      whileTap={ready ? { scale: 0.85 } : {}}
      onPointerDown={(e) => { e.preventDefault(); if (ready) onFire(); }}
      aria-label="おうえん"
    >
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={RADIUS} fill="none" stroke="var(--text)" strokeWidth="4" opacity="0.15" />
        <circle cx="30" cy="30" r={RADIUS} fill="none" stroke={ready ? 'var(--primary)' : 'var(--secondary)'} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - ratio)} style={{ transition: 'stroke-dashoffset 0.3s' }} />
      </svg>
      <Sparkles size={20} className={ready ? 'text-[var(--primary)]' : 'text-[var(--text)] opacity-40'} />
      <span className={`text-[9px] font-black ${ready ? 'text-[var(--text)]' : 'text-[var(--text)] opacity-40'}`}>おうえん</span>
    </motion.button>
  );
};

// 問題エリアに重ねるデバフ演出(ink=スライムのしずく / blackout=くらやみ)
export const ProblemDebuffOverlay = ({ debuffs }) => {
  const ink = debuffs.find(d => d.kind === 'ink');
  const blackout = debuffs.find(d => d.kind === 'blackout');
  return (
    <AnimatePresence>
      {ink && (
        <motion.div key={`ink-${ink.at}`} className="absolute inset-0 z-20 pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
          {[{ l: '12%', t: '8%', s: 110 }, { l: '42%', t: '30%', s: 150 }, { l: '68%', t: '5%', s: 120 }].map((b, i) => (
            <motion.svg key={i} viewBox="0 0 100 100" className="absolute" style={{ left: b.l, top: b.t, width: b.s, height: b.s }}
              initial={{ y: -60, scale: 0.4, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 0.92 }} transition={{ type: 'spring', bounce: 0.5, delay: i * 0.1 }}>
              <path d="M50 6 C 72 20, 88 42, 86 62 C 84 82, 68 92, 50 92 C 32 92, 16 82, 14 62 C 12 42, 28 20, 50 6 Z" fill="#7BC950" stroke="#56AB2F" strokeWidth="4" />
              <ellipse cx="36" cy="36" rx="9" ry="14" fill="#ffffff" opacity="0.4" transform="rotate(-20 36 36)" />
            </motion.svg>
          ))}
        </motion.div>
      )}
      {blackout && (
        <motion.div key={`bo-${blackout.at}`} className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center rounded-2xl bg-[#0f172a]/90"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
          <span className="font-black text-5xl md:text-7xl text-[#39FF14] tracking-widest">??????</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// テンキーに重ねる凍結演出。残り秒数のカウントダウンは内部tickで完結させる
export const FreezeOverlay = ({ debuffs }) => {
  const freeze = debuffs.find(d => d.kind === 'freeze');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!freeze) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [!!freeze]);
  return (
    <AnimatePresence>
      {freeze && (
        <motion.div key={`fz-${freeze.at}`} className="absolute inset-0 z-40 rounded-2xl flex flex-col items-center justify-center bg-sky-200/70 border-4 border-sky-400 backdrop-blur-[2px]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }}>
          <motion.span className="text-5xl" animate={{ rotate: [0, -10, 10, 0] }} transition={{ duration: 0.8, repeat: Infinity }}>❄️</motion.span>
          <span className="font-black text-sky-700 text-lg">こおってる！ {Math.max(0, Math.ceil((freeze.expiresAt - now) / 1000))}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// 全画面イベント演出(撃破 / 新ボス登場 / たてなおし / おうえん)
export const RaidEventOverlay = ({ lastEvent }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lastEvent) return;
    const id = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(id);
  }, [lastEvent?.at]);
  const show = lastEvent && now < lastEvent.at + (lastEvent.kind === 'boss_defeated' ? RAID_CONSTANTS.DEFEAT_LOCK_MS : 2000);
  const banner = (bg, content) => (
    <motion.div key={`${lastEvent.kind}-${lastEvent.at}`} className="absolute inset-x-0 top-1/4 z-[60] flex justify-center pointer-events-none px-4"
      initial={{ opacity: 0, scale: 0.6, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: 'spring', bounce: 0.5 }}>
      <div className={`${bg} border-[4px] border-[var(--text)] rounded-2xl px-6 py-3 font-black text-xl md:text-2xl shadow-[4px_4px_0_var(--text)] text-center`}>{content}</div>
    </motion.div>
  );
  return (
    <AnimatePresence>
      {show && lastEvent.kind === 'boss_defeated' && banner('bg-[var(--accent)] text-[var(--text)]', <>👑 たおした！！</>)}
      {show && lastEvent.kind === 'boss_enter' && banner('bg-[var(--panel)] text-[var(--text)]', <>⚔ {bossForStage(lastEvent.stage || 1).name} があらわれた！</>)}
      {show && lastEvent.kind === 'team_down' && banner('bg-[var(--panel)] text-[var(--primary)]', <><span className="ruby-text">💥 たいせいを たてなおせ！</span></>)}
      {show && lastEvent.kind === 'support' && banner('bg-pink-100 text-pink-600', <>💝 {lastEvent.name} さんの おうえん！</>)}
    </AnimatePresence>
  );
};

// ==========================================
// 結果画面: 貢献度パネル
// ==========================================

const MVP_DEFS = [
  { key: 'damage', label: 'アタックMVP', emoji: '⚔️', min: 1 },
  { key: 'supports', label: 'サポートMVP', emoji: '💝', min: 1 },
  { key: 'maxCombo', label: 'コンボMVP', emoji: '🔥', min: 2 },
];

export const RaidResultPanel = ({ raidResult, myId }) => {
  const { defeated = 0, contributions = {} } = raidResult || {};
  const list = Object.entries(contributions).map(([id, c]) => ({ id, ...c })).sort((a, b) => b.damage - a.damage);
  const maxDamage = Math.max(1, ...list.map(p => p.damage));
  const mvps = MVP_DEFS.map(def => {
    const best = list.reduce((acc, p) => ((p[def.key] || 0) > (acc?.[def.key] || 0) ? p : acc), null);
    return best && (best[def.key] || 0) >= def.min ? { ...def, winner: best } : null;
  }).filter(Boolean);

  return (
    <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] p-4 w-full mb-6 shrink-0 relative overflow-hidden flex flex-col items-center shadow-[4px_4px_0_var(--text)]">
      <h3 className="font-black text-xl mb-2 text-[var(--text)] flex items-center gap-2">
        <Crown size={24} className="text-yellow-400" /> ボスを <span className="text-4xl text-[var(--primary)]">{defeated}</span> たい たおした！
      </h3>
      {defeated > 0 && (
        <div className="flex justify-center gap-1 mb-4 flex-wrap">
          {[...Array(Math.min(defeated, 8))].map((_, i) => {
            const info = bossForStage(i + 1);
            return <BossAvatar key={i} bossIndex={info.bossIndex} superMode={info.superMode} className="w-12 h-12" />;
          })}
          {defeated > 8 && <span className="font-black text-[var(--text)] self-center">+{defeated - 8}</span>}
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
          <div key={p.id} className={`rounded-xl border-2 px-3 py-2 ${p.id === myId ? 'border-[var(--primary)] bg-[var(--bg)]' : 'border-[var(--text)] bg-[var(--bg)]'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-black text-xs text-[var(--text)] opacity-50 w-6">#{idx + 1}</span>
              <span className="font-bold text-sm truncate flex-grow">{p.name}{p.id === myId && <span className="text-[10px] text-[var(--primary)] ml-1">(あなた)</span>}</span>
              <span className="font-black text-sm text-[var(--text)] shrink-0">⚔{p.damage}</span>
              <span className="font-black text-xs text-pink-500 shrink-0">💝{p.supports || 0}</span>
              <span className="font-black text-xs text-orange-500 shrink-0">🔥{p.maxCombo || 0}</span>
            </div>
            <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden border border-[var(--text)]">
              <motion.div className="h-full origin-left bg-[var(--primary)]" initial={{ scaleX: 0 }} animate={{ scaleX: p.damage / maxDamage }} transition={{ duration: 0.8, delay: 0.2 + idx * 0.12, ease: 'easeOut' }} style={{ width: '100%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
