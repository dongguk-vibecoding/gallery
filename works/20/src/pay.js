/*
 * 수당 계산 (근태 연동 수당만. 기본급 지급과 공제는 하지 않는다)
 *
 *   통상시급 = 월 통상임금 / 209 (월급제만)
 *   연장수당 = 연장시간 x 통상시급 x 150%
 *   야간수당 = 야간시간 x 통상시급 x  50%   (연장·휴일과 겹치면 각각의 수당에 더해진다)
 *   휴일수당 = (휴일 8시간 이내 x 150% + 8시간 초과 x 200%) x 통상시급
 *
 * 금액은 시급을 먼저 자르지 않고 분수 그대로 곱한 뒤 항목마다 원 미만을 절사한다.
 * 수당 합계는 절사한 세 항목의 합이다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AttendancePay = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_PAY_CONFIG = {
    monthlyHours: 209,
    pct: { ot: 150, night: 50, hol: 150, holOver: 200 },
  };

  const MESSAGES = {
    NO_EMP: '사번이 비어 있습니다',
    BAD_WAGE: '월 통상임금을 읽을 수 없습니다',
    DUP_WAGE: '같은 사번이 여러 줄입니다',
    UNMATCHED: '근태 파일에 없는 사번입니다 (계산에 쓰이지 않음)',
    NO_WAGE: '급여 기준 파일에 이 사번이 없습니다',
  };

  // 숫자 또는 "3,200,000", "3200000원" 형태 -> 양의 정수(원), 아니면 null
  function parseWage(v) {
    let n = v;
    if (typeof v === 'string') {
      const s = v.replace(/[,\s원]/g, '');
      if (!/^\d+(\.\d+)?$/.test(s)) return null;
      n = Number(s);
    }
    if (typeof n !== 'number' || !isFinite(n) || n <= 0 || n > 1e9) return null;
    return Math.round(n);
  }

  // 분 단위 (분, 퍼센트) 목록을 시급 기준으로 환산해 원 미만 절사
  function amount(wage, parts, cfg) {
    const num = parts.reduce((a, [min, pct]) => a + wage * min * pct, 0);
    const den = cfg.monthlyHours * 60 * 100;
    return (num - (num % den)) / den;
  }

  // employees: analyze() 결과의 employees, wageRows: [{ rowNo, empNo, name, wage }]
  function calcPay(employees, wageRows, userConfig) {
    const cfg = Object.assign({}, DEFAULT_PAY_CONFIG, userConfig || {});
    cfg.pct = Object.assign({}, DEFAULT_PAY_CONFIG.pct, (userConfig && userConfig.pct) || {});

    const issues = [];
    const count = new Map();
    for (const w of wageRows) {
      const k = String(w.empNo == null ? '' : w.empNo).trim();
      if (k) count.set(k, (count.get(k) || 0) + 1);
    }
    const wages = new Map();
    const known = new Set(employees.map((e) => e.empNo));
    for (const w of wageRows) {
      const empNo = String(w.empNo == null ? '' : w.empNo).trim();
      const name = w.name == null ? '' : String(w.name);
      const add = (code, extra) => issues.push({ rowNo: w.rowNo, empNo, name, code, message: MESSAGES[code] + (extra || '') });
      if (!empNo) { add('NO_EMP'); continue; }
      if (count.get(empNo) > 1) { add('DUP_WAGE', ' (' + count.get(empNo) + '건)'); wages.set(empNo, { bad: true }); continue; }
      const wage = parseWage(w.wage);
      if (wage == null) { add('BAD_WAGE', ' (입력값: ' + (w.wage === '' || w.wage == null ? '빈 칸' : w.wage) + ')'); wages.set(empNo, { bad: true }); continue; }
      if (!known.has(empNo)) { add('UNMATCHED'); continue; }
      wages.set(empNo, { wage });
    }

    const rows = employees.map((e) => {
      const base = {
        empNo: e.empNo, name: e.name, group: e.group, site: e.site,
        attendanceError: e.errorRows > 0,
        wage: null, hourly: null, otPay: null, nightPay: null, holPay: null, total: null,
        status: 'ok',
      };
      const w = wages.get(e.empNo);
      if (!w) { base.status = 'no_wage'; issues.push({ rowNo: null, empNo: e.empNo, name: e.name, code: 'NO_WAGE', message: MESSAGES.NO_WAGE }); return base; }
      if (w.bad) { base.status = 'bad_wage'; return base; }
      base.wage = w.wage;
      base.hourly = Math.floor(w.wage / cfg.monthlyHours);
      base.otPay = amount(w.wage, [[e.otMin, cfg.pct.ot]], cfg);
      base.nightPay = amount(w.wage, [[e.nightMin, cfg.pct.night]], cfg);
      base.holPay = amount(w.wage, [[e.holMin - e.holOverMin, cfg.pct.hol], [e.holOverMin, cfg.pct.holOver]], cfg);
      base.total = base.otPay + base.nightPay + base.holPay;
      return base;
    });

    return { rows, issues };
  }

  return { DEFAULT_PAY_CONFIG, MESSAGES, parseWage, calcPay };
});
