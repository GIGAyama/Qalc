// 「さっきと おなじ」と「かだいリンク」（src/kadai.js）のテスト。
//   実行: npm run test:kadai
import { normalizePlayConfig, encodeKadai, decodeKadai, kadaiUrl, readKadaiHash, kadaiId, sanitizeKadaiTitle } from '../src/kadai.js';
import { getParsedDefaultProblems } from '../src/data/problems.js';

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('NG', name, '\n  got :', JSON.stringify(got), '\n  want:', JSON.stringify(want)); }
  else console.log('ok', name);
};

const presets = getParsedDefaultProblems();
const isPreset = (n) => Object.prototype.hasOwnProperty.call(presets, n);

// --- さっきと おなじ（保存してあった設定） ---
eq('ふつうの設定', normalizePlayConfig({ mode: 'TIME_ATTACK', courses: ['2年_九九'], minutes: 3, shuffle: false }), { mode: 'TIME_ATTACK', courses: ['2年_九九'], minutes: 3, shuffle: false });
eq('にがて克服ボックスも残す', normalizePlayConfig({ mode: 'SCORE_ATTACK', courses: ['mistakes', '2年_九九'], minutes: 5 }).courses, ['mistakes', '2年_九九']);
eq('時間は1〜10分にそろえる', [normalizePlayConfig({ mode: 'SCORE_ATTACK', courses: ['a'], minutes: 99 }).minutes, normalizePlayConfig({ mode: 'SCORE_ATTACK', courses: ['a'], minutes: 'x' }).minutes], [10, 3]);
eq('知らないモード・ドリルなし・形ちがいは null', [normalizePlayConfig({ mode: 'BOSS_RAID', courses: ['a'] }), normalizePlayConfig({ mode: 'TIME_ATTACK', courses: [] }), normalizePlayConfig('x'), normalizePlayConfig(null)], [null, null, null, null]);
eq('ドリルの名前の重なりと空は消す', normalizePlayConfig({ mode: 'TIME_ATTACK', courses: ['a', 'a', '', 5, null] }).courses, ['a']);

// --- かだいリンク: プリセットだけ ---
{
  const code = encodeKadai({ title: 'きょうの しゅくだい', mode: 'TIME_ATTACK', courses: ['2年_九九'], minutes: 3, shuffle: true });
  eq('URL に そのまま入れられる文字だけ', /^[A-Za-z0-9_-]+$/.test(code), true);
  const url = kadaiUrl('https://qalc.giga-school.com/', code);
  console.log(`  （プリセット1つのリンク: ${url.length} 文字）`);
  eq('プリセット1つのリンクは短い（QR にしやすい）', url.length < 200, true);
  eq('URL から取りだせる', readKadaiHash(new URL(url).hash), code);
  eq('読みもどせる', decodeKadai(code, isPreset), { title: 'きょうの しゅくだい', mode: 'TIME_ATTACK', courses: ['2年_九九'], minutes: 3, shuffle: true, custom: {} });
}

// --- かだいリンク: 自作のドリル（問題ごと入れる） ---
{
  const mine = [{ q: '12+7', a: '19' }, { q: 'みかんが 3こ, りんごが 2こ。ぜんぶで？', a: '5' }, { q: '1/4+5/4', a: '6/4|3/2' }];
  const code = encodeKadai({ mode: 'SCORE_ATTACK', courses: ['じぶんのドリル', '2年_九九'], minutes: 5, shuffle: false, custom: { 'じぶんのドリル': mine } });
  const k = decodeKadai(code, isPreset);
  eq('自作の問題が そのままもどる（「,」があっても）', k.custom['じぶんのドリル'], mine);
  eq('自作とプリセットをまぜられる', k.courses, ['じぶんのドリル', '2年_九九']);
  eq('時間とランダム', [k.minutes, k.shuffle, k.title], [5, false, '']);
}

// --- 読めないもの・あやしいもの ---
{
  eq('こわれた文字は null', [decodeKadai('!!!', isPreset), decodeKadai('', isPreset), decodeKadai(null, isPreset), decodeKadai('eyJ2IjoxfQ', isPreset)], [null, null, null, null]);
  eq('知らないモードは null', decodeKadai(encodeKadai({ mode: 'BOSS_RAID', courses: ['2年_九九'] }), isPreset), null);
  eq('この端末で出せないドリル（プリセットでも、問題も無い）は外す', decodeKadai(encodeKadai({ mode: 'TIME_ATTACK', courses: ['どこにもない', '2年_九九'] }), isPreset).courses, ['2年_九九']);
  eq('出せるドリルが1つも無ければ null', decodeKadai(encodeKadai({ mode: 'TIME_ATTACK', courses: ['どこにもない'] }), isPreset), null);
  eq('にがて克服ボックスは かだいに入れない', decodeKadai(encodeKadai({ mode: 'TIME_ATTACK', courses: ['mistakes', '2年_九九'] }), isPreset).courses, ['2年_九九']);
  const bad = encodeKadai({ mode: 'TIME_ATTACK', courses: ['じぶん'], custom: { 'じぶん': [{ q: '1+1', a: '2' }, { q: '長さ', a: '12cm' }, { q: '', a: '1' }] } });
  eq('テンキーで打てない答え・空の問題は外す', decodeKadai(bad, isPreset).custom['じぶん'], [{ q: '1+1', a: '2' }]);
  eq('タイトルは20文字まで・制御文字なし', sanitizeKadaiTitle('あ\nい' + 'う'.repeat(30)).length, 20);
  eq('長すぎるリンクは読まない', decodeKadai('A'.repeat(400001), isPreset), null);
  eq('#kadai= の形でなければ取りださない', [readKadaiHash('#host=123'), readKadaiHash('#kadai=a+b'), readKadaiHash('')], [null, null, null]);
  // 手で書きかえたリンク: 名前の列にない問題・数でない時間・ふえすぎた問題
  const big = Array.from({ length: 2500 }, (_, i) => ({ q: `${i}+1`, a: String(i + 1) }));
  const k = decodeKadai(encodeKadai({ mode: 'SCORE_ATTACK', courses: ['おおい'], minutes: 'abc', custom: { 'おおい': big } }), isPreset);
  eq('問題は2000問まで・時間は3分', [k.custom['おおい'].length, k.minutes], [2000, 3]);
}

// --- 同じリンクは同じ印 ---
{
  const a = encodeKadai({ mode: 'TIME_ATTACK', courses: ['2年_九九'] });
  const b = encodeKadai({ mode: 'TIME_ATTACK', courses: ['2年_九九'], minutes: 3 });
  const c = encodeKadai({ mode: 'SUDDEN_DEATH', courses: ['2年_九九'] });
  eq('同じ中身なら同じ印、ちがえばちがう印', [kadaiId(a) === kadaiId(b), kadaiId(a) === kadaiId(c)], [true, false]);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
