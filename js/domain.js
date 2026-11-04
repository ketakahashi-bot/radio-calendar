// 固定マスタと入力検証

// 番組カラーは Google カレンダーの予定色に揃える（F-REM-07）
export const COLORS = [
  { id: '11', name: 'トマト', hex: '#D50000' },
  { id: '4', name: 'フラミンゴ', hex: '#E67C73' },
  { id: '6', name: 'ミカン', hex: '#F4511E' },
  { id: '5', name: 'バナナ', hex: '#F6BF26' },
  { id: '2', name: 'セージ', hex: '#33B679' },
  { id: '10', name: 'バジル', hex: '#0B8043' },
  { id: '7', name: 'ピーコック', hex: '#039BE5' },
  { id: '9', name: 'ブルーベリー', hex: '#3F51B5' },
  { id: '1', name: 'ラベンダー', hex: '#7986CB' },
  { id: '3', name: 'ブドウ', hex: '#8E24AA' },
  { id: '8', name: 'グラファイト', hex: '#616161' },
];
export const DEFAULT_COLOR = '#039BE5';
export const colorIdOf = (hex) => (COLORS.find((c) => c.hex === hex) || COLORS[6]).id;

/** 背景色に対して読める文字色を返す */
export function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1b1a17' : '#ffffff';
}

export const MEDIA_TYPES = [
  { id: 'am', label: 'AM', unit: 'kHz' },
  { id: 'fm', label: 'FM', unit: 'MHz' },
  { id: 'widefm', label: 'ワイドFM', unit: 'MHz' },
  { id: 'net', label: 'ネットラジオ', unit: '' },
  { id: 'youtube', label: 'YouTube', unit: '' },
  { id: 'podcast', label: 'Podcast', unit: '' },
  { id: 'other', label: 'その他', unit: '' },
];
export const mediaLabel = (id) => (MEDIA_TYPES.find((m) => m.id === id) || { label: id }).label;

export const REMINDER_CHOICES = [
  { value: 0, label: '開始時' },
  { value: 5, label: '5分前' },
  { value: 15, label: '15分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
];

export const reminderLabel = (m) => (REMINDER_CHOICES.find((c) => c.value === m) || { label: `${m}分前` }).label;

export const CORNER_FREQ = [
  { value: 'every', label: '毎回' },
  { value: 'biweekly', label: '隔週' },
  { value: 'irregular', label: '不定期' },
];
export const CORNER_STATUS = [
  { value: 'active', label: '放送中' },
  { value: 'paused', label: '休止中' },
  { value: 'ended', label: '終了' },
];
export const CONTACT_TYPES = [
  { value: 'email', label: 'メール' },
  { value: 'form', label: 'フォームURL' },
  { value: 'hashtag', label: 'ハッシュタグ' },
];

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());

/** リンクに使ってよい URL か。javascript: などを弾く。アプリ起動用のスキームは許可する。 */
export function safeUrl(url) {
  const s = String(url || '').trim();
  if (!s) return null;
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!m) return null;
  return ['javascript', 'data', 'vbscript', 'file', 'blob'].includes(m[1].toLowerCase()) ? null : s;
}
