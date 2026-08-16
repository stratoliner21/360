// Web アプリのエントリーポイント。
// ログイン認証・マスタ取得・評価送信のいずれも POST + JSON ボディで受け付ける。
// パスワード等の秘匿情報をURLクエリに載せないため、GET は疎通確認(ping)のみ許可する。

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'ping') {
    return jsonResponse({ success: true, message: 'pong', now: new Date().toISOString() });
  }
  return jsonResponse({
    success: false,
    error: { code: 'METHOD_NOT_ALLOWED', message: 'このAPIはPOSTでリクエストしてください' }
  });
}

function doPost(e) {
  let action;
  try {
    const params = parseRequestParams(e);
    action = params.action;

    switch (action) {
      case 'ping':
        return jsonResponse({ success: true, message: 'pong', now: new Date().toISOString() });
      case 'login':
        return jsonResponse(login(params));
      case 'getMaster':
        return jsonResponse(getMaster(params));
      case 'submitEvaluation':
        return jsonResponse(submit(params));
      default:
        throw new ApiError('UNKNOWN_ACTION', '不明なアクションです: ' + action);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonResponse({ success: false, error: { code: err.code, message: err.message } });
    }
    console.error(err);
    return jsonResponse({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' }
    });
  }
}
