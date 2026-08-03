/* PWA まわり（Part I §3-2, §3-4）
 *
 *  - インストールの案内（アプリ内のボタン）
 *  - あたらしい版が来たときのお知らせ
 *
 * beforeinstallprompt そのものを受け取るのは public/pwa-install.js。
 * React より先に動く必要があるので、そこだけ <head> の外部ファイルに分けてある。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Download, RefreshCw, Share, PlusSquare, X } from 'lucide-react';
// Esc と端末の「戻る」でも閉じられるようにする（Part I §4）
import { useBackHandler, BACK_PRIORITY } from './BackNavigation.jsx';

/* ── ホーム画面から起動しているか ───────────────────────── */
export const isStandalone = () =>
    (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches)
    || (typeof navigator !== 'undefined' && navigator.standalone === true);

// iOS の Safari には beforeinstallprompt が無い。
// 「共有 → ホームがめんに追加」を自分で案内するしかないので、端末を見分ける
const isIos = () =>
    typeof navigator !== 'undefined'
    && /iP(hone|ad|od)/.test(navigator.userAgent)
    && !window.MSStream;

/* ── Service Worker の登録と更新の検出 ───────────────────── */

// 児童が「さいしんに する」を押したときだけ再読みこみする。
// clients.claim() でも controllerchange は飛ぶので、押していないのに
// 初回訪問でいきなりリロードされないよう、意図の有無を持っておく
let userRequestedUpdate = false;
let reloading = false;

const announceUpdate = (worker) => {
    window.__waitingServiceWorker = worker;
    window.dispatchEvent(new Event('pwa-update-ready'));
};

export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!userRequestedUpdate || reloading) return;
        reloading = true;
        window.location.reload();
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/Qalc/sw.js').then((reg) => {
            // 前回のうちに新しい版が入って、待機したまま閉じられていた場合
            if (reg.waiting && navigator.serviceWorker.controller) announceUpdate(reg.waiting);

            reg.addEventListener('updatefound', () => {
                const sw = reg.installing;
                if (!sw) return;
                sw.addEventListener('statechange', () => {
                    // controller がいる = 初回インストールではなく「更新」。
                    // 初回にお知らせを出すと、初めて開いた児童が意味の分からない案内を見ることになる
                    if (sw.state === 'installed' && navigator.serviceWorker.controller) announceUpdate(sw);
                });
            });
        }).catch(() => { /* 登録できなくてもアプリは動く（オフライン対応が効かないだけ） */ });
    });
}

/* ── あたらしいバージョンのお知らせ ──────────────────────── */
export const UpdateNotice = () => {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const on = () => setReady(true);
        window.addEventListener('pwa-update-ready', on);
        return () => window.removeEventListener('pwa-update-ready', on);
    }, []);

    const apply = useCallback(() => {
        userRequestedUpdate = true;
        const sw = window.__waitingServiceWorker;
        if (sw) sw.postMessage({ type: 'SKIP_WAITING' });
        // 待機中のものが見つからないときのための保険。
        // 押したのに何も起きないのがいちばん困る
        else window.location.reload();
    }, []);

    if (!ready) return null;

    return (
        <div
            // 状態の変化を読み上げてもらう。押さなくても先に進めるので polite
            role="status"
            aria-live="polite"
            className="fixed left-0 right-0 z-[110] flex justify-center px-4 pointer-events-none"
            style={{ bottom: 'calc(16px + var(--safe-b))' }}
        >
            <div className="pointer-events-auto flex items-center gap-3 bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-2xl shadow-[3px_3px_0_var(--text)] px-4 py-3 max-w-md w-full">
                <RefreshCw size={22} className="text-[var(--primary)] shrink-0" />
                <span className="font-bold text-sm text-[var(--text)] flex-grow leading-snug">
                    あたらしい バージョンが あります
                </span>
                <button
                    type="button"
                    onClick={apply}
                    className="shrink-0 min-h-[44px] px-4 rounded-xl border-[3px] border-[var(--text)] bg-[var(--primary)] text-[var(--panel)] font-black text-sm active:scale-95 transition-transform"
                >
                    さいしんに する
                </button>
                <button
                    type="button"
                    onClick={() => setReady(false)}
                    aria-label="あとにする"
                    className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text)] opacity-80 hover:opacity-100"
                >
                    <X size={18} />
                </button>
            </div>
        </div>
    );
};

/* ── インストールのボタン ─────────────────────────────── */
export const InstallButton = ({ onSound }) => {
    const [canInstall, setCanInstall] = useState(() => !!window.__deferredInstallPrompt);
    const [installed, setInstalled] = useState(() => isStandalone());
    const [showIosHelp, setShowIosHelp] = useState(false);
    // 開いているあいだだけ、Esc と端末の「戻る」を受けとる
    useBackHandler(showIosHelp, () => { setShowIosHelp(false); return true; }, BACK_PRIORITY.overlay);

    useEffect(() => {
        const onReady = () => setCanInstall(true);
        const onDone = () => { setCanInstall(false); setInstalled(true); };
        window.addEventListener('pwa-installable', onReady);
        window.addEventListener('pwa-installed', onDone);
        return () => {
            window.removeEventListener('pwa-installable', onReady);
            window.removeEventListener('pwa-installed', onDone);
        };
    }, []);

    const install = async () => {
        onSound?.();
        const e = window.__deferredInstallPrompt;
        if (!e) return;
        window.__deferredInstallPrompt = null;
        setCanInstall(false);
        try {
            e.prompt();
            await e.userChoice;
        } catch (err) { /* 断られてもアプリはそのまま使える */ }
    };

    // すでにホーム画面から起動しているなら出す意味がない
    if (installed) return null;

    // iOS は beforeinstallprompt が来ないので、手順を案内するボタンを出す
    if (!canInstall && !isIos()) return null;

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => { onSound?.(); if (isIos() && !canInstall) setShowIosHelp((v) => !v); else install(); }}
                aria-label="アプリとしてインストールする"
                className="p-2 rounded-full transition-all border-2 border-transparent text-[var(--text)] opacity-80 hover:opacity-100 hover:border-[var(--text)] hover:bg-[var(--bg)] min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
                <Download size={24} />
            </button>

            {showIosHelp && (
                <>
                    <button
                        type="button"
                        aria-label="とじる"
                        className="fixed inset-0 z-[90] cursor-default"
                        onClick={() => { onSound?.(); setShowIosHelp(false); }}
                    />
                    <div
                        role="dialog"
                        aria-modal="false"
                        aria-label="ホームがめんに ついかする"
                        className="absolute right-0 top-full mt-2 z-[95] w-72 bg-[var(--panel)] border-[3px] border-[var(--text)] rounded-2xl shadow-xl p-4 text-left"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-black text-sm text-[var(--text)]">ホームがめんに ついかする</span>
                            <button
                                type="button"
                                onClick={() => { onSound?.(); setShowIosHelp(false); }}
                                aria-label="とじる"
                                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text)] opacity-80 hover:opacity-100"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <ol className="text-sm text-[var(--text)] flex flex-col gap-2 leading-snug">
                            <li className="flex items-start gap-2">
                                <Share size={18} className="shrink-0 mt-0.5 text-[var(--primary)]" />
                                <span>下（または右上）の <b>きょうゆう</b> ボタンを おす</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <PlusSquare size={18} className="shrink-0 mt-0.5 text-[var(--primary)]" />
                                <span><b>「ホーム画面に追加」</b> を えらぶ</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="shrink-0 mt-0.5 w-[18px] text-center font-black text-[var(--primary)]">3</span>
                                <span>右上の <b>「追加」</b> を おす</span>
                            </li>
                        </ol>
                        <p className="mt-3 text-[11px] text-[var(--text)] opacity-80 leading-snug">
                            ホームがめんに おいておくと、インターネットに つながっていなくても あそべます。
                        </p>
                    </div>
                </>
            )}
        </div>
    );
};
