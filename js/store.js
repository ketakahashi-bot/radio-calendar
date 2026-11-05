// 端末内データ。IndexedDB を正とし、起動時に全件をメモリへ読み込んで同期的に扱う。
// 全エンティティは id / createdAt / updatedAt / deleted（論理削除）を持つ。

import { migrateData, DATA_VERSION } from './migrate.js';

export const TABLES = [
  'programs', 'schedules', 'episodes', 'channels', 'corners', 'contacts', 'memos', 'presets', 'templates',
  'postLogs', 'radioNames', 'ideas', 'feedItems',
];
const DB_NAME = globalThis.__RADIO_DB_NAME__ || 'radio-calendar';
const DB_VERSION = 2;
const AUX = ['kv', 'gcalMap', 'syncQueue', 'snapshots'];
const KEEP_SNAPSHOTS = 5;

let db = null;
let tables = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
export const kv = new Map();
export const gcalMap = new Map(); // key -> { id, hash, kind }
export const syncQueue = new Map(); // key -> { op, key, kind, id, payload, hash, attempts, error }
const listeners = new Set();

export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      for (const t of TABLES) if (!names.contains(t)) req.result.createObjectStore(t, { keyPath: 'id' });
      for (const t of AUX) if (!names.contains(t)) req.result.createObjectStore(t, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const getAll = (name) => new Promise((resolve, reject) => {
  const req = db.transaction(name).objectStore(name).getAll();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function write(name, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    fn(tx.objectStore(name));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function initStore() {
  db = await openDb();
  await Promise.all(TABLES.map(async (t) => {
    for (const row of await getAll(t)) tables[t].set(row.id, row);
  }));
  for (const row of await getAll('kv')) kv.set(row.key, row.value);
  for (const row of await getAll('gcalMap')) gcalMap.set(row.key, row);
  for (const row of await getAll('syncQueue')) syncQueue.set(row.key, row);
  await upgradeLocalData();
}

/** 前の版のアプリで保存したデータを、今の形式に直す */
async function upgradeLocalData() {
  const version = kv.get('dataVersion') || 1;
  if (version >= DATA_VERSION) return;
  const current = { version, tables: Object.fromEntries(TABLES.map((t) => [t, [...tables[t].values()]])), settings: Object.fromEntries(kv) };
  // 書き換える前の状態を控えに残す（「元に戻す」で戻せる）
  if (TABLES.some((t) => tables[t].size)) await saveSnapshot(`版${version}からの更新前`);
  const next = migrateData(current);
  for (const t of TABLES) {
    const rows = next.tables[t] || [];
    tables[t] = new Map(rows.map((r) => [r.id, r]));
    await write(t, (s) => { s.clear(); rows.forEach((r) => s.put(r)); });
  }
  for (const k of [...kv.keys()]) if (!(k in next.settings)) deleteSetting(k);
  for (const [k, v] of Object.entries(next.settings)) setSetting(k, v);
  setSetting('dataVersion', DATA_VERSION);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 論理削除されていない行 */
export const all = (table) => [...tables[table].values()].filter((r) => !r.deleted);
export const get = (table, id) => {
  const row = tables[table].get(id);
  return row && !row.deleted ? row : null;
};
export const byProgram = (table, programId) => all(table).filter((r) => r.programId === programId);

export function save(table, row, { silent = false } = {}) {
  const now = Date.now();
  const next = { ...row, id: row.id || uuid(), createdAt: row.createdAt || now, updatedAt: now, deleted: false };
  tables[table].set(next.id, next);
  write(table, (s) => s.put(next)).catch(reportWriteError);
  if (!silent) emit();
  return next;
}

/** 新着の回など、件数の多いデータをまとめて保存する */
export async function saveMany(table, rows) {
  const now = Date.now();
  const list = rows.map((row) => ({ ...row, createdAt: row.createdAt || now, updatedAt: now, deleted: !!row.deleted }));
  list.forEach((r) => tables[table].set(r.id, r));
  await write(table, (s) => list.forEach((r) => s.put(r))).catch(reportWriteError);
  emit();
}

export const getRaw = (table, id) => tables[table].get(id) || null;

export function remove(table, id, { silent = false } = {}) {
  const row = tables[table].get(id);
  if (!row) return;
  const next = { ...row, deleted: true, updatedAt: Date.now() };
  tables[table].set(id, next);
  write(table, (s) => s.put(next)).catch(reportWriteError);
  if (!silent) emit();
}

/** 番組と、ぶら下がる全データを削除 */
export function removeProgram(id) {
  for (const t of ['schedules', 'episodes', 'channels', 'corners', 'contacts', 'memos', 'postLogs', 'radioNames', 'ideas', 'feedItems']) {
    for (const row of byProgram(t, id)) remove(t, row.id, { silent: true });
  }
  remove('programs', id);
}

function reportWriteError(e) {
  console.error('保存に失敗しました', e);
  globalThis.dispatchEvent?.(new CustomEvent('storage-error', { detail: e }));
}

export const getSetting = (key, fallback) => (kv.has(key) ? kv.get(key) : fallback);
export function setSetting(key, value) {
  kv.set(key, value);
  write('kv', (s) => s.put({ key, value })).catch(reportWriteError);
}
export function deleteSetting(key) {
  kv.delete(key);
  write('kv', (s) => s.delete(key)).catch(reportWriteError);
}

export function setGcalMap(key, row) {
  const next = { ...row, key };
  gcalMap.set(key, next);
  write('gcalMap', (s) => s.put(next)).catch(reportWriteError);
}
export function deleteGcalMap(key) {
  gcalMap.delete(key);
  write('gcalMap', (s) => s.delete(key)).catch(reportWriteError);
}
export function clearGcalMap() {
  gcalMap.clear();
  write('gcalMap', (s) => s.clear()).catch(reportWriteError);
}

export function setQueueItem(item) {
  syncQueue.set(item.key, item);
  write('syncQueue', (s) => s.put(item)).catch(reportWriteError);
}
export function deleteQueueItem(key) {
  syncQueue.delete(key);
  write('syncQueue', (s) => s.delete(key)).catch(reportWriteError);
}
export function clearQueue() {
  syncQueue.clear();
  write('syncQueue', (s) => s.clear()).catch(reportWriteError);
}

// 連携用URLと合言葉は端末の外へ出さない（7章 セキュリティ）
const PRIVATE_SETTINGS = new Set([
  'gasUrl', 'gasSecret', 'lastSyncAt', 'lastBackupAt', 'lastError', 'backupDirty', 'calendarId', 'dataVersion',
  'feedsHash', 'digestHash', 'feedPulledAt', 'feedPullCheckedAt', 'gasVersion', 'syncFailStreak', 'feedStatus',
]);

const COUNTED = { programs: '番組', memos: 'メモ', postLogs: '投稿履歴', ideas: 'ネタ帳', feedItems: '新着の回' };

/** 件数の内訳（バックアップ情報と復元時の確認に使う） */
export function countsOf(json) {
  const live = (t) => (json.tables[t] || []).filter((r) => !r.deleted);
  const counts = {};
  for (const t of Object.keys(COUNTED)) counts[t] = live(t).length;
  counts.archived = live('programs').filter((p) => p.archived).length;
  counts.listened = live('episodes').filter((e) => e.listened).length + live('feedItems').filter((f) => f.listened).length;
  return counts;
}

export function describeCounts(c) {
  if (!c) return '件数不明';
  return [`番組${c.programs ?? 0}件（アーカイブ${c.archived ?? 0}件）`, `メモ${c.memos ?? 0}件`, `投稿履歴${c.postLogs ?? 0}件`, `ネタ帳${c.ideas ?? 0}件`].join('・');
}

export function exportAll() {
  const out = { app: 'radio-calendar', version: DATA_VERSION, exportedAt: new Date().toISOString(), tables: {}, settings: {}, gcalMap: [...gcalMap.values()] };
  for (const t of TABLES) out.tables[t] = [...tables[t].values()];
  for (const [k, v] of kv) if (!PRIVATE_SETTINGS.has(k)) out.settings[k] = v;
  return out;
}

export const hasUserData = () => all('programs').length > 0 || all('memos').length > 0 || all('postLogs').length > 0;

/** 上書き前の状態を端末内に残す（F-MIG-12）。直近5件を保持 */
export async function saveSnapshot(reason) {
  const snapshot = { key: `snap-${Date.now()}`, createdAt: Date.now(), reason, data: exportAll() };
  await write('snapshots', (s) => s.put(snapshot));
  const list = (await getAll('snapshots')).sort((a, b) => b.createdAt - a.createdAt);
  const old = list.slice(KEEP_SNAPSHOTS);
  if (old.length) await write('snapshots', (s) => old.forEach((o) => s.delete(o.key)));
  return snapshot;
}

export async function listSnapshots() {
  return (await getAll('snapshots')).sort((a, b) => b.createdAt - a.createdAt).map(({ key, createdAt, reason, data }) => ({ key, createdAt, reason, counts: countsOf(data) }));
}

export async function getSnapshot(key) {
  return (await getAll('snapshots')).find((s) => s.key === key) || null;
}

/** バックアップの形式を確かめ、今の形式に直して返す。違えば例外。 */
export function normalizeBackup(json) {
  if (!json || json.app !== 'radio-calendar' || typeof json.tables !== 'object') {
    throw new Error('このアプリのバックアップファイルではありません');
  }
  if ((json.version || 1) > DATA_VERSION) throw new Error('新しい版のアプリで作られたファイルです。アプリを更新してから読み込んでください');
  for (const t of Object.keys(json.tables)) {
    const rows = json.tables[t];
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.id !== 'string')) throw new Error(`データが壊れています（${t}）`);
  }
  return migrateData({ version: json.version || 1, tables: json.tables, settings: json.settings || {}, gcalMap: json.gcalMap || [] });
}

/** バックアップで全データを置き換える。呼び出し側で先に saveSnapshot すること */
export async function importAll(json) {
  const data = normalizeBackup(json);
  for (const t of TABLES) {
    const rows = data.tables[t] || [];
    tables[t] = new Map(rows.map((r) => [r.id, r]));
    await write(t, (s) => {
      s.clear();
      rows.forEach((r) => s.put(r));
    });
  }
  for (const [k, v] of Object.entries(data.settings || {})) {
    if (!PRIVATE_SETTINGS.has(k)) setSetting(k, v);
  }
  clearGcalMap();
  clearQueue();
  deleteSetting('feedsHash');
  deleteSetting('digestHash');
  for (const row of data.gcalMap || []) if (row && row.key) setGcalMap(row.key, row);
  emit();
}

export const notifyChange = emit;
