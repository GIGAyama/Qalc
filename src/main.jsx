import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// 本文フォント(Zen Maru Gothic)を自分のサイトから配る。
// 以前は Google Fonts から読んでいたため、児童端末のIPとUAがGoogleに送られていた。
// unicode-range でサブセットに分かれているので、画面に出た文字ぶんだけが落ちてきて
// Service Worker にキャッシュされる(2回目以降は通信ゼロ、オフラインでも本来の字で出る)。
import '@fontsource/zen-maru-gothic/500.css'
import '@fontsource/zen-maru-gothic/700.css'
import '@fontsource/zen-maru-gothic/900.css'
import './index.css'
import { registerServiceWorker } from './pwa.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

// 登録するだけでなく、あたらしい版が待機したことも見張る。
// 前は register するだけだったので、直したものを出しても
// 児童の端末は古いままで、本人にはそれが分からなかった（Part I §3-4）
registerServiceWorker()
