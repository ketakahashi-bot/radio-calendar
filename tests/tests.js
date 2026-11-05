// ブラウザで動かすテスト。tests/test.html を開くと実行される。
// Google 連携は gas/Code.gs を本物のまま読み込み、Google のサービスだけを偽物に差し替えて通しで確認する。

await new Promise((resolve) => {
  const req = indexedDB.deleteDatabase('radio-calendar-test');
  req.onsuccess = req.onerror = req.onblocked = () => resolve();
});

const time = await import('../js/time.js');
const rrule = await import('../js/rrule.js');
const store = await import('../js/store.js');
const episodes = await import('../js/episodes.js');
const gcal = await import('../js/gcal.js');
const sync = await import('../js/sync.js');
const mail = await import('../js/mail.js');
const domain = await import('../js/domain.js');
const links = await import('../js/links.js');
const migrate = await import('../js/migrate.js');
const digest = await import('../js/digest.js');
const share = await import('../js/share.js');
const stats = await import('../js/stats.js');
const programsView = await import('../js/views/programs.js');

const { ymdToDay, dayToYmd, parseHM, fmtHM, instant, logicalDay, logicalMin, isoJst, jstDay, jstMin } = time;
const { expand, buildRRule, rruleToForm, googleSeries, describeSchedule } = rrule;

const results = [];
function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  results.push({ name, ok: a === b, detail: `期待 ${b}\n実際 ${a}` });
}
const ok = (cond, name) => eq(!!cond, true, name);
const ymds = (list) => list.map(dayToYmd);
const tick = () => new Promise((r) => setTimeout(r, 0));

await store.initStore();
eq(store.getSetting('dataVersion'), 2, '新しい端末はデータ形式の版2で始まる');

// ---- 時刻と深夜表記（第2版 2.2）----
eq(parseHM('25:00'), 1500, '25:00 は 1500 分');
eq(parseHM('2530'), 1530, '4桁入力 2530');
eq(parseHM('28:59'), 1739, '28:59');
eq(parseHM('25:60'), null, '不正な分は null');
eq(fmtHM(1500), '25:00', '25:00 表示');
const mon25 = instant(ymdToDay('2026-11-02'), 1500);
eq(isoJst(mon25), '2026-11-03T01:00:00+09:00', '月曜 25:00 は火曜 1:00');
eq(episodes.BOUNDARY, 300, '日の区切りは 5:00 固定');
eq(dayToYmd(logicalDay(instant(ymdToDay('2026-11-03'), 299), 300)), '2026-11-02', '火曜 4:59 は月曜の放送日');
eq(logicalMin(instant(ymdToDay('2026-11-03'), 299), 300), 1739, '火曜 4:59 は 28:59 表示');
eq(dayToYmd(logicalDay(instant(ymdToDay('2026-11-03'), 300), 300)), '2026-11-03', '火曜 5:00 は火曜の放送日');
eq(dayToYmd(logicalDay(instant(ymdToDay('2026-11-30'), 1500), 300)), '2026-11-30', '月末の月曜 25:00 は翌月1日でなく月末の欄');

// ---- 放送枠の入力チェック ----
const vs = programsView.validateSchedule;
ok(vs({ repeat: 'weekly', days: [1], nths: [], start: '25:00', end: '27:00' }) === null, '月曜 25:00〜27:00 は登録できる');
ok(vs({ repeat: 'weekly', days: [1], nths: [], start: '1:00', end: '3:00' })?.includes('前日の曜日'), '0:00〜4:59 開始は前日の深夜表記に誘導');
ok(vs({ repeat: 'weekly', days: [1], nths: [], start: '29:00', end: '30:00' }), '29:00 開始は不可');
ok(vs({ repeat: 'weekly', days: [1], nths: [], start: '28:00', end: '30:00' }) === null, '28:00〜30:00 は登録できる');
ok(vs({ repeat: 'weekly', days: [], nths: [], start: '25:00', end: '27:00' }), '曜日なしは不可');

// ---- RRULE 展開 ----
const from = ymdToDay('2026-11-01');
const to = ymdToDay('2026-11-30');
eq(ymds(expand({ dtstart: '2026-11-01', rrule: buildRRule({ repeat: 'weekly', days: [6] }) }, from, to)),
  ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'], '毎週土曜');
eq(ymds(expand({ dtstart: '2026-11-07', rrule: buildRRule({ repeat: 'biweekly', days: [6] }) }, from, to)), ['2026-11-07', '2026-11-21'], '隔週土曜');
eq(ymds(expand({ dtstart: '2026-01-01', rrule: buildRRule({ repeat: 'monthly', days: [6], nths: [2] }) }, from, to)), ['2026-11-14'], '毎月第2土曜');
eq(ymds(expand({ dtstart: '2026-01-01', rrule: buildRRule({ repeat: 'monthly', days: [1], nths: [-1] }) }, from, to)), ['2026-11-30'], '毎月最終月曜');
eq(rruleToForm(buildRRule({ repeat: 'monthly', days: [6], nths: [2, 4] })), { repeat: 'monthly', days: [6], nths: [2, 4] }, 'RRULE とフォームの往復');
eq(describeSchedule({ dtstart: '2026-11-07', rrule: 'FREQ=WEEKLY;BYDAY=SA', start: '25:00', end: '27:00' }), '毎週 土曜 25:00〜27:00', '放送枠の説明文');

// ---- Google へ送る繰り返し（実際の曜日）----
const H = ymdToDay('2029-01-01');
eq(googleSeries({ dtstart: '2026-11-01', rrule: 'FREQ=WEEKLY;BYDAY=MO' }, { offsetMin: 1500, horizonDay: H }).lines, ['RRULE:FREQ=WEEKLY;BYDAY=TU'], '月曜 25:00 は毎週火曜の繰り返し');
eq(googleSeries({ dtstart: '2026-11-01', rrule: 'FREQ=WEEKLY;BYDAY=MO' }, { offsetMin: 1410, horizonDay: H }).lines, ['RRULE:FREQ=WEEKLY;BYDAY=MO'], '月曜 23:30 は月曜のまま');
eq(googleSeries({ dtstart: '2026-11-07', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA' }, { offsetMin: 1500, horizonDay: H }).lines, ['RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=SU'], '隔週の週の区切りもずらす');
eq(googleSeries({ dtstart: '2026-01-01', rrule: 'FREQ=MONTHLY;BYDAY=2SA' }, { offsetMin: 1500, horizonDay: H }).lines, ['RRULE:FREQ=MONTHLY;BYDAY=SU;BYMONTHDAY=9,10,11,12,13,14,15'], '第2土曜25時は 9〜15日の日曜');
eq(googleSeries({ dtstart: '2026-11-01', rrule: 'FREQ=MONTHLY;BYDAY=-1SA' }, { offsetMin: 1500, horizonDay: ymdToDay('2027-03-01') }).lines,
  ['RDATE;TZID=Asia/Tokyo:20261227T010000,20270131T010000,20270228T010000'], '月またぎの可能性があれば日付を列挙');
eq(googleSeries({ dtstart: '2026-11-01', rrule: 'FREQ=WEEKLY;BYDAY=SA' }, { offsetMin: 1500, exDays: [ymdToDay('2026-11-14')], endDay: ymdToDay('2027-03-27'), horizonDay: H }).lines,
  ['RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20270327T160000Z', 'EXDATE;TZID=Asia/Tokyo:20261115T010000'], '休止は実際の日時で除外、放送期間は UNTIL');

// ---- 入力検証・リンク ----
ok(domain.isEmail('a.b+c@example.co.jp'), 'メール形式 正常');
ok(!domain.isEmail('foo@bar'), 'メール形式 ドメイン不正');
eq(domain.safeUrl('javascript:alert(1)'), null, 'javascript: を拒否');
eq(links.normalizeHashtag('＃深夜'), '#深夜', '全角＃のハッシュタグ');
eq(links.splitList('#a b, #a　c', links.normalizeHashtag), ['#a', '#b', '#c'], 'ハッシュタグを複数登録');
eq(links.normalizeAccount('https://x.com/radio_x?s=1'), 'radio_x', 'X アカウントの URL からIDを取り出す');
eq(links.xPostUrl('#a #b '), 'https://x.com/intent/post?text=%23a%20%23b%20', '実況する（Web Intent）');
eq(links.xSearchUrl('#a OR #b'), 'https://x.com/search?q=%23a%20OR%20%23b&f=live', 'みんなの反応（検索）');
eq(links.youtubeFeedFromUrl('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'), 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv', 'チャンネルURLから RSS');
eq(links.youtubeFeedFromUrl('https://www.youtube.com/@someone'), null, '@ハンドルは GAS で解決');
eq(links.radikoTimefreeUrl('TBS', instant(ymdToDay('2026-11-02'), 1500)), 'https://radiko.jp/#!/ts/TBS/20261103010000', 'radiko タイムフリーのリンク');

// ---- データ形式の移行（F-MIG-09）----
{
  const v1 = {
    version: 1,
    tables: {
      programs: [{ id: 'p1', name: '旧番組', hashtag: '#旧', color: '#3F51B5' }],
      schedules: [
        { id: 's1', programId: 'p1', dtstart: '2026-11-03', start: '1:00', end: '3:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' },
        { id: 's2', programId: 'p1', dtstart: '2026-11-03', start: '1:00', end: '2:00', rrule: 'FREQ=MONTHLY;BYDAY=1TU' },
        { id: 's3', programId: 'p1', dtstart: '2026-11-03', start: '22:00', end: '24:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' },
      ],
      episodes: [{ id: 'e1', programId: 'p1', scheduleId: 's1', date: '2026-11-10', status: 'cancelled' }],
      channels: [{ id: 'c1', programId: 'p1', catchupDays: 7 }, { id: 'c2', programId: 'p1' }],
      contacts: [{ id: 'k1', programId: 'p1', type: 'hashtag', value: '#旧' }],
    },
    settings: { dayBoundary: 0, mailApp: 'default' },
  };
  const v2 = migrate.migrateData(v1);
  eq(v2.version, 2, '版1を版2に変換');
  eq(v2.tables.programs[0].hashtags, ['#旧'], 'ハッシュタグを複数形式に');
  eq(v2.tables.programs[0].timefree, true, 'タイムフリー対応の既定値');
  const s1 = v2.tables.schedules.find((s) => s.id === 's1');
  eq([s1.dtstart, s1.start, s1.end, s1.rrule], ['2026-11-02', '25:00', '27:00', 'FREQ=WEEKLY;BYDAY=MO'], '火曜 1:00 を月曜 25:00 に直す');
  eq(v2.tables.episodes[0].date, '2026-11-09', '放送回の日付も放送日に直す');
  eq(v2.tables.schedules.find((s) => s.id === 's2').start, '1:00', '毎月第n曜日の 1:00 は変えない');
  eq(v2.tables.schedules.find((s) => s.id === 's3').start, '22:00', '22:00 は変えない');
  eq(v2.tables.channels.map((c) => c.catchupMode), ['days', ''], '聴き逃し日数を方式つきに');
  eq(v2.tables.contacts[0].type, 'xhashtag', 'ハッシュタグの投稿先を X のハッシュタグに');
  ok(!('dayBoundary' in v2.settings) && v2.settings.mailApp === 'default', '日の区切りの設定を外し、他の設定は残す');
  // 変換前後で実際の放送日時が変わらない
  const before = instant(ymdToDay('2026-11-10'), 60);
  const after = instant(ymdToDay('2026-11-09'), 1500);
  eq(before, after, '変換しても実際の放送日時は同じ');
}
{
  // 第1版の端末のデータが、更新時に控えを取ってから変換されること（別のデータベースで確かめる）
  const name = 'radio-calendar-test-upgrade';
  await new Promise((r) => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  const db = await new Promise((res) => {
    const q = indexedDB.open(name, 1);
    q.onupgradeneeded = () => {
      for (const t of ['programs', 'schedules', 'episodes', 'channels', 'corners', 'contacts', 'memos', 'presets', 'templates']) q.result.createObjectStore(t, { keyPath: 'id' });
      for (const t of ['kv', 'gcalMap', 'syncQueue']) q.result.createObjectStore(t, { keyPath: 'key' });
    };
    q.onsuccess = () => res(q.result);
  });
  const tx = db.transaction(['programs', 'schedules'], 'readwrite');
  tx.objectStore('programs').put({ id: 'u1', name: '更新前の番組', hashtag: '#u', color: '#D50000', deleted: false });
  tx.objectStore('schedules').put({ id: 'us', programId: 'u1', dtstart: '2026-11-03', start: '1:00', end: '3:00', rrule: 'FREQ=WEEKLY;BYDAY=TU', deleted: false });
  await new Promise((r) => { tx.oncomplete = r; });
  db.close();
  globalThis.__RADIO_DB_NAME__ = name;
  const fresh = await import(`../js/store.js?upgrade=${Date.now()}`);
  await fresh.initStore();
  eq(fresh.get('schedules', 'us').start, '25:00', '第1版の端末のデータを更新時に変換');
  eq((await fresh.listSnapshots())[0]?.reason, '版1からの更新前', '変換の前に控えを取る');
  globalThis.__RADIO_DB_NAME__ = 'radio-calendar-test';
}

// ---- 放送回の計算 ----
const prog = store.save('programs', { name: '深夜テスト', station: 'テスト放送', color: '#3F51B5', reminders: [15, 0], hashtags: ['#深夜テスト'], timefree: true, createdAt: instant(ymdToDay('2026-01-01')) });
const sch = store.save('schedules', { programId: prog.id, dtstart: '2026-11-01', start: '25:00', end: '27:00', rrule: 'FREQ=WEEKLY;BYDAY=SA', tz: 'Asia/Tokyo' });
const chan = store.save('channels', { programId: prog.id, mediaType: 'net', station: 'radiko', url: 'https://radiko.jp/x', catchupMode: 'radiko', offsetMin: 0, radikoStation: 'TBS' });
const corner = store.save('corners', { programId: prog.id, name: 'ふつおた', status: 'active', deadline: '2026-11-07T18:00', topic: '秋' });
const contact = store.save('contacts', { programId: prog.id, type: 'email', label: '番組宛', value: 'test@example.com', cornerIds: [corner.id] });

const range = (a, b) => episodes.occurrences(instant(ymdToDay(a)), instant(ymdToDay(b)));
let occ = range('2026-11-08', '2026-11-09');
eq(occ.length, 1, '日曜の実時刻で検索すると土曜25時の回が出る');
eq(occ[0].key, `s~${sch.id}~2026-11-07`, '放送回キーは放送日');
eq(dayToYmd(logicalDay(occ[0].startMs, 300)), '2026-11-07', 'カレンダーでは土曜の欄');

const { onAir, next } = episodes.nowNext(instant(ymdToDay('2026-11-07'), 1560));
eq(onAir.length, 1, '放送中を検出');
eq(dayToYmd(next.day), '2026-11-14', '次の放送を検出');

// タイムフリー期限（F-TF）
eq(episodes.catchupExpiry(occ[0], chan), occ[0].startMs + 7 * 86400000, '無料タイムフリーは放送から7日');
store.setSetting('radikoPlan', 'tf30');
eq(episodes.catchupExpiry(occ[0], chan), occ[0].startMs + 30 * 86400000, 'タイムフリー30は30日');
store.setSetting('radikoPlan', 'free');
const unheardNow = instant(ymdToDay('2026-11-09'), 600);
const un = episodes.unheard(unheardNow);
eq(un.map((o) => dayToYmd(o.day)), ['2026-11-07'], '未聴の放送回');
eq(un[0].expiry, occ[0].startMs + 7 * 86400000, '未聴の回に期限を付ける');
episodes.saveEpisode(un[0], { tfStartedAt: unheardNow - 3600000, listenedMinutes: 50 });
const tf = episodes.timefreeStatus(episodes.occurrenceByKey(un[0].key), unheardNow);
eq([Math.round(tf.windowLeftMs / 60000), tf.leftMinutes], [23 * 60, 130], '24時間の残りと3時間の残り');
store.save('programs', { ...store.get('programs', prog.id), timefree: false });
eq(episodes.catchupExpiry(episodes.occurrenceByKey(occ[0].key), chan), null, 'タイムフリー非対応の番組は期限なし');
store.save('programs', { ...store.get('programs', prog.id), timefree: true });

// 今日のまとめの材料（F-NTF-04）
{
  const dg = digest.buildDigest(instant(ymdToDay('2026-11-07'), 360));
  const d = dg.days['2026-11-07'];
  eq(d.tonight, ['25:00 深夜テスト'], '今夜の番組');
  eq(d.deadlines, ['今日 18:00 深夜テスト ふつおた（秋）'], '当日が締切のお題');
  eq(dg.time, '7:00', 'まとめの時刻の初期値は 7:00');
  ok(digest.isKaihenSeason(ymdToDay('2026-03-20')) && !digest.isKaihenSeason(ymdToDay('2026-04-01')) && digest.isKaihenSeason(ymdToDay('2026-09-15')), '改編期のお知らせの時期');
}

// 休止
occ = range('2026-11-08', '2026-11-09');
episodes.saveEpisode(occ[0], { status: 'cancelled' });
eq(range('2026-11-08', '2026-11-09')[0].status, 'cancelled', '休止が反映される');
eq(episodes.nowNext(instant(ymdToDay('2026-11-07'), 1560)).onAir.length, 0, '休止回は放送中にならない');

// 時間変更
const occ14 = range('2026-11-15', '2026-11-16')[0];
episodes.saveEpisode(occ14, { status: 'changed', overrideDate: '2026-11-20', overrideStart: '22:00', overrideEnd: '24:00' });
eq(range('2026-11-15', '2026-11-16').length, 0, '移動元には出ない');
eq(range('2026-11-20', '2026-11-21')[0].key, `s~${sch.id}~2026-11-14`, '移動先に出て、キーは変わらない');

// 特番
const sp = store.save('episodes', { programId: prog.id, scheduleId: null, date: '2026-12-31', overrideDate: '2026-12-31', overrideStart: '23:00', overrideEnd: '25:00', status: 'special', title: '年越し' });
eq(range('2026-12-31', '2027-01-01')[0].key, `e~${sp.id}`, '特番が表示される');

// 放送期間・アーカイブ・最終回（F-CHG-03）
const shortP = store.save('programs', { name: '期間限定', color: '#33B679', startDate: '2026-11-10', endDate: '2026-11-20' });
store.save('schedules', { programId: shortP.id, dtstart: '2026-11-01', start: '10:00', end: '11:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
eq(ymds(episodes.occurrences(instant(from), instant(to + 1), { programId: shortP.id }).map((o) => o.day)), ['2026-11-16'], '放送期間の外は出ない');
const finP = store.save('programs', { name: '最終回テスト', color: '#33B679' });
store.save('schedules', { programId: finP.id, dtstart: '2026-11-01', start: '10:00', end: '11:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
programsView.archiveProgram(store.get('programs', finP.id), '2026-11-10');
eq(ymds(episodes.occurrences(instant(from), instant(to + 1), { programId: finP.id }).map((o) => o.day)), ['2026-11-03', '2026-11-10'], '最終回より後の予定を外し、それまでの記録は残す');
ok(store.get('programs', finP.id).archived, '最終回にするとアーカイブへ移る');

// マーク
const marks = episodes.marksInRange(ymdToDay('2026-11-01'), ymdToDay('2026-11-30'));
ok((marks.get(ymdToDay('2026-11-07')) || []).some((m) => m.type === 'deadline'), '締切マーク');
ok([...marks.values()].flat().some((m) => m.type === 'catchup'), '聴取期限マーク');

// ---- メール・投稿履歴・ラジオネーム ----
store.save('templates', { radioName: '既定ネーム', signature: '東京都', body: '{番組名}のみなさん' });
let m1 = mail.buildMail({ program: prog, corner, contact });
eq(m1.subject, '深夜テスト ふつおた', '件名にコーナー名を挿入');
ok(m1.body.includes('ラジオネーム: 既定ネーム'), '既定のラジオネームを差し込む');
store.save('radioNames', { programId: prog.id, name: '番組用ネーム' });
m1 = mail.buildMail({ program: prog, corner, contact, body: 'ネタ本文' });
ok(m1.body.includes('ラジオネーム: 番組用ネーム') && !m1.body.includes('既定ネーム') && m1.body.includes('ネタ本文'), '番組ごとのラジオネームとネタ本文を差し込む');
mail.logPost({ program: prog, corner, route: 'mail', subject: m1.subject });
eq(store.all('postLogs').length, 1, '投稿を履歴に残す');
const log = store.all('postLogs')[0];
store.save('postLogs', { ...log, read: true, readDate: '2026-11-07', readTime: '25:30' });
eq(stats.adoption().map((r) => [r.corner?.name, r.posts, r.read]), [['ふつおた', 1, 1]], 'コーナー別の採用率');

// ---- 振り返り ----
{
  const occ21 = range('2026-11-22', '2026-11-23')[0];
  episodes.saveEpisode(occ21, { listened: true });
  const s = stats.monthStats({ y: 2026, m: 11 }, instant(ymdToDay('2026-12-01'), 600));
  eq([s.listened, s.posts, s.read], [1, 1, 1], '月ごとの聴いた数・投稿数・読まれた数');
  ok(s.missed >= 1, '聴き逃した回数');
  const st = stats.streaks(instant(ymdToDay('2026-11-24'), 600));
  eq(st.find((x) => x.program.id === prog.id)?.weeks, 1, '続けて聴いている週');
}

// ---- 共有ファイル（F-SHARE）----
{
  store.save('memos', { programId: prog.id, body: '個人的なメモ' });
  const file = share.buildShareFile([prog.id]);
  const text = JSON.stringify(file);
  ok(!text.includes('個人的なメモ') && !text.includes('番組用ネーム') && !text.includes('既定ネーム'), '共有ファイルにメモ・ラジオネームを含めない');
  eq(file.programs[0].contacts[0].corners, [0], '投稿先とコーナーの紐付けを保つ');
  const items = share.parseShareFile(JSON.parse(text));
  const added = share.importShareItem(items[0], 'add');
  ok(added.id !== prog.id && store.byProgram('corners', added.id).length === 1, '別の番組として追加');
  eq(store.byProgram('contacts', added.id)[0].cornerIds, [store.byProgram('corners', added.id)[0].id], '取り込んだ投稿先がコーナーに紐付く');
  store.removeProgram(added.id);
  const edited = JSON.parse(text);
  edited.programs[0].program.station = '新しい局';
  share.importShareItem(share.parseShareFile(edited)[0], 'overwrite');
  eq(store.get('programs', prog.id).station, '新しい局', '上書きで登録内容を置き換える');
  ok(store.byProgram('memos', prog.id).length === 1 && store.byProgram('postLogs', prog.id).length === 1, '上書きしてもメモと投稿履歴は残る');
  ok(store.get('schedules', sch.id) && store.get('channels', chan.id) && store.get('corners', corner.id), '内容が同じ放送枠・媒体・コーナーは作り直さない（休止や履歴の紐付けを保つ）');
  eq(store.get('contacts', contact.id)?.cornerIds, [corner.id], '投稿先とコーナーの紐付けも保つ');
  store.save('programs', { ...store.get('programs', prog.id), station: 'テスト放送' });
  let bad = null;
  try { share.parseShareFile({ app: 'x' }); } catch (e) { bad = e.message; }
  ok(bad, '共有ファイル以外は取り込まない');
}

// ---- 予定の組み立て ----
store.setSetting('syncCatchup', true);
let desired = gcal.buildDesired(instant(ymdToDay('2026-11-01')));
const series = desired.get(`sch:${sch.id}`);
eq(series.payload.summary, '深夜テスト（土25:00）', '予定のタイトルに深夜表記を添える');
eq(series.payload.start, { dateTime: '2026-11-08T01:00:00+09:00', timeZone: 'Asia/Tokyo' }, '実際の日時で登録');
eq(series.payload.recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=SU', '実際の曜日で繰り返す');
eq(series.payload.reminders.overrides.map((o) => o.minutes), [0, 15], '放送開始の通知');
const cu = [...desired.entries()].find(([k]) => k.startsWith('cu:'))[1];
eq(cu.payload.reminders.overrides, [], '聴取期限は初期設定では通知しない');
eq(cu.payload.end.dateTime, '2026-11-15T01:00:00+09:00', 'タイムフリーの期限は放送開始から7日');
ok(!desired.has(`dl:${corner.id}`), '締切は初期設定では個別の予定にしない');
store.save('corners', { ...store.get('corners', corner.id), individualNotify: true });
store.save('programs', { ...store.get('programs', prog.id), individualNotify: true });
desired = gcal.buildDesired(instant(ymdToDay('2026-11-01')));
eq(desired.get(`dl:${corner.id}`).payload.reminders.overrides.map((o) => o.minutes), [60, 1440], '個別通知にした締切は通知付きの予定');
eq([...desired.entries()].find(([k]) => k.startsWith('cu:'))[1].payload.reminders.overrides.map((o) => o.minutes), [1440], '個別通知の番組は聴取期限も通知');
store.save('corners', { ...store.get('corners', corner.id), individualNotify: false });
store.save('programs', { ...store.get('programs', prog.id), individualNotify: false, timefree: false, reminders: [] });
desired = gcal.buildDesired(instant(ymdToDay('2026-11-01')));
eq(desired.get(`sch:${sch.id}`).payload.reminders.overrides.map((o) => o.minutes), [0], 'タイムフリー非対応は通知を必ず入れる');
ok(![...desired.keys()].some((k) => k.startsWith('cu:')), 'タイムフリー非対応は聴取期限を作らない');
store.save('programs', { ...store.get('programs', prog.id), timefree: true, reminders: [15, 0] });
desired = gcal.buildDesired(instant(ymdToDay('2026-11-01')));
ok(desired.has(`task:${corner.id}`), '締切の ToDo');
ok(![...desired.keys()].some((k) => k.includes(shortP.id)), '放送期間外の番組の予定はない');
eq(desired.get(`sch:${store.byProgram('schedules', finP.id)[0].id}`).payload.recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261110T010000Z', '最終回の番組は UNTIL で止める');

// ---- GAS を通した同期（Code.gs は本物、Google のサービスだけ偽物）----
const FEED_URL = 'https://example.com/podcast.xml';
const now0 = Date.now();
const rfc = (ms) => new Date(ms).toUTCString();
let feedXml = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>テストポッドキャスト</title>
<item><title>第10回 本編</title><guid>ep10</guid><pubDate>${rfc(now0 - 3600000)}</pubDate><enclosure url="https://example.com/10.mp3" type="audio/mpeg"/><itunes:duration>1:02:00</itunes:duration></item>
<item><title>第9回 切り抜き</title><guid>ep9</guid><pubDate>${rfc(now0 - 2 * 3600000)}</pubDate><enclosure url="https://example.com/9.mp3" type="audio/mpeg"/></item>
<item><title>第1回 本編</title><guid>ep1</guid><pubDate>${rfc(now0 - 60 * 86400000)}</pubDate></item>
</channel></rss>`;
const ytPage = '<html><link rel="alternate" type="application/rss+xml" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv"></html>';
const ytFeed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>テストチャンネル</title>
<entry><id>yt:video:v1</id><yt:videoId>v1</yt:videoId><title>動画1</title><link rel="alternate" href="https://www.youtube.com/watch?v=v1"/><published>${new Date(now0 - 600000).toISOString()}</published></entry></feed>`;

function fakeGoogle() {
  const props = new Map();
  const g = { calendars: new Map(), events: new Map(), tasklists: new Map(), tasks: new Map(), files: [], folder: null, seq: 0, fail: null, mails: [], calls: [], triggers: [], web: {} };
  const nid = (p) => `${p}${++g.seq}`;
  const notFound = () => { throw new Error('Not Found'); };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const fileObj = (f) => ({
    getId: () => f.id, getName: () => f.name, getSize: () => f.data.length,
    getDateCreated: () => new Date(f.created), setTrashed: (v) => { f.trashed = v; },
    getBlob: () => ({ getDataAsString: () => f.data }),
    setContent: (t) => { f.data = t; }, setDescription: (d) => { f.desc = d; }, getDescription: () => f.desc || null,
  });
  const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => fileObj(list[i++]) }; };
  const folderObj = {
    getId: () => 'folder1', isTrashed: () => false,
    createFile: (name, data) => {
      const f = { id: nid('f'), name, data, created: Date.now() + g.seq, trashed: false };
      g.files.push(f);
      return fileObj(f);
    },
    getFiles: () => iter(g.files.filter((f) => !f.trashed)),
    getFilesByName: (name) => iter(g.files.filter((f) => !f.trashed && f.name === name)),
  };
  // XmlService は DOMParser で代用する
  const xmlEl = (node) => ({
    getName: () => node.localName,
    getNamespace: () => ({ uri: node.namespaceURI }),
    getChildren: (name, ns) => [...node.children].filter((c) => c.localName === name && (ns ? c.namespaceURI === ns.uri : !c.namespaceURI)).map(xmlEl),
    getChild(name, ns) { return this.getChildren(name, ns)[0] || null; },
    getText: () => node.textContent,
    getAttribute: (n) => (node.hasAttribute(n) ? { getValue: () => node.getAttribute(n) } : null),
  });
  const res = (url) => {
    const body = g.web[url];
    return { getResponseCode: () => (body == null ? 404 : 200), getContentText: () => body ?? 'not found' };
  };
  const chain = (rec) => new Proxy({}, { get: (_, k) => (k === 'create' ? () => { g.triggers.push(rec); return { getHandlerFunction: () => rec.name }; } : () => chain(rec)) });
  const env = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) },
    Utilities: {
      getUuid: () => `${nid('u')}-0123456789abcdef0123456789abcdef`,
      formatDate: (d, tz, fmt) => {
        const t = new Date(d.getTime() + 9 * 3600000).toISOString();
        if (fmt === 'yyyy-MM-dd') return t.slice(0, 10);
        if (fmt === 'yyyyMMdd-HHmmss') return `${t.slice(0, 10).replace(/-/g, '')}-${t.slice(11, 19).replace(/:/g, '')}${++g.seq}`;
        return t.slice(0, 19);
      },
    },
    Logger: { log() {} },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    MailApp: { sendEmail: (to, subject, body) => g.mails.push({ to, subject, body }) },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/dev' }),
      getProjectTriggers: () => g.triggers.map((t) => ({ getHandlerFunction: () => t.name })),
      newTrigger: (name) => chain({ name }),
      deleteTrigger: () => {},
    },
    DriveApp: {
      createFolder: () => { g.folder = folderObj; return folderObj; },
      getFolderById: () => g.folder || notFound(),
    },
    UrlFetchApp: { fetch: (url) => res(url), fetchAll: (reqs) => reqs.map((r) => res(r.url)) },
    XmlService: {
      parse: (text) => ({ getRootElement: () => xmlEl(new DOMParser().parseFromString(text, 'application/xml').documentElement) }),
      getNamespace: (prefix, uri) => ({ uri }),
    },
    Calendar: {
      Calendars: {
        get: (id) => g.calendars.get(id) || notFound(),
        insert: (b) => { const c = { ...b, id: nid('cal') }; g.calendars.set(c.id, c); return c; },
        remove: (id) => { g.calendars.delete(id); },
      },
      Events: {
        list: (cal, q) => {
          const key = q.privateExtendedProperty.split('=').slice(1).join('=');
          return { items: [...g.events.values()].filter((e) => e.cal === cal && e.extendedProperties.private.appKey === key) };
        },
        insert: (b, cal) => {
          if (g.fail && g.fail(b)) throw new Error('Rate Limit Exceeded');
          const e = { ...clone(b), id: nid('ev'), cal };
          g.events.set(e.id, e);
          g.calls.push('insert');
          return e;
        },
        update: (b, cal, id) => {
          if (!g.events.has(id)) notFound();
          const e = { ...clone(b), id, cal };
          g.events.set(id, e);
          g.calls.push('update');
          return e;
        },
        remove: (cal, id) => { if (!g.events.delete(id)) notFound(); g.calls.push('remove'); },
      },
    },
    Tasks: {
      Tasklists: {
        get: (id) => g.tasklists.get(id) || notFound(),
        insert: (b) => { const l = { ...b, id: nid('list') }; g.tasklists.set(l.id, l); return l; },
        remove: (id) => { g.tasklists.delete(id); },
      },
      Tasks: {
        list: () => ({ items: [...g.tasks.values()] }),
        insert: (b) => { const t = { ...b, id: nid('task') }; g.tasks.set(t.id, t); return t; },
        patch: (b, l, id) => { if (!g.tasks.has(id)) notFound(); const t = { ...g.tasks.get(id), ...b }; g.tasks.set(id, t); return t; },
        remove: (l, id) => { if (!g.tasks.delete(id)) notFound(); },
      },
    },
  };
  return { g, env };
}

const code = await (await fetch('../gas/Code.gs')).text();
const { g, env } = fakeGoogle();
g.web[FEED_URL] = feedXml;
g.web['https://www.youtube.com/@someone'] = ytPage;
g.web['https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv'] = ytFeed;
const names = Object.keys(env);
const gas = new Function(...names, `${code}\nreturn { doPost, setup, resetSecret, onHourly, onDaily };`)(...names.map((n) => env[n]));
gas.setup();
const secret = g.mails[0].body.match(/合言葉:\n(\w+)/)[1];
ok(secret.length >= 32, 'setup が合言葉を作って自分宛てに送る');
ok(!g.mails[0].body.includes('/dev'), 'setup のメールに /dev のURLを載せない');
eq(g.triggers.map((t) => t.name).sort(), ['onDaily', 'onHourly'], 'setup で定期処理を登録');
gas.setup();
eq(g.triggers.length, 2, 'setup を2回実行しても定期処理は増えない');

const realFetch = globalThis.fetch;
let online = true;
let requests = 0;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('script.google.com')) return realFetch(url, init);
  requests++;
  if (!online) throw new TypeError('Failed to fetch');
  const out = gas.doPost({ postData: { contents: init.body } });
  return new Response(out.text, { status: 200 });
};
const GAS_URL = 'https://script.google.com/macros/s/TEST/exec';

ok(sync.isValidGasUrl(GAS_URL), '連携URLの形式を受け付ける');
ok(sync.gasUrlProblem('https://script.google.com/macros/s/AKfy/dev').includes('/dev'), '/dev のURLは理由を説明する');
let badSecret = null;
await sync.connect(GAS_URL, 'wrong').catch((e) => { badSecret = e.message; });
ok(badSecret?.startsWith('合言葉が一致しません'), '合言葉が違えば接続できない');
ok(!sync.isLinked(), '失敗時は連携状態にならない');

let conn = await sync.connect(GAS_URL, secret);
eq(conn.backups.length, 0, '初回はバックアップなし');
eq(g.events.size, 0, '復元するか決めるまで予定は送らない');
await sync.finishConnect({ restoreId: null });
eq(store.getSetting('gasVersion'), 2, 'GAS の版を記録');
eq(g.calendars.size, 1, '専用カレンダーを1つだけ作る');
eq([...g.calendars.values()][0].summary, 'ラジオ番組', 'カレンダー名');
const desiredEvents = [...gcal.buildDesired().values()].filter((d) => d.kind === 'event').length;
eq([...g.events.values()].filter((e) => !e.extendedProperties.private.appKey.startsWith('sum:')).length, desiredEvents, '全予定が登録される');
eq(sync.syncStatus().pending, 0, '未送信なし');
eq(g.files.filter((f) => f.name.startsWith('backup-')).length, 1, '連携後にバックアップ');

// 変更がなければ送らない
const before = requests;
await sync.syncNow();
eq(requests, before, '差分がなければ通信しない');

// 更新
g.calls.length = 0;
store.save('schedules', { ...store.get('schedules', sch.id), start: '26:00', end: '28:00' });
await sync.syncNow();
ok(g.calls.includes('update') && !g.calls.includes('insert'), '時刻変更は更新のみで二重登録しない');
const evOf = (key) => [...g.events.values()].find((e) => e.extendedProperties.private.appKey === key);
eq(evOf(`sch:${sch.id}`).start.dateTime, '2026-11-08T02:00:00+09:00', 'Google の予定が新しい時刻になる');
eq(evOf(`sch:${sch.id}`).summary, '深夜テスト（土26:00）', 'タイトルの深夜表記も更新');

// 番組単位で対象外 → 消える
store.save('programs', { ...store.get('programs', prog.id), syncEnabled: false });
await sync.syncNow();
ok(!evOf(`sch:${sch.id}`), '番組を対象外にすると予定が消える');
store.save('programs', { ...store.get('programs', prog.id), syncEnabled: true });
await sync.syncNow();
ok(evOf(`sch:${sch.id}`), '対象に戻すと予定が戻る');

// オフライン
online = false;
const e0 = g.events.size;
const off = store.save('programs', { name: 'オフライン追加', color: '#D50000', reminders: [5] });
store.save('schedules', { programId: off.id, dtstart: '2026-11-01', start: '9:00', end: '10:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
await sync.syncNow();
ok(sync.syncStatus().pending === 1 && sync.syncStatus().failed === 1, '通信できないときはキューに残り失敗件数に出る');
online = true;
await sync.syncNow();
eq(sync.syncStatus().pending, 0, '通信が戻ると送信される');
eq(g.events.size, e0 + 1, '再送で1件だけ増える');

// 新着の自動検知（F-FEED）
const feedChan = store.save('channels', { programId: prog.id, mediaType: 'podcast', station: 'テストポッドキャスト', rssUrl: FEED_URL, rssKind: 'podcast', feedExclude: ['切り抜き'], feedCalendar: true });
await sync.syncNow();
let items = store.byProgram('feedItems', prog.id);
eq(items.map((i) => i.title), ['第10回 本編'], '新しい回だけ検知し、除く語の回と古い回は入れない');
eq([items[0].duration, items[0].audioUrl], [62, 'https://example.com/10.mp3'], '再生時間と音声ファイルを保存');
const feedEv = [...g.events.values()].find((e) => e.extendedProperties.private.appKey.startsWith('feed:'));
ok(feedEv && feedEv.reminders.overrides.length === 0, '新着の回を通知なしの予定として登録');
eq(episodes.unheardFeedItems().length, 1, '未聴リストに新着の回');
g.web[FEED_URL] = feedXml.replace('<item>', `<item><title>第11回 本編</title><guid>ep11</guid><pubDate>${rfc(Date.now())}</pubDate></item><item>`);
gas.onHourly();
store.setSetting('feedPullCheckedAt', 0);
await sync.syncNow();
eq(store.byProgram('feedItems', prog.id).map((i) => i.title).sort(), ['第10回 本編', '第11回 本編'], '1時間ごとの確認で次の回を検知');
const firstItem = store.byProgram('feedItems', prog.id).find((i) => i.title === '第10回 本編');
store.save('feedItems', { ...firstItem, listened: true });
gas.onHourly();
store.setSetting('feedPullCheckedAt', 0);
await sync.syncNow();
ok(store.get('feedItems', firstItem.id).listened, '再取得しても聴取済みの記録は保つ');
g.web[FEED_URL] = null;
gas.onHourly(); gas.onHourly(); gas.onHourly();
store.setSetting('feedPullCheckedAt', 0);
await sync.syncNow();
ok(sync.syncStatus().feedErrors[0]?.failStreak >= 3, 'RSS の確認の失敗を設定画面に出す');
g.web[FEED_URL] = feedXml;
const resolved = await sync.resolveFeed('https://www.youtube.com/@someone');
eq([resolved.feedUrl, resolved.kind, resolved.title], ['https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv', 'youtube', 'テストチャンネル'], 'YouTube のチャンネルページから RSS を求める');

// 今日のまとめ（GAS 側で予定を作る）
{
  const tomorrow = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
  await sync.callGas('setDigest', { digest: { time: '7:00', enabled: true, days: { [tomorrow]: { tonight: ['25:00 深夜テスト'], deadlines: ['明日 18:00 深夜テスト ふつおた'], expiring: [], notes: [] } } } });
  const sum = evOf(`sum:${tomorrow}`);
  ok(sum && sum.summary.startsWith('今日のまとめ（番組1・締切1'), '明日の朝のまとめの予定を作る');
  eq(sum.start.dateTime, `${tomorrow}T07:00:00+09:00`, 'まとめは設定した時刻');
  eq(sum.reminders.overrides.map((o) => o.minutes), [0], 'まとめは時刻ちょうどに1回だけ通知');
  ok(sum.description.includes('▼今夜の番組') && sum.description.includes('25:00 深夜テスト'), 'まとめの本文');
  ok(sum.description.includes('RSS の確認に3回続けて失敗'), '3回続けて失敗したらまとめで知らせる');
  const count = g.events.size;
  await sync.callGas('setDigest', { digest: { time: '7:00', enabled: true, days: { [tomorrow]: { tonight: ['25:00 深夜テスト'], deadlines: [], expiring: [], notes: [] } } } });
  eq(g.events.size, count, 'まとめを更新しても予定は1日1件');
  await sync.callGas('setDigest', { digest: { time: '7:00', enabled: false, days: {} } });
  ok(!evOf(`sum:${tomorrow}`) || ![...g.events.values()].some((e) => e.id === sum.id), 'まとめを止めると予定を消す');
}

// 通知テスト（F-NTF-02）
const t1 = await sync.testNotification(3);
const testEv = [...g.events.values()].find((e) => e.extendedProperties.private.appKey.startsWith('test:'));
ok(testEv && Math.abs(Date.parse(testEv.start.dateTime) - t1.at) < 1000, '通知テストの予定を数分後に入れる');
await sync.testNotification(3);
eq([...g.events.values()].filter((e) => e.extendedProperties.private.appKey.startsWith('test:')).length, 1, '通知テストの予定は1件だけ残す');

// バックアップ・復元・元に戻す（F-MIG）
const bk = await sync.backupToDrive();
const bkFile = g.files.find((f) => f.id === bk.id);
const saved = JSON.parse(bkFile.data);
ok(!JSON.stringify(saved).includes(secret) && !JSON.stringify(saved).includes('script.google.com'), 'バックアップに合言葉と連携URLを含めない');
eq(saved.version, 2, 'バックアップに版数');
for (const t of ['postLogs', 'radioNames', 'feedItems', 'memos', 'episodes']) ok(saved.tables[t].length > 0, `バックアップに${t}を含める`);
ok(saved.tables.programs.some((p) => p.archived), 'バックアップにアーカイブ番組を含める');
const meta = JSON.parse(bkFile.desc);
eq([meta.type, meta.counts.programs, meta.counts.postLogs], ['regular', store.all('programs').length, 1], 'バックアップ情報に件数の内訳');
const listed = (await sync.listDriveBackups()).backups;
eq(listed[0].meta.counts.memos, 1, '一覧で件数を確かめられる');

const programsBefore = store.all('programs').length;
store.save('programs', { name: '復元で消える番組', color: '#D50000' });
const filesBefore = g.files.length;
await sync.restoreFromDrive(bk.id);
eq(store.all('programs').length, programsBefore, '復元で件数がバックアップ元と一致');
ok(g.files.slice(filesBefore).some((f) => JSON.parse(f.desc).type === 'pre-overwrite'), '上書き前の状態をドライブにも残す');
const snaps = await store.listSnapshots();
eq(snaps[0].reason, 'ドライブから復元する前', '上書き前の控えを端末内に残す');
const dup = g.events.size;
await sync.syncNow();
eq(g.events.size, dup, '復元後の同期で予定が重複しない');
await sync.undoToSnapshot(snaps[0].key);
ok(store.all('programs').some((p) => p.name === '復元で消える番組'), '「元に戻す」で復元前に戻せる');
eq(g.events.size, dup, '元に戻しても予定は重複しない');

// 古い版のバックアップを読み込める（F-MIG-09）
await sync.replaceAllData({ app: 'radio-calendar', version: 1, tables: { programs: [{ id: 'old1', name: '版1の番組', hashtag: '#v1', color: '#D50000' }], schedules: [{ id: 'olds', programId: 'old1', dtstart: '2026-11-03', start: '1:00', end: '2:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' }] }, settings: {} }, 'テスト');
eq(store.all('programs').map((p) => [p.name, p.hashtags]), [['版1の番組', ['#v1']]], '版1のファイルを版2として読み込む');
eq(store.get('schedules', 'olds').start, '25:00', '版1の深夜番組を深夜表記に直して読み込む');
let badImport = null;
await sync.replaceAllData({ foo: 1 }, 'テスト').catch((e) => { badImport = e.message; });
ok(badImport && store.all('programs').length === 1, '不正なファイルは読み込まず、データも消さない');
await sync.undoToSnapshot((await store.listSnapshots())[0].key);
ok(store.get('programs', prog.id), '元に戻して元のデータに戻る');

// 新しい端末での連携（F-MIG-03）
conn = await sync.connect(GAS_URL, secret);
ok(conn.backups.length >= 1 && conn.backups.every((b) => b.meta.type !== 'pre-overwrite'), '連携時に定期バックアップを見つける');

// 機種変更用の連携コード（F-MIG-05）
const codeText = sync.linkCode();
eq(sync.parseLinkCode(` ${codeText}\n`), { url: GAS_URL, secret }, '連携コードから URL と合言葉を戻せる');
eq(sync.parseLinkCode('RCLINK1.abc'), null, '壊れた連携コードは拒否');

// 合言葉の再発行（F-GGL-09）
const newSecret = await sync.rotateSecret();
ok(newSecret !== secret && store.getSetting('gasSecret') === newSecret, '合言葉を再発行して端末を切り替える');
let oldFails = null;
await sync.callGas('info', {}, { url: GAS_URL, secret }).catch((e) => { oldFails = e.message; });
ok(oldFails?.startsWith('合言葉が一致しません'), '古い合言葉はすぐ使えない');

// 世代整理（F-MIG-06）
{
  const day = 86400000;
  const nowMs = Date.now();
  g.files.filter((f) => f.name.startsWith('backup-')).forEach((f) => { f.trashed = true; });
  const mk = (ageDays, type = 'regular') => g.files.push({ id: `old${g.seq++}`, name: `backup-x${g.seq}.json`, data: '{}', created: nowMs - ageDays * day, trashed: false, desc: JSON.stringify({ type }) });
  mk(0.1); mk(0.2); mk(2.1); mk(2.2); mk(10); mk(31); mk(5, 'pre-overwrite'); mk(40, 'pre-overwrite');
  gas.onDaily();
  const left = g.files.filter((f) => f.name.startsWith('backup-x') && !f.trashed).map((f) => Math.round((nowMs - f.created) / day * 10) / 10).sort((a, b) => a - b);
  eq(left, [0.1, 0.2, 2.1, 5, 10], '直近はすべて、それ以前は1日1件、30日より前は削除');
}

// 解除
await sync.disconnect({ deleteCalendar: true });
eq(g.calendars.size, 0, '解除時にカレンダーを削除');
eq(sync.isLinked(), false, '解除で連携情報を消す');
gas.resetSecret();
ok(g.mails.at(-1).subject.includes('再発行') && g.mails.at(-1).body.match(/合言葉:\n(\w+)/)[1] !== newSecret, 'GAS の画面から合言葉を再発行できる（前の端末がないとき）');
globalThis.fetch = realFetch;

// ---- 性能：番組 200 件・放送枠 500 件 ----
for (let i = 0; i < 200; i++) {
  const p = store.save('programs', { name: `番組${i}`, color: '#039BE5' }, { silent: true });
  for (let j = 0; j < (i < 100 ? 3 : 2); j++) {
    store.save('schedules', { programId: p.id, dtstart: '2026-01-01', start: `${5 + ((i + j) % 23)}:00`, end: `${6 + ((i + j) % 23)}:00`, rrule: `FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][(i + j) % 7]}` }, { silent: true });
  }
}
const t0 = performance.now();
const big = episodes.occurrences(instant(ymdToDay('2026-11-01')), instant(ymdToDay('2026-12-06')));
episodes.marksInRange(ymdToDay('2026-11-01'), ymdToDay('2026-12-05'));
const elapsed = performance.now() - t0;
ok(big.length > 2000, `番組200・放送枠500の月計算（${big.length}回）`);
ok(elapsed < 300, `月の計算が 300ms 未満（実測 ${Math.round(elapsed)}ms）`);
const t1d = performance.now();
digest.buildDigest();
ok(performance.now() - t1d < 1500, `今日のまとめ14日分の計算が 1.5 秒未満（実測 ${Math.round(performance.now() - t1d)}ms）`);
await tick();

// ---- 結果 ----
const failed = results.filter((r) => !r.ok);
const out = document.getElementById('out');
for (const r of results) {
  const li = document.createElement('li');
  li.className = r.ok ? 'ok' : 'ng';
  li.textContent = r.ok ? r.name : `${r.name}\n${r.detail}`;
  out.append(li);
}
document.getElementById('summary').textContent = failed.length ? `失敗 ${failed.length} / ${results.length}` : `すべて成功 ${results.length} 件`;
globalThis.__TEST_RESULT__ = { total: results.length, failed: failed.map((r) => `${r.name}: ${r.detail}`), elapsed: Math.round(elapsed) };
