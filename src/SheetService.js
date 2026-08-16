// スプレッドシートの読み書きを担当する共通レイヤー。
// 4シートすべてこの層を経由してのみアクセスする。

function getSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('SPREADSHEET_ID');
  if (ssId) {
    return SpreadsheetApp.openById(ssId);
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new ApiError(
      'CONFIG_ERROR',
      'スプレッドシートが設定されていません。スクリプトプロパティ SPREADSHEET_ID を設定してください'
    );
  }
  return active;
}

function getSheet(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new ApiError('CONFIG_ERROR', 'シートが見つかりません: ' + sheetName);
  }
  return sheet;
}

// 1行目をヘッダーとして、2行目以降をオブジェクト配列として取得する。
// 各オブジェクトには __row（1始まりのシート上の行番号）を付与する。
function readSheetAsObjects(sheetName) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return { headers: [], rows: [] };

  const headers = values[0].map(function (h) { return String(h).trim(); });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const isBlank = row.every(function (c) { return c === '' || c === null; });
    if (isBlank) continue;

    const obj = {};
    headers.forEach(function (h, idx) { obj[h] = row[idx]; });
    obj.__row = i + 1;
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function appendRowByHeader(sheetName, rowObject) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  const row = headers.map(function (h) {
    return rowObject.hasOwnProperty(h) ? rowObject[h] : '';
  });
  sheet.appendRow(row);
}

function updateRowByHeader(sheetName, rowNumber, rowObject) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  const row = headers.map(function (h) {
    return rowObject.hasOwnProperty(h) ? rowObject[h] : '';
  });
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
}
