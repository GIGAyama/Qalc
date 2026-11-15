/* コースの共有コード・CSV 取りこみ・答えの検査（App.jsx から切りだした）。
 *
 * 画面の都合とまぜずに、node から直接テストできるようにしている。
 * 変更したら必ず `npm run test:share` を通すこと。
 *
 * ここで防いでいること（どれも実際に起きていた）
 *   1. 問題文に「,」があると共有コードが壊れた。旧形式は「問題,答え」を「;」でつないだ
 *      文字列で、読むときに最初の「,」で切っていた。プリセットの
 *      「6年_ことば（データの代表値）」は100問すべて壊れた。
 *   2. AI で作った問題を同じ日に2回取りこむと、1回目が消えた（名前が AI_日付 だけだった）。
 *      共有コードも同じ名前のコースを だまって上書きしていた。
 *   3. 答えに「０．５」「3あまり1」「12cm」のような、テンキーで打てない文字が入ると、
 *      その問題は正解できず、ゲームが先へ進めなくなった。
 */
import { normalizeStr } from './data/problems.js';

// ── 答え ────────────────────────────────────────────

// テンキー（と Chromebook のキーボード）で打てる文字。GameView の Keypad と同じ
const TYPEABLE_RE = /^[0-9./\-()]+$/;
// 答えらんに入る文字数の上限（GameView の入力と同じ）
export const ANSWER_MAX_LEN = 15;

/** 「|」で区切った答えの候補を、比べるときと同じ形にそろえて返す */
export const answerAlternatives = (a) => String(a ?? '').split('|').map(normalizeStr).filter(Boolean);

/** テンキーで打てる候補が1つでもあれば true（その問題はゲームで正解できる） */
export const isTypeableAnswer = (a) => answerAlternatives(a).some((x) => TYPEABLE_RE.test(x) && x.length <= ANSWER_MAX_LEN);

// ── コース名 ────────────────────────────────────────

export const COURSE_NAME_MAX = 40;
// にがて克服ボックスは内部で 'mistakes' という名前で選ばれるため、コース名には使わせない
const RESERVED_NAMES = new Set(['mistakes']);

/** コース名をそろえる。使えない名前なら空文字 */
export const sanitizeCourseName = (v) => {
  if (typeof v !== 'string') return '';
  // 制御文字（改行・タブなど）は空白にしてから前後をけずる
  const name = v.replace(/\p{Cc}/gu, ' ').trim().slice(0, COURSE_NAME_MAX);
  return RESERVED_NAMES.has(name) ? '' : name;
};

/** 同じ名前のコースがあれば「名前 (2)」「名前 (3)」… にして、だまって上書きしない */
export const uniqueCourseName = (base, existingNames) => {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const name = `${base} (${i})`;
    if (!taken.has(name)) return name;
  }
  return `${base} (${Date.now()})`;
};

// ── 問題の検査 ───────────────────────────────────────

export const PROBLEM_MAX = 2000;      // 1コースの問題数（みんなであそぶで配れる上限と同じ）
export const QUESTION_MAX_LEN = 200;  // 問題文（みんなであそぶで配るときに切る長さと同じ）

/**
 * 問題を「ゲームで使えるもの」と「使えないもの」に分ける。
 * 使えないもの: 問題文か答えが空・問題文が長すぎる・答えをテンキーで打てない
 */
export const validateProblems = (rows) => {
  const ok = [];
  const bad = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const q = typeof r?.q === 'string' ? r.q.trim() : '';
    const a = r?.a == null ? '' : String(r.a).trim();
    if (!q || !a) bad.push({ q, a, reason: 'empty' });
    else if (q.length > QUESTION_MAX_LEN) bad.push({ q, a, reason: 'too-long' });
    else if (!isTypeableAnswer(a)) bad.push({ q, a, reason: 'untypeable' });
    else ok.push({ q, a });
  });
  return { ok: ok.slice(0, PROBLEM_MAX), bad, overflow: Math.max(0, ok.length - PROBLEM_MAX) };
};

// ── 共有コード ───────────────────────────────────────
//
// v2: 'Q2:' + base64(UTF-8 の JSON {v:2, n:名前, p:[[問題,答え], ...]})
//   ・JSON の配列なので、問題文に「,」「;」があっても壊れない
//   ・旧形式（encodeURIComponent してから base64）より約3分の1の長さになる
// v1（旧形式）も読める。配ったあとのコードが使えなくならないように。

const V2_PREFIX = 'Q2:';

const toBase64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  // 大きなコースで引数が多すぎないよう、区切って文字にする
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const fromBase64 = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

/** URL の中に入れられる base64（+ / = を使わない）。かだいリンク（kadai.js）で使う */
export const toBase64Url = (str) => toBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromBase64Url = (s) => {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
};

/** コースを共有コードにする */
export const encodeCourse = (name, problems) => V2_PREFIX + toBase64(JSON.stringify({
  v: 2,
  n: String(name),
  p: (problems || []).map((p) => [String(p.q), String(p.a)]),
}));

/**
 * 共有コードを読む。読めなければ null。
 * 中身は「問題文と答え(どちらも文字列)」と「名前」だけにしぼって組み立てなおす。
 */
export const decodeCourse = (code) => {
  try {
    // チャットに貼ると途中で改行されることがあるので、空白はすべて取りのぞく
    const s = String(code ?? '').replace(/\s+/g, '');
    if (!s) return null;
    let name;
    let rows;
    if (s.startsWith(V2_PREFIX)) {
      const data = JSON.parse(fromBase64(s.slice(V2_PREFIX.length)));
      if (!data || data.v !== 2 || !Array.isArray(data.p)) return null;
      name = data.n;
      rows = data.p.map((x) => (Array.isArray(x) ? { q: x[0], a: x[1] } : null)).filter(Boolean);
    } else {
      // v1: btoa(encodeURIComponent(JSON.stringify({ n, p: '問題,答え;問題,答え' })))
      const data = JSON.parse(decodeURIComponent(atob(s)));
      if (!data || typeof data.p !== 'string') return null;
      name = data.n;
      // 答えには「,」が入らない（テンキーで打てない）ので、最後の「,」で切れば
      // 問題文に「,」があっても元にもどせる（旧版は最初の「,」で切って壊していた）
      rows = data.p.split(';').map((item) => {
        const i = item.lastIndexOf(',');
        return i < 0 ? null : { q: item.slice(0, i), a: item.slice(i + 1) };
      }).filter(Boolean);
    }
    const cleanName = sanitizeCourseName(name);
    if (!cleanName) return null;
    const problems = rows
      .filter((r) => typeof r.q === 'string' && (typeof r.a === 'string' || typeof r.a === 'number'))
      .map((r) => ({ q: r.q, a: String(r.a) }));
    if (!problems.length) return null;
    return { name: cleanName, problems };
  } catch (e) {
    return null;
  }
};

// ── CSV / 表計算からの貼りつけ ───────────────────────────

// CSV の1行を、"…" で囲まれた欄（中の「,」や「""」）に気をつけて切る。
// 前後の空白は残して返す（問題文にもどすとき「13, 16」の空白を消さないため）
const splitCsvLine = (line) => {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
};

const HEADER_RE = /^(問題|もんだい|しつもん|q|question)$/i;

/**
 * AI が出した CSV や、表計算ソフトからコピーした「問題<TAB>答え」を問題の配列にする。
 * 戻り値: { rows: [{q, a}], skipped: 読めなかった行の数 }
 *   ・```（コードブロックの囲み）と見出し行「問題,答え」は読みとばす
 *   ・"…" で囲まれた欄の中の「,」は区切りとみなさない
 *   ・囲まれていない「1,000 + 2,000,3000」のように「,」が多いときは、
 *     まん中の欄に答えになれないもの（「000 + 2」など）があり、最後の欄が答えとして
 *     打てる形のときだけ、最後を答えにして のこりを問題文にもどす。
 *     「2+3,5,10」（3列めは配点など）のように まん中も答えの形なら、1列め・2列めを使う。
 *     （最後を答えにすると、問題「2+3,5」答え「10」という まちがったコースができてしまう）
 */
export const parseProblemText = (text) => {
  const rows = [];
  let skipped = 0;
  String(text ?? '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('```')) return;
    let pieces;
    let sep;
    if (line.includes('\t')) { pieces = line.split('\t').slice(0, 2); sep = '\t'; }
    else if (line.includes(',')) { pieces = splitCsvLine(line); sep = ','; }
    else if (line.includes('，')) { pieces = line.split('，'); sep = '，'; }
    else { skipped++; return; }
    const fields = pieces.map((x) => x.trim());
    let q;
    let a;
    if (fields.length <= 2) [q, a] = fields;
    else {
      const last = fields[fields.length - 1];
      const middle = fields.slice(1, -1);
      const commaInQuestion = middle.some((f) => !isTypeableAnswer(f));
      if (commaInQuestion && isTypeableAnswer(last)) { q = pieces.slice(0, -1).join(sep).trim(); a = last; } else { [q, a] = fields; }
    }
    if (HEADER_RE.test(q || '')) return;
    if (!q || !a) { skipped++; return; }
    rows.push({ q, a });
  });
  return { rows, skipped };
};
