// データ形式の版数と移行（F-MIG-09）。古いバックアップもこの関数を通して今の形式にする。
//   版1: 最初のリリース
//   版2: 要件定義書 第2版（ハッシュタグ複数、X アカウント、聴き逃し配信の方式、日の区切り 5:00 固定 など）

import { parseRHM } from './rrule-lite.js';

export const DATA_VERSION = 2;

const DAY = 86400000;
const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const pad = (n) => String(n).padStart(2, '0');

function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * 0:00〜4:59 開始で登録された毎週・隔週・単発の放送枠を、前日の 24:00〜28:59 表記に直す。
 * 実際の放送日時は変わらない。毎月第n曜日は前日の曜日に直せないことがあるので、そのまま残す。
 */
function toLateNight(schedule, episodes) {
  const start = parseRHM(schedule.start);
  if (start == null || start >= 300) return schedule;
  const rule = schedule.rrule || '';
  if (/FREQ=MONTHLY/.test(rule)) return schedule;
  let end = parseRHM(schedule.end);
  if (end == null) end = start + 60;
  if (end <= start) end += 1440;
  const fmt = (m) => `${Math.floor(m / 60)}:${pad(m % 60)}`;
  const nextRule = rule.replace(/BYDAY=([A-Z,]+)/, (_, days) => `BYDAY=${days.split(',').map((c) => CODES[(CODES.indexOf(c) + 6) % 7]).join(',')}`)
    .replace(/WKST=([A-Z]{2})/, (_, c) => `WKST=${CODES[(CODES.indexOf(c) + 6) % 7]}`);
  for (const ep of episodes) {
    if (ep.scheduleId === schedule.id) {
      ep.date = shiftYmd(ep.date, -1);
      if (ep.overrideDate && ep.overrideStart && parseRHM(ep.overrideStart) < 300) {
        ep.overrideDate = shiftYmd(ep.overrideDate, -1);
        ep.overrideStart = fmt(parseRHM(ep.overrideStart) + 1440);
        if (ep.overrideEnd) ep.overrideEnd = fmt(parseRHM(ep.overrideEnd) + 1440);
      }
    }
  }
  return { ...schedule, dtstart: shiftYmd(schedule.dtstart, -1), start: fmt(start + 1440), end: fmt(end + 1440), rrule: nextRule };
}

function v1to2(data) {
  const t = data.tables;
  const episodes = (t.episodes || []).map((e) => ({ ...e }));
  t.programs = (t.programs || []).map((p) => {
    const next = { ...p };
    if (!Array.isArray(next.hashtags)) next.hashtags = p.hashtag ? [p.hashtag] : [];
    delete next.hashtag;
    if (!Array.isArray(next.xAccounts)) next.xAccounts = [];
    if (next.timefree == null) next.timefree = true;
    // 番組画像は権利の都合で扱わない方針になったので、汎用アイコンに切り替える
    if (next.icon && String(next.icon).startsWith('data:')) { next.legacyIcon = next.icon; next.icon = ''; }
    return next;
  });
  t.schedules = (t.schedules || []).map((s) => toLateNight(s, episodes));
  t.episodes = episodes;
  t.channels = (t.channels || []).map((c) => ({
    ...c,
    catchupMode: c.catchupMode ?? (c.catchupDays > 0 ? 'days' : ''),
  }));
  t.contacts = (t.contacts || []).map((c) => (c.type === 'hashtag' ? { ...c, type: 'xhashtag' } : c));
  const settings = { ...data.settings };
  delete settings.dayBoundary; // 5:00 固定になった
  return { ...data, version: 2, tables: t, settings };
}

export function migrateData(input) {
  let data = { ...input, tables: { ...input.tables }, settings: { ...(input.settings || {}) } };
  if ((data.version || 1) < 2) data = v1to2(data);
  return data;
}
