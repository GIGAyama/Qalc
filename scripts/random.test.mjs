// 並べかえと乱数（src/random.js）のテスト。
//   実行: npm run test:random
import { shuffle, sample, seededRandom } from '../src/random.js';

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('NG', name, '\n  got :', JSON.stringify(got), '\n  want:', JSON.stringify(want)); }
  else console.log('ok', name);
};

// --- もとの配列を変えない・中身は同じ ---
const base = Array.from({ length: 30 }, (_, i) => i);
const mixed = shuffle(base);
eq('もとの配列は変えない', base, Array.from({ length: 30 }, (_, i) => i));
eq('中身は同じ（入れかえただけ）', [...mixed].sort((a, b) => a - b), base);
eq('空の配列', shuffle([]), []);
eq('1つだけ', shuffle(['a']), ['a']);
eq('sample は n 個', sample(base, 20).length, 20);
eq('sample で n が多いときは全部', sample(base, 100).length, 30);
eq('sample に重なりは無い', new Set(sample(base, 20)).size, 20);

// --- 種が同じなら同じ並び、ちがえばちがう並び ---
eq('同じ種なら同じ並び', shuffle(base, seededRandom(7)), shuffle(base, seededRandom(7)));
eq('ちがう種ならちがう並び', JSON.stringify(shuffle(base, seededRandom(7))) !== JSON.stringify(shuffle(base, seededRandom(8))), true);
const r = seededRandom(1);
const xs = Array.from({ length: 1000 }, () => r());
eq('種つき乱数は 0以上1未満', xs.every((x) => x >= 0 && x < 1), true);

// --- かたよらない: どの問題も「先頭20問」に同じ確率で入る ---
// 以前の sort(() => Math.random() - 0.5) では、100問のコースで出やすさに 0.76〜1.82 倍の差があった
const N = 100;
const PICK = 20;
const TRIALS = 40000;
const hit = new Array(N).fill(0);
const rand = seededRandom(20261115);
const items = Array.from({ length: N }, (_, i) => i);
for (let t = 0; t < TRIALS; t++) sample(items, PICK, rand).forEach((i) => { hit[i]++; });
const expect = (TRIALS * PICK) / N;
const ratios = hit.map((h) => h / expect);
const worst = Math.max(...ratios.map((x) => Math.abs(x - 1)));
console.log(`   （先頭${PICK}問に入る確率の ずれ: 最大 ${(worst * 100).toFixed(1)}%）`);
eq('どの問題も同じくらい出る（ずれ 6% 未満）', worst < 0.06, true);
// 位置ごとの平均: 前半と後半で差が無い
const firstHalf = ratios.slice(0, N / 2).reduce((a, b) => a + b, 0) / (N / 2);
const secondHalf = ratios.slice(N / 2).reduce((a, b) => a + b, 0) / (N / 2);
eq('前のほうの問題ばかり出ない', Math.abs(firstHalf - secondHalf) < 0.02, true);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
