/* PWA の挙動を実測する（§7-5 / Part III P1 の検証項目）
 *
 * 「sw.js を読んで正しそうだった」では ✅ にできない項目ばかりを、実際に動かして確かめる。
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

import { CHROME } from './env.mjs';
const PORT = Number(process.env.PORT || 4181);
const BASE = `http://127.0.0.1:${PORT}/Qalc/`;
const DIST = new URL('../../dist/', import.meta.url).pathname;
const SW = `${DIST}/sw.js`;

const results = [];
const record = (item, ok, detail) => {
  results.push({ item, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${item.padEnd(46)} ${detail}`);
};

const browser = await chromium.launch({ executablePath: CHROME });

/* ── ① まっさらな状態で1回開く：勝手にリロードしないか ─────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  // ⚠️ framenavigated を数えてはいけない。history.pushState でも飛ぶので、
  //    端末の「戻る」でモーダルを閉じる作りのアプリでは必ず2回以上になり、
  //    正常なのに「勝手にリロードした」と誤判定する（実際に一度そう出た）。
  //    数えるべきは「文書が何回読みこまれたか」なので、addInitScript の実行回数で数える。
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem('__docLoads', String(Number(sessionStorage.getItem('__docLoads') || 0) + 1));
    } catch { /* sessionStorage が使えない環境では数えない */ }
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000); // controllerchange が飛ぶなら、この間に飛ぶ
  const docLoads = await page.evaluate(() => Number(sessionStorage.getItem('__docLoads') || 0));
  record('E8 初回訪問で勝手にリロードしない', docLoads === 1, `文書の読みこみ ${docLoads} 回（1回なら正常）`);

  /* ── ② Service Worker が実際に登録されているか ──────────────── */
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? { scope: r.scope, active: !!r.active, waiting: !!r.waiting } : null;
  });
  record('E9 Service Worker が登録されている', !!reg?.active, reg ? `scope=${reg.scope} active=${reg.active}` : '登録されていない');

  /* ── ③ 他アプリのキャッシュを巻きこまないか ──────────────────
   * 同じオリジンに別アプリのキャッシュを置いてから版を上げ、残るかを見る */
  await page.evaluate(async () => {
    const c1 = await caches.open('townmap-static-v3');
    await c1.put('/Qalc/favicon.png', new Response('よそのアプリのもの'));
    const c2 = await caches.open('keisan-card-runtime-v1');
    await c2.put('/Qalc/favicon.png', new Response('よそのアプリのもの'));
  });

  // sw.js の版を上げて、更新を起こす
  // ⚠️ 版の文字列を決め打ちしない。
  //    'v4' と書いていたら、リリースで v5 に上がった瞬間に置きかえが空振りし、
  //    「更新が起きない」を「更新が起きなかった」と取りちがえて落ちた。
  const orig = readFileSync(SW, 'utf8');
  copyFileSync(SW, SW + '.bak');
  const bumped = orig.replace(/const APP_VERSION = '[^']*'/, "const APP_VERSION = 'test-next'");
  if (bumped === orig) throw new Error('sw.js の APP_VERSION が見つからない。検査が空振りしている');
  writeFileSync(SW, bumped);

  const upd = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    await r.update();
    return true;
  });

  /* ── ④ 押すまで切りかわらないか（3秒放置） ─────────────────── */
  await page.waitForTimeout(3000);
  const state = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return {
      waiting: !!r.waiting,
      activeScript: r.active?.scriptURL,
      controllerIsOld: !!navigator.serviceWorker.controller,
      caches: await caches.keys(),
    };
  });
  record('E7 更新は押すまで切りかわらない（3秒放置）', state.waiting === true, `waiting=${state.waiting}（待機したままなら正常）`);
  record('E5 他アプリのキャッシュが残っている',
    state.caches.includes('townmap-static-v3') && state.caches.includes('keisan-card-runtime-v1'),
    `いまあるキャッシュ: ${state.caches.join(' , ')}`);

  /* ── ⑤ 押したら切りかわるか ──────────────────────────────── */
  const before = state.caches.filter((k) => k.startsWith('qalc-cache-')).join(',');
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    r.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  await page.waitForTimeout(3000);
  const after = await page.evaluate(async () => ({
    caches: await caches.keys(),
    controller: navigator.serviceWorker.controller?.scriptURL,
  }));
  const nowQalc = after.caches.filter((k) => k.startsWith('qalc-cache-'));
  record('押したら切りかわり、古いキャッシュが消える',
    nowQalc.some((k) => k.includes('test-next')) && nowQalc.length < before.split(',').length,
    `前: ${before} → 後: ${nowQalc.join(',')}`);
  record('（再確認）よそのキャッシュは切りかえ後も残る',
    after.caches.includes('townmap-static-v3') && after.caches.includes('keisan-card-runtime-v1'),
    after.caches.filter((k) => !k.startsWith('qalc-')).join(' , ') || 'なし');

  writeFileSync(SW, orig); // 元に戻す
  await ctx.close();
}

/* ── ⑥ 圏外で起動するか ─────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500); // precache が終わるのを待つ
  await ctx.setOffline(true);
  let bodyText = '';
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
    bodyText = await page.evaluate(() => document.body.innerText.slice(0, 80));
  } catch (e) { bodyText = 'エラー: ' + e.message.slice(0, 60); }
  const booted = await page.evaluate(() => !!document.querySelector('#root')?.children.length);
  record('圏外で起動する', booted, `本文の先頭: ${JSON.stringify(bodyText.replace(/\n/g, ' ').slice(0, 50))}`);

  /* ── ⑦ 本体のキャッシュが無いときに offline.html が出るか ───────── */
  await ctx.setOffline(false);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      await c.delete('/Qalc/index.html');
      await c.delete('/Qalc/');
    }
  });
  await ctx.setOffline(true);
  let offlineShown = false, offlineText = '';
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1200);
    offlineText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 60));
    offlineShown = /つながって|オフライン|ひらく|ためす/.test(offlineText);
  } catch (e) { offlineText = 'エラー: ' + e.message.slice(0, 50); }
  record('E10 本体が無ければ offline.html が出る', offlineShown, JSON.stringify(offlineText));

  /* offline.html が外部資産にも JS にも頼っていないか（静的に確認） */
  // ⚠️ 判定の前に必ずコメントを落とす。
  //    「以前は <script> で動かしていた」という説明書きに反応して、
  //    直したはずのものが直っていないと誤判定した（実際にそう出た）。
  const off = readFileSync(`${DIST}/offline.html`, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const hasScript = /<script/i.test(off);
  const hasExternal = /https?:\/\//i.test(off);
  record('E10b offline.html が JS・外部資産に頼らない', !hasScript && !hasExternal,
    `script タグ ${hasScript ? 'あり' : 'なし'} / 外部URL ${hasExternal ? 'あり' : 'なし'}`);

  await ctx.close();
}

console.log('\n' + JSON.stringify({ 合格: results.filter((r) => r.ok).length, 不合格: results.filter((r) => !r.ok).length }, null, 0));
writeFileSync(new URL('./pwa-result.json', import.meta.url), JSON.stringify(results, null, 2));
if (results.some((r) => !r.ok)) process.exitCode = 1;
await browser.close();
