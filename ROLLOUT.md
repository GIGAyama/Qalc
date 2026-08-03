# GIGA Standard v4 展開の記録

- 診断日：2026-08-03
- 方法：`node scripts/audit-repo.mjs <パス>`（読むだけ・何も書きかえない）
- 対象：10リポジトリ（第1群5・第2群3・第3群2）＋ 実施ずみの Qalc

**このファイルは Qalc に置いてあるが、内容は全リポジトリにまたがる。**
Qalc が最初に GIGA Standard v4 を通したリポジトリで、診断スクリプトと品質ゲートの
実装がここにあるため、暫定的にここを置き場にしている。
専用の置き場が決まったら移すこと。

---

## 🚨 いちばん先に直すべきもの — 他のアプリを壊している4本

診断して分かった最大の問題は、個々のアプリの出来ではなく**アプリ同士の干渉**だった。

### 何が起きているか

`gigayama.github.io` は数十本のアプリが**同じドメインを共有**している。
ブラウザのキャッシュはドメイン単位なので、`caches.keys()` は
**自分のものだけでなく、そこに同居する全アプリのキャッシュを返す。**

次の4本は、その結果を「自分のもの以外ぜんぶ」削除していた。

```js
// docs/sw.js（週案エディタ）— 実際のコード
caches.keys().then((keys) =>
  Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
)
```

| リポジトリ | 型 | 該当箇所 |
|---|---|---|
| **SchoolPlan_Editor**（週案エディタ） | C | `docs/sw.js:31` |
| **Townmap_Mikke** | C | `docs/sw.js:17` |
| **Reflection_Journal** | C | `docs/sw.js:29` |
| **Quoridor** | B | `public/sw.js:25` |

**教室で何が起きるか。**
先生が週案エディタを開き、そこで新しい版の Service Worker が有効になった瞬間、
**その端末に入っていた他の全アプリのオフライン用データが消える。**
児童がその端末で Qalc や KANJI_Town をオフラインで開こうとしても起動しない。
オンラインに戻るまで直らず、しかも**原因がそのアプリ側に見えない**ため、
「たまにアプリが開かなくなる」という再現しにくい不具合として報告されることになる。

Part III P1 手順8 が「`caches.keys()` の全削除がある場合は**最優先で修正**（他アプリを壊している）」
としているのは、まさにこの状態を指している。

**直しかたは1行。** 自分の接頭辞で始まるものだけを消す。

```js
const CACHE_PREFIX = 'schoolplan-';
keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))
```

### 同じ4本が manifest の `id` も欠いている

| リポジトリ | いまの値 |
|---|---|
| SchoolPlan_Editor | `id` が無い／`start_url: "./"` `scope: "./"` |
| Townmap_Mikke | `id` が無い |
| Reflection_Journal | `id: "./"` `scope: "./"` |
| Quoridor | `id: "./"` `scope: "./"` |

Part I §3-1 のとおり、`id` を省略すると `start_url` が代わりの識別子になる。
相対パスの `./` は**同一オリジンの全アプリで同じ値**になるため、
ホーム画面に追加したアプリが取り違えられ「開いたら違うアプリが立ちあがる」事故が起きうる。

**この2つは同じ `sw.js` / `manifest` の修正で片づく。** まとめて直すのが効率的。

---

## 診断の一覧

判定：✅ 対応ずみ ／ ❌ 未対応 ／ — 対象外（その機能を持たない）

| リポジトリ | 型 | 🚨sw全消し | 🚨mf不備 | dpr補正 | safe-area | clamp | 動きの配慮 | offline | 更新通知 | 150KB超の画像 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|--:|
| **Qalc**（実施ずみ） | B | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| Gamification | C | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| KANJI_Town | B | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0 |
| KANA_Master | A | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | 0 |
| Keisan-Card | A | ✅ | ✅ | — | ✅ | ✅ | ✅ | ❌ | ✅ | 2 |
| **SchoolPlan_Editor** | C | 🚨 | 🚨 | — | ✅ | ❌ | ✅ | ❌ | ❌ | 0 |
| **Townmap_Mikke** | C | 🚨 | 🚨 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 0 |
| **Reflection_Journal** | C | 🚨 | 🚨 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | 0 |
| **Quoridor** | B | 🚨 | 🚨 | — | ✅ | ❌ | ✅ | ❌ | ❌ | 2 |
| Class_tweet | C | ✅ | — | — | ❌ | ❌ | ❌ | — | — | 0 |
| tsubomi-learning | A | ✅ | — | — | ❌ | ❌ | ❌ | — | — | **40** |

### そのほか目についたもの

| 内容 | 実測 |
|---|---|
| **tsubomi-learning の画像が 28.3MB** | 40枚すべてが150KB超。最大 `assets/pumpkin_bud.png` 855KB。Qalc は同じ作業で 1,220KB → 276KB になった |
| **Quoridor の favicon が 1,102KB** | タブに16pxで出すためだけに1MB超を配っている |
| **KANA_Master の App.jsx が 7,474行 / 417KB** | Part I §5 の上限（5,000行 / 400KB）超え。Qalc と同じくデータの切りだしで下がる見こみ |
| **Class_tweet と tsubomi-learning に PWA が無い** | `manifest` も `sw.js` も無い。ホーム画面に置けず、オフラインでも使えない |
| **Class_tweet に `viewport-fit=cover` が無い** | iPhone のノッチ／ホームバー領域に背景が伸びない |

---

## 直す順番（実測にもとづく）

当初は仕様書の推奨順（第1群＝個人情報・実運用中）で進める想定だったが、
**測った結果、優先すべきは「他アプリを壊しているかどうか」だった。**
個人情報まわりは、診断した範囲ではどのリポジトリも大きな問題を抱えていない。

### 第1段：他のアプリを壊すのを止める（4本）— **PR 提出ずみ**

`sw.js` の1行と `manifest` の `id` を直すだけ。**機能には触れないので、まとめて実施できる。**

1. **SchoolPlan_Editor** — 週案エディタ。教員機で毎日開かれるため、被害がいちばん広い
2. **Townmap_Mikke**
3. **Reflection_Journal**
4. **Quoridor**

> SchoolPlan_Editor は品質ゲートの正本も持っているので、
> ここに Part I §2/§3 の検査を移せば、以降の全リポジトリが恩恵を受ける。

### 第2段：画像（2本）

壊す余地がほぼ無く、効果が大きい。

5. **tsubomi-learning** — 28.3MB。校内Wi-Fiで40人が一斉に開くと目に見えて詰まる
6. **Quoridor** の favicon 1,102KB（第1段のついでに）

### 第3段：表示とPWAを揃える

7. **Townmap_Mikke** — Canvas の dpr 補正なし。地図に書きこむアプリで線がぼやける
8. **Reflection_Journal** — 同上
9. **KANA_Master** — `clamp()` と `offline.html`、App.jsx の分割
10. **Keisan-Card** — `offline.html` と画像2枚
11. **Class_tweet / tsubomi-learning** — PWA を一から入れるか、入れない判断をする

---

## 進捗

| リポジトリ | 型 | 診断 | P0 | P1(表示/PWA) | P2 | P3 | ゲート | 備考 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Qalc | B | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 試行第1号。PR #43/#44/#45 |
| SchoolPlan_Editor | C | ✅ | — | 🔄PR#24 | — | — | — | sw全消し＋id を修正 |
| Townmap_Mikke | C | ✅ | — | 🔄PR#10 | — | — | — | sw全消し＋id を修正。dpr は未 |
| Reflection_Journal | C | ✅ | — | 🔄PR#5 | — | — | — | sw全消しのみ修正。**id は要判断** |
| Quoridor | B | ✅ | — | 🔄PR#4 | — | — | — | sw全消しのみ修正。**id は要判断**・favicon 1.1MB |
| tsubomi-learning | A | ✅ | — | — | — | — | — | 画像28.3MB・PWA無し |
| KANA_Master | A | ✅ | — | — | — | — | — | App.jsx 7,474行 |
| Keisan-Card | A | ✅ | — | — | — | — | — | offline無し・画像2枚 |
| Class_tweet | C | ✅ | — | — | — | — | — | PWA無し |
| Gamification | C | ✅ | — | — | — | — | — | 問題なし |
| KANJI_Town | B | ✅ | — | — | — | — | — | 問題なし |

---

## 診断のやりかた

```bash
node scripts/audit-repo.mjs /path/to/repo          # 人が読む形
node scripts/audit-repo.mjs /path/to/repo --json    # 集計用
```

読むだけで、対象のリポジトリには一切書きこまない。

**誤検知について。** 最初に回したとき、`localStorage.clear()` を「あり」と誤判定した。
検査スクリプト自身（`scripts/check-project.mjs`）や、
「使ってはいけません」と書いた説明のコメント、
Node 上のモックを消しているテスト（`tools/check-study.js`）を拾っていたため。
いまは `scripts/` `tools/` `test/` とコメントを判定から外してある。
**新しい検査を足すときは、同じ罠に注意すること。**


---

## 第1段の結果（2026-08-03）

4本すべてに PR を出した。**`sw.js` の修正はどれも同じ形で、機能には触れていない。**

| リポジトリ | PR | sw.js | manifest の id |
|---|---|:--:|---|
| SchoolPlan_Editor | [#24](https://github.com/GIGAyama/SchoolPlan_Editor/pull/24) | ✅ | ✅ 明示した（**同一性は保たれる**） |
| Townmap_Mikke | [#10](https://github.com/GIGAyama/Townmap_Mikke/pull/10) | ✅ | ✅ 明示した（**同一性は保たれる**） |
| Reflection_Journal | [#5](https://github.com/GIGAyama/Reflection_Journal/pull/5) | ✅ | ⏸ **要判断** |
| Quoridor | [#4](https://github.com/GIGAyama/Quoridor/pull/4) | ✅ | ⏸ **要判断** |

### `id` を2本だけ直さなかった理由

`id` は**マニフェストの場所ではなくオリジンを基準に**解決される、という仕様がある。

| 現状 | 実効値 | `/Name/` に変えると |
|---|---|---|
| `id` を書いていない（SchoolPlan_Editor / Townmap_Mikke） | 解決後の `start_url` ＝ `https://gigayama.github.io/Name/` | **同じ値**。すでに入れた人に影響なし → 直した |
| `id: "./"`（Reflection_Journal / Quoridor） | `https://gigayama.github.io/`（**ドメイン直下**） | **別の識別子になる**。ホーム画面に追加した人は置き直しが必要 → **止めた** |

後者は Part III の停止条件（「`manifest` の `id` 変更で既存のインストール済みアプリが
別扱いになると判断されるとき」）に該当する。

**なお、この2本はいまたがいに同じ識別子を共有している。**
どちらも実効値が `https://gigayama.github.io/` なので、同じ端末で両方をホーム画面に
追加すると取りちがえが起きうる。放置するリスクと、置き直しの手間を天秤にかける判断が要る。
各 PR の本文に状況を書いた。

### PR で別途報告したこと

| リポジトリ | 内容 |
|---|---|
| Townmap_Mikke / Reflection_Journal | 手書き Canvas に `devicePixelRatio` 補正がなく、線がぼやける |
| Quoridor | `favicon.png` が 1,102KB（Qalc では同じ作業で 238KB → 12.7KB になった） |
