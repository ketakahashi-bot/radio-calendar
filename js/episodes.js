// 放送回の計算。放送回は放送枠から表示時に計算し、個別情報がある回だけ episodes に保存する。

import { all, get, save, getSetting } from './store.js';
import { expand, scheduleMinutes } from './rrule.js';
import { DAY_MS, instant, jstDay, logicalDay, parseHM, ymdToDay, dayToYmd, parseLocalDateTime, fmtDay, fmtHM } from './time.js';

/** 1日は 5:00 に始まる（第2版で固定） */
export const BOUNDARY = 300;
export const boundary = () => BOUNDARY;
export const todayDay = (now = Date.now()) => logicalDay(now, BOUNDARY);

/**
 * カレンダーに出す番組か。アーカイブ済みでも放送期間の終了日があれば、その日までの記録は残す。
 */
export const isProgramActive = (p) => !!p && !p.deleted && (!p.archived || !!p.endDate);

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

/** 放送回の日時を深夜表記で（「11/9(月) 25:00」） */
export const fmtOcc = (o) => `${fmtDay(o.day)} ${fmtHM(o.startMin)}`;

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
  const saved = save('episodes', { ...base, ...patch });
  occ.episode = saved;
  return saved;
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

// ---- 聴き逃し配信の期限（F-TF） ----

export const radikoPlan = () => getSetting('radikoPlan', 'free');
export const radikoDays = () => (radikoPlan() === 'tf30' ? 30 : 7);

/** 聴取手段ごとの聴き逃し期限。radiko は放送開始からプランの日数、それ以外は放送終了からの日数 */
export function catchupExpiry(occ, channel) {
  if (occ.program.timefree === false) return null;
  if (channel.catchupMode === 'radiko') return occ.startMs + radikoDays() * DAY_MS;
  if (channel.catchupMode === 'days' && channel.catchupDays > 0) {
    return occ.endMs + (channel.offsetMin || 0) * 60000 + channel.catchupDays * DAY_MS;
  }
  return null;
}

export const catchupChannels = (programId) => all('channels').filter((c) => c.programId === programId
  && (c.catchupMode === 'radiko' || (c.catchupMode === 'days' && c.catchupDays > 0)));

/** その回を聴ける最後の時刻（聴取手段の中で一番遅いもの）。聴き逃し配信がなければ null */
export function latestExpiry(occ) {
  const list = catchupChannels(occ.program.id).map((c) => catchupExpiry(occ, c)).filter((x) => x != null);
  return list.length ? Math.max(...list) : null;
}

/** 無料タイムフリーの「聴き始めてから24時間・合計3時間」（F-TF-04） */
export function timefreeStatus(occ, now = Date.now()) {
  const ep = occ.episode;
  if (!ep?.tfStartedAt) return null;
  const windowLeft = ep.tfStartedAt + DAY_MS - now;
  const used = ep.listenedMinutes || 0;
  return {
    windowLeftMs: Math.max(windowLeft, 0),
    expired: windowLeft <= 0,
    usedMinutes: used,
    leftMinutes: radikoPlan() === 'free' ? Math.max(180 - used, 0) : null,
  };
}

/** 論理日ごとの締切・聴取期限マーク。返り値: Map<logicalDay, mark[]> */
export function marksInRange(fromDay, toDay) {
  const marks = new Map();
  const add = (ms, mark) => {
    const d = logicalDay(ms, BOUNDARY);
    if (d < fromDay || d > toDay) return;
    if (!marks.has(d)) marks.set(d, []);
    marks.get(d).push({ ...mark, ms });
  };
  for (const c of all('corners')) {
    if (c.status && c.status !== 'active') continue;
    const program = get('programs', c.programId);
    const ms = parseLocalDateTime(c.deadline);
    if (ms == null || !program || program.archived) continue;
    add(ms, { type: 'deadline', program, corner: c, label: `${c.name} 締切` });
  }
  const channels = all('channels').filter((c) => c.catchupMode === 'radiko' || (c.catchupMode === 'days' && c.catchupDays > 0));
  if (channels.length) {
    const maxDays = Math.max(radikoDays(), ...channels.map((c) => (c.catchupDays || 0) + (c.offsetMin || 0) / 1440)) + 1;
    const occs = occurrences(instant(fromDay) - maxDays * DAY_MS, instant(toDay + 2)).filter((o) => o.status !== 'cancelled' && !o.listened);
    for (const occ of occs) {
      for (const ch of channels) {
        if (ch.programId !== occ.program.id) continue;
        const ms = catchupExpiry(occ, ch);
        if (ms != null) add(ms, { type: 'catchup', program: occ.program, occ, channel: ch, label: `${occ.program.name} 聴取期限` });
      }
    }
  }
  for (const list of marks.values()) list.sort((a, b2) => a.ms - b2.ms);
  return marks;
}

/**
 * 未聴の放送回（F-REM-09）。聴き逃し配信がある回は期限内のもの、ない回は直近14日。
 * 返り値は期限の近い順。期限のない回は後ろ。
 */
export function unheard(now = Date.now()) {
  const span = Math.max(radikoDays(), 14, ...all('channels').map((c) => c.catchupDays || 0)) + 1;
  return occurrences(now - span * DAY_MS, now)
    .filter((o) => o.endMs <= now && o.status !== 'cancelled' && !o.listened && o.startMs >= o.program.createdAt)
    .map((o) => ({ ...o, expiry: latestExpiry(o) }))
    .filter((o) => (o.expiry != null ? o.expiry > now : o.endMs > now - 14 * DAY_MS))
    .sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity) || b.startMs - a.startMs);
}

/** 未聴の新着の回（F-FEED-04） */
export const unheardFeedItems = () => all('feedItems')
  .filter((f) => !f.listened && get('programs', f.programId))
  .sort((a, b) => b.publishedAt - a.publishedAt);

export { todayDay as logicalToday };
