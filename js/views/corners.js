// コーナー・投稿先の管理と、全番組の投稿先一覧（投稿タブ）

import { h, page, section, empty, button, openForm, rerender, confirmSheet, copyText, linkButton } from '../ui.js';
import { all, byProgram, get, remove, save } from '../store.js';
import { CONTACT_TYPES, CORNER_FREQ, CORNER_STATUS, isEmail, safeUrl } from '../domain.js';
import { fmtInstant, fmtRemaining, parseLocalDateTime } from '../time.js';
import { actContact, contactActionLabel, postTemplate, postToCorner } from '../mail.js';
import { notFound } from './programs.js';

function openCorner(programId, corner) {
  const contacts = byProgram('contacts', programId);
  const linked = corner ? contacts.filter((c) => (c.cornerIds || []).includes(corner.id)).map((c) => c.id) : [];
  openForm({
    title: corner ? 'コーナーを編集' : 'コーナーを追加',
    fields: [
      { name: 'name', label: 'コーナー名', required: true },
      { name: 'description', label: '説明', type: 'textarea', rows: 2 },
      { name: 'theme', label: '募集テーマ', type: 'textarea', rows: 2 },
      { name: 'topic', label: '今週のお題' },
      { name: 'deadline', label: '投稿締切', type: 'datetime' },
      { name: 'frequency', label: '放送頻度', type: 'select', options: CORNER_FREQ },
      { name: 'status', label: '状態', type: 'select', options: CORNER_STATUS },
      { name: 'order', label: '表示順', type: 'number' },
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
      { name: 'subjectTemplate', label: '件名テンプレート', placeholder: '{番組名} {コーナー名}', help: '{番組名} {コーナー名} {ラジオネーム} {お題} が使えます' },
      { name: 'cornerIds', label: 'コーナーに紐付け', type: 'checks', options: corners.map((c) => ({ value: c.id, label: c.name })), emptyText: 'コーナーを追加すると紐付けられます' },
    ],
    values: contact || { type: 'email' },
    validate: (v) => {
      if (v.type === 'email' && !isEmail(v.value)) return { value: 'メールアドレスの形式が正しくありません' };
      if (v.type === 'form' && !safeUrl(v.value)) return { value: 'https:// から始まるURLを入力してください' };
      return {};
    },
    onSubmit: (v) => {
      save('contacts', { ...(contact || { programId }), ...v });
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
      h('strong', null, c.label || '投稿先'), h('small', { class: 'break' }, c.value)),
    button('コピー', () => copyText(c.value), 'small ghost'),
    c.type !== 'hashtag' ? button(contactActionLabel(c), () => actContact(c, program, corner), 'small primary') : null);
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
              ms != null ? h('small', null, `締切 ${fmtInstant(ms)}`) : null,
              linked.length ? h('small', null, `投稿先：${linked.map((x) => x.label || x.value).join('、')}`) : null),
            button('メール作成', () => postToCorner(c), 'small primary'));
        }))
        : h('p', { class: 'muted pad' }, 'コーナーは未登録です'),
      h('div', { class: 'row-actions' }, button('＋ コーナーを追加', () => openCorner(programId, null), 'small'))),
    section('投稿先',
      contacts.length
        ? h('div', { class: 'list' }, contacts.map((c) => contactRow(c, p)))
        : h('p', { class: 'muted pad' }, '投稿先は未登録です'),
      h('div', { class: 'row-actions' }, button('＋ 投稿先を追加', () => openContact(programId, null), 'small'))));
}

function openTemplate() {
  const t = postTemplate();
  openForm({
    title: '投稿テンプレート',
    fields: [
      { name: 'radioName', label: 'ラジオネーム' },
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

export function renderPost() {
  const now = Date.now();
  const programs = all('programs').filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const deadlines = all('corners')
    .map((c) => ({ c, ms: parseLocalDateTime(c.deadline), program: get('programs', c.programId) }))
    .filter((x) => x.ms != null && x.ms > now && x.program && !x.program.archived && (x.c.status || 'active') === 'active')
    .sort((a, b) => a.ms - b.ms);
  const t = postTemplate();
  const groups = programs.map((p) => ({ p, contacts: byProgram('contacts', p.id) })).filter((g) => g.contacts.length);

  return page({ title: '投稿', tab: 'post', actions: button('テンプレート', openTemplate, 'small') },
    section('近い締切',
      deadlines.length
        ? h('div', { class: 'list' }, deadlines.slice(0, 10).map(({ c, ms, program }) => h('div', { class: 'row' },
          h('span', { class: 'mark mark-deadline', 'aria-hidden': 'true' }),
          h('a', { class: 'row-main', href: `#/program/${program.id}/corners` },
            h('strong', null, `${program.name} ${c.name}`),
            h('small', null, `${fmtInstant(ms)}（あと${fmtRemaining(ms - now)}）${c.topic ? `・${c.topic}` : ''}`)),
          button('投稿', () => postToCorner(c), 'small primary'))))
        : h('p', { class: 'muted pad' }, '近い締切はありません')),
    section('投稿先一覧',
      groups.length
        ? groups.map(({ p, contacts }) => h('div', { class: 'group' },
          h('a', { class: 'group-title', href: `#/program/${p.id}/corners` }, h('span', { class: 'ev-bar', style: `background:${p.color}` }), p.name),
          h('div', { class: 'list' }, contacts.map((c) => contactRow(c, p)))))
        : empty('番組の「コーナー・投稿先」から投稿先を登録できます。', programs.length ? linkButton('番組一覧へ', '#/programs') : null)),
    section('投稿テンプレート',
      h('div', { class: 'row card' },
        h('span', { class: 'row-main' },
          h('strong', null, t?.radioName ? `ラジオネーム：${t.radioName}` : '未設定'),
          h('small', null, 'ラジオネーム・署名をメール本文に差し込みます')),
        button('編集', openTemplate, 'small'))));
}
