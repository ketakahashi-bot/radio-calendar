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
  if (program.icon) return h('img', { class: 'prog-icon', src: program.icon, alt: '' });
  return h('span', { class: 'prog-icon', style: `background:${program.color};color:${textOn(program.color)}`, 'aria-hidden': 'true' }, (program.name || '?').slice(0, 1));
}

let toastTimer = null;
export function toast(message, { error = false } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show ${error ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, error ? 5000 : 2200);
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
