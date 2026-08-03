/* バトルの画面を「みんなであそぶ」を選ぶまで読みこまない（Part I §5）
 *
 * ボスバトルとじんとりバトルの画面は、あわせて約74KB ある。
 * 1人であそぶだけの児童には1バイトも要らないのに、初回に配っていた。
 *
 * ここでの import() は同じファイルを指しているので、まとめて1つのチャンクになる。
 * 何度呼んでも読みこみは1回きり（ブラウザが解決ずみの Promise を使いまわす）。
 *
 * 決まりごと・計算（ボスの強さ、盤面のコスト、フックなど）は
 * ../battles/raidLogic.js と ../battles/territoryLogic.js にあり、そちらは最初から読む。
 * GameView が useRaidDebuffs / useRaidShake / useTerritoryMood を無条件に呼ぶため、
 * フックだけは遅らせるわけにいかない。
 */
import { lazy } from 'react';

const raid = () => import('../BossBattle.jsx');
const terr = () => import('../TerritoryBattle.jsx');

const pick = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));

/* へやを作る／入るときに、通信の準備といっしょに裏で取ってくる。
 * バトルが始まってから取りにいくと、最初の1問が出るまで待たされてしまう。 */
export const preloadBattles = () => {
    raid().catch(() => {});
    terr().catch(() => {});
};

// --- ボスバトルの画面 ---
export const BossPanel = pick(raid, 'BossPanel');
export const BossAvatar = pick(raid, 'BossAvatar');
export const SupportButton = pick(raid, 'SupportButton');
export const ProblemDebuffOverlay = pick(raid, 'ProblemDebuffOverlay');
export const FreezeOverlay = pick(raid, 'FreezeOverlay');
export const RaidEventOverlay = pick(raid, 'RaidEventOverlay');
export const RaidScreenFx = pick(raid, 'RaidScreenFx');
export const RaidResultPanel = pick(raid, 'RaidResultPanel');

// --- じんとりバトルの画面 ---
export const TerritoryScoreBar = pick(terr, 'TerritoryScoreBar');
export const TerritoryBoard = pick(terr, 'TerritoryBoard');
export const TerritoryEventOverlay = pick(terr, 'TerritoryEventOverlay');
export const TerritoryResultPanel = pick(terr, 'TerritoryResultPanel');
export const TerritorySpecialButton = pick(terr, 'TerritorySpecialButton');
export const TerritoryRushBadge = pick(terr, 'TerritoryRushBadge');
export const TerritoryLastSpurtFx = pick(terr, 'TerritoryLastSpurtFx');
export const TerritoryCharacter = pick(terr, 'TerritoryCharacter');
