/* 面の明るさに合わせて文字の色を選ぶ、React 側の入り口。
 *
 * 色の表そのものは colorTables.js にある（React を入れないため）。
 * ここはそれを画面に繋ぐだけ。
 */
import { useState, useEffect } from 'react';
export { relLuminance, isLightSurface, pickOn, RANK_TEXT, TEAM_TEXT, TOOL_TEXT } from './colorTables.js';
import { isLightSurface } from './colorTables.js';

/** いま画面に出ている面(--panel)が明るいか。テーマを変えると変わる */
export function currentSurfaceIsLight() {
    if (typeof window === 'undefined' || !document.documentElement) return true;
    const v = getComputedStyle(document.documentElement).getPropertyValue('--panel');
    return v ? isLightSurface(v) : true;
}

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
