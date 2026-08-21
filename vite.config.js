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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), stripCspInDev, dropLegacyWoff],
  base: './',
  build: {
    // フォントを data: URI に埋めこませない。
    // 小さいサブセットが CSS に埋まると font-src に data: を許可せねばならず、
    // CSP をゆるめることになる。ファイルとして出せば font-src 'self' で閉じられる。
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined),
  },
})
