// GAS 中継への同期とバックアップ。
// あるべき状態（buildDesired）と Google に送信済みの状態（gcalMap）の差分を SyncQueue に積み、順に送る。
// あわせて、新着検知の対象（feeds）と今日のまとめの材料（digest）を GAS に渡し、検知した新着の回を受け取る。

import { buildDesired } from './gcal.js';
import { buildDigest } from './digest.js';
import { colorIdOf } from './domain.js';
import {
  all, get, getRaw, getSetting, setSetting, deleteSetting, gcalMap, syncQueue, setGcalMap, deleteGcalMap, clearGcalMap,
  setQueueItem, deleteQueueItem, clearQueue, exportAll, importAll, countsOf, saveSnapshot, getSnapshot, saveMany, normalizeBackup,
} from './store.js';
import { DATA_VERSION } from './migrate.js';

const BATCH = 10;
const SYNC_DEBOUNCE = 1500;
const BACKUP_DEBOUNCE = 30000;
const RETRY_MS = 60000;
const DAILY = 24 * 3600000;
export const MAX_FEEDS = 50;
export const GAS_VERSION_REQUIRED = 2;

let running = false;
let rerun = false;
let syncTimer = null;
let backupTimer = null;
let retryTimer = null;

export const isLinked = () => !!(getSetting('gasUrl') && getSetting('gasSecret'));
const announce = () => globalThis.dispatchEvent?.(new CustomEvent('sync-status'));
export const gasOutdated = () => isLinked() && (getSetting('gasVersion', 1) < GAS_VERSION_REQUIRED);

/** メールからのコピーで混ざる改行や空白を取り除く */
export const cleanCredential = (s) => String(s ?? '').replace(/\s+/g, '');

export function isValidGasUrl(url) {
  return /^https:\/\/script\.google\.com\/(macros\/|a\/macros\/[^/]+\/|a\/[^/]+\/macros\/)s\/[\w-]+\/exec$/.test(cleanCredential(url));
}

/** 連携用URLの問題点を、直し方が分かる文で返す。問題なければ null */
export function gasUrlProblem(raw) {
  const url = cleanCredential(raw);
  if (isValidGasUrl(url)) return null;
  if (!url) return '連携用URLを入力してください';
  if (/\/dev$/.test(url)) {
    return '末尾が /dev のURLはテスト用なので使えません。GAS の「デプロイ > デプロイを管理」で、末尾が /exec のウェブアプリURLをコピーしてください';
  }
  if (/script\.google\.com\/.*\/(edit|home)/.test(url) || /script\.google\.com\/home/.test(url)) {
    return 'これは GAS のエディタのURLです。「デプロイ > デプロイを管理」で、末尾が /exec のウェブアプリURLをコピーしてください';
  }
  return '連携用URLは https://script.google.com/ で始まり /exec で終わります。GAS の「デプロイ > デプロイを管理」でウェブアプリURLをコピーしてください';
}

/** GAS から返るエラーを、対処が分かる文に置き換える */
function explainGasError(error) {
  if (error === 'unauthorized') return '合言葉が一致しません。合言葉を再発行した場合は、新しい合言葉を入れ直してください';
  if (error === 'unknown action') return 'GAS が古い版です。README の「GAS を更新する」の手順で Code.gs を置き換えてください';
  if (/is not defined/.test(error || '')) {
    return `GAS の appsscript.json が反映されていません。README の手順で置き換えて「新しいバージョン」でデプロイし直してください（${error}）`;
  }
  return error || '不明なエラー';
}

export async function callGas(action, params = {}, creds = null) {
  const url = creds?.url || getSetting('gasUrl');
  const secret = creds?.secret || getSetting('gasSecret');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      // text/plain にすると CORS のプリフライトが発生せず GAS で受けられる
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, action, ...params }),
      redirect: 'follow',
    });
  } catch {
    // 「全員」以外で公開すると Google のログイン画面が返り、ブラウザではこの通信エラーになる
    throw new Error('GAS に接続できません。通信状態と、デプロイの「アクセスできるユーザー」が「全員」になっているか確認してください');
  }
  if (!res.ok) throw new Error(`通信エラー (${res.status})。連携用URLとデプロイ設定を確認してください`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('連携用URLの応答を読み取れません。デプロイの種類が「ウェブアプリ」で、「全員」に公開されているか確認してください');
  }
  if (!json.ok) throw new Error(explainGasError(json.error));
  if (json.version) setSetting('gasVersion', json.version);
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
  const feedStatus = getSetting('feedStatus', {});
  const feedErrors = Object.values(feedStatus).filter((s) => s.error);
  return {
    linked: isLinked(),
    running,
    pending: items.length,
    failed: items.filter((i) => i.attempts > 0).length,
    lastSyncAt: getSetting('lastSyncAt', null),
    lastBackupAt: getSetting('lastBackupAt', null),
    lastError: getSetting('lastError', null),
    feedErrors,
    outdated: gasOutdated(),
  };
}

/** 7日以上バックアップできていないか（F-MIG-07）。ファイルへの書き出しも数える */
export function backupWarning(now = Date.now()) {
  if (!all('programs').length) return null;
  const last = Math.max(getSetting('lastBackupAt', 0) || 0, getSetting('lastExportAt', 0) || 0);
  if (now - last < 7 * DAILY) return null;
  return last ? `${Math.floor((now - last) / DAILY)}日間バックアップできていません` : 'まだバックアップがありません';
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => syncNow(), RETRY_MS);
}

/** 新着検知の対象（F-FEED-01）。上限は MAX_FEEDS 件 */
export function buildFeeds() {
  const list = [];
  for (const c of all('channels')) {
    if (!c.rssUrl) continue;
    const p = get('programs', c.programId);
    if (!p || p.archived) continue;
    list.push({
      id: c.id,
      programId: p.id,
      programName: p.name,
      url: c.rssUrl,
      kind: c.rssKind || 'podcast',
      include: c.feedInclude || [],
      exclude: c.feedExclude || [],
      calendar: c.feedCalendar === true,
      notify: p.individualNotify === true,
      colorId: colorIdOf(p.color),
    });
  }
  return list.slice(0, MAX_FEEDS);
}

/** 新着の回を受け取り、端末に保存する。聴取済みなど端末側の記録は保つ */
export async function pullFeedItems() {
  const since = getSetting('feedPulledAt', 0);
  const res = await callGas('feedItems', { since });
  const rows = [];
  for (const item of res.items || []) {
    const existing = getRaw('feedItems', item.id);
    if (existing) continue;
    const channel = get('channels', item.channelId);
    if (!channel) continue;
    rows.push({ ...item, programId: channel.programId, listened: false, position: 0 });
  }
  if (rows.length) await saveMany('feedItems', rows);
  setSetting('feedStatus', res.status || {});
  setSetting('feedPulledAt', res.now || Date.now());
  return rows.length;
}

async function pushExtras() {
  if (gasOutdated()) return;
  const feeds = buildFeeds();
  const feedsHash = JSON.stringify(feeds);
  const feedsChanged = feedsHash !== getSetting('feedsHash');
  if (feedsChanged) {
    await callGas('setFeeds', { feeds }); // 新しく登録した RSS は GAS がすぐに確認する
    setSetting('feedsHash', feedsHash);
  }
  const digest = buildDigest();
  const digestHash = JSON.stringify(digest);
  if (digestHash !== getSetting('digestHash')) {
    await callGas('setDigest', { digest });
    setSetting('digestHash', digestHash);
  }
  // 新着の回の取得は5分に1回まで（GAS の実行量を節約する）
  if (feedsChanged || Date.now() - getSetting('feedPullCheckedAt', 0) > 5 * 60000) {
    await pullFeedItems();
    setSetting('feedPullCheckedAt', Date.now());
  }
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
      try {
        await pushExtras();
      } catch (e) {
        hadError = true;
        setSetting('lastError', e.message);
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
  deleteSetting('feedsHash');
  deleteSetting('digestHash');
  return syncNow();
}

export function requestSync() {
  setSetting('backupDirty', true);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), SYNC_DEBOUNCE);
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => backupToDrive().catch(() => {}), BACKUP_DEBOUNCE);
}

const deviceName = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  return 'PC';
};

/** Google ドライブへバックアップ（F-GGL-04, F-MIG-01）。type は regular / pre-overwrite */
export async function backupToDrive({ type = 'regular', data = null } = {}) {
  if (!isLinked() || navigator.onLine === false) return false;
  const json = data || exportAll();
  const meta = { type, version: DATA_VERSION, counts: countsOf(json), device: deviceName(), createdAt: Date.now() };
  const res = await callGas('backup', { data: JSON.stringify(json), meta });
  if (type === 'regular') {
    setSetting('lastBackupAt', Date.now());
    setSetting('backupDirty', false);
  }
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

/**
 * 上書きの前に、いまの状態を端末内とドライブに残す（F-MIG-12）。
 * ドライブへの保存に失敗しても、端末内の控えがあるので処理は続ける。
 */
export async function protectBeforeOverwrite(reason) {
  const snap = await saveSnapshot(reason);
  if (isLinked()) await backupToDrive({ type: 'pre-overwrite', data: snap.data }).catch(() => {});
  return snap;
}

/** 全データを置き換える（復元・ファイル取り込み）。控えを取ってから行う */
export async function replaceAllData(json, reason) {
  normalizeBackup(json); // 壊れたファイルなら控えを取る前に止める
  const snap = await protectBeforeOverwrite(reason);
  await importAll(json);
  setSetting('backupDirty', false);
  await syncNow();
  return snap;
}

export async function restoreFromDrive(id) {
  const res = await callGas('restore', { id });
  return replaceAllData(JSON.parse(res.data), 'ドライブから復元する前');
}

/** 「元に戻す」：控えの状態に戻す。戻す前の状態も控えに残す */
export async function undoToSnapshot(key) {
  const snap = await getSnapshot(key);
  if (!snap) throw new Error('控えが見つかりません');
  return replaceAllData(snap.data, '元に戻す前');
}

/**
 * 連携の確認だけを行う。予定の送信とバックアップは、復元するかを決めてから finishConnect で行う（F-MIG-03）。
 * 返り値の backups は新しい順。
 */
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
  deleteSetting('feedsHash');
  deleteSetting('digestHash');
  deleteSetting('feedPullCheckedAt');
  let backups = [];
  try {
    backups = (await listDriveBackups()).backups || [];
  } catch { /* 一覧が取れなくても連携は続ける */ }
  return { ...res, backups: backups.filter((b) => b.meta?.type !== 'pre-overwrite') };
}

export async function finishConnect({ restoreId = null } = {}) {
  if (restoreId) {
    await restoreFromDrive(restoreId);
  } else {
    await syncNow();
  }
  await backupToDrive().catch(() => {});
}

export async function disconnect({ deleteCalendar }) {
  // 通信できないときも端末側の連携は解除できるようにする
  let warning = null;
  try {
    await callGas('disconnect', { deleteCalendar });
  } catch (e) {
    warning = e.message;
  }
  for (const k of ['gasUrl', 'gasSecret', 'calendarId', 'lastSyncAt', 'lastBackupAt', 'lastError', 'feedsHash', 'digestHash', 'gasVersion']) deleteSetting(k);
  clearGcalMap();
  clearQueue();
  announce();
  return warning;
}

/** 合言葉の再発行（F-GGL-09）。古い合言葉はすぐ使えなくなる */
export async function rotateSecret() {
  const res = await callGas('rotateSecret');
  setSetting('gasSecret', res.secret);
  return res.secret;
}

/** 通知テスト（F-NTF-02）。数分後に鳴る予定を専用カレンダーに入れる */
export const testNotification = (minutes = 3) => callGas('testNotification', { minutes });

/** チャンネルURLなどから RSS を求め、中身を確かめる（F-FEED-02） */
export const resolveFeed = (url) => callGas('resolveFeed', { url });

// ---- 機種変更用の連携コード（F-MIG-05） ----

const CODE_PREFIX = 'RCLINK1.';

export function linkCode() {
  const json = JSON.stringify({ u: getSetting('gasUrl'), s: getSetting('gasSecret') });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return CODE_PREFIX + b64;
}

export function parseLinkCode(text) {
  const s = cleanCredential(text);
  if (!s.startsWith(CODE_PREFIX)) return null;
  try {
    const b64 = s.slice(CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { u, s: secret } = JSON.parse(new TextDecoder().decode(bytes));
    return isValidGasUrl(u) && secret ? { url: u, secret } : null;
  } catch {
    return null;
  }
}

export function startSyncLoop() {
  globalThis.addEventListener('online', () => maintenance());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') maintenance();
  });
  maintenance();
}
