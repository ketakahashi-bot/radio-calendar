// 設定（Google 連携・同期状態・日の区切り・バックアップ）

import { h, page, section, button, toast, rerender, confirmSheet, chooseSheet, openForm, externalLink } from '../ui.js';
import { all, exportAll, getSetting, importAll, remove, save, setSetting, notifyChange } from '../store.js';
import { backupToDrive, connect, disconnect, isLinked, isValidGasUrl, listDriveBackups, resyncAll, restoreFromDrive, syncStatus, syncNow } from '../sync.js';
import { fmtInstant } from '../time.js';

const fmtTime = (ms) => (ms ? fmtInstant(ms) : '—');

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

function statusRows() {
  const s = syncStatus();
  const row = (label, value) => h('div', { class: 'row' }, h('span', { class: 'row-main' }, label), h('strong', null, value));
  return h('div', { class: 'list', id: 'sync-status' },
    row('状態', s.running ? '同期中…' : navigator.onLine === false ? 'オフライン（復帰後に送信）' : '連携中'),
    row('最終同期', fmtTime(s.lastSyncAt)),
    row('未送信', `${s.pending}件`),
    row('失敗', `${s.failed}件`),
    row('最終バックアップ', fmtTime(s.lastBackupAt)),
    s.lastError ? h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('strong', null, 'エラー'), h('small', { class: 'break' }, s.lastError))) : null);
}

export function refreshSyncStatus() {
  const el = document.getElementById('sync-status');
  if (el) el.replaceWith(statusRows());
}

function linkForm() {
  const urlInput = h('input', { id: 's-url', type: 'url', inputMode: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', value: '' });
  const secretInput = h('input', { id: 's-secret', type: 'password', autocomplete: 'off', value: '' });
  const err = h('small', { class: 'field-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn primary' }, '連携する');
  return h('form', {
    class: 'form',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const url = urlInput.value.trim();
      const secret = secretInput.value.trim();
      if (!isValidGasUrl(url)) { err.textContent = 'GAS を「ウェブアプリ」として公開したときの URL（/exec で終わるもの）を入力してください'; return; }
      if (!secret) { err.textContent = '合言葉を入力してください'; return; }
      submit.disabled = true;
      submit.textContent = '接続中…';
      try {
        const res = await connect(url, secret);
        toast(`カレンダー「${res.calendarName}」と連携しました`);
        rerender();
      } catch (ex) {
        err.textContent = `連携できませんでした：${ex.message}`;
        submit.disabled = false;
        submit.textContent = '連携する';
      }
    },
  },
  h('p', { class: 'help' }, 'Google 連携には、自分の Google アカウントに GAS（無料）を設置します。手順はアプリと一緒に配布している README を参照してください。'),
  h('div', { class: 'field' }, h('label', { for: 's-url' }, '連携用URL'), urlInput),
  h('div', { class: 'field' }, h('label', { for: 's-secret' }, '合言葉'), secretInput),
  err,
  h('div', { class: 'sheet-actions' }, submit));
}

async function restoreFlow() {
  let list;
  try {
    list = (await listDriveBackups()).backups;
  } catch (e) {
    toast(`取得できませんでした：${e.message}`, { error: true });
    return;
  }
  if (!list.length) { toast('バックアップはまだありません'); return; }
  const id = await chooseSheet('復元するバックアップ', list.map((b) => ({ value: b.id, label: fmtInstant(b.createdAt) })));
  if (!id) return;
  if (!(await confirmSheet('端末のデータをこのバックアップで置き換えますか？', { ok: '復元', danger: true }))) return;
  try {
    await restoreFromDrive(id);
    toast('復元しました');
    rerender();
  } catch (e) {
    toast(`復元できませんでした：${e.message}`, { error: true });
  }
}

function googleSection() {
  if (!isLinked()) return section('Google 連携', linkForm());
  const toggles = [
    ['syncEnabled', true, '放送予定を Google カレンダーに登録する', 'オフにすると、カレンダー「ラジオ番組」の予定を削除します'],
    ['syncDeadlines', true, 'コーナーの締切を Google ToDo リストに登録する', null],
    ['syncCatchup', false, '聴き逃し期限を予定として登録する', null],
  ];
  return section('Google 連携',
    statusRows(),
    h('div', { class: 'row-actions' },
      button('今すぐ同期', async () => { await syncNow(); toast('同期しました'); }, 'small'),
      button('すべて送り直す', async () => { await resyncAll(); toast('再同期しました'); }, 'small'),
      button('今すぐバックアップ', async () => {
        try { await backupToDrive(); toast('バックアップしました'); } catch (e) { toast(e.message, { error: true }); }
      }, 'small'),
      button('ドライブから復元', restoreFlow, 'small')),
    h('div', { class: 'list' }, toggles.map(([key, def, label, help]) => h('label', { class: 'check-row' },
      h('input', { type: 'checkbox', checked: getSetting(key, def), onchange: (e) => { setSetting(key, e.target.checked); notifyChange(); } }),
      h('span', null, label),
      help ? h('small', { class: 'help' }, help) : null))),
    h('div', { class: 'row-actions' }, button('連携を解除', async () => {
      const choice = await chooseSheet('連携を解除します。カレンダー「ラジオ番組」をどうしますか？', [
        { value: 'keep', label: 'カレンダーを残す' },
        { value: 'delete', label: 'カレンダーと ToDo リストを削除する', danger: true },
      ]);
      if (!choice) return;
      const warning = await disconnect({ deleteCalendar: choice === 'delete' });
      toast(warning ? `端末側は解除しました（Google 側の処理は失敗：${warning}）` : '連携を解除しました', { error: !!warning });
      rerender();
    }, 'small ghost danger')));
}

function managePresets() {
  const presets = all('presets');
  if (!presets.length) { toast('プリセットはまだありません。配信媒体の登録時に保存できます'); return; }
  openForm({
    title: 'プリセットを削除',
    fields: [{ name: 'ids', label: '削除するプリセット', type: 'checks', options: presets.map((p) => ({ value: p.id, label: p.name })) }],
    submitLabel: '削除',
    onSubmit: (v) => { v.ids.forEach((id) => remove('presets', id)); },
  });
}

export function renderSettings() {
  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'hidden',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        if (!(await confirmSheet('端末のデータをこのファイルで置き換えますか？', { ok: '読み込む', danger: true }))) return;
        await importAll(json);
        toast('読み込みました');
        rerender();
      } catch (ex) {
        toast(`読み込めませんでした：${ex.message}`, { error: true });
      }
    },
  });
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `radio-calendar-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const seg = (key, def, options, label) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([v, l]) => h('button', {
    type: 'button', class: getSetting(key, def) === v ? 'on' : '', 'aria-pressed': String(getSetting(key, def) === v),
    onclick: () => { setSetting(key, v); rerender(); },
  }, l)));

  return page({ title: '設定', tab: 'settings' },
    isIos() && !isStandalone() ? h('p', { class: 'notice' }, 'Safari の共有メニューから「ホーム画面に追加」して使ってください。タブのままだと、しばらく使わないときに端末内のデータが消える場合があります。') : null,
    googleSection(),
    section('カレンダー',
      h('div', { class: 'row card' }, h('span', { class: 'row-main' }, h('strong', null, '日の区切り'), h('small', null, '5:00 にすると、深夜番組を前日の枠に表示します')),
        seg('dayBoundary', 300, [[0, '0:00'], [300, '5:00']], '日の区切り'))),
    section('投稿',
      h('div', { class: 'row card' }, h('span', { class: 'row-main' }, h('strong', null, 'メールアプリ'), h('small', null, 'Gmail が入っていない場合は既定のアプリで開きます')),
        seg('mailApp', 'gmail', [['gmail', 'Gmail'], ['default', '既定']], 'メールアプリ'))),
    section('データ',
      h('p', { class: 'help' }, 'データはこの端末と、連携した自分の Google アカウントにだけ保存されます。'),
      h('div', { class: 'row-actions' },
        button('JSON を書き出す', exportJson, 'small'),
        button('JSON を読み込む', () => fileInput.click(), 'small'),
        button('プリセットの管理', managePresets, 'small'),
        fileInput)),
    section('このアプリ',
      h('p', { class: 'help' }, 'ラジオ番組カレンダー 1.0.0'),
      h('p', { class: 'help' }, '通知は iPhone の Google カレンダーアプリが行います。'),
      externalLink('Google カレンダーを開く', 'https://calendar.google.com/', 'btn small')),
  );
}

export { save };
