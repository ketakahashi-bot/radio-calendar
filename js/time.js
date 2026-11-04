// 時刻ユーティリティ。端末のタイムゾーンに関係なく Asia/Tokyo 基準で計算する。
// 「日」は 1970-01-01 からの通算日数（整数）、「分」はその日の 0:00 からの分数で表す。
// 深夜表記の 25:00 は 分 = 1500 となり、翌日 1:00 を指す。

export const TZ = 'Asia/Tokyo';
export const DAY_MS = 86400000;
const MIN_MS = 60000;
const JST_MS = 9 * 3600000;
const WD = ['日', '月', '火', '水', '木', '金', '土'];

export const pad = (n) => String(n).padStart(2, '0');

export function ymdToDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function dayToYmd(day) {
  const t = new Date(day * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export const dayParts = (day) => {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
};

export const weekdayOf = (day) => new Date(day * DAY_MS).getUTCDay();
export const weekdayLabel = (wd) => WD[wd];
export const monthStart = (y, m) => Date.UTC(y, m - 1, 1) / DAY_MS;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "25:00" / "2500" / "1:5" などを分に変換。不正なら null。 */
export function parseHM(text) {
  if (text == null) return null;
  const s = String(text).trim().replace('：', ':');
  let m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) m = s.match(/^(\d{1,2})(\d{2})$/);
  if (!m) {
    if (/^\d{1,2}$/.test(s)) m = [s, s, '0'];
    else return null;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 47) return null;
  return h * 60 + min;
}

export const fmtHM = (min) => `${Math.floor(min / 60)}:${pad(min % 60)}`;

/** 日と分から実時刻（エポックms）へ */
export const instant = (day, min = 0) => day * DAY_MS + min * MIN_MS - JST_MS;
export const jstDay = (ms) => Math.floor((ms + JST_MS) / DAY_MS);
export const jstMin = (ms) => Math.floor((ms + JST_MS - jstDay(ms) * DAY_MS) / MIN_MS);

/** 日の区切り boundary（分）を考慮した「論理上の日」 */
export const logicalDay = (ms, boundary = 0) => jstDay(ms - boundary * MIN_MS);
/** 論理日の 0:00 からの分。区切り 5:00 なら実時刻 1:00 は 25:00 になる */
export const logicalMin = (ms, boundary = 0) => Math.round((ms - instant(logicalDay(ms, boundary))) / MIN_MS);

export function fmtDay(day, { year = false } = {}) {
  const p = dayParts(day);
  return `${year ? p.y + '年' : ''}${p.m}/${p.d}(${WD[p.wd]})`;
}

export const fmtInstant = (ms) => `${fmtDay(jstDay(ms))} ${fmtHM(jstMin(ms))}`;

/** Google カレンダー用 ISO 文字列 */
export function isoJst(ms) {
  const day = jstDay(ms);
  const min = jstMin(ms);
  return `${dayToYmd(day)}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00+09:00`;
}

/** iCal のローカル時刻表現 20261108T010000 */
export function icalLocal(ms) {
  const min = jstMin(ms);
  return `${dayToYmd(jstDay(ms)).replace(/-/g, '')}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
}

/** iCal の UTC 表現（UNTIL 用） */
export function icalUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** datetime-local の値 "2026-11-07T18:00" を JST として解釈 */
export function parseLocalDateTime(s) {
  const m = s && s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return instant(ymdToDay(m[1]), Number(m[2]) * 60 + Number(m[3]));
}

export function fmtRemaining(ms) {
  const mins = Math.round(ms / MIN_MS);
  if (mins < 60) return `${mins}分`;
  if (mins < 1440) return `${Math.floor(mins / 60)}時間${mins % 60 ? mins % 60 + '分' : ''}`;
  return `${Math.floor(mins / 1440)}日`;
}
