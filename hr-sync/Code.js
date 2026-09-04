// F-11: 人事原本(社員名簿) → 評価専用マスタ(社員マスタ) 同期スクリプト
//
// このプロジェクトは 360度評価APIの GAS プロジェクト(src/)とは別物で、
// 「人事原本」スプレッドシートにコンテナバインドして使う。
// 人事担当者がカスタムメニューを押した時だけ、人事担当者自身のアカウント権限で実行される
// (要件定義書 5.1・F-11 / データ定義書 v1.1 3章)。
//
// 同期対象は 社員番号・氏名・メールアドレス・事業所・有効フラグ の5項目のみ。
// パスワード・代表フラグは評価専用マスタ側でのみ管理し、この同期では一切変更しない。
// 360度評価APIの実行アカウントは、この人事原本への読み取り権限を持たない。

const SYNC_TARGET_SHEET = '社員マスタ';
const SYNC_SOURCE_SHEET_NAME_PROPERTY = 'SOURCE_SHEET_NAME';
const SYNC_DEFAULT_SOURCE_SHEET_NAME = 'シート1';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('360度評価')
    .addItem('評価用マスタへ反映', 'syncToEvaluationMaster')
    .addToUi();
}

function getScriptProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getEvalMasterSpreadsheetId_() {
  const id = getScriptProperty_('EVAL_MASTER_SPREADSHEET_ID');
  if (!id) {
    throw new Error('スクリプトプロパティ EVAL_MASTER_SPREADSHEET_ID が設定されていません(評価専用マスタのスプレッドシートID)');
  }
  return id;
}

// 「所属」列の値(例: 101_Campo台之郷) → 事業所マスタの事業所名(例: Campo台之郷) の対応表。
// 部門・事業所の全体像は要件定義書「13. 未決事項」の通りまだ確定していないため、
// ここではハードコードせずスクリプトプロパティで管理する。
// 例: {"101_Campo台之郷":"Campo台之郷","102_Campo大原":"Campo大原"}
function getOfficeCodeMap_() {
  const raw = getScriptProperty_('OFFICE_CODE_MAP');
  if (!raw) {
    throw new Error(
      'スクリプトプロパティ OFFICE_CODE_MAP が設定されていません。' +
        '「所属」列の値→事業所マスタの事業所名の対応表をJSON形式で設定してください'
    );
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('OFFICE_CODE_MAP のJSON解析に失敗しました: ' + e.message);
  }
}

// 「退職」等、退職扱いとみなす在籍状況の文字列一覧。既定は ["退職"]。
function getResignedStatusValues_() {
  const raw = getScriptProperty_('RESIGNED_STATUS_VALUES');
  if (!raw) return ['退職'];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : ['退職'];
  } catch (e) {
    return ['退職'];
  }
}

function isDryRun_() {
  return (getScriptProperty_('SYNC_DRY_RUN') || 'false').toLowerCase() === 'true';
}

function readSourceRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = getScriptProperty_(SYNC_SOURCE_SHEET_NAME_PROPERTY) || SYNC_DEFAULT_SOURCE_SHEET_NAME;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('人事原本のシートが見つかりません: ' + sheetName);
  }

  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return [];

  const headers = values[0].map(function (h) { return String(h).trim(); });
  const idxOf = function (name) { return headers.indexOf(name); };

  const idIdx = idxOf('社員番号');
  const nameIdx = idxOf('氏名');
  const mailIdx = idxOf('メールアドレス');
  const officeIdx = idxOf('所属');
  const statusIdx = idxOf('在籍状況');
  const resignIdx = idxOf('退職日');

  if (idIdx === -1 || nameIdx === -1 || officeIdx === -1) {
    throw new Error('人事原本に必要な列(社員番号・氏名・所属)が見つかりません');
  }

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const employeeId = row[idIdx];
    // 社員番号が空の行(区切り見出し行「退職済」など)はスキップする
    if (employeeId === '' || employeeId === null || employeeId === undefined) continue;

    rows.push({
      employeeId: String(employeeId).trim(),
      name: row[nameIdx],
      email: mailIdx === -1 ? '' : row[mailIdx],
      rawOffice: row[officeIdx],
      status: statusIdx === -1 ? '' : row[statusIdx],
      resignedDate: resignIdx === -1 ? '' : row[resignIdx]
    });
  }
  return rows;
}

// 在籍状況の判定。
// 1. 「在籍状況」列があれば、その値が退職扱い文字列(既定「退職」)かどうかで判定する
// 2. その列がなければ「退職日」が入力されているかどうかで判定する(実データはこちらの形式)
// 人事原本側の運用が変わった場合は、この関数だけを差し替えれば良い構成にしている。
function deriveActiveFlag_(sourceRow) {
  if (sourceRow.status) {
    const resignedValues = getResignedStatusValues_();
    return resignedValues.indexOf(String(sourceRow.status).trim()) === -1;
  }
  return !sourceRow.resignedDate;
}

function generatePassword_() {
  // 見間違えやすい 0/O, 1/l/I を除いた文字集合から8桁生成する
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 8; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pw;
}

// F-08: 新規社員への初期パスワード送付
function sendInitialPasswordEmail_(name, email, employeeId, password) {
  if (!email) return;
  const subject = '【360度評価システム】初期パスワードのお知らせ';
  const body =
    name + ' 様\n\n' +
    '360度評価システムのアカウントを発行しました。\n\n' +
    '社員番号: ' + employeeId + '\n' +
    '初期パスワード: ' + password + '\n\n' +
    '本パスワードはユーザー側で変更することはできません。' +
    '紛失・お忘れの場合は本部までご連絡ください。';
  MailApp.sendEmail(email, subject, body);
}

function syncToEvaluationMaster() {
  const ui = SpreadsheetApp.getUi();
  const dryRun = isDryRun_();

  let sourceRows;
  let officeMap;
  try {
    sourceRows = readSourceRows_();
    officeMap = getOfficeCodeMap_();
  } catch (e) {
    ui.alert('同期を中止しました: ' + e.message);
    return;
  }

  let targetSheet;
  try {
    const targetSs = SpreadsheetApp.openById(getEvalMasterSpreadsheetId_());
    targetSheet = targetSs.getSheetByName(SYNC_TARGET_SHEET);
    if (!targetSheet) {
      throw new Error('評価専用マスタに「' + SYNC_TARGET_SHEET + '」シートが見つかりません');
    }
  } catch (e) {
    ui.alert('同期を中止しました: ' + e.message);
    return;
  }

  const targetValues = targetSheet.getDataRange().getValues();
  if (targetValues.length === 0) {
    ui.alert('評価専用マスタの「' + SYNC_TARGET_SHEET + '」シートにヘッダー行がありません。先にヘッダー行(社員番号・氏名・パスワード・メールアドレス・事業所・代表フラグ・有効フラグ)を用意してください');
    return;
  }

  const targetHeaders = targetValues[0].map(function (h) { return String(h).trim(); });
  const col = {
    id: targetHeaders.indexOf('社員番号'),
    name: targetHeaders.indexOf('氏名'),
    password: targetHeaders.indexOf('パスワード'),
    email: targetHeaders.indexOf('メールアドレス'),
    office: targetHeaders.indexOf('事業所'),
    rep: targetHeaders.indexOf('代表フラグ'),
    active: targetHeaders.indexOf('有効フラグ')
  };
  const missingCols = Object.keys(col).filter(function (key) { return col[key] === -1; });
  if (missingCols.length > 0) {
    ui.alert('評価専用マスタの「' + SYNC_TARGET_SHEET + '」シートに必要な列がありません: ' + missingCols.join(', '));
    return;
  }

  const existingRowByEmployeeId = {};
  for (let i = 1; i < targetValues.length; i++) {
    const id = targetValues[i][col.id];
    if (id === '' || id === null || id === undefined) continue;
    existingRowByEmployeeId[String(id).trim()] = i + 1; // 1始まりのシート行番号
  }

  let created = 0;
  let updated = 0;
  const skipped = [];
  const newAccounts = [];

  sourceRows.forEach(function (src) {
    const office = officeMap[String(src.rawOffice).trim()];
    if (!office) {
      skipped.push(src.employeeId + '：所属「' + src.rawOffice + '」に対応する事業所名が OFFICE_CODE_MAP にありません');
      return;
    }

    const activeFlag = deriveActiveFlag_(src);
    const existingRow = existingRowByEmployeeId[src.employeeId];

    if (existingRow) {
      // 既存社員: 氏名・メールアドレス・事業所・有効フラグのみ更新。パスワード・代表フラグは維持する
      if (!dryRun) {
        targetSheet.getRange(existingRow, col.name + 1).setValue(src.name);
        targetSheet.getRange(existingRow, col.email + 1).setValue(src.email);
        targetSheet.getRange(existingRow, col.office + 1).setValue(office);
        targetSheet.getRange(existingRow, col.active + 1).setValue(activeFlag);
      }
      updated++;
    } else {
      // 新規社員: パスワードを自動発行し、評価専用マスタへ追加行を作る(F-08)
      const password = generatePassword_();
      const newRow = new Array(targetHeaders.length).fill('');
      newRow[col.id] = src.employeeId;
      newRow[col.name] = src.name;
      newRow[col.password] = password;
      newRow[col.email] = src.email;
      newRow[col.office] = office;
      newRow[col.rep] = false;
      newRow[col.active] = activeFlag;

      if (!dryRun) {
        targetSheet.appendRow(newRow);
      }
      created++;
      newAccounts.push({ name: src.name, email: src.email, employeeId: src.employeeId, password: password });
    }
  });

  if (!dryRun) {
    newAccounts.forEach(function (acc) {
      sendInitialPasswordEmail_(acc.name, acc.email, acc.employeeId, acc.password);
    });
  }

  let message = (dryRun ? '[ドライラン・実際には反映していません]\n\n' : '') +
    '同期が完了しました。\n新規: ' + created + '件 / 更新: ' + updated + '件';
  if (skipped.length > 0) {
    message += '\n\nスキップ(要確認): ' + skipped.length + '件\n' + skipped.join('\n');
  }
  ui.alert(message);
}
