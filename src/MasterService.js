// マスタ取得（部門マスタ・部署マスタ・評価期間マスタ・対象者一覧）まわりの処理
//
// 評価基準(大項目2×小項目5+自由記述2)は2階層で管理する。
// 部門マスタが部門ごとのデフォルトを持ち、部署マスタは同じ列を「上書き用」として持つ。
// 部署マスタ側のセルが空欄ならデフォルト(部門マスタ)の値を使う。

function findDepartmentByName(departmentName) {
  const { rows } = readSheetAsObjects(SHEET_NAMES.DEPARTMENT);
  const target = String(departmentName).trim();
  return rows.find(function (r) { return String(r['部門名']).trim() === target; }) || null;
}

function findUnitByName(unitName) {
  const { rows } = readSheetAsObjects(SHEET_NAMES.UNIT);
  const target = String(unitName).trim();
  return rows.find(function (r) { return String(r['部署名']).trim() === target; }) || null;
}

// 部署マスタの値が空欄なら部門マスタのデフォルト値を使う
function resolveCriteriaField(unit, department, field) {
  const unitValue = unit ? unit[field] : '';
  if (unitValue !== undefined && unitValue !== null && String(unitValue).trim() !== '') {
    return unitValue;
  }
  return department[field];
}

function buildEvaluationItems(department, unit) {
  return {
    department: department['部門名'],
    unit: unit['部署名'],
    section1: {
      title: resolveCriteriaField(unit, department, '大項目1名'),
      items: [1, 2, 3, 4, 5].map(function (i) {
        return resolveCriteriaField(unit, department, '小項目1-' + i);
      })
    },
    section2: {
      title: resolveCriteriaField(unit, department, '大項目2名'),
      items: [1, 2, 3, 4, 5].map(function (i) {
        return resolveCriteriaField(unit, department, '小項目2-' + i);
      })
    },
    freeText1Label: resolveCriteriaField(unit, department, '自由記述1ラベル'),
    freeText2Label: resolveCriteriaField(unit, department, '自由記述2ラベル')
  };
}

// 実施ステータスが「実施中」かつ本日が受付開始日〜受付終了日の範囲内かを判定する
function getPeriodStatus(period) {
  const today = todayDateOnly();
  const start = dateOnly(period['受付開始日']);
  const end = dateOnly(period['受付終了日']);
  const withinRange = today >= start && today <= end;
  const isOpen = period['実施ステータス'] === PERIOD_STATUS.OPEN && withinRange;
  return { isOpen: isOpen };
}

function listPeriods() {
  const { rows } = readSheetAsObjects(SHEET_NAMES.PERIOD);
  return rows.map(function (p) {
    return {
      periodId: p['期間ID'],
      periodName: p['期間名'],
      startDate: formatDate(p['受付開始日']),
      endDate: formatDate(p['受付終了日']),
      status: p['実施ステータス'],
      isOpen: getPeriodStatus(p).isOpen
    };
  });
}

// F-02: 自分と同じ部署の社員 + 代表フラグ=TRUEの社員（部署問わず）。自分自身は除く。
function listTargets(currentEmployee) {
  const { rows } = readSheetAsObjects(SHEET_NAMES.EMPLOYEE);
  const unit = String(currentEmployee['部署']).trim();
  const selfId = String(currentEmployee['社員番号']).trim();

  return rows
    .filter(function (r) { return toBool(r['有効フラグ']); })
    .filter(function (r) { return String(r['社員番号']).trim() !== selfId; })
    .filter(function (r) {
      return String(r['部署']).trim() === unit || toBool(r['代表フラグ']);
    })
    .map(function (r) {
      return {
        employeeId: String(r['社員番号']).trim(),
        name: r['氏名'],
        unit: r['部署'],
        isRepresentative: toBool(r['代表フラグ'])
      };
    });
}

// action: getMaster
// params: { token }
function getMaster(params) {
  requireFields(params, ['token']);
  const employee = authenticate(params.token);

  const unit = findUnitByName(employee['部署']);
  if (!unit) {
    throw new ApiError('DATA_ERROR', '部署マスタに一致するデータが見つかりません: ' + employee['部署']);
  }
  const department = findDepartmentByName(unit['部門']);
  if (!department) {
    throw new ApiError(
      'DATA_ERROR',
      '部門マスタに一致するデータが見つかりません: ' + unit['部門'] + '（部署: ' + employee['部署'] + '）'
    );
  }

  return {
    success: true,
    employee: toPublicEmployee(employee),
    evaluationItems: buildEvaluationItems(department, unit),
    periods: listPeriods(),
    targets: listTargets(employee)
  };
}
