/*
 * 결과 화면의 그래프. 외부 라이브러리 없이 SVG로 그린다.
 *   AttendanceCharts.render(root, { employees, days, pay, period, rules, isHoliday })
 * 색: 연장=파랑, 야간=주황, 휴일=청록(모든 그래프에서 같은 의미). 총 근무는 회색.
 * 값은 툴팁뿐 아니라 "표" 보기에서도 그대로 볼 수 있다.
 */
(function (root, factory) {
  root.AttendanceCharts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const NS = 'http://www.w3.org/2000/svg';
  const S = (tag, attrs, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    for (const kid of kids) n.append(kid);
    return n;
  };
  const H = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    for (const kid of kids) n.append(kid);
    return n;
  };

  const SERIES = [
    { key: 'otMin', label: '연장', color: 'var(--series-1)' },
    { key: 'nightMin', label: '야간', color: 'var(--series-2)' },
    { key: 'holMin', label: '휴일', color: 'var(--series-3)' },
  ];
  const PAY = [
    { key: 'otPay', label: '연장수당', color: 'var(--series-1)' },
    { key: 'nightPay', label: '야간수당', color: 'var(--series-2)' },
    { key: 'holPay', label: '휴일수당', color: 'var(--series-3)' },
  ];
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  const hm = (min) => Math.floor(min / 60) + ':' + String(Math.round(min % 60)).padStart(2, '0');
  const num = (n) => Math.round(n).toLocaleString('ko-KR');
  const hour1 = (h) => (Math.round(h * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const wonAxis = (v) => (v >= 1e8 ? v / 1e8 + '억' : v >= 1e4 ? num(v / 1e4) + '만' : String(v));

  function niceScale(max, n) {
    if (!(max > 0)) return { max: 1, ticks: [0, 1] };
    const raw = max / (n || 4);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
    const top = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = 0; v <= top + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { max: top, ticks };
  }

  // 4px로 둥근 끝, 기준선 쪽은 직각
  function roundedRight(x, y, w, h) {
    const r = Math.min(4, w / 2, h / 2);
    return 'M' + x + ' ' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) + 'V' + (y + h - r) + 'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - r) + ' ' + (y + h) + 'H' + x + 'Z';
  }
  function roundedTop(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return 'M' + x + ' ' + (y + h) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) + 'V' + (y + h) + 'Z';
  }

  // ---- 툴팁 (값이 먼저, 이름이 뒤. 텍스트는 textContent로만 넣는다) ----
  function makeTip(container) {
    const tip = H('div', { class: 'tip', role: 'status' });
    tip.hidden = true;
    container.append(tip);
    const place = (x, y) => {
      const box = container.getBoundingClientRect();
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let left = x - box.left + 14;
      if (left + w > box.width - 6) left = x - box.left - w - 14;
      left = Math.max(6, Math.min(left, box.width - w - 6));
      let top = y - box.top - h - 10;
      if (top < 4) top = y - box.top + 16;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    };
    return {
      show(title, rows, x, y) {
        tip.replaceChildren(
          H('div', { class: 'tip-title' }, title),
          ...rows.map((r) => {
            const row = H('div', { class: 'tip-row' });
            if (r.color) row.append(H('span', { class: 'tip-key', style: 'background:' + r.color }));
            const val = H('b', {}); val.textContent = r.value;
            const lab = H('span', {}); lab.textContent = ' ' + r.label;
            row.append(val, lab);
            return row;
          })
        );
        tip.hidden = false;
        place(x, y);
      },
      hide() { tip.hidden = true; },
    };
  }

  // 마크가 아니라 넓은 히트 영역(hit)에 이벤트를 붙인다. marks는 함께 밝아지는 그림 요소들.
  function bind(hit, marks, tip, title, rows, label) {
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('aria-label', label);
    const lift = (on) => marks.forEach((m) => m.classList.toggle('hot', on));
    const at = (e) => tip.show(title, rows, e.clientX, e.clientY);
    hit.addEventListener('pointerenter', (e) => { lift(true); at(e); });
    hit.addEventListener('pointermove', at);
    hit.addEventListener('pointerleave', () => { lift(false); tip.hide(); });
    hit.addEventListener('focus', () => {
      lift(true);
      const b = hit.getBoundingClientRect();
      tip.show(title, rows, b.left + b.width / 2, b.top);
    });
    hit.addEventListener('blur', () => { lift(false); tip.hide(); });
  }

  function legend(items) {
    return H('ul', { class: 'legend' }, ...items.map((i) => {
      const li = H('li', {});
      li.append(H('span', { class: 'sw' + (i.shade ? ' shade' : ''), style: i.color ? 'background:' + i.color : '' }));
      li.append(document.createTextNode(i.label));
      return li;
    }));
  }

  function card(title, sub, ...extra) {
    return H('section', { class: 'vcard' }, H('h3', {}, title), H('p', { class: 'vsub' }, sub), ...extra);
  }

  function axisY(svg, ticks, scale, l, r, W, fmt) {
    ticks.forEach((t, i) => {
      const y = scale(t);
      svg.append(S('line', { x1: l, x2: W - r, y1: y, y2: y, class: i === 0 ? 'baseline' : 'grid' }));
      const tx = S('text', { x: l - 6, y: y, dy: '0.32em', 'text-anchor': 'end', class: 'tick' });
      tx.textContent = fmt(t);
      svg.append(tx);
    });
  }

  // ---- 그래프 1: 직군별 1인당 평균 가산 시간 ----
  function byGroup(wrap, tip, list, W) {
    const groups = [...new Set(list.map((e) => e.group || '(미지정)'))];
    const data = groups.map((g) => {
      const m = list.filter((e) => (e.group || '(미지정)') === g);
      return { g, n: m.length, vals: SERIES.map((s) => m.reduce((a, e) => a + e[s.key], 0) / m.length / 60) };
    });
    const max = Math.max(...data.flatMap((d) => d.vals));
    const sc = niceScale(max, 4);
    const m = { l: 40, r: 8, t: 16, b: 32 };
    const plotH = 170;
    const Ht = m.t + plotH + m.b;
    const y = (v) => m.t + plotH - (v / sc.max) * plotH;
    const svg = S('svg', { width: W, height: Ht, viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': '직군별 1인당 평균 연장·야간·휴일 시간 막대그래프' });
    axisY(svg, sc.ticks, y, m.l, m.r, W, (v) => num(v));

    const slot = (W - m.l - m.r) / data.length;
    const bw = Math.max(6, Math.min(24, (slot * 0.8 - 4) / 3));
    const cw = 3 * bw + 4;
    let top = { v: -1 };
    data.forEach((d, i) => {
      const x0 = m.l + slot * i + (slot - cw) / 2;
      const marks = [];
      d.vals.forEach((v, j) => {
        const h = (v / sc.max) * plotH;
        const x = x0 + j * (bw + 2);
        if (h >= 0.5) {
          const p = S('path', { d: roundedTop(x, m.t + plotH - h, bw, h), fill: SERIES[j].color, class: 'mark' });
          svg.append(p);
          marks.push(p);
        }
        if (v > top.v) top = { v, x: x + bw / 2, y: y(v) };
      });
      const lab = S('text', { x: m.l + slot * (i + 0.5), y: m.t + plotH + 20, 'text-anchor': 'middle', class: 'xlab' });
      lab.textContent = d.g + ' (' + d.n + '명)';
      svg.append(lab);
      const hit = S('rect', { x: m.l + slot * i, y: m.t, width: slot, height: plotH + 24, fill: 'transparent', class: 'hit' });
      svg.append(hit);
      const rows = SERIES.map((s, j) => ({ color: s.color, value: hour1(d.vals[j]) + '시간', label: s.label }));
      bind(hit, marks, tip, d.g + ' · 1인당 평균 (' + d.n + '명)', rows,
        d.g + ' 1인당 평균: ' + SERIES.map((s, j) => s.label + ' ' + hour1(d.vals[j]) + '시간').join(', '));
    });
    if (top.v > 0) {
      const t = S('text', { x: top.x, y: top.y - 5, 'text-anchor': 'middle', class: 'vlab' });
      t.textContent = hour1(top.v);
      svg.append(t);
    }
    wrap.append(svg);
  }

  // ---- 그래프 2: 연장시간 상위 10명 ----
  function topOvertime(wrap, tip, list, W) {
    const top = list.filter((e) => e.otMin > 0).sort((a, b) => b.otMin - a.otMin).slice(0, 10);
    if (!top.length) { wrap.append(H('p', { class: 'vempty' }, '연장근로가 있는 직원이 없습니다.')); return; }
    const rowH = 28, barH = 16;
    const l = Math.min(150, Math.max(104, W * 0.32)), r = 56;
    const Ht = top.length * rowH + 8;
    const max = top[0].otMin;
    const svg = S('svg', { width: W, height: Ht, viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': '연장시간 상위 ' + top.length + '명 막대그래프' });
    svg.append(S('line', { x1: l, x2: l, y1: 0, y2: Ht, class: 'baseline' }));
    top.forEach((e, i) => {
      const y = 4 + i * rowH;
      const w = Math.max(2, ((W - l - r) * e.otMin) / max);
      const lab = S('text', { x: l - 8, y: y + rowH / 2, dy: '0.32em', 'text-anchor': 'end', class: 'ylab' });
      lab.textContent = e.name + (e.group ? ' · ' + e.group : '');
      svg.append(lab);
      const bar = S('path', { d: roundedRight(l, y + (rowH - barH) / 2, w, barH), fill: 'var(--series-1)', class: 'mark' });
      svg.append(bar);
      const v = S('text', { x: l + w + 6, y: y + rowH / 2, dy: '0.32em', class: 'vlab' });
      v.textContent = hm(e.otMin);
      svg.append(v);
      const hit = S('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent', class: 'hit' });
      svg.append(hit);
      bind(hit, [bar], tip, e.name + ' (' + e.empNo + ')',
        [{ color: 'var(--series-1)', value: hm(e.otMin), label: '연장' }, { value: hm(e.totalMin), label: '총 근무' }, { value: e.group || '-', label: '직군' }],
        e.name + ' 연장 ' + hm(e.otMin));
    });
    wrap.append(svg);
  }

  // ---- 그래프 3: 일자별 총 근무시간 ----
  function daily(wrap, tip, list, daysRows, period, rules, isHoliday, W) {
    if (!period) { wrap.append(H('p', { class: 'vempty' }, '날짜가 없습니다.')); return; }
    const from = rules.parseDate(period.from), to = rules.parseDate(period.to);
    const by = new Map();
    for (const d of daysRows) {
      const o = by.get(d.day) || { work: 0, night: 0, n: 0 };
      o.work += d.workMin; o.night += d.nightMin; o.n += 1;
      by.set(d.day, o);
    }
    const all = [];
    for (let d = from; d <= to; d++) all.push({ day: d, ...(by.get(d) || { work: 0, night: 0, n: 0 }) });
    const sc = niceScale(Math.max(...all.map((d) => d.work / 60)), 4);
    const m = { l: 44, r: 8, t: 10, b: 30 };
    const plotH = 150;
    const Ht = m.t + plotH + m.b;
    const y = (v) => m.t + plotH - (v / sc.max) * plotH;
    const slot = (W - m.l - m.r) / all.length;
    const svg = S('svg', { width: W, height: Ht, viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': '일자별 총 근무시간 막대그래프' });
    all.forEach((d, i) => {
      if (isHoliday(d.day)) svg.append(S('rect', { x: m.l + slot * i, y: m.t, width: slot, height: plotH, class: 'shade' }));
    });
    axisY(svg, sc.ticks, y, m.l, m.r, W, (v) => num(v));
    const bw = Math.max(3, Math.min(24, slot - 2));
    const step = slot >= 22 ? 1 : slot >= 13 ? 2 : 5;
    all.forEach((d, i) => {
      const date = new Date(d.day * 86400000);
      const h = (d.work / 60 / sc.max) * plotH;
      const x = m.l + slot * i + (slot - bw) / 2;
      const marks = [];
      if (h >= 0.5) {
        const p = S('path', { d: roundedTop(x, m.t + plotH - h, bw, h), fill: 'var(--viz-total)', class: 'mark' });
        svg.append(p);
        marks.push(p);
      }
      if (i % step === 0) {
        const t = S('text', { x: m.l + slot * (i + 0.5), y: m.t + plotH + 18, 'text-anchor': 'middle', class: 'xlab' });
        t.textContent = String(date.getUTCDate());
        svg.append(t);
      }
      const hit = S('rect', { x: m.l + slot * i, y: m.t, width: slot, height: plotH + 24, fill: 'transparent', class: 'hit' });
      svg.append(hit);
      const title = (date.getUTCMonth() + 1) + '월 ' + date.getUTCDate() + '일 (' + WEEK[date.getUTCDay()] + ')' + (isHoliday(d.day) ? ' · 휴일' : '');
      bind(hit, marks, tip, title,
        [{ value: num(d.work / 60) + '시간', label: '총 근무', color: 'var(--viz-total)' }, { value: d.n + '명', label: '근무 인원' }, { value: num(d.night / 60) + '시간', label: '그중 야간' }],
        title + ' 총 근무 ' + num(d.work / 60) + '시간, ' + d.n + '명');
    });
    wrap.append(svg);
  }

  // ---- 그래프 4: 직군별 수당 합계 (쌓은 막대. 세 수당은 서로 더해지는 금액) ----
  function payByGroup(wrap, tip, list, payBy, W) {
    const groups = [...new Set(list.map((e) => e.group || '(미지정)'))];
    const data = groups.map((g) => {
      const m = list.filter((e) => (e.group || '(미지정)') === g);
      const sums = PAY.map((p) => m.reduce((a, e) => a + ((payBy.get(e.empNo) || {})[p.key] || 0), 0));
      return { g, sums, total: sums.reduce((a, b) => a + b, 0) };
    });
    const sc = niceScale(Math.max(...data.map((d) => d.total)), 4);
    const rowH = 42, barH = 22;
    const m = { l: 56, r: 92, t: 6, b: 28 };
    const Ht = m.t + data.length * rowH + m.b;
    const x = (v) => m.l + (v / sc.max) * (W - m.l - m.r);
    const svg = S('svg', { width: W, height: Ht, viewBox: '0 0 ' + W + ' ' + Ht, role: 'img', 'aria-label': '직군별 수당 합계 쌓은 막대그래프' });
    const mil = sc.max >= 5e6; // 큰 금액은 백만원 단위로 줄여 눈금이 겹치지 않게 한다
    sc.ticks.forEach((t, i) => {
      svg.append(S('line', { x1: x(t), x2: x(t), y1: m.t, y2: m.t + data.length * rowH, class: i === 0 ? 'baseline' : 'grid' }));
      const tx = S('text', { x: x(t), y: m.t + data.length * rowH + 18, 'text-anchor': 'middle', class: 'tick' });
      tx.textContent = mil ? num(t / 1e6) : wonAxis(t);
      svg.append(tx);
    });
    if (mil) {
      const u = S('text', { x: W - 2, y: m.t + data.length * rowH + 18, 'text-anchor': 'end', class: 'tick' });
      u.textContent = '(백만원)';
      svg.append(u);
    }
    data.forEach((d, i) => {
      const y = m.t + i * rowH + (rowH - barH) / 2;
      const lab = S('text', { x: m.l - 8, y: m.t + i * rowH + rowH / 2, dy: '0.32em', 'text-anchor': 'end', class: 'ylab' });
      lab.textContent = d.g;
      svg.append(lab);
      const marks = [];
      let acc = 0;
      const lastIdx = d.sums.map((s, k) => (s > 0 ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
      d.sums.forEach((s, k) => {
        if (s <= 0) return;
        const x0 = x(acc), x1 = x(acc + s);
        acc += s;
        const w = Math.max(1, x1 - x0 - (k === lastIdx ? 0 : 2)); // 조각 사이 2px 틈
        const p = k === lastIdx
          ? S('path', { d: roundedRight(x0, y, w, barH), fill: PAY[k].color, class: 'mark' })
          : S('rect', { x: x0, y, width: w, height: barH, fill: PAY[k].color, class: 'mark' });
        svg.append(p);
        marks.push(p);
      });
      const t = S('text', { x: x(d.total) + 6, y: m.t + i * rowH + rowH / 2, dy: '0.32em', class: 'vlab' });
      t.textContent = num(d.total) + '원';
      svg.append(t);
      const hit = S('rect', { x: 0, y: m.t + i * rowH, width: W, height: rowH, fill: 'transparent', class: 'hit' });
      svg.append(hit);
      bind(hit, marks, tip, d.g + ' · 수당 합계',
        [{ value: num(d.total) + '원', label: '합계' }, ...PAY.map((p, k) => ({ color: p.color, value: num(d.sums[k]) + '원', label: p.label }))],
        d.g + ' 수당 합계 ' + num(d.total) + '원');
    });
    wrap.append(svg);
  }

  // ---- 전체 ----
  function render(container, o) {
    const list = o.employees;
    container.replaceChildren();
    if (!list.length) {
      container.append(H('p', { class: 'vempty' }, '조건에 맞는 직원이 없습니다.'));
      return;
    }
    const tip = makeTip(container);
    const sumMin = (f) => list.reduce((a, e) => a + e[f], 0);
    const tile = (label, value, unit, note, cls) =>
      H('div', { class: 'tile' + (cls ? ' ' + cls : '') },H('span', { class: 'tl' }, label), H('b', { class: 'tv' }, value, H('small', {}, unit || '')), note ? H('span', { class: 'tn' }, note) : '');

    const tiles = [
      tile('직원', num(list.length), '명'),
      tile('총 근무', num(sumMin('totalMin') / 60), '시간'),
      tile('연장', num(sumMin('otMin') / 60), '시간'),
      tile('야간', num(sumMin('nightMin') / 60), '시간'),
      tile('휴일', num(sumMin('holMin') / 60), '시간'),
    ];
    let flagged = 0, missing = 0;
    if (o.pay) {
      for (const e of list) {
        const p = o.pay.get(e.empNo);
        if (!p || p.total == null) missing++;
        else if (p.attendanceError) flagged++;
      }
      const total = list.reduce((a, e) => a + ((o.pay.get(e.empNo) || {}).total || 0), 0);
      const notes = [];
      if (flagged) notes.push('확정 불가 ' + flagged + '명 포함');
      if (missing) notes.push('금액 없음 ' + missing + '명 제외');
      tiles.push(tile('수당 합계', num(total), '원', notes.join(' · '), 'money'));
    }
    container.append(H('div', { class: 'tiles' }, ...tiles));

    const grid = H('div', { class: 'vgrid' });
    container.append(grid);
    const make = (title, sub, extra, draw, cls) => {
      const wrap = H('div', { class: 'vplot' });
      const c = card(title, sub, ...(extra ? [extra] : []), wrap);
      if (cls) c.classList.add(cls);
      grid.append(c);
      const W = Math.max(260, Math.floor(wrap.clientWidth || c.clientWidth - 32));
      draw(wrap, W);
    };

    make('직군별 1인당 평균 시간', '직군 안에서 한 사람이 한 달 동안 평균 몇 시간을 일했는지(시간). 야간은 연장·휴일과 겹칠 수 있습니다.',
      legend(SERIES), (w, W) => byGroup(w, tip, list, W));
    make('연장시간 상위 10명', '연장근로가 많은 순서입니다(시:분).', null, (w, W) => topOvertime(w, tip, list, W));
    make('일자별 총 근무시간', '그날 일한 모든 직원의 근무시간 합계(시간). 날짜는 출근한 날 기준이고, 음영은 일요일·공휴일입니다.',
      legend([{ label: '총 근무', color: 'var(--viz-total)' }, { label: '일요일·공휴일', shade: true }]),
      (w, W) => daily(w, tip, list, o.days, o.period, o.rules, o.isHoliday, W), 'wide');
    if (o.pay) {
      const sub = '연장·야간·휴일 수당 금액을 직군별로 쌓았습니다(원).' + (flagged ? ' 근태 오류로 확정 불가인 ' + flagged + '명의 금액이 들어 있습니다.' : '') + (missing ? ' 급여 기준이 없는 ' + missing + '명은 빠져 있습니다.' : '');
      make('직군별 수당 합계', sub, legend(PAY), (w, W) => payByGroup(w, tip, list, o.pay, W), 'wide');
    }
  }

  return { render };
});
