/* みんなであそぶ（P2P）の入室まわり。
 *
 * ここは「だれがへやに入れるか」「だれに何を配るか」を決める部分なので、
 * 画面の都合とまぜずに切りだして、node から直接テストできるようにしている。
 * 変更したら必ず `npm run test:room` を通すこと。
 */

// 通信の取り決め(プロトコル)の版。入室の手順やメッセージの形をかえたらここを上げる。
// PWAとしてキャッシュされた古い版の端末が新しい版のへやに入ろうとしたとき、
// 「ルームが見つかりません」ではなく「アプリが古い」と伝えられるようにするための番号。
export const PROTOCOL_VERSION = 2;

// PeerJS の接続先を明示的に固定する。
// 既定値まかせにすると、どのサーバへ通信するのかがコードから読めない。
// ここに書いたホストが、校内フィルタリングで許可が必要なホストと完全に一致する。
//   シグナリング(へやの番号のやりとり): 0.peerjs.com
//   ICE(つなぎ役):                      stun.l.google.com / *.turn.peerjs.com
// ICE は CSP では制御できないため、connect-src には書けない(README 参照)。
export const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    ],
  },
};

// うけつけタイム: この時間内の申しこみは自動で許可する。
// 30人学級でリーダーが30回タップするのは現実的でないため「いっせいに入れる時間」を用意する。
// 短いほど安全なので既定は30秒。延ばしたいときはボタンを押しなおす運用にする(開いたままにしない)。
export const ACCEPT_WINDOW_MS = 30000;

// ルーム番号: 10けたの数字。
// (1) Math.random は予測されうるので crypto.getRandomValues を使う
// (2) 6けた(90万通り)だと総当たりや偶然の一致で校外の第三者が入室できてしまうため10けた(90億通り)にする
// (3) 児童がテンキーで打てるよう、英数字ではなく数字のままにする(0とO、1とlの見まちがいも防げる)
export const ROOM_ID_LEN = 10;

// 0..max-1 の乱数。256 を max で割った余りを切りすてて引きなおし、出やすい数字がうまれないようにする
const randomDigit = (max) => {
  const buf = new Uint8Array(1);
  const limit = 256 - (256 % max);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % max;
};

export const generateRoomId = () => {
  let id = String(1 + randomDigit(9)); // 先頭は1〜9(けた数が足りないように見えるのを防ぐ)
  for (let i = 1; i < ROOM_ID_LEN; i++) id += String(randomDigit(10));
  return id;
};

export const isValidRoomId = (v) => typeof v === 'string' && new RegExp(`^[1-9][0-9]{${ROOM_ID_LEN - 1}}$`).test(v);

// 画面に見せるときだけ 4-3-3 で区切る(10けたを読みまちがえないように)。入力は数字だけでよい
export const formatRoomId = (id) => (typeof id === 'string' && id.length === ROOM_ID_LEN ? `${id.slice(0, 4)} ${id.slice(4, 7)} ${id.slice(7)}` : id || '');

// なまえ: ひらがな・カタカナ・英数字だけ、8文字まで。
// 本名を入れさせない決定打にはならない(ひらがなでも本名は書ける)ので、
// UIの文言で「本名は入れない」と伝えることとセットで運用する。
// 受けとる側(リーダー)でも必ずかけ直すこと。改造した端末は何でも送ってこられる。
export const NAME_MAX = 8;
export const sanitizeName = (v) => (typeof v === 'string' ? v : '').replace(/[^ぁ-んァ-ヴーa-zA-Z0-9]/g, '').slice(0, NAME_MAX);

// ==========================================
// 受けとったメッセージの検証
// ==========================================
// 通信の相手は「同じアプリを開いているはず」の端末だが、そう決めつけてはいけない。
// 開発者ツールから改造した端末は、どんな型のどんな値でも送ってこられる。
// 送られた値をそのまま使うと、ボスを1発でたおす・盤面を一気にぬる・
// 児童の画面に好きな文字を出す、といったことができてしまう。
//
// ここでは「知らない type は捨てる」「値は型と範囲でしぼる」「知らないキーは通さない」の
// 3つだけを徹底する。範囲外は はじくのではなく丸める(clamp)。
// 通信のゆらぎで正しい値が捨てられ、ゲームが進まなくなるほうが困るため。

const TERR_CELLS = 7 * 7;               // じんとりの盤面(TERRITORY_CONSTANTS.COLS × ROWS)
const TERR_SPECIAL_KINDS = ['drop', 'line', 'rush']; // TerritoryBattle.jsx の SPECIALS のキー
const TERR_MAX_CHARGE = 12;             // 1正解あたりのぬり数の上限(App.jsx の Math.min(12, ...))
// ボスへの与ダメージの上限。BossBattle.jsx の calcRaidDamage の最大値
//   (10 + 2*コンボ10) * 1.5(フィーバー) * 2(おうえん) = 90
// ★ calcRaidDamage の式を変えたら、この値も必ず見直すこと
const RAID_MAX_DAMAGE = 90;
const MAX_COMBO = 9999;
const MAX_SCORE = 9999999;
const GAME_MODES = ['SCORE_ATTACK', 'TIME_ATTACK', 'SUDDEN_DEATH', 'BOSS_RAID', 'TERRITORY'];

// 数値として使える値だけを通し、範囲におさめる。整数でない/NaN/Infinity/文字列は null
const num = (v, min, max, { int = true } = {}) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (int && !Number.isInteger(v)) v = Math.round(v);
  return Math.min(max, Math.max(min, v));
};
const cellIdx = (v) => {
  const n = num(v, 0, TERR_CELLS - 1);
  return n === null ? null : n;
};

/* メンバー → リーダー のメッセージ。
 * 参加者リストやゲームの進行を動かすのはこの向きなので、いちばん厳しく見る。
 * 返り値は「安全な形にそろえたメッセージ」。捨てるべきものは null。 */
export const parseMemberMessage = (raw) => {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return null;
  const d = raw.data && typeof raw.data === 'object' ? raw.data : {};

  switch (raw.type) {
    case 'pong':
    case 'leave':
    case 'raid_support':
      return { type: raw.type };

    case 'join':
      // 版番号は数値でなければ「不一致」として扱わせる(NaN は PROTOCOL_VERSION と一致しない)
      return { type: 'join', name: sanitizeName(raw.name), v: typeof raw.v === 'number' ? raw.v : -1 };

    case 'score_update': {
      const score = num(d.score, 0, MAX_SCORE);
      const combo = num(d.combo, 0, MAX_COMBO);
      if (score === null || combo === null) return null;
      return { type: 'score_update', data: { score, combo } };
    }

    case 'raid_attack': {
      // 1発でボスをたおせるような値は、ここで上限まで丸められる
      const damage = num(d.damage, 1, RAID_MAX_DAMAGE);
      const combo = num(d.combo, 0, MAX_COMBO);
      if (damage === null || combo === null) return null;
      return { type: 'raid_attack', data: { damage, combo } };
    }

    case 'terr_charge': {
      const idx = cellIdx(d.cellIdx);
      const amount = num(d.amount, 1, TERR_MAX_CHARGE);
      const combo = num(d.combo, 0, MAX_COMBO);
      if (idx === null || amount === null || combo === null) return null;
      return { type: 'terr_charge', data: { cellIdx: idx, amount, combo } };
    }

    case 'terr_target': {
      const idx = cellIdx(d.cellIdx);
      if (idx === null) return null;
      return { type: 'terr_target', data: { cellIdx: idx } };
    }

    case 'terr_special': {
      const idx = cellIdx(d.cellIdx);
      if (idx === null || !TERR_SPECIAL_KINDS.includes(d.kind)) return null;
      return { type: 'terr_special', data: { kind: d.kind, cellIdx: idx } };
    }

    default:
      return null; // 知らない type は捨てる
  }
};

/* リーダー → メンバー のメッセージ。
 * こちらは「リーダーの端末が改造されていたら」への備え。
 * とくに game_start は、以前は届いた data を state にまるごと混ぜていたため、
 * 知らないキーで画面の状態を上書きできた。
 * いまは下で必要なキーを1つずつ組み立てるので、それ以外は入りようがない
 * (届いた data をコピーしてから足し引きするのではなく、まっさらな器に詰めなおす)。 */

// 問題は「文字列の問題文」と「答えの候補(文字列の配列)」だけ。
// ここを通すことで、問題文の位置に画像やオブジェクトを差しこむことはできなくなる。
const MAX_PROBLEMS = 2000;
const MAX_PROBLEM_LEN = 200;
const sanitizeProblems = (v) => {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_PROBLEMS).map((p) => ({
    q: typeof p?.q === 'string' ? p.q.slice(0, MAX_PROBLEM_LEN) : '',
    a: Array.isArray(p?.a)
      ? p.a.filter((x) => typeof x === 'string').slice(0, 20).map((x) => x.slice(0, MAX_PROBLEM_LEN))
      : [],
  })).filter((p) => p.q && p.a.length);
};

const sanitizeParticipants = (v) => {
  if (!v || typeof v !== 'object') return {};
  const out = {};
  Object.entries(v).slice(0, 100).forEach(([id, m]) => {
    if (typeof id !== 'string' || !m || typeof m !== 'object') return;
    out[id] = {
      id,
      // リーダー側でもかけているが、ここでもかける。長い名前で画面をくずされないように
      name: sanitizeName(m.name) || 'ゲスト',
      score: num(m.score, 0, MAX_SCORE) ?? 0,
      combo: num(m.combo, 0, MAX_COMBO) ?? 0,
      ...(m.team === 'red' || m.team === 'blue' ? { team: m.team } : {}),
    };
  });
  return out;
};

export const parseHostMessage = (raw) => {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return null;

  switch (raw.type) {
    case 'ping':
    case 'join_accepted':
    case 'version_mismatch':
      return { type: raw.type };

    case 'room_closed':
      return { type: 'room_closed', data: { reason: typeof raw.data?.reason === 'string' ? raw.data.reason : '' } };

    case 'game_start': {
      const d = raw.data;
      if (!d || typeof d !== 'object') return null;
      const problemSet = sanitizeProblems(d.problemSet);
      if (!problemSet.length) return null; // 問題がなければゲームは始めない
      return {
        type: 'game_start',
        data: {
          problemSet,
          timeLimitSec: num(d.timeLimitSec, 0, 3600) ?? 0,
          courseName: typeof d.courseName === 'string' ? d.courseName.slice(0, 200) : '',
          courseNames: Array.isArray(d.courseNames)
            ? d.courseNames.filter((x) => typeof x === 'string').slice(0, 50)
            : [],
          gameMode: GAME_MODES.includes(d.gameMode) ? d.gameMode : 'SCORE_ATTACK',
          // raid / territory の中身はホスト権威のスナップショット。
          // 形(オブジェクトかどうか)だけ見て、数値の細部は各モジュールの描画側にゆだねる
          raid: d.raid && typeof d.raid === 'object' ? d.raid : null,
          territory: d.territory && typeof d.territory === 'object' ? d.territory : null,
        },
      };
    }

    case 'game_finish': {
      const d = raw.data && typeof raw.data === 'object' ? raw.data : {};
      return {
        type: 'game_finish',
        data: {
          ...(d.raidResult && typeof d.raidResult === 'object' ? { raidResult: d.raidResult } : {}),
          ...(d.territoryResult && typeof d.territoryResult === 'object' ? { territoryResult: d.territoryResult } : {}),
        },
      };
    }

    case 'participants_update':
      return { type: 'participants_update', data: sanitizeParticipants(raw.data) };

    // ゲーム中のスナップショット・演出。オブジェクトであることだけ確かめて渡す
    case 'raid_state':
    case 'raid_boss_attack':
    case 'raid_event':
    case 'terr_state':
    case 'terr_event':
      if (!raw.data || typeof raw.data !== 'object') return null;
      return { type: raw.type, data: raw.data };

    default:
      return null; // 知らない type は捨てる
  }
};

// --- 送信のユーティリティ ---
// 切断済みの接続へ送ると PeerJS がエラーを出すため、開いている接続にだけ送る
export const safeSend = (conn, data) => {
  try { if (conn && conn.open) conn.send(data); } catch (e) { /* すでに切れている接続は無視 */ }
};
export const sendToAll = (connections, data) => (connections || []).forEach(c => safeSend(c, data));

// リーダーが「いれる」をおした人(＝参加者リストに載っている人)にだけ配る。
// 承認まちの端末に参加者リストやゲーム開始をながしてしまわないための関門。
// これがないと、番号を当てただけの第三者に児童のなまえ一覧がとどく。
export const sendToApproved = (p, data) => (p?.connections || []).forEach(c => { if (p.participants?.[c.peer]) safeSend(c, data); });
