// 起動処理とルーティング

import { initStore, onChange } from './store.js';
import { h, setRerender, toast } from './ui.js';
import { renderCalendar, refreshNow } from './views/calendar.js';
import { renderPrograms, renderProgram, renderProgramEdit, renderProgramEpisodes, notFound } from './views/programs.js';
import { renderEpisode } from './views/episode.js';
import { renderChannels } from './views/media.js';
import { renderCorners, renderPost } from './views/corners.js';
import { renderMemos } from './views/memos.js';
import { renderSettings, refreshSyncStatus } from './views/settings.js';
import { requestSync, startSyncLoop } from './sync.js';

const TABS = [
  { id: 'calendar', label: 'カレンダー', href: '#/calendar', icon: 'M7 2v3M17 2v3M3.5 9h17M5 4.5h14A1.5 1.5 0 0 1 20.5 6v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z' },
  { id: 'programs', label: '番組一覧', href: '#/programs', icon: 'M4 9.5 18 4M5 9.5h14A1.5 1.5 0 0 1 20.5 11v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19v-8A1.5 1.5 0 0 1 5 9.5ZM8 16.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM14 13.5h3.5M14 16.5h3.5' },
  { id: 'post', label: '投稿', href: '#/post', icon: 'M3.5 6.5h17v11a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-11ZM3.5 6.5 12 13l8.5-6.5' },
  { id: 'settings', label: '設定', href: '#/settings', icon: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 9.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM9 19.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z' },
];

function tabIcon(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function route(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [head, a, b] = parts;
  switch (head) {
    case undefined:
    case 'calendar': return renderCalendar();
    case 'programs': return renderPrograms();
    case 'post': return renderPost();
    case 'settings': return renderSettings();
    case 'ep': return renderEpisode(a);
    case 'program':
      if (a === 'new') return renderProgramEdit(null);
      if (b === 'edit') return renderProgramEdit(a);
      if (b === 'channels') return renderChannels(a);
      if (b === 'corners') return renderCorners(a);
      if (b === 'memos') return renderMemos(a);
      if (b === 'episodes') return renderProgramEpisodes(a);
      return renderProgram(a);
    default: return notFound();
  }
}

let lastHash = null;

function render() {
  const root = document.getElementById('view');
  const sameRoute = lastHash === location.hash;
  const y = window.scrollY;
  const node = route(location.hash);
  root.replaceChildren(node);
  const tab = node.dataset?.tab;
  document.querySelectorAll('.tab').forEach((el) => {
    const active = el.dataset.id === tab;
    el.classList.toggle('on', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  if (sameRoute) {
    window.scrollTo(0, y);
  } else {
    window.scrollTo(0, 0);
    lastHash = location.hash;
    node.querySelector('.bar-title')?.focus({ preventScroll: true });
  }
  document.title = `${node.querySelector('.bar-title')?.textContent || ''} - ラジオ番組カレンダー`;
}

function mountShell() {
  const nav = document.getElementById('tabs');
  nav.replaceChildren(...TABS.map((t) => h('a', { class: 'tab', href: t.href, 'data-id': t.id }, tabIcon(t.icon), h('span', null, t.label))));
}

async function boot() {
  await initStore();
  mountShell();
  setRerender(render);
  window.addEventListener('hashchange', render);
  onChange(requestSync);
  window.addEventListener('sync-status', refreshSyncStatus);
  window.addEventListener('storage-error', () => toast('端末への保存に失敗しました', { error: true }));
  render();
  setInterval(refreshNow, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNow(); });
  startSyncLoop();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker を登録できません', e));
  } else if ('serviceWorker' in navigator && location.hostname === 'localhost') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker を登録できません', e));
  }
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('view').textContent = `起動できませんでした：${e.message}`;
});
