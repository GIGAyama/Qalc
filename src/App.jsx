import React, { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle, lazy, Suspense } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
// 外部CDNからの動的読み込みはやめ、すべてバンドルに同梱する。
// 理由: (1) CDNが改ざんされると児童端末で任意コードが動く (2) 校内フィルタでCDNが
// ブロックされると「エラーも出ないまま機能が動かない」 (3) CSPを 'self' で閉じられる
import {
  Calculator, Trash2, PenTool, Home, Rocket,
  Flame, Clock, Award, Settings, Plus, XCircle, Bot, Volume2,
  VolumeX, ArrowLeftRight, Share2, BarChart3, Trophy, User,
  Gamepad2, Swords, Timer, Download, HeartCrack, Coins,
  Store, CheckCircle2, PaintBucket, Shirt, Users, Radio,
  LayoutDashboard, Lightbulb
} from 'lucide-react';
// どの「かんがえるどうぐ」を出すかの判定は毎問ひつようなので、最初から読みこむ。
// どうぐの絵そのもの(SVGが多く約140KB)はゲーム画面に入ってから取りにいく（Part I §5）
import { getAvailableTools, TOOL_META } from './learningTools/detect.js';
const LearningToolPanel = lazy(() =>
  import('./LearningTools.jsx').then((m) => ({ default: m.LearningToolPanel })));
const preloadLearningTools = () => import('./LearningTools.jsx');
// 提示モード(電子黒板)・児童名の伏せ字・演出をへらす設定（Part I §2-10, §2-11）
import { PresentationControl, PupilName, usePresentation, prefersReducedMotion } from './presentation.jsx';
// PWA のインストール導線と、あたらしい版のお知らせ（Part I §3-2, §3-4）
import { InstallButton, UpdateNotice } from './pwa.jsx';
import { createStudySession, STUDY_ABORT_AWAY_MS } from './studySession.js';
import { loadStudyRecords, summarize, topMissedItems } from './studyStats.js';
// 「だれがへやに入れるか」「だれに何を配るか」は roomAccess.js に切りだしてテストしている
import {
  PROTOCOL_VERSION, PEER_OPTIONS, ACCEPT_WINDOW_MS,
  ROOM_ID_LEN, generateRoomId, isValidRoomId, formatRoomId,
  NAME_MAX, sanitizeName,
  parseMemberMessage, parseHostMessage,
  safeSend, sendToAll, sendToApproved,
} from './roomAccess.js';
import { BACK_PRIORITY, useBackHandler, useHistoryBackGuard, EdgeSwipeBack } from './BackNavigation.jsx';
import {
  RAID_CONSTANTS, bossForStage, bossMaxHp, calcRaidDamage, attackIntervalMs, pickBossAttack,
  makeShuffledLayout, useRaidDebuffs, raidInputLocked, raidDamageMods, raidProblemTransform,
  rollBurstCount, preloadBossSprites, useRaidShake,
  BossPanel, SupportButton, ProblemDebuffOverlay, FreezeOverlay, RaidEventOverlay, RaidScreenFx, RaidResultPanel,
  BossAvatar
} from './BossBattle.jsx';
import {
  TERRITORY_CONSTANTS, TEAMS, otherTeam, createTerritoryCells, isSelectable, autoPickTarget,
  computeScores, resolveCaptures, addCharge, applyBlast, specialCharges, rollSpecial, rollLucky, pickNearTarget, SPECIALS,
  TerritoryScoreBar, TerritoryBoard, TerritoryEventOverlay, TerritoryResultPanel,
  TerritorySpecialButton, TerritoryRushBadge, TerritoryLastSpurtFx,
  TerritoryCharacter, useTerritoryMood, preloadTerritoryCharacters, TERRITORY_CHARACTER_NAME
} from './TerritoryBattle.jsx';

// 問題データ・ショップ・ミッションの定義は src/data/ に切りだした。
// App.jsx が5,000行を超えて追いきれなくなっていたため（Part I §5）。
import {
  normalizeStr, getParsedDefaultProblems, courseCompare,
  DEFAULTS_VERSION, LEGACY_DEFAULT_KEYS,
} from './data/problems.js';
import {
  SHOP_ITEMS, RARITY_INFO, getRarity, GACHA_COST, GACHA_DUP_REFUND,
  getGachaPool, rollGacha,
} from './data/shop.js';
import { getRandomMissions } from './data/missions.js';

// ふりがなヘルパー: <R k="かん" g="じ" /> → <ruby>漢<rt>かん</rt></ruby><ruby>字<rt>じ</rt></ruby>
// 使い方: <R k="漢" r="かん" /> は1文字用。複数文字は直接rubyタグで書く。
const R = ({ c, r }) => <ruby>{c}<rt>{r}</rt></ruby>;

// ==========================================
// 1. サウンド & ハプティック(振動) エンジン
// ==========================================
class AudioController {
  constructor() { this.ctx = null; this.muted = true; this.bgmInterval = null; }
  init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); }
  toggle() { this.muted = !this.muted; if (!this.muted) { this.init(); this.playSE('click'); } else { this.stopBGM(); } return this.muted; }

  vibrate(pattern) {
    // 「動きを減らす」設定のときはふるえも止める。
    // 振動は視覚の演出ではないが、感覚過敏の児童にはこちらのほうが負担が大きいことがある
    if (prefersReducedMotion()) return;
    if (!this.muted && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  playSE(type, param = 0) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime; const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    switch (type) {
      case 'click':
        osc.type = 'square'; osc.frequency.setValueAtTime(600, t); gain.gain.setValueAtTime(0.05, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05); osc.start(t); osc.stop(t + 0.05);
        this.vibrate(10); break;
      case 'correct':
        osc.type = 'sine'; osc.frequency.setValueAtTime(880, t); osc.frequency.exponentialRampToValueAtTime(1760, t + 0.1); gain.gain.setValueAtTime(0.1, t); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3); osc.start(t); osc.stop(t + 0.3);
        this.vibrate([20, 50, 20]); break;
      case 'combo':
        osc.type = 'sine'; const freq = Math.min(880 + param * 55, 2000); osc.frequency.setValueAtTime(freq, t); gain.gain.setValueAtTime(0.1, t); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2); osc.start(t); osc.stop(t + 0.2); if (param >= 5) { const osc2 = this.ctx.createOscillator(); osc2.connect(gain); osc2.type = 'triangle'; osc2.frequency.setValueAtTime(freq * 1.5, t); osc2.start(t); osc2.stop(t + 0.2); }
        this.vibrate([30, 30, 40]); break;
      case 'wrong':
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, t); osc.frequency.linearRampToValueAtTime(100, t + 0.3); gain.gain.setValueAtTime(0.1, t); gain.gain.linearRampToValueAtTime(0.01, t + 0.3); osc.start(t); osc.stop(t + 0.3);
        this.vibrate([100, 50, 100]); break;
      case 'finish':
        osc.type = 'triangle'; osc.frequency.setValueAtTime(440, t); osc.frequency.setValueAtTime(554.37, t + 0.1); osc.frequency.setValueAtTime(659.25, t + 0.2); osc.frequency.setValueAtTime(880, t + 0.3); gain.gain.setValueAtTime(0.1, t); gain.gain.linearRampToValueAtTime(0.001, t + 1.0); osc.start(t); osc.stop(t + 1.0); break;
      case 'coin':
        osc.type = 'sine'; osc.frequency.setValueAtTime(1200, t); osc.frequency.setValueAtTime(1600, t + 0.1); gain.gain.setValueAtTime(0.1, t); gain.gain.linearRampToValueAtTime(0.01, t + 0.3); osc.start(t); osc.stop(t + 0.3); break;
      // --- ボスバトル用 ---
      case 'roar': // ボスの咆哮(登場・げきおこ)
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(90, t); osc.frequency.exponentialRampToValueAtTime(45, t + 0.8);
        gain.gain.setValueAtTime(0.14, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9); osc.start(t); osc.stop(t + 0.9);
        { const sub = this.ctx.createOscillator(); sub.connect(gain); sub.type = 'square'; sub.frequency.setValueAtTime(140, t); sub.frequency.exponentialRampToValueAtTime(60, t + 0.7); sub.start(t); sub.stop(t + 0.7); }
        this.vibrate([60, 40, 120]); break;
      case 'charge': // 攻撃をためている音(テレグラフ)
        osc.type = 'triangle'; osc.frequency.setValueAtTime(220, t); osc.frequency.exponentialRampToValueAtTime(880, t + 0.55);
        gain.gain.setValueAtTime(0.02, t); gain.gain.linearRampToValueAtTime(0.09, t + 0.5); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.start(t); osc.stop(t + 0.6); this.vibrate([15, 40, 15, 40, 15]); break;
      case 'boom': // ボスの攻撃が当たった音
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(320, t); osc.frequency.exponentialRampToValueAtTime(50, t + 0.35);
        gain.gain.setValueAtTime(0.16, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4); osc.start(t); osc.stop(t + 0.4);
        this.vibrate([120, 40, 80]); break;
      case 'guard': // バリア展開
        osc.type = 'sine'; osc.frequency.setValueAtTime(660, t); osc.frequency.linearRampToValueAtTime(990, t + 0.25);
        gain.gain.setValueAtTime(0.08, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35); osc.start(t); osc.stop(t + 0.35); break;
      // --- じんとりバトル用 ---
      case 'splat': // インクがマスにはじける音
        osc.type = 'triangle'; osc.frequency.setValueAtTime(520, t); osc.frequency.exponentialRampToValueAtTime(160, t + 0.18);
        gain.gain.setValueAtTime(0.11, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22); osc.start(t); osc.stop(t + 0.22);
        { const n = this.ctx.createOscillator(); n.connect(gain); n.type = 'square'; n.frequency.setValueAtTime(1100, t); n.frequency.exponentialRampToValueAtTime(300, t + 0.12); n.start(t); n.stop(t + 0.12); }
        this.vibrate([25, 20, 35]); break;
      case 'special': // スペシャル発動
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(180, t); osc.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
        gain.gain.setValueAtTime(0.05, t); gain.gain.linearRampToValueAtTime(0.16, t + 0.4); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        osc.start(t); osc.stop(t + 0.8);
        { const s2 = this.ctx.createOscillator(); s2.connect(gain); s2.type = 'square'; s2.frequency.setValueAtTime(440, t + 0.4); s2.frequency.setValueAtTime(660, t + 0.55); s2.frequency.setValueAtTime(880, t + 0.68); s2.start(t + 0.4); s2.stop(t + 0.8); }
        this.vibrate([40, 30, 40, 30, 140]); break;
      case 'lucky': // ラッキーマス
        osc.type = 'sine'; [880, 1174, 1568, 2093].forEach((f, i) => osc.frequency.setValueAtTime(f, t + i * 0.07));
        gain.gain.setValueAtTime(0.1, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45); osc.start(t); osc.stop(t + 0.45);
        this.vibrate([20, 30, 20, 30, 60]); break;
      case 'tick': // 終了まえのカウントダウン
        osc.type = 'square'; osc.frequency.setValueAtTime(param > 0 ? 1320 : 880, t);
        gain.gain.setValueAtTime(0.09, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14); osc.start(t); osc.stop(t + 0.14);
        this.vibrate(30); break;
    }
  }
  playBGM(type) {
    if (this.muted) return; this.stopBGM(); this.init(); let step = 0;
    const notes = type === 'game' ? [261.63, 329.63, 392.00, 523.25] : [220, 277.18, 329.63, 440];
    this.bgmInterval = setInterval(() => {
      if (this.muted || !this.ctx) return; const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain(); osc.connect(gain); gain.connect(this.ctx.destination);
      osc.type = 'square'; osc.frequency.value = notes[step % notes.length] / 2;
      gain.gain.setValueAtTime(0.015, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15); osc.start(t); osc.stop(t + 0.15); step++;
    }, 250);
  }
  stopBGM() { if (this.bgmInterval) { clearInterval(this.bgmInterval); this.bgmInterval = null; } }
}
const audioCtrl = new AudioController();

// ==========================================
// 2. データ構造 & Storage API
// ==========================================

// ==========================================
// マスター判定 & 報酬減衰（コイン・EXP稼ぎ目的の周回対策）
// 方針: プレイ自体は制限しない（復習は自由）。ただし
//  1) 高正答率・高速で安定してクリアできる＝「マスター済み」コースを楽々クリアしたとき
//  2) 同じコースを同じ日に何度も繰り返したとき（難易度によらず。自作コース悪用対策も兼ねる）
// はEXP・コイン・ミッション進捗が減衰し、代わりに「つぎのドリルへ挑戦しよう」と促す。
const DECAY = {
  REPEAT_SCHEDULE: [1, 1, 0.5, 0.25], // その日すでに遊んだ回数 → 倍率（3回目から半減）
  REPEAT_FLOOR: 0.1,                  // 5回目以降の倍率
  MASTERED_MULT: 0.2,                 // マスター済みコースを楽々クリアしたときの倍率
  FLOOR: 0.05,                        // 合成倍率の下限（ゼロにはしない）
  MASTER_MIN_CORRECT: 10,             // マスター判定に必要な1セッションの正解数
  MASTER_MIN_ACC: 0.95,               // マスター判定に必要な正答率
  MASTER_MAX_SPQ: 5,                  // マスター判定: 1問あたりの秒数上限（指折り計算では届かない速さ）
  MASTER_STREAK: 3,                   // 連続何セッション条件を満たせばマスターか
  DEMOTE_ACC: 0.8,                    // マスター済みでもこれを下回ったら「忘れていた」として解除
  EASY_ACC: 0.9,                      // マスター減衰が発動する正答率（苦戦した復習は減衰しない）
  MIN_ATTEMPTS_FOR_REPEAT: 5          // これ未満の回答数のセッションは周回カウントに入れない（誤タップ即終了の救済）
};

// セッションの正答率。サドンデスは終了のきっかけになった1ミスを除外して評価する
const sessionAccuracy = (session) => {
  const wrongAdj = session.gameMode === 'SUDDEN_DEATH' ? Math.max(0, session.wrongCount - 1) : session.wrongCount;
  const attempts = session.correctCount + wrongAdj;
  return { attempts, acc: attempts > 0 ? session.correctCount / attempts : 0 };
};

// にがて克服ボックス('mistakes')は常に減衰対象外（まちがい直しはいつでも全額）
const realCoursesOf = (courseNames) => (courseNames || []).filter(n => n !== 'mistakes');

const isCourseMastered = (stats, name) => !!(stats.courseStats && stats.courseStats[name] && stats.courseStats[name].mastered);

// 減衰倍率を計算する（stats は変更しない。今セッションを記録する「前」の値で呼ぶこと）
const computeRewardDecay = (stats, courseNames, session) => {
  const real = realCoursesOf(courseNames);
  if (real.length === 0) return { mult: 1, masteredApplied: false, repeatPlays: 0, repeatMult: 1 };
  const today = new Date().toLocaleDateString();
  const counts = (stats.repeat && stats.repeat.date === today) ? stats.repeat.counts : {};
  // 複数ドリル選択時は「いちばん周回されているコース」に合わせる（稼ぎコースに新規1つ混ぜる抜け道の防止）
  const repeatPlays = Math.max(...real.map(n => counts[n] || 0));
  const repeatMult = repeatPlays < DECAY.REPEAT_SCHEDULE.length ? DECAY.REPEAT_SCHEDULE[repeatPlays] : DECAY.REPEAT_FLOOR;
  const { acc } = sessionAccuracy(session);
  // マスター減衰は「選んだ全コースがマスター済み」かつ「今回も楽々だった」ときだけ。苦戦したなら復習が必要だった証拠なので全額
  const masteredApplied = real.every(n => isCourseMastered(stats, n)) && acc >= DECAY.EASY_ACC;
  const mult = Math.max(DECAY.FLOOR, repeatMult * (masteredApplied ? DECAY.MASTERED_MULT : 1));
  return { mult, masteredApplied, repeatPlays, repeatMult };
};

// 今セッションを周回カウント・マスター判定に記録する（stats を直接変更する）
// 戻り値: { newlyMastered: 新しくマスターになったコース名 | null }
const recordCourseSession = (stats, courseNames, session) => {
  const real = realCoursesOf(courseNames);
  if (real.length === 0) return { newlyMastered: null };
  const today = new Date().toLocaleDateString();
  if (!stats.repeat || stats.repeat.date !== today) stats.repeat = { date: today, counts: {} };
  const { attempts, acc } = sessionAccuracy(session);
  if (attempts >= DECAY.MIN_ATTEMPTS_FOR_REPEAT) {
    real.forEach(n => { stats.repeat.counts[n] = (stats.repeat.counts[n] || 0) + 1; });
  }
  if (!stats.courseStats) stats.courseStats = {};
  let newlyMastered = null;
  // 複数ドリル混合ではコース別の正答率が分からないため、単一コースのセッションだけを判定の証拠にする
  if (real.length === 1) {
    const name = real[0];
    const cs = stats.courseStats[name] || (stats.courseStats[name] = { plays: 0, streak: 0, mastered: false });
    cs.plays += 1;
    const spq = session.correctCount > 0 ? session.elapsedSec / session.correctCount : Infinity;
    const qualifies = session.correctCount >= DECAY.MASTER_MIN_CORRECT && acc >= DECAY.MASTER_MIN_ACC && spq <= DECAY.MASTER_MAX_SPQ;
    if (qualifies) {
      cs.streak += 1;
      if (!cs.mastered && cs.streak >= DECAY.MASTER_STREAK) { cs.mastered = true; cs.masteredAt = today; newlyMastered = name; }
    } else {
      cs.streak = 0;
      // 久しぶりに遊んで正答率が落ちていたらマスター解除（忘れていた復習は全額で報いる）
      if (cs.mastered && attempts >= DECAY.MIN_ATTEMPTS_FOR_REPEAT && acc < DECAY.DEMOTE_ACC) cs.mastered = false;
    }
  }
  return { newlyMastered };
};

const StorageAPI = {
  safeGet: (key, fallback = null) => { try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
  safeSet: (key, val) => { try { window.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { console.warn("Quota exceeded"); return false; } },

  getStats: () => {
    let stats = StorageAPI.safeGet('qalc_stats');
    if (!stats || !stats.inventory) {
      stats = {
        totalExp: parseInt(window.localStorage.getItem('qalc_exp') || '0', 10),
        streak: parseInt(window.localStorage.getItem('qalc_streak') || '0', 10),
        lastDate: window.localStorage.getItem('qalc_last_date') || '',
        maxComboRecord: 0, suddenDeathRecord: 0, timeAttackRecord: 0, bossRaidRecord: 0,
        coins: 100, inventory: { bases: ['b_dog'], hats: [], faces: [], props: [], themes: ['default'] },
        equipped: { base: 'b_dog', hat: null, face: null, prop: null }, theme: 'default', missions: null, daily: {}
      };
    }
    // カテゴリ追加時のマイグレーション: 旧データに新カテゴリのキーを補う
    stats.inventory = { bases: ['b_dog'], hats: [], faces: [], props: [], themes: ['default'], backgrounds: [], effects: [], titles: [], ...stats.inventory };
    stats.equipped = { base: 'b_dog', hat: null, face: null, prop: null, background: null, effect: null, title: null, ...stats.equipped };
    const todayStr = new Date().toLocaleDateString();
    if (!stats.missions || stats.missions.date !== todayStr) {
      stats.missions = {
        date: todayStr,
        list: getRandomMissions(3, stats.streak || 0)
      };
    }
    // マスター判定・周回カウントのマイグレーション（周回カウントは日替わりでリセット）
    if (!stats.courseStats) stats.courseStats = {};
    if (!stats.repeat || stats.repeat.date !== todayStr) stats.repeat = { date: todayStr, counts: {} };
    StorageAPI.safeSet('qalc_stats', stats);
    return stats;
  },
  saveStats: (stats) => StorageAPI.safeSet('qalc_stats', stats),

  // missionPlayCredit: 減衰の強いセッションはミッションの「あそぶ系」進捗に数えない（省略時は playCount と同じ）
  updateDailyAndMissions: (stats, exp, combo, playCount, gameMode, correctCount, missionPlayCredit = playCount) => {
    const today = new Date().toLocaleDateString();
    if (!stats.daily) stats.daily = {};
    if (!stats.daily[today]) stats.daily[today] = { exp: 0, count: 0 };
    stats.daily[today].exp += exp;
    stats.daily[today].count += playCount;
    stats.totalExp = (stats.totalExp || 0) + exp;

    if (stats.lastDate !== today) {
      if (stats.lastDate) {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        if (stats.lastDate === yesterday.toLocaleDateString()) stats.streak += 1; else stats.streak = 1;
      } else stats.streak = 1;
      stats.lastDate = today;
    }

    if (stats.missions && stats.missions.date === today) {
      stats.missions.list.forEach(m => {
        if (m.type === 'play' && !m.claimed) m.current += missionPlayCredit;
        if (m.type === 'combo' && !m.claimed && combo > m.current) m.current = combo;
        if (m.type === 'score' && !m.claimed && exp > m.current) m.current = exp;

        if (m.type === 'play_score_attack' && gameMode === 'SCORE_ATTACK' && !m.claimed) m.current += missionPlayCredit;
        if (m.type === 'play_time_attack' && gameMode === 'TIME_ATTACK' && !m.claimed) m.current += missionPlayCredit;
        if (m.type === 'play_sudden_death' && gameMode === 'SUDDEN_DEATH' && !m.claimed) m.current += missionPlayCredit;
        if (m.type === 'sudden_death_correct' && gameMode === 'SUDDEN_DEATH' && !m.claimed && correctCount > m.current) m.current = correctCount;
        if (m.type === 'play_boss_raid' && gameMode === 'BOSS_RAID' && !m.claimed) m.current += missionPlayCredit;
        if (m.type === 'play_territory' && gameMode === 'TERRITORY' && !m.claimed) m.current += missionPlayCredit;
      });
    }
    return stats;
  },

  getMistakes: () => StorageAPI.safeGet('qalc_mistakes', []),
  addMistakes: (newMistakes) => {
    if (newMistakes.length === 0) return;
    let mistakes = StorageAPI.getMistakes(); mistakes = [...newMistakes, ...mistakes];
    const unique = Array.from(new Map(mistakes.map(m => [m.q, m])).values()).slice(0, 50);
    StorageAPI.safeSet('qalc_mistakes', unique);
  },
  removeMistakes: (correctQs) => {
    let mistakes = StorageAPI.getMistakes(); const correctSet = new Set(correctQs.map(q => q.q));
    StorageAPI.safeSet('qalc_mistakes', mistakes.filter(m => !correctSet.has(m.q)));
  },

  getRawData: () => {
    let data = StorageAPI.safeGet('qalc_problems', {});
    const parsedDefaults = getParsedDefaultProblems();
    let isUpdated = false;
    // 既定コースの改名・内容更新のマイグレーション（自作コースはそのまま残す）
    if (StorageAPI.safeGet('qalc_defaults_version', 1) < DEFAULTS_VERSION) {
      LEGACY_DEFAULT_KEYS.forEach(key => { if (data[key]) delete data[key]; });
      for (const key of Object.keys(parsedDefaults)) data[key] = parsedDefaults[key];
      StorageAPI.safeSet('qalc_defaults_version', DEFAULTS_VERSION);
      isUpdated = true;
    }
    for (const key of Object.keys(parsedDefaults)) { if (!data[key]) { data[key] = parsedDefaults[key]; isUpdated = true; } }
    if (isUpdated || Object.keys(data).length === 0) StorageAPI.safeSet('qalc_problems', data);
    return Object.keys(data).length > 0 ? data : parsedDefaults;
  },
  getProblemGroups: () => {
    const data = StorageAPI.getRawData();
    return Object.keys(data).sort(courseCompare).map(key => ({ name: key, count: data[key].length }));
  },
  getProblemsByGroup: (name) => StorageAPI.getRawData()[name] || [],
  saveProblemSet: (name, problems) => { const data = StorageAPI.getRawData(); data[name] = problems; return StorageAPI.safeSet('qalc_problems', data); },
  deleteProblemGroup: (name) => { const data = StorageAPI.getRawData(); delete data[name]; return StorageAPI.safeSet('qalc_problems', data); },
  encodeCourse: (name, problems) => btoa(encodeURIComponent(JSON.stringify({ n: name, p: problems.map(p => `${p.q},${p.a}`).join(';') }))),
  decodeCourse: (code) => { try { const data = JSON.parse(decodeURIComponent(atob(code))); return { name: data.n, problems: data.p.split(';').map(str => { const [q, a] = str.split(','); return { q, a }; }) }; } catch (e) { return null; } },

  getResume: () => StorageAPI.safeGet('qalc_resume', null),
  saveResume: (data) => StorageAPI.safeSet('qalc_resume', data),
  clearResume: () => { try { window.localStorage.removeItem('qalc_resume'); } catch (e) { /* ignore */ } }
};

// ==========================================
// 3. 共通 UIコンポーネント & フック
// ==========================================
const toastEvent = new EventTarget();
const showToast = (icon, title) => { toastEvent.dispatchEvent(new CustomEvent('show', { detail: { icon, title } })); };
// 紙ふぶきは「動きを減らす」設定のときは出さない。
// 感覚過敏の児童には、画面いっぱいに散る粒がいちばんつらい演出になる（Part I §2-10）
//
// canvas-confetti(約24KB)は最初の1画面には要らないので、別ファイルに分けて
// あとから取りにいく。ただし「正解したしゅんかんに出ない」と気が抜けるので、
// ゲームに入るときに preloadConfetti() で先に温めておく（Part I §5）
let confettiFn = null;
export const preloadConfetti = () => {
  if (confettiFn) return;
  import('canvas-confetti').then((m) => { confettiFn = m.default; }).catch(() => {});
};
const triggerConfetti = (options) => {
  if (prefersReducedMotion()) return;
  if (confettiFn) {
    try { confettiFn(options); } catch (e) { /* 演出なので失敗しても進める */ }
    return;
  }
  import('canvas-confetti')
    .then((m) => { confettiFn = m.default; confettiFn(options); })
    .catch(() => { /* 取れなくても正解の判定には関係ない */ });
};

const CustomToast = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleShow = (e) => {
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev, { id, ...e.detail }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
    };
    toastEvent.addEventListener('show', handleShow);
    return () => toastEvent.removeEventListener('show', handleShow);
  }, []);

  // 保存できた・つながらない などのお知らせを読み上げてもらう。
  // 割りこまずに読ませたいので polite（Part I §4）
  return (
    <div role="status" aria-live="polite" className="fixed top-20 right-4 z-[9999] flex flex-col gap-2 pointer-events-none w-[90%] max-w-xs">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, x: 50 }}
            className={`bg-[var(--panel)] border-[3px] ${t.icon === 'error' || t.icon === 'warning' ? 'border-[var(--primary)]' : 'border-[var(--secondary)]'} text-[var(--text)] px-4 py-3 rounded-2xl shadow-[4px_4px_0_rgba(0,0,0,0.15)] flex items-center gap-3 font-black text-sm`}
          >
            {t.icon === 'success' && <CheckCircle2 className="text-[var(--secondary-d)] shrink-0" size={24} />}
            {(t.icon === 'error' || t.icon === 'warning') && <HeartCrack className="text-[var(--primary-d)] shrink-0" size={24} />}
            <span className="leading-tight break-words flex-grow">{t.title}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

const getLevelInfo = (exp) => {
  const level = Math.floor(Math.cbrt(exp / 200)) + 1; const currentLevelExp = 200 * Math.pow(level - 1, 3); const nextLevelExp = 200 * Math.pow(level, 3);
  const progress = ((exp - currentLevelExp) / (nextLevelExp - currentLevelExp)) * 100;
  const rank = [
    { min: 100, text: "計算神", badge: "🌌", color: "#9333ea" }, { min: 50, text: "計算マスター", badge: "👑", color: "#ca8a04" },
    { min: 30, text: "達人", badge: "💎", color: "#06b6d4" }, { min: 20, text: "上級", badge: "🥇", color: "#eab308" },
    { min: 10, text: "中級", badge: "🥈", color: "#6b7280" }, { min: 5, text: "初級", badge: "🥉", color: "#f97316" }, { min: 0, text: "かけだし", badge: "🌱", color: "#4ade80" }
  ].find(r => level >= r.min);
  return { level, title: rank.text, badge: rank.badge, color: rank.color, progress, nextLevelExp };
};

const LayeredAvatar = React.memo(({ equipped, size = "text-5xl", className = "" }) => {
  const getChar = (category, id) => { if (!id) return null; const item = SHOP_ITEMS[category].find(i => i.id === id); return item ? item.char : null; };
  const fx = getChar('effects', equipped.effect);
  return (
    <div className={`relative flex items-center justify-center aspect-square ${size} ${className}`}>
      {equipped.background && <span className="absolute z-0 text-[1.5em] opacity-70 select-none">{getChar('backgrounds', equipped.background)}</span>}
      <span className="absolute z-10 drop-shadow-sm">{getChar('bases', equipped.base) || '🐶'}</span>
      {equipped.face && <span className="absolute z-20 text-[0.8em] top-[15%] drop-shadow-sm">{getChar('faces', equipped.face)}</span>}
      {equipped.hat && <span className="absolute z-30 text-[0.8em] -top-[25%] -rotate-12 drop-shadow-sm">{getChar('hats', equipped.hat)}</span>}
      {equipped.prop && <span className="absolute z-40 text-[0.7em] -bottom-[10%] -right-[10%] rotate-12 drop-shadow-sm">{getChar('props', equipped.prop)}</span>}
      {fx && <>
        <span className="absolute z-50 text-[0.45em] -top-[5%] -left-[5%] avatar-fx select-none">{fx}</span>
        <span className="absolute z-50 text-[0.35em] top-[30%] -right-[8%] avatar-fx-delay select-none">{fx}</span>
        <span className="absolute z-50 text-[0.3em] -bottom-[2%] left-[5%] avatar-fx-delay2 select-none">{fx}</span>
      </>}
    </div>
  );
});

const PageWrapper = ({ children, keyName }) => (
  <motion.div key={keyName} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.25, ease: "easeOut" }} className="absolute inset-0 flex flex-col overflow-y-auto overflow-x-hidden p-4 no-scrollbar">
    <div className="m-auto w-full max-w-lg md:max-w-xl">{children}</div>
  </motion.div>
);

const MotionButton = ({ children, onClick, className, ...props }) => (
  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95, y: 2, boxShadow: "none" }} onClick={() => { audioCtrl.playSE('click'); if (onClick) onClick(); }} className={`rounded-[20px] font-bold shadow-[0_4px_0_rgba(0,0,0,0.2)] border-none outline-none flex items-center justify-center gap-2 select-none touch-manipulation ${className}`} {...props}>
    {children}
  </motion.button>
);

const MathText = React.memo(({ text }) => {
  if (!text) return null;
  return (
    <span className="flex items-center justify-center flex-wrap">
      {text.split(/(\d+\/\d+)/g).map((part, index) => {
        const match = part.match(/(\d+)\/(\d+)/);
        if (match) return (
          <span key={index} className="inline-flex flex-col align-middle text-center text-[0.7em] mx-1 -mt-2">
            <span className="border-b-[3px] border-current px-1 leading-[1.1]">{match[1]}</span>
            <span className="px-1 leading-[1.1]">{match[2]}</span>
          </span>
        );
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
});

// 手書きキャンバス（描画はネイティブイベントで完結するため React.memo で親の再レンダーから完全に隔離する）
// 画面上の大きさ(CSS px)と、実際に描くピクセル数を分ける（Part I §2-5）。
// これをやらないと Chromebook や iPad の高DPI機で、手書きの線と数字がぼやける。
//
// dpr を 2 で頭打ちにするのは、3倍端末で 9倍の面積を持つと、メモリ4GBの Chromebook が
// タブごと落ちるため。2 あれば肉眼では十分にきれいに見える。
const canvasDpr = () => Math.min(window.devicePixelRatio || 1, 2);

const HandWritingCanvas = React.memo(forwardRef((props, ref) => {
  const canvasRef = useRef(null); const isDrawing = useRef(false); const lastPos = useRef({ x: 0, y: 0 }); const rectRef = useRef({ left: 0, top: 0 });
  // 紙を塗るときに使う「CSS px での大きさ」。バッファは dpr 倍あるので cvs.width とは一致しない
  const cssSize = useRef({ w: 0, h: 0 });

  // desynchronized + alpha:false: 透明合成(アルファブレンド)を排除し、通常の合成パイプラインを
  // 介さない低遅延描画パスを最大限有効化する（低スペック機での描画/入力遅延を大幅に削減）
  const getCtx = (cvs) => cvs.getContext('2d', { desynchronized: true, alpha: false });
  const resolveVar = (cvs, name, fallback) => getComputedStyle(cvs).getPropertyValue(name).trim() || fallback;
  // ctx には dpr の拡大が入っているので、塗る範囲も CSS px で指定する
  const fillPaper = (cvs, ctx) => {
    ctx.fillStyle = resolveVar(cvs, '--panel', '#ffffff');
    const { w, h } = cssSize.current;
    ctx.fillRect(0, 0, w || cvs.width, h || cvs.height);
  };

  useImperativeHandle(ref, () => ({
    clear: () => { const cvs = canvasRef.current; if (cvs) fillPaper(cvs, getCtx(cvs)); }
  }));

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = getCtx(cvs);
    fillPaper(cvs, ctx); // 不透明キャンバスの初期表示が黒くならないよう紙色で塗る

    // Canvas 2D はCSS変数を解釈できないため --text を実際の色に解決して適用する
    const applyStyle = () => {
      ctx.strokeStyle = resolveVar(cvs, '--text', '#333333'); ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    };

    // バッファ上限: 万一レイアウトが暴走してもバッファの巨大化（メガピクセル級の再確保・コピー）で
    // 端末が固まらないようにする保険。通常の画面サイズではこの上限に届かない。
    // dpr 倍したあとの実ピクセル数に対しての上限なので、CSS px 側は上限 / dpr になる。
    const MAX_DIM = 4096;
    const doResize = () => {
      if (!canvasRef.current || !canvasRef.current.parentElement) return;
      const currentCvs = canvasRef.current;
      const parent = currentCvs.parentElement;
      const dpr = canvasDpr();
      // clientWidth/Height はボーダーを除いた整数値。canvas は absolute 配置でフロー外のため、
      // ここでバッファを変えてもレイアウトに影響せず ResizeObserver が再発火しない
      const cssW = Math.min(parent.clientWidth, Math.floor(MAX_DIM / dpr));
      const cssH = Math.min(parent.clientHeight, Math.floor(MAX_DIM / dpr));
      if (cssW === 0 || cssH === 0) return;
      // バッファは CSS 上の大きさの dpr 倍。ここが「ぼやけない」ための本体
      const newW = Math.round(cssW * dpr); const newH = Math.round(cssH * dpr);
      if (Math.abs(currentCvs.width - newW) > 1 || Math.abs(currentCvs.height - newH) > 1) {
        // 書きかけの線を退避する。tempCanvas はバッファ実寸で持ち、
        // 戻すときは CSS px に縮めて描く（ctx に dpr の拡大が入っているため）
        const prev = cssSize.current;
        const tempCanvas = document.createElement('canvas'); tempCanvas.width = currentCvs.width || newW; tempCanvas.height = currentCvs.height || newH;
        if (currentCvs.width > 0 && currentCvs.height > 0) tempCanvas.getContext('2d').drawImage(currentCvs, 0, 0);
        currentCvs.width = newW; currentCvs.height = newH;
        cssSize.current = { w: cssW, h: cssH };
        // width/height への代入でコンテキストの状態は初期化されるため、毎回かけ直す。
        // これ以降、描画コードは今までどおり CSS px の座標のまま書ける
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        fillPaper(currentCvs, ctx); applyStyle();
        ctx.drawImage(tempCanvas, 0, 0, prev.w || cssW, prev.h || cssH);
      }
    };
    // 開閉時の300msトランジション中は毎フレーム ResizeObserver が発火するため、
    // サイズが落ち着いてから1回だけバッファを再確保する（低スペック機での連続再確保を防ぐ）
    let resizeTimer = null;
    const resize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { resizeTimer = null; window.requestAnimationFrame(doResize); }, 120);
    };
    const observer = new ResizeObserver(resize); observer.observe(cvs.parentElement);

    // 電子黒板や外部ディスプレイにつなぎかえると devicePixelRatio が変わる。
    // 画面の大きさは変わらないことがあるので ResizeObserver では気づけない。
    // dpr そのものを監視して、変わったらバッファを取り直す（Part I §2-5）
    let dprMql = null;
    const onDprChange = () => { watchDpr(); resize(); };
    const watchDpr = () => {
      if (!window.matchMedia) return;
      dprMql?.removeEventListener?.('change', onDprChange);
      dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprMql.addEventListener?.('change', onDprChange);
    };
    watchDpr();

    const startDraw = (e) => {
      e.preventDefault();
      const rect = cvs.getBoundingClientRect(); rectRef.current = { left: rect.left, top: rect.top };
      applyStyle(); isDrawing.current = true;
      lastPos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.pointerId != null) { try { cvs.setPointerCapture(e.pointerId); } catch {} }
    };
    const draw = (e) => {
      if (!isDrawing.current) return; e.preventDefault();
      const { left, top } = rectRef.current;
      const points = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y);
      for (const ev of points) { const x = ev.clientX - left; const y = ev.clientY - top; ctx.lineTo(x, y); lastPos.current = { x, y }; }
      ctx.stroke();
    };
    const stopDraw = () => { isDrawing.current = false; };

    cvs.addEventListener('pointerdown', startDraw); cvs.addEventListener('pointermove', draw); cvs.addEventListener('pointerup', stopDraw); cvs.addEventListener('pointercancel', stopDraw);

    return () => {
      observer.disconnect();
      dprMql?.removeEventListener?.('change', onDprChange);
      if (resizeTimer) clearTimeout(resizeTimer);
      cvs.removeEventListener('pointerdown', startDraw); cvs.removeEventListener('pointermove', draw); cvs.removeEventListener('pointerup', stopDraw); cvs.removeEventListener('pointercancel', stopDraw);
    };
  }, []);

  return (
    // 軽さ最優先: ドット背景・内側影・太い角丸枠などの塗りコストを排除。canvas は不透明な素の矩形で、
    // 低スペック機(ソフトウェア合成含む)でも描画コストが最小になるようにする。
    // canvas は必ず absolute でフロー外に置く: 通常フローに置くとバッファサイズ(=固有サイズ)が
    // flex の min-content 計算に入り、「バッファ拡大→親が成長→ResizeObserver→さらに拡大」の
    // 無限ループでバッファが数万pxまで膨張し、操作不能なほど重くなる。
    <div className="w-full h-full relative overflow-hidden border-2 border-[var(--text)] bg-[var(--panel)]">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none" />
      <button className="absolute top-3 right-3 w-11 h-11 bg-[var(--panel)] border-2 border-[var(--text)] rounded-full flex items-center justify-center text-red-500 z-20 active:scale-90 transition-transform" onClick={() => { audioCtrl.playSE('click'); ref.current?.clear(); }}><Trash2 size={24} /></button>
    </div>
  );
}));

// 数字キーパッド（answer/score/timer の更新で再レンダーしないよう memo 化し、安定したコールバックのみ受け取る）
// digitLayout: ボスバトルのシャッフルデバフ用。省略時は通常配列
const DEFAULT_DIGIT_LAYOUT = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'];
const Keypad = React.memo(({ onAppend, onClear, onSubmit, digitLayout = DEFAULT_DIGIT_LAYOUT }) => (
  <div className="flex-grow flex flex-col gap-2 z-30 min-h-[30vh]">
    <div className="flex h-14 gap-2 shrink-0">
      {['.', '/', '-', '(', ')'].map(c => <motion.button whileTap={{ scale: 0.9, y: 2, boxShadow: "none" }} key={c} className="flex-1 bg-[var(--panel)] text-[var(--secondary-d)] border-2 border-[var(--secondary)] rounded-xl font-black text-xl shadow-[0_2px_0_var(--secondary)] flex items-center justify-center select-none outline-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onAppend(c); }}>{c}</motion.button>)}
    </div>
    <div className="grid grid-cols-3 gap-2 flex-grow">
      {digitLayout.slice(0, 9).map(n => <motion.button whileTap={{ scale: 0.9, y: 4, boxShadow: "none" }} key={n} className="bg-[var(--panel)] text-[var(--primary-d)] border-[3px] border-[var(--primary)] rounded-2xl font-black text-3xl shadow-[0_4px_0_var(--primary)] flex items-center justify-center select-none outline-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onAppend(n); }}>{n}</motion.button>)}
      <motion.button whileTap={{ scale: 0.9, y: 4, boxShadow: "none" }} className="bg-[var(--text)] opacity-50 text-[var(--panel)] font-black text-3xl rounded-2xl shadow-[0_4px_0_rgba(0,0,0,0.5)] outline-none flex items-center justify-center select-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onClear(); }}>C</motion.button>
      <motion.button whileTap={{ scale: 0.9, y: 4, boxShadow: "none" }} className="bg-[var(--panel)] text-[var(--primary-d)] border-[3px] border-[var(--primary)] rounded-2xl font-black text-3xl shadow-[0_4px_0_var(--primary)] flex items-center justify-center select-none outline-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onAppend(digitLayout[9]); }}>{digitLayout[9]}</motion.button>
      <motion.button whileTap={{ scale: 0.9, y: 4, boxShadow: "none" }} className="bg-[var(--secondary)] text-[var(--panel)] border-[3px] border-[var(--text)] font-black text-3xl rounded-2xl shadow-[0_4px_0_var(--text)] outline-none flex items-center justify-center select-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onSubmit(); }}>OK</motion.button>
    </div>
  </div>
));

// 退出検知(ハートビート)。PeerJS の close は相手が黙って消えたとき数十秒〜届かないことがあるため、
// ホストから定期的に ping を投げ、一定時間 pong が返らないメンバーは「抜けた」とみなす。
// peerjs は「みんなであそぶ」を選んだ児童しか使わない。
// WebRTC のつじつま合わせ(webrtc-adapter / sdp / binarypack)まで合わせると
// 約190KB あり、1人であそぶだけの児童にこれを配るのは重い。
// へやを作る／入るときに、はじめて取りにいく（Part I §5）
let PeerCtor = null;
const loadPeer = async () => {
  if (!PeerCtor) PeerCtor = (await import('peerjs')).default;
  return PeerCtor;
};
// 読みこみ中に2回押されると、へやが2つできてしまう。1回きりにする
let peerLoading = false;

const PEER_PING_MS = 5000;
const PEER_TIMEOUT_MS = 30000;

// ==========================================
// 4. アプリケーション Views
// ==========================================

// --- ホーム画面 ---
const HomeView = ({ setView, stats, setStats, setConfigMode, initHost, resumeData, onResume, onDiscardResume }) => {
  const { level, title, badge, color, progress, nextLevelExp } = getLevelInfo(stats.totalExp);
  const chartData = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const dayData = stats.daily[d.toLocaleDateString()] || { exp: 0 };
    return { label: `${d.getDate()}日`, exp: dayData.exp };
  });
  const maxExp = Math.max(...chartData.map(d => d.exp), 500);

  // 学習ログ(study.v1)のふりかえり。読み出し専用で、ここから書きかえは行わない
  const study = useMemo(() => {
    const records = loadStudyRecords();
    return { summary: summarize(records, 7), missed: topMissedItems(records, 3) };
  }, []);

  const claimMission = (mId) => {
    let newStats = { ...stats }; const m = newStats.missions.list.find(x => x.id === mId);
    if (m && m.current >= m.target && !m.claimed) {
      audioCtrl.playSE('coin'); m.claimed = true; newStats.coins += m.reward;
      StorageAPI.saveStats(newStats); setStats(newStats); showToast('success', `${m.reward}コイン ゲット！`);
    }
  };

  return (
    <div className="flex flex-col items-center relative gap-4 pb-10">
      <div className="text-center">
        <h2 className="font-black text-5xl mb-1 text-[var(--text)] tracking-wider">Qalc<span className="text-[var(--primary-d)]">.</span></h2>
        <p className="text-[var(--text)] opacity-80 font-bold">めざせ、計算マスター！</p>
      </div>

      {/* Profile Card */}
      <div className="w-full bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] shadow-[4px_4px_0_rgba(0,0,0,0.1)] p-4 relative">
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {(stats.streak || 0) > 0 && (
            <div className="flex items-center gap-1 font-black text-sm text-[var(--panel)] bg-[var(--primary)] px-3 py-1 rounded-full border-2 border-[var(--text)] shadow-sm" title="連続学習日数">
              <Flame size={16} /> {stats.streak}<span className="text-[10px]">日</span>
            </div>
          )}
          <div className="flex items-center gap-1 font-black text-sm text-[var(--on-accent)] bg-[var(--accent)] px-3 py-1 rounded-full border-2 border-[var(--text)] shadow-sm"><Coins size={16} /> {stats.coins}</div>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <div className="bg-[var(--bg)] rounded-2xl w-[80px] h-[80px] border-[3px] border-[var(--text)] overflow-hidden">
            <LayeredAvatar equipped={stats.equipped} size="text-5xl" className="w-full h-full" />
          </div>
          <div className="flex-grow text-left">
            <div className="text-xs font-bold text-[var(--text)] opacity-80 mb-0.5"><span style={{ color }}>{badge} {title}</span></div>
            <div className="text-3xl font-black text-[var(--text)] tracking-wide">Lv.{level}</div>
            {(() => {
              const t = stats.equipped?.title ? SHOP_ITEMS.titles.find(i => i.id === stats.equipped.title) : null;
              return t ? <div className="inline-flex items-center gap-1 text-[10px] font-black text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-full px-2 py-0.5 mt-1">{t.char} {t.name}</div> : null;
            })()}
          </div>
        </div>
        <div className="w-full mt-4 h-3 bg-gray-200 rounded-full overflow-hidden z-10 border border-[var(--text)]">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} className="h-full bg-[var(--secondary)]"></motion.div>
        </div>
        <div className="text-right w-full text-[10px] font-bold text-[var(--text)] opacity-80 mt-1">NEXT: {Math.floor(nextLevelExp - stats.totalExp)} pt</div>
      </div>

      {resumeData && (
        <div className="w-full bg-[var(--accent)] border-[4px] border-[var(--text)] rounded-[20px] shadow-[4px_4px_0_rgba(0,0,0,0.1)] p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="font-black text-[var(--text)] flex items-center gap-2 ruby-text">
              <Clock size={20} /> <R c="前" r="ぜん" /><R c="回" r="かい" />のとちゅう
            </div>
            <button onClick={onDiscardResume} className="text-[var(--text)] opacity-80 hover:opacity-100 text-xs font-bold border-2 border-[var(--text)] rounded-lg px-2 py-1 bg-[var(--panel)] ruby-text"><R c="消" r="け" />す</button>
          </div>
          <div className="text-sm font-bold text-[var(--text)] opacity-80 leading-tight">
            <span className="bg-[var(--panel)] border-2 border-[var(--text)] rounded px-2 py-0.5 mr-1">
              {resumeData.gameMode === 'SCORE_ATTACK' ? 'スコア' : resumeData.gameMode === 'TIME_ATTACK' ? 'タイム' : 'サドンデス'}
            </span>
            <span className="truncate">{resumeData.courseName}</span>
            <span className="ml-1 opacity-70 ruby-text">／ {resumeData.correctCount || 0}<R c="問" r="もん" /><R c="正" r="せい" /><R c="解" r="かい" /></span>
          </div>
          <MotionButton className="bg-[var(--primary)] text-[var(--panel)] w-full py-3 text-lg border-[3px] border-[var(--text)] ruby-text" onClick={onResume}>
            <Rocket size={20} /> つづきから<R c="始" r="はじ" />める
          </MotionButton>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 w-full">
        <MotionButton className="bg-[var(--panel)] text-[var(--text)] border-[3px] border-[var(--text)] p-3 flex-col gap-1 h-auto" onClick={() => { setConfigMode('SCORE_ATTACK'); setView('singleConfig'); }}>
          <Award size={28} className="text-[var(--accent)]" /> <span className="text-xs leading-tight">スコア<br />アタック</span>
        </MotionButton>
        <MotionButton className="bg-[var(--panel)] text-[var(--text)] border-[3px] border-[var(--text)] p-3 flex-col gap-1 h-auto" onClick={() => { setConfigMode('TIME_ATTACK'); setView('singleConfig'); }}>
          <Timer size={28} className="text-[var(--secondary-d)]" /> <span className="text-xs leading-tight">タイム<br />アタック</span>
        </MotionButton>
        <MotionButton className="bg-[var(--panel)] text-[var(--text)] border-[3px] border-[var(--text)] p-3 flex-col gap-1 h-auto" onClick={() => { setConfigMode('SUDDEN_DEATH'); setView('singleConfig'); }}>
          <Swords size={28} className="text-[var(--primary-d)]" /> <span className="text-xs leading-tight">サドン<br />デス</span>
        </MotionButton>
      </div>

      {/* マルチプレイ ボタン */}
      <div className="w-full flex flex-col gap-2">
        <MotionButton className="bg-[var(--accent)] text-[var(--on-accent)] w-full py-4 text-xl border-[4px] border-[var(--text)]" onClick={initHost}>
          <Users size={24} /> みんなであそぶ（へやをつくる）
        </MotionButton>
        <MotionButton className="bg-[var(--secondary)] text-[var(--panel)] w-full py-4 text-xl border-[4px] border-[var(--text)]" onClick={() => setView('clientJoin')}>
          <User size={24} /> へやに<R c="入" r="はい" />る
        </MotionButton>
      </div>

      {/* ミッションパネル */}
      <div className="w-full bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] p-4">
        <h4 className="font-bold text-[var(--text)] mb-3 flex items-center gap-2 ruby-text"><CheckCircle2 size={20} className="text-[var(--secondary-d)]" /> <R c="今" r="きょ" /><R c="日" r="う" />のミッション</h4>
        <div className="flex flex-col gap-2">
          {stats.missions?.list.map(m => {
            const isCleared = m.current >= m.target;
            return (
              <div key={m.id} className="flex items-center justify-between bg-[var(--bg)] p-2 rounded-xl border-2 border-transparent">
                <div className="flex flex-col flex-grow pr-2">
                  <span className={`text-sm font-bold ${isCleared ? 'text-[var(--secondary-d)] line-through' : 'text-[var(--text)]'}`}>{m.desc}</span>
                  <span className="text-xs text-[var(--text)] opacity-80 font-bold">{Math.min(m.current, m.target)} / {m.target}</span>
                </div>
                {isCleared ? (
                  m.claimed ? <span className="text-[var(--text)] opacity-80 font-bold text-xs flex items-center"><CheckCircle2 size={16} /> 完了</span>
                    : <button onClick={() => claimMission(m.id)} className="bg-[var(--accent)] text-[var(--on-accent)] font-bold text-xs px-3 py-1.5 rounded-lg border-2 border-[var(--text)] active:scale-95 whitespace-nowrap">うけとる</button>
                ) : (
                  <span className="flex items-center gap-1 font-bold text-xs text-[var(--text)] opacity-80"><Coins size={14} /> {m.reward}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* がんばりグラフ */}
      <div className="w-full bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] p-4">
        <h4 className="font-bold text-[var(--text)] mb-4 flex items-center gap-2 ruby-text"><BarChart3 size={18} /> がんばりグラフ (<R c="直" r="ちょっ" /><R c="近" r="きん" />7<R c="日" r="にち" />)</h4>
        <div className="flex justify-between h-24 gap-1">
          {chartData.map((d, i) => (
            <div key={i} className="flex flex-col items-center flex-1 h-full group">
              <div className="w-full flex-grow flex items-end justify-center relative">
                <div className="absolute -top-6 opacity-0 group-hover:opacity-100 text-[10px] font-bold text-[var(--text)] transition-opacity bg-[var(--panel)] px-1 rounded border z-10 shadow-sm">{d.exp}</div>
                <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max((d.exp / maxExp) * 100, 2)}%` }} className={`w-full max-w-[20px] rounded-t-sm ${d.exp > 0 ? 'bg-[var(--secondary)]' : 'bg-gray-200'}`}></motion.div>
              </div>
              <div className="text-[9px] font-bold text-[var(--text)] opacity-80 mt-1 shrink-0">{d.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* まなびのきろく: 学習ログ(study.v1)を読んで、自分のがんばりをふりかえる */}
      {study.summary.sessions > 0 && (
        <div className="w-full bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] p-4">
          <h4 className="font-bold text-[var(--text)] mb-3 flex items-center gap-2 ruby-text">
            <Trophy size={18} className="text-[var(--accent)]" /> まなびのきろく（<R c="直" r="ちょっ" /><R c="近" r="きん" />7<R c="日" r="にち" />）
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[var(--bg)] rounded-xl border-2 border-[var(--text)] p-2 text-center">
              <div className="text-2xl font-black text-[var(--text)]">{study.summary.sessions}</div>
              <div className="text-[10px] font-bold text-[var(--text)] opacity-80 ruby-text"><R c="回" r="かい" />あそんだ</div>
            </div>
            <div className="bg-[var(--bg)] rounded-xl border-2 border-[var(--text)] p-2 text-center">
              <div className="text-2xl font-black text-[var(--secondary-d)]">{study.summary.minutes}<span className="text-xs ml-0.5 ruby-text"><R c="分" r="ふん" /></span></div>
              <div className="text-[10px] font-bold text-[var(--text)] opacity-80 ruby-text"><R c="集" r="しゅう" /><R c="中" r="ちゅう" />した<R c="時" r="じ" /><R c="間" r="かん" /></div>
            </div>
            <div className="bg-[var(--bg)] rounded-xl border-2 border-[var(--text)] p-2 text-center">
              <div className="text-2xl font-black text-[var(--primary-d)]">
                {study.summary.firstTryRate == null ? '—' : `${Math.round(study.summary.firstTryRate * 100)}%`}
              </div>
              <div className="text-[10px] font-bold text-[var(--text)] opacity-80 ruby-text">1<R c="回" r="かい" />めで<R c="正" r="せい" /><R c="解" r="かい" /></div>
            </div>
          </div>
          {study.missed.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold text-[var(--text)] opacity-80 mb-1.5 ruby-text">もういちど やってみよう</p>
              <div className="flex flex-wrap gap-1.5">
                {study.missed.map(m => (
                  <span key={m.q} className="text-sm font-black bg-[var(--bg)] border-2 border-[var(--text)] rounded-full px-3 py-1 text-[var(--text)]">
                    {m.q}<span className="text-[10px] opacity-60 ml-1">×{m.misses}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="w-full flex gap-2">
        <MotionButton className="bg-[var(--panel)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={() => setView('shop')}><Store size={20} /> きせかえ</MotionButton>
        <MotionButton className="bg-[var(--panel)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1 ruby-text" onClick={() => setView('manager')}><Settings size={20} /> コース<R c="管" r="かん" /><R c="理" r="り" /></MotionButton>
      </div>
    </div>
  );
};

// --- ホスト(リーダー) ルーム画面 ---
// みんなであそぶ専用のモード一覧（BOSS_RAID / TERRITORY は協力・チーム戦モードなのでマルチにのみ登場する）
const MULTI_MODES = [
  { id: 'SCORE_ATTACK', label: 'スコア' },
  { id: 'TIME_ATTACK', label: 'タイム' },
  { id: 'SUDDEN_DEATH', label: 'サドンデス' },
  { id: 'BOSS_RAID', label: 'ボス' },
  { id: 'TERRITORY', label: 'じんとり' },
];
const HostRoomView = ({ peerState, setPeerState, broadcast, setView, setState, configMode, setConfigMode, initRaid, initTerritory, approveMember, rejectMember }) => {
  const [groups, setGroups] = useState([]); const [selectedGroups, setSelectedGroups] = useState([]);
  const [time, setTime] = useState(3);
  const [selectedGrade, setSelectedGrade] = useState('すべて');
  const grades = ['すべて', '1年', '2年', '3年', '4年', '5年', '6年', 'その他'];

  const filteredGroups = groups.filter(g => {
    if (selectedGrade === 'すべて') return true;
    if (selectedGrade === 'その他') return !/^[1-6]年/.test(g.name);
    return g.name.startsWith(selectedGrade);
  });

  useEffect(() => { setGroups(StorageAPI.getProblemGroups()); }, []);

  // QRコード描画（同梱した qrcode を canvas に直接描く。innerHTML の組み立てはしない）
  const qrRef = useRef(null);
  useEffect(() => {
    if (!peerState.hostId || !qrRef.current) return;
    // 画面上は 160px のまま、描くピクセル数だけ dpr 倍にする（Part I §2-5）。
    // QRコードは細い白黒の格子なので、等倍で描くと高DPI機でにじんで読み取れないことがある
    const cssPx = 160;
    const dpr = canvasDpr();
    // qrcode(約25KB)は「へやをつくる」を選んだ人しか使わないので、ここで取りにいく
    import('qrcode').then(({ default: QRCode }) =>
      QRCode.toCanvas(qrRef.current, `${window.location.origin}${window.location.pathname}?host=${peerState.hostId}`, { width: cssPx * dpr, margin: 1 })
    )
      .then(() => {
        // toCanvas は width/height 属性と一緒に style も書きかえるので、あとから CSS 側を戻す
        if (!qrRef.current) return;
        qrRef.current.style.width = `${cssPx}px`;
        qrRef.current.style.height = `${cssPx}px`;
      })
      .catch(() => { /* 番号の手入力でも参加できるので、QRが出せなくても止めない */ });
  }, [peerState.hostId]);

  const hostTeam = peerState.hostTeam || 'red';

  // うけつけタイムの残り秒。1秒ごとに描きかえて、開いたままにならないよう残りを見せる
  const [acceptLeft, setAcceptLeft] = useState(0);
  useEffect(() => {
    const tick = () => setAcceptLeft(Math.max(0, Math.ceil(((peerState.acceptUntil || 0) - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [peerState.acceptUntil]);

  const pendingList = Object.entries(peerState.pending || {});

  const toggleAcceptWindow = () => {
    audioCtrl.playSE('click');
    setPeerState(p => ({ ...p, acceptUntil: (p.acceptUntil || 0) > Date.now() ? 0 : Date.now() + ACCEPT_WINDOW_MS }));
  };
  const approveAllPending = () => {
    audioCtrl.playSE('coin');
    pendingList.forEach(([id]) => approveMember(id));
  };

  // じんとり用: メンバーのチームをタップで入れかえる(参加者リスト経由で全員に同期される)
  const toggleMemberTeam = (id) => {
    audioCtrl.playSE('click');
    setPeerState(p => {
      const cur = p.participants[id];
      if (!cur) return p;
      const newP = { ...p, participants: { ...p.participants, [id]: { ...cur, team: cur.team === 'blue' ? 'red' : 'blue' } } };
      sendToApproved(newP, { type: 'participants_update', data: newP.participants });
      return newP;
    });
  };
  const toggleHostTeam = () => {
    audioCtrl.playSE('click');
    setPeerState(p => ({ ...p, hostTeam: (p.hostTeam || 'red') === 'red' ? 'blue' : 'red' }));
  };

  const startGame = () => {
    if (selectedGroups.length === 0) return showToast('warning', 'ドリルを選んでください');
    let probs = collectProblems(selectedGroups);
    if (probs.length === 0) return showToast('error', '問題がありません');
    probs = [...probs].sort(() => Math.random() - 0.5);
    if (configMode === 'TIME_ATTACK') probs = probs.slice(0, 20);

    // 開始直前にもう一度「いま つながっている人」だけにしぼる。
    // すでに抜けている端末をメンバー数やチーム分けに数えてしまわないようにするため。
    const liveIds = new Set(peerState.connections.filter(c => c.open).map(c => c.peer));
    const liveParticipants = {};
    Object.entries(peerState.participants).forEach(([id, m]) => { if (id === peerState.hostId || liveIds.has(id)) liveParticipants[id] = m; });

    const gameConfig = {
      timeLimitSec: (configMode === 'SCORE_ATTACK' || configMode === 'BOSS_RAID' || configMode === 'TERRITORY') ? time * 60 : 0,
      problemSet: probs.map(p => ({ q: p.q, a: String(p.a).split('|') })),
      courseName: joinCourseNames(selectedGroups),
      // 学習ログの単元IDに使う。メンバー側の端末でも同じ単元として記録されるように配る
      courseNames: [...selectedGroups],
      gameMode: configMode
    };

    // ボスバトル: ホスト権威のレイド状態を初期化し、初期スナップショットを全員に配る
    if (configMode === 'BOSS_RAID') {
      const playerCount = liveIds.size + 1; // メンバー + ホスト
      gameConfig.raid = initRaid(playerCount, liveParticipants);
    }

    // じんとり: チーム分けを確定し(未割当は人数の少ない側へ)、ホスト権威の盤面を初期化する
    let teamsMap = null;
    if (configMode === 'TERRITORY') {
      teamsMap = { [peerState.hostId]: { name: 'リーダー', team: hostTeam } };
      let red = hostTeam === 'red' ? 1 : 0; let blue = 1 - red;
      Object.entries(liveParticipants).forEach(([id, m]) => {
        if (id === peerState.hostId) return;
        let team = m.team === 'red' || m.team === 'blue' ? m.team : (red <= blue ? 'red' : 'blue');
        if (team === 'red') red++; else blue++;
        teamsMap[id] = { name: m.name, team };
      });
      if (red === 0 || blue === 0) return showToast('warning', 'あかチームと あおチームに 1人ずつは 必要です');
      gameConfig.territory = initTerritory(teamsMap);
    }

    // ホスト自身を参加者リストに追加し、全参加者のスコアをリセット(抜けた人はここで除かれる)
    setPeerState(p => {
      const resetParticipants = {};
      Object.entries(p.participants).forEach(([id, participant]) => {
        if (id !== p.hostId && !liveIds.has(id)) return; // すでに抜けている端末は参加者から外す
        resetParticipants[id] = { ...participant, score: 0, combo: 0, ...(teamsMap && teamsMap[id] ? { team: teamsMap[id].team } : {}) };
      });
      resetParticipants[p.hostId] = { id: p.hostId, name: 'リーダー', score: 0, combo: 0, ...(teamsMap ? { team: hostTeam } : {}) };
      const newP = { ...p, participants: resetParticipants, connections: p.connections.filter(c => c.open) };
      sendToApproved(newP, { type: 'participants_update', data: newP.participants });
      return newP;
    });

    setState(gameConfig);
    // 全クライアントにゲーム設定を送信して開始させる
    broadcast({ type: 'game_start', data: gameConfig });
    setView('game');
  };

  return (
    <div className="flex flex-col h-[85vh] gap-4">
      <div className="flex justify-between items-center bg-[var(--panel)] p-3 rounded-2xl border-[3px] border-[var(--text)] shrink-0 shadow-sm">
        <h3 className="font-black text-xl flex items-center gap-2 text-[var(--text)]"><Users size={24} className="text-[var(--secondary-d)]" /> みんなのへや</h3>
        <div className="font-bold bg-[var(--secondary)] text-white px-3 py-1 rounded-full border-2 border-[var(--text)]">{Object.keys(peerState.participants).length} <R c="人" r="にん" /></div>
      </div>

      <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] p-5 flex flex-col gap-6 overflow-y-auto flex-grow shadow-sm">
        <div className="flex flex-col items-center justify-center p-4 bg-[var(--bg)] rounded-xl border-2 border-dashed border-[var(--text)] shrink-0">
          <p className="font-bold text-[var(--primary-d)] mb-1 text-sm ruby-text">ルーム<R c="番" r="ばん" /><R c="号" r="ごう" /></p>
          {/* 10けたは長いので 4-3-3 に区切って見せる。打つときは数字だけでよい（すきまは読みやすさのため） */}
          <h4 className="font-black text-3xl sm:text-4xl text-[var(--text)] mb-4 tracking-wider tabular-nums">{formatRoomId(peerState.hostId)}</h4>
          <p className="font-bold text-sm text-[var(--text)] mb-3 ruby-text">この<R c="数" r="すう" /><R c="字" r="じ" />を<R c="入" r="にゅう" /><R c="力" r="りょく" />するか、QRコードを<R c="読" r="よ" />みこんでね</p>
          <canvas ref={qrRef} className="bg-white p-3 rounded-xl mb-3 shadow-inner" />
          <div className="w-full flex items-center bg-white border-2 border-gray-200 rounded-lg p-2">
            <input type="text" readOnly value={`${window.location.origin}${window.location.pathname}?host=${peerState.hostId}`} className="text-xs font-mono w-full outline-none bg-transparent" />
            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?host=${peerState.hostId}`); showToast('success', 'コピーしました'); }} className="text-gray-500 hover:text-[var(--primary-d)] ml-2"><Share2 size={16} /></button>
          </div>
        </div>

        <div className="shrink-0">
          <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-80 ruby-text"><R c="出" r="しゅつ" /><R c="題" r="だい" />モード</label>
          <div className="flex gap-2 mb-4">
            {MULTI_MODES.map(m => (
              <button key={m.id} onClick={() => { audioCtrl.playSE('click'); setConfigMode(m.id); }} className={`flex-1 py-2 text-xs font-bold rounded-lg border-2 transition-colors ${configMode === m.id ? 'bg-[var(--text)] text-white border-[var(--text)]' : 'bg-transparent border-gray-300 text-gray-500 hover:border-gray-400'}`}>
                {m.label}
              </button>
            ))}
          </div>

          {/* ボスバトル: ルール説明(じんとりと同じく、みんなであそぶ限定モードなので受付画面で遊び方を見せる) */}
          {configMode === 'BOSS_RAID' && (
            <div className="mb-4">
              {/* 最初にたたかうボスがバトル前にあおってくる(はじまる前から気分をあげる) */}
              <div className="flex items-center gap-2 mb-2">
                <BossAvatar bossIndex={0} className="w-16 h-16 shrink-0" />
                <div className="font-black text-sm text-[var(--text)] leading-snug">
                  みんなで <span className="text-[var(--primary-d)]"><R c="力" r="ちから" /></span>を あわせて、<br className="hidden sm:block" />ボスを たおそう！
                </div>
              </div>
              <div className="bg-[var(--bg)] border-2 border-dashed border-[var(--text)] rounded-xl p-3 text-xs font-bold text-[var(--text)] opacity-90 mb-3 leading-relaxed flex flex-col gap-1">
                <span>👑 <R c="全" r="ぜん" /><R c="員" r="いん" />で 1<R c="体" r="たい" />のボスに ちょうせんする <R c="協" r="きょう" /><R c="力" r="りょく" />モード！<R c="正" r="せい" /><R c="解" r="かい" />すると ボスにダメージ、コンボが つづくほど <span className="text-[var(--primary-d)]">大ダメージ</span></span>
                <span>💗 <R c="体" r="たい" /><R c="力" r="りょく" />は みんなで1つ。ボスの こうげきで へって 0になると たてなおし（ボスも かいふくしてしまう）</span>
                <span>✨ <span className="text-[var(--primary-d)]">おうえん</span>… ゲージが たまると はつどう！ 8<R c="秒" r="びょう" />かん <R c="全" r="ぜん" /><R c="員" r="いん" />のダメージ2ばい＋<R c="体" r="たい" /><R c="力" r="りょく" />かいふく</span>
                <span>⚡ ボスは <R c="問" r="もん" /><R c="題" r="だい" />かくし・テンキーシャッフル・こおり などで じゃまをしてくる。<span className="text-red-500">💣バクダン</span>は みんなの<R c="正" r="せい" /><R c="解" r="かい" />で かいじょ！</span>
                <span>🔥 ボスの<R c="体" r="たい" /><R c="力" r="りょく" />が へると <span className="text-red-500">げきおこ</span>で こうげきが はげしくなる。たおすと つぎのボスが とうじょう！</span>
              </div>
            </div>
          )}

          {/* じんとり: ルール説明とチーム分けUI */}
          {configMode === 'TERRITORY' && (
            <div className="mb-4">
              {/* あいぼうの「ペンキー」がバトル前にあいさつする(はじまる前から気分をあげる) */}
              <div className="flex items-center gap-2 mb-2">
                <TerritoryCharacter mood="fight" bubble={false} className="w-16 shrink-0" />
                <div className="font-black text-sm text-[var(--text)] leading-snug">
                  あいぼうの <span className="text-[var(--primary-d)]">{TERRITORY_CHARACTER_NAME}</span> と いっしょに、<br className="hidden sm:block" />ばんめんを ぬりつぶそう！
                </div>
              </div>
              <div className="bg-[var(--bg)] border-2 border-dashed border-[var(--text)] rounded-xl p-3 text-xs font-bold text-[var(--text)] opacity-90 mb-3 leading-relaxed flex flex-col gap-1">
                <span>🚩 2チームに<R c="分" r="わ" />かれて、7×7の ばんめんを ぬりあうチーム<R c="戦" r="せん" />！<R c="正" r="せい" /><R c="解" r="かい" />すると ねらったマスに ぬれるよ。</span>
                <span>🌊 マスをぬると となりにも インクがはねて <span className="text-[var(--primary-d)]">れんさ</span>が おきる！★マスは ポイントが<R c="大" r="おお" />きい</span>
                <span>💥 <span className="text-[var(--primary-d)]">スペシャル</span>… ゲージが たまると スーパーチャクチ・スプラッシュライン・インクラッシュ が うてる</span>
                <span>🎁 <span className="text-[var(--primary-d)]">？マス</span>… とるとラッキー！ ⏰ のこり30<R c="秒" r="びょう" />は <span className="text-red-500">ラストスパートで ぬり2ばい</span>（さいごまで ぎゃくてんできる！）</span>
              </div>
              <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-80">チームわけ（なまえをタップで いれかえ）</label>
              <div className="grid grid-cols-2 gap-2">
                {['red', 'blue'].map(team => {
                  const members = Object.entries(peerState.participants).filter(([id, m]) => id !== peerState.hostId && ((m.team === 'blue' ? 'blue' : 'red') === team));
                  const count = members.length + (hostTeam === team ? 1 : 0);
                  return (
                    <div key={team} className="rounded-xl border-[3px] p-2 min-h-[88px]" style={{ borderColor: TEAMS[team].color, background: TEAMS[team].soft }}>
                      <div className="font-black text-xs mb-1.5" style={{ color: TEAMS[team].color }}>{TEAMS[team].label}チーム（{count}<R c="人" r="にん" />）</div>
                      <div className="flex flex-wrap gap-1.5">
                        {hostTeam === team && (
                          <button onClick={toggleHostTeam} className="text-[11px] font-black bg-[var(--panel)] border-2 border-[var(--text)] rounded-full px-2 py-0.5 active:scale-95">👑 リーダー</button>
                        )}
                        {members.map(([id, m]) => (
                          <button key={id} onClick={() => toggleMemberTeam(id)} className="text-[11px] font-bold bg-[var(--panel)] border-2 border-[var(--text)] rounded-full px-2 py-0.5 active:scale-95 max-w-[110px] truncate"><PupilName name={m.name} /></button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-80 ruby-text"><R c="学" r="がく" /><R c="年" r="ねん" /></label>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3 no-scrollbar sm:flex-wrap sm:overflow-visible sm:pb-0">
            {grades.map(grade => <button key={grade} onClick={() => { audioCtrl.playSE('click'); setSelectedGrade(grade); }} className={`px-4 py-2 rounded-full whitespace-nowrap font-bold text-sm border-2 transition-colors flex-shrink-0 ${selectedGrade === grade ? 'bg-[var(--text)] border-[var(--text)] text-[var(--panel)] shadow-sm' : 'bg-[var(--bg)] border-transparent text-[var(--text)] hover:border-gray-400'}`}>{grade}</button>)}
          </div>

          <div className="mb-2">
            <CourseMultiSelect filteredGroups={filteredGroups} allGroups={groups} selected={selectedGroups} setSelected={setSelectedGroups} />
          </div>
        </div>

        {(configMode === 'SCORE_ATTACK' || configMode === 'BOSS_RAID' || configMode === 'TERRITORY') && (
          <div className="shrink-0 mb-2">
            <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-80 flex justify-between ruby-text"><span><R c="制" r="せい" /><R c="限" r="げん" /><R c="時" r="じ" /><R c="間" r="かん" /></span><span className="text-[var(--primary-d)] text-lg">{time} <R c="分" r="ふん" /></span></label>
            <input type="range" min="1" max="10" value={time} onChange={e => setTime(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[var(--primary)]" />
          </div>
        )}

        {/* 入室のきょか。ここを通した人だけが参加者リスト・問題・ゲーム開始を受けとれる */}
        <div className="shrink-0">
          <h4 className="font-black text-lg text-[var(--text)] border-b-2 border-dashed border-gray-200 pb-2 mb-3 ruby-text flex items-center justify-between">
            <span><R c="入" r="はい" />りたい<R c="人" r="ひと" /></span>
            {pendingList.length > 0 && <span className="text-sm text-[var(--panel)] bg-[var(--primary)] rounded-full px-3 py-0.5">{pendingList.length}</span>}
          </h4>

          <div className="flex gap-2 mb-3">
            <button
              onClick={toggleAcceptWindow}
              className={`flex-1 py-2 text-xs font-black rounded-lg border-2 transition-colors ruby-text ${acceptLeft > 0 ? 'bg-[var(--secondary)] text-[var(--panel)] border-[var(--text)]' : 'bg-transparent border-gray-300 text-gray-500'}`}
            >
              {acceptLeft > 0
                ? <>うけつけ<R c="中" r="ちゅう" /> あと {acceptLeft} <R c="秒" r="びょう" />（とめる）</>
                : <>うけつけタイム（{ACCEPT_WINDOW_MS / 1000}<R c="秒" r="びょう" />）</>}
            </button>
            {pendingList.length > 1 && (
              <button onClick={approveAllPending} className="px-3 py-2 text-xs font-black rounded-lg border-2 border-[var(--text)] bg-[var(--accent)] text-[var(--on-accent)] ruby-text">
                ぜんいん いれる
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 mb-5">
            {pendingList.length === 0 && (
              <p className="text-center text-gray-400 py-2 font-bold text-xs ruby-text">
                {acceptLeft > 0
                  ? <>いま<R c="入" r="はい" />ってくる<R c="人" r="ひと" />は じどうで きょかされます</>
                  : <>もうしこみが あると ここに<R c="出" r="で" />ます</>}
              </p>
            )}
            {pendingList.map(([id, req]) => (
              <div key={id} className="flex justify-between items-center bg-[var(--bg)] p-2 pl-3 rounded-xl border-2 border-dashed border-[var(--primary)] gap-2">
                <span className="font-bold text-[var(--text)] truncate"><PupilName name={req.name} /></span>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => { audioCtrl.playSE('coin'); approveMember(id); }} className="px-3 py-1.5 text-xs font-black rounded-lg border-2 border-[var(--text)] bg-[var(--secondary)] text-[var(--panel)]">いれる</button>
                  <button onClick={() => { audioCtrl.playSE('click'); rejectMember(id); }} className="px-3 py-1.5 text-xs font-black rounded-lg border-2 border-[var(--text)] bg-[var(--panel)] text-[var(--text)]">ことわる</button>
                </div>
              </div>
            ))}
          </div>

          <h4 className="font-black text-lg text-[var(--text)] border-b-2 border-dashed border-gray-200 pb-2 mb-3 ruby-text"><R c="参" r="さん" /><R c="加" r="か" /><R c="者" r="しゃ" />の<R c="状" r="じょう" /><R c="況" r="きょう" /></h4>
          <div className="flex flex-col gap-2">
            {Object.keys(peerState.participants).length === 0 && <p className="text-center text-gray-400 py-4 font-bold text-sm ruby-text"><R c="参" r="さん" /><R c="加" r="か" /><R c="者" r="しゃ" />がいません</p>}
            {Object.entries(peerState.participants).sort((a, b) => b[1].score - a[1].score).map(([id, p], index) => (
              <div key={id} className="flex justify-between items-center bg-[var(--bg)] p-3 rounded-xl border-2 border-[var(--text)]">
                <div className="flex items-center gap-3">
                  <span className="font-black text-gray-400 w-4 text-center">{index + 1}</span>
                  <span className="font-bold text-[var(--text)]"><PupilName name={p.name} /></span>
                </div>
                <div className="flex items-center gap-4 text-sm font-bold">
                  <span className="text-[var(--secondary-d)]">🔥 {p.combo} Combo</span>
                  <span className="text-[var(--primary-d)] w-16 text-right font-black">{p.score} pt</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <MotionButton className="bg-[var(--primary)] text-[var(--panel)] w-full py-4 text-xl border-[3px] border-[var(--text)] shrink-0 ruby-text" onClick={startGame}><Radio size={24} /> <R c="全" r="ぜん" /><R c="員" r="いん" />でゲーム<R c="開" r="かい" /><R c="始" r="し" />！</MotionButton>
    </div>
  );
};

// --- クライアント(児童) 参加画面 ---
const ClientJoinView = ({ initClient, urlHostId, setView }) => {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(urlHostId || '');

  const submit = () => {
    if (!isValidRoomId(roomId)) return showToast('warning', `ルーム番号は ${ROOM_ID_LEN} けたの数字です`);
    const clean = sanitizeName(name);
    if (!clean) return showToast('warning', 'なまえは ひらがな・カタカナ・すうじ で 入れてね');
    initClient(clean, roomId);
  };

  return (
    <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] p-6 text-center shadow-md max-w-sm mx-auto mt-10 flex flex-col">
      <div className="bg-[var(--accent)] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-[var(--text)] shrink-0">
        <Users size={32} className="text-[var(--text)]" />
      </div>
      <h3 className="font-black text-2xl mb-4 text-[var(--text)] shrink-0 ruby-text">へやに<R c="入" r="はい" />ります</h3>

      <div className="mb-4 shrink-0">
        <p className="font-bold mb-2 text-[var(--text)] opacity-80 text-sm ruby-text">ルーム<R c="番" r="ばん" /><R c="号" r="ごう" />（<R c="数" r="すう" /><R c="字" r="じ" />{ROOM_ID_LEN}けた）</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={ROOM_ID_LEN}
          className="w-full border-[3px] border-[var(--text)] rounded-xl p-4 font-black text-2xl tracking-wider text-center outline-none focus:border-[var(--secondary)] bg-[var(--bg)] tabular-nums"
          placeholder="1234567890"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value.replace(/[^0-9]/g, '').slice(0, ROOM_ID_LEN))}
        />
        <p className="text-[11px] font-bold text-[var(--text)] opacity-80 mt-1 tabular-nums">{roomId.length} / {ROOM_ID_LEN}</p>
      </div>

      <div className="mb-6 shrink-0">
        <p className="font-bold mb-2 text-[var(--text)] opacity-80 text-sm ruby-text">あなたの<R c="名" r="な" /><R c="前" r="まえ" />（ニックネーム）</p>
        <input
          type="text"
          maxLength={NAME_MAX}
          className="w-full border-[3px] border-[var(--text)] rounded-xl p-4 font-black text-xl text-center outline-none focus:border-[var(--secondary)] bg-[var(--bg)]"
          placeholder="さくら / 5ばん"
          value={name}
          onChange={(e) => setName(sanitizeName(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        {/* 本名を入れないことは技術だけでは防げない。ここで はっきり つたえる */}
        <p className="text-[11px] font-bold text-[var(--primary-d)] mt-2 leading-snug ruby-text">
          ⚠ ほんとうの<R c="名" r="な" /><R c="前" r="まえ" />（フルネーム）は<R c="入" r="い" />れないでね。<br />
          ひらがな・カタカナ・すうじで {NAME_MAX}<R c="文" r="も" /><R c="字" r="じ" />までだよ
        </p>
      </div>

      <MotionButton
        className="bg-[var(--secondary)] text-[var(--panel)] w-full py-4 text-xl border-[3px] border-[var(--text)] shrink-0"
        onClick={submit}
      >
        へやに<R c="入" r="はい" />る！
      </MotionButton>

      <button className="text-[var(--text)] opacity-80 font-bold mt-4 hover:opacity-100 transition shrink-0" onClick={() => { audioCtrl.playSE('click'); setView('home') }}>もどる</button>
    </div>
  );
};

// --- クライアント 待機画面 ---
// リーダーの「きょか」を待っている間と、きょかが出てゲーム開始を待っている間の2つの状態がある。
// 児童に「いま何を待っているのか」が伝わるように、見た目と文言をはっきり分ける。
const ClientWaitView = ({ peerState, leaveRoom }) => {
  const approved = !!peerState.approved;
  return (
    <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] p-8 text-center shadow-md flex flex-col items-center justify-center min-h-[50vh] max-w-sm mx-auto mt-10">
      <div className="animate-spin mb-6 bg-[var(--bg)] p-4 rounded-full border-2 border-[var(--text)]">
        {approved ? <Radio size={48} className="text-[var(--secondary-d)]" /> : <Clock size={48} className="text-[var(--primary-d)]" />}
      </div>
      {approved ? (
        <>
          <h3 className="font-black text-3xl text-[var(--text)] mb-3 ruby-text"><PupilName name={peerState.myName} /> さん、<br /><R c="準" r="じゅん" /><R c="備" r="び" />OK！</h3>
          <p className="font-bold text-[var(--on-accent)] opacity-80 bg-[var(--accent)] px-4 py-2 rounded-lg border-2 border-[var(--text)] mb-6 ruby-text">
            リーダーがスタートするまで<br />このまま<R c="待" r="ま" />っていてね
          </p>
        </>
      ) : (
        <>
          <h3 className="font-black text-2xl text-[var(--text)] mb-3 ruby-text">リーダーの<br /><R c="許" r="きょ" /><R c="可" r="か" />を<R c="待" r="ま" />っています</h3>
          <p className="font-bold text-[var(--text)] opacity-80 bg-[var(--bg)] border-2 border-dashed border-[var(--text)] px-4 py-2 rounded-lg mb-6 ruby-text text-sm">
            「<PupilName name={peerState.myName} />」で<R c="申" r="もう" />しこみました。<br />リーダーが「いれる」を おすまで<br />ちょっと<R c="待" r="ま" />っててね
          </p>
        </>
      )}
      <button className="text-[var(--text)] opacity-80 font-bold hover:opacity-100 transition underline ruby-text" onClick={leaveRoom}>やめる（<R c="退" r="たい" /><R c="出" r="しゅつ" />する）</button>
    </div>
  );
};


// --- ショップ＆きせかえ画面 ---
const ShopView = ({ setView, stats, setStats }) => {
  const [tab, setTab] = useState('bases');
  const [confirmItem, setConfirmItem] = useState(null);
  const [gachaResult, setGachaResult] = useState(null); // { category, item, isNew, refund, revealed }
  const spinningRef = useRef(false);
  const { level } = getLevelInfo(stats.totalExp);

  // 「戻る」でひらいているダイアログをとじる(ガチャは演出中だけそのまま待つ)
  useBackHandler(!!confirmItem, () => { audioCtrl.playSE('click'); setConfirmItem(null); return true; }, BACK_PRIORITY.overlay);
  useBackHandler(!!gachaResult, () => {
    if (!gachaResult.revealed) return true; // たまごが開くまでは何もしない
    audioCtrl.playSE('click'); setGachaResult(null); return true;
  }, BACK_PRIORITY.overlay);

  const gachaPool = getGachaPool();
  const gachaOwnedCount = gachaPool.filter(e => (stats.inventory[e.category] || []).includes(e.item.id)).length;
  const totalItems = Object.values(SHOP_ITEMS).reduce((a, arr) => a + arr.length, 0);
  const ownedItems = Object.entries(SHOP_ITEMS).reduce((a, [cat, arr]) => a + arr.filter(i => (stats.inventory[cat] || []).includes(i.id)).length, 0);
  const collectionPct = Math.floor((ownedItems / totalItems) * 100);

  const handleItemClick = (item, category) => {
    audioCtrl.playSE('click'); let newStats = { ...stats }; const isOwned = newStats.inventory[category].includes(item.id);

    if (!isOwned) {
      if (item.gacha) { showToast('error', '🥚 ガチャからでてくるよ！'); return; }
      if (item.lv && level < item.lv) { showToast('error', `レベル${item.lv}になったら買えるよ！`); return; }
      if (newStats.coins >= item.price) {
        setConfirmItem({ item, category });
      } else {
        showToast('error', 'コインが足りません');
      }
    } else {
      if (category === 'themes') {
        newStats.theme = item.id;
      } else {
        // equipped は LayeredAvatar(React.memo) の props になるため、必ず新しいオブジェクトに差し替える
        const propName = category.slice(0, -1);
        newStats.equipped = { ...newStats.equipped, [propName]: newStats.equipped[propName] === item.id ? null : item.id };
      }
      StorageAPI.saveStats(newStats); setStats(newStats);
    }
  };

  const executeBuy = () => {
    if (!confirmItem) return;
    const { item, category } = confirmItem;
    let newStats = { ...stats };
    newStats.coins -= item.price;
    newStats.inventory = { ...newStats.inventory, [category]: [...newStats.inventory[category], item.id] };

    if (category === 'themes') { newStats.theme = item.id; }
    else { const propName = category.slice(0, -1); newStats.equipped = { ...newStats.equipped, [propName]: item.id }; }

    audioCtrl.playSE('coin'); showToast('success', '購入しました！');
    StorageAPI.saveStats(newStats); setStats(newStats); setConfirmItem(null);
  };

  const spinGacha = () => {
    // 連打・演出中の多重スピン防止(state だと同一レンダー内の連打を防げないため ref を使う)
    if (spinningRef.current) return;
    if (stats.coins < GACHA_COST) { showToast('error', 'コインが足りません'); return; }
    spinningRef.current = true;
    audioCtrl.playSE('click');
    const { category, item } = rollGacha();
    let newStats = { ...stats };
    newStats.coins -= GACHA_COST;
    const isNew = !newStats.inventory[category].includes(item.id);
    let refund = 0;
    if (isNew) {
      newStats.inventory = { ...newStats.inventory, [category]: [...newStats.inventory[category], item.id] };
    } else {
      refund = GACHA_DUP_REFUND[getRarity(item)];
      newStats.coins += refund;
    }
    StorageAPI.saveStats(newStats); setStats(newStats);
    setGachaResult({ category, item, isNew, refund, revealed: false });
    setTimeout(() => {
      audioCtrl.playSE(isNew ? 'finish' : 'coin');
      if (isNew && getRarity(item) !== 'N') triggerConfetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
      setGachaResult(prev => (prev ? { ...prev, revealed: true } : prev));
      spinningRef.current = false;
    }, 1200);
  };

  const CATEGORY_LABELS = { bases: 'ベース', hats: 'ぼうし', faces: 'かお', props: 'もちもの', backgrounds: 'はいけい', effects: 'エフェクト', titles: 'しょうごう', themes: 'テーマ' };

  return (
    <div className="flex flex-col h-[80vh] relative">
      <AnimatePresence>
        {confirmItem && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} role="dialog" aria-modal="true" aria-label="かうかどうかの かくにん" exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-xs flex flex-col items-center text-center">
              <div className="text-5xl mb-3 h-16 flex items-center justify-center">
                {confirmItem.category === 'themes'
                  ? (confirmItem.item.c ? <div className="flex gap-1">{confirmItem.item.c.map((col, i) => <span key={i} className="w-8 h-8 rounded-full border-[3px] border-[var(--text)]" style={{ background: col }} />)}</div> : <PaintBucket size={48} className="text-[var(--text)]" />)
                  : confirmItem.item.char}
              </div>
              <h3 className="font-black text-xl text-[var(--text)] mb-2 leading-snug">「{confirmItem.item.name}」を<br />買いますか？</h3>
              <p className="font-bold text-[var(--primary-d)] mb-6 flex items-center gap-1 justify-center"><Coins size={20} /> {confirmItem.item.price}</p>
              <div className="flex w-full gap-3">
                <MotionButton className="bg-[var(--bg)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={() => { audioCtrl.playSE('click'); setConfirmItem(null); }}>やめる</MotionButton>
                <MotionButton className="bg-[var(--accent)] text-[var(--on-accent)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={executeBuy}>かう！</MotionButton>
              </div>
            </motion.div>
          </motion.div>
        )}

        {gachaResult && (
          <motion.div key="gachaModal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} role="dialog" aria-modal="true" aria-label="ふしぎなたまごガチャ" exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-xs flex flex-col items-center text-center">
              {!gachaResult.revealed ? (
                <>
                  <motion.div animate={{ rotate: [0, -15, 15, -15, 15, 0], scale: [1, 1.05, 1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 0.7 }} className="text-7xl mb-4">🥚</motion.div>
                  <p className="font-black text-[var(--text)]">なにが でるかな…？</p>
                </>
              ) : (
                <>
                  <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", bounce: 0.5 }} className="text-7xl mb-3">{gachaResult.item.char}</motion.div>
                  <span className="text-[10px] font-black text-white px-2 py-0.5 rounded-full mb-2" style={{ background: RARITY_INFO[getRarity(gachaResult.item)].color }}>{RARITY_INFO[getRarity(gachaResult.item)].label}</span>
                  <h3 className="font-black text-xl text-[var(--text)] leading-snug">{gachaResult.item.name}</h3>
                  <p className="text-[10px] font-bold text-[var(--text)] opacity-80 mb-2">({CATEGORY_LABELS[gachaResult.category]})</p>
                  {gachaResult.isNew
                    ? <p className="font-black text-[var(--primary-d)] mb-4">✨ NEW! てにいれた！</p>
                    : <p className="font-black text-[var(--text)] opacity-80 mb-4 flex items-center gap-1 justify-center">もってた！ <Coins size={16} /> +{gachaResult.refund} もどってきた</p>}
                  <div className="flex w-full gap-3">
                    <MotionButton className="bg-[var(--bg)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={() => { audioCtrl.playSE('click'); setGachaResult(null); }}>とじる</MotionButton>
                    <MotionButton className="bg-[var(--accent)] text-[var(--on-accent)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={spinGacha} disabled={stats.coins < GACHA_COST}>もう1かい</MotionButton>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-between items-center mb-2 shrink-0">
        <h3 className="font-bold text-xl text-[var(--text)] flex items-center gap-2"><Store size={24} /> ショップ＆きせかえ</h3>
        <div className="flex items-center gap-1 font-black text-sm text-[var(--on-accent)] bg-[var(--accent)] px-3 py-1.5 rounded-full border-[3px] border-[var(--text)]"><Coins size={16} /> {stats.coins}</div>
      </div>

      {/* コレクションりつ */}
      <div className="flex items-center gap-2 mb-3 shrink-0 text-[10px] font-bold text-[var(--text)]">
        <span className="opacity-70 whitespace-nowrap">コレクション {ownedItems}/{totalItems}</span>
        <div className="flex-grow h-2.5 bg-[var(--panel)] rounded-full border-2 border-[var(--text)] overflow-hidden">
          <div className="h-full bg-[var(--secondary)] rounded-full transition-all" style={{ width: `${collectionPct}%` }} />
        </div>
        <span className="opacity-70">{collectionPct}%</span>
      </div>

      <div className="flex gap-3 mb-4 shrink-0">
        <div className="w-24 h-24 bg-[var(--bg)] border-[3px] border-[var(--text)] rounded-2xl shrink-0 overflow-hidden">
          {/* key を装備内容にして、きせかえのたびにポヨンと弾ませる */}
          <motion.div key={`${stats.equipped.base}_${stats.equipped.hat}_${stats.equipped.face}_${stats.equipped.prop}_${stats.equipped.background}_${stats.equipped.effect}`} initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", bounce: 0.6 }} className="w-full h-full">
            <LayeredAvatar equipped={stats.equipped} size="text-6xl" className="w-full h-full" />
          </motion.div>
        </div>
        <div className="flex-grow grid grid-cols-3 gap-1 content-start">
          {[
            { id: 'bases', icon: <User size={14} />, label: 'ベース' },
            { id: 'hats', icon: <Shirt size={14} />, label: 'ぼうし' },
            { id: 'faces', icon: <span className="text-xs">🕶️</span>, label: 'かお' },
            { id: 'props', icon: <span className="text-xs">🎒</span>, label: 'もちもの' },
            { id: 'backgrounds', icon: <span className="text-xs">🖼️</span>, label: 'はいけい' },
            { id: 'effects', icon: <span className="text-xs">✨</span>, label: 'エフェクト' },
            { id: 'titles', icon: <span className="text-xs">🎖️</span>, label: 'しょうごう' },
            { id: 'themes', icon: <PaintBucket size={14} />, label: 'テーマ' },
            { id: 'gacha', icon: <span className="text-xs">🥚</span>, label: 'ガチャ' },
          ].map(t => (
            <button key={t.id} onClick={() => { audioCtrl.playSE('click'); setTab(t.id); }} className={`flex flex-col items-center justify-center p-1 rounded-lg border-2 font-bold text-[9px] transition-all ${tab === t.id ? 'bg-[var(--text)] text-[var(--panel)] border-[var(--text)]' : 'bg-[var(--panel)] text-[var(--text)] opacity-80 border-transparent hover:bg-[var(--bg)]'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'gacha' ? (
        <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] flex-grow p-4 overflow-y-auto shadow-sm flex flex-col items-center gap-3">
          <motion.div animate={{ rotate: [0, -6, 6, -6, 6, 0] }} transition={{ repeat: Infinity, duration: 2.5, repeatDelay: 1 }} className="text-7xl">🥚</motion.div>
          <h4 className="font-black text-lg text-[var(--text)]">ふしぎなたまごガチャ</h4>
          <p className="text-xs font-bold text-[var(--text)] opacity-80 text-center leading-relaxed">
            ここでしか手に入らないレアきせかえが ぜんぶで {gachaPool.length}しゅるい！<br />
            もっているものが 出たときは コインが すこし もどってくるよ
          </p>
          <div className="w-full flex items-center gap-2 text-[10px] font-bold text-[var(--text)]">
            <span className="opacity-70 whitespace-nowrap">あつめたかず {gachaOwnedCount}/{gachaPool.length}</span>
            <div className="flex-grow h-2.5 bg-[var(--bg)] rounded-full border-2 border-[var(--text)] overflow-hidden">
              <div className="h-full bg-[var(--primary)] rounded-full transition-all" style={{ width: `${Math.floor((gachaOwnedCount / gachaPool.length) * 100)}%` }} />
            </div>
          </div>
          {gachaOwnedCount >= gachaPool.length ? (
            <div className="font-black text-[var(--primary-d)] py-3">🎉 ガチャコンプリート！おめでとう！</div>
          ) : (
            <MotionButton className="bg-[var(--primary)] text-[var(--panel)] w-full py-4 text-lg border-[3px] border-[var(--text)]" onClick={spinGacha}>
              🥚 ガチャをまわす（<Coins size={18} /> {GACHA_COST}）
            </MotionButton>
          )}
          <div className="flex gap-2 text-[9px] font-bold">
            {Object.entries(RARITY_INFO).map(([k, v]) => (
              <span key={k} className="text-white px-2 py-0.5 rounded-full" style={{ background: v.color }}>{v.label}{k === 'N' ? ' でやすい' : k === 'UR' ? ' ちょうレア' : ''}</span>
            ))}
          </div>
          <div className="w-full grid grid-cols-4 gap-2 mt-1">
            {gachaPool.map(({ category, item }) => {
              const owned = (stats.inventory[category] || []).includes(item.id);
              const r = getRarity(item);
              return (
                <div key={item.id} className={`relative flex flex-col items-center p-1.5 rounded-xl border-2 ${owned ? 'bg-[var(--bg)] border-[var(--text)]' : 'bg-[var(--panel)] border-gray-200'}`}>
                  <span className="absolute -top-1.5 -right-1.5 text-[8px] font-black text-white px-1.5 rounded-full" style={{ background: RARITY_INFO[r].color }}>{RARITY_INFO[r].label}</span>
                  <div className={`text-2xl ${owned ? '' : 'grayscale opacity-40'}`}>{owned ? item.char : '❓'}</div>
                  <div className="text-[8px] font-bold text-[var(--text)] text-center leading-tight truncate w-full">{owned ? item.name : '？？？'}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] flex-grow p-3 overflow-y-auto grid grid-cols-3 gap-3 content-start shadow-sm">
          {SHOP_ITEMS[tab].map(item => {
            const isOwned = stats.inventory[tab].includes(item.id);
            const isEquipped = tab === 'themes' ? stats.theme === item.id : stats.equipped[tab.slice(0, -1)] === item.id;
            const rarity = getRarity(item);
            const isLocked = !isOwned && item.lv && level < item.lv;
            const isGachaOnly = item.gacha && !isOwned;
            return (
              <div key={item.id} onClick={() => handleItemClick(item, tab)} className={`relative flex flex-col items-center p-2 rounded-xl border-[3px] cursor-pointer transition-transform active:scale-95 ${isEquipped ? 'bg-[var(--accent)] border-[var(--text)]' : isOwned ? 'bg-[var(--bg)] border-[var(--text)] opacity-80' : 'bg-[var(--panel)] border-gray-200 grayscale hover:grayscale-0'}`}>
                {rarity !== 'N' && <span className="absolute -top-1.5 -right-1.5 text-[8px] font-black text-white px-1.5 py-px rounded-full z-10" style={{ background: RARITY_INFO[rarity].color }}>{RARITY_INFO[rarity].label}</span>}
                <div className="text-3xl mb-1 h-10 flex items-center justify-center">
                  {tab === 'themes'
                    ? (item.c ? <div className="flex gap-0.5">{item.c.map((col, i) => <span key={i} className="w-4 h-4 rounded-full border-2 border-[var(--text)]" style={{ background: col }} />)}</div> : <PaintBucket size={28} className={isEquipped ? 'text-[var(--text)]' : 'text-gray-400'} />)
                    : isGachaOnly ? '❓' : isLocked ? '🔒' : item.char}
                </div>
                <div className="text-[9px] font-bold text-[var(--text)] text-center leading-tight h-6 overflow-hidden">{isGachaOnly ? '？？？' : item.name}</div>
                <div className="mt-1 w-full text-center">
                  {isOwned
                    ? <span className="text-[10px] font-bold bg-[var(--text)] text-[var(--panel)] px-2 py-0.5 rounded-full">{isEquipped ? 'そうび中' : 'もってる'}</span>
                    : isGachaOnly
                      ? <span className="text-[10px] font-bold text-[var(--text)] bg-[var(--bg)] border border-[var(--text)] px-1.5 py-0.5 rounded-full">🥚ガチャ</span>
                      : isLocked
                        ? <span className="text-[10px] font-bold text-[var(--text)] bg-[var(--bg)] border border-[var(--text)] px-1.5 py-0.5 rounded-full">🔒Lv.{item.lv}</span>
                        : <span className="text-[10px] font-bold text-[var(--on-accent)] bg-[var(--accent)] border border-[var(--text)] px-1.5 py-0.5 rounded-full flex items-center justify-center gap-0.5"><Coins size={10} />{item.price}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <MotionButton className="bg-[var(--text)] text-[var(--panel)] w-full py-4 mt-4 shrink-0 border-[3px] border-[var(--text)]" onClick={() => setView('home')}>もどる</MotionButton>
    </div>
  );
};

// --- ドリル(コース)の複数選択リスト ---
// プルダウン1択の代わりに、タップで ON/OFF できるチェックリスト。
// 学年フィルタで隠れているぶんも含めて、えらんだドリルは下のチップ行でいつでも一覧・解除できる
const CourseMultiSelect = ({ filteredGroups, allGroups, selected, setSelected, masteredSet = new Set() }) => {
  const toggle = (name) => {
    audioCtrl.playSE('click');
    setSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };
  const visibleNames = filteredGroups.map(g => g.name);
  const allVisibleSelected = visibleNames.length > 0 && visibleNames.every(n => selected.includes(n));
  const toggleAllVisible = () => {
    audioCtrl.playSE('click');
    setSelected(prev => allVisibleSelected ? prev.filter(n => !visibleNames.includes(n)) : [...new Set([...prev, ...visibleNames])]);
  };
  const groupOf = (name) => allGroups.find(g => g.name === name);
  const totalCount = selected.reduce((sum, name) => sum + (groupOf(name)?.count || 0), 0);

  return (
    <div>
      <div className="flex items-end justify-between mb-1 gap-2">
        <label className="font-bold text-sm text-[var(--text)] opacity-80">ドリル（タップで えらぶ・いくつでもOK）</label>
        {visibleNames.length > 0 && (
          <button onClick={toggleAllVisible} className="shrink-0 text-xs font-bold px-3 py-1 rounded-full border-2 border-[var(--text)] bg-[var(--bg)] text-[var(--text)] active:scale-95 transition-transform touch-manipulation">
            {allVisibleSelected ? 'ぜんぶ はずす' : 'ぜんぶ えらぶ'}
          </button>
        )}
      </div>
      <div className="border-[3px] border-[var(--text)] rounded-xl bg-[var(--bg)] overflow-hidden">
        <div className="max-h-52 overflow-y-auto p-2 flex flex-col gap-1.5">
          {filteredGroups.length === 0 && <p className="text-center font-bold text-sm text-[var(--text)] opacity-80 py-4">該当するコースがありません</p>}
          {filteredGroups.map(g => {
            const on = selected.includes(g.name);
            return (
              <button key={g.name} onClick={() => toggle(g.name)} aria-pressed={on}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border-2 text-left transition-colors touch-manipulation ${on ? 'bg-[var(--accent)] border-[var(--text)]' : 'bg-[var(--panel)] border-transparent'}`}>
                <span className={`w-6 h-6 shrink-0 rounded flex items-center justify-center border-2 transition-colors ${on ? 'bg-[var(--secondary)] border-[var(--secondary)]' : 'bg-[var(--panel)] border-[var(--text)]'}`}>
                  {on && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                </span>
                <span className="flex-grow font-bold text-sm text-[var(--text)] truncate">{g.displayName || g.name}</span>
                {masteredSet.has(g.name) && <span className="shrink-0 text-[10px] font-black bg-[var(--accent)] text-[var(--on-accent)] border-2 border-[var(--text)] rounded-full px-1.5 py-0.5">⭐マスター</span>}
                <span className="shrink-0 text-xs font-bold text-[var(--text)] opacity-80">{g.count}問</span>
              </button>
            );
          })}
        </div>
        <div className="border-t-2 border-dashed border-[var(--text)] bg-[var(--panel)] p-2 flex items-center gap-1.5 flex-wrap min-h-[44px]">
          {selected.length === 0 ? (
            <span className="font-bold text-xs text-[var(--text)] opacity-80 px-1">ドリルを えらんでね</span>
          ) : (
            <>
              <span className="shrink-0 font-black text-xs bg-[var(--text)] text-[var(--panel)] rounded-full px-2.5 py-1">{selected.length}こ / {totalCount}問</span>
              {selected.map(name => (
                <button key={name} onClick={() => toggle(name)} className="flex items-center gap-1 max-w-[160px] text-xs font-bold bg-[var(--bg)] border-2 border-[var(--text)] rounded-full pl-2.5 pr-1.5 py-0.5 active:scale-95 transition-transform touch-manipulation">
                  <span className="truncate">{groupOf(name)?.displayName || name}</span>
                  <XCircle size={14} className="shrink-0 opacity-60" />
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// えらんだドリル(複数)の問題をまとめて集める。mistakes はにがて克服ボックス
const collectProblems = (names) => names.flatMap(name => (name === 'mistakes' ? StorageAPI.getMistakes() : StorageAPI.getProblemsByGroup(name)) || []);
const joinCourseNames = (names) => names.map(n => n === 'mistakes' ? 'にがて克服ボックス' : n).join('、');

// --- 設定・スタート画面 ---
const SingleConfigView = ({ setView, setState, configMode, stats }) => {
  const [groups, setGroups] = useState([]); const [selectedGroups, setSelectedGroups] = useState([]); const [time, setTime] = useState(3); const [isShuffle, setIsShuffle] = useState(true); const [selectedGrade, setSelectedGrade] = useState('すべて');
  const grades = ['すべて', '1年', '2年', '3年', '4年', '5年', '6年', 'その他'];
  const mistakesCount = StorageAPI.getMistakes().length;

  // マスター済みコースと今日の周回状況（選ぶ前に「減るよ」を知らせるための情報）
  const masteredSet = new Set(Object.keys(stats?.courseStats || {}).filter(n => stats.courseStats[n].mastered));
  const todayCounts = (stats?.repeat && stats.repeat.date === new Date().toLocaleDateString()) ? stats.repeat.counts : {};
  const realSelected = realCoursesOf(selectedGroups);
  const allSelectedMastered = realSelected.length > 0 && realSelected.every(n => masteredSet.has(n));
  const maxRepeatPlays = realSelected.length > 0 ? Math.max(...realSelected.map(n => todayCounts[n] || 0)) : 0;
  const previewRepeatMult = maxRepeatPlays < DECAY.REPEAT_SCHEDULE.length ? DECAY.REPEAT_SCHEDULE[maxRepeatPlays] : DECAY.REPEAT_FLOOR;
  // おすすめ: 学習順(groups は courseCompare 順)で、まだマスターしていない最初のドリル
  const recommend = groups.find(g => g.name !== 'mistakes' && !masteredSet.has(g.name) && !selectedGroups.includes(g.name));

  const filteredGroups = groups.filter(g => {
    if (g.name === 'mistakes') return true;
    if (selectedGrade === 'すべて') return true;
    if (selectedGrade === 'その他') return !/^[1-6]年/.test(g.name);
    return g.name.startsWith(selectedGrade);
  });

  useEffect(() => { const list = StorageAPI.getProblemGroups(); if (mistakesCount > 0) list.unshift({ name: 'mistakes', count: mistakesCount, displayName: '★ にがて克服ボックス' }); setGroups(list); }, []);

  const start = () => {
    if (selectedGroups.length === 0) return showToast('warning', 'ドリルを選んでください');
    let probs = collectProblems(selectedGroups);
    if (probs.length === 0) return showToast('error', '問題がありません');
    if (isShuffle) probs = [...probs].sort(() => Math.random() - 0.5);
    if (configMode === 'TIME_ATTACK') probs = probs.slice(0, 20);

    setState({
      timeLimitSec: configMode === 'SCORE_ATTACK' ? time * 60 : 0,
      problemSet: probs.map(p => ({ q: p.q, a: String(p.a).split('|') })),
      courseName: joinCourseNames(selectedGroups),
      courseNames: [...selectedGroups],
      gameMode: configMode
    });
    setView('game');
  };

  return (
    <div>
      <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] shadow-[4px_4px_0_rgba(0,0,0,0.1)] p-5 flex flex-col gap-4">
        <h3 className="font-black text-2xl text-center mb-1 text-[var(--text)] flex items-center justify-center gap-2">
          {configMode === 'SCORE_ATTACK' && <><Award size={28} className="text-[var(--accent)]" /> スコアアタック</>}
          {configMode === 'TIME_ATTACK' && <><Timer size={28} className="text-[var(--secondary-d)]" /> タイムアタック</>}
          {configMode === 'SUDDEN_DEATH' && <><Swords size={28} className="text-[var(--primary-d)]" /> サドンデス</>}
        </h3>

        <div>
          <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-80 ruby-text"><R c="学" r="がく" /><R c="年" r="ねん" /></label>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar sm:flex-wrap sm:overflow-visible sm:pb-0">
            {grades.map(grade => <button key={grade} onClick={() => { audioCtrl.playSE('click'); setSelectedGrade(grade); }} className={`px-4 py-2 rounded-full whitespace-nowrap font-bold text-sm border-2 transition-colors flex-shrink-0 ${selectedGrade === grade ? 'bg-[var(--text)] border-[var(--text)] text-[var(--panel)] shadow-sm' : 'bg-[var(--bg)] border-transparent text-[var(--text)]'}`}>{grade}</button>)}
          </div>
        </div>

        <CourseMultiSelect filteredGroups={filteredGroups} allGroups={groups} selected={selectedGroups} setSelected={setSelectedGroups} masteredSet={masteredSet} />

        {(allSelectedMastered || maxRepeatPlays >= 2) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-[var(--bg)] border-2 border-dashed border-[var(--text)] rounded-xl p-3 text-sm font-bold text-[var(--text)] flex flex-col gap-2">
            {allSelectedMastered && (
              <p className="ruby-text">⭐このドリルはもうマスターしたよ！つぎのドリルに<R c="挑" r="ちょう" /><R c="戦" r="せん" />するとEXPがいっぱいもらえるよ！</p>
            )}
            {maxRepeatPlays >= 2 && (
              <p>🔁きょう {maxRepeatPlays + 1}かいめだよ。もらえるEXPは {Math.round(previewRepeatMult * 100)}% になるよ。</p>
            )}
            {recommend && (
              <button onClick={() => { audioCtrl.playSE('click'); setSelectedGroups([recommend.name]); }}
                className="self-start flex items-center gap-1.5 text-xs font-black bg-[var(--accent)] border-2 border-[var(--text)] rounded-full px-3 py-1.5 active:scale-95 transition-transform touch-manipulation">
                👉つぎのおすすめ: <span className="max-w-[180px] truncate">{recommend.name}</span>
              </button>
            )}
          </motion.div>
        )}

        {configMode === 'SCORE_ATTACK' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
            <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-80 flex justify-between ruby-text"><span><R c="制" r="せい" /><R c="限" r="げん" /><R c="時" r="じ" /><R c="間" r="かん" /></span><span className="text-[var(--primary-d)] text-lg">{time} <R c="分" r="ふん" /></span></label>
            <input type="range" min="1" max="10" value={time} onChange={e => setTime(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[var(--primary)]" />
          </motion.div>
        )}

        <div className="flex items-center gap-3 bg-[var(--bg)] p-3 rounded-xl border border-[var(--text)] cursor-pointer" onClick={() => { audioCtrl.playSE('click'); setIsShuffle(!isShuffle); }}>
          <div className={`w-6 h-6 rounded flex items-center justify-center border-2 transition-colors ${isShuffle ? 'bg-[var(--secondary)] border-[var(--secondary)]' : 'bg-[var(--panel)] border-[var(--text)]'}`}>
            {isShuffle && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
          </div>
          <label className="font-bold text-sm text-[var(--text)] select-none cursor-pointer">問題をランダムに出題する</label>
        </div>

        <div className="mt-2 space-y-3">
          <MotionButton className="bg-[var(--primary)] text-[var(--panel)] w-full py-4 text-xl border-[3px] border-[var(--text)]" onClick={start}><Gamepad2 size={24} /> スタート！</MotionButton>
          <button className="text-[var(--text)] opacity-80 font-bold text-sm py-2 w-full hover:opacity-100 transition" onClick={() => { audioCtrl.playSE('click'); setView('home') }}>もどる</button>
        </div>
      </div>
    </div>
  );
};

// 毎秒の時刻更新を内部に閉じ込め、GameView 本体を再レンダーさせないための時計表示コンポーネント
const TimerClock = React.memo(({ gameMode, startTime, timeLimitSec }) => {
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    let id; let last = -1;
    const tick = () => {
      const now = Date.now();
      const sec = Math.floor((now - startTime) / 1000);
      if (sec !== last) { last = sec; setCurrentTime(now); }
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [startTime]);
  const elapsedSec = Math.floor((currentTime - startTime) / 1000);
  const remainSec = Math.max(0, timeLimitSec - elapsedSec);
  const isCountdown = gameMode === 'SCORE_ATTACK' || gameMode === 'BOSS_RAID' || gameMode === 'TERRITORY';
  const displaySec = isCountdown ? remainSec : elapsedSec;
  const m = Math.floor(displaySec / 60).toString().padStart(2, '0');
  const s = (displaySec % 60).toString().padStart(2, '0');
  const danger = isCountdown && remainSec <= 10;
  return (
    <div className={`font-black text-2xl flex items-center gap-2 ${danger ? 'text-red-500 animate-pulse' : 'text-[var(--text)]'}`}><Clock size={24} /> {m}:{s}</div>
  );
});

// 上部の進捗バー。SCORE_ATTACK のみ毎秒tickし、時間切れで onTimeUp を呼ぶ（GameView 本体は tick で再レンダーしない）
const TimerProgressBar = React.memo(({ gameMode, startTime, timeLimitSec, correctCount, total, onTimeUp }) => {
  const isScoreAttack = gameMode === 'SCORE_ATTACK' || gameMode === 'BOSS_RAID' || gameMode === 'TERRITORY'; // 残り時間でtickするモード
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const onTimeUpRef = useRef(onTimeUp);
  useEffect(() => { onTimeUpRef.current = onTimeUp; }, [onTimeUp]);
  useEffect(() => {
    if (!isScoreAttack) return;
    let id; let last = -1;
    const tick = () => {
      const now = Date.now();
      const sec = Math.floor((now - startTime) / 1000);
      if (sec !== last) { last = sec; setCurrentTime(now); }
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [isScoreAttack, startTime]);
  const elapsedSec = Math.floor((currentTime - startTime) / 1000);
  const remainSec = Math.max(0, timeLimitSec - elapsedSec);
  useEffect(() => { if (isScoreAttack && remainSec <= 0) onTimeUpRef.current?.(); }, [isScoreAttack, remainSec]);
  const progress = isScoreAttack ? (remainSec / timeLimitSec) * 100 : (correctCount / total) * 100;
  return (
    <div className="h-2 w-full bg-[var(--text)] opacity-20 shrink-0 relative overflow-hidden">
      <motion.div className="h-full w-full absolute top-0 left-0 origin-left bg-[var(--primary)] z-10" animate={{ scaleX: Math.max(0, Math.min(1, progress / 100)), backgroundColor: (isScoreAttack && remainSec <= 10) ? '#ef4444' : 'var(--primary)' }} transition={{ ease: 'linear', duration: 0.2 }} />
    </div>
  );
});

// --- ゲーム画面 ---
const GameView = ({ state, setState, setView, stats, setStats, peerState, setPeerState, setResumeData, raidState, sendRaidAttack, sendRaidSupport, collectRaidResult, terrState, sendTerrCharge, sendTerrTarget, sendTerrSpecial, collectTerritoryResult }) => {
  const isMultiplayer = peerState && peerState.role;
  const isRaid = state.gameMode === 'BOSS_RAID';
  const isTerritory = state.gameMode === 'TERRITORY';
  const resumeSnapshot = (!isMultiplayer && state.resumeSnapshot) ? state.resumeSnapshot : null;

  const [score, setScore] = useState(resumeSnapshot?.score || 0);
  const [combo, setCombo] = useState(resumeSnapshot?.combo || 0);
  const [maxCombo, setMaxCombo] = useState(resumeSnapshot?.maxCombo || 0);
  const [qIndex, setQIndex] = useState(resumeSnapshot?.qIndex || 0);
  const [ans, setAns] = useState('');
  const [correctCount, setCorrectCount] = useState(resumeSnapshot?.correctCount || 0);
  const [startTime] = useState(() => Date.now() - (resumeSnapshot?.elapsedMs || 0));
  const [showMemo, setShowMemo] = useState(false); const [memoPosition, setMemoPosition] = useState('right');
  const [showTools, setShowTools] = useState(false);
  const canvasRef = useRef(null); const [fever, setFever] = useState(false); const [cardAnim, setCardAnim] = useState({});
  const mistakesRef = useRef(resumeSnapshot?.mistakes ? [...resumeSnapshot.mistakes] : []);
  // 正答率の算出用。mistakesRef はにがて克服で途中除去されるため、別カウンタで数える
  const wrongCountRef = useRef(resumeSnapshot?.wrongCount || 0);
  const isResumedSessionRef = useRef(!!resumeSnapshot);
  const [quitDialog, setQuitDialog] = useState(false);

  // --- 学習ログ（study.v1）---
  // 端末に保存するだけで、外部へは一切送信しない。氏名などの識別情報も持たない。
  // 記録に失敗してもゲームは止めない（studyLog.js 側で握りつぶす）。
  const studyRef = useRef(null);
  useEffect(() => {
    const session = createStudySession({
      gameMode: state.gameMode,
      courseName: state.courseName,
      courseNames: state.courseNames,
      multiplayer: !!isMultiplayer,
      // タイムアタックは出題数が決まっている。中断からの復帰時は「のこりの分」が今回のレコードになる
      plannedCount: state.gameMode === 'TIME_ATTACK'
        ? Math.max(0, state.problemSet.length - (resumeSnapshot?.correctCount || 0))
        : null,
    });
    studyRef.current = session;
    session.present(state.problemSet[resumeSnapshot?.qIndex || 0]?.q);
    return () => { session.dispose(); studyRef.current = null; };
  }, []);

  // タブを離れたまま5分もどらなかったら、離れた時刻で1レコードを締める（中断）。
  // 待っていた5分を学習時間に含めないため、endedAtMs には「離れた時刻」を渡す
  useEffect(() => {
    let awayTimer = null;
    const onVisibility = () => {
      if (document.hidden) {
        const hiddenAt = Date.now();
        awayTimer = setTimeout(() => {
          if (!gameEndedRef.current) studyRef.current?.save({ status: 'aborted', endedAtMs: hiddenAt, ext: { maxCombo: maxComboRef.current } });
        }, STUDY_ABORT_AWAY_MS);
      } else if (awayTimer) {
        clearTimeout(awayTimer); awayTimer = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); if (awayTimer) clearTimeout(awayTimer); };
  }, []);

  // ページが破棄される直前にレコードを確定する。
  // Chromebook ではメモリ不足やスリープでタブごと消されることがあり、上の5分タイマーも
  // 一緒に消えるため、これがないと記録中のぶんが丸ごと失われる。
  // beforeunload はモバイルや bfcache 経路で発火しないことがあるので pagehide を使う。
  // 保存後は次のレコードが自動的に始まるので、bfcache から戻って学習が続いても取りこぼさない。
  useEffect(() => {
    const onPageHide = () => {
      if (gameEndedRef.current) return; // 結果画面へ進んだぶんは finishGame で保存ずみ
      studyRef.current?.save({ status: 'aborted', ext: { maxCombo: maxComboRef.current } });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // 「戻る」: どうぐ → メモ → やめる確認ダイアログ の順にとじる。
  // ゲーム中はいきなりホームへもどさず、かならず確認ダイアログを出す(とちゅうの記録を守るため)。
  useBackHandler(showTools, () => { audioCtrl.playSE('click'); setShowTools(false); return true; }, BACK_PRIORITY.overlay);
  useBackHandler(quitDialog, () => { audioCtrl.playSE('click'); setQuitDialog(false); return true; }, BACK_PRIORITY.overlay);
  useBackHandler(showMemo, () => { audioCtrl.playSE('click'); setShowMemo(false); return true; }, BACK_PRIORITY.panel);
  useBackHandler(true, () => { audioCtrl.playSE('click'); setQuitDialog(true); return true; }, BACK_PRIORITY.view);

  const participantsList = isMultiplayer ? Object.entries(peerState.participants || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.score - a.score) : [];
  const top5 = participantsList.slice(0, 5);

  // --- ボスバトル用 ---
  const myId = peerState?.role === 'host' ? peerState.hostId : (peerState?.peer ? peerState.peer.id : null);
  const myDebuffs = useRaidDebuffs(isRaid ? raidState : null, myId);
  const shuffleDebuff = myDebuffs.find(d => d.kind === 'shuffle');
  const digitLayout = isRaid && shuffleDebuff ? makeShuffledLayout(shuffleDebuff.shuffleSeed) : undefined;
  const [cheerGauge, setCheerGauge] = useState(0);
  const mySupportsRef = useRef(0);
  const defeatedRef = useRef(0);
  useEffect(() => { if (raidState) defeatedRef.current = raidState.defeated || 0; }, [raidState?.defeated]);
  // 入力ガードはイベントハンドラから呼ばれるため ref 経由で最新の raidState を参照する
  const raidStateRef = useRef(raidState);
  useEffect(() => { raidStateRef.current = raidState; }, [raidState]);
  const isRaidLocked = () => isRaid && raidInputLocked(raidStateRef.current, myId);

  // --- じんとりバトル用 ---
  const myTeam = isTerritory ? terrState?.teams?.[myId]?.team : null;
  const terrStateRef = useRef(terrState);
  useEffect(() => { terrStateRef.current = terrState; }, [terrState]);
  const [terrTarget, setTerrTarget] = useState(null);
  const terrTargetRef = useRef(terrTarget);
  useEffect(() => { terrTargetRef.current = terrTarget; }, [terrTarget]);

  // ねらいが未選択・ぬり終わった・うばわれ済みになったら、まずは「となりのマス」へ自動でねらい直す
  useEffect(() => {
    if (!isTerritory || !terrState?.cells || !myTeam) return;
    if (terrTarget != null && isSelectable(terrState.cells, terrTarget, myTeam)) return;
    const next = pickNearTarget(terrState.cells, myTeam, terrTarget);
    setTerrTarget(next);
    if (next != null) sendTerrTarget?.(next);
  }, [isTerritory, terrState, myTeam, terrTarget, sendTerrTarget]);

  const selectTerrTarget = useCallback((idx) => {
    audioCtrl.playSE('click');
    setTerrTarget(idx);
    sendTerrTarget?.(idx);
  }, [sendTerrTarget]);

  // --- じんとり: スペシャル / インクラッシュ / ラストスパート ---
  const [specialGauge, setSpecialGauge] = useState(0);
  const specialGaugeRef = useRef(0);
  const [specialKind, setSpecialKind] = useState(() => rollSpecial());
  const [rushUntil, setRushUntil] = useState(0);
  const rushUntilRef = useRef(0);
  const lastSpurtRef = useRef(false);
  const [lastSpurt, setLastSpurt] = useState(false);

  // --- じんとり: おうえんキャラクター「ペンキー」のきもち ---
  // まちがえた時こく(missAt)・盤面イベント・コンボ・のこり時間から、表情とセリフが決まる
  const [terrMissAt, setTerrMissAt] = useState(0);
  const { mood: terrMood, line: terrLine } = useTerritoryMood({
    terrState: isTerritory ? terrState : null,
    myTeam,
    combo,
    lastSpurt,
    rushActive: rushUntil > Date.now(),
    missAt: terrMissAt,
  });

  const startRush = useCallback(() => {
    const until = Date.now() + TERRITORY_CONSTANTS.RUSH_MS;
    rushUntilRef.current = until;
    setRushUntil(until);
  }, []);

  const fireTerrSpecial = useCallback((kind) => {
    if (specialGaugeRef.current < TERRITORY_CONSTANTS.SPECIAL_MAX) return;
    audioCtrl.playSE('click');
    specialGaugeRef.current = 0;
    setSpecialGauge(0);
    setSpecialKind(rollSpecial()); // つぎのスペシャルは何が出るかおたのしみ
    if (kind === 'rush') startRush();
    sendTerrSpecial?.(kind, terrTargetRef.current);
  }, [sendTerrSpecial, startRush]);

  const handleSpurtCue = useCallback((cue) => {
    if (cue === 'spurt') { audioCtrl.playSE('roar'); audioCtrl.vibrate([80, 60, 80]); }
    else if (cue === 'tick') audioCtrl.playSE('tick', 1);
  }, []);
  const handleSpurtChange = useCallback((active) => { lastSpurtRef.current = active; setLastSpurt(active); }, []);

  // じんとりイベントへのローカル反応(効果音・ラッキーマスのごほうび受け取り)
  const terrSeenEvents = useRef(new Set());
  useEffect(() => {
    if (!isTerritory) return;
    (terrState?.events || []).forEach(ev => {
      if (terrSeenEvents.current.has(ev.id)) return;
      terrSeenEvents.current.add(ev.id);
      switch (ev.kind) {
        case 'capture':
          if (ev.team === myTeam) audioCtrl.playSE('coin');
          else if (ev.steal) audioCtrl.playSE('wrong');
          break;
        case 'chain':
          audioCtrl.playSE('combo', 8);
          if (ev.team === myTeam) triggerConfetti({ particleCount: 45, spread: 80, origin: { y: 0.4 }, colors: [TEAMS[ev.team].color, '#ffffff'], zIndex: 9999 });
          break;
        case 'lucky':
          audioCtrl.playSE('lucky');
          // ？マスをとった本人へのごほうび(スペシャル満タン / ラッシュ)はこの端末で反映する
          if (ev.to && ev.to === myId) {
            if (ev.effect === 'special') { specialGaugeRef.current = TERRITORY_CONSTANTS.SPECIAL_MAX; setSpecialGauge(TERRITORY_CONSTANTS.SPECIAL_MAX); }
            if (ev.effect === 'rush') startRush();
          }
          break;
        case 'special':
          audioCtrl.playSE('special');
          break;
        case 'lead':
          audioCtrl.playSE('roar'); audioCtrl.vibrate([60, 40, 60]);
          break;
        case 'board_full':
          audioCtrl.playSE('combo', 10);
          break;
        default: break;
      }
    });
  }, [isTerritory, terrState?.events, myTeam, myId, startRush]);

  // レイドイベントへのローカル反応(効果音・立て直し時のコンボリセット)
  const lastEventAtRef = useRef(0);
  useEffect(() => {
    const ev = raidState?.lastEvent;
    if (!isRaid || !ev || ev.at === lastEventAtRef.current) return;
    lastEventAtRef.current = ev.at;
    if (ev.kind === 'boss_defeated') { audioCtrl.playSE('combo', 10); audioCtrl.playSE('coin'); triggerConfetti({ particleCount: 110, spread: 110, origin: { y: 0.4 }, zIndex: 9999 }); }
    if (ev.kind === 'team_down') { audioCtrl.playSE('boom'); setCombo(0); }
    if (ev.kind === 'support') { audioCtrl.playSE('coin'); }
    if (ev.kind === 'boss_enter') { audioCtrl.playSE('roar'); }
    if (ev.kind === 'boss_enrage') { audioCtrl.playSE('roar'); audioCtrl.vibrate([80, 60, 80, 60, 160]); }
    if (ev.kind === 'boss_shield') { audioCtrl.playSE('guard'); }
    if (ev.kind === 'boss_drain') { audioCtrl.playSE('boom'); }
    if (ev.kind === 'bomb_blast') { audioCtrl.playSE('boom'); setCombo(0); }
    if (ev.kind === 'bomb_defused') { audioCtrl.playSE('coin'); triggerConfetti({ particleCount: 40, spread: 70, origin: { y: 0.5 }, zIndex: 9999 }); }
  }, [isRaid, raidState?.lastEvent]);

  // ボスの攻撃が自分に当たった瞬間の効果音
  const lastAttackAtRef = useRef(0);
  useEffect(() => {
    const atk = raidState?.lastAttack;
    if (!isRaid || !atk || atk.at === lastAttackAtRef.current) return;
    lastAttackAtRef.current = atk.at;
    const hitsMe = atk.targets === 'all' || (Array.isArray(atk.targets) && atk.targets.includes(myId));
    if (atk.kind === 'hp' || atk.kind === 'drain') audioCtrl.playSE('boom');
    else if (hitsMe) audioCtrl.playSE('wrong');
  }, [isRaid, raidState?.lastAttack]);

  // 「ためている…！」の予兆に合わせてチャージ音を鳴らす(1回の予兆につき1度だけ)
  const lastTelegraphRef = useRef(0);
  useEffect(() => {
    if (!isRaid || !raidState?.telegraphAt) return;
    const at = raidState.telegraphAt;
    if (at === lastTelegraphRef.current) return;
    const delay = at - Date.now();
    if (delay < -400) return;
    lastTelegraphRef.current = at;
    const id = setTimeout(() => audioCtrl.playSE('charge'), Math.max(0, delay));
    return () => clearTimeout(id);
  }, [isRaid, raidState?.telegraphAt]);

  // ボスの攻撃・撃破に合わせた画面ゆれ
  const raidShake = useRaidShake(raidState, isRaid);

  const fireSupport = useCallback(() => {
    audioCtrl.playSE('coin');
    setCheerGauge(0);
    mySupportsRef.current += 1;
    sendRaidSupport?.();
  }, [sendRaidSupport]);

  useEffect(() => { setFever(combo >= 5); }, [combo]);

  // スコアの定期送信
  useEffect(() => {
    if (peerState && peerState.role === 'client' && peerState.conn) {
      safeSend(peerState.conn, { type: 'score_update', data: { score, combo } });
    } else if (peerState && peerState.role === 'host' && setPeerState) {
      // ホストのスコアを参加者リストに反映し、全クライアントにブロードキャスト
      setPeerState(p => {
        if (!p.hostId || !p.participants[p.hostId]) return p;
        const newP = { ...p, participants: { ...p.participants, [p.hostId]: { ...p.participants[p.hostId], score, combo } } };
        sendToApproved(newP, { type: 'participants_update', data: newP.participants });
        return newP;
      });
    }
  }, [score, combo, peerState?.role, setPeerState]);

  const scoreRef = useRef(score); useEffect(() => { scoreRef.current = score; }, [score]);
  const maxComboRef = useRef(maxCombo); useEffect(() => { maxComboRef.current = maxCombo; }, [maxCombo]);
  const correctCountRef = useRef(correctCount); useEffect(() => { correctCountRef.current = correctCount; }, [correctCount]);
  const gameEndedRef = useRef(false);

  const finishGame = useCallback((quitEarly = false) => {
    // 盤面うまりの早期終了とタイマー満了が重なっても、集計・EXP付与を二重に行わない
    if (gameEndedRef.current) return;
    gameEndedRef.current = true;
    if (mistakesRef.current.length > 0) StorageAPI.addMistakes(mistakesRef.current);

    let newStats = { ...stats };
    newStats.maxComboRecord = Math.max(newStats.maxComboRecord || 0, maxComboRef.current);
    const exactElapsedSec = Number(((Date.now() - startTime) / 1000).toFixed(1));
    const isTimeAttackCleared = state.gameMode === 'TIME_ATTACK' && !quitEarly && correctCountRef.current >= state.problemSet.length;

    if (isTimeAttackCleared) {
      const rec = newStats.timeAttackRecord || 9999; if (exactElapsedSec < rec || rec === 0) newStats.timeAttackRecord = exactElapsedSec;
    }
    if (state.gameMode === 'SUDDEN_DEATH') { newStats.suddenDeathRecord = Math.max(newStats.suddenDeathRecord || 0, correctCountRef.current); }
    if (state.gameMode === 'BOSS_RAID') { newStats.bossRaidRecord = Math.max(newStats.bossRaidRecord || 0, defeatedRef.current); }

    let baseExp = scoreRef.current;
    if (state.gameMode === 'TIME_ATTACK') {
      // クリアボーナスは問題数に比例させる（数問だけの小コースを秒でクリアして大量EXPを得る悪用の防止。20問=満額）
      const sizeScale = Math.min(1, state.problemSet.length / 20);
      baseExp = isTimeAttackCleared ? Math.round((1000 + Math.max(0, Math.floor(120 - exactElapsedSec) * 10)) * sizeScale) : correctCountRef.current * 50;
    }
    if (state.gameMode === 'SUDDEN_DEATH') baseExp = correctCountRef.current * 50;
    // ボスバトル: 自分の与ダメージ(score) + チームの撃破数 + 自分のおうえん回数。チーム成果が全員のEXPに入る
    if (state.gameMode === 'BOSS_RAID') baseExp = Math.round(scoreRef.current * 0.5 + defeatedRef.current * 100 + mySupportsRef.current * 30);
    // じんとり: 自分のぬり回数(score) + チームの勝敗ボーナス
    if (state.gameMode === 'TERRITORY') {
      const s = terrStateRef.current?.scores || { red: 0, blue: 0 };
      const won = myTeam && s[myTeam] > s[otherTeam(myTeam)];
      const draw = myTeam && s[myTeam] === s[otherTeam(myTeam)];
      // ぬり回数はフィーバー/ラッシュ/ラストスパートで増えるため、1ぬりあたりの係数は控えめにする
      baseExp = scoreRef.current * 18 + (won ? 400 : draw ? 250 : 150);
      if (won) newStats.territoryWins = (newStats.territoryWins || 0) + 1;
    }

    // 報酬減衰: ソロモードのみ。マルチ(ボスバトル・じんとり)はリーダーがコースを決めるため対象外
    const isDecayMode = !isMultiplayer && state.gameMode !== 'BOSS_RAID' && state.gameMode !== 'TERRITORY';
    const session = { correctCount: correctCountRef.current, wrongCount: wrongCountRef.current, elapsedSec: exactElapsedSec, gameMode: state.gameMode };
    // 減衰は「今セッションを記録する前」の状態で計算する（その日の1・2回目は満額のまま）
    const decay = isDecayMode ? computeRewardDecay(newStats, state.courseNames, session) : { mult: 1, masteredApplied: false, repeatPlays: 0, repeatMult: 1 };
    const earnedExp = baseExp > 0 ? Math.max(1, Math.round(baseExp * decay.mult)) : 0;
    const masteryResult = isDecayMode ? recordCourseSession(newStats, state.courseNames, session) : { newlyMastered: null };

    // 減衰の強いセッション(半額未満)は「あそぶ系」ミッションの進捗にも数えない
    newStats = StorageAPI.updateDailyAndMissions(newStats, earnedExp, maxComboRef.current, 1, state.gameMode, correctCountRef.current, decay.mult >= 0.5 ? 1 : 0);

    // レベルアップしたらコインボーナスを付与（上がったレベル数 × 50コイン）
    const levelBefore = getLevelInfo(stats.totalExp).level;
    const levelAfter = getLevelInfo(newStats.totalExp).level;
    const levelUpCoins = levelAfter > levelBefore ? (levelAfter - levelBefore) * 50 : 0;
    if (levelUpCoins > 0) newStats.coins = (newStats.coins || 0) + levelUpCoins;

    StorageAPI.saveStats(newStats); setStats(newStats);

    // 学習ログ（study.v1）。「ポイントもらって終わる」で切りあげたときは中断として残す。
    // マルチプレイは妨害・盤面戦略があるため学力指標に使えないが、取り組み量として記録する
    studyRef.current?.save({
      status: quitEarly ? 'aborted' : 'completed',
      ext: {
        maxCombo: maxComboRef.current,
        level: getLevelInfo(newStats.totalExp).level,
        score: baseExp,
        ...(state.gameMode === 'BOSS_RAID' ? { bossDefeated: defeatedRef.current > 0, bossDefeatedCount: defeatedRef.current, supports: mySupportsRef.current } : {}),
        ...(state.gameMode === 'TERRITORY' ? { paints: scoreRef.current } : {}),
      },
    });

    // ボスバトル/じんとり: ホストが権威データから最終結果を確定し、結果画面と全クライアントに配る
    const raidResult = (state.gameMode === 'BOSS_RAID' && peerState && peerState.role === 'host' && collectRaidResult) ? collectRaidResult() : null;
    const territoryResult = (state.gameMode === 'TERRITORY' && peerState && peerState.role === 'host' && collectTerritoryResult) ? collectTerritoryResult() : null;

    setState(prev => ({ ...prev, finalScore: baseExp, finalCombo: maxComboRef.current, finalTime: exactElapsedSec, finalCorrect: correctCountRef.current, earnedExp, previousExp: stats.totalExp, levelUpCoins, mistakes: mistakesRef.current, resumeSnapshot: null, decayInfo: { mult: decay.mult, mastered: decay.masteredApplied, repeatPlays: decay.repeatPlays, baseExp, newlyMastered: masteryResult.newlyMastered }, ...(raidResult ? { raidResult } : {}), ...(territoryResult ? { territoryResult } : {}) }));

    if (isResumedSessionRef.current) {
      StorageAPI.clearResume();
      if (setResumeData) setResumeData(null);
      isResumedSessionRef.current = false;
    }

    // 終了通知
    if (peerState && peerState.role === 'client' && peerState.conn) {
      safeSend(peerState.conn, { type: 'game_finish', data: { finalScore: baseExp } });
    } else if (peerState && peerState.role === 'host') {
      // ホストが終了した場合、全クライアントにも終了を通知
      sendToApproved(peerState, { type: 'game_finish', data: raidResult ? { raidResult } : territoryResult ? { territoryResult } : undefined });
    }

    setView('result');
  }, [stats, state.gameMode, state.problemSet, state.courseNames, startTime, setStats, setState, setView, peerState, setResumeData, collectRaidResult, collectTerritoryResult, myTeam]);

  // じんとり: 盤面がうまっても試合はつづく(ここからは全マスのうばいあい)。終了はつねに制限時間ちょうど

  const pauseAndExit = useCallback(() => {
    const snapshot = {
      problemSet: state.problemSet,
      timeLimitSec: state.timeLimitSec,
      courseName: state.courseName,
      courseNames: state.courseNames || [],
      gameMode: state.gameMode,
      qIndex,
      score: scoreRef.current,
      combo,
      maxCombo: maxComboRef.current,
      correctCount: correctCountRef.current,
      wrongCount: wrongCountRef.current,
      elapsedMs: Date.now() - startTime,
      mistakes: mistakesRef.current,
      savedAt: Date.now()
    };
    // 学習ログ: 中断としてここまでを1レコードで締める。
    // 復帰後は新しいレコードを始めるため、このレコードに追記はしない（§5.4）
    studyRef.current?.save({
      status: 'aborted',
      ext: { maxCombo: maxComboRef.current, level: getLevelInfo(stats.totalExp).level, score: scoreRef.current },
    });

    StorageAPI.saveResume(snapshot);
    if (setResumeData) setResumeData(snapshot);
    showToast('success', 'とちゅうから保存しました');
    setState(prev => ({ ...prev, resumeSnapshot: null }));
    setView('home');
  }, [state.problemSet, state.timeLimitSec, state.courseName, state.courseNames, state.gameMode, qIndex, combo, startTime, stats, setState, setView, setResumeData]);

  const submitAns = useCallback(() => {
    if (!ans || isRaidLocked()) return; const q = state.problemSet[qIndex];
    const normalizedAns = normalizeStr(ans);
    const isCorrect = q.a.some(correctStr => normalizeStr(correctStr) === normalizedAns);

    // 学習ログ: 初回正答（firstTryCorrect）を出すため、正解・誤答の両方を1回の解答として数える
    studyRef.current?.answer(isCorrect, ans);

    setAnswerAnnounce(isCorrect ? 'せいかい' : 'ちがうよ、もういちど');

    if (isCorrect) {
      // じんとりでは正解音を「インクをぬる音」に差しかえて、ぬった手ごたえを出す
      const newC = combo + 1; audioCtrl.playSE(isTerritory ? 'splat' : 'correct'); if (newC > 1) audioCtrl.playSE('combo', newC);
      if (newC === 5) studyRef.current?.markFever();
      if (newC % 10 === 0) triggerConfetti({ particleCount: 50, spread: 60, origin: { y: 0.8 }, zIndex: 9999 });
      if (isRaid) {
        // 正解=ボスへの攻撃。score は与ダメージ累計として既存のスコア同期をそのまま使う
        const cheerActive = (raidStateRef.current?.cheerUntil || 0) > Date.now();
        // のろい(与ダメージ半減) / ボスのバリア(半減) を反映する
        const dmg = calcRaidDamage(newC, cheerActive, raidDamageMods(raidStateRef.current, myId));
        setScore(s => s + dmg);
        sendRaidAttack?.(dmg, newC);
        setCheerGauge(g => Math.min(RAID_CONSTANTS.GAUGE_MAX, g + (newC >= 5 ? 2 : 1)));
      } else if (isTerritory) {
        // 正解=ねらっているマスへのぬり。フィーバー(5コンボ)×ラッシュ(3ばい)×ラストスパート(2ばい)で一気に増える
        const base = newC >= 5 ? TERRITORY_CONSTANTS.FEVER_CHARGE : 1;
        const rushMult = rushUntilRef.current > Date.now() ? TERRITORY_CONSTANTS.RUSH_MULT : 1;
        const spurtMult = lastSpurtRef.current ? TERRITORY_CONSTANTS.LAST_SPURT_MULT : 1;
        const amount = Math.min(12, base * rushMult * spurtMult);
        setScore(s => s + amount);
        sendTerrCharge?.(terrTargetRef.current, amount, newC);
        // スペシャルゲージ。満タンになった瞬間だけ知らせる
        const prevG = specialGaugeRef.current;
        const nextG = Math.min(TERRITORY_CONSTANTS.SPECIAL_MAX, prevG + (newC >= 5 ? TERRITORY_CONSTANTS.SPECIAL_FEVER_GAIN : 1));
        specialGaugeRef.current = nextG;
        setSpecialGauge(nextG);
        if (prevG < TERRITORY_CONSTANTS.SPECIAL_MAX && nextG >= TERRITORY_CONSTANTS.SPECIAL_MAX) { audioCtrl.playSE('coin'); audioCtrl.vibrate([40, 40, 80]); }
      } else {
        setScore(s => s + 100 + (combo * 10));
      }
      setCombo(newC); setMaxCombo(m => Math.max(m, newC));
      setCorrectCount(c => c + 1);
      setCardAnim({ scale: [1, 1.05, 1], boxShadow: ["0 8px 0 var(--text)", "0 0 20px var(--secondary)", "0 8px 0 var(--text)"], transition: { duration: 0.3 } });
      setAns(''); canvasRef.current?.clear();

      // にがて克服ボックスの問題は、正解した時点でボックスから取り除く（同セッション内で先に間違えていても、最後に正解すれば克服とみなす）
      // courseName は複数ドリル選択時に「、」区切りで連結されるため includes で判定する
      if ((state.courseName || '').includes('にがて克服ボックス')) {
        StorageAPI.removeMistakes([{ q: q.q }]);
        mistakesRef.current = mistakesRef.current.filter(m => m.q !== q.q);
      }

      if (state.gameMode === 'TIME_ATTACK' && correctCount + 1 >= state.problemSet.length) { setTimeout(finishGame, 500); }
      else {
        const nextIndex = (qIndex + 1) % state.problemSet.length;
        setQIndex(nextIndex);
        // 同じ式が何度も出題されうるため、出題ごとに1件ずつ数える（§2.10）
        studyRef.current?.present(state.problemSet[nextIndex]?.q);
      }
    } else {
      audioCtrl.playSE('wrong'); setCombo(0); wrongCountRef.current += 1;
      if (isTerritory) setTerrMissAt(Date.now()); // ペンキーが「ドンマイ！」と はげましてくれる
      setCardAnim({ x: [-15, 15, -10, 10, 0], boxShadow: ["0 8px 0 var(--text)", "0 0 20px var(--primary)", "0 8px 0 var(--text)"], transition: { duration: 0.4 } });
      setAns(''); mistakesRef.current.push({ q: q.q, a: q.a.join('|') });
      if (state.gameMode === 'SUDDEN_DEATH') setTimeout(finishGame, 500);
    }
  }, [ans, qIndex, combo, correctCount, state.problemSet, state.gameMode, state.courseName, finishGame]);

  // 正解の瞬間に自動で次の問題へ進む
  useEffect(() => {
    if (!ans) return;
    const q = state.problemSet[qIndex];
    if (!q) return;
    const normalizedAns = normalizeStr(ans);
    const isCorrect = q.a.some(correctStr => normalizeStr(correctStr) === normalizedAns);
    if (isCorrect) submitAns();
  }, [ans]);

  useEffect(() => {
    const handleKey = (e) => {
      if (quitDialog) return; // ダイアログ表示中は背後のゲームに入力を流さない
      if (isRaidLocked()) return; // ボスの凍結攻撃・撃破演出中は物理キーボードもロック
      const key = e.key;
      if ((key >= '0' && key <= '9') || ['.', '/', '-', '(', ')'].includes(key)) { audioCtrl.playSE('click'); setAns(a => (a.length < 15 ? a + key : a)); }
      else if (key === 'Backspace') { audioCtrl.playSE('click'); setAns(a => a.slice(0, -1)); }
      else if (key === 'Enter') { e.preventDefault(); submitAns(); }
      else if (key === 'Escape' || key === 'Delete' || key.toLowerCase() === 'c') { audioCtrl.playSE('click'); setAns(''); }
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [submitAns, quitDialog]);

  // キーパッドへ渡す安定コールバック（submitAns は ref 経由で最新を参照し、Keypad の memo を維持する）
  const submitAnsRef = useRef(submitAns); useEffect(() => { submitAnsRef.current = submitAns; }, [submitAns]);
  const isRaidLockedRef = useRef(isRaidLocked); useEffect(() => { isRaidLockedRef.current = isRaidLocked; });
  const handleAppend = useCallback((c) => { if (isRaidLockedRef.current()) return; audioCtrl.playSE('click'); setAns(a => (a.length < 15 ? a + c : a)); }, []);
  const handleClear = useCallback(() => { audioCtrl.playSE('click'); setAns(''); }, []);
  // どうぐを開いて解いた問題は、自力で解いたのとは分けて記録する（hint: true）。
  // ext.tools は教師が読む値なので、内部IDではなく画面と同じ名前で残す
  const handleToolUse = useCallback((toolId) => {
    studyRef.current?.markTool(TOOL_META[toolId]?.label || toolId);
  }, []);
  const handleSubmit = useCallback(() => { submitAnsRef.current(); }, []);

  // ゲームに入ったらすぐ、どうぐの絵と紙ふぶきを裏で取ってくる。
  // 電球を押したとき・正解したときに待たされないようにするため。
  // 取れるまでパネルは出さない(toolsReady)ので、ちらつきも起きない
  // 正誤は「色＋形＋ことば」に加えて読み上げでも伝える（Part I §2-8, §4）。
  // 画面上は◯×とスコアの動きで分かるが、それだけだと目で追えない児童に届かない
  const [answerAnnounce, setAnswerAnnounce] = useState('');
  const [toolsReady, setToolsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    preloadConfetti();
    preloadLearningTools().then(() => { if (alive) setToolsReady(true); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const q = state.problemSet[qIndex] || { q: '?', a: ['?'] };
  const availableTools = getAvailableTools(state.courseName, q.q);

  const textLen = q.q.length;
  let fontSizeClass = "text-[5rem] md:text-8xl";
  if (textLen >= 25) { fontSizeClass = "text-xl md:text-3xl"; }
  else if (textLen >= 15) { fontSizeClass = "text-2xl md:text-5xl"; }
  else if (textLen >= 8) { fontSizeClass = "text-4xl md:text-6xl"; }

  return (
    <div
      className="absolute inset-0 w-full h-[100dvh] flex flex-col z-10 overflow-hidden bg-[var(--bg)] pb-[env(safe-area-inset-bottom)]"
      style={raidShake}
    >
      {/* フィーバー演出: 毎フレーム合成が走る全画面アニメーションは、手書きパッドを開いている間は無効化して描画性能を優先する */}
      {fever && !showMemo && (
        <motion.div
          className="absolute inset-0 bg-[var(--panel)] pointer-events-none z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.55, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />
      )}
      {state.gameMode !== 'SUDDEN_DEATH' && (
        <TimerProgressBar gameMode={state.gameMode} startTime={startTime} timeLimitSec={state.timeLimitSec} correctCount={correctCount} total={state.problemSet.length} onTimeUp={finishGame} />
      )}

      {/* ボスバトル: ランキングの代わりにボスパネルを表示 */}
      {isRaid && <BossPanel raidState={raidState} compact={showMemo} />}

      {/* じんとり: ランキングの代わりにチームスコアバーを表示 */}
      {isTerritory && <TerritoryScoreBar terrState={terrState} myTeam={myTeam} lastSpurt={lastSpurt} />}

      {/* ランキング表示（メインレイアウトの外に配置） */}
      {!isRaid && !isTerritory && isMultiplayer && top5.length > 0 && (
        <div className="flex justify-center gap-2 p-2 overflow-x-auto no-scrollbar shrink-0 w-full bg-[var(--panel)] border-b-2 border-[var(--text)] shadow-sm">
          {top5.map((p, idx) => (
            <div key={p.id} className="bg-[var(--bg)] border-2 border-[var(--text)] rounded-lg px-3 py-1.5 flex flex-col items-center min-w-[80px]">
              <div className="flex items-center gap-1">
                <span className={`text-xs font-black px-1.5 py-0.5 rounded-sm ${idx === 0 ? 'bg-yellow-400 text-white' : idx === 1 ? 'bg-gray-400 text-white' : idx === 2 ? 'bg-orange-400 text-white' : 'text-[var(--text)] opacity-80'}`}>{idx + 1}</span>
                <span className="text-xs font-bold truncate max-w-[60px]"><PupilName name={p.name} /></span>
              </div>
              <span className="text-base text-[var(--primary-d)] font-black">{p.score}<span className="text-[10px] ml-0.5 opacity-60">pt</span></span>
            </div>
          ))}
        </div>
      )}

      <div className={`flex-grow flex flex-col ${memoPosition === 'right' ? 'md:flex-row' : 'md:flex-row-reverse'} overflow-y-auto md:overflow-hidden relative w-full h-full`}>

        {/* じんとり: 盤面を問題エリアと並べて常時表示する(モバイルは上段・PCは左カラム)。手書きメモ使用中はモバイルのみ盤面をたたむ */}
        {isTerritory && (
          <div className={`shrink-0 w-full md:h-full md:order-first border-b-2 md:border-b-0 md:border-r-2 border-[var(--text)] bg-[var(--panel)] p-2 flex-col items-center justify-center relative ${showMemo ? 'hidden md:flex md:w-[240px]' : 'flex md:w-[340px]'}`}>
            <div className="h-[27vh] md:h-auto md:w-full md:flex-grow md:min-h-0 flex items-center justify-center gap-1 w-full">
              <TerritoryBoard terrState={terrState} myTeam={myTeam} myId={myId} targetIdx={terrTarget} onSelect={selectTerrTarget} lastSpurt={lastSpurt} />
              {/* おうえんキャラクター(モバイル): 盤面は 27vh の正方形なので、あまった横のすきまに ならべて置く */}
              <TerritoryCharacter mood={terrMood} line={terrLine} team={myTeam} bubbleClassName="max-w-[104px] text-[8px]" className="w-20 shrink-0 md:hidden" />
            </div>
            <TerritoryRushBadge until={rushUntil} />
            {/* おうえんキャラクター(PC): 盤面の下にゆったり出す */}
            <TerritoryCharacter mood={terrMood} line={terrLine} team={myTeam} bubbleClassName="max-w-[230px] text-[11px]" className="hidden md:flex w-32 shrink-0 mt-1" />
            <p className="shrink-0 text-[10px] font-bold text-[var(--text)] opacity-80 mt-1 text-center">タップで ねらうマスを えらぼう（<R c="数" r="すう" /><R c="字" r="じ" />＝あと<R c="何" r="なん" /><R c="回" r="かい" />で ぬれる／？＝ラッキーマス）</p>
          </div>
        )}

        <div className={`flex flex-col flex-shrink-0 transition-all duration-300 ${showMemo ? 'w-full md:w-[400px] min-h-[85vh] md:min-h-0 border-b md:border-b-0 md:border-r border-[var(--text)]' : `w-full ${isTerritory ? 'md:flex-grow md:w-auto max-w-4xl' : 'max-w-4xl h-full'} mx-auto`} md:h-full p-4`}>

          <div className="flex justify-between items-center mb-2 shrink-0 gap-2">
            <button onClick={() => { audioCtrl.playSE('click'); setQuitDialog(true); }} className="shrink-0 bg-[var(--panel)] text-[var(--text)] border-2 border-[var(--text)] rounded-lg px-3 min-h-[44px] font-bold text-xs shadow-[0_2px_0_var(--text)] active:translate-y-[1px] active:shadow-none flex items-center justify-center gap-1"><XCircle size={16} /> やめる</button>
            <TimerClock gameMode={state.gameMode} startTime={startTime} timeLimitSec={state.timeLimitSec} />
            <div className="font-black text-2xl text-[var(--primary-d)] flex items-center gap-2 drop-shadow-sm">
              {state.gameMode === 'TIME_ATTACK' ? <>{correctCount} / {state.problemSet.length} <R c="問" r="もん" /></> : state.gameMode === 'SUDDEN_DEATH' ? <>{correctCount} <R c="問" r="もん" /><R c="正" r="せい" /><R c="解" r="かい" /></> : state.gameMode === 'BOSS_RAID' ? <>⚔ {score} <span className="text-sm text-[var(--text)] opacity-80">ダメージ</span></> : state.gameMode === 'TERRITORY' ? <>🖌 {score} <span className="text-sm text-[var(--text)] opacity-80">ぬり</span></> : <>{score} <span className="text-sm text-[var(--text)] opacity-80">pt</span></>}
            </div>
          </div>

          <div className={`relative flex-grow flex flex-col justify-center items-center ${isTerritory ? 'min-h-[90px] mb-2 md:min-h-[150px] md:mb-4' : 'min-h-[150px] mb-4'}`}>
            <div className="absolute top-0 h-10 flex justify-center items-center w-full">
              <AnimatePresence>
                {combo > 1 && <motion.div initial={{ scale: 0, y: 10 }} animate={{ scale: [0, 1.3, 1], y: 0, rotate: -6 }} exit={{ scale: 0 }} className="bg-[var(--accent)] text-[var(--on-accent)] border-2 border-[var(--text)] rounded-full px-4 py-1.5 font-black text-sm shadow-[2px_2px_0_var(--text)] z-30">{combo} COMBO! 🔥</motion.div>}
              </AnimatePresence>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={qIndex} initial={{ opacity: 0, x: 50, scale: 0.8 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -50, scale: 0.8 }} transition={{ type: "spring", stiffness: 300, damping: 25 }} className={`${fontSizeClass} font-black text-[var(--text)] text-center drop-shadow-sm w-full break-words px-2 leading-tight`}>
                {/* ボスの「かがみ文字」デバフ中は問題文だけを左右反転させる(motion側のtransformと衝突しないよう内側のdivで掛ける) */}
                <div className="w-full" style={isRaid ? { transform: raidProblemTransform(myDebuffs), transition: 'transform 0.35s' } : undefined}>
                  <MathText text={q.q} />
                </div>
              </motion.div>
            </AnimatePresence>
            {/* ボスの妨害デバフ(問題隠し・くらやみ)を問題の上に重ねる */}
            {isRaid && <ProblemDebuffOverlay debuffs={myDebuffs} />}
            {/* おうえんボタン: 正解でゲージが貯まり、満タンで仲間の回復+デバフ解除+ダメージ2倍 */}
            {isRaid && <SupportButton gauge={cheerGauge} onFire={fireSupport} />}
            {/* スペシャルボタン: 正解でゲージが貯まり、満タンでねらったマスに必殺技を発動 */}
            {isTerritory && <TerritorySpecialButton gauge={specialGauge} kind={specialKind} onFire={fireTerrSpecial} />}
          </div>

          <motion.div animate={cardAnim} className={`bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-2xl flex items-center justify-center shadow-[0_8px_0_var(--text)] relative z-30 shrink-0 ${isTerritory ? 'h-16 mb-2 md:h-24 md:mb-4' : 'h-24 mb-4'}`}>
            {/* onClick で開閉する(onPointerDown だと、開いた直後に指を離したときの合成 click が
                最前面のオーバーレイに当たって即閉じてしまい、長押ししないと開けない挙動になる) */}
            {availableTools.length > 0 && (
              <motion.button whileTap={{ scale: 0.8 }} className={`absolute left-4 w-14 h-14 rounded-full flex items-center justify-center border-[3px] border-[var(--text)] shadow-sm transition-colors z-40 touch-manipulation ${showTools ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'bg-[var(--bg)] text-[var(--text)] opacity-80'}`} onClick={() => { audioCtrl.playSE('click'); setShowTools(s => !s); }} aria-label="かんがえるどうぐ">
                <Lightbulb size={24} />
              </motion.button>
            )}
            <span className="text-5xl font-black text-[var(--secondary-d)] tracking-widest">{ans || <span className="text-4xl font-bold text-[var(--text)] opacity-20">?</span>}</span>
            {showMemo && <motion.button whileTap={{ scale: 0.8 }} className="absolute right-20 w-12 h-12 rounded-full hidden md:flex items-center justify-center border-[3px] border-[var(--text)] shadow-sm bg-[var(--panel)] text-[var(--text)] z-40 transition-colors" onPointerDown={(e) => { e.preventDefault(); audioCtrl.playSE('click'); setMemoPosition(p => p === 'right' ? 'left' : 'right'); }}><ArrowLeftRight size={20} /></motion.button>}
            <motion.button whileTap={{ scale: 0.8 }} className={`absolute right-4 w-14 h-14 rounded-full flex items-center justify-center text-2xl border-[3px] border-[var(--text)] shadow-sm transition-colors z-40 ${showMemo ? 'bg-[var(--secondary)] text-[var(--panel)]' : 'bg-[var(--bg)] text-[var(--text)] opacity-80'}`} onPointerDown={(e) => { e.preventDefault(); audioCtrl.playSE('click'); setShowMemo(!showMemo); }}><PenTool size={24} /></motion.button>
          </motion.div>

          <div className="relative flex-grow flex flex-col">
            <Keypad onAppend={handleAppend} onClear={handleClear} onSubmit={handleSubmit} digitLayout={digitLayout} />
            {isRaid && <FreezeOverlay debuffs={myDebuffs} />}
          </div>
        </div>

        {/* min-h-0/min-w-0: canvas の固有サイズが flex の min-content 経由でレイアウトを押し広げないようにする */}
        {/* data-back-swipe-ignore: 手書きメモの上でのなぞり書きを「戻る」スワイプとまちがえないようにする */}
        <div data-back-swipe-ignore className={`w-full md:flex-grow relative transition-all duration-300 h-[500px] md:h-full flex-shrink-0 md:flex-shrink min-h-0 min-w-0 p-4 md:p-6 flex flex-col gap-2 ${showMemo ? 'opacity-100 flex' : 'hidden opacity-0'}`}>
          <div className="flex-grow relative min-h-0 min-w-0">
            <HandWritingCanvas ref={canvasRef} />
          </div>
        </div>
      </div>

      {/* 画面には出さず、読み上げにだけ渡す。assertive にしないのは
          連続で解いたときに前の読み上げを切ってしまわないようにするため */}
      <div aria-live="polite" role="status" className="sr-only">{answerAnnounce}</div>

      {toolsReady && (
        <Suspense fallback={null}>
          <LearningToolPanel open={showTools} onClose={() => { audioCtrl.playSE('click'); setShowTools(false); }} courseName={state.courseName} qText={q.q} onFx={() => audioCtrl.playSE('click')} onToolUse={handleToolUse} />
        </Suspense>
      )}

      {/* ボスバトルの全画面イベント演出(撃破・新ボス登場・たてなおし・おうえん・げきおこ・バクダン) */}
      {isRaid && <RaidEventOverlay lastEvent={raidState?.lastEvent} />}

      {/* ボスバトルの画面ふち演出(被弾フラッシュ・技名カットイン・げきおこ・時限爆弾) */}
      {isRaid && <RaidScreenFx raidState={raidState} debuffs={myDebuffs} />}

      {/* じんとりの全画面イベント演出(うばい・れんさ・ラッキーマス・スペシャル・ぎゃくてん・盤面うまり) */}
      {isTerritory && <TerritoryEventOverlay events={terrState?.events} />}

      {/* じんとりのラストスパート演出(のこり30秒で ぬり2ばい / のこり5秒のカウントダウン) */}
      {isTerritory && state.timeLimitSec > 0 && (
        <TerritoryLastSpurtFx startTime={startTime} timeLimitSec={state.timeLimitSec} onCue={handleSpurtCue} onSpurtChange={handleSpurtChange} />
      )}

      <AnimatePresence>
        {quitDialog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} role="dialog" aria-modal="true" aria-label="とちゅうで やめるかの かくにん" exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-sm flex flex-col items-center text-center">
              <XCircle size={48} className="text-[var(--primary-d)] mb-3" />
              <h3 className="font-black text-xl text-[var(--text)] mb-2 ruby-text"><R c="途" r="と" /><R c="中" r="ちゅう" />で やめますか？</h3>
              <p className="text-sm text-[var(--text)] opacity-80 mb-5 ruby-text">
                ここまでの<R c="正" r="せい" /><R c="解" r="かい" />: <span className="font-black text-[var(--primary-d)]">{correctCount}<R c="問" r="もん" /></span>
                {state.gameMode === 'SCORE_ATTACK' && <> ／ スコア: <span className="font-black text-[var(--primary-d)]">{score}pt</span></>}
                {state.gameMode === 'BOSS_RAID' && <> ／ <R c="与" r="あた" />えたダメージ: <span className="font-black text-[var(--primary-d)]">⚔{score}</span></>}
                {state.gameMode === 'TERRITORY' && <> ／ ぬった<R c="回" r="かい" /><R c="数" r="すう" />: <span className="font-black text-[var(--primary-d)]">🖌{score}</span></>}
              </p>
              <div className="flex flex-col w-full gap-2">
                <MotionButton className="bg-[var(--primary)] text-[var(--panel)] border-[3px] border-[var(--text)] py-3 w-full ruby-text" onClick={() => { setQuitDialog(false); finishGame(true); }}>
                  <Award size={18} /> ポイントもらって<R c="終" r="お" />わる
                </MotionButton>
                {!isMultiplayer && (
                  <MotionButton className="bg-[var(--secondary)] text-[var(--panel)] border-[3px] border-[var(--text)] py-3 w-full ruby-text" onClick={() => { setQuitDialog(false); pauseAndExit(); }}>
                    <Clock size={18} /> <R c="中" r="ちゅう" /><R c="断" r="だん" />して<R c="保" r="ほ" /><R c="存" r="ぞん" />
                  </MotionButton>
                )}
                <MotionButton className="bg-[var(--bg)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 w-full" onClick={() => { audioCtrl.playSE('click'); setQuitDialog(false); }}>
                  つづける
                </MotionButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- リザルト画面 (おさらいレポート付き) ---
const ResultView = ({ state, setView, peerState, leaveRoom }) => {
  const oldExp = state.previousExp || 0; const earnedExp = state.earnedExp || 0; const newExp = oldExp + earnedExp;
  const oldInfo = getLevelInfo(oldExp); const newInfo = getLevelInfo(newExp);
  const mistakes = state.mistakes || [];
  const [showLevelUp, setShowLevelUp] = useState(false);

  const isMultiplayer = peerState && peerState.role;
  const participantsList = isMultiplayer ? Object.entries(peerState.participants || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.score - a.score) : [];
  const myId = peerState.role === 'host' ? peerState.hostId : (peerState.peer ? peerState.peer.id : null);
  const myRank = isMultiplayer && myId ? participantsList.findIndex(p => p.id === myId) + 1 : null;
  const top5 = participantsList.slice(0, 5);

  useEffect(() => {
    triggerConfetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, colors: ['#FF6B6B', '#4ECDC4', '#FFE66D'] });
    // 新しくマスターしたら、ごほうびとしてお祝いする（マスターは達成であってペナルティではない）
    if (state.decayInfo?.newlyMastered) {
      setTimeout(() => {
        audioCtrl.playSE('combo', 10);
        triggerConfetti({ particleCount: 100, spread: 100, startVelocity: 35, origin: { y: 0.5 }, shapes: ['star'], colors: ['#FFD700', '#FFA500'], zIndex: 9999 });
        showToast('success', `⭐「${state.decayInfo.newlyMastered}」をマスターしたよ！すごい！`);
      }, 600);
    }
    setTimeout(() => {
      if (newInfo.level > oldInfo.level) {
        audioCtrl.playSE('combo', 10); audioCtrl.playSE('coin'); setShowLevelUp(true);
        triggerConfetti({ particleCount: 120, spread: 120, startVelocity: 40, origin: { y: 0.5 }, shapes: ['star'], colors: ['#FFD700', '#FFA500', '#FFE66D'], zIndex: 9999 });
      }
    }, 1000);
  }, []);

  return (
    <div className="flex flex-col min-h-[80vh] py-4 relative">
      <AnimatePresence>
        {showLevelUp && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: 50 }}
            transition={{ type: "spring", bounce: 0.5 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--bg)]/80 backdrop-blur-sm rounded-[20px] m-4"
          >
            <div className="bg-[var(--panel)] border-[4px] border-[var(--accent)] p-8 rounded-3xl text-center shadow-2xl flex flex-col items-center w-full max-w-sm">
              <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", bounce: 0.6, delay: 0.1 }} className="text-7xl mb-4">{newInfo.badge}</motion.div>
              <h3 className="text-3xl font-black text-[var(--text)] mb-2">レベルアップ！</h3>
              <p className="text-xl font-bold text-[var(--primary-d)] mb-3">Lv.{oldInfo.level} <span className="opacity-50">→</span> Lv.{newInfo.level} {newInfo.title}</p>
              {(state.levelUpCoins || 0) > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="flex items-center gap-1.5 bg-[var(--accent)] border-2 border-[var(--text)] rounded-full px-4 py-1.5 font-black text-[var(--on-accent)] mb-6">
                  <Coins size={18} /> ボーナス +{state.levelUpCoins} コイン！
                </motion.div>
              )}
              <MotionButton className="bg-[var(--accent)] text-[var(--on-accent)] w-full py-3 text-lg border-[3px] border-[var(--text)]" onClick={() => setShowLevelUp(false)}>やったー！</MotionButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.h2 initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.6 }} className="font-black text-5xl text-center mb-4 text-[var(--primary-d)] shrink-0">
        {state.gameMode === 'SUDDEN_DEATH' ? <span className="text-[var(--text)] ruby-text"><HeartCrack size={40} className="inline mr-2 text-red-500 mb-2" /><R c="終" r="しゅう" /><R c="了" r="りょう" />！</span> : state.gameMode === 'BOSS_RAID' ? '👑 バトルしゅうりょう！' : state.gameMode === 'TERRITORY' ? '🚩 じんとり しゅうりょう！' : '🎉 FINISH!'}
      </motion.h2>

      {isMultiplayer && state.gameMode === 'BOSS_RAID' && state.raidResult ? (
        <RaidResultPanel raidResult={state.raidResult} myId={myId} />
      ) : isMultiplayer && state.gameMode === 'TERRITORY' && state.territoryResult ? (
        <TerritoryResultPanel territoryResult={state.territoryResult} myId={myId} />
      ) : isMultiplayer && participantsList.length > 0 ? (
        <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] p-4 w-full mb-6 shrink-0 relative overflow-hidden flex flex-col items-center shadow-[4px_4px_0_var(--text)]">
          <h3 className="font-black text-xl mb-6 text-[var(--text)] flex items-center gap-2 ruby-text"><Trophy size={24} className="text-yellow-400" /> <R c="最" r="さい" /><R c="終" r="しゅう" />ランキング</h3>

          <div className="flex items-end justify-center gap-2 h-36 w-full mb-6 px-2">
            {top5[1] && (
              <div className="flex flex-col items-center w-1/4 h-full justify-end">
                <span className="font-bold text-xs sm:text-sm truncate w-full text-center"><PupilName name={top5[1].name} /></span>
                <span className="font-black text-base sm:text-lg text-[var(--secondary-d)] mb-1">{top5[1].score}<span className="text-[10px] ml-0.5">pt</span></span>
                <div className="w-full bg-gray-300 h-[60%] rounded-t-lg border-2 border-[var(--text)] border-b-0 flex justify-center pt-2 font-black text-xl text-white shadow-inner">2</div>
              </div>
            )}
            {top5[0] && (
              <div className="flex flex-col items-center w-1/3 h-full justify-end">
                <span className="font-bold text-sm sm:text-base truncate w-full text-center"><PupilName name={top5[0].name} /></span>
                <span className="font-black text-lg sm:text-2xl text-[var(--primary-d)] mb-1">{top5[0].score}<span className="text-xs ml-0.5">pt</span></span>
                <div className="w-full bg-yellow-400 h-[85%] rounded-t-lg border-2 border-[var(--text)] border-b-0 flex justify-center pt-2 font-black text-3xl text-white shadow-inner">1</div>
              </div>
            )}
            {top5[2] && (
              <div className="flex flex-col items-center w-1/4 h-full justify-end">
                <span className="font-bold text-xs sm:text-sm truncate w-full text-center"><PupilName name={top5[2].name} /></span>
                <span className="font-black text-base sm:text-lg text-[var(--text)] opacity-80 mb-1">{top5[2].score}<span className="text-[10px] ml-0.5">pt</span></span>
                <div className="w-full bg-orange-300 h-[40%] rounded-t-lg border-2 border-[var(--text)] border-b-0 flex justify-center pt-2 font-black text-lg text-white shadow-inner">3</div>
              </div>
            )}
          </div>

          {top5.length > 3 && (
            <div className="flex flex-wrap justify-center gap-2 w-full">
              {top5.slice(3, 5).map((p, i) => (
                <div key={p.id} className="flex gap-2 items-center bg-[var(--bg)] px-3 py-2 rounded-lg border-2 border-[var(--text)]">
                  <span className="font-black text-gray-500 text-sm">#{i + 4}</span>
                  <span className="font-bold text-sm max-w-[80px] truncate"><PupilName name={p.name} /></span>
                  <span className="font-black text-base">{p.score}<span className="text-[10px] ml-0.5">pt</span></span>
                </div>
              ))}
            </div>
          )}

          {myRank && myRank > 0 && (
            <div className="mt-4 pt-4 border-t-2 border-dashed border-gray-200 w-full text-center bg-[var(--bg)] rounded-xl p-3">
              <span className="font-bold text-[var(--text)] text-sm ruby-text">あなたの<R c="順" r="じゅん" /><R c="位" r="い" /> </span>
              <span className="font-black text-3xl text-[var(--primary-d)] ml-2">{myRank} <span className="text-lg ruby-text"><R c="位" r="い" /></span></span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-[4px_4px_0_var(--text)] p-6 text-center w-full mb-6 shrink-0 relative overflow-hidden">
          {state.gameMode === 'SCORE_ATTACK' && <><h4 className="text-[var(--text)] opacity-80 font-bold mb-1">SCORE</h4><div className="text-6xl font-black text-[var(--text)] mb-2">{state.finalScore || 0}</div></>}
          {state.gameMode === 'TIME_ATTACK' && <><h4 className="text-[var(--text)] opacity-80 font-bold mb-1">CLEAR TIME</h4><div className="text-6xl font-black text-[var(--secondary-d)] mb-2">{state.finalTime.toFixed(1)} <span className="text-2xl ruby-text"><R c="秒" r="びょう" /></span></div></>}
          {state.gameMode === 'SUDDEN_DEATH' && <><h4 className="text-[var(--text)] opacity-80 font-bold mb-1 ruby-text"><R c="連" r="れん" /><R c="続" r="ぞく" /><R c="正" r="せい" /><R c="解" r="かい" /><R c="数" r="すう" /></h4><div className="text-6xl font-black text-[var(--primary-d)] mb-2">{state.finalCorrect} <span className="text-2xl ruby-text"><R c="問" r="もん" /></span></div></>}

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="text-xl font-black text-[var(--secondary-d)] mb-4 flex flex-col items-center justify-center gap-1">
            <div className="flex items-center gap-1.5">
              ⬆ {earnedExp} EXP かくとく！
              {state.decayInfo && state.decayInfo.mult < 1 && <span className="text-sm font-bold opacity-50 line-through">{state.decayInfo.baseExp}</span>}
            </div>
            {state.decayInfo && state.decayInfo.mult < 1 && (
              <div className="text-xs font-bold text-[var(--text)] opacity-80 ruby-text px-2">
                {state.decayInfo.mastered
                  ? <>⭐もうマスターしたドリルだよ！つぎのドリルに<R c="挑" r="ちょう" /><R c="戦" r="せん" />するとEXPがいっぱいもらえるよ！</>
                  : <>🔁きょう{state.decayInfo.repeatPlays + 1}かいめだから EXPは{Math.round(state.decayInfo.mult * 100)}%だよ。ほかのドリルもやってみよう！</>}
              </div>
            )}
          </motion.div>
          <div className="inline-block bg-[var(--accent)] text-[var(--on-accent)] font-black px-5 py-2 rounded-full border-[3px] border-[var(--text)] shadow-sm">Max Combo: {state.finalCombo || 0}</div>

          {/* EXPバー: 獲得EXPがレベルにどれだけ近づいたかをその場でアニメーション表示する */}
          <div className="mt-5 text-left">
            <div className="flex justify-between items-end mb-1">
              <span className="font-black text-sm text-[var(--text)]">{newInfo.badge} Lv.{newInfo.level}</span>
              <span className="text-[10px] font-bold text-[var(--text)] opacity-80">NEXT: {Math.floor(newInfo.nextLevelExp - newExp)} pt</span>
            </div>
            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden border border-[var(--text)]">
              <motion.div initial={{ width: `${newInfo.level > oldInfo.level ? 0 : oldInfo.progress}%` }} animate={{ width: `${newInfo.progress}%` }} transition={{ delay: 0.8, duration: 1, ease: 'easeOut' }} className="h-full bg-[var(--secondary)]" />
            </div>
          </div>
        </div>
      )}

      {mistakes.length > 0 && (
        <div className="bg-[var(--panel)] border-[3px] border-[var(--primary)] rounded-[20px] p-4 mb-6 shrink-0 shadow-sm">
          <h4 className="font-black text-[var(--primary-d)] mb-3 flex items-center justify-center gap-2 ruby-text"><PenTool size={20} /> おさらい（まちがえた<R c="問" r="もん" /><R c="題" r="だい" />）</h4>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-2 no-scrollbar">
            {mistakes.map((m, i) => (
              <div key={i} className="flex justify-between items-center border-b-2 border-dashed border-[var(--bg)] pb-2">
                <span className="font-bold text-lg text-[var(--text)] tracking-wider">{m.q}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text)] opacity-80">▶</span>
                  <span className="font-black text-xl text-[var(--primary-d)]">{m.a.replace(/\|/g, ' または ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto shrink-0 pt-4">
        {isMultiplayer ? (
          <div className="flex flex-col gap-3">
            {peerState.role === 'host' && (
              <MotionButton className="bg-[var(--secondary)] text-[var(--panel)] w-full py-4 text-xl border-[3px] border-[var(--text)]" onClick={() => setView('hostRoom')}>
                <Users size={20} /> へやにもどってもう<R c="一" r="いっ" /><R c="回" r="かい" />あそぶ
              </MotionButton>
            )}
            {peerState.role === 'client' && (
              <div className="bg-[var(--accent)] border-[3px] border-[var(--text)] rounded-xl p-4 text-center font-bold text-[var(--on-accent)] ruby-text">
                リーダーの<R c="画" r="が" /><R c="面" r="めん" />がかわるまで<R c="待" r="ま" />っていてね
              </div>
            )}
            <MotionButton className="bg-[var(--panel)] text-[var(--text)] w-full py-3 text-lg border-[3px] border-[var(--text)] ruby-text" onClick={leaveRoom}>
              <Home size={20} /> ルームから<R c="退" r="たい" /><R c="出" r="しゅつ" />してホームへもどる
            </MotionButton>
          </div>
        ) : (
          <MotionButton className="bg-[var(--text)] w-full py-4 text-[var(--panel)] text-xl border-[3px] border-[var(--text)]" onClick={() => setView('home')}>
            <Home size={24} /> ホームへもどる
          </MotionButton>
        )}
      </div>
    </div>
  );
};

// --- 問題管理・共有画面 ---
const ManagerView = ({ setView }) => {
  const [groups, setGroups] = useState([]); const [selectedGrade, setSelectedGrade] = useState('すべて'); const [editTarget, setEditTarget] = useState(null); const [editName, setEditName] = useState(''); const [probs, setProbs] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const grades = ['すべて', '1年', '2年', '3年', '4年', '5年', '6年', 'その他'];
  const loadGroups = () => setGroups(StorageAPI.getProblemGroups());
  useEffect(() => { loadGroups(); }, []);

  // 「戻る」: 削除の確認 → コース編集 → (App側でコース一覧からホームへ) の順にもどる
  useBackHandler(confirmDelete, () => { audioCtrl.playSE('click'); setConfirmDelete(false); return true; }, BACK_PRIORITY.overlay);
  useBackHandler(editTarget !== null, () => { audioCtrl.playSE('click'); setEditTarget(null); return true; }, BACK_PRIORITY.view);

  const filteredGroups = groups.filter(g => { if (selectedGrade === 'すべて') return true; if (selectedGrade === 'その他') return !/^[1-6]年/.test(g.name); return g.name.startsWith(selectedGrade); });

  const openEdit = (name) => {
    setEditTarget(name); setEditName(name);
    if (name) { const res = StorageAPI.getProblemsByGroup(name); setProbs(res.length ? res.map(p => ({ q: p.q, a: String(p.a) })) : [{ q: '', a: '' }]); } else { setProbs(Array.from({ length: 3 }, () => ({ q: '', a: '' }))); }
  };
  const save = () => {
    if (!editName.trim()) return showToast('warning', '名前を入力してください');
    const valid = probs.filter(p => p.q.trim() && p.a.trim()); if (!valid.length) return showToast('warning', '問題を1つ以上入力してください');
    StorageAPI.saveProblemSet(editName.trim(), valid); if (editTarget && editTarget !== editName.trim()) StorageAPI.deleteProblemGroup(editTarget);
    showToast('success', '保存しました'); setEditTarget(null); loadGroups();
  };
  const executeDelete = () => {
    if (!editTarget) return;
    StorageAPI.deleteProblemGroup(editTarget);
    setEditTarget(null);
    setConfirmDelete(false);
    loadGroups();
    showToast('success', '削除しました');
  };

  const copyShareCode = (e, name) => {
    e.stopPropagation(); audioCtrl.playSE('click');
    const code = StorageAPI.encodeCourse(name, StorageAPI.getProblemsByGroup(name));

    const textArea = document.createElement("textarea");
    textArea.value = code;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('success', '共有コードをコピーしました！');
    } catch (err) {
      showToast('error', 'コピーに失敗しました');
    }
    document.body.removeChild(textArea);
  };

  if (editTarget !== null) {
    return (
      <div className="flex flex-col h-[80vh] relative">
        <AnimatePresence>
          {confirmDelete && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} role="dialog" aria-modal="true" aria-label="さくじょの かくにん" exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-xs flex flex-col items-center text-center">
                <Trash2 size={48} className="text-[var(--primary-d)] mb-3" />
                <h3 className="font-black text-xl text-[var(--text)] mb-6 leading-snug">「{editTarget}」を<br />本当に削除しますか？</h3>
                <div className="flex w-full gap-3">
                  <MotionButton className="bg-[var(--bg)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={() => { audioCtrl.playSE('click'); setConfirmDelete(false); }}>やめる</MotionButton>
                  <MotionButton className="bg-[var(--primary)] text-[var(--panel)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={() => { audioCtrl.playSE('click'); executeDelete(); }}>削除する</MotionButton>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex justify-between items-center mb-4 shrink-0"><h3 className="font-bold text-xl flex items-center gap-2 text-[var(--text)]"><Settings size={20} /> コース編集</h3>{editTarget && <button className="text-[var(--panel)] font-bold border-2 border-[var(--primary)] bg-[var(--primary)] rounded-xl px-4 py-1.5 text-sm" onClick={() => { audioCtrl.playSE('click'); setConfirmDelete(true); }}>削除</button>}</div>
        <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-xl p-2 mb-4 shrink-0 shadow-sm"><input type="text" className="w-full font-bold text-lg p-2 outline-none bg-transparent text-[var(--text)]" placeholder="コース名 (例: 1年_たしざん)" value={editName} onChange={e => setEditName(e.target.value)} /></div>
        <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-xl flex flex-col flex-grow overflow-hidden mb-4 shadow-sm">
          <div className="bg-[var(--bg)] flex p-3 border-b-2 border-[var(--text)] font-bold text-sm text-[var(--text)] opacity-80 shrink-0"><div className="flex-grow px-2">問題</div><div className="w-24 px-2 text-center border-l-2 border-[var(--text)]">答え</div><div className="w-12 border-l-2 border-[var(--text)]"></div></div>
          <div className="flex-grow overflow-y-auto">
            <AnimatePresence>
              {probs.map((p, i) => (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} key={i} className="flex border-b-2 border-dashed border-[var(--bg)] overflow-hidden">
                  <input type="text" className="flex-grow p-3 outline-none font-bold bg-transparent text-[var(--text)]" placeholder="問題" value={p.q} onChange={e => { const n = [...probs]; n[i] = { ...n[i], q: e.target.value }; setProbs(n); }} />
                  <input type="text" className="w-24 p-3 outline-none border-l-2 border-dashed border-[var(--bg)] text-center font-bold text-[var(--primary-d)] bg-transparent" placeholder="答え" value={p.a} onChange={e => { const n = [...probs]; n[i] = { ...n[i], a: e.target.value }; setProbs(n); }} />
                  <button className="w-12 border-l-2 border-dashed border-[var(--bg)] text-[var(--text)] opacity-80 hover:opacity-100 flex items-center justify-center transition-opacity" onClick={() => { audioCtrl.playSE('click'); setProbs(probs.filter((_, idx) => idx !== i)) }}><XCircle size={20} /></button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <button className="bg-[var(--bg)] hover:bg-[var(--accent)] text-[var(--on-accent)] font-bold p-3 border-t-2 border-[var(--text)] shrink-0 transition-colors flex items-center justify-center gap-2" onClick={() => { audioCtrl.playSE('click'); setProbs([...probs, { q: '', a: '' }]) }}><Plus size={20} /> 問題を追加</button>
        </div>
        <div className="flex gap-3 shrink-0 pb-4">
          <MotionButton className="bg-[var(--bg)] text-[var(--text)] w-1/3 py-3 border-[3px] border-[var(--text)]" onClick={() => setEditTarget(null)}>キャンセル</MotionButton>
          <MotionButton className="bg-[var(--primary)] text-[var(--panel)] flex-grow py-3 border-[3px] border-[var(--text)]" onClick={save}>保存する</MotionButton>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col h-[70vh]">
      <h3 className="font-bold text-xl text-center mb-4 shrink-0 flex items-center justify-center gap-2 text-[var(--text)]"><Settings size={24} /> 管理・共有</h3>
      <div className="shrink-0 mb-3">
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar sm:flex-wrap sm:overflow-visible sm:pb-0">
          {grades.map(grade => <button key={grade} onClick={() => { audioCtrl.playSE('click'); setSelectedGrade(grade); }} className={`px-4 py-2 rounded-full whitespace-nowrap font-bold text-sm border-[3px] transition-colors flex-shrink-0 ${selectedGrade === grade ? 'bg-[var(--text)] border-[var(--text)] text-[var(--panel)] shadow-sm' : 'bg-[var(--panel)] border-[var(--text)] text-[var(--text)]'}`}>{grade}</button>)}
        </div>
      </div>
      <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-xl flex-grow overflow-y-auto mb-4 shadow-sm p-2">
        {filteredGroups.length === 0 ? <div className="text-center text-[var(--text)] opacity-80 py-10 font-bold">コースがありません</div> : filteredGroups.map(g => (
          <div key={g.name} className="p-3 border-b border-dashed border-[var(--bg)] cursor-pointer flex justify-between items-center transition-colors rounded-lg group" onClick={() => { audioCtrl.playSE('click'); openEdit(g.name) }}>
            <div className="flex flex-col"><span className="font-bold text-[var(--text)]">{g.name}</span><span className="text-[var(--text)] opacity-80 text-xs">{g.count}問</span></div>
            <button className="bg-[var(--bg)] hover:bg-[var(--secondary)] hover:text-[var(--panel)] text-[var(--text)] p-2 rounded-xl transition-colors border-2 border-[var(--text)] shadow-sm" onClick={(e) => copyShareCode(e, g.name)} title="共有コードをコピー"><Share2 size={18} /></button>
          </div>
        ))}
      </div>
      <div className="shrink-0 flex flex-col gap-3 pb-4">
        <div className="flex gap-3">
          <MotionButton className="bg-[var(--secondary)] text-[var(--panel)] flex-grow py-3 border-[3px] border-[var(--text)]" onClick={() => { audioCtrl.playSE('click'); setView('import') }}><Download size={20} /> 受信/AI</MotionButton>
          <MotionButton className="bg-[var(--accent)] text-[var(--on-accent)] flex-grow py-3 border-[3px] border-[var(--text)]" onClick={() => { audioCtrl.playSE('click'); openEdit('') }}><Plus size={20} /> 新規作成</MotionButton>
        </div>
        <button className="text-[var(--text)] opacity-80 font-bold py-3 hover:opacity-100 transition" onClick={() => { audioCtrl.playSE('click'); setView('home') }}>もどる</button>
      </div>
    </div>
  );
};

// --- インポート画面 ---
const ImportView = ({ setView }) => {
  const [text, setText] = useState(''); const [mode, setMode] = useState('code');

  const copyPrompt = () => {
    audioCtrl.playSE('click');
    const prompt = `あなたは日本の小学校教育に精通したベテラン教師アシスタントです。\n指定の学年・単元の計算問題を作成します。\n# 出力ルール\n1. 形式: CSV形式（問題,答え）\n2. 正解が複数考えられる場合は「|」で区切る\n3. ヘッダーなし\n4. コードブロック内にCSVデータのみを出力`;

    const textArea = document.createElement("textarea");
    textArea.value = prompt;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('success', 'プロンプトをコピーしました！');
    } catch (err) {
      showToast('error', 'コピーに失敗しました');
    }
    document.body.removeChild(textArea);
  };

  const process = () => {
    if (!text.trim()) return showToast('warning', 'データが空です');
    if (mode === 'code') {
      const decoded = StorageAPI.decodeCourse(text.trim());
      if (decoded) { StorageAPI.saveProblemSet(`受信_${decoded.name}`, decoded.problems); showToast('success', `${decoded.name} を追加しました！`); setView('manager'); }
      else { showToast('error', '正しい共有コードではありません'); }
    } else {
      const probs = []; text.split('\n').forEach(line => { const parts = line.includes(',') ? line.split(',') : line.split('\t'); if (parts.length >= 2) { const q = parts[0].trim(), a = parts[1].trim(); if (q && a && q !== '問題') probs.push({ q, a }); } });
      if (!probs.length) return showToast('error', '読み込めませんでした'); StorageAPI.saveProblemSet(`AI_${new Date().toLocaleDateString()}`, probs); showToast('success', `${probs.length}問保存しました`); setView('manager');
    }
  };

  return (
    <div className="flex flex-col h-[70vh]">
      <h3 className="font-bold text-xl text-center mb-4 shrink-0 flex items-center justify-center gap-2 text-[var(--text)]"><Download size={24} /> コースを追加</h3>
      <div className="flex gap-2 mb-4 shrink-0 bg-[var(--text)] p-1 rounded-xl">
        <button onClick={() => setMode('code')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${mode === 'code' ? 'bg-[var(--panel)] text-[var(--text)]' : 'text-[var(--panel)] opacity-60'}`}>共有コード</button>
        <button onClick={() => setMode('ai')} className={`flex-1 py-2 rounded-lg font-bold text-sm transition-colors ${mode === 'ai' ? 'bg-[var(--panel)] text-[var(--text)]' : 'text-[var(--panel)] opacity-60'}`}>AI(CSV)</button>
      </div>
      <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] shadow-sm flex-grow flex flex-col p-5 mb-4 gap-4">
        <p className="text-sm font-bold text-[var(--text)] opacity-80 shrink-0">{mode === 'code' ? 'もらった「共有コード」を貼り付けてください。' : 'AI(ChatGPT等)が作った「問題,答え」のリストを貼り付けてください。'}</p>

        {mode === 'ai' && (
          <button className="border-[3px] border-[var(--secondary)] text-[var(--secondary-d)] font-bold rounded-xl py-2 text-sm shrink-0 active:scale-95 transition-transform" onClick={copyPrompt}>
            AIへの指示(プロンプト)をコピー
          </button>
        )}

        <textarea className="flex-grow border-[3px] border-[var(--text)] rounded-xl p-3 resize-none font-mono text-sm outline-none bg-[var(--bg)] text-[var(--text)]" value={text} onChange={e => setText(e.target.value)}></textarea>
        <MotionButton className="bg-[var(--primary)] text-[var(--panel)] py-4 shrink-0 border-[3px] border-[var(--text)]" onClick={process}>読み込んで追加</MotionButton>
      </div>
      <button className="text-[var(--text)] opacity-80 font-bold py-3 shrink-0 pb-4" onClick={() => { audioCtrl.playSE('click'); setView('manager') }}>もどる</button>
    </div>
  );
};


// ==========================================
// 5. メインアプリケーション (App)
// ==========================================
export default function App() {
  const [view, setView] = useState('home');
  // PeerJS のコールバックから「いまどの画面か」を見るためのref(コールバックは古い view を閉じこめてしまうため)
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const [configMode, setConfigMode] = useState('SCORE_ATTACK');
  const [isMuted, setIsMuted] = useState(audioCtrl.muted);
  const [state, setState] = useState({ problemSet: [], timeLimitSec: 0, courseName: '', finalScore: 0, finalCombo: 0, earnedExp: 0, previousExp: 0, gameMode: 'SCORE_ATTACK', mistakes: [] });
  const [stats, setStats] = useState(() => StorageAPI.getStats());
  const [resumeData, setResumeData] = useState(() => StorageAPI.getResume());
  // 提示モードと「えんしゅつをへらす」の状態。framer-motion にも伝える
  const { reduceFx } = usePresentation();

  const resumeGame = () => {
    const data = StorageAPI.getResume();
    if (!data) return;
    setState({
      timeLimitSec: data.timeLimitSec || 0,
      problemSet: data.problemSet || [],
      courseName: data.courseName || '',
      courseNames: data.courseNames || [],
      gameMode: data.gameMode || 'SCORE_ATTACK',
      resumeSnapshot: data,
      mistakes: [],
      finalScore: 0, finalCombo: 0, earnedExp: 0, previousExp: 0
    });
    setView('game');
  };

  const discardResume = () => {
    audioCtrl.playSE('click');
    StorageAPI.clearResume();
    setResumeData(null);
    showToast('success', '中断データを消しました');
  };

  // P2P通信用のステート
  // pending: 入室を申しこんだがリーダーがまだ「いれる」をおしていない人。participants には入れない
  // acceptUntil: 「うけつけタイム」の終了時刻(ミリ秒)。この間の申しこみは自動で許可する
  // approved: メンバー側が「リーダーの許可が出たか」を持つフラグ
  const [urlHostId, setUrlHostId] = useState(null);
  const [peerState, setPeerState] = useState({ role: null, peer: null, conn: null, hostId: null, myName: '', connections: [], participants: {}, pending: {}, acceptUntil: 0, approved: false });
  const peerStateRef = useRef(peerState);
  useEffect(() => { peerStateRef.current = peerState; }, [peerState]);
  // ルームに入りなおすたびに増える通し番号。退出後に古い接続のイベントで画面が動かないようにするための世代管理
  const peerSessionRef = useRef(0);
  // ホストがメンバーごとに「最後に反応があった時刻」を持ち、無反応が続いたら抜けたとみなす
  const memberSeenRef = useRef({});

  // 【ボスバトル(BOSS_RAID)の状態】
  // raidRef がホスト権威の真実(HP・攻撃スケジュール・貢献度)、raidState は全端末共通の描画用スナップショット。
  // クライアントは raid_state / raid_boss_attack / raid_event の受信だけで raidState を組み立てる。
  const [raidState, setRaidState] = useState(null);
  const raidRef = useRef(null);

  // --- 全端末共通: 受信メッセージ(またはホスト自身のブロードキャスト)を raidState に反映する ---
  const applyRaidSnapshot = useCallback((snap) => {
    setRaidState(prev => ({ ...(prev || {}), ...snap }));
  }, []);

  const applyRaidBossAttack = useCallback((data) => {
    const at = Date.now();
    setRaidState(prev => {
      if (!prev) return prev;
      const kept = (prev.activeDebuffs || []).filter(d => d.expiresAt > at);
      // shield/drain/hp はボス側の効果なのでプレイヤーのデバフ一覧には積まない(debuff フラグで判定)
      const withNew = (data.debuff && data.durationMs > 0) ? [...kept, { ...data, at, expiresAt: at + data.durationMs }] : kept;
      return { ...prev, activeDebuffs: withNew, lastAttack: { ...data, at } };
    });
  }, []);

  const applyRaidEvent = useCallback((data) => {
    const at = Date.now();
    setRaidState(prev => {
      if (!prev) return prev;
      const next = { ...prev, lastEvent: { ...data, at } };
      if (data.kind === 'support') next.activeDebuffs = []; // おうえんで全デバフ解除
      // 時限爆弾は解除/爆発したらカウントダウン表示を即座に消す
      if (data.kind === 'bomb_defused' || data.kind === 'bomb_blast') {
        next.activeDebuffs = (prev.activeDebuffs || []).filter(d => d.kind !== 'bomb');
        next.bombEndsAt = 0;
      }
      return next;
    });
  }, []);

  // --- ここからホスト専用ロジック(すべて ref 経由で最新を参照する) ---
  const raidSnapshot = () => {
    const r = raidRef.current;
    return {
      stage: r.stage, bossHp: r.bossHp, bossMaxHp: r.bossMaxHp,
      teamHp: r.teamHp, teamHpMax: r.teamHpMax, defeated: r.defeated,
      // ためこみ予兆は2トラックのうち先に来るほうに合わせる
      telegraphAt: r.pendingAdvanceAt ? 0 : Math.min(r.nextAttackAt, r.nextDamageAt) - RAID_CONSTANTS.TELEGRAPH_MS,
      cheerUntil: r.cheerUntil || 0,
      enraged: !!r.enraged, shieldUntil: r.shieldUntil || 0,
      bombEndsAt: r.bombEndsAt || 0, bombHits: r.bombHits || 0, bombNeeded: r.bombNeeded || 0,
    };
  };

  const broadcastRaidState = () => {
    if (!raidRef.current) return;
    const snap = raidSnapshot();
    raidRef.current.lastBeatAt = Date.now();
    broadcast({ type: 'raid_state', data: snap });
    applyRaidSnapshot(snap);
  };

  // 開始時・ボス切替時の攻撃スケジュール初期化。
  // 2トラックが同時に発火すると演出が重なるので、ダメージ攻撃を少しうしろにずらしておく
  const hostResetAttackSchedule = (from) => {
    const r = raidRef.current;
    r.nextAttackAt = from + RAID_CONSTANTS.GRACE_MS;
    r.nextDamageAt = from + RAID_CONSTANTS.GRACE_MS + RAID_CONSTANTS.TRACK_START_OFFSET_MS;
    r.burstLeft = 0;
    r.damageBurstLeft = 0;
  };

  // ゲーム開始時にホストが呼ぶ。初期スナップショットを返し、game_start に同梱される
  const initRaid = (playerCount, roster) => {
    const now = Date.now();
    preloadBossSprites(); // ドット絵の初回表示がちらつかないよう先読み
    const maxHp = bossMaxHp(1, playerCount);
    // 0ダメージの子も結果画面に載るよう、開始時点の参加者全員を貢献度テーブルへ登録しておく
    const contributions = {};
    const p = peerStateRef.current;
    Object.entries(roster || p.participants).forEach(([id, part]) => { contributions[id] = { name: part.name, damage: 0, supports: 0, maxCombo: 0 }; });
    if (p.hostId) contributions[p.hostId] = { name: 'リーダー', damage: 0, supports: 0, maxCombo: 0 };
    raidRef.current = {
      stage: 1, playerCount, bossHp: maxHp, bossMaxHp: maxHp,
      teamHp: RAID_CONSTANTS.TEAM_HP_MAX, teamHpMax: RAID_CONSTANTS.TEAM_HP_MAX,
      defeated: 0, contributions,
      pendingAdvanceAt: 0, cheerUntil: 0, lastBeatAt: now,
      // 攻撃スケジュール: 妨害トラック(nextAttackAt) と ダメージトラック(nextDamageAt) を別々に回す
      nextAttackAt: 0, nextDamageAt: 0, burstLeft: 0, damageBurstLeft: 0,
      // 強化ボス用: げきおこ / バリア / 時限爆弾 の状態
      enraged: false, shieldUntil: 0, bombEndsAt: 0, bombHits: 0, bombNeeded: 0,
    };
    hostResetAttackSchedule(now);
    const snap = raidSnapshot();
    // 1体目も登場カットインを出す
    setRaidState({ ...snap, activeDebuffs: [], lastAttack: null, lastEvent: { kind: 'boss_enter', stage: 1, at: now } });
    return snap;
  };

  const raidContribution = (peerId) => {
    const r = raidRef.current;
    if (!r.contributions[peerId]) {
      const p = peerStateRef.current;
      const name = p.participants[peerId]?.name || (peerId === p.hostId ? 'リーダー' : '???');
      r.contributions[peerId] = { name, damage: 0, supports: 0, maxCombo: 0 };
    }
    return r.contributions[peerId];
  };

  // ボス側のイベントを全員へ流すヘルパー
  const emitRaidEvent = (ev) => {
    broadcast({ type: 'raid_event', data: ev });
    applyRaidEvent(ev);
  };

  // HPが一定割合を切ったら「げきおこ」フェーズへ。攻撃間隔が縮み、攻撃力も上がる
  const hostCheckEnrage = () => {
    const r = raidRef.current;
    if (!r || r.enraged || r.bossHp <= 0) return;
    if (r.bossHp > r.bossMaxHp * RAID_CONSTANTS.ENRAGE_THRESHOLD) return;
    r.enraged = true;
    // 突入直後に一度たたみかける(ダメージ→妨害の順で重ならないようにずらす)
    const rageAt = Date.now();
    r.nextDamageAt = Math.min(r.nextDamageAt, rageAt + 2400);
    r.nextAttackAt = Math.min(r.nextAttackAt, rageAt + 3600);
    emitRaidEvent({ kind: 'boss_enrage', stage: r.stage });
  };

  const hostApplyDamage = (peerId, damage, combo) => {
    const r = raidRef.current;
    if (!r || !(damage > 0)) return;
    const c = raidContribution(peerId);
    c.damage += damage;
    c.maxCombo = Math.max(c.maxCombo, combo || 0);
    // 撃破演出中(次ボス待ち)に届いた攻撃は貢献度のみ有効
    if (!r.pendingAdvanceAt && r.bossHp > 0) {
      // 時限爆弾: 制限時間内にチームで規定数の正解を積めば解除できる
      if (r.bombEndsAt > Date.now()) {
        r.bombHits += 1;
        if (r.bombHits >= r.bombNeeded) {
          r.bombEndsAt = 0; r.bombHits = 0; r.bombNeeded = 0;
          emitRaidEvent({ kind: 'bomb_defused' });
        }
      }
      r.bossHp = Math.max(0, r.bossHp - damage);
      if (r.bossHp <= 0) {
        r.defeated += 1;
        r.pendingAdvanceAt = Date.now() + RAID_CONSTANTS.DEFEAT_LOCK_MS;
        r.bombEndsAt = 0; r.shieldUntil = 0; r.burstLeft = 0; r.damageBurstLeft = 0;
        emitRaidEvent({ kind: 'boss_defeated', stage: r.stage });
      } else {
        hostCheckEnrage();
      }
    }
    broadcastRaidState();
  };

  const hostApplySupport = (peerId) => {
    const r = raidRef.current;
    if (!r) return;
    const c = raidContribution(peerId);
    c.supports += 1;
    r.teamHp = Math.min(r.teamHpMax, r.teamHp + RAID_CONSTANTS.CHEER_HEAL);
    r.cheerUntil = Date.now() + RAID_CONSTANTS.CHEER_DURATION_MS;
    emitRaidEvent({ kind: 'support', name: c.name });
    broadcastRaidState();
  };

  const hostAdvanceBoss = () => {
    const r = raidRef.current;
    r.stage += 1;
    r.pendingAdvanceAt = 0;
    r.bossMaxHp = bossMaxHp(r.stage, r.playerCount);
    r.bossHp = r.bossMaxHp;
    r.teamHp = Math.min(r.teamHpMax, r.teamHp + RAID_CONSTANTS.STAGE_CLEAR_HEAL);
    hostResetAttackSchedule(Date.now());
    // ボスごとの強化ステートをリセット
    r.enraged = false; r.shieldUntil = 0; r.bombEndsAt = 0; r.bombHits = 0; r.bombNeeded = 0;
    emitRaidEvent({ kind: 'boss_enter', stage: r.stage });
    broadcastRaidState();
  };

  // チームHPを減らす。0を割ったら全滅ではなく「たてなおし」でゲームを続行させる
  const hostDamageTeam = (amount) => {
    const r = raidRef.current;
    r.teamHp -= amount;
    if (r.teamHp <= 0) {
      // 全滅にはしない: ボスがHPを回復し、チームは立て直しペナルティ(コンボリセット)で継続する
      r.teamHp = RAID_CONSTANTS.TEAM_DOWN_RECOVER_HP;
      r.bossHp = Math.min(r.bossMaxHp, r.bossHp + Math.round(r.bossMaxHp * RAID_CONSTANTS.TEAM_DOWN_BOSS_HEAL_RATE));
      emitRaidEvent({ kind: 'team_down' });
    }
  };

  // track = 'damage'(チームHPを削る技) / 'disrupt'(問題や入力をじゃまする技)。
  // トラックごとに独立したタイマーで撃つので、片方の頻度がもう片方を押しのけることはない
  const hostFireAttack = (track) => {
    const r = raidRef.current;
    const info = bossForStage(r.stage);
    const ids = Object.keys(peerStateRef.current.participants);
    const nowAtk = Date.now();
    // すでに効いている継続技は上書きしない(バリアの塗り替え・爆弾の進捗リセットを防ぐ)
    const exclude = [];
    if (r.bombEndsAt > nowAtk) exclude.push('bomb');
    if (r.shieldUntil > nowAtk) exclude.push('shield');
    const atk = pickBossAttack(info.bossIndex, r.stage, ids, { enraged: r.enraged, track, exclude });

    if (atk.kind === 'hp') {
      hostDamageTeam(atk.damage);
    } else if (atk.kind === 'drain') {
      // きゅうしゅう: チームHPを削り、その分ボスが回復する
      hostDamageTeam(atk.damage);
      r.bossHp = Math.min(r.bossMaxHp, r.bossHp + atk.damage * 2);
      emitRaidEvent({ kind: 'boss_drain', amount: atk.damage });
    } else if (atk.kind === 'shield') {
      // バリア: 一定時間ダメージが半減する(与ダメ計算は各端末の calcRaidDamage 側で反映)
      r.shieldUntil = Date.now() + atk.durationMs;
      emitRaidEvent({ kind: 'boss_shield' });
    } else if (atk.kind === 'bomb') {
      // 時限爆弾: 制限時間内にチームで規定数の正解を積めないと大ダメージ
      r.bombEndsAt = Date.now() + atk.durationMs;
      r.bombHits = 0;
      r.bombNeeded = atk.needHits;
    }

    // れんぞくこうげき: 残り本数は「このターンでこの先まだ撃つ本数」。トラックごとに別で数える。
    // 残っていれば短い間隔で続けて撃ち、撃ち切ったら通常間隔に戻して次のターンぶんを抽選する
    const burstKey = track === 'damage' ? 'damageBurstLeft' : 'burstLeft';
    const nextKey = track === 'damage' ? 'nextDamageAt' : 'nextAttackAt';
    if (r[burstKey] > 0) r[burstKey] -= 1;
    else r[burstKey] = Math.max(0, rollBurstCount(r.stage, r.enraged) - 1);
    r[nextKey] = nowAtk + (r[burstKey] > 0 ? RAID_CONSTANTS.BURST_GAP_MS : attackIntervalMs(r.stage, r.enraged, track));
    // もう片方のトラックが同時に来ていたら、演出が重ならないよう少しうしろへずらす
    const otherKey = track === 'damage' ? 'nextAttackAt' : 'nextDamageAt';
    r[otherKey] = Math.max(r[otherKey], nowAtk + RAID_CONSTANTS.TRACK_MIN_GAP_MS);

    broadcast({ type: 'raid_boss_attack', data: atk });
    applyRaidBossAttack(atk);
    broadcastRaidState();
  };

  // ボスAI: setInterval + Date.now() 比較でタブスロットリングに耐える。2秒ごとのハートビート同期も同居
  useEffect(() => {
    if (view !== 'game' || state.gameMode !== 'BOSS_RAID' || peerState.role !== 'host') return;
    const id = setInterval(() => {
      const r = raidRef.current;
      if (!r) return;
      const now = Date.now();
      // 時限爆弾の時間切れ判定はボスの行動より先に処理する
      if (r.bombEndsAt && now >= r.bombEndsAt) {
        r.bombEndsAt = 0; r.bombHits = 0; r.bombNeeded = 0;
        hostDamageTeam(RAID_CONSTANTS.BOMB_DAMAGE);
        emitRaidEvent({ kind: 'bomb_blast' });
        broadcastRaidState();
      }
      if (r.pendingAdvanceAt && now >= r.pendingAdvanceAt) hostAdvanceBoss();
      else if (!r.pendingAdvanceAt) {
        // 2トラックが同じtickで来たら、先に予定されていたほうを撃つ(もう片方は発射時にずらされる)
        const damageDue = now >= r.nextDamageAt;
        const disruptDue = now >= r.nextAttackAt;
        if (damageDue || disruptDue) {
          const damageFirst = damageDue && (!disruptDue || r.nextDamageAt <= r.nextAttackAt);
          hostFireAttack(damageFirst ? 'damage' : 'disrupt');
        }
      }
      if (now - r.lastBeatAt >= RAID_CONSTANTS.HEARTBEAT_MS) broadcastRaidState();
    }, 400);
    return () => clearInterval(id);
  }, [view, state.gameMode, peerState.role]);

  // GameView から呼ばれる送信ヘルパー(ホストなら直接権威ロジックへ、クライアントならホストへ送信)
  const sendRaidAttack = useCallback((damage, combo) => {
    const p = peerStateRef.current;
    if (p.role === 'host') hostApplyDamage(p.hostId, damage, combo);
    else if (p.conn) safeSend(p.conn, { type: 'raid_attack', data: { damage, combo } });
  }, []);

  const sendRaidSupport = useCallback(() => {
    const p = peerStateRef.current;
    if (p.role === 'host') hostApplySupport(p.hostId);
    else if (p.conn) safeSend(p.conn, { type: 'raid_support', data: {} });
  }, []);

  // 結果画面用(ホストのみ実体を持つ)
  const collectRaidResult = useCallback(() => (
    raidRef.current ? { defeated: raidRef.current.defeated, contributions: raidRef.current.contributions } : null
  ), []);

  // 【じんとりバトル(TERRITORY)の状態】
  // terrRef がホスト権威の真実(盤面・ぬり進行・貢献度)、terrState は全端末共通の描画用スナップショット。
  // クライアントは terr_state / terr_event の受信だけで terrState を組み立てる。
  const [terrState, setTerrState] = useState(null);
  const terrRef = useRef(null);

  // --- 全端末共通: 受信スナップショット/イベントを terrState に反映する ---
  const applyTerrSnapshot = useCallback((snap) => {
    setTerrState(prev => ({ ...(prev || {}), ...snap }));
  }, []);

  // イベントは短時間に何個も飛ぶ(ぬり→れんさ→ラッキー→ぎゃくてん)ため、キューに積んで演出側で順に見せる
  const terrEvSeq = useRef(0);
  const applyTerrEvent = useCallback((data) => {
    const ev = { ...data, at: Date.now(), id: `${Date.now()}-${terrEvSeq.current++}` };
    setTerrState(prev => {
      if (!prev) return prev;
      if ((prev.events || []).some(e => e.id === ev.id)) return prev; // StrictModeの二重実行よけ
      return { ...prev, lastEvent: ev, events: [...(prev.events || []), ev].slice(-6) };
    });
  }, []);

  // --- ここからホスト専用ロジック ---
  // ホストは cells を直接ミューテートするため、スナップショットは必ず複製して配る
  const terrSnapshot = () => {
    const t = terrRef.current;
    return {
      cells: t.cells.map(c => ({ owner: c.owner, charge: { ...c.charge } })),
      scores: { ...t.scores },
      targets: { ...t.targets },
      boardFull: t.boardFull,
    };
  };

  const broadcastTerrState = () => {
    if (!terrRef.current) return;
    const snap = terrSnapshot();
    terrRef.current.lastBeatAt = Date.now();
    broadcast({ type: 'terr_state', data: snap });
    applyTerrSnapshot(snap);
  };

  // ゲーム開始時にホストが呼ぶ。初期スナップショット(チーム表つき)を返し、game_start に同梱される
  const initTerritory = (teamsMap) => {
    preloadTerritoryCharacters(); // ペンキーの表情4まいを先読みしておく
    const cells = createTerritoryCells();
    const contributions = {};
    Object.entries(teamsMap).forEach(([id, m]) => {
      contributions[id] = { name: m.name, team: m.team, charges: 0, captures: 0, steals: 0, specials: 0, luckies: 0, maxCombo: 0 };
    });
    terrRef.current = {
      cells, scores: computeScores(cells), targets: {}, contributions,
      teams: teamsMap, boardFull: false, lastBeatAt: Date.now(),
    };
    const snap = { ...terrSnapshot(), teams: teamsMap };
    setTerrState({ ...snap, lastEvent: null, events: [] });
    return snap;
  };

  const emitTerrEvent = (ev) => {
    broadcast({ type: 'terr_event', data: ev });
    applyTerrEvent(ev);
  };

  // 盤面にぬりを足したあとの確定処理(ホスト専用)
  //   確保の確定 → ？マス(ラッキー)の抽選 → 貢献度加算 → スコア更新 → イベント発行(うばい/れんさ/ぎゃくてん/うまり)
  const hostSettleBoard = (peerId, c) => {
    const t = terrRef.current;
    const prevLeader = t.scores.red > t.scores.blue ? 'red' : t.scores.blue > t.scores.red ? 'blue' : null;
    let captured = resolveCaptures(t.cells);
    if (captured.length === 0) return;

    // ？マス(ラッキーマス): とったチームへのごほうび。blast だけ盤面に効き、他はとった本人の端末で効く
    captured.filter(cap => cap.lucky).forEach(cap => {
      const effect = rollLucky();
      const mine = !!c && cap.team === c.team;
      if (effect === 'blast') {
        applyBlast(t.cells, cap.idx, cap.team);
        captured = captured.concat(resolveCaptures(t.cells));
      }
      if (mine) c.luckies = (c.luckies || 0) + 1;
      emitTerrEvent({ kind: 'lucky', effect, team: cap.team, cellIdx: cap.idx, to: mine ? peerId : null });
    });

    if (c) captured.forEach(cap => { if (cap.team === c.team) { c.captures += 1; if (cap.steal) c.steals += 1; } });
    t.scores = computeScores(t.cells);

    // いちばん目立つ確保(うばい > 高価値)だけをイベントとして流す
    const notable = [...captured].sort((a, b) => (b.steal - a.steal) || (b.value - a.value))[0];
    if (notable && (notable.steal || notable.value >= 2)) {
      emitTerrEvent({ kind: 'capture', name: c?.name || '', team: notable.team, cellIdx: notable.idx, steal: notable.steal, value: notable.value });
    }
    // インクがはねてマスが連鎖でぬれたとき
    if (captured.length >= 3) emitTerrEvent({ kind: 'chain', team: captured[0].team, count: captured.length });

    const leader = t.scores.red > t.scores.blue ? 'red' : t.scores.blue > t.scores.red ? 'blue' : null;
    if (leader && prevLeader && leader !== prevLeader) emitTerrEvent({ kind: 'lead', team: leader });

    // 盤面がうまっても試合はつづく(ここからは うばいあいの時間。制限時間まで ぎゃくてんのチャンスがある)
    if (!t.boardFull && t.cells.every(cell => cell.owner)) {
      t.boardFull = true;
      emitTerrEvent({ kind: 'board_full' });
    }
  };

  // 正解によるぬりを盤面へ適用する。ねらいが無効(ぬり済みなど)なら自動でぬりやすいマスへ振り替える
  const hostApplyCharge = (peerId, cellIdx, amount, combo) => {
    const t = terrRef.current;
    if (!t || !(amount > 0)) return;
    const c = t.contributions[peerId];
    if (!c) return; // チーム未登録(開始後参加)のぬりは無効
    const amt = Math.max(1, Math.min(12, Math.round(amount))); // フィーバー×ラストスパート×ラッシュの上限
    c.charges += amt;
    c.maxCombo = Math.max(c.maxCombo, combo || 0);

    let idx = cellIdx;
    if (idx == null || !t.cells[idx] || !isSelectable(t.cells, idx, c.team)) idx = pickNearTarget(t.cells, c.team, t.targets[peerId]);
    if (idx == null) return;
    addCharge(t.cells, idx, c.team, amt);
    hostSettleBoard(peerId, c);
    broadcastTerrState();
  };

  // スペシャル発動。drop/line は盤面へ大量のぬりを落とし、rush は発動した本人の端末でバフになる
  const hostApplySpecial = (peerId, kind, cellIdx) => {
    const t = terrRef.current;
    if (!t || !SPECIALS[kind]) return;
    const c = t.contributions[peerId];
    if (!c) return;
    c.specials = (c.specials || 0) + 1;
    emitTerrEvent({ kind: 'special', effect: kind, name: c.name, team: c.team });

    if (kind !== 'rush') {
      let idx = cellIdx;
      if (idx == null || !t.cells[idx]) idx = autoPickTarget(t.cells, c.team);
      if (idx != null) {
        specialCharges(idx, kind).forEach(({ idx: target, amount }) => addCharge(t.cells, target, c.team, amount));
        hostSettleBoard(peerId, c);
      }
    }
    broadcastTerrState();
  };

  const hostSetTarget = (peerId, cellIdx) => {
    const t = terrRef.current;
    if (!t) return;
    t.targets[peerId] = cellIdx;
    broadcastTerrState();
  };

  // ハートビート同期(タブスロットリング・取りこぼし対策)
  useEffect(() => {
    if (view !== 'game' || state.gameMode !== 'TERRITORY' || peerState.role !== 'host') return;
    const id = setInterval(() => {
      const t = terrRef.current;
      if (t && Date.now() - t.lastBeatAt >= TERRITORY_CONSTANTS.HEARTBEAT_MS) broadcastTerrState();
    }, 1000);
    return () => clearInterval(id);
  }, [view, state.gameMode, peerState.role]);

  // GameView から呼ばれる送信ヘルパー(ホストなら直接権威ロジックへ、クライアントならホストへ送信)
  const sendTerrCharge = useCallback((cellIdx, amount, combo) => {
    const p = peerStateRef.current;
    if (p.role === 'host') hostApplyCharge(p.hostId, cellIdx, amount, combo);
    else if (p.conn) safeSend(p.conn, { type: 'terr_charge', data: { cellIdx, amount, combo } });
  }, []);

  const sendTerrTarget = useCallback((cellIdx) => {
    const p = peerStateRef.current;
    if (p.role === 'host') hostSetTarget(p.hostId, cellIdx);
    else if (p.conn) safeSend(p.conn, { type: 'terr_target', data: { cellIdx } });
  }, []);

  const sendTerrSpecial = useCallback((kind, cellIdx) => {
    const p = peerStateRef.current;
    if (p.role === 'host') hostApplySpecial(p.hostId, kind, cellIdx);
    else if (p.conn) safeSend(p.conn, { type: 'terr_special', data: { kind, cellIdx } });
  }, []);

  // 結果画面用(ホストのみ実体を持つ)
  const collectTerritoryResult = useCallback(() => (
    terrRef.current ? {
      scores: { ...terrRef.current.scores },
      cells: terrRef.current.cells.map(c => ({ owner: c.owner })),
      contributions: terrRef.current.contributions,
      teams: terrRef.current.teams,
    } : null
  ), []);

  // URLパラメータのチェック（児童がURLからアクセスした場合）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hostParam = params.get('host');
    // URLの値はそのまま使わない。10けたの数字の形をしていなければ、ただの参加画面として開く
    if (hostParam) {
      setUrlHostId(isValidRoomId(hostParam) ? hostParam : null);
      setView('clientJoin');
      // リロード時などに意図せず参加画面に戻らないようURLパラメータを消去
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // 【ホスト専用】メンバーが抜けたときの後片付け。
  // 参加者リスト・接続・じんとりのねらい表示から取りのぞき、残りの全員へ最新の参加者リストを配る。
  const hostRemoveMember = useCallback((peerId, notify, reason = 'removed') => {
    const cur = peerStateRef.current;
    if (cur.role !== 'host' || !peerId || peerId === cur.hostId) return;
    const known = !!cur.participants[peerId] || !!cur.pending?.[peerId] || cur.connections.some(c => c.peer === peerId);
    if (!known) return;
    const name = cur.participants[peerId]?.name;

    delete memberSeenRef.current[peerId];
    if (terrRef.current && terrRef.current.targets) delete terrRef.current.targets[peerId];

    // 相手の端末が生きている場合(通信不良で切ったときなど)は、へやから外れたことを伝えてから切断する
    const gone = cur.connections.find(c => c.peer === peerId);
    if (gone) { safeSend(gone, { type: 'room_closed', data: { reason } }); setTimeout(() => { try { gone.close(); } catch (e) {} }, 200); }

    setPeerState(p => {
      if (!p.participants[peerId] && !p.pending?.[peerId] && !p.connections.some(c => c.peer === peerId)) return p;
      const participants = { ...p.participants };
      delete participants[peerId];
      const pending = { ...(p.pending || {}) };
      delete pending[peerId];
      const newP = { ...p, participants, pending, connections: p.connections.filter(c => c.peer !== peerId) };
      sendToApproved(newP, { type: 'participants_update', data: participants });
      return newP;
    });

    if (notify && name) showToast('warning', `${name} さんが たいしゅつしました`);
  }, []);

  // 【ホスト専用】入室の申しこみを許可する。ここを通らないと participants に入らない＝
  // 参加者リストもゲーム開始も届かない(＝番号を知っているだけでは、へやの中は見えない)
  const hostApproveMember = useCallback((peerId) => {
    setPeerState(p => {
      const req = p.pending?.[peerId];
      const conn = p.connections.find(c => c.peer === peerId);
      if (!req || !conn) return p;
      // じんとり用に参加時点でチームを自動割当(人数の少ない側へ)。他モードでは使われないだけで無害
      const hostTeam = p.hostTeam || 'red';
      let red = hostTeam === 'red' ? 1 : 0; let blue = 1 - red;
      Object.entries(p.participants).forEach(([id, m]) => { if (id === p.hostId) return; if (m.team === 'blue') blue++; else red++; });
      const team = red <= blue ? 'red' : 'blue';
      const pending = { ...p.pending }; delete pending[peerId];
      const newP = {
        ...p,
        pending,
        participants: { ...p.participants, [peerId]: { id: peerId, name: req.name, score: 0, combo: 0, team } },
      };
      safeSend(conn, { type: 'join_accepted' });
      sendToApproved(newP, { type: 'participants_update', data: newP.participants });
      return newP;
    });
  }, []);

  // 【ホスト専用】申しこみをことわる。相手には「きょかされなかった」ことを伝えて切る
  const hostRejectMember = useCallback((peerId) => {
    hostRemoveMember(peerId, false, 'rejected');
  }, [hostRemoveMember]);

  // 【ホスト専用】ハートビート。ping に一定時間こたえないメンバーは抜けたとみなして片付ける。
  // (PeerJS の close は相手が黙って消えたときに届かないことがあるため)
  useEffect(() => {
    if (peerState.role !== 'host') return;
    let lastTick = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const gap = now - lastTick; lastTick = now;
      const p = peerStateRef.current;
      if (p.role !== 'host') return;

      p.connections.forEach(c => { if (!memberSeenRef.current[c.peer]) memberSeenRef.current[c.peer] = now; });

      if (gap > PEER_TIMEOUT_MS) {
        // 自分のタブが止まっていた(バックグラウンドなど)。誤判定しないよう猶予を配りなおす
        Object.keys(memberSeenRef.current).forEach(pid => { memberSeenRef.current[pid] = now; });
      } else {
        p.connections.forEach(c => {
          if (!c.open || now - (memberSeenRef.current[c.peer] || now) > PEER_TIMEOUT_MS) hostRemoveMember(c.peer, true);
        });
        // 接続がひとつも残っていない参加者(切断だけ先に検知された場合)も片付ける
        Object.keys(p.participants).forEach(pid => {
          if (pid !== p.hostId && !p.connections.some(c => c.peer === pid)) hostRemoveMember(pid, true);
        });
      }

      sendToAll(p.connections, { type: 'ping' });
    }, PEER_PING_MS);
    return () => clearInterval(id);
  }, [peerState.role, hostRemoveMember]);

  // 【ホスト(リーダー)の初期化処理】
  const initHost = async () => {
    if (peerLoading) return;
    peerLoading = true;
    let Peer;
    try {
      Peer = await loadPeer();
    } catch (e) {
      peerLoading = false;
      return showToast('error', 'つうしんの じゅんびが できませんでした。もういちど ためしてね');
    }
    peerLoading = false;
    const roomId = generateRoomId();
    const peer = new Peer(roomId, PEER_OPTIONS);
    const session = ++peerSessionRef.current;
    const alive = () => peerSessionRef.current === session; // 退出後に古い接続からのイベントで動かないようにする

    peer.on('open', (id) => {
      if (!alive()) return;
      memberSeenRef.current = {};
      setPeerState(p => ({ ...p, role: 'host', peer, hostId: id, participants: {}, pending: {}, acceptUntil: 0, connections: [] }));
      setView('hostRoom');
      showToast('success', 'あたらしいへやを作成しました！');
    });

    peer.on('connection', (conn) => {
      if (!alive()) return safeSend(conn, { type: 'room_closed' });
      conn.on('open', () => {
        if (!alive()) return;
        memberSeenRef.current[conn.peer] = Date.now();
        setPeerState(p => ({ ...p, connections: [...p.connections.filter(c => c.peer !== conn.peer), conn] }));
      });
      conn.on('data', (incoming) => {
        if (!alive()) return;
        memberSeenRef.current[conn.peer] = Date.now(); // 何か届いた＝生きている
        // 届いた値は信用しない。型と範囲でしぼり、知らない type は捨てる
        const rawData = parseMemberMessage(incoming);
        if (!rawData) return;
        if (rawData.type === 'pong') {
          return;
        } else if (rawData.type === 'leave') {
          // メンバーが「退出」をおした。参加者リストからすぐに外す
          hostRemoveMember(conn.peer, true);
        } else if (rawData.type === 'join') {
          // 古い版の端末が入ろうとした場合。「ルームが見つかりません」ではなく理由を伝えて切る
          if (rawData.v !== PROTOCOL_VERSION) {
            safeSend(conn, { type: 'version_mismatch' });
            setTimeout(() => { try { conn.close(); } catch (e) {} }, 200);
            return;
          }
          // 名前は parseMemberMessage でかけ直してある。空なら「ゲスト」であつかう
          const name = rawData.name || 'ゲスト';
          // ゲーム中はリーダーが承認画面を見られない。だまって待たせるのではなく理由を返して切る
          if (viewRef.current === 'game') {
            safeSend(conn, { type: 'room_closed', data: { reason: 'in_game' } });
            setTimeout(() => { try { conn.close(); } catch (e) {} }, 200);
            return;
          }
          const cur = peerStateRef.current;
          if (cur.participants[conn.peer] || cur.pending?.[conn.peer]) return; // 二重申しこみは無視
          // うけつけタイム中は自動で許可(30人学級でリーダーが30回タップしなくてよいように)
          if ((cur.acceptUntil || 0) > Date.now()) {
            setPeerState(p => {
              if (p.participants[conn.peer]) return p;
              const hostTeam = p.hostTeam || 'red';
              let red = hostTeam === 'red' ? 1 : 0; let blue = 1 - red;
              Object.entries(p.participants).forEach(([id, m]) => { if (id === p.hostId) return; if (m.team === 'blue') blue++; else red++; });
              const team = red <= blue ? 'red' : 'blue';
              const newP = { ...p, participants: { ...p.participants, [conn.peer]: { id: conn.peer, name, score: 0, combo: 0, team } } };
              safeSend(conn, { type: 'join_accepted' });
              sendToApproved(newP, { type: 'participants_update', data: newP.participants });
              return newP;
            });
            // トーストは更新関数の外で出す(StrictMode では更新関数が2回走り、2重に出てしまう)
            showToast('success', `${name} さんが参加しました`);
          } else {
            // それ以外は「承認まち」に入れるだけ。参加者リストはまだ配らない
            setPeerState(p => (p.participants[conn.peer] || p.pending?.[conn.peer])
              ? p
              : { ...p, pending: { ...(p.pending || {}), [conn.peer]: { id: conn.peer, name, at: Date.now() } } });
            showToast('success', `${name} さんが 入りたいそうです`);
          }
        } else if (rawData.type === 'score_update') {
          setPeerState(p => {
            if (!p.participants[conn.peer]) return p;
            const newP = { ...p, participants: { ...p.participants, [conn.peer]: { ...p.participants[conn.peer], score: rawData.data.score, combo: rawData.data.combo } } };
            sendToApproved(newP, { type: 'participants_update', data: newP.participants });
            return newP;
          });
        } else if (!peerStateRef.current.participants[conn.peer]) {
          // ここから下はゲーム中の操作。まだ許可していない端末からのものは受けつけない
          return;
        } else if (rawData.type === 'raid_attack') {
          hostApplyDamage(conn.peer, rawData.data.damage, rawData.data.combo);
        } else if (rawData.type === 'raid_support') {
          hostApplySupport(conn.peer);
        } else if (rawData.type === 'terr_charge') {
          hostApplyCharge(conn.peer, rawData.data.cellIdx, rawData.data.amount, rawData.data.combo);
        } else if (rawData.type === 'terr_target') {
          hostSetTarget(conn.peer, rawData.data.cellIdx);
        } else if (rawData.type === 'terr_special') {
          hostApplySpecial(conn.peer, rawData.data.kind, rawData.data.cellIdx);
        }
      });
      // 接続が切れたら参加者リストからも外す(以前は connections からしか消しておらず、
      // 抜けたはずのメンバーがへや・ランキング・チーム分けに残りつづけていた)
      conn.on('close', () => { if (alive()) hostRemoveMember(conn.peer, true); });
      conn.on('error', () => { if (alive() && !conn.open) hostRemoveMember(conn.peer, true); });
    });

    peer.on('error', (err) => {
      if (!alive()) return;
      showToast('error', '接続エラーが発生しました。もう一度お試しください。');
    });
  };

  // 【ホストからのブロードキャスト送信】（refを使って最新のconnectionsを参照）
  // 許可した人にだけ配る。承認まちの端末にゲーム開始や問題文がながれないようにするため
  const broadcast = useCallback((data) => {
    sendToApproved(peerStateRef.current, data);
  }, []);

  // 【クライアント(児童)の初期化処理】
  const initClient = async (playerName, hId) => {
    if (!isValidRoomId(hId)) return showToast('error', `ルーム番号は ${ROOM_ID_LEN} けたの数字です`);
    const name = sanitizeName(playerName);
    if (!name) return showToast('error', 'なまえを もういちど 入れてね');
    if (peerLoading) return;
    peerLoading = true;
    let Peer;
    try {
      Peer = await loadPeer();
    } catch (e) {
      peerLoading = false;
      return showToast('error', 'つうしんの じゅんびが できませんでした。もういちど ためしてね');
    }
    peerLoading = false;
    const peer = new Peer(PEER_OPTIONS);
    const session = ++peerSessionRef.current;
    // 退出したあとに(切断が完了するまでの間などに)届いたメッセージで画面が動きださないようにする
    const alive = () => peerSessionRef.current === session;

    peer.on('open', () => {
      if (!alive()) return;
      const conn = peer.connect(hId);
      conn.on('open', () => {
        if (!alive()) return;
        conn.send({ type: 'join', name, v: PROTOCOL_VERSION });
        // まだ「承認まち」。リーダーが「いれる」をおすまで approved は false のまま
        setPeerState(p => ({ ...p, role: 'client', peer, conn, myName: name, approved: false }));
        setView('clientWait');
        showToast('success', 'リーダーに もうしこみました');
      });
      conn.on('data', (incoming) => {
        if (!alive()) return; // すでにルームを抜けている端末は、以降いっさい反応しない
        // リーダーの端末が改造されている場合にそなえ、こちらでも型と範囲をたしかめる
        const rawData = parseHostMessage(incoming);
        if (!rawData) return;
        if (rawData.type === 'ping') {
          safeSend(conn, { type: 'pong' }); // 生きていることをリーダーへ返す
        } else if (rawData.type === 'join_accepted') {
          setPeerState(p => ({ ...p, approved: true }));
          audioCtrl.playSE('coin');
          showToast('success', 'リーダーのへやに 入れました！');
        } else if (rawData.type === 'version_mismatch') {
          // 古いキャッシュのまま入ろうとした。原因がわかる文言で伝える(「へやが見つからない」ではない)
          teardownPeer({ type: 'error', msg: 'アプリが古いようです。ページを さいよみこみ してね' });
        } else if (rawData.type === 'room_closed') {
          // リーダーがへやをとじた/自分がへやから外された。この端末はここで完全に切りはなす
          const reason = rawData.data?.reason;
          const msg = reason === 'rejected' ? 'リーダーが きょかしませんでした'
            : reason === 'in_game' ? 'いま ゲーム中です。おわるまで まってね'
              : reason === 'removed' ? 'へやからはなれました'
                : 'リーダーがへやをとじました';
          teardownPeer({ type: 'warning', msg });
        } else if (rawData.type === 'game_start') {
          // data は parseHostMessage で許可キーのみに絞られている。
          // (以前は届いた data をそのまま混ぜていたため、知らないキーで画面の状態を上書きできた)
          setState(prev => ({ ...prev, raidResult: null, territoryResult: null, ...rawData.data }));
          // ボスバトル/じんとりなら初期スナップショットから表示を立ち上げる
          if (rawData.data.raid) preloadBossSprites();
          if (rawData.data.territory) preloadTerritoryCharacters();
          setRaidState(rawData.data.raid
            ? { ...rawData.data.raid, activeDebuffs: [], lastAttack: null, lastEvent: { kind: 'boss_enter', stage: rawData.data.raid.stage || 1, at: Date.now() } }
            : null);
          setTerrState(rawData.data.territory ? { ...rawData.data.territory, lastEvent: null, events: [] } : null);
          setView('game');
        } else if (rawData.type === 'game_finish') {
          if (rawData.data && rawData.data.raidResult) setState(prev => ({ ...prev, raidResult: rawData.data.raidResult }));
          if (rawData.data && rawData.data.territoryResult) setState(prev => ({ ...prev, territoryResult: rawData.data.territoryResult }));
          setView('result');
        } else if (rawData.type === 'participants_update') {
          setPeerState(p => ({ ...p, participants: rawData.data }));
        } else if (rawData.type === 'raid_state') {
          applyRaidSnapshot(rawData.data);
        } else if (rawData.type === 'raid_boss_attack') {
          applyRaidBossAttack(rawData.data);
        } else if (rawData.type === 'raid_event') {
          applyRaidEvent(rawData.data);
        } else if (rawData.type === 'terr_state') {
          applyTerrSnapshot(rawData.data);
        } else if (rawData.type === 'terr_event') {
          applyTerrEvent(rawData.data);
        }
      });
      conn.on('error', () => { if (alive()) showToast('error', 'リーダーとの接続が切れました'); });
      conn.on('close', () => {
        if (alive()) showToast('warning', 'リーダーとの接続が切れました');
      });
    });

    peer.on('error', (err) => {
      if (!alive()) return;
      showToast('error', 'ルームが見つかりませんでした。番号を確認してください。');
    });
  };

  // 【ルームの後片付け】
  // 退出をあいてに伝えてから通信を切り、ローカルの状態をリセットしてホームへもどる。
  // 世代番号(peerSessionRef)を進めるので、切断が完了するまでの間に届いたメッセージでは
  // もう画面が動かない(＝抜けたはずの端末でゲームが始まってしまうことがない)。
  const teardownPeer = useCallback((notice) => {
    const p = peerStateRef.current;
    peerSessionRef.current += 1;

    if (p.role === 'client' && p.conn) safeSend(p.conn, { type: 'leave' }); // リーダーに「抜けます」と伝える
    if (p.role === 'host') sendToAll(p.connections, { type: 'room_closed', data: { reason: 'host' } });

    // 退出のメッセージを送りきってから切断する
    const peer = p.peer;
    if (peer && !peer.destroyed) setTimeout(() => { try { peer.destroy(); } catch (e) {} }, 300);

    memberSeenRef.current = {};
    setPeerState({ role: null, peer: null, conn: null, hostId: null, myName: '', connections: [], participants: {}, pending: {}, acceptUntil: 0, approved: false });
    raidRef.current = null;
    setRaidState(null);
    terrRef.current = null;
    setTerrState(null);
    setUrlHostId(null);
    setView('home');
    if (notice) showToast(notice.type, notice.msg);
  }, []);

  const leaveRoom = useCallback(() => {
    audioCtrl.playSE('click');
    teardownPeer({ type: 'success', msg: 'ルームから退出しました' });
  }, [teardownPeer]);

  // タブを閉じた/リロードしたときも、できるだけ退出をあいてへ伝えておく
  // (届かなかった場合はホスト側のハートビートが拾う)
  useEffect(() => {
    if (!peerState.role) return;
    const notifyLeave = () => {
      const p = peerStateRef.current;
      if (p.role === 'client' && p.conn) safeSend(p.conn, { type: 'leave' });
      if (p.role === 'host') sendToAll(p.connections, { type: 'room_closed', data: { reason: 'host' } });
    };
    window.addEventListener('beforeunload', notifyLeave);
    return () => window.removeEventListener('beforeunload', notifyLeave);
  }, [peerState.role]);

  const handleHomeClick = () => {
    audioCtrl.playSE('click');
    setUrlHostId(null);
    if (peerState.role) {
      leaveRoom();
    } else {
      setView('home');
    }
  };

  // ==========================================
  // スマホ・タブレットの「戻る」操作
  // 端末の戻るボタン(画面下のナビゲーションバー)と、画面のはしからのスワイプの
  // どちらでも、1つ前の階層の画面にもどれるようにする。
  // ダミーの履歴を1つ積んでおくので、ブラウザが前のページへ動いたりアプリが終了したりしない。
  // ==========================================
  useHistoryBackGuard();

  // ルームからぬけるときは、まちがえて全員のへやを閉じてしまわないように一度たしかめる
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  // ルームが先に閉じた(リーダーが解散した等)ときは、たしかめの表示も引っこめる
  useEffect(() => { if (!peerState.role) setLeaveConfirm(false); }, [peerState.role]);
  useBackHandler(leaveConfirm, () => { audioCtrl.playSE('click'); setLeaveConfirm(false); return true; }, BACK_PRIORITY.overlay);

  // 画面ごとの「1つ前の階層」。true をかえすと、そこで「戻る」は処理ずみになる。
  useBackHandler(true, () => {
    switch (view) {
      case 'singleConfig':
      case 'shop':
      case 'manager':
        audioCtrl.playSE('click'); setView('home'); return true;
      case 'import':
        audioCtrl.playSE('click'); setView('manager'); return true;
      case 'clientJoin':
        audioCtrl.playSE('click'); setUrlHostId(null); setView('home'); return true;
      case 'hostRoom':
      case 'clientWait':
        audioCtrl.playSE('click'); setLeaveConfirm(true); return true;
      case 'result':
        audioCtrl.playSE('click');
        if (peerState.role) setLeaveConfirm(true); else setView('home');
        return true;
      // game は GameView 側で「やめますか？」を出す。home はここがいちばん上なので何もしない。
      default:
        return true;
    }
  }, BACK_PRIORITY.app);

  useEffect(() => {
    if (!isMuted) { if (view === 'game') audioCtrl.playBGM('game'); else if (view === 'result') { audioCtrl.stopBGM(); } else audioCtrl.playBGM('home'); }
    else audioCtrl.stopBGM();
  }, [view, isMuted]);

  const GlobalStyle = () => {
    let themeVars = `
      --bg: #fffbf0; --primary: #FF6B6B; --secondary: #4ECDC4; --accent: #FFE66D; --text: #292f36; --panel: #ffffff; --primary-d: #e50000; --secondary-d: #247f79; --on-accent: #292f36;`;
    if (stats.theme === 'dark') themeVars = `--bg: #0f172a; --primary: #f43f5e; --secondary: #0ea5e9; --accent: #f59e0b; --text: #e2e8f0; --panel: #1e293b; --primary-d: #f65c76; --secondary-d: #0ea5e9; --on-accent: #111111;`;
    if (stats.theme === 'sakura') themeVars = `--bg: #fdf2f8; --primary: #d946ef; --secondary: #f472b6; --accent: #fbcfe8; --text: #831843; --panel: #ffffff; --primary-d: #ba12d4; --secondary-d: #d31076; --on-accent: #831843;`;
    if (stats.theme === 'ocean') themeVars = `--bg: #f0f9ff; --primary: #0284c7; --secondary: #38bdf8; --accent: #7dd3fc; --text: #0c4a6e; --panel: #ffffff; --primary-d: #0277b3; --secondary-d: #0678ab; --on-accent: #0c4a6e;`;
    if (stats.theme === 'forest') themeVars = `--bg: #f0fdf4; --primary: #16a34a; --secondary: #f59e0b; --accent: #bbf7d0; --text: #14532d; --panel: #ffffff; --primary-d: #11813b; --secondary-d: #9e6506; --on-accent: #14532d;`;
    if (stats.theme === 'space') themeVars = `--bg: #17153B; --primary: #c084fc; --secondary: #2dd4bf; --accent: #4338ca; --text: #e2e8f0; --panel: #2e2b5f; --primary-d: #c084fc; --secondary-d: #2dd4bf; --on-accent: #e2e8f0;`;
    if (stats.theme === 'gold') themeVars = `--bg: #fefce8; --primary: #b45309; --secondary: #eab308; --accent: #fef08a; --text: #713f12; --panel: #ffffff; --primary-d: #b45309; --secondary-d: #8f6d05; --on-accent: #713f12;`;
    if (stats.theme === 'mint') themeVars = `--bg: #f0fdfa; --primary: #14b8a6; --secondary: #2dd4bf; --accent: #ccfbf1; --text: #134e4a; --panel: #ffffff; --primary-d: #0e7e72; --secondary-d: #1a7f72; --on-accent: #134e4a;`;
    if (stats.theme === 'sunset') themeVars = `--bg: #fff7ed; --primary: #ea580c; --secondary: #f97316; --accent: #fcd34d; --text: #7c2d12; --panel: #ffffff; --primary-d: #c3490a; --secondary-d: #bb5005; --on-accent: #7c2d12;`;
    if (stats.theme === 'cyber') themeVars = `--bg: #000000; --primary: #39ff14; --secondary: #ff00ff; --accent: #0ff0fc; --text: #ffffff; --panel: #111111; --primary-d: #39ff14; --secondary-d: #ff00ff; --on-accent: #111111;`;
    if (stats.theme === 'choco') themeVars = `--bg: #fdf8f5; --primary: #92400e; --secondary: #d97706; --accent: #fde68a; --text: #451a03; --panel: #ffffff; --primary-d: #92400e; --secondary-d: #aa5d05; --on-accent: #451a03;`;
    if (stats.theme === 'retro') themeVars = `--bg: #f5eedc; --primary: #c25953; --secondary: #6a7f72; --accent: #e0b469; --text: #3d312d; --panel: #faf6ee; --primary-d: #b44640; --secondary-d: #5c6e63; --on-accent: #3d312d;`;
    if (stats.theme === 'monochrome') themeVars = `--bg: #f8f9fa; --primary: #000000; --secondary: #666666; --accent: #d4d4d4; --text: #1a1a1a; --panel: #ffffff; --primary-d: #000000; --secondary-d: #666666; --on-accent: #1a1a1a;`;
    if (stats.theme === 'lavender') themeVars = `--bg: #f5f3ff; --primary: #7c3aed; --secondary: #a78bfa; --accent: #ddd6fe; --text: #4c1d95; --panel: #ffffff; --primary-d: #7c3aed; --secondary-d: #774bf7; --on-accent: #4c1d95;`;
    if (stats.theme === 'candy') themeVars = `--bg: #fff0f6; --primary: #ec4899; --secondary: #60a5fa; --accent: #a5f3fc; --text: #9d174d; --panel: #ffffff; --primary-d: #d21673; --secondary-d: #0768e0; --on-accent: #9d174d;`;
    if (stats.theme === 'soda') themeVars = `--bg: #eff6ff; --primary: #2563eb; --secondary: #22d3ee; --accent: #bfdbfe; --text: #1e3a8a; --panel: #ffffff; --primary-d: #2563eb; --secondary-d: #0b7a8b; --on-accent: #1e3a8a;`;
    if (stats.theme === 'matcha') themeVars = `--bg: #f7fee7; --primary: #4d7c0f; --secondary: #84cc16; --accent: #d9f99d; --text: #365314; --panel: #ffffff; --primary-d: #4d7c0f; --secondary-d: #517e0e; --on-accent: #365314;`;
    if (stats.theme === 'ruby') themeVars = `--bg: #fff1f2; --primary: #be123c; --secondary: #fb7185; --accent: #fecdd3; --text: #881337; --panel: #ffffff; --primary-d: #be123c; --secondary-d: #dc0625; --on-accent: #881337;`;
    if (stats.theme === 'hero') themeVars = `--bg: #f8fafc; --primary: #dc2626; --secondary: #2563eb; --accent: #fde047; --text: #111827; --panel: #ffffff; --primary-d: #dc2626; --secondary-d: #2563eb; --on-accent: #111827;`;
    if (stats.theme === 'aurora') themeVars = `--bg: #042f2e; --primary: #34d399; --secondary: #818cf8; --accent: #115e59; --text: #ccfbf1; --panel: #134e4a; --primary-d: #34d399; --secondary-d: #aab1fa; --on-accent: #ccfbf1;`;
    if (stats.theme === 'hanabi') themeVars = `--bg: #1e1b4b; --primary: #f472b6; --secondary: #facc15; --accent: #6d28d9; --text: #ede9fe; --panel: #312e81; --primary-d: #f57ebc; --secondary-d: #facc15; --on-accent: #ede9fe;`;
    if (stats.theme === 'midnight') themeVars = `--bg: #020617; --primary: #38bdf8; --secondary: #818cf8; --accent: #1e293b; --text: #e0f2fe; --panel: #0f172a; --primary-d: #38bdf8; --secondary-d: #818cf8; --on-accent: #e0f2fe;`;
    if (stats.theme === 'ninja') themeVars = `--bg: #18181b; --primary: #ef4444; --secondary: #a1a1aa; --accent: #3f3f46; --text: #f4f4f5; --panel: #27272a; --primary-d: #f15e5e; --secondary-d: #a1a1aa; --on-accent: #f4f4f5;`;
    if (stats.theme === 'royal') themeVars = `--bg: #faf5ff; --primary: #7e22ce; --secondary: #eab308; --accent: #e9d5ff; --text: #581c87; --panel: #ffffff; --primary-d: #7e22ce; --secondary-d: #8c6b05; --on-accent: #581c87;`;
    if (stats.theme === 'rainbow') themeVars = `--bg: #fdf4ff; --primary: #e11d48; --secondary: #0ea5e9; --accent: #fde047; --text: #3b0764; --panel: #ffffff; --primary-d: #da1c46; --secondary-d: #0a77a8; --on-accent: #3b0764;`;
    if (stats.theme === 'sunflower') themeVars = `--bg: #fefce8; --primary: #ca8a04; --secondary: #22c55e; --accent: #fde047; --text: #422006; --panel: #ffffff; --primary-d: #986803; --secondary-d: #17843f; --on-accent: #422006;`;
    if (stats.theme === 'watermelon') themeVars = `--bg: #f0fdf4; --primary: #ef4444; --secondary: #22c55e; --accent: #fecaca; --text: #14532d; --panel: #ffffff; --primary-d: #e21313; --secondary-d: #16823e; --on-accent: #14532d;`;
    if (stats.theme === 'milktea') themeVars = `--bg: #f5f0e8; --primary: #a16207; --secondary: #78716c; --accent: #e7d8c0; --text: #44403c; --panel: #fffaf3; --primary-d: #9a5e07; --secondary-d: #716b66; --on-accent: #44403c;`;
    if (stats.theme === 'tropical') themeVars = `--bg: #ecfeff; --primary: #f59e0b; --secondary: #06b6d4; --accent: #a7f3d0; --text: #164e63; --panel: #ffffff; --primary-d: #9e6506; --secondary-d: #047d91; --on-accent: #164e63;`;
    if (stats.theme === 'halloween') themeVars = `--bg: #1c1917; --primary: #f97316; --secondary: #a855f7; --accent: #78350f; --text: #fed7aa; --panel: #292524; --primary-d: #f97316; --secondary-d: #b36bf8; --on-accent: #fed7aa;`;
    if (stats.theme === 'christmas') themeVars = `--bg: #fef2f2; --primary: #dc2626; --secondary: #16a34a; --accent: #fde68a; --text: #7f1d1d; --panel: #ffffff; --primary-d: #d82323; --secondary-d: #117f3a; --on-accent: #7f1d1d;`;
    if (stats.theme === 'prism') themeVars = `--bg: #f5fffa; --primary: #8b5cf6; --secondary: #ec4899; --accent: #99f6e4; --text: #1e1b4b; --panel: #ffffff; --primary-d: #8250f5; --secondary-d: #db1778; --on-accent: #1e1b4b;`;

    return (
      <style>{`
        /* フォントの読みこみは main.jsx (同梱の woff2)。外部への通信はない */
        :root { ${themeVars} }
        body { font-family: var(--font-ui); background-color: var(--bg); color: var(--text); touch-action: manipulation; transition: background-color 0.3s ease; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        ::selection { background-color: var(--accent); color: var(--text); }
        ruby { ruby-align: center; }
        ruby rt { font-size: 0.5em; font-weight: 500; letter-spacing: 0; }
        .ruby-text { line-height: 1.8; }
        .avatar-fx { animation: fxTwinkle 1.8s ease-in-out infinite; }
        .avatar-fx-delay { animation: fxTwinkle 1.8s ease-in-out 0.6s infinite; }
        .avatar-fx-delay2 { animation: fxTwinkle 1.8s ease-in-out 1.2s infinite; }
        @keyframes fxTwinkle { 0%, 100% { opacity: 0.25; transform: scale(0.75); } 50% { opacity: 1; transform: scale(1.2); } }
      `}</style>
    );
  };

  return (
    // reducedMotion="user" は端末の「視差効果を減らす」を framer-motion に守らせる指定。
    // アプリ内の「えんしゅつをへらす」が入っているときは "always" にして、
    // OS の設定に手が届かない児童でも動きを止められるようにする（Part I §2-10）
    <MotionConfig reducedMotion={reduceFx ? 'always' : 'user'}>
    {/* 横向きにしたときノッチ側が欠けないよう、左右にセーフエリアぶんの余白を足す（Part I §2-3） */}
    <div
      className="flex flex-col h-[100dvh] w-full bg-[var(--bg)] relative overflow-hidden transition-colors duration-500"
      style={{ paddingLeft: 'var(--safe-l)', paddingRight: 'var(--safe-r)' }}
    >
      <GlobalStyle />
      {view !== 'game' && (
        <header
          className="flex-shrink-0 bg-[var(--panel)]/90 backdrop-blur border-b-[4px] border-[var(--accent)] py-3 px-5 flex justify-between items-center z-50 sticky top-0 shadow-sm transition-colors duration-500"
          // 上端のノッチ・ステータスバーにタイトルが潜りこまないようにする
          style={{ paddingTop: 'calc(0.75rem + var(--safe-t))' }}
        >
          <div className="flex items-center cursor-pointer gap-2" onClick={handleHomeClick}>
            <div className="bg-[var(--secondary)] p-1.5 rounded-lg text-[var(--panel)] shadow-sm border-2 border-[var(--text)]"><Calculator size={22} strokeWidth={3} /></div>
            <h1 className="text-2xl font-black text-[var(--text)] tracking-wide">Qalc<span className="text-[var(--primary-d)]">.</span></h1>
          </div>
          <div className="flex items-center gap-3">
            {peerState.role && <span className="font-bold text-xs bg-[var(--accent)] px-2 py-1 rounded border-2 border-[var(--text)]">{peerState.role === 'host' ? 'リーダー' : 'メンバー'}</span>}
            {/* ホーム画面に置くための案内。入れ終わったら自分で消える */}
            <InstallButton onSound={() => audioCtrl.playSE('click')} />
            {/* 電子黒板に映すときの拡大・全画面・名前かくし（Part I §2-11） */}
            <PresentationControl onSound={() => audioCtrl.playSE('click')} />
            <button
              onClick={() => setIsMuted(audioCtrl.toggle())}
              aria-label={isMuted ? 'おとを出す' : 'おとを消す'}
              className="text-[var(--text)] opacity-80 hover:opacity-100 p-2 rounded-full transition-all border-2 border-transparent hover:border-[var(--text)] hover:bg-[var(--bg)] min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} className="text-[var(--primary-d)]" />}
            </button>
          </div>
        </header>
      )}

      <main className="flex-grow relative overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'home' && <PageWrapper key="home"><HomeView setView={setView} stats={stats} setStats={setStats} setConfigMode={setConfigMode} initHost={initHost} resumeData={resumeData} onResume={resumeGame} onDiscardResume={discardResume} /></PageWrapper>}
          {view === 'singleConfig' && <PageWrapper key="single"><SingleConfigView setView={setView} setState={setState} configMode={configMode} stats={stats} /></PageWrapper>}

          {/* 追加ビュー */}
          {view === 'hostRoom' && <PageWrapper key="host"><HostRoomView peerState={peerState} setPeerState={setPeerState} broadcast={broadcast} setView={setView} setState={setState} configMode={configMode} setConfigMode={setConfigMode} initRaid={initRaid} initTerritory={initTerritory} approveMember={hostApproveMember} rejectMember={hostRejectMember} /></PageWrapper>}
          {view === 'clientJoin' && <PageWrapper key="clientJoin"><ClientJoinView initClient={initClient} urlHostId={urlHostId} setView={setView} /></PageWrapper>}
          {view === 'clientWait' && <PageWrapper key="clientWait"><ClientWaitView peerState={peerState} leaveRoom={leaveRoom} /></PageWrapper>}

          {view === 'game' && <PageWrapper key="game"><GameView state={state} setState={setState} setView={setView} stats={stats} setStats={setStats} peerState={peerState} setPeerState={setPeerState} setResumeData={setResumeData} raidState={raidState} sendRaidAttack={sendRaidAttack} sendRaidSupport={sendRaidSupport} collectRaidResult={collectRaidResult} terrState={terrState} sendTerrCharge={sendTerrCharge} sendTerrTarget={sendTerrTarget} sendTerrSpecial={sendTerrSpecial} collectTerritoryResult={collectTerritoryResult} /></PageWrapper>}
          {view === 'result' && <PageWrapper key="result"><ResultView state={state} setView={setView} peerState={peerState} leaveRoom={leaveRoom} /></PageWrapper>}
          {view === 'manager' && <PageWrapper key="manager"><ManagerView setView={setView} /></PageWrapper>}
          {view === 'import' && <PageWrapper key="import"><ImportView setView={setView} /></PageWrapper>}
          {view === 'shop' && <PageWrapper key="shop"><ShopView setView={setView} stats={stats} setStats={setStats} /></PageWrapper>}
        </AnimatePresence>
      </main>

      {view !== 'game' && (
        <footer
          className="w-full bg-[var(--panel)] border-t-[3px] border-[var(--text)] pt-3 pb-2 text-center text-sm text-[var(--text)] font-bold shrink-0 z-50 transition-colors duration-500"
          // iPhone のホームバーに文字が重ならないようにする（Part I §2-3）
          style={{ paddingBottom: 'calc(0.5rem + var(--safe-b))' }}
        >
          <p>
            © {new Date().getFullYear()} Qalc
            {/* outline-none を外した。キーボードだけで操作している人に、
                いまここにフォーカスがあることが見えなくなっていたため（Part I §4）。
                inline-flex + min-h で押しどころも 44px を確保する（Part I §2-9） */}
            <a href="https://note.com/cute_borage86" target="_blank" rel="noopener noreferrer" className="ml-1 text-[var(--text)] inline-flex items-center justify-center min-h-[44px] px-2 align-middle">
              GIGA山
            </a>
          </p>
        </footer>
      )}

      {/* ルームからぬけるまえのたしかめ(「戻る」でうっかり全員のへやを閉じないように) */}
      <AnimatePresence>
        {leaveConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} role="dialog" aria-modal="true" aria-label="へやから 出るかの かくにん" exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-xs flex flex-col items-center text-center">
              <Users size={48} className="text-[var(--primary-d)] mb-3" />
              <h3 className="font-black text-xl text-[var(--text)] mb-2 ruby-text">へやから<R c="出" r="で" />ますか？</h3>
              <p className="text-sm text-[var(--text)] opacity-80 mb-5 ruby-text">
                {peerState.role === 'host'
                  ? <>リーダーが<R c="出" r="で" />ると、みんなのへやも<R c="終" r="お" />わります</>
                  : <>ホーム<R c="画" r="が" /><R c="面" r="めん" />にもどります</>}
              </p>
              <div className="flex w-full gap-3">
                <MotionButton className="bg-[var(--bg)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={() => setLeaveConfirm(false)}>やめる</MotionButton>
                <MotionButton className="bg-[var(--primary)] text-[var(--panel)] border-[3px] border-[var(--text)] py-3 flex-1 ruby-text" onClick={() => { setLeaveConfirm(false); leaveRoom(); }}><R c="出" r="で" />る</MotionButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 画面のはしから中央へのスワイプで「戻る」。ホームはいちばん上の階層なので出さない */}
      <EdgeSwipeBack enabled={view !== 'home'} />

      {/* カスタム通知コンポーネントを配置 */}
      <CustomToast />

      {/* あたらしいバージョンがあります（押すまで入れかわらない） */}
      <UpdateNotice />
    </div>
    </MotionConfig>
  );
}