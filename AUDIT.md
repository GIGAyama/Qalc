# GIGA Standard v4 監査：Qalc（カルク ～目指せ、計算マスター～）

- 監査日：2026-08-03
- 対象コミット：`main` 相当（作業ブランチ `claude/rollout-bul4o6`）
- 判定した型：**B型（Vite + React）** — `vite.config.js` あり、`base: '/Qalc/'` 設定済み
- 実測方法：リポジトリ全文の grep と `npm ci && npm run build` による実ビルド。推測値は含めない。

判定記号：✅ 適合 ／ ⚠️ 部分適合 ／ ❌ 未対応 ／ — 対象外（理由を明記）

---

## 総評

**このリポジトリは、すでにかなりの水準にある。** CSP は meta で投入済み、Service Worker は
自アプリ接頭辞のキャッシュだけを掃除しており（他アプリを壊していない）、フォントは自己ホスト、
`localStorage.clear()` も `postMessage(..., '*')` も無い。学習ログ `study.v1` も仕様どおりで、
`pagehide` による確定保存・5分の離席ルールも実装されている。

不足しているのは主に次の4点に集約される。

1. **LICENSE の実ファイルが無い**（README に一文があるだけ）
2. **PWA の「インストール導線」と「オフライン時の顔」が無い** — `beforeinstallprompt` の捕捉、
   アプリ内インストールボタン、更新通知、`offline.html` がいずれも未実装
3. **手書きキャンバスに devicePixelRatio 補正が無い** — Chromebook の高DPI機で線がぼやける
4. **画像が重い** — favicon 239KB / icon-512 283KB / icon-maskable-512 177KB（上限の4〜8倍）

---

## A. 法務・配布

| # | 項目 | 判定 | 実測 |
|---|---|:--:|---|
| A1 | LICENSE 実ファイル | ❌ | ファイルが存在しない。README.md:312 に「## ライセンス / © Qalc GIGA山」の記載のみで、許諾条件が示されていない |
| A2 | .gitignore | ✅ | 1,169 バイト。`node_modules/` `dist/` を含む |
| A3 | dependabot.yml | ✅ | `.github/dependabot.yml` あり。npm=weekly（production / development をグループ分け）、github-actions=monthly |
| A4 | README.md / MANUAL.md 両方 | ⚠️ | README.md（26,876 バイト・全13節）は非常に充実。**MANUAL.md（先生向け）が無い** |

補足：`git ls-files` に `.clasp.json` / `.env` は無い（秘密情報のコミットなし）。

---

## B. セキュリティ

| # | 項目 | 判定 | 実測 |
|---|---|:--:|---|
| B1 | CSP（connect-src が最小） | ✅ | index.html:31 に meta で投入済み。`connect-src 'self' https://0.peerjs.com wss://0.peerjs.com` の2件のみ。ワイルドカードなし。`object-src 'none'` `frame-src 'none'` `form-action 'none'` まで閉じている |
| B2 | 秘密情報・IDの直書きなし | ✅ | APIキー・スプレッドシートID・メールアドレスの直書きを検出せず |
| B3 | OAuthスコープ最小 | — | GAS を使わない B型のため対象外 |
| B4 | postMessage の宛先が `*` でない | ✅ | `postMessage(..., '*')` の該当0件 |
| B5 | サーバー側5段ガード | — | サーバーを持たない P2P（PeerJS）構成のため対象外。代替として `src/roomAccess.js`（267行）にリーダー承認制の入室制御と受信データ検証があり、専用テスト `scripts/roomAccess.test.mjs` で担保されている |

---

## C. 堅牢性

| # | 項目 | 判定 | 実測 |
|---|---|:--:|---|
| C1 | LockService + try/finally | — | GAS 非使用のため対象外 |
| C2 | 自動復旧（シート再生成） | — | 同上 |
| C3 | pagehide で記録確定 | ✅ | App.jsx:3582-3590。`beforeunload` が bfcache 経路で発火しない件のコメント付き |
| C4 | 通信失敗時のリトライと明示 | ⚠️ | `retry` / `reconnect` に相当する自動再接続処理が見当たらない。校内Wi-Fiが混むと「へや」から落ちたまま戻らない可能性 → **要調査（P3 で扱う）** |
| C5 | localStorage.clear() を使っていない | ✅ | 該当0件。`study.records.v1` は保護されている |

---

## D. 表示（Part I §2）

| # | 項目 | 判定 | 実測 |
|---|---|:--:|---|
| D1 | viewport に viewport-fit=cover | ✅ | index.html:33。`user-scalable=no` は付いていない（拡大可能＝a11y 上も適切） |
| D2 | 100dvh を使用（100vh 単独でない） | ✅ | `100vh` 単独の使用0件。`h-[100dvh]` を App.jsx:4030, 5537 で使用 |
| D3 | safe-area-inset を適用 | ⚠️ | 2箇所のみ（App.jsx:4030 と LearningTools.jsx:2360、いずれも `padding-bottom`）。**左右パディング（横向き時のノッチ欠け）と上部ヘッダー（App.jsx:5540 の `sticky top-0`）に未適用** |
| D4 | clamp() による fluid type | ❌ | `clamp(` の該当0件。文字サイズは Tailwind の固定クラス（`text-2xl` 等）のみ。1366×768 の Chromebook と 375px のスマホで同じ値が出る |
| D5 | Canvas に devicePixelRatio 補正（上限2） | ❌ | **`devicePixelRatio` の該当0件。** `HandWritingCanvas`（App.jsx:2341-2426）はバッファを CSS px と1:1（`parent.clientWidth/Height`）で確保しており、DPR 2 の Chromebook・iPad では線と数字がぼやける。`ResizeObserver` と描画コード自体は既に整っているため、補正の挿入だけで済む |
| D6 | 320px 幅で横スクロールが出ない | ⚠️ | 静的解析では断定不可。**P1 の検証で実測する** |
| D7 | 画像に width/height、150KB以下 | ❌ | `<img>` は TerritoryBattle.jsx:409 の1箇所のみで `width`/`height` なし（CLS 要因）。150KB 超が3ファイル：favicon.png 239KB / icon-512.png 283KB / icon-maskable-512.png 177KB |
| D8 | コントラスト 4.5:1 以上 | ⚠️ | テーマが16種（App.jsx:5500-5516）あり全組み合わせの機械判定は未実施。各テーマは `--text` を濃色・`--bg` を淡色に取る設計で概ね良好だが、`aurora` `hanabi` `ninja` 等の暗色テーマは要実測 |
| D9 | タップ領域 44px 以上・touch-action | ⚠️ | `body { touch-action: manipulation }`（App.jsx:5521）✅、キャンバスは `touch-none` ✅、消去ボタンは `w-11 h-11`=44px ✅。**`-webkit-tap-highlight-color` の指定0件／`overscroll-behavior: contain` の指定0件**（引っぱり更新の暴発を防げていない） |
| D10 | prefers-reduced-motion 対応 | ⚠️ | index.css:52-57 で画面ゆれ4種の keyframes のみ無効化。**framer-motion（全画面で使用）・canvas-confetti・`navigator.vibrate`（App.jsx:56-92 で9種類）は無効化されない。**感覚過敏の児童向けの設定 OFF スイッチも無い |
| D11 | 提示モード（一斉授業で使う場合） | ❌ | `requestFullscreen` / 拡大表示の該当0件。ボスバトル・じんとりバトルはクラス全体で行う機能のため、本来は必要 |
| D12 | 印刷CSS | — | 印刷を前提とした機能（ワークシート・記録の配布）を持たないため対象外。「かんがえるどうぐ」は画面上の一時的な補助表示であり、印刷用途ではない |

---

## E. PWA（Part I §3）

| # | 項目 | 判定 | 実測 |
|---|---|:--:|---|
| E1 | manifest の id/scope/start_url がリポジトリ名絶対パス | ✅ | `"id": "/Qalc/"` `"scope": "/Qalc/"` `"start_url": "/Qalc/"` — **同一オリジン共有の事故は起きていない**（最重要項目をクリア） |
| E2 | アイコン4種 + apple-touch-icon | ✅ | 192 / 512 / maskable-192 / maskable-512 / apple-touch-icon の5つとも実在 |
| E3 | beforeinstallprompt を head 最上部で捕捉 | ❌ | **該当0件。** イベント自体を受け取っていないため、Chrome の合図を毎回取りこぼしている |
| E4 | インストールボタンをアプリ内に設置 | ❌ | インストール導線・`display-mode: standalone` の判定ともに0件 |
| E5 | sw.js が自アプリ接頭辞のキャッシュのみ削除 | ✅ | public/sw.js:25-34。`CACHE_PREFIX = 'qalc-cache-'` で絞り込み済み。他アプリを壊していない |
| E6 | sw.js が localStorage に触れていない | ✅ | 該当0件 |
| E7 | 更新通知（あたらしいバージョンがあります） | ❌ | main.jsx:19-23 は `register()` するだけ。`updatefound` の監視も `SKIP_WAITING` の受信ハンドラも無い。新版を出しても児童の端末は旧版のまま |
| E8 | offline.html | ❌ | ファイルが存在しない。圏外時は `caches.match('/Qalc/index.html')` に頼るのみで、それも外すと白画面になる |
| E9 | APP_VERSION を今回のリリース値に更新した | ⚠️ | `CACHE = 'qalc-cache-v3'`。**今回の変更に合わせて v4 へ上げる必要がある** |
| E10 | iOS の「ホーム画面に追加」手順を MANUAL に記載 | ❌ | MANUAL.md 自体が無い |

### E 追加所見（Part I §3-1 / §3-3 との差分）

| 箇所 | 内容 |
|---|---|
| manifest.webmanifest | `display_override` と `launch_handler` が未設定。二重起動時に既存ウィンドウへ寄せられない |
| public/sw.js:19 | `cache.addAll(SHELL)` は**1本でも失敗すると全体が落ちる**。個別 `cache.add()` + `catch` に分ける必要がある |
| public/sw.js:47 | navigate 失敗時のフォールバックが `index.html` のみ。`offline.html` の二段目が無い |
| public/sw.js | `message` イベントによる `SKIP_WAITING` 受信ハンドラが無い（E7 と対）|
| public/sw.js | 静的アセットが `CACHE`（版付き）に混ざる。版を上げるたび全アセットを取り直す |

---

## F. アクセシビリティ・性能

| # | 項目 | 判定 | 実測 |
|---|---|:--:|---|
| F1 | alt / aria-label / aria-live | ⚠️ | `aria-label` 14件・`alt` 1件（`<img>` が1つなので網羅）・**`aria-live` 0件**（正解／保存完了が読み上げられない）・**`role="dialog"` 0件**（モーダルが複数あるが未指定） |
| F2 | キーボードのみで全機能に到達 | ⚠️ | `focus-visible` 相当の指定が1件のみ。手書きパネルにはキーボード代替（数字入力）が存在するが、全画面の Tab 順は未検証 |
| F3 | 初回JS 300KB以下（gzip前） | ❌ | **`dist/assets/index-*.js` = 846.6KB（gzip 246.7KB）。** 単一チャンクで、Vite も 500KB 超の警告を出している |
| F4 | 1ファイル 5,000行 / 400KB 以内 | ❌ | **`src/App.jsx` = 5,610行 / 374KB。**行数が上限超過。次点は LearningTools.jsx 2,418行 / 128KB（適合） |

### F 追加所見（性能）

| 指標 | 目標 | 実測 | 判定 |
|---|---|---|:--:|
| 初回 JS（gzip前） | 300KB 以下 | 846.6KB | ❌ |
| 初回 CSS（gzip前） | — | 321.6KB（gzip 101.4KB） | ⚠️ |
| 総アセット（初回） | 1MB 以下 | 約1.4MB（HTML 3KB + JS 847KB + CSS 322KB + favicon 244KB + フォントサブセット数本） | ❌ |
| dist 全体 | — | 9.1MB（うちフォント woff2 が 6.7MB） | 参考値 |
| woff（旧形式）の残存 | 0 | 0件（`dropLegacyWoff` プラグインが効いている） | ✅ |

フォント 6.7MB は `unicode-range` によるサブセット分割済みで、画面に出た文字ぶんだけが落ちてくる。
初回の実効転送量には含まれないため、これ自体は問題ではない。

---

## G. 学習ログ（study.v1）

| # | 項目 | 判定 | 実測 |
|---|---|:--:|---|
| G1 | study.v1 準拠・個人情報を持たない | ✅ | `src/studyLog.js`（ロジック版1.1・74行）。`localStorage['study.records.v1']` に保存のみ、外部送信なし。氏名・出席番号・メールを持たない。上限500件・items 200件・`wrong` の文字列サニタイズあり。壊れた JSON からの復帰も実装済み |
| G2 | 中断記録・5分ルール | ✅ | `src/studySession.js:239` `STUDY_ABORT_AWAY_MS = 5 * 60 * 1000`（5分。4分では締めない）。`IDLE_MS = 60 * 1000` で無操作時の `activeMs` 加算停止（§2.8 準拠）。テスト `scripts/studyLog.test.mjs` あり |

---

## 対応フェーズの割り当て

| フェーズ | 対象 | 破壊リスク |
|---|---|:--:|
| **P0 — 法務** | A1（LICENSE 新規作成） | なし |
| **P1 — 表示・PWA** | D3（safe-area 左右・上部）／D5（**Canvas DPR 補正**）／D9（tap-highlight・overscroll）／D10（framer-motion・confetti・振動の reduced-motion 対応）／E3・E4（インストール導線）／E7（更新通知）／E8（offline.html）／E9（v3→v4）／sw.js の §3-3 準拠化／manifest の display_override・launch_handler | 小〜中 |
| **P2 — 性能** | D7（favicon・icon-512・icon-maskable-512 の圧縮、`<img>` に width/height） | 小（**画質の可否は人間に確認**） |
| **P3 — 保守性** | A4（MANUAL.md 作成）／C4（再接続の調査）／F1・F2（aria-live・role="dialog"・Tab順）／D4（clamp() 導入）／**F3・F4 は提案のみ**（App.jsx 5,610行の分割・コード分割は合意なしに実施しない） | 中 |
| **P4 — 品質ゲート** | `scripts/check-project.mjs` + `quality.config.json` を追加し、`npm run check` を CI に組み込む | なし |

---

## 実施後の状態（2026-08-03 追記）

`/rollout` で P0〜P4 をすべて実施した。品質ゲート `npm run check` の 41 項目は全て合格。

| 監査時 ❌/⚠️ | いま | どう直したか |
|---|:--:|---|
| A1 LICENSE なし | ✅ | MIT を追加 |
| A4 MANUAL なし | ✅ | `MANUAL.md` を新規作成（うまくいかないとき／iOS 手順を含む） |
| C4 再接続 | 📋 | 自動再接続は入れず、理由とともに README に明記（下記） |
| D3 safe-area 一部 | ✅ | ヘッダー上端・フッター下端・左右に適用 |
| D4 clamp() なし | ✅ | `tailwind.config.js` の fontSize を clamp() に |
| **D5 Canvas の DPR 補正なし** | ✅ | 手書きとQRコードの両方を dpr 倍で描画（実測 2.00 倍） |
| D7 画像が上限の4〜8倍 | ✅ | 1,220KB → 276KB。150KB 超は0枚 |
| D9 tap-highlight / overscroll | ✅ | `src/index.css` に追加 |
| D10 reduced-motion が一部 | ✅ | framer-motion・紙ふぶき・振動まで対応＋アプリ内の切りかえ |
| D11 提示モードなし | ✅ | 拡大・全画面・名前かくし・演出オフを実装 |
| E3/E4 インストール導線なし | ✅ | `public/pwa-install.js`＋アプリ内ボタン（iOS は手順案内） |
| E7 更新通知なし | ✅ | 待機を検知して「あたらしい バージョンが あります」 |
| E8 offline.html なし | ✅ | 追加。つながり直したら自動でもどる |
| E9 APP_VERSION | ✅ | v3 → v4 |
| E10 iOS 手順なし | ✅ | MANUAL に記載 |
| F1 aria-live 0件 | ✅ | 正誤の読み上げ・トースト・モーダルの role |
| **F4 App.jsx 5,610行** | ✅ | データを `src/data/` に分離 → **3,881行 / 253KB** |
| **F3 初回JS 802KB** | ⚠️ | 遅延読みこみで **646KB（gzip 197KB）**。目標 300KB には未達（下記） |
| lint が動いていない | ✅ | `.eslintrc.cjs` を追加し CI に組みこみ。エラー0件 |

### CSS の内訳（追加調査）

`index-*.css` が 325KB（gzip 100KB）あり、初回描画をブロックしていた。中身を測ったところ：

| 中身 | 生 | gzip | 割合 |
|---|---:|---:|---:|
| `@font-face` 366件（3ウェイト × 122サブセット） | 277KB | 91KB | **85%** |
| Tailwind ほか | 48KB | 9KB | 15% |

Tailwind ではなく**フォントの定義そのもの**が原因だった。
`@font-face` は1件あたり平均757バイトで、その大半が `unicode-range` の長い16進リスト。

フォントの CSS を静的 import から動的 import に変え、Tailwind と別のファイルに分けた。

| | before | after |
|---|---:|---:|
| 描画をブロックする CSS | 325KB（gzip 100KB） | **48KB（gzip 8.9KB）** |

サブセット分割そのものは残してある。減らせば `@font-face` は3件で済むが、
このアプリは**先生が作ったオリジナル問題や CSV 取りこみで任意の漢字が出る**ため、
サブセットを削ると豆腐（□）になる危険がある（Part I §2-7 の但し書き）。

あわせて `--font-ui` にフォールバックの連鎖を定義した（Part I §2-7）。
これまでは `'Zen Maru Gothic', sans-serif` だけで、届くまでのあいだ角ゴシックで出て、
届いた瞬間に丸ゴシックへ大きく字形が変わっていた。
`Hiragino Maru Gothic ProN`（iPad）・`Kosugi Maru`（Android）を先に置いたので、
端末に丸ゴシックがあれば差しかわりがほとんど分からない。

### F3 が目標に届いていない理由

初回に読む `index-*.js` は 646KB。内訳のうち削れないものが大きい。

| 中身 | おおよそ | 減らせるか |
|---|---:|---|
| `src/App.jsx`（画面の組み立て） | 253KB | 画面ごとに分ければ減るが、共有している部品が多く影響範囲が大きい |
| `react-dom` | 130KB | 減らせない |
| `framer-motion` | 約120KB | ライブラリを入れかえれば減るが、全画面のアニメーションを書き直すことになる |
| `src/data/problems.js` | 70KB | コース一覧の表示に要る。遅延にすると StorageAPI が非同期になり波及が大きい |
| `BossBattle` + `TerritoryBattle` | 105KB | みんなであそぶ専用。純関数を画面と一緒に多数参照しており、動的化には約50か所の書きかえが要る |

すでに別ファイルへ追い出したもの（初回には読まない）:
peerjs 一式 89KB ／ かんがえるどうぐ 72KB ／ qrcode 24KB ／ 紙ふぶき 11KB。

**次にやるなら** `BossBattle` / `TerritoryBattle` を「みんなであそぶ」の読みこみと同じ束にまとめるのが
いちばん効く（-105KB）。ただしテストの無い箇所への100行超の変更になるため、
Part III の停止条件にあたる。着手するなら別途合意のうえで。

`quality.config.json` の `initialJsBytes` は、いまの実測に少し余裕を持たせた
680,000 バイトを天井にしてある。**減らせたら必ずこの値も下げること。**

### D8 コントラスト（実測ずみ・一部修正）

`npm run check:contrast` で全32テーマ × 8通り = 256件を実測した（推測ではない）。

**本文はもともと健全だった。** `--text` on `--bg` / `--panel` は 32テーマすべて合格で、
最小でも 7.15:1 ある。問題は「補足の文字に `opacity` をかけている箇所」に集中していた。

| | 修正前 | 修正後 |
|---|---:|---:|
| 合格 | 192 | **229** |
| 4.5:1 未満（3:1 以上） | 97 | 0 |
| 3:1 未満 | 63 | 27 |

計算すると **opacity 77% で全32テーマが 4.5:1 を満たす**（いちばん厳しいのは matcha の背景）。
そこで切りのよい **80%** を下限とし、文字色に `--text` を使っている 105か所の
`opacity-30/40/50/60/70` を `opacity-80` に上げた。
`bg-[var(--text)] opacity-50`（塗りつぶし）や装飾の透過には手を出していない。
**配色は1色も変えていない。**

#### 残る27件 — 配色そのものの問題

落ちているのはすべて `--primary` / `--secondary` / `--accent` を文字・アイコンの色に
使っている箇所で、`opacity` では直せない。

| テーマ | 色 | 背景 | 比 |
|---|---|---|---:|
| （きほん） | `#4ECDC4`(secondary) | `#ffffff` | 1.93:1 |
| soda | `#22d3ee` | `#ffffff` | 1.81:1 |
| mint | `#2dd4bf` | `#ffffff` | 1.86:1 |
| gold / royal | `#eab308` | `#ffffff` | 1.92:1 |
| matcha | `#84cc16` | `#ffffff` | 1.98:1 |
| tropical | `#f59e0b`(primary) | `#ffffff` | 2.15:1 |
| cyber | `#ffffff`(text) | `#0ff0fc`(accent) | 1.41:1 |

これは **Part I §2-8 が名指ししている問題そのもの**である。

> 明るい色をそのまま文字色に使わない。面用と文字用の2段階を用意する

いまは1つの色を「面」と「文字」の両方に使っている。正しい直しかたは、
テーマごとに文字用の濃い変種（`--primary-d` / `--secondary-d`）を足し、
`text-[var(--primary)]` を `text-[var(--primary-d)]` に置きかえること。
ただしこれは色を増やす＝配色の変更にあたり、Part III の規則6で禁じられているため、
**実測して報告するに留めた。** 着手には人の判断が要る（32テーマ × 2色を決める作業）。

#### 品質ゲートへの組みこみ

`npm run check` に含めた。ただし終了コードに反映するのは
**本文・補足の文字が落ちたときだけ**。上の27件は毎回落としても直せないので
（配色の変更が要る）、報告のみで CI は止めない。

### 残っている項目

| # | 内容 | 扱い |
|---|---|---|
| F3 | 初回JS 646KB（目標 300KB） | 上記のとおり。天井を設けて肥大化は止めてある |
| D8 | 暗色テーマの薄い文字 | 実測して報告のみ（配色は変更しない） |
| C4 | みんなであそぶの自動再接続 | 入れない判断。理由は README「制限とクォータ」 |
| F2 | Tab 順の全画面検証 | 主要導線は確認済み。全画面の網羅は未実施 |

---

## 人間に判断を仰いだこと（回答済み）

1. **ブランチ運用** — → 1ブランチ上でフェーズごとにコミットを分けた（環境の制約による）。

2. **D11 提示モード** — → 実装することで合意。ヘッダーに追加した。

3. **F3・F4 の扱い** — → 分割まで実施することで合意。F4 は解消、F3 は未達（上記）。

4. **D8 コントラスト** — → 報告のみに留めた（上記）。
