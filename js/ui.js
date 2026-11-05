// 画面部品。文字列はすべて textContent 経由で入れるので、入力内容が HTML として解釈されることはない。

import { safeUrl, textOn } from './domain.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') throw new Error('html is not allowed');
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

let rerenderFn = () => {};
export const setRerender = (fn) => { rerenderFn = fn; };
export const rerender = () => rerenderFn();

export function page({ title, back, actions, tab }, ...content) {
  return h('div', { class: 'page', 'data-tab': tab },
    h('header', { class: 'bar' },
      back ? h('a', { class: 'bar-back', href: back, 'aria-label': '戻る' }, '‹') : null,
      h('h1', { class: 'bar-title', tabIndex: -1 }, title),
      h('div', { class: 'bar-actions' }, actions)),
    h('main', { class: 'content' }, content));
}

export const section = (title, ...content) => h('section', { class: 'sec' },
  title ? h('h2', { class: 'sec-title' }, title) : null, content);

export const empty = (text, action) => h('div', { class: 'empty' }, h('p', null, text), action);

export const button = (label, onclick, cls = '', extra = {}) => h('button', { type: 'button', class: `btn ${cls}`, onclick, ...extra }, label);
export const linkButton = (label, href, cls = '') => h('a', { class: `btn ${cls}`, href }, label);

export function externalLink(label, url, cls = 'btn') {
  const safe = safeUrl(url);
  if (!safe) return h('span', { class: 'muted' }, label);
  return h('a', { class: cls, href: safe, target: '_blank', rel: 'noopener noreferrer' }, label);
}

export function colorDot(program) {
  const style = `background:${program.color};color:${textOn(program.color)}`;
  if (GENERIC_ICONS[program.icon]) return h('span', { class: 'prog-icon', style, 'aria-hidden': 'true' }, svgIcon(program.icon));
  return h('span', { class: 'prog-icon', style, 'aria-hidden': 'true' }, (program.name || '?').slice(0, 1));
}

/** 番組に使える汎用アイコン（番組ロゴ・画像は権利の都合で扱わない） */
export const GENERIC_ICONS = {
  radio: { label: 'ラジオ', d: 'M4 9.5 18 4M5 9.5h14A1.5 1.5 0 0 1 20.5 11v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19v-8A1.5 1.5 0 0 1 5 9.5ZM8 16.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM14 13.5h3.5M14 16.5h3.5' },
  mic: { label: 'マイク', d: 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3M8.5 20.5h7' },
  music: { label: '音楽', d: 'M9 18V5.5l11-2V16M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z' },
  headphones: { label: 'ヘッドホン', d: 'M4 17v-4a8 8 0 0 1 16 0v4M4 15h3v5H5a1 1 0 0 1-1-1v-4ZM20 15h-3v5h2a1 1 0 0 0 1-1v-4Z' },
  chat: { label: 'トーク', d: 'M4 5.5h16v10H9l-5 4v-14ZM8 9.5h8M8 12.5h5' },
  moon: { label: '深夜', d: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z' },
  sun: { label: '朝', d: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4' },
  star: { label: '星', d: 'm12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z' },
  video: { label: '動画', d: 'M3.5 6.5h12v11h-12zM15.5 10.5l5-3v9l-5-3' },
  sport: { label: 'スポーツ', d: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5M12 3.5C9.5 5.8 8.2 8.7 8.2 12s1.3 6.2 3.8 8.5' },
};

export function svgIcon(id) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'gicon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', GENERIC_ICONS[id]?.d || '');
  svg.append(path);
  return svg;
}

let toastTimer = null;
/** action: { label, onClick } を渡すとボタン付きで長めに表示する */
export function toast(message, { error = false, action = null } = {}) {
  const el = document.getElementById('toast');
  el.replaceChildren(...[h('span', null, message), action ? h('button', {
    type: 'button',
    class: 'toast-action',
    onclick: () => { el.className = 'toast'; action.onClick(); },
  }, action.label) : null].filter(Boolean));
  el.className = `toast show ${error ? 'error' : ''} ${action ? 'has-action' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, action ? 8000 : error ? 5000 : 2200);
}

export async function copyText(text, label = 'コピーしました') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label);
}

function openDialog(build) {
  const dlg = h('dialog', { class: 'sheet' });
  const close = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  build(dlg, close);
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmSheet(message, { ok = 'OK', danger = false, detail = null } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const dlg = openDialog((d, close) => {
      d.append(
        h('p', { class: 'sheet-msg' }, message),
        detail ? h('p', { class: 'muted' }, detail) : '',
        h('div', { class: 'sheet-actions' },
          button('キャンセル', close),
          button(ok, () => { result = true; close(); }, danger ? 'danger' : 'primary')));
    });
    dlg.addEventListener('close', () => resolve(result));
  });
}

/** 選択肢のシート。選ばれた value を返す（閉じたら null） */
export function chooseSheet(title, options) {
  return new Promise((resolve) => {
    let result = null;
    const dlg = openDialog((d, close) => {
      d.append(h('h2', { class: 'sheet-title' }, title),
        h('div', { class: 'choice-list' }, options.map((o) => button(o.label, () => { result = o.value; close(); }, o.danger ? 'danger' : ''))),
        h('div', { class: 'sheet-actions' }, button('キャンセル', close)));
    });
    dlg.addEventListener('close', () => resolve(result));
  });
}

let fieldSeq = 0;

function buildField(f, value) {
  const id = `f${++fieldSeq}`;
  const common = { id, name: f.name, required: f.required, placeholder: f.placeholder };
  let control;
  if (f.type === 'textarea') control = h('textarea', { ...common, rows: f.rows || 4, value: value ?? '' });
  else if (f.type === 'select') {
    control = h('select', common, f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value ?? '') }, o.label)));
  } else if (f.type === 'checkbox') {
    return h('label', { class: 'check-row' }, h('input', { type: 'checkbox', name: f.name, checked: !!value }), h('span', null, f.label), f.help ? h('small', { class: 'help' }, f.help) : null);
  } else if (f.type === 'checks') {
    const set = new Set(value || []);
    return h('fieldset', { class: 'field' }, h('legend', null, f.label),
      f.options.length
        ? h('div', { class: 'chips' }, f.options.map((o) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', name: f.name, value: o.value, checked: set.has(o.value) }), h('span', null, o.label))))
        : h('p', { class: 'muted' }, f.emptyText || '選択肢がありません'),
      f.help ? h('small', { class: 'help' }, f.help) : null);
  } else {
    const types = { datetime: 'datetime-local' };
    const inputmode = f.type === 'number' ? 'decimal' : undefined;
    control = h('input', { ...common, type: types[f.type] || f.type || 'text', inputMode: inputmode, value: value ?? '', min: f.min, step: f.step });
  }
  return h('div', { class: 'field' },
    h('label', { for: id }, f.label, f.required ? h('span', { class: 'req' }, '必須') : null),
    control,
    f.help ? h('small', { class: 'help' }, f.help) : null,
    h('small', { class: 'field-error', 'data-error': f.name, role: 'alert' }));
}

export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'checkbox') out[f.name] = form.elements[f.name].checked;
    else if (f.type === 'checks') {
      out[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => {
        const opt = f.options.find((o) => String(o.value) === i.value);
        return opt ? opt.value : i.value;
      });
    } else if (f.type === 'number') {
      const v = form.elements[f.name].value.trim();
      out[f.name] = v === '' ? null : Number(v);
    } else out[f.name] = form.elements[f.name].value.trim();
  }
  return out;
}

/** 入力フォームのシート。validate は { 項目名: エラー文 } を返す */
export function openForm({ title, fields, values = {}, submitLabel = '保存', validate, onSubmit, onDelete, extra }) {
  openDialog((d, close) => {
    const form = h('form', { class: 'form', method: 'dialog', novalidate: true },
      h('h2', { class: 'sheet-title' }, title),
      typeof extra === 'function' ? extra(values) : null,
      fields.map((f) => buildField(f, values[f.name])),
      h('div', { class: 'sheet-actions' },
        onDelete ? button('削除', async () => { if (await onDelete()) close(); }, 'danger ghost') : null,
        h('span', { class: 'spacer' }),
        button('キャンセル', close),
        h('button', { type: 'submit', class: 'btn primary' }, submitLabel)));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('[data-error]').forEach((n) => { n.textContent = ''; });
      const vals = readForm(form, fields);
      const errors = {};
      for (const f of fields) {
        if (f.required && (vals[f.name] === '' || vals[f.name] == null)) errors[f.name] = `${f.label}を入力してください`;
      }
      Object.assign(errors, validate?.(vals) || {});
      const names = Object.keys(errors);
      if (names.length) {
        names.forEach((n) => { const t = form.querySelector(`[data-error="${n}"]`); if (t) t.textContent = errors[n]; });
        form.elements[names[0]]?.focus?.();
        return;
      }
      if ((await onSubmit(vals, form)) !== false) close();
    });
    d.append(form);
  });
}
