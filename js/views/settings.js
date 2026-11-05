// 設定（Google 連携・引き継ぎ・通知・データ）

import { h, page, section, button, toast, rerender, confirmSheet, chooseSheet, openForm, externalLink, linkButton, copyText } from '../ui.js';
import { all, exportAll, getSetting, remove, save, setSetting, notifyChange, listSnapshots, describeCounts, hasUserData } from '../store.js';
import {
  backupToDrive, cleanCredential, connect, finishConnect, disconnect, gasUrlProblem, isLinked, listDriveBackups, resyncAll,
  restoreFromDrive, syncStatus, syncNow, backupWarning, rotateSecret, testNotification, linkCode, parseLinkCode,
  undoToSnapshot, replaceAllData, gasOutdated, callGas,
} from '../sync.js';
import { fmtInstant } from '../time.js';
import { MEDIA_TYPES, mediaLabel } from '../domain.js';
import { saveJsonFile, pickJsonFile, stamp } from '../files.js';
import { qrCanvas, scanQr } from '../qr.js';
import { exportShare, importShareFlow } from './share-ui.js';

const fmtTime = (ms) => (ms ? fmtInstant(ms) : '—');

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

function statusRows() {
  const s = syncStatus();
  const row = (label, value) => h('div', { class: 'row' }, h('span', { class: 'row-main' }, label), h('strong', null, value));
  return h('div', { class: 'list', id: 'sync-status' },
    row('状態', s.running ? '同期中…' : navigator.onLine === false ? 'オフライン（復帰後に送信）' : '連携中'),
    row('最終同期', fmtTime(s.lastSyncAt)),
    row('未送信', `${s.pending}件`),
    row('失敗', `${s.failed}件`),
    row('最終バックアップ', fmtTime(s.lastBackupAt)),
    s.feedErrors.length ? row('新着検知の失敗', `${s.feedErrors.length}件`) : null,
    s.lastError ? h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('strong', null, 'エラー'), h('small', { class: 'break' }, s.lastError))) : null,
    s.feedErrors.map((f) => h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('strong', null, `新着検知：${f.programName || ''}`), h('small', { class: 'break' }, `${f.error}（${f.failStreak}回連続）`)))));
}

export function refreshSyncStatus() {
  const el = document.getElementById('sync-status');
  if (el) el.replaceWith(statusRows());
}

/** 連携し、ドライブにバックアップがあれば件数を見せて復元するか確かめる（F-MIG-03） */
async function linkAndRestore(url, secret) {
  const res = await connect(url, secret);
  let restoreId = null;
  if (res.backups.length) {
    const latest = res.backups[0];
    const choice = await chooseSheet(`ドライブにバックアップがあります。最新：${fmtInstant(latest.createdAt)}（${latest.meta?.device || '端末不明'}）${describeCounts(latest.meta?.counts)}`, [
      { value: 'latest', label: 'この最新のバックアップを復元する' },
      { value: 'pick', label: '別の日時を選んで復元する' },
      { value: 'none', label: '復元しない（この端末のデータを使う）' },
    ]);
    if (choice === 'latest') restoreId = latest.id;
    if (choice === 'pick') restoreId = await pickBackup(res.backups);
    if (restoreId && hasUserData() && !(await confirmSheet('この端末のデータを、選んだバックアップで置き換えますか？', { ok: '復元する', detail: '置き換える前の状態は控えに残すので、「元に戻す」で戻せます。' }))) restoreId = null;
  }
  await finishConnect({ restoreId });
  toast(restoreId ? '連携して、バックアップを復元しました' : `カレンダー「${res.calendarName}」と連携しました`, {
    action: { label: '通知の設定へ', onClick: () => { location.hash = '#/guide/notify'; } },
  });
  if (res.triggers === false) toast('GAS の定期処理が未登録です。GAS のエディタで setup を実行してください', { error: true });
}

function linkForm() {
  const urlInput = h('input', { id: 's-url', type: 'text', inputMode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, placeholder: 'https://script.google.com/macros/s/…/exec', value: '' });
  const secretInput = h('input', { id: 's-secret', type: 'password', autocomplete: 'off', autocapitalize: 'off', value: '' });
  const err = h('small', { class: 'field-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn primary' }, '連携する');
  const run = async (url, secret) => {
    err.textContent = '';
    const problem = gasUrlProblem(url);
    if (problem) { err.textContent = problem; return; }
    if (!secret) { err.textContent = '合言葉を入力してください'; return; }
    submit.disabled = true;
    submit.textContent = '接続中…';
    try {
      await linkAndRestore(cleanCredential(url), cleanCredential(secret));
      rerender();
    } catch (ex) {
      err.textContent = `連携できませんでした：${ex.message}`;
      submit.disabled = false;
      submit.textContent = '連携する';
    }
  };
  const fromCode = (text) => {
    const parsed = parseLinkCode(text);
    if (!parsed) { err.textContent = '連携コードとして読めません'; return; }
    urlInput.value = parsed.url;
    secretInput.value = parsed.secret;
    run(parsed.url, parsed.secret);
  };
  return h('form', {
    class: 'form',
    onsubmit: (e) => { e.preventDefault(); run(urlInput.value, secretInput.value); },
  },
  h('p', { class: 'help' }, 'Google 連携には、自分の Google アカウントに GAS（無料）を設置します。機種変更のときは、前の端末の QR コードを読み取るだけで連携できます。'),
  h('div', { class: 'row-actions' },
    button('QR コードを読み取る', async () => { const text = await scanQr(); if (text) fromCode(text); }, 'small'),
    button('連携コードを貼り付ける', () => openForm({
      title: '連携コードを貼り付ける',
      fields: [{ name: 'code', label: '連携コード（RCLINK1. で始まる文字列）', type: 'textarea', rows: 3, required: true }],
      onSubmit: (v) => { fromCode(v.code); },
    }), 'small')),
  h('div', { class: 'field' }, h('label', { for: 's-url' }, '連携用URL'), urlInput,
    h('small', { class: 'help' }, 'GAS の「デプロイ > デプロイを管理」に出ている、末尾が /exec のウェブアプリURLです')),
  h('div', { class: 'field' }, h('label', { for: 's-secret' }, '合言葉'), secretInput),
  err,
  h('div', { class: 'sheet-actions' }, submit),
  h('details', { class: 'help-box' },
    h('summary', null, '前の端末がないとき（連携用URLと合言葉の確かめ方）'),
    h('ol', null,
      h('li', null, 'PC で script.google.com を開き、ラジオ番組カレンダーの GAS を開く'),
      h('li', null, '連携用URL：「デプロイ > デプロイを管理」に出ている、末尾が /exec の URL'),
      h('li', null, '合言葉：歯車の「プロジェクトの設定」の「スクリプト プロパティ」にある SECRET の値'),
      h('li', null, '合言葉が漏れたおそれがあるときは、エディタで関数 resetSecret を実行すると再発行され、新しい合言葉がメールで届きます'))));
}

const typeLabel = (b) => (b.meta?.type === 'pre-overwrite' ? '上書き前の控え' : '定期');

async function pickBackup(list) {
  return chooseSheet('復元するバックアップ', list.map((b) => ({ value: b.id, label: `${fmtInstant(b.createdAt)}・${typeLabel(b)}・${describeCounts(b.meta?.counts)}` })));
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
  const id = await pickBackup(list);
  if (!id) return;
  if (!(await confirmSheet('端末のデータをこのバックアップで置き換えますか？', { ok: '復元', danger: true, detail: '置き換える前の状態は控えに残すので、「元に戻す」で戻せます。' }))) return;
  try {
    await restoreFromDrive(id);
    toast('復元しました', { action: { label: '元に戻す', onClick: undoFlow } });
    rerender();
  } catch (e) {
    toast(`復元できませんでした：${e.message}`, { error: true });
  }
}

/** 「元に戻す」（F-MIG-12） */
async function undoFlow() {
  const snaps = await listSnapshots();
  if (!snaps.length) { toast('戻せる控えはありません'); return; }
  const key = await chooseSheet('どの時点に戻しますか？', snaps.map((s) => ({ value: s.key, label: `${fmtInstant(s.createdAt)}・${s.reason}・${describeCounts(s.counts)}` })));
  if (!key) return;
  if (!(await confirmSheet('この時点の状態に戻しますか？', { ok: '戻す', detail: '戻す前の状態も控えに残します。' }))) return;
  await undoToSnapshot(key);
  toast('元に戻しました');
  rerender();
}

async function showLinkQr() {
  if (!(await confirmSheet('機種変更用の QR コードを表示しますか？', { ok: '表示する', detail: 'QR コードには連携用URLと合言葉が入っています。他の人に見せたり、撮影させたりしないでください。' }))) return;
  const code = linkCode();
  const canvas = await qrCanvas(code, 260);
  const dlg = h('dialog', { class: 'sheet center' },
    h('h2', { class: 'sheet-title' }, '機種変更用の QR コード'),
    h('p', { class: 'help' }, '新しい端末で「設定 > Google 連携 > QR コードを読み取る」を開いて、この画面を写してください。'),
    canvas,
    h('div', { class: 'sheet-actions' },
      button('連携コードをコピー', () => copyText(code, '連携コードをコピーしました。使い終わったら消してください'), 'small ghost'),
      button('閉じる', () => dlg.close(), 'primary')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function googleSection() {
  if (!isLinked()) return section('Google 連携', linkForm());
  const toggles = [
    ['syncEnabled', true, '放送予定を Google カレンダーに登録する', 'オフにすると、カレンダー「ラジオ番組」の放送予定を削除します'],
    ['syncDeadlines', true, 'コーナーの締切を Google ToDo リストに登録する', null],
    ['syncCatchup', false, '聴取期限を予定として登録する（通知なし）', '個別に通知する設定の番組は、この設定に関係なく通知付きで登録します'],
  ];
  return section('Google 連携',
    gasOutdated() ? h('p', { class: 'notice warn' }, 'GAS が古い版です。新着の自動検知・今日のまとめ・合言葉の再発行を使うには、README の「GAS を更新する」の手順で Code.gs を置き換えてください。') : null,
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
    h('div', { class: 'row-actions' },
      button('機種変更用の QR コード', showLinkQr, 'small'),
      button('合言葉を再発行', async () => {
        if (!(await confirmSheet('合言葉を再発行しますか？', { ok: '再発行', detail: '古い合言葉はすぐに使えなくなります。この端末は新しい合言葉に自動で切り替わります。ほかの端末で連携している場合は、その端末で連携し直してください。' }))) return;
        try { await rotateSecret(); toast('合言葉を再発行しました'); } catch (e) { toast(e.message, { error: true }); }
      }, 'small'),
      button('連携を解除', async () => {
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

function notifySection() {
  return section('通知',
    h('div', { class: 'list' },
      h('label', { class: 'check-row' },
        h('input', { type: 'checkbox', checked: getSetting('summaryEnabled', true), onchange: (e) => { setSetting('summaryEnabled', e.target.checked); notifyChange(); } }),
        h('span', null, '毎朝「今日のまとめ」を通知する'),
        h('small', { class: 'help' }, '今夜の番組、当日・翌日が締切のお題、期限が1日以内の未聴の回、新着の回の件数をまとめます')),
      h('div', { class: 'row' },
        h('label', { class: 'row-main', for: 's-summary' }, h('strong', null, 'まとめの時刻')),
        h('input', { id: 's-summary', type: 'time', class: 'narrow', value: getSetting('summaryTime', '7:00').padStart(5, '0'), onchange: (e) => { if (e.target.value) { setSetting('summaryTime', e.target.value.replace(/^0/, '')); notifyChange(); } } }))),
    h('div', { class: 'row-actions' },
      button('通知テスト', async () => {
        if (!isLinked()) { toast('Google 連携をすると使えます', { error: true }); return; }
        try {
          const res = await testNotification(3);
          toast(`${fmtInstant(res.at)} に通知が鳴る予定を入れました`);
        } catch (e) { toast(e.message, { error: true }); }
      }, 'small'),
      linkButton('睡眠・集中モードでも鳴らす設定', '#/guide/notify', 'small')));
}

function bulkMediaChange() {
  const stations = [...new Set(all('channels').map((c) => c.station).filter(Boolean))].sort();
  if (!stations.length) { toast('局名が登録された配信媒体がありません'); return; }
  const media = MEDIA_TYPES.map((m) => ({ value: m.id, label: m.label }));
  openForm({
    title: '放送局の媒体を一括で付け替える',
    fields: [
      { name: 'station', label: '放送局', type: 'select', options: stations.map((s) => ({ value: s, label: s })) },
      { name: 'from', label: '変更前の媒体', type: 'select', options: [{ value: '', label: 'すべて' }, ...media] },
      { name: 'to', label: '変更後の媒体', type: 'select', options: media },
      { name: 'frequency', label: '新しい周波数（任意）' },
      { name: 'unit', label: '単位', type: 'select', options: [{ value: '', label: '変えない' }, { value: 'kHz', label: 'kHz' }, { value: 'MHz', label: 'MHz' }] },
    ],
    values: { from: 'am', to: 'fm', unit: 'MHz' },
    submitLabel: '付け替える',
    onSubmit: async (v) => {
      const targets = all('channels').filter((c) => c.station === v.station && (!v.from || c.mediaType === v.from));
      if (!targets.length) { toast('該当する配信媒体がありません', { error: true }); return false; }
      if (!(await confirmSheet(`${targets.length}件の配信媒体を「${mediaLabel(v.to)}」に付け替えますか？`, { ok: '付け替える' }))) return false;
      for (const c of targets) {
        save('channels', { ...c, mediaType: v.to, frequency: v.frequency || c.frequency, unit: v.unit || c.unit }, { silent: true });
      }
      notifyChange();
      toast(`${targets.length}件を付け替えました`);
      return true;
    },
  });
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

async function exportAllFile() {
  const how = await saveJsonFile(`radio-calendar-${stamp()}.json`, exportAll());
  if (how !== 'cancelled') {
    setSetting('lastExportAt', Date.now());
    toast('全データを書き出しました（連携用URLと合言葉は含みません）');
  }
}

async function importAllFile() {
  try {
    const json = await pickJsonFile();
    if (!json) return;
    if (!(await confirmSheet('端末のデータをこのファイルで置き換えますか？', { ok: '読み込む', danger: true, detail: '置き換える前の状態は控えに残すので、「元に戻す」で戻せます。' }))) return;
    await replaceAllData(json, 'ファイルを読み込む前');
    toast('読み込みました', { action: { label: '元に戻す', onClick: undoFlow } });
    rerender();
  } catch (ex) {
    toast(`読み込めませんでした：${ex.message}`, { error: true });
  }
}

export function renderSettings() {
  const seg = (key, def, options, label) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([v, l]) => h('button', {
    type: 'button', class: getSetting(key, def) === v ? 'on' : '', 'aria-pressed': String(getSetting(key, def) === v),
    onclick: () => { setSetting(key, v); notifyChange(); rerender(); },
  }, l)));
  const warn = backupWarning();

  return page({ title: '設定', tab: 'settings' },
    isIos() && !isStandalone() ? h('p', { class: 'notice' }, 'Safari の共有メニューから「ホーム画面に追加」して使ってください。タブのままだと、しばらく使わないときに端末内のデータが消える場合があります。') : null,
    warn ? h('p', { class: 'notice warn' }, `${warn}。Google 連携をするか、下の「全データを書き出す」で保存してください。`) : null,
    googleSection(),
    notifySection(),
    section('radiko',
      h('div', { class: 'row card' }, h('span', { class: 'row-main' }, h('strong', null, 'プラン'), h('small', null, '聴取期限の計算に使います（無料：放送から7日、タイムフリー30：30日）')),
        seg('radikoPlan', 'free', [['free', '無料'], ['tf30', 'TF30']], 'radiko のプラン'))),
    section('投稿',
      h('div', { class: 'row card' }, h('span', { class: 'row-main' }, h('strong', null, 'メールアプリ'), h('small', null, 'Gmail が入っていない場合は既定のアプリで開きます')),
        seg('mailApp', 'gmail', [['gmail', 'Gmail'], ['default', '既定']], 'メールアプリ'))),
    section('番組',
      h('div', { class: 'list' },
        h('label', { class: 'check-row' },
          h('input', { type: 'checkbox', checked: getSetting('kaihenNotice', true), onchange: (e) => { setSetting('kaihenNotice', e.target.checked); notifyChange(); } }),
          h('span', null, '改編期（4月・10月）の前に、番組の見直しを今日のまとめで知らせる'))),
      h('div', { class: 'row-actions' },
        button('放送局の媒体を一括で付け替える', bulkMediaChange, 'small'),
        button('共有ファイルに書き出す', () => exportShare(), 'small'),
        button('共有ファイルを取り込む', () => importShareFlow(), 'small'),
        button('プリセットの管理', managePresets, 'small'))),
    section('データの保存と引き継ぎ',
      h('p', { class: 'help' }, 'データはこの端末と、連携した自分の Google アカウントにだけ保存されます。最終の書き出し：', fmtTime(getSetting('lastExportAt', null))),
      h('div', { class: 'row-actions' },
        button('全データを書き出す', exportAllFile, 'small'),
        button('ファイルから読み込む', importAllFile, 'small'),
        button('元に戻す', undoFlow, 'small'),
        linkButton('機種変更の手順', '#/guide/migrate', 'small'))),
    section('このアプリ',
      h('p', { class: 'help' }, 'ラジオ番組カレンダー 2.0.0（要件定義書 第2版）'),
      h('p', { class: 'help' }, '通知は iPhone の Google カレンダーアプリが行います。'),
      externalLink('Google カレンダーを開く', 'https://calendar.google.com/', 'btn small')),
  );
}

export { callGas };
