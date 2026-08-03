/* 提示モード（電子黒板・一斉授業むけ） — Part I §2-11
 *
 * ボスバトル・じんとりバトルはクラス全体でやる機能なので、教員機を電子黒板につないで
 * 大きく映すことがある。教室のいちばん後ろの席から読めることが要件で、ふだんの文字の
 * 大きさでは足りない。body に .presentation を付けて、CSS 側で文字とボタンを拡大する。
 *
 * 名前を伏せるのが既定なのは、電子黒板は廊下や参観の保護者からも見えるため。
 * 教員が必要と判断したときだけ表に出す（＝オプトイン）。
 *
 * 演出をへらす設定もここに置く。端末の「視差効果を減らす」を見るだけでは、
 * 感覚過敏の児童が自分の端末で紙吹雪や振動を止められない（OS設定は児童が触れないことが多い）。
 */
import React, { useSyncExternalStore, useCallback, useEffect, useState } from 'react';
import { Presentation, Maximize, Minimize, X } from 'lucide-react';
// Esc と端末の「戻る」でも閉じられるようにする（Part I §4）
import { useBackHandler, BACK_PRIORITY } from './BackNavigation.jsx';

// 自アプリ接頭辞のキー。学習ログ(study.records.v1)とは別なので、リセットしても学習記録は消えない
const KEY = 'qalc.presentation.v1';

const DEFAULTS = { big: false, maskNames: true, reduceFx: false };

const read = () => {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return DEFAULTS;
        const p = JSON.parse(raw);
        return {
            big: !!p.big,
            // 既定は「伏せる」。保存値が無い/壊れているときも伏せる側に倒す
            maskNames: p.maskNames !== false,
            reduceFx: !!p.reduceFx,
        };
    } catch (e) {
        return DEFAULTS;
    }
};

let state = read();
const listeners = new Set();

// body のクラスは CSS の入口。状態が変わるたびに揃える
const syncBody = () => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('presentation', state.big);
    document.body.classList.toggle('reduce-fx', state.reduceFx);
};
syncBody();

const emit = () => {
    syncBody();
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { /* 保存できなくても表示は続ける */ }
    listeners.forEach((l) => l());
};

const subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
};

const getSnapshot = () => state;

export const setPresentation = (patch) => {
    state = { ...state, ...patch };
    emit();
};

export const usePresentation = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/* 演出をへらすかどうかの判定。
 * 端末の設定（OS の「視差効果を減らす」）と、アプリ内の設定のどちらかが立っていれば減らす。
 * CSS 側は index.css の @media (prefers-reduced-motion) と body.reduce-fx が受け持つ。 */
let mql = null;
export const prefersReducedMotion = () => {
    if (state.reduceFx) return true;
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    if (!mql) mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    return mql.matches;
};

/* 名前の伏せ字。「たろう」→「た○○」
 * 先頭1文字を残すのは、リーダーが誰の申しこみか分かるようにするため。
 * 伸ばしすぎると人数が推測できてしまうので ○ は3つまで。 */
export const maskPupilName = (name) => {
    const s = String(name ?? '');
    if (s.length <= 1) return '○';
    return s[0] + '○'.repeat(Math.min(s.length - 1, 3));
};

/* 児童の名前を出すところは、必ずこれを通す。
 * 提示モードのあいだだけ伏せ字になる（ふだんの1人用画面ではそのまま出る）。
 * 教材名・問題セット名・ボスの名前など、個人情報でないものには使わない。 */
export const PupilName = ({ name }) => {
    const { big, maskNames } = usePresentation();
    return <>{big && maskNames ? maskPupilName(name) : name}</>;
};

const useFullscreen = () => {
    const [isFull, setIsFull] = useState(() =>
        typeof document !== 'undefined' && !!document.fullscreenElement);

    useEffect(() => {
        const onChange = () => setIsFull(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    // iPad の Safari は要素の requestFullscreen に対応していない。
    // 失敗しても「大きく表示」だけは効くので、握りつぶして進める
    const toggle = useCallback(() => {
        try {
            if (document.fullscreenElement) document.exitFullscreen?.();
            else document.documentElement.requestFullscreen?.();
        } catch (e) { /* 全画面にできない端末では何もしない */ }
    }, []);

    return [isFull, toggle];
};

/* ヘッダーに置く提示モードのボタン。押すと設定パネルが開く */
export const PresentationControl = ({ onSound }) => {
    const { big, maskNames, reduceFx } = usePresentation();
    const [open, setOpen] = useState(false);
    const [isFull, toggleFull] = useFullscreen();
    // 開いているあいだだけ、Esc と端末の「戻る」を受けとる
    useBackHandler(open, () => { setOpen(false); return true; }, BACK_PRIORITY.overlay);

    const click = (fn) => () => { onSound?.(); fn(); };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={click(() => setOpen((v) => !v))}
                aria-label="ていじモードのせってい"
                aria-expanded={open}
                className={`p-2 rounded-full transition-all border-2 min-w-[44px] min-h-[44px] flex items-center justify-center
                    ${big
                        ? 'text-[var(--primary-d)] border-[var(--text)] bg-[var(--accent)]'
                        : 'text-[var(--text)] opacity-80 hover:opacity-100 border-transparent hover:border-[var(--text)] hover:bg-[var(--bg)]'}`}
            >
                <Presentation size={24} />
            </button>

            {open && (
                <>
                    {/* 画面のどこを押しても閉じられるようにする（低学年でも迷わない） */}
                    <button
                        type="button"
                        aria-label="とじる"
                        className="fixed inset-0 z-[90] cursor-default"
                        onClick={click(() => setOpen(false))}
                    />
                    <div
                        role="dialog"
                        aria-modal="false"
                        aria-label="ていじモード"
                        // presentation-panel: 提示モードでは文字が1.5倍になるぶん、
                        // パネル自体も広げないと項目名が何行にも折り返してしまう（index.css）
                        className="presentation-panel absolute right-0 top-full mt-2 z-[95] w-64 bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-2xl shadow-xl p-3 flex flex-col gap-2"
                    >
                        <div className="flex items-center justify-between">
                            <span className="font-black text-sm text-[var(--text)]">ていじモード</span>
                            <button
                                type="button"
                                onClick={click(() => setOpen(false))}
                                aria-label="とじる"
                                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text)] opacity-80 hover:opacity-100"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <PanelToggle
                            checked={big}
                            onChange={click(() => setPresentation({ big: !big }))}
                            label="大きく表示する"
                            hint="教室のうしろからも読める大きさにします"
                        />
                        <PanelToggle
                            checked={maskNames}
                            onChange={click(() => setPresentation({ maskNames: !maskNames }))}
                            label="名前をかくす"
                            hint="大きく表示中だけ「た○○」のように伏せます"
                        />
                        <PanelToggle
                            checked={reduceFx}
                            onChange={click(() => setPresentation({ reduceFx: !reduceFx }))}
                            label="えんしゅつをへらす"
                            hint="紙ふぶき・画面のゆれ・ふるえを止めます"
                        />

                        <button
                            type="button"
                            onClick={click(toggleFull)}
                            className="mt-1 flex items-center justify-center gap-2 min-h-[44px] rounded-xl border-[3px] border-[var(--text)] bg-[var(--bg)] font-bold text-sm text-[var(--text)] active:scale-95 transition-transform"
                        >
                            {isFull ? <Minimize size={18} /> : <Maximize size={18} />}
                            {isFull ? 'ぜんがめんをやめる' : 'ぜんがめんにする'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

const PanelToggle = ({ checked, onChange, label, hint }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className="flex items-start gap-2 text-left min-h-[44px] rounded-xl px-2 py-1.5 hover:bg-[var(--bg)] transition-colors"
    >
        {/* 色だけで状態を伝えない。チェックの形と ON/OFF のことばを添える（Part I §2-8） */}
        <span
            aria-hidden="true"
            className={`mt-0.5 shrink-0 w-6 h-6 rounded-md border-[3px] border-[var(--text)] flex items-center justify-center text-xs font-black
                ${checked ? 'bg-[var(--primary)] text-[var(--on-primary)]' : 'bg-[var(--panel)] text-transparent'}`}
        >
            ✓
        </span>
        <span className="flex flex-col">
            <span className="font-bold text-sm text-[var(--text)] leading-tight">
                {label}
                <span className="ml-1 text-[10px] opacity-60">{checked ? 'ON' : 'OFF'}</span>
            </span>
            <span className="text-[10px] text-[var(--text)] opacity-80 leading-tight">{hint}</span>
        </span>
    </button>
);
