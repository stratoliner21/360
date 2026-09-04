// シート名・列名・固定値の定義（データ定義書 v1.1 / 要件定義書 v1.6 準拠）

const SHEET_NAMES = {
  EMPLOYEE: '社員マスタ',
  DEPARTMENT: '部門マスタ', // 部門ごとの評価基準デフォルト
  UNIT: '部署マスタ',       // 部署ごとの評価基準上書き(空欄は部門マスタを継承)
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

// F-01 / 要件定義書 7.1: 社員番号の総当たり対策としてのログイン試行回数制限
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 15;
const LOGIN_ATTEMPT_WINDOW_MINUTES = 30;
