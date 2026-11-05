// 投稿メールの作成と投稿履歴の記録（F-MAIL, F-POST, F-X）。
// iPhone では Gmail アプリ、なければ既定のメールアプリ、PC では Gmail のWeb画面を開く。

import { all, byProgram, get, getSetting, save } from './store.js';
import { chooseSheet, copyText, toast } from './ui.js';
import { safeUrl } from './domain.js';
import { xPostUrl, normalizeHashtag } from './links.js';

export const postTemplate = () => all('templates')[0] || null;

/** 番組ごとのラジオネーム（F-POST-05）。なければテンプレートの既定のラジオネーム */
export function radioNameFor(programId) {
  const own = all('radioNames').find((r) => r.programId === programId);
  return own?.name || postTemplate()?.radioName || '';
}

function fill(tpl, vars) {
  return tpl.replace(/\{(番組名|コーナー名|ラジオネーム|お題)\}/g, (_, k) => vars[k] || '').replace(/[ 　]+$/g, '').trim();
}

export function buildMail({ program, corner, contact, body = '' }, template = postTemplate()) {
  const radioName = all('radioNames').find((r) => r.programId === program.id)?.name || template?.radioName || '';
  const vars = {
    番組名: program.name,
    コーナー名: corner?.name || '',
    ラジオネーム: radioName,
    お題: corner?.topic || '',
  };
  const subjectTpl = contact.subjectTemplate || (corner ? '{番組名} {コーナー名}' : '{番組名}');
  const parts = [];
  if (template?.body) parts.push(fill(template.body, vars));
  if (body) parts.push(body);
  const sign = [radioName ? `ラジオネーム: ${radioName}` : '', template?.signature || ''].filter(Boolean).join('\n');
  if (sign) parts.push(`\n${sign}`);
  return { to: contact.value, subject: fill(subjectTpl, vars), body: parts.join('\n\n').trim() };
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

/** 投稿履歴を残す（F-POST-02, F-X-06） */
export function logPost({ program, corner = null, route, subject = '' }) {
  return save('postLogs', {
    programId: program.id,
    cornerId: corner?.id || null,
    route,
    subject,
    postedAt: Date.now(),
    read: false,
  });
}

/** メールを書き始める。書き始めた時点で投稿履歴に残す */
export function composeMail({ program, corner = null, contact, body = '' }) {
  const mail = buildMail({ program, corner, contact, body });
  logPost({ program, corner, route: 'mail', subject: mail.subject });
  openMail(mail);
}

/** X の投稿画面を開く。投稿したかはアプリから分からないので、記録は利用者が選ぶ */
export function composeX({ program, corner = null, text }) {
  window.open(xPostUrl(text), '_blank', 'noopener');
  toast('X で投稿したら、履歴に残せます', {
    action: { label: '履歴に記録', onClick: () => { logPost({ program, corner, route: 'x', subject: text.split('\n')[0].slice(0, 60) }); toast('投稿履歴に記録しました'); } },
  });
}

/** 投稿先の種類に応じた操作を実行する */
export function actContact(contact, program, corner = null, body = '') {
  if (contact.type === 'form') {
    const url = safeUrl(contact.value);
    if (url) window.open(url, '_blank', 'noopener');
  } else if (contact.type === 'xhashtag') {
    const tag = normalizeHashtag(contact.value);
    composeX({ program, corner, text: [body, tag].filter(Boolean).join('\n') });
  } else {
    composeMail({ program, corner, contact, body });
  }
}

export const contactActionLabel = (c) => ({ form: 'フォームを開く', xhashtag: 'X で投稿' }[c.type] || 'メール作成');

/** コーナーからの投稿。紐付いた投稿先、なければ番組の投稿先を使う */
export async function postToCorner(corner, body = '') {
  const program = get('programs', corner.programId);
  const contacts = byProgram('contacts', corner.programId).filter((c) => c.type === 'email' || c.type === 'xhashtag');
  const linked = contacts.filter((c) => (c.cornerIds || []).includes(corner.id));
  const pool = linked.length ? linked : contacts;
  if (!pool.length) {
    toast('メールまたは X の投稿先が登録されていません', { error: true });
    return;
  }
  let contact = pool[0];
  if (pool.length > 1) {
    const id = await chooseSheet('投稿先を選択', pool.map((c) => ({ value: c.id, label: `${c.label || (c.type === 'xhashtag' ? 'X' : 'メール')}（${c.value}）` })));
    if (!id) return;
    contact = pool.find((c) => c.id === id);
  }
  actContact(contact, program, corner, body);
}

export { copyText };
