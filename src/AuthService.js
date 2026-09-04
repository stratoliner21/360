// ログイン認証（社員マスタ）まわりの処理

function findEmployeeById(employeeId) {
  const { rows } = readSheetAsObjects(SHEET_NAMES.EMPLOYEE);
  const target = String(employeeId).trim();
  return rows.find(function (r) { return String(r['社員番号']).trim() === target; }) || null;
}

function toPublicEmployee(employee) {
  return {
    employeeId: String(employee['社員番号']).trim(),
    name: employee['氏名'],
    office: employee['事業所'],
    isRepresentative: toBool(employee['代表フラグ'])
  };
}

// action: login
// params: { employeeId, password }
function login(params) {
  requireFields(params, ['employeeId', 'password']);
  const employeeId = String(params.employeeId).trim();

  // 総当たり対策: ロック中は資格情報を照合する前に弾く
  assertLoginNotLocked(employeeId);

  const employee = findEmployeeById(employeeId);
  // 存在しない社員番号と、無効化された社員は同じエラーメッセージにして
  // 在籍者かどうかの推測を許さない
  if (!employee || !toBool(employee['有効フラグ'])) {
    recordLoginFailure(employeeId);
    throw new ApiError('INVALID_CREDENTIALS', '社員番号またはパスワードが正しくありません');
  }

  const storedPassword = String(employee['パスワード']);
  if (storedPassword !== String(params.password)) {
    recordLoginFailure(employeeId);
    throw new ApiError('INVALID_CREDENTIALS', '社員番号またはパスワードが正しくありません');
  }

  clearLoginFailures(employeeId);

  const token = issueToken(employee['社員番号'], TOKEN_TTL_MINUTES);
  return {
    success: true,
    token: token,
    expiresInMinutes: TOKEN_TTL_MINUTES,
    employee: toPublicEmployee(employee)
  };
}

// トークンを検証し、対応する在籍中の社員レコードを返す。
// マスタ取得・評価送信の各APIはこの関数を先頭で呼ぶ。
function authenticate(token) {
  const employeeId = verifyToken(token);
  const employee = findEmployeeById(employeeId);
  if (!employee || !toBool(employee['有効フラグ'])) {
    throw new ApiError('AUTH_ERROR', '認証情報が無効です。再度ログインしてください');
  }
  return employee;
}
