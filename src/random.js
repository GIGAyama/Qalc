/* 並べかえと乱数（App.jsx と data/problems.js が使う）。
 *
 * ⚠️ `arr.sort(() => Math.random() - 0.5)` でまぜないこと。
 *    並べかえの手順しだいで出やすい並びがかたよる。タイムアタックの20問では、
 *    元の並びの前のほうの問題が出やすく、729問のコースでは出やすさに
 *    最大3.7倍と0.18倍の差があった（どの問題も同じ確率で出るべき）。
 *    フィッシャー–イェーツのまぜかたなら、どの並びも同じ確率になる。
 *
 * 変更したら `npm run test:random` を通すこと。
 */

/** 0以上1未満の乱数を返す関数を、種(seed)から作る（mulberry32）。同じ種なら同じ列になる */
export const seededRandom = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** 新しい配列にまぜて返す（もとの配列は変えない） */
export const shuffle = (arr, rand = Math.random) => {
  const out = Array.from(arr);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** まぜてから先頭の n 個（n が多ければ全部） */
export const sample = (arr, n, rand = Math.random) => shuffle(arr, rand).slice(0, n);
