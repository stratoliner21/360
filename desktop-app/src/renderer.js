(function () {
  const state = {
    token: null,
    employee: null,
    master: null,
    currentTarget: null
  };

  const screens = {
    login: document.getElementById('screen-login'),
    targets: document.getElementById('screen-targets'),
    form: document.getElementById('screen-form')
  };

  function showScreen(name) {
    Object.keys(screens).forEach((key) => {
      screens[key].hidden = key !== name;
    });
  }

  function setText(el, text) {
    el.textContent = text === undefined || text === null ? '' : String(text);
  }

  function showError(el, message) {
    setText(el, message);
    el.hidden = !message;
  }

  // ---- ログイン ----
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(loginError, '');
    const employeeId = document.getElementById('login-employeeId').value.trim();
    const password = document.getElementById('login-password').value;

    const res = await window.api.call('login', { employeeId, password });
    if (!res.success) {
      showError(loginError, res.error.message || 'ログインに失敗しました');
      return;
    }
    state.token = res.token;
    state.employee = res.employee;
    document.getElementById('login-password').value = '';
    await loadMaster();
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    state.token = null;
    state.employee = null;
    state.master = null;
    state.currentTarget = null;
    showScreen('login');
  });

  document.getElementById('back-btn').addEventListener('click', () => {
    state.currentTarget = null;
    showScreen('targets');
  });

  // ---- マスタ取得・対象者一覧 ----
  async function loadMaster() {
    const res = await window.api.call('getMaster', { token: state.token });
    if (!res.success) {
      showError(loginError, res.error.message || 'マスタ情報の取得に失敗しました');
      showScreen('login');
      return;
    }
    state.master = res;
    renderTargetsScreen();
    showScreen('targets');
  }

  function renderTargetsScreen() {
    const m = state.master;
    setText(document.getElementById('me-name'), m.employee.name);
    setText(document.getElementById('me-unit'), m.employee.unit);

    const banner = document.getElementById('period-banner');
    const activePeriod = m.periods.find((p) => p.periodId === m.activePeriodId);
    banner.classList.remove('closed');
    if (activePeriod) {
      setText(banner, activePeriod.periodName + '(受付終了: ' + activePeriod.endDate + ')');
    } else {
      banner.classList.add('closed');
      setText(banner, '現在受付中の評価期間はありません');
    }

    const list = document.getElementById('target-list');
    list.innerHTML = '';
    m.targets.forEach((target) => {
      const li = document.createElement('li');
      li.className = 'target-item';

      const left = document.createElement('div');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'target-name';
      setText(nameSpan, target.name);
      const unitSpan = document.createElement('span');
      unitSpan.className = 'target-unit';
      setText(unitSpan, target.isRepresentative ? '代表' : target.unit);
      left.appendChild(nameSpan);
      left.appendChild(unitSpan);

      const right = document.createElement('div');
      const done = m.evaluatedTargetIds.indexOf(target.employeeId) !== -1;
      const badge = document.createElement('span');
      badge.className = 'badge ' + (done ? 'done' : 'pending');
      setText(badge, done ? '評価済み' : '未評価');
      right.appendChild(badge);

      const btn = document.createElement('button');
      setText(btn, done ? '再評価する' : '評価する');
      btn.disabled = !activePeriod;
      btn.addEventListener('click', () => openEvalForm(target));
      right.appendChild(btn);

      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);
    });
  }

  // ---- 評価入力フォーム ----
  function buildScoreQuestion(name, text) {
    const wrap = document.createElement('div');
    wrap.className = 'question-block';

    const label = document.createElement('span');
    label.className = 'question-text';
    setText(label, text);
    wrap.appendChild(label);

    const options = document.createElement('div');
    options.className = 'score-options';
    for (let v = 1; v <= 5; v++) {
      const optLabel = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = String(v);
      input.required = true;
      optLabel.appendChild(input);
      optLabel.appendChild(document.createTextNode(String(v)));
      options.appendChild(optLabel);
    }
    wrap.appendChild(options);
    return wrap;
  }

  function buildTextArea(name, labelText) {
    const wrap = document.createElement('div');
    wrap.className = 'question-block';
    const label = document.createElement('label');
    setText(label, labelText);
    const textarea = document.createElement('textarea');
    textarea.name = name;
    label.appendChild(textarea);
    wrap.appendChild(label);
    return wrap;
  }

  function openEvalForm(target) {
    state.currentTarget = target;
    const container = document.getElementById('form-sections');
    container.innerHTML = '';
    setText(
      document.getElementById('form-title'),
      target.name + ' さんへの' + (target.isRepresentative ? '代表向け簡易評価' : '評価') + '入力'
    );

    if (target.isRepresentative) {
      const block = document.createElement('div');
      block.className = 'section-block';
      block.appendChild(buildTextArea('freeText1', '良いところを教えてください'));
      container.appendChild(block);
    } else {
      const items = state.master.evaluationItems;
      [items.section1, items.section2].forEach((section, sIdx) => {
        const block = document.createElement('div');
        block.className = 'section-block';
        const h3 = document.createElement('h3');
        setText(h3, section.title);
        block.appendChild(h3);
        section.items.forEach((qText, i) => {
          block.appendChild(buildScoreQuestion('score' + (sIdx + 1) + '_' + (i + 1), qText));
        });
        container.appendChild(block);
      });
      const freeBlock = document.createElement('div');
      freeBlock.className = 'section-block';
      freeBlock.appendChild(buildTextArea('freeText1', items.freeText1Label));
      freeBlock.appendChild(buildTextArea('freeText2', items.freeText2Label));
      container.appendChild(freeBlock);
    }

    showError(document.getElementById('form-error'), '');
    showScreen('form');
  }

  function readScores(form, sectionIdx) {
    const scores = [];
    for (let i = 1; i <= 5; i++) {
      const checked = form.querySelector('input[name="score' + sectionIdx + '_' + i + '"]:checked');
      scores.push(checked ? Number(checked.value) : null);
    }
    return scores;
  }

  // ---- 送信 ----
  const evalForm = document.getElementById('eval-form');
  evalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formError = document.getElementById('form-error');
    showError(formError, '');

    const target = state.currentTarget;
    const activePeriodId = state.master.activePeriodId;
    if (!activePeriodId) {
      showError(formError, '現在受付中の評価期間がありません');
      return;
    }

    const payload = {
      token: state.token,
      evaluateeId: target.employeeId,
      periodId: activePeriodId,
      evaluationType: target.isRepresentative ? '代表' : '通常',
      freeText1: evalForm.querySelector('textarea[name="freeText1"]').value
    };

    if (!target.isRepresentative) {
      payload.scores1 = readScores(evalForm, 1);
      payload.scores2 = readScores(evalForm, 2);
      payload.freeText2 = evalForm.querySelector('textarea[name="freeText2"]').value;
    }

    let res = await window.api.call('submitEvaluation', payload);

    if (!res.success && res.error && res.error.code === 'DUPLICATE_SUBMISSION') {
      const overwrite = window.confirm('この対象者へは送信済みです。内容を上書きして再送信しますか？');
      if (overwrite) {
        res = await window.api.call('submitEvaluation', Object.assign({}, payload, { overwrite: true }));
      } else {
        return;
      }
    }

    if (!res.success) {
      showError(formError, res.error ? res.error.message : '送信に失敗しました');
      return;
    }

    await loadMaster();
  });

  showScreen('login');
})();
