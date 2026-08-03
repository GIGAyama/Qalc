import React, { useEffect, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';

// ==========================================
// スマホ・タブレットの「戻る」操作をアプリの中で受けとめるしくみ
// ------------------------------------------
// ・画面下のナビゲーションバーの戻るボタン
// ・画面の左右のはしから中央へむかってのスワイプ(ジェスチャー操作)
// のどちらでも、アプリの中で1つ前の階層にもどれるようにする。
//
// しくみ:
//  1) 起動したときにダミーの履歴(=番人)を1つ積んでおく。端末の「戻る」はこの番人を
//     消すだけなので、ブラウザが前のページへ動いたり、ホーム画面に追加したアプリ(PWA)が
//     終了したりしない。
//  2) popstate を受けとったらすぐ番人を積みなおし、そのうえでアプリ内の「戻る」を実行する。
//  3) エッジスワイプでも同じ「戻る」を呼ぶ。端末じたいのジェスチャーと二重に反応しないよう、
//     短いあいだに2回目が来たときは無視する(=ブラウザの戻ると同時には動かない)。
// ==========================================

// 「戻る」を受けとる順番。数が大きいほど先に呼ばれる(同じ数なら後から登録したほうが先)。
// overlay: ダイアログなど最前面のもの / panel: メモなどの引き出し
// view:    その画面が自分で処理したいとき      / app:   画面から1つ前の階層へもどる既定の動き
export const BACK_PRIORITY = { overlay: 30, panel: 25, view: 20, app: 10 };

const handlers = [];
let registerSeq = 0;

// 「戻る」ハンドラを登録する。戻り値は登録を取りけす関数。
export const registerBackHandler = (fn, priority = BACK_PRIORITY.view) => {
  const entry = { fn, priority, seq: ++registerSeq };
  handlers.push(entry);
  return () => {
    const i = handlers.indexOf(entry);
    if (i >= 0) handlers.splice(i, 1);
  };
};

// 優先度の高いものから順に呼び、最初に true を返したところで止める。
// minPriority を指定すると、それ未満の受け手には回さない
const dispatchBack = (minPriority = 0) => {
  const ordered = [...handlers]
    .filter((h) => h.priority >= minPriority)
    .sort((a, b) => (b.priority - a.priority) || (b.seq - a.seq));
  for (const h of ordered) {
    let handled = false;
    try { handled = h.fn() === true; } catch (e) { handled = false; }
    if (handled) return true;
  }
  return false;
};

/* Esc キーでいちばん手前のものを閉じる（Part I §4）。
 *
 * 「戻る」と同じ受け手を使いまわすが、閉じる対象は overlay と panel だけにしてある。
 * Esc で画面そのものが1つ前へもどってしまうと、キーボードで操作している人が
 * 意図せず学習をやめてしまうため（Esc は「閉じる」であって「戻る」ではない）。 */
export const dispatchEscape = () => dispatchBack(BACK_PRIORITY.panel);

// 端末の戻るボタンとエッジスワイプが同時に発火しても、「戻る」は1回だけにする。
// (わざと2回つづけて戻る操作をしたときはちゃんと2階層もどれるよう、時間は短めにしてある)
const BACK_COOLDOWN_MS = 350;
let lastBackAt = 0;
export const goBack = () => {
  const now = Date.now();
  if (now - lastBackAt < BACK_COOLDOWN_MS) return false;
  lastBackAt = now;
  return dispatchBack();
};

// active が true のあいだだけ handler を「戻る」の受け手として登録する。
// handler が true を返したら「この画面で処理した」という意味になり、そこで打ち止め。
export const useBackHandler = (active, handler, priority = BACK_PRIORITY.view) => {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; });
  useEffect(() => {
    if (!active) return undefined;
    return registerBackHandler(() => handlerRef.current(), priority);
  }, [active, priority]);
};

// --- 履歴の番人 ---
const GUARD_KEY = 'qalcBackGuard';

export const useHistoryBackGuard = () => {
  useEffect(() => {
    const pushGuard = () => {
      try { window.history.pushState({ [GUARD_KEY]: true }, ''); } catch (e) { /* 履歴が使えない環境では何もしない */ }
    };

    // すでに番人の上にいる(リロードなど)ときは積みなおさない
    if (!(window.history.state && window.history.state[GUARD_KEY])) pushGuard();

    const onPopState = () => {
      // 先に積みなおして履歴を切らさない。こうしておくと次の「戻る」もアプリ側で受けとれる。
      pushGuard();
      goBack();
    };

    /* Esc は「いちばん手前のものを閉じる」。
     * ゲーム画面は Esc に「入力した数字を消す」を割りあてているので、
     * ダイアログを閉じたときは stopImmediatePropagation でそちらへ流さない
     * （ダイアログを閉じたつもりで、書きかけの答えまで消えないように）。
     * この受け手はアプリの最上位で1回だけ登録されるので、
     * 画面ごとの keydown より先に呼ばれる。 */
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (dispatchEscape()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
};

// --- 画面のはしからのスワイプ ---
const EDGE_WIDTH = 32;      // 画面のはしから何pxまでを「はしっこ」とみなすか
const TRIGGER_DIST = 72;    // 中央へ何px動かしたら「戻る」とみなすか
const OFF_AXIS_LIMIT = 48;  // たてにこれ以上ぶれたらスワイプではないとみなす

// 横スクロールする場所(学年えらびのタブなど)から始まったスワイプは、戻るあつかいにしない
const startsInHorizontalScroller = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.dataset && n.dataset.backSwipeIgnore !== undefined) return true;
    if (n.scrollWidth - n.clientWidth > 4) {
      const overflowX = window.getComputedStyle(n).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
  }
  return false;
};

// はしからのスワイプを見はって「戻る」を呼ぶ。指の動きに合わせて目印も出す。
export const EdgeSwipeBack = ({ enabled = true }) => {
  const [drag, setDrag] = useState(null); // { side: 'left'|'right', progress: 0〜1 }
  const startRef = useRef(null);

  useEffect(() => {
    if (!enabled) { setDrag(null); startRef.current = null; return undefined; }

    const reset = () => { startRef.current = null; setDrag(null); };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return reset();
      const t = e.touches[0];
      const w = window.innerWidth;
      const side = t.clientX <= EDGE_WIDTH ? 'left' : (t.clientX >= w - EDGE_WIDTH ? 'right' : null);
      if (!side) return;
      if (e.target instanceof Element && startsInHorizontalScroller(e.target)) return;
      startRef.current = { side, x: t.clientX, y: t.clientY };
      setDrag({ side, progress: 0 });
    };

    const onTouchMove = (e) => {
      const start = startRef.current;
      if (!start) return;
      if (e.touches.length !== 1) return reset();
      const t = e.touches[0];
      const toCenter = start.side === 'left' ? (t.clientX - start.x) : (start.x - t.clientX);
      const offAxis = Math.abs(t.clientY - start.y);
      // たてにぶれた・逆向きに動いた場合は、スワイプではなかったものとしてやめる
      if (toCenter < -8 || (offAxis > OFF_AXIS_LIMIT && offAxis > toCenter)) return reset();
      setDrag({ side: start.side, progress: Math.max(0, Math.min(1, toCenter / TRIGGER_DIST)) });
    };

    const onTouchEnd = (e) => {
      const start = startRef.current;
      if (!start) return;
      const t = e.changedTouches && e.changedTouches[0];
      const toCenter = t ? (start.side === 'left' ? (t.clientX - start.x) : (start.x - t.clientX)) : 0;
      const offAxis = t ? Math.abs(t.clientY - start.y) : 0;
      reset();
      if (toCenter >= TRIGGER_DIST && offAxis <= OFF_AXIS_LIMIT) goBack();
    };

    // passive: なにも打ちけさないので、ふつうのスクロールや端末のジェスチャーはそのまま動く
    const opts = { passive: true };
    window.addEventListener('touchstart', onTouchStart, opts);
    window.addEventListener('touchmove', onTouchMove, opts);
    window.addEventListener('touchend', onTouchEnd, opts);
    window.addEventListener('touchcancel', reset, opts);
    return () => {
      window.removeEventListener('touchstart', onTouchStart, opts);
      window.removeEventListener('touchmove', onTouchMove, opts);
      window.removeEventListener('touchend', onTouchEnd, opts);
      window.removeEventListener('touchcancel', reset, opts);
    };
  }, [enabled]);

  if (!drag || drag.progress <= 0.02) return null;
  const ready = drag.progress >= 1;
  const offset = drag.progress * 28;

  return (
    <div
      className="fixed top-1/2 z-[9998] pointer-events-none"
      style={{
        [drag.side]: 0,
        transform: `translateY(-50%) translateX(${drag.side === 'left' ? offset : -offset}px)`,
        opacity: 0.35 + drag.progress * 0.65,
      }}
    >
      <div
        className={`flex items-center justify-center w-14 h-14 border-[3px] border-[var(--text)] shadow-[0_2px_0_rgba(0,0,0,0.2)] transition-colors ${ready ? 'bg-[var(--secondary)] text-[var(--panel)]' : 'bg-[var(--panel)] text-[var(--text)]'}`}
        style={{ borderRadius: drag.side === 'left' ? '0 999px 999px 0' : '999px 0 0 999px' }}
      >
        <Undo2 size={26} strokeWidth={3} style={{ transform: drag.side === 'right' ? 'scaleX(-1)' : 'none' }} />
      </div>
    </div>
  );
};
