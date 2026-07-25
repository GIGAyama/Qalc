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
    id: 'purun', name: 'スライムキング・プルン', color: '#22C55E',
    attackName: { ink: 'ぷるぷるスプラッシュ', hp: 'たいあたり' },
    attacks: [
      { kind: 'ink', weight: 7, durationMs: 4000 },
      { kind: 'hp', weight: 3 },
    ],
  },
  {
    id: 'goron', name: 'カウントドラゴン・ゴロン', color: '#4F46E5',
    attackName: { blackout: 'かずかくしブレス', hp: 'しっぽアタック' },
    attacks: [
      { kind: 'blackout', weight: 6, durationMs: 3000 },
      { kind: 'hp', weight: 4 },
    ],
  },
  {
    id: 'nyaruru', name: 'まじょねこ・ニャルル', color: '#A855F7',
    attackName: { shuffle: 'シャッフルマジック', freeze: 'こおりのまなざし', hp: 'ネコパンチ' },
    attacks: [
      { kind: 'shuffle', weight: 5, durationMs: 6000 },
      { kind: 'freeze', weight: 3, durationMs: 2500 },
      { kind: 'hp', weight: 2 },
    ],
  },
  {
    id: 'calculon', name: 'メカボス・カリキュロン', color: '#EF4444',
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

// 各ボス共通: 背後の闘気オーラ(色付きビネット+立ち昇る粒子)。どのテーマ背景でもボスを際立たせる
const BattleAura = ({ color }) => {
  const gid = `bossAura${color.replace('#', '')}`;
  return (
    <g>
      <defs>
        <radialGradient id={gid} cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.38" />
          <stop offset="70%" stopColor={color} stopOpacity="0.14" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="112" r="94" fill={`url(#${gid})`} />
      {[36, 76, 128, 168].map((x, i) => (
        <motion.circle key={x} cx={x} cy="170" r={i % 2 ? 2.5 : 3.5} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }}
          animate={{ y: [0, -80], opacity: [0, 0.9, 0] }} transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.65, ease: 'easeOut' }} />
      ))}
    </g>
  );
};

// --- ボス1: スライムキング・プルン(猛毒の粘体王) ---
const PurunBoss = ({ animState }) => {
  const hit = animState === 'hit';
  const attack = animState === 'attack';
  const defeat = animState === 'defeat';
  return (
    <motion.g animate={attack ? { y: [0, -34, 0] } : { y: 0 }} transition={{ duration: 0.5 }}>
      <defs>
        <linearGradient id="pkBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86EFAC" /><stop offset="45%" stopColor="#22C55E" /><stop offset="100%" stopColor="#14532D" />
        </linearGradient>
        <linearGradient id="pkCrown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FEF08A" /><stop offset="55%" stopColor="#FACC15" /><stop offset="100%" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id="pkCape" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#991B1B" /><stop offset="100%" stopColor="#450A0A" />
        </linearGradient>
        <radialGradient id="pkCore" cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FEF9C3" /><stop offset="55%" stopColor="#FDE047" /><stop offset="100%" stopColor="#D97706" />
        </radialGradient>
      </defs>
      {/* 攻撃時に飛び散る毒液 */}
      {attack && [...Array(8)].map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <motion.circle key={i} cx="100" cy="150" r="7" fill="#4ADE80" stroke="#166534" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 5px #4ADE80)' }} initial={{ opacity: 1, x: 0, y: 0 }} animate={{ opacity: 0, x: Math.cos(a) * 80, y: Math.sin(a) * 52 - 26 }} transition={{ duration: 0.6 }} />;
      })}
      <motion.g
        style={{ originX: '100px', originY: '186px' }}
        animate={defeat
          ? { scaleY: 0.07, scaleX: 1.45 }
          : hit ? { scaleX: [1, 1.22, 0.9, 1], scaleY: [1, 0.8, 1.05, 1] }
            : { scaleY: [1, 0.94, 1], scaleX: [1, 1.05, 1] }}
        transition={defeat ? { duration: 0.8 } : hit ? { duration: 0.35 } : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* 王のマント */}
        <path d="M62 90 C 22 114, 14 164, 28 184 L 56 170 L 52 118 Z" fill="url(#pkCape)" stroke="#1C0505" strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M138 90 C 178 114, 186 164, 172 184 L 144 170 L 148 118 Z" fill="url(#pkCape)" stroke="#1C0505" strokeWidth="3.5" strokeLinejoin="round" />
        {/* 粘体ボディ */}
        <path d="M100 42 C 148 68, 170 108, 170 145 C 170 176, 151 187, 130 183 C 119 181, 114 187, 100 187 C 86 187, 81 181, 70 183 C 49 187, 30 176, 30 145 C 30 108, 52 68, 100 42 Z" fill="url(#pkBody)" stroke="#052E16" strokeWidth="4.5" />
        {/* 体内の気泡(ゆっくり浮上) */}
        {[[68, 158, 5], [126, 166, 4], [88, 172, 3]].map(([x, y, r], i) => (
          <motion.circle key={i} cx={x} cy={y} r={r} fill="#BBF7D0" opacity="0.5" animate={{ y: [0, -26], opacity: [0.5, 0] }} transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.9, ease: 'easeOut' }} />
        ))}
        {/* リムライト */}
        <ellipse cx="68" cy="84" rx="17" ry="27" fill="#ffffff" opacity="0.45" transform="rotate(-22 68 84)" />
        <path d="M146 92 C 158 108, 164 126, 164 142" stroke="#BBF7D0" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.5" />
        {/* 目: 爛々と光る三角眼(被弾・撃破でバッテン) */}
        {defeat || hit ? (
          <g stroke="#DCFCE7" strokeWidth="5" strokeLinecap="round" fill="none">
            <path d="M62 110 L88 128 M88 110 L62 128" /><path d="M112 110 L138 128 M138 110 L112 128" />
          </g>
        ) : (
          <g style={{ filter: 'drop-shadow(0 0 5px #FDE047)' }}>
            <path d="M56 106 L94 116 L62 130 Z" fill="#FDE047" stroke="#713F12" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M144 106 L106 116 L138 130 Z" fill="#FDE047" stroke="#713F12" strokeWidth="2.5" strokeLinejoin="round" />
            <circle cx="74" cy="117" r="3" fill="#7F1D1D" /><circle cx="126" cy="117" r="3" fill="#7F1D1D" />
          </g>
        )}
        {/* ギザギザの大口と牙 */}
        {defeat ? (
          <path d="M78 158 Q100 148 122 158" stroke="#052E16" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        ) : (
          <g>
            <path d="M62 142 Q100 180 138 142 Q100 156 62 142 Z" fill="#052E16" stroke="#052E16" strokeWidth="2" strokeLinejoin="round" />
            <polygon points="70,145 78,162 86,148" fill="#F0FDF4" stroke="#052E16" strokeWidth="1.5" />
            <polygon points="130,145 122,162 114,148" fill="#F0FDF4" stroke="#052E16" strokeWidth="1.5" />
          </g>
        )}
        {/* 鼓動する王のコア */}
        <motion.circle cx="100" cy="171" r="8" fill="url(#pkCore)" stroke="#92400E" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 6px #FDE047)', originX: '100px', originY: '171px' }} animate={{ scale: [1, 1.18, 1] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }} />
      </motion.g>
      {/* 大王冠(撃破時に落ちる) */}
      <motion.g animate={defeat ? { y: 130, rotate: 110, x: 25 } : { y: 0, rotate: 0 }} transition={defeat ? { duration: 0.9, ease: 'easeIn' } : {}} style={{ originX: '100px', originY: '30px' }}>
        <polygon points="62,46 66,14 82,34 100,4 118,34 134,14 138,46" fill="url(#pkCrown)" stroke="#78350F" strokeWidth="4" strokeLinejoin="round" />
        <rect x="62" y="42" width="76" height="11" rx="3" fill="url(#pkCrown)" stroke="#78350F" strokeWidth="3" />
        <circle cx="100" cy="47" r="5" fill="#EF4444" stroke="#78350F" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 3px #EF4444)' }} />
        <circle cx="79" cy="47" r="3.5" fill="#3B82F6" stroke="#78350F" strokeWidth="1.5" />
        <circle cx="121" cy="47" r="3.5" fill="#3B82F6" stroke="#78350F" strokeWidth="1.5" />
        <circle cx="66" cy="13" r="3" fill="#FEF08A" stroke="#78350F" strokeWidth="1.5" /><circle cx="100" cy="4" r="3.5" fill="#FEF08A" stroke="#78350F" strokeWidth="1.5" /><circle cx="134" cy="13" r="3" fill="#FEF08A" stroke="#78350F" strokeWidth="1.5" />
      </motion.g>
    </motion.g>
  );
};

// --- ボス2: カウントドラゴン・ゴロン(数字を操る蒼竜) ---
const GoronBoss = ({ animState }) => {
  const hit = animState === 'hit';
  const attack = animState === 'attack';
  const defeat = animState === 'defeat';
  return (
    <motion.g animate={defeat ? { rotate: 20, y: 15, opacity: 0 } : hit ? { x: [-8, 8, -5, 0] } : { x: 0 }} transition={defeat ? { duration: 1.1, opacity: { delay: 0.5, duration: 0.6 } } : { duration: 0.35 }} style={{ originX: '100px', originY: '120px' }}>
      <defs>
        <linearGradient id="gdBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818CF8" /><stop offset="45%" stopColor="#4F46E5" /><stop offset="100%" stopColor="#1E1B4B" />
        </linearGradient>
        <linearGradient id="gdWing" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4338CA" /><stop offset="100%" stopColor="#111036" />
        </linearGradient>
        <linearGradient id="gdBelly" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C7D2FE" /><stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
        <linearGradient id="gdHorn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F8FAFC" /><stop offset="100%" stopColor="#64748B" />
        </linearGradient>
      </defs>
      {/* 漂う数字ルーン(シアン発光) */}
      {['3', '7', '5'].map((n, i) => (
        <motion.text key={n} x={[24, 172, 18][i]} y={[58, 88, 132][i]} fontSize="20" fontWeight="900" fill="#67E8F9" opacity="0.75" style={{ filter: 'drop-shadow(0 0 5px #22D3EE)' }}
          animate={{ y: [[58, 88, 132][i], [58, 88, 132][i] - 12, [58, 88, 132][i]], opacity: [0.75, 0.35, 0.75] }} transition={{ duration: 2.4 + i * 0.5, repeat: Infinity, ease: 'easeInOut' }}>{n}</motion.text>
      ))}
      {/* しっぽ(矢じり付き) */}
      <path d="M118 168 C 148 176, 160 182, 170 190" stroke="#1E1B4B" strokeWidth="9" fill="none" strokeLinecap="round" />
      <polygon points="164,182 188,188 170,199" fill="#4F46E5" stroke="#111036" strokeWidth="3" strokeLinejoin="round" />
      {/* 翼(骨指+皮膜) */}
      <motion.g style={{ originX: '64px', originY: '95px' }} animate={{ rotate: [0, -14, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
        <path d="M64 95 L4 30 L26 74 L0 66 L28 102 L10 110 L48 126 Z" fill="url(#gdWing)" stroke="#0B0A28" strokeWidth="4" strokeLinejoin="round" />
        <path d="M64 95 L10 38 M64 98 L6 70 M62 102 L16 105" stroke="#818CF8" strokeWidth="2" opacity="0.55" fill="none" />
      </motion.g>
      <motion.g style={{ originX: '136px', originY: '95px' }} animate={{ rotate: [0, 14, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
        <path d="M136 95 L196 30 L174 74 L200 66 L172 102 L190 110 L152 126 Z" fill="url(#gdWing)" stroke="#0B0A28" strokeWidth="4" strokeLinejoin="round" />
        <path d="M136 95 L190 38 M136 98 L194 70 M138 102 L184 105" stroke="#818CF8" strokeWidth="2" opacity="0.55" fill="none" />
      </motion.g>
      {/* 胴体 */}
      <motion.g animate={attack ? { rotate: -8 } : { scale: [1, 1.03, 1] }} transition={attack ? { duration: 0.3 } : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} style={{ originX: '100px', originY: '150px' }}>
        {/* 背びれ */}
        <polygon points="86,44 92,28 98,42" fill="#312E81" stroke="#0B0A28" strokeWidth="3" strokeLinejoin="round" />
        <polygon points="102,42 108,26 114,44" fill="#312E81" stroke="#0B0A28" strokeWidth="3" strokeLinejoin="round" />
        <path d="M100 38 C 142 43, 157 80, 154 122 C 152 157, 136 177, 100 180 C 64 177, 48 157, 46 122 C 43 80, 58 43, 100 38 Z" fill="url(#gdBody)" stroke="#0B0A28" strokeWidth="4.5" />
        {/* 腹部装甲 */}
        <ellipse cx="100" cy="142" rx="31" ry="33" fill="url(#gdBelly)" stroke="#1E1B4B" strokeWidth="3" />
        <path d="M72 128 Q100 138 128 128 M74 144 Q100 154 126 144 M79 160 Q100 169 121 160" stroke="#1E1B4B" strokeWidth="2.5" fill="none" opacity="0.55" />
        {/* カウントコア(胸の菱形結晶) */}
        <motion.polygon points="100,126 111,141 100,156 89,141" fill="#22D3EE" stroke="#0E7490" strokeWidth="2.5" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 7px #22D3EE)' }} animate={{ opacity: [1, 0.55, 1] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />
        {/* 湾曲する双角 */}
        <path d="M74 52 C 54 38, 46 18, 58 2 C 58 20, 68 34, 88 46 Z" fill="url(#gdHorn)" stroke="#1E293B" strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M126 52 C 146 38, 154 18, 142 2 C 142 20, 132 34, 112 46 Z" fill="url(#gdHorn)" stroke="#1E293B" strokeWidth="3.5" strokeLinejoin="round" />
        {/* 目: 白熱するシアンの眼光と怒り眉 */}
        {defeat ? (
          <g stroke="#C7D2FE" strokeWidth="4.5" strokeLinecap="round" fill="none">
            <path d="M64 76 L84 90 M84 76 L64 90" /><path d="M116 76 L136 90 M136 76 L116 90" />
          </g>
        ) : (
          <g>
            <path d="M56 70 L92 80 L62 94 Z" fill="#A5F3FC" stroke="#0E7490" strokeWidth="2.5" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px #22D3EE)' }} />
            <path d="M144 70 L108 80 L138 94 Z" fill="#A5F3FC" stroke="#0E7490" strokeWidth="2.5" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px #22D3EE)' }} />
            <circle cx="72" cy="81" r="2.8" fill="#164E63" /><circle cx="128" cy="81" r="2.8" fill="#164E63" />
            <path d="M52 64 L90 72 M148 64 L110 72" stroke="#0B0A28" strokeWidth="4.5" strokeLinecap="round" />
          </g>
        )}
        {/* 鼻先・口・牙 */}
        <path d="M86 102 Q100 113 114 102" stroke="#0B0A28" strokeWidth="4" fill="none" strokeLinecap="round" />
        <polygon points="87,103 91,112 95,104" fill="#F8FAFC" stroke="#0B0A28" strokeWidth="1.5" />
        <polygon points="113,103 109,112 105,104" fill="#F8FAFC" stroke="#0B0A28" strokeWidth="1.5" />
        <circle cx="93" cy="98" r="2.5" fill="#0B0A28" /><circle cx="107" cy="98" r="2.5" fill="#0B0A28" />
      </motion.g>
      {/* 攻撃時の三層ファイアブレス */}
      {attack && (
        <motion.g initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: [0, 1, 1, 0] }} transition={{ duration: 0.6 }} style={{ originX: '105px', originY: '108px' }}>
          <polygon points="105,96 198,80 186,108 200,124 105,120" fill="#DC2F02" opacity="0.9" style={{ filter: 'drop-shadow(0 0 8px #FB8500)' }} />
          <polygon points="105,100 188,88 180,108 190,118 105,116" fill="#FB8500" />
          <polygon points="105,104 172,96 166,108 174,114 105,112" fill="#FFD166" />
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

// --- ボス3: まじょねこ・ニャルル(魔導の黒猫) ---
const NyaruruBoss = ({ animState }) => {
  const hit = animState === 'hit';
  const attack = animState === 'attack';
  const defeat = animState === 'defeat';
  return (
    <g>
      <defs>
        <linearGradient id="nyBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#413A6B" /><stop offset="100%" stopColor="#141026" />
        </linearGradient>
        <linearGradient id="nyCloak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7C3AED" /><stop offset="100%" stopColor="#2E1065" />
        </linearGradient>
        <linearGradient id="nyHat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" /><stop offset="100%" stopColor="#4C1D95" />
        </linearGradient>
        <radialGradient id="nyOrb" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#FDF4FF" /><stop offset="45%" stopColor="#E879F9" /><stop offset="100%" stopColor="#86198F" />
        </radialGradient>
      </defs>
      {/* 回転する魔法陣 */}
      <motion.g style={{ originX: '100px', originY: '118px' }} animate={{ rotate: 360 }} transition={{ duration: 18, repeat: Infinity, ease: 'linear' }} opacity="0.6">
        <circle cx="100" cy="118" r="80" fill="none" stroke="#C084FC" strokeWidth="2" strokeDasharray="12 7" style={{ filter: 'drop-shadow(0 0 4px #C084FC)' }} />
        <circle cx="100" cy="118" r="68" fill="none" stroke="#E879F9" strokeWidth="1.5" strokeDasharray="3 10" />
        {[0, 90, 180, 270].map(deg => (
          <polygon key={deg} points="100,32 105,38 100,44 95,38" fill="#F0ABFC" transform={`rotate(${deg} 100 118)`} style={{ filter: 'drop-shadow(0 0 3px #E879F9)' }} />
        ))}
      </motion.g>
      <motion.g
        animate={defeat ? { rotate: 720, opacity: 0 } : { y: [0, -8, 0] }}
        transition={defeat ? { duration: 0.8, ease: 'easeIn' } : { duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        style={{ originX: '100px', originY: '120px' }}
      >
        {/* しっぽ(先がくるん) */}
        <motion.path d="M140 162 C 172 168, 178 144, 164 136 C 156 131, 150 140, 158 144" stroke="#141026" strokeWidth="6" fill="none" strokeLinecap="round"
          animate={{ rotate: [0, 10, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} style={{ originX: '140px', originY: '162px' }} />
        {/* 魔女のローブ(裾が裂けたマント) */}
        <path d="M100 74 C 138 78, 158 104, 162 148 C 164 168, 156 180, 148 186 L 140 172 L 130 187 L 119 175 L 100 189 L 81 175 L 70 187 L 60 172 L 52 186 C 44 180, 36 168, 38 148 C 42 104, 62 78, 100 74 Z" fill="url(#nyCloak)" stroke="#1E1041" strokeWidth="4" strokeLinejoin="round" />
        {/* 体(黒猫) */}
        <motion.g animate={hit ? { scale: [1, 1.15, 1] } : { scale: 1 }} transition={{ duration: 0.3 }} style={{ originX: '100px', originY: '130px' }}>
          <path d="M100 68 C 128 68, 146 92, 146 126 C 146 156, 128 172, 100 172 C 72 172, 54 156, 54 126 C 54 92, 72 68, 100 68 Z" fill="url(#nyBody)" stroke="#0B0819" strokeWidth="4" />
          <path d="M62 96 C 58 108, 56 120, 57 132" stroke="#8B5CF6" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity="0.55" />
          {/* 耳 */}
          <polygon points="66,82 54,48 90,66" fill="url(#nyBody)" stroke="#0B0819" strokeWidth="4" strokeLinejoin="round" />
          <polygon points="134,82 146,48 110,66" fill="url(#nyBody)" stroke="#0B0819" strokeWidth="4" strokeLinejoin="round" />
          <polygon points="68,76 62,58 80,68" fill="#E879F9" />
          <polygon points="132,76 138,58 120,68" fill="#E879F9" />
          {/* 目: 妖しく光る魔眼(被弾でまんまる) */}
          {hit || defeat ? (
            <g>
              <circle cx="80" cy="112" r="10" fill="#F0ABFC" stroke="#0B0819" strokeWidth="2.5" /><circle cx="80" cy="112" r="4" fill="#0B0819" />
              <circle cx="120" cy="112" r="10" fill="#F0ABFC" stroke="#0B0819" strokeWidth="2.5" /><circle cx="120" cy="112" r="4" fill="#0B0819" />
            </g>
          ) : (
            <g style={{ filter: 'drop-shadow(0 0 5px #E879F9)' }}>
              <path d="M64 108 Q80 96 94 110 Q80 120 64 108 Z" fill="#F0ABFC" stroke="#86198F" strokeWidth="2" />
              <path d="M136 108 Q120 96 106 110 Q120 120 136 108 Z" fill="#F0ABFC" stroke="#86198F" strokeWidth="2" />
              <path d="M79 102 L81 116 M121 102 L119 116" stroke="#4A044E" strokeWidth="3" strokeLinecap="round" />
              <path d="M60 96 L92 102 M140 96 L108 102" stroke="#0B0819" strokeWidth="4" strokeLinecap="round" />
            </g>
          )}
          {/* 鼻・口・魔力を帯びたヒゲ */}
          <polygon points="96,126 104,126 100,132" fill="#E879F9" />
          <path d="M100 132 Q94 140 86 136 M100 132 Q106 140 114 136" stroke="#E879F9" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <g stroke="#C084FC" strokeWidth="2" strokeLinecap="round" opacity="0.9" style={{ filter: 'drop-shadow(0 0 3px #C084FC)' }}>
            <line x1="50" y1="122" x2="76" y2="126" /><line x1="50" y1="134" x2="76" y2="132" />
            <line x1="150" y1="122" x2="124" y2="126" /><line x1="150" y1="134" x2="124" y2="132" />
          </g>
        </motion.g>
        {/* とんがり帽子(三日月飾り+曲がった先端。撃破で吹き飛ぶ) */}
        <motion.g animate={defeat ? { y: -120, rotate: -40, opacity: 0 } : hit ? { rotate: [0, -20, 0] } : { rotate: 0 }} transition={defeat ? { duration: 0.7 } : { duration: 0.4 }} style={{ originX: '100px', originY: '58px' }}>
          <path d="M56 62 C 70 34, 82 14, 94 4 C 112 -4, 126 4, 122 14 C 116 8, 106 8, 100 16 C 110 32, 116 46, 124 60 Z" fill="url(#nyHat)" stroke="#1E1041" strokeWidth="4" strokeLinejoin="round" />
          <path d="M46 62 Q100 80 134 56" stroke="#1E1041" strokeWidth="4" fill="#4C1D95" />
          <rect x="84" y="44" width="22" height="12" rx="2" fill="#1E1041" />
          <rect x="89" y="46" width="12" height="8" rx="1.5" fill="#FDE047" stroke="#B45309" strokeWidth="1.5" />
          <path d="M86 22 a 7 7 0 1 0 7 9 a 5.5 5.5 0 1 1 -7 -9" fill="#FDE047" style={{ filter: 'drop-shadow(0 0 3px #FDE047)' }} />
        </motion.g>
        {/* 魔杖(クリスタルオーブ) */}
        <motion.g animate={attack ? { rotate: [0, -45, 25, 0] } : { rotate: 0 }} transition={{ duration: 0.7 }} style={{ originX: '160px', originY: '150px' }}>
          <line x1="160" y1="152" x2="180" y2="96" stroke="#57230B" strokeWidth="6" strokeLinecap="round" />
          <circle cx="181" cy="88" r="10" fill="url(#nyOrb)" stroke="#701A75" strokeWidth="2.5" style={{ filter: 'drop-shadow(0 0 7px #E879F9)' }} />
          <motion.circle cx="181" cy="88" r="15" fill="none" stroke="#F0ABFC" strokeWidth="1.5" strokeDasharray="4 6" animate={{ rotate: 360 }} transition={{ duration: 4, repeat: Infinity, ease: 'linear' }} style={{ originX: '181px', originY: '88px' }} />
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

// --- ボス4: メカボス・カリキュロン(重装演算兵器) ---
const CalculonBoss = ({ animState }) => {
  const hit = animState === 'hit';
  const attack = animState === 'attack';
  const defeat = animState === 'defeat';
  const Gear = ({ cx, cy, reverse }) => (
    <motion.g animate={{ rotate: reverse ? -360 : 360 }} transition={{ duration: 5, repeat: Infinity, ease: 'linear' }} style={{ originX: `${cx}px`, originY: `${cy}px` }}>
      {[...Array(8)].map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <rect key={i} x={cx - 4} y={cy - 24} width="8" height="10" rx="2" fill="#475569" stroke="#020617" strokeWidth="2" transform={`rotate(${(a * 180) / Math.PI} ${cx} ${cy})`} />;
      })}
      <circle cx={cx} cy={cy} r="16" fill="#64748B" stroke="#020617" strokeWidth="3.5" />
      <circle cx={cx} cy={cy} r="6" fill="#1E293B" stroke="#020617" strokeWidth="2" />
    </motion.g>
  );
  return (
    <motion.g animate={hit ? { x: [-4, 4, -4, 4, 0] } : defeat ? { x: [-3, 3, -5, 5, -8, 8, 0] } : { y: [0, -2, 0] }}
      transition={hit ? { duration: 0.3 } : defeat ? { duration: 0.9 } : { duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}>
      <defs>
        <linearGradient id="mkArmor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#64748B" /><stop offset="45%" stopColor="#334155" /><stop offset="100%" stopColor="#0F172A" />
        </linearGradient>
        <linearGradient id="mkPlate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#94A3B8" /><stop offset="100%" stopColor="#334155" />
        </linearGradient>
        <radialGradient id="mkCore" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#FECACA" /><stop offset="45%" stopColor="#EF4444" /><stop offset="100%" stopColor="#7F1D1D" />
        </radialGradient>
      </defs>
      {/* 背部の歯車機関 */}
      <motion.g animate={defeat ? { x: -90, y: -60, rotate: -180, opacity: 0 } : {}} transition={{ duration: 0.8, delay: 0.9 }}><Gear cx={34} cy={80} /></motion.g>
      <motion.g animate={defeat ? { x: 90, y: -60, rotate: 180, opacity: 0 } : {}} transition={{ duration: 0.8, delay: 0.9 }}><Gear cx={166} cy={80} reverse /></motion.g>
      {/* 腕(装甲アーム+三本クロー) */}
      <motion.g animate={defeat ? { x: -110, y: 70, rotate: -120, opacity: 0 } : attack ? { rotate: -12 } : {}} transition={defeat ? { duration: 0.8, delay: 1 } : { duration: 0.3 }} style={{ originX: '38px', originY: '110px' }}>
        <rect x="22" y="104" width="26" height="34" rx="7" fill="url(#mkPlate)" stroke="#020617" strokeWidth="3.5" />
        <rect x="18" y="136" width="34" height="24" rx="6" fill="#1E293B" stroke="#020617" strokeWidth="3.5" />
        <polygon points="22,158 14,182 30,162" fill="#CBD5E1" stroke="#020617" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="32,160 33,188 42,162" fill="#CBD5E1" stroke="#020617" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="44,158 54,180 48,160" fill="#CBD5E1" stroke="#020617" strokeWidth="2.5" strokeLinejoin="round" />
      </motion.g>
      <motion.g animate={defeat ? { x: 110, y: 70, rotate: 120, opacity: 0 } : {}} transition={{ duration: 0.8, delay: 1 }}>
        <rect x="152" y="104" width="26" height="34" rx="7" fill="url(#mkPlate)" stroke="#020617" strokeWidth="3.5" />
        <rect x="148" y="136" width="34" height="24" rx="6" fill="#1E293B" stroke="#020617" strokeWidth="3.5" />
        <polygon points="152,158 146,182 160,162" fill="#CBD5E1" stroke="#020617" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="162,160 163,188 172,162" fill="#CBD5E1" stroke="#020617" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="174,158 184,180 178,160" fill="#CBD5E1" stroke="#020617" strokeWidth="2.5" strokeLinejoin="round" />
      </motion.g>
      {/* 肩部パウルドロン(スパイク付き) */}
      <motion.g animate={defeat ? { x: -70, y: -40, rotate: -90, opacity: 0 } : {}} transition={{ duration: 0.7, delay: 1.05 }}>
        <polygon points="14,92 50,76 60,104 24,114" fill="url(#mkPlate)" stroke="#020617" strokeWidth="4" strokeLinejoin="round" />
        <polygon points="14,92 0,74 30,82" fill="#475569" stroke="#020617" strokeWidth="3" strokeLinejoin="round" />
      </motion.g>
      <motion.g animate={defeat ? { x: 70, y: -40, rotate: 90, opacity: 0 } : {}} transition={{ duration: 0.7, delay: 1.05 }}>
        <polygon points="186,92 150,76 140,104 176,114" fill="url(#mkPlate)" stroke="#020617" strokeWidth="4" strokeLinejoin="round" />
        <polygon points="186,92 200,74 170,82" fill="#475569" stroke="#020617" strokeWidth="3" strokeLinejoin="round" />
      </motion.g>
      {/* 胴体 */}
      <motion.g animate={defeat ? { y: 40, opacity: 0 } : {}} transition={{ duration: 0.7, delay: 1.2 }}>
        <rect x="52" y="78" width="96" height="100" rx="12" fill="url(#mkArmor)" stroke="#020617" strokeWidth="4.5" />
        {[[61, 86], [139, 86], [61, 170], [139, 170]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.5" fill="#CBD5E1" stroke="#020617" strokeWidth="1.5" />
        ))}
        {/* 演算ディスプレイ */}
        <rect x="70" y="86" width="60" height="26" rx="4" fill="#020617" stroke="#1E293B" strokeWidth="3" />
        <motion.text x="100" y="105" textAnchor="middle" fontSize="15" fontWeight="900" fill="#39FF14" fontFamily="monospace"
          animate={hit ? { skewX: 15, opacity: [1, 0.2, 1, 0.4, 1] } : { opacity: [1, 1, 0.6, 1] }} transition={hit ? { duration: 0.3 } : { duration: 2, repeat: Infinity }}>
          {hit ? 'ERR0R' : '1+1=?'}
        </motion.text>
        {/* 動力コア(六角リアクター) */}
        <motion.g animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }} style={{ originX: '100px', originY: '138px' }}>
          <circle cx="100" cy="138" r="21" fill="none" stroke="#EF4444" strokeWidth="2" strokeDasharray="5 7" opacity="0.8" />
        </motion.g>
        <polygon points="100,122 114,130 114,146 100,154 86,146 86,130" fill="#1E293B" stroke="#020617" strokeWidth="3" strokeLinejoin="round" />
        <motion.circle cx="100" cy="138" r="9" fill="url(#mkCore)" stroke="#7F1D1D" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 8px #EF4444)', originX: '100px', originY: '138px' }} animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }} />
        {/* 警告ストライプ */}
        <rect x="60" y="160" width="80" height="12" rx="3" fill="#1E293B" stroke="#020617" strokeWidth="2.5" />
        {[0, 1, 2, 3, 4].map(i => (
          <polygon key={i} points={`${66 + i * 15},161 ${73 + i * 15},161 ${67 + i * 15},171 ${60 + i * 15},171`} fill="#F59E0B" opacity="0.9" />
        ))}
        {/* サイドベント(排熱の明滅) */}
        {[0, 1, 2].map(i => (
          <motion.rect key={i} x="56" y={118 + i * 10} width="10" height="5" rx="2" fill="#F97316" animate={{ opacity: [0.9, 0.25, 0.9] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.25 }} />
        ))}
        {[0, 1, 2].map(i => (
          <motion.rect key={i} x="134" y={118 + i * 10} width="10" height="5" rx="2" fill="#F97316" animate={{ opacity: [0.9, 0.25, 0.9] }} transition={{ duration: 1.1, repeat: Infinity, delay: 0.4 + i * 0.25 }} />
        ))}
      </motion.g>
      {/* 頭部 */}
      <motion.g animate={defeat ? { y: -140, rotate: 60, opacity: 0 } : attack ? { y: -4 } : {}} transition={defeat ? { duration: 0.8, delay: 0.8 } : { duration: 0.3 }}>
        <polygon points="90,28 100,6 110,28" fill="#334155" stroke="#020617" strokeWidth="3" strokeLinejoin="round" />
        <motion.circle cx="100" cy="13" r="4" fill="#EF4444" stroke="#020617" strokeWidth="1.5" animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }} style={{ filter: 'drop-shadow(0 0 4px #EF4444)' }} />
        {/* サイドフィン */}
        <polygon points="66,38 54,30 58,64 66,60" fill="#475569" stroke="#020617" strokeWidth="3" strokeLinejoin="round" />
        <polygon points="134,38 146,30 142,64 134,60" fill="#475569" stroke="#020617" strokeWidth="3" strokeLinejoin="round" />
        <rect x="66" y="26" width="68" height="52" rx="9" fill="url(#mkPlate)" stroke="#020617" strokeWidth="4" />
        {/* バイザー内を左右スキャンする赤LED */}
        <rect x="73" y="40" width="54" height="20" rx="5" fill="#0B1120" stroke="#020617" strokeWidth="3" />
        <motion.circle cy="50" r="5" fill="#EF4444" style={{ filter: 'drop-shadow(0 0 5px #EF4444)' }} animate={{ cx: [83, 117, 83] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />
        {/* マウスグリル */}
        <rect x="86" y="64" width="28" height="9" rx="2" fill="#1E293B" stroke="#020617" strokeWidth="2" />
        <path d="M92 64 V73 M100 64 V73 M108 64 V73" stroke="#020617" strokeWidth="1.5" />
      </motion.g>
      {/* 攻撃: 照準サークル→レーザー */}
      {attack && (
        <g>
          <motion.circle cx="100" cy="185" r="18" fill="none" stroke="#EF4444" strokeWidth="3" strokeDasharray="6 5"
            initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: [0, 1, 1, 0] }} transition={{ duration: 0.7 }} style={{ originX: '100px', originY: '185px' }} />
          <motion.rect x="94" y="80" width="12" height="110" fill="#EF4444" opacity="0.85" style={{ filter: 'drop-shadow(0 0 6px #EF4444)', originX: '100px', originY: '80px' }}
            initial={{ scaleY: 0 }} animate={{ scaleY: [0, 1, 1, 0] }} transition={{ duration: 0.6, delay: 0.25 }} />
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

// ボスの見た目。背後に闘気オーラを敷き、superMode(2周目以降)は色相反転+金色の闘気リングで「スーパー」個体化
export const BossAvatar = ({ bossIndex, animState = 'idle', superMode = false, className = '' }) => {
  const Boss = BOSS_COMPONENTS[bossIndex] || PurunBoss;
  const auraColor = (BOSSES[bossIndex] || BOSSES[0]).color;
  return (
    <motion.svg viewBox="0 0 200 200" className={className}
      initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.5 }}>
      {superMode && (
        <motion.g style={{ originX: '100px', originY: '112px' }} animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}>
          <circle cx="100" cy="112" r="90" fill="none" stroke="#FDE047" strokeWidth="3" strokeDasharray="5 16" opacity="0.85" style={{ filter: 'drop-shadow(0 0 6px #FDE047)' }} />
          {[0, 120, 240].map(deg => (
            <polygon key={deg} points="100,16 104,26 100,23 96,26" fill="#FDE047" transform={`rotate(${deg} 100 112)`} style={{ filter: 'drop-shadow(0 0 4px #FDE047)' }} />
          ))}
        </motion.g>
      )}
      <g style={superMode ? { filter: 'hue-rotate(140deg) saturate(1.5)' } : undefined}>
        <BattleAura color={auraColor} />
        <Boss animState={animState} />
      </g>
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
