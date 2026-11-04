// 端末内データ。IndexedDB を正とし、起動時に全件をメモリへ読み込んで同期的に扱う。
// 全エンティティは id / createdAt / updatedAt / deleted（論理削除）を持つ。

export const TABLES = ['programs', 'schedules', 'episodes', 'channels', 'corners', 'contacts', 'memos', 'presets', 'templates'];
const DB_NAME = globalThis.__RADIO_DB_NAME__ || 'radio-calendar';
const AUX = ['kv', 'gcalMap', 'syncQueue'];

let db = null;
const tables = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
export const kv = new Map();
export const gcalMap = new Map(); // key -> { id, hash, kind }
export const syncQueue = new Map(); // key -> { op, key, kind, id, payload, hash, attempts, error }
const listeners = new Set();

export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const t of TABLES) req.result.createObjectStore(t, { keyPath: 'id' });
      for (const t of AUX) req.result.createObjectStore(t, { keyPath: 'key' });
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
  for (const t of ['schedules', 'episodes', 'channels', 'corners', 'contacts', 'memos']) {
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

// 連携用URLと合言葉は端末の外へ出さない（6章 セキュリティ）
const PRIVATE_SETTINGS = new Set(['gasUrl', 'gasSecret', 'lastSyncAt', 'lastBackupAt', 'lastError', 'backupDirty', 'calendarId']);

export function exportAll() {
  const out = { app: 'radio-calendar', version: 1, exportedAt: new Date().toISOString(), tables: {}, settings: {}, gcalMap: [...gcalMap.values()] };
  for (const t of TABLES) out.tables[t] = [...tables[t].values()];
  for (const [k, v] of kv) if (!PRIVATE_SETTINGS.has(k)) out.settings[k] = v;
  return out;
}

/** バックアップで全データを置き換える。形式が違えば例外。 */
export async function importAll(json) {
  if (!json || json.app !== 'radio-calendar' || typeof json.tables !== 'object') {
    throw new Error('このアプリのバックアップファイルではありません');
  }
  for (const t of TABLES) {
    const rows = json.tables[t] || [];
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.id !== 'string')) throw new Error(`データが壊れています（${t}）`);
  }
  for (const t of TABLES) {
    const rows = json.tables[t] || [];
    tables[t] = new Map(rows.map((r) => [r.id, r]));
    await write(t, (s) => {
      s.clear();
      rows.forEach((r) => s.put(r));
    });
  }
  for (const [k, v] of Object.entries(json.settings || {})) {
    if (!PRIVATE_SETTINGS.has(k)) setSetting(k, v);
  }
  clearGcalMap();
  clearQueue();
  for (const row of json.gcalMap || []) if (row && row.key) setGcalMap(row.key, row);
  emit();
}

export const notifyChange = emit;
