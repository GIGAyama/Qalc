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
// APP_VERSION は手で上げない。tools/build-sw.mjs がビルド後に dist/sw.js の
// この行を、先読み対象の内容ハッシュで書き換える（原本のここは 'dev' のまま）。
const CACHE_PREFIX = 'qalc-cache-';
const APP_VERSION = 'dev'; /* __APP_VERSION__ */

// 版ごとに作りなおすもの（アプリの外枠）
const CACHE_STATIC = CACHE_PREFIX + 'static-' + APP_VERSION;
// 版をまたいで残すもの（ファイル名にハッシュが付いた JS/CSS/フォント）。
// 中身が変わればファイル名も変わるので、古いものが誤って使われることはない
const CACHE_RUNTIME = CACHE_PREFIX + 'runtime-v1';

/* 先読み一覧。tools/build-sw.mjs がビルド後に dist/ の実体から埋める
 * （静的ファイルは sw-build.config.json、本体の JS/CSS は dist/index.html の参照から拾う）。
 *
 * 【なぜ本体を入れるか】これが無いと、1回しか開いていない端末は圏外で起動できない。
 *   はじめて開いたとき、ブラウザは <script> と <link> を Service Worker より
 *   先に取りにいく。そのときページはまだ Service Worker の管理下に入っていないので、
 *   fetch のハンドラを素通りし、runtime キャッシュに1件も入らない。
 *   そのまま圏外になると index.html はキャッシュから出るのに本体の JS が取れず、
 *   **まっ白な画面**になる。
 *
 * 【なぜ本体だけか】遅延読みこみの塊（ボスバトル・じんとり・がくしゅうどうぐ）と
 *   フォントはここに入れない。先読みが重くなると、校内 Wi-Fi に40人が
 *   ぶら下がっている時間帯に初回表示が止まる（Part I §6）。
 *   それらは実際に使われたときに runtime キャッシュへ入る。
 *
 * ⚠️ リポジトリ名の絶対パス（旧 '/Qalc/…'）で書かない。
 *    独自ドメインではアプリがドメイン直下に置かれるため、そのパスは 404 になる。
 *    build-sw.mjs は sw.js からの相対（'./…'）で埋めるので、配信場所が変わっても追随する。 */
const PRECACHE_URLS = []; /* __PRECACHE_URLS__ */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    // addAll は1本でも取れないと全部が失敗する。
    // 校内Wi-Fiが混んでいる時間だと1本だけ落ちることがあり、そのたびにインストールごと
    // 失敗して「オフラインで起動しない」状態になっていた。1本ずつ入れて、落ちたものは飛ばす
    await Promise.all(PRECACHE_URLS.map((url) =>
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
