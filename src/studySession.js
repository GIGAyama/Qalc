/* Qalc 固有の学習ログ組み立て（study.v1 §3.2）
 *
 * 役割分担（仕様書 §6 の3層構成）
 *   studyLog.js     … 全アプリ共通・不変の保存処理
 *   studySession.js … このファイル。Qalc のゲーム進行から study.v1 レコードを組み立てる
 *   studyStats.js   … 読み出し（児童に成長を見せるための集計）
 *
 * 保存のみを行い、外部送信は一切しない。児童を識別する情報は持たない。
 */
import { saveStudyRecord } from './studyLog.js';

export const APP_ID = 'qalc';
// アプリのバージョン。学習ログに載る唯一の版表示なので、ここ1箇所で管理する
export const APP_VERSION = '1.0.0';

// ゲームモード → 仕様書 §3.2 の mode（英数小文字）
const MODE_MAP = {
  SCORE_ATTACK: 'scoreattack',
  TIME_ATTACK: 'timeattack',
  SUDDEN_DEATH: 'suddendeath',
  BOSS_RAID: 'boss',
  TERRITORY: 'nawabari',
};

// コース名 → 単元ID。
// 【重要】この ID は「改訂しても不変であること」が仕様書で最も強い要件（§2.5）。
// コースの表示名を変えるときは、名前だけを差しかえて ID は据えおくこと。
// 旧名称も同じ ID に向けておくと、改名前後の記録がつながる。
const UNIT_IDS = {
  '1年_ことば（いくつといくつ）': 'g1-word-ikutsu-to-ikutsu',
  '1年_あわせて10': 'g1-awasete-10',
  '1年_たしざん（10まで）': 'g1-add-to-10',
  '1年_ひきざん（10まで）': 'g1-sub-to-10',
  '1年_10といくつ': 'g1-ten-and-some',
  '1年_3つのかず': 'g1-three-numbers',
  '1年_くりあがり': 'g1-carry-add',
  '1年_ひきざん（くりさがり）': 'g1-borrow-sub',
  '1年_おおきいかずのけいさん': 'g1-big-number-calc',
  '1年_なん十のけいさん（100まで）': 'g1-tens-calc-100',
  '1年_とけいクイズ': 'g1-clock-quiz',
  '1年_ことば（あわせて・のこりは）': 'g1-word-add-sub',
  '1年_ことば（ちがい）': 'g1-word-difference',
  '1年_ことば（3つのかず）': 'g1-word-three-numbers',
  '1年_ことば（じゅんじょ）': 'g1-word-order',
  '1年_ことば（かずのならび）': 'g1-word-number-sequence',
  '1年_ことば（おおきい・ちいさい）': 'g1-word-bigger-smaller',
  '1年_ことば（おおきさくらべ）': 'g1-word-size-compare',
  '1年_ことば（かたちづくり）': 'g1-word-shape-build',
  '2年_なん十の計算': 'g2-tens-calc',
  '2年_2けたのたし算': 'g2-add-2digit',
  '2年_2けたのひき算': 'g2-sub-2digit',
  '2年_3けた・4けたの計算': 'g2-calc-3-4digit',
  '2年_数のしくみ（1000まで）': 'g2-number-system-1000',
  '2年_一の段の九九': 'g2-kuku-1',
  '2年_二の段の九九': 'g2-kuku-2',
  '2年_三の段の九九': 'g2-kuku-3',
  '2年_四の段の九九': 'g2-kuku-4',
  '2年_五の段の九九': 'g2-kuku-5',
  '2年_六の段の九九': 'g2-kuku-6',
  '2年_七の段の九九': 'g2-kuku-7',
  '2年_八の段の九九': 'g2-kuku-8',
  '2年_九の段の九九': 'g2-kuku-9',
  '2年_九九': 'g2-kuku-all',
  '2年_九九あなうめ': 'g2-kuku-blank',
  '2年_ことば（かけ算）': 'g2-word-multiply',
  '2年_ことば（かけ算のきまり）': 'g2-word-multiply-rules',
  '2年_分数': 'g2-fraction',
  '2年_ことば（たんい）': 'g2-word-unit',
  '2年_時こくと時間': 'g2-time-and-duration',
  '2年_ことば（ながさのけいさん）': 'g2-word-length-calc',
  '2年_ことば（かさのけいさん）': 'g2-word-volume-calc',
  '2年_ことば（おおきい・ちいさい）': 'g2-word-bigger-smaller',
  '2年_ことば（かたち）': 'g2-word-shape',
  '3年_わり算': 'g3-divide',
  '3年_あまりは？': 'g3-remainder',
  '3年_大きいわり算': 'g3-divide-big',
  '3年_何十のかけ算': 'g3-multiply-tens',
  '3年_かけ算（2けた×1けた）': 'g3-multiply-2x1',
  '3年_かけ算（3けた×1けた）': 'g3-multiply-3x1',
  '3年_かけ算（2けた×2けた）': 'g3-multiply-2x2',
  '3年_かけ算（3けた×2けた）': 'g3-multiply-3x2',
  '3年_暗算（2けたのたし算）': 'g3-mental-add-2digit',
  '3年_暗算（2けたのひき算）': 'g3-mental-sub-2digit',
  '3年_3けたのたし算・ひき算': 'g3-add-sub-3digit',
  '3年_大きい数の計算': 'g3-big-number-calc',
  '3年_小数たし算': 'g3-decimal-add',
  '3年_小数ひき算': 'g3-decimal-sub',
  '3年_分数たし算': 'g3-fraction-add',
  '3年_分数ひき算': 'g3-fraction-sub',
  '3年_小数と分数': 'g3-decimal-and-fraction',
  '3年_□を使った式': 'g3-box-equation',
  '3年_時間（秒と分）': 'g3-time-sec-min',
  '3年_ことば（わり算）': 'g3-word-divide',
  '3年_ことば（あまりのあるわり算）': 'g3-word-divide-remainder',
  '3年_ことば（円と球）': 'g3-word-circle-sphere',
  '3年_ことば（長さと重さのたんい）': 'g3-word-length-weight-unit',
  '4年_大きな数（億・兆）': 'g4-big-number-oku-cho',
  '4年_わり算（1けたでわる）': 'g4-divide-by-1digit',
  '4年_わり算（2けたでわる）': 'g4-divide-by-2digit',
  '4年_計算のきまり': 'g4-calc-rules',
  '4年_がい数（四捨五入）': 'g4-round-half-up',
  '4年_がい数の見つもり': 'g4-round-estimate',
  '4年_小数×整数': 'g4-decimal-times-int',
  '4年_小数÷整数': 'g4-decimal-div-int',
  '4年_小数のたし算・ひき算': 'g4-decimal-add-sub',
  '4年_ことば（小数のしくみ）': 'g4-word-decimal-system',
  '4年_分数たし算（1より大きい）': 'g4-fraction-add-over1',
  '4年_分数ひき算（1より大きい）': 'g4-fraction-sub-over1',
  '4年_仮分数と帯分数': 'g4-improper-mixed-fraction',
  '4年_ことば（角の大きさ）': 'g4-word-angle',
  '4年_ことば（垂直・平行と四角形）': 'g4-word-perpendicular-parallel',
  '4年_ことば（面積のたんい）': 'g4-word-area-unit',
  '4年_ことば（面積のけいさん）': 'g4-word-area-calc',
  '4年_ことば（変わり方）': 'g4-word-change',
  '5年_小数と10・100の計算': 'g5-decimal-x10-x100',
  '5年_小数のかけわり': 'g5-decimal-mul-div',
  '5年_3.14のけいさん': 'g5-pi-calc',
  '5年_倍数と約数': 'g5-multiple-divisor',
  '5年_公倍数・公約数': 'g5-common-multiple-divisor',
  '5年_約分': 'g5-reduce-fraction',
  '5年_通分': 'g5-common-denominator',
  '5年_分数たしひき': 'g5-fraction-add-sub',
  '5年_分数と小数': 'g5-fraction-and-decimal',
  '5年_割合パッ！（小数→％）': 'g5-decimal-to-percent',
  '5年_ことば（百分率）': 'g5-word-percent',
  '5年_割合（くらべる量・もとにする量）': 'g5-ratio-compare-base',
  '5年_ことば（歩合）': 'g5-word-buai',
  '5年_単位量あたりの大きさ': 'g5-per-unit-quantity',
  '5年_ことば（平均）': 'g5-word-average',
  '5年_ことば（図形の角）': 'g5-word-shape-angle',
  '5年_ことば（正多角形と円）': 'g5-word-regular-polygon-circle',
  '5年_ことば（図形の面積）': 'g5-word-shape-area',
  '5年_ことば（台形・ひし形の面積）': 'g5-word-trapezoid-rhombus-area',
  '5年_ことば（体積のけいさん）': 'g5-word-volume-calc',
  '6年_文字と式': 'g6-letters-and-expressions',
  '6年_分数かけわり': 'g6-fraction-mul-div',
  '6年_分数と小数のまじった計算': 'g6-fraction-decimal-mixed',
  '6年_円の計算': 'g6-circle-calc',
  '6年_比のけいさん': 'g6-ratio-calc',
  '6年_比を簡単にする': 'g6-ratio-simplify',
  '6年_速さ・時間・道のり': 'g6-speed-time-distance',
  '6年_場合の数': 'g6-cases',
  '6年_ことば（対称な図形）': 'g6-word-symmetry',
  '6年_ことば（拡大図と縮図）': 'g6-word-enlarge-reduce',
  '6年_ことば（立体の体積）': 'g6-word-solid-volume',
  '6年_ことば（比例・反比例のけいさん）': 'g6-word-proportion',
  '6年_ことば（データの代表値）': 'g6-word-data-representative',
  'チャレンジ_四則混合': 'challenge-mixed-operations',

  // にがて克服ボックス（コースではないが、取り組んだ単元として扱う）
  mistakes: 'weakness-box',

  // 旧名称（App.jsx の LEGACY_DEFAULT_KEYS）。改名前の記録と同じ ID に向ける
  '4年_がい数(四捨五入)': 'g4-round-half-up',
  '4年_小数x整数': 'g4-decimal-times-int',
  '5年_割合パッ！(%)': 'g5-decimal-to-percent',
  '6年_速さ・時間・道': 'g6-speed-time-distance',
  '1年_ひきざん': 'g1-sub-to-10',
  '1年_10と いくつ': 'g1-ten-and-some',
  '1年_おおきいかずの けいさん': 'g1-big-number-calc',
  '1年_なん十の けいさん（100まで）': 'g1-tens-calc-100',
  '1年_ことば（かずの ならび）': 'g1-word-number-sequence',
  '2年_ことば（ながさの けいさん）': 'g2-word-length-calc',
  '2年_ことば（かさの けいさん）': 'g2-word-volume-calc',
  '3年_ことば（あまりのある わり算）': 'g3-word-divide-remainder',
  '3年_ことば（長さと重さの たんい）': 'g3-word-length-weight-unit',
};

// 文字列 → 短い安定ハッシュ（自作コース・文章題の設問IDに使う）
const hash36 = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const isPresetCourse = (name) => Object.prototype.hasOwnProperty.call(UNIT_IDS, name);

// 自作コースは名前から導く。名前を変えると別単元になるが、自作コースの ID は
// もともと児童ごとに意味が異なり横断集計の対象外（§2.4 custom）なので許容する
const unitIdOf = (name) => UNIT_IDS[name] || `custom-${hash36(String(name))}`;

const gradeOf = (name) => {
  const m = /^([1-6])年/.exec(String(name));
  return m ? Number(m[1]) : null;
};

// 複数ドリル選択時の unit。単一なら素直にそのコース、複数なら mix- で連結する
export const buildUnit = (courseNames, courseName) => {
  const names = (courseNames || []).filter(Boolean);
  if (names.length === 0) {
    // コース名しか判らない場合（旧い中断データなど）の保険
    const title = courseName || '不明';
    return { id: `custom-${hash36(title)}`, title, preset: false };
  }
  const title = courseName || names.join('、');
  if (names.length === 1) {
    const unit = { id: unitIdOf(names[0]), title, preset: isPresetCourse(names[0]) };
    const grade = gradeOf(names[0]);
    if (grade) unit.grade = grade;
    return unit;
  }
  const ids = names.map(unitIdOf).sort();
  // ID が長くなりすぎるときは、先頭3つ＋残数にまとめる（全 ID は ext.unitIds に残す）
  const joined = ids.join('+');
  const id = joined.length <= 80 ? `mix-${joined}` : `mix-${ids.slice(0, 3).join('+')}+etc${ids.length - 3}`;
  const unit = { id, title, preset: names.every(isPresetCourse) };
  const grades = names.map(gradeOf).filter(Boolean);
  if (grades.length === names.length && grades.every((g) => g === grades[0])) unit.grade = grades[0];
  return unit;
};

// 出題元（§2.4）。にがて克服ボックスを含むなら weak、自作コースを含むなら custom
export const sourceOf = (courseNames) => {
  const names = (courseNames || []).filter(Boolean);
  if (names.includes('mistakes')) return 'weak';
  if (names.length > 0 && names.some((n) => !isPresetCourse(n))) return 'custom';
  return 'course';
};

// 設問ID（§2.10）。問題文そのものは入れない。
// 式だけの問題は式そのものが安定した ID になる（`8+9`）。
// 文章題は長く容量を圧迫するため、ハッシュにして短く保つ。
export const itemIdOf = (qText) => {
  const t = String(qText || '').replace(/\s+/g, '');
  if (!t) return 'q-empty';
  const hasJapanese = /[぀-ヿ一-鿿]/.test(t);
  if (!hasJapanese && t.length <= 20) return t;
  return `w-${hash36(t)}`;
};

// 誤答内容（§2.10）。自由入力欄の値をそのまま格納しない
const sanitizeInput = (v) => {
  const s = String(v == null ? '' : v).slice(0, 12);
  return /^[0-9./\-()]*$/.test(s) && s.length > 0 ? s : null;
};

// タブを離れてこの時間もどらなければ中断とみなす（§5.4）。
// 短くすると、教師の説明を聞くための数分の離席まで中断として記録されてしまう
export const STUDY_ABORT_AWAY_MS = 5 * 60 * 1000;
const IDLE_MS = 60 * 1000;           // 60秒 無操作で activeMs の加算を止める（§2.8）

// タブが表示され、かつ操作が続いていた時間を数える（§2.8 の参照実装）
const createActiveTimer = () => {
  let activeMs = 0;
  let mark = Date.now();
  let idle = false;
  const tick = () => {
    if (!idle && !document.hidden) activeMs += Date.now() - mark;
    mark = Date.now();
  };
  const wake = () => { tick(); idle = false; };
  const goIdle = () => { tick(); idle = true; };
  const events = ['click', 'keydown', 'touchstart', 'pointerdown'];
  const tickId = setInterval(tick, 1000);
  const idleId = setInterval(goIdle, IDLE_MS);
  document.addEventListener('visibilitychange', tick);
  events.forEach((ev) => document.addEventListener(ev, wake));
  return {
    value: () => { tick(); return activeMs; },
    reset: () => { tick(); activeMs = 0; },
    dispose: () => {
      clearInterval(tickId); clearInterval(idleId);
      document.removeEventListener('visibilitychange', tick);
      events.forEach((ev) => document.removeEventListener(ev, wake));
    },
  };
};

/**
 * 1回の学習セッションを組み立てる。
 *
 * つかいかた
 *   const session = createStudySession({...});
 *   session.present(問題文);                       // 出題した
 *   session.answer(正誤, 入力値);                  // 解答した
 *   session.save({ status: 'completed', ext });    // 終了・中断で1レコード
 *   session.dispose();                             // 画面を離れるとき
 *
 * save() のあとは自動的に次のレコードが始まる（§5.4「復帰したら新しいレコードを開始する」）。
 */
export function createStudySession({ gameMode, courseName, courseNames, multiplayer = false, plannedCount = null }) {
  const unit = buildUnit(courseNames, courseName);
  const source = sourceOf(courseNames);
  const mode = MODE_MAP[gameMode] || 'scoreattack';
  const timer = createActiveTimer();

  let startMs = Date.now();
  let startedAt = new Date().toISOString();
  let planned = plannedCount;       // タイムアタックの残り問題数。最初の1レコードだけで使う
  let presented = 0;                // 出題した回数（同じ式が何度も出るので、出題ごとに数える）
  let firstTryCorrect = 0;
  let items = [];
  let pending = null;               // いま画面に出ている問題
  let tools = new Set();
  let feverCount = 0;
  let disposed = false;

  const closePending = () => {
    if (!pending) return;
    // 解答が1回もない問題は未着手として items から外す（§2.7）
    if (pending.tries > 0) {
      // 最後まで解けなかった問題は ok: false（§2.10）
      items.push(toItem(pending, false, false));
    }
    pending = null;
  };

  const toItem = (p, ok, firstTry) => {
    const item = { q: p.q, ok, firstTry, tries: p.tries, ms: Math.max(0, Date.now() - p.startMs) };
    if (p.hint) item.hint = true;
    if (p.wrong.length > 0) item.wrong = p.wrong;
    return item;
  };

  // 次のレコードを開始する。carry は「いま画面に出ている問題」の設問ID。
  // 中断で締めたあとも同じ問題を解きつづけるため、新しいレコードで出題しなおす
  const reset = (carry) => {
    timer.reset();
    startMs = Date.now();
    startedAt = new Date().toISOString();
    planned = null;
    presented = 0;
    firstTryCorrect = 0;
    items = [];
    tools = new Set();
    feverCount = 0;
    pending = carry ? { q: carry, tries: 0, wrong: [], hint: false, startMs } : null;
    if (pending) presented = 1;
  };

  return {
    /** 問題を画面に出した */
    present(qText) {
      if (disposed) return;
      closePending();
      presented += 1;
      pending = { q: itemIdOf(qText), tries: 0, wrong: [], hint: false, startMs: Date.now() };
    },

    /** 解答した。input は児童が入力した値（誤答内容として残す） */
    answer(isCorrect, input) {
      if (disposed || !pending) return;
      pending.tries += 1;
      if (isCorrect) {
        const firstTry = pending.tries === 1;
        if (firstTry) firstTryCorrect += 1;
        items.push(toItem(pending, true, firstTry));
        pending = null;
      } else {
        const wrong = sanitizeInput(input);
        if (wrong && pending.wrong.length < 5) pending.wrong.push(wrong);
      }
    },

    /** かんがえるどうぐを開いた（ヒント扱い） */
    markTool(toolId) {
      if (disposed) return;
      if (toolId) tools.add(toolId);
      if (pending) pending.hint = true;
    },

    /** フィーバーに入った回数 */
    markFever() { if (!disposed) feverCount += 1; },

    /**
     * 1レコードとして保存し、次のレコードを開始する。
     * endedAtMs を渡すと、その時刻で締める（中断待ちの5分を学習時間に含めないため）。
     * 1問も解答していないセッションは保存しない（§5.4）。
     */
    save({ status = 'completed', endedAtMs = null, ext = {} } = {}) {
      if (disposed) return null;
      const carry = pending ? pending.q : null;
      closePending();
      const attempted = items.length;
      // 1問も解答していない中断は保存しない（§5.4）。ログ枠500件を空レコードで埋めないため
      if (attempted === 0) { reset(carry); return null; }

      const endMs = Math.max(startMs, endedAtMs || Date.now());
      const elapsedMs = endMs - startMs;
      // 別々の時計で数えた値なので、ありえない大小関係になりうる。保存前に必ず抑え込む（§2.8）
      const activeMs = Math.min(timer.value(), elapsedMs);
      const count = Math.max(planned || 0, presented, attempted);

      const record = {
        appId: APP_ID,
        appVersion: APP_VERSION,
        kind: 'session',
        mode,
        unit,
        source,
        multiplayer: !!multiplayer,
        grading: 'objective',
        startedAt,
        endedAt: new Date(endMs).toISOString(),
        elapsedMs,
        activeMs,
        timeBasis: 'app',
        status,
        summary: {
          count,
          attempted,
          firstTryCorrect,
          correct: items.filter((it) => it.ok).length,
        },
        items,
        ext: {
          ...ext,
          feverCount,
          tools: [...tools],
          ...(Array.isArray(courseNames) && courseNames.length > 1
            ? { unitIds: courseNames.map(unitIdOf) }
            : {}),
        },
      };

      const id = saveStudyRecord(record);
      reset(carry);
      return id;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      timer.dispose();
    },
  };
}
