// 「今日のまとめ」（F-NTF-04）の材料。
// 通知は GAS が毎朝の予定として作る。アプリを開いていない日もまとめが届くよう、14日分を先に計算して渡す。
// 新着の回の件数・RSS の失敗・バックアップの遅れは GAS 側で足す。

import { all, get, getSetting } from './store.js';
import { occurrences, latestExpiry, BOUNDARY } from './episodes.js';
import { DAY_MS, instant, logicalDay, logicalMin, fmtHM, dayToYmd, dayParts, fmtDay, parseHM, parseLocalDateTime, fmtRemaining, jstDay } from './time.js';

const DAYS = 14;
const TONIGHT_FROM = 17 * 60; // 「今夜の番組」は 17:00〜28:59 開始

export const summaryTime = () => getSetting('summaryTime', '7:00');

/** 改編期（4月・10月）の前、3月と9月の後半に見直しを促す（F-CHG-01） */
export function isKaihenSeason(day) {
  const { m, d } = dayParts(day);
  return (m === 3 || m === 9) && d >= 15;
}

export function buildDigest(now = Date.now()) {
  const time = parseHM(summaryTime()) ?? 420;
  const startDay = jstDay(now);
  const occs = occurrences(instant(startDay - 31), instant(startDay + DAYS + 2)).filter((o) => o.status !== 'cancelled');
  const corners = all('corners')
    .map((c) => ({ c, ms: parseLocalDateTime(c.deadline), program: get('programs', c.programId) }))
    .filter((x) => x.ms != null && x.program && !x.program.archived && (x.c.status || 'active') === 'active');
  const days = {};
  for (let day = startDay; day < startDay + DAYS; day++) {
    const at = instant(day, time); // まとめが届く時刻（実際の日付の朝）
    const tonight = occs
      .filter((o) => logicalDay(o.startMs, BOUNDARY) === day && logicalMin(o.startMs, BOUNDARY) >= TONIGHT_FROM)
      .map((o) => `${fmtHM(logicalMin(o.startMs, BOUNDARY))} ${o.program.name}${o.title ? ` ${o.title}` : ''}`);
    const deadlines = corners
      .filter(({ ms }) => { const d = logicalDay(ms, BOUNDARY); return ms > at && (d === day || d === day + 1); })
      .sort((a, b) => a.ms - b.ms)
      .map(({ c, ms, program }) => `${logicalDay(ms, BOUNDARY) === day ? '今日' : '明日'} ${fmtHM(logicalMin(ms, BOUNDARY))} ${program.name} ${c.name}${c.topic ? `（${c.topic}）` : ''}`);
    const expiring = occs
      .filter((o) => !o.listened && o.endMs <= at && o.startMs >= o.program.createdAt)
      .map((o) => ({ o, exp: latestExpiry(o) }))
      .filter(({ exp }) => exp != null && exp > at && exp - at <= DAY_MS)
      .map(({ o, exp }) => `${o.program.name} ${fmtDay(o.day)}の回（あと${fmtRemaining(exp - at)}）`);
    const notes = [];
    if (getSetting('kaihenNotice', true) && isKaihenSeason(day)) notes.push('改編期が近づいています。登録した番組の放送枠を見直しましょう');
    days[dayToYmd(day)] = { tonight, deadlines, expiring, notes };
  }
  return { time: fmtHM(time), enabled: getSetting('summaryEnabled', true), days };
}
