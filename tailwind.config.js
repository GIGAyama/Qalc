/** @type {import('tailwindcss').Config} */

/* 文字の大きさを画面幅に追従させる（Part I §2-4）。
 *
 * この画面は 1366×768 の Chromebook から 375px のスマホ、電子黒板の 4K まで同じものが出る。
 * メディアクエリを何段も書くかわりに clamp() で一本にする。
 *
 * 下限は Tailwind のもとの値そのまま。狭い画面では今までと1pxも変わらないので、
 * 320〜375px のレイアウトが崩れることはない。そこから 1280px にかけて 1.25倍まで
 * ゆっくり育つ。広い画面ほど文字が大きくなるのが目的。
 *
 * 全体に var(--fs-scale) を掛けてあるのは提示モードのため。
 * body.presentation で --fs-scale が 1.5 になり、教室のうしろからも読める大きさになる
 * （clamp の外に掛けるので、上限にはりついた状態からでもきちんと拡大される）。
 *
 * 行間は単位なしの倍率にしてある。もとの Tailwind は rem 固定なので、
 * 文字だけ大きくなると行が重なってしまう。倍率なら文字と一緒に広がる
 * （下限では もとの rem 値と同じ行間になるように計算してある）。
 */
const fluid = (minPx, vw, basePx, maxPx, leading) => [
    `calc(clamp(${minPx}px, ${vw}vw + ${basePx}px, ${maxPx}px) * var(--fs-scale, 1))`,
    { lineHeight: String(leading) },
]

export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontSize: {
                xs: fluid(12, 0.33, 10.76, 15, 1.3333),
                sm: fluid(14, 0.39, 12.55, 17.5, 1.4286),
                base: fluid(16, 0.44, 14.34, 20, 1.5),
                lg: fluid(18, 0.5, 16.14, 22.5, 1.5556),
                xl: fluid(20, 0.55, 17.93, 25, 1.4),
                '2xl': fluid(24, 0.66, 21.51, 30, 1.3333),
                '3xl': fluid(30, 0.83, 26.89, 37.5, 1.2),
                '4xl': fluid(36, 0.99, 32.27, 45, 1.1111),
                '5xl': fluid(48, 1.33, 43.03, 60, 1),
                '6xl': fluid(60, 1.66, 53.78, 75, 1),
                '7xl': fluid(72, 1.99, 64.54, 90, 1),
                '8xl': fluid(96, 2.65, 86.06, 120, 1),
                '9xl': fluid(128, 3.54, 114.74, 160, 1),
            },
        },
    },
    plugins: [],
}
