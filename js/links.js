// 外部サービスへのリンク形式。形式が変わったときはこのファイルだけ直せばよいようにまとめる。
// X は API を使わず、投稿画面・検索・アカウントのページをリンクで開くだけにする（F-X）。

import { jstDay, jstMin, dayToYmd, pad } from './time.js';

export const normalizeHashtag = (s) => {
  const t = String(s || '').trim().replace(/^[#＃]+/, '');
  return t ? `#${t}` : '';
};

export const normalizeAccount = (s) => String(s || '').trim()
  .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
  .replace(/^@/, '')
  .replace(/[/?#].*$/, '');

/** 「#a #b, c」のような入力を配列に */
export const splitList = (s, normalize) => [...new Set(String(s || '').split(/[\s,、，]+/).map(normalize).filter(Boolean))];

export const xPostUrl = (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
export const xSearchUrl = (query) => `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
export const xAccountUrl = (name) => `https://x.com/${encodeURIComponent(normalizeAccount(name))}`;

/**
 * radiko のタイムフリーで放送回を開く（F-POST-04）。
 * 形式 https://radiko.jp/#!/ts/{局ID}/{開始日時} は公式に公開されたものではないため、未決事項として要確認。
 */
export function radikoTimefreeUrl(stationId, startMs) {
  if (!stationId) return null;
  const min = jstMin(startMs);
  const stamp = `${dayToYmd(jstDay(startMs)).replace(/-/g, '')}${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
  return `https://radiko.jp/#!/ts/${encodeURIComponent(stationId)}/${stamp}`;
}

/** YouTube のチャンネルURLから RSS の URL を求める。@ハンドルなどページを読まないと分からないものは null */
export function youtubeFeedFromUrl(url) {
  const s = String(url || '').trim();
  let m = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (m) return `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
  m = s.match(/youtube\.com\/(?:playlist\?list=|.*[?&]list=)(PL[\w-]+)/);
  if (m) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${m[1]}`;
  if (/youtube\.com\/feeds\/videos\.xml\?(channel_id|playlist_id)=/.test(s)) return s;
  return null;
}

export const isYoutubeUrl = (url) => /(^|\.)youtube\.com\/|youtu\.be\//.test(String(url || ''));
