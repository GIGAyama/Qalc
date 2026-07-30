import { defineConfig } from 'vite'
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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), stripCspInDev],
  base: '/Qalc/',
})
