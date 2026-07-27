/* 学習ログの読み出し（study.v1 §5.5）
 *
 * 遵守事項
 *   - 読み出し専用。study.records.v1 への書き込み・削除は行わない
 *   - 自アプリ（qalc）のレコードだけを扱う
 *   - schema === 'study.v1' を確認する
 *   - パース失敗時は空配列を返し、アプリの表示を壊さない
 *
 * 児童向けの表示でも、正答率は firstTryCorrect / attempted を用いる。
 */
import { APP_ID } from './studySession.js';

const STUDY_LOG_KEY = 'study.records.v1';

export function loadStudyRecords(appId = APP_ID) {
  try {
    const raw = localStorage.getItem(STUDY_LOG_KEY);
    if (!raw) return [];
    const log = JSON.parse(raw);
    if (!Array.isArray(log)) return [];
    return log.filter((r) => r && r.schema === 'study.v1' && r.appId === appId).reverse();
  } catch (e) {
    return [];
  }
}

const startedMs = (rec) => {
  const t = Date.parse(rec.startedAt);
  return Number.isFinite(t) ? t : 0;
};

export const withinDays = (records, days) => {
  const from = Date.now() - days * 24 * 60 * 60 * 1000;
  return records.filter((r) => startedMs(r) >= from);
};

/**
 * 直近 days 日のまとめ。
 * 正答率は「じゃまが入るマルチプレイ」を除いて計算する（§3.2 の集計上の警告）。
 * 取り組み量（回数・時間）はマルチプレイも含める。
 */
export function summarize(records, days = 7) {
  const recent = withinDays(records, days);
  const solo = recent.filter((r) => !r.multiplayer);

  let activeMs = 0;
  recent.forEach((r) => { activeMs += Number(r.activeMs) || Number(r.elapsedMs) || 0; });

  let attempted = 0;
  let firstTryCorrect = 0;
  solo.forEach((r) => {
    const s = r.summary || {};
    attempted += Number(s.attempted) || 0;
    firstTryCorrect += Number(s.firstTryCorrect) || 0;
  });

  return {
    sessions: recent.length,
    minutes: Math.round(activeMs / 60000),
    attempted,
    firstTryCorrect,
    firstTryRate: attempted > 0 ? firstTryCorrect / attempted : null,
    days,
  };
}

/**
 * よくまちがえた問題（初回で解けなかった回数の多い順）。
 * 設問IDが式そのもののときだけ表示に使う。文章題はハッシュなので児童には見せない。
 */
export function topMissedItems(records, limit = 3, days = 14) {
  const counts = new Map();
  withinDays(records, days).forEach((r) => {
    if (r.multiplayer) return; // 妨害のあるモードは「にがて」の証拠にしない
    (r.items || []).forEach((it) => {
      if (!it || it.firstTry || typeof it.q !== 'string') return;
      if (it.q.startsWith('w-') || it.q.startsWith('q-')) return; // 文章題（ハッシュID）は式として見せられない
      counts.set(it.q, (counts.get(it.q) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([q, misses]) => ({ q, misses }));
}

/** 単元ごとの初回正答率（多く取り組んだ順）。ソロのレコードのみを使う */
export function unitBreakdown(records, limit = 5, days = 14) {
  const byUnit = new Map();
  withinDays(records, days).forEach((r) => {
    if (r.multiplayer || !r.unit || !r.unit.id) return;
    const s = r.summary || {};
    const cur = byUnit.get(r.unit.id) || { id: r.unit.id, title: r.unit.title || r.unit.id, attempted: 0, firstTryCorrect: 0, sessions: 0 };
    cur.attempted += Number(s.attempted) || 0;
    cur.firstTryCorrect += Number(s.firstTryCorrect) || 0;
    cur.sessions += 1;
    cur.title = r.unit.title || cur.title;
    byUnit.set(r.unit.id, cur);
  });
  return [...byUnit.values()]
    .filter((u) => u.attempted > 0)
    .sort((a, b) => b.attempted - a.attempted)
    .slice(0, limit)
    .map((u) => ({ ...u, firstTryRate: u.firstTryCorrect / u.attempted }));
}
