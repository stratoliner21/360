// 共通ユーティリティ（レスポンス生成・パラメータ検証・エラー型）

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// doPost の e.postData.contents (JSON文字列) をパースする。
// GAS Web アプリは doGet の e.parameter も同形式で扱えるようフォールバックする。
function parseRequestParams(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      throw new ApiError('INVALID_JSON', 'リクエストボディのJSON解析に失敗しました');
    }
  }
  return (e && e.parameter) || {};
}

function requireFields(params, fields) {
  fields.forEach(function (f) {
    if (params[f] === undefined || params[f] === null || params[f] === '') {
      throw new ApiError('VALIDATION_ERROR', '必須項目が不足しています: ' + f);
    }
  });
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim().toUpperCase() === 'TRUE';
  return false;
}

function todayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dateOnly(d) {
  const date = d instanceof Date ? d : new Date(d);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(d) {
  if (!(d instanceof Date)) return d;
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
}
