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
