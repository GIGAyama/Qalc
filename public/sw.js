/*
 * Qalc の Service Worker（Part I §3-3）
 *
 * 【重要1】activate では自アプリ以外のキャッシュを削除しない。
 *   gigayama.github.io は数十個の学習アプリが同じドメインを共有している。
 *   caches.keys() を全消しすると、他のアプリがオフラインで起動しなくなる。
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
const APP_VERSION = 'v5';

// 版ごとに作りなおすもの（アプリの外枠）
const CACHE_STATIC = CACHE_PREFIX + 'static-' + APP_VERSION;
// 版をまたいで残すもの（ファイル名にハッシュが付いた JS/CSS/フォント）。
// 中身が変わればファイル名も変わるので、古いものが誤って使われることはない
const CACHE_RUNTIME = CACHE_PREFIX + 'runtime-v1';

const SHELL = [
  '/Qalc/',
  '/Qalc/index.html',
  '/Qalc/offline.html',
  '/Qalc/manifest.webmanifest',
  '/Qalc/pwa-install.js',
  '/Qalc/favicon.png',
  '/Qalc/icon-192.png',
  '/Qalc/icon-512.png',
  '/Qalc/icon-maskable-192.png',
  '/Qalc/icon-maskable-512.png',
  '/Qalc/apple-touch-icon.png',
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
        return (await caches.match('/Qalc/index.html'))
          || (await caches.match('/Qalc/offline.html'))
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
