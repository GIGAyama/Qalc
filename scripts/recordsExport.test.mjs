/* 学習ログの受け渡し口のテスト。
 * 実行: npm run test:records
 *
 * ここは「誰に渡してよいか」を決めている場所なので、
 * 通してはいけない相手を1つでも通すと学習ログがよそへ渡る。
 * 正しく通る例より、通ってはいけない例のほうを厚く並べてある。
 */
import { isAllowedOrigin, parseRecords } from '../public/records-export.js';

let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'ok' : 'NG'} ${label}`);
  if (!cond) failed++;
};

for (const o of [
  'https://giga-school.com',            // 集計ページの置き場
  'https://qalc.giga-school.com',       // 自分自身
  'https://kake-master.giga-school.com',
  'https://online-100square-calculation.giga-school.com',
]) ok(isAllowedOrigin(o) === true, `渡す: ${o}`);

for (const o of [
  'https://giga-school.com.example.com',  // 前方一致で書くと通ってしまう
  'https://evil-giga-school.com',         // 後方一致で書くと通ってしまう
  'https://giga-school.net',
  'https://gigaschool.com',
  'http://giga-school.com',               // https でない
  'https://giga-school.com:8443',         // ポートが違う
  'https://gigayama.github.io',           // 旧オリジン
  'null',                                 // sandbox iframe の origin
  '',
  undefined,
  null,
  { toString: () => 'https://giga-school.com' },
]) ok(isAllowedOrigin(o) === false, `渡さない: ${String(o)}`);

ok(isAllowedOrigin('http://localhost:5173') === true, '手元の localhost は通す');
ok(isAllowedOrigin('http://127.0.0.1:8080') === true, '手元の 127.0.0.1 は通す');
ok(isAllowedOrigin('http://localhost.evil.com') === false, 'localhost に見せかけた別ドメインは通さない');

const empty = (v) => Array.isArray(v) && v.length === 0;
ok(empty(parseRecords(null)), '記録が無いときは空の配列');
ok(empty(parseRecords('{壊れたJSON')), '壊れた JSON でも空の配列（集計側を落とさない）');
ok(empty(parseRecords('{"a":1}')), '配列でないものはそのまま返さない');
const records = [{ schema: 'study.v1', appId: 'qalc' }];
ok(JSON.stringify(parseRecords(JSON.stringify(records))) === JSON.stringify(records), '読める記録はそのまま返す');

console.log(failed === 0 ? '\nすべて合格' : `\n${failed} 件 失敗`);
process.exit(failed === 0 ? 0 : 1);
