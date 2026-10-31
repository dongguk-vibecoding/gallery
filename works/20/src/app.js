(function () {
  const { analyze, DEFAULT_CONFIG } = window.AttendanceRules;
  const { calcPay } = window.AttendancePay;
  const { readRows, readWageRows } = window.AttendanceIO;

  const state = { fileName: '', rows: null, result: null, wageName: '', wageRows: null, pay: null, reached: 1 };
  const $ = (id) => document.getElementById(id);

  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) n.setAttribute(k === 'class' ? 'class' : k, v);
    for (const kid of kids) n.append(kid);
    return n;
  };

  const hm = (min) => Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0');
  const dec = (min) => Math.round((min / 60) * 100) / 100;
  const won = (n) => (n == null ? '-' : n.toLocaleString('ko-KR'));

  const STATUS_TEXT = { ok: '', no_wage: '급여 기준 없음', bad_wage: '임금 읽기 실패' };
  const statusOf = (p) => (p.status !== 'ok' ? STATUS_TEXT[p.status] : p.attendanceError ? '근태 오류 있음 – 확정 불가' : '');

  // ---- 단계 이동 ----
  const LAST = 5;
  function go(step) {
    if (step > state.reached) return;
    for (let i = 1; i <= LAST; i++) $('step' + i).hidden = i !== step;
    document.querySelectorAll('#stepper li').forEach((li) => {
      const n = +li.dataset.step;
      const b = li.querySelector('button');
      li.classList.toggle('current', n === step);
      li.classList.toggle('done', n !== step && n <= state.reached);
      b.disabled = n > state.reached;
      if (n === step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    if (step === 3) renderCheck();
    if (step === 4) renderSummary();
    if (step === 5) renderExport();
    window.scrollTo({ top: 0 });
  }
  const reach = (step) => { state.reached = Math.max(state.reached, step); go(step); };

  document.querySelectorAll('#stepper li').forEach((li) => {
    li.querySelector('button').addEventListener('click', () => go(+li.dataset.step));
  });
  document.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => {
      const to = +b.dataset.go;
      if (b.id === 'restart') resetAll();
      if (to > state.reached) reach(to); else go(to);
    });
  });

  function resetAll() {
    Object.assign(state, { fileName: '', rows: null, result: null, wageName: '', wageRows: null, pay: null, reached: 1 });
    $('file').value = '';
    $('wfile').value = '';
    msg('fileMsg', '');
    msg('wfileMsg', '');
    $('toCheck').disabled = true;
  }

  function msg(id, text, isErr) {
    const m = $(id);
    m.textContent = text;
    m.className = 'msg' + (isErr ? ' err' : '');
  }

  // 근태 결과와 급여 결과를 다시 만든다 (공휴일을 바꾸거나 파일을 올렸을 때)
  function recompute() {
    if (!state.rows) return;
    state.result = analyze(state.rows, config());
    state.pay = state.wageRows ? calcPay(state.result.employees, state.wageRows) : null;
  }

  // ---- 파일 읽기 공통 ----
  function loadFile(file, reader, onDone, msgId) {
    if (!file) return;
    const fr = new FileReader();
    fr.onerror = () => msg(msgId, '파일을 읽는 중 문제가 생겼습니다. 다시 시도해 주세요.', true);
    fr.onload = () => {
      const isCsv = /\.csv$/i.test(file.name);
      const read = isCsv
        ? reader(window.XLSX, new TextDecoder('utf-8').decode(fr.result).replace(/^﻿/, ''), 'string')
        : reader(window.XLSX, fr.result, 'array');
      if (read.error) return msg(msgId, read.error, true);
      if (!read.rows.length) return msg(msgId, '데이터 행이 없습니다.', true);
      onDone(read.rows, file.name);
    };
    fr.readAsArrayBuffer(file);
  }

  function dropZone(zoneId, inputId, handler) {
    const zone = $(zoneId);
    $(inputId).addEventListener('change', (e) => handler(e.target.files[0]));
    ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => handler(e.dataTransfer.files[0]));
  }

  // ---- 1단계: 근태 업로드 ----
  $('holidays').value = DEFAULT_CONFIG.holidays.join('\n');
  const config = () => ({ holidays: $('holidays').value.split(/\s+/).map((s) => s.trim()).filter(Boolean) });

  dropZone('drop', 'file', (file) =>
    loadFile(file, readRows, (rows, name) => {
      state.fileName = name;
      state.rows = rows;
      recompute();
      msg('fileMsg', name + ' — ' + rows.length + '행을 읽었습니다.');
      reach(2);
    }, 'fileMsg'));

  $('holidays').addEventListener('change', recompute);

  // ---- 2단계: 급여 기준 ----
  dropZone('wdrop', 'wfile', (file) =>
    loadFile(file, readWageRows, (rows, name) => {
      state.wageName = name;
      state.wageRows = rows;
      recompute();
      msg('wfileMsg', name + ' — ' + rows.length + '행을 읽었습니다.');
      $('toCheck').disabled = false;
    }, 'wfileMsg'));

  $('toCheck').addEventListener('click', () => reach(3));
  $('skipWage').addEventListener('click', () => {
    state.wageRows = null;
    state.wageName = '';
    $('wfile').value = '';
    msg('wfileMsg', '');
    recompute();
    reach(3);
  });

  // ---- 데모: 파일 대신 코드에 넣어 둔 예시 데이터 ----
  const SAMPLE = window.DemoSample;
  $('demoAtt').addEventListener('click', () => {
    state.fileName = SAMPLE.attendance.name;
    state.rows = SAMPLE.attendance.rows();
    recompute();
    msg('fileMsg', '예시 근태 데이터 ' + state.rows.length + '행을 불러왔습니다.');
    reach(2);
  });
  $('demoWage').addEventListener('click', () => {
    state.wageName = SAMPLE.wage.name;
    state.wageRows = SAMPLE.wage.rows();
    recompute();
    msg('wfileMsg', '예시 급여 기준 ' + state.wageRows.length + '행을 불러왔습니다.');
    $('toCheck').disabled = false;
  });
  // 관람객이 바꾼 것(올린 파일, 공휴일, 필터, 보기 방식)을 모두 처음 상태로 되돌린다
  $('demoReset').addEventListener('click', () => {
    resetAll();
    $('holidays').value = DEFAULT_CONFIG.holidays.join('\n');
    $('fGroup').value = '';
    $('fText').value = '';
    $('graphView').hidden = false;
    $('tableView').hidden = true;
    $('vGraph').setAttribute('aria-pressed', 'true');
    $('vTable').setAttribute('aria-pressed', 'false');
    go(1);
    msg('fileMsg', '처음 상태로 되돌렸습니다. "예시 데이터로 시작"을 눌러 다시 체험해 보세요.');
  });

  // ---- 3단계: 검증 ----
  const card = (value, label, cls) =>
    el('div', { class: 'card' + (cls ? ' ' + cls : '') }, el('b', {}, String(value)), el('span', {}, label));

  function errTable(headers, rows) {
    return el('div', { class: 'tablewrap' },
      el('table', {},
        el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', h.r ? { class: 'r' } : {}, h.t)))),
        el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c, i) => el('td', headers[i].r ? { class: 'r' } : {}, String(c))))))));
  }

  function renderCheck() {
    const r = state.result;
    const cards = [
      card(r.stats.totalRows, '읽은 행'),
      card(r.stats.validRows, '정상 행', 'good'),
      card(r.stats.errorRows, '오류 행 (계산 제외)', r.stats.errorRows ? 'bad' : 'good'),
      card(r.period ? r.period.from + ' ~ ' + r.period.to : '-', '파일의 날짜 범위'),
    ];
    if (state.pay) {
      const bad = state.pay.issues.length;
      cards.push(card(bad, '급여 기준 문제', bad ? 'bad' : 'good'));
    }
    $('checkStats').replaceChildren(...cards);

    const warn = $('checkWarn');
    warn.replaceChildren();
    if (r.warnings.length) {
      const ul = el('ul');
      r.warnings.forEach((w) => ul.append(el('li', {}, w.message)));
      warn.append(el('div', { class: 'notice warn' }, el('b', {}, '확인해 주세요'), ul));
    }

    const box = $('checkErr');
    box.replaceChildren();
    if (!r.errors.length) {
      box.append(el('p', {}, '근태 오류 행이 없습니다. 모든 기록이 계산에 들어갑니다.'));
    } else {
      box.append(
        el('h3', {}, '근태 오류 행'),
        el('p', {}, '아래 행은 추측해서 채우지 않고 계산에서 뺐습니다. 원본 파일을 고쳐서 다시 올리면 반영됩니다. (엑셀 행 번호는 제목 행을 1로 센 번호입니다.)'),
        errTable([{ t: '엑셀 행', r: 1 }, { t: '사번' }, { t: '이름' }, { t: '날짜' }, { t: '사유' }],
          r.errors.map((e) => [e.rowNo, e.empNo, e.name, e.date, e.message]))
      );
    }

    const wbox = $('checkWage');
    wbox.replaceChildren();
    if (!state.pay) {
      wbox.append(el('p', { class: 'hint' }, '급여 기준 파일을 올리지 않았습니다. 시간만 집계합니다.'));
      return;
    }
    if (!state.pay.issues.length) {
      wbox.append(el('p', {}, '급여 기준 파일에 문제가 없습니다.'));
    } else {
      wbox.append(
        el('h3', {}, '급여 기준 문제'),
        el('p', {}, '"급여 기준 없음"과 "임금 읽기 실패" 직원은 수당을 계산하지 못합니다. 근태 파일에 없는 사번은 계산에 쓰이지 않습니다.'),
        errTable([{ t: '엑셀 행', r: 1 }, { t: '사번' }, { t: '이름' }, { t: '사유' }],
          state.pay.issues.map((i) => [i.rowNo == null ? '-' : i.rowNo, i.empNo, i.name, i.message]))
      );
    }
  }

  // ---- 4단계: 결과 ----
  function renderSummary() {
    const r = state.result;
    const groups = [...new Set(r.employees.map((e) => e.group).filter(Boolean))];
    const sel = $('fGroup');
    const keep = sel.value;
    sel.replaceChildren(el('option', { value: '' }, '전체'), ...groups.map((g) => el('option', { value: g }, g)));
    sel.value = groups.includes(keep) ? keep : '';

    const cols = ['사번', '이름', '직군', '사업장', '근무일', '총 근무', '연장', '야간', '휴일', '휴일 중 8시간 초과', '오류 행'];
    const numFrom = 4;
    if (state.pay) cols.push('통상시급', '연장수당', '야간수당', '휴일수당', '수당 합계', '상태');
    $('summary').querySelector('thead').replaceChildren(
      el('tr', {}, ...cols.map((c, i) => el('th', i >= numFrom && c !== '상태' ? { class: 'r' } : {}, c)))
    );

    const note = $('payNote');
    note.replaceChildren();
    if (state.pay) {
      const flagged = state.pay.rows.filter((p) => statusOf(p)).length;
      if (flagged) {
        note.append(el('div', { class: 'notice warn' }, '상태 열에 표시가 있는 직원 ' + flagged + '명은 금액을 그대로 지급하면 안 됩니다. 원본을 고쳐서 다시 올려 주세요.'));
      }
    }
    drawRows();
  }

  function drawRows() {
    const g = $('fGroup').value;
    const q = $('fText').value.trim();
    const payBy = new Map((state.pay ? state.pay.rows : []).map((p) => [p.empNo, p]));
    const list = state.result.employees.filter((e) => (!g || e.group === g) && (!q || e.name.includes(q) || e.empNo.includes(q)));
    const td = (text, cls, title) => {
      const p = {};
      if (cls) p.class = cls;
      if (title) p.title = title;
      return el('td', p, text);
    };

    $('summary').querySelector('tbody').replaceChildren(
      ...list.map((e) => {
        const cells = [
          td(e.empNo), td(e.name), td(e.group), td(e.site),
          td(String(e.workDays), 'r'),
          td(hm(e.totalMin), 'r', dec(e.totalMin) + '시간'),
          td(hm(e.otMin), 'r', dec(e.otMin) + '시간'),
          td(hm(e.nightMin), 'r', dec(e.nightMin) + '시간'),
          td(hm(e.holMin), 'r', dec(e.holMin) + '시간'),
          td(hm(e.holOverMin), 'r', dec(e.holOverMin) + '시간'),
          td(e.errorRows ? String(e.errorRows) : '-', 'r' + (e.errorRows ? ' errcell' : '')),
        ];
        if (state.pay) {
          const p = payBy.get(e.empNo);
          const st = statusOf(p);
          cells.push(
            td(won(p.hourly), 'r'), td(won(p.otPay), 'r'), td(won(p.nightPay), 'r'), td(won(p.holPay), 'r'),
            td(won(p.total), 'r total'), td(st, st ? 'errcell' : '')
          );
        }
        return el('tr', {}, ...cells);
      })
    );

    const sum = (f) => list.reduce((a, e) => a + e[f], 0);
    const psum = (f) => list.reduce((a, e) => a + ((payBy.get(e.empNo) || {})[f] || 0), 0);
    const foot = [
      el('td', { colspan: '4' }, '합계 ' + list.length + '명'),
      td(String(sum('workDays')), 'r'), td(hm(sum('totalMin')), 'r'), td(hm(sum('otMin')), 'r'),
      td(hm(sum('nightMin')), 'r'), td(hm(sum('holMin')), 'r'), td(hm(sum('holOverMin')), 'r'), td(String(sum('errorRows')), 'r'),
    ];
    if (state.pay) foot.push(td(''), td(won(psum('otPay')), 'r'), td(won(psum('nightPay')), 'r'), td(won(psum('holPay')), 'r'), td(won(psum('total')), 'r total'), td(''));
    $('summary').querySelector('tfoot').replaceChildren(el('tr', {}, ...foot));
    drawGraphs(list, payBy);
  }

  function drawGraphs(list, payBy) {
    const view = $('graphView');
    if (view.hidden || !state.result) return;
    const ids = new Set(list.map((e) => e.empNo));
    window.AttendanceCharts.render(view, {
      employees: list,
      days: state.result.days.filter((d) => ids.has(d.empNo)),
      pay: state.pay ? payBy : null,
      period: state.result.period,
      rules: window.AttendanceRules,
      isHoliday: state.result.isHoliday,
    });
  }

  function setView(graph) {
    $('graphView').hidden = !graph;
    $('tableView').hidden = graph;
    $('vGraph').setAttribute('aria-pressed', String(graph));
    $('vTable').setAttribute('aria-pressed', String(!graph));
    drawRows();
  }
  $('vGraph').addEventListener('click', () => setView(true));
  $('vTable').addEventListener('click', () => setView(false));

  // 창 크기가 바뀌면 그래프를 다시 그린다
  let resizeTimer = null;
  let lastWidth = 0;
  new ResizeObserver(() => {
    const w = $('graphView').clientWidth;
    if (!w || w === lastWidth) return;
    lastWidth = w;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.result && !$('step4').hidden) drawRows(); }, 120);
  }).observe($('graphView'));

  $('fGroup').addEventListener('change', drawRows);
  $('fText').addEventListener('input', drawRows);

  // ---- 5단계: 내보내기 ----
  const RULE_TEXT = [
    '휴게시간: 총 체류 4시간 이상 30분, 8시간 이상 60분을 근무 시간대의 한가운데에서 쉰 것으로 보고 뺍니다.',
    '연장: 하루 8시간을 넘은 부분과, 하루 8시간 이내 근로의 합이 주 40시간을 넘은 부분을 더합니다(겹쳐 세지 않음).',
    '야간: 22:00~06:00에 일한 시간. 연장·휴일과 겹쳐도 따로 셉니다.',
    '휴일: 일요일과 공휴일 목록의 날짜. 달력상 그 날짜에 속한 시간만 휴일이고, 휴일근로는 연장 계산에서 뺍니다.',
    '휴일 중 8시간 초과: 한 번의 근무 안에서 휴일근로가 8시간을 넘은 부분.',
    '주는 월요일~일요일입니다. 파일에 일부만 들어 있는 주는 경고로 표시합니다.',
    '통상시급 = 월 통상임금 / 209 (월급제만). 시급을 먼저 자르지 않고 분수 그대로 곱합니다.',
    '연장수당 = 연장시간 x 통상시급 x 150%, 야간수당 = 야간시간 x 통상시급 x 50%(연장·휴일과 겹치면 각각에 더해짐).',
    '휴일수당 = (휴일 8시간 이내 x 150% + 8시간 초과 x 200%) x 통상시급. 항목마다 원 미만 절사, 수당 합계는 세 항목의 합.',
    '기본급 지급, 4대보험·소득세 공제는 계산하지 않습니다.',
  ];

  function renderExport() {
    const r = state.result;
    const info = [
      el('p', {}, '근태 파일: ' + state.fileName),
      el('p', {}, '직원 ' + r.employees.length + '명 · 정상 ' + r.stats.validRows + '행 · 오류 ' + r.stats.errorRows + '행(제외)'),
    ];
    if (state.pay) {
      info.push(el('p', {}, '급여 기준 파일: ' + state.wageName));
      info.push(el('p', {}, '엑셀에는 시트 4개가 들어갑니다: 월간요약(시간·수당), 근태오류, 급여기준문제, 적용규칙. 시간은 소수 시간(1시간 30분 = 1.5)입니다.'));
      info.push(el('p', { class: 'privacy' }, '내려받는 파일에는 임금 정보가 들어 있습니다. 보관과 공유는 담당자가 책임져 주세요.'));
    } else {
      info.push(el('p', {}, '엑셀에는 시트 3개가 들어갑니다: 월간요약(시간), 근태오류, 적용규칙. 시간은 소수 시간(1시간 30분 = 1.5)입니다.'));
    }
    $('exportInfo').replaceChildren(...info);
    $('rules').replaceChildren(...RULE_TEXT.map((t) => el('li', {}, t)));
    msg('exportMsg', '');
  }

  $('download').addEventListener('click', () => {
    const r = state.result;
    const X = window.XLSX;
    const wb = X.utils.book_new();
    const payBy = new Map((state.pay ? state.pay.rows : []).map((p) => [p.empNo, p]));

    const head = ['사번', '이름', '직군', '사업장', '근무일수', '총근무(시간)', '연장(시간)', '야간(시간)', '휴일(시간)', '휴일 중 8시간 초과(시간)', '오류 행 수'];
    const widths = [10, 8, 6, 11, 9, 12, 11, 11, 11, 22, 10];
    if (state.pay) {
      head.push('월 통상임금', '통상시급(참고)', '연장수당', '야간수당', '휴일수당', '수당 합계', '상태');
      widths.push(13, 13, 12, 12, 12, 13, 26);
    }
    const body = r.employees.map((e) => {
      const row = [e.empNo, e.name, e.group, e.site, e.workDays, dec(e.totalMin), dec(e.otMin), dec(e.nightMin), dec(e.holMin), dec(e.holOverMin), e.errorRows];
      if (state.pay) {
        const p = payBy.get(e.empNo);
        row.push(p.wage == null ? '' : p.wage, p.hourly == null ? '' : p.hourly, p.otPay == null ? '' : p.otPay, p.nightPay == null ? '' : p.nightPay, p.holPay == null ? '' : p.holPay, p.total == null ? '' : p.total, statusOf(p));
      }
      return row;
    });
    const s1 = X.utils.aoa_to_sheet([head, ...body]);
    s1['!cols'] = widths.map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, s1, '월간요약');

    const s2 = X.utils.aoa_to_sheet([['엑셀 행', '사번', '이름', '날짜', '사유'], ...r.errors.map((e) => [e.rowNo, e.empNo, e.name, e.date, e.message])]);
    s2['!cols'] = [8, 10, 8, 12, 50].map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, s2, '근태오류');

    if (state.pay) {
      const s3 = X.utils.aoa_to_sheet([['엑셀 행', '사번', '이름', '사유'], ...state.pay.issues.map((i) => [i.rowNo == null ? '' : i.rowNo, i.empNo, i.name, i.message])]);
      s3['!cols'] = [8, 10, 10, 60].map((w) => ({ wch: w }));
      X.utils.book_append_sheet(wb, s3, '급여기준문제');
    }

    const rules = [
      ['근태 파일', state.fileName],
      ...(state.pay ? [['급여 기준 파일', state.wageName]] : []),
      ['날짜 범위', r.period ? r.period.from + ' ~ ' + r.period.to : ''],
      ...r.warnings.map((w) => ['경고', w.message]),
      ...RULE_TEXT.map((t) => ['규칙', t]),
    ];
    const s4 = X.utils.aoa_to_sheet(rules);
    s4['!cols'] = [{ wch: 14 }, { wch: 110 }];
    X.utils.book_append_sheet(wb, s4, '적용규칙');

    const base = (state.fileName || '근태').replace(/\.[^.]+$/, '');
    try {
      X.writeFile(wb, base + '_집계.xlsx');
      msg('exportMsg', base + '_집계.xlsx 파일을 내려받았습니다.');
    } catch (e) {
      msg('exportMsg', '내려받기에 실패했습니다: ' + e.message, true);
    }
  });

  go(1);
})();
