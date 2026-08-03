/* ボスバトルの「決まりごと」と計算（BossBattle.jsx から切りだした）
 *
 * ここには絵が1つも入っていない。ボスの強さ・攻撃の抽選・ダメージ計算といった、
 * ホストが正解として持つロジックだけを置く。
 *
 * 画面（ボスのドット絵・技のカットイン・結果発表）は ../BossBattle.jsx にあり、
 * そちらは「みんなであそぶ」を選ぶまで読みこまれない（Part I §5）。
 * こちらを分けてあるのは、GameView が useRaidDebuffs / useRaidShake を
 * 無条件に呼ぶため。フックは遅れて読みこむわけにいかない。
 */
import { useState, useEffect, useRef } from 'react';

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
// ★ この式の最大値は roomAccess.js の RAID_MAX_DAMAGE(=90) に写してある。
//   改造した端末が大きなダメージを送ってこないよう、リーダー側でそこまで丸めている。
//   式をいじって最大値が変わるときは、あちらも必ず直すこと(でないと正しい攻撃が丸められる)。
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

// import.meta.env はビルドしたときにだけ入る。
// このファイルは決まりごとの検証(scripts/battleLogic.test.mjs)から
// Node で直接読みこむので、無いときは '/' に落とす
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
const SPRITE_DIR = `${BASE}bosses/`;
export const bossSpriteUrl = (bossIndex) => SPRITE_DIR + (BOSSES[bossIndex] || BOSSES[0]).sprite;

// 初回表示のちらつきを避けるため、バトル開始時に4体ぶんを先読みする
export const preloadBossSprites = () => {
  if (typeof window === 'undefined') return;
  BOSSES.forEach(b => { const img = new window.Image(); img.src = SPRITE_DIR + b.sprite; });
};

// 画面ゆれ。GameView が無条件に呼ぶフックなので、画面側ではなくこちらに置く
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
