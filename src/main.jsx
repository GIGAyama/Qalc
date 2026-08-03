import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerServiceWorker } from './pwa.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

/* 本文フォント(Zen Maru Gothic)を自分のサイトから配る。
 * 以前は Google Fonts から読んでいたため、児童端末のIPとUAがGoogleに送られていた。
 * unicode-range でサブセットに分かれているので、画面に出た文字ぶんだけが落ちてきて
 * Service Worker にキャッシュされる(2回目以降は通信ゼロ、オフラインでも本来の字で出る)。
 *
 * import を静的から動的にしてあるのは、この CSS が重いため。
 * 3ウェイト × 122サブセットで @font-face が366個あり、
 * CSS全体 325KB のうち 277KB(gzip で 91KB のうち 91%)をこれが占めていた。
 * 静的 import だと Tailwind と同じ1枚にまとめられ、<head> から読みこまれるので、
 * 校内Wi-Fiに40人がぶら下がっている時間帯は、この91KBが届くまで画面に何も出ない。
 *
 * 動的にすると、まず素の文字で画面が出て、フォントが届いたら差しかわる。
 * 差しかわりが目立たないよう、index.css の font-family には
 * 同じ系統(丸ゴシック)の端末内蔵フォントを並べてある(Part I §2-7)。
 * 2回目以降は Service Worker のキャッシュから出るので、差しかわり自体が起きない。 */
import('@fontsource/zen-maru-gothic/500.css')
import('@fontsource/zen-maru-gothic/700.css')
import('@fontsource/zen-maru-gothic/900.css')

// 登録するだけでなく、あたらしい版が待機したことも見張る。
// 前は register するだけだったので、直したものを出しても
// 児童の端末は古いままで、本人にはそれが分からなかった（Part I §3-4）
registerServiceWorker()
