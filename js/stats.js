// 振り返り（F-STAT）。端末内のデータだけで集計し、外部には送らない。

import { all, get } from './store.js';
import { occurrences, BOUNDARY } from './episodes.js';
import { instant, logicalDay, dayParts, monthStart, daysInMonth, ymdToDay } from './time.js';

/** 月ごとの数値。month は { y, m } */
export function monthStats({ y, m }, now = Date.now()) {
  const from = monthStart(y, m);
  const to = from + daysInMonth(y, m); // 翌月1日
  const inMonth = (ms) => { const d = logicalDay(ms, BOUNDARY); return d >= from && d < to; };
  const occs = occurrences(instant(from, BOUNDARY), Math.min(instant(to, BOUNDARY), now))
    .filter((o) => o.status !== 'cancelled' && o.endMs <= now && o.startMs >= o.program.createdAt && inMonth(o.startMs));
  const feed = all('feedItems').filter((f) => inMonth(f.publishedAt));
  const logs = all('postLogs');
  // 読まれた日は放送日で記録している
  const readLogs = logs.filter((l) => l.read && l.readDate && ymdToDay(l.readDate) >= from && ymdToDay(l.readDate) < to);
  return {
    listened: occs.filter((o) => o.listened).length + feed.filter((f) => f.listened).length,
    missed: occs.filter((o) => !o.listened).length,
    posts: logs.filter((l) => inMonth(l.postedAt)).length,
    read: readLogs.length,
  };
}

const weekOf = (day) => Math.floor((day + 4) / 7); // 日曜始まりの通算週

/** 番組ごとに何週続けて聴いているか（F-STAT-02）。今週まだ聴いていなくても先週まで続いていれば数える */
export function streaks(now = Date.now()) {
  const listenedWeeks = new Map();
  const mark = (programId, day) => {
    if (!listenedWeeks.has(programId)) listenedWeeks.set(programId, new Set());
    listenedWeeks.get(programId).add(weekOf(day));
  };
  for (const e of all('episodes')) if (e.listened) mark(e.programId, ymdToDay(e.date));
  for (const f of all('feedItems')) if (f.listened) mark(f.programId, logicalDay(f.publishedAt, BOUNDARY));
  const thisWeek = weekOf(logicalDay(now, BOUNDARY));
  const out = [];
  for (const [programId, weeks] of listenedWeeks) {
    const program = get('programs', programId);
    if (!program) continue;
    let w = weeks.has(thisWeek) ? thisWeek : thisWeek - 1;
    let n = 0;
    while (weeks.has(w)) { n++; w--; }
    out.push({ program, weeks: n });
  }
  return out.sort((a, b) => b.weeks - a.weeks);
}

/** 採用率（F-POST-06）。番組別・コーナー別 */
export function adoption() {
  const rows = new Map();
  for (const l of all('postLogs')) {
    const program = get('programs', l.programId);
    if (!program) continue;
    const corner = l.cornerId ? get('corners', l.cornerId) : null;
    const key = `${l.programId}|${l.cornerId || ''}`;
    if (!rows.has(key)) rows.set(key, { program, corner, posts: 0, read: 0 });
    const r = rows.get(key);
    r.posts++;
    if (l.read) r.read++;
  }
  return [...rows.values()].sort((a, b) => a.program.name.localeCompare(b.program.name, 'ja') || (a.corner ? 1 : -1));
}

export const monthOf = (ms) => { const p = dayParts(logicalDay(ms, BOUNDARY)); return { y: p.y, m: p.m }; };
