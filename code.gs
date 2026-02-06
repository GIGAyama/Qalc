/**
 * Qalc (カルク) - 計算バトルアプリ プログラム本体
 * Ver 1.0
 * * このファイルはアプリの「動き」を管理しています。
 * 問題データの追加・修正は、別ファイルの「initialData.gs」で行ってください。
 */

// =================================================================
// 1. 基本設定・Webアプリ機能
// =================================================================

const APP_NAME = "Qalc";
// プロパティサービス（設定値を保存する場所）の取得
const SCRIPT_PROP = PropertiesService.getScriptProperties();

/**
 * アプリにアクセスした時に最初に動く関数
 * 画面（HTML）を表示します。
 */
function doGet(e) {
  // URLパラメータ（招待用リンクなど）から部屋IDを取得
  const initialRoomId = e.parameter.room || "";
  
  // index.html を元に画面を作成
  const template = HtmlService.createTemplateFromFile('index');
  
  // 画面に部屋IDとアプリのURLを渡す
  template.initialRoomId = initialRoomId; 
  template.appUrl = ScriptApp.getService().getUrl();

  // 画面を表示するための設定（タイトルやスマホ対応など）
  return template.evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setFaviconUrl('https://drive.google.com/uc?id=1_XKWqFLbuOzzmtSMVNB_UbpqNj0ace2J&.png');
}

/**
 * HTMLファイルの中に別のファイルを読み込むための関数
 * （CSSやJavaScriptを分割するために使います）
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * アプリ起動時の接続チェック用
 * フロントエンドから呼び出して、通信が通じるか確認します。
 */
function checkConnection() {
  const ss = getDb(); // DBにアクセスできるか確認
  return { status: 'ok' };
}


// =================================================================
// 2. データベース（スプレッドシート）の基本操作
// =================================================================

/**
 * データベース（スプレッドシート）を取得する関数
 * IDが保存されていない、または開けない場合はエラーを出します。
 */
function getDb() {
  const id = SCRIPT_PROP.getProperty('SS_ID');
  if (!id) {
    throw new Error('データベースIDが見つかりません');
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('データベースを開けませんでした');
  }
}

/**
 * 初回起動時のセットアップ関数
 * 必要なシート（Rooms, Scores, Problems）を自動で作ります。
 */
function initialSetup() {
  let ss;
  try {
    // 既存のIDがあればそれを開く、なければ新規作成
    const id = SCRIPT_PROP.getProperty('SS_ID');
    if (id) {
      try {
        ss = SpreadsheetApp.openById(id);
      } catch(e) {
        ss = SpreadsheetApp.create(`${APP_NAME}_DB`);
      }
    } else {
      ss = SpreadsheetApp.create(`${APP_NAME}_DB`);
    }
    
    // 作成したファイルのIDを保存
    const fileId = ss.getId();
    
    // シートを作成する便利関数（なければ作る、あればそのまま）
    const ensureSheet = (name, headers) => {
      let sheet = ss.getSheetByName(name);
      if (!sheet) {
        sheet = ss.insertSheet(name);
        if (headers) sheet.appendRow(headers); // 1行目に見出しを追加
      }
      return sheet;
    };

    // 必要なシートを準備
    ensureSheet('Rooms', ['RoomId', 'HostName', 'ProblemSet', 'TimeLimit', 'Status', 'CreatedAt', 'DeletedAt']);
    ensureSheet('Scores', ['RoomId', 'PlayerName', 'Score', 'MaxCombo', 'LastUpdated']);
    
    // 問題データシートの準備と、初期データの書き込み
    const probSheet = ensureSheet('Problems', ['GroupName', 'Question', 'Answer', 'DeletedAt']);
    
    // もしデータが空っぽなら、初期データ（SEED_DATA）を書き込む
    // ※ SEED_DATA は initialData.gs に定義されています
    if (probSheet.getLastRow() < 2 && typeof SEED_DATA !== 'undefined') {
      const seedRows = SEED_DATA.map(d => [d.g, d.q, d.a, '']);
      if(seedRows.length > 0) {
        probSheet.getRange(2, 1, seedRows.length, 4).setValues(seedRows);
      }
    }

    // デフォルトの「シート1」があれば削除してスッキリさせる
    const defaultSheet = ss.getSheetByName('シート1');
    if (defaultSheet) ss.deleteSheet(defaultSheet);

    // 設定完了フラグを保存
    SCRIPT_PROP.setProperty('SS_ID', fileId);
    SCRIPT_PROP.setProperty('IS_INITIALIZED', 'true');
    
    return { success: true, url: ss.getUrl() };

  } catch (e) {
    console.error(e);
    throw new Error('初期セットアップに失敗しました: ' + e.toString());
  }
}


// =================================================================
// 3. 問題データの管理機能 (取得・保存・削除)
// =================================================================

/**
 * 問題グループ（コース）の一覧を取得する
 * 例: [{name: "1年_たしざん", count: 20}, ...]
 */
function getProblemGroups() {
  const ss = getDb();
  let sheet = ss.getSheetByName('Problems');
  // シートがない場合は初期セットアップを実行
  if (!sheet) {
    initialSetup();
    sheet = ss.getSheetByName('Problems');
  }
  
  const data = sheet.getDataRange().getValues();
  const groups = {};
  
  // データを走査してグループごとの問題数をカウント
  // i=1 から始めるのは、0行目は見出しだから
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // 削除フラグ(D列)が空のものだけを集計
    if (row[3] === '') { 
      const gName = String(row[0]); // 文字列として扱う
      if (!groups[gName]) groups[gName] = 0;
      groups[gName]++;
    }
  }
  
  // 名前順に並べて返す
  return Object.keys(groups).sort().map(name => ({
    name: name,
    count: groups[name]
  }));
}

/**
 * 指定されたグループの問題リストを取得する
 * ★修正ポイント: 日付に化けてしまった分数を「M/D」形式の文字列に復元する
 */
function getProblemsByGroup(groupName) {
  const ss = getDb();
  let sheet = ss.getSheetByName('Problems');
  if (!sheet) { initialSetup(); sheet = ss.getSheetByName('Problems'); }

  const data = sheet.getDataRange().getValues();
  const problems = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // グループ名が一致し、かつ削除されていないもの
    // row[0] も念のためString変換して比較
    if (String(row[0]) === String(groupName) && row[3] === '') {
      
      let qVal = row[1];
      let aVal = row[2];

      // ★日付変換の救済処理★
      // スプレッドシートが分数を勝手に日付(Date型)として解釈してしまっている場合、
      // それを「月/日」という形式の文字列に戻します。
      // 例: "2024/01/02" (Date) → "1/2" (String)
      if (qVal instanceof Date) {
        qVal = (qVal.getMonth() + 1) + '/' + qVal.getDate();
      }
      if (aVal instanceof Date) {
        aVal = (aVal.getMonth() + 1) + '/' + aVal.getDate();
      }

      problems.push({
        q: String(qVal || ""), // 空の場合は空文字にする
        a: String(aVal || "")
      });
    }
  }
  return problems;
}

/**
 * 問題セットを保存する（編集・新規作成）
 * 実装方法: 一旦そのグループの既存データを論理削除し、新しいデータを追加します。
 */
function saveProblemSet(groupName, problems) {
  const ss = getDb();
  let sheet = ss.getSheetByName('Problems');
  if (!sheet) { initialSetup(); sheet = ss.getSheetByName('Problems'); }

  const data = sheet.getDataRange().getValues();
  const now = new Date();
  
  // 1. 同じ名前の既存グループがあれば、削除日を入れて「削除済み」扱いにする
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === groupName && data[i][3] === '') {
      sheet.getRange(i + 1, 4).setValue(now); // D列に日時を書き込む
    }
  }
  
  // 2. 新しい問題データを追加する
  // 入力値も文字列化して保存
  const newRows = problems.map(p => [String(groupName), String(p.q), String(p.a), '']);
  if(newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
  }
  return { success: true };
}

/**
 * 問題グループを削除する
 */
function deleteProblemGroup(groupName) {
  const ss = getDb();
  const sheet = ss.getSheetByName('Problems');
  if (!sheet) return { success: true };

  const data = sheet.getDataRange().getValues();
  const now = new Date();
  
  // 該当するグループの問題全てに削除日を入れる
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === groupName && data[i][3] === '') {
      sheet.getRange(i + 1, 4).setValue(now);
    }
  }
  return { success: true };
}


// =================================================================
// 4. ゲーム部屋・スコアの管理機能
// =================================================================

/**
 * 新しい部屋を作成する
 */
function createRoom(hostName, problemSetJson, timeLimit) {
  // まず古い部屋データを掃除する
  cleanUpDatabase();
  
  const ss = getDb();
  const sheet = ss.getSheetByName('Rooms');
  
  // 4桁のランダムな部屋ID (1000〜9999)
  const roomId = Math.floor(1000 + Math.random() * 9000).toString();
  const now = new Date();
  
  // Roomsシートに追加
  sheet.appendRow([roomId, hostName, problemSetJson, timeLimit, 'WAITING', now, '']);
  return { success: true, roomId: roomId };
}

/**
 * 部屋に参加する
 */
function joinRoom(roomId, playerName) {
  cleanUpDatabase();
  const ss = getDb();
  
  // 部屋情報を取得して存在確認
  const roomInfo = getRoomInfo(roomId);
  if (roomInfo.error) return roomInfo; // 部屋がない場合
  
  // すでに同じ名前で参加していないか確認
  const isExist = roomInfo.participants.some(p => p.name === playerName);
  if (!isExist) {
    // 参加していなければ Scores シートに追加
    const scoreSheet = ss.getSheetByName('Scores');
    scoreSheet.appendRow([roomId, playerName, 0, 0, new Date()]);
  }
  return { success: true, room: roomInfo.room };
}

/**
 * 部屋の状態と参加者リストを取得する（ポーリング用）
 */
function getRoomInfo(roomId, playerName) {
  const ss = getDb();
  const roomSheet = ss.getSheetByName('Rooms');
  const rooms = roomSheet.getDataRange().getValues();
  
  // 1. 部屋を探す（後ろから探すと最新が見つかりやすい）
  let room = null;
  for (let i = rooms.length - 1; i >= 1; i--) {
    if (String(rooms[i][0]) === String(roomId)) {
      room = {
        roomId: rooms[i][0],
        host: rooms[i][1],
        problemSet: rooms[i][2],
        timeLimit: rooms[i][3],
        status: rooms[i][4] // 'WAITING' か 'ACTIVE'
      };
      break;
    }
  }
  
  if (!room) return { error: 'ROOM_NOT_FOUND' };
  
  // 2. 参加者とスコアを探す
  const scoreSheet = ss.getSheetByName('Scores');
  const scores = scoreSheet.getDataRange().getValues();
  const participants = [];
  
  for (let i = 1; i < scores.length; i++) {
    if (String(scores[i][0]) === String(roomId)) {
      participants.push({
        name: scores[i][1],
        score: Number(scores[i][2]),
        combo: Number(scores[i][3])
      });
    }
  }
  
  // スコア順に並べ替え（ランキング表示用）
  participants.sort((a, b) => b.score - a.score);
  
  return { room: room, participants: participants };
}

/**
 * ゲームを開始する（ステータスを ACTIVE に変更）
 */
function startGame(roomId) {
  const ss = getDb();
  const sheet = ss.getSheetByName('Rooms');
  const data = sheet.getDataRange().getValues();
  
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(roomId)) {
      // ステータス列(E列=index 4)を更新
      sheet.getRange(i + 1, 5).setValue('ACTIVE');
      return { success: true };
    }
  }
  return { error: 'ERROR' };
}

/**
 * スコアを更新する
 * 排他制御（LockService）を使って、同時に書き込みが起きても壊れないようにしています。
 */
function updateScore(roomId, playerName, score, maxCombo) {
  const lock = LockService.getScriptLock();
  try {
    // 最大3秒間、他の人が書き終わるのを待つ
    lock.waitLock(3000); 
    
    const ss = getDb();
    const scoreSheet = ss.getSheetByName('Scores');
    const data = scoreSheet.getDataRange().getValues();
    
    // 自分の行を探して更新
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(roomId) && data[i][1] === playerName) {
        // C列(Score), D列(MaxCombo), E列(LastUpdated) を更新
        scoreSheet.getRange(i + 1, 3, 1, 3).setValues([[score, maxCombo, new Date()]]);
        return { success: true };
      }
    }
    return { success: false, message: 'Player not found' };
  } catch (e) {
    return { success: false, error: 'Server Busy' };
  } finally {
    // 必ずロックを解除する
    lock.releaseLock();
  }
}

/**
 * 部屋を解散・削除する
 */
function deleteRoom(roomId) {
  try {
    const ss = getDb();
    const roomSheet = ss.getSheetByName('Rooms');
    const scoreSheet = ss.getSheetByName('Scores');
    
    // Roomsシートから該当部屋以外を残す（フィルタリング）
    const roomData = roomSheet.getDataRange().getValues();
    const keepRooms = roomData.filter((row, i) => i === 0 || String(row[0]) !== String(roomId));
    
    if (keepRooms.length < roomData.length) {
      roomSheet.clearContents();
      if(keepRooms.length > 0) roomSheet.getRange(1, 1, keepRooms.length, keepRooms[0].length).setValues(keepRooms);
    }
    
    // Scoresシートからも削除
    const scoreData = scoreSheet.getDataRange().getValues();
    const keepScores = scoreData.filter((row, i) => i === 0 || String(row[0]) !== String(roomId));
    
    if (keepScores.length < scoreData.length) {
      scoreSheet.clearContents();
      if(keepScores.length > 0) scoreSheet.getRange(1, 1, keepScores.length, keepScores[0].length).setValues(keepScores);
    }
  } catch(e) {}
}

/**
 * 古い部屋データを自動でお掃除する機能
 * 5分以上待機中の部屋や、24時間以上経過した部屋を削除します。
 */
function cleanUpDatabase() {
  try {
    const ss = getDb();
    const roomSheet = ss.getSheetByName('Rooms');
    const scoreSheet = ss.getSheetByName('Scores');
    if(!roomSheet || !scoreSheet) return;

    const now = new Date().getTime();
    const TIMEOUT_WAITING = 5 * 60 * 1000;     // 待機中なら5分で削除
    const TIMEOUT_OLD = 24 * 60 * 60 * 1000;   // 古い部屋は24時間で削除

    const roomData = roomSheet.getDataRange().getValues();
    if (roomData.length <= 1) return;

    const keepRooms = [roomData[0]]; // 見出し行は残す
    const deletedRoomIds = [];

    for (let i = 1; i < roomData.length; i++) {
      const row = roomData[i];
      const roomId = row[0];
      const status = row[4];
      const createdAt = new Date(row[5]).getTime();
      
      let shouldDelete = false;
      if (status === 'WAITING' && (now - createdAt > TIMEOUT_WAITING)) shouldDelete = true;
      else if (now - createdAt > TIMEOUT_OLD) shouldDelete = true;

      if (shouldDelete) deletedRoomIds.push(String(roomId));
      else keepRooms.push(row);
    }

    if (deletedRoomIds.length === 0) return;

    // 部屋データを更新（削除対象を除いたリストで上書き）
    roomSheet.clearContents();
    if (keepRooms.length > 0) roomSheet.getRange(1, 1, keepRooms.length, keepRooms[0].length).setValues(keepRooms);

    // 削除された部屋に関連するスコアも削除
    const scoreData = scoreSheet.getDataRange().getValues();
    const keepScores = [scoreData[0]];
    for (let i = 1; i < scoreData.length; i++) {
      if (!deletedRoomIds.includes(String(scoreData[i][0]))) keepScores.push(scoreData[i]);
    }
    scoreSheet.clearContents();
    if (keepScores.length > 0) scoreSheet.getRange(1, 1, keepScores.length, keepScores[0].length).setValues(keepScores);
  } catch(e) {}
}
