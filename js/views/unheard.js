// 未聴タブ：未聴の放送回と新着の回（F-REM-09, F-FEED-04, F-TF-02, F-TF-04）

import { h, page, section, empty, button, externalLink, colorDot, toast, rerender } from '../ui.js';
import { get, save, byProgram } from '../store.js';
import { unheard, unheardFeedItems, saveEpisode, timefreeStatus, radikoPlan } from '../episodes.js';
import { fmtDay, fmtHM, fmtInstant, fmtRemaining } from '../time.js';
import { safeUrl } from '../domain.js';
import { isLinked, gasOutdated } from '../sync.js';

function expiryText(expiry, now) {
  if (expiry == null) return '聴き逃し配信なし';
  const left = expiry - now;
  const days = Math.floor(left / 86400000);
  return days >= 1 ? `あと${days}日（${fmtInstant(expiry)}まで）` : `あと${fmtRemaining(left)}（${fmtInstant(expiry)}まで）`;
}

function listenLink(programId) {
  const ch = byProgram('channels', programId).find((c) => safeUrl(c.url));
  return ch ? externalLink('聴く', ch.url, 'btn small primary') : null;
}

export function episodeRows(list, now = Date.now()) {
  return h('div', { class: 'list' }, list.map((o) => {
    const tf = timefreeStatus(o, now);
    const urgent = o.expiry != null && o.expiry - now < 86400000;
    return h('div', { class: 'row' },
      colorDot(o.program),
      h('a', { class: 'row-main', href: `#/ep/${o.key}` },
        h('strong', null, o.program.name, o.title ? ` ${o.title}` : ''),
        h('small', null, `${fmtDay(o.day)} ${fmtHM(o.startMin)}〜の回`),
        h('small', { class: urgent ? 'warn' : '' }, expiryText(o.expiry, now)),
        tf && !tf.expired ? h('small', null, `聴き始めてから24時間の残り ${fmtRemaining(tf.windowLeftMs)}${tf.leftMinutes != null ? `・3時間の残り ${tf.leftMinutes}分` : ''}`) : null),
      listenLink(o.program.id),
      button('聴いた', () => { saveEpisode(o, { listened: true }); toast('聴取済みにしました'); rerender(); }, 'small'));
  }));
}

function feedRows(items) {
  return h('div', { class: 'list' }, items.map((f) => {
    const p = get('programs', f.programId);
    const url = safeUrl(f.url) || safeUrl(f.audioUrl);
    return h('div', { class: 'row' },
      colorDot(p),
      h('span', { class: 'row-main' },
        h('strong', null, f.title || '（タイトルなし）'),
        h('small', null, [p.name, fmtInstant(f.publishedAt), f.duration ? `${f.duration}分` : ''].filter(Boolean).join('・'))),
      url ? externalLink('開く', url, 'btn small primary') : null,
      button('聴いた', () => { save('feedItems', { ...f, listened: true }); toast('聴取済みにしました'); rerender(); }, 'small'));
  }));
}

export function renderUnheard() {
  const now = Date.now();
  const eps = unheard(now);
  const feed = unheardFeedItems();
  const feedNote = !isLinked()
    ? 'YouTube・ポッドキャストの新着は、Google 連携をすると自動で届きます'
    : gasOutdated() ? 'GAS を第2版に更新すると、YouTube・ポッドキャストの新着が自動で届きます（README 参照）' : null;
  return page({ title: '未聴', tab: 'unheard' },
    section(`放送回（期限の近い順）${eps.length ? `・${eps.length}件` : ''}`,
      eps.length ? episodeRows(eps, now) : h('p', { class: 'muted pad' }, '未聴の放送回はありません'),
      h('p', { class: 'help' }, radikoPlan() === 'tf30'
        ? 'radiko の期限はタイムフリー30（放送から30日）で計算しています。'
        : 'radiko の期限は無料のタイムフリー（放送から7日）で計算しています。プランは設定で変えられます。')),
    section(`新着の回${feed.length ? `・${feed.length}件` : ''}`,
      feed.length ? feedRows(feed) : h('p', { class: 'muted pad' }, '未聴の新着の回はありません'),
      feedNote ? h('p', { class: 'help' }, feedNote) : null,
      feed.length > 1 ? h('div', { class: 'row-actions' }, button('すべて聴いたことにする', () => {
        feed.forEach((f) => save('feedItems', { ...f, listened: true }, { silent: true }));
        save('feedItems', { ...feed[0], listened: true });
        rerender();
      }, 'small ghost')) : null));
}
