// 依存のない小さな時刻解析（データ移行で使う）

export function parseRHM(text) {
  const m = String(text ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 47) return null;
  return h * 60 + min;
}
