import React, { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calculator, Trash2, PenTool, Home, Rocket,
  Flame, Clock, Award, Settings, Plus, XCircle, Bot, Volume2,
  VolumeX, ArrowLeftRight, Share2, BarChart3, Trophy, User,
  Gamepad2, Swords, Timer, Download, HeartCrack, Coins,
  Store, CheckCircle2, PaintBucket, Shirt, Users, Radio,
  LayoutDashboard, Lightbulb
} from 'lucide-react';
import { LearningToolPanel, getAvailableTools } from './LearningTools.jsx';
import { createStudySession, STUDY_ABORT_AWAY_MS } from './studySession.js';
import { loadStudyRecords, summarize, topMissedItems } from './studyStats.js';
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
const DEFAULT_PROBLEMS = {
  "4年_計算のきまり": ["50-(10+20)|20", "100-(30+40)|30", "80-(20+30)|30", "60-(15+15)|30", "25-(5+10)|10", "40-(12+8)|20", "90-(50+10)|30", "120-(20+80)|20", "35-(5+15)|15", "200-(100+50)|50", "(3+2)×4|20", "(5+5)×6|60", "(10+20)×3|90", "(4+6)×8|80", "(20+5)×2|50", "(12+8)×5|100", "(7+3)×9|90", "(50+10)×2|120", "(2+8)×7|70", "(15+15)×3|90", "4×(10-2)|32", "5×(20-10)|50", "6×(8-3)|30", "3×(15-5)|30", "9×(10-1)|81", "2×(50-25)|50", "8×(6-4)|16", "10×(30-20)|100", "7×(20-15)|35", "4×(25-5)|80", "(10+20)÷3|10", "(15+5)÷4|5", "(30+10)÷5|8", "(18+12)÷6|5", "(40+24)÷8|8", "(50+40)÷9|10", "(2+12)÷7|2", "(60+40)÷10|10", "(14+14)÷4|7", "(27+3)÷3|10", "5+2×3|11", "10+4×5|30", "20+3×6|38", "50+10×2|70", "8+5×4|28", "15+2×10|35", "6+8×8|70", "12+3×9|39", "40+5×5|65", "100+10×10|200", "20-2×5|10", "50-4×8|18", "30-3×9|3", "100-10×5|50", "60-6×7|18", "45-5×5|20", "25-2×10|5", "80-8×8|16", "15-3×4|3", "40-4×9|4", "10+10÷2|15", "20+20÷4|25", "30+15÷3|35", "5+40÷8|10", "6+42÷6|13", "12+18÷2|21", "50+50÷5|60", "100+100÷10|110", "8+24÷3|16", "15+45÷9|20", "20-10÷2|15", "30-15÷3|25", "50-20÷4|45", "18-12÷6|16", "40-32÷8|36", "100-50÷5|90", "60-24÷6|56", "25-25÷5|20", "80-40÷10|76", "15-12÷4|12", "2×5+10|20", "3×4+8|20", "6×6+14|50", "5×9+5|50", "8×2+30|46", "4×10+60|100", "7×3+9|30", "9×8+8|80", "10×10+100|200", "2×50+50|150", "20÷2-5|5", "30÷3-8|2", "48÷6-5|3", "100÷5-10|10", "56÷8-4|3", "25÷5-1|4", "72÷9-6|2", "40÷4-9|1", "60÷6-5|5", "120÷2-10|50"],
  "4年_がい数（四捨五入）": ["12を 十の位までの がい数にすると？|10", "28を 十の位までの がい数にすると？|30", "34を 十の位までの がい数にすると？|30", "45を 十の位までの がい数にすると？|50", "56を 十の位までの がい数にすると？|60", "61を 十の位までの がい数にすると？|60", "79を 十の位までの がい数にすると？|80", "83を 十の位までの がい数にすると？|80", "94を 十の位までの がい数にすると？|90", "97を 十の位までの がい数にすると？|100", "123を 十の位までの がい数にすると？|120", "158を 十の位までの がい数にすると？|160", "342を 十の位までの がい数にすると？|340", "675を 十の位までの がい数にすると？|680", "996を 十の位までの がい数にすると？|1000", "120を 百の位までの がい数にすると？|100", "150を 百の位までの がい数にすると？|200", "240を 百の位までの がい数にすると？|200", "260を 百の位までの がい数にすると？|300", "333を 百の位までの がい数にすると？|300", "389を 百の位までの がい数にすると？|400", "449を 百の位までの がい数にすると？|400", "451を 百の位までの がい数にすると？|500", "510を 百の位までの がい数にすると？|500", "590を 百の位までの がい数にすると？|600", "650を 百の位までの がい数にすると？|700", "649を 百の位までの がい数にすると？|600", "725を 百の位までの がい数にすると？|700", "780を 百の位までの がい数にすると？|800", "810を 百の位までの がい数にすると？|800", "899を 百の位までの がい数にすると？|900", "940を 百の位までの がい数にすると？|900", "950を 百の位までの がい数にすると？|1000", "1040を 百の位までの がい数にすると？|1000", "1060を 百の位までの がい数にすると？|1100", "1450を 百の位までの がい数にすると？|1500", "2340を 百の位までの がい数にすると？|2300", "3670を 百の位までの がい数にすると？|3700", "4980を 百の位までの がい数にすると？|5000", "5020を 百の位までの がい数にすると？|5000", "6190を 百の位までの がい数にすると？|6200", "7530を 百の位までの がい数にすると？|7500", "8210を 百の位までの がい数にすると？|8200", "9960を 百の位までの がい数にすると？|10000", "12345を 百の位までの がい数にすると？|12300", "1200を 千の位までの がい数にすると？|1000", "1500を 千の位までの がい数にすると？|2000", "2400を 千の位までの がい数にすると？|2000", "2600を 千の位までの がい数にすると？|3000", "3499を 千の位までの がい数にすると？|3000", "3500を 千の位までの がい数にすると？|4000", "4100を 千の位までの がい数にすると？|4000", "4900を 千の位までの がい数にすると？|5000", "5250を 千の位までの がい数にすると？|5000", "5800を 千の位までの がい数にすると？|6000", "6499を 千の位までの がい数にすると？|6000", "6501を 千の位までの がい数にすると？|7000", "7090を 千の位までの がい数にすると？|7000", "7600を 千の位までの がい数にすると？|8000", "8300を 千の位までの がい数にすると？|8000", "8500を 千の位までの がい数にすると？|9000", "9200を 千の位までの がい数にすると？|9000", "9800を 千の位までの がい数にすると？|10000", "10400を 千の位までの がい数にすると？|10000", "10600を 千の位までの がい数にすると？|11000", "23450を 千の位までの がい数にすると？|23000", "34567を 千の位までの がい数にすると？|35000", "49900を 千の位までの がい数にすると？|50000", "50500を 千の位までの がい数にすると？|51000", "61200を 千の位までの がい数にすると？|61000", "78900を 千の位までの がい数にすると？|79000", "89500を 千の位までの がい数にすると？|90000", "99800を 千の位までの がい数にすると？|100000", "123456を 千の位までの がい数にすると？|123000", "654321を 千の位までの がい数にすると？|654000", "12000を 万の位までの がい数にすると？|10000", "15000を 万の位までの がい数にすると？|20000", "24000を 万の位までの がい数にすると？|20000", "26000を 万の位までの がい数にすると？|30000", "33333を 万の位までの がい数にすると？|30000", "36789を 万の位までの がい数にすると？|40000", "44999を 万の位までの がい数にすると？|40000", "45000を 万の位までの がい数にすると？|50000", "51234を 万の位までの がい数にすると？|50000", "59876を 万の位までの がい数にすると？|60000", "60500を 万の位までの がい数にすると？|60000", "68000を 万の位までの がい数にすると？|70000", "72000を 万の位までの がい数にすると？|70000", "75000を 万の位までの がい数にすると？|80000", "84000を 万の位までの がい数にすると？|80000", "86000を 万の位までの がい数にすると？|90000", "93000を 万の位までの がい数にすると？|90000", "98000を 万の位までの がい数にすると？|100000", "123000を 万の位までの がい数にすると？|120000", "156000を 万の位までの がい数にすると？|160000", "395000を 万の位までの がい数にすると？|400000", "404000を 万の位までの がい数にすると？|400000", "555555を 万の位までの がい数にすると？|560000", "899000を 万の位までの がい数にすると？|900000"],
  "4年_小数×整数": ["0.2 × 3|0.6", "0.4 × 2|0.8", "0.3 × 3|0.9", "1.2 × 2|2.4", "2.1 × 4|8.4", "3.2 × 3|9.6", "4.1 × 2|8.2", "1.1 × 5|5.5", "2.3 × 3|6.9", "1.2 × 4|4.8", "3.4 × 2|6.8", "0.5 × 1|0.5", "2.2 × 4|8.8", "1.3 × 3|3.9", "4.3 × 2|8.6", "0.6 × 2|1.2", "0.5 × 3|1.5", "0.8 × 4|3.2", "0.7 × 5|3.5", "1.5 × 2|3", "2.5 × 4|10", "3.5 × 2|7", "4.5 × 2|9", "1.6 × 5|8", "2.4 × 5|12", "1.8 × 3|5.4", "2.7 × 3|8.1", "3.6 × 2|7.2", "4.8 × 2|9.6", "5.2 × 4|20.8", "6.3 × 5|31.5", "7.4 × 3|22.2", "8.9 × 2|17.8", "9.5 × 4|38", "3.8 × 5|19", "0.02 × 3|0.06", "0.04 × 2|0.08", "0.05 × 5|0.25", "0.08 × 9|0.72", "0.12 × 4|0.48", "0.25 × 2|0.5", "0.15 × 6|0.9", "0.36 × 2|0.72", "1.23 × 2|2.46", "2.14 × 2|4.28", "3.05 × 3|9.15", "4.12 × 4|16.48", "1.45 × 2|2.9", "2.75 × 2|5.5", "3.25 × 4|13", "5.12 × 5|25.6", "0.05 × 2|0.1", "0.25 × 4|1", "0.75 × 4|3", "1.50 × 2|3", "0.3 × 10|3", "0.7 × 10|7", "1.5 × 10|15", "2.9 × 10|29", "0.05 × 10|0.5", "0.48 × 10|4.8", "1.25 × 10|12.5", "0.02 × 100|2", "0.09 × 100|9", "0.15 × 100|15", "1.45 × 100|145", "2.06 × 100|206", "0.3 × 100|30", "1.8 × 100|180", "2.5 × 100|250", "1.2 × 12|14.4", "2.3 × 11|25.3", "1.5 × 14|21", "2.5 × 12|30", "3.2 × 15|48", "4.5 × 12|54", "0.8 × 25|20", "0.5 × 16|8", "0.4 × 15|6", "0.6 × 15|9", "1.8 × 20|36", "2.4 × 30|72", "0.12 × 12|1.44", "0.25 × 12|3", "0.15 × 20|3", "0.45 × 20|9", "3.14 × 10|31.4", "3.14 × 2|6.28", "1.05 × 12|12.6", "2.02 × 31|62.62", "0.25 × 8|2", "0.125 × 8|1", "1.5 × 6|9", "2.5 × 6|15", "3.5 × 4|14", "4.5 × 6|27", "0.04 × 25|1", "0.08 × 25|2", "1.2 × 50|60", "0.6 × 50|30", "2.4 × 5|12", "1.6 × 50|80", "5.5 × 2|11", "5.5 × 4|22", "9.9 × 10|99"],
  "5年_小数のかけわり": ["0.2 × 0.3|0.06", "0.2 × 0.4|0.08", "0.3 × 0.2|0.06", "0.3 × 0.3|0.09", "0.4 × 0.2|0.08", "0.2 × 0.5|0.1", "0.5 × 0.2|0.1", "0.3 × 0.4|0.12", "0.4 × 0.3|0.12", "0.2 × 0.6|0.12", "0.6 × 0.2|0.12", "0.3 × 0.5|0.15", "0.5 × 0.3|0.15", "0.4 × 0.4|0.16", "0.2 × 0.8|0.16", "0.3 × 0.6|0.18", "0.6 × 0.3|0.18", "0.2 × 0.9|0.18", "0.4 × 0.5|0.2", "0.5 × 0.4|0.2", "0.3 × 0.7|0.21", "0.7 × 0.3|0.21", "0.4 × 0.6|0.24", "0.6 × 0.4|0.24", "0.3 × 0.8|0.24", "0.8 × 0.3|0.24", "0.5 × 0.5|0.25", "0.3 × 0.9|0.27", "0.9 × 0.3|0.27", "0.4 × 0.7|0.28", "0.7 × 0.4|0.28", "0.5 × 0.6|0.3", "0.6 × 0.5|0.3", "0.4 × 0.8|0.32", "0.8 × 0.4|0.32", "0.5 × 0.7|0.35", "0.7 × 0.5|0.35", "0.4 × 0.9|0.36", "0.9 × 0.4|0.36", "0.6 × 0.6|0.36", "0.5 × 0.8|0.4", "0.8 × 0.5|0.4", "0.6 × 0.7|0.42", "0.7 × 0.6|0.42", "0.5 × 0.9|0.45", "0.9 × 0.5|0.45", "0.6 × 0.8|0.48", "0.8 × 0.6|0.48", "0.7 × 0.7|0.49", "0.6 × 0.9|0.54", "0.9 × 0.6|0.54", "0.7 × 0.8|0.56", "0.8 × 0.7|0.56", "0.7 × 0.9|0.63", "0.9 × 0.7|0.63", "0.8 × 0.8|0.64", "0.8 × 0.9|0.72", "0.9 × 0.8|0.72", "0.9 × 0.9|0.81", "1.2 × 0.5|0.6", "1.5 × 0.2|0.3", "1.5 × 0.4|0.6", "1.5 × 0.6|0.9", "2.5 × 0.2|0.5", "2.5 × 0.4|1", "2.5 × 0.8|2", "4.5 × 0.2|0.9", "5.5 × 0.2|1.1", "1.2 × 1.2|1.44", "1.1 × 1.1|1.21", "0.25 × 0.4|0.1", "0.12 × 0.5|0.06", "0.75 × 0.2|0.15", "0.6 ÷ 0.2|3", "0.8 ÷ 0.2|4", "0.8 ÷ 0.4|2", "0.9 ÷ 0.3|3", "1.2 ÷ 0.2|6", "1.2 ÷ 0.3|4", "1.2 ÷ 0.4|3", "1.2 ÷ 0.6|2", "1.4 ÷ 0.2|7", "1.4 ÷ 0.7|2", "1.5 ÷ 0.3|5", "1.5 ÷ 0.5|3", "1.6 ÷ 0.2|8", "1.6 ÷ 0.4|4", "1.6 ÷ 0.8|2", "1.8 ÷ 0.2|9", "1.8 ÷ 0.3|6", "1.8 ÷ 0.6|3", "1.8 ÷ 0.9|2", "2.1 ÷ 0.3|7", "2.1 ÷ 0.7|3", "2.4 ÷ 0.3|8", "2.4 ÷ 0.4|6", "2.4 ÷ 0.6|4", "2.4 ÷ 0.8|3", "2.5 ÷ 0.5|5", "2.7 ÷ 0.3|9", "2.7 ÷ 0.9|3", "3.2 ÷ 0.4|8", "3.2 ÷ 0.8|4", "3.5 ÷ 0.5|7", "3.5 ÷ 0.7|5", "3.6 ÷ 0.4|9", "3.6 ÷ 0.6|6", "3.6 ÷ 0.9|4", "4.2 ÷ 0.6|7", "4.2 ÷ 0.7|6", "4.5 ÷ 0.5|9", "4.5 ÷ 0.9|5", "4.8 ÷ 0.6|8", "4.8 ÷ 0.8|6", "4.9 ÷ 0.7|7", "5.4 ÷ 0.6|9", "5.4 ÷ 0.9|6", "5.6 ÷ 0.7|8", "5.6 ÷ 0.8|7", "6.3 ÷ 0.7|9", "6.3 ÷ 0.9|7", "6.4 ÷ 0.8|8", "7.2 ÷ 0.8|9", "7.2 ÷ 0.9|8", "8.1 ÷ 0.9|9", "6 ÷ 0.5|12", "2 ÷ 0.5|4", "3 ÷ 0.5|6", "4 ÷ 0.5|8", "1 ÷ 0.2|5", "2 ÷ 0.2|10", "1 ÷ 0.4|2.5", "2 ÷ 0.4|5", "3 ÷ 0.4|7.5", "1 ÷ 0.8|1.25", "0.36 ÷ 0.6|0.6", "0.48 ÷ 0.8|0.6", "0.15 ÷ 0.3|0.5", "0.14 ÷ 0.7|0.2", "0.08 ÷ 0.4|0.2", "0.27 ÷ 0.3|0.9"],
  "5年_割合パッ！（小数→％）": ["0.1 → ?%|10", "0.2 → ?%|20", "0.3 → ?%|30", "0.4 → ?%|40", "0.5 → ?%|50", "0.6 → ?%|60", "0.7 → ?%|70", "0.8 → ?%|80", "0.9 → ?%|90", "1.0 → ?%|100", "0.11 → ?%|11", "0.12 → ?%|12", "0.15 → ?%|15", "0.18 → ?%|18", "0.23 → ?%|23", "0.25 → ?%|25", "0.34 → ?%|34", "0.39 → ?%|39", "0.45 → ?%|45", "0.49 → ?%|49", "0.51 → ?%|51", "0.55 → ?%|55", "0.62 → ?%|62", "0.68 → ?%|68", "0.75 → ?%|75", "0.76 → ?%|76", "0.83 → ?%|83", "0.88 → ?%|88", "0.95 → ?%|95", "0.99 → ?%|99", "0.01 → ?%|1", "0.02 → ?%|2", "0.03 → ?%|3", "0.04 → ?%|4", "0.05 → ?%|5", "0.06 → ?%|6", "0.07 → ?%|7", "0.08 → ?%|8", "0.09 → ?%|9", "1 → ?%|100", "2 → ?%|200", "1.1 → ?%|110", "1.2 → ?%|120", "1.5 → ?%|150", "1.8 → ?%|180", "2.5 → ?%|250", "3.2 → ?%|320", "1.01 → ?%|101", "1.05 → ?%|105", "1.15 → ?%|115", "1.25 → ?%|125", "2.05 → ?%|205", "1.9 → ?%|190", "0.125 → ?%|12.5", "0.375 → ?%|37.5", "0.625 → ?%|62.5", "0.875 → ?%|87.5", "0.005 → ?%|0.5", "0.015 → ?%|1.5", "0.025 → ?%|2.5", "0.105 → ?%|10.5", "5 → ?%|500", "0.001 → ?%|0.1", "0.111 → ?%|11.1", "3 → ?%|300", "0.22 → ?%|22", "1.08 → ?%|108", "0.108 → ?%|10.8"],
  "5年_分数たしひき": ["1/2 + 1/4|3/4", "1/4 + 1/2|3/4", "1/2 + 3/8|7/8", "3/8 + 1/2|7/8", "1/3 + 1/6|1/2|3/6", "1/6 + 1/3|1/2|3/6", "1/3 + 2/9|5/9", "2/9 + 1/3|5/9", "1/4 + 1/8|3/8", "1/8 + 1/4|3/8", "1/4 + 3/8|5/8", "3/8 + 1/4|5/8", "1/4 + 5/12|2/3|8/12", "1/5 + 1/10|3/10", "2/5 + 3/10|7/10", "1/6 + 5/12|7/12", "1/2 + 1/3|5/6", "1/3 + 1/2|5/6", "1/2 + 1/5|7/10", "1/5 + 1/2|7/10", "1/2 + 1/7|9/14", "1/3 + 1/4|7/12", "1/4 + 1/3|7/12", "1/3 + 1/5|8/15", "1/3 + 2/5|11/15", "2/3 + 1/5|13/15", "1/3 + 1/7|10/21", "1/4 + 1/5|9/20", "1/4 + 2/5|13/20", "3/4 + 1/5|19/20", "1/5 + 1/6|11/30", "1/6 + 1/5|11/30", "1/2 + 1/6|2/3|4/6", "1/6 + 1/2|2/3|4/6", "1/2 + 3/10|4/5|8/10", "1/3 + 1/9|4/9", "1/4 + 1/12|1/3|4/12", "1/6 + 1/12|1/4|3/12", "1/6 + 1/3|1/2|3/6", "1/2 + 1/2|1", "1/3 + 2/3|1", "1/4 + 3/4|1", "2/5 + 3/5|1", "1/6 + 5/6|1", "1/3 + 4/6|1", "1/2 + 2/4|1", "1/4 + 6/8|1", "1/5 + 8/10|1", "1/2 - 1/4|1/4", "3/4 - 1/2|1/4", "1/2 - 3/8|1/8", "7/8 - 1/2|3/8", "5/8 - 1/2|1/8", "1/2 - 1/6|1/3|2/6", "5/6 - 1/2|1/3|2/6", "1/3 - 1/6|1/6", "2/3 - 1/6|1/2|3/6", "5/6 - 1/3|1/2|3/6", "1/3 - 2/9|1/9", "4/9 - 1/3|1/9", "5/9 - 1/3|2/9", "7/9 - 1/3|4/9", "1/4 - 1/8|1/8", "3/4 - 1/8|5/8", "3/4 - 3/8|3/8", "3/4 - 5/8|1/8", "7/8 - 1/4|5/8", "5/8 - 1/4|3/8", "2/5 - 1/10|3/10", "7/10 - 2/5|3/10", "1/2 - 1/3|1/6", "1/2 - 1/5|3/10", "1/2 - 1/7|5/14", "1/2 - 1/9|7/18", "1/3 - 1/4|1/12", "2/3 - 1/4|5/12", "3/4 - 1/3|5/12", "3/4 - 2/3|1/12", "1/3 - 1/5|2/15", "2/3 - 1/5|7/15", "2/3 - 2/5|4/15", "4/5 - 1/3|7/15", "4/5 - 2/3|2/15", "1/4 - 1/5|1/20", "3/4 - 1/5|11/20", "3/4 - 2/5|7/20", "3/4 - 3/5|3/20", "2/5 - 1/4|3/20", "4/5 - 1/4|11/20", "4/5 - 3/4|1/20", "1/5 - 1/6|1/30", "5/6 - 1/5|19/30", "5/6 - 1/2|1/3|2/6", "7/10 - 1/2|1/5|2/10", "9/10 - 1/2|2/5|4/10", "5/12 - 1/4|1/6|2/12", "7/12 - 1/4|1/3|4/12", "11/12 - 1/4|2/3|8/12", "1 - 1/2|1/2", "1 - 1/3|2/3", "1 - 1/4|3/4", "1 - 1/5|4/5", "1 - 1/6|5/6", "1 - 2/3|1/3", "1 - 3/4|1/4", "1 - 2/5|3/5", "1 - 5/6|1/6", "1 - 1/8|7/8"],
  "6年_分数かけわり": ["2/7 × 3|6/7", "3/8 × 2|3/4|6/8", "4/9 × 3|4/3|12/9", "5/6 × 2|5/3|10/6", "3/10 × 5|3/2|15/10", "7/12 × 4|7/3|28/12", "2/5 × 3|6/5", "3/4 × 2|3/2|6/4", "1/6 × 3|1/2|3/6", "5/8 × 4|5/2|20/8", "2/9 × 6|4/3|12/9", "3/5 × 5|3", "4/7 × 7|4", "5/9 × 9|5", "3/8 × 8|3", "1/2 × 10|5", "3/4 × 12|9", "2/3 × 9|6", "5/6 × 12|10", "7/10 × 20|14", "4/5 ÷ 2|2/5|4/10", "6/7 ÷ 3|2/7|6/21", "8/9 ÷ 4|2/9|8/36", "9/10 ÷ 3|3/10|9/30", "10/11 ÷ 5|2/11|10/55", "2/3 ÷ 2|1/3|2/6", "3/4 ÷ 3|1/4|3/12", "5/6 ÷ 5|1/6|5/30", "7/8 ÷ 7|1/8|7/56", "1/2 ÷ 2|1/4", "1/3 ÷ 3|1/9", "2/5 ÷ 3|2/15", "3/7 ÷ 2|3/14", "4/9 ÷ 5|4/45", "3/4 ÷ 2|3/8", "5/6 ÷ 2|5/12", "2/3 ÷ 5|2/15", "4/5 ÷ 3|4/15", "7/10 ÷ 2|7/20", "3/8 ÷ 4|3/32", "1/2 × 1/3|1/6", "1/3 × 1/4|1/12", "2/3 × 2/5|4/15", "3/4 × 3/5|9/20", "2/5 × 2/3|4/15", "3/7 × 2/5|6/35", "1/4 × 3/5|3/20", "2/9 × 4/5|8/45", "5/8 × 1/2|5/16", "3/10 × 3/4|9/40", "2/3 × 3/4|1/2|6/12", "3/5 × 5/6|1/2|15/30", "4/7 × 7/8|1/2|28/56", "2/5 × 5/6|1/3|10/30", "3/8 × 4/9|1/6|12/72", "5/12 × 4/5|1/3|20/60", "8/15 × 3/4|2/5|24/60", "9/14 × 7/3|3/2|63/42", "2/3 × 9/10|3/5|18/30", "4/9 × 3/8|1/6|12/72", "5/6 × 3/10|1/4|15/60", "7/12 × 6/7|1/2|42/84", "3/4 × 8/9|2/3|24/36", "5/8 × 4/15|1/6|20/120", "1/2 × 2/3|1/3|2/6", "3/5 × 1/3|1/5|3/15", "1/3 ÷ 1/2|2/3", "2/5 ÷ 1/3|6/5", "3/4 ÷ 2/5|15/8", "1/2 ÷ 1/5|5/2", "2/3 ÷ 3/4|8/9", "3/7 ÷ 2/5|15/14", "4/9 ÷ 1/2|8/9", "5/8 ÷ 2/3|15/16", "1/4 ÷ 1/3|3/4", "2/7 ÷ 3/5|10/21", "2/5 ÷ 4/5|1/2|10/20", "3/7 ÷ 6/7|1/2|21/42", "5/8 ÷ 5/4|1/2|20/40", "3/4 ÷ 9/10|5/6|30/36", "2/3 ÷ 4/9|3/2|18/12", "5/6 ÷ 10/3|1/4|15/60", "8/15 ÷ 4/5|2/3|40/60", "9/10 ÷ 3/5|3/2|45/30", "7/12 ÷ 7/6|1/2|42/84", "4/5 ÷ 8/15|3/2|60/40", "3/8 ÷ 9/16|2/3|48/72", "5/12 ÷ 5/6|1/2|30/60", "2/9 ÷ 2/3|1/3|6/18", "3/10 ÷ 6/5|1/4|15/60", "1/2 ÷ 1/2|1", "2/3 ÷ 2/3|1", "3/4 × 4/3|1", "5/7 × 7/5|1", "2/3 ÷ 1/3|2", "3/4 ÷ 1/4|3", "4/5 ÷ 2/5|2", "6/7 ÷ 2/7|3", "8/9 ÷ 2/9|4", "9/10 ÷ 3/10|3", "1/2 × 1/3 × 1/4|1/24", "2/3 × 3/4 × 4/5|2/5|24/60", "1/2 × 4/5 × 5/6|1/3|20/60", "3/4 ÷ 1/2 × 2/3|1", "5/6 × 3/5 ÷ 1/2|1", "2/3 ÷ 2/3 × 5/6|5/6", "4/9 × 3/2 ÷ 2/3|1", "1/2 ÷ 1/4 ÷ 2|1", "3/8 ÷ 3/4 × 2|1", "5/12 × 2 ÷ 5/6|1"],
  "6年_文字と式": ["x + 4 = 10|6", "x + 7 = 15|8", "x + 12 = 20|8", "x + 9 = 21|12", "x + 15 = 30|15", "x + 8 = 17|9", "x + 25 = 50|25", "x + 36 = 100|64", "2 + x = 11|9", "14 + x = 28|14", "x + 0.5 = 1.5|1", "x + 1.2 = 3|1.8", "x + 2.5 = 4.5|2", "x + 0.8 = 1|0.2", "x + 1/3 = 1|2/3", "x + 2/5 = 4/5|2/5", "x - 5 = 5|10", "x - 8 = 4|12", "x - 10 = 20|30", "x - 7 = 13|20", "x - 15 = 15|30", "x - 3 = 18|21", "x - 24 = 26|50", "x - 50 = 50|100", "x - 0.4 = 0.6|1", "x - 1.5 = 2.5|4", "x - 0.9 = 0.1|1", "x - 3.2 = 1.8|5", "x - 1/2 = 1/2|1", "x - 3/4 = 1/4|1", "x - 1/5 = 3/5|4/5", "x - 2/3 = 1/3|1", "10 - x = 3|7", "15 - x = 10|5", "20 - x = 8|12", "12 - x = 6|6", "30 - x = 25|5", "18 - x = 9|9", "50 - x = 40|10", "100 - x = 1|99", "1 - x = 0.2|0.8", "2.5 - x = 1.5|1", "5 - x = 2.5|2.5", "3.4 - x = 1.4|2", "1 - x = 2/3|1/3", "4/5 - x = 1/5|3/5", "x × 3 = 12|4", "x × 5 = 20|4", "x × 4 = 24|6", "x × 6 = 18|3", "x × 8 = 32|4", "x × 9 = 54|6", "x × 2 = 18|9", "x × 7 = 49|7", "x × 10 = 100|10", "x × 12 = 36|3", "2 × x = 14|7", "5 × x = 45|9", "x × 4 = 10|2.5", "x × 2 = 5|2.5", "x × 5 = 8|1.6", "x × 0.5 = 2|4", "x × 1.2 = 2.4|2", "x × 1/2 = 3|6", "x ÷ 2 = 4|8", "x ÷ 3 = 5|15", "x ÷ 4 = 6|24", "x ÷ 5 = 10|50", "x ÷ 6 = 3|18", "x ÷ 8 = 2|16", "x ÷ 7 = 7|49", "x ÷ 9 = 4|36", "x ÷ 10 = 5|50", "x ÷ 1.5 = 2|3", "x ÷ 0.5 = 4|2", "x ÷ 3 = 0.5|1.5", "x ÷ 1/2 = 4|2", "x ÷ 2/3 = 6|4", "10 ÷ x = 2|5", "12 ÷ x = 3|4", "15 ÷ x = 5|3", "20 ÷ x = 4|5", "18 ÷ x = 6|3", "24 ÷ x = 8|3", "36 ÷ x = 9|4", "50 ÷ x = 10|5", "6 ÷ x = 1.5|4", "5 ÷ x = 2.5|2", "1 ÷ x = 0.5|2", "3 ÷ x = 0.5|6", "2 ÷ x = 1/2|4", "4 ÷ x = 2/3|6", "x + 1.5 = 3.5|2", "x - 2.8 = 1.2|4", "x × 2.5 = 10|4", "x ÷ 0.2 = 5|1", "1.2 ÷ x = 0.6|2", "x + 3/4 = 5/4|1/2|2/4", "x - 1/3 = 1/3|2/3", "x × 1/4 = 1/2|2", "x ÷ 1/3 = 9|3", "2/3 ÷ x = 2|1/3"],
  "6年_速さ・時間・道のり": ["時速40kmで2時間 → ?km|80", "時速50kmで3時間 → ?km|150", "時速60kmで4時間 → ?km|240", "時速30kmで5時間 → ?km|150", "時速80kmで2時間 → ?km|160", "時速100kmで3時間 → ?km|300", "時速45kmで2時間 → ?km|90", "時速70kmで4時間 → ?km|280", "時速25kmで4時間 → ?km|100", "時速120kmで2時間 → ?km|240", "分速60mで10分 → ?m|600", "分速80mで5分 → ?m|400", "分速50mで20分 → ?m|1000", "分速70mで30分 → ?m|2100", "分速100mで15分 → ?m|1500", "分速200mで5分 → ?m|1000", "分速300mで3分 → ?m|900", "分速40mで40分 → ?m|1600", "秒速2mで10秒 → ?m|20", "秒速5mで20秒 → ?m|100", "秒速10mで30秒 → ?m|300", "秒速15mで4秒 → ?m|60", "秒速20mで5秒 → ?m|100", "秒速4mで60秒 → ?m|240", "時速60kmで1.5時間 → ?km|90", "時速40kmで2.5時間 → ?km|100", "時速80kmで0.5時間 → ?km|40", "時速100kmで1.2時間 → ?km|120", "時速50kmで30分 → ?km|25", "時速60kmで20分 → ?km|20", "時速90kmで40分 → ?km|60", "時速12kmで15分 → ?km|3", "分速60mで1時間 → ?m|3600", "分速80mで2時間 → ?m|9600", "秒速5mで1分間 → ?m|300", "秒速10mで2分間 → ?m|1200", "秒速2mで1時間 → ?m|7200", "120kmを2時間で → 時速?km|60", "150kmを3時間で → 時速?km|50", "200kmを4時間で → 時速?km|50", "240kmを3時間で → 時速?km|80", "300kmを5時間で → 時速?km|60", "100kmを2時間で → 時速?km|50", "180kmを2時間で → 時速?km|90", "160kmを4時間で → 時速?km|40", "90kmを3時間で → 時速?km|30", "500kmを2時間で → 時速?km|250", "300mを5分で → 分速?m|60", "600mを10分で → 分速?m|60", "1000mを20分で → 分速?m|50", "400mを5分で → 分速?m|80", "1200mを15分で → 分速?m|80", "1500mを30分で → 分速?m|50", "240mを3分で → 分速?m|80", "800mを4分で → 分速?m|200", "100mを10秒で → 秒速?m|10", "50mを5秒で → 秒速?m|10", "200mを20秒で → 秒速?m|10", "60mを12秒で → 秒速?m|5", "400mを50秒で → 秒速?m|8", "30mを2秒で → 秒速?m|15", "6kmを30分で → 時速?km|12", "10kmを15分で → 時速?km|40", "3kmを20分で → 時速?km|9", "1200mを2分で → 秒速?m|10", "3600mを1時間で → 秒速?m|1", "120kmを時速60kmで → ?時間|2", "150kmを時速50kmで → ?時間|3", "200kmを時速40kmで → ?時間|5", "240kmを時速80kmで → ?時間|3", "180kmを時速60kmで → ?時間|3", "300kmを時速100kmで → ?時間|3", "80kmを時速20kmで → ?時間|4", "90kmを時速45kmで → ?時間|2", "400kmを時速50kmで → ?時間|8", "500kmを時速250kmで → ?時間|2", "600mを分速60mで → ?分|10", "1000mを分速50mで → ?分|20", "800mを分速80mで → ?分|10", "1500mを分速75mで → ?分|20", "300mを分速100mで → ?分|3", "2000mを分速200mで → ?分|10", "100mを秒速10mで → ?秒|10", "60mを秒速2mで → ?秒|30", "200mを秒速5mで → ?秒|40", "50mを秒速25mで → ?秒|2", "90kmを時速60kmで → ?時間|1.5", "30kmを時速60kmで → ?時間|0.5", "10kmを時速40kmで → ?時間|0.25", "200kmを時速80kmで → ?時間|2.5", "3kmを分速50mで → ?分|60", "1.2kmを分速60mで → ?分|20", "36kmを秒速10mで → ?秒|3600", "時速36kmは秒速何m|10", "時速72kmは秒速何m|20", "時速54kmは秒速何m|15", "秒速10mは時速何km|36", "秒速20mは時速何km|72", "分速60mは時速何km|3.6", "時速6kmは分速何m|100"],
  "チャレンジ_四則混合": ["2+3×4|14", "(2+3)×4|20", "10-4÷2|8", "15÷(3+2)|3", "2×3+4×5|26", "20-(4+6)|10"]
};

const generateDynamicProblems = () => {
  const problems = {};
  const gcd = (x, y) => y === 0 ? x : gcd(y, x % y);

  const awasete10 = [];
  for (let i = 1; i <= 9; i++) {
    awasete10.push(`${i}+?=10|${10 - i}`);
    awasete10.push(`?+${i}=10|${10 - i}`);
  }
  problems["1年_あわせて10"] = awasete10;

  const kuriagari1 = [];
  for (let a = 2; a <= 9; a++) {
    for (let b = 2; b <= 9; b++) {
      if (a + b >= 11 && a + b <= 18) kuriagari1.push(`${a}+${b}|${a + b}`);
    }
  }
  problems["1年_くりあがり"] = kuriagari1;

  const hikizan1 = [];
  for (let a = 11; a <= 18; a++) {
    for (let b = 2; b <= 9; b++) {
      if (a - b >= 2 && a - b <= 9) hikizan1.push(`${a}-${b}|${a - b}`);
    }
  }
  problems["1年_ひきざん（くりさがり）"] = hikizan1;

  const kuku2 = [];
  const danNames = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  for (let a = 1; a <= 9; a++) {
    const dan = [];
    for (let b = 1; b <= 9; b++) {
      dan.push(`${a}×${b}|${a * b}`);
      kuku2.push(`${a}×${b}|${a * b}`);
    }
    problems[`2年_${danNames[a - 1]}の段の九九`] = dan;
  }
  problems["2年_九九"] = kuku2;

  const kukuAna2 = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      kukuAna2.push(`${a}×?=${a * b}|${b}`);
      kukuAna2.push(`?×${b}=${a * b}|${a}`);
    }
  }
  problems["2年_九九あなうめ"] = kukuAna2;

  const nanju2 = [];
  for (let a = 10; a <= 90; a += 10) {
    for (let b = 10; b <= 90; b += 10) nanju2.push(`${a}+${b}|${a + b}`);
  }
  for (let a = 100; a <= 180; a += 10) {
    for (let b = 10; b <= 90; b += 10) {
      if (a - b >= 10 && a - b <= 90) nanju2.push(`${a}-${b}|${a - b}`);
    }
  }
  problems["2年_なん十の計算"] = nanju2;

  const wari3 = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) wari3.push(`${a * b}÷${a}|${b}`);
  }
  problems["3年_わり算"] = wari3;

  const amari3 = [];
  for (let a = 2; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      const base = a * b;
      for (let r = 1; r < a; r++) amari3.push(`${base + r}÷${a}のあまり|${r}`);
    }
  }
  problems["3年_あまりは？"] = amari3;

  const nanjuKake3 = [];
  for (let a = 10; a <= 90; a += 10) {
    for (let b = 1; b <= 9; b++) nanjuKake3.push(`${a}×${b}|${a * b}`);
  }
  problems["3年_何十のかけ算"] = nanjuKake3;

  const shosuTashi3 = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      let sum = (a + b) / 10;
      let sumStr = Number.isInteger(sum) ? String(sum) : sum.toFixed(1);
      shosuTashi3.push(`0.${a}+0.${b}|${sumStr}`);
    }
  }
  problems["3年_小数たし算"] = shosuTashi3;

  const shosuHiki3 = [];
  for (let a = 2; a <= 9; a++) {
    for (let b = 1; b < a; b++) shosuHiki3.push(`0.${a}-0.${b}|${((a - b) / 10).toFixed(1)}`);
  }
  for (let a = 10; a <= 18; a++) {
    for (let b = 1; b <= 9; b++) {
      if (a - b >= 1 && a - b <= 9) {
        let aStr = (a / 10).toFixed(1);
        if (aStr.endsWith('.0')) aStr = String(a / 10);
        shosuHiki3.push(`${aStr}-0.${b}|${((a - b) / 10).toFixed(1)}`);
      }
    }
  }
  problems["3年_小数ひき算"] = shosuHiki3;

  const bunsuTashi3 = [];
  for (let d = 3; d <= 9; d++) {
    for (let a = 1; a < d; a++) {
      for (let b = 1; b < d; b++) {
        if (a + b <= d) {
          let ans = (a + b) === d ? "1" : `${a + b}/${d}`;
          let g = gcd(a + b, d);
          if ((a + b) !== d && g > 1) ans += `|${(a + b) / g}/${d / g}`;
          bunsuTashi3.push(`${a}/${d}+${b}/${d}|${ans}`);
        }
      }
    }
  }
  problems["3年_分数たし算"] = bunsuTashi3;

  const bunsuHiki3 = [];
  for (let d = 3; d <= 9; d++) {
    for (let a = 2; a <= d; a++) {
      for (let b = 1; b < a; b++) {
        let aStr = a === d ? "1" : `${a}/${d}`;
        let ans = `${a - b}/${d}`;
        let g = gcd(a - b, d);
        if (g > 1) ans += `|${(a - b) / g}/${d / g}`;
        bunsuHiki3.push(`${aStr}-${b}/${d}|${ans}`);
      }
    }
  }
  problems["3年_分数ひき算"] = bunsuHiki3;

  const ikutsu = [];
  for (let sum = 2; sum <= 10; sum++) {
    for (let i = 1; i < sum; i++) {
      ikutsu.push(`${sum}は ${i}と いくつ？|${sum - i}`);
    }
  }
  for (let a = 1; a <= 9; a++) {
    for (let b = 0; b <= 9; b++) {
      ikutsu.push(`10が ${a}こと 1が ${b}こ。あわせて いくつ？|${a * 10 + b}`);
    }
  }
  problems["1年_ことば（いくつといくつ）"] = ikutsu;

  const junjo = [];
  for (let i = 1; i <= 6; i++) {
    for (let j = 1; j <= 6; j++) {
      junjo.push(`まえから ${i}ばんめ。うしろに ${j}にん。ぜんぶで なんにん？|${i + j}`);
      junjo.push(`ひだりから ${i}ばんめ。みぎから ${j}ばんめ。ぜんぶで なんにん？|${i + j - 1}`);
    }
  }
  for (let total = 2; total <= 16; total++) {
    for (let i = 1; i < total; i++) {
      if (junjo.length >= 100) break;
      junjo.push(`${total}にん ならんでいます。まえから ${i}ばんめの ひとの うしろには なんにん？|${total - i}`);
    }
  }
  problems["1年_ことば（じゅんじょ）"] = junjo.slice(0, 100);

  const tokei = [];
  for (let h = 1; h <= 12; h++) {
    tokei.push(`みじかい はりが ${h}。ながい はりが 12。なんじ？|${h}`);
    tokei.push(`みじかい はりが ${h}と ${h % 12 + 1}の あいだ。ながい はりが 6。なんじ はん？|${h}`);
    tokei.push(`いま ${h}じ です。1じかん ごは なんじ？|${h % 12 + 1}`);
    tokei.push(`いま ${h}じ です。2じかん ごは なんじ？|${(h + 1) % 12 + 1}`);
  }
  for (let m = 1; m <= 11; m++) {
    tokei.push(`ながい はりが ${m}の とき。なんぷん？|${m * 5}`);
    tokei.push(`ながい はりが 12から ${m}まで うごきました。なんぷん たった？|${m * 5}`);
    tokei.push(`ながい はりが ${m}の ところから、1つ すすみました。なんぷん たった？|5`);
    tokei.push(`ながい はりが ${m}の ところから、2つ すすみました。なんぷん たった？|10`);
  }
  for (let h = 1; h <= 8; h++) {
    tokei.push(`いま ${h}じ です。3じかん ごは なんじ？|${h + 3}`);
  }
  problems["1年_とけいクイズ"] = tokei.slice(0, 100);

  const chigai = [];
  for (let a = 1; a <= 8; a++) {
    for (let b = 1; b <= 8; b++) {
      if (a !== b) chigai.push(`あか が ${a}こ、しろ が ${b}こ。ちがいは いくつ？|${Math.abs(a - b)}`);
    }
  }
  for (let a = 1; a <= 6; a++) {
    for (let b = a + 1; b <= 10; b++) {
      chigai.push(`${a}こ もっています。あと なんこで ${b}こに なる？|${b - a}`);
    }
  }
  for (let a = 5; a <= 10; a++) {
    for (let b = 1; b < a; b++) {
      chigai.push(`あめを ${a}こ もっています。${b}こ たべると のこりは？|${a - b}`);
    }
  }
  for (let a = 11; a <= 15; a++) {
    chigai.push(`あめを ${a}こ もっています。2こ たべると のこりは？|${a - 2}`);
  }
  problems["1年_ことば（ちがい）"] = chigai.slice(0, 100);

  const mittsu = [];
  for (let a = 1; a <= 4; a++) {
    for (let b = 1; b <= 4; b++) {
      for (let c = 1; c <= 4; c++) {
        mittsu.push(`${a}にん いて、${b}にん きて、${c}にん きました。ぜんぶで なんにん？|${a + b + c}`);
        mittsu.push(`${a + b}こ あって、${a}こ たべて、${c}こ もらいました。いま なんこ？|${b + c}`);
      }
    }
  }
  problems["1年_ことば（3つのかず）"] = mittsu.slice(0, 100);

  const awasete = [];
  const items_add = [
    { a: "あかい くるま", b: "あおい くるま", unit: "だい", word: "あわせて なんだい？" },
    { a: "おとこのこ", b: "おんなのこ", unit: "にん", word: "ぜんぶで なんにん？" },
    { a: "いぬ", b: "ねこ", unit: "ひき", word: "あわせて なんびき？" },
    { a: "りんご", b: "みかん", unit: "こ", word: "あわせて なんこ？" },
    { a: "あかい はな", b: "しろい はな", unit: "ほん", word: "ぜんぶで なんぼん？" }
  ];
  const items_sub = [
    { name: "クッキー", unit: "こ", action: "たべました。", word: "のこりは なんこ？" },
    { name: "えんぴつ", unit: "ほん", action: "ともだちに あげました。", word: "のこりは なんぼん？" },
    { name: "あめ", unit: "こ", action: "たべました。", word: "のこりは なんこ？" },
    { name: "くるま", unit: "だい", action: "いなくなりました。", word: "のこりは なんだい？" },
    { name: "とり", unit: "わ", action: "とんでいきました。", word: "のこりは なんわ？" }
  ];

  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      const itemAdd = items_add[(a + b) % items_add.length];
      awasete.push(`${itemAdd.a}が ${a}${itemAdd.unit}、${itemAdd.b}が ${b}${itemAdd.unit}。${itemAdd.word}|${a + b}`);
    }
  }
  for (let a = 2; a <= 18; a++) {
    for (let b = 1; b < a; b++) {
      const itemSub = items_sub[(a + b) % items_sub.length];
      awasete.push(`${itemSub.name}が ${a}${itemSub.unit} あります。${b}${itemSub.unit} ${itemSub.action} ${itemSub.word}|${a - b}`);
    }
  }
  problems["1年_ことば（あわせて・のこりは）"] = awasete.sort(() => Math.random() - 0.5).slice(0, 100);

  const tashizan10 = [];
  for (let a = 0; a <= 10; a++) {
    for (let b = 0; b <= 10 - a; b++) {
      tashizan10.push(`${a}+${b}|${a + b}`);
    }
  }
  problems["1年_たしざん（10まで）"] = tashizan10;

  const hikizan10 = [];
  for (let a = 0; a <= 10; a++) {
    for (let b = 0; b <= a; b++) {
      hikizan10.push(`${a}-${b}|${a - b}`);
    }
  }
  problems["1年_ひきざん（10まで）"] = hikizan10;

  const mittsu_calc = [];
  for (let a = 1; a <= 8; a++) {
    for (let b = 1; b <= 9 - a; b++) {
      for (let c = 1; c <= 10 - a - b; c++) {
        mittsu_calc.push(`${a}+${b}+${c}|${a + b + c}`);
      }
    }
  }
  for (let a = 3; a <= 10; a++) {
    for (let b = 1; b <= a - 2; b++) {
      for (let c = 1; c <= a - b - 1; c++) {
        mittsu_calc.push(`${a}-${b}-${c}|${a - b - c}`);
      }
    }
  }
  for (let a = 1; a <= 8; a++) {
    for (let b = 1; b <= 9 - a; b++) {
      for (let c = 1; c <= a + b - 1; c++) {
        mittsu_calc.push(`${a}+${b}-${c}|${a + b - c}`);
      }
    }
  }
  for (let a = 2; a <= 10; a++) {
    for (let b = 1; b <= a - 1; b++) {
      for (let c = 1; c <= 10 - (a - b); c++) {
        mittsu_calc.push(`${a}-${b}+${c}|${a - b + c}`);
      }
    }
  }
  problems["1年_3つのかず"] = mittsu_calc;

  const tenAnd = [];
  for (let a = 1; a <= 9; a++) {
    tenAnd.push(`10+${a}|${10 + a}`);
    tenAnd.push(`${a}+10|${a + 10}`);
  }
  problems["1年_10といくつ"] = tenAnd;

  const bigCalc = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9 - a; b++) {
      bigCalc.push(`${10 + a}+${b}|${10 + a + b}`);
      bigCalc.push(`${b}+${10 + a}|${10 + a + b}`);
    }
  }
  for (let a = 2; a <= 9; a++) {
    for (let b = 1; b <= a - 1; b++) {
      bigCalc.push(`${10 + a}-${b}|${10 + a - b}`);
    }
  }
  problems["1年_おおきいかずのけいさん"] = bigCalc;

  const nanju100 = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 10 - a; b++) {
      nanju100.push(`${a * 10}+${b * 10}|${(a + b) * 10}`);
    }
  }
  for (let a = 2; a <= 10; a++) {
    for (let b = 1; b <= a - 1; b++) {
      nanju100.push(`${a * 10}-${b * 10}|${(a - b) * 10}`);
    }
  }
  problems["1年_なん十のけいさん（100まで）"] = nanju100;

  const narabi = [];
  for (let a = 1; a <= 97; a++) {
    narabi.push(`${a}、${a + 1}、${a + 2}、つぎは？|${a + 3}`);
  }
  for (let a = 4; a <= 100; a++) {
    narabi.push(`${a}、${a - 1}、${a - 2}、つぎは？|${a - 3}`);
  }
  for (let a = 10; a <= 70; a += 10) {
    narabi.push(`${a}、${a + 10}、${a + 20}、つぎは？|${a + 30}`);
  }
  for (let a = 100; a >= 40; a -= 10) {
    narabi.push(`${a}、${a - 10}、${a - 20}、つぎは？|${a - 30}`);
  }
  for (let a = 2; a <= 14; a += 2) {
    narabi.push(`${a}、${a + 2}、${a + 4}、${a + 6}、つぎは？|${a + 8}`);
  }
  for (let a = 5; a <= 35; a += 5) {
    narabi.push(`${a}、${a + 5}、${a + 10}、つぎは？|${a + 15}`);
  }
  problems["1年_ことば（かずのならび）"] = narabi.sort(() => Math.random() - 0.5).slice(0, 100);

  const okiichisai = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 100);
    let b = Math.floor(Math.random() * 100);
    if (a === b) b = (b + 1) % 100;
    okiichisai.push(`${a}と ${b}、おおきい ほうは？|${Math.max(a, b)}`);
    okiichisai.push(`${a}と ${b}、ちいさい ほうは？|${Math.min(a, b)}`);
  }
  problems["1年_ことば（おおきい・ちいさい）"] = okiichisai;

  const katachi = [
    "しかくを 1つ つくるのに、かぞえぼうは なんぼん いる？|4",
    "さんかくを 1つ つくるのに、かぞえぼうは なんぼん いる？|3",
    "しかくを 2つ つなげて つくります。かぞえぼうは なんぼん いる？|7",
    "さんかくを 2つ つなげて つくります。かぞえぼうは なんぼん いる？|5",
    "しかくを ばらばらに 2つ つくります。かぞえぼうは なんぼん いる？|8",
    "さんかくを ばらばらに 2つ つくります。かぞえぼうは なんぼん いる？|6",
    "しかくを 3つ つなげて つくります。かぞえぼうは なんぼん いる？|10",
    "さんかくを 3つ つなげて つくります。かぞえぼうは なんぼん いる？|7"
  ];
  problems["1年_ことば（かたちづくり）"] = katachi;

  const tashizan2keta = [];
  for (let i = 0; i < 100; i++) {
    // 「2けた＋2けた」のドリルなので、くり上がりで99をこえるときは a のほうを小さくする
    let a = Math.floor(Math.random() * 80) + 10;
    let b = Math.floor(Math.random() * 80) + 10;
    if (a + b > 99) a = 99 - b;
    tashizan2keta.push(`${a}+${b}|${a + b}`);
  }
  problems["2年_2けたのたし算"] = tashizan2keta;

  const hikizan2keta = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 90) + 10;
    let b = Math.floor(Math.random() * 89) + 10;
    if (a <= b) { let tmp = a; a = b; b = tmp; }
    if (a === b) { a += 1; }
    hikizan2keta.push(`${a}-${b}|${a - b}`);
  }
  problems["2年_2けたのひき算"] = hikizan2keta;

  const bigCalc2 = [];
  for (let i = 0; i < 100; i++) {
    const type = Math.floor(Math.random() * 4);
    if (type === 0) {
      let a = Math.floor(Math.random() * 9) + 1;
      let b = Math.floor(Math.random() * (10 - a)) + 1;
      bigCalc2.push(`${a * 100}+${b * 100}|${(a + b) * 100}`);
    } else if (type === 1) {
      let a = Math.floor(Math.random() * 9) + 2;
      let b = Math.floor(Math.random() * (a - 1)) + 1;
      bigCalc2.push(`${a * 100}-${b * 100}|${(a - b) * 100}`);
    } else if (type === 2) {
      let a = Math.floor(Math.random() * 9) + 1;
      let b = Math.floor(Math.random() * (10 - a)) + 1;
      bigCalc2.push(`${a * 1000}+${b * 1000}|${(a + b) * 1000}`);
    } else {
      let a = Math.floor(Math.random() * 9) + 2;
      let b = Math.floor(Math.random() * (a - 1)) + 1;
      bigCalc2.push(`${a * 1000}-${b * 1000}|${(a - b) * 1000}`);
    }
  }
  problems["2年_3けた・4けたの計算"] = bigCalc2;

  const tani2 = [
    "1cmは なんmm？|10", "10mmは なんcm？|1", "1mは なんcm？|100", "100cmは なんm？|1",
    "1Lは なんdL？|10", "10dLは なんL？|1", "1Lは なんmL？|1000", "1000mLは なんL？|1",
    "1dLは なんmL？|100", "100mLは なんdL？|1", "1じかんは なんぷん？|60", "60ぷんは なんじかん？|1",
    "1にちは なんじかん？|24", "24じかんは なんにち？|1", "ごぜんは なんじかん？|12", "ごごは なんじかん？|12"
  ];
  problems["2年_ことば（たんい）"] = tani2;

  const okiichisai2 = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 9900) + 100;
    let b = Math.floor(Math.random() * 9900) + 100;
    if (a === b) b = (b + 1) % 10000;
    if (i % 2 === 0) {
      okiichisai2.push(`${a}と ${b}、おおきい ほうは？|${Math.max(a, b)}`);
    } else {
      okiichisai2.push(`${a}と ${b}、ちいさい ほうは？|${Math.min(a, b)}`);
    }
  }
  problems["2年_ことば（おおきい・ちいさい）"] = okiichisai2;

  const bunsu2 = [
    "おなじ おおきさに 2つに 分けた 1つ分は？|1/2",
    "おなじ おおきさに 3つに 分けた 1つ分は？|1/3",
    "おなじ おおきさに 4つに 分けた 1つ分は？|1/4",
    "おなじ おおきさに 8つに 分けた 1つ分は？|1/8"
  ];
  problems["2年_分数"] = bunsu2;

  const katachi2 = [
    "さんかくけいの ちょうてんは いくつ？|3", "さんかくけいの へんは いくつ？|3",
    "しかくけいの ちょうてんは いくつ？|4", "しかくけいの へんは いくつ？|4",
    "はこの かたちの めんは いくつ？|6", "はこの かたちの ちょうてんは いくつ？|8",
    "はこの かたちの へんは いくつ？|12", "さいころの かたちの めんは いくつ？|6"
  ];
  problems["2年_ことば（かたち）"] = katachi2;

  const kakezanWord = [];
  const kake_items = [
    { container: "はこ", item: "こ", in: "はいっています", q_item: "なんこ" },
    { container: "ふくろ", item: "こ", in: "はいっています", q_item: "なんこ" },
    { container: "おさら", item: "こ", in: "のっています", q_item: "なんこ" },
    { container: "たば", item: "ほん", in: "あります", q_item: "なんぼん" }
  ];
  const kake_people = [
    { target: "にん", item: "こ", verb: "くばります", q_item: "なんこ" },
    { target: "にん", item: "まい", verb: "くばります", q_item: "なんまい" },
    { target: "にん", item: "ほん", verb: "くばります", q_item: "なんぼん" },
    { target: "にん", item: "ひき", verb: "つかまえました", q_item: "なんびき" }
  ];

  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      if ((a + b) % 2 === 0) {
        let t = kake_items[(a * b) % kake_items.length];
        kakezanWord.push(`1${t.container}に ${a}${t.item} ${t.in}。${b}${t.container}では ぜんぶで ${t.q_item}？|${a * b}`);
      } else {
        let p = kake_people[(a * b) % kake_people.length];
        kakezanWord.push(`1${p.target}に ${a}${p.item}ずつ ${p.verb}。${b}${p.target}では ぜんぶで ${p.q_item}？|${a * b}`);
      }
    }
  }
  problems["2年_ことば（かけ算）"] = kakezanWord.sort(() => Math.random() - 0.5);

  const nagasaCalc = [];
  for (let i = 0; i < 100; i++) {
    let type = Math.floor(Math.random() * 2);
    if (type === 0) {
      let a = Math.floor(Math.random() * 50) + 1;
      let b = Math.floor(Math.random() * 49) + 1;
      nagasaCalc.push(`${a}cmの テープと ${b}cmの テープを つなぐと なんcm？|${a + b}`);
    } else {
      let a = Math.floor(Math.random() * 50) + 20;
      let b = Math.floor(Math.random() * 19) + 1;
      nagasaCalc.push(`${a}cmの ひもから ${b}cm きりとると のこりは なんcm？|${a - b}`);
    }
  }
  problems["2年_ことば（ながさのけいさん）"] = nagasaCalc;

  const kasaCalc = [];
  for (let i = 0; i < 100; i++) {
    let type = Math.floor(Math.random() * 2);
    if (type === 0) {
      let a = Math.floor(Math.random() * 9) + 1;
      let b = Math.floor(Math.random() * 9) + 1;
      kasaCalc.push(`${a}Lの 水と ${b}Lの 水を あわせると なんL？|${a + b}`);
    } else {
      let a = Math.floor(Math.random() * 10) + 5;
      let b = Math.floor(Math.random() * 4) + 1;
      kasaCalc.push(`${a}dLの ジュースから ${b}dL のむと のこりは なんdL？|${a - b}`);
    }
  }
  problems["2年_ことば（かさのけいさん）"] = kasaCalc;

  const kakezan2x1 = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 90) + 10;
    let b = Math.floor(Math.random() * 9) + 1;
    kakezan2x1.push(`${a}×${b}|${a * b}`);
  }
  problems["3年_かけ算（2けた×1けた）"] = kakezan2x1;

  const kakezan3x1 = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 900) + 100;
    let b = Math.floor(Math.random() * 9) + 1;
    kakezan3x1.push(`${a}×${b}|${a * b}`);
  }
  problems["3年_かけ算（3けた×1けた）"] = kakezan3x1;

  const warizanBig = [];
  for (let i = 0; i < 100; i++) {
    let type = Math.floor(Math.random() * 2);
    if (type === 0) {
      let b = Math.floor(Math.random() * 8) + 2;
      let sho = Math.floor(Math.random() * 9) + 1;
      let a = b * sho;
      warizanBig.push(`${a * 10}÷${b}|${sho * 10}`);
    } else {
      let b = Math.floor(Math.random() * 8) + 2;
      let sho = Math.floor(Math.random() * 20) + 10;
      let a = b * sho;
      if (a < 100) {
        warizanBig.push(`${a}÷${b}|${sho}`);
      } else {
        i--;
      }
    }
  }
  problems["3年_大きいわり算"] = warizanBig;

  const anzanTashi = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 90) + 10;
    let b = Math.floor(Math.random() * 90) + 10;
    anzanTashi.push(`${a}+${b}|${a + b}`);
  }
  problems["3年_暗算（2けたのたし算）"] = anzanTashi;

  const anzanHiki = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 90) + 10;
    let b = Math.floor(Math.random() * 90) + 10;
    if (a < b) { let tmp = a; a = b; b = tmp; }
    if (a === b) { a += 1; }
    anzanHiki.push(`${a}-${b}|${a - b}`);
  }
  problems["3年_暗算（2けたのひき算）"] = anzanHiki;

  const bigCalc3 = [];
  for (let i = 0; i < 100; i++) {
    let type = Math.floor(Math.random() * 4);
    if (type === 0) {
      let a = Math.floor(Math.random() * 9) + 1;
      let b = Math.floor(Math.random() * 9) + 1;
      bigCalc3.push(`${a * 1000}+${b * 1000}|${(a + b) * 1000}`);
    } else if (type === 1) {
      let a = Math.floor(Math.random() * 9) + 2;
      let b = Math.floor(Math.random() * (a - 1)) + 1;
      bigCalc3.push(`${a * 1000}-${b * 1000}|${(a - b) * 1000}`);
    } else if (type === 2) {
      let a = Math.floor(Math.random() * 9) + 1;
      let b = Math.floor(Math.random() * 9) + 1;
      bigCalc3.push(`${a}万+${b}万は なん万？|${a + b}`);
    } else {
      let a = Math.floor(Math.random() * 9) + 2;
      let b = Math.floor(Math.random() * (a - 1)) + 1;
      bigCalc3.push(`${a}万-${b}万は なん万？|${a - b}`);
    }
  }
  problems["3年_大きい数の計算"] = bigCalc3;

  const jikan3 = [];
  for (let i = 1; i <= 3; i++) {
    jikan3.push(`${i}分は なん秒？|${i * 60}`);
  }
  for (let i = 1; i <= 2; i++) {
    for (let j = 10; j <= 50; j += 10) {
      jikan3.push(`${i}分${j}秒は なん秒？|${i * 60 + j}`);
    }
  }
  for (let i = 70; i <= 110; i += 10) {
    jikan3.push(`${i}秒は 1分なん秒？|${i - 60}`);
  }
  problems["3年_時間（秒と分）"] = jikan3;

  const warizanWord3 = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 9) + 1;
    let b = Math.floor(Math.random() * 8) + 2;
    let total = a * b;
    if (i % 2 === 0) {
      warizanWord3.push(`${total}この あめを ${b}にんで おなじ かずずつ わけると、1にんぶんは なんこ？|${a}`);
    } else {
      warizanWord3.push(`${total}まいの おりがみを 1にんに ${b}まいずつ くばると、なんにんに くばれる？|${a}`);
    }
  }
  problems["3年_ことば（わり算）"] = warizanWord3;

  const amariWord3 = [];
  for (let i = 0; i < 100; i++) {
    let b = Math.floor(Math.random() * 5) + 3;
    let sho = Math.floor(Math.random() * 7) + 2;
    let amari = Math.floor(Math.random() * (b - 1)) + 1;
    let total = b * sho + amari;
    if (i % 2 === 0) {
      amariWord3.push(`${total}こ の ケーキを 1つの はこに ${b}こ ずつ いれます。ぜんぶ いれるには、はこは いくつ いる？|${sho + 1}`);
    } else {
      amariWord3.push(`${total}にん で くるまに のります。1だいに ${b}にん のれます。ぜんいん のるには、くるまは なんだい いる？|${sho + 1}`);
    }
  }
  problems["3年_ことば（あまりのあるわり算）"] = amariWord3;

  const enToKyu3 = [];
  for (let i = 1; i <= 50; i++) {
    enToKyu3.push(`はんけいが ${i}cmの えんが あります。ちょっけいは なんcm？|${i * 2}`);
    enToKyu3.push(`ちょっけいが ${i * 2}cmの えんが あります。はんけいは なんcm？|${i}`);
  }
  problems["3年_ことば（円と球）"] = enToKyu3;

  const tani3 = [];
  for (let i = 1; i <= 9; i++) {
    tani3.push(`${i}kmは なんm？|${i * 1000}`);
    tani3.push(`${i * 1000}mは なんkm？|${i}`);
    tani3.push(`${i}kgは なんg？|${i * 1000}`);
    tani3.push(`${i * 1000}gは なんkg？|${i}`);
    tani3.push(`${i}tは なんkg？|${i * 1000}`);
    tani3.push(`${i * 1000}kgは なんt？|${i}`);
  }
  problems["3年_ことば（長さと重さのたんい）"] = tani3;

  const warizan4_1 = [];
  for (let i = 0; i < 100; i++) {
    let b = Math.floor(Math.random() * 8) + 2;
    let ans = Math.floor(Math.random() * 190) + 10;
    let a = b * ans;
    warizan4_1.push(`${a}÷${b}|${ans}`);
  }
  problems["4年_わり算（1けたでわる）"] = warizan4_1;

  const warizan4_2 = [];
  for (let i = 0; i < 100; i++) {
    let type = Math.floor(Math.random() * 2);
    if (type === 0) {
      let b0 = Math.floor(Math.random() * 9) + 1;
      let ans = Math.floor(Math.random() * 9) + 1;
      warizan4_2.push(`${b0 * ans * 10}÷${b0 * 10}|${ans}`);
    } else {
      let b = Math.floor(Math.random() * 89) + 11;
      let ans = Math.floor(Math.random() * 9) + 2;
      let a = b * ans;
      if (a < 1000) {
        warizan4_2.push(`${a}÷${b}|${ans}`);
      } else {
        i--;
      }
    }
  }
  problems["4年_わり算（2けたでわる）"] = warizan4_2;

  const shosuWari4 = [];
  for (let i = 0; i < 100; i++) {
    let b = Math.floor(Math.random() * 8) + 2;
    let ans = Math.floor(Math.random() * 99) + 1;
    if (ans % 10 === 0) ans += 1;
    let a = b * ans;
    if (Math.random() < 0.5) {
      shosuWari4.push(`${(a / 10).toFixed(1)}÷${b}|${(ans / 10).toFixed(1)}`);
    } else {
      shosuWari4.push(`${(a / 100).toFixed(2)}÷${b}|${(ans / 100).toFixed(2)}`);
    }
  }
  problems["4年_小数÷整数"] = shosuWari4;

  const bunsuTashi4 = [];
  for (let d = 3; d <= 9; d++) {
    for (let a = 1; a <= 9; a++) {
      for (let b = 1; b <= 9; b++) {
        if (a + b > d && a + b <= 18) {
          let ansStr = (a + b) % d === 0 ? String((a + b) / d) : `${a + b}/${d}`;
          bunsuTashi4.push(`${a}/${d}+${b}/${d}|${ansStr}`);
        }
      }
    }
  }
  problems["4年_分数たし算（1より大きい）"] = bunsuTashi4;

  const bunsuHiki4 = [];
  for (let d = 3; d <= 9; d++) {
    for (let a = d + 1; a <= 18; a++) {
      for (let b = 1; b < a; b++) {
        let ansStr = (a - b) % d === 0 ? String((a - b) / d) : `${a - b}/${d}`;
        bunsuHiki4.push(`${a}/${d}-${b}/${d}|${ansStr}`);
      }
    }
  }
  problems["4年_分数ひき算（1より大きい）"] = bunsuHiki4;

  const bigNum4 = [];
  for (let i = 0; i < 100; i++) {
    let type = Math.floor(Math.random() * 4);
    let a = Math.floor(Math.random() * 90) + 10;
    let b = Math.floor(Math.random() * 90) + 10;
    if (type === 0) {
      bigNum4.push(`${a}億+${b}億は なん億？|${a + b}`);
    } else if (type === 1) {
      if (a < b) { let tmp = a; a = b; b = tmp; }
      if (a === b) a += 1;
      bigNum4.push(`${a}億-${b}億は なん億？|${a - b}`);
    } else if (type === 2) {
      bigNum4.push(`${a}兆+${b}兆は なん兆？|${a + b}`);
    } else {
      if (a < b) { let tmp = a; a = b; b = tmp; }
      if (a === b) a += 1;
      bigNum4.push(`${a}兆-${b}兆は なん兆？|${a - b}`);
    }
  }
  problems["4年_大きな数（億・兆）"] = bigNum4;

  const kaku4 = [
    "直角は なんど？|90", "半かいてんは なんど？|180", "1かいてんは なんど？|360",
    "直角2つぶんは なんど？|180", "直角3つぶんは なんど？|270", "直角4つぶんは なんど？|360",
    "180どは 直角いくつぶん？|2", "270どは 直角いくつぶん？|3", "360どは 直角いくつぶん？|4",
    "直角の 半分の 大きさは なんど？|45"
  ];
  problems["4年_ことば（角の大きさ）"] = kaku4;

  const mensekiTani4 = [
    "1辺が1mの 正方形の 面積は なん㎡？|1", "1辺が10mの 正方形の 面積は なんa？|1",
    "1辺が100mの 正方形の 面積は なんha？|1", "1辺が1kmの 正方形の 面積は なん㎢？|1",
    "1㎡は なん㎠？|10000", "1aは なん㎡？|100", "1haは なんa？|100",
    "1haは なん㎡？|10000", "1㎢は なんha？|100"
  ];
  problems["4年_ことば（面積のたんい）"] = mensekiTani4;

  const mensekiCalc4 = [];
  for (let i = 0; i < 100; i++) {
    if (Math.random() < 0.3) {
      let a = Math.floor(Math.random() * 20) + 2;
      mensekiCalc4.push(`1辺が ${a}cmの 正方形の 面積は なん㎠？|${a * a}`);
    } else {
      let a = Math.floor(Math.random() * 20) + 2;
      let b = Math.floor(Math.random() * 20) + 2;
      if (a === b) b += 1;
      mensekiCalc4.push(`たてが ${a}cm、よこが ${b}cmの 長方形の 面積は なん㎠？|${a * b}`);
    }
  }
  problems["4年_ことば（面積のけいさん）"] = mensekiCalc4;

  const shosuShikumi4 = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 9) + 1;
    let b = Math.floor(Math.random() * 9) + 1;
    let c = Math.floor(Math.random() * 9) + 1;
    if (Math.random() < 0.5) {
      shosuShikumi4.push(`1を ${a}こ、0.1を ${b}こ あわせた 数は？|${a}.${b}`);
    } else {
      shosuShikumi4.push(`1を ${a}こ、0.1を ${b}こ、0.01を ${c}こ あわせた 数は？|${a}.${b}${c}`);
    }
  }
  problems["4年_ことば（小数のしくみ）"] = shosuShikumi4;

  const shosu10_100 = [];
  for (let i = 0; i < 100; i++) {
    let num = Math.floor(Math.random() * 999) + 1;
    let shift = Math.floor(Math.random() * 3);
    let baseVal = num / Math.pow(10, shift);
    let op = Math.floor(Math.random() * 4);

    let ansVal;
    if (op === 0) ansVal = baseVal * 10;
    else if (op === 1) ansVal = baseVal * 100;
    else if (op === 2) ansVal = baseVal / 10;
    else ansVal = baseVal / 100;

    let baseStr = parseFloat(baseVal.toPrecision(10)).toString();
    let ansStr = parseFloat(ansVal.toPrecision(10)).toString();

    let opStr = ['× 10', '× 100', '÷ 10', '÷ 100'][op];
    shosu10_100.push(`${baseStr} ${opStr}|${ansStr}`);
  }
  problems["5年_小数と10・100の計算"] = shosu10_100;

  const yakubun = [];
  for (let d = 4; d <= 50; d++) {
    for (let n = 2; n < d; n++) {
      let g = gcd(n, d);
      if (g > 1) { yakubun.push(`${n}/${d}を 約分すると？|${n / g}/${d / g}`); }
    }
  }
  problems["5年_約分"] = yakubun.sort(() => Math.random() - 0.5).slice(0, 100);

  const piCalc = [];
  for (let i = 1; i <= 20; i++) {
    let ans = parseFloat((i * 3.14).toPrecision(10)).toString();
    piCalc.push(`${i}×3.14|${ans}`);
    if (i <= 9) piCalc.push(`3.14×${i}|${ans}`);
  }
  for (let i = 30; i <= 90; i += 10) {
    let ans = parseFloat((i * 3.14).toPrecision(10)).toString();
    piCalc.push(`${i}×3.14|${ans}`);
  }
  for (let i = 0.5; i <= 9.5; i += 1) {
    let ans = parseFloat((i * 3.14).toPrecision(10)).toString();
    piCalc.push(`${i}×3.14|${ans}`);
  }
  problems["5年_3.14のけいさん"] = piCalc;

  const koubaisuu = [];
  for (let a = 2; a <= 12; a++) {
    for (let b = a + 1; b <= 15; b++) {
      let g = gcd(a, b);
      let lcm = (a * b) / g;
      if (lcm <= 60) { koubaisuu.push(`${a}と${b}の 最小公倍数は？|${lcm}`); }
    }
  }
  for (let a = 4; a <= 50; a++) {
    for (let b = a + 1; b <= 60; b++) {
      let g = gcd(a, b);
      if (g > 2 && g !== a) { koubaisuu.push(`${a}と${b}の 最大公約数は？|${g}`); }
    }
  }
  problems["5年_公倍数・公約数"] = koubaisuu.sort(() => Math.random() - 0.5).slice(0, 100);

  const kaku5 = [
    "三角形の 内角の和は なんど？|180", "四角形の 内角の和は なんど？|360",
    "五角形の 内角の和は なんど？|540", "六角形の 内角の和は なんど？|720",
    "七角形の 内角の和は なんど？|900", "八角形の 内角の和は なんど？|1080"
  ];
  problems["5年_ことば（図形の角）"] = kaku5;

  const percent5 = [];
  for (let i = 1; i <= 99; i++) {
    let dec = (i / 100).toFixed(2);
    if (i % 10 === 0) dec = (i / 100).toFixed(1);
    percent5.push(`割合の ${dec} を 百分率(%)で こたえると なん%？|${i}`);
  }
  percent5.push("割合の 1 を 百分率(%)で こたえると なん%？|100");
  problems["5年_ことば（百分率）"] = percent5;

  const taiseki5 = [];
  for (let i = 0; i < 100; i++) {
    if (Math.random() < 0.3) {
      let a = Math.floor(Math.random() * 9) + 2;
      taiseki5.push(`1辺が ${a}cmの 立方体の 体積は なん㎤？|${a * a * a}`);
    } else {
      let a = Math.floor(Math.random() * 9) + 2;
      let b = Math.floor(Math.random() * 9) + 2;
      let c = Math.floor(Math.random() * 9) + 2;
      taiseki5.push(`たて ${a}cm、よこ ${b}cm、高さ ${c}cmの 直方体の 体積は なん㎤？|${a * b * c}`);
    }
  }
  problems["5年_ことば（体積のけいさん）"] = taiseki5;

  const menseki5 = [];
  for (let i = 0; i < 100; i++) {
    if (Math.random() < 0.5) {
      let b = Math.floor(Math.random() * 19) + 2;
      let h = Math.floor(Math.random() * 19) + 2;
      menseki5.push(`底辺 ${b}cm、高さ ${h}cmの 平行四辺形の 面積は なん㎠？|${b * h}`);
    } else {
      let b = Math.floor(Math.random() * 19) + 2;
      let h = Math.floor(Math.random() * 19) + 2;
      if ((b * h) % 2 !== 0) b += 1;
      menseki5.push(`底辺 ${b}cm、高さ ${h}cmの 三角形の 面積は なん㎠？|${(b * h) / 2}`);
    }
  }
  problems["5年_ことば（図形の面積）"] = menseki5;

  const heikin5 = [];
  for (let i = 0; i < 100; i++) {
    let a = Math.floor(Math.random() * 40) + 10;
    let b = Math.floor(Math.random() * 40) + 10;
    let c = Math.floor(Math.random() * 40) + 10;
    let sum = a + b + c;
    let rem = sum % 3;
    if (rem !== 0) { c += (3 - rem); }
    heikin5.push(`${a} と ${b} と ${c} の 平均は？|${(a + b + c) / 3}`);
  }
  problems["5年_ことば（平均）"] = heikin5;

  const enCalc6 = [];
  for (let r = 1; r <= 10; r++) {
    let d = r * 2;
    let ensyu = parseFloat((d * 3.14).toPrecision(10)).toString();
    enCalc6.push(`半径 ${r}cm の 円周は なんcm？|${ensyu}`);
    enCalc6.push(`直径 ${d}cm の 円周は なんcm？|${ensyu}`);
    let menseki = parseFloat((r * r * 3.14).toPrecision(10)).toString();
    enCalc6.push(`半径 ${r}cm の 円の面積は なん㎠？|${menseki}`);
  }
  problems["6年_円の計算"] = enCalc6;

  const hiCalc6 = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      if (a !== b && a % b !== 0 && b % a !== 0) {
        let g = gcd(a, b);
        let a1 = a / g; let b1 = b / g;
        hiCalc6.push(`${a}:${b} の 比の値は？|${a1}/${b1}`);
      } else if (a % b === 0) {
        hiCalc6.push(`${a}:${b} の 比の値は？|${a / b}`);
      }
    }
  }
  for (let a = 1; a <= 5; a++) {
    for (let b = 1; b <= 5; b++) {
      for (let k = 2; k <= 5; k++) {
        if (a !== b) {
          hiCalc6.push(`${a}:${b} = ${a * k}:?|${b * k}`);
          hiCalc6.push(`${a}:${b} = ?:${b * k}|${a * k}`);
        }
      }
    }
  }
  problems["6年_比のけいさん"] = hiCalc6.sort(() => Math.random() - 0.5).slice(0, 100);

  const baai6 = [
    "2人を 1列に ならべる ならべ方は なん通り？|2", "3人を 1列に ならべる ならべ方は なん通り？|6",
    "4人を 1列に ならべる ならべ方は なん通り？|24", "5人を 1列に ならべる ならべ方は なん通り？|120",
    "3人から 2人を えらぶ えらび方は なん通り？|3", "4人から 2人を えらぶ えらび方は なん通り？|6",
    "5人から 2人を えらぶ えらび方は なん通り？|10", "6人から 2人を えらぶ えらび方は なん通り？|15",
    "4人から 3人を えらぶ えらび方は なん通り？|4", "5人から 3人を えらぶ えらび方は なん通り？|10",
    "コインを 2回 なげます。表と裏の 出方は なん通り？|4", "コインを 3回 なげます。表と裏の 出方は なん通り？|8",
    "さいころを 1回 なげます。目の 出方は なん通り？|6"
  ];
  problems["6年_場合の数"] = baai6;

  const taisho6 = [
    "正三角形の 対称の軸は なん本？|3", "正方形の 対称の軸は なん本？|4", "正五角形の 対称の軸は なん本？|5",
    "正六角形の 対称の軸は なん本？|6", "正八角形の 対称の軸は なん本？|8", "長方形の 対称の軸は なん本？|2",
    "ひし形の 対称の軸は なん本？|2", "二等辺三角形の 対称の軸は なん本？|1"
  ];
  problems["6年_ことば（対称な図形）"] = taisho6;

  const kakushuku6 = [];
  for (let i = 0; i < 100; i++) {
    if (Math.random() < 0.5) {
      let a = Math.floor(Math.random() * 20) + 2;
      let k = Math.floor(Math.random() * 4) + 2;
      kakushuku6.push(`長さ ${a}cm の ${k}倍の 拡大図の 長さは なんcm？|${a * k}`);
    } else {
      let a = Math.floor(Math.random() * 10) + 2;
      let k_hundreds = Math.floor(Math.random() * 10) + 1;
      let k = k_hundreds * 100;
      kakushuku6.push(`${k}分の1 の 縮図で ${a}cm の 長さは、実際には なんm？|${(a * k) / 100}`);
    }
  }
  problems["6年_ことば（拡大図と縮図）"] = kakushuku6;

  const rittai6 = [];
  for (let i = 0; i < 100; i++) {
    let s = Math.floor(Math.random() * 50) + 10;
    let h = Math.floor(Math.random() * 20) + 2;
    if (Math.random() < 0.5) {
      rittai6.push(`底面積が ${s}㎠、高さが ${h}cm の 角柱の 体積は なん㎤？|${s * h}`);
    } else {
      rittai6.push(`底面積が ${s}㎠、高さが ${h}cm の 円柱の 体積は なん㎤？|${s * h}`);
    }
  }
  problems["6年_ことば（立体の体積）"] = rittai6;

  const daihyo6 = [];
  for (let i = 0; i < 100; i++) {
    if (Math.random() < 0.5) {
      let start = Math.floor(Math.random() * 10) + 1;
      let arr = [start, start + Math.floor(Math.random() * 3), start + Math.floor(Math.random() * 5) + 2, start + Math.floor(Math.random() * 8) + 5, start + Math.floor(Math.random() * 10) + 8];
      arr.sort((a, b) => a - b);
      daihyo6.push(`${arr.join(', ')} の 中央値(メジアン)は？|${arr[2]}`);
    } else {
      // 最頻値。0や負の数が混ざらないよう、mode は 6 以上から選ぶ
      let mode = Math.floor(Math.random() * 10) + 6;
      let other1 = mode + Math.floor(Math.random() * 5) + 1;
      let other2 = mode - Math.floor(Math.random() * 5) - 1;
      let arr = [mode, mode, mode, other1, other2];
      arr.sort(() => Math.random() - 0.5);
      daihyo6.push(`${arr.join(', ')} の 最頻値(モード)は？|${mode}`);
    }
  }
  problems["6年_ことば（データの代表値）"] = daihyo6;

  const hirei6 = [];
  for (let i = 0; i < 100; i++) {
    if (Math.random() < 0.5) {
      let a = Math.floor(Math.random() * 9) + 2;
      let x1 = Math.floor(Math.random() * 5) + 2;
      let y1 = a * x1;
      let x2 = x1 + Math.floor(Math.random() * 4) + 1;
      hirei6.push(`yはxに 比例します。xが${x1}のとき yは${y1}です。xが${x2}のとき yはいくつ？|${a * x2}`);
    } else {
      let y2 = Math.floor(Math.random() * 8) + 2;
      let x2 = Math.floor(Math.random() * 5) + 2;
      let a = x2 * y2;
      let divisors = [];
      for (let d = 2; d <= a; d++) {
        if (a % d === 0 && d !== x2) divisors.push(d);
      }
      if (divisors.length > 0) {
        let x1 = divisors[Math.floor(Math.random() * divisors.length)];
        let y1 = a / x1;
        hirei6.push(`yはxに 反比例します。xが${x1}のとき yは${y1}です。xが${x2}のとき yはいくつ？|${y2}`);
      } else {
        i--;
      }
    }
  }
  problems["6年_ことば（比例・反比例のけいさん）"] = hirei6;

  // ==========================================================
  // 追加コース: 小学校算数のうち、これまでカバーできていなかった単元
  // （時こくと時間・2けた×2けた・□を使った式・仮分数と帯分数・
  //   通分・倍数と約数・分数と小数・単位量あたり・割合の3用法 など）
  // ==========================================================
  const num = (v) => parseFloat(Number(v).toPrecision(12)).toString();
  const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const shuffled = (arr, n = 100) => arr.sort(() => Math.random() - 0.5).slice(0, n);
  // 分数の答え。約分できるときは約分前・約分後のどちらも正解にする
  const fracAns = (n, d) => {
    if (n % d === 0) return String(n / d);
    const g = gcd(n, d);
    return g > 1 ? `${n}/${d}|${n / g}/${d / g}` : `${n}/${d}`;
  };

  // --- 1年: おおきさくらべ（任意単位でくらべる） ---
  const kurabe1 = [];
  for (let a = 2; a <= 12; a++) {
    for (let b = 1; b < a; b++) {
      kurabe1.push(`えんぴつは クリップ ${a}こぶん、ペンは クリップ ${b}こぶん。えんぴつは なんこぶん ながい？|${a - b}`);
      kurabe1.push(`あかい コップ ${a}はいぶんと、あおい コップ ${b}はいぶんの 水。あわせて なんはいぶん？|${a + b}`);
      kurabe1.push(`つくえの よこは ますが ${a}こぶん、ほんの よこは ますが ${b}こぶん。ちがいは なんこぶん？|${a - b}`);
    }
  }
  problems["1年_ことば（おおきさくらべ）"] = shuffled(kurabe1);

  // --- 2年: 時こくと時間 ---
  const jikoku2 = [];
  for (let h = 1; h <= 11; h++) {
    for (let m = 0; m <= 50; m += 10) {
      for (const d of [10, 20, 30]) {
        if (m + d < 60) {
          jikoku2.push(`${h}時${m}分の ${d}分後は ${h}時なん分？|${m + d}`);
          jikoku2.push(`${h}時${m}分から ${h}時${m + d}分までは なん分？|${d}`);
          jikoku2.push(`${h}時${m + d}分の ${d}分前は ${h}時なん分？|${m}`);
        } else {
          jikoku2.push(`${h}時${m}分の ${d}分後は ${h + 1}時なん分？|${m + d - 60}`);
        }
      }
    }
    jikoku2.push(`${h}時から ${h + 1}時までは なん分？|60`);
  }
  for (let m = 5; m <= 55; m += 5) {
    jikoku2.push(`1時間${m}分は なん分？|${60 + m}`);
    jikoku2.push(`${60 + m}分は 1時間なん分？|${m}`);
  }
  for (let h = 8; h <= 11; h++) {
    for (let h2 = 1; h2 <= 5; h2++) jikoku2.push(`午前${h}時から 午後${h2}時までは なん時間？|${12 - h + h2}`);
  }
  jikoku2.push('1日は なん時間？|24', '午前は なん時間？|12', '午後は なん時間？|12', '1時間は なん分？|60', '2時間は なん分？|120', '半日は なん時間？|12');
  problems["2年_時こくと時間"] = shuffled(jikoku2);

  // --- 2年: 1000までの数のしくみ ---
  const shikumi2 = [];
  for (let a = 1; a <= 9; a++) {
    for (let b = 0; b <= 9; b++) {
      for (let c = 0; c <= 8; c += 4) {
        shikumi2.push(`100が ${a}こ、10が ${b}こ、1が ${c}こ。あわせて いくつ？|${a * 100 + b * 10 + c}`);
      }
    }
    shikumi2.push(`${a}00は 100を いくつ あつめた 数？|${a}`);
    shikumi2.push(`${a}0は 10を いくつ あつめた 数？|${a}`);
    shikumi2.push(`10を ${a * 10}こ あつめた 数は？|${a * 100}`);
  }
  for (let n = 100; n <= 890; n += 30) {
    shikumi2.push(`${n}より 10 大きい 数は？|${n + 10}`);
    shikumi2.push(`${n}より 10 小さい 数は？|${n - 10}`);
    shikumi2.push(`${n}より 100 大きい 数は？|${n + 100}`);
  }
  shikumi2.push('1000は 100を いくつ あつめた 数？|10', '1000は 10を いくつ あつめた 数？|100', '1000より 1 小さい 数は？|999');
  problems["2年_数のしくみ（1000まで）"] = shuffled(shikumi2);

  // --- 2年: かけ算のきまり（交換法則・1ふえるといくつふえる・0や10のかけ算） ---
  const kukuKimari2 = [];
  for (let a = 2; a <= 9; a++) {
    for (let b = 2; b <= 9; b++) {
      kukuKimari2.push(`${a}×${b}と 答えが おなじに なるのは ${b}×□。□は いくつ？|${a}`);
      if (b < 9) kukuKimari2.push(`${a}×${b + 1}は ${a}×${b}より いくつ 大きい？|${a}`);
      kukuKimari2.push(`${a}を ${b}こ たした 数は いくつ？|${a * b}`);
    }
  }
  for (let a = 1; a <= 9; a++) {
    kukuKimari2.push(`${a}×0は いくつ？|0`, `0×${a}は いくつ？|0`, `${a}×10は いくつ？|${a * 10}`, `10×${a}は いくつ？|${a * 10}`, `${a}×1は いくつ？|${a}`);
  }
  problems["2年_ことば（かけ算のきまり）"] = shuffled(kukuKimari2);

  // --- 3年: かけ算のひっ算（2けた×2けた・3けた×2けた） ---
  const kakezan2x2 = [];
  for (let i = 0; i < 100; i++) {
    const a = rnd(11, 99); const b = rnd(11, 99);
    kakezan2x2.push(`${a}×${b}|${a * b}`);
  }
  problems["3年_かけ算（2けた×2けた）"] = kakezan2x2;

  const kakezan3x2 = [];
  for (let i = 0; i < 100; i++) {
    const a = rnd(100, 999); const b = rnd(11, 99);
    kakezan3x2.push(`${a}×${b}|${a * b}`);
  }
  problems["3年_かけ算（3けた×2けた）"] = kakezan3x2;

  // --- 3年: 3けたのたし算・ひき算のひっ算 ---
  const hissan3 = [];
  for (let i = 0; i < 100; i++) {
    if (i % 2 === 0) {
      const a = rnd(105, 880); const b = rnd(105, 999 - a);
      hissan3.push(`${a}+${b}|${a + b}`);
    } else {
      const a = rnd(210, 999); const b = rnd(105, a - 100);
      hissan3.push(`${a}-${b}|${a - b}`);
    }
  }
  problems["3年_3けたのたし算・ひき算"] = hissan3;

  // --- 3年: □を使った式（逆算の考え方） ---
  const shiki3 = [];
  for (let b = 2; b <= 20; b++) {
    for (let ans = 2; ans <= 20; ans += 3) {
      shiki3.push(`□+${b}=${ans + b}。□は いくつ？|${ans}`);
      shiki3.push(`${b}+□=${ans + b}。□は いくつ？|${ans}`);
      shiki3.push(`□-${b}=${ans}。□は いくつ？|${ans + b}`);
      shiki3.push(`${ans + b}-□=${ans}。□は いくつ？|${b}`);
    }
  }
  for (let b = 2; b <= 9; b++) {
    for (let ans = 2; ans <= 9; ans++) {
      shiki3.push(`□×${b}=${ans * b}。□は いくつ？|${ans}`);
      shiki3.push(`${b}×□=${ans * b}。□は いくつ？|${ans}`);
      shiki3.push(`□÷${b}=${ans}。□は いくつ？|${ans * b}`);
      shiki3.push(`${ans * b}÷□=${ans}。□は いくつ？|${b}`);
    }
  }
  problems["3年_□を使った式"] = shuffled(shiki3);

  // --- 3年: 小数と分数のかんけい（0.1と1/10） ---
  const shosuBunsu3 = [];
  for (let a = 1; a <= 9; a++) {
    shosuBunsu3.push(`0.${a}は 0.1が いくつ分？|${a}`);
    shosuBunsu3.push(`0.1を ${a}こ あつめた 数は？|0.${a}`);
    shosuBunsu3.push(`0.${a}を 分数で かくと □/10。□は いくつ？|${a}`);
    shosuBunsu3.push(`${a}/10を 小数で かくと？|0.${a}`);
    shosuBunsu3.push(`1より 0.${a} 大きい 数は？|1.${a}`);
  }
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      if (a + b < 10) shosuBunsu3.push(`0.1が ${a}こと 0.1が ${b}こ。あわせて いくつ？|0.${a + b}`);
    }
  }
  shosuBunsu3.push('1は 0.1を いくつ あつめた 数？|10', '10/10を 整数で かくと？|1', '1は 1/10が いくつ分？|10');
  problems["3年_小数と分数"] = shuffled(shosuBunsu3);

  // --- 4年: 小数のたし算・ひき算（1/100の位まで） ---
  const shosuTashiHiki4 = [];
  for (let i = 0; i < 100; i++) {
    const aI = rnd(30, 900); const bI = rnd(15, 500);
    if (i % 2 === 0) {
      shosuTashiHiki4.push(`${num(aI / 100)} + ${num(bI / 100)}|${num((aI + bI) / 100)}`);
    } else {
      const hi = Math.max(aI, bI) + 1; const lo = Math.min(aI, bI);
      shosuTashiHiki4.push(`${num(hi / 100)} - ${num(lo / 100)}|${num((hi - lo) / 100)}`);
    }
  }
  problems["4年_小数のたし算・ひき算"] = shosuTashiHiki4;

  // --- 4年: 仮分数と帯分数 ---
  const kabun4 = [];
  for (let d = 2; d <= 9; d++) {
    for (let q = 1; q <= 4; q++) {
      for (let r = 1; r < d; r++) {
        const n = q * d + r;
        kabun4.push(`${n}/${d}を 帯分数に すると □と${r}/${d}。□は いくつ？|${q}`);
        kabun4.push(`${n}/${d}を 帯分数に すると ${q}と□/${d}。□は いくつ？|${r}`);
        kabun4.push(`${q}と${r}/${d}を 仮分数に すると □/${d}。□は いくつ？|${n}`);
      }
    }
    for (let k = 1; k <= 4; k++) kabun4.push(`${k * d}/${d}を 整数に すると？|${k}`);
  }
  problems["4年_仮分数と帯分数"] = shuffled(kabun4);

  // --- 4年: がい数を使った見つもり ---
  const gaisan4 = [];
  for (let i = 0; i < 100; i++) {
    const t = i % 3;
    if (t === 0) {
      const a = rnd(11, 98) * 100 + rnd(1, 99); const b = rnd(11, 98) * 100 + rnd(1, 99);
      const ra = Math.round(a / 100) * 100; const rb = Math.round(b / 100) * 100;
      gaisan4.push(`${a}+${b} を 百の位までの がい数に して 見つもると？|${ra + rb}`);
    } else if (t === 1) {
      let a = rnd(21, 98) * 100 + rnd(1, 99); let b = rnd(11, 20) * 100 + rnd(1, 99);
      const ra = Math.round(a / 100) * 100; const rb = Math.round(b / 100) * 100;
      gaisan4.push(`${a}-${b} を 百の位までの がい数に して 見つもると？|${ra - rb}`);
    } else {
      const a = rnd(11, 89) * 10 + rnd(1, 9); const b = rnd(11, 89) * 10 + rnd(1, 9);
      const ra = Math.round(a / 100) * 100; const rb = Math.round(b / 100) * 100;
      gaisan4.push(`${a}×${b} を 上から1けたの がい数に して 見つもると？|${ra * rb}`);
    }
  }
  problems["4年_がい数の見つもり"] = gaisan4;

  // --- 4年: 垂直・平行と四角形 ---
  const shikaku4 = [
    '長方形の 4つの 角は それぞれ なんど？|90', '正方形の 4つの 角は それぞれ なんど？|90',
    '平行四辺形で 平行な 辺は なん組？|2', '台形で 平行な 辺は なん組？|1',
    'ひし形の 辺は なん本？|4', 'ひし形の 4つの 辺の 長さは ぜんぶ 同じ。1辺が 7cmの とき まわりは なんcm？|28',
    '四角形の たいかく線は なん本？|2', '長方形の たいかく線の 長さは 同じ。1本が 10cmの とき もう1本は なんcm？|10',
    '平行四辺形の となり合う 角を たすと なんど？|180', '垂直に まじわる 2本の 直線が つくる 角は なんど？|90'
  ];
  for (let x = 20; x <= 160; x += 10) {
    shikaku4.push(`平行四辺形の 1つの 角が ${x}どのとき、向かい合う 角は なんど？|${x}`);
    shikaku4.push(`平行四辺形の 1つの 角が ${x}どのとき、となりの 角は なんど？|${180 - x}`);
  }
  for (let a = 3; a <= 20; a++) {
    shikaku4.push(`1辺が ${a}cmの ひし形の まわりの 長さは なんcm？|${a * 4}`);
    shikaku4.push(`たて ${a}cm、よこ ${a + 3}cmの 長方形の まわりの 長さは なんcm？|${(a + a + 3) * 2}`);
  }
  problems["4年_ことば（垂直・平行と四角形）"] = shuffled(shikaku4);

  // --- 4年: 変わり方（ともなって変わる2つの数量） ---
  const kawari4 = [];
  for (let s = 10; s <= 30; s++) {
    for (let a = 1; a < s; a += 4) kawari4.push(`□と○を たすと ${s}に なります。□が ${a}のとき ○は いくつ？|${s - a}`);
  }
  for (let a = 2; a <= 20; a++) {
    kawari4.push(`1辺が ${a}cmの 正三角形の まわりの 長さは なんcm？|${a * 3}`);
    kawari4.push(`1辺が ${a}cmの 正方形の まわりの 長さは なんcm？|${a * 4}`);
  }
  for (let p = 20; p <= 120; p += 10) {
    for (let n = 2; n <= 6; n++) kawari4.push(`1本 ${p}円の えんぴつ ${n}本の 代金は なん円？|${p * n}`);
  }
  for (let a = 5; a <= 25; a++) {
    kawari4.push(`午前9時の 気温は ${a}度、正午は ${a + 6}度。上がった 気温は なん度？|6`);
  }
  problems["4年_ことば（変わり方）"] = shuffled(kawari4);

  // --- 5年: 通分 ---
  const tsuubun5 = [];
  for (let a = 2; a <= 9; a++) {
    for (let b = a + 1; b <= 12; b++) {
      const l = (a * b) / gcd(a, b);
      if (l > 60) continue;
      tsuubun5.push(`1/${a}と 1/${b}を 通分すると 分母は いくつ？|${l}`);
      tsuubun5.push(`1/${a}を 分母が ${l}の 分数に すると □/${l}。□は いくつ？|${l / a}`);
      tsuubun5.push(`1/${b}を 分母が ${l}の 分数に すると □/${l}。□は いくつ？|${l / b}`);
      tsuubun5.push(`1/${a}と 1/${b}、大きい ほうは？|1/${a}`);
    }
  }
  problems["5年_通分"] = shuffled(tsuubun5);

  // --- 5年: 倍数と約数（偶数・奇数をふくむ） ---
  const baisuu5 = [];
  for (let a = 2; a <= 12; a++) {
    for (let k = 2; k <= 6; k++) baisuu5.push(`${a}の 倍数を 小さい ほうから ${k}ばんめは？|${a * k}`);
    baisuu5.push(`${a}の いちばん 小さい 倍数は？|${a}`);
  }
  for (let n = 6; n <= 60; n++) {
    const divs = [];
    for (let d = 1; d <= n; d++) if (n % d === 0) divs.push(d);
    if (divs.length >= 4) {
      baisuu5.push(`${n}の 約数は ぜんぶで なんこ？|${divs.length}`);
      baisuu5.push(`${n}の 約数の うち、${n}の つぎに 大きいのは？|${divs[divs.length - 2]}`);
      baisuu5.push(`${n}の 約数の うち、1の つぎに 小さいのは？|${divs[1]}`);
    }
  }
  for (let n = 10; n <= 100; n += 2) baisuu5.push(`1から ${n}までに 偶数は なんこ ある？|${n / 2}`);
  for (let n = 11; n <= 99; n += 2) baisuu5.push(`1から ${n}までに 奇数は なんこ ある？|${(n + 1) / 2}`);
  problems["5年_倍数と約数"] = shuffled(baisuu5);

  // --- 5年: 分数と小数（わり算と分数・小数への変換） ---
  const bunsuShosu5 = [];
  const DEC_FRAC = [[0.5, 1, 2], [0.25, 1, 4], [0.75, 3, 4], [0.2, 1, 5], [0.4, 2, 5], [0.6, 3, 5], [0.8, 4, 5], [0.125, 1, 8], [0.375, 3, 8], [0.625, 5, 8], [0.875, 7, 8], [0.05, 1, 20], [0.1, 1, 10], [0.3, 3, 10], [0.7, 7, 10], [0.9, 9, 10]];
  for (const [dec, n, d] of DEC_FRAC) {
    bunsuShosu5.push(`${n}/${d}を 小数に すると？|${dec}`);
    bunsuShosu5.push(`${dec}を 分数に すると □/${d}。□は いくつ？|${n}`);
  }
  for (let a = 1; a <= 9; a++) {
    for (let b = 2; b <= 9; b++) {
      if (a < b) bunsuShosu5.push(`${a}÷${b}を 分数で あらわすと？|${fracAns(a, b)}`);
    }
  }
  for (let d = 2; d <= 9; d++) {
    for (let n = 1; n < d; n++) {
      const v = n / d;
      if (Number.isInteger(v * 1000)) bunsuShosu5.push(`${n}/${d}を 小数に すると？|${num(v)}`);
    }
  }
  problems["5年_分数と小数"] = shuffled(bunsuShosu5);

  // --- 5年: 単位量あたりの大きさ ---
  const tanniAtari5 = [];
  for (let i = 0; i < 100; i++) {
    const t = i % 4;
    if (t === 0) { const n = rnd(2, 9); const per = rnd(20, 150); tanniAtari5.push(`${n}こで ${n * per}円の おかし。1こ なん円？|${per}`); }
    else if (t === 1) { const l = rnd(2, 9); const km = rnd(8, 18); tanniAtari5.push(`ガソリン ${l}Lで ${l * km}km 走る 車。1Lで なんkm 走る？|${km}`); }
    else if (t === 2) { const a = rnd(2, 9); const d = rnd(20, 300); tanniAtari5.push(`面積 ${a}k㎡に ${a * d}人が すんでいます。人口みつどは 1k㎡あたり なん人？|${d}`); }
    else { const n = rnd(2, 9); const per = rnd(3, 30); tanniAtari5.push(`1mの ねだんが ${per}円の リボン。${n}mでは なん円？|${n * per}`); }
  }
  problems["5年_単位量あたりの大きさ"] = tanniAtari5;

  // --- 5年: 割合（くらべる量・もとにする量） ---
  const PCTS = [5, 10, 20, 25, 40, 50, 60, 75, 80];
  const wariai5 = [];
  for (let i = 0; i < 100; i++) {
    const t = i % 4;
    const p = PCTS[rnd(0, PCTS.length - 1)];
    if (t === 0) { const base = rnd(1, 30) * 100; wariai5.push(`${base}円の ${p}%は なん円？|${(base * p) / 100}`); }
    else if (t === 1) { const base = rnd(1, 10) * 20; wariai5.push(`${base}人の ${p}%は なん人？|${(base * p) / 100}`); }
    else if (t === 2) { const base = rnd(1, 10) * 20; wariai5.push(`${(base * p) / 100}は ${base}の なん%？|${p}`); }
    else { const base = rnd(1, 20) * 100; wariai5.push(`ある 数の ${p}%が ${(base * p) / 100}です。もとにする 数は いくつ？|${base}`); }
  }
  problems["5年_割合（くらべる量・もとにする量）"] = wariai5;

  // --- 5年: 歩合（割・分・厘） ---
  const buai5 = [];
  for (let w = 1; w <= 9; w++) {
    buai5.push(`${w}割は なん%？|${w * 10}`);
    buai5.push(`${w * 10}%は なん割？|${w}`);
    for (let b = 1; b <= 9; b++) {
      buai5.push(`${w}割${b}分は なん%？|${w * 10 + b}`);
      buai5.push(`${w * 10 + b}%は ${w}割なん分？|${b}`);
    }
  }
  for (let base = 100; base <= 2000; base += 100) {
    for (let w = 1; w <= 9; w += 2) buai5.push(`${base}円の ${w}割は なん円？|${(base * w) / 10}`);
  }
  buai5.push('1分は なん%？|1', '10割は なん%？|100', '1割は 小数で あらわすと？|0.1', '1分は 小数で あらわすと？|0.01');
  problems["5年_ことば（歩合）"] = shuffled(buai5);

  // --- 5年: 台形・ひし形の面積 ---
  const menseki5b = [];
  for (let i = 0; i < 100; i++) {
    if (i % 2 === 0) {
      const a = rnd(2, 14); const b = a + rnd(1, 8); let h = rnd(2, 14);
      if (((a + b) * h) % 2 !== 0) h += 1;
      menseki5b.push(`上底 ${a}cm、下底 ${b}cm、高さ ${h}cmの 台形の 面積は なん㎠？|${((a + b) * h) / 2}`);
    } else {
      let p = rnd(2, 20); const q = rnd(2, 20);
      if ((p * q) % 2 !== 0) p += 1;
      menseki5b.push(`たいかく線が ${p}cmと ${q}cmの ひし形の 面積は なん㎠？|${(p * q) / 2}`);
    }
  }
  problems["5年_ことば（台形・ひし形の面積）"] = menseki5b;

  // --- 5年: 正多角形と円 ---
  const seitakakkei5 = [];
  const KANSUJI = ['', '', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  for (let n = 3; n <= 12; n++) {
    const name = `正${KANSUJI[n]}角形`;
    if (360 % n === 0) seitakakkei5.push(`${name}を 円の 中心から わけたとき、中心の 角 1つは なんど？|${360 / n}`);
    if (((n - 2) * 180) % n === 0) seitakakkei5.push(`${name}の 1つの 角は なんど？|${((n - 2) * 180) / n}`);
    seitakakkei5.push(`${name}の 辺は なん本？|${n}`);
    seitakakkei5.push(`${name}の 内角の和は なんど？|${(n - 2) * 180}`);
    for (let a = 2; a <= 12; a++) seitakakkei5.push(`1辺が ${a}cmの ${name}の まわりの 長さは なんcm？|${n * a}`);
  }
  problems["5年_ことば（正多角形と円）"] = shuffled(seitakakkei5);

  // --- 6年: 分数と小数のまじった計算 ---
  const konsei6 = [];
  for (const [dec, n, d] of DEC_FRAC) {
    if (d > 10) continue;
    for (let dd = 2; dd <= 6; dd++) {
      for (let nn = 1; nn < dd; nn++) {
        konsei6.push(`${dec} × ${nn}/${dd}|${fracAns(n * nn, d * dd)}`);
        konsei6.push(`${nn}/${dd} × ${dec}|${fracAns(n * nn, d * dd)}`);
        konsei6.push(`${nn}/${dd} ÷ ${dec}|${fracAns(nn * d, dd * n)}`);
      }
    }
  }
  problems["6年_分数と小数のまじった計算"] = shuffled(konsei6);

  // --- 6年: 比を簡単にする ---
  const hiKantan6 = [];
  for (let a = 2; a <= 24; a++) {
    for (let b = 2; b <= 24; b++) {
      const g = gcd(a, b);
      if (g > 1 && a !== b) {
        hiKantan6.push(`${a}:${b}を いちばん 簡単な 整数の 比に すると □:${b / g}。□は いくつ？|${a / g}`);
        hiKantan6.push(`${a}:${b}を いちばん 簡単な 整数の 比に すると ${a / g}:□。□は いくつ？|${b / g}`);
      }
    }
  }
  problems["6年_比を簡単にする"] = shuffled(hiKantan6);

  // チャレンジ_四則混合: 静的な6問に加え、計算の順序（×÷が先・カッコが先）を
  // 意識させる問題を決定的に生成して拡充する
  const shisoku = [...DEFAULT_PROBLEMS["チャレンジ_四則混合"]];
  for (let b = 2; b <= 9; b++) {
    for (let c = 2; c <= 9; c++) {
      const a = ((b * 5 + c * 3) % 8) + 2;
      switch ((b + c) % 6) {
        case 0: shisoku.push(`${a}+${b}×${c}|${a + b * c}`); break;
        case 1: shisoku.push(`${b * c + a}-${b}×${c}|${a}`); break;
        case 2: shisoku.push(`(${a}+${b})×${c}|${(a + b) * c}`); break;
        case 3: shisoku.push(a * b > c ? `${a}×${b}-${c}|${a * b - c}` : `${a}×${b}+${c}|${a * b + c}`); break;
        case 4: shisoku.push(`${a}+${b * c}÷${c}|${a + b}`); break;
        case 5: shisoku.push(`(${a * c}+${b * c})÷${c}|${a + b}`); break;
      }
    }
  }
  problems["チャレンジ_四則混合"] = shisoku;

  return problems;
};

Object.assign(DEFAULT_PROBLEMS, generateDynamicProblems());

// アイテムの追加フィールド:
//   lv: そのレベルに到達するまで購入できない(ながく遊ぶための解放条件)
//   gacha: ショップでは買えず「ふしぎなたまごガチャ」からのみ出る
//   rarity: ガチャ限定品のレアリティ明示。通常品は価格から自動判定(getRarity)
const SHOP_ITEMS = {
  bases: [
    { id: 'b_dog', char: '🐶', name: 'イヌ', price: 0 }, { id: 'b_cat', char: '🐱', name: 'ネコ', price: 200 },
    { id: 'b_frog', char: '🐸', name: 'カエル', price: 250 }, { id: 'b_bear', char: '🐻', name: 'クマ', price: 300 },
    { id: 'b_pig', char: '🐷', name: 'ブタ', price: 300 }, { id: 'b_monkey', char: '🐵', name: 'サル', price: 350 },
    { id: 'b_rabbit', char: '🐰', name: 'ウサギ', price: 350 }, { id: 'b_penguin', char: '🐧', name: 'ペンギン', price: 400 },
    { id: 'b_fox', char: '🦊', name: 'キツネ', price: 400 }, { id: 'b_koala', char: '🐨', name: 'コアラ', price: 450 },
    { id: 'b_tiger', char: '🐯', name: 'トラ', price: 450 }, { id: 'b_panda', char: '🐼', name: 'パンダ', price: 500 },
    { id: 'b_lion', char: '🦁', name: 'ライオン', price: 600 }, { id: 'b_ghost', char: '👻', name: 'オバケ', price: 700 },
    { id: 'b_alien', char: '👽', name: 'うちゅうじん', price: 800 }, { id: 'b_robot', char: '🤖', name: 'ロボット', price: 900 },
    { id: 'b_dragon', char: '🐉', name: 'ドラゴン', price: 1000 }, { id: 'b_unicorn', char: '🦄', name: 'ユニコーン', price: 1500 },
    { id: 'b_hamster', char: '🐹', name: 'ハムスター', price: 250 }, { id: 'b_mouse', char: '🐭', name: 'ネズミ', price: 250 },
    { id: 'b_chick', char: '🐥', name: 'ヒヨコ', price: 300 }, { id: 'b_chicken', char: '🐔', name: 'ニワトリ', price: 350 },
    { id: 'b_cow', char: '🐮', name: 'ウシ', price: 400 }, { id: 'b_turtle', char: '🐢', name: 'カメ', price: 400 },
    { id: 'b_horse', char: '🐴', name: 'ウマ', price: 450 }, { id: 'b_crab', char: '🦀', name: 'カニ', price: 450 },
    { id: 'b_owl', char: '🦉', name: 'フクロウ', price: 500 }, { id: 'b_octopus', char: '🐙', name: 'タコ', price: 550 },
    { id: 'b_wolf', char: '🐺', name: 'オオカミ', price: 650 }, { id: 'b_dolphin', char: '🐬', name: 'イルカ', price: 800 },
    { id: 'b_whale', char: '🐳', name: 'クジラ', price: 1200 }, { id: 'b_parrot', char: '🦜', name: 'オウム', price: 1400 },
    { id: 'b_shark', char: '🦈', name: 'サメ', price: 1600 }, { id: 'b_hedgehog', char: '🦔', name: 'ハリネズミ', price: 1600 },
    { id: 'b_elephant', char: '🐘', name: 'ゾウ', price: 1800 }, { id: 'b_trex', char: '🦖', name: 'きょうりゅう', price: 2000 },
    { id: 'b_giraffe', char: '🦒', name: 'キリン', price: 2200 }, { id: 'b_bronto', char: '🦕', name: 'くびながりゅう', price: 2500 },
    { id: 'b_flamingo', char: '🦩', name: 'フラミンゴ', price: 2800 }, { id: 'b_snowman', char: '⛄', name: 'ゆきだるま', price: 3000 },
    { id: 'b_pumpkin', char: '🎃', name: 'パンプキン', price: 3000 }, { id: 'b_peacock', char: '🦚', name: 'クジャク', price: 3500 },
    { id: 'b_teddy', char: '🧸', name: 'テディベア', price: 4000 }, { id: 'b_moai', char: '🗿', name: 'モアイ', price: 5000 },
    { id: 'b_eagle', char: '🦅', name: 'イーグル', price: 6000, lv: 10 }, { id: 'b_pixel', char: '👾', name: 'ピクセルモンスター', price: 9000, lv: 15 },
    { id: 'b_ryuo', char: '🐲', name: 'りゅうおう', price: 15000, lv: 20 },
    { id: 'b_egghatch', char: '🐣', name: 'たまごヒヨコ', price: 300 }, { id: 'b_bird', char: '🐦', name: 'ことり', price: 300 },
    { id: 'b_snail', char: '🐌', name: 'カタツムリ', price: 350 }, { id: 'b_caterpillar', char: '🐛', name: 'いもむし', price: 350 },
    { id: 'b_fish', char: '🐟', name: 'さかな', price: 400 }, { id: 'b_ant', char: '🐜', name: 'アリ', price: 400 },
    { id: 'b_duck', char: '🦆', name: 'アヒル', price: 450 }, { id: 'b_bee', char: '🐝', name: 'ミツバチ', price: 500 },
    { id: 'b_ladybug', char: '🐞', name: 'テントウムシ', price: 500 }, { id: 'b_tropicalfish', char: '🐠', name: 'ねったいぎょ', price: 500 },
    { id: 'b_cricket', char: '🦗', name: 'バッタ', price: 550 }, { id: 'b_shrimp', char: '🦐', name: 'エビ', price: 600 },
    { id: 'b_squid', char: '🦑', name: 'イカ', price: 700 }, { id: 'b_sheep', char: '🐑', name: 'ヒツジ', price: 700 },
    { id: 'b_goat', char: '🐐', name: 'ヤギ', price: 750 }, { id: 'b_lizard', char: '🦎', name: 'トカゲ', price: 800 },
    { id: 'b_lobster', char: '🦞', name: 'ロブスター', price: 900 }, { id: 'b_snake', char: '🐍', name: 'ヘビ', price: 900 },
    { id: 'b_croc', char: '🐊', name: 'ワニ', price: 1000 }, { id: 'b_deer', char: '🦌', name: 'シカ', price: 1000 },
    { id: 'b_zebra', char: '🦓', name: 'シマウマ', price: 1300 }, { id: 'b_kangaroo', char: '🦘', name: 'カンガルー', price: 1500 },
    { id: 'b_llama', char: '🦙', name: 'ラマ', price: 1700 }, { id: 'b_raccoon', char: '🦝', name: 'アライグマ', price: 1900 },
    { id: 'b_badger', char: '🦡', name: 'アナグマ', price: 2000 }, { id: 'b_beaver', char: '🦫', name: 'ビーバー', price: 2100 },
    { id: 'b_hippo', char: '🦛', name: 'カバ', price: 2400 }, { id: 'b_rhino', char: '🦏', name: 'サイ', price: 2600 },
    { id: 'b_camel', char: '🐪', name: 'ラクダ', price: 2800 }, { id: 'b_gorilla', char: '🦍', name: 'ゴリラ', price: 3200 },
    { id: 'b_orangutan', char: '🦧', name: 'オランウータン', price: 3800 }, { id: 'b_leopard', char: '🐆', name: 'ヒョウ', price: 4500 },
    { id: 'b_bison', char: '🦬', name: 'バイソン', price: 5500 }, { id: 'b_dodo', char: '🦤', name: 'ドードー', price: 7000, lv: 10 },
    { id: 'b_swan', char: '🦢', name: 'ハクチョウ', price: 8500, lv: 12 },
    { id: 'b_seal', char: '🦭', name: 'アザラシ', price: 0, gacha: true, rarity: 'N' },
    { id: 'b_turkey', char: '🦃', name: 'シチメンチョウ', price: 0, gacha: true, rarity: 'R' },
    { id: 'b_dove', char: '🕊️', name: 'しろいハト', price: 0, gacha: true, rarity: 'R' },
    { id: 'b_liberty', char: '🗽', name: 'じゆうのめがみ', price: 0, gacha: true, rarity: 'UR' },
    { id: 'b_fugu', char: '🐡', name: 'フグ', price: 0, gacha: true, rarity: 'N' },
    { id: 'b_sloth', char: '🦥', name: 'ナマケモノ', price: 0, gacha: true, rarity: 'R' },
    { id: 'b_otter', char: '🦦', name: 'カワウソ', price: 0, gacha: true, rarity: 'R' },
    { id: 'b_scorpion', char: '🦂', name: 'サソリ', price: 0, gacha: true, rarity: 'SR' },
    { id: 'b_mammoth', char: '🦣', name: 'マンモス', price: 0, gacha: true, rarity: 'UR' },
  ],
  hats: [
    { id: 'h_cap', char: '🧢', name: 'キャップ', price: 150 }, { id: 'h_ribbon', char: '🎀', name: 'リボン', price: 150 },
    { id: 'h_straw', char: '👒', name: 'むぎわら', price: 150 }, { id: 'h_flower', char: '🌸', name: 'はなかざり', price: 150 },
    { id: 'h_leaf', char: '🍃', name: 'はっぱ', price: 150 }, { id: 'h_helmet', char: '🪖', name: 'ヘルメット', price: 200 },
    { id: 'h_mushroom', char: '🍄', name: 'キノコ', price: 250 }, { id: 'h_tophat', char: '🎩', name: 'シルクハット', price: 300 },
    { id: 'h_graduate', char: '🎓', name: 'そつぎょう', price: 350 }, { id: 'h_crown', char: '👑', name: 'おうかん', price: 500 },
    { id: 'h_halo', char: '😇', name: 'てんしのわ', price: 600 },
    { id: 'h_apple', char: '🍎', name: '頭のせリンゴ', price: 100 }, { id: 'h_mikan', char: '🍊', name: '頭のせみかん', price: 100 },
    { id: 'h_sprout', char: '🌱', name: 'ふたば', price: 150 }, { id: 'h_clover', char: '🍀', name: 'クローバー', price: 150 },
    { id: 'h_poop', char: '💩', name: 'うんち', price: 150 }, { id: 'h_star', char: '🌟', name: 'ぴかぴか星', price: 200 },
    { id: 'h_cloud', char: '☁️', name: 'どんより雲', price: 200 }, { id: 'h_umbrella', char: '☂️', name: 'あまがさ', price: 200 },
    { id: 'h_hotspring', char: '♨️', name: 'ほかほか', price: 150 }, { id: 'h_music', char: '🎵', name: 'おんぷ', price: 150 },
    { id: 'h_sleep', char: '💤', name: 'ぐうぐう', price: 150 }, { id: 'h_idea', char: '💡', name: 'ひらめき', price: 200 },
    { id: 'h_anger', char: '💢', name: 'イライラ', price: 150 }, { id: 'h_sweat', char: '💦', name: 'あせあせ', price: 150 },
    { id: 'h_bat', char: '🦇', name: 'コウモリ', price: 250 }, { id: 'h_butterfly', char: '🦋', name: 'チョウチョ', price: 250 },
    { id: 'h_spider', char: '🕷️', name: 'クモ', price: 250 }, { id: 'h_ufo', char: '🛸', name: 'UFO', price: 400 },
    { id: 'h_carrot', char: '🥕', name: 'にんじん', price: 250 }, { id: 'h_strawberry', char: '🍓', name: 'いちご', price: 300 },
    { id: 'h_watermelon', char: '🍉', name: 'スイカ', price: 300 }, { id: 'h_candy', char: '🍭', name: 'キャンディ', price: 400 },
    { id: 'h_sunflower', char: '🌻', name: 'ひまわり', price: 400 }, { id: 'h_donut', char: '🍩', name: 'ドーナツ', price: 500 },
    { id: 'h_balloon', char: '🎈', name: 'ふうせん', price: 500 }, { id: 'h_thunder', char: '⚡', name: 'いなずま', price: 600 },
    { id: 'h_snowflake', char: '❄️', name: 'ゆきのけっしょう', price: 600 }, { id: 'h_bubble', char: '🫧', name: 'しゃぼんだま', price: 700 },
    { id: 'h_rainbow', char: '🌈', name: 'にじ', price: 800 }, { id: 'h_fire', char: '🔥', name: 'ほのお', price: 800 },
    { id: 'h_kite', char: '🪁', name: 'カイト', price: 900 }, { id: 'h_ice', char: '🧊', name: 'こおり', price: 1000 },
    { id: 'h_cake', char: '🎂', name: 'バースデーケーキ', price: 1000 }, { id: 'h_xmas', char: '🎄', name: 'クリスマスツリー', price: 1200 },
    { id: 'h_moon', char: '🌙', name: 'みかづき', price: 1500 }, { id: 'h_sun', char: '☀️', name: 'たいよう', price: 2000 },
    { id: 'h_shooting', char: '💫', name: 'ながれぼし', price: 2500 }, { id: 'h_planet', char: '🪐', name: 'わくせい', price: 3000 },
    { id: 'h_tornado', char: '🌪️', name: 'たつまき', price: 3500 }, { id: 'h_heli', char: '🚁', name: 'ヘリコプター', price: 4000 },
    { id: 'h_tower', char: '🗼', name: 'タワー', price: 5000 }, { id: 'h_castle', char: '🏰', name: 'おしろ', price: 9000, lv: 10 },
    { id: 'h_banana', char: '🍌', name: 'バナナ', price: 300 }, { id: 'h_cherry', char: '🍒', name: 'さくらんぼ', price: 300 },
    { id: 'h_lemon', char: '🍋', name: 'レモン', price: 350 }, { id: 'h_kiwi', char: '🥝', name: 'キウイ', price: 350 },
    { id: 'h_tomato', char: '🍅', name: 'トマト', price: 350 }, { id: 'h_daisy', char: '🌼', name: 'マーガレット', price: 350 },
    { id: 'h_grape', char: '🍇', name: 'ぶどう', price: 400 }, { id: 'h_peach', char: '🍑', name: 'もも', price: 400 },
    { id: 'h_pineapple', char: '🍍', name: 'パイナップル', price: 400 }, { id: 'h_broccoli', char: '🥦', name: 'ブロッコリー', price: 400 },
    { id: 'h_corn', char: '🌽', name: 'とうもろこし', price: 400 }, { id: 'h_tulip', char: '🌷', name: 'チューリップ', price: 400 },
    { id: 'h_fallenleaf', char: '🍂', name: 'おちば', price: 400 }, { id: 'h_bread', char: '🍞', name: 'しょくパン', price: 400 },
    { id: 'h_onigiri', char: '🍙', name: 'おにぎり', price: 450 }, { id: 'h_croissant', char: '🥐', name: 'クロワッサン', price: 450 },
    { id: 'h_rescue', char: '⛑️', name: 'きゅうじょヘルメット', price: 500 }, { id: 'h_cookie', char: '🍪', name: 'クッキー', price: 500 },
    { id: 'h_dango', char: '🍡', name: 'おだんご', price: 500 }, { id: 'h_cupcake', char: '🧁', name: 'カップケーキ', price: 600 },
    { id: 'h_rose', char: '🌹', name: 'バラ', price: 600 }, { id: 'h_rice', char: '🌾', name: 'いなほ', price: 600 },
    { id: 'h_icecream2', char: '🍨', name: 'アイスクリーム', price: 600 }, { id: 'h_partlycloudy', char: '⛅', name: 'くもりぞら', price: 700 },
    { id: 'h_bouquet', char: '💐', name: 'はなたば', price: 800 }, { id: 'h_shortcake', char: '🍰', name: 'ショートケーキ', price: 800 },
    { id: 'h_lantern', char: '🏮', name: 'ちょうちん', price: 800 }, { id: 'h_magnet', char: '🧲', name: 'じしゃく', price: 800 },
    { id: 'h_koinobori', char: '🎏', name: 'こいのぼり', price: 900 }, { id: 'h_windchime', char: '🎐', name: 'ふうりん', price: 900 },
    { id: 'h_kadomatsu', char: '🎍', name: 'かどまつ', price: 1000 }, { id: 'h_tanabata', char: '🎋', name: 'たなばたささ', price: 1000 },
    { id: 'h_pinata', char: '🪅', name: 'ピニャータ', price: 1000 }, { id: 'h_matryoshka', char: '🪆', name: 'マトリョーシカ', price: 1100 },
    { id: 'h_feather', char: '🪶', name: 'はね', price: 1200 }, { id: 'h_lotus', char: '🪷', name: 'ハスのはな', price: 1500 },
    { id: 'h_coaster', char: '🎢', name: 'ジェットコースター', price: 6000, lv: 10 },
    { id: 'h_cactus', char: '🌵', name: 'サボテン', price: 0, gacha: true, rarity: 'N' },
    { id: 'h_avocado', char: '🥑', name: 'アボカド', price: 0, gacha: true, rarity: 'N' },
    { id: 'h_cheese', char: '🧀', name: 'チーズ', price: 0, gacha: true, rarity: 'R' },
    { id: 'h_taco', char: '🌮', name: 'タコス', price: 0, gacha: true, rarity: 'R' },
    { id: 'h_ramen', char: '🍜', name: 'ラーメン', price: 0, gacha: true, rarity: 'SR' },
    { id: 'h_sushi', char: '🍣', name: 'おすし', price: 0, gacha: true, rarity: 'SR' },
    { id: 'h_burger', char: '🍔', name: 'ハンバーガー', price: 0, gacha: true, rarity: 'R' },
    { id: 'h_pizza', char: '🍕', name: 'ピザ', price: 0, gacha: true, rarity: 'R' },
    { id: 'h_hanabi', char: '🎇', name: 'せんこうはなび', price: 0, gacha: true, rarity: 'R' },
    { id: 'h_circus', char: '🎪', name: 'サーカステント', price: 0, gacha: true, rarity: 'SR' },
  ],
  faces: [
    { id: 'f_mask', char: '😷', name: 'マスク', price: 150 },
    { id: 'f_glass', char: '🕶️', name: 'サングラス', price: 200 }, { id: 'f_nerd', char: '🥸', name: 'めがね', price: 200 },
    { id: 'f_monocle', char: '🧐', name: 'モノクル', price: 250 },
    { id: 'f_star', char: '🤩', name: 'スター', price: 300 },
    { id: 'f_goggles', char: '🥽', name: 'ゴーグル', price: 200 }, { id: 'f_mask_theater', char: '🎭', name: 'かめん', price: 300 },
    { id: 'f_bandage', char: '🩹', name: 'ばんそうこう', price: 100 }, { id: 'f_tongue', char: '👅', name: 'あっかんべー', price: 150 },
    { id: 'f_lip', char: '💋', name: 'くちびる', price: 150 }, { id: 'f_cyber', char: '👁️‍🗨️', name: 'サイバーアイ', price: 300 },
    { id: 'f_sparkle', char: '✨', name: 'きらきら', price: 200 }, { id: 'f_tear', char: '💧', name: 'なみだ', price: 150 },
    { id: 'f_dizzy', char: '🌀', name: 'ぐるぐる', price: 200 }, { id: 'f_flower', char: '💮', name: 'はなまる', price: 200 },
    { id: 'f_diving', char: '🤿', name: 'ダイバー', price: 300 }, { id: 'f_eye', char: '👁️', name: 'ギョロめ', price: 200 },
    { id: 'f_nose', char: '👃', name: 'おはな', price: 300 }, { id: 'f_sleep', char: '😴', name: 'おやすみ', price: 400 },
    { id: 'f_tooth', char: '🦷', name: 'まっしろな歯', price: 400 }, { id: 'f_rednose', char: '🔴', name: 'あかっぱな', price: 500 },
    { id: 'f_sick', char: '🤢', name: 'うぇっぷ', price: 500 }, { id: 'f_scream', char: '😱', name: 'びっくり', price: 600 },
    { id: 'f_party', char: '🥳', name: 'パーティー', price: 800 }, { id: 'f_cold', char: '🥶', name: 'こおりがお', price: 1000 },
    { id: 'f_hot', char: '🥵', name: 'あつあつがお', price: 1000 }, { id: 'f_imp', char: '😈', name: 'こあくま', price: 1200 },
    { id: 'f_clown', char: '🤡', name: 'ピエロ', price: 1500 }, { id: 'f_oni', char: '👹', name: 'おに', price: 2000 },
    { id: 'f_tengu', char: '👺', name: 'てんぐ', price: 2000 }, { id: 'f_skull', char: '💀', name: 'ガイコツ', price: 2500 },
    { id: 'f_eyeamulet', char: '🧿', name: 'おまもりアイ', price: 3500 },
    { id: 'f_specs', char: '👓', name: 'まるめがね', price: 300 }, { id: 'f_pignose', char: '🐽', name: 'ぶたばな', price: 400 },
    { id: 'f_sneeze', char: '🤧', name: 'ハクション', price: 400 }, { id: 'f_happytear', char: '🥲', name: 'うれしなみだ', price: 500 },
    { id: 'f_fever', char: '🤒', name: 'おねつ', price: 500 }, { id: 'f_bump', char: '🤕', name: 'たんこぶ', price: 500 },
    { id: 'f_hmpf', char: '😤', name: 'ふんす', price: 500 }, { id: 'f_lol', char: '😂', name: 'わらいすぎ', price: 600 },
    { id: 'f_knockout', char: '😵', name: 'まいった', price: 600 }, { id: 'f_woozy', char: '🥴', name: 'ふらふら', price: 600 },
    { id: 'f_catface', char: '😺', name: 'ねこがお', price: 800 }, { id: 'f_melt', char: '🫠', name: 'とろけがお', price: 800 },
    { id: 'f_rich', char: '🤑', name: 'おかねもちがお', price: 1000 }, { id: 'f_cowboy', char: '🤠', name: 'カウボーイハット', price: 1200 },
    { id: 'f_ninja', char: '🥷', name: 'ニンジャマスク', price: 1500 }, { id: 'f_peek', char: '🫣', name: 'ちらみ', price: 1500 },
    { id: 'f_mindblown', char: '🤯', name: 'びっくりばくはつ', price: 2000 }, { id: 'f_eyes', char: '👀', name: 'りょうめ', price: 4000 },
    { id: 'f_dizzy2', char: '😵‍💫', name: 'めがまわる', price: 0, gacha: true, rarity: 'R' },
    { id: 'f_pleading', char: '🥹', name: 'うるうる', price: 0, gacha: true, rarity: 'R' },
    { id: 'f_joycat', char: '😹', name: 'なきわらいねこ', price: 0, gacha: true, rarity: 'R' },
    { id: 'f_grincat', char: '😸', name: 'にっこりねこ', price: 0, gacha: true, rarity: 'SR' },
    { id: 'f_lovecat', char: '😻', name: 'メロメロねこ', price: 0, gacha: true, rarity: 'SR' },
    { id: 'f_pinocchio', char: '🤥', name: 'ピノキオ', price: 0, gacha: true, rarity: 'R' },
    { id: 'f_invisible', char: '🫥', name: 'とうめいにんげん', price: 0, gacha: true, rarity: 'SR' },
  ],
  props: [
    { id: 'p_apple', char: '🍎', name: 'リンゴ', price: 100 }, { id: 'p_pencil', char: '✏️', name: 'えんぴつ', price: 100 },
    { id: 'p_book', char: '📖', name: 'ほん', price: 150 }, { id: 'p_ball', char: '⚽', name: 'ボール', price: 150 },
    { id: 'p_palette', char: '🎨', name: 'パレット', price: 250 }, { id: 'p_bag', char: '🎒', name: 'ランドセル', price: 250 },
    { id: 'p_wand', char: '🪄', name: 'ステッキ', price: 300 }, { id: 'p_mic', char: '🎤', name: 'マイク', price: 350 },
    { id: 'p_sword', char: '🗡️', name: 'けん', price: 400 }, { id: 'p_game', char: '🎮', name: 'ゲーム', price: 400 },
    { id: 'p_guitar', char: '🎸', name: 'ギター', price: 500 }, { id: 'p_pc', char: '💻', name: 'パソコン', price: 500 },
    { id: 'p_gem', char: '💎', name: 'ほうせき', price: 500 }, { id: 'p_rocket', char: '🚀', name: 'ロケット', price: 800 },
    { id: 'p_medal', char: '🏅', name: 'メダル', price: 800 }, { id: 'p_trophy', char: '🏆', name: 'トロフィー', price: 1000 },
    { id: 'p_basketball', char: '🏀', name: 'バスケットボール', price: 300 }, { id: 'p_baseball', char: '⚾', name: 'やきゅうボール', price: 300 },
    { id: 'p_tennis', char: '🎾', name: 'テニスボール', price: 350 }, { id: 'p_pingpong', char: '🏓', name: 'ピンポン', price: 350 },
    { id: 'p_yoyo', char: '🪀', name: 'ヨーヨー', price: 400 }, { id: 'p_puzzle', char: '🧩', name: 'パズル', price: 500 },
    { id: 'p_dart', char: '🎯', name: 'ダーツ', price: 600 }, { id: 'p_taiko', char: '🥁', name: 'たいこ', price: 700 },
    { id: 'p_fishing', char: '🎣', name: 'つりざお', price: 700 }, { id: 'p_skateboard', char: '🛹', name: 'スケボー', price: 800 },
    { id: 'p_trumpet', char: '🎺', name: 'トランペット', price: 800 }, { id: 'p_flask', char: '🧪', name: 'じっけんフラスコ', price: 900 },
    { id: 'p_bicycle', char: '🚲', name: 'じてんしゃ', price: 1000 }, { id: 'p_telescope', char: '🔭', name: 'ぼうえんきょう', price: 1200 },
    { id: 'p_microscope', char: '🔬', name: 'けんびきょう', price: 1200 }, { id: 'p_shield', char: '🛡️', name: 'たて', price: 1500 },
    { id: 'p_bow', char: '🏹', name: 'ゆみや', price: 1500 }, { id: 'p_compass', char: '🧭', name: 'ぼうけんコンパス', price: 1600 },
    { id: 'p_violin', char: '🎻', name: 'バイオリン', price: 1800 }, { id: 'p_map', char: '🗺️', name: 'ぼうけんのちず', price: 2000 },
    { id: 'p_goldcoin', char: '🪙', name: 'きんか', price: 3000 }, { id: 'p_moneybag', char: '💰', name: 'かねぶくろ', price: 5000 },
    { id: 'p_crystal', char: '🔮', name: 'すいしょうだま', price: 9000, lv: 10 },
    { id: 'p_crayon', char: '🖍️', name: 'クレヨン', price: 300 }, { id: 'p_volleyball', char: '🏐', name: 'バレーボール', price: 350 },
    { id: 'p_brush', char: '🖌️', name: 'ふで', price: 350 }, { id: 'p_football', char: '🏈', name: 'アメフトボール', price: 400 },
    { id: 'p_badminton', char: '🏸', name: 'バドミントン', price: 400 }, { id: 'p_ruler', char: '📐', name: 'さんかくじょうぎ', price: 400 },
    { id: 'p_frisbee', char: '🥏', name: 'フリスビー', price: 450 }, { id: 'p_bowling', char: '🎳', name: 'ボウリング', price: 500 },
    { id: 'p_golf', char: '⛳', name: 'ゴルフ', price: 600 }, { id: 'p_boxing', char: '🥊', name: 'ボクシンググローブ', price: 600 },
    { id: 'p_dogi', char: '🥋', name: 'どうぎ', price: 600 }, { id: 'p_clock', char: '⏰', name: 'めざましどけい', price: 600 },
    { id: 'p_watch', char: '⌚', name: 'うでどけい', price: 700 }, { id: 'p_sled', char: '🛷', name: 'そり', price: 700 },
    { id: 'p_boomerang', char: '🪃', name: 'ブーメラン', price: 800 }, { id: 'p_curling', char: '🥌', name: 'カーリングストーン', price: 800 },
    { id: 'p_phone', char: '📱', name: 'スマホ', price: 800 }, { id: 'p_skate', char: '⛸️', name: 'スケートぐつ', price: 800 },
    { id: 'p_ski', char: '🎿', name: 'スキー', price: 900 }, { id: 'p_conga', char: '🪘', name: 'コンガ', price: 900 },
    { id: 'p_headphone', char: '🎧', name: 'ヘッドホン', price: 900 }, { id: 'p_camera', char: '📷', name: 'カメラ', price: 1000 },
    { id: 'p_abacus', char: '🧮', name: 'そろばん', price: 1000 }, { id: 'p_parachute', char: '🪂', name: 'パラシュート', price: 1200 },
    { id: 'p_accordion', char: '🪗', name: 'アコーディオン', price: 1300 }, { id: 'p_sax', char: '🎷', name: 'サックス', price: 1400 },
    { id: 'p_piano', char: '🎹', name: 'ピアノ', price: 1500 }, { id: 'p_gear', char: '⚙️', name: 'はぐるま', price: 1600 },
    { id: 'p_mirror', char: '🪞', name: 'かがみ', price: 1800 }, { id: 'p_key', char: '🗝️', name: 'まほうのカギ', price: 2000 },
    { id: 'p_canoe', char: '🛶', name: 'カヌー', price: 2000 }, { id: 'p_scale', char: '⚖️', name: 'てんびん', price: 2200 },
    { id: 'p_alembic', char: '⚗️', name: 'れんきんどうぐ', price: 2500 }, { id: 'p_antenna', char: '📡', name: 'パラボラアンテナ', price: 3000 },
    { id: 'p_dna', char: '🧬', name: 'DNAもけい', price: 4000 }, { id: 'p_satellite', char: '🛰️', name: 'じんこうえいせい', price: 5000 },
    { id: 'p_dualswords', char: '⚔️', name: 'にとうりゅう', price: 7000, lv: 10 }, { id: 'p_trident', char: '🔱', name: 'トライデント', price: 12000, lv: 15 },
    { id: 'p_icecream', char: '🍦', name: 'ソフトクリーム', price: 0, gacha: true, rarity: 'N' },
    { id: 'p_popcorn', char: '🍿', name: 'ポップコーン', price: 0, gacha: true, rarity: 'N' },
    { id: 'p_juice', char: '🧃', name: 'ジュース', price: 0, gacha: true, rarity: 'N' },
    { id: 'p_dice', char: '🎲', name: 'サイコロ', price: 0, gacha: true, rarity: 'R' },
    { id: 'p_joker', char: '🃏', name: 'ジョーカー', price: 0, gacha: true, rarity: 'R' },
    { id: 'p_vase', char: '🏺', name: 'こだいのつぼ', price: 0, gacha: true, rarity: 'SR' },
    { id: 'p_ring', char: '💍', name: 'ダイヤのゆびわ', price: 0, gacha: true, rarity: 'UR' },
    { id: 'p_choco', char: '🍫', name: 'チョコレート', price: 0, gacha: true, rarity: 'N' },
    { id: 'p_present', char: '🎁', name: 'プレゼント', price: 0, gacha: true, rarity: 'R' },
    { id: 'p_train', char: '🚂', name: 'きかんしゃ', price: 0, gacha: true, rarity: 'R' },
    { id: 'p_mirrorball', char: '🪩', name: 'ミラーボール', price: 0, gacha: true, rarity: 'SR' },
  ],
  backgrounds: [
    { id: 'bg_rainbow', char: '🌈', name: 'にじぞら', price: 500 }, { id: 'bg_sakura', char: '🌸', name: 'さくらばたけ', price: 500 },
    { id: 'bg_forest', char: '🌳', name: 'もり', price: 500 }, { id: 'bg_wave', char: '🌊', name: 'なみ', price: 600 },
    { id: 'bg_momiji', char: '🍁', name: 'もみじ', price: 800 }, { id: 'bg_beach', char: '🏖️', name: 'ビーチ', price: 800 },
    { id: 'bg_mountain', char: '🏔️', name: 'ゆきやま', price: 800 }, { id: 'bg_sunrise', char: '🌅', name: 'あさひ', price: 1000 },
    { id: 'bg_volcano', char: '🌋', name: 'かざん', price: 1000 }, { id: 'bg_night', char: '🌃', name: 'よるのまち', price: 1200 },
    { id: 'bg_shrine', char: '⛩️', name: 'じんじゃ', price: 1500 }, { id: 'bg_park', char: '🎡', name: 'ゆうえんち', price: 1500 },
    { id: 'bg_castle', char: '🏯', name: 'おしろのまち', price: 2000 }, { id: 'bg_star', char: '🌠', name: 'ながれぼしぞら', price: 2000 },
    { id: 'bg_stadium', char: '🏟️', name: 'スタジアム', price: 2500 }, { id: 'bg_galaxy', char: '🌌', name: 'ぎんが', price: 2500 },
    { id: 'bg_island', char: '🏝️', name: 'みなみのしま', price: 3500 }, { id: 'bg_fireworks', char: '🎆', name: 'はなびたいかい', price: 4000 },
    { id: 'bg_fuji', char: '🗻', name: 'ふじさん', price: 5000 }, { id: 'bg_earth', char: '🌍', name: 'ちきゅう', price: 9000, lv: 10 },
    { id: 'bg_town', char: '🏘️', name: 'まちなみ', price: 800 }, { id: 'bg_desert', char: '🏜️', name: 'さばく', price: 1000 },
    { id: 'bg_railway', char: '🛤️', name: 'せんろ', price: 1000 }, { id: 'bg_camp', char: '🏕️', name: 'キャンプじょう', price: 1200 },
    { id: 'bg_naturepark', char: '🏞️', name: 'けいこく', price: 1200 }, { id: 'bg_moonviewing', char: '🎑', name: 'おつきみ', price: 1500 },
    { id: 'bg_bridge', char: '🌉', name: 'よるのおおはし', price: 1500 }, { id: 'bg_city', char: '🏙️', name: 'だいとかい', price: 1800 },
    { id: 'bg_ship', char: '🚢', name: 'おおきなふね', price: 2000 }, { id: 'bg_japan', char: '🗾', name: 'にほんちず', price: 2000 },
    { id: 'bg_palace', char: '🏛️', name: 'しんでん', price: 2500 }, { id: 'bg_airplane', char: '✈️', name: 'そらのたび', price: 2500 },
    { id: 'bg_slide', char: '🛝', name: 'こうえん', price: 0, gacha: true, rarity: 'N' },
    { id: 'bg_fountain', char: '⛲', name: 'ふんすい', price: 0, gacha: true, rarity: 'R' },
    { id: 'bg_carousel', char: '🎠', name: 'メリーゴーランド', price: 0, gacha: true, rarity: 'SR' },
    { id: 'bg_school', char: '🏫', name: 'がっこう', price: 0, gacha: true, rarity: 'R' },
    { id: 'bg_sunsetcity', char: '🌇', name: 'ゆうやけまち', price: 0, gacha: true, rarity: 'R' },
    { id: 'bg_fullmoon', char: '🌕', name: 'まんげつ', price: 0, gacha: true, rarity: 'SR' },
  ],
  effects: [
    { id: 'e_sparkle', char: '✨', name: 'きらきらオーラ', price: 1000 }, { id: 'e_note', char: '🎵', name: 'おんぷオーラ', price: 1200 },
    { id: 'e_heart', char: '💖', name: 'ハートオーラ', price: 1500 }, { id: 'e_star', char: '⭐', name: 'スターオーラ', price: 1800 },
    { id: 'e_petal', char: '🌸', name: 'はなふぶき', price: 2000 }, { id: 'e_thunder', char: '⚡', name: 'でんげきオーラ', price: 2500 },
    { id: 'e_fire', char: '🔥', name: 'ほのおオーラ', price: 2500 }, { id: 'e_snow', char: '❄️', name: 'ふぶきオーラ', price: 2500 },
    { id: 'e_clover', char: '🍀', name: 'しあわせオーラ', price: 3000 }, { id: 'e_gem', char: '💎', name: 'ダイヤオーラ', price: 5000 },
    { id: 'e_rainbow', char: '🌈', name: 'にじいろオーラ', price: 9000, lv: 10 }, { id: 'e_crown', char: '👑', name: 'おうじゃのオーラ', price: 15000, lv: 15 },
    { id: 'e_leaf', char: '🍂', name: 'おちばオーラ', price: 1500 }, { id: 'e_hibiscus', char: '🌺', name: 'ハイビスカスオーラ', price: 1600 },
    { id: 'e_notes', char: '🎶', name: 'メロディオーラ', price: 1800 }, { id: 'e_cracker', char: '🎉', name: 'クラッカーオーラ', price: 2000 },
    { id: 'e_boom', char: '💥', name: 'ばくはつオーラ', price: 2000 }, { id: 'e_goldstar', char: '🌟', name: 'ゴールドスターオーラ', price: 2200 },
    { id: 'e_confetti', char: '🎊', name: 'コンフェッティオーラ', price: 2500 }, { id: 'e_diamondshape', char: '💠', name: 'ダイヤかざりオーラ', price: 2800 },
    { id: 'e_burningheart', char: '❤️‍🔥', name: 'もえるハートオーラ', price: 3500 }, { id: 'e_fleur', char: '⚜️', name: 'おうけのもんしょう', price: 9000, lv: 12 },
    { id: 'e_bubble', char: '🫧', name: 'バブルオーラ', price: 0, gacha: true, rarity: 'R' },
    { id: 'e_paw', char: '🐾', name: 'あしあとオーラ', price: 0, gacha: true, rarity: 'R' },
    { id: 'e_score', char: '🎼', name: 'がくふオーラ', price: 0, gacha: true, rarity: 'R' },
    { id: 'e_unicorn', char: '🦄', name: 'ユニコーンオーラ', price: 0, gacha: true, rarity: 'SR' },
    { id: 'e_poop', char: '💩', name: 'うんちオーラ', price: 0, gacha: true, rarity: 'R' },
    { id: 'e_butterfly', char: '🦋', name: 'バタフライオーラ', price: 0, gacha: true, rarity: 'SR' },
    { id: 'e_comet', char: '☄️', name: 'すいせいオーラ', price: 0, gacha: true, rarity: 'UR' },
  ],
  titles: [
    { id: 't_beginner', char: '🌱', name: 'けいさんビギナー', price: 300 }, { id: 't_drill', char: '✏️', name: 'ドリルずき', price: 500 },
    { id: 't_game', char: '🎮', name: 'ゲームずき', price: 800 }, { id: 't_study', char: '📚', name: 'べんきょうか', price: 800 },
    { id: 't_lucky', char: '🍀', name: 'ラッキーさん', price: 1000 }, { id: 't_cool', char: '😎', name: 'クールキャラ', price: 1200 },
    { id: 't_speed', char: '⚡', name: 'スピードスター', price: 1500 }, { id: 't_streak', char: '🔥', name: 'まいにちがんばりや', price: 2000 },
    { id: 't_perfect', char: '🎯', name: 'ノーミスめいじん', price: 2500 }, { id: 't_brain', char: '🧠', name: 'ひらめきはかせ', price: 3000 },
    { id: 't_rocket', char: '🚀', name: 'ロケットずのう', price: 4000 }, { id: 't_hero', char: '🦸', name: 'けいさんヒーロー', price: 5000 },
    { id: 't_king', char: '👑', name: 'けいさんおう', price: 8000, lv: 10 }, { id: 't_champion', char: '🏆', name: 'チャンピオン', price: 10000, lv: 15 },
    { id: 't_legend', char: '🐉', name: 'でんせつのけいさんし', price: 15000, lv: 20 }, { id: 't_diamond', char: '💎', name: 'ダイヤモンドブレイン', price: 20000, lv: 25 },
    { id: 't_galaxy', char: '🌌', name: 'ぎんがのちえもの', price: 30000, lv: 30 },
    { id: 't_steady', char: '🐢', name: 'コツコツがんばりや', price: 600 }, { id: 't_challenger', char: '🎲', name: 'チャレンジャー', price: 700 },
    { id: 't_bronze', char: '🥉', name: 'ブロンズせんしゅ', price: 800 }, { id: 't_addition', char: '➕', name: 'たしざんめいじん', price: 1200 },
    { id: 't_subtraction', char: '➖', name: 'ひきざんめいじん', price: 1200 }, { id: 't_owl', char: '🦉', name: 'ちえのフクロウ', price: 1500 },
    { id: 't_detective', char: '🔍', name: 'なぞときめいたんてい', price: 1800 }, { id: 't_silver', char: '🥈', name: 'シルバーせんしゅ', price: 2000 },
    { id: 't_multiplication', char: '✖️', name: 'かけざんめいじん', price: 2800 }, { id: 't_division', char: '➗', name: 'わりざんめいじん', price: 2800 },
    { id: 't_numbers', char: '🔢', name: 'すうじマスター', price: 3500 }, { id: 't_magician', char: '🪄', name: 'けいさんマジシャン', price: 4000 },
    { id: 't_gold', char: '🥇', name: 'ゴールドせんしゅ', price: 4500 }, { id: 't_hundred', char: '💯', name: 'ひゃくてんまんてん', price: 6000 },
    { id: 't_miracle', char: '🌠', name: 'ミラクルスター', price: 8000, lv: 10 }, { id: 't_legendplayer', char: '🏵️', name: 'でんせつせんしゅ', price: 9000, lv: 12 },
    { id: 't_scholar', char: '🎓', name: 'スーパーはかせ', price: 12000, lv: 15 }, { id: 't_infinity', char: '♾️', name: 'むげんのちから', price: 25000, lv: 28 },
    { id: 't_spaceno1', char: '🛸', name: 'うちゅういちのけいさんし', price: 40000, lv: 35 },
  ],
  themes: [
    // c: ショップの色見本 [背景, メイン, サブ]。GlobalStyle の CSS 変数と揃えること
    { id: 'default', name: 'いつもの色 (あたたかい)', price: 0, c: ['#fffbf0', '#FF6B6B', '#4ECDC4'] }, { id: 'dark', name: 'ダークモード (よる)', price: 1000, c: ['#0f172a', '#f43f5e', '#0ea5e9'] },
    { id: 'sakura', name: 'さくら (ピンク)', price: 1000, c: ['#fdf2f8', '#d946ef', '#f472b6'] }, { id: 'ocean', name: 'うみ (ブルー)', price: 1000, c: ['#f0f9ff', '#0284c7', '#38bdf8'] },
    { id: 'mint', name: 'ミント (さわやか)', price: 1000, c: ['#f0fdfa', '#14b8a6', '#2dd4bf'] }, { id: 'sunset', name: 'ゆうやけ (オレンジ)', price: 1000, c: ['#fff7ed', '#ea580c', '#f97316'] },
    { id: 'forest', name: 'もり (グリーン)', price: 1000, c: ['#f0fdf4', '#16a34a', '#f59e0b'] }, { id: 'choco', name: 'チョコ (ブラウン)', price: 1000, c: ['#fdf8f5', '#92400e', '#d97706'] },
    { id: 'space', name: 'うちゅう (パープル)', price: 1500, c: ['#17153B', '#c084fc', '#2dd4bf'] }, { id: 'retro', name: 'レトロ (セピア)', price: 1500, c: ['#f5eedc', '#c25953', '#6a7f72'] },
    { id: 'gold', name: 'おうごん (ゴールド)', price: 2000, c: ['#fefce8', '#b45309', '#eab308'] }, { id: 'cyber', name: 'サイバー (ネオン)', price: 2000, c: ['#000000', '#39ff14', '#ff00ff'] },
    { id: 'monochrome', name: 'モノクロ (しろくろ)', price: 2000, c: ['#f8f9fa', '#000000', '#666666'] },
    { id: 'lavender', name: 'ラベンダー (むらさき)', price: 3000, c: ['#f5f3ff', '#7c3aed', '#a78bfa'] }, { id: 'candy', name: 'キャンディ (あまい)', price: 3000, c: ['#fff0f6', '#ec4899', '#60a5fa'] },
    { id: 'soda', name: 'ソーダ (しゅわしゅわ)', price: 3000, c: ['#eff6ff', '#2563eb', '#22d3ee'] }, { id: 'matcha', name: 'まっちゃ (わふう)', price: 3000, c: ['#f7fee7', '#4d7c0f', '#84cc16'] },
    { id: 'ruby', name: 'ルビー (じょうねつ)', price: 5000, c: ['#fff1f2', '#be123c', '#fb7185'] }, { id: 'hero', name: 'ヒーロー (せいぎ)', price: 5000, c: ['#f8fafc', '#dc2626', '#2563eb'] },
    { id: 'aurora', name: 'オーロラ (ひかり)', price: 8000, c: ['#042f2e', '#34d399', '#818cf8'] }, { id: 'hanabi', name: 'はなび (よまつり)', price: 8000, c: ['#1e1b4b', '#f472b6', '#facc15'] },
    { id: 'midnight', name: 'まよなか (しんかい)', price: 10000, c: ['#020617', '#38bdf8', '#818cf8'] }, { id: 'ninja', name: 'ニンジャ (すみいろ)', price: 12000, c: ['#18181b', '#ef4444', '#a1a1aa'] },
    { id: 'royal', name: 'ロイヤル (おうぞく)', price: 15000, c: ['#faf5ff', '#7e22ce', '#eab308'] }, { id: 'rainbow', name: 'にじいろ (でんせつ)', price: 20000, lv: 15, c: ['#fdf4ff', '#e11d48', '#0ea5e9'] },
    { id: 'sunflower', name: 'ひまわり (げんき)', price: 4000, c: ['#fefce8', '#ca8a04', '#22c55e'] }, { id: 'watermelon', name: 'スイカ (なつやすみ)', price: 4000, c: ['#f0fdf4', '#ef4444', '#22c55e'] },
    { id: 'milktea', name: 'ミルクティー (ほっこり)', price: 4000, c: ['#f5f0e8', '#a16207', '#78716c'] }, { id: 'tropical', name: 'トロピカル (じょうねつ)', price: 6000, c: ['#ecfeff', '#f59e0b', '#06b6d4'] },
    { id: 'halloween', name: 'ハロウィン (おばけのよる)', price: 6000, c: ['#1c1917', '#f97316', '#a855f7'] }, { id: 'christmas', name: 'クリスマス (せいなるよる)', price: 6000, c: ['#fef2f2', '#dc2626', '#16a34a'] },
    { id: 'prism', name: 'プリズム (きせき)', price: 25000, lv: 20, c: ['#f5fffa', '#8b5cf6', '#ec4899'] },
  ]
};

// ---- レアリティ & ガチャ ----
const RARITY_INFO = {
  N: { label: 'N', color: '#9ca3af' },
  R: { label: 'R', color: '#3b82f6' },
  SR: { label: 'SR', color: '#a855f7' },
  UR: { label: 'UR', color: '#f59e0b' },
};
// 明示指定(ガチャ限定品)がなければ価格から自動判定
const getRarity = (item) => item.rarity || (item.price >= 8000 ? 'UR' : item.price >= 3000 ? 'SR' : item.price >= 1000 ? 'R' : 'N');

const GACHA_COST = 500;
// ダブり時の返却コイン(レアリティ別)
const GACHA_DUP_REFUND = { N: 100, R: 200, SR: 400, UR: 1000 };
// 抽選の重み(レアなほど出にくい)
const GACHA_WEIGHT = { N: 50, R: 30, SR: 15, UR: 5 };

const getGachaPool = () => Object.entries(SHOP_ITEMS).flatMap(([category, items]) =>
  items.filter(i => i.gacha).map(item => ({ category, item }))
);
const rollGacha = () => {
  const pool = getGachaPool();
  const weights = pool.map(e => GACHA_WEIGHT[getRarity(e.item)]);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
};

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

const getRandomMissions = (count = 3, streak = 0) => {
  let pool = [...MISSION_POOL];
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

    selected.push({ ...pool[selectedIdx], current: 0, claimed: false });
    pool.splice(selectedIdx, 1);
  }

  return selected;
};

const normalizeStr = (str) => {
  return String(str).replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/\s+/g, '');
};

// DEFAULT_PROBLEMS のパース結果は不変なので一度だけ計算して使い回す
let parsedDefaultProblemsCache = null;
const getParsedDefaultProblems = () => {
  if (!parsedDefaultProblemsCache) {
    parsedDefaultProblemsCache = {};
    for (const [key, list] of Object.entries(DEFAULT_PROBLEMS)) {
      parsedDefaultProblemsCache[key] = list.map(str => { const parts = str.split('|'); return { q: parts[0], a: parts.slice(1).join('|') }; });
    }
  }
  return parsedDefaultProblemsCache;
};

// 既定コースの表示順（学年内は学習する順序）。ここにない自作コースは各学年の末尾に五十音順で並ぶ
const COURSE_DISPLAY_ORDER = [
  '1年_ことば（いくつといくつ）', '1年_あわせて10', '1年_たしざん（10まで）', '1年_ひきざん（10まで）',
  '1年_10といくつ', '1年_3つのかず', '1年_くりあがり', '1年_ひきざん（くりさがり）',
  '1年_おおきいかずのけいさん', '1年_なん十のけいさん（100まで）', '1年_とけいクイズ',
  '1年_ことば（あわせて・のこりは）', '1年_ことば（ちがい）', '1年_ことば（3つのかず）',
  '1年_ことば（じゅんじょ）', '1年_ことば（かずのならび）', '1年_ことば（おおきい・ちいさい）',
  '1年_ことば（おおきさくらべ）', '1年_ことば（かたちづくり）',
  '2年_なん十の計算', '2年_2けたのたし算', '2年_2けたのひき算', '2年_3けた・4けたの計算',
  '2年_数のしくみ（1000まで）',
  '2年_一の段の九九', '2年_二の段の九九', '2年_三の段の九九', '2年_四の段の九九', '2年_五の段の九九',
  '2年_六の段の九九', '2年_七の段の九九', '2年_八の段の九九', '2年_九の段の九九',
  '2年_九九', '2年_九九あなうめ', '2年_ことば（かけ算）', '2年_ことば（かけ算のきまり）', '2年_分数', '2年_ことば（たんい）',
  '2年_時こくと時間',
  '2年_ことば（ながさのけいさん）', '2年_ことば（かさのけいさん）', '2年_ことば（おおきい・ちいさい）', '2年_ことば（かたち）',
  '3年_わり算', '3年_あまりは？', '3年_大きいわり算', '3年_何十のかけ算',
  '3年_かけ算（2けた×1けた）', '3年_かけ算（3けた×1けた）', '3年_かけ算（2けた×2けた）', '3年_かけ算（3けた×2けた）',
  '3年_暗算（2けたのたし算）', '3年_暗算（2けたのひき算）', '3年_3けたのたし算・ひき算',
  '3年_大きい数の計算', '3年_小数たし算', '3年_小数ひき算', '3年_分数たし算', '3年_分数ひき算', '3年_小数と分数',
  '3年_□を使った式',
  '3年_時間（秒と分）', '3年_ことば（わり算）', '3年_ことば（あまりのあるわり算）', '3年_ことば（円と球）', '3年_ことば（長さと重さのたんい）',
  '4年_大きな数（億・兆）', '4年_わり算（1けたでわる）', '4年_わり算（2けたでわる）', '4年_計算のきまり',
  '4年_がい数（四捨五入）', '4年_がい数の見つもり', '4年_小数×整数', '4年_小数÷整数', '4年_小数のたし算・ひき算', '4年_ことば（小数のしくみ）',
  '4年_分数たし算（1より大きい）', '4年_分数ひき算（1より大きい）', '4年_仮分数と帯分数',
  '4年_ことば（角の大きさ）', '4年_ことば（垂直・平行と四角形）', '4年_ことば（面積のたんい）', '4年_ことば（面積のけいさん）',
  '4年_ことば（変わり方）',
  '5年_小数と10・100の計算', '5年_小数のかけわり', '5年_3.14のけいさん', '5年_倍数と約数', '5年_公倍数・公約数',
  '5年_約分', '5年_通分', '5年_分数たしひき', '5年_分数と小数',
  '5年_割合パッ！（小数→％）', '5年_ことば（百分率）', '5年_割合（くらべる量・もとにする量）', '5年_ことば（歩合）',
  '5年_単位量あたりの大きさ', '5年_ことば（平均）',
  '5年_ことば（図形の角）', '5年_ことば（正多角形と円）', '5年_ことば（図形の面積）', '5年_ことば（台形・ひし形の面積）', '5年_ことば（体積のけいさん）',
  '6年_文字と式', '6年_分数かけわり', '6年_分数と小数のまじった計算', '6年_円の計算',
  '6年_比のけいさん', '6年_比を簡単にする', '6年_速さ・時間・道のり',
  '6年_場合の数', '6年_ことば（対称な図形）', '6年_ことば（拡大図と縮図）', '6年_ことば（立体の体積）',
  '6年_ことば（比例・反比例のけいさん）', '6年_ことば（データの代表値）',
  'チャレンジ_四則混合'
];
const COURSE_ORDER_INDEX = new Map(COURSE_DISPLAY_ORDER.map((n, i) => [n, i]));

const courseCompare = (a, b) => {
  const ga = a.match(/^([1-6])年/); const gb = b.match(/^([1-6])年/);
  const gradeA = ga ? Number(ga[1]) : 7; const gradeB = gb ? Number(gb[1]) : 7;
  if (gradeA !== gradeB) return gradeA - gradeB;
  const ia = COURSE_ORDER_INDEX.has(a) ? COURSE_ORDER_INDEX.get(a) : Infinity;
  const ib = COURSE_ORDER_INDEX.has(b) ? COURSE_ORDER_INDEX.get(b) : Infinity;
  if (ia !== ib) return ia - ib;
  return a.localeCompare(b, 'ja');
};

// 既定コースの名前・内容を更新したときにインクリメントする。
// 保存済みバージョンが古い場合、旧名称のコースを取り除き既定コースを最新内容で入れ直す
const DEFAULTS_VERSION = 2;
const LEGACY_DEFAULT_KEYS = [
  '4年_がい数(四捨五入)', '4年_小数x整数', '5年_割合パッ！(%)', '6年_速さ・時間・道',
  '1年_ひきざん', '1年_10と いくつ', '1年_おおきいかずの けいさん', '1年_なん十の けいさん（100まで）',
  '1年_ことば（かずの ならび）', '2年_ことば（ながさの けいさん）', '2年_ことば（かさの けいさん）',
  '3年_ことば（あまりのある わり算）', '3年_ことば（長さと重さの たんい）'
];

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
const triggerConfetti = (options) => { if (window.confetti) window.confetti(options); };

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

  return (
    <div className="fixed top-20 right-4 z-[9999] flex flex-col gap-2 pointer-events-none w-[90%] max-w-xs">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, x: 50 }}
            className={`bg-[var(--panel)] border-[3px] ${t.icon === 'error' || t.icon === 'warning' ? 'border-[var(--primary)]' : 'border-[var(--secondary)]'} text-[var(--text)] px-4 py-3 rounded-2xl shadow-[4px_4px_0_rgba(0,0,0,0.15)] flex items-center gap-3 font-black text-sm`}
          >
            {t.icon === 'success' && <CheckCircle2 className="text-[var(--secondary)] shrink-0" size={24} />}
            {(t.icon === 'error' || t.icon === 'warning') && <HeartCrack className="text-[var(--primary)] shrink-0" size={24} />}
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
const HandWritingCanvas = React.memo(forwardRef((props, ref) => {
  const canvasRef = useRef(null); const isDrawing = useRef(false); const lastPos = useRef({ x: 0, y: 0 }); const rectRef = useRef({ left: 0, top: 0 });

  // desynchronized + alpha:false: 透明合成(アルファブレンド)を排除し、通常の合成パイプラインを
  // 介さない低遅延描画パスを最大限有効化する（低スペック機での描画/入力遅延を大幅に削減）
  const getCtx = (cvs) => cvs.getContext('2d', { desynchronized: true, alpha: false });
  const resolveVar = (cvs, name, fallback) => getComputedStyle(cvs).getPropertyValue(name).trim() || fallback;
  const fillPaper = (cvs, ctx) => { ctx.fillStyle = resolveVar(cvs, '--panel', '#ffffff'); ctx.fillRect(0, 0, cvs.width, cvs.height); };

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
    const MAX_DIM = 4096;
    const doResize = () => {
      if (!canvasRef.current || !canvasRef.current.parentElement) return;
      const currentCvs = canvasRef.current;
      const parent = currentCvs.parentElement;
      // clientWidth/Height はボーダーを除いた整数値。canvas は absolute 配置でフロー外のため、
      // ここでバッファを変えてもレイアウトに影響せず ResizeObserver が再発火しない
      const newW = Math.min(parent.clientWidth, MAX_DIM); const newH = Math.min(parent.clientHeight, MAX_DIM);
      if (newW === 0 || newH === 0) return;
      if (Math.abs(currentCvs.width - newW) > 1 || Math.abs(currentCvs.height - newH) > 1) {
        const tempCanvas = document.createElement('canvas'); tempCanvas.width = currentCvs.width || newW; tempCanvas.height = currentCvs.height || newH;
        if (currentCvs.width > 0 && currentCvs.height > 0) tempCanvas.getContext('2d').drawImage(currentCvs, 0, 0);
        currentCvs.width = newW; currentCvs.height = newH;
        fillPaper(currentCvs, ctx); applyStyle(); ctx.drawImage(tempCanvas, 0, 0);
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
      {['.', '/', '-', '(', ')'].map(c => <motion.button whileTap={{ scale: 0.9, y: 2, boxShadow: "none" }} key={c} className="flex-1 bg-[var(--panel)] text-[var(--secondary)] border-2 border-[var(--secondary)] rounded-xl font-black text-xl shadow-[0_2px_0_var(--secondary)] flex items-center justify-center select-none outline-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onAppend(c); }}>{c}</motion.button>)}
    </div>
    <div className="grid grid-cols-3 gap-2 flex-grow">
      {digitLayout.slice(0, 9).map(n => <motion.button whileTap={{ scale: 0.9, y: 4, boxShadow: "none" }} key={n} className="bg-[var(--panel)] text-[var(--primary)] border-[3px] border-[var(--primary)] rounded-2xl font-black text-3xl shadow-[0_4px_0_var(--primary)] flex items-center justify-center select-none outline-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onAppend(n); }}>{n}</motion.button>)}
      <motion.button whileTap={{ scale: 0.9, y: 4, boxShadow: "none" }} className="bg-[var(--text)] opacity-50 text-[var(--panel)] font-black text-3xl rounded-2xl shadow-[0_4px_0_rgba(0,0,0,0.5)] outline-none flex items-center justify-center select-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onClear(); }}>C</motion.button>
      <motion.button whileTap={{ scale: 0.9, y: 4, boxShadow: "none" }} className="bg-[var(--panel)] text-[var(--primary)] border-[3px] border-[var(--primary)] rounded-2xl font-black text-3xl shadow-[0_4px_0_var(--primary)] flex items-center justify-center select-none outline-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onAppend(digitLayout[9]); }}>{digitLayout[9]}</motion.button>
      <motion.button whileTap={{ scale: 0.9, y: 4, boxShadow: "none" }} className="bg-[var(--secondary)] text-[var(--panel)] border-[3px] border-[var(--text)] font-black text-3xl rounded-2xl shadow-[0_4px_0_var(--text)] outline-none flex items-center justify-center select-none touch-manipulation" onPointerDown={(e) => { e.preventDefault(); onSubmit(); }}>OK</motion.button>
    </div>
  </div>
));

// CDNスクリプト動的読み込みフック（PeerJS, QRCode, canvas-confetti）
const useExternalScripts = () => {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const loadScript = (src) => new Promise((resolve) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = src; script.onload = resolve; script.onerror = resolve; document.head.appendChild(script);
    });
    Promise.all([
      loadScript('https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js'),
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js')
    ]).then(() => setLoaded(true));
  }, []);
  return loaded;
};

// --- P2P通信のユーティリティ ---
// 切断済みの接続へ送ると PeerJS がエラーを出すため、開いている接続にだけ送る
const safeSend = (conn, data) => {
  try { if (conn && conn.open) conn.send(data); } catch (e) { /* すでに切れている接続は無視 */ }
};
const sendToAll = (connections, data) => (connections || []).forEach(c => safeSend(c, data));

// 退出検知(ハートビート)。PeerJS の close は相手が黙って消えたとき数十秒〜届かないことがあるため、
// ホストから定期的に ping を投げ、一定時間 pong が返らないメンバーは「抜けた」とみなす。
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
        <h2 className="font-black text-5xl mb-1 text-[var(--text)] tracking-wider">Qalc<span className="text-[var(--primary)]">.</span></h2>
        <p className="text-[var(--text)] opacity-70 font-bold">めざせ、計算マスター！</p>
      </div>

      {/* Profile Card */}
      <div className="w-full bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] shadow-[4px_4px_0_rgba(0,0,0,0.1)] p-4 relative">
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {(stats.streak || 0) > 0 && (
            <div className="flex items-center gap-1 font-black text-sm text-[var(--panel)] bg-[var(--primary)] px-3 py-1 rounded-full border-2 border-[var(--text)] shadow-sm" title="連続学習日数">
              <Flame size={16} /> {stats.streak}<span className="text-[10px]">日</span>
            </div>
          )}
          <div className="flex items-center gap-1 font-black text-sm text-[var(--text)] bg-[var(--accent)] px-3 py-1 rounded-full border-2 border-[var(--text)] shadow-sm"><Coins size={16} /> {stats.coins}</div>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <div className="bg-[var(--bg)] rounded-2xl w-[80px] h-[80px] border-[3px] border-[var(--text)] overflow-hidden">
            <LayeredAvatar equipped={stats.equipped} size="text-5xl" className="w-full h-full" />
          </div>
          <div className="flex-grow text-left">
            <div className="text-xs font-bold text-[var(--text)] opacity-70 mb-0.5"><span style={{ color }}>{badge} {title}</span></div>
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
        <div className="text-right w-full text-[10px] font-bold text-[var(--text)] opacity-60 mt-1">NEXT: {Math.floor(nextLevelExp - stats.totalExp)} pt</div>
      </div>

      {resumeData && (
        <div className="w-full bg-[var(--accent)] border-[4px] border-[var(--text)] rounded-[20px] shadow-[4px_4px_0_rgba(0,0,0,0.1)] p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="font-black text-[var(--text)] flex items-center gap-2 ruby-text">
              <Clock size={20} /> <R c="前" r="ぜん" /><R c="回" r="かい" />のとちゅう
            </div>
            <button onClick={onDiscardResume} className="text-[var(--text)] opacity-60 hover:opacity-100 text-xs font-bold border-2 border-[var(--text)] rounded-lg px-2 py-1 bg-[var(--panel)] ruby-text"><R c="消" r="け" />す</button>
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
          <Timer size={28} className="text-[var(--secondary)]" /> <span className="text-xs leading-tight">タイム<br />アタック</span>
        </MotionButton>
        <MotionButton className="bg-[var(--panel)] text-[var(--text)] border-[3px] border-[var(--text)] p-3 flex-col gap-1 h-auto" onClick={() => { setConfigMode('SUDDEN_DEATH'); setView('singleConfig'); }}>
          <Swords size={28} className="text-[var(--primary)]" /> <span className="text-xs leading-tight">サドン<br />デス</span>
        </MotionButton>
      </div>

      {/* マルチプレイ ボタン */}
      <div className="w-full flex flex-col gap-2">
        <MotionButton className="bg-[var(--accent)] text-[var(--text)] w-full py-4 text-xl border-[4px] border-[var(--text)]" onClick={initHost}>
          <Users size={24} /> みんなであそぶ（へやをつくる）
        </MotionButton>
        <MotionButton className="bg-[var(--secondary)] text-[var(--panel)] w-full py-4 text-xl border-[4px] border-[var(--text)]" onClick={() => setView('clientJoin')}>
          <User size={24} /> へやに<R c="入" r="はい" />る
        </MotionButton>
      </div>

      {/* ミッションパネル */}
      <div className="w-full bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] p-4">
        <h4 className="font-bold text-[var(--text)] mb-3 flex items-center gap-2 ruby-text"><CheckCircle2 size={20} className="text-[var(--secondary)]" /> <R c="今" r="きょ" /><R c="日" r="う" />のミッション</h4>
        <div className="flex flex-col gap-2">
          {stats.missions?.list.map(m => {
            const isCleared = m.current >= m.target;
            return (
              <div key={m.id} className="flex items-center justify-between bg-[var(--bg)] p-2 rounded-xl border-2 border-transparent">
                <div className="flex flex-col flex-grow pr-2">
                  <span className={`text-sm font-bold ${isCleared ? 'text-[var(--secondary)] line-through' : 'text-[var(--text)]'}`}>{m.desc}</span>
                  <span className="text-xs text-[var(--text)] opacity-60 font-bold">{Math.min(m.current, m.target)} / {m.target}</span>
                </div>
                {isCleared ? (
                  m.claimed ? <span className="text-[var(--text)] opacity-40 font-bold text-xs flex items-center"><CheckCircle2 size={16} /> 完了</span>
                    : <button onClick={() => claimMission(m.id)} className="bg-[var(--accent)] text-[var(--text)] font-bold text-xs px-3 py-1.5 rounded-lg border-2 border-[var(--text)] active:scale-95 whitespace-nowrap">うけとる</button>
                ) : (
                  <span className="flex items-center gap-1 font-bold text-xs text-[var(--text)] opacity-60"><Coins size={14} /> {m.reward}</span>
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
              <div className="text-[9px] font-bold text-[var(--text)] opacity-50 mt-1 shrink-0">{d.label}</div>
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
              <div className="text-[10px] font-bold text-[var(--text)] opacity-60 ruby-text"><R c="回" r="かい" />あそんだ</div>
            </div>
            <div className="bg-[var(--bg)] rounded-xl border-2 border-[var(--text)] p-2 text-center">
              <div className="text-2xl font-black text-[var(--secondary)]">{study.summary.minutes}<span className="text-xs ml-0.5 ruby-text"><R c="分" r="ふん" /></span></div>
              <div className="text-[10px] font-bold text-[var(--text)] opacity-60 ruby-text"><R c="集" r="しゅう" /><R c="中" r="ちゅう" />した<R c="時" r="じ" /><R c="間" r="かん" /></div>
            </div>
            <div className="bg-[var(--bg)] rounded-xl border-2 border-[var(--text)] p-2 text-center">
              <div className="text-2xl font-black text-[var(--primary)]">
                {study.summary.firstTryRate == null ? '—' : `${Math.round(study.summary.firstTryRate * 100)}%`}
              </div>
              <div className="text-[10px] font-bold text-[var(--text)] opacity-60 ruby-text">1<R c="回" r="かい" />めで<R c="正" r="せい" /><R c="解" r="かい" /></div>
            </div>
          </div>
          {study.missed.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold text-[var(--text)] opacity-70 mb-1.5 ruby-text">もういちど やってみよう</p>
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
const HostRoomView = ({ peerState, setPeerState, broadcast, setView, setState, configMode, setConfigMode, initRaid, initTerritory }) => {
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

  // QRコード描画
  useEffect(() => {
    if (peerState.hostId && window.QRCode && document.getElementById('qrcode')) {
      document.getElementById('qrcode').innerHTML = ''; // クリア
      const url = `${window.location.origin}${window.location.pathname}?host=${peerState.hostId}`;
      new window.QRCode(document.getElementById('qrcode'), { text: url, width: 160, height: 160 });
    }
  }, [peerState.hostId]);

  const hostTeam = peerState.hostTeam || 'red';

  // じんとり用: メンバーのチームをタップで入れかえる(参加者リスト経由で全員に同期される)
  const toggleMemberTeam = (id) => {
    audioCtrl.playSE('click');
    setPeerState(p => {
      const cur = p.participants[id];
      if (!cur) return p;
      const newP = { ...p, participants: { ...p.participants, [id]: { ...cur, team: cur.team === 'blue' ? 'red' : 'blue' } } };
      sendToAll(newP.connections, { type: 'participants_update', data: newP.participants });
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
      sendToAll(newP.connections, { type: 'participants_update', data: newP.participants });
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
        <h3 className="font-black text-xl flex items-center gap-2 text-[var(--text)]"><Users size={24} className="text-[var(--secondary)]" /> みんなのへや</h3>
        <div className="font-bold bg-[var(--secondary)] text-white px-3 py-1 rounded-full border-2 border-[var(--text)]">{Object.keys(peerState.participants).length} <R c="人" r="にん" /></div>
      </div>

      <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] p-5 flex flex-col gap-6 overflow-y-auto flex-grow shadow-sm">
        <div className="flex flex-col items-center justify-center p-4 bg-[var(--bg)] rounded-xl border-2 border-dashed border-[var(--text)] shrink-0">
          <p className="font-bold text-[var(--primary)] mb-1 text-sm ruby-text">ルーム<R c="番" r="ばん" /><R c="号" r="ごう" /></p>
          <h4 className="font-black text-5xl text-[var(--text)] mb-4 tracking-widest">{peerState.hostId}</h4>
          <p className="font-bold text-sm text-[var(--text)] mb-3 ruby-text">この<R c="数" r="すう" /><R c="字" r="じ" />を<R c="入" r="にゅう" /><R c="力" r="りょく" />するか、QRコードを<R c="読" r="よ" />みこんでね</p>
          <div id="qrcode" className="bg-white p-3 rounded-xl mb-3 shadow-inner"></div>
          <div className="w-full flex items-center bg-white border-2 border-gray-200 rounded-lg p-2">
            <input type="text" readOnly value={`${window.location.origin}${window.location.pathname}?host=${peerState.hostId}`} className="text-xs font-mono w-full outline-none bg-transparent" />
            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?host=${peerState.hostId}`); showToast('success', 'コピーしました'); }} className="text-gray-500 hover:text-[var(--primary)] ml-2"><Share2 size={16} /></button>
          </div>
        </div>

        <div className="shrink-0">
          <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-70 ruby-text"><R c="出" r="しゅつ" /><R c="題" r="だい" />モード</label>
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
                  みんなで <span className="text-[var(--primary)]"><R c="力" r="ちから" /></span>を あわせて、<br className="hidden sm:block" />ボスを たおそう！
                </div>
              </div>
              <div className="bg-[var(--bg)] border-2 border-dashed border-[var(--text)] rounded-xl p-3 text-xs font-bold text-[var(--text)] opacity-90 mb-3 leading-relaxed flex flex-col gap-1">
                <span>👑 <R c="全" r="ぜん" /><R c="員" r="いん" />で 1<R c="体" r="たい" />のボスに ちょうせんする <R c="協" r="きょう" /><R c="力" r="りょく" />モード！<R c="正" r="せい" /><R c="解" r="かい" />すると ボスにダメージ、コンボが つづくほど <span className="text-[var(--primary)]">大ダメージ</span></span>
                <span>💗 <R c="体" r="たい" /><R c="力" r="りょく" />は みんなで1つ。ボスの こうげきで へって 0になると たてなおし（ボスも かいふくしてしまう）</span>
                <span>✨ <span className="text-[var(--primary)]">おうえん</span>… ゲージが たまると はつどう！ 8<R c="秒" r="びょう" />かん <R c="全" r="ぜん" /><R c="員" r="いん" />のダメージ2ばい＋<R c="体" r="たい" /><R c="力" r="りょく" />かいふく</span>
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
                  あいぼうの <span className="text-[var(--primary)]">{TERRITORY_CHARACTER_NAME}</span> と いっしょに、<br className="hidden sm:block" />ばんめんを ぬりつぶそう！
                </div>
              </div>
              <div className="bg-[var(--bg)] border-2 border-dashed border-[var(--text)] rounded-xl p-3 text-xs font-bold text-[var(--text)] opacity-90 mb-3 leading-relaxed flex flex-col gap-1">
                <span>🚩 2チームに<R c="分" r="わ" />かれて、7×7の ばんめんを ぬりあうチーム<R c="戦" r="せん" />！<R c="正" r="せい" /><R c="解" r="かい" />すると ねらったマスに ぬれるよ。</span>
                <span>🌊 マスをぬると となりにも インクがはねて <span className="text-[var(--primary)]">れんさ</span>が おきる！★マスは ポイントが<R c="大" r="おお" />きい</span>
                <span>💥 <span className="text-[var(--primary)]">スペシャル</span>… ゲージが たまると スーパーチャクチ・スプラッシュライン・インクラッシュ が うてる</span>
                <span>🎁 <span className="text-[var(--primary)]">？マス</span>… とるとラッキー！ ⏰ のこり30<R c="秒" r="びょう" />は <span className="text-red-500">ラストスパートで ぬり2ばい</span>（さいごまで ぎゃくてんできる！）</span>
              </div>
              <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-70">チームわけ（なまえをタップで いれかえ）</label>
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
                          <button key={id} onClick={() => toggleMemberTeam(id)} className="text-[11px] font-bold bg-[var(--panel)] border-2 border-[var(--text)] rounded-full px-2 py-0.5 active:scale-95 max-w-[110px] truncate">{m.name}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-70 ruby-text"><R c="学" r="がく" /><R c="年" r="ねん" /></label>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3 no-scrollbar sm:flex-wrap sm:overflow-visible sm:pb-0">
            {grades.map(grade => <button key={grade} onClick={() => { audioCtrl.playSE('click'); setSelectedGrade(grade); }} className={`px-4 py-2 rounded-full whitespace-nowrap font-bold text-sm border-2 transition-colors flex-shrink-0 ${selectedGrade === grade ? 'bg-[var(--text)] border-[var(--text)] text-[var(--panel)] shadow-sm' : 'bg-[var(--bg)] border-transparent text-[var(--text)] hover:border-gray-400'}`}>{grade}</button>)}
          </div>

          <div className="mb-2">
            <CourseMultiSelect filteredGroups={filteredGroups} allGroups={groups} selected={selectedGroups} setSelected={setSelectedGroups} />
          </div>
        </div>

        {(configMode === 'SCORE_ATTACK' || configMode === 'BOSS_RAID' || configMode === 'TERRITORY') && (
          <div className="shrink-0 mb-2">
            <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-70 flex justify-between ruby-text"><span><R c="制" r="せい" /><R c="限" r="げん" /><R c="時" r="じ" /><R c="間" r="かん" /></span><span className="text-[var(--primary)] text-lg">{time} <R c="分" r="ふん" /></span></label>
            <input type="range" min="1" max="10" value={time} onChange={e => setTime(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[var(--primary)]" />
          </div>
        )}

        <div className="shrink-0">
          <h4 className="font-black text-lg text-[var(--text)] border-b-2 border-dashed border-gray-200 pb-2 mb-3 ruby-text"><R c="参" r="さん" /><R c="加" r="か" /><R c="者" r="しゃ" />の<R c="状" r="じょう" /><R c="況" r="きょう" /></h4>
          <div className="flex flex-col gap-2">
            {Object.keys(peerState.participants).length === 0 && <p className="text-center text-gray-400 py-4 font-bold text-sm ruby-text"><R c="参" r="さん" /><R c="加" r="か" /><R c="者" r="しゃ" />がいません</p>}
            {Object.entries(peerState.participants).sort((a, b) => b[1].score - a[1].score).map(([id, p], index) => (
              <div key={id} className="flex justify-between items-center bg-[var(--bg)] p-3 rounded-xl border-2 border-[var(--text)]">
                <div className="flex items-center gap-3">
                  <span className="font-black text-gray-400 w-4 text-center">{index + 1}</span>
                  <span className="font-bold text-[var(--text)]">{p.name}</span>
                </div>
                <div className="flex items-center gap-4 text-sm font-bold">
                  <span className="text-[var(--secondary)]">🔥 {p.combo} Combo</span>
                  <span className="text-[var(--primary)] w-16 text-right font-black">{p.score} pt</span>
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
  return (
    <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] p-6 text-center shadow-md max-w-sm mx-auto mt-10 flex flex-col">
      <div className="bg-[var(--accent)] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-[var(--text)] shrink-0">
        <Users size={32} className="text-[var(--text)]" />
      </div>
      <h3 className="font-black text-2xl mb-4 text-[var(--text)] shrink-0 ruby-text">へやに<R c="入" r="はい" />ります</h3>

      <div className="mb-4 shrink-0">
        <p className="font-bold mb-2 text-[var(--text)] opacity-70 text-sm ruby-text">ルーム<R c="番" r="ばん" /><R c="号" r="ごう" />（<R c="数" r="すう" /><R c="字" r="じ" />）</p>
        <input
          type="text"
          inputMode="numeric"
          className="w-full border-[3px] border-[var(--text)] rounded-xl p-4 font-black text-2xl tracking-widest text-center outline-none focus:border-[var(--secondary)] bg-[var(--bg)]"
          placeholder="123456"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value.replace(/[^0-9]/g, ''))}
        />
      </div>

      <div className="mb-6 shrink-0">
        <p className="font-bold mb-2 text-[var(--text)] opacity-70 text-sm ruby-text">あなたの<R c="名" r="な" /><R c="前" r="まえ" /></p>
        <input
          type="text"
          className="w-full border-[3px] border-[var(--text)] rounded-xl p-4 font-black text-xl text-center outline-none focus:border-[var(--secondary)] bg-[var(--bg)]"
          placeholder="なまえ"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { if (!roomId.trim()) return showToast('warning', 'ルーム番号を入力してください'); if (!name.trim()) return showToast('warning', '名前を入力してください'); initClient(name, roomId); } }}
        />
      </div>

      <MotionButton
        className="bg-[var(--secondary)] text-[var(--panel)] w-full py-4 text-xl border-[3px] border-[var(--text)] shrink-0"
        onClick={() => {
          if (!roomId.trim()) return showToast('warning', 'ルーム番号を入力してください');
          if (!name.trim()) return showToast('warning', '名前を入力してください');
          initClient(name, roomId);
        }}
      >
        へやに<R c="入" r="はい" />る！
      </MotionButton>

      <button className="text-[var(--text)] opacity-50 font-bold mt-4 hover:opacity-100 transition shrink-0" onClick={() => { audioCtrl.playSE('click'); setView('home') }}>もどる</button>
    </div>
  );
};

// --- クライアント 待機画面 ---
const ClientWaitView = ({ peerState, leaveRoom }) => (
  <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] p-8 text-center shadow-md flex flex-col items-center justify-center min-h-[50vh] max-w-sm mx-auto mt-10">
    <div className="animate-spin mb-6 bg-[var(--bg)] p-4 rounded-full border-2 border-[var(--text)]">
      <Radio size={48} className="text-[var(--secondary)]" />
    </div>
    <h3 className="font-black text-3xl text-[var(--text)] mb-3 ruby-text">{peerState.myName} さん、<br /><R c="準" r="じゅん" /><R c="備" r="び" />OK！</h3>
    <p className="font-bold text-[var(--text)] opacity-70 bg-[var(--accent)] px-4 py-2 rounded-lg border-2 border-[var(--text)] mb-6 ruby-text">
      リーダーがスタートするまで<br />このまま<R c="待" r="ま" />っていてね
    </p>
    <button className="text-[var(--text)] opacity-50 font-bold hover:opacity-100 transition underline ruby-text" onClick={leaveRoom}>やめる（<R c="退" r="たい" /><R c="出" r="しゅつ" />する）</button>
  </div>
);


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
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-xs flex flex-col items-center text-center">
              <div className="text-5xl mb-3 h-16 flex items-center justify-center">
                {confirmItem.category === 'themes'
                  ? (confirmItem.item.c ? <div className="flex gap-1">{confirmItem.item.c.map((col, i) => <span key={i} className="w-8 h-8 rounded-full border-[3px] border-[var(--text)]" style={{ background: col }} />)}</div> : <PaintBucket size={48} className="text-[var(--text)]" />)
                  : confirmItem.item.char}
              </div>
              <h3 className="font-black text-xl text-[var(--text)] mb-2 leading-snug">「{confirmItem.item.name}」を<br />買いますか？</h3>
              <p className="font-bold text-[var(--primary)] mb-6 flex items-center gap-1 justify-center"><Coins size={20} /> {confirmItem.item.price}</p>
              <div className="flex w-full gap-3">
                <MotionButton className="bg-[var(--bg)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={() => { audioCtrl.playSE('click'); setConfirmItem(null); }}>やめる</MotionButton>
                <MotionButton className="bg-[var(--accent)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={executeBuy}>かう！</MotionButton>
              </div>
            </motion.div>
          </motion.div>
        )}

        {gachaResult && (
          <motion.div key="gachaModal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-xs flex flex-col items-center text-center">
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
                  <p className="text-[10px] font-bold text-[var(--text)] opacity-60 mb-2">({CATEGORY_LABELS[gachaResult.category]})</p>
                  {gachaResult.isNew
                    ? <p className="font-black text-[var(--primary)] mb-4">✨ NEW! てにいれた！</p>
                    : <p className="font-black text-[var(--text)] opacity-70 mb-4 flex items-center gap-1 justify-center">もってた！ <Coins size={16} /> +{gachaResult.refund} もどってきた</p>}
                  <div className="flex w-full gap-3">
                    <MotionButton className="bg-[var(--bg)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={() => { audioCtrl.playSE('click'); setGachaResult(null); }}>とじる</MotionButton>
                    <MotionButton className="bg-[var(--accent)] text-[var(--text)] border-[3px] border-[var(--text)] py-3 flex-1" onClick={spinGacha} disabled={stats.coins < GACHA_COST}>もう1かい</MotionButton>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-between items-center mb-2 shrink-0">
        <h3 className="font-bold text-xl text-[var(--text)] flex items-center gap-2"><Store size={24} /> ショップ＆きせかえ</h3>
        <div className="flex items-center gap-1 font-black text-sm text-[var(--text)] bg-[var(--accent)] px-3 py-1.5 rounded-full border-[3px] border-[var(--text)]"><Coins size={16} /> {stats.coins}</div>
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
            <button key={t.id} onClick={() => { audioCtrl.playSE('click'); setTab(t.id); }} className={`flex flex-col items-center justify-center p-1 rounded-lg border-2 font-bold text-[9px] transition-all ${tab === t.id ? 'bg-[var(--text)] text-[var(--panel)] border-[var(--text)]' : 'bg-[var(--panel)] text-[var(--text)] opacity-60 border-transparent hover:bg-[var(--bg)]'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'gacha' ? (
        <div className="bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-[20px] flex-grow p-4 overflow-y-auto shadow-sm flex flex-col items-center gap-3">
          <motion.div animate={{ rotate: [0, -6, 6, -6, 6, 0] }} transition={{ repeat: Infinity, duration: 2.5, repeatDelay: 1 }} className="text-7xl">🥚</motion.div>
          <h4 className="font-black text-lg text-[var(--text)]">ふしぎなたまごガチャ</h4>
          <p className="text-xs font-bold text-[var(--text)] opacity-70 text-center leading-relaxed">
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
            <div className="font-black text-[var(--primary)] py-3">🎉 ガチャコンプリート！おめでとう！</div>
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
                        : <span className="text-[10px] font-bold text-[var(--text)] bg-[var(--accent)] border border-[var(--text)] px-1.5 py-0.5 rounded-full flex items-center justify-center gap-0.5"><Coins size={10} />{item.price}</span>}
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
        <label className="font-bold text-sm text-[var(--text)] opacity-70">ドリル（タップで えらぶ・いくつでもOK）</label>
        {visibleNames.length > 0 && (
          <button onClick={toggleAllVisible} className="shrink-0 text-xs font-bold px-3 py-1 rounded-full border-2 border-[var(--text)] bg-[var(--bg)] text-[var(--text)] active:scale-95 transition-transform touch-manipulation">
            {allVisibleSelected ? 'ぜんぶ はずす' : 'ぜんぶ えらぶ'}
          </button>
        )}
      </div>
      <div className="border-[3px] border-[var(--text)] rounded-xl bg-[var(--bg)] overflow-hidden">
        <div className="max-h-52 overflow-y-auto p-2 flex flex-col gap-1.5">
          {filteredGroups.length === 0 && <p className="text-center font-bold text-sm text-[var(--text)] opacity-50 py-4">該当するコースがありません</p>}
          {filteredGroups.map(g => {
            const on = selected.includes(g.name);
            return (
              <button key={g.name} onClick={() => toggle(g.name)} aria-pressed={on}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border-2 text-left transition-colors touch-manipulation ${on ? 'bg-[var(--accent)] border-[var(--text)]' : 'bg-[var(--panel)] border-transparent'}`}>
                <span className={`w-6 h-6 shrink-0 rounded flex items-center justify-center border-2 transition-colors ${on ? 'bg-[var(--secondary)] border-[var(--secondary)]' : 'bg-[var(--panel)] border-[var(--text)]'}`}>
                  {on && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                </span>
                <span className="flex-grow font-bold text-sm text-[var(--text)] truncate">{g.displayName || g.name}</span>
                {masteredSet.has(g.name) && <span className="shrink-0 text-[10px] font-black bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--text)] rounded-full px-1.5 py-0.5">⭐マスター</span>}
                <span className="shrink-0 text-xs font-bold text-[var(--text)] opacity-50">{g.count}問</span>
              </button>
            );
          })}
        </div>
        <div className="border-t-2 border-dashed border-[var(--text)] bg-[var(--panel)] p-2 flex items-center gap-1.5 flex-wrap min-h-[44px]">
          {selected.length === 0 ? (
            <span className="font-bold text-xs text-[var(--text)] opacity-50 px-1">ドリルを えらんでね</span>
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
          {configMode === 'TIME_ATTACK' && <><Timer size={28} className="text-[var(--secondary)]" /> タイムアタック</>}
          {configMode === 'SUDDEN_DEATH' && <><Swords size={28} className="text-[var(--primary)]" /> サドンデス</>}
        </h3>

        <div>
          <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-70 ruby-text"><R c="学" r="がく" /><R c="年" r="ねん" /></label>
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
            <label className="font-bold text-sm block mb-1 text-[var(--text)] opacity-70 flex justify-between ruby-text"><span><R c="制" r="せい" /><R c="限" r="げん" /><R c="時" r="じ" /><R c="間" r="かん" /></span><span className="text-[var(--primary)] text-lg">{time} <R c="分" r="ふん" /></span></label>
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
          <button className="text-[var(--text)] opacity-50 font-bold text-sm py-2 w-full hover:opacity-100 transition" onClick={() => { audioCtrl.playSE('click'); setView('home') }}>もどる</button>
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
        sendToAll(newP.connections, { type: 'participants_update', data: newP.participants });
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
        ...(state.gameMode === 'BOSS_RAID' ? { bossDefeated: defeatedRef.current, supports: mySupportsRef.current } : {}),
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
      sendToAll(peerState.connections, { type: 'game_finish', data: raidResult ? { raidResult } : territoryResult ? { territoryResult } : undefined });
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
  // どうぐを開いて解いた問題は、自力で解いたのとは分けて記録する（hint: true）
  const handleToolUse = useCallback((toolId) => { studyRef.current?.markTool(toolId); }, []);
  const handleSubmit = useCallback(() => { submitAnsRef.current(); }, []);

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
                <span className={`text-xs font-black px-1.5 py-0.5 rounded-sm ${idx === 0 ? 'bg-yellow-400 text-white' : idx === 1 ? 'bg-gray-400 text-white' : idx === 2 ? 'bg-orange-400 text-white' : 'text-[var(--text)] opacity-50'}`}>{idx + 1}</span>
                <span className="text-xs font-bold truncate max-w-[60px]">{p.name}</span>
              </div>
              <span className="text-base text-[var(--primary)] font-black">{p.score}<span className="text-[10px] ml-0.5 opacity-60">pt</span></span>
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
            <p className="shrink-0 text-[10px] font-bold text-[var(--text)] opacity-60 mt-1 text-center">タップで ねらうマスを えらぼう（<R c="数" r="すう" /><R c="字" r="じ" />＝あと<R c="何" r="なん" /><R c="回" r="かい" />で ぬれる／？＝ラッキーマス）</p>
          </div>
        )}

        <div className={`flex flex-col flex-shrink-0 transition-all duration-300 ${showMemo ? 'w-full md:w-[400px] min-h-[85vh] md:min-h-0 border-b md:border-b-0 md:border-r border-[var(--text)]' : `w-full ${isTerritory ? 'md:flex-grow md:w-auto max-w-4xl' : 'max-w-4xl h-full'} mx-auto`} md:h-full p-4`}>

          <div className="flex justify-between items-center mb-2 shrink-0 gap-2">
            <button onClick={() => { audioCtrl.playSE('click'); setQuitDialog(true); }} className="shrink-0 bg-[var(--panel)] text-[var(--text)] border-2 border-[var(--text)] rounded-lg px-2 py-1 font-bold text-xs shadow-[0_2px_0_var(--text)] active:translate-y-[1px] active:shadow-none flex items-center gap-1"><XCircle size={16} /> やめる</button>
            <TimerClock gameMode={state.gameMode} startTime={startTime} timeLimitSec={state.timeLimitSec} />
            <div className="font-black text-2xl text-[var(--primary)] flex items-center gap-2 drop-shadow-sm">
              {state.gameMode === 'TIME_ATTACK' ? <>{correctCount} / {state.problemSet.length} <R c="問" r="もん" /></> : state.gameMode === 'SUDDEN_DEATH' ? <>{correctCount} <R c="問" r="もん" /><R c="正" r="せい" /><R c="解" r="かい" /></> : state.gameMode === 'BOSS_RAID' ? <>⚔ {score} <span className="text-sm text-[var(--text)] opacity-50">ダメージ</span></> : state.gameMode === 'TERRITORY' ? <>🖌 {score} <span className="text-sm text-[var(--text)] opacity-50">ぬり</span></> : <>{score} <span className="text-sm text-[var(--text)] opacity-50">pt</span></>}
            </div>
          </div>

          <div className={`relative flex-grow flex flex-col justify-center items-center ${isTerritory ? 'min-h-[90px] mb-2 md:min-h-[150px] md:mb-4' : 'min-h-[150px] mb-4'}`}>
            <div className="absolute top-0 h-10 flex justify-center items-center w-full">
              <AnimatePresence>
                {combo > 1 && <motion.div initial={{ scale: 0, y: 10 }} animate={{ scale: [0, 1.3, 1], y: 0, rotate: -6 }} exit={{ scale: 0 }} className="bg-[var(--accent)] text-[var(--text)] border-2 border-[var(--text)] rounded-full px-4 py-1.5 font-black text-sm shadow-[2px_2px_0_var(--text)] z-30">{combo} COMBO! 🔥</motion.div>}
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
              <motion.button whileTap={{ scale: 0.8 }} className={`absolute left-4 w-14 h-14 rounded-full flex items-center justify-center border-[3px] border-[var(--text)] shadow-sm transition-colors z-40 touch-manipulation ${showTools ? 'bg-[var(--accent)] text-[var(--text)]' : 'bg-[var(--bg)] text-[var(--text)] opacity-50'}`} onClick={() => { audioCtrl.playSE('click'); setShowTools(s => !s); }} aria-label="かんがえるどうぐ">
                <Lightbulb size={24} />
              </motion.button>
            )}
            <span className="text-5xl font-black text-[var(--secondary)] tracking-widest">{ans || <span className="text-4xl font-bold text-[var(--text)] opacity-20">?</span>}</span>
            {showMemo && <motion.button whileTap={{ scale: 0.8 }} className="absolute right-20 w-12 h-12 rounded-full hidden md:flex items-center justify-center border-[3px] border-[var(--text)] shadow-sm bg-[var(--panel)] text-[var(--text)] z-40 transition-colors" onPointerDown={(e) => { e.preventDefault(); audioCtrl.playSE('click'); setMemoPosition(p => p === 'right' ? 'left' : 'right'); }}><ArrowLeftRight size={20} /></motion.button>}
            <motion.button whileTap={{ scale: 0.8 }} className={`absolute right-4 w-14 h-14 rounded-full flex items-center justify-center text-2xl border-[3px] border-[var(--text)] shadow-sm transition-colors z-40 ${showMemo ? 'bg-[var(--secondary)] text-[var(--panel)]' : 'bg-[var(--bg)] text-[var(--text)] opacity-50'}`} onPointerDown={(e) => { e.preventDefault(); audioCtrl.playSE('click'); setShowMemo(!showMemo); }}><PenTool size={24} /></motion.button>
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

      <LearningToolPanel open={showTools} onClose={() => { audioCtrl.playSE('click'); setShowTools(false); }} courseName={state.courseName} qText={q.q} onFx={() => audioCtrl.playSE('click')} onToolUse={handleToolUse} />

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
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-sm flex flex-col items-center text-center">
              <XCircle size={48} className="text-[var(--primary)] mb-3" />
              <h3 className="font-black text-xl text-[var(--text)] mb-2 ruby-text"><R c="途" r="と" /><R c="中" r="ちゅう" />で やめますか？</h3>
              <p className="text-sm text-[var(--text)] opacity-70 mb-5 ruby-text">
                ここまでの<R c="正" r="せい" /><R c="解" r="かい" />: <span className="font-black text-[var(--primary)]">{correctCount}<R c="問" r="もん" /></span>
                {state.gameMode === 'SCORE_ATTACK' && <> ／ スコア: <span className="font-black text-[var(--primary)]">{score}pt</span></>}
                {state.gameMode === 'BOSS_RAID' && <> ／ <R c="与" r="あた" />えたダメージ: <span className="font-black text-[var(--primary)]">⚔{score}</span></>}
                {state.gameMode === 'TERRITORY' && <> ／ ぬった<R c="回" r="かい" /><R c="数" r="すう" />: <span className="font-black text-[var(--primary)]">🖌{score}</span></>}
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
              <p className="text-xl font-bold text-[var(--primary)] mb-3">Lv.{oldInfo.level} <span className="opacity-50">→</span> Lv.{newInfo.level} {newInfo.title}</p>
              {(state.levelUpCoins || 0) > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="flex items-center gap-1.5 bg-[var(--accent)] border-2 border-[var(--text)] rounded-full px-4 py-1.5 font-black text-[var(--text)] mb-6">
                  <Coins size={18} /> ボーナス +{state.levelUpCoins} コイン！
                </motion.div>
              )}
              <MotionButton className="bg-[var(--accent)] text-[var(--text)] w-full py-3 text-lg border-[3px] border-[var(--text)]" onClick={() => setShowLevelUp(false)}>やったー！</MotionButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.h2 initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.6 }} className="font-black text-5xl text-center mb-4 text-[var(--primary)] shrink-0">
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
                <span className="font-bold text-xs sm:text-sm truncate w-full text-center">{top5[1].name}</span>
                <span className="font-black text-base sm:text-lg text-[var(--secondary)] mb-1">{top5[1].score}<span className="text-[10px] ml-0.5">pt</span></span>
                <div className="w-full bg-gray-300 h-[60%] rounded-t-lg border-2 border-[var(--text)] border-b-0 flex justify-center pt-2 font-black text-xl text-white shadow-inner">2</div>
              </div>
            )}
            {top5[0] && (
              <div className="flex flex-col items-center w-1/3 h-full justify-end">
                <span className="font-bold text-sm sm:text-base truncate w-full text-center">{top5[0].name}</span>
                <span className="font-black text-lg sm:text-2xl text-[var(--primary)] mb-1">{top5[0].score}<span className="text-xs ml-0.5">pt</span></span>
                <div className="w-full bg-yellow-400 h-[85%] rounded-t-lg border-2 border-[var(--text)] border-b-0 flex justify-center pt-2 font-black text-3xl text-white shadow-inner">1</div>
              </div>
            )}
            {top5[2] && (
              <div className="flex flex-col items-center w-1/4 h-full justify-end">
                <span className="font-bold text-xs sm:text-sm truncate w-full text-center">{top5[2].name}</span>
                <span className="font-black text-base sm:text-lg text-[var(--text)] opacity-70 mb-1">{top5[2].score}<span className="text-[10px] ml-0.5">pt</span></span>
                <div className="w-full bg-orange-300 h-[40%] rounded-t-lg border-2 border-[var(--text)] border-b-0 flex justify-center pt-2 font-black text-lg text-white shadow-inner">3</div>
              </div>
            )}
          </div>

          {top5.length > 3 && (
            <div className="flex flex-wrap justify-center gap-2 w-full">
              {top5.slice(3, 5).map((p, i) => (
                <div key={p.id} className="flex gap-2 items-center bg-[var(--bg)] px-3 py-2 rounded-lg border-2 border-[var(--text)]">
                  <span className="font-black text-gray-500 text-sm">#{i + 4}</span>
                  <span className="font-bold text-sm max-w-[80px] truncate">{p.name}</span>
                  <span className="font-black text-base">{p.score}<span className="text-[10px] ml-0.5">pt</span></span>
                </div>
              ))}
            </div>
          )}

          {myRank && myRank > 0 && (
            <div className="mt-4 pt-4 border-t-2 border-dashed border-gray-200 w-full text-center bg-[var(--bg)] rounded-xl p-3">
              <span className="font-bold text-[var(--text)] text-sm ruby-text">あなたの<R c="順" r="じゅん" /><R c="位" r="い" /> </span>
              <span className="font-black text-3xl text-[var(--primary)] ml-2">{myRank} <span className="text-lg ruby-text"><R c="位" r="い" /></span></span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-[4px_4px_0_var(--text)] p-6 text-center w-full mb-6 shrink-0 relative overflow-hidden">
          {state.gameMode === 'SCORE_ATTACK' && <><h4 className="text-[var(--text)] opacity-70 font-bold mb-1">SCORE</h4><div className="text-6xl font-black text-[var(--text)] mb-2">{state.finalScore || 0}</div></>}
          {state.gameMode === 'TIME_ATTACK' && <><h4 className="text-[var(--text)] opacity-70 font-bold mb-1">CLEAR TIME</h4><div className="text-6xl font-black text-[var(--secondary)] mb-2">{state.finalTime.toFixed(1)} <span className="text-2xl ruby-text"><R c="秒" r="びょう" /></span></div></>}
          {state.gameMode === 'SUDDEN_DEATH' && <><h4 className="text-[var(--text)] opacity-70 font-bold mb-1 ruby-text"><R c="連" r="れん" /><R c="続" r="ぞく" /><R c="正" r="せい" /><R c="解" r="かい" /><R c="数" r="すう" /></h4><div className="text-6xl font-black text-[var(--primary)] mb-2">{state.finalCorrect} <span className="text-2xl ruby-text"><R c="問" r="もん" /></span></div></>}

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="text-xl font-black text-[var(--secondary)] mb-4 flex flex-col items-center justify-center gap-1">
            <div className="flex items-center gap-1.5">
              ⬆ {earnedExp} EXP かくとく！
              {state.decayInfo && state.decayInfo.mult < 1 && <span className="text-sm font-bold opacity-50 line-through">{state.decayInfo.baseExp}</span>}
            </div>
            {state.decayInfo && state.decayInfo.mult < 1 && (
              <div className="text-xs font-bold text-[var(--text)] opacity-70 ruby-text px-2">
                {state.decayInfo.mastered
                  ? <>⭐もうマスターしたドリルだよ！つぎのドリルに<R c="挑" r="ちょう" /><R c="戦" r="せん" />するとEXPがいっぱいもらえるよ！</>
                  : <>🔁きょう{state.decayInfo.repeatPlays + 1}かいめだから EXPは{Math.round(state.decayInfo.mult * 100)}%だよ。ほかのドリルもやってみよう！</>}
              </div>
            )}
          </motion.div>
          <div className="inline-block bg-[var(--accent)] text-[var(--text)] font-black px-5 py-2 rounded-full border-[3px] border-[var(--text)] shadow-sm">Max Combo: {state.finalCombo || 0}</div>

          {/* EXPバー: 獲得EXPがレベルにどれだけ近づいたかをその場でアニメーション表示する */}
          <div className="mt-5 text-left">
            <div className="flex justify-between items-end mb-1">
              <span className="font-black text-sm text-[var(--text)]">{newInfo.badge} Lv.{newInfo.level}</span>
              <span className="text-[10px] font-bold text-[var(--text)] opacity-60">NEXT: {Math.floor(newInfo.nextLevelExp - newExp)} pt</span>
            </div>
            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden border border-[var(--text)]">
              <motion.div initial={{ width: `${newInfo.level > oldInfo.level ? 0 : oldInfo.progress}%` }} animate={{ width: `${newInfo.progress}%` }} transition={{ delay: 0.8, duration: 1, ease: 'easeOut' }} className="h-full bg-[var(--secondary)]" />
            </div>
          </div>
        </div>
      )}

      {mistakes.length > 0 && (
        <div className="bg-[var(--panel)] border-[3px] border-[var(--primary)] rounded-[20px] p-4 mb-6 shrink-0 shadow-sm">
          <h4 className="font-black text-[var(--primary)] mb-3 flex items-center justify-center gap-2 ruby-text"><PenTool size={20} /> おさらい（まちがえた<R c="問" r="もん" /><R c="題" r="だい" />）</h4>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-2 no-scrollbar">
            {mistakes.map((m, i) => (
              <div key={i} className="flex justify-between items-center border-b-2 border-dashed border-[var(--bg)] pb-2">
                <span className="font-bold text-lg text-[var(--text)] tracking-wider">{m.q}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text)] opacity-30">▶</span>
                  <span className="font-black text-xl text-[var(--primary)]">{m.a.replace(/\|/g, ' または ')}</span>
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
              <div className="bg-[var(--accent)] border-[3px] border-[var(--text)] rounded-xl p-4 text-center font-bold text-[var(--text)] ruby-text">
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
              <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-xs flex flex-col items-center text-center">
                <Trash2 size={48} className="text-[var(--primary)] mb-3" />
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
          <div className="bg-[var(--bg)] flex p-3 border-b-2 border-[var(--text)] font-bold text-sm text-[var(--text)] opacity-70 shrink-0"><div className="flex-grow px-2">問題</div><div className="w-24 px-2 text-center border-l-2 border-[var(--text)]">答え</div><div className="w-12 border-l-2 border-[var(--text)]"></div></div>
          <div className="flex-grow overflow-y-auto">
            <AnimatePresence>
              {probs.map((p, i) => (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} key={i} className="flex border-b-2 border-dashed border-[var(--bg)] overflow-hidden">
                  <input type="text" className="flex-grow p-3 outline-none font-bold bg-transparent text-[var(--text)]" placeholder="問題" value={p.q} onChange={e => { const n = [...probs]; n[i] = { ...n[i], q: e.target.value }; setProbs(n); }} />
                  <input type="text" className="w-24 p-3 outline-none border-l-2 border-dashed border-[var(--bg)] text-center font-bold text-[var(--primary)] bg-transparent" placeholder="答え" value={p.a} onChange={e => { const n = [...probs]; n[i] = { ...n[i], a: e.target.value }; setProbs(n); }} />
                  <button className="w-12 border-l-2 border-dashed border-[var(--bg)] text-[var(--text)] opacity-30 hover:opacity-100 flex items-center justify-center transition-opacity" onClick={() => { audioCtrl.playSE('click'); setProbs(probs.filter((_, idx) => idx !== i)) }}><XCircle size={20} /></button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <button className="bg-[var(--bg)] hover:bg-[var(--accent)] text-[var(--text)] font-bold p-3 border-t-2 border-[var(--text)] shrink-0 transition-colors flex items-center justify-center gap-2" onClick={() => { audioCtrl.playSE('click'); setProbs([...probs, { q: '', a: '' }]) }}><Plus size={20} /> 問題を追加</button>
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
        {filteredGroups.length === 0 ? <div className="text-center text-[var(--text)] opacity-50 py-10 font-bold">コースがありません</div> : filteredGroups.map(g => (
          <div key={g.name} className="p-3 border-b border-dashed border-[var(--bg)] cursor-pointer flex justify-between items-center transition-colors rounded-lg group" onClick={() => { audioCtrl.playSE('click'); openEdit(g.name) }}>
            <div className="flex flex-col"><span className="font-bold text-[var(--text)]">{g.name}</span><span className="text-[var(--text)] opacity-50 text-xs">{g.count}問</span></div>
            <button className="bg-[var(--bg)] hover:bg-[var(--secondary)] hover:text-[var(--panel)] text-[var(--text)] p-2 rounded-xl transition-colors border-2 border-[var(--text)] shadow-sm" onClick={(e) => copyShareCode(e, g.name)} title="共有コードをコピー"><Share2 size={18} /></button>
          </div>
        ))}
      </div>
      <div className="shrink-0 flex flex-col gap-3 pb-4">
        <div className="flex gap-3">
          <MotionButton className="bg-[var(--secondary)] text-[var(--panel)] flex-grow py-3 border-[3px] border-[var(--text)]" onClick={() => { audioCtrl.playSE('click'); setView('import') }}><Download size={20} /> 受信/AI</MotionButton>
          <MotionButton className="bg-[var(--accent)] text-[var(--text)] flex-grow py-3 border-[3px] border-[var(--text)]" onClick={() => { audioCtrl.playSE('click'); openEdit('') }}><Plus size={20} /> 新規作成</MotionButton>
        </div>
        <button className="text-[var(--text)] opacity-50 font-bold py-3 hover:opacity-100 transition" onClick={() => { audioCtrl.playSE('click'); setView('home') }}>もどる</button>
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
        <p className="text-sm font-bold text-[var(--text)] opacity-70 shrink-0">{mode === 'code' ? 'もらった「共有コード」を貼り付けてください。' : 'AI(ChatGPT等)が作った「問題,答え」のリストを貼り付けてください。'}</p>

        {mode === 'ai' && (
          <button className="border-[3px] border-[var(--secondary)] text-[var(--secondary)] font-bold rounded-xl py-2 text-sm shrink-0 active:scale-95 transition-transform" onClick={copyPrompt}>
            AIへの指示(プロンプト)をコピー
          </button>
        )}

        <textarea className="flex-grow border-[3px] border-[var(--text)] rounded-xl p-3 resize-none font-mono text-sm outline-none bg-[var(--bg)] text-[var(--text)]" value={text} onChange={e => setText(e.target.value)}></textarea>
        <MotionButton className="bg-[var(--primary)] text-[var(--panel)] py-4 shrink-0 border-[3px] border-[var(--text)]" onClick={process}>読み込んで追加</MotionButton>
      </div>
      <button className="text-[var(--text)] opacity-50 font-bold py-3 shrink-0 pb-4" onClick={() => { audioCtrl.playSE('click'); setView('manager') }}>もどる</button>
    </div>
  );
};


// ==========================================
// 5. メインアプリケーション (App)
// ==========================================
export default function App() {
  const [view, setView] = useState('home');
  const [configMode, setConfigMode] = useState('SCORE_ATTACK');
  const [isMuted, setIsMuted] = useState(audioCtrl.muted);
  const [state, setState] = useState({ problemSet: [], timeLimitSec: 0, courseName: '', finalScore: 0, finalCombo: 0, earnedExp: 0, previousExp: 0, gameMode: 'SCORE_ATTACK', mistakes: [] });
  const [stats, setStats] = useState(() => StorageAPI.getStats());
  const [resumeData, setResumeData] = useState(() => StorageAPI.getResume());

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

  const scriptsLoaded = useExternalScripts();

  // P2P通信用のステート
  const [urlHostId, setUrlHostId] = useState(null);
  const [peerState, setPeerState] = useState({ role: null, peer: null, conn: null, hostId: null, myName: '', connections: [], participants: {} });
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
    if (hostParam) {
      setUrlHostId(hostParam);
      setView('clientJoin');
      // リロード時などに意図せず参加画面に戻らないようURLパラメータを消去
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // 【ホスト専用】メンバーが抜けたときの後片付け。
  // 参加者リスト・接続・じんとりのねらい表示から取りのぞき、残りの全員へ最新の参加者リストを配る。
  const hostRemoveMember = useCallback((peerId, notify) => {
    const cur = peerStateRef.current;
    if (cur.role !== 'host' || !peerId || peerId === cur.hostId) return;
    const known = !!cur.participants[peerId] || cur.connections.some(c => c.peer === peerId);
    if (!known) return;
    const name = cur.participants[peerId]?.name;

    delete memberSeenRef.current[peerId];
    if (terrRef.current && terrRef.current.targets) delete terrRef.current.targets[peerId];

    // 相手の端末が生きている場合(通信不良で切ったときなど)は、へやから外れたことを伝えてから切断する
    const gone = cur.connections.find(c => c.peer === peerId);
    if (gone) { safeSend(gone, { type: 'room_closed', data: { reason: 'removed' } }); setTimeout(() => { try { gone.close(); } catch (e) {} }, 200); }

    setPeerState(p => {
      if (!p.participants[peerId] && !p.connections.some(c => c.peer === peerId)) return p;
      const participants = { ...p.participants };
      delete participants[peerId];
      const newP = { ...p, participants, connections: p.connections.filter(c => c.peer !== peerId) };
      sendToAll(newP.connections, { type: 'participants_update', data: participants });
      return newP;
    });

    if (notify && name) showToast('warning', `${name} さんが たいしゅつしました`);
  }, []);

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
  const initHost = () => {
    if (!window.Peer) return showToast('error', '通信準備中です。少し待ってから再度お試しください。');
    const roomId = Math.floor(100000 + Math.random() * 900000).toString();
    const peer = new window.Peer(roomId);
    const session = ++peerSessionRef.current;
    const alive = () => peerSessionRef.current === session; // 退出後に古い接続からのイベントで動かないようにする

    peer.on('open', (id) => {
      if (!alive()) return;
      memberSeenRef.current = {};
      setPeerState(p => ({ ...p, role: 'host', peer, hostId: id, participants: {}, connections: [] }));
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
      conn.on('data', (rawData) => {
        if (!alive()) return;
        memberSeenRef.current[conn.peer] = Date.now(); // 何か届いた＝生きている
        if (rawData.type === 'pong') {
          return;
        } else if (rawData.type === 'leave') {
          // メンバーが「退出」をおした。参加者リストからすぐに外す
          hostRemoveMember(conn.peer, true);
        } else if (rawData.type === 'join') {
          setPeerState(p => {
            // じんとり用に参加時点でチームを自動割当(人数の少ない側へ)。他モードでは使われないだけで無害
            const hostTeam = p.hostTeam || 'red';
            let red = hostTeam === 'red' ? 1 : 0; let blue = 1 - red;
            Object.entries(p.participants).forEach(([id, m]) => { if (id === p.hostId) return; if (m.team === 'blue') blue++; else red++; });
            const team = red <= blue ? 'red' : 'blue';
            const newP = { ...p, participants: { ...p.participants, [conn.peer]: { id: conn.peer, name: rawData.name, score: 0, combo: 0, team } } };
            sendToAll(newP.connections, { type: 'participants_update', data: newP.participants });
            return newP;
          });
          showToast('success', `${rawData.name} さんが参加しました`);
        } else if (rawData.type === 'score_update') {
          setPeerState(p => {
            if (!p.participants[conn.peer]) return p;
            const newP = { ...p, participants: { ...p.participants, [conn.peer]: { ...p.participants[conn.peer], score: rawData.data.score, combo: rawData.data.combo } } };
            sendToAll(newP.connections, { type: 'participants_update', data: newP.participants });
            return newP;
          });
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
  const broadcast = useCallback((data) => {
    sendToAll(peerStateRef.current.connections, data);
  }, []);

  // 【クライアント(児童)の初期化処理】
  const initClient = (playerName, hId) => {
    if (!window.Peer) return showToast('error', '通信準備中です。');
    const peer = new window.Peer();
    const session = ++peerSessionRef.current;
    // 退出したあとに(切断が完了するまでの間などに)届いたメッセージで画面が動きださないようにする
    const alive = () => peerSessionRef.current === session;

    peer.on('open', () => {
      if (!alive()) return;
      const conn = peer.connect(hId);
      conn.on('open', () => {
        if (!alive()) return;
        conn.send({ type: 'join', name: playerName });
        setPeerState(p => ({ ...p, role: 'client', peer, conn, myName: playerName }));
        setView('clientWait');
        showToast('success', 'リーダーのルームに入りました！');
      });
      conn.on('data', (rawData) => {
        if (!alive()) return; // すでにルームを抜けている端末は、以降いっさい反応しない
        if (rawData.type === 'ping') {
          safeSend(conn, { type: 'pong' }); // 生きていることをリーダーへ返す
        } else if (rawData.type === 'room_closed') {
          // リーダーがへやをとじた/自分がへやから外された。この端末はここで完全に切りはなす
          teardownPeer({ type: 'warning', msg: rawData.data?.reason === 'removed' ? 'へやからはなれました' : 'リーダーがへやをとじました' });
        } else if (rawData.type === 'game_start') {
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
    setPeerState({ role: null, peer: null, conn: null, hostId: null, myName: '', connections: [], participants: {} });
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
      --bg: #fffbf0; --primary: #FF6B6B; --secondary: #4ECDC4; --accent: #FFE66D; --text: #292f36; --panel: #ffffff;
    `;
    if (stats.theme === 'dark') themeVars = `--bg: #0f172a; --primary: #f43f5e; --secondary: #0ea5e9; --accent: #f59e0b; --text: #e2e8f0; --panel: #1e293b;`;
    if (stats.theme === 'sakura') themeVars = `--bg: #fdf2f8; --primary: #d946ef; --secondary: #f472b6; --accent: #fbcfe8; --text: #831843; --panel: #ffffff;`;
    if (stats.theme === 'ocean') themeVars = `--bg: #f0f9ff; --primary: #0284c7; --secondary: #38bdf8; --accent: #7dd3fc; --text: #0c4a6e; --panel: #ffffff;`;
    if (stats.theme === 'forest') themeVars = `--bg: #f0fdf4; --primary: #16a34a; --secondary: #f59e0b; --accent: #bbf7d0; --text: #14532d; --panel: #ffffff;`;
    if (stats.theme === 'space') themeVars = `--bg: #17153B; --primary: #c084fc; --secondary: #2dd4bf; --accent: #4338ca; --text: #e2e8f0; --panel: #2e2b5f;`;
    if (stats.theme === 'gold') themeVars = `--bg: #fefce8; --primary: #b45309; --secondary: #eab308; --accent: #fef08a; --text: #713f12; --panel: #ffffff;`;
    if (stats.theme === 'mint') themeVars = `--bg: #f0fdfa; --primary: #14b8a6; --secondary: #2dd4bf; --accent: #ccfbf1; --text: #134e4a; --panel: #ffffff;`;
    if (stats.theme === 'sunset') themeVars = `--bg: #fff7ed; --primary: #ea580c; --secondary: #f97316; --accent: #fcd34d; --text: #7c2d12; --panel: #ffffff;`;
    if (stats.theme === 'cyber') themeVars = `--bg: #000000; --primary: #39ff14; --secondary: #ff00ff; --accent: #0ff0fc; --text: #ffffff; --panel: #111111;`;
    if (stats.theme === 'choco') themeVars = `--bg: #fdf8f5; --primary: #92400e; --secondary: #d97706; --accent: #fde68a; --text: #451a03; --panel: #ffffff;`;
    if (stats.theme === 'retro') themeVars = `--bg: #f5eedc; --primary: #c25953; --secondary: #6a7f72; --accent: #e0b469; --text: #3d312d; --panel: #faf6ee;`;
    if (stats.theme === 'monochrome') themeVars = `--bg: #f8f9fa; --primary: #000000; --secondary: #666666; --accent: #d4d4d4; --text: #1a1a1a; --panel: #ffffff;`;
    if (stats.theme === 'lavender') themeVars = `--bg: #f5f3ff; --primary: #7c3aed; --secondary: #a78bfa; --accent: #ddd6fe; --text: #4c1d95; --panel: #ffffff;`;
    if (stats.theme === 'candy') themeVars = `--bg: #fff0f6; --primary: #ec4899; --secondary: #60a5fa; --accent: #a5f3fc; --text: #9d174d; --panel: #ffffff;`;
    if (stats.theme === 'soda') themeVars = `--bg: #eff6ff; --primary: #2563eb; --secondary: #22d3ee; --accent: #bfdbfe; --text: #1e3a8a; --panel: #ffffff;`;
    if (stats.theme === 'matcha') themeVars = `--bg: #f7fee7; --primary: #4d7c0f; --secondary: #84cc16; --accent: #d9f99d; --text: #365314; --panel: #ffffff;`;
    if (stats.theme === 'ruby') themeVars = `--bg: #fff1f2; --primary: #be123c; --secondary: #fb7185; --accent: #fecdd3; --text: #881337; --panel: #ffffff;`;
    if (stats.theme === 'hero') themeVars = `--bg: #f8fafc; --primary: #dc2626; --secondary: #2563eb; --accent: #fde047; --text: #111827; --panel: #ffffff;`;
    if (stats.theme === 'aurora') themeVars = `--bg: #042f2e; --primary: #34d399; --secondary: #818cf8; --accent: #115e59; --text: #ccfbf1; --panel: #134e4a;`;
    if (stats.theme === 'hanabi') themeVars = `--bg: #1e1b4b; --primary: #f472b6; --secondary: #facc15; --accent: #6d28d9; --text: #ede9fe; --panel: #312e81;`;
    if (stats.theme === 'midnight') themeVars = `--bg: #020617; --primary: #38bdf8; --secondary: #818cf8; --accent: #1e293b; --text: #e0f2fe; --panel: #0f172a;`;
    if (stats.theme === 'ninja') themeVars = `--bg: #18181b; --primary: #ef4444; --secondary: #a1a1aa; --accent: #3f3f46; --text: #f4f4f5; --panel: #27272a;`;
    if (stats.theme === 'royal') themeVars = `--bg: #faf5ff; --primary: #7e22ce; --secondary: #eab308; --accent: #e9d5ff; --text: #581c87; --panel: #ffffff;`;
    if (stats.theme === 'rainbow') themeVars = `--bg: #fdf4ff; --primary: #e11d48; --secondary: #0ea5e9; --accent: #fde047; --text: #3b0764; --panel: #ffffff;`;
    if (stats.theme === 'sunflower') themeVars = `--bg: #fefce8; --primary: #ca8a04; --secondary: #22c55e; --accent: #fde047; --text: #422006; --panel: #ffffff;`;
    if (stats.theme === 'watermelon') themeVars = `--bg: #f0fdf4; --primary: #ef4444; --secondary: #22c55e; --accent: #fecaca; --text: #14532d; --panel: #ffffff;`;
    if (stats.theme === 'milktea') themeVars = `--bg: #f5f0e8; --primary: #a16207; --secondary: #78716c; --accent: #e7d8c0; --text: #44403c; --panel: #fffaf3;`;
    if (stats.theme === 'tropical') themeVars = `--bg: #ecfeff; --primary: #f59e0b; --secondary: #06b6d4; --accent: #a7f3d0; --text: #164e63; --panel: #ffffff;`;
    if (stats.theme === 'halloween') themeVars = `--bg: #1c1917; --primary: #f97316; --secondary: #a855f7; --accent: #78350f; --text: #fed7aa; --panel: #292524;`;
    if (stats.theme === 'christmas') themeVars = `--bg: #fef2f2; --primary: #dc2626; --secondary: #16a34a; --accent: #fde68a; --text: #7f1d1d; --panel: #ffffff;`;
    if (stats.theme === 'prism') themeVars = `--bg: #f5fffa; --primary: #8b5cf6; --secondary: #ec4899; --accent: #99f6e4; --text: #1e1b4b; --panel: #ffffff;`;

    return (
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700;900&display=swap');
        :root { ${themeVars} }
        body { font-family: 'Zen Maru Gothic', sans-serif; background-color: var(--bg); color: var(--text); touch-action: manipulation; transition: background-color 0.3s ease; }
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
    <div className="flex flex-col h-[100dvh] w-full bg-[var(--bg)] relative overflow-hidden transition-colors duration-500">
      <GlobalStyle />
      {view !== 'game' && (
        <header className="flex-shrink-0 bg-[var(--panel)]/90 backdrop-blur border-b-[4px] border-[var(--accent)] py-3 px-5 flex justify-between items-center z-50 sticky top-0 shadow-sm transition-colors duration-500">
          <div className="flex items-center cursor-pointer gap-2" onClick={handleHomeClick}>
            <div className="bg-[var(--secondary)] p-1.5 rounded-lg text-[var(--panel)] shadow-sm border-2 border-[var(--text)]"><Calculator size={22} strokeWidth={3} /></div>
            <h1 className="text-2xl font-black text-[var(--text)] tracking-wide">Qalc<span className="text-[var(--primary)]">.</span></h1>
          </div>
          <div className="flex items-center gap-3">
            {peerState.role && <span className="font-bold text-xs bg-[var(--accent)] px-2 py-1 rounded border-2 border-[var(--text)]">{peerState.role === 'host' ? 'リーダー' : 'メンバー'}</span>}
            <button onClick={() => setIsMuted(audioCtrl.toggle())} className="text-[var(--text)] opacity-50 hover:opacity-100 p-2 rounded-full transition-all focus:outline-none border-2 border-transparent hover:border-[var(--text)] hover:bg-[var(--bg)]">
              {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} className="text-[var(--primary)]" />}
            </button>
          </div>
        </header>
      )}

      <main className="flex-grow relative overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'home' && <PageWrapper key="home"><HomeView setView={setView} stats={stats} setStats={setStats} setConfigMode={setConfigMode} initHost={initHost} resumeData={resumeData} onResume={resumeGame} onDiscardResume={discardResume} /></PageWrapper>}
          {view === 'singleConfig' && <PageWrapper key="single"><SingleConfigView setView={setView} setState={setState} configMode={configMode} stats={stats} /></PageWrapper>}

          {/* 追加ビュー */}
          {view === 'hostRoom' && <PageWrapper key="host"><HostRoomView peerState={peerState} setPeerState={setPeerState} broadcast={broadcast} setView={setView} setState={setState} configMode={configMode} setConfigMode={setConfigMode} initRaid={initRaid} initTerritory={initTerritory} /></PageWrapper>}
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
        <footer className="w-full bg-[var(--panel)] border-t-[3px] border-[var(--text)] pt-3 pb-2 text-center text-sm text-[var(--text)] font-bold shrink-0 z-50 transition-colors duration-500">
          <p>
            © {new Date().getFullYear()} Qalc
            <a href="https://note.com/cute_borage86" target="_blank" rel="noopener noreferrer" className="ml-1 text-[var(--text)] cursor-default outline-none">
              GIGA山
            </a>
          </p>
        </footer>
      )}

      {/* ルームからぬけるまえのたしかめ(「戻る」でうっかり全員のへやを閉じないように) */}
      <AnimatePresence>
        {leaveConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-[var(--panel)] border-[4px] border-[var(--text)] rounded-[20px] shadow-xl p-6 w-full max-w-xs flex flex-col items-center text-center">
              <Users size={48} className="text-[var(--primary)] mb-3" />
              <h3 className="font-black text-xl text-[var(--text)] mb-2 ruby-text">へやから<R c="出" r="で" />ますか？</h3>
              <p className="text-sm text-[var(--text)] opacity-70 mb-5 ruby-text">
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
    </div>
  );
}