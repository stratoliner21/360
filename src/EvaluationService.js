// 評価送信（評価結果ログへの書き込み）まわりの処理

function findPeriodById(periodId) {
  const { rows } = readSheetAsObjects(SHEET_NAMES.PERIOD);
  const target = String(periodId).trim();
  return rows.find(function (r) { return String(r['期間ID']).trim() === target; }) || null;
}

function validateScores(scores, fieldName) {
  if (!Array.isArray(scores) || scores.length !== 5) {
    throw new ApiError('VALIDATION_ERROR', fieldName + ' は5つの数値の配列で指定してください');
  }
  scores.forEach(function (s) {
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      throw new ApiError('VALIDATION_ERROR', fieldName + ' は1〜5の整数で指定してください');
    }
  });
}

function findExistingLog(evaluatorId, evaluateeId, periodId) {
  const { rows } = readSheetAsObjects(SHEET_NAMES.LOG);
  return rows.find(function (r) {
    return (
      String(r['評価者社員番号']).trim() === evaluatorId &&
      String(r['被評価者社員番号']).trim() === evaluateeId &&
      String(r['期間ID']).trim() === periodId
    );
  }) || null;
}

// action: submitEvaluation
// params: {
//   token, evaluateeId, periodId, evaluationType('通常'|'代表'),
//   scores1[5], scores2[5] (通常のみ必須),
//   freeText1, freeText2 (通常のみ), overwrite(true で二重送信時に上書き)
// }
function submit(params) {
  requireFields(params, ['token', 'evaluateeId', 'periodId', 'evaluationType']);
  const evaluator = authenticate(params.token);
  const evaluatorId = String(evaluator['社員番号']).trim();
  const evaluateeId = String(params.evaluateeId).trim();
  const periodId = String(params.periodId).trim();
  const evaluationType = params.evaluationType;

  if (evaluationType !== EVALUATION_TYPES.NORMAL && evaluationType !== EVALUATION_TYPES.REPRESENTATIVE) {
    throw new ApiError('VALIDATION_ERROR', '評価種別は「通常」または「代表」を指定してください');
  }
  if (evaluatorId === evaluateeId) {
    throw new ApiError('VALIDATION_ERROR', '自分自身を評価することはできません');
  }

  const period = findPeriodById(periodId);
  if (!period) {
    throw new ApiError('VALIDATION_ERROR', '指定された評価期間が見つかりません');
  }
  if (!getPeriodStatus(period).isOpen) {
    throw new ApiError('PERIOD_CLOSED', 'この評価期間は現在受付中ではありません');
  }

  const evaluatee = findEmployeeById(evaluateeId);
  if (!evaluatee || !toBool(evaluatee['有効フラグ'])) {
    throw new ApiError('VALIDATION_ERROR', '指定された被評価者が見つかりません');
  }

  if (evaluationType === EVALUATION_TYPES.REPRESENTATIVE) {
    if (!toBool(evaluatee['代表フラグ'])) {
      throw new ApiError('VALIDATION_ERROR', '代表向け評価は代表者に対してのみ送信できます');
    }
  } else {
    const sameOffice = String(evaluatee['事業所']).trim() === String(evaluator['事業所']).trim();
    if (!sameOffice && !toBool(evaluatee['代表フラグ'])) {
      throw new ApiError('VALIDATION_ERROR', '同じ事業所の社員、または代表者のみ評価できます');
    }
  }

  let scores1 = [];
  let scores2 = [];
  let freeText1 = params.freeText1 || '';
  let freeText2 = params.freeText2 || '';

  if (evaluationType === EVALUATION_TYPES.NORMAL) {
    validateScores(params.scores1, '小項目1-1〜1-5スコア');
    validateScores(params.scores2, '小項目2-1〜2-5スコア');
    scores1 = params.scores1;
    scores2 = params.scores2;
  } else {
    freeText2 = ''; // 代表向け簡易評価では自由記述2は使用しない
  }

  // 二重送信防止のチェックと書き込みを排他制御する
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existing = findExistingLog(evaluatorId, evaluateeId, periodId);
    if (existing && !params.overwrite) {
      throw new ApiError(
        'DUPLICATE_SUBMISSION',
        'この期間・被評価者への評価は送信済みです。上書きする場合は overwrite:true を指定して再送信してください'
      );
    }

    const now = new Date();
    const rowObject = {
      'ログID': existing ? existing['ログID'] : Utilities.getUuid(),
      '評価者社員番号': evaluatorId,
      '被評価者社員番号': evaluateeId,
      '期間ID': periodId,
      '評価種別': evaluationType,
      '自由記述1': freeText1,
      '自由記述2': freeText2,
      '送信日時': now
    };
    [1, 2, 3, 4, 5].forEach(function (i) {
      rowObject['小項目1-' + i + 'スコア'] = scores1[i - 1] !== undefined ? scores1[i - 1] : '';
      rowObject['小項目2-' + i + 'スコア'] = scores2[i - 1] !== undefined ? scores2[i - 1] : '';
    });

    if (existing) {
      updateRowByHeader(SHEET_NAMES.LOG, existing.__row, rowObject);
    } else {
      appendRowByHeader(SHEET_NAMES.LOG, rowObject);
    }

    return {
      success: true,
      logId: rowObject['ログID'],
      submittedAt: now.toISOString(),
      overwritten: !!existing
    };
  } finally {
    lock.releaseLock();
  }
}
