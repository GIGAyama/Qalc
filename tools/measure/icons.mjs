/* アイコンを画素で確かめる（§3-2 の透明・§3-7 の maskable セーフゾーン）
 *
 * 追加のライブラリは要らない。ブラウザに PNG を読ませて getImageData で数える。
 */
import { chromium } from 'playwright';

import { CHROME } from './env.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:4180/Qalc/';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
await page.goto(BASE);

const result = await page.evaluate(async (base) => {
  const load = (src) => new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = base + src;
  });

  const pixels = async (src) => {
    const im = await load(src);
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(im, 0, 0);
    return { d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  };

  const out = {};

  /* ① apple-touch-icon に透明があると iOS が黒で埋める（§3-2） */
  for (const f of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon.png']) {
    const { d, w, h } = await pixels(f);
    let transparent = 0, semi = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] === 0) transparent++;
      else if (d[i] < 255) semi++;
    }
    const total = w * h;
    out[f] = {
      size: `${w}x${h}`,
      完全に透明: +(transparent / total * 100).toFixed(2) + '%',
      半透明: +(semi / total * 100).toFixed(2) + '%',
    };
  }

  /* ② maskable：中央80%の円の外側に「絵の中身」がどれだけあるか（§3-7）
   *
   * 下地(いちばん外の角の色)は切りぬかれてよいので、中身と区別して数える。
   * これを一緒に数えると実態より深刻に見える。 */
  for (const f of ['icon-maskable-192.png', 'icon-maskable-512.png']) {
    const { d, w, h } = await pixels(f);
    const at = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    // 四隅を下地の見本にする
    const corners = [at(1, 1), at(w - 2, 1), at(1, h - 2), at(w - 2, h - 2)];
    const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;
    const isBackdrop = (p) => p[3] < 8 || corners.some((c) => near(p, c, 26));

    const cx = w / 2, cy = h / 2, r = w * 0.4; // 中央80%の円
    let outsideContent = 0, totalContent = 0, outsideAll = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = at(x, y);
        const inCircle = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) <= r * r;
        const content = !isBackdrop(p);
        if (content) totalContent++;
        if (!inCircle) {
          if (p[3] > 8) outsideAll++;
          if (content) outsideContent++;
        }
      }
    }
    out[f] = {
      size: `${w}x${h}`,
      セーフゾーン外の中身: +(outsideContent / (w * h) * 100).toFixed(2) + '%',
      判定: outsideContent / (w * h) * 100 <= 0.2 ? 'OK（0.2%以下）' : 'NG（欠ける）',
      参考_下地こみの外側: +(outsideAll / (w * h) * 100).toFixed(2) + '%',
      参考_四隅の色: corners.map((c) => `rgba(${c.join(',')})`),
      参考_下地が端まで伸びているか: corners.every((c) => c[3] > 250) ? '伸びている' : '角が透明（縮んで見える）',
    };
  }

  return out;
}, BASE);

console.log(JSON.stringify(result, null, 2));
const bad = Object.entries(result).filter(([f, v]) =>
  (f.startsWith('apple-touch') && v['完全に透明'] !== '0%')
  || (f.startsWith('icon-maskable') && v['判定']?.startsWith('NG')));
if (bad.length) { console.error('❌', bad.map(([f]) => f).join(' , ')); process.exitCode = 1; }
await browser.close();
