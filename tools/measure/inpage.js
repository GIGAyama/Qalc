/* 実ブラウザの中で走る測定コード（GIGA Standard v5 §7-2 / §2-9）
 *
 * ここに書いてあることの多くは「素朴にやると壊れる」ことへの対処である。
 *  - 色は必ず 1px 塗って読む（Tailwind v4 の oklch() を数字として読み違えないため）
 *  - 背景がグラデーションのときは backgroundColor が透明になる
 *  - 絵文字はフォント自身の色で描かれるので CSS の color は効かない
 *  - 使用不可(disabled)は WCAG の対象外
 */
window.__giga = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  /** CSS の色文字列 → [r,g,b,a]（0-255, 0-1）。oklch/color-mix もこれで正しく読める */
  const parse = (s) => {
    if (!s) return [0, 0, 0, 0];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    try { ctx.fillStyle = s; } catch { return [0, 0, 0, 0]; }
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    if (a === 0) return [0, 0, 0, 0];
    return [d[0] / a, d[1] / a, d[2] / a, a];
  };

  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg, bg) => {
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  /** 半透明の前景を背景に重ねる */
  const over = (fg, bg) => {
    const a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  };

  /** グラデーション文字列から色の候補をすべて取り出す（いちばん不利なものを使うため） */
  const stopsOf = (bgImage) => {
    if (!bgImage || bgImage === 'none') return [];
    const out = [];
    const re = /(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|\b(?:white|black|transparent|currentcolor)\b)/gi;
    let m;
    while ((m = re.exec(bgImage))) {
      const c = parse(m[1]);
      if (c[3] > 0.05) out.push(c);
    }
    return out;
  };

  /** 要素の実効背景。祖先をさかのぼって不透明になるまで重ねる。
   *  グラデーションがあれば、その色ぶんだけ候補を増やす（最悪値で判定する） */
  const backgroundsOf = (el) => {
    let candidates = [null]; // null = まだ決まっていない
    let node = el;
    const layers = [];
    while (node && node !== document.documentElement.parentNode) {
      const cs = getComputedStyle(node);
      const gs = stopsOf(cs.backgroundImage);
      const bc = parse(cs.backgroundColor);
      if (gs.length) layers.push(gs);
      else if (bc[3] > 0) layers.push([bc]);
      // 不透明な層に当たったらそこで打ち切る
      if ((gs.length && gs.every((c) => c[3] >= 0.999)) || bc[3] >= 0.999) break;
      node = node.parentElement;
    }
    layers.push([[255, 255, 255, 1]]); // 最終的な下地は白（body に色がなければ）
    // 手前から奥へ重ねる。候補が複数ある層は、それぞれを別の背景として展開する
    let results = [[0, 0, 0, 0]];
    for (const layer of layers) {
      const next = [];
      for (const acc of results) {
        if (acc[3] >= 0.999) { next.push(acc); continue; }
        for (const c of layer) {
          // acc（手前）を c（奥）の上に置く
          const a = acc[3];
          next.push([
            acc[0] * a + c[0] * (1 - a) * c[3] + (1 - a) * (1 - c[3]) * 255,
            acc[1] * a + c[1] * (1 - a) * c[3] + (1 - a) * (1 - c[3]) * 255,
            acc[2] * a + c[2] * (1 - a) * c[3] + (1 - a) * (1 - c[3]) * 255,
            Math.min(1, a + (1 - a) * c[3]),
          ]);
        }
      }
      results = next.slice(0, 12); // 展開しすぎないよう頭打ち
      if (results.every((r) => r[3] >= 0.999)) break;
    }
    return results.map((r) => [r[0], r[1], r[2], 1]);
  };

  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{2049}\u{203C}]/u;
  const isEmojiOnly = (t) => t.length > 0 && [...t].every((ch) => EMOJI.test(ch) || /\s/.test(ch));

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const disabled = (el) => {
    let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (n.disabled || n.getAttribute?.('aria-disabled') === 'true'
        || cs.cursor === 'not-allowed' || cs.pointerEvents === 'none') return true;
      n = n.parentElement;
    }
    return false;
  };

  const path = (el) => {
    const parts = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 4; i++) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
      const cls = (n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) s += '.' + cls;
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };

  /* ── コントラスト ─────────────────────────────── */
  function contrast() {
    const bad = [];
    let checked = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || disabled(el)) continue;
      // 直接の子として持っている文字だけを見る（親で二重に数えない）
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('')
        .trim();
      if (!text || isEmojiOnly(text)) continue;

      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || (cs.fontWeight === 'bold' ? 700 : 400);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;

      // opacity は祖先ぶんも掛かる
      let opacity = 1, n = el;
      while (n && n.nodeType === 1) { opacity *= Number(getComputedStyle(n).opacity); n = n.parentElement; }

      const rawFg = parse(cs.color);
      const bgs = backgroundsOf(el);
      let worst = Infinity, worstBg = null;
      for (const bg of bgs) {
        const fg = over([rawFg[0], rawFg[1], rawFg[2], rawFg[3] * opacity], bg);
        const r = ratio(fg, bg);
        if (r < worst) { worst = r; worstBg = [fg, bg]; }
      }
      checked++;
      if (worst + 1e-9 < need) {
        const [fg, bg] = worstBg;
        bad.push({
          text: text.slice(0, 40),
          ratio: Math.round(worst * 100) / 100,
          need,
          fontSize: size,
          weight,
          color: cs.color,
          fg: `rgb(${fg.map((v) => Math.round(v)).slice(0, 3).join(',')})`,
          bg: `rgb(${bg.map((v) => Math.round(v)).slice(0, 3).join(',')})`,
          where: path(el),
        });
      }
    }
    return { checked, bad };
  }

  /* ── タップ領域 44px（疑似要素で広げた分も込み） ───────── */
  function tapTargets() {
    const SEL = 'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [onclick], [tabindex]:not([tabindex="-1"])';
    const bad = [];
    let checked = 0;
    for (const el of document.querySelectorAll(SEL)) {
      if (!visible(el) || disabled(el)) continue;
      const r = el.getBoundingClientRect();
      let w = r.width, h = r.height;

      // 疑似要素で当たり判定だけ広げている形（Part I §2-9 の .tap-44）を拾う
      for (const pe of ['::after', '::before']) {
        const ps = getComputedStyle(el, pe);
        if (!ps || ps.content === 'none' || ps.display === 'none') continue;
        if (ps.position !== 'absolute' && ps.position !== 'fixed') continue;
        const pw = Math.max(parseFloat(ps.width) || 0, parseFloat(ps.minWidth) || 0);
        const ph = Math.max(parseFloat(ps.height) || 0, parseFloat(ps.minHeight) || 0);
        w = Math.max(w, pw); h = Math.max(h, ph);
      }
      // ラベルで囲ってあるチェックボックス・ラジオは、囲みの大きさで足りる
      if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
        const label = el.closest('label');
        if (label) {
          const lr = label.getBoundingClientRect();
          w = Math.max(w, lr.width); h = Math.max(h, lr.height);
        }
      }
      checked++;
      if (w < 44 || h < 44) {
        bad.push({
          where: path(el),
          text: (el.textContent || el.getAttribute('aria-label') || el.value || '').trim().slice(0, 30),
          w: Math.round(w * 10) / 10,
          h: Math.round(h * 10) / 10,
        });
      }
    }
    return { checked, bad };
  }

  /* ── 横スクロール ───────────────────────────── */
  function overflow() {
    const de = document.documentElement;
    const wide = [];
    if (de.scrollWidth > de.clientWidth + 1) {
      for (const el of document.querySelectorAll('body *')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.right > de.clientWidth + 1 || r.left < -1) {
          wide.push({ where: path(el), right: Math.round(r.right), left: Math.round(r.left) });
        }
      }
    }
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, wide: wide.slice(0, 10) };
  }

  /* ── ふりがな（rt）が読めるか ─────────────────── */
  function ruby() {
    const out = [];
    for (const rt of document.querySelectorAll('rt')) {
      if (!visible(rt)) continue;
      const cs = getComputedStyle(rt);
      const rawFg = parse(cs.color);
      const bgs = backgroundsOf(rt);
      let worst = Infinity;
      for (const bg of bgs) worst = Math.min(worst, ratio(over(rawFg, bg), bg));
      out.push({ text: rt.textContent.trim().slice(0, 10), ratio: Math.round(worst * 100) / 100, color: cs.color, where: path(rt) });
    }
    return out;
  }

  return { contrast, tapTargets, overflow, ruby, parse, ratio };
})();
