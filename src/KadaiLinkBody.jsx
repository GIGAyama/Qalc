import React, { useEffect, useRef, useState } from 'react';
import { Link2, Copy } from 'lucide-react';

/* かだいリンクのダイアログの中身（先生むけ）。
 *
 * 先生しか使わない画面なので、最初に読みこむ JS には入れず、ダイアログを開いたときに取りにいく
 * （App.jsx の KadaiLinkDialog。ダイアログの枠とフォーカスの扱い・リンクの組み立ては あちら）。
 * QR を描く qrcode（約25KB）も、ここで はじめて取りにいく。
 */
const KADAI_QR_MAX = 1200; // これより長いリンクは QR にすると細かすぎて読みとりにくい

export default function KadaiLinkBody({ url, title, setTitle, titleMax, summary, droppedMistakes, onCopy, onClose, Button, dpr }) {
  const qrRef = useRef(null);
  const [qr, setQr] = useState('loading'); // loading | ok | long | error

  useEffect(() => {
    if (url.length > KADAI_QR_MAX) { setQr('long'); return undefined; }
    let alive = true;
    const cssPx = 200;
    setQr('loading');
    import('qrcode').then(({ default: QRCode }) => {
      if (!alive || !qrRef.current) return undefined;
      return QRCode.toCanvas(qrRef.current, url, { width: cssPx * dpr, margin: 1 }).then(() => {
        if (!alive || !qrRef.current) return;
        // toCanvas は style も書きかえるので、画面での大きさをもどす
        qrRef.current.style.width = `${cssPx}px`;
        qrRef.current.style.height = `${cssPx}px`;
        setQr('ok');
      });
    }).catch(() => { if (alive) setQr('error'); });
    return () => { alive = false; };
  }, [url, dpr]);

  return (
    <>
      <h2 className="font-black text-xl text-[var(--text)] flex items-center gap-2"><Link2 size={22} aria-hidden="true" /> かだいリンク</h2>
      <p className="text-sm font-bold text-[var(--text)] leading-relaxed">このリンクか QR を こどもに わたすと、ひらいたときに ホームに「かだい」が 出て、「はじめる」で この せっていの ゲームが はじまります。</p>
      <div className="text-sm font-black text-[var(--text)] bg-[var(--bg)] border-2 border-[var(--text)] rounded-xl px-3 py-2 break-words">{summary}</div>
      {droppedMistakes && <p className="text-xs font-bold text-[var(--text)]">にがて克服ボックスは、その子の まちがいなので かだいには 入れません。</p>}
      <label className="text-sm font-bold text-[var(--text)] flex flex-col gap-1">
        かだいの なまえ（なくても よい・{titleMax}もじまで）
        <input type="text" value={title} maxLength={titleMax} onChange={e => setTitle(e.target.value)} placeholder="れい: きょうの しゅくだい" className="min-h-[44px] border-[3px] border-[var(--text)] rounded-xl px-3 font-bold bg-[var(--bg)] text-[var(--text)]" />
      </label>
      <p className="text-xs font-bold text-[var(--text)]">こどもの なまえは 入れないで ください。</p>
      <div className="flex justify-center min-h-[100px] items-center">
        {qr === 'long' && <p className="text-sm font-bold text-[var(--text)] text-center">もんだいが おおいので QR には できません。リンクを コピーして わたしてください。</p>}
        {qr === 'error' && <p className="text-sm font-bold text-[var(--text)] text-center">QR を 出せませんでした。リンクを コピーして わたしてください。</p>}
        {qr !== 'long' && qr !== 'error' && <canvas ref={qrRef} role="img" aria-label="かだいリンクの QR コード" className="bg-white p-3 rounded-xl shadow-inner" />}
      </div>
      <input type="text" readOnly value={url} aria-label="かだいリンクの URL" onFocus={e => e.target.select()} className="min-h-[44px] w-full border-2 border-[var(--text)] rounded-xl px-3 text-xs font-mono bg-[var(--bg)] text-[var(--text)]" />
      <Button className="bg-[var(--secondary)] text-[var(--on-secondary)] w-full py-3 border-[3px] border-[var(--text)]" onClick={onCopy}><Copy size={20} aria-hidden="true" /> リンクを コピー</Button>
      {/* 開いたら、押しても困らない「とじる」へフォーカスを移す（中身は あとから読みこむので autoFocus で） */}
      <Button autoFocus className="bg-[var(--bg)] text-[var(--text)] w-full py-3 border-[3px] border-[var(--text)]" onClick={onClose}>とじる</Button>
    </>
  );
}
