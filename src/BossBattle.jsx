import React, { useState, useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Swords, Heart, Crown, Sparkles, AlertTriangle, Flame, Shield, Bomb } from 'lucide-react';

// ==========================================
// ボスバトル(BOSS_RAID)モード
//   - ボス定義・数値バランス・純関数 (ホスト権威ロジックが使う)
//   - ボスのドット絵アバター/バトルUI (全端末が raid_state スナップショットから描画)
// ==========================================

export const RAID_CONSTANTS = {
  TEAM_HP_MAX: 100,
  GAUGE_MAX: 10,
  CHEER_HEAL: 20,
  CHEER_DURATION_MS: 8000,
  DEFEAT_LOCK_MS: 2800,
  GRACE_MS: 9000,
  TELEGRAPH_MS: 2600,
  HEARTBEAT_MS: 2000,
  STAGE_CLEAR_HEAL: 12,
  TEAM_DOWN_RECOVER_HP: 40,
  TEAM_DOWN_BOSS_HEAL_RATE: 0.3,
  // --- 強化ボス用パラメータ ---
  ENRAGE_THRESHOLD: 0.3,       // ボスHPがこの割合以下になると「げきおこ」フェーズへ
  ENRAGE_INTERVAL_RATE: 0.6,   // げきおこ中の攻撃間隔の倍率(短くなる)
  ENRAGE_DAMAGE_RATE: 1.4,     // げきおこ中のボス攻撃力の倍率
  BURST_GAP_MS: 950,           // 連続攻撃(れんぞくこうげき)の間隔
  SHIELD_CUT: 0.5,             // バリア中に軽減されるダメージの割合
  CURSE_DAMAGE_RATE: 0.5,      // のろい中にプレイヤーの与ダメージにかかる倍率
  BOMB_DAMAGE: 28,             // 時限爆弾が不発に終わったときのチームHPダメージ
  BOMB_REQUIRED_HITS: 4,       // 時限爆弾の解除に必要なチーム全体の正解数
  DRAIN_AMOUNT: 14,            // きゅうしゅうでボスが回復し、チームが失うHP
  // --- 攻撃トラック(ダメージ系 / 妨害系)のスケジュール ---
  // ボスは「ダメージ攻撃」と「妨害攻撃」を別々のタイマーで撃つ。
  // 1つの抽選テーブルを共有していたころは、ダメージ攻撃を増やすと妨害攻撃が減ってしまったが、
  // トラックを分けたことで片方の頻度をもう片方に影響させずに調整できる。
  DAMAGE_INTERVAL_RATE: 1.5,   // ダメージ攻撃の間隔倍率(旧・混合抽選時の約1.3〜2.7倍の頻度になる)
  DISRUPT_INTERVAL_RATE: 1.3,  // 妨害攻撃の間隔倍率(どのボス・ステージでも旧・混合抽選時より頻度が下がらない値)
  TRACK_MIN_GAP_MS: 900,       // 2トラックの攻撃が重なったとき、後発をずらす最小間隔
  TRACK_START_OFFSET_MS: 3000, // 開始直後・ボス切替直後にダメージ攻撃をずらす時間
};

// プレイヤーに付くデバフ(activeDebuffs に積むもの)。shield/drain/hp はボス側の効果なので含めない
export const PLAYER_DEBUFF_KINDS = ['ink', 'blackout', 'shuffle', 'freeze', 'mirror', 'curse', 'bomb'];

// チームHPを削りにくる技(= ダメージ攻撃トラック)。これ以外はすべて妨害攻撃トラックになる。
// bomb は失敗したときのダメージが大きいのでダメージ側に入れている
export const DAMAGE_ATTACK_KINDS = ['hp', 'drain', 'bomb'];
export const attackTrackOf = (kind) => (DAMAGE_ATTACK_KINDS.includes(kind) ? 'damage' : 'disrupt');

// ボス定義:
//   attacks は重み付き抽選。minStage を付けた技は、そのステージ以降でのみ抽選対象になる。
//   重みはトラック(ダメージ系 / 妨害系)ごとに独立して働くので、
//   同じトラック内での出やすさだけを表す(例: hp と drain の比率)
//   kind = ink(問題かくし) / blackout(問題??化) / shuffle(テンキー混乱) / freeze(入力こおり)
//        / hp(チームHP攻撃) / mirror(問題かがみ文字) / curse(与ダメージ半減)
//        / bomb(時間内に◯回正解しないと大ダメージ) / drain(チームHPを吸ってボス回復) / shield(ボスにバリア)
export const BOSSES = [
  {
    id: 'purun', name: 'スライムキング・プルン', color: '#7C3AED', sprite: 'purun.png', fx: 'poison',
    attackName: {
      ink: 'ぷるぷるスプラッシュ', hp: 'たいあたり', drain: 'ヘドロきゅうしゅう',
      bomb: 'ねばねばバクダン', curse: 'どくのもや',
    },
    attacks: [
      { kind: 'ink', weight: 6, durationMs: 4200 },
      { kind: 'hp', weight: 4 },
      { kind: 'drain', weight: 3, minStage: 2 },
      { kind: 'curse', weight: 3, durationMs: 7000, minStage: 2 },
      { kind: 'bomb', weight: 2, durationMs: 10000, minStage: 3 },
    ],
  },
  {
    id: 'goron', name: 'カウントドラゴン・ゴロン', color: '#EF4444', sprite: 'goron.png', fx: 'fire',
    attackName: {
      blackout: 'かずかくしブレス', hp: 'しっぽアタック', mirror: 'かがみのつばさ',
      shield: 'りゅうりんのまもり', bomb: 'カウントダウンほのお',
    },
    attacks: [
      { kind: 'blackout', weight: 5, durationMs: 3200 },
      { kind: 'hp', weight: 5, extraDamage: 3 },
      { kind: 'mirror', weight: 4, durationMs: 6500, minStage: 2 },
      { kind: 'shield', weight: 3, durationMs: 7000, minStage: 2 },
      { kind: 'bomb', weight: 2, durationMs: 9500, minStage: 3 },
    ],
  },
  {
    id: 'nyaruru', name: 'まじょねこ・ニャルル', color: '#D946EF', sprite: 'nyaruru.png', fx: 'magic',
    attackName: {
      shuffle: 'シャッフルマジック', freeze: 'こおりのまなざし', hp: 'ネコパンチ',
      curse: 'くろねこのろい', mirror: 'ミラーワールド', drain: 'まりょくきゅうしゅう',
    },
    attacks: [
      { kind: 'shuffle', weight: 5, durationMs: 6500 },
      { kind: 'freeze', weight: 3, durationMs: 2600 },
      { kind: 'hp', weight: 3 },
      { kind: 'curse', weight: 4, durationMs: 8000, minStage: 2 },
      { kind: 'mirror', weight: 3, durationMs: 6000, minStage: 2 },
      { kind: 'drain', weight: 2, minStage: 3 },
    ],
  },
  {
    id: 'calculon', name: 'メカボス・カリキュロン', color: '#A855F7', sprite: 'calculon.png', fx: 'laser',
    attackName: {
      hp: 'ロックオンレーザー', freeze: 'システムジャック', blackout: 'ノイズジャミング',
      shield: 'アブソリュートバリア', bomb: 'じばくプログラム', curse: 'エラーウイルス', mirror: 'リバースコード',
    },
    attacks: [
      { kind: 'hp', weight: 4, extraDamage: 5 },
      { kind: 'freeze', weight: 3, durationMs: 2200, targetAll: true },
      { kind: 'blackout', weight: 3, durationMs: 3200 },
      { kind: 'shield', weight: 3, durationMs: 8000, minStage: 2 },
      { kind: 'curse', weight: 3, durationMs: 8000, minStage: 2 },
      { kind: 'mirror', weight: 2, durationMs: 6000, minStage: 3 },
      { kind: 'bomb', weight: 3, durationMs: 9000, minStage: 3 },
    ],
  },
];

export const bossForStage = (stage) => {
  const idx = (stage - 1) % BOSSES.length;
  const superMode = stage > BOSSES.length;
  return { bossIndex: idx, superMode, name: (superMode ? 'スーパー' : '') + BOSSES[idx].name };
};

// 体力: 旧 (50+50n)*1.3^(s-1) から約1.5倍に強化し、ステージごとの伸びも上げた
export const bossMaxHp = (stage, n) => Math.round((75 + 75 * Math.max(1, n)) * Math.pow(1.34, stage - 1));

// プレイヤーの与ダメージ。mods でボスのバリア/のろいの影響を反映する
export const calcRaidDamage = (combo, cheerActive, mods = {}) => {
  let dmg = 10 + 2 * Math.min(combo, 10);
  if (combo >= 5) dmg *= 1.5; // フィーバー
  if (cheerActive) dmg *= 2; // おうえんタイム
  if (mods.cursed) dmg *= RAID_CONSTANTS.CURSE_DAMAGE_RATE; // のろい
  if (mods.shielded) dmg *= 1 - RAID_CONSTANTS.SHIELD_CUT; // ボスのバリア
  return Math.max(1, Math.round(dmg));
};

// 攻撃間隔: 旧 max(8000, 20000-2000(s-1)) から短縮。げきおこ中はさらに約6割。
// track ごとに別のタイマーで使うため、基準間隔にトラックの倍率を掛けて返す
export const attackIntervalMs = (stage, enraged = false, track = 'disrupt') => {
  const base = Math.max(5000, 15000 - 1500 * (stage - 1));
  const rate = track === 'damage' ? RAID_CONSTANTS.DAMAGE_INTERVAL_RATE : RAID_CONSTANTS.DISRUPT_INTERVAL_RATE;
  const jittered = base * rate * (0.85 + Math.random() * 0.3);
  return Math.round(jittered * (enraged ? RAID_CONSTANTS.ENRAGE_INTERVAL_RATE : 1));
};

export const bossAttackDamage = (stage, extraDamage = 0, enraged = false) =>
  Math.round((Math.min(32, 13 + 3 * stage) + extraDamage) * (enraged ? RAID_CONSTANTS.ENRAGE_DAMAGE_RATE : 1));

// 1回のターンに続けて撃つ攻撃の本数(れんぞくこうげき)
export const rollBurstCount = (stage, enraged = false) => {
  let n = 1;
  if (stage >= 3 && Math.random() < 0.35) n += 1;
  if (enraged && Math.random() < 0.5) n += 1;
  return Math.min(3, n);
};

// ボスの攻撃を重み付き抽選する(ホスト専用)。targets は 'all' か peerId の配列。
// opts.track を渡すと、そのトラック(damage / disrupt)の技だけから抽選する。
// opts.exclude は今かかっている技(バリア・時限爆弾)を上書きしないための除外リスト
export const pickBossAttack = (bossIndex, stage, participantIds, opts = {}) => {
  const boss = BOSSES[bossIndex];
  const enraged = !!opts.enraged;
  const exclude = opts.exclude || [];
  const inStage = (a) => !a.minStage || stage >= a.minStage;
  const inTrack = (a) => !opts.track || attackTrackOf(a.kind) === opts.track;
  // 条件を満たす技が無くなったら、除外→ステージ の順に条件をゆるめてトラックだけは守る
  const candidates = [
    boss.attacks.filter(a => inTrack(a) && inStage(a) && !exclude.includes(a.kind)),
    boss.attacks.filter(a => inTrack(a) && inStage(a)),
    boss.attacks.filter(a => inTrack(a)),
    boss.attacks,
  ];
  const table = candidates.find(list => list.length > 0);
  const total = table.reduce((s, a) => s + a.weight, 0);
  let roll = Math.random() * total;
  let atk = table[0];
  for (const a of table) { roll -= a.weight; if (roll <= 0) { atk = a; break; } }

  const result = {
    kind: atk.kind, targets: 'all', durationMs: atk.durationMs || 0, damage: 0, shuffleSeed: 0,
    bossIndex, enraged, needHits: 0,
    label: boss.attackName?.[atk.kind] || 'こうげき',
    debuff: PLAYER_DEBUFF_KINDS.includes(atk.kind),
  };
  if (atk.kind === 'hp') result.damage = bossAttackDamage(stage, atk.extraDamage || 0, enraged);
  if (atk.kind === 'drain') result.damage = RAID_CONSTANTS.DRAIN_AMOUNT + (enraged ? 6 : 0);
  if (atk.kind === 'bomb') result.needHits = RAID_CONSTANTS.BOMB_REQUIRED_HITS + (stage >= 5 ? 1 : 0);
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

// 与ダメージ計算に渡す補正(のろい / ボスのバリア)。回答ハンドラから同期的に呼べるよう純関数
export const raidDamageMods = (raidState, myId) => {
  if (!raidState) return {};
  const now = Date.now();
  const cursed = (raidState.activeDebuffs || []).some(d =>
    d.kind === 'curse' && d.expiresAt > now && (d.targets === 'all' || (Array.isArray(d.targets) && d.targets.includes(myId)))
  );
  return { cursed, shielded: (raidState.shieldUntil || 0) > now };
};

// 「かがみ文字」デバフ中は問題文を左右反転させる
export const raidProblemTransform = (debuffs) => (debuffs.some(d => d.kind === 'mirror') ? 'scaleX(-1)' : undefined);

// ==========================================
// ボスのドット絵アバター (viewBox 0 0 200 200)
// ==========================================

const SPRITE_DIR = `${import.meta.env.BASE_URL}bosses/`;
export const bossSpriteUrl = (bossIndex) => SPRITE_DIR + (BOSSES[bossIndex] || BOSSES[0]).sprite;

// 初回表示のちらつきを避けるため、バトル開始時に4体ぶんを先読みする
export const preloadBossSprites = () => {
  if (typeof window === 'undefined') return;
  BOSSES.forEach(b => { const img = new window.Image(); img.src = SPRITE_DIR + b.sprite; });
};

// 各ボス共通: 被弾時の全面白フラッシュ
const HitFlash = ({ active }) => (
  <AnimatePresence>
    {active && <motion.rect x="0" y="0" width="200" height="200" rx="30" fill="#ffffff" initial={{ opacity: 0.55 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />}
  </AnimatePresence>
);

// 各ボス共通: 背後の闘気オーラ(色付きビネット+立ち昇る粒子)。どのテーマ背景でもボスを際立たせる
const BattleAura = ({ color, gid, enraged }) => (
  <g>
    <defs>
      <radialGradient id={gid} cx="50%" cy="55%" r="50%">
        <stop offset="0%" stopColor={color} stopOpacity={enraged ? 0.6 : 0.4} />
        <stop offset="70%" stopColor={color} stopOpacity={enraged ? 0.24 : 0.14} />
        <stop offset="100%" stopColor={color} stopOpacity="0" />
      </radialGradient>
    </defs>
    <motion.circle cx="100" cy="110" r="94" fill={`url(#${gid})`}
      animate={enraged ? { scale: [1, 1.06, 1] } : { scale: 1 }}
      transition={{ duration: 0.9, repeat: enraged ? Infinity : 0, ease: 'easeInOut' }}
      style={{ originX: '100px', originY: '110px' }} />
    {[36, 76, 128, 168].map((x, i) => (
      <motion.circle key={x} cx={x} cy="176" r={i % 2 ? 2.5 : 3.5} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        animate={{ y: [0, -84], opacity: [0, 0.9, 0] }}
        transition={{ duration: enraged ? 1.5 : 2.6, repeat: Infinity, delay: i * (enraged ? 0.35 : 0.65), ease: 'easeOut' }} />
    ))}
  </g>
);

// ボスごとの攻撃エフェクト(ドット絵の上に重ねる)
const AttackFx = ({ fx, color }) => {
  if (fx === 'poison') {
    return (
      <g>
        {[...Array(10)].map((_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return <motion.circle key={i} cx="100" cy="120" r={5 + (i % 3) * 2} fill="#A78BFA" stroke="#4C1D95" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 6px #A78BFA)' }}
            initial={{ opacity: 1, x: 0, y: 0, scale: 0.4 }} animate={{ opacity: 0, x: Math.cos(a) * 96, y: Math.sin(a) * 70 + 10, scale: 1.3 }} transition={{ duration: 0.7 }} />;
        })}
      </g>
    );
  }
  if (fx === 'fire') {
    return (
      <motion.g initial={{ scaleY: 0.2, opacity: 0 }} animate={{ scaleY: 1, opacity: [0, 1, 1, 0] }} transition={{ duration: 0.75 }} style={{ originX: '100px', originY: '96px' }}>
        <polygon points="100,88 196,60 178,110 200,150 100,132" fill="#DC2626" opacity="0.9" style={{ filter: 'drop-shadow(0 0 10px #F97316)' }} />
        <polygon points="100,94 186,72 172,110 186,140 100,126" fill="#F97316" />
        <polygon points="100,100 168,86 158,110 168,130 100,120" fill="#FDE047" />
        <polygon points="100,88 4,60 22,110 0,150 100,132" fill="#DC2626" opacity="0.55" />
      </motion.g>
    );
  }
  if (fx === 'magic') {
    return (
      <g>
        {[...Array(8)].map((_, i) => (
          <motion.path key={i} d="M0,-8 L2.3,-2.3 L8,-2.3 L3.4,1.7 L5.2,7.5 L0,4 L-5.2,7.5 L-3.4,1.7 L-8,-2.3 L-2.3,-2.3 Z" fill="#F0ABFC" stroke="#A21CAF" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 5px #E879F9)' }}
            initial={{ x: 100, y: 96, opacity: 1, scale: 0.7 }} animate={{ x: 16 + i * 24, y: 214, opacity: 0, scale: 1.5, rotate: 300 }} transition={{ duration: 0.85, delay: i * 0.05 }} />
        ))}
      </g>
    );
  }
  // laser
  return (
    <g>
      <motion.circle cx="100" cy="192" r="20" fill="none" stroke={color} strokeWidth="3.5" strokeDasharray="7 5"
        initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: [0, 1, 1, 0], rotate: 180 }} transition={{ duration: 0.75 }} style={{ originX: '100px', originY: '192px' }} />
      <motion.rect x="92" y="70" width="16" height="126" fill={color} opacity="0.9" style={{ filter: `drop-shadow(0 0 10px ${color})`, originX: '100px', originY: '70px' }}
        initial={{ scaleY: 0 }} animate={{ scaleY: [0, 1, 1, 0] }} transition={{ duration: 0.65, delay: 0.22 }} />
      <motion.rect x="97" y="70" width="6" height="126" fill="#ffffff" opacity="0.9" style={{ originX: '100px', originY: '70px' }}
        initial={{ scaleY: 0 }} animate={{ scaleY: [0, 1, 1, 0] }} transition={{ duration: 0.65, delay: 0.22 }} />
    </g>
  );
};

// ドット絵スプライトのボス本体。idle/hit/attack/defeat と げきおこ の状態でアニメーションを切り替える
const SpriteBoss = ({ bossIndex, animState, enraged, uid }) => {
  const boss = BOSSES[bossIndex] || BOSSES[0];
  const href = bossSpriteUrl(bossIndex);
  const hit = animState === 'hit';
  const attack = animState === 'attack';
  const defeat = animState === 'defeat';
  const whiteId = `bw-${uid}`;
  const redId = `br-${uid}`;
  const BOX = { x: 12, y: 8, width: 176, height: 176 };

  const bodyAnim = defeat
    ? { scale: [1, 1.12, 0.2], rotate: [0, -6, 22], y: [0, -12, 46], opacity: [1, 1, 0] }
    : hit ? { x: [0, -8, 7, -4, 0], scale: [1, 0.94, 1.03, 1], rotate: [0, -3, 2, 0] }
      : attack ? { scale: [1, 1.16, 1], y: [0, -16, 0] }
        : { y: [0, -5, 0], scale: [1, 1.02, 1] };
  const bodyTrans = defeat ? { duration: 1.15, times: [0, 0.25, 1], ease: 'easeIn' }
    : hit ? { duration: 0.36 }
      : attack ? { duration: 0.55 }
        : { duration: enraged ? 1.2 : 2.4, repeat: Infinity, ease: 'easeInOut' };

  return (
    <g>
      <defs>
        {/* 被弾フラッシュ用: 透明度だけ残して真っ白にする */}
        <filter id={whiteId} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
        </filter>
        {/* げきおこ用: 赤く染める */}
        <filter id={redId} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.9 0.5 0.4 0 0.25  0.1 0.1 0.1 0 0  0.1 0.1 0.1 0 0  0 0 0 1 0" />
        </filter>
      </defs>

      {/* 接地影 */}
      <motion.ellipse cx="100" cy="188" rx="50" ry="8" fill="#000000" opacity="0.28"
        animate={defeat ? { opacity: 0, scaleX: 0.3 } : { scaleX: [1, 0.88, 1] }}
        transition={defeat ? { duration: 0.8 } : { duration: enraged ? 1.2 : 2.4, repeat: Infinity, ease: 'easeInOut' }}
        style={{ originX: '100px', originY: '188px' }} />

      <motion.g style={{ originX: '100px', originY: '160px' }} animate={bodyAnim} transition={bodyTrans}>
        <image href={href} xlinkHref={href} {...BOX} preserveAspectRatio="xMidYMid meet"
          style={{ filter: enraged ? `drop-shadow(0 0 10px ${boss.color})` : `drop-shadow(0 3px 5px rgba(0,0,0,0.45))` }} />
        {/* げきおこ中の赤い明滅 */}
        {enraged && !defeat && (
          <motion.image href={href} xlinkHref={href} {...BOX} preserveAspectRatio="xMidYMid meet" filter={`url(#${redId})`}
            animate={{ opacity: [0.12, 0.55, 0.12] }} transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }} />
        )}
        {/* 被弾の白フラッシュ */}
        {hit && (
          <motion.image href={href} xlinkHref={href} {...BOX} preserveAspectRatio="xMidYMid meet" filter={`url(#${whiteId})`}
            initial={{ opacity: 0.95 }} animate={{ opacity: 0 }} transition={{ duration: 0.32 }} />
        )}
        {/* 撃破時の白い消滅フラッシュ */}
        {defeat && (
          <motion.image href={href} xlinkHref={href} {...BOX} preserveAspectRatio="xMidYMid meet" filter={`url(#${whiteId})`}
            initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 1.1, times: [0, 0.3, 0.6, 1] }} />
        )}
      </motion.g>

      {/* 攻撃エフェクト */}
      {attack && <AttackFx fx={boss.fx} color={boss.color} />}

      {/* 被弾の火花 */}
      {hit && [...Array(5)].map((_, i) => {
        const a = -Math.PI / 2 + (i - 2) * 0.5;
        return <motion.circle key={i} r="4" fill="#FDE047" stroke="#F59E0B" strokeWidth="1.5"
          initial={{ cx: 100, cy: 104, opacity: 1 }} animate={{ cx: 100 + Math.cos(a) * 62, cy: 104 + Math.sin(a) * 62, opacity: 0 }} transition={{ duration: 0.45, delay: i * 0.04 }} />;
      })}

      {/* 撃破の破片 */}
      {defeat && [...Array(12)].map((_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <motion.rect key={i} width="9" height="9" rx="2" fill={boss.color} stroke="#0f172a" strokeWidth="1.5"
          initial={{ x: 96, y: 106, opacity: 1, rotate: 0 }} animate={{ x: 96 + Math.cos(a) * 105, y: 106 + Math.sin(a) * 105, opacity: 0, rotate: 300 }} transition={{ duration: 1, delay: 0.35 }} />;
      })}
    </g>
  );
};

// ボスの見た目。背後に闘気オーラを敷き、superMode(2周目以降)は金色の闘気リングで「スーパー」個体化
export const BossAvatar = ({ bossIndex, animState = 'idle', superMode = false, enraged = false, className = '' }) => {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, '');
  const boss = BOSSES[bossIndex] || BOSSES[0];
  const auraColor = enraged ? '#EF4444' : boss.color;
  return (
    <motion.svg viewBox="0 0 200 200" className={className}
      initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.5 }}>
      {superMode && (
        <motion.g style={{ originX: '100px', originY: '110px' }} animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}>
          <circle cx="100" cy="110" r="92" fill="none" stroke="#FDE047" strokeWidth="3" strokeDasharray="5 16" opacity="0.85" style={{ filter: 'drop-shadow(0 0 6px #FDE047)' }} />
          {[0, 120, 240].map(deg => (
            <polygon key={deg} points="100,14 104,24 100,21 96,24" fill="#FDE047" transform={`rotate(${deg} 100 110)`} style={{ filter: 'drop-shadow(0 0 4px #FDE047)' }} />
          ))}
        </motion.g>
      )}
      {enraged && (
        <motion.g style={{ originX: '100px', originY: '110px' }} animate={{ rotate: -360 }} transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}>
          <circle cx="100" cy="110" r="84" fill="none" stroke="#EF4444" strokeWidth="4" strokeDasharray="3 12" opacity="0.9" style={{ filter: 'drop-shadow(0 0 7px #EF4444)' }} />
        </motion.g>
      )}
      <g style={superMode ? { filter: 'hue-rotate(150deg) saturate(1.5) contrast(1.1)' } : undefined}>
        <BattleAura color={auraColor} gid={`aura-${uid}`} enraged={enraged} />
        <SpriteBoss bossIndex={bossIndex} animState={animState} enraged={enraged} uid={uid} />
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
    const id = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(id);
  }, []);
  const prevHpRef = useRef(null);
  const hitAtRef = useRef(0);
  // 直近の被ダメージをボスの上にポップさせるためのキュー
  const popsRef = useRef([]);
  const ghostRef = useRef({ ratio: 1, at: 0 });

  if (!raidState) {
    return (
      <div className="flex justify-center items-center p-3 shrink-0 w-full bg-[var(--panel)] border-b-2 border-[var(--text)] shadow-sm font-bold text-sm text-[var(--text)] opacity-60">
        ボスがあらわれる…
      </div>
    );
  }

  const {
    stage = 1, bossHp = 0, bossMaxHp: maxHp = 1, teamHp = 0, teamHpMax = 100, defeated = 0,
    telegraphAt = 0, lastAttack, lastEvent, cheerUntil = 0, enraged = false,
    shieldUntil = 0, bombEndsAt = 0, bombHits = 0, bombNeeded = 0,
  } = raidState;
  const { bossIndex, superMode, name } = bossForStage(stage);

  if (prevHpRef.current !== null && bossHp < prevHpRef.current) {
    hitAtRef.current = Date.now();
    popsRef.current = [...popsRef.current.filter(p => Date.now() - p.at < 900), { id: `${Date.now()}-${Math.round(bossHp)}`, at: Date.now(), amount: Math.round(prevHpRef.current - bossHp) }];
    ghostRef.current = { ratio: Math.max(0, prevHpRef.current / maxHp), at: Date.now() };
  }
  prevHpRef.current = bossHp;

  const defeatActive = lastEvent?.kind === 'boss_defeated' && now < lastEvent.at + RAID_CONSTANTS.DEFEAT_LOCK_MS;
  const attackActive = lastAttack && now < (lastAttack.at || 0) + 900;
  const hitActive = now < hitAtRef.current + 380;
  const animState = defeatActive ? 'defeat' : attackActive ? 'attack' : hitActive ? 'hit' : 'idle';
  const telegraphActive = !defeatActive && telegraphAt > 0 && now >= telegraphAt;
  const cheerActive = now < cheerUntil;
  const shieldActive = now < shieldUntil;
  const bombActive = bombEndsAt > now;
  const bossRatio = Math.max(0, bossHp / maxHp);
  const teamRatio = Math.max(0, teamHp / teamHpMax);
  const ghostRatio = now - ghostRef.current.at < 700 ? ghostRef.current.ratio : bossRatio;
  const pops = popsRef.current.filter(p => now - p.at < 900);

  return (
    <div className={`flex items-center gap-3 px-3 ${compact ? 'py-1' : 'py-2'} shrink-0 w-full bg-[var(--panel)] border-b-2 border-[var(--text)] shadow-sm relative overflow-hidden`}>
      {cheerActive && <motion.div className="absolute inset-0 bg-[var(--accent)] pointer-events-none" animate={{ opacity: [0.1, 0.35, 0.1] }} transition={{ duration: 0.8, repeat: Infinity }} />}
      {enraged && <motion.div className="absolute inset-0 bg-red-500 pointer-events-none" animate={{ opacity: [0.05, 0.2, 0.05] }} transition={{ duration: 0.7, repeat: Infinity }} />}

      {!compact && (
        <motion.div
          key={stage}
          animate={telegraphActive ? { x: [0, -3, 3, 0], scale: [1, 1.04, 1] } : {}}
          transition={{ duration: 0.28, repeat: telegraphActive ? Infinity : 0 }}
          className="shrink-0 relative"
        >
          <BossAvatar bossIndex={bossIndex} animState={animState} superMode={superMode} enraged={enraged} className="w-24 h-24 md:w-28 md:h-28" />

          {/* ためこみ(テレグラフ)の警告リング */}
          {telegraphActive && (
            <motion.span className="absolute inset-0 rounded-full border-[3px] border-red-500 pointer-events-none"
              animate={{ scale: [0.6, 1.15], opacity: [0.9, 0] }} transition={{ duration: 0.8, repeat: Infinity }} />
          )}
          {/* ボスのバリア */}
          <AnimatePresence>
            {shieldActive && (
              <motion.span className="absolute inset-0 rounded-full border-[3px] border-cyan-300 bg-cyan-300/20 pointer-events-none"
                initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: [0.55, 0.95, 0.55], scale: 1 }} exit={{ opacity: 0, scale: 1.3 }} transition={{ duration: 1, repeat: Infinity }} />
            )}
          </AnimatePresence>
          {/* 被ダメージのポップアップ */}
          <AnimatePresence>
            {pops.map(p => (
              <motion.span key={p.id} className="absolute left-1/2 top-2 -translate-x-1/2 font-black text-lg text-yellow-300 pointer-events-none z-10"
                style={{ WebkitTextStroke: '3px var(--text)', paintOrder: 'stroke' }}
                initial={{ opacity: 0, y: 10, scale: 0.6 }} animate={{ opacity: [1, 1, 0], y: -34, scale: 1.15 }} exit={{ opacity: 0 }} transition={{ duration: 0.9 }}>
                -{p.amount}
              </motion.span>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <div className="flex-grow min-w-0 relative">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-black text-sm md:text-base text-[var(--text)] truncate">{name}</span>
            <span className="shrink-0 text-[10px] font-black bg-[var(--primary)] text-white rounded-full px-2 py-0.5 border border-[var(--text)]">{stage}たいめ</span>
            {/* 狭い画面では文字を落としてアイコンだけにし、ボス名の表示幅を確保する */}
            {enraged && (
              <motion.span className="shrink-0 text-[10px] font-black bg-red-500 text-white rounded-full px-1.5 md:px-2 py-0.5 border border-[var(--text)] flex items-center gap-0.5"
                animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 0.6, repeat: Infinity }}>
                <Flame size={10} /><span className="hidden md:inline">げきおこ</span>
              </motion.span>
            )}
            {shieldActive && (
              <span className="shrink-0 text-[10px] font-black bg-cyan-400 text-[var(--text)] rounded-full px-1.5 md:px-2 py-0.5 border border-[var(--text)] flex items-center gap-0.5">
                <Shield size={10} /><span className="hidden md:inline">バリア</span>
              </span>
            )}
          </div>
          <span className="shrink-0 font-black text-xs text-[var(--text)] flex items-center gap-1"><Crown size={14} className="text-yellow-500" />×{defeated}</span>
        </div>

        {/* ボスHP(遅れて追いつく白いゴーストバーで被ダメージ量を見せる) */}
        <div className="flex items-center gap-1.5 mb-1">
          <Swords size={13} className="shrink-0 text-[var(--text)] opacity-60" />
          <motion.div className="flex-grow h-3.5 bg-gray-200 rounded-full overflow-hidden border-2 border-[var(--text)] relative"
            animate={hitActive ? { x: [0, -2, 2, 0] } : { x: 0 }} transition={{ duration: 0.25 }}>
            <motion.div className="absolute inset-0 h-full origin-left bg-white/80" animate={{ scaleX: ghostRatio }} transition={{ duration: 0.55, ease: 'easeOut' }} />
            <motion.div className="absolute inset-0 h-full origin-left" animate={{ scaleX: bossRatio, backgroundColor: enraged ? '#DC2626' : hpBarColor(bossRatio) }} transition={{ duration: 0.25 }} />
            {/* げきおこ突入ラインの目印 */}
            <span className="absolute top-0 bottom-0 w-[2px] bg-[var(--text)] opacity-40" style={{ left: `${RAID_CONSTANTS.ENRAGE_THRESHOLD * 100}%` }} />
          </motion.div>
          <span className="shrink-0 font-black text-[10px] text-[var(--text)] w-16 text-right tabular-nums">{Math.max(0, Math.ceil(bossHp))}/{maxHp}</span>
        </div>

        {/* チームHP */}
        <div className="flex items-center gap-1.5">
          <Heart size={13} className="shrink-0 text-pink-500" fill="currentColor" />
          <div className={`flex-grow h-3.5 bg-gray-200 rounded-full overflow-hidden border-2 ${teamRatio < 0.3 ? 'border-red-500' : 'border-[var(--text)]'}`}>
            <motion.div className={`h-full origin-left ${teamRatio < 0.3 ? 'bg-red-400' : 'bg-pink-400'}`} animate={{ scaleX: teamRatio }} transition={{ duration: 0.3 }} style={{ width: '100%' }} />
          </div>
          <span className="shrink-0 font-black text-[10px] text-[var(--text)] w-16 text-right tabular-nums">{Math.max(0, Math.ceil(teamHp))}/{teamHpMax}</span>
        </div>

        {/* 時限爆弾の進捗(チーム全員の正解数で解除) */}
        <AnimatePresence>
          {bombActive && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-1.5 mt-1 overflow-hidden">
              <motion.span animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 0.5, repeat: Infinity }}><Bomb size={13} className="shrink-0 text-red-500" /></motion.span>
              <motion.span className="shrink-0 font-black text-[11px] text-red-500"
                animate={{ opacity: [1, 0.55, 1] }} transition={{ duration: 0.6, repeat: Infinity }}>
                みんなであと{Math.max(0, bombNeeded - bombHits)}問！
              </motion.span>
              <div className="flex-grow h-2.5 bg-gray-200 rounded-full overflow-hidden border-2 border-red-500">
                <motion.div className="h-full origin-left bg-red-500" animate={{ scaleX: Math.min(1, bombHits / Math.max(1, bombNeeded)) }} transition={{ duration: 0.25 }} style={{ width: '100%' }} />
              </div>
              <span className="shrink-0 font-black text-[10px] text-red-500 tabular-nums">{Math.max(0, Math.ceil((bombEndsAt - now) / 1000))}s</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {telegraphActive && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: [1, 0.4, 1] }} exit={{ opacity: 0 }} transition={{ duration: 0.45, repeat: Infinity }}
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

// 問題エリアに重ねるデバフ演出(ink=ヘドロ / blackout=くらやみ / mirror=かがみ / curse=のろい)
export const ProblemDebuffOverlay = ({ debuffs }) => {
  const ink = debuffs.find(d => d.kind === 'ink');
  const blackout = debuffs.find(d => d.kind === 'blackout');
  const mirror = debuffs.find(d => d.kind === 'mirror');
  const curse = debuffs.find(d => d.kind === 'curse');
  return (
    <AnimatePresence>
      {ink && (
        <motion.div key={`ink-${ink.at}`} className="absolute inset-0 z-20 pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
          {[{ l: '12%', t: '8%', s: 110 }, { l: '42%', t: '30%', s: 150 }, { l: '68%', t: '5%', s: 120 }].map((b, i) => (
            <motion.svg key={i} viewBox="0 0 100 100" className="absolute" style={{ left: b.l, top: b.t, width: b.s, height: b.s }}
              initial={{ y: -60, scale: 0.4, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 0.94 }} transition={{ type: 'spring', bounce: 0.5, delay: i * 0.1 }}>
              <path d="M50 6 C 72 20, 88 42, 86 62 C 84 82, 68 92, 50 92 C 32 92, 16 82, 14 62 C 12 42, 28 20, 50 6 Z" fill="#5B21B6" stroke="#2E1065" strokeWidth="4" />
              <ellipse cx="36" cy="36" rx="9" ry="14" fill="#C4B5FD" opacity="0.45" transform="rotate(-20 36 36)" />
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
      {mirror && (
        <motion.div key={`mi-${mirror.at}`} className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-2xl"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }}>
          <motion.div className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/45 to-transparent -skew-x-12"
            animate={{ left: ['-20%', '110%'] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} />
          <span className="absolute top-1 left-1 bg-sky-400 text-[var(--text)] border-2 border-[var(--text)] rounded-full px-2 py-0.5 font-black text-[10px]">🪞 かがみ文字</span>
        </motion.div>
      )}
      {curse && (
        <motion.div key={`cu-${curse.at}`} className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }}>
          <motion.svg viewBox="0 0 100 100" className="absolute w-[70%] h-[70%] opacity-60"
            animate={{ rotate: -360 }} transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}>
            <circle cx="50" cy="50" r="44" fill="none" stroke="#A855F7" strokeWidth="2" strokeDasharray="9 6" />
            <circle cx="50" cy="50" r="34" fill="none" stroke="#D946EF" strokeWidth="1.5" strokeDasharray="2 8" />
            <polygon points="50,10 84,68 16,68" fill="none" stroke="#C084FC" strokeWidth="2" />
          </motion.svg>
          <motion.span className="absolute bottom-1 left-1 bg-purple-600 text-white border-2 border-[var(--text)] rounded-full px-2 py-0.5 font-black text-[10px]"
            animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 0.9, repeat: Infinity }}>💀 のろい ダメージ半分</motion.span>
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

// ==========================================
// 画面全体の演出
// ==========================================

// ボス攻撃・げきおこ・時限爆弾などに合わせて画面のふちを光らせる全画面レイヤー
export const RaidScreenFx = ({ raidState, debuffs = [] }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(id);
  }, []);
  if (!raidState) return null;
  const atk = raidState.lastAttack;
  const impact = atk && (atk.kind === 'hp' || atk.kind === 'drain') && now < (atk.at || 0) + 600;
  const enraged = !!raidState.enraged;
  const bomb = debuffs.find(d => d.kind === 'bomb');
  const cursed = debuffs.some(d => d.kind === 'curse');
  const teamRatio = Math.max(0, (raidState.teamHp || 0) / (raidState.teamHpMax || 100));

  return (
    <div className="fixed inset-0 z-[55] pointer-events-none overflow-hidden">
      {/* 被弾の赤フラッシュ(計算のじゃまにならないよう短く・薄めに) */}
      <AnimatePresence>
        {impact && (
          <motion.div key={`imp-${atk.at}`} className="absolute inset-0 bg-red-500"
            initial={{ opacity: 0.32 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }} />
        )}
      </AnimatePresence>
      {/* 攻撃名のカットイン(問題文と答えカードの間に出す) */}
      <AnimatePresence>
        {atk && now < (atk.at || 0) + 1100 && atk.label && (
          <motion.div key={`lbl-${atk.at}`} className="absolute left-0 right-0 top-[32%] flex justify-center"
            initial={{ opacity: 0, x: -40, skewX: -12 }} animate={{ opacity: 1, x: 0, skewX: -12 }} exit={{ opacity: 0, x: 40 }} transition={{ type: 'spring', bounce: 0.4 }}>
            <span className="bg-[var(--text)] text-[var(--panel)] font-black text-base md:text-2xl px-6 py-1.5 tracking-wider shadow-[4px_4px_0_rgba(0,0,0,0.35)]">
              {atk.label}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* げきおこ / ピンチ / のろい のふち光り(問題が読みにくくならないよう画面のふちだけ) */}
      {(enraged || teamRatio < 0.3 || cursed) && (
        <motion.div className="absolute inset-0"
          style={{ boxShadow: `inset 0 0 55px 8px ${cursed && !enraged ? 'rgba(168,85,247,0.5)' : 'rgba(239,68,68,0.5)'}` }}
          animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ duration: enraged ? 0.8 : 1.4, repeat: Infinity, ease: 'easeInOut' }} />
      )}
      {/* 時限爆弾ちゅうのふち点滅(残り問題数と秒数はボスパネル側に表示している) */}
      <AnimatePresence>
        {bomb && (
          <motion.div key={`bomb-${bomb.at}`} className="absolute inset-0" style={{ boxShadow: 'inset 0 0 55px 10px rgba(239,68,68,0.6)' }}
            initial={{ opacity: 0 }} animate={{ opacity: [0.25, 0.85, 0.25] }} exit={{ opacity: 0 }} transition={{ duration: 0.55, repeat: Infinity }} />
        )}
      </AnimatePresence>
    </div>
  );
};

// ボスの攻撃・撃破に合わせて画面をゆらす。GameView のルート要素に style として渡す。
// transform を常時掛けると position:fixed の子(ダイアログ等)の基準がズレるため、
// ゆれている間だけ CSS アニメーションを載せる方式にしている(index.css の @keyframes raidShake*)。
export const useRaidShake = (raidState, enabled = true) => {
  const [style, setStyle] = useState(undefined);
  const lastRef = useRef(0);
  const flipRef = useRef(false);
  const attackAt = raidState?.lastAttack?.at || 0;
  const eventAt = raidState?.lastEvent?.at || 0;
  const eventKind = raidState?.lastEvent?.kind;
  const strongEvent = eventKind === 'team_down' || eventKind === 'boss_enrage' || eventKind === 'bomb_blast' || eventKind === 'boss_defeated';
  const trigger = Math.max(attackAt, strongEvent ? eventAt : 0);
  const strong = strongEvent && eventAt >= attackAt;

  useEffect(() => {
    if (!enabled || !trigger || trigger === lastRef.current) return;
    lastRef.current = trigger;
    // 同じアニメーション名を再指定しても再生し直されないため、AとBを交互に使って必ず頭から流す
    flipRef.current = !flipRef.current;
    const base = strong ? 'raidShakeStrong' : 'raidShake';
    const dur = strong ? 620 : 440;
    setStyle({ animation: `${base}${flipRef.current ? 'A' : 'B'} ${dur}ms ease-out` });
    const id = setTimeout(() => setStyle(undefined), dur);
    return () => clearTimeout(id);
  }, [trigger, strong, enabled]);

  return style;
};

// 全画面イベント演出(撃破 / 新ボス登場 / たてなおし / おうえん / げきおこ / 爆弾)
export const RaidEventOverlay = ({ lastEvent }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lastEvent) return;
    const id = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(id);
  }, [lastEvent?.at]);

  const durations = { boss_defeated: RAID_CONSTANTS.DEFEAT_LOCK_MS, boss_enter: 2100, boss_enrage: 1900 };
  const show = lastEvent && now < lastEvent.at + (durations[lastEvent.kind] || 2000);
  const kind = lastEvent?.kind;

  const banner = (bg, content) => (
    <motion.div key={`${kind}-${lastEvent.at}`} className="fixed inset-x-0 top-1/4 z-[60] flex justify-center pointer-events-none px-4"
      initial={{ opacity: 0, scale: 0.6, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: 'spring', bounce: 0.5 }}>
      <div className={`${bg} border-[4px] border-[var(--text)] rounded-2xl px-6 py-3 font-black text-xl md:text-2xl shadow-[4px_4px_0_var(--text)] text-center`}>{content}</div>
    </motion.div>
  );

  // ボス登場: 暗転 + 斜めの帯 + ドット絵がせり上がるカットイン
  const intro = () => {
    const info = bossForStage(lastEvent.stage || 1);
    return (
      <motion.div key={`intro-${lastEvent.at}`} className="fixed inset-0 z-[70] flex flex-col items-center justify-center pointer-events-none overflow-hidden"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
        <motion.div className="absolute inset-0 bg-black" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.62, 0.62, 0] }} transition={{ duration: 2.0, times: [0, 0.15, 0.72, 1] }} />
        {/* 左右から走る斜めの帯 */}
        <motion.div className="absolute h-24 w-[160%] bg-[var(--primary)] -skew-y-6 opacity-90"
          initial={{ x: '-120%' }} animate={{ x: ['-120%', '0%', '0%', '120%'] }} transition={{ duration: 2.0, times: [0, 0.18, 0.75, 1], ease: 'easeOut' }} />
        <motion.div className="absolute z-10 flex flex-col items-center"
          initial={{ scale: 0.3, y: 90, opacity: 0 }} animate={{ scale: [0.3, 1.08, 1, 1, 0.9], y: [90, 0, 0, 0, -20], opacity: [0, 1, 1, 1, 0] }}
          transition={{ duration: 2.0, times: [0, 0.22, 0.4, 0.75, 1] }}>
          <BossAvatar bossIndex={info.bossIndex} superMode={info.superMode} className="w-44 h-44 md:w-60 md:h-60 drop-shadow-[0_0_25px_rgba(0,0,0,0.7)]" />
          <div className="mt-1 bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-2xl px-5 py-2 shadow-[4px_4px_0_var(--text)] text-center">
            <div className="font-black text-lg md:text-2xl text-[var(--text)]">{info.name}</div>
            <div className="font-black text-xs md:text-sm text-[var(--primary)]">があらわれた！</div>
          </div>
        </motion.div>
      </motion.div>
    );
  };

  // げきおこ: 赤い集中線と炎の帯
  const enrageCut = () => (
    <motion.div key={`rage-${lastEvent.at}`} className="fixed inset-0 z-[65] flex items-center justify-center pointer-events-none overflow-hidden"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-red-600" animate={{ opacity: [0.55, 0.15, 0.45, 0] }} transition={{ duration: 1.6 }} />
      {[...Array(14)].map((_, i) => (
        <motion.div key={i} className="absolute left-1/2 top-1/2 h-[2px] w-[70vmax] bg-yellow-200 origin-left"
          style={{ rotate: `${(360 / 14) * i}deg` }}
          initial={{ scaleX: 0, opacity: 0.9 }} animate={{ scaleX: 1, opacity: 0 }} transition={{ duration: 0.9, delay: i * 0.02 }} />
      ))}
      <motion.div className="relative bg-red-600 text-white border-[5px] border-[var(--text)] rounded-2xl px-7 py-3 font-black text-2xl md:text-4xl shadow-[5px_5px_0_var(--text)] flex items-center gap-2"
        initial={{ scale: 0.4, rotate: -8 }} animate={{ scale: [0.4, 1.15, 1], rotate: [-8, 3, -2] }} transition={{ duration: 0.6 }}>
        <Flame size={32} /> げきおこモード！
      </motion.div>
    </motion.div>
  );

  return (
    <AnimatePresence>
      {show && kind === 'boss_enter' && intro()}
      {show && kind === 'boss_enrage' && enrageCut()}
      {show && kind === 'boss_defeated' && banner('bg-[var(--accent)] text-[var(--text)]', <>👑 たおした！！</>)}
      {show && kind === 'team_down' && banner('bg-[var(--panel)] text-[var(--primary)]', <><span className="ruby-text">💥 たいせいを たてなおせ！</span></>)}
      {show && kind === 'support' && banner('bg-pink-100 text-pink-600', <>💝 {lastEvent.name} さんの おうえん！</>)}
      {show && kind === 'bomb_defused' && banner('bg-emerald-100 text-emerald-600', <>✅ バクダン かいじょ！</>)}
      {show && kind === 'bomb_blast' && banner('bg-red-100 text-red-600', <>💣 ばくはつした！</>)}
      {show && kind === 'boss_shield' && banner('bg-cyan-100 text-cyan-700', <>🛡 バリアを はった！</>)}
      {show && kind === 'boss_drain' && banner('bg-purple-100 text-purple-700', <>🩸 たいりょくを すいとられた！</>)}
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
