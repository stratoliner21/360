// ログイン後に発行する署名付きトークンの発行・検証。
// GAS Web アプリはステートレスなため、社員番号+有効期限をHMAC署名して
// クライアント(デスクトップアプリ)に保持させ、以後のリクエストで提示させる。

function getTokenSecret() {
  const secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!secret) {
    throw new ApiError('CONFIG_ERROR', 'スクリプトプロパティ TOKEN_SECRET が設定されていません');
  }
  return secret;
}

function signPayload(payloadB64) {
  const secret = getTokenSecret();
  const bytes = Utilities.computeHmacSha256Signature(payloadB64, secret);
  return Utilities.base64EncodeWebSafe(bytes);
}

function issueToken(employeeId, ttlMinutes) {
  const payload = {
    sub: String(employeeId),
    iat: Date.now(),
    exp: Date.now() + ttlMinutes * 60 * 1000
  };
  const payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const sig = signPayload(payloadB64);
  return payloadB64 + '.' + sig;
}

// 検証に成功した場合、トークンに紐づく社員番号を返す。
function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.split('.').length !== 2) {
    throw new ApiError('AUTH_ERROR', '無効なトークンです');
  }
  const parts = token.split('.');
  const payloadB64 = parts[0];
  const sig = parts[1];

  const expectedSig = signPayload(payloadB64);
  if (!constantTimeEquals(sig, expectedSig)) {
    throw new ApiError('AUTH_ERROR', 'トークンの署名が不正です');
  }

  let payload;
  try {
    const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadB64)).getDataAsString();
    payload = JSON.parse(json);
  } catch (err) {
    throw new ApiError('AUTH_ERROR', 'トークンの解析に失敗しました');
  }

  if (!payload.exp || Date.now() > payload.exp) {
    throw new ApiError('AUTH_ERROR', 'トークンの有効期限が切れています。再度ログインしてください');
  }
  return payload.sub;
}

function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
