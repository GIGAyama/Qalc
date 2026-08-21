#!/usr/bin/env node
/* GIGA Standard v4 品質ゲート
 *
 * Part II Phase 7 の監査表 A〜G のうち、機械で判定できるものを毎回たしかめる。
 * 目視が要るもの（コントラスト比・実機での見えかた）はここでは扱わない。
 *
 * つかいかた:
 *   npm run check          … 全部みる。dist が無ければサイズの検査だけ飛ばす
 *   npm run check -- --build … 先に npm run build をしてから全部みる
 *
 * 落ちたときに検査をゆるめないこと。
 * どうしても通せない理由があるときは quality.config.json の securityExceptions に
 * 理由を書いて明示的に許可する（黙って条件を下げると、次の人が事故に気づけない）。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const cfg = JSON.parse(readFileSync(join(ROOT, 'quality.config.json'), 'utf8'));
const P = cfg.paths;

const results = [];
const ok = (id, title, detail = '') => results.push({ id, title, status: 'ok', detail });
const ng = (id, title, detail = '') => results.push({ id, title, status: 'ng', detail });
const skip = (id, title, detail = '') => results.push({ id, title, status: 'skip', detail });
const check = (id, title, cond, detail = '') => (cond ? ok : ng)(id, title, detail);

const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);
const has = (p) => existsSync(join(ROOT, p));

/* コメントを落としてから中身をみる。
 * 「localStorage をさわらない」と説明のコメントに書いてあるだけで
 * 検査に引っかかる、といったことを起こさないため。
 * 文字列の中の // までは考えないが、この用途にはこれで足りる。 */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** ソースファイルを再帰的に集める（node_modules と dist は見ない） */
function sourceFiles(exts = ['.js', '.jsx', '.mjs', '.css', '.html']) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (exts.includes(extname(name))) out.push(full);
    }
  };
  for (const d of P.sourceDirs) if (has(d)) walk(join(ROOT, d));
  return out;
}
const allSource = sourceFiles();
const sourceText = allSource.map((f) => readFileSync(f, 'utf8')).join('\n');

const kb = (n) => (n / 1024).toFixed(1) + 'KB';
const sizeOf = (p) => (has(p) ? statSync(join(ROOT, p)).size : 0);

// ── A. 法務・配布 ─────────────────────────────────
check('A1', 'LICENSE の実ファイルがある', has('LICENSE'));
check('A2', '.gitignore がある', has('.gitignore'));
check('A3', 'dependabot.yml がある', has('.github/dependabot.yml'));
check('A4', 'README.md と MANUAL.md が両方ある', has('README.md') && has('MANUAL.md'));

// 秘密情報がコミットされていないか（値そのものは出さない。ファイル名だけ）
{
  let tracked = '';
  try { tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { /* git が無くても続ける */ }
  const bad = tracked.split('\n').filter((f) => /(^|\/)(\.env|\.clasp\.json)$/.test(f));
  check('A5', '.env / .clasp.json をコミットしていない', bad.length === 0, bad.join(', '));
}

// ── B. セキュリティ ───────────────────────────────
const indexHtml = read(P.indexHtml) || '';
{
  const m = indexHtml.match(/Content-Security-Policy"\s+content="([^"]+)"/);
  check('B1a', 'index.html に CSP がある', !!m);
  if (m) {
    const csp = m[1];
    const connect = (csp.match(/connect-src ([^;]+)/) || [, ''])[1];
    check('B1b', 'connect-src にワイルドカードが無い', !/\*/.test(connect), connect.trim());
    check('B1c', "script-src が 'self' で閉じている",
      /script-src 'self'(;|\s*$)/.test(csp) || /script-src 'self';/.test(csp));
  }
}
{
  /* ありがちな直書き。
   * 前半4つは SchoolPlan_Editor/scripts/lib/project-quality.mjs（品質ゲートの正本）の
   * detectSecretCandidates と同じパターン。正本は GAS(C型)むけで、こちらは
   * 表示とPWA(B型)むけと守備範囲が違うが、「秘密情報を配ってしまわない」ことは
   * 型によらず共通なので、そこだけ揃えている。 */
  const patterns = [
    [/AIza[0-9A-Za-z_-]{35}/, 'Google APIキー'],
    [/(?:ghp|github_pat)_[0-9A-Za-z_]{20,}/, 'GitHub のトークン'],
    [/sk-[0-9A-Za-z_-]{32,}/, 'OpenAI のAPIキー'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, '秘密鍵'],
    [/\b1[A-Za-z0-9_-]{43}\b/, 'スプレッドシートIDらしき文字列'],
    [/[\w.+-]+@(?!example\.)[\w-]+\.[\w.]+/, 'メールアドレス'],
  ];
  const hits = [];
  for (const f of allSource) {
    const t = stripComments(readFileSync(f, 'utf8'));
    for (const [re, label] of patterns) if (re.test(t)) hits.push(`${f.replace(ROOT + '/', '')}: ${label}`);
  }
  check('B2', '秘密情報・IDの直書きが無い', hits.length === 0, hits.join(' / '));
}
{
  /* マージの跡が残ったまま配られていないか（正本の MERGE_CONFLICT_MARKER と同じ）。
   * 残っていると画面に <<<<<<< がそのまま出るか、構文エラーで真っ白になる。 */
  const bad = [];
  for (const f of allSource) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^(<<<<<<<|=======|>>>>>>>)(\s|$)/.test(line)) bad.push(`${f.replace(ROOT + '/', '')}:${i + 1}`);
    });
  }
  check('B6', 'マージの跡（<<<<<<<）が残っていない', bad.length === 0, bad.join(', '));
}
check('B4', "postMessage の宛先が '*' でない", !/postMessage\([^)]*['"]\*['"]/.test(sourceText));

// ── C. 堅牢性 ────────────────────────────────────
check('C3', 'pagehide で記録を確定している', /pagehide/.test(sourceText));
check('C5', 'localStorage.clear() を使っていない', !/localStorage\.clear\(\)/.test(sourceText));

// ── D. 表示（Part I §2）─────────────────────────
check('D1', 'viewport に viewport-fit=cover', /viewport-fit=cover/.test(indexHtml));
{
  // 100vh を単独で使っていないか（フォールバックとして dvh と並べてあるものは可）
  const bad = [];
  for (const f of allSource) {
    const t = readFileSync(f, 'utf8');
    t.split('\n').forEach((line, i) => {
      if (/100vh/.test(line) && !/dvh/.test(line) && !/100dvh/.test(t.split('\n')[i + 1] || '')) {
        bad.push(`${f.replace(ROOT + '/', '')}:${i + 1}`);
      }
    });
  }
  check('D2', '100vh を単独で使っていない', bad.length === 0, bad.join(', '));
}
check('D3', 'safe-area-inset を使っている', /safe-area-inset/.test(sourceText));
check('D4', 'clamp() で文字サイズを追従させている',
  /clamp\(/.test(sourceText) || /clamp\(/.test(read('tailwind.config.js') || ''));
{
  const usesCanvas = /getContext\(['"]2d['"]/.test(sourceText);
  if (!usesCanvas) skip('D5', 'Canvas の devicePixelRatio 補正', 'Canvas を使っていない');
  else check('D5', 'Canvas に devicePixelRatio 補正がある', /devicePixelRatio/.test(sourceText));
}
check('D9', 'touch-action を指定している', /touch-action/.test(sourceText));
check('D10', 'prefers-reduced-motion に対応している', /prefers-reduced-motion/.test(sourceText));

// 画像の大きさ
{
  const imgs = [];
  const walkImg = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walkImg(full);
      else if (/\.(png|jpe?g|webp)$/i.test(name)) imgs.push(full);
    }
  };
  if (has(P.iconDir)) walkImg(join(ROOT, P.iconDir));
  const over = imgs.filter((f) => statSync(f).size > cfg.limits.imageBytes)
    .map((f) => `${f.replace(ROOT + '/', '')} ${kb(statSync(f).size)}`);
  check('D7a', `画像が ${kb(cfg.limits.imageBytes)} 以下`, over.length === 0, over.join(', '));

  const i512 = sizeOf(`${P.iconDir}/icon-512.png`);
  check('D7b', `icon-512.png が ${kb(cfg.limits.icon512Bytes)} 以下`,
    i512 > 0 && i512 <= cfg.limits.icon512Bytes, kb(i512));
  const fav = sizeOf(`${P.iconDir}/favicon.png`);
  check('D7c', `favicon.png が ${kb(cfg.limits.faviconBytes)} 以下`,
    fav > 0 && fav <= cfg.limits.faviconBytes, kb(fav));
}

// ── E. PWA（Part I §3）──────────────────────────
{
  const raw = read(P.manifest);
  if (!raw) ng('E1', 'manifest がある');
  else {
    const m = JSON.parse(raw);
    // 正しい値は「どこで配信するか」で変わる。
    // 独自ドメイン（CNAME あり）だとアプリは qalc.giga-school.com の直下に置かれる。
    // ここで /Qalc/ のままにすると scope がページの URL を含まなくなり、
    // manifest ごと無視されて PWA としてインストールできなくなる。
    // CNAME が無ければ従来どおり共有オリジンのサブディレクトリ配信なので、
    // リポジトリ名の絶対パスでないと同居する別アプリと取り違えられる。
    const hasCname = has('CNAME') || has('public/CNAME');
    const want = hasCname ? './' : `/${cfg.repoName}/`;
    check('E1', 'manifest の id/scope/start_url が配信場所と合っている',
      m.id === want && m.scope === want && m.start_url?.startsWith(want),
      `id=${m.id} scope=${m.scope} start_url=${m.start_url}（期待: ${want}）`);
    check('E1b', 'display_override と launch_handler がある',
      Array.isArray(m.display_override) && !!m.launch_handler);

    // manifest だけ直しても、Service Worker の登録先と先読み一覧が
    // 旧構成のリポジトリ名の絶対パス（/Qalc/…）のままだと、
    // 登録も先読みも全件 404 になる。どちらも失敗を握りつぶす作りなので、
    // 画面にもコンソールにも何も出ないまま
    // 「オフラインで開けない・インストールできない」だけが静かに残る。
    // 実際にこの形で残っていたので、機械で見張る。
    if (hasCname) {
      const stale = `/${cfg.repoName}/`;
      // ⚠️ 判定の前にコメントを落とすこと。
      //    落とさないと、この決まりを説明したコメント自身
      //    （「旧 '/Qalc/sw.js' で書かない」）に反応して落ちる。
      //    正しく直して理由を書き残したファイルほど落ちるという、
      //    いちばん困る形になる。offline.html のぶんは HTML コメントも落とす。
      const stripAll = (src) => stripComments(src).replace(/<!--[\s\S]*?-->/g, ' ');
      const offenders = [P.serviceWorker, 'src/pwa.jsx', P.offlineHtml]
        .map((f) => [f, stripAll(read(f) || '')])
        .filter(([, src]) => src.includes(`'${stale}`) || src.includes(`"${stale}`))
        .map(([f]) => f);
      check('E1c', 'SW の登録先と先読みがリポジトリ名の絶対パスになっていない',
        offenders.length === 0,
        offenders.length ? `${stale} が残っている: ${offenders.join(' , ')}` : `${stale} は残っていない`);
    }
    const purposes = (m.icons || []).map((i) => `${i.sizes}:${i.purpose}`);
    check('E2a', 'アイコン4種が manifest にある',
      ['192x192:any', '512x512:any', '192x192:maskable', '512x512:maskable']
        .every((p) => purposes.includes(p)), purposes.join(' '));
  }
  check('E2b', 'アイコンの実ファイルが5つある',
    ['icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png']
      .every((f) => has(`${P.iconDir}/${f}`)));
}
{
  // beforeinstallprompt を <head> のできるだけ上で受け取っているか。
  // 外部ファイルに分けている場合は、その <script> の位置を見る
  const headEnd = indexHtml.indexOf('</head>');
  const head = headEnd > 0 ? indexHtml.slice(0, headEnd) : indexHtml;
  const inline = head.indexOf('beforeinstallprompt');
  const external = head.match(/<script[^>]+src="([^"]*pwa-install[^"]*)"/);
  const externalFile = external ? read(join('public', external[1].replace(/^\//, ''))) : null;
  const captured = inline >= 0 || (externalFile && /beforeinstallprompt/.test(externalFile));
  check('E3', 'beforeinstallprompt を head で受け取っている', !!captured,
    external ? `外部ファイル ${external[1]}（head 内 ${head.slice(0, head.indexOf(external[0])).split('<').length - 1} 番目のタグ）` : '');
}
check('E4', 'アプリ内にインストールの導線がある',
  /__deferredInstallPrompt/.test(sourceText) && /display-mode: standalone/.test(sourceText));
{
  const sw = read(P.serviceWorker);
  if (!sw) ng('E5', 'sw.js がある');
  else {
    // caches.keys() の結果を接頭辞で絞らずに全部消していないか
    const filtersByPrefix = /startsWith\(\s*CACHE_PREFIX/.test(sw) || /startsWith\(['"][\w-]+-['"]\)/.test(sw);
    check('E5', 'sw.js が自アプリ接頭辞のキャッシュだけを消す', filtersByPrefix);
    check('E6', 'sw.js が localStorage にさわっていない', !/localStorage/.test(stripComments(sw)));
    // 版は手で上げず tools/build-sw.mjs がビルド後に dist/sw.js を書き換える
    // （手動運用は 2026-08-21 に全リポジトリで上げ忘れる事故を起こした）
    check('E9', 'sw.js の版が自動生成の形になっている',
      /APP_VERSION = '[^']*'; \/\* __APP_VERSION__ \*\//.test(sw) && has('tools/build-sw.mjs'));
    check('E8b', 'sw.js が offline.html をキャッシュしている', /offline\.html/.test(sw));
  }
}
/* E8c ── 圏外で起動できるか（先読みに本体の JS/CSS が入っているか）
 *
 * これが無いと、1回しか開いていない端末が圏外でまっ白になる。
 * はじめて開いたときの <script>/<link> は Service Worker が管理下に入る前に
 * 取りにいくので fetch のハンドラを素通りし、runtime キャッシュに入らない。
 * 2回目からは入るので、手で試すと気づけないことがある。
 *
 * ファイル名にハッシュが付くため、vite.config.js がビルド時に書きこんでいる。
 * ここでは「dist/index.html が読んでいる本体が、dist/sw.js に全部あるか」を見る。
 * 目印(__BUILD_ASSETS__)が残ったままなら、書きこみが空振りしている。 */
{
  const distSw = read(join(P.distDir, 'sw.js'));
  const distHtml = read(join(P.distDir, 'index.html'));
  if (!distSw || !distHtml) {
    skip('E8c', '圏外で起動できる（本体を先読みしている）', 'dist が無い。npm run build のあとに実行すること');
  } else if (distSw.includes("APP_VERSION = 'dev'")) {
    ng('E8c', '圏外で起動できる（本体を先読みしている）', "dist の版が 'dev' のまま＝build-sw が走っていない");
  } else {
    // base を相対パスにしたので参照は "./assets/…" になる。旧構成の "/Qalc/assets/…" も拾う。
    const entry = [...distHtml.matchAll(/(?:src|href)="((?:\.\/|\/[^"]*\/)assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
    const missing = entry.filter((u) => !distSw.includes(u));
    check('E8c', '圏外で起動できる（本体を先読みしている）',
      entry.length > 0 && missing.length === 0,
      missing.length ? `先読みに無い: ${missing.join(' , ')}` : `本体 ${entry.length} 件を先読みしている`);
  }
}
check('E7', '更新のお知らせを出している',
  /SKIP_WAITING/.test(sourceText) && /updatefound/.test(sourceText));
check('E8', 'offline.html がある', has(P.offlineHtml));
check('E10', 'MANUAL に iOS のホーム画面追加手順がある',
  /ホーム画面に追加/.test(read('MANUAL.md') || ''));

// ── F. 性能・保守性 ──────────────────────────────
{
  const over = [];
  for (const f of allSource) {
    const t = readFileSync(f, 'utf8');
    const lines = t.split('\n').length;
    const bytes = Buffer.byteLength(t);
    if (lines > cfg.limits.fileLines || bytes > cfg.limits.fileBytes) {
      over.push(`${f.replace(ROOT + '/', '')} ${lines}行/${kb(bytes)}`);
    }
  }
  check('F4', `1ファイル ${cfg.limits.fileLines}行 / ${kb(cfg.limits.fileBytes)} 以内`,
    over.length === 0, over.join(', '));
}
{
  const dist = join(ROOT, P.distDir, 'assets');
  if (!existsSync(dist)) {
    skip('F3', '初回JSの大きさ', 'dist が無い（npm run build のあとに測る）');
  } else {
    const entry = readdirSync(dist).filter((f) => /^index-.*\.js$/.test(f));
    const bytes = entry.reduce((s, f) => s + statSync(join(dist, f)).size, 0);
    const limit = cfg.limits.initialJsBytes;
    check('F3', `初回JS が ${kb(limit)} 以下`, bytes <= limit,
      `${kb(bytes)}（Part I の目標は ${kb(cfg.limits.initialJsTarget)}）`);
  }
}

// ── G. 学習ログ ─────────────────────────────────
{
  const log = read('src/studyLog.js');
  if (!log) skip('G1', 'study.v1 準拠', 'studyLog.js が無い');
  else {
    check('G1a', "保存先が localStorage['study.records.v1']", /study\.records\.v1/.test(log));
    check('G1b', '学習ログを外部送信していない', !/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(log));
    check('G1c', '氏名・出席番号・メールを持たない',
      !/(氏名|出席番号|studentName|email)/.test(log));
  }
  check('G2', '中断記録と5分ルールがある',
    /aborted/.test(sourceText) && /5 \* 60 \* 1000|300000/.test(sourceText));

  /* 共通ロジックの版ずれの検知（Part III P3「共通ロジックを正本と差分確認し、揃える」）
   *
   * studyLog.js は GIGA山の学習アプリ全体で同じ動きをすることになっている。
   * 実際に3本（Qalc / KANJI_Town / Keisan-Card）を突き合わせたところ、
   * ロジック版1.1の中身は一致していた。ちがうのは書き方だけで、
   *   B型(Vite) … ESM（export function）
   *   A型(単一HTML) … IIFE（global.StudyLog）
   * とアプリの型に合わせてあるためで、これは版ずれではない。
   *
   * ここでは「版の表記」と「変わってはいけない値」だけを見る。
   * 全文を比べないのは、上のとおり書き方が型ごとに違ってよいから。 */
  if (log) {
    check('G3', 'studyLog のロジック版が明記されている', /ロジック版[：: ]*\*{0,2}1\.1/.test(log),
      (log.match(/ロジック版[：: ]*\*{0,2}[\d.]+/) || ['見あたらない'])[0]);
    const invariants = [
      [/STUDY_LOG_MAX\s*=\s*500/, '上限500件'],
      [/STUDY_ITEMS_MAX\s*=\s*200/, '設問200件'],
      [/schema:\s*'study\.v1'/, "schema: 'study.v1'"],
      [/length\s*<=\s*12/, '誤答は12文字まで'],
    ];
    const missing = invariants.filter(([re]) => !re.test(log)).map(([, label]) => label);
    check('G4', '共通ロジックの決まった値が変わっていない', missing.length === 0,
      missing.length ? `ちがっている: ${missing.join(' / ')}` : '上限500件・設問200件・study.v1・誤答12文字');
  }
}

// ── 出力 ────────────────────────────────────────
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const mark = { ok: '✅', ng: '❌', skip: '➖' };

console.log(`\nGIGA Standard v4 品質ゲート — ${cfg.repoName}（${cfg.type}型）\n`);
for (const r of results) {
  console.log(`${mark[r.status]} ${pad(r.id, 5)} ${pad(r.title, 48)} ${r.detail}`);
}

if (cfg.securityExceptions?.length) {
  console.log('\n明示的に許可しているもの（securityExceptions）:');
  for (const e of cfg.securityExceptions) console.log(`  ・${e.id} — ${e.reason}`);
}

const failed = results.filter((r) => r.status === 'ng');
const skipped = results.filter((r) => r.status === 'skip');
console.log(`\n合格 ${results.length - failed.length - skipped.length} / 不合格 ${failed.length} / 対象外 ${skipped.length}`);

if (failed.length) {
  console.log('\n落ちた項目:');
  for (const r of failed) console.log(`  ❌ ${r.id} ${r.title}${r.detail ? ' — ' + r.detail : ''}`);
  console.log('\n検査をゆるめて通さないこと。理由があるなら quality.config.json に書いて明示的に許可する。');
  process.exit(1);
}
console.log('すべて合格。\n');
