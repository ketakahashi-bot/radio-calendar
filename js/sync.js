// GAS 中継への同期とバックアップ。
// あるべき状態（buildDesired）と Google に送信済みの状態（gcalMap）の差分を SyncQueue に積み、順に送る。

import { buildDesired } from './gcal.js';
import {
  getSetting, setSetting, deleteSetting, gcalMap, syncQueue, setGcalMap, deleteGcalMap, clearGcalMap,
  setQueueItem, deleteQueueItem, clearQueue, exportAll, importAll,
} from './store.js';

const BATCH = 10;
const SYNC_DEBOUNCE = 1500;
const BACKUP_DEBOUNCE = 30000;
const RETRY_MS = 60000;
const DAILY = 24 * 3600000;

let running = false;
let rerun = false;
let syncTimer = null;
let backupTimer = null;
let retryTimer = null;

export const isLinked = () => !!(getSetting('gasUrl') && getSetting('gasSecret'));
const announce = () => globalThis.dispatchEvent?.(new CustomEvent('sync-status'));

export function isValidGasUrl(url) {
  return /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[\w-]+\/exec$/.test(String(url).trim());
}

export async function callGas(action, params = {}, creds = null) {
  const url = creds?.url || getSetting('gasUrl');
  const secret = creds?.secret || getSetting('gasSecret');
  const res = await fetch(url, {
    method: 'POST',
    // text/plain にすると CORS のプリフライトが発生せず GAS で受けられる
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret, action, ...params }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`通信エラー (${res.status})`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('連携用URLの応答を読み取れません。URLとデプロイ設定を確認してください');
  }
  if (!json.ok) throw new Error(json.error === 'unauthorized' ? '合言葉が一致しません' : json.error || '不明なエラー');
  return json;
}

/** 差分を計算して SyncQueue を更新する。試行回数は引き継ぐ。 */
export function reconcile(now = Date.now()) {
  const desired = buildDesired(now);
  const wanted = new Set();
  for (const [key, { kind, payload }] of desired) {
    const hash = JSON.stringify(payload);
    const sent = gcalMap.get(key);
    if (sent && sent.hash === hash) continue;
    wanted.add(key);
    const prev = syncQueue.get(key);
    setQueueItem({ key, op: 'upsert', kind, id: sent?.id || null, payload, hash, attempts: prev?.attempts || 0, error: prev?.error || null });
  }
  for (const [key, sent] of gcalMap) {
    if (desired.has(key)) continue;
    wanted.add(key);
    const prev = syncQueue.get(key);
    setQueueItem({ key, op: 'delete', kind: sent.kind, id: sent.id, attempts: prev?.attempts || 0, error: prev?.error || null });
  }
  for (const key of [...syncQueue.keys()]) if (!wanted.has(key)) deleteQueueItem(key);
}

export function syncStatus() {
  const items = [...syncQueue.values()];
  return {
    linked: isLinked(),
    running,
    pending: items.length,
    failed: items.filter((i) => i.attempts > 0).length,
    lastSyncAt: getSetting('lastSyncAt', null),
    lastBackupAt: getSetting('lastBackupAt', null),
    lastError: getSetting('lastError', null),
  };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => syncNow(), RETRY_MS);
}

/** 差分を送る。オフラインや未連携なら積むだけ。 */
export async function syncNow() {
  reconcile();
  announce();
  if (!isLinked() || navigator.onLine === false) return;
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  announce();
  let hadError = false;
  try {
    const items = [...syncQueue.values()];
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      let results;
      try {
        const res = await callGas('sync', {
          ops: batch.map(({ op, key, kind, id, payload }) => ({ op, key, kind, id, payload })),
        });
        results = res.results;
      } catch (e) {
        hadError = true;
        setSetting('lastError', e.message);
        for (const item of items.slice(i)) setQueueItem({ ...item, attempts: item.attempts + 1, error: e.message });
        break;
      }
      for (const item of batch) {
        const r = results.find((x) => x.key === item.key);
        if (r && r.ok) {
          if (item.op === 'delete') deleteGcalMap(item.key);
          else setGcalMap(item.key, { id: r.id, hash: item.hash, kind: item.kind });
          deleteQueueItem(item.key);
        } else {
          hadError = true;
          const error = r?.error || '応答がありません';
          setSetting('lastError', error);
          setQueueItem({ ...item, attempts: item.attempts + 1, error });
        }
      }
    }
    if (!hadError) {
      setSetting('lastSyncAt', Date.now());
      deleteSetting('lastError');
    }
  } finally {
    running = false;
    announce();
  }
  if (rerun) {
    rerun = false;
    return syncNow();
  }
  if (hadError) scheduleRetry();
}

/** 全予定を送り直す（手動再同期）。Google 側で予定を消してしまった場合の復旧にも使う */
export async function resyncAll() {
  for (const [key, row] of gcalMap) setGcalMap(key, { ...row, hash: null });
  clearQueue();
  return syncNow();
}

export function requestSync() {
  setSetting('backupDirty', true);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), SYNC_DEBOUNCE);
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => backupToDrive().catch(() => {}), BACKUP_DEBOUNCE);
}

export async function backupToDrive() {
  if (!isLinked() || navigator.onLine === false) return false;
  const res = await callGas('backup', { data: JSON.stringify(exportAll()) });
  setSetting('lastBackupAt', Date.now());
  setSetting('backupDirty', false);
  announce();
  return res;
}

/** 起動時や復帰時の定期処理。バックアップは変更時と1日1回。 */
export function maintenance(now = Date.now()) {
  if (!isLinked()) return;
  syncNow();
  const last = getSetting('lastBackupAt', 0);
  if (getSetting('backupDirty', false) || now - last > DAILY) backupToDrive().catch(() => {});
}

export const listDriveBackups = () => callGas('listBackups');

export async function restoreFromDrive(id) {
  const res = await callGas('restore', { id });
  await importAll(JSON.parse(res.data));
  setSetting('backupDirty', false);
  await syncNow();
}

export async function connect(url, secret) {
  const res = await callGas('connect', {}, { url, secret });
  if (getSetting('calendarId') && getSetting('calendarId') !== res.calendarId) {
    clearGcalMap(); // カレンダーが作り直されたら予定IDは無効
    clearQueue();
  }
  setSetting('gasUrl', url);
  setSetting('gasSecret', secret);
  setSetting('calendarId', res.calendarId);
  deleteSetting('lastError');
  await syncNow();
  backupToDrive().catch(() => {});
  return res;
}

export async function disconnect({ deleteCalendar }) {
  // 通信できないときも端末側の連携は解除できるようにする
  let warning = null;
  try {
    await callGas('disconnect', { deleteCalendar });
  } catch (e) {
    warning = e.message;
  }
  for (const k of ['gasUrl', 'gasSecret', 'calendarId', 'lastSyncAt', 'lastBackupAt', 'lastError']) deleteSetting(k);
  clearGcalMap();
  clearQueue();
  announce();
  return warning;
}

export function startSyncLoop() {
  globalThis.addEventListener('online', () => maintenance());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') maintenance();
  });
  maintenance();
}
