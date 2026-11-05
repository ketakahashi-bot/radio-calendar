// 案内画面：集中モードでも通知を鳴らす設定（F-NTF-01）と、機種変更の手順（F-MIG-11）

import { h, page, section, button, linkButton, toast } from '../ui.js';
import { isLinked, testNotification } from '../sync.js';
import { fmtInstant } from '../time.js';

const steps = (...items) => h('ol', { class: 'steps' }, items.map((t) => h('li', null, t)));

export function renderNotifyGuide() {
  return page({ title: '通知の設定', back: '#/settings', tab: 'settings' },
    h('p', { class: 'help' }, '深夜は睡眠モードやおやすみモードがオンになっていることが多く、そのままでは放送開始の通知が鳴りません。次の設定で、Google カレンダーアプリの通知だけ許可します。'),
    section('1. Google カレンダーアプリの準備',
      steps(
        'App Store から「Google カレンダー」を入れて、このアプリと同じ Google アカウントでログインする',
        'Google カレンダーアプリのメニューで、カレンダー「ラジオ番組」にチェックが入っていることを確かめる',
        'iPhone の「設定 > 通知 > Google カレンダー」で「通知を許可」をオンにする')),
    section('2. 睡眠・おやすみモードで通知を許可する',
      steps(
        'iPhone の「設定 > 集中モード」を開き、「睡眠」を選ぶ',
        '「通知を許可」の「App」で「App を追加」を押し、「Google カレンダー」を追加する',
        '「おやすみモード」など、夜に使う集中モードがほかにもあれば、同じように追加する'),
      h('p', { class: 'help' }, 'iOS の版によって項目名が少し違うことがあります。')),
    section('3. 鳴るか確かめる',
      h('p', { class: 'help' }, '睡眠モードをオンにした状態で通知テストを行い、数分後に鳴るか確かめてください。'),
      h('div', { class: 'row-actions' }, button('通知テスト（3分後）', async () => {
        if (!isLinked()) { toast('Google 連携をすると使えます', { error: true }); return; }
        try {
          const res = await testNotification(3);
          toast(`${fmtInstant(res.at)} に通知が鳴る予定を入れました`);
        } catch (e) { toast(e.message, { error: true }); }
      }, 'primary'))));
}

export function renderMigrateGuide() {
  return page({ title: '機種変更の手順', back: '#/settings', tab: 'settings' },
    h('p', { class: 'help' }, 'iPhone から Android など、OS の違う機種でも同じ手順で引き継げます。データは Google ドライブのバックアップから戻します。'),
    section('前の端末でやること',
      steps(
        'このアプリを開き、「設定 > Google 連携 > 今すぐバックアップ」を押す',
        '念のため「設定 > 全データを書き出す」で、ファイルにも保存しておく（iCloud Drive など）',
        '「設定 > Google 連携 > 機種変更用の QR コード」を表示しておく')),
    section('新しい端末でやること',
      steps(
        'ブラウザでこのアプリを開き、ホーム画面に追加する（iPhone は Safari の共有メニューから）',
        'ホーム画面のアイコンから起動し、「設定 > Google 連携 > QR コードを読み取る」で前の端末の QR コードを写す',
        'バックアップが見つかったら、件数を確かめて「復元する」を選ぶ',
        'Google カレンダーアプリを入れて、通知の設定をする'),
      h('p', { class: 'help' }, '復元しても Google カレンダーの予定は重複しません。')),
    section('前の端末がないとき',
      steps(
        'PC で GAS のエディタを開き、連携用URL（デプロイを管理）と合言葉（プロジェクトの設定 > スクリプト プロパティの SECRET）を確かめる',
        '新しい端末の「設定 > Google 連携」に入力して連携する',
        '前の端末を他人が使えるおそれがあるときは、連携後に「合言葉を再発行」する')),
    section('Google 連携をしていないとき',
      h('p', { class: 'help' }, '前の端末で書き出したファイルを、新しい端末の「設定 > ファイルから読み込む」で取り込んでください。')),
    h('div', { class: 'row-actions' }, linkButton('設定に戻る', '#/settings', 'small')));
}
