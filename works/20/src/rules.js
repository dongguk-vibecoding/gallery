/*
 * 근태 집계 엔진 (시간 집계 전용, 금액 계산 없음)
 *
 * 모든 시간은 "분" 단위 정수로 다룬다. 절대 분 = 일수(1970-01-01 기준) * 1440 + 하루 중 분.
 *
 * 적용 규칙 (DEFAULT_CONFIG에서 바꿀 수 있음)
 *  - 휴게시간: 총 체류 4시간 이상 30분, 8시간 이상 60분. 근무 시간대의 한가운데에 쓴 것으로 본다.
 *  - 연장: 하루 8시간 초과분 + (하루 8시간 이내 근로의 합이 주 40시간을 넘는 부분). 둘은 겹쳐 세지 않는다.
 *  - 야간: 22:00~06:00에 한 근로(연장·휴일과 별개로 센다).
 *  - 휴일: 일요일(주휴일)과 공휴일. 달력상 그 날짜에 속한 분만 휴일로 본다.
 *    휴일근로는 연장 산정(일 8시간, 주 40시간)에서 제외하고, 1회 근무 안에서 8시간 초과분은 따로 센다.
 *  - 주는 월~일. 파일에 일부만 들어 있는 주는 경고로 알린다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AttendanceRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 1440;

  const DEFAULT_CONFIG = {
    dailyLimit: 8 * 60,
    weeklyLimit: 40 * 60,
    nightStart: 22 * 60,
    nightEnd: 6 * 60,
    breakRules: [
      { minGross: 8 * 60, minutes: 60 },
      { minGross: 4 * 60, minutes: 30 },
    ],
    maxGrossMinutes: 16 * 60,
    sundayIsHoliday: true,
    holidays: [
      '2026-09-24', '2026-09-25', '2026-09-26',
      '2026-10-03', '2026-10-05', '2026-10-09',
      '2026-12-25',
    ],
  };

  const ERROR_CODES = {
    NO_EMP: '사번이 비어 있습니다',
    INVALID_DATE: '날짜를 읽을 수 없습니다',
    DUPLICATE: '같은 사번·날짜의 기록이 여러 건입니다',
    MISSING_IN: '출근시각이 비어 있습니다',
    MISSING_OUT: '퇴근시각이 비어 있습니다',
    INVALID_TIME: '시각 형식이 올바르지 않습니다',
    SAME_TIME: '출근시각과 퇴근시각이 같습니다',
    TOO_LONG: '근무 시간이 16시간을 넘습니다',
  };

  function dayFromYMD(y, m, d) {
    const t = Date.UTC(y, m - 1, d);
    const dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return Math.round(t / 86400000);
  }

  function dayToStr(day) {
    return new Date(day * 86400000).toISOString().slice(0, 10);
  }

  // 0 = 일요일
  function weekday(day) {
    return (((day + 4) % 7) + 7) % 7;
  }

  function mondayOf(day) {
    return day - ((weekday(day) + 6) % 7);
  }

  // 날짜 값(문자열, 엑셀 일련번호, Date) -> 일수, 읽을 수 없으면 null
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      return dayFromYMD(v.getFullYear(), v.getMonth() + 1, v.getDate());
    }
    if (typeof v === 'number') {
      if (!isFinite(v) || v < 20000 || v > 80000) return null;
      return Math.floor(v) - 25569;
    }
    const m = String(v).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!m) return null;
    return dayFromYMD(+m[1], +m[2], +m[3]);
  }

  // 시각 값 -> { state: 'empty' | 'ok' | 'invalid', min }
  function parseTime(v) {
    if (v == null || (typeof v === 'string' && v.trim() === '')) return { state: 'empty' };
    if (typeof v === 'number') {
      if (!isFinite(v) || v < 0 || v >= 1) return { state: 'invalid' };
      return { state: 'ok', min: Math.round(v * DAY) % DAY };
    }
    if (v instanceof Date) {
      if (isNaN(v)) return { state: 'invalid' };
      return { state: 'ok', min: v.getHours() * 60 + v.getMinutes() };
    }
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return { state: 'invalid' };
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return { state: 'invalid' };
    return { state: 'ok', min: h * 60 + mi };
  }

  function overlap(a1, a2, b1, b2) {
    return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  }

  function analyze(rawRows, userConfig) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, userConfig || {});
    const holSet = new Set();
    for (const h of cfg.holidays) {
      const d = parseDate(h);
      if (d != null) holSet.add(d);
    }
    const isHoliday = (d) => holSet.has(d) || (cfg.sundayIsHoliday && weekday(d) === 0);

    const breakMinutes = (gross) => {
      for (const r of cfg.breakRules) if (gross >= r.minGross) return r.minutes;
      return 0;
    };

    // 1) 행 읽기
    const rows = rawRows.map((raw) => ({
      raw,
      empNo: raw.empNo == null ? '' : String(raw.empNo).trim(),
      day: parseDate(raw.date),
      tin: parseTime(raw.in),
      tout: parseTime(raw.out),
    }));

    const dupCount = new Map();
    for (const r of rows) {
      if (r.empNo && r.day != null) {
        const k = r.empNo + '|' + r.day;
        dupCount.set(k, (dupCount.get(k) || 0) + 1);
      }
    }

    // 2) 오류 판정 (행마다 이유 하나, 앞선 것이 우선)
    const errors = [];
    const fmtHM = (min) => Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0');
    for (const r of rows) {
      let code = null;
      let detail = '';
      if (!r.empNo) code = 'NO_EMP';
      else if (r.day == null) {
        code = 'INVALID_DATE';
        detail = ' (입력값: ' + (r.raw.date === '' || r.raw.date == null ? '빈 칸' : r.raw.date) + ')';
      } else if (dupCount.get(r.empNo + '|' + r.day) > 1) {
        code = 'DUPLICATE';
        detail = ' (' + dupCount.get(r.empNo + '|' + r.day) + '건)';
      } else if (r.tin.state === 'empty') code = 'MISSING_IN';
      else if (r.tout.state === 'empty') code = 'MISSING_OUT';
      else if (r.tin.state === 'invalid' || r.tout.state === 'invalid') {
        code = 'INVALID_TIME';
        detail = ' (출근 ' + r.raw.in + ', 퇴근 ' + r.raw.out + ')';
      } else if (r.tin.min === r.tout.min) code = 'SAME_TIME';
      else {
        const s = r.day * DAY + r.tin.min;
        const e = r.tout.min > r.tin.min ? r.day * DAY + r.tout.min : (r.day + 1) * DAY + r.tout.min;
        r.s = s;
        r.e = e;
        if (e - s > cfg.maxGrossMinutes) {
          code = 'TOO_LONG';
          detail = ' (' + fmtHM(e - s) + ')';
        }
      }
      if (code) {
        r.error = code;
        errors.push({
          rowNo: r.raw.rowNo,
          empNo: r.empNo,
          name: r.raw.name == null ? '' : String(r.raw.name),
          date: r.day != null ? dayToStr(r.day) : String(r.raw.date == null ? '' : r.raw.date),
          code,
          message: ERROR_CODES[code] + detail,
        });
      }
    }

    // 3) 정상 행 계산
    const days = [];
    const emps = new Map();
    const getEmp = (r) => {
      if (!emps.has(r.empNo)) {
        emps.set(r.empNo, {
          empNo: r.empNo,
          name: r.raw.name == null ? '' : String(r.raw.name),
          group: r.raw.group == null ? '' : String(r.raw.group),
          site: r.raw.site == null ? '' : String(r.raw.site),
          workDays: 0,
          totalMin: 0,
          otMin: 0,
          nightMin: 0,
          holMin: 0,
          holOverMin: 0,
          errorRows: 0,
          _weeks: new Map(),
        });
      }
      return emps.get(r.empNo);
    };

    for (const r of rows) {
      if (!r.empNo) continue;
      const emp = getEmp(r);
      if (r.error) {
        emp.errorRows++;
        continue;
      }
      const gross = r.e - r.s;
      const b = breakMinutes(gross);
      const bs = r.s + Math.floor((gross - b) / 2);
      const segs = [];
      if (bs > r.s) segs.push([r.s, bs]);
      if (r.e > bs + b) segs.push([bs + b, r.e]);

      let work = 0, night = 0, hol = 0;
      for (const [a, z] of segs) {
        work += z - a;
        for (let d = Math.floor(a / DAY) - 1; d <= Math.floor((z - 1) / DAY); d++) {
          night += overlap(a, z, d * DAY + cfg.nightStart, (d + 1) * DAY + cfg.nightEnd);
        }
        for (let d = Math.floor(a / DAY); d <= Math.floor((z - 1) / DAY); d++) {
          if (isHoliday(d)) hol += overlap(a, z, d * DAY, (d + 1) * DAY);
        }
      }
      const regular = work - hol;
      const dailyOT = Math.max(0, regular - cfg.dailyLimit);
      const wk = mondayOf(r.day);
      emp._weeks.set(wk, (emp._weeks.get(wk) || 0) + (regular - dailyOT));

      emp.workDays++;
      emp.totalMin += work;
      emp.otMin += dailyOT;
      emp.nightMin += night;
      emp.holMin += hol;
      emp.holOverMin += Math.max(0, hol - 8 * 60);
      days.push({ empNo: r.empNo, day: r.day, workMin: work, nightMin: night, holMin: hol });
    }

    const employees = [];
    for (const emp of emps.values()) {
      for (const base of emp._weeks.values()) emp.otMin += Math.max(0, base - cfg.weeklyLimit);
      delete emp._weeks;
      employees.push(emp);
    }
    employees.sort((a, b) => (a.empNo < b.empNo ? -1 : a.empNo > b.empNo ? 1 : 0));

    // 4) 경고: 파일에 일부만 들어 있는 주
    const warnings = [];
    const allDays = rows.filter((r) => r.day != null).map((r) => r.day);
    let period = null;
    if (allDays.length) {
      const from = Math.min(...allDays);
      const to = Math.max(...allDays);
      period = { from: dayToStr(from), to: dayToStr(to) };
      for (let wk = mondayOf(from); wk <= to; wk += 7) {
        if (wk < from || wk + 6 > to) {
          warnings.push({
            code: 'PARTIAL_WEEK',
            message:
              dayToStr(wk) + ' ~ ' + dayToStr(wk + 6) + ' 주는 파일에 일부 날짜만 있어 주 40시간 초과분이 실제보다 적게 계산될 수 있습니다',
          });
        }
      }
    }

    return {
      employees,
      days, // 정상 행의 일자별 값. 날짜는 출근한 날 기준
      isHoliday,
      errors,
      warnings,
      stats: { totalRows: rows.length, validRows: rows.filter((r) => !r.error).length, errorRows: errors.length },
      period,
    };
  }

  return { DEFAULT_CONFIG, ERROR_CODES, analyze, parseDate, parseTime, dayToStr, weekday, mondayOf };
});
