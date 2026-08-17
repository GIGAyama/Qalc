import { defineConfig } from 'vite'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirnameLike = dirname(fileURLToPath(import.meta.url))
import react from '@vitejs/plugin-react'

// 開発サーバ(npm run dev)では index.html の CSP を外す。
// Vite の HMR は WebSocket と インラインスクリプト(React Refresh の前口上)を使うため、
// 本番用の厳しい CSP のままでは開発ができない。
// → CSP の検証は「npm run build && npm run preview」で、本番と同じ成果物に対しておこなう。
const stripCspInDev = {
  name: 'strip-csp-in-dev',
  apply: 'serve',
  transformIndexHtml(html) {
    return html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  },
}

// フォントは woff2 だけを配る。
// fontsource の CSS は 1つの src に woff2 と woff(旧形式)を並べているため、
// そのままだと だれも使わない woff が成果物に約7MBぶん入ってしまう。
// woff2 は 2016年以降のブラウザがすべて対応しており、児童用Chromebookでも問題ない。
//
// enforce:'pre' が要る: Vite は url() を書きかえながら参照先をアセットとして登録するので、
// それより前に CSS の文字列から woff を落とさないと、ファイルだけが出力されてしまう
// (PostCSS プラグインでは間に合わない)。
const dropLegacyWoff = {
  name: 'drop-legacy-woff',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('@fontsource') || !id.endsWith('.css')) return null
    return {
      code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, ''),
      map: null,
    }
  },
}

// ビルドで出来た「本体の JS と CSS」を sw.js の先読み一覧に書きこむ。
//
// これが無いと、1回しか開いていない端末が圏外で起動できない。
// はじめて開いたときの <script>/<link> は Service Worker が管理下に入る前に
// 取りにいくため、fetch のハンドラを素通りして runtime キャッシュに入らない。
// 理由の詳細は public/sw.js の BUILD_ASSETS のところに書いてある。
//
// 遅延読みこみの塊とフォントは入れない。先読みが重くなると、
// 校内Wi-Fiに40人がぶら下がっている時間帯に初回表示が止まる。
const injectPrecacheAssets = {
  name: 'inject-precache-assets',
  apply: 'build',
  // public/ の中身は Vite がそのままコピーするので、出来あがったあとに書きかえる
  closeBundle() {
    const swPath = resolve(__dirnameLike, 'dist/sw.js')
    if (!existsSync(swPath)) return
    const html = readFileSync(resolve(__dirnameLike, 'dist/index.html'), 'utf8')
    // index.html が直接読んでいるものだけを拾う（遅延読みこみの塊は入らない）
    // base を相対パスにしたので、参照は "./assets/…" になる。
    // 旧構成（/Qalc/assets/…）の書き方も、取りこぼさないよう両方拾う。
    const urls = [...html.matchAll(/(?:src|href)="((?:\.\/|\/Qalc\/)assets\/[^"]+\.(?:js|css))"/g)]
      .map((m) => m[1])
    const uniq = [...new Set(urls)]
    if (uniq.length === 0) throw new Error('index.html から本体の JS/CSS を見つけられなかった')
    const sw = readFileSync(swPath, 'utf8')
    if (!sw.includes('/* __BUILD_ASSETS__ */')) throw new Error('sw.js に __BUILD_ASSETS__ の目印がない')
    writeFileSync(swPath, sw.replace('/* __BUILD_ASSETS__ */', uniq.map((u) => `\n  '${u}',`).join('') + '\n'))
    console.log(`[sw] 先読みに本体を ${uniq.length} 件書きこんだ: ${uniq.join(' , ')}`)
  },
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), stripCspInDev, dropLegacyWoff, injectPrecacheAssets],
  base: './',
  build: {
    // フォントを data: URI に埋めこませない。
    // 小さいサブセットが CSS に埋まると font-src に data: を許可せねばならず、
    // CSP をゆるめることになる。ファイルとして出せば font-src 'self' で閉じられる。
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined),
  },
})
