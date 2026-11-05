// コーナー・投稿先の管理と、投稿タブ（締切・投稿履歴・ネタ帳・投稿先）

import { h, page, section, empty, button, openForm, rerender, confirmSheet, copyText, linkButton, externalLink, toast } from '../ui.js';
import { all, byProgram, get, remove, save } from '../store.js';
import { CONTACT_TYPES, CORNER_FREQ, CORNER_STATUS, isEmail, safeUrl } from '../domain.js';
import { fmtInstant, fmtRemaining, parseLocalDateTime, dayToYmd, fmtDay, ymdToDay, parseHM } from '../time.js';
import { actContact, contactActionLabel, postTemplate, postToCorner, logPost } from '../mail.js';
import { normalizeHashtag, radikoTimefreeUrl } from '../links.js';
import { occurrences, todayDay } from '../episodes.js';
import { adoption } from '../stats.js';
import { notFound } from './programs.js';
import { instant } from '../time.js';

function openCorner(programId, corner) {
  const contacts = byProgram('contacts', programId);
  const linked = corner ? contacts.filter((c) => (c.cornerIds || []).includes(corner.id)).map((c) => c.id) : [];
  openForm({
    title: corner ? 'コーナーを編集' : 'コーナーを追加',
    fields: [
      { name: 'name', label: 'コーナー名', required: true },
      { name: 'description', label: '説明', type: 'textarea', rows: 2 },
      { name: 'theme', label: '募集内容', type: 'textarea', rows: 2 },
      { name: 'topic', label: '今週のお題' },
      { name: 'deadline', label: '投稿締切', type: 'datetime' },
      { name: 'frequency', label: '放送頻度', type: 'select', options: CORNER_FREQ },
      { name: 'status', label: '状態', type: 'select', options: CORNER_STATUS },
      { name: 'order', label: '表示順', type: 'number' },
      { name: 'individualNotify', label: '締切を個別に通知する', type: 'checkbox', help: 'オフのときは、毎朝の「今日のまとめ」に載せます' },
      { name: 'contactIds', label: '投稿先', type: 'checks', options: contacts.map((c) => ({ value: c.id, label: c.label || c.value })), emptyText: '投稿先を追加すると紐付けられます' },
    ],
    values: { frequency: 'every', status: 'active', order: byProgram('corners', programId).length + 1, ...(corner || {}), contactIds: linked },
    onSubmit: (v) => {
      const { contactIds, ...fields } = v;
      const saved = save('corners', { ...(corner || { programId }), ...fields }, { silent: true });
      for (const c of contacts) {
        const had = (c.cornerIds || []).includes(saved.id);
        const want = contactIds.includes(c.id);
        if (had !== want) save('contacts', { ...c, cornerIds: want ? [...(c.cornerIds || []), saved.id] : c.cornerIds.filter((x) => x !== saved.id) }, { silent: true });
      }
      save('corners', saved);
      rerender();
    },
    onDelete: corner ? async () => {
      if (!(await confirmSheet(`「${corner.name}」を削除しますか？`, { ok: '削除', danger: true }))) return false;
      remove('corners', corner.id);
      rerender();
      return true;
    } : null,
  });
}

function openContact(programId, contact) {
  const corners = byProgram('corners', programId);
  openForm({
    title: contact ? '投稿先を編集' : '投稿先を追加',
    fields: [
      { name: 'type', label: '種別', type: 'select', options: CONTACT_TYPES },
      { name: 'label', label: 'ラベル', placeholder: '例：ふつおた、リクエスト' },
      { name: 'value', label: 'メールアドレス／URL／ハッシュタグ', required: true },
      { name: 'subjectTemplate', label: '件名テンプレート（メール）', placeholder: '{番組名} {コーナー名}', help: '{番組名} {コーナー名} {ラジオネーム} {お題} が使えます' },
      { name: 'cornerIds', label: 'コーナーに紐付け', type: 'checks', options: corners.map((c) => ({ value: c.id, label: c.name })), emptyText: 'コーナーを追加すると紐付けられます' },
    ],
    values: contact || { type: 'email' },
    validate: (v) => {
      if (v.type === 'email' && !isEmail(v.value)) return { value: 'メールアドレスの形式が正しくありません' };
      if (v.type === 'form' && !safeUrl(v.value)) return { value: 'https:// から始まるURLを入力してください' };
      if (v.type === 'xhashtag' && !normalizeHashtag(v.value)) return { value: 'ハッシュタグを入力してください' };
      return {};
    },
    onSubmit: (v) => {
      save('contacts', { ...(contact || { programId }), ...v, value: v.type === 'xhashtag' ? normalizeHashtag(v.value) : v.value });
      rerender();
    },
    onDelete: contact ? async () => {
      if (!(await confirmSheet('この投稿先を削除しますか？', { ok: '削除', danger: true }))) return false;
      remove('contacts', contact.id);
      rerender();
      return true;
    } : null,
  });
}

function contactRow(c, program, corner = null) {
  return h('div', { class: 'row' },
    h('button', { type: 'button', class: 'row-main plain', onclick: () => openContact(program.id, c) },
      h('strong', null, c.label || (c.type === 'xhashtag' ? 'X' : '投稿先')), h('small', { class: 'break' }, c.value)),
    button('コピー', () => copyText(c.value), 'small ghost'),
    button(contactActionLabel(c), () => actContact(c, program, corner), 'small primary'));
}

export function renderCorners(programId) {
  const p = get('programs', programId);
  if (!p) return notFound();
  const corners = byProgram('corners', programId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const contacts = byProgram('contacts', programId);
  const statusLabel = { paused: '休止中', ended: '終了' };
  return page({ title: 'コーナー・投稿先', back: `#/program/${programId}`, tab: 'programs' },
    h('p', { class: 'muted pad' }, p.name),
    section('コーナー',
      corners.length
        ? h('div', { class: 'list' }, corners.map((c) => {
          const ms = parseLocalDateTime(c.deadline);
          const linked = contacts.filter((x) => (x.cornerIds || []).includes(c.id));
          return h('div', { class: 'row' },
            h('button', { type: 'button', class: 'row-main plain', onclick: () => openCorner(programId, c) },
              h('strong', null, c.name, statusLabel[c.status] ? `（${statusLabel[c.status]}）` : ''),
              c.topic ? h('small', null, `今週のお題：${c.topic}`) : c.theme ? h('small', null, c.theme) : null,
              ms != null ? h('small', null, `締切 ${fmtInstant(ms)}${c.individualNotify ? '・個別に通知' : ''}`) : null,
              linked.length ? h('small', null, `投稿先：${linked.map((x) => x.label || x.value).join('、')}`) : null),
            button('投稿', () => postToCorner(c), 'small primary'));
        }))
        : h('p', { class: 'muted pad' }, 'コーナーは未登録です'),
      h('div', { class: 'row-actions' }, button('＋ コーナーを追加', () => openCorner(programId, null), 'small'))),
    section('投稿先',
      contacts.length
        ? h('div', { class: 'list' }, contacts.map((c) => contactRow(c, p)))
        : h('p', { class: 'muted pad' }, '投稿先は未登録です'),
      h('div', { class: 'row-actions' }, button('＋ 投稿先を追加', () => openContact(programId, null), 'small'))));
}

// ---- 投稿タブ ----

function openTemplate() {
  const t = postTemplate();
  openForm({
    title: '署名と本文の定型',
    fields: [
      { name: 'radioName', label: '既定のラジオネーム', help: '番組ごとのラジオネームは番組詳細で設定できます' },
      { name: 'body', label: '本文の定型', type: 'textarea', rows: 3, placeholder: '{番組名} のみなさん、こんにちは。', help: '{番組名} {コーナー名} {ラジオネーム} {お題} が使えます' },
      { name: 'signature', label: '署名（住所など任意）', type: 'textarea', rows: 3 },
    ],
    values: t || {},
    onSubmit: (v) => {
      save('templates', { ...(t || {}), ...v });
      rerender();
    },
  });
}

/** 番組とコーナーを1つの選択肢で選ぶ */
function programCornerOptions(withEmpty = false) {
  const opts = withEmpty ? [{ value: '', label: '選んでください' }] : [];
  for (const p of all('programs').filter((x) => !x.archived).sort((a, b) => a.name.localeCompare(b.name, 'ja'))) {
    opts.push({ value: `${p.id}|`, label: p.name });
    for (const c of byProgram('corners', p.id)) opts.push({ value: `${p.id}|${c.id}`, label: `${p.name} ／ ${c.name}` });
  }
  return opts;
}
const splitTarget = (v) => { const [programId, cornerId] = String(v || '').split('|'); return { programId, cornerId: cornerId || null }; };

function deadlinesTab(now) {
  const deadlines = all('corners')
    .map((c) => ({ c, ms: parseLocalDateTime(c.deadline), program: get('programs', c.programId) }))
    .filter((x) => x.ms != null && x.ms > now && x.program && !x.program.archived && (x.c.status || 'active') === 'active')
    .sort((a, b) => a.ms - b.ms);
  const t = postTemplate();
  return [
    section('締切が近いお題（全番組）',
      deadlines.length
        ? h('div', { class: 'list' }, deadlines.map(({ c, ms, program }) => h('div', { class: 'row' },
          h('span', { class: 'mark mark-deadline', 'aria-hidden': 'true' }),
          h('a', { class: 'row-main', href: `#/program/${program.id}/corners` },
            h('strong', null, `${program.name} ${c.name}`),
            h('small', { class: ms - now < 86400000 ? 'warn' : '' }, `${fmtInstant(ms)}（あと${fmtRemaining(ms - now)}）`),
            c.topic ? h('small', null, `お題：${c.topic}`) : null),
          button('投稿', () => postToCorner(c), 'small primary'))))
        : h('p', { class: 'muted pad' }, '締切が設定されたお題はありません。コーナーの編集で締切を入れられます')),
    section('署名と本文の定型',
      h('div', { class: 'row card' },
        h('span', { class: 'row-main' },
          h('strong', null, t?.radioName ? `既定のラジオネーム：${t.radioName}` : '未設定'),
          h('small', null, 'ラジオネーム・署名をメール本文に差し込みます')),
        button('編集', openTemplate, 'small'))),
  ];
}

function openLog(log) {
  const program = get('programs', log?.programId);
  openForm({
    title: log ? '投稿履歴' : '投稿履歴を記録',
    fields: [
      ...(log ? [] : [
        { name: 'target', label: '番組・コーナー', type: 'select', options: programCornerOptions(true), required: true },
        { name: 'route', label: '経路', type: 'select', options: [{ value: 'mail', label: 'メール' }, { value: 'x', label: 'X' }, { value: 'form', label: 'フォーム' }] },
      ]),
      { name: 'subject', label: '件名・内容' },
      { name: 'read', label: '読まれた', type: 'checkbox' },
      { name: 'readDate', label: '読まれた放送日', type: 'date', help: '深夜番組は前日の日付（放送日）です' },
      { name: 'readTime', label: '放送中のおおよその時刻', placeholder: '25:30' },
      { name: 'memo', label: 'メモ', type: 'textarea', rows: 3 },
    ],
    values: log ? { ...log } : { route: 'mail', readDate: dayToYmd(todayDay()) },
    validate: (v) => (v.readTime && parseHM(v.readTime) == null ? { readTime: '25:30 の形式で入力してください' } : {}),
    extra: () => (log ? h('p', { class: 'help' }, `${program?.name || ''}${log.cornerId ? ` ／ ${get('corners', log.cornerId)?.name || ''}` : ''}・${fmtInstant(log.postedAt)}・${log.route === 'x' ? 'X' : log.route === 'form' ? 'フォーム' : 'メール'}`) : null),
    onSubmit: (v) => {
      if (log) {
        save('postLogs', { ...log, subject: v.subject, read: v.read, readDate: v.read ? v.readDate : '', readTime: v.readTime, memo: v.memo });
      } else {
        const { programId, cornerId } = splitTarget(v.target);
        const p = get('programs', programId);
        if (!p) return false;
        const saved = logPost({ program: p, corner: cornerId ? get('corners', cornerId) : null, route: v.route, subject: v.subject });
        save('postLogs', { ...saved, read: v.read, readDate: v.read ? v.readDate : '', readTime: v.readTime, memo: v.memo });
      }
      rerender();
    },
    onDelete: log ? async () => {
      if (!(await confirmSheet('この投稿履歴を削除しますか？', { ok: '削除', danger: true }))) return false;
      remove('postLogs', log.id);
      rerender();
      return true;
    } : null,
  });
}

/** 読まれた回を radiko のタイムフリーで開くリンク（F-POST-04） */
function readLink(log) {
  if (!log.read || !log.readDate) return null;
  const station = byProgram('channels', log.programId).find((c) => c.radikoStation)?.radikoStation;
  if (!station) return null;
  const day = ymdToDay(log.readDate);
  const occ = occurrences(instant(day, 300), instant(day + 1, 300), { programId: log.programId })[0];
  const url = occ ? radikoTimefreeUrl(station, occ.startMs) : null;
  return url ? externalLink('radiko で開く', url, 'btn small ghost') : null;
}

function logsTab() {
  const logs = all('postLogs').sort((a, b) => b.postedAt - a.postedAt);
  const rates = adoption();
  return [
    h('div', { class: 'row-actions' }, button('＋ 手動で記録', () => openLog(null), 'small')),
    logs.length
      ? h('div', { class: 'list' }, logs.slice(0, 200).map((l) => {
        const p = get('programs', l.programId);
        const c = l.cornerId ? get('corners', l.cornerId) : null;
        return h('div', { class: 'row' },
          h('button', { type: 'button', class: 'row-main plain', onclick: () => openLog(l) },
            h('strong', null, `${p?.name || '（削除された番組）'}${c ? ` ／ ${c.name}` : ''}`),
            h('small', null, `${fmtInstant(l.postedAt)}・${l.route === 'x' ? 'X' : l.route === 'form' ? 'フォーム' : 'メール'}${l.subject ? `・${l.subject}` : ''}`),
            l.read ? h('small', null, `読まれた ${l.readDate ? fmtDay(ymdToDay(l.readDate)) : ''}${l.readTime ? ` ${l.readTime}頃` : ''}`) : null),
          l.read ? h('span', { class: 'tag tag-special' }, '読まれた') : null,
          readLink(l));
      }))
      : empty('メールを作成すると、ここに自動で記録されます。'),
    rates.length ? section('採用率',
      h('div', { class: 'list' }, rates.map((r) => h('div', { class: 'row' },
        h('span', { class: 'row-main' }, h('strong', null, r.program.name), h('small', null, r.corner ? r.corner.name : 'コーナー指定なし')),
        h('strong', null, `${r.read}/${r.posts}（${Math.round((r.read / r.posts) * 100)}%）`))))) : null,
  ];
}

function openIdea(idea) {
  openForm({
    title: idea ? 'ネタを編集' : 'ネタを追加',
    fields: [
      { name: 'target', label: '番組・コーナー', type: 'select', options: programCornerOptions(true), required: true },
      { name: 'body', label: '本文', type: 'textarea', rows: 6, required: true },
    ],
    values: idea ? { target: `${idea.programId}|${idea.cornerId || ''}`, body: idea.body } : {},
    onSubmit: (v) => {
      const { programId, cornerId } = splitTarget(v.target);
      save('ideas', { ...(idea || {}), programId, cornerId, body: v.body });
      rerender();
    },
    onDelete: idea ? async () => {
      if (!(await confirmSheet('このネタを削除しますか？', { ok: '削除', danger: true }))) return false;
      remove('ideas', idea.id);
      rerender();
      return true;
    } : null,
  });
}

async function postIdea(idea) {
  const program = get('programs', idea.programId);
  const corner = idea.cornerId ? get('corners', idea.cornerId) : null;
  if (corner) { await postToCorner(corner, idea.body); return; }
  const contact = byProgram('contacts', idea.programId).find((c) => c.type === 'email' || c.type === 'xhashtag');
  if (!contact) { toast('メールまたは X の投稿先が登録されていません', { error: true }); return; }
  actContact(contact, program, null, idea.body);
}

function ideasTab() {
  const ideas = all('ideas').filter((i) => get('programs', i.programId)).sort((a, b) => b.updatedAt - a.updatedAt);
  return [
    h('div', { class: 'row-actions' }, button('＋ ネタを追加', () => openIdea(null), 'small')),
    ideas.length
      ? h('div', { class: 'list' }, ideas.map((i) => {
        const p = get('programs', i.programId);
        const c = i.cornerId ? get('corners', i.cornerId) : null;
        return h('div', { class: 'row' },
          h('button', { type: 'button', class: 'row-main plain', onclick: () => openIdea(i) },
            h('small', null, `${p.name}${c ? ` ／ ${c.name}` : ''}`),
            h('span', { class: 'memo-body' }, i.body)),
          button('投稿', () => postIdea(i), 'small primary'));
      }))
      : empty('思いついた投稿ネタを番組・コーナーごとに書き留めておけます。'),
  ];
}

function contactsTab() {
  const programs = all('programs').filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const groups = programs.map((p) => ({ p, contacts: byProgram('contacts', p.id) })).filter((g) => g.contacts.length);
  return groups.length
    ? groups.map(({ p, contacts }) => h('div', { class: 'group' },
      h('a', { class: 'group-title', href: `#/program/${p.id}/corners` }, h('span', { class: 'ev-bar', style: `background:${p.color}` }), p.name),
      h('div', { class: 'list' }, contacts.map((c) => contactRow(c, p)))))
    : empty('番組の「コーナー・投稿先」から投稿先を登録できます。', programs.length ? linkButton('番組一覧へ', '#/programs') : null);
}

const postUi = { tab: 'deadlines' };

export function renderPost() {
  const now = Date.now();
  const tabs = [['deadlines', '締切'], ['logs', '履歴'], ['ideas', 'ネタ帳'], ['contacts', '投稿先']];
  const body = { deadlines: () => deadlinesTab(now), logs: logsTab, ideas: ideasTab, contacts: contactsTab }[postUi.tab]();
  return page({ title: '投稿', tab: 'post' },
    h('div', { class: 'seg wide', role: 'group', 'aria-label': '投稿の切替' }, tabs.map(([v, l]) => h('button', {
      type: 'button', class: postUi.tab === v ? 'on' : '', 'aria-pressed': String(postUi.tab === v),
      onclick: () => { postUi.tab = v; rerender(); },
    }, l))),
    body);
}
