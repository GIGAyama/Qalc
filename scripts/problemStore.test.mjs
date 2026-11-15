// プリセットの作りかた（種つき）と、コースの保存・旧データの移しかえ（src/problemStore.js）のテスト。
//   実行: npm run test:store
import { getParsedDefaultProblems, buildPresetProblems, PRESET_SEED, LEGACY_DEFAULT_KEYS } from '../src/data/problems.js';
import { cleanCourses, isUneditedLegacyCopy, migrateLegacyCourses, mergeCourses } from '../src/problemStore.js';

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('NG', name, '\n  got :', JSON.stringify(got).slice(0, 300), '\n  want:', JSON.stringify(want).slice(0, 300)); }
  else console.log('ok', name);
};

const presets = getParsedDefaultProblems();
const alt = buildPresetProblems(PRESET_SEED + 1);

// --- プリセットは種つきで、何度作っても同じ ---
eq('同じ種なら まったく同じプリセット', buildPresetProblems(PRESET_SEED), presets);
eq('コース数は119', Object.keys(presets).length, 119);
const total = Object.values(presets).reduce((n, l) => n + l.length, 0);
eq('問題数は11,796（以前と同じ数）', total, 11796);
const randomCourses = Object.keys(presets).filter((k) => JSON.stringify(presets[k].map((p) => p.q).sort()) !== JSON.stringify(alt[k].map((p) => p.q).sort()));
console.log(`   （乱数で中身が変わるコース: ${randomCourses.length}本）`);
eq('乱数で変わるコースがある（文章題など）', randomCourses.length > 0, true);
eq('九九は乱数で変わらない', randomCourses.includes('2年_九九'), false);

// --- 3〜4年の分数: どの書きかたでも正解（B7） ---
const answersOf = (course, q) => presets[course].find((p) => p.q === q)?.a.split('|');
eq('4年: 6/4 も 3/2 も正解', answersOf('4年_分数たし算（1より大きい）', '1/4+5/4'), ['6/4', '3/2']);
eq('4年: 整数の答えは 2 も 18/9 も正解', answersOf('4年_分数たし算（1より大きい）', '9/9+9/9'), ['2', '18/9']);
eq('4年ひき算: 2/4 も 1/2 も正解', answersOf('4年_分数ひき算（1より大きい）', '5/4-3/4'), ['2/4', '1/2']);
eq('3年: 1 も 3/3 も正解', answersOf('3年_分数たし算', '1/3+2/3'), ['1', '3/3']);
eq('3年ひき算: 約分した形も正解（前から）', answersOf('3年_分数ひき算', '4/8-2/8'), ['2/8', '1/4']);
// 4コースの全問で、答えの候補がどれも式の値と等しい
const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));
const value = (s) => { const m = String(s).match(/^(\d+)\/(\d+)$/); return m ? [Number(m[1]), Number(m[2])] : [Number(s), 1]; };
const same = ([a, b], [c, d]) => a * d === b * c;
let wrong = [];
for (const c of ['3年_分数たし算', '3年_分数ひき算', '4年_分数たし算（1より大きい）', '4年_分数ひき算（1より大きい）']) {
  for (const p of presets[c]) {
    const m = p.q.match(/^(\d+)(?:\/(\d+))?([+-])(\d+)\/(\d+)$/);
    const left = m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1]), 1];
    const right = [Number(m[4]), Number(m[5])];
    const v = m[3] === '+' ? [left[0] * right[1] + right[0] * left[1], left[1] * right[1]] : [left[0] * right[1] - right[0] * left[1], left[1] * right[1]];
    if (!p.a.split('|').every((alt2) => same(value(alt2), v))) wrong.push(`${c}: ${p.q} → ${p.a}`);
    const g = gcd(v[0], v[1]); const reduced = v[1] / g === 1 ? String(v[0] / g) : `${v[0] / g}/${v[1] / g}`;
    if (!p.a.split('|').includes(reduced)) wrong.push(`${c}: ${p.q} に約分した形 ${reduced} が無い`);
  }
}
eq('3〜4年の分数4コース: 答えはどれも正しく、約分した形をふくむ', wrong.slice(0, 3), []);

// --- 保存されていたコースの掃除 ---
eq('オブジェクトでなければ空', cleanCourses('abc'), {});
eq('配列でも空', cleanCourses([1, 2]), {});
eq('配列でない値・形のちがう問題は捨て、数の答えは文字にする', cleanCourses({ a: 'x', b: [{ q: '1+1', a: 2 }, { q: 3 }, null], c: [] }), { b: [{ q: '1+1', a: '2' }] });

// --- 旧データの移しかえ ---
const det = '2年_九九';                  // 乱数で変わらない
const rnd = randomCourses[0];            // 乱数で変わる
// 旧版の答え（別解なし）のまま保存されていた 4年の分数 → 問題文が同じなので写しとして捨てる
const oldFrac = presets['4年_分数たし算（1より大きい）'].map((p) => ({ q: p.q, a: p.a.split('|')[0] }));
const legacy = {
  [det]: presets[det],
  '4年_分数たし算（1より大きい）': oldFrac,
  [rnd]: alt[rnd],                                            // 以前の端末で選ばれていた別の問題（数は同じ）
  '3年_わり算': [...presets['3年_わり算'], { q: '100÷4', a: '25' }], // 先生が1問足した
  '2年_九九あなうめ': presets['2年_九九あなうめ'].map((p, i) => (i === 0 ? { q: 'じぶんで作った問題', a: '1' } : p)), // 1問書きかえた
  'じぶんのドリル': [{ q: '2+2', a: '4' }],                      // 自作
  [LEGACY_DEFAULT_KEYS[0]]: [{ q: '1+1', a: '2' }],              // 改名前の古い名前
  'こわれた': 'abc',
};
const m = migrateLegacyCourses(legacy, {}, presets, alt, LEGACY_DEFAULT_KEYS);
eq('手を入れていない写しは捨てる', m.dropped.sort(), [det, '4年_分数たし算（1より大きい）', rnd, LEGACY_DEFAULT_KEYS[0]].sort());
eq('書きかえたプリセットは残す', m.kept.sort(), ['2年_九九あなうめ', '3年_わり算'].sort());
eq('自作コースは残す', m.courses['じぶんのドリル'], [{ q: '2+2', a: '4' }]);
eq('こわれた値は残さない', 'こわれた' in m.courses, false);
eq('保存するのは自作と書きかえだけ', Object.keys(m.courses).sort(), ['2年_九九あなうめ', '3年_わり算', 'じぶんのドリル'].sort());
const m2 = migrateLegacyCourses(legacy, { 'じぶんのドリル': [{ q: '9+9', a: '18' }] }, presets, alt, LEGACY_DEFAULT_KEYS);
eq('すでに新しい形にあるものは上書きしない', m2.courses['じぶんのドリル'], [{ q: '9+9', a: '18' }]);
eq('乱数で変わるコースで数がちがえば書きかえとみなす', isUneditedLegacyCopy(alt[rnd].slice(1), presets[rnd], alt[rnd]), false);

// --- 重ねかた ---
const merged = mergeCourses(presets, m.courses);
eq('書きかえたプリセットが勝つ', merged['3年_わり算'].length, presets['3年_わり算'].length + 1);
eq('ほかのプリセットはそのまま', merged[det], presets[det]);
eq('自作コースも入る', merged['じぶんのドリル'].length, 1);
const size = (o) => JSON.stringify(o).length;
console.log(`   （保存する量: 旧 ${size(legacy)} 文字 → 新 ${size(m.courses)} 文字）`);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
