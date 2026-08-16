// マスタ取得（事業所マスタ・評価期間マスタ・対象者一覧）まわりの処理

function findOfficeByName(officeName) {
  const { rows } = readSheetAsObjects(SHEET_NAMES.OFFICE);
  const target = String(officeName).trim();
  return rows.find(function (r) { return String(r['事業所名']).trim() === target; }) || null;
}

function buildEvaluationItems(office) {
  return {
    section1: {
      title: office['大項目1名'],
      items: [1, 2, 3, 4, 5].map(function (i) { return office['小項目1-' + i]; })
    },
    section2: {
      title: office['大項目2名'],
      items: [1, 2, 3, 4, 5].map(function (i) { return office['小項目2-' + i]; })
    },
    freeText1Label: office['自由記述1ラベル'],
    freeText2Label: office['自由記述2ラベル']
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

// F-02: 自分と同じ事業所の社員 + 代表フラグ=TRUEの社員（事業所問わず）。自分自身は除く。
function listTargets(currentEmployee) {
  const { rows } = readSheetAsObjects(SHEET_NAMES.EMPLOYEE);
  const office = String(currentEmployee['事業所']).trim();
  const selfId = String(currentEmployee['社員番号']).trim();

  return rows
    .filter(function (r) { return toBool(r['有効フラグ']); })
    .filter(function (r) { return String(r['社員番号']).trim() !== selfId; })
    .filter(function (r) {
      return String(r['事業所']).trim() === office || toBool(r['代表フラグ']);
    })
    .map(function (r) {
      return {
        employeeId: String(r['社員番号']).trim(),
        name: r['氏名'],
        office: r['事業所'],
        isRepresentative: toBool(r['代表フラグ'])
      };
    });
}

// action: getMaster
// params: { token }
function getMaster(params) {
  requireFields(params, ['token']);
  const employee = authenticate(params.token);

  const office = findOfficeByName(employee['事業所']);
  if (!office) {
    throw new ApiError(
      'DATA_ERROR',
      '事業所マスタに一致するデータが見つかりません: ' + employee['事業所']
    );
  }

  return {
    success: true,
    employee: toPublicEmployee(employee),
    evaluationItems: buildEvaluationItems(office),
    periods: listPeriods(),
    targets: listTargets(employee)
  };
}
