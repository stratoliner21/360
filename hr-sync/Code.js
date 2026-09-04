// F-11: 人事原本(社員名簿) → 評価専用マスタ(社員マスタ) 同期スクリプト
//
// このプロジェクトは 360度評価APIの GAS プロジェクト(src/)とは別物で、
// 「人事原本」スプレッドシートにコンテナバインドして使う。
// 人事担当者がカスタムメニューを押した時だけ、人事担当者自身のアカウント権限で実行される
// (要件定義書 5.1・F-11 / データ定義書 v1.1 3章)。
//
// 同期対象は 社員番号・氏名・メールアドレス・部署・代表フラグ・有効フラグ。
// パスワードのみ評価専用マスタ側で管理し、この同期では変更しない(新規社員の初回発行を除く)。
// 360度評価APIの実行アカウントは、この人事原本への読み取り権限を持たない。
//
// 部署(旧・事業所)の判定は、人事原本の「部署」シート(部門・部署コード・部署の対応表)を
// 正とする。以前のようなスクリプトプロパティでの手動対応表(OFFICE_CODE_MAP)は不要。

const SYNC_TARGET_SHEET = '社員マスタ';
const SYNC_SOURCE_SHEET_NAME_PROPERTY = 'SOURCE_SHEET_NAME';
const SYNC_DEFAULT_SOURCE_SHEET_NAME = 'シート1';
const SYNC_DEPARTMENT_SHEET_NAME_PROPERTY = 'SOURCE_DEPARTMENT_SHEET_NAME';
const SYNC_DEFAULT_DEPARTMENT_SHEET_NAME = '部署';

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

// 「代表」とみなす部門名(例: 役員)。この部門に属する部署の社員は代表フラグ=TRUEとして同期する。
function getRepresentativeDepartmentName_() {
  return getScriptProperty_('REPRESENTATIVE_DEPARTMENT_NAME') || '役員';
}

// 「退職」とみなす部門名。この部門に属する部署の社員は有効フラグ=FALSEとして同期する。
function getResignedDepartmentName_() {
  return getScriptProperty_('RESIGNED_DEPARTMENT_NAME') || '退職';
}

function isDryRun_() {
  return (getScriptProperty_('SYNC_DRY_RUN') || 'false').toLowerCase() === 'true';
}

// 人事原本の「部署」シート(部門・部署コード・部署の3列)を読み、
// 部署名 → { department, code } のマップを作る。このマップが部署マスタの正となる。
function readUnitLookup_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = getScriptProperty_(SYNC_DEPARTMENT_SHEET_NAME_PROPERTY) || SYNC_DEFAULT_DEPARTMENT_SHEET_NAME;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('人事原本に「部署」シートが見つかりません: ' + sheetName);
  }

  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return {};

  const headers = values[0].map(function (h) { return String(h).trim(); });
  const deptIdx = headers.indexOf('部門');
  const codeIdx = headers.indexOf('部署コード');
  const unitIdx = headers.indexOf('部署');
  if (deptIdx === -1 || unitIdx === -1) {
    throw new Error('「' + sheetName + '」シートに必要な列(部門・部署)が見つかりません');
  }

  const lookup = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const unitName = row[unitIdx];
    if (unitName === '' || unitName === null || unitName === undefined) continue;
    lookup[String(unitName).trim()] = {
      department: String(row[deptIdx]).trim(),
      code: codeIdx === -1 ? '' : row[codeIdx]
    };
  }
  return lookup;
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
  // 「所属」列はシート内に2回登場する(古い単独列と、「所属履歴」グループ内の現在の所属)。
  // 現在値は後方(最後)に出現する方なので lastIndexOf で取得する。
  const unitIdx = headers.lastIndexOf('所属');
  const resignIdx = idxOf('退職日');

  if (idIdx === -1 || nameIdx === -1 || unitIdx === -1) {
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
      rawUnit: row[unitIdx],
      resignedDate: resignIdx === -1 ? '' : row[resignIdx]
    });
  }
  return rows;
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
  const representativeDept = getRepresentativeDepartmentName_();
  const resignedDept = getResignedDepartmentName_();

  let sourceRows;
  let unitLookup;
  try {
    sourceRows = readSourceRows_();
    unitLookup = readUnitLookup_();
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
    ui.alert('評価専用マスタの「' + SYNC_TARGET_SHEET + '」シートにヘッダー行がありません。先にヘッダー行(社員番号・氏名・パスワード・メールアドレス・部署・代表フラグ・有効フラグ)を用意してください');
    return;
  }

  const targetHeaders = targetValues[0].map(function (h) { return String(h).trim(); });
  const col = {
    id: targetHeaders.indexOf('社員番号'),
    name: targetHeaders.indexOf('氏名'),
    password: targetHeaders.indexOf('パスワード'),
    email: targetHeaders.indexOf('メールアドレス'),
    unit: targetHeaders.indexOf('部署'),
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
    const unitName = String(src.rawUnit).trim();
    const unitInfo = unitLookup[unitName];
    if (!unitInfo) {
      skipped.push(src.employeeId + '：所属「' + src.rawUnit + '」が「部署」シートに見つかりません');
      return;
    }

    const isRepresentative = unitInfo.department === representativeDept;
    const isResignedDept = unitInfo.department === resignedDept;
    const activeFlag = !isResignedDept && !src.resignedDate;

    const existingRow = existingRowByEmployeeId[src.employeeId];

    if (existingRow) {
      // 既存社員: 氏名・メールアドレス・部署・代表フラグ・有効フラグを更新する。
      // パスワードのみ評価専用マスタ側の既存値を維持する。
      if (!dryRun) {
        targetSheet.getRange(existingRow, col.name + 1).setValue(src.name);
        targetSheet.getRange(existingRow, col.email + 1).setValue(src.email);
        targetSheet.getRange(existingRow, col.unit + 1).setValue(unitName);
        targetSheet.getRange(existingRow, col.rep + 1).setValue(isRepresentative);
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
      newRow[col.unit] = unitName;
      newRow[col.rep] = isRepresentative;
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
