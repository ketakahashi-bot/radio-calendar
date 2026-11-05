// 操作を試すためのサンプル番組（架空のデータ）

import { save } from './store.js';
import { buildRRule } from './rrule.js';
import { dayToYmd, jstDay } from './time.js';

export function addSample() {
  const today = dayToYmd(jstDay(Date.now()) - 21);
  const p1 = save('programs', {
    name: 'ミッドナイト放送室（サンプル）', personality: '架空 太郎', station: 'サンプル放送', genre: 'バラエティ',
    color: '#3F51B5', icon: 'moon', hashtags: ['#サンプル放送室'], xAccounts: [], timefree: true, reminders: [15], favorite: true, syncEnabled: false,
  }, { silent: true });
  save('schedules', { programId: p1.id, dtstart: today, start: '25:00', end: '27:00', rrule: buildRRule({ repeat: 'weekly', days: [6] }), tz: 'Asia/Tokyo' }, { silent: true });
  save('channels', { programId: p1.id, mediaType: 'am', station: 'サンプル放送', frequency: '999', unit: 'kHz', region: '関東', catchupMode: 'radiko', catchupDays: 0, offsetMin: 0, url: 'https://example.com/listen' }, { silent: true });
  const corner = save('corners', { programId: p1.id, name: 'ふつおた', description: '普通のお便りを紹介', theme: '最近あった小さな事件', frequency: 'every', order: 1, status: 'active' }, { silent: true });
  save('contacts', { programId: p1.id, type: 'email', label: '番組宛', value: 'midnight@example.com', cornerIds: [corner.id] }, { silent: true });

  const p2 = save('programs', {
    name: '朝の音楽便（サンプル）', personality: '見本 花子', station: 'サンプルFM', genre: '音楽',
    color: '#33B679', icon: 'sun', hashtags: [], xAccounts: [], timefree: true, reminders: [5], syncEnabled: false,
  }, { silent: true });
  save('schedules', { programId: p2.id, dtstart: today, start: '7:00', end: '9:00', rrule: buildRRule({ repeat: 'weekly', days: [1, 2, 3, 4, 5] }), tz: 'Asia/Tokyo' });
}
