// シート名・列名・固定値の定義（データ定義書 v1.0 準拠）

const SHEET_NAMES = {
  EMPLOYEE: '社員マスタ',
  OFFICE: '事業所マスタ',
  PERIOD: '評価期間マスタ',
  LOG: '評価結果ログ'
};

const EVALUATION_TYPES = {
  NORMAL: '通常',
  REPRESENTATIVE: '代表'
};

const PERIOD_STATUS = {
  PREPARING: '準備中',
  OPEN: '実施中',
  CLOSED: '終了'
};

// ログイントークンの有効期限（分）
const TOKEN_TTL_MINUTES = 480; // 8時間
