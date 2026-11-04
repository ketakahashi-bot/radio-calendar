// 投稿メールの作成。iPhone では Gmail アプリ、なければ既定のメールアプリ、PC では Gmail のWeb画面を開く。

import { all, byProgram, get, getSetting } from './store.js';
import { chooseSheet, copyText, toast } from './ui.js';
import { safeUrl } from './domain.js';

export const postTemplate = () => all('templates')[0] || null;

function fill(tpl, vars) {
  return tpl.replace(/\{(番組名|コーナー名|ラジオネーム|お題)\}/g, (_, k) => vars[k] || '').replace(/[ 　]+$/g, '').trim();
}

export function buildMail({ program, corner, contact }, template = postTemplate()) {
  const vars = {
    番組名: program.name,
    コーナー名: corner?.name || '',
    ラジオネーム: template?.radioName || '',
    お題: corner?.topic || '',
  };
  const subjectTpl = contact.subjectTemplate || (corner ? '{番組名} {コーナー名}' : '{番組名}');
  const parts = [];
  if (template?.body) parts.push(fill(template.body, vars));
  const sign = [template?.radioName ? `ラジオネーム: ${template.radioName}` : '', template?.signature || ''].filter(Boolean).join('\n');
  if (sign) parts.push(`\n\n${sign}`);
  return { to: contact.value, subject: fill(subjectTpl, vars), body: parts.join('\n').trim() };
}

const query = ({ to, subject, body }) => `to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const mailtoUrl = (m) => `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
export const gmailAppUrl = (m) => `googlegmail://co?${query(m)}`;
export const gmailWebUrl = (m) => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.to)}&su=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;

const isMobile = () => /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function openMail(mail) {
  const pref = getSetting('mailApp', 'gmail');
  if (pref === 'default') {
    location.href = mailtoUrl(mail);
    return;
  }
  if (!isMobile()) {
    window.open(gmailWebUrl(mail), '_blank', 'noopener');
    return;
  }
  // Gmail アプリが開けばページが背面に回る。回らなければ既定のメールアプリへ切り替える
  let left = false;
  const onHide = () => { if (document.hidden) left = true; };
  document.addEventListener('visibilitychange', onHide);
  location.href = gmailAppUrl(mail);
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    if (!left) location.href = mailtoUrl(mail);
  }, 1200);
}

/** 投稿先の種類に応じた操作を実行する */
export function actContact(contact, program, corner = null) {
  if (contact.type === 'form') {
    const url = safeUrl(contact.value);
    if (url) window.open(url, '_blank', 'noopener');
  } else if (contact.type === 'hashtag') {
    copyText(contact.value, 'ハッシュタグをコピーしました');
  } else {
    openMail(buildMail({ program, corner, contact }));
  }
}

export const contactActionLabel = (c) => ({ form: 'フォームを開く', hashtag: 'コピー' }[c.type] || 'メール作成');

/** コーナーからの投稿。紐付いた投稿先、なければ番組の投稿先を使う */
export async function postToCorner(corner) {
  const program = get('programs', corner.programId);
  const contacts = byProgram('contacts', corner.programId);
  const linked = contacts.filter((c) => (c.cornerIds || []).includes(corner.id));
  const pool = (linked.length ? linked : contacts).filter((c) => c.type === 'email');
  if (!pool.length) {
    toast('メールの投稿先が登録されていません', { error: true });
    return;
  }
  let contact = pool[0];
  if (pool.length > 1) {
    const id = await chooseSheet('投稿先を選択', pool.map((c) => ({ value: c.id, label: `${c.label || '投稿先'}（${c.value}）` })));
    if (!id) return;
    contact = pool.find((c) => c.id === id);
  }
  openMail(buildMail({ program, corner, contact }));
}
