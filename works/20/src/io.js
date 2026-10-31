/*
 * 엑셀/CSV 첫 시트를 읽어 엔진이 받는 행 배열로 바꾼다.
 * XLSX(SheetJS)는 호출하는 쪽에서 넘겨 준다. 브라우저와 Node 양쪽에서 쓴다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AttendanceIO = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLUMNS = {
    empNo: { label: '사번', required: true, aliases: ['사번', '사원번호', '직원번호'] },
    name: { label: '이름', required: true, aliases: ['이름', '성명', '직원명'] },
    group: { label: '직군', required: false, aliases: ['직군', '직종'] },
    site: { label: '사업장', required: false, aliases: ['사업장', '근무지'] },
    date: { label: '날짜', required: true, aliases: ['날짜', '근무일', '일자'] },
    in: { label: '출근시각', required: true, aliases: ['출근시각', '출근시간', '출근'] },
    out: { label: '퇴근시각', required: true, aliases: ['퇴근시각', '퇴근시간', '퇴근'] },
  };

  const WAGE_COLUMNS = {
    empNo: { label: '사번', required: true, aliases: ['사번', '사원번호', '직원번호'] },
    name: { label: '이름', required: false, aliases: ['이름', '성명', '직원명'] },
    wage: { label: '월통상임금', required: true, aliases: ['월통상임금', '통상임금', '통상임금(월)', '월통상임금(원)'] },
  };

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');

  // type: 'array'(브라우저 ArrayBuffer) | 'buffer'(Node Buffer) | 'string'(CSV 텍스트)
  function readTable(XLSX, data, type, columns) {
    let wb;
    try {
      wb = XLSX.read(data, { type: type || 'array' });
    } catch (e) {
      return { error: '파일을 읽을 수 없습니다. 엑셀(.xlsx) 또는 CSV 파일인지 확인해 주세요.' };
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { error: '시트가 없는 파일입니다.' };
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (aoa.length < 2) return { error: '데이터 행이 없습니다. 첫 줄은 제목 행이어야 합니다.' };

    const header = aoa[0].map(norm);
    const idx = {};
    const missing = [];
    for (const [key, col] of Object.entries(columns)) {
      const i = header.findIndex((h) => col.aliases.includes(h));
      if (i >= 0) idx[key] = i;
      else if (col.required) missing.push(col.label);
    }
    if (missing.length) {
      return { error: '필수 열이 없습니다: ' + missing.join(', ') + ' (첫 줄 제목: ' + header.filter(Boolean).join(', ') + ')' };
    }

    const rows = [];
    for (let r = 1; r < aoa.length; r++) {
      const line = aoa[r];
      if (line.every((c) => c === '' || c == null)) continue;
      const row = { rowNo: r + 1 };
      for (const key of Object.keys(columns)) row[key] = idx[key] != null ? line[idx[key]] : '';
      rows.push(row);
    }
    return { rows, sheetName: wb.SheetNames[0] };
  }

  const readRows = (XLSX, data, type) => readTable(XLSX, data, type, COLUMNS);
  const readWageRows = (XLSX, data, type) => readTable(XLSX, data, type, WAGE_COLUMNS);

  return { COLUMNS, WAGE_COLUMNS, readRows, readWageRows };
});
