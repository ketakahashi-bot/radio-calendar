// 配信媒体（聴取手段）の管理。聴き逃し配信と、YouTube・ポッドキャストの RSS（F-MED, F-FEED）

import { h, page, empty, button, externalLink, openForm, rerender, confirmSheet, toast, readForm } from '../ui.js';
import { all, byProgram, get, getSetting, remove, save } from '../store.js';
import { MEDIA_TYPES, mediaLabel, safeUrl } from '../domain.js';
import { splitList, youtubeFeedFromUrl, isYoutubeUrl } from '../links.js';
import { isLinked, resolveFeed, gasOutdated, MAX_FEEDS } from '../sync.js';
import { fmtInstant } from '../time.js';
import { notFound } from './programs.js';

const mediaOptions = MEDIA_TYPES.map((m) => ({ value: m.id, label: m.label }));
const words = (s) => splitList(s, (w) => w.trim());

const fields = (presets) => [
  ...(presets.length ? [{ name: 'preset', label: 'プリセットから入力', type: 'select', options: [{ value: '', label: '使わない' }, ...presets.map((p) => ({ value: p.id, label: p.name }))] }] : []),
  { name: 'mediaType', label: '媒体の種類', type: 'select', options: mediaOptions, required: true },
  { name: 'station', label: '局名・サービス名', placeholder: '例：radiko' },
  { name: 'frequency', label: '周波数', placeholder: '954' },
  { name: 'unit', label: '単位', type: 'select', options: [{ value: '', label: 'なし' }, { value: 'kHz', label: 'kHz' }, { value: 'MHz', label: 'MHz' }] },
  { name: 'url', label: '配信URL（聴くボタンで開く）', type: 'url', placeholder: 'https://' },
  { name: 'region', label: '地域', placeholder: '例：関東' },
  { name: 'offsetDays', label: '放送時刻のずれ（日）', type: 'number', min: 0, help: '遅れネットや後日公開の場合に入力します' },
  { name: 'offsetMins', label: '放送時刻のずれ（分）', type: 'number', min: 0 },
  {
    name: 'catchupMode', label: '聴き逃し配信', type: 'select',
    options: [{ value: '', label: 'なし' }, { value: 'radiko', label: 'radiko のタイムフリー（期限は設定のプランで計算）' }, { value: 'days', label: 'その他（日数を指定）' }],
  },
  { name: 'catchupDays', label: '聴き逃し配信の期限（放送後の日数）', type: 'number', min: 0, help: '「その他」のときに使います。例：らじる★らじるの聴き逃しなら 7' },
  { name: 'radikoStation', label: 'radiko の局ID', placeholder: '例：TBS', help: '投稿履歴の「読まれた」回を radiko で開くときに使います（任意）' },
  { name: 'rssUrl', label: '新着を検知する URL（YouTube チャンネル・ポッドキャストの RSS）', placeholder: 'https://www.youtube.com/@… または RSS の URL', help: `アプリを閉じていても1時間ごとに確認します（Google 連携が必要。全体で${MAX_FEEDS}件まで）` },
  { name: 'feedInclude', label: 'タイトルにこの語を含む回だけ（スペース区切り）', placeholder: '本編' },
  { name: 'feedExclude', label: 'タイトルにこの語を含む回は除く（スペース区切り）', placeholder: '切り抜き #shorts' },
  { name: 'feedCalendar', label: '新着の回を Google カレンダーにも入れる（通知なし）', type: 'checkbox' },
  { name: 'savePreset', label: 'この内容をプリセットに保存する', type: 'checkbox' },
];

/** 入力された URL から RSS を求める。YouTube の @ハンドルなどは GAS にページを読んでもらう */
async function resolveRss(raw) {
  const url = raw.trim();
  if (!url) return { rssUrl: '', rssKind: '' };
  const direct = youtubeFeedFromUrl(url);
  if (direct) return { rssUrl: direct, rssKind: 'youtube' };
  if (!isLinked() || gasOutdated()) {
    if (isYoutubeUrl(url)) throw new Error('この YouTube の URL から RSS を求めるには、Google 連携（第2版の GAS）が必要です。チャンネルID（UC…）の URL なら連携なしでも登録できます');
    return { rssUrl: url, rssKind: 'podcast' };
  }
  const res = await resolveFeed(url);
  toast(`「${res.title || 'RSS'}」を確認しました（${res.count}件）`);
  return { rssUrl: res.feedUrl, rssKind: res.kind };
}

function openChannel(programId, channel) {
  const presets = all('presets');
  const values = channel
    ? {
      ...channel,
      offsetDays: Math.floor((channel.offsetMin || 0) / 1440) || '',
      offsetMins: (channel.offsetMin || 0) % 1440 || '',
      feedInclude: (channel.feedInclude || []).join(' '),
      feedExclude: (channel.feedExclude || []).join(' '),
    }
    : { mediaType: 'net', catchupMode: '' };
  const list = fields(presets);
  openForm({
    title: channel ? '配信媒体を編集' : '配信媒体を追加',
    fields: list,
    values,
    validate: (v) => {
      const e = {};
      if (v.url && !safeUrl(v.url)) e.url = 'https:// から始まるURLを入力してください';
      if (v.rssUrl && !/^https?:\/\//.test(v.rssUrl)) e.rssUrl = 'https:// から始まるURLを入力してください';
      if (v.catchupMode === 'days' && !(v.catchupDays > 0)) e.catchupDays = '日数を入力してください';
      const feeds = all('channels').filter((c) => c.rssUrl && c.id !== channel?.id).length;
      if (v.rssUrl && feeds >= MAX_FEEDS) e.rssUrl = `新着を検知できるのは全体で${MAX_FEEDS}件までです`;
      return e;
    },
    onSubmit: async (v, form) => {
      let rss = { rssUrl: channel?.rssUrl || '', rssKind: channel?.rssKind || '' };
      if (v.rssUrl !== (channel?.rssUrl || '')) {
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        submit.textContent = '確認中…';
        try {
          rss = await resolveRss(v.rssUrl);
        } catch (err) {
          form.querySelector('[data-error="rssUrl"]').textContent = err.message;
          submit.disabled = false;
          submit.textContent = '保存';
          return false;
        }
      }
      const preset = v.preset ? get('presets', v.preset) : null;
      const row = {
        ...(channel || { programId }),
        mediaType: preset && !channel ? preset.mediaType : v.mediaType,
        station: v.station || preset?.station || '',
        frequency: v.frequency || preset?.frequency || '',
        unit: v.unit || preset?.unit || '',
        url: v.url || preset?.url || '',
        region: v.region || preset?.region || '',
        offsetMin: (v.offsetDays || 0) * 1440 + (v.offsetMins || 0),
        catchupMode: v.catchupMode,
        catchupDays: v.catchupMode === 'days' ? v.catchupDays : 0,
        radikoStation: v.radikoStation || preset?.radikoStation || '',
        ...rss,
        feedInclude: words(v.feedInclude),
        feedExclude: words(v.feedExclude),
        feedCalendar: v.feedCalendar,
      };
      save('channels', row);
      if (v.savePreset) {
        const name = [mediaLabel(row.mediaType), row.station].filter(Boolean).join(' ');
        save('presets', { name, mediaType: row.mediaType, station: row.station, frequency: row.frequency, unit: row.unit, url: row.url, region: row.region, radikoStation: row.radikoStation });
        toast('プリセットに保存しました');
      }
      rerender();
    },
    onDelete: channel ? async () => {
      if (!(await confirmSheet('この配信媒体を削除しますか？', { ok: '削除', danger: true }))) return false;
      remove('channels', channel.id);
      rerender();
      return true;
    } : null,
  });
}

function feedState(c) {
  if (!c.rssUrl) return null;
  const st = getSetting('feedStatus', {})[c.id];
  if (!isLinked()) return '新着検知：Google 連携後に動きます';
  if (gasOutdated()) return '新着検知：GAS の更新が必要です';
  if (!st) return '新着検知：次の同期で登録します';
  if (st.error) return `新着検知：失敗（${st.error}）`;
  return `新着検知：${st.lastChecked ? `${fmtInstant(st.lastChecked)} に確認` : '確認待ち'}`;
}

export function renderChannels(programId) {
  const p = get('programs', programId);
  if (!p) return notFound();
  const rows = byProgram('channels', programId);
  return page({ title: '配信媒体', back: `#/program/${programId}`, tab: 'programs', actions: button('＋ 追加', () => openChannel(programId, null), 'small') },
    h('p', { class: 'muted pad' }, p.name),
    rows.length
      ? h('div', { class: 'list' }, rows.map((c) => h('div', { class: 'row' },
        h('button', { type: 'button', class: 'row-main plain', onclick: () => openChannel(programId, c) },
          h('strong', null, [mediaLabel(c.mediaType), c.station].filter(Boolean).join(' ')),
          h('small', null, [c.frequency ? `${c.frequency}${c.unit || ''}` : '', c.region, c.offsetMin ? `${c.offsetMin}分遅れ` : '',
            c.catchupMode === 'radiko' ? 'タイムフリー' : c.catchupMode === 'days' ? `聴き逃し${c.catchupDays}日` : ''].filter(Boolean).join('・') || '詳細なし'),
          feedState(c) ? h('small', null, feedState(c)) : null),
        c.url ? externalLink('聴く', c.url, 'btn small primary') : null)))
      : empty('AM / FM / radiko / YouTube / ポッドキャストなど、聴く手段を登録します。', button('配信媒体を追加', () => openChannel(programId, null), 'primary')));
}

export { readForm };
