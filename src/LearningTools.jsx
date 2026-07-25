import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lightbulb, LayoutGrid, Cherry, PencilLine, Table2, Clock, Ruler, GlassWater, Circle } from 'lucide-react';

// ==========================================
// 学習補助ツール（算数ブロック・さくらんぼ計算・筆算・位取り表）
// 問題の内容（数の大きさ・演算の種類）から使えるどうぐを自動判定し、
// ゲーム中にボトムシートでさっと開けるようにする。
// ==========================================

// 「12+7」「0.2 × 3」「123×4」のような単純な2項演算をパースする
const parseArith = (qText) => {
  if (!qText) return null;
  const s = String(qText).replace(/\s/g, '').replace(/[xX*]/g, '×');
  const m = s.match(/^(\d+(?:\.\d+)?)([+\-−×÷])(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[3]);
  const op = m[2] === '−' ? '-' : m[2];
  return { a, b, op, aStr: m[1], bStr: m[3], isInt: Number.isInteger(a) && Number.isInteger(b) };
};

const extractNumbers = (qText) => (String(qText).match(/\d+(?:\.\d+)?/g) || []).slice(0, 2);

// ---- 図で見る系（時計・長さ・かさ・円）の問題文パース ----
const parseClock = (q) => {
  let m = q.match(/みじかい はりが (\d+)。ながい はりが 12/);
  if (m) return { hour: +m[1], minute: 0 };
  m = q.match(/みじかい はりが (\d+)と \d+の あいだ。ながい はりが 6/);
  if (m) return { hour: +m[1], minute: 30 };
  m = q.match(/いま (\d+)じ です/);
  if (m) return { hour: +m[1], minute: 0 };
  m = q.match(/ながい はりが 12から (\d+)まで うごきました/);
  if (m) return { minute: +m[1] * 5, noHour: true, arc: [0, +m[1] * 5] };
  m = q.match(/ながい はりが (\d+)の ところから、(\d+)つ すすみました/);
  if (m) {
    const start = +m[1] * 5;
    return { minute: (start + +m[2] * 5) % 60, noHour: true, ghostMinute: start, arc: [start, start + +m[2] * 5] };
  }
  m = q.match(/ながい はりが (\d+)の とき/);
  if (m) return { minute: +m[1] * 5, noHour: true };
  return null;
};

const parseTape = (q) => {
  let m = q.match(/(\d+)cmの テープと (\d+)cmの テープを つなぐと/);
  if (m) return { type: 'join', a: +m[1], b: +m[2] };
  m = q.match(/(\d+)cmの ひもから (\d+)cm きりとると/);
  if (m) return { type: 'cut', a: +m[1], b: +m[2] };
  return null;
};

const parseKasa = (q) => {
  let m = q.match(/(\d+)Lの 水と (\d+)Lの 水を あわせると/);
  if (m) return { type: 'join', a: +m[1], b: +m[2], unit: 'L' };
  m = q.match(/(\d+)dLの ジュースから (\d+)dL のむと/);
  if (m) return { type: 'cut', a: +m[1], b: +m[2], unit: 'dL' };
  return null;
};

const parseCircle = (q) => {
  let m = q.match(/はんけいが (\d+)cmの えん/);
  if (m) return { kind: 'radius', v: +m[1] };
  m = q.match(/ちょっけいが (\d+)cmの えん/);
  if (m) return { kind: 'diameter', v: +m[1] };
  return null;
};

export const TOOL_META = {
  tokei: { Icon: Clock, label: 'とけい' },
  nagasa: { Icon: Ruler, label: 'ながさ' },
  kasa: { Icon: GlassWater, label: 'かさ' },
  en: { Icon: Circle, label: 'えん' },
  blocks: { Icon: LayoutGrid, label: 'ブロック' },
  sakuranbo: { Icon: Cherry, label: 'さくらんぼ' },
  hissan: { Icon: PencilLine, label: 'ひっ算' },
  kurai: { Icon: Table2, label: 'くらい' },
};

// 問題文とコース名から、この問題で役に立つどうぐの一覧を返す
export const getAvailableTools = (courseName = '', qText = '') => {
  const p = parseArith(qText);
  const tools = [];
  const isLowGrade = /^[12]年/.test(courseName);

  // 図で見る系は問題文そのものを図にするので、使えるときは先頭（初期タブ）にする
  if (parseClock(qText)) tools.push('tokei');
  if (parseTape(qText)) tools.push('nagasa');
  if (parseKasa(qText)) tools.push('kasa');
  if (parseCircle(qText)) tools.push('en');
  const hasGraphic = tools.length > 0;

  if (p && p.isInt && (p.op === '+' || p.op === '-')) {
    const result = p.op === '+' ? p.a + p.b : p.a - p.b;
    if (p.a <= 20 && p.b <= 20 && result >= 0 && result <= 20) tools.push('blocks');
  } else if (!p && isLowGrade && !hasGraphic) {
    // 1・2年の文章題などは自由に数えられるブロックを出す
    tools.push('blocks');
  }

  if (p && p.isInt) {
    if (p.op === '+' && p.a < 10 && p.b < 10 && p.a + p.b > 10) tools.push('sakuranbo');
    if (p.op === '-' && p.a > 10 && p.a < 20 && p.b < 10 && p.a % 10 < p.b) tools.push('sakuranbo');
  }

  if (p && p.isInt) {
    if ((p.op === '+' || p.op === '-') && p.a >= 10 && p.b >= 10) tools.push('hissan');
    if ((p.op === '×' || p.op === '÷') && p.a >= 10) tools.push('hissan');
  }

  const nums = extractNumbers(qText);
  if (nums.some((n) => parseFloat(n) >= 100 || n.includes('.'))) tools.push('kurai');

  return tools;
};

const ToolHint = ({ children }) => (
  <p className="text-center text-xs font-bold text-[var(--text)] opacity-60 leading-relaxed">{children}</p>
);

// ---- 算数ブロック ----
const Block = ({ color, marked, crossed, onClick }) => (
  <button
    onClick={onClick}
    className={`relative w-9 h-9 sm:w-10 sm:h-10 rounded-lg border-2 border-[var(--text)] shadow-[0_2px_0_var(--text)] active:translate-y-[2px] active:shadow-none transition-all select-none touch-manipulation ${color} ${crossed ? 'opacity-30' : ''} ${marked ? 'ring-4 ring-[var(--accent)]' : ''}`}
  >
    {crossed && <span className="absolute inset-0 flex items-center justify-center text-xl font-black text-[var(--text)]">✕</span>}
  </button>
);

const BlockGrid = ({ count, color, states, onToggle }) => (
  <div className="grid grid-cols-5 gap-1.5 justify-items-center">
    {Array.from({ length: count }).map((_, i) => (
      <Block key={i} color={color} marked={states?.[i] === 'marked'} crossed={states?.[i] === 'crossed'} onClick={() => onToggle && onToggle(i)} />
    ))}
  </div>
);

const BlocksTool = ({ p, onFx }) => {
  const [states, setStates] = useState({});
  const [freeCount, setFreeCount] = useState(5);

  if (!p) {
    return (
      <div className="flex flex-col items-center gap-4">
        <ToolHint>ブロックを ふやしたり へらしたりして かんがえよう</ToolHint>
        <div className="flex items-center gap-4">
          <button onClick={() => { onFx?.(); setFreeCount((c) => Math.max(0, c - 1)); }} className="w-14 h-14 rounded-2xl bg-[var(--bg)] border-[3px] border-[var(--text)] font-black text-3xl text-[var(--primary)] shadow-[0_3px_0_var(--text)] active:translate-y-[2px] active:shadow-none touch-manipulation">−</button>
          <div className="font-black text-4xl text-[var(--text)] w-16 text-center">{freeCount}</div>
          <button onClick={() => { onFx?.(); setFreeCount((c) => Math.min(20, c + 1)); }} className="w-14 h-14 rounded-2xl bg-[var(--bg)] border-[3px] border-[var(--text)] font-black text-3xl text-[var(--secondary)] shadow-[0_3px_0_var(--text)] active:translate-y-[2px] active:shadow-none touch-manipulation">＋</button>
        </div>
        <BlockGrid count={freeCount} color="bg-orange-400" />
      </div>
    );
  }

  const toggle = (group) => (i) => {
    onFx?.();
    const key = `${group}_${i}`;
    setStates((s) => ({ ...s, [key]: s[key] ? null : p.op === '-' && group === 'a' ? 'crossed' : 'marked' }));
  };

  if (p.op === '+') {
    return (
      <div className="flex flex-col items-center gap-4">
        <ToolHint>ブロックを タップしながら かぞえてみよう</ToolHint>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-6">
          <div className="flex flex-col items-center gap-2">
            <span className="font-black text-2xl text-orange-500">{p.a}</span>
            <BlockGrid count={p.a} color="bg-orange-400" states={Object.fromEntries(Array.from({ length: p.a }).map((_, i) => [i, states[`a_${i}`]]))} onToggle={toggle('a')} />
          </div>
          <span className="font-black text-3xl text-[var(--text)]">＋</span>
          <div className="flex flex-col items-center gap-2">
            <span className="font-black text-2xl text-sky-500">{p.b}</span>
            <BlockGrid count={p.b} color="bg-sky-400" states={Object.fromEntries(Array.from({ length: p.b }).map((_, i) => [i, states[`b_${i}`]]))} onToggle={toggle('b')} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <ToolHint>ひくかずのぶんだけ タップして けしてみよう</ToolHint>
      <div className="flex flex-col items-center gap-2">
        <span className="font-black text-2xl text-orange-500">{p.a} − {p.b}</span>
        <BlockGrid count={p.a} color="bg-orange-400" states={Object.fromEntries(Array.from({ length: p.a }).map((_, i) => [i, states[`a_${i}`]]))} onToggle={toggle('a')} />
      </div>
    </div>
  );
};

// ---- さくらんぼ計算 ----
const CherryCircle = ({ value, revealed, onReveal }) => (
  <button
    onClick={onReveal}
    className={`w-14 h-14 rounded-full border-[3px] border-[var(--text)] font-black text-2xl flex items-center justify-center shadow-[0_3px_0_var(--text)] active:translate-y-[2px] active:shadow-none transition-all touch-manipulation ${revealed ? 'bg-[var(--accent)] text-[var(--text)]' : 'bg-[var(--bg)] text-[var(--text)] opacity-70'}`}
  >
    {revealed ? value : '?'}
  </button>
);

const SakuranboTool = ({ p, onFx }) => {
  const [revealed, setRevealed] = useState([false, false]);
  if (!p) return null;

  const isAdd = p.op === '+';
  // たし算: 後ろの数を「10になる数」とのこりに分ける ／ ひき算(減加法): 前の数を10とのこりに分ける
  const split = isAdd ? [10 - p.a, p.b - (10 - p.a)] : [10, p.a - 10];
  const hint = isAdd
    ? `${p.a} は あといくつで 10 に なるかな？`
    : `10 の まとまりから ${p.b} を ひいてみよう`;

  const reveal = (i) => {
    onFx?.();
    setRevealed((r) => r.map((v, idx) => (idx === i ? true : v)));
  };

  const NumberBox = ({ n, isTarget }) => (
    <div className="flex flex-col items-center">
      <span className={`font-black text-5xl ${isTarget ? 'text-[var(--primary)]' : 'text-[var(--text)]'}`}>{n}</span>
      {isTarget && (
        <>
          <svg width="90" height="26" className="mt-1" aria-hidden="true">
            <line x1="45" y1="0" x2="16" y2="26" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
            <line x1="45" y1="0" x2="74" y2="26" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div className="flex gap-4 mt-1">
            <CherryCircle value={split[0]} revealed={revealed[0]} onReveal={() => reveal(0)} />
            <CherryCircle value={split[1]} revealed={revealed[1]} onReveal={() => reveal(1)} />
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-4">
      <ToolHint>{hint}<br />？をタップすると さくらんぼが ひらくよ</ToolHint>
      <div className="flex items-start justify-center gap-3">
        <NumberBox n={p.a} isTarget={!isAdd} />
        <span className="font-black text-4xl text-[var(--text)] mt-1">{isAdd ? '＋' : '−'}</span>
        <NumberBox n={p.b} isTarget={isAdd} />
      </div>
    </div>
  );
};

// ---- 筆算表示 ----
const HissanTool = ({ p }) => {
  if (!p) return null;
  const aStr = String(p.a);
  const bStr = String(p.b);

  const DigitCell = ({ ch }) => (
    <div className="w-10 h-12 sm:w-12 sm:h-14 flex items-center justify-center font-black text-3xl sm:text-4xl text-[var(--text)]">{ch}</div>
  );
  const EmptyCell = () => <div className="w-10 h-12 sm:w-12 sm:h-14" />;
  const AnswerCell = () => <div className="w-10 h-12 sm:w-12 sm:h-14 rounded-lg border-2 border-dashed border-[var(--text)] opacity-40 m-0.5" />;

  if (p.op === '÷') {
    return (
      <div className="flex flex-col items-center gap-4">
        <ToolHint>メモに かきうつして けいさんしてみよう</ToolHint>
        <div className="flex items-end">
          <span className="font-black text-4xl sm:text-5xl text-[var(--text)] pr-2 pb-1">{bStr}</span>
          <div className="border-l-4 border-t-4 border-[var(--text)] rounded-tl-lg pl-3 pt-1 pr-2">
            <span className="font-black text-4xl sm:text-5xl text-[var(--text)]">{aStr}</span>
          </div>
        </div>
      </div>
    );
  }

  const width = Math.max(aStr.length, bStr.length) + 1;
  const padRow = (str, withOp) => {
    const cells = [];
    for (let i = 0; i < width - str.length; i++) cells.push(withOp && i === 0 ? 'OP' : null);
    return [...cells, ...str.split('')];
  };
  const opChar = p.op === '×' ? '×' : p.op === '+' ? '＋' : '−';
  const topRow = padRow(aStr, false);
  const bottomRow = padRow(bStr, true);
  const answerLen = p.op === '×' ? String(p.a * p.b).length : width;

  return (
    <div className="flex flex-col items-center gap-4">
      <ToolHint>メモに かきうつして けいさんしてみよう</ToolHint>
      <div className="inline-flex flex-col bg-[var(--bg)] rounded-2xl border-2 border-[var(--text)] px-4 py-3">
        <div className="flex">{topRow.map((ch, i) => (ch === null ? <EmptyCell key={i} /> : <DigitCell key={i} ch={ch} />))}</div>
        <div className="flex border-b-4 border-[var(--text)] pb-1">
          {bottomRow.map((ch, i) => (ch === null ? <EmptyCell key={i} /> : ch === 'OP' ? <DigitCell key={i} ch={opChar} /> : <DigitCell key={i} ch={ch} />))}
        </div>
        <div className="flex justify-end pt-1">
          {Array.from({ length: Math.max(answerLen, width) }).map((_, i) => <AnswerCell key={i} />)}
        </div>
      </div>
    </div>
  );
};

// ---- 位取り表 ----
const INT_LABELS = ['億', '千万', '百万', '十万', '万', '千', '百', '十', '一'];
const FRAC_LABELS = ['1/10', '1/100', '1/1000'];

const KuraiTool = ({ qText }) => {
  const nums = extractNumbers(qText);
  if (nums.length === 0) return null;

  const maxInt = Math.max(...nums.map((n) => n.split('.')[0].length), 2);
  const maxFrac = Math.max(...nums.map((n) => (n.split('.')[1] || '').length), 0);
  const intLabels = INT_LABELS.slice(Math.max(0, INT_LABELS.length - Math.min(maxInt, 9)));
  const fracLabels = FRAC_LABELS.slice(0, Math.min(maxFrac, 3));

  const cellsFor = (n) => {
    const [intPart, fracPart = ''] = n.split('.');
    const intDigits = intPart.slice(-9).padStart(intLabels.length, ' ').split('');
    const fracDigits = fracLabels.map((_, i) => fracPart[i] ?? ' ');
    return { intDigits, fracDigits };
  };

  const Cell = ({ ch, highlight }) => (
    <div className={`w-10 h-11 sm:w-12 sm:h-12 border border-[var(--text)] flex items-center justify-center font-black text-2xl text-[var(--text)] ${highlight ? 'bg-[var(--accent)]' : 'bg-[var(--panel)]'}`}>
      {ch.trim()}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>それぞれの すうじが どの「くらい」に あるか みてみよう</ToolHint>
      <div className="overflow-x-auto max-w-full pb-1">
        <div className="inline-flex flex-col border-2 border-[var(--text)] rounded-xl overflow-hidden">
          <div className="flex bg-[var(--bg)]">
            {intLabels.map((l, i) => (
              <div key={`h${i}`} className={`w-10 sm:w-12 py-1.5 border border-[var(--text)] text-center font-bold text-xs text-[var(--text)] ${l === '一' ? 'bg-[var(--accent)]' : ''}`}>{l}</div>
            ))}
            {fracLabels.length > 0 && <div className="w-4 border border-[var(--text)] bg-[var(--bg)]" />}
            {fracLabels.map((l, i) => (
              <div key={`f${i}`} className="w-10 sm:w-12 py-1.5 border border-[var(--text)] text-center font-bold text-[10px] text-[var(--text)]">{l}</div>
            ))}
          </div>
          {nums.map((n, row) => {
            const { intDigits, fracDigits } = cellsFor(n);
            return (
              <div key={row} className="flex">
                {intDigits.map((ch, i) => <Cell key={`i${i}`} ch={ch} highlight={intLabels[i] === '一' && ch.trim() !== ''} />)}
                {fracLabels.length > 0 && (
                  <div className="w-4 border border-[var(--text)] flex items-end justify-center pb-1 font-black text-[var(--text)] bg-[var(--panel)]">.</div>
                )}
                {fracDigits.map((ch, i) => <Cell key={`d${i}`} ch={ch} />)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ---- とけい（アナログ時計SVG） ----
const ClockTool = ({ spec }) => {
  if (!spec) return null;
  const cx = 100, cy = 100;
  const pt = (deg, r) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];
  const minuteDeg = (spec.minute ?? 0) * 6;
  const hourDeg = ((spec.hour ?? 0) % 12) * 30 + (spec.minute ?? 0) * 0.5;
  const [mx, my] = pt(minuteDeg, 60);
  const [hx, hy] = pt(hourDeg, 38);
  const arcPath = () => {
    const [a1, a2] = spec.arc.map((m) => m * 6);
    const [x1, y1] = pt(a1, 72); const [x2, y2] = pt(a2, 72);
    return `M ${x1} ${y1} A 72 72 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const hint = spec.arc
    ? 'ながいはりが どれだけ うごいたかな（1めもり＝5ふん）'
    : spec.noHour
      ? 'ながいはりの めもりを よもう（1めもり＝5ふん）'
      : 'みじかいはりと ながいはりを よく みよう';
  return (
    <div className="flex flex-col items-center gap-2">
      <ToolHint>{hint}</ToolHint>
      <svg viewBox="0 0 200 200" className="w-52 h-52 sm:w-60 sm:h-60" aria-label="とけい">
        <circle cx={cx} cy={cy} r={92} fill="var(--panel)" stroke="var(--text)" strokeWidth="5" />
        {Array.from({ length: 60 }).map((_, i) => {
          const major = i % 5 === 0;
          const [x1, y1] = pt(i * 6, major ? 80 : 85);
          const [x2, y2] = pt(i * 6, 89);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text)" strokeWidth={major ? 3 : 1.5} opacity={major ? 0.8 : 0.35} />;
        })}
        {Array.from({ length: 12 }).map((_, i) => {
          const [x, y] = pt((i + 1) * 30, 66);
          return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="bold" fill="var(--text)">{i + 1}</text>;
        })}
        {spec.arc && <path d={arcPath()} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" />}
        {spec.ghostMinute != null && (() => { const [gx, gy] = pt(spec.ghostMinute * 6, 60); return <line x1={cx} y1={cy} x2={gx} y2={gy} stroke="var(--secondary)" strokeWidth="5" strokeLinecap="round" strokeDasharray="6 6" opacity="0.6" />; })()}
        {!spec.noHour && <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="var(--text)" strokeWidth="9" strokeLinecap="round" />}
        <line x1={cx} y1={cy} x2={mx} y2={my} stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6} fill="var(--text)" />
      </svg>
      <div className="flex gap-4 text-xs font-bold text-[var(--text)]">
        <span className="flex items-center gap-1"><span className="inline-block w-5 h-1.5 rounded-full bg-[var(--primary)]" /> ながいはり</span>
        {!spec.noHour && <span className="flex items-center gap-1"><span className="inline-block w-4 h-2 rounded-full bg-[var(--text)]" /> みじかいはり</span>}
        {spec.ghostMinute != null && <span className="flex items-center gap-1"><span className="inline-block w-5 h-1.5 rounded-full bg-[var(--secondary)] opacity-60" /> うごくまえ</span>}
      </div>
    </div>
  );
};

// ---- ながさ（テープ図） ----
const TapeTool = ({ spec }) => {
  if (!spec) return null;
  if (spec.type === 'join') {
    const total = spec.a + spec.b;
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <ToolHint>2ほんの テープを つないだ ながさを かんがえよう</ToolHint>
        <div className="w-full max-w-sm">
          <div className="flex w-full">
            <div className="flex flex-col items-center" style={{ width: `${(spec.a / total) * 100}%` }}>
              <span className="font-black text-sm text-orange-500">{spec.a}cm</span>
              <div className="w-full h-10 bg-orange-400 border-[3px] border-[var(--text)] rounded-l-xl" />
            </div>
            <div className="flex flex-col items-center" style={{ width: `${(spec.b / total) * 100}%` }}>
              <span className="font-black text-sm text-sky-500">{spec.b}cm</span>
              <div className="w-full h-10 bg-sky-400 border-[3px] border-l-0 border-[var(--text)] rounded-r-xl" />
            </div>
          </div>
          <div className="mx-1 h-3 border-x-[3px] border-b-[3px] border-[var(--text)] rounded-b" />
          <div className="text-center font-black text-[var(--text)] mt-1">ぜんぶで ?cm</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <ToolHint>きりとった のこりの ながさを かんがえよう</ToolHint>
      <div className="w-full max-w-sm">
        <div className="text-center font-black text-[var(--text)] mb-1">はじめは {spec.a}cm</div>
        <div className="flex w-full">
          <div className="h-10 bg-orange-400 border-[3px] border-[var(--text)] rounded-l-xl flex items-center justify-center font-black text-white" style={{ width: `${((spec.a - spec.b) / spec.a) * 100}%` }}>?</div>
          <div className="h-10 bg-[var(--bg)] border-[3px] border-l-0 border-dashed border-[var(--text)] rounded-r-xl flex items-center justify-center" style={{ width: `${(spec.b / spec.a) * 100}%` }}>
            <span className="font-black text-xs text-[var(--text)] opacity-70 whitespace-nowrap">✂ {spec.b}cm</span>
          </div>
        </div>
        <div className="flex w-full text-xs font-bold text-[var(--text)] opacity-60 mt-1">
          <div className="text-center" style={{ width: `${((spec.a - spec.b) / spec.a) * 100}%` }}>のこり</div>
          <div className="text-center" style={{ width: `${(spec.b / spec.a) * 100}%` }}>きりとる</div>
        </div>
      </div>
    </div>
  );
};

// ---- かさ（ますの図） ----
const KasaBeaker = ({ value, denom, unit, drink = 0 }) => (
  <div className="flex flex-col items-center gap-1">
    <span className="font-black text-sky-500">{value}{unit}</span>
    <div className="relative w-16 h-28 border-[3px] border-t-2 border-[var(--text)] rounded-b-xl overflow-hidden bg-[var(--bg)]">
      <div className="absolute bottom-0 left-0 right-0 bg-sky-400" style={{ height: `${Math.min(100, (value / denom) * 100)}%` }}>
        {drink > 0 && (
          <div className="absolute top-0 left-0 right-0 bg-sky-200 border-b-2 border-dashed border-[var(--text)] flex items-center justify-center" style={{ height: `${(drink / value) * 100}%` }}>
            <span className="font-black text-[10px] text-[var(--text)] opacity-70">のむ</span>
          </div>
        )}
      </div>
      {/* 1単位ごとの めもり */}
      {Array.from({ length: denom - 1 }).map((_, i) => (
        <div key={i} className="absolute left-0 w-2.5 h-[2px] bg-[var(--text)] opacity-40" style={{ bottom: `${((i + 1) / denom) * 100}%` }} />
      ))}
    </div>
  </div>
);

const KasaTool = ({ spec }) => {
  if (!spec) return null;
  if (spec.type === 'join') {
    const denom = Math.max(10, spec.a, spec.b);
    return (
      <div className="flex flex-col items-center gap-3">
        <ToolHint>2つの ますの 水を あわせると どれだけかな（1めもり＝1{spec.unit}）</ToolHint>
        <div className="flex items-end gap-3">
          <KasaBeaker value={spec.a} denom={denom} unit={spec.unit} />
          <span className="font-black text-3xl text-[var(--text)] pb-10">＋</span>
          <KasaBeaker value={spec.b} denom={denom} unit={spec.unit} />
        </div>
      </div>
    );
  }
  const denom = Math.max(15, spec.a);
  return (
    <div className="flex flex-col items-center gap-3">
      <ToolHint>うすい ところが のむ ぶん。のこりは どれだけかな（1めもり＝1{spec.unit}）</ToolHint>
      <KasaBeaker value={spec.a} denom={denom} unit={spec.unit} drink={spec.b} />
      <span className="font-black text-sm text-[var(--text)] opacity-70">{spec.b}{spec.unit} のむと のこりは ?{spec.unit}</span>
    </div>
  );
};

// ---- えん（半径と直径） ----
const CircleTool = ({ spec }) => {
  if (!spec) return null;
  const isRadius = spec.kind === 'radius';
  return (
    <div className="flex flex-col items-center gap-2">
      <ToolHint>ちょっけいは はんけいの 2つぶん だよ</ToolHint>
      <svg viewBox="0 0 200 170" className="w-56 h-48" aria-label="えん">
        <circle cx="100" cy="90" r="70" fill="var(--bg)" stroke="var(--text)" strokeWidth="4" />
        {/* 直径（よこ） */}
        <line x1="30" y1="90" x2="170" y2="90" stroke={isRadius ? 'var(--secondary)' : 'var(--primary)'} strokeWidth="5" strokeLinecap="round" strokeDasharray={isRadius ? '7 7' : 'none'} />
        <text x="100" y="112" textAnchor="middle" fontSize="14" fontWeight="bold" fill={isRadius ? 'var(--secondary)' : 'var(--primary)'}>
          ちょっけい {isRadius ? '?' : spec.v}cm
        </text>
        {/* 半径（たて）。ラベルは線の左側に2行で置き、見切れを防ぐ */}
        <line x1="100" y1="90" x2="100" y2="20" stroke={isRadius ? 'var(--primary)' : 'var(--secondary)'} strokeWidth="5" strokeLinecap="round" strokeDasharray={isRadius ? 'none' : '7 7'} />
        <text x="93" y="44" textAnchor="end" fontSize="13" fontWeight="bold" fill={isRadius ? 'var(--primary)' : 'var(--secondary)'}>はんけい</text>
        <text x="93" y="60" textAnchor="end" fontSize="13" fontWeight="bold" fill={isRadius ? 'var(--primary)' : 'var(--secondary)'}>{isRadius ? spec.v : '?'}cm</text>
        <circle cx="100" cy="90" r="5" fill="var(--text)" />
      </svg>
    </div>
  );
};

// ---- どうぐパネル（ボトムシート） ----
export const LearningToolPanel = ({ open, onClose, courseName, qText, onFx }) => {
  const tools = useMemo(() => getAvailableTools(courseName, qText), [courseName, qText]);
  const [active, setActive] = useState(tools[0] || null);
  const p = useMemo(() => parseArith(qText), [qText]);

  useEffect(() => {
    if (!tools.includes(active)) setActive(tools[0] || null);
  }, [qText, tools, active]);

  return (
    <>
      {/* 背景は常設して CSS で開閉する。AnimatePresence の終了アニメーション中も全画面の
          オーバーレイがタップを吸ってしまい、閉じた直後にどうぐボタンが反応しなくなるのを防ぐ */}
      <div
        className={`fixed inset-0 z-[75] bg-black/30 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: { type: 'spring', damping: 28, stiffness: 300 } }}
            exit={{ y: '100%', transition: { duration: 0.15, ease: 'easeIn' } }}
            className="fixed bottom-0 left-0 right-0 z-[80] mx-auto max-w-2xl bg-[var(--panel)] border-[3px] border-b-0 border-[var(--text)] rounded-t-3xl flex flex-col max-h-[70vh] shadow-[0_-4px_20px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center gap-2 p-3 pb-2 shrink-0">
              <Lightbulb size={22} className="text-[var(--secondary)] shrink-0" />
              <div className="flex gap-1.5 flex-grow overflow-x-auto no-scrollbar">
                {tools.map((t) => {
                  const { Icon, label } = TOOL_META[t];
                  return (
                    <button
                      key={t}
                      onClick={() => { onFx?.(); setActive(t); }}
                      className={`px-3 py-1.5 rounded-full font-bold text-sm whitespace-nowrap border-2 transition-colors touch-manipulation flex items-center gap-1.5 ${active === t ? 'bg-[var(--text)] text-[var(--panel)] border-[var(--text)]' : 'bg-[var(--bg)] text-[var(--text)] border-transparent'}`}
                    >
                      <Icon size={16} /> {label}
                    </button>
                  );
                })}
              </div>
              <button onClick={onClose} className="w-9 h-9 shrink-0 rounded-full bg-[var(--bg)] border-2 border-[var(--text)] flex items-center justify-center text-[var(--text)] active:scale-90 transition-transform touch-manipulation" aria-label="とじる">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-6 pt-2">
              {tools.length === 0 && (
                <p className="text-center font-bold text-[var(--text)] opacity-60 py-8">このもんだいで つかえる どうぐは ないよ</p>
              )}
              {/* key に問題文を含めて、次の問題に進んだらどうぐの状態をリセットする */}
              {active === 'tokei' && <ClockTool key={`t_${qText}`} spec={parseClock(qText)} />}
              {active === 'nagasa' && <TapeTool key={`n_${qText}`} spec={parseTape(qText)} />}
              {active === 'kasa' && <KasaTool key={`ks_${qText}`} spec={parseKasa(qText)} />}
              {active === 'en' && <CircleTool key={`e_${qText}`} spec={parseCircle(qText)} />}
              {active === 'blocks' && <BlocksTool key={`b_${qText}`} p={p && p.isInt && (p.op === '+' || p.op === '-') ? p : null} onFx={onFx} />}
              {active === 'sakuranbo' && <SakuranboTool key={`s_${qText}`} p={p} onFx={onFx} />}
              {active === 'hissan' && <HissanTool key={`h_${qText}`} p={p} />}
              {active === 'kurai' && <KuraiTool key={`k_${qText}`} qText={qText} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
