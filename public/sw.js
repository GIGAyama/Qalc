/*
 * Qalc の Service Worker（Part I §3-3）
 *
 * 【重要1】activate では自アプリ以外のキャッシュを削除しない。
 *   いまは独自ドメイン qalc.giga-school.com がこのアプリ専用のオリジンだが、
 *   旧配信元の gigayama.github.io は数十個の学習アプリが同じドメインを共有していた。
 *   caches.keys() を全消しする書き方にすると、その形に戻したとたん
 *   他のアプリがオフラインで起動しなくなる。
 *   だから CACHE_PREFIX で始まるものだけを掃除する。
 *
 * 【重要2】この Service Worker は localStorage を一切さわらない。
 *   study.records.v1（学習ログ）をふくむ、端末に残っている記録には触れない。
 *
 * 【重要3】install では skipWaiting しない。
 *   Part I §3-3 の見本には入っているが、それだと新しい版が入った瞬間に
 *   入れかわってしまい、§3-4 の「あたらしいバージョンがあります」の
 *   お知らせを出す間がない。児童が計算しているとちゅうで勝手に切りかわるのも困る。
 *   待たせておいて、「さいしんに する」が押されたときだけ SKIP_WAITING を受けて入れかわる。
 */

// 版を上げると古いキャッシュが捨てられ、新しい成果物が配られる。
// JS/CSS をキャッシュ優先で持つので、中身をかえたら必ずここを上げること
// (上げわすれると、旧版を持った端末が新版のへやに入れず「アプリが古い」と言われつづける)
const CACHE_PREFIX = 'qalc-cache-';
const APP_VERSION = 'v7';

// 版ごとに作りなおすもの（アプリの外枠）
const CACHE_STATIC = CACHE_PREFIX + 'static-' + APP_VERSION;
// 版をまたいで残すもの（ファイル名にハッシュが付いた JS/CSS/フォント）。
// 中身が変わればファイル名も変わるので、古いものが誤って使われることはない
const CACHE_RUNTIME = CACHE_PREFIX + 'runtime-v1';

/* ビルドで作られる本体の JS と CSS。中身は vite.config.js が書きこむ。
 *
 * 【なぜ要るか】これが無いと、1回しか開いていない端末は圏外で起動できない。
 *   はじめて開いたとき、ブラウザは <script> と <link> を Service Worker より
 *   先に取りにいく。そのときページはまだ Service Worker の管理下に入っていないので、
 *   fetch のハンドラを素通りし、runtime キャッシュに1件も入らない。
 *   そのまま圏外になると、index.html はキャッシュから出るのに
 *   本体の JS が取れず、**まっ白な画面**になる。
 *   実測でも qalc-cache-runtime-v1 が作られないまま
 *   assets/index-*.js が ERR_FAILED になった。
 *
 * 【なぜ本体だけか】遅延読みこみの塊（ボスバトル・じんとり・がくしゅうどうぐ）と
 *   フォントはここに入れない。先読みが重くなると、校内 Wi-Fi に40人が
 *   ぶら下がっている時間帯に初回表示が止まる（Part I §6）。
 *   それらは実際に使われたときに runtime キャッシュへ入る。 */
const BUILD_ASSETS = [/* __BUILD_ASSETS__ */];

// ⚠️ リポジトリ名の絶対パス（旧 '/Qalc/…'）で書かない。
//    独自ドメイン qalc.giga-school.com ではアプリがドメイン直下に置かれるので、
//    そのパスには何も無く、先読みが1件残らず 404 になる。
//    cache.add の失敗は握りつぶしているため警告しか出ず、
//    「圏外で開くとまっ白」だけが静かに残る。
//    sw.js は必ずアプリ直下に置かれるので、ここからの相対で書けば
//    配信場所（ドメイン直下 / サブパス）が変わっても追随する。
const SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './pwa-install.js',
  './records-export.html',
  './records-export.js',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  ...BUILD_ASSETS,
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    // addAll は1本でも取れないと全部が失敗する。
    // 校内Wi-Fiが混んでいる時間だと1本だけ落ちることがあり、そのたびにインストールごと
    // 失敗して「オフラインで起動しない」状態になっていた。1本ずつ入れて、落ちたものは飛ばす
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' }))
        .catch((err) => console.warn('[sw] precache skipped', url, err))
    ));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_STATIC && k !== CACHE_RUNTIME)
        .map((k) => caches.delete(k))   // ← 自アプリ分だけ削除
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 画面を開くときは network-first。
  // 直したところをすぐ届けたいので、まずネットを見にいく。
  // つながらなければキャッシュの index.html、それも無ければ offline.html を出す
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (e) {
        // 圏外。まず「開こうとした画面そのもの」を探す。
        // これを飛ばして index.html から返すと、圏外では
        // 利用規約を開いてもアプリが出る、という妙な動きになる。
        return (await caches.match(request))
          || (await caches.match('./index.html'))
          || (await caches.match('./offline.html'))
          || Response.error();
      }
    })());
    return;
  }

  // JS/CSS/画像は cache-first。校内Wi-Fiに40人がぶら下がっていても即座に出る
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      // 待たずに入れる。保存に失敗しても表示は止めない
      caches.open(CACHE_RUNTIME).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  })());
});

// 「さいしんに する」が押されたときだけ入れかわる（§3-4 の更新通知と対）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
