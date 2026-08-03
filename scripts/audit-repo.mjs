#!/usr/bin/env node
/* GIGA Standard v4 — リポジトリの現状診断（読むだけ・何も書きかえない）
 *
 *   node scripts/audit-repo.mjs <リポジトリのパス> [--json]
 *
 * Part III Phase 0「実測（推測で書かない）」を、どのリポジトリにも当てられる形にしたもの。
 * 57本を1本ずつ手で grep していられないので、同じ物差しで並べられるようにする。
 *
 * ここで見るのは「児童の画面で実際に困ること」に絞ってある。
 *   - 手書きや図がぼやける（Canvas の dpr 補正）
 *   - iPhone でボタンがホームバーに隠れる（safe-area）
 *   - スマホで画面がはみ出す（100vh 単独）
 *   - ホーム画面に置けない／更新が届かない（PWA一式）
 *   - ★他のアプリをオフラインで壊す（sw.js の caches.keys() 全消し）
 *   - ★開いたら違うアプリが立ちあがる（manifest の id がコピー元のまま）
 * ★の2つは同一オリジンに数十本が同居しているため、1本の事故が他へ波及する。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const root = process.argv[2];
const asJson = process.argv.includes('--json');
if (!root || !existsSync(root)) {
  console.error('つかいかた: node scripts/audit-repo.mjs <リポジトリのパス> [--json]');
  process.exit(2);
}

const name = basename(root);
const has = (p) => existsSync(join(root, p));
const read = (p) => (has(p) ? readFileSync(join(root, p), 'utf8') : null);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '_live', '.assets-original']);
const TEXT_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.gs', '.html', '.css', '.json']);

const files = [];
const images = [];
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full);
    else if (TEXT_EXT.has(extname(e).toLowerCase())) files.push({ path: full, size: st.size });
    else if (/\.(png|jpe?g|webp|gif)$/i.test(e)) images.push({ path: full, size: st.size });
  }
})(root);

const rel = (p) => p.replace(root + '/', '');
const texts = files.map((f) => {
  try { return { ...f, body: readFileSync(f.path, 'utf8') }; } catch { return { ...f, body: '' }; }
});

/* 「やってはいけないこと」を探すときは、その文字列が
 *   - 品質ゲートの検査そのもの（scripts/check-*.mjs、このファイル）
 *   - 「使ってはいけません」と書いてある説明のコメント
 * に出てくるぶんを数えない。最初に回したとき、Qalc も KANJI_Town も Keisan-Card も
 * この誤検知で「localStorage.clear あり」と出てしまった（実際には1つも無い）。 */
const isChecker = (p) => {
  const r = rel(p);
  // 検査・テスト用のスクリプトは児童の端末に配られない。
  // ここに localStorage.clear() があっても、それは Node 上のモックを消しているだけ。
  return /^(scripts|tools|test|tests)\//.test(r)
    || /\.(test|spec)\.[jt]sx?$/.test(r)
    || /(check|audit)-[\w-]+\.(mjs|js)$/.test(r);
};
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = texts.filter((t) => !isChecker(t.path)).map((t) => stripComments(t.body)).join('\n');

const all = texts.map((t) => t.body).join('\n');
const hit = (re) => re.test(all);
// 禁止事項の判定はコードだけを見る
const hitCode = (re) => re.test(code);
const findFiles = (re) => texts.filter((t) => re.test(t.body)).map((t) => rel(t.path));

/* ── 型の判定 ───────────────────────────────── */
let type = 'A';
if (has('vite.config.js') || has('vite.config.mjs') || has('vite.config.ts')) type = 'B';
else if (texts.some((t) => t.path.endsWith('.gs'))) type = 'C';
else if (texts.some((t) => t.path.endsWith('manifest.json') && /manifest_version/.test(t.body))) type = 'D';

/* ── PWA ─────────────────────────────────── */
const mfPath = ['public/manifest.webmanifest', 'manifest.webmanifest', 'docs/manifest.webmanifest',
  'public/manifest.json', 'manifest.json'].find((p) => has(p));
let manifest = null, manifestOk = null, manifestNote = '';
if (mfPath) {
  try {
    manifest = JSON.parse(read(mfPath));
    const { id, scope, start_url: start } = manifest;
    if (!id || !scope || !start) { manifestOk = false; manifestNote = 'id/scope/start_url のどれかが無い'; }
    else {
      // リポジトリ名の絶対パスになっているか。コピー元のまま＝別アプリと取りちがえる事故
      const paths = [id, scope, start].map((v) => String(v));
      const consistent = paths.every((v) => v.startsWith('/'));
      const seg = (String(id).match(/^\/([^/]+)\//) || [])[1] || '';
      manifestOk = consistent && !!seg;
      manifestNote = `id=${id} scope=${scope} start=${start}`;
      if (consistent && seg && seg.toLowerCase() !== name.toLowerCase().replace(/_/g, '_')) {
        manifestNote += `  ← ディレクトリ名(${name})と ${seg} が食い違う`;
      }
    }
  } catch (e) { manifestOk = false; manifestNote = 'JSON として読めない'; }
}

const swPath = ['public/sw.js', 'sw.js', 'docs/sw.js', 'service-worker.js'].find((p) => has(p));
const sw = swPath ? read(swPath) : null;
const swStrip = sw ? sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') : '';
// caches.keys() の結果を接頭辞で絞らずに消していないか（他アプリを壊す）
const swWipesAll = !!sw && /caches\.keys\(\)/.test(swStrip) && !/startsWith\(/.test(swStrip);
const swTouchesLocalStorage = !!sw && /localStorage/.test(swStrip);

const htmlPath = ['index.html', 'docs/index.html', 'public/index.html', 'App.html'].find((p) => has(p));
const html = htmlPath ? read(htmlPath) : '';

/* ── 表示 ─────────────────────────────────── */
const bareVh = [];
for (const t of texts) {
  const lines = t.body.split('\n');
  lines.forEach((line, i) => {
    if (/100vh/.test(line) && !/dvh/.test(line) && !/100dvh/.test(lines[i + 1] || '')) {
      bareVh.push(`${rel(t.path)}:${i + 1}`);
    }
  });
}
const usesCanvas = hit(/getContext\(\s*['"]2d['"]/);
const hasDpr = hitCode(/devicePixelRatio/);

/* ── 画像 ───────────────────────────────────
 *
 * 「児童の端末に配られる画像」だけを数える。
 * B型(Vite)はビルド時に public/ の中身と、src/ から import したものだけが出力される。
 * リポジトリ直下に置いてある元データ（アイコンを作るための 1024px の版など）は
 * 配られないので、数に入れると実態より重く見える。
 *
 * 実際、最初にこの区別をせずに測ったとき Quoridor を「favicon 1,102KB を配信」と
 * 報告してしまった。1,102KB はリポジトリ直下の元データで、配られているのは
 * public/favicon.png の 8KB のほうだった。 */
const isShipped = (p) => {
  if (type !== 'B') return true;                 // A型・C型は置いてあるものがそのまま配られる
  const r = rel(p);
  return r.startsWith('public/') || r.startsWith('src/') || r.startsWith('docs/');
};
const shipped = images.filter((i) => isShipped(i.path));
const notShipped = images.filter((i) => !isShipped(i.path));
const over150 = shipped.filter((i) => i.size > 153600).sort((a, b) => b.size - a.size);
const imgTotal = shipped.reduce((s, i) => s + i.size, 0);
const heavySource = notShipped.filter((i) => i.size > 153600).sort((a, b) => b.size - a.size);

/* ── 大きすぎるファイル ───────────────────── */
const bigFiles = texts
  .map((t) => ({ path: rel(t.path), lines: t.body.split('\n').length, bytes: t.size }))
  .filter((f) => f.lines > 5000 || f.bytes > 409600)
  .sort((a, b) => b.lines - a.lines);

const kb = (n) => (n / 1024).toFixed(0) + 'KB';
const mb = (n) => (n / 1024 / 1024).toFixed(1) + 'MB';

const result = {
  name, type,
  法務: {
    LICENSE: has('LICENSE'), gitignore: has('.gitignore'),
    dependabot: has('.github/dependabot.yml'),
    README: has('README.md'), MANUAL: has('MANUAL.md'),
  },
  危険: {
    // 他のアプリまで巻きこむもの
    sw_全キャッシュ削除: swWipesAll,
    sw_localStorage参照: swTouchesLocalStorage,
    manifest_id不備: mfPath ? manifestOk === false : null,
    localStorage_clear: hitCode(/localStorage\.clear\(\)/),
    postMessage_ワイルドカード: hitCode(/postMessage\([^)]*['"]\*['"]/),
  },
  表示: {
    viewport_fit: /viewport-fit=cover/.test(html),
    vh単独: bareVh.length,
    vh箇所: bareVh.slice(0, 3),
    safe_area: hitCode(/safe-area-inset/),
    clamp: hitCode(/clamp\(/),
    canvas使用: usesCanvas,
    dpr補正: usesCanvas ? hasDpr : null,
    reduced_motion: hitCode(/prefers-reduced-motion/),
    印刷CSS: hit(/@media\s+print/),
  },
  PWA: {
    manifest: mfPath || null,
    manifest詳細: manifestNote,
    sw: swPath || null,
    offline_html: has('public/offline.html') || has('offline.html') || has('docs/offline.html'),
    beforeinstallprompt: hitCode(/beforeinstallprompt/),
    更新通知: hitCode(/SKIP_WAITING/),
  },
  性能: {
    画像合計: imgTotal, 画像枚数: shipped.length,
    配信されない元データ: heavySource.map((i) => `${rel(i.path)} ${kb(i.size)}`),
    超過150KB: over150.length,
    最大画像: over150[0] ? `${rel(over150[0].path)} ${kb(over150[0].size)}` : null,
    巨大ファイル: bigFiles.slice(0, 2).map((f) => `${f.path} ${f.lines}行/${kb(f.bytes)}`),
  },
  学習ログ: {
    使用: hit(/study\.records\.v1/),
    studyLogファイル: findFiles(/STUDY_LOG_KEY/).slice(0, 2),
  },
  セキュリティ: {
    CSP: /Content-Security-Policy/.test(html),
  },
};

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

// 人が読む形。危ないものから並べる
const mark = (b) => (b === null ? '—' : b ? '✅' : '❌');
const danger = (b) => (b === null ? '—' : b ? '🚨 あり' : '✅ なし');
console.log(`\n■ ${name}（${type}型）`);
console.log(`  法務      LICENSE ${mark(result.法務.LICENSE)}  MANUAL ${mark(result.法務.MANUAL)}  dependabot ${mark(result.法務.dependabot)}`);
console.log(`  ★危険     sw全消し ${danger(result.危険.sw_全キャッシュ削除)}  manifest不備 ${danger(result.危険.manifest_id不備)}  localStorage.clear ${danger(result.危険.localStorage_clear)}`);
console.log(`  表示      viewport-fit ${mark(result.表示.viewport_fit)}  100vh単独 ${result.表示.vh単独}件  safe-area ${mark(result.表示.safe_area)}  clamp ${mark(result.表示.clamp)}`);
console.log(`            Canvas ${result.表示.canvas使用 ? `あり → dpr補正 ${mark(result.表示.dpr補正)}` : 'なし'}  動きの配慮 ${mark(result.表示.reduced_motion)}`);
console.log(`  PWA       manifest ${result.PWA.manifest || '—'}  sw ${result.PWA.sw || '—'}  offline ${mark(result.PWA.offline_html)}  install導線 ${mark(result.PWA.beforeinstallprompt)}  更新通知 ${mark(result.PWA.更新通知)}`);
if (result.PWA.manifest詳細) console.log(`            ${result.PWA.manifest詳細}`);
console.log(`  性能      配信画像 ${result.性能.画像枚数}枚 計${mb(result.性能.画像合計)}  150KB超 ${result.性能.超過150KB}枚  ${result.性能.最大画像 || ''}`);
if (result.性能.配信されない元データ.length) console.log(`            (配信されない元データ: ${result.性能.配信されない元データ.join(' / ')})`);
if (result.性能.巨大ファイル.length) console.log(`            巨大: ${result.性能.巨大ファイル.join(' / ')}`);
console.log(`  学習ログ  ${result.学習ログ.使用 ? 'study.records.v1 を使用' : '未使用'}`);
