/* バトルの「決まりごと」のテスト。
 * 実行: npm run test:battle
 *
 * ボスバトルとじんとりバトルは、ホストの端末が正解を持って全員に配る作りになっている。
 * ここが狂うと、児童の画面では「正解したのにダメージが入らない」「ぬったはずのマスが
 * 相手の色になる」といった、原因の分かりにくい不具合になる。
 *
 * 画面(絵)を後から読みこむようにしたとき、決まりごとを別ファイルへ切りだした。
 * その切りだしで値が変わっていないことを、ここで確かめる。
 */
import {
  RAID_CONSTANTS, BOSSES, bossForStage, bossMaxHp, calcRaidDamage,
  attackIntervalMs, rollBurstCount, pickBossAttack, makeShuffledLayout,
  raidInputLocked, raidDamageMods, raidProblemTransform, attackTrackOf,
  DAMAGE_ATTACK_KINDS, PLAYER_DEBUFF_KINDS,
} from '../src/battles/raidLogic.js';
import {
  TERRITORY_CONSTANTS, TEAMS, otherTeam, CELL_DEFS, TOTAL_VALUE,
  createTerritoryCells, isSelectable, effectiveCost, remainingFor,
  autoPickTarget, pickNearTarget, computeScores, addCharge, resolveCaptures,
  applyBlast, specialCharges, rollSpecial, rollLucky, SPECIALS, LUCKY_EFFECTS,
} from '../src/battles/territoryLogic.js';

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'ok' : 'NG'} ${label}`);
  if (!cond) failed++;
};

console.log('--- ボスバトル ---');

// ボスは4体で、順ぐりに出る
ok(BOSSES.length === 4, 'ボスは4体');
// 5体目からは1体目にもどるが、「スーパー」が付いて強化版になる
ok(bossForStage(5).bossIndex === bossForStage(1).bossIndex, '5体目は1体目のボスにもどる');
ok(bossForStage(4).superMode === false && bossForStage(5).superMode === true, '5体目からスーパー');
ok(bossForStage(5).name.startsWith('スーパー'), 'スーパーは名前で分かる');
ok([1, 2, 3, 4].map((s) => bossForStage(s).bossIndex).join() === '0,1,2,3', '1〜4体目は順ぐりに出る');
ok(BOSSES.every((b) => b.sprite && b.name && b.color), 'すべてのボスに絵・名前・色がある');

// 体力は「人数」と「何体目か」で増える。ここが逆だと1人のときに終わらなくなる
const hp1 = bossMaxHp(1, 1);
const hp1x5 = bossMaxHp(1, 5);
const hp3 = bossMaxHp(3, 1);
ok(hp1x5 > hp1, '人数が多いほど体力が多い');
ok(hp3 > hp1, '後のボスほど体力が多い');
ok(hp1 > 0 && Number.isFinite(hp1), '体力が有限の正の数');

// ダメージ。改造した端末から大きな値を送られても、計算じたいの上限は超えない
const dmgs = [1, 2, 5, 10, 30].map((c) => calcRaidDamage(c, false, {}));
ok(dmgs.every((d, i, a) => i === 0 || d >= a[i - 1]), 'コンボが多いほどダメージが増える（減らない）');
ok(Math.max(...dmgs) <= 90, 'ダメージの最大は90（roomAccess の受けとり上限と同じ）');
ok(calcRaidDamage(5, true, {}) > calcRaidDamage(5, false, {}), 'おうえん中はダメージが増える');
ok(calcRaidDamage(5, false, { halve: true }) <= calcRaidDamage(5, false, {}), 'のろい/バリアでダメージが減る');
ok(calcRaidDamage(0, false, {}) >= 0, 'コンボ0でも負にならない');

// 攻撃の間隔。げきおこ中は短くなる（＝攻撃が激しくなる）
ok(attackIntervalMs(1, true) < attackIntervalMs(1, false), 'げきおこ中は攻撃の間隔が短い');
ok(attackIntervalMs(4, false) <= attackIntervalMs(1, false), '後のボスほど間隔が短い（か同じ）');

// 連続攻撃の回数は、決められた範囲におさまる
const bursts = Array.from({ length: 200 }, () => rollBurstCount(4, true));
ok(bursts.every((n) => n >= 1 && n <= 3), 'れんぞくこうげきは1〜3回');

// 技の抽選。妨害技とダメージ技は別々のタイマーで飛んでくる
ok(DAMAGE_ATTACK_KINDS.every((k) => attackTrackOf(k) === 'damage'), 'ダメージ技が damage に分類される');
ok(PLAYER_DEBUFF_KINDS.filter((k) => !DAMAGE_ATTACK_KINDS.includes(k))
  .every((k) => attackTrackOf(k) === 'disrupt'), '妨害技が disrupt に分類される');
const picks = Array.from({ length: 100 }, () => pickBossAttack(0, 1, ['a', 'b']));
ok(picks.every((p) => p && typeof p.kind === 'string'), '技の抽選が必ず kind を返す');

// テンキーの並びかえ。同じ種なら全員同じ並びになる（ばらばらだと不公平になる）
const l1 = makeShuffledLayout(1234);
const l2 = makeShuffledLayout(1234);
ok(JSON.stringify(l1) === JSON.stringify(l2), '同じ種なら並びも同じ（全員そろう）');
ok(l1.length === 10 && new Set(l1).size === 10, '0〜9の10個がもれなく1回ずつ');
ok(JSON.stringify(makeShuffledLayout(1)) !== JSON.stringify(makeShuffledLayout(2)), '種がちがえば並びもちがう');

// 入力のロック。状態が無いときに落ちない
ok(raidInputLocked(null, 'me') === false, 'raid の状態が無ければロックしない');
ok(typeof raidDamageMods(null, 'me') === 'object', 'デバフが無くてもオブジェクトを返す');
ok(raidProblemTransform([]) === undefined, 'かがみ文字でなければ変形しない');
ok(raidProblemTransform([{ kind: 'mirror' }]) === 'scaleX(-1)', 'かがみ文字は左右反転');

ok(RAID_CONSTANTS.TEAM_HP_MAX > 0, 'チームHPの最大が正の数');

console.log('\n--- じんとりバトル ---');

const N = TERRITORY_CONSTANTS.COLS * TERRITORY_CONSTANTS.ROWS;
ok(N === 49, '盤面は7×7の49マス');
ok(CELL_DEFS.length === N, 'マスの定義が49個');
ok(TOTAL_VALUE > 0, '合計ポイントが正の数');
ok(otherTeam('red') === 'blue' && otherTeam('blue') === 'red', 'あか⇔あお');
ok(Object.keys(TEAMS).length === 2, 'チームは2つ');

// 本陣は左上と右下。うばえない
const cells = createTerritoryCells();
ok(cells[0].owner === 'red' && cells[N - 1].owner === 'blue', '本陣が最初からぬられている');
ok(isSelectable(cells, 0, 'blue') === false, '相手の本陣はねらえない');
ok(isSelectable(cells, 0, 'red') === false, '自分の本陣もねらえない');
ok(isSelectable(cells, 10, 'red') === true, 'ふつうのマスはねらえる');

// 180度回転で対称＝両チームが同じ条件になっているか
const symmetric = CELL_DEFS.every((d, i) => {
  const o = CELL_DEFS[N - 1 - i];
  return d.cost === o.cost && d.value === o.value && d.star === o.star && d.lucky === o.lucky;
});
ok(symmetric, '盤面が180度回転で対称（どちらのチームも同じ条件）');

// コスト。うばうときと、はなれたマスは高くつく
const c2 = createTerritoryCells();
c2[8].owner = 'blue';
ok(effectiveCost(c2, 8, 'red') > CELL_DEFS[8].cost, '相手のマスをうばうと高い');
ok(remainingFor(c2, 8, 'red') >= 1, 'のこりぬり数は1以上');

/* ぬる → たまったら自分の色になる。
 * addCharge / resolveCaptures / applyBlast は cells をその場で書きかえる作り
 * （毎正解ごとに49マスをコピーすると、低スペック機で重くなるため）。
 * 戻り値は addCharge が「ぬれたか」、resolveCaptures が「確定したマスの一覧」。 */
const after = createTerritoryCells();
const target = 1;   // 本陣のとなり
const need = effectiveCost(after, target, 'red');
ok(addCharge(after, target, 'red', need) === true, 'ねらえるマスにはぬれる');
ok(addCharge(after, 0, 'red', 1) === false, '本陣にはぬれない');
const captured = resolveCaptures(after);
ok(Array.isArray(captured), '確定したマスの一覧がかえる');
ok(after[target].owner === 'red', 'ぬり数がたまるとチームの色になる');

// スコア。ぬったぶんだけ増える
const s0 = computeScores(createTerritoryCells());
const s1 = computeScores(after);
ok(s1.red > s0.red, 'ぬるとスコアが増える');
ok(s1.red + s1.blue <= TOTAL_VALUE, 'スコアの合計が上限をこえない');

// インクばくはつが盤面の外に出ない（外に出ると例外で試合が止まる）
const blastCells = createTerritoryCells();
applyBlast(blastCells, 24, 'red');
ok(blastCells.length === N, 'ばくはつしても盤面の大きさは変わらない');
ok(blastCells.some((c) => c.charge.red > 0), 'まわりのマスにインクがはねている');
applyBlast(blastCells, 0, 'red');
applyBlast(blastCells, N - 1, 'blue');
ok(blastCells.length === N, 'かどでばくはつしても盤面の外を見にいかない');
for (const kind of Object.keys(SPECIALS)) {
  const list = specialCharges(24, kind);
  ok(list.every((x) => x.idx >= 0 && x.idx < N), `${SPECIALS[kind].name}: 盤面の外をぬらない`);
}
ok(specialCharges(null, 'drop').length === 0, 'ねらいが無ければ何もぬらない');

// 抽選が定義の中から選ばれる
ok(Array.from({ length: 60 }, rollSpecial).every((k) => k in SPECIALS), 'スペシャルは定義の中から選ばれる');
ok(Array.from({ length: 60 }, rollLucky).every((k) => k in LUCKY_EFFECTS), 'ラッキーは定義の中から選ばれる');

// ねらいの自動選択が、いつも有効なマスを返す
const auto = autoPickTarget(createTerritoryCells(), 'red');
ok(auto != null && isSelectable(createTerritoryCells(), auto, 'red'), '自動でねらうマスは必ずねらえるマス');
const near = pickNearTarget(after, 'red', target);
ok(near == null || isSelectable(after, near, 'red'), 'ぬり終えたあとの次のねらいも有効');

console.log(failed ? `\n${failed} 件 失敗` : '\nALL PASS');
process.exit(failed ? 1 : 0);
