// 端末のデータから「Google 側にあるべき状態」を組み立てる純粋な処理。
// 差分を取って送ることで、追加・更新・削除とオフライン時の再送を一つの仕組みで扱う（F-REM-03, F-GGL-03）。

import { all, get, byProgram, getSetting } from './store.js';
import { googleSeries, scheduleMinutes, describeSchedule } from './rrule.js';
import { TZ, instant, isoJst, jstDay, ymdToDay, dayParts, monthStart, parseHM, fmtHM, fmtInstant, parseLocalDateTime, dayToYmd, weekdayLabel, weekdayOf } from './time.js';
import { colorIdOf, mediaLabel } from './domain.js';
import { hasOverride, isProgramActive, radikoDays } from './episodes.js';

const MAX_REMINDERS = 5; // Google カレンダーの上限

function reminders(minutes) {
  const list = [...new Set(minutes || [])].sort((a, b) => a - b).slice(0, MAX_REMINDERS);
  return { useDefault: false, overrides: list.map((m) => ({ method: 'popup', minutes: m })) };
}

export function channelLine(ch) {
  const freq = ch.frequency ? ` ${ch.frequency}${ch.unit || ''}` : '';
  const head = [mediaLabel(ch.mediaType), ch.station].filter(Boolean).join(' ');
  return `${head}${freq}${ch.url ? `: ${ch.url}` : ''}`;
}

function description(program) {
  const lines = [];
  const channels = byProgram('channels', program.id);
  if (channels.length) lines.push('▼聴く', ...channels.map(channelLine));
  const corners = byProgram('corners', program.id).filter((c) => (c.status || 'active') === 'active');
  if (corners.length) {
    lines.push('', '▼コーナー');
    for (const c of corners) {
      const ms = parseLocalDateTime(c.deadline);
      const extra = [c.topic || c.theme, ms != null ? `締切 ${fmtInstant(ms)}` : ''].filter(Boolean).join(' / ');
      lines.push(`・${c.name}${extra ? `（${extra}）` : ''}`);
    }
  }
  const contacts = byProgram('contacts', program.id);
  if (contacts.length) {
    lines.push('', '▼投稿先');
    for (const c of contacts) lines.push(`・${c.label ? c.label + ': ' : ''}${c.value}`);
  }
  if (program.url) lines.push('', `▼番組公式: ${program.url}`);
  return lines.join('\n').trim();
}

function basePayload(program, summary, startMs, endMs, reminderMinutes) {
  return {
    summary,
    location: program.station || '',
    description: description(program),
    colorId: colorIdOf(program.color),
    start: { dateTime: isoJst(startMs), timeZone: TZ },
    end: { dateTime: isoJst(endMs), timeZone: TZ },
    reminders: reminders(reminderMinutes),
  };
}

/** RDATE で列挙するときの上限。年単位で固定し、差分が毎日出ないようにする */
function horizonDay(now) {
  return monthStart(dayParts(jstDay(now)).y + 3, 1);
}

/** タイムフリー非対応の番組は、放送開始の通知を必ず入れる（F-TF-05） */
function broadcastReminders(program, minutes) {
  const list = minutes ?? program.reminders ?? [15];
  return program.timefree === false && !list.length ? [0] : list;
}

/** 予定のタイトルに添える深夜表記（「月25:00」）。24時以降の放送だけ */
function lateNightLabel(day, startMin) {
  return startMin >= 1440 ? `（${weekdayLabel(weekdayOf(day))}${fmtHM(startMin)}）` : '';
}

/** 締切や聴取期限を個別に通知するか（F-NTF-05）。初期設定では今日のまとめに集約する */
const individual = (x) => x?.individualNotify === true;

const needsOwnEvent = (ep) => ep.status === 'special' || ep.status === 'changed' || hasOverride(ep) || Array.isArray(ep.reminders);

const STATUS_PREFIX = { special: '【特番】', changed: '【時間変更】' };

export function buildDesired(now = Date.now()) {
  const out = new Map();
  if (!getSetting('syncEnabled', true)) return out;
  const withCatchup = getSetting('syncCatchup', false);
  const withDeadlines = getSetting('syncDeadlines', true);
  const horizon = horizonDay(now);

  for (const program of all('programs')) {
    if (!isProgramActive(program) || program.syncEnabled === false) continue;
    const startDay = program.startDate ? ymdToDay(program.startDate) : null;
    const endDay = program.endDate ? ymdToDay(program.endDate) : null;
    const episodes = byProgram('episodes', program.id);
    const channels = byProgram('channels', program.id).filter((c) => c.catchupMode === 'radiko' || (c.catchupMode === 'days' && c.catchupDays > 0));

    for (const s of byProgram('schedules', program.id)) {
      const { start, end } = scheduleMinutes(s);
      const own = episodes.filter((e) => e.scheduleId === s.id);
      const exDays = own.filter((e) => e.status === 'cancelled' || needsOwnEvent(e)).map((e) => ymdToDay(e.date));

      const series = googleSeries(s, { offsetMin: start, exDays, startDay, endDay, horizonDay: horizon });
      if (series) {
        const title = `${program.name}${lateNightLabel(series.firstDay, start)}`;
        const payload = basePayload(program, title, instant(series.firstDay, start), instant(series.firstDay, end), broadcastReminders(program));
        payload.recurrence = series.lines;
        out.set(`sch:${s.id}`, { kind: 'event', payload });
      }

      if (withCatchup || individual(program)) {
        for (const ch of channels) {
          if (program.timefree === false) continue;
          const offset = ch.catchupMode === 'radiko'
            ? start + radikoDays() * 1440
            : end + (ch.offsetMin || 0) + ch.catchupDays * 1440;
          const cancelled = own.filter((e) => e.status === 'cancelled').map((e) => ymdToDay(e.date));
          const cs = googleSeries(s, { offsetMin: offset, exDays: cancelled, startDay, endDay, horizonDay: horizon });
          if (!cs) continue;
          const name = [mediaLabel(ch.mediaType), ch.station].filter(Boolean).join(' ');
          const payload = basePayload(program, `⏳ 聴取期限: ${program.name}（${name}）`, instant(cs.firstDay, offset - 15), instant(cs.firstDay, offset), individual(program) ? [1440] : []);
          payload.recurrence = cs.lines;
          out.set(`cu:${s.id}:${ch.id}`, { kind: 'event', payload });
        }
      }
    }

    for (const ep of episodes) {
      if (ep.status === 'cancelled') continue;
      if (ep.scheduleId && !needsOwnEvent(ep)) continue;
      const schedule = ep.scheduleId ? get('schedules', ep.scheduleId) : null;
      if (ep.scheduleId && !schedule) continue;
      const day = ymdToDay(ep.overrideDate || ep.date);
      let startMin;
      let endMin;
      if (hasOverride(ep)) {
        startMin = parseHM(ep.overrideStart);
        endMin = parseHM(ep.overrideEnd);
        if (endMin == null) endMin = startMin + 60;
        if (endMin <= startMin) endMin += 1440;
      } else {
        ({ start: startMin, end: endMin } = scheduleMinutes(schedule));
      }
      const label = `${STATUS_PREFIX[ep.status] || ''}${program.name}${ep.title ? ` ${ep.title}` : ''}${lateNightLabel(day, startMin)}`;
      const payload = basePayload(program, label, instant(day, startMin), instant(day, endMin), broadcastReminders(program, Array.isArray(ep.reminders) ? ep.reminders : null));
      out.set(`ep:${ep.id}`, { kind: 'event', payload });
    }

    for (const c of byProgram('corners', program.id)) {
      const ms = parseLocalDateTime(c.deadline);
      if (ms == null || (c.status && c.status !== 'active') || program.archived) continue;
      if (withDeadlines) {
        out.set(`task:${c.id}`, {
          kind: 'task',
          payload: {
            title: `${program.name} ${c.name} 締切`,
            notes: [`締切 ${fmtInstant(ms)}`, c.topic || c.theme || ''].filter(Boolean).join('\n'),
            due: `${dayToYmd(jstDay(ms))}T00:00:00.000Z`,
          },
        });
      }
      if (individual(c) && ms > now) {
        out.set(`dl:${c.id}`, { kind: 'event', payload: basePayload(program, `✉ 締切: ${program.name} ${c.name}`, ms - 15 * 60000, ms, [1440, 60]) });
      }
    }
  }
  return out;
}

export { describeSchedule };
