// コースの共有コード・CSV 取りこみ・答えの検査（src/courseShare.js）のテスト。
//   実行: npm run test:share
// どれも実際に起きていた「取りこむとデータが壊れる」「その問題から先へ進めない」を止めるためのもの。
import { normalizeStr, getParsedDefaultProblems } from '../src/data/problems.js';
import {
  isTypeableAnswer, encodeCourse, decodeCourse, parseProblemText, validateProblems,
  uniqueCourseName, sanitizeCourseName, PROBLEM_MAX,
} from '../src/courseShare.js';

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('NG', name, '\n  got :', JSON.stringify(got), '\n  want:', JSON.stringify(want)); }
  else console.log('ok', name);
};

// 旧版（v1）の共有コードの作りかた。すでに配られたコードが読めることを確かめるために残す
const encodeV1 = (name, problems) => btoa(encodeURIComponent(JSON.stringify({ n: name, p: problems.map(p => `${p.q},${p.a}`).join(';') })));

// --- 答えのそろえかた（打った答えと正解を同じ形にする） ---
eq('全角の小数', normalizeStr('０．５'), '0.5');
eq('全角のマイナス', normalizeStr('－３'), '-3');
eq('数学のマイナス記号', normalizeStr('−３'), '-3');
eq('全角のかっこと分数', normalizeStr('（１）／（２）'), '(1)/(2)');
eq('位取りの「,」は取る', normalizeStr('1,000,000'), '1000000');
eq('全角の「，」も取る', normalizeStr('１，０００'), '1000');
eq('「数字, 数字」（空白あり）は位取りではない', normalizeStr('13, 16'), '13,16');
eq('空白は取る', normalizeStr(' 1 2 '), '12');

// --- テンキーで打てる答えか ---
eq('整数', isTypeableAnswer('12'), true);
eq('小数', isTypeableAnswer('0.5'), true);
eq('分数', isTypeableAnswer('3/4'), true);
eq('全角でも打てる形になる', isTypeableAnswer('０．５'), true);
eq('位取りの「,」つき', isTypeableAnswer('1,000'), true);
eq('負の数', isTypeableAnswer('-3'), true);
eq('単位つきは打てない', isTypeableAnswer('12cm'), false);
eq('「あまり」は打てない', isTypeableAnswer('3あまり1'), false);
eq('候補のどれかが打てればよい', isTypeableAnswer('いち|1'), true);
eq('分数の別解', isTypeableAnswer('1/2|2/4'), true);
eq('空は打てない', isTypeableAnswer(''), false);
eq('15文字まで', isTypeableAnswer('123456789012345'), true);
eq('16文字は答えらんに入らない', isTypeableAnswer('1234567890123456'), false);

// --- プリセットの問題は1問のこらずゲームで正解できる（ゲーム開始時に外されない） ---
const presets = getParsedDefaultProblems();
const untypeablePresets = [];
for (const [name, list] of Object.entries(presets)) list.forEach(p => { if (!isTypeableAnswer(p.a)) untypeablePresets.push(`${name}: ${p.q} → ${p.a}`); });
eq('プリセットに テンキーで打てない答えは無い', untypeablePresets.slice(0, 3), []);

// --- 共有コード: 全プリセットが往復で1文字も変わらない ---
let broken = [];
let v2Total = 0;
let v1Total = 0;
for (const [name, list] of Object.entries(presets)) {
  const code = encodeCourse(name, list);
  v2Total += code.length;
  v1Total += encodeV1(name, list).length;
  const back = decodeCourse(code);
  const same = back && back.name === name && back.problems.length === list.length
    && back.problems.every((p, i) => p.q === list[i].q && p.a === String(list[i].a));
  if (!same) broken.push(name);
}
eq('全119コースが往復で元にもどる', broken, []);
eq('コース数', Object.keys(presets).length, 119);
eq('v2 のコードは旧形式の半分より短い', v2Total < v1Total / 2, true);
console.log(`   （共有コードの合計: 旧形式 ${v1Total} 文字 → v2 ${v2Total} 文字）`);

// 問題文に「,」がある（旧版では全問こわれていた）
const dataCourse = presets['6年_ことば（データの代表値）'];
eq('「,」をふくむ問題が往復で元にもどる', decodeCourse(encodeCourse('代表値', dataCourse)).problems[0], { q: dataCourse[0].q, a: String(dataCourse[0].a) });
// 「;」と「"」と「|」をふくむ
const tricky = [{ q: 'a; b, "c"', a: '1|2' }, { q: '改行\nなし', a: '3' }];
eq('「;」「"」「|」も往復で元にもどる', decodeCourse(encodeCourse('きごう', tricky)).problems, tricky);

// --- 旧形式（v1）のコードも読める ---
eq('v1 のコードを読める', decodeCourse(encodeV1('ふつう', [{ q: '2+3', a: '5' }, { q: '1/2+1/4', a: '3/4' }])), { name: 'ふつう', problems: [{ q: '2+3', a: '5' }, { q: '1/2+1/4', a: '3/4' }] });
eq('v1 の「,」入り問題も、最後の「,」で切って元にもどす', decodeCourse(encodeV1('代表値', dataCourse.slice(0, 2))).problems, dataCourse.slice(0, 2).map(p => ({ q: p.q, a: String(p.a) })));
eq('v1 の別解「|」も残る', decodeCourse(encodeV1('分数', [{ q: '1/3+1/6', a: '1/2|3/6' }])).problems[0].a, '1/2|3/6');

// --- チャットに貼ると改行・空白が入る ---
const code = encodeCourse('九九', presets['2年_九九']);
const wrapped = code.replace(/(.{40})/g, '$1\n  ');
eq('途中の改行・空白は無視して読む', decodeCourse(wrapped)?.problems.length, 81);

// --- 壊れた・改ざんされたコードは読まない（「[object Object] を追加しました」にしない） ---
eq('空', decodeCourse(''), null);
eq('ただの文字', decodeCourse('こんにちは'), null);
eq('途中で切れた v2', decodeCourse(code.slice(0, 30)), null);
eq('途中で切れた v1', decodeCourse(encodeV1('x', [{ q: '1', a: '1' }]).slice(0, 20)), null);
eq('名前がオブジェクト', decodeCourse(encodeV1({ a: 1 }, [{ q: '1+1', a: '2' }])), null);
eq('名前が空', decodeCourse(encodeCourse('   ', [{ q: '1+1', a: '2' }])), null);
eq('予約の名前 mistakes', decodeCourse(encodeCourse('mistakes', [{ q: '1+1', a: '2' }])), null);
eq('問題が0', decodeCourse(encodeCourse('から', [])), null);
const toB64 = (s) => 'Q2:' + Buffer.from(s, 'utf8').toString('base64');
eq('版が違う', decodeCourse(toB64(JSON.stringify({ v: 3, n: 'x', p: [['1', '1']] }))), null);
eq('問題が配列でない', decodeCourse(toB64(JSON.stringify({ v: 2, n: 'x', p: 'abc' }))), null);
eq('問題の形が変なものは捨てる', decodeCourse(toB64(JSON.stringify({ v: 2, n: 'x', p: [['1+1', '2'], 'abc', [{}, '3'], ['2+2', 4]] }))).problems, [{ q: '1+1', a: '2' }, { q: '2+2', a: '4' }]);
eq('名前の改行は空白にして前後をけずる', decodeCourse(encodeCourse('  まとめ\nテスト ', [{ q: '1+1', a: '2' }])).name, 'まとめ テスト');
eq('名前は40文字まで', sanitizeCourseName('あ'.repeat(50)).length, 40);

// --- CSV（AI が出したもの・表計算からの貼りつけ） ---
eq('ふつうの CSV', parseProblemText('2+3,5\n4×5,20').rows, [{ q: '2+3', a: '5' }, { q: '4×5', a: '20' }]);
eq('見出しとコードブロックの囲みは読みとばす', parseProblemText('```csv\n問題,答え\n2+3,5\n```').rows, [{ q: '2+3', a: '5' }]);
eq('"…" で囲んだ問題文の「,」', parseProblemText('"1,000 + 2,000",3000').rows, [{ q: '1,000 + 2,000', a: '3000' }]);
eq('囲んだ中の "" は " にもどす', parseProblemText('"「""5""」は いくつ",5').rows, [{ q: '「"5"」は いくつ', a: '5' }]);
eq('囲まれていない位取りの「,」は、最後の欄を答えにする', parseProblemText('1,000 + 2,000,3000').rows, [{ q: '1,000 + 2,000', a: '3000' }]);
eq('3列めが説明なら2列めが答え', parseProblemText('2+3,5,くりあがりなし').rows, [{ q: '2+3', a: '5' }]);
eq('3列めが数（配点など）でも2列めが答え', parseProblemText('2+3,5,10').rows, [{ q: '2+3', a: '5' }]);
eq('「,」の多い代表値の問題（囲みなし）', parseProblemText('13, 16, 14, 14, 14 の 最頻値(モード)は？,14').rows, [{ q: '13, 16, 14, 14, 14 の 最頻値(モード)は？', a: '14' }]);
eq('「,」の多い数の並び（囲みなし）', parseProblemText('1,2,3,つぎは？,4').rows, [{ q: '1,2,3,つぎは？', a: '4' }]);
eq('表計算から（タブ区切り）', parseProblemText('りんご 3こと 2こ\t5\t（メモ）').rows, [{ q: 'りんご 3こと 2こ', a: '5' }]);
eq('全角の「，」区切り', parseProblemText('2+3，5').rows, [{ q: '2+3', a: '5' }]);
eq('Windows の改行', parseProblemText('2+3,5\r\n1+1,2\r\n').rows.length, 2);
eq('区切りの無い行は数える', parseProblemText('2+3,5\nこれは問題じゃない\n\n7-1,6').skipped, 1);
eq('答えが空の行は数える', parseProblemText('2+3,').skipped, 1);

// --- 保存してよい問題か ---
const v = validateProblems([
  { q: '2+3', a: '5' }, { q: '6÷4', a: '1あまり2' }, { q: '', a: '3' }, { q: 'たて3cm よこ4cm', a: '12cm' }, { q: 'a'.repeat(201), a: '1' }, { q: ' 1+1 ', a: ' ２ ' },
]);
eq('使える問題だけ残す（前後の空白はけずる）', v.ok, [{ q: '2+3', a: '5' }, { q: '1+1', a: '２' }]);
eq('使えない理由', v.bad.map(b => b.reason), ['untypeable', 'empty', 'untypeable', 'too-long']);
const many = validateProblems(Array.from({ length: PROBLEM_MAX + 5 }, (_, i) => ({ q: `${i}+0`, a: String(i) })));
eq('多すぎる分は数えて残さない', [many.ok.length, many.overflow], [PROBLEM_MAX, 5]);

// --- 同じ名前のコースを上書きしない ---
eq('空いていればそのまま', uniqueCourseName('AI_2026/11/15', ['ほか']), 'AI_2026/11/15');
eq('同じ日の2回目の AI 取りこみ', uniqueCourseName('AI_2026/11/15', ['AI_2026/11/15']), 'AI_2026/11/15 (2)');
eq('3回目', uniqueCourseName('AI_2026/11/15', ['AI_2026/11/15', 'AI_2026/11/15 (2)']), 'AI_2026/11/15 (3)');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
