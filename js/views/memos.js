// メモ（番組単位・放送回単位）

import { h, page, empty, button, openForm, rerender, confirmSheet } from '../ui.js';
import { get, save, remove, byProgram } from '../store.js';
import { dayToYmd, jstDay, ymdToDay, fmtDay, fmtInstant } from '../time.js';

const memoFields = [{ name: 'body', label: '本文', type: 'textarea', required: true, rows: 6, placeholder: '感想、ゲスト、オンエア曲など' }];

export function openMemo(memo, base = {}) {
  openForm({
    title: memo ? 'メモを編集' : 'メモを追加',
    fields: memoFields,
    values: memo || {},
    onSubmit: (v) => {
      save('memos', { ...(memo || base), body: v.body });
      rerender();
    },
    onDelete: memo ? async () => {
      if (!(await confirmSheet('このメモを削除しますか？', { ok: '削除', danger: true }))) return false;
      remove('memos', memo.id);
      rerender();
      return true;
    } : null,
  });
}

export function memoRows(memos, { showProgram = false } = {}) {
  return h('div', { class: 'list' }, memos.map((m) => {
    const program = get('programs', m.programId);
    const heading = [
      showProgram && program ? program.name : null,
      m.episodeDate ? `${fmtDay(ymdToDay(m.episodeDate))}の回` : null,
      fmtInstant(m.createdAt),
    ].filter(Boolean).join('・');
    return h('button', { type: 'button', class: 'row memo-row', onclick: () => openMemo(m) },
      h('span', { class: 'row-main' }, h('small', null, heading), h('span', { class: 'memo-body' }, m.body)));
  }));
}

export function renderMemos(programId) {
  const p = get('programs', programId);
  const memos = byProgram('memos', programId).sort((a, b) => b.createdAt - a.createdAt);
  return page({
    title: 'メモ', back: `#/program/${programId}`, tab: 'programs',
    actions: button('＋ 追加', () => openMemo(null, { programId, date: dayToYmd(jstDay(Date.now())) }), 'small'),
  },
  h('p', { class: 'muted pad' }, p?.name),
  memos.length ? memoRows(memos) : empty('メモはまだありません。'));
}
