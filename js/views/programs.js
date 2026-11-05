// 番組一覧・番組詳細・番組編集（放送枠を含む）

import { h, page, section, empty, button, linkButton, externalLink, colorDot, toast, confirmSheet, openForm, rerender, copyText, GENERIC_ICONS, svgIcon, chooseSheet } from '../ui.js';
import { all, get, save, remove, removeProgram, byProgram } from '../store.js';
import { MEDIA_TYPES, COLORS, DEFAULT_COLOR, REMINDER_CHOICES, reminderLabel, mediaLabel, safeUrl } from '../domain.js';
import { describeSchedule, rruleToForm, buildRRule } from '../rrule.js';
import { nextByProgram, occurrences, nowNext, todayDay, fmtOcc } from '../episodes.js';
import { DAY_MS, dayToYmd, fmtInstant, parseHM, fmtHM, weekdayLabel, fmtDay, parseLocalDateTime, ymdToDay, dayParts } from '../time.js';
import { memoRows } from './memos.js';
import { actContact, contactActionLabel, postToCorner, composeX, radioNameFor } from '../mail.js';
import { xSearchUrl, xAccountUrl, splitList, normalizeHashtag, normalizeAccount } from '../links.js';
import { monthStats, streaks } from '../stats.js';
import { exportShare, importShareFlow } from './share-ui.js';

const ui = { tab: 'list', q: '', genre: '', media: '', sort: 'next', favOnly: false, archived: false, statMonth: null };

function filterPrograms() {
  const q = ui.q.trim().toLowerCase();
  const channels = all('channels');
  return all('programs').filter((p) => {
    if (!!p.archived !== ui.archived) return false;
    if (ui.favOnly && !p.favorite) return false;
    if (ui.genre && p.genre !== ui.genre) return false;
    if (ui.media && !channels.some((c) => c.programId === p.id && c.mediaType === ui.media)) return false;
    if (q && ![p.name, p.personality, p.station].some((s) => (s || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function listTab() {
  const next = nextByProgram();
  const genres = [...new Set(all('programs').map((p) => p.genre).filter(Boolean))];
  const paint = () => {
    const rows = filterPrograms();
    const sorters = {
      next: (a, b) => (next.get(a.id)?.startMs ?? Infinity) - (next.get(b.id)?.startMs ?? Infinity),
      name: (a, b) => a.name.localeCompare(b.name, 'ja'),
      created: (a, b) => a.createdAt - b.createdAt,
    };
    rows.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || sorters[ui.sort](a, b));
    listBox.replaceChildren(rows.length
      ? h('div', { class: 'list' }, rows.map((p) => {
        const n = next.get(p.id);
        return h('a', { class: 'row', href: `#/program/${p.id}` },
          colorDot(p),
          h('span', { class: 'row-main' },
            h('strong', null, p.favorite ? '★ ' : '', p.name),
            h('small', null, [p.station, p.personality].filter(Boolean).join('・') || '—'),
            h('small', null, p.archived ? `アーカイブ${p.endDate ? `（${p.endDate} まで）` : ''}` : n ? `次回 ${fmtOcc(n)}` : '放送予定なし')),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
      }))
      : empty(all('programs').length ? '条件に合う番組はありません。' : 'まだ番組がありません。', all('programs').length ? null : linkButton('番組を登録', '#/program/new', 'primary')));
  };
  const listBox = h('div', null);
  const select = (key, options, label) => h('select', {
    'aria-label': label,
    onchange: (e) => { ui[key] = e.target.value; paint(); },
  }, options.map(([v, l]) => h('option', { value: v, selected: ui[key] === v }, l)));
  const toggle = (key, label) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: ui[key], onchange: (e) => { ui[key] = e.target.checked; paint(); } }), h('span', null, label));
  paint();
  return [
    h('div', { class: 'filters' },
      h('input', { type: 'search', placeholder: '番組名で検索', 'aria-label': '番組名で検索', value: ui.q, oninput: (e) => { ui.q = e.target.value; paint(); } }),
      h('div', { class: 'filter-row' },
        select('genre', [['', 'すべてのジャンル'], ...genres.map((g) => [g, g])], 'ジャンル'),
        select('media', [['', 'すべての媒体'], ...MEDIA_TYPES.map((m) => [m.id, m.label])], '媒体'),
        select('sort', [['next', '次の放送順'], ['name', '名前順'], ['created', '登録順']], '並び替え')),
      h('div', { class: 'chips' }, toggle('favOnly', 'お気に入り'), toggle('archived', 'アーカイブ'))),
    listBox,
    h('div', { class: 'row-actions' },
      button('番組を共有ファイルに書き出す', () => exportShare(), 'small'),
      button('共有ファイルを取り込む', () => importShareFlow(), 'small')),
  ];
}

function memoTab() {
  const box = h('div', null);
  let q = ui.memoQ || '';
  const paint = () => {
    const needle = q.trim().toLowerCase();
    const memos = all('memos')
      .filter((m) => !needle || m.body.toLowerCase().includes(needle) || (get('programs', m.programId)?.name || '').toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt - a.createdAt);
    box.replaceChildren(memos.length ? memoRows(memos, { showProgram: true }) : empty(needle ? '一致するメモはありません。' : 'メモはまだありません。'));
  };
  paint();
  return [
    h('div', { class: 'filters' }, h('input', { type: 'search', placeholder: 'メモを検索', 'aria-label': 'メモを検索', value: q, oninput: (e) => { q = e.target.value; ui.memoQ = q; paint(); } })),
    box,
  ];
}

function statsTab() {
  const today = dayParts(todayDay());
  const month = ui.statMonth || { y: today.y, m: today.m };
  const s = monthStats(month);
  const shift = (d) => {
    const t = new Date(Date.UTC(month.y, month.m - 1 + d, 1));
    ui.statMonth = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
    rerender();
  };
  const tile = (label, value) => h('div', { class: 'stat' }, h('strong', null, String(value)), h('small', null, label));
  const st = streaks();
  return [
    h('div', { class: 'cal-nav' },
      button('‹', () => shift(-1), 'icon', { 'aria-label': '前の月' }),
      h('span', { class: 'cal-title' }, `${month.y}年${month.m}月`),
      button('›', () => shift(1), 'icon', { 'aria-label': '次の月' })),
    h('div', { class: 'stats' }, tile('聴いた回数', s.listened), tile('聴き逃した回数', s.missed), tile('投稿数', s.posts), tile('読まれた数', s.read)),
    section('続けて聴いている週',
      st.length
        ? h('div', { class: 'list' }, st.map(({ program, weeks }) => h('a', { class: 'row', href: `#/program/${program.id}` },
          colorDot(program), h('span', { class: 'row-main' }, h('strong', null, program.name)), h('strong', null, weeks ? `${weeks}週` : '—'))))
        : h('p', { class: 'muted pad' }, '聴取済みにした回がまだありません')),
    h('p', { class: 'help' }, '数値はこの端末の記録だけで集計しています。外部には送りません。'),
  ];
}

export function renderPrograms() {
  const tabs = [['list', '番組'], ['memos', 'メモ'], ['stats', '振り返り']];
  const body = { list: listTab, memos: memoTab, stats: statsTab }[ui.tab]();
  return page({ title: '番組一覧', tab: 'programs', actions: linkButton('＋ 追加', '#/program/new', 'small') },
    h('div', { class: 'seg wide', role: 'group', 'aria-label': '一覧の切替' }, tabs.map(([v, l]) => h('button', {
      type: 'button', class: ui.tab === v ? 'on' : '', 'aria-pressed': String(ui.tab === v),
      onclick: () => { ui.tab = v; rerender(); },
    }, l))),
    body);
}

// ---- 番組詳細 ----

/** 番組のアーカイブ。放送期間の終了日を今日までにして、それ以降の予定を外す（F-CHG-03） */
export function archiveProgram(p, endYmd = dayToYmd(todayDay())) {
  const endDate = p.endDate && p.endDate < endYmd ? p.endDate : endYmd;
  return save('programs', { ...p, archived: true, endDate });
}

function xSection(p, onAir) {
  const tags = p.hashtags || [];
  const accounts = p.xAccounts || [];
  if (!tags.length && !accounts.length) {
    return h('p', { class: 'muted pad' }, 'ハッシュタグと公式アカウントは「編集」から登録できます');
  }
  return [
    tags.length ? h('div', { class: 'chips' }, tags.map((t) => h('button', { type: 'button', class: 'chip-btn', onclick: () => copyText(t) }, t))) : null,
    h('div', { class: 'row-actions' },
      tags.length ? button(onAir ? '実況する（放送中）' : '実況する', () => composeX({ program: p, text: `${tags.join(' ')} ` }), onAir ? 'primary' : 'small') : null,
      tags.length ? externalLink('みんなの反応', xSearchUrl(tags.join(' OR ')), 'btn small') : null,
      accounts.map((a) => externalLink(`@${normalizeAccount(a)}`, xAccountUrl(a), 'btn small ghost'))),
  ];
}

function editRadioName(p) {
  const row = all('radioNames').find((r) => r.programId === p.id);
  openForm({
    title: 'この番組で使うラジオネーム',
    fields: [{ name: 'name', label: 'ラジオネーム', help: '空にすると、投稿テンプレートの既定のラジオネームを使います' }],
    values: { name: row?.name || '' },
    onSubmit: (v) => {
      if (!v.name && row) remove('radioNames', row.id);
      else if (v.name) save('radioNames', { ...(row || { programId: p.id }), name: v.name });
      rerender();
    },
  });
}

export function renderProgram(id) {
  const p = get('programs', id);
  if (!p) return notFound();
  const next = nextByProgram().get(id);
  const onAir = nowNext().onAir.some((o) => o.program.id === id);
  const schedules = byProgram('schedules', id);
  const channels = byProgram('channels', id);
  const corners = byProgram('corners', id).sort((a, b) => (a.order || 0) - (b.order || 0));
  const contacts = byProgram('contacts', id);
  const memos = byProgram('memos', id).sort((a, b) => b.createdAt - a.createdAt);
  const url = safeUrl(p.url);
  const radioName = radioNameFor(id);

  const toggleFav = () => { save('programs', { ...p, favorite: !p.favorite }); rerender(); };
  const toggleArchive = async () => {
    if (p.archived) {
      save('programs', { ...p, archived: false });
      toast('アーカイブから戻しました。放送期間の終了日は「編集」で直せます');
      rerender();
      return;
    }
    if (!(await confirmSheet('この番組をアーカイブしますか？', { ok: 'アーカイブ', detail: '今日を放送期間の終了日にして、これからの予定をカレンダーと Google カレンダーから外します。これまでの記録は残ります。' }))) return;
    archiveProgram(p);
    rerender();
  };
  const addSpecial = () => openForm({
    title: '特番を追加',
    fields: [
      { name: 'title', label: '特番名', placeholder: '例：年末スペシャル' },
      { name: 'date', label: '放送日', type: 'date', required: true, help: '深夜の放送は前日の日付で、25:00 のように入力します' },
      { name: 'start', label: '開始時刻', required: true, placeholder: '25:00' },
      { name: 'end', label: '終了時刻', required: true, placeholder: '27:00' },
    ],
    values: { date: dayToYmd(todayDay()) },
    validate: (v) => {
      const e = {};
      const s = parseHM(v.start);
      if (s == null || s < 300 || s >= 1740) e.start = '開始時刻は 5:00〜28:59 で入力してください';
      if (parseHM(v.end) == null) e.end = '時刻は 27:00 の形式で入力してください';
      return e;
    },
    onSubmit: (v) => {
      save('episodes', { programId: id, scheduleId: null, date: v.date, overrideDate: v.date, overrideStart: fmtHM(parseHM(v.start)), overrideEnd: fmtHM(parseHM(v.end)), status: 'special', title: v.title, listened: false });
      rerender();
    },
  });

  return page({ title: p.name, back: '#/programs', tab: 'programs', actions: h('a', { class: 'btn small', href: `#/program/${id}/edit` }, '編集') },
    h('div', { class: 'prog-head', style: `--c:${p.color}` },
      colorDot(p),
      h('div', { class: 'row-main' },
        h('strong', null, p.name),
        h('small', null, [p.personality, p.station, p.genre].filter(Boolean).join('・') || '—'),
        p.startDate || p.endDate ? h('small', null, `放送期間 ${p.startDate || ''}〜${p.endDate || ''}`) : null,
        p.timefree === false ? h('small', null, h('span', { class: 'tag tag-changed' }, 'タイムフリーなし・生で聴く')) : null),
      button(p.favorite ? '★' : '☆', toggleFav, 'icon', { 'aria-label': p.favorite ? 'お気に入りを解除' : 'お気に入りに追加', 'aria-pressed': String(!!p.favorite) })),
    p.archived ? h('p', { class: 'notice' }, 'この番組はアーカイブされています。記録は削除しない限り残ります。') : null,

    section('次回放送', next
      ? h('a', { class: 'row card', href: `#/ep/${next.key}` }, h('span', { class: 'row-main' }, h('strong', null, `${fmtDay(next.day)} ${fmtHM(next.startMin)}〜${fmtHM(next.endMin)}`), next.startMin >= 1440 ? h('small', null, `実際の日時 ${fmtInstant(next.startMs)}`) : null), h('span', { class: 'chev' }, '›'))
      : h('p', { class: 'muted pad' }, '予定されている放送はありません')),

    section('X', xSection(p, onAir)),

    section('放送枠', schedules.length
      ? h('div', { class: 'list' }, schedules.map((s) => h('div', { class: 'row' }, h('span', { class: 'row-main' }, describeSchedule(s)))))
      : h('p', { class: 'muted pad' }, '放送枠が未登録です。「編集」から追加してください。'),
    h('div', { class: 'row-actions' }, button('＋ 特番を追加', addSpecial, 'small'), linkButton('これまでの放送回', `#/program/${id}/episodes`, 'small'))),

    section('配信媒体', channels.length
      ? h('div', { class: 'list' }, channels.map((c) => h('div', { class: 'row' },
        h('span', { class: 'row-main' },
          h('strong', null, [mediaLabel(c.mediaType), c.station].filter(Boolean).join(' ')),
          h('small', null, [c.frequency ? `${c.frequency}${c.unit || ''}` : '', c.region, c.catchupMode === 'radiko' ? 'タイムフリー' : c.catchupMode === 'days' ? `聴き逃し${c.catchupDays}日` : '', c.rssUrl ? '新着を自動検知' : ''].filter(Boolean).join('・'))),
        c.url ? externalLink('聴く', c.url, 'btn small primary') : null)))
      : h('p', { class: 'muted pad' }, '未登録'),
    h('div', { class: 'row-actions' }, linkButton('配信媒体を管理', `#/program/${id}/channels`, 'small'))),

    section('コーナー', corners.length
      ? h('div', { class: 'list' }, corners.map((c) => {
        const ms = parseLocalDateTime(c.deadline);
        return h('div', { class: 'row' },
          h('span', { class: 'row-main' },
            h('strong', null, c.name, c.status && c.status !== 'active' ? ` （${c.status === 'paused' ? '休止中' : '終了'}）` : ''),
            h('small', null, [c.topic || c.theme, ms != null ? `締切 ${fmtInstant(ms)}` : ''].filter(Boolean).join('・'))),
          button('投稿', () => postToCorner(c), 'small'));
      }))
      : h('p', { class: 'muted pad' }, '未登録')),

    section('投稿先', contacts.length
      ? h('div', { class: 'list' }, contacts.map((c) => h('div', { class: 'row' },
        h('span', { class: 'row-main' }, h('strong', null, c.label || '投稿先'), h('small', { class: 'break' }, c.value)),
        button('コピー', () => copyText(c.value), 'small ghost'),
        button(contactActionLabel(c), () => actContact(c, p), 'small'))))
      : h('p', { class: 'muted pad' }, '未登録'),
    h('div', { class: 'row card' },
      h('span', { class: 'row-main' }, h('strong', null, 'ラジオネーム'), h('small', null, radioName || '未設定')),
      button('変更', () => editRadioName(p), 'small')),
    h('div', { class: 'row-actions' }, linkButton('コーナー・投稿先を管理', `#/program/${id}/corners`, 'small'))),

    section('メモ', memos.length ? memoRows(memos.slice(0, 3)) : h('p', { class: 'muted pad' }, 'メモはまだありません'),
      h('div', { class: 'row-actions' }, linkButton(`メモを開く${memos.length ? `（${memos.length}件）` : ''}`, `#/program/${id}/memos`, 'small'))),

    section('その他',
      h('div', { class: 'list' },
        url ? h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('strong', null, '番組公式サイト'), h('small', { class: 'break' }, url)), externalLink('開く', url, 'btn small')) : null,
        h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('strong', null, '放送開始の通知'), h('small', null, (p.reminders ?? [15]).map(reminderLabel).join('・') || 'なし'))),
        h('div', { class: 'row' }, h('span', { class: 'row-main' }, h('strong', null, '聴取期限・新着の通知'), h('small', null, p.individualNotify ? '個別に通知する' : '今日のまとめに集約')))),
      h('div', { class: 'row-actions' },
        button('この番組を共有ファイルに書き出す', () => exportShare([id]), 'small'),
        button(p.archived ? 'アーカイブから戻す' : 'アーカイブ', toggleArchive, 'small'))));
}

export function renderProgramEpisodes(id) {
  const p = get('programs', id);
  if (!p) return notFound();
  const now = Date.now();
  const occs = occurrences(now - 60 * DAY_MS, now + 60 * DAY_MS, { programId: id });
  const label = { cancelled: '休止', special: '特番', changed: '時間変更' };
  return page({ title: '放送回', back: `#/program/${id}`, tab: 'programs' },
    occs.length
      ? h('div', { class: 'list' }, occs.reverse().map((o) => h('a', { class: `row ${o.status === 'cancelled' ? 'is-cancelled' : ''}`, href: `#/ep/${o.key}` },
        h('span', { class: 'row-main' }, h('strong', null, `${fmtDay(o.day)} ${fmtHM(o.startMin)}〜${fmtHM(o.endMin)}`), o.title ? h('small', null, o.title) : null),
        label[o.status] ? h('span', { class: `tag tag-${o.status}` }, label[o.status]) : null,
        o.listened ? h('span', { class: 'tag' }, '聴取済') : null,
        h('span', { class: 'chev' }, '›'))))
      : empty('前後60日に放送回はありません。'));
}

export const notFound = () => page({ title: '見つかりません', back: '#/calendar' }, empty('このデータは削除された可能性があります。'));

// ---- 番組編集 ----

const blankSchedule = () => ({ repeat: 'weekly', days: [], nths: [1], dtstart: dayToYmd(todayDay()), start: '', end: '' });

function scheduleRow(row, onRemove) {
  const el = h('fieldset', { class: 'sched' });
  const paint = () => {
    const dayChips = h('div', { class: 'chips', role: 'group', 'aria-label': '放送日の曜日' }, [0, 1, 2, 3, 4, 5, 6].map((d) => h('label', { class: 'chip small' },
      h('input', { type: 'checkbox', checked: row.days.includes(d), onchange: (e) => { row.days = e.target.checked ? [...row.days, d] : row.days.filter((x) => x !== d); } }),
      h('span', null, weekdayLabel(d)))));
    const nthChips = h('div', { class: 'chips', role: 'group', 'aria-label': '第何週' }, [1, 2, 3, 4, 5, -1].map((n) => h('label', { class: 'chip small' },
      h('input', { type: 'checkbox', checked: row.nths.includes(n), onchange: (e) => { row.nths = e.target.checked ? [...row.nths, n] : row.nths.filter((x) => x !== n); } }),
      h('span', null, n === -1 ? '最終' : `第${n}`))));
    const timeInput = (key, label, ph) => h('div', { class: 'field' },
      h('label', null, label, h('input', { value: row[key], placeholder: ph, inputMode: 'text', autocomplete: 'off', oninput: (e) => { row[key] = e.target.value; }, onblur: (e) => { const m = parseHM(e.target.value); if (m != null) { row[key] = fmtHM(m); e.target.value = row[key]; } } })));
    el.replaceChildren(...[
      h('div', { class: 'sched-head' },
        h('select', { 'aria-label': '繰り返し', onchange: (e) => { row.repeat = e.target.value; paint(); } },
          [['weekly', '毎週'], ['biweekly', '隔週'], ['monthly', '毎月第n曜日'], ['once', '単発']].map(([v, l]) => h('option', { value: v, selected: row.repeat === v }, l))),
        button('削除', onRemove, 'small ghost danger')),
      row.repeat === 'monthly' ? nthChips : null,
      row.repeat !== 'once' ? dayChips : null,
      row.repeat === 'once' || row.repeat === 'biweekly'
        ? h('div', { class: 'field' }, h('label', null, row.repeat === 'once' ? '放送日' : '初回の放送日（隔週の基準）', h('input', { type: 'date', value: row.dtstart, onchange: (e) => { row.dtstart = e.target.value; } })))
        : null,
      h('div', { class: 'two' }, timeInput('start', '開始時刻', '25:00'), timeInput('end', '終了時刻', '27:00')),
      h('small', { class: 'field-error', role: 'alert' }, row.error || '')].filter(Boolean));
  };
  row.repaint = paint;
  paint();
  return el;
}

/** 放送枠の入力チェック。開始は 5:00〜28:59（第2版 2.2） */
export function validateSchedule(r) {
  const s = parseHM(r.start);
  const e = parseHM(r.end);
  if (s == null || s < 300 || s >= 1740) {
    return s != null && s < 300
      ? '0:00〜4:59 の放送は、前日の曜日を選んで 24:00〜28:59 で入力してください（例：火曜 1:00 → 月曜 25:00）'
      : '開始時刻は 5:00〜28:59 で入力してください';
  }
  if (e == null) return '終了時刻は 27:00 の形式で入力してください';
  if (r.repeat !== 'once' && !r.days.length) return '放送日の曜日を選んでください';
  if (r.repeat === 'monthly' && !r.nths.length) return '第何週かを選んでください';
  if ((r.repeat === 'once' || r.repeat === 'biweekly') && !r.dtstart) return '放送日を入力してください';
  return null;
}

export function renderProgramEdit(id) {
  const existing = id ? get('programs', id) : null;
  if (id && !existing) return notFound();
  const p = existing || { color: DEFAULT_COLOR, reminders: [15], syncEnabled: true, timefree: true, icon: 'radio' };
  const v = { ...p };
  const scheduleRows = existing
    ? byProgram('schedules', id).map((s) => ({ id: s.id, source: s, ...rruleToForm(s.rrule), dtstart: s.dtstart, start: s.start, end: s.end }))
    : [blankSchedule()];
  if (!scheduleRows.length) scheduleRows.push(blankSchedule());
  scheduleRows.forEach((r) => { if (!r.nths.length) r.nths = [1]; });
  const removedIds = [];

  const input = (name, label, attrs = {}, help = null) => h('div', { class: 'field' },
    h('label', { for: `p-${name}` }, label, attrs.required ? h('span', { class: 'req' }, '必須') : null),
    h('input', { id: `p-${name}`, name, value: attrs.value ?? v[name] ?? '', ...attrs }),
    help ? h('small', { class: 'help' }, help) : null,
    h('small', { class: 'field-error', 'data-error': name, role: 'alert' }));

  const schedBox = h('div', { class: 'sched-list' });
  const paintScheds = () => schedBox.replaceChildren(...scheduleRows.map((r) => scheduleRow(r, () => {
    if (r.id) removedIds.push(r.id);
    scheduleRows.splice(scheduleRows.indexOf(r), 1);
    paintScheds();
  })));
  paintScheds();

  const reminderSet = new Set((p.reminders ?? [15]));
  const preset = REMINDER_CHOICES.map((c) => c.value);
  const customInitial = [...reminderSet].find((m) => !preset.includes(m));

  const form = h('form', { class: 'form', novalidate: true },
    section('基本情報',
      input('name', '番組名', { required: true }),
      input('personality', 'パーソナリティ'),
      input('station', '放送局'),
      input('genre', 'ジャンル', { list: 'genre-list' }),
      h('datalist', { id: 'genre-list' }, [...new Set(all('programs').map((x) => x.genre).filter(Boolean))].map((g) => h('option', { value: g }))),
      input('url', '番組公式URL', { type: 'url', inputMode: 'url', placeholder: 'https://' }),
      h('fieldset', { class: 'field' }, h('legend', null, 'カラー（Google カレンダーの色に合わせます）'),
        h('div', { class: 'swatches' }, COLORS.map((c) => h('label', { class: 'swatch', style: `--c:${c.hex}`, title: c.name },
          h('input', { type: 'radio', name: 'color', value: c.hex, checked: (v.color || DEFAULT_COLOR) === c.hex, 'aria-label': c.name }),
          h('span', null))))),
      h('fieldset', { class: 'field' }, h('legend', null, 'アイコン'),
        h('div', { class: 'icon-pick' },
          h('label', { class: 'icon-opt', title: '頭文字' }, h('input', { type: 'radio', name: 'icon', value: '', checked: !GENERIC_ICONS[v.icon], 'aria-label': '番組名の頭文字' }), h('span', null, (v.name || '番').slice(0, 1))),
          Object.entries(GENERIC_ICONS).map(([key, ic]) => h('label', { class: 'icon-opt', title: ic.label },
            h('input', { type: 'radio', name: 'icon', value: key, checked: v.icon === key, 'aria-label': ic.label }), h('span', null, svgIcon(key)))))),
      p.legacyIcon ? h('p', { class: 'help' }, '以前登録した番組画像は、権利の都合で表示しない方針になりました（データはバックアップに残っています）。') : null),
    section('X',
      input('hashtags', 'ハッシュタグ（複数はスペース区切り）', { value: (v.hashtags || []).join(' '), placeholder: '#番組名 #番組名2' }),
      input('xAccounts', '公式アカウント（番組・パーソナリティ）', { value: (v.xAccounts || []).map((a) => `@${a}`).join(' '), placeholder: '@account', autocapitalize: 'off' })),
    section('放送枠',
      h('p', { class: 'help' }, '1日は 5:00 に始まります。深夜の放送は、放送日の曜日を選んで 24:00〜28:59 で入力してください（例：火曜 1:00 の番組は「月曜 25:00」）。'),
      schedBox,
      button('＋ 放送枠を追加', () => { scheduleRows.push(blankSchedule()); paintScheds(); }, 'small')),
    section('放送期間',
      h('div', { class: 'two' }, input('startDate', '開始日', { type: 'date' }), input('endDate', '終了日', { type: 'date' }))),
    section('通知',
      h('p', { class: 'help' }, '放送開始の通知（番組ごと）'),
      h('div', { class: 'chips' }, REMINDER_CHOICES.map((c) => h('label', { class: 'chip' },
        h('input', { type: 'checkbox', name: 'reminder', value: c.value, checked: reminderSet.has(c.value) }), h('span', null, c.label)))),
      h('div', { class: 'field' }, h('label', { for: 'p-custom' }, '任意（分前）'),
        h('input', { id: 'p-custom', name: 'customReminder', type: 'number', inputMode: 'numeric', min: 0, value: customInitial ?? '' })),
      h('div', { class: 'list' },
        h('label', { class: 'check-row' }, h('input', { type: 'checkbox', name: 'timefree', checked: p.timefree !== false }),
          h('span', null, 'radiko のタイムフリーで後から聴ける'), h('small', { class: 'help' }, 'オフにすると「生で聴く」番組として、放送開始の通知を必ず入れます')),
        h('label', { class: 'check-row' }, h('input', { type: 'checkbox', name: 'individualNotify', checked: !!p.individualNotify }),
          h('span', null, '聴取期限と新着の回を個別に通知する'), h('small', { class: 'help' }, 'オフのときは、毎朝の「今日のまとめ」にまとめて載せます')),
        h('label', { class: 'check-row' }, h('input', { type: 'checkbox', name: 'syncEnabled', checked: p.syncEnabled !== false }), h('span', null, 'この番組を Google カレンダーに登録する')))),
    h('div', { class: 'save-bar' },
      existing ? button('番組を削除', async () => {
        if (await confirmSheet(`「${p.name}」を削除しますか？`, { ok: '削除', danger: true, detail: '放送枠・媒体・コーナー・投稿先・メモ・投稿履歴もまとめて削除されます。記録を残したいときは「アーカイブ」を使ってください。' })) {
          removeProgram(id);
          toast('削除しました');
          location.hash = '#/programs';
        }
      }, 'ghost danger') : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'submit', class: 'btn primary' }, '保存')));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    form.querySelectorAll('.field-error').forEach((n) => { n.textContent = ''; });
    const f = form.elements;
    const name = f.name.value.trim();
    let ok = true;
    const fail = (field, msg) => { form.querySelector(`[data-error="${field}"]`).textContent = msg; ok = false; };
    if (!name) fail('name', '番組名を入力してください');
    const urlValue = f.url.value.trim();
    if (urlValue && !safeUrl(urlValue)) fail('url', 'https:// から始まるURLを入力してください');
    if (f.startDate.value && f.endDate.value && ymdToDay(f.startDate.value) > ymdToDay(f.endDate.value)) fail('endDate', '終了日は開始日以降にしてください');
    scheduleRows.forEach((r) => {
      r.error = validateSchedule(r);
      if (r.error) ok = false;
      r.repaint();
    });
    const reminders = [...form.querySelectorAll('input[name="reminder"]:checked')].map((i) => Number(i.value));
    const custom = f.customReminder.value.trim();
    if (custom !== '') reminders.push(Number(custom));
    if (!ok) {
      form.querySelector('.field-error:not(:empty)')?.scrollIntoView({ block: 'center' });
      toast('入力内容を確認してください', { error: true });
      return;
    }
    const saved = save('programs', {
      ...p,
      name,
      personality: f.personality.value.trim(),
      station: f.station.value.trim(),
      genre: f.genre.value.trim(),
      url: urlValue,
      hashtags: splitList(f.hashtags.value, normalizeHashtag),
      xAccounts: splitList(f.xAccounts.value, normalizeAccount),
      color: form.querySelector('input[name="color"]:checked')?.value || DEFAULT_COLOR,
      icon: form.querySelector('input[name="icon"]:checked')?.value || '',
      startDate: f.startDate.value,
      endDate: f.endDate.value,
      reminders: [...new Set(reminders)],
      timefree: f.timefree.checked,
      individualNotify: f.individualNotify.checked,
      syncEnabled: f.syncEnabled.checked,
    }, { silent: true });
    removedIds.forEach((sid) => remove('schedules', sid, { silent: true }));
    scheduleRows.forEach((r) => {
      save('schedules', {
        ...(r.source || {}),
        programId: saved.id,
        dtstart: r.dtstart,
        start: fmtHM(parseHM(r.start)),
        end: fmtHM(parseHM(r.end) <= parseHM(r.start) ? parseHM(r.end) + 1440 : parseHM(r.end)),
        rrule: buildRRule(r),
        tz: 'Asia/Tokyo',
      }, { silent: true });
    });
    save('programs', saved);
    toast(!saved.reminders.length && saved.timefree === false ? '保存しました（生で聴く番組なので、開始時の通知を入れます）' : '保存しました');
    location.hash = `#/program/${saved.id}`;
  });

  return page({ title: existing ? '番組を編集' : '番組を登録', back: existing ? `#/program/${id}` : '#/programs', tab: 'programs' }, form);
}

export { chooseSheet };
