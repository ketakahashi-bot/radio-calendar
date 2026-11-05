// カレンダー画面（月・週・日）

import { h, page, button, linkButton, empty, externalLink, rerender } from '../ui.js';
import { composeX } from '../mail.js';
import { backupWarning } from '../sync.js';
import { getSetting, setSetting, all, byProgram } from '../store.js';
import { occurrences, marksInRange, nowNext, boundary, fmtOcc } from '../episodes.js';
import { textOn, safeUrl } from '../domain.js';
import { addSample } from '../sample.js';
import {
  DAY_MS, instant, logicalDay, logicalMin, dayParts, monthStart, daysInMonth, weekdayOf, weekdayLabel,
  fmtDay, fmtHM, fmtInstant, fmtRemaining,
} from '../time.js';

const st = { view: null, anchor: null, selected: null, scrollNow: true };

const STATUS_LABEL = { cancelled: '休止', special: '特番', changed: '時間変更' };

export function occTime(o, b = boundary()) {
  const start = logicalMin(o.startMs, b);
  return `${fmtHM(start)}〜${fmtHM(start + (o.endMs - o.startMs) / 60000)}`;
}

function listenButton(occ) {
  const ch = byProgram('channels', occ.program.id).find((c) => safeUrl(c.url));
  return ch ? externalLink('聴く', ch.url, 'btn small primary') : null;
}

function nowCards() {
  const now = Date.now();
  const { onAir, next } = nowNext(now);
  const cards = [];
  for (const o of onAir) {
    cards.push(h('article', { class: 'now-card onair', style: `--c:${o.program.color}` },
      h('a', { class: 'now-main', href: `#/ep/${o.key}` },
        h('span', { class: 'onair-badge' }, 'ON AIR'),
        h('strong', null, o.program.name),
        h('small', null, `${occTime(o)}・残り${fmtRemaining(o.endMs - now)}`)),
      (o.program.hashtags || []).length ? button('実況', () => composeX({ program: o.program, text: `${o.program.hashtags.join(' ')} ` }), 'small') : null,
      listenButton(o)));
  }
  if (next) {
    cards.push(h('article', { class: 'now-card', style: `--c:${next.program.color}` },
      h('a', { class: 'now-main', href: `#/ep/${next.key}` },
        h('span', { class: 'next-badge' }, '次の放送'),
        h('strong', null, next.program.name),
        h('small', null, `${fmtOcc(next)}・あと${fmtRemaining(next.startMs - now)}`)),
      null));
  }
  return cards;
}

export function refreshNow() {
  const box = document.getElementById('now-cards');
  if (box) box.replaceChildren(...nowCards());
  const line = document.querySelector('.now-line');
  if (line) line.style.top = `${nowTop()}%`;
}

function today() {
  return logicalDay(Date.now(), boundary());
}

function nowTop() {
  const b = boundary();
  return ((logicalMin(Date.now(), b) - b) / 1440) * 100;
}

function occChip(o) {
  const cancelled = o.status === 'cancelled';
  return h('span', {
    class: `chip-ev ${cancelled ? 'is-cancelled' : ''}`,
    style: `background:${o.program.color};color:${textOn(o.program.color)}`,
  }, o.program.name);
}

function agenda(day, occs, marks) {
  const rows = [];
  for (const o of occs) {
    rows.push(h('a', { class: `row ev-row ${o.status === 'cancelled' ? 'is-cancelled' : ''}`, href: `#/ep/${o.key}` },
      h('span', { class: 'ev-bar', style: `background:${o.program.color}` }),
      h('span', { class: 'row-main' },
        h('strong', null, o.program.name, o.title ? ` ${o.title}` : ''),
        h('small', null, occTime(o), o.program.station ? `・${o.program.station}` : '')),
      STATUS_LABEL[o.status] ? h('span', { class: `tag tag-${o.status}` }, STATUS_LABEL[o.status]) : null,
      o.listened ? h('span', { class: 'tag' }, '聴取済') : null));
  }
  for (const m of marks) {
    const href = m.type === 'deadline' ? `#/program/${m.program.id}/corners` : `#/ep/${m.occ.key}`;
    rows.push(h('a', { class: 'row mark-row', href },
      h('span', { class: `mark mark-${m.type}`, 'aria-hidden': 'true' }),
      h('span', { class: 'row-main' },
        h('strong', null, m.type === 'deadline' ? `${m.program.name} ${m.label}` : m.label),
        h('small', null, m.type === 'catchup' ? `${fmtHM(logicalMin(m.ms, boundary()))}まで・${m.channel.station || ''}` : `${fmtHM(logicalMin(m.ms, boundary()))}まで`))));
  }
  return h('div', { class: 'agenda' },
    h('h2', { class: 'sec-title' }, fmtDay(day)),
    rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'muted pad' }, '放送予定はありません'));
}

function groupByDay(occs, b) {
  const map = new Map();
  for (const o of occs) {
    const d = logicalDay(o.startMs, b);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(o);
  }
  return map;
}

function monthView() {
  const b = boundary();
  const { y, m } = dayParts(st.anchor);
  const first = monthStart(y, m);
  const gridStart = first - weekdayOf(first);
  const lastDay = first + daysInMonth(y, m) - 1;
  const gridEnd = lastDay + (6 - weekdayOf(lastDay));
  const occs = occurrences(instant(gridStart, b), instant(gridEnd + 1, b));
  const byDay = groupByDay(occs, b);
  const marks = marksInRange(gridStart, gridEnd);
  const t = today();
  if (st.selected == null || st.selected < gridStart || st.selected > gridEnd) st.selected = t >= first && t <= lastDay ? t : first;

  const agendaBox = h('div', null);
  const paintAgenda = () => agendaBox.replaceChildren(agenda(st.selected, byDay.get(st.selected) || [], marks.get(st.selected) || []));
  paintAgenda();

  const cells = [];
  for (let d = gridStart; d <= gridEnd; d++) {
    const p = dayParts(d);
    const items = byDay.get(d) || [];
    const dayMarks = marks.get(d) || [];
    const live = items.filter((o) => o.status !== 'cancelled').length;
    const cell = h('button', {
      type: 'button',
      class: `m-cell ${p.m !== m ? 'other' : ''} ${d === t ? 'today' : ''} ${d === st.selected ? 'selected' : ''} wd${p.wd}`,
      'aria-label': `${p.m}月${p.d}日${weekdayLabel(p.wd)}曜 放送${live}件${dayMarks.length ? ` 期限${dayMarks.length}件` : ''}`,
      'aria-pressed': String(d === st.selected),
      onclick: (e) => {
        st.selected = d;
        document.querySelectorAll('.m-cell.selected').forEach((n) => { n.classList.remove('selected'); n.setAttribute('aria-pressed', 'false'); });
        e.currentTarget.classList.add('selected');
        e.currentTarget.setAttribute('aria-pressed', 'true');
        paintAgenda();
      },
    },
    h('span', { class: 'm-num' }, p.d,
      dayMarks.map((mk) => h('span', { class: `mark mark-${mk.type}`, 'aria-hidden': 'true' }))),
    items.slice(0, 3).map(occChip),
    items.length > 3 ? h('span', { class: 'm-more' }, `+${items.length - 3}`) : null);
    cells.push(cell);
  }
  return h('div', null,
    h('div', { class: 'm-head', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4, 5, 6].map((w) => h('span', { class: `wd${w}` }, weekdayLabel(w)))),
    h('div', { class: 'm-grid' }, cells),
    agendaBox);
}

/** 重なる放送を横に並べる列番号を割り当てる */
function layout(blocks) {
  const cols = [];
  const placed = blocks.sort((a, b) => a.top - b.top || b.height - a.height);
  for (const bk of placed) {
    let i = cols.findIndex((end) => end <= bk.top);
    if (i < 0) { i = cols.length; cols.push(0); }
    cols[i] = bk.top + bk.height;
    bk.col = i;
  }
  for (const bk of placed) {
    bk.cols = 1 + Math.max(bk.col, ...placed.filter((x) => x.top < bk.top + bk.height && bk.top < x.top + x.height).map((x) => x.col));
  }
  return placed;
}

function timeline(days) {
  const b = boundary();
  const occs = occurrences(instant(days[0], b), instant(days[days.length - 1] + 1, b));
  const marks = marksInRange(days[0], days[days.length - 1]);
  const t = today();
  const startHour = b / 60;
  const hours = Array.from({ length: 24 }, (_, i) => startHour + i);

  const cols = days.map((d) => {
    const dayStart = instant(d, b);
    const dayEnd = dayStart + DAY_MS;
    const blocks = layout(occs.filter((o) => o.startMs < dayEnd && o.endMs > dayStart).map((o) => {
      const s = Math.max(o.startMs, dayStart);
      const e = Math.min(o.endMs, dayEnd);
      return { o, top: ((s - dayStart) / DAY_MS) * 100, height: Math.max(((e - s) / DAY_MS) * 100, 1.6) };
    }));
    return h('div', { class: `t-col ${d === t ? 'today' : ''}` },
      hours.map(() => h('span', { class: 't-line' })),
      blocks.map(({ o, top, height, col, cols: n }) => h('a', {
        class: `t-ev ${o.status === 'cancelled' ? 'is-cancelled' : ''}`,
        href: `#/ep/${o.key}`,
        style: `top:${top}%;height:${height}%;left:${(col / n) * 100}%;width:${100 / n}%;background:${o.program.color};color:${textOn(o.program.color)}`,
        'aria-label': `${o.program.name} ${fmtDay(d)} ${occTime(o)}${STATUS_LABEL[o.status] ? ` ${STATUS_LABEL[o.status]}` : ''}`,
      },
      h('strong', null, o.program.name),
      days.length === 1 ? h('small', null, occTime(o)) : null)),
      d === t ? h('span', { class: 'now-line', style: `top:${nowTop()}%`, 'aria-hidden': 'true' }) : null);
  });

  const head = days.length > 1
    ? h('div', { class: 't-head' }, h('span', { class: 't-gutter' }), days.map((d) => {
      const p = dayParts(d);
      return h('button', {
        type: 'button',
        class: `t-day ${d === t ? 'today' : ''} wd${p.wd}`,
        'aria-label': `${p.m}月${p.d}日の日表示へ`,
        onclick: () => { st.view = 'day'; st.anchor = d; st.scrollNow = true; renderInPlace(); },
      }, h('small', null, weekdayLabel(p.wd)), h('span', null, p.d),
      h('span', { class: 't-marks' }, (marks.get(d) || []).map((mk) => h('span', { class: `mark mark-${mk.type}`, 'aria-hidden': 'true' }))));
    }))
    : null;

  const dayMarks = days.length === 1 ? agendaMarks(marks.get(days[0]) || []) : null;

  return h('div', { class: `timeline n${days.length}` }, head, dayMarks,
    h('div', { class: 't-body' },
      h('div', { class: 't-gutter' }, hours.map((hr) => h('span', { class: 't-hour' }, `${hr}:00`))),
      cols));
}

function agendaMarks(marks) {
  if (!marks.length) return null;
  return h('div', { class: 'list day-marks' }, marks.map((m) => h('a', { class: 'row mark-row', href: m.type === 'deadline' ? `#/program/${m.program.id}/corners` : `#/ep/${m.occ.key}` },
    h('span', { class: `mark mark-${m.type}`, 'aria-hidden': 'true' }),
    h('span', { class: 'row-main' }, h('strong', null, m.type === 'deadline' ? `${m.program.name} ${m.label}` : m.label),
      h('small', null, `${fmtHM(logicalMin(m.ms, boundary()))}まで`)))));
}

function title() {
  const p = dayParts(st.anchor);
  if (st.view === 'month') return `${p.y}年${p.m}月`;
  if (st.view === 'day') return fmtDay(st.anchor);
  const start = st.anchor - weekdayOf(st.anchor);
  return `${fmtDay(start)}〜${fmtDay(start + 6)}`;
}

function move(dir) {
  if (st.view === 'day') st.anchor += dir;
  else if (st.view === 'week') st.anchor += 7 * dir;
  else {
    const { y, m } = dayParts(st.anchor);
    const nm = new Date(Date.UTC(y, m - 1 + dir, 1));
    st.anchor = Date.UTC(nm.getUTCFullYear(), nm.getUTCMonth(), 1) / DAY_MS;
    st.selected = null;
  }
  renderInPlace();
}

function viewBody() {
  if (st.view === 'month') return monthView();
  if (st.view === 'day') return timeline([st.anchor]);
  const start = st.anchor - weekdayOf(st.anchor);
  return timeline(Array.from({ length: 7 }, (_, i) => start + i));
}

function controls() {
  const seg = [['month', '月'], ['week', '週'], ['day', '日']];
  return h('div', { class: 'cal-ctl' },
    h('div', { class: 'seg', role: 'group', 'aria-label': '表示切替' }, seg.map(([v, label]) => h('button', {
      type: 'button',
      class: st.view === v ? 'on' : '',
      'aria-pressed': String(st.view === v),
      onclick: () => { st.view = v; setSetting('calView', v); st.scrollNow = true; if (st.selected != null && v !== 'month') st.anchor = st.selected; renderInPlace(); },
    }, label))),
    h('div', { class: 'cal-nav' },
      button('‹', () => move(-1), 'icon', { 'aria-label': '前へ' }),
      h('span', { class: 'cal-title', 'aria-live': 'polite' }, title()),
      button('›', () => move(1), 'icon', { 'aria-label': '次へ' }),
      button('今日', () => { st.anchor = today(); st.selected = st.anchor; st.scrollNow = true; renderInPlace(); }, 'small')));
}

function renderInPlace() {
  const box = document.getElementById('cal-box');
  if (!box) return;
  box.replaceChildren(controls(), viewBody());
  scrollToNow();
}

function scrollToNow() {
  if (!st.scrollNow || st.view === 'month') return;
  st.scrollNow = false;
  requestAnimationFrame(() => {
    const body = document.querySelector('.t-body');
    if (!body) return;
    const b = boundary();
    const min = logicalDay(Date.now(), b) >= 0 ? logicalMin(Date.now(), b) - b - 60 : 0;
    const y = body.getBoundingClientRect().top + window.scrollY + (Math.max(min, 0) / 1440) * body.offsetHeight - 120;
    window.scrollTo(0, Math.max(y, 0));
  });
}

export function renderCalendar() {
  st.view = st.view || getSetting('calView', 'month');
  st.anchor = st.anchor ?? today();
  const hasPrograms = all('programs').length > 0;
  const view = page({ title: 'カレンダー', tab: 'calendar', actions: linkButton('＋ 番組', '#/program/new', 'small') },
    hasPrograms ? null : empty('番組を登録すると、放送予定がここに並びます。', h('div', { class: 'row-actions center' },
      linkButton('番組を登録', '#/program/new', 'primary'),
      button('サンプルを追加', () => { addSample(); rerender(); }))),
    backupWarning() ? h('a', { class: 'notice warn', href: '#/settings' }, `${backupWarning()}。設定画面でバックアップしてください`) : null,
    h('div', { id: 'now-cards', class: 'now-cards' }, nowCards()),
    h('div', { id: 'cal-box' }, controls(), viewBody()));
  st.scrollNow = st.view !== 'month';
  setTimeout(scrollToNow, 0);
  return view;
}
