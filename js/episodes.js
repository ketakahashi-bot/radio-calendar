// 放送回の計算。放送回は放送枠から表示時に計算し、個別情報がある回だけ episodes に保存する。

import { all, get, save, getSetting } from './store.js';
import { expand, scheduleMinutes } from './rrule.js';
import { DAY_MS, instant, jstDay, logicalDay, parseHM, ymdToDay, dayToYmd, parseLocalDateTime } from './time.js';

export const boundary = () => getSetting('dayBoundary', 300);

export const isProgramActive = (p) => p && !p.deleted && !p.archived;

function withinPeriod(program, day) {
  if (program.startDate && day < ymdToDay(program.startDate)) return false;
  if (program.endDate && day > ymdToDay(program.endDate)) return false;
  return true;
}

function episodeTimes(ep) {
  const start = parseHM(ep.overrideStart);
  let end = parseHM(ep.overrideEnd);
  if (end == null) end = start + 60;
  if (end <= start) end += 1440;
  return { day: ymdToDay(ep.overrideDate || ep.date), start, end };
}

function makeOcc(program, schedule, episode, day, startMin, endMin, key) {
  const status = episode?.status || 'normal';
  return {
    key,
    program,
    schedule,
    episode: episode || null,
    day,
    startMin,
    endMin,
    startMs: instant(day, startMin),
    endMs: instant(day, endMin),
    status,
    title: episode?.title || '',
    listened: !!episode?.listened,
  };
}

const scheduleKey = (sid, ymd) => `s~${sid}~${ymd}`;

function occFromEpisode(ep, program, schedule) {
  const t = episodeTimes(ep);
  const key = ep.scheduleId ? scheduleKey(ep.scheduleId, ep.date) : `e~${ep.id}`;
  return makeOcc(program, schedule, ep, t.day, t.start, t.end, key);
}

export const hasOverride = (ep) => !!(ep && (ep.overrideStart != null && ep.overrideStart !== ''));

/** [fromMs, toMs) と重なる放送回を開始順に返す */
export function occurrences(fromMs, toMs, { programId = null } = {}) {
  const fromDay = jstDay(fromMs) - 2;
  const toDay = jstDay(toMs) + 1;
  const episodes = all('episodes');
  const epIndex = new Map();
  for (const ep of episodes) if (ep.scheduleId) epIndex.set(`${ep.scheduleId}|${ep.date}`, ep);

  const out = [];
  const include = (occ) => { if (occ.endMs > fromMs && occ.startMs < toMs) out.push(occ); };

  for (const s of all('schedules')) {
    if (programId && s.programId !== programId) continue;
    const program = get('programs', s.programId);
    if (!isProgramActive(program)) continue;
    const { start, end } = scheduleMinutes(s);
    for (const day of expand(s, fromDay, toDay)) {
      if (!withinPeriod(program, day)) continue;
      const ymd = dayToYmd(day);
      const ep = epIndex.get(`${s.id}|${ymd}`);
      if (hasOverride(ep)) continue; // 時刻変更された回は下でまとめて扱う
      include(makeOcc(program, s, ep, day, start, end, scheduleKey(s.id, ymd)));
    }
  }
  for (const ep of episodes) {
    if (!hasOverride(ep)) continue;
    if (programId && ep.programId !== programId) continue;
    const program = get('programs', ep.programId);
    if (!isProgramActive(program)) continue;
    const schedule = ep.scheduleId ? get('schedules', ep.scheduleId) : null;
    if (ep.scheduleId && !schedule) continue;
    include(occFromEpisode(ep, program, schedule));
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** ルート用のキーから放送回を復元（アーカイブ番組でも表示できるように） */
export function occurrenceByKey(key) {
  const parts = key.split('~');
  if (parts[0] === 'e') {
    const ep = get('episodes', parts[1]);
    if (!ep) return null;
    const program = get('programs', ep.programId);
    return program ? occFromEpisode(ep, program, null) : null;
  }
  const [, sid, ymd] = parts;
  const schedule = get('schedules', sid);
  if (!schedule) return null;
  const program = get('programs', schedule.programId);
  if (!program) return null;
  const ep = all('episodes').find((e) => e.scheduleId === sid && e.date === ymd);
  if (hasOverride(ep)) return occFromEpisode(ep, program, schedule);
  const { start, end } = scheduleMinutes(schedule);
  return makeOcc(program, schedule, ep, ymdToDay(ymd), start, end, key);
}

/** 放送回を実体化して保存する */
export function saveEpisode(occ, patch) {
  const base = occ.episode || {
    programId: occ.program.id,
    scheduleId: occ.schedule?.id || null,
    date: dayToYmd(occ.day),
    status: 'normal',
    listened: false,
  };
  return save('episodes', { ...base, ...patch });
}

export function nowNext(now = Date.now()) {
  const live = occurrences(now - DAY_MS, now + 35 * DAY_MS).filter((o) => o.status !== 'cancelled');
  return {
    onAir: live.filter((o) => o.startMs <= now && now < o.endMs),
    next: live.find((o) => o.startMs > now) || null,
  };
}

export function nextByProgram(now = Date.now()) {
  const map = new Map();
  for (const o of occurrences(now, now + 35 * DAY_MS)) {
    if (o.status !== 'cancelled' && !map.has(o.program.id)) map.set(o.program.id, o);
  }
  return map;
}

/** 聴取手段ごとの聴き逃し期限 */
export function catchupExpiry(occ, channel) {
  if (!channel.catchupDays) return null;
  return occ.endMs + (channel.offsetMin || 0) * 60000 + channel.catchupDays * DAY_MS;
}

/** 論理日ごとの締切・聴き逃し期限マーク。返り値: Map<logicalDay, mark[]> */
export function marksInRange(fromDay, toDay) {
  const b = boundary();
  const marks = new Map();
  const add = (ms, mark) => {
    const d = logicalDay(ms, b);
    if (d < fromDay || d > toDay) return;
    if (!marks.has(d)) marks.set(d, []);
    marks.get(d).push({ ...mark, ms });
  };
  for (const c of all('corners')) {
    if (c.status && c.status !== 'active') continue;
    const program = get('programs', c.programId);
    const ms = parseLocalDateTime(c.deadline);
    if (ms == null || !isProgramActive(program)) continue;
    add(ms, { type: 'deadline', program, corner: c, label: `${c.name} 締切` });
  }
  const channels = all('channels').filter((c) => c.catchupDays > 0);
  if (channels.length) {
    const maxDays = Math.max(...channels.map((c) => c.catchupDays + (c.offsetMin || 0) / 1440));
    const from = instant(fromDay) - (maxDays + 1) * DAY_MS;
    const occs = occurrences(from, instant(toDay + 2)).filter((o) => o.status !== 'cancelled' && !o.listened);
    for (const occ of occs) {
      for (const ch of channels) {
        if (ch.programId !== occ.program.id) continue;
        add(catchupExpiry(occ, ch), { type: 'catchup', program: occ.program, occ, channel: ch, label: `${occ.program.name} 聴き逃し期限` });
      }
    }
  }
  for (const list of marks.values()) list.sort((a, b2) => a.ms - b2.ms);
  return marks;
}

/** 未聴の放送回（直近14日、番組登録より後のもの） */
export function unheard(now = Date.now()) {
  return occurrences(now - 14 * DAY_MS, now)
    .filter((o) => o.endMs <= now && o.status !== 'cancelled' && !o.listened && o.startMs >= o.program.createdAt)
    .reverse();
}
