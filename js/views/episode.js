// 放送回詳細

import { h, page, section, button, externalLink, colorDot, openForm, rerender, toast, confirmSheet } from '../ui.js';
import { remove, byProgram, all } from '../store.js';
import { occurrenceByKey, saveEpisode, catchupExpiry, timefreeStatus, radikoPlan } from '../episodes.js';
import { mediaLabel, REMINDER_CHOICES, reminderLabel } from '../domain.js';
import { dayToYmd, fmtDay, fmtHM, fmtInstant, jstDay, jstMin, parseHM, fmtRemaining } from '../time.js';
import { composeX } from '../mail.js';
import { xSearchUrl } from '../links.js';
import { memoRows, openMemo } from './memos.js';
import { notFound, archiveProgram } from './programs.js';

const STATUS = [
  { value: 'normal', label: '通常' },
  { value: 'cancelled', label: '休止' },
  { value: 'special', label: '特番' },
  { value: 'changed', label: '時間変更' },
];

function editEpisode(occ) {
  const ep = occ.episode;
  const fields = [
    { name: 'status', label: '状態', type: 'select', options: STATUS },
    { name: 'title', label: '回のタイトル（特番名など）' },
    { name: 'overrideDate', label: '放送日', type: 'date', help: '時間変更・特番で日時が変わるときだけ入力します。深夜は前日の日付（放送日）です' },
    { name: 'overrideStart', label: '開始時刻', placeholder: fmtHM(occ.startMin) },
    { name: 'overrideEnd', label: '終了時刻', placeholder: fmtHM(occ.endMin) },
  ];
  const timeErr = (s) => s !== '' && parseHM(s) == null;
  const isStandalone = !occ.schedule;
  openForm({
    title: 'この回を変更',
    fields,
    values: {
      status: occ.status,
      title: ep?.title || '',
      overrideDate: ep?.overrideDate || '',
      overrideStart: ep?.overrideStart || '',
      overrideEnd: ep?.overrideEnd || '',
    },
    validate: (v) => {
      const e = {};
      if (timeErr(v.overrideStart)) e.overrideStart = '25:00 の形式で入力してください';
      else if (v.overrideStart && (parseHM(v.overrideStart) < 300 || parseHM(v.overrideStart) >= 1740)) e.overrideStart = '開始時刻は 5:00〜28:59 で入力してください';
      if (timeErr(v.overrideEnd)) e.overrideEnd = '27:00 の形式で入力してください';
      if (v.status === 'changed' && !v.overrideStart) e.overrideStart = '変更後の開始時刻を入力してください';
      if (isStandalone && !v.overrideStart) e.overrideStart = '開始時刻を入力してください';
      return e;
    },
    onSubmit: (v) => {
      const start = v.overrideStart ? fmtHM(parseHM(v.overrideStart)) : '';
      const patch = {
        status: v.status,
        title: v.title,
        overrideStart: v.status === 'cancelled' && !isStandalone ? '' : start,
        overrideEnd: v.status === 'cancelled' && !isStandalone ? '' : (v.overrideEnd ? fmtHM(parseHM(v.overrideEnd)) : ''),
        overrideDate: v.overrideDate || (start ? dayToYmd(occ.day) : ''),
      };
      saveEpisode(occ, patch);
      toast('変更しました');
      rerender();
    },
    onDelete: isStandalone ? async () => {
      if (!(await confirmSheet('この特番を削除しますか？', { ok: '削除', danger: true }))) return false;
      remove('episodes', ep.id);
      location.hash = `#/program/${occ.program.id}`;
      return true;
    } : null,
  });
}

function editReminder(occ) {
  const current = occ.episode?.reminders;
  const base = current ?? occ.program.reminders ?? [15];
  const presets = REMINDER_CHOICES.map((c) => c.value);
  const custom = base.find((m) => !presets.includes(m));
  openForm({
    title: 'この回の通知',
    fields: [
      { name: 'useCustom', label: 'この回だけ通知を変更する', type: 'checkbox' },
      { name: 'minutes', label: '通知', type: 'checks', options: REMINDER_CHOICES },
      { name: 'custom', label: '任意（分前）', type: 'number', min: 0 },
    ],
    values: { useCustom: Array.isArray(current), minutes: base.filter((m) => presets.includes(m)), custom: custom ?? '' },
    onSubmit: (v) => {
      const list = [...v.minutes];
      if (v.custom != null) list.push(v.custom);
      saveEpisode(occ, { reminders: v.useCustom ? [...new Set(list)] : null });
      rerender();
    },
  });
}

/** タイムフリーの聴き始めと聴いた時間（F-TF-04） */
function timefreeSection(occ, now) {
  if (occ.program.timefree === false) return h('p', { class: 'muted pad' }, 'この番組はタイムフリーで聴けない設定です（生で聴く番組）');
  const hasRadiko = byProgram('channels', occ.program.id).some((c) => c.catchupMode === 'radiko');
  if (!hasRadiko || occ.endMs > now || occ.listened) return null;
  const tf = timefreeStatus(occ, now);
  const addMinutes = (m) => { saveEpisode(occ, { listenedMinutes: Math.max((occ.episode?.listenedMinutes || 0) + m, 0) }); rerender(); };
  return h('div', { class: 'card tf' },
    tf
      ? h('div', { class: 'row-main' },
        h('strong', null, tf.expired ? '聴き始めてから24時間を過ぎました' : `24時間の残り ${fmtRemaining(tf.windowLeftMs)}`),
        radikoPlan() === 'free' ? h('small', null, `聴いた時間 ${tf.usedMinutes}分・3時間の残り ${tf.leftMinutes}分`) : h('small', null, `聴いた時間 ${tf.usedMinutes}分`))
      : h('div', { class: 'row-main' }, h('strong', null, 'タイムフリーで聴く'), h('small', null, radikoPlan() === 'free' ? '無料のタイムフリーは、聴き始めてから24時間以内に合計3時間まで聴けます' : 'タイムフリー30 は期限内なら時間の制限なく聴けます')),
    h('div', { class: 'row-actions' },
      tf ? null : button('聴き始めた', () => { saveEpisode(occ, { tfStartedAt: Date.now(), listenedMinutes: 0 }); rerender(); }, 'small primary'),
      tf ? button('+15分', () => addMinutes(15), 'small') : null,
      tf ? button('+30分', () => addMinutes(30), 'small') : null,
      tf ? button('+60分', () => addMinutes(60), 'small') : null,
      tf ? button('取り消し', () => { saveEpisode(occ, { tfStartedAt: null, listenedMinutes: 0 }); rerender(); }, 'small ghost') : null));
}

export function renderEpisode(key) {
  const occ = occurrenceByKey(decodeURIComponent(key));
  if (!occ) return notFound();
  const p = occ.program;
  const crosses = jstDay(occ.startMs) !== occ.day;
  const channels = byProgram('channels', p.id);
  const epId = occ.episode?.id;
  const ymd = dayToYmd(occ.day);
  const memos = all('memos').filter((m) => m.programId === p.id && (m.episodeId === epId && epId)).sort((a, b) => b.createdAt - a.createdAt);
  const cancelled = occ.status === 'cancelled';
  const now = Date.now();
  const onAirNow = occ.startMs <= now && now < occ.endMs && !cancelled;
  const label = STATUS.find((s) => s.value === occ.status)?.label;
  const tags = p.hashtags || [];

  const addMemo = () => {
    const ep = occ.episode || saveEpisode(occ, {});
    openMemo(null, { programId: p.id, episodeId: ep.id, episodeDate: ymd });
  };
  const reminderText = Array.isArray(occ.episode?.reminders)
    ? `${occ.episode.reminders.map(reminderLabel).join('・') || 'なし'}（この回のみ）`
    : `${(p.reminders ?? [15]).map(reminderLabel).join('・') || 'なし'}（番組の既定）`;
  const finalEpisode = async () => {
    if (!(await confirmSheet('この回を最終回にしますか？', { ok: '最終回にする', danger: true, detail: `${fmtDay(occ.day)} を放送期間の終了日にして、番組をアーカイブへ移します。以降の予定はカレンダーと Google カレンダーから外れます。` }))) return;
    archiveProgram(p, ymd);
    toast('最終回にしました');
    location.hash = `#/program/${p.id}`;
  };

  return page({ title: '放送回', back: '#/calendar', tab: 'calendar' },
    h('a', { class: 'prog-head link', href: `#/program/${p.id}`, style: `--c:${p.color}` },
      colorDot(p),
      h('span', { class: 'row-main' }, h('strong', null, p.name), h('small', null, [p.personality, p.station].filter(Boolean).join('・') || '番組詳細へ')),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')),
    section(null,
      h('div', { class: `ep-time ${cancelled ? 'is-cancelled' : ''}` },
        h('strong', null, `${fmtDay(occ.day)} ${fmtHM(occ.startMin)}〜${fmtHM(occ.endMin)}`),
        crosses ? h('small', null, `実際の日時：${fmtDay(jstDay(occ.startMs))} ${fmtHM(jstMin(occ.startMs))} 開始`) : null),
      h('div', { class: 'ep-tags' },
        onAirNow ? h('span', { class: 'onair-badge' }, 'ON AIR') : null,
        occ.status !== 'normal' ? h('span', { class: `tag tag-${occ.status}` }, label) : null,
        occ.title ? h('span', { class: 'tag' }, occ.title) : null),
      tags.length ? h('div', { class: 'row-actions' },
        button(onAirNow ? '実況する（放送中）' : '実況する', () => composeX({ program: p, text: `${tags.join(' ')} ` }), onAirNow ? 'primary' : 'small'),
        externalLink('みんなの反応', xSearchUrl(tags.join(' OR ')), 'btn small')) : null,
      h('div', { class: 'row-actions' },
        button('この回を変更', () => editEpisode(occ), 'small'),
        !occ.schedule ? null : button(cancelled ? '休止を取り消す' : '休止にする', () => {
          saveEpisode(occ, { status: cancelled ? 'normal' : 'cancelled', overrideStart: '', overrideEnd: '', overrideDate: '' });
          toast(cancelled ? '休止を取り消しました' : '休止にしました');
          rerender();
        }, 'small'),
        p.archived ? null : button('最終回にする', finalEpisode, 'small ghost danger'))),
    section('聴取',
      h('label', { class: 'check-row card' },
        h('input', { type: 'checkbox', checked: occ.listened, onchange: (e) => { saveEpisode(occ, { listened: e.target.checked }); rerender(); } }),
        h('span', null, '聴取済み')),
      timefreeSection(occ, now),
      channels.length
        ? h('div', { class: 'list' }, channels.map((c) => {
          const start = occ.startMs + (c.offsetMin || 0) * 60000;
          const expiry = catchupExpiry(occ, c);
          const info = [];
          if (c.offsetMin) info.push(`配信 ${fmtInstant(start)}`);
          if (expiry != null) info.push(expiry > now ? `聴取期限 ${fmtInstant(expiry)}（あと${fmtRemaining(expiry - now)}）` : '聴取期限切れ');
          return h('div', { class: 'row' },
            h('span', { class: 'row-main' }, h('strong', null, [mediaLabel(c.mediaType), c.station].filter(Boolean).join(' ')), info.length ? h('small', null, info.join('・')) : null),
            c.url ? externalLink('聴く', c.url, 'btn small primary') : null);
        }))
        : h('p', { class: 'muted pad' }, '配信媒体が未登録です')),
    section('通知',
      h('div', { class: 'row card' }, h('span', { class: 'row-main' }, reminderText), button('変更', () => editReminder(occ), 'small'))),
    section('この回のメモ',
      memos.length ? memoRows(memos) : h('p', { class: 'muted pad' }, 'メモはまだありません'),
      h('div', { class: 'row-actions' }, button('＋ メモを追加', addMemo, 'small'))));
}
