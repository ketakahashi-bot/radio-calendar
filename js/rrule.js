// 放送枠の繰り返しルール（RRULE のサブセット）。
// 放送枠は「番組表上の曜日」で保持する。土曜 25:00 の番組なら BYDAY=SA。
// 実際の放送は翌日になるため、Google カレンダーへ送るときは googleSeries() が曜日をずらす。

import { ymdToDay, dayParts, daysInMonth, weekdayOf, weekdayLabel, fmtHM, parseHM, instant, icalLocal, icalUtc, fmtDay } from './time.js';

const CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseRRule(str) {
  if (!str) return null;
  const parts = Object.fromEntries(str.split(';').map((p) => p.split('=')));
  const byday = (parts.BYDAY || '').split(',').filter(Boolean).map((token) => {
    const m = token.match(/^(-?\d)?([A-Z]{2})$/);
    return { n: m[1] ? Number(m[1]) : null, wd: CODE.indexOf(m[2]) };
  });
  return { freq: parts.FREQ, interval: Number(parts.INTERVAL || 1), byday };
}

/** 入力フォームの値から RRULE を組み立てる。単発は空文字。 */
export function buildRRule({ repeat, days = [], nths = [] }) {
  const sorted = [...days].sort((a, b) => a - b);
  if (repeat === 'once') return '';
  if (repeat === 'weekly') return `FREQ=WEEKLY;BYDAY=${sorted.map((d) => CODE[d]).join(',')}`;
  if (repeat === 'biweekly') return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${sorted.map((d) => CODE[d]).join(',')}`;
  if (repeat === 'monthly') {
    const tokens = [];
    for (const n of nths) for (const d of sorted) tokens.push(`${n}${CODE[d]}`);
    return `FREQ=MONTHLY;BYDAY=${tokens.join(',')}`;
  }
  throw new Error(`unknown repeat: ${repeat}`);
}

export function rruleToForm(rrule) {
  const r = parseRRule(rrule);
  if (!r) return { repeat: 'once', days: [], nths: [] };
  const days = [...new Set(r.byday.map((b) => b.wd))];
  if (r.freq === 'MONTHLY') return { repeat: 'monthly', days, nths: [...new Set(r.byday.map((b) => b.n))] };
  return { repeat: r.interval === 2 ? 'biweekly' : 'weekly', days, nths: [] };
}

const weekIndex = (day) => Math.floor((day + 4) / 7); // 日曜始まりの通算週（1970-01-01 は木曜）

function matchesMonthly(day, byday) {
  const p = dayParts(day);
  return byday.some((b) => {
    if (b.wd !== p.wd) return false;
    if (b.n === -1) return p.d + 7 > daysInMonth(p.y, p.m);
    return Math.ceil(p.d / 7) === b.n;
  });
}

/** [fromDay, toDay] に含まれる放送日（番組表上の日）を返す */
export function expand(schedule, fromDay, toDay) {
  const first = ymdToDay(schedule.dtstart);
  const rule = parseRRule(schedule.rrule);
  if (!rule) return first >= fromDay && first <= toDay ? [first] : [];
  const out = [];
  const wds = new Set(rule.byday.map((b) => b.wd));
  for (let d = Math.max(first, fromDay); d <= toDay; d++) {
    if (rule.freq === 'WEEKLY') {
      if (!wds.has(weekdayOf(d))) continue;
      if ((weekIndex(d) - weekIndex(first)) % rule.interval !== 0) continue;
      out.push(d);
    } else if (rule.freq === 'MONTHLY' && matchesMonthly(d, rule.byday)) {
      out.push(d);
    }
  }
  return out;
}

/** 開始・終了の分を返す。終了が開始以前なら翌日にまたがるとみなす。 */
export function scheduleMinutes(s) {
  const start = parseHM(s.start);
  let end = parseHM(s.end);
  if (end <= start) end += 1440;
  return { start, end };
}

const nthLabel = (n) => (n === -1 ? '最終' : `第${n}`);

export function describeSchedule(s) {
  const time = `${s.start}〜${s.end}`;
  const r = parseRRule(s.rrule);
  if (!r) return `単発 ${fmtDay(ymdToDay(s.dtstart))} ${time}`;
  const days = [...new Set(r.byday.map((b) => b.wd))].sort((a, b) => a - b).map(weekdayLabel).join('・');
  if (r.freq === 'MONTHLY') {
    const nths = [...new Set(r.byday.map((b) => b.n))].map(nthLabel).join('・');
    return `毎月${nths} ${days}曜 ${time}`;
  }
  return `${r.interval === 2 ? '隔週' : '毎週'} ${days}曜 ${time}`;
}

const shiftCode = (wd, shift) => CODE[(wd + shift) % 7];

/**
 * Google カレンダーの繰り返し予定を組み立てる。
 * offsetMin は番組表上の日の 0:00 からの分（25:00 なら 1500、聴き逃し期限なら数日分）。
 * その分だけ実際の曜日がずれるので、BYDAY / WKST / 月内の日付を補正する。
 * 返り値: { firstDay, lines } / 該当する放送がなければ null
 */
export function googleSeries(schedule, { offsetMin, exDays = [], startDay = null, endDay = null, horizonDay }) {
  const lower = Math.max(ymdToDay(schedule.dtstart), startDay ?? -Infinity);
  const upper = Math.min(endDay ?? Infinity, horizonDay);
  const candidates = expand(schedule, lower, Math.min(lower + 800, upper));
  if (!candidates.length) return null;
  const firstDay = candidates[0];
  const rule = parseRRule(schedule.rrule);
  const lines = [];
  if (rule) {
    const shift = Math.floor(offsetMin / 1440);
    const until = endDay != null ? `;UNTIL=${icalUtc(instant(endDay, offsetMin))}` : '';
    let rrule = null;
    if (rule.freq === 'WEEKLY') {
      const days = rule.byday.map((b) => shiftCode(b.wd, shift)).join(',');
      const interval = rule.interval > 1 ? `;INTERVAL=${rule.interval};WKST=${shiftCode(0, shift)}` : '';
      rrule = `FREQ=WEEKLY${interval};BYDAY=${days}${until}`;
    } else if (shift === 0) {
      rrule = `FREQ=MONTHLY;BYDAY=${rule.byday.map((b) => `${b.n}${CODE[b.wd]}`).join(',')}${until}`;
    } else if (rule.byday.length === 1 && rule.byday[0].n > 0 && rule.byday[0].n * 7 + shift <= 28) {
      // 第2土曜の翌日は「第2日曜」とは限らないので、月内の日付の範囲で指定する
      const { n, wd } = rule.byday[0];
      const monthDays = Array.from({ length: 7 }, (_, i) => (n - 1) * 7 + 1 + i + shift).join(',');
      rrule = `FREQ=MONTHLY;BYDAY=${shiftCode(wd, shift)};BYMONTHDAY=${monthDays}${until}`;
    }
    if (rrule) {
      lines.push(`RRULE:${rrule}`);
    } else {
      // 月をまたぐ場合（第5・最終の深夜など）は RRULE で表せないので日付を列挙する
      const rest = expand(schedule, firstDay + 1, upper);
      if (rest.length) lines.push(`RDATE;TZID=Asia/Tokyo:${rest.map((d) => icalLocal(instant(d, offsetMin))).join(',')}`);
    }
  }
  const ex = exDays.filter((d) => d >= firstDay && (!rule ? false : true));
  if (ex.length) lines.push(`EXDATE;TZID=Asia/Tokyo:${ex.map((d) => icalLocal(instant(d, offsetMin))).join(',')}`);
  if (!rule && exDays.includes(firstDay)) return null; // 単発が休止なら予定なし
  return { firstDay, lines };
}
