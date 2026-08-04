/* 測定ツールが環境に依存しないようにするところ。
 *
 * Chromium の場所は環境によって違う。
 *  - CHROME_PATH を指定していればそれを使う
 *  - PLAYWRIGHT_BROWSERS_PATH の下にあればそれを探す
 *  - どちらも無ければ playwright に任せる（undefined を返す）
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const findChromium = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(root, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
};

export const CHROME = findChromium();
export const BASE_ORIGIN = process.env.BASE_ORIGIN || 'http://127.0.0.1:4180';
