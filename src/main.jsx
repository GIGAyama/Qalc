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

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/Qalc/sw.js').catch(() => {})
    })
}
