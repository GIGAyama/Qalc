// 学習ログ（study.v1）の組み立てを、ブラウザAPIのスタブ上で検証する。
//   実行: npm run test:studylog
// 仕様書「学習ログ共通スキーマ仕様書 study.v1」の必須項目・集計規則を守れているかを確かめる。
// studySession.js / studyLog.js を直せなくなる前に、ここのテストを通すこと。
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
};
// node には crypto.randomUUID がある

const { createStudySession, buildUnit, sourceOf, itemIdOf } = await import('../src/studySession.js');

const read = () => JSON.parse(localStorage.getItem('study.records.v1') || '[]');
let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('NG', name, '\n  got :', JSON.stringify(got), '\n  want:', JSON.stringify(want)); }
  else console.log('ok', name);
};

// --- 単元ID / 出題元 ---
eq('unit single', buildUnit(['2年_九九'], '2年_九九'), { id: 'g2-kuku-all', title: '2年_九九', preset: true, grade: 2 });
eq('unit legacy = current', buildUnit(['4年_小数x整数'], 'x').id, buildUnit(['4年_小数×整数'], 'y').id);
eq('unit custom', buildUnit(['じぶんのドリル'], 'じぶんのドリル').preset, false);
eq('unit mix', buildUnit(['2年_九九', '2年_分数'], '2年_九九、2年_分数').id, 'mix-g2-fraction+g2-kuku-all');
eq('unit mix grade', buildUnit(['2年_九九', '2年_分数'], '').grade, 2);
eq('unit mix cross grade', buildUnit(['2年_九九', '3年_わり算'], '').grade, undefined);
eq('source weak', sourceOf(['mistakes', '2年_九九']), 'weak');
eq('source custom', sourceOf(['じぶんのドリル']), 'custom');
eq('source course', sourceOf(['2年_九九']), 'course');
eq('item id expr', itemIdOf('8 + 9'), '8+9');
eq('item id word is hashed', itemIdOf('りんごが 3こ あります。'), itemIdOf('りんごが 3こ あります。'));
eq('item id word not raw', /^w-/.test(itemIdOf('りんごが 3こ あります。')), true);

// --- スコアアタック: 1問目を1回まちがえる ---
const s = createStudySession({ gameMode: 'SCORE_ATTACK', courseName: '2年_九九', courseNames: ['2年_九九'], multiplayer: false });
s.present('3×4');
s.answer(false, '11');
s.answer(true, '12');
s.present('5×6');
s.answer(true, '30');
s.present('7×8');   // 時間切れ時に画面に出ていた問題（未着手）
s.save({ status: 'completed', ext: { maxCombo: 2, level: 4 } });
let r = read()[0];
eq('schema', r.schema, 'study.v1');
eq('appId', r.appId, 'qalc');
eq('mode', r.mode, 'scoreattack');
eq('kind', r.kind, 'session');
eq('grading', r.grading, 'objective');
eq('timeBasis', r.timeBasis, 'app');
eq('summary', r.summary, { count: 3, attempted: 2, firstTryCorrect: 1, correct: 2 });
eq('items len (未着手は含めない)', r.items.length, 2);
eq('item1', { q: r.items[0].q, ok: r.items[0].ok, firstTry: r.items[0].firstTry, tries: r.items[0].tries, wrong: r.items[0].wrong }, { q: '3×4', ok: true, firstTry: false, tries: 2, wrong: ['11'] });
eq('activeMs <= elapsedMs', r.activeMs <= r.elapsedMs, true);
eq('startedAt ISO', !Number.isNaN(Date.parse(r.startedAt)), true);
eq('ext', r.ext, { maxCombo: 2, level: 4, feverCount: 0, tools: [] });
eq('unit', r.unit.id, 'g2-kuku-all');
s.dispose();

// --- 1問も解答していない中断は保存しない ---
store.clear();
const s2 = createStudySession({ gameMode: 'SUDDEN_DEATH', courseName: 'x', courseNames: ['2年_九九'] });
s2.present('3×4');
eq('empty abort not saved', s2.save({ status: 'aborted' }), null);
eq('log still empty', read().length, 0);
// 中断で締めたあとも、画面に出ていた問題は次のレコードで出題しなおす
s2.answer(true, '12');
s2.save({ status: 'aborted' });
eq('carried over', read()[0].summary, { count: 1, attempted: 1, firstTryCorrect: 1, correct: 1 });
s2.dispose();

// --- タイムアタック: 中断すると未着手が count-attempted に出る ---
store.clear();
const s3 = createStudySession({ gameMode: 'TIME_ATTACK', courseName: 'x', courseNames: ['mistakes'], plannedCount: 20 });
s3.present('8+9'); s3.answer(true, '17');
s3.present('7+6'); s3.answer(false, '12'); s3.answer(true, '13');
s3.save({ status: 'aborted' });
r = read()[0];
eq('timeattack count', r.summary, { count: 20, attempted: 2, firstTryCorrect: 1, correct: 2 });
eq('timeattack status', r.status, 'aborted');
eq('timeattack source', r.source, 'weak');
eq('timeattack unit', r.unit.id, 'weakness-box');
// 2レコード目は planned を持ちこさない
s3.present('9+4'); s3.answer(true, '13');
s3.save({ status: 'completed' });
eq('second record count', read()[1].summary.count, 1);
s3.dispose();

// --- どうぐ・フィーバー・マルチ ---
store.clear();
const s4 = createStudySession({ gameMode: 'BOSS_RAID', courseName: 'x', courseNames: ['3年_わり算'], multiplayer: true });
s4.present('12÷3');
s4.markTool('array');
s4.markFever();
s4.answer(true, '4');
s4.save({ status: 'completed', ext: { bossDefeated: 2 } });
r = read()[0];
eq('multiplayer flag', r.multiplayer, true);
eq('mode boss', r.mode, 'boss');
eq('hint', r.items[0].hint, true);
eq('ext tools/fever', { t: r.ext.tools, f: r.ext.feverCount, b: r.ext.bossDefeated }, { t: ['array'], f: 1, b: 2 });
s4.dispose();

// --- 誤答のサニタイズ ---
store.clear();
const s5 = createStudySession({ gameMode: 'SCORE_ATTACK', courseName: 'x', courseNames: ['2年_九九'] });
s5.present('3×4');
s5.answer(false, '<script>alert(1)</script>');
s5.answer(false, '1234567890123');
s5.answer(true, '12');
s5.save({});
// 記号まじりの入力は破棄、長すぎる入力は12文字に切り詰める（仕様書 §2.10）
eq('wrong sanitized', read()[0].items[0].wrong, ['123456789012']);
s5.dispose();

// --- 保存済みログが壊れていても復帰できる ---
store.clear();
localStorage.setItem('study.records.v1', '{壊れたJSON');
const s6 = createStudySession({ gameMode: 'SCORE_ATTACK', courseName: 'x', courseNames: ['2年_九九'] });
s6.present('3×4'); s6.answer(true, '12'); s6.save({});
eq('recovered from broken log', read().length, 1);
s6.dispose();

// --- 上限500件 ---
store.clear();
localStorage.setItem('study.records.v1', JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ schema: 'study.v1', appId: 'qalc', i }))));
const s7 = createStudySession({ gameMode: 'SCORE_ATTACK', courseName: 'x', courseNames: ['2年_九九'] });
s7.present('3×4'); s7.answer(true, '12'); s7.save({});
eq('capped at 500', read().length, 500);
eq('oldest dropped', read()[0].i, 1);
s7.dispose();

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
