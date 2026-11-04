// 配信媒体の管理

import { h, page, empty, button, externalLink, openForm, rerender, confirmSheet, toast } from '../ui.js';
import { all, byProgram, get, remove, save } from '../store.js';
import { MEDIA_TYPES, mediaLabel, safeUrl } from '../domain.js';
import { notFound } from './programs.js';

const mediaOptions = MEDIA_TYPES.map((m) => ({ value: m.id, label: m.label }));

const fields = (presets) => [
  ...(presets.length ? [{ name: 'preset', label: 'プリセットから入力', type: 'select', options: [{ value: '', label: '使わない' }, ...presets.map((p) => ({ value: p.id, label: p.name }))] }] : []),
  { name: 'mediaType', label: '媒体の種類', type: 'select', options: mediaOptions, required: true },
  { name: 'station', label: '局名・サービス名', placeholder: '例：radiko' },
  { name: 'frequency', label: '周波数', placeholder: '954' },
  { name: 'unit', label: '単位', type: 'select', options: [{ value: '', label: 'なし' }, { value: 'kHz', label: 'kHz' }, { value: 'MHz', label: 'MHz' }] },
  { name: 'url', label: '配信URL', type: 'url', placeholder: 'https://' },
  { name: 'region', label: '地域', placeholder: '例：関東' },
  { name: 'offsetDays', label: '放送時刻のずれ（日）', type: 'number', min: 0, help: '遅れネットや後日公開の場合に入力します' },
  { name: 'offsetMins', label: '放送時刻のずれ（分）', type: 'number', min: 0 },
  { name: 'catchupDays', label: '聴き逃し配信の期限（放送後の日数）', type: 'number', min: 0, help: '例：タイムフリーなら 7。聴き逃し配信がなければ空欄' },
  { name: 'savePreset', label: 'この内容をプリセットに保存する', type: 'checkbox' },
];

function openChannel(programId, channel) {
  const presets = all('presets');
  const values = channel
    ? { ...channel, offsetDays: Math.floor((channel.offsetMin || 0) / 1440) || '', offsetMins: (channel.offsetMin || 0) % 1440 || '' }
    : { mediaType: 'net' };
  openForm({
    title: channel ? '配信媒体を編集' : '配信媒体を追加',
    fields: fields(presets),
    values,
    validate: (v) => (v.url && !safeUrl(v.url) ? { url: 'https:// から始まるURLを入力してください' } : {}),
    onSubmit: (v) => {
      const preset = v.preset ? get('presets', v.preset) : null;
      const row = {
        ...(channel || { programId }),
        mediaType: v.mediaType,
        station: v.station || preset?.station || '',
        frequency: v.frequency || preset?.frequency || '',
        unit: v.unit || preset?.unit || '',
        url: v.url || preset?.url || '',
        region: v.region || preset?.region || '',
        offsetMin: (v.offsetDays || 0) * 1440 + (v.offsetMins || 0),
        catchupDays: v.catchupDays || 0,
      };
      if (preset && !channel) row.mediaType = preset.mediaType;
      save('channels', row);
      if (v.savePreset) {
        const name = [mediaLabel(row.mediaType), row.station].filter(Boolean).join(' ');
        save('presets', { name, mediaType: row.mediaType, station: row.station, frequency: row.frequency, unit: row.unit, url: row.url, region: row.region });
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
          h('small', null, [c.frequency ? `${c.frequency}${c.unit || ''}` : '', c.region, c.offsetMin ? `${c.offsetMin}分遅れ` : '', c.catchupDays ? `聴き逃し${c.catchupDays}日` : ''].filter(Boolean).join('・') || '詳細なし')),
        c.url ? externalLink('聴く', c.url, 'btn small primary') : null)))
      : empty('AM / FM / radiko / YouTube など、聴く手段を登録します。', button('配信媒体を追加', () => openChannel(programId, null), 'primary')));
}
