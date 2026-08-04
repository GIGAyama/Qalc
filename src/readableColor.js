import { useState, useEffect } from 'react';

/* 面(背景)の明るさに合わせて、文字の色を選ぶ（Part I §2-8）
 *
 * なぜ要るか。
 * Qalc はテーマが32種あり、`--panel` は白(#ffffff)から #111111 まで幅がある。
 * ランクの色やチームの色のように「意味を持った色」を文字に使う場面では、
 * 明るい面と暗い面の両方で 4.5:1 を満たす色は **存在しない**。
 *
 *   白地で 4.5:1 を満たす → 相対輝度が 0.1785 以下
 *   #111111 の上で 4.5:1 を満たす → 相対輝度が 0.2025 以上
 *
 * 範囲が重ならないので、1色では絶対に届かない。
 * だから色ごとに「明るい面むけ」と「暗い面むけ」の2つを持ち、面を見て選ぶ。
 *
 * Part I §2-8 が「一括置換は濃い面の上の文字を壊す」と書いているのは、
 * まさにこの取りちがえのことである。片方だけを見て濃くすると、もう片方が潰れる。
 */

/** #rgb / #rrggbb → 相対輝度(0〜1)。テーマの色はすべて16進で書いてある */
export function relLuminance(hex) {
    const h = String(hex).trim().replace(/^#/, '');
    const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.slice(0, 6);
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return 1; // 読めなければ「明るい面」とみなす（白地が既定）
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/* しきい値 0.18。
 * これより明るい面は「明るい面」として扱う。
 * 32テーマの --panel を測ると、明るいほうは最小 0.62、暗いほうは最大 0.09 で、
 * あいだが大きく空いている。どこで切っても同じ結果になるが、
 * 白地で 4.5:1 を満たせる上限(0.1785)に合わせておくと理屈が一本になる。 */
const LIGHT_SURFACE_MIN = 0.18;

export const isLightSurface = (hex) => relLuminance(hex) > LIGHT_SURFACE_MIN;

/** いま画面に出ている面(--panel)が明るいか。テーマを変えると変わる */
export function currentSurfaceIsLight() {
    if (typeof window === 'undefined' || !document.documentElement) return true;
    const v = getComputedStyle(document.documentElement).getPropertyValue('--panel');
    return v ? isLightSurface(v) : true;
}

/** { light, dark } の組から、面に合うほうを返す */
export const pickOn = (pair, lightSurface) => (lightSurface ? pair.light : pair.dark);

/* ランクの文字色。左が明るい面むけ、右が暗い面むけ。
 * 色みは変えていない（同じ色相の濃さちがい）。かっこ内は実測の比。
 *
 *   ランク          もとの色    明るい面(白地)      暗い面(#111111 の上)
 *   計算神          #9333ea    #9333ea (5.38)     #c084fc (7.15)
 *   計算マスター     #ca8a04    #a16207 (4.92)     #facc15 (12.33)
 *   達人            #06b6d4    #0e7490 (5.36)     #06b6d4 (7.78)
 *   上級            #eab308    #854d0e (6.85)     #eab308 (9.85)
 *   中級            #6b7280    #6b7280 (4.83)     #9ca3af (7.44)
 *   初級            #f97316    #c2410c (5.18)     #fb923c (8.34)
 *   かけだし         #4ade80    #15803d (5.02)     #86efac (13.45)
 *
 * 明るい面では「計算神」と「中級」がもとのままで足りている。
 * 暗い面では「達人」と「上級」がもとのままで足りている。 */
export const RANK_TEXT = {
    計算神: { light: '#9333ea', dark: '#c084fc' },
    計算マスター: { light: '#a16207', dark: '#facc15' },
    達人: { light: '#0e7490', dark: '#06b6d4' },
    上級: { light: '#854d0e', dark: '#eab308' },
    中級: { light: '#6b7280', dark: '#9ca3af' },
    初級: { light: '#c2410c', dark: '#fb923c' },
    かけだし: { light: '#15803d', dark: '#86efac' },
};

/* チーム名を文字として出すときの色。
 * territoryLogic.js の color は「面(マスの塗り)」用なので、そのまま文字にすると
 * あか 3.76 / あお 3.68 で足りない。deep が明るい面むけの文字色として使える。
 *
 *   あか  面 #EF4444  明るい面 #B91C1C (6.47)  暗い面 #EF4444 (5.02)
 *   あお  面 #3B82F6  明るい面 #1D4ED8 (6.70)  暗い面 #3B82F6 (5.13) */
export const TEAM_TEXT = {
    red: { light: '#B91C1C', dark: '#EF4444' },
    blue: { light: '#1D4ED8', dark: '#3B82F6' },
};

/* テーマを切りかえたときに、いまの面の明るさを取り直す。
 *
 * 描画のあと(useEffect)に読むのが大事。テーマの CSS 変数を書いているのは
 * GlobalStyle の <style> なので、描画中に getComputedStyle すると
 * まだ1つ前のテーマの値が返ってくる。 */
export function useLightSurface(themeKey) {
    const [light, setLight] = useState(currentSurfaceIsLight);
    useEffect(() => { setLight(currentSurfaceIsLight()); }, [themeKey]);
    return light;
}
