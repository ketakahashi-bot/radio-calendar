// 番組情報の共有ファイル（F-SHARE）。メモ・投稿履歴・ラジオネームなどの個人的な情報は含めない。

import { all, byProgram, get, save, remove } from './store.js';
import { uuid } from './store.js';

export const SHARE_APP = 'radio-calendar-share';
export const SHARE_VERSION = 1;

const PROGRAM_FIELDS = ['name', 'personality', 'station', 'genre', 'url', 'color', 'icon', 'hashtags', 'xAccounts', 'timefree', 'startDate', 'endDate', 'reminders'];
const SCHEDULE_FIELDS = ['dtstart', 'start', 'end', 'rrule', 'tz'];
const CHANNEL_FIELDS = ['mediaType', 'station', 'frequency', 'unit', 'url', 'region', 'offsetMin', 'catchupMode', 'catchupDays', 'rssUrl', 'rssKind', 'feedInclude', 'feedExclude', 'radikoStation'];
const CORNER_FIELDS = ['name', 'description', 'theme', 'topic', 'deadline', 'frequency', 'status', 'order'];
const CONTACT_FIELDS = ['type', 'label', 'value', 'subjectTemplate'];

const pick = (row, fields) => Object.fromEntries(fields.filter((f) => row[f] !== undefined && row[f] !== null && row[f] !== '').map((f) => [f, row[f]]));

export function buildShareFile(programIds) {
  const programs = programIds.map((id) => get('programs', id)).filter(Boolean).map((p) => {
    const corners = byProgram('corners', p.id);
    const cornerIndex = new Map(corners.map((c, i) => [c.id, i]));
    return {
      program: pick(p, PROGRAM_FIELDS),
      schedules: byProgram('schedules', p.id).map((s) => pick(s, SCHEDULE_FIELDS)),
      channels: byProgram('channels', p.id).map((c) => pick(c, CHANNEL_FIELDS)),
      corners: corners.map((c) => pick(c, CORNER_FIELDS)),
      // コーナーとの紐付けは、ファイル内の並び順で表す
      contacts: byProgram('contacts', p.id).map((c) => ({ ...pick(c, CONTACT_FIELDS), corners: (c.cornerIds || []).map((id) => cornerIndex.get(id)).filter((i) => i != null) })),
    };
  });
  return { app: SHARE_APP, version: SHARE_VERSION, exportedAt: new Date().toISOString(), programs };
}

export function parseShareFile(json) {
  if (!json || json.app !== SHARE_APP || !Array.isArray(json.programs)) throw new Error('番組の共有ファイルではありません');
  if ((json.version || 1) > SHARE_VERSION) throw new Error('新しい版のアプリで作られたファイルです。アプリを更新してください');
  for (const item of json.programs) {
    if (!item?.program?.name) throw new Error('番組名のないデータが含まれています');
  }
  return json.programs;
}

export const findSameProgram = (item) => all('programs').find((p) => p.name === item.program.name);

function addChildren(programId, item) {
  for (const s of item.schedules || []) save('schedules', { ...pick(s, SCHEDULE_FIELDS), programId }, { silent: true });
  for (const c of item.channels || []) save('channels', { ...pick(c, CHANNEL_FIELDS), programId }, { silent: true });
  const cornerIds = (item.corners || []).map((c) => save('corners', { ...pick(c, CORNER_FIELDS), programId }, { silent: true }).id);
  for (const c of item.contacts || []) {
    save('contacts', { ...pick(c, CONTACT_FIELDS), programId, cornerIds: (c.corners || []).map((i) => cornerIds[i]).filter(Boolean) }, { silent: true });
  }
}

const sameContent = (a, b, fields) => JSON.stringify(pick(a, fields)) === JSON.stringify(pick(b, fields));

/**
 * 番組にぶら下がるデータを、取り込んだ内容に合わせる。内容が同じ行はそのまま残し（ID を保つ）、
 * なくなった行は削除、新しい行は追加する。ID を保つことで、休止・聴取済み・投稿履歴などの紐付けが切れない。
 * 返り値は取り込んだ行の並び順に対応する ID。
 */
function mergeRows(table, fields, programId, incoming, extra = () => ({})) {
  const existing = byProgram(table, programId);
  const used = new Set();
  const ids = incoming.map((row, i) => {
    const match = existing.find((e) => !used.has(e.id) && sameContent(e, row, fields));
    if (match) {
      used.add(match.id);
      const next = extra(row, i);
      if (Object.keys(next).length) save(table, { ...match, ...next }, { silent: true });
      return match.id;
    }
    return save(table, { ...pick(row, fields), ...extra(row, i), programId }, { silent: true }).id;
  });
  for (const e of existing) if (!used.has(e.id)) remove(table, e.id, { silent: true });
  return ids;
}

/**
 * 取り込む。mode: 'add'（別の番組として追加）/ 'overwrite'（同名の番組の登録内容を置き換え）/ 'skip'
 * 上書きでも、メモ・投稿履歴・ラジオネーム・聴取の記録は残す。
 */
export function importShareItem(item, mode) {
  const same = findSameProgram(item);
  if (mode === 'skip') return null;
  if (mode === 'overwrite' && same) {
    const program = save('programs', { ...same, ...pick(item.program, PROGRAM_FIELDS) }, { silent: true });
    mergeRows('schedules', SCHEDULE_FIELDS, program.id, item.schedules || []);
    mergeRows('channels', CHANNEL_FIELDS, program.id, item.channels || []);
    const cornerIds = mergeRows('corners', CORNER_FIELDS, program.id, item.corners || []);
    mergeRows('contacts', CONTACT_FIELDS, program.id, item.contacts || [], (c) => ({ cornerIds: (c.corners || []).map((i) => cornerIds[i]).filter(Boolean) }));
    save('programs', program);
    return program;
  }
  const program = save('programs', { ...pick(item.program, PROGRAM_FIELDS), id: uuid(), syncEnabled: true }, { silent: true });
  addChildren(program.id, item);
  save('programs', program);
  return program;
}
