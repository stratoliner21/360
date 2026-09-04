// ログイン試行回数の制限（要件定義書 7.1: 社員番号の総当たり対策）。
// CacheService はデプロイ全体で共有されるため、社員番号単位の失敗回数・ロック状態を
// スクリプトのプロパティストアではなく短命なキャッシュで管理する。

function getLoginCache_() {
  return CacheService.getScriptCache();
}

function loginFailureKey_(employeeId) {
  return 'login_fail_' + employeeId;
}

function loginLockKey_(employeeId) {
  return 'login_lock_' + employeeId;
}

// ロック中であれば ApiError を投げる。呼び出し側は資格情報を検証する前に呼ぶこと。
function assertLoginNotLocked(employeeId) {
  const cache = getLoginCache_();
  if (cache.get(loginLockKey_(employeeId))) {
    throw new ApiError(
      'ACCOUNT_LOCKED',
      'ログイン試行回数の上限を超えたため、しばらくの間ログインできません。' +
        LOGIN_LOCKOUT_MINUTES + '分ほど時間をおいて再度お試しください'
    );
  }
}

// 認証失敗時に呼ぶ。既定回数に達したらロックを設定する。
function recordLoginFailure(employeeId) {
  const cache = getLoginCache_();
  const key = loginFailureKey_(employeeId);
  const current = Number(cache.get(key) || '0') + 1;

  if (current >= LOGIN_MAX_ATTEMPTS) {
    cache.put(loginLockKey_(employeeId), '1', LOGIN_LOCKOUT_MINUTES * 60);
    cache.remove(key);
  } else {
    cache.put(key, String(current), LOGIN_ATTEMPT_WINDOW_MINUTES * 60);
  }
}

// 認証成功時に呼び、その社員番号の失敗履歴をクリアする。
function clearLoginFailures(employeeId) {
  const cache = getLoginCache_();
  cache.remove(loginFailureKey_(employeeId));
  cache.remove(loginLockKey_(employeeId));
}
