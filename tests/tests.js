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

await store.initStore();

// ---- 時刻 ----
eq(parseHM('25:00'), 1500, '25:00 は 1500 分');
eq(parseHM('2530'), 1530, '4桁入力 2530');
eq(parseHM('29:59'), 1799, '29:59');
eq(parseHM('7'), 420, '時だけの入力');
eq(parseHM('25:60'), null, '不正な分は null');
eq(parseHM('abc'), null, '文字は null');
eq(fmtHM(1500), '25:00', '25:00 表示');
const sat25 = instant(ymdToDay('2026-11-07'), 1500);
eq(new Date(sat25).toISOString(), '2026-11-07T16:00:00.000Z', '土曜 25:00 = 日曜 1:00 JST = 土曜 16:00 UTC');
eq(dayToYmd(jstDay(sat25)), '2026-11-08', '実際の日付は翌日');
eq(jstMin(sat25), 60, '実際の時刻は 1:00');
eq(dayToYmd(logicalDay(sat25, 300)), '2026-11-07', '区切り 5:00 なら前日扱い');
eq(logicalMin(sat25, 300), 1500, '区切り 5:00 なら 25:00');
eq(dayToYmd(logicalDay(sat25, 0)), '2026-11-08', '区切り 0:00 なら当日');
eq(logicalMin(sat25, 0), 60, '区切り 0:00 なら 1:00');
eq(isoJst(sat25), '2026-11-08T01:00:00+09:00', 'ISO 文字列');

// ---- RRULE 展開 ----
const from = ymdToDay('2026-11-01');
const to = ymdToDay('2026-11-30');
eq(ymds(expand({ dtstart: '2026-11-01', rrule: buildRRule({ repeat: 'weekly', days: [6] }) }, from, to)),
  ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'], '毎週土曜');
eq(ymds(expand({ dtstart: '2026-11-10', rrule: 'FREQ=WEEKLY;BYDAY=SA' }, from, to)),
  ['2026-11-14', '2026-11-21', '2026-11-28'], '開始日より前は出ない');
eq(ymds(expand({ dtstart: '2026-11-07', rrule: buildRRule({ repeat: 'biweekly', days: [6] }) }, from, to)),
  ['2026-11-07', '2026-11-21'], '隔週土曜');
eq(ymds(expand({ dtstart: '2026-11-02', rrule: buildRRule({ repeat: 'biweekly', days: [1, 5] }) }, from, to)),
  ['2026-11-02', '2026-11-06', '2026-11-16', '2026-11-20', '2026-11-30'], '隔週の複数曜日');
eq(ymds(expand({ dtstart: '2026-01-01', rrule: buildRRule({ repeat: 'monthly', days: [6], nths: [2] }) }, from, to)),
  ['2026-11-14'], '毎月第2土曜');
eq(ymds(expand({ dtstart: '2026-01-01', rrule: buildRRule({ repeat: 'monthly', days: [1], nths: [-1] }) }, from, to)),
  ['2026-11-30'], '毎月最終月曜');
eq(ymds(expand({ dtstart: '2026-01-01', rrule: buildRRule({ repeat: 'monthly', days: [0], nths: [5] }) }, from, to)),
  ['2026-11-29'], '第5日曜');
eq(ymds(expand({ dtstart: '2026-11-15', rrule: '' }, from, to)), ['2026-11-15'], '単発');
eq(rruleToForm(buildRRule({ repeat: 'monthly', days: [6], nths: [2, 4] })), { repeat: 'monthly', days: [6], nths: [2, 4] }, 'RRULE とフォームの往復');
eq(rruleToForm('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), { repeat: 'biweekly', days: [1], nths: [] }, '隔週のフォーム復元');
eq(describeSchedule({ dtstart: '2026-11-07', rrule: 'FREQ=WEEKLY;BYDAY=SA', start: '25:00', end: '27:00' }), '毎週 土曜 25:00〜27:00', '放送枠の説明文');

// ---- Google へ送る繰り返し ----
const H = ymdToDay('2029-01-01');
{
  const r = googleSeries({ dtstart: '2026-11-01', rrule: 'FREQ=WEEKLY;BYDAY=SA' }, { offsetMin: 1500, horizonDay: H });
  eq(r.lines, ['RRULE:FREQ=WEEKLY;BYDAY=SU'], '土曜25時の予定は日曜の繰り返し');
  eq(dayToYmd(r.firstDay), '2026-11-07', '初回は番組表上の土曜');
}
{
  const r = googleSeries({ dtstart: '2026-11-01', rrule: 'FREQ=WEEKLY;BYDAY=SA' }, { offsetMin: 1320, horizonDay: H });
  eq(r.lines, ['RRULE:FREQ=WEEKLY;BYDAY=SA'], '22時は曜日をずらさない');
}
{
  const r = googleSeries({ dtstart: '2026-11-07', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA' }, { offsetMin: 1500, horizonDay: H });
  eq(r.lines, ['RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=SU'], '隔週の週の区切りも一緒にずらす');
}
{
  const r = googleSeries({ dtstart: '2026-01-01', rrule: 'FREQ=MONTHLY;BYDAY=2SA' }, { offsetMin: 1500, horizonDay: H });
  eq(r.lines, ['RRULE:FREQ=MONTHLY;BYDAY=SU;BYMONTHDAY=9,10,11,12,13,14,15'], '第2土曜25時は 9〜15日の日曜');
}
{
  const r = googleSeries({ dtstart: '2026-11-01', rrule: 'FREQ=MONTHLY;BYDAY=-1SA' }, { offsetMin: 1500, horizonDay: ymdToDay('2027-03-01') });
  eq(dayToYmd(r.firstDay), '2026-11-28', '最終土曜の初回');
  eq(r.lines, ['RDATE;TZID=Asia/Tokyo:20261227T010000,20270131T010000,20270228T010000'], '月またぎの可能性があれば日付を列挙');
}
{
  const r = googleSeries({ dtstart: '2026-11-01', rrule: 'FREQ=WEEKLY;BYDAY=SA' }, { offsetMin: 1500, exDays: [ymdToDay('2026-11-14')], endDay: ymdToDay('2027-03-27'), horizonDay: H });
  eq(r.lines, ['RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20270327T160000Z', 'EXDATE;TZID=Asia/Tokyo:20261115T010000'], '休止は実際の日時で除外、放送期間は UNTIL');
}
eq(googleSeries({ dtstart: '2026-11-15', rrule: '' }, { offsetMin: 600, exDays: [ymdToDay('2026-11-15')], horizonDay: H }), null, '単発が休止なら予定を作らない');
eq(googleSeries({ dtstart: '2026-11-01', rrule: 'FREQ=WEEKLY;BYDAY=SA' }, { offsetMin: 600, endDay: ymdToDay('2026-10-01'), horizonDay: H }), null, '放送期間外なら予定を作らない');

// ---- 入力検証 ----
ok(domain.isEmail('a.b+c@example.co.jp'), 'メール形式 正常');
ok(!domain.isEmail('foo@bar'), 'メール形式 ドメイン不正');
ok(!domain.isEmail('foo bar@example.com'), 'メール形式 空白');
eq(domain.safeUrl('javascript:alert(1)'), null, 'javascript: を拒否');
eq(domain.safeUrl('JavaScript:alert(1)'), null, '大文字の javascript: を拒否');
eq(domain.safeUrl('https://radiko.jp/'), 'https://radiko.jp/', 'https は許可');
eq(domain.safeUrl('radiko://x'), 'radiko://x', 'アプリ用スキームは許可');
eq(domain.safeUrl('radiko.jp'), null, 'スキームなしは拒否');

// ---- 放送回の計算 ----
const prog = store.save('programs', { name: '深夜テスト', station: 'テスト放送', color: '#3F51B5', reminders: [15, 0], createdAt: instant(ymdToDay('2026-01-01')) });
const sch = store.save('schedules', { programId: prog.id, dtstart: '2026-11-01', start: '25:00', end: '27:00', rrule: 'FREQ=WEEKLY;BYDAY=SA', tz: 'Asia/Tokyo' });
store.save('channels', { programId: prog.id, mediaType: 'net', station: 'radiko', url: 'https://radiko.jp/x', catchupDays: 7, offsetMin: 0 });
const corner = store.save('corners', { programId: prog.id, name: 'ふつおた', status: 'active', deadline: '2026-11-07T18:00', topic: '秋' });
const contact = store.save('contacts', { programId: prog.id, type: 'email', label: '番組宛', value: 'test@example.com', cornerIds: [corner.id] });

const range = (a, b) => episodes.occurrences(instant(ymdToDay(a)), instant(ymdToDay(b)));
let occ = range('2026-11-08', '2026-11-09');
eq(occ.length, 1, '日曜の実時刻で検索すると土曜25時の回が出る');
eq(occ[0].key, `s~${sch.id}~2026-11-07`, '放送回キーは番組表上の日');
eq(isoJst(occ[0].startMs), '2026-11-08T01:00:00+09:00', '開始は実時刻で日曜 1:00');
eq(isoJst(occ[0].endMs), '2026-11-08T03:00:00+09:00', '終了は実時刻で日曜 3:00');

const { onAir, next } = episodes.nowNext(instant(ymdToDay('2026-11-07'), 1560));
eq(onAir.length, 1, '放送中を検出');
eq(dayToYmd(next.day), '2026-11-14', '次の放送を検出');

// 休止
episodes.saveEpisode(occ[0], { status: 'cancelled' });
occ = range('2026-11-08', '2026-11-09');
eq(occ[0].status, 'cancelled', '休止が反映される');
eq(dayToYmd(episodes.nowNext(instant(ymdToDay('2026-11-07'), 1560)).next.day), '2026-11-14', '休止回は次の放送にならない');
eq(episodes.nowNext(instant(ymdToDay('2026-11-07'), 1560)).onAir.length, 0, '休止回は放送中にならない');

// 時間変更：別の日へ移動しても移動先で見える
const occ14 = range('2026-11-15', '2026-11-16')[0];
episodes.saveEpisode(occ14, { status: 'changed', overrideDate: '2026-11-20', overrideStart: '22:00', overrideEnd: '24:00' });
eq(range('2026-11-15', '2026-11-16').length, 0, '移動元には出ない');
const moved = range('2026-11-20', '2026-11-21');
eq(moved.length, 1, '移動先に出る');
eq(moved[0].key, `s~${sch.id}~2026-11-14`, '移動してもキーは変わらない');
eq(episodes.occurrenceByKey(moved[0].key).startMin, 1320, 'キーから変更後の時刻を復元');

// 特番（放送枠なし）
const sp = store.save('episodes', { programId: prog.id, scheduleId: null, date: '2026-12-31', overrideDate: '2026-12-31', overrideStart: '23:00', overrideEnd: '25:00', status: 'special', title: '年越し' });
const spOcc = range('2026-12-31', '2027-01-01')[0];
eq(spOcc.key, `e~${sp.id}`, '特番が表示される');
eq(episodes.occurrenceByKey(spOcc.key).title, '年越し', '特番のキー復元');

// 放送期間
const shortP = store.save('programs', { name: '期間限定', color: '#33B679', startDate: '2026-11-10', endDate: '2026-11-20' });
store.save('schedules', { programId: shortP.id, dtstart: '2026-11-01', start: '10:00', end: '11:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
eq(ymds(episodes.occurrences(instant(from), instant(to + 1), { programId: shortP.id }).map((o) => o.day)), ['2026-11-16'], '放送期間の外は出ない');

// アーカイブ
store.save('programs', { ...store.get('programs', shortP.id), archived: true });
eq(episodes.occurrences(instant(from), instant(to + 1), { programId: shortP.id }).length, 0, 'アーカイブは表示しない');

// マーク
const marks = episodes.marksInRange(ymdToDay('2026-11-01'), ymdToDay('2026-11-30'));
ok((marks.get(ymdToDay('2026-11-07')) || []).some((m) => m.type === 'deadline'), '締切マーク');
ok([...marks.values()].flat().some((m) => m.type === 'catchup'), '聴き逃し期限マーク');

// ---- メール ----
const m1 = mail.buildMail({ program: prog, corner, contact }, { radioName: 'テスト太郎', signature: '東京都', body: '{番組名}のみなさん' });
eq(m1.subject, '深夜テスト ふつおた', '件名にコーナー名を挿入');
ok(m1.body.includes('深夜テストのみなさん') && m1.body.includes('ラジオネーム: テスト太郎') && m1.body.includes('東京都'), '本文にテンプレートを差し込み');
eq(mail.buildMail({ program: prog, contact: { value: 'a@b.jp' } }, null).subject, '深夜テスト', 'コーナーなしの件名');
ok(mail.gmailAppUrl({ to: 'a@b.jp', subject: '件名 テスト', body: '' }).startsWith('googlegmail://co?to=a%40b.jp&subject=%E4%BB%B6'), 'Gmail アプリの URL');
ok(mail.mailtoUrl({ to: 'a@b.jp', subject: 'x', body: 'y' }).startsWith('mailto:a%40b.jp?'), 'mailto の URL');

// ---- 予定の組み立て ----
store.setSetting('syncCatchup', true);
let desired = gcal.buildDesired(instant(ymdToDay('2026-11-01')));
const series = desired.get(`sch:${sch.id}`);
ok(series, '放送枠の予定がある');
eq(series.payload.start, { dateTime: '2026-11-08T01:00:00+09:00', timeZone: 'Asia/Tokyo' }, '予定の開始にタイムゾーンを付ける');
eq(series.payload.colorId, '9', '番組カラーを Google の色に変換');
eq(series.payload.reminders.overrides.map((o) => o.minutes), [0, 15], '通知を登録');
ok(series.payload.description.includes('https://radiko.jp/x') && series.payload.description.includes('ふつおた') && series.payload.description.includes('test@example.com'), '説明欄に URL・コーナー・投稿先');
eq(series.payload.recurrence[1], 'EXDATE;TZID=Asia/Tokyo:20261108T010000,20261115T010000', '休止と時間変更の回を除外');
ok([...desired.keys()].some((k) => k.startsWith('ep:')), '時間変更の回は個別の予定');
ok([...desired.values()].some((d) => d.payload.summary?.startsWith('【特番】')), '特番の予定');
ok(desired.has(`task:${corner.id}`), '締切の ToDo');
eq(desired.get(`task:${corner.id}`).payload.due, '2026-11-07T00:00:00.000Z', 'ToDo の期限日');
ok([...desired.keys()].some((k) => k.startsWith('cu:')), '聴き逃し期限の予定');
ok(![...desired.keys()].some((k) => k.includes(shortP.id)), 'アーカイブ番組は同期しない');
const cu = [...desired.entries()].find(([k]) => k.startsWith('cu:'))[1];
eq(cu.payload.end.dateTime, '2026-11-15T03:00:00+09:00', '聴き逃し期限は放送終了の7日後');
eq(cu.payload.recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=SU', '聴き逃し期限も実際の曜日で繰り返す');

// ---- GAS を通した同期（Code.gs は本物、Google のサービスだけ偽物）----
function fakeGoogle() {
  const props = new Map();
  const g = { calendars: new Map(), events: new Map(), tasklists: new Map(), tasks: new Map(), files: [], folder: null, seq: 0, fail: null, mails: [], calls: [] };
  const nid = (p) => `${p}${++g.seq}`;
  const notFound = () => { throw new Error('Not Found'); };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const folderObj = {
    getId: () => 'folder1', isTrashed: () => false,
    createFile: (name, data) => {
      const f = { id: nid('f'), name, data, created: Date.now() + g.seq, trashed: false };
      g.files.push(f);
      return fileObj(f);
    },
    getFiles: () => {
      const live = g.files.filter((f) => !f.trashed);
      let i = 0;
      return { hasNext: () => i < live.length, next: () => fileObj(live[i++]) };
    },
  };
  const fileObj = (f) => ({
    getId: () => f.id, getName: () => f.name, getSize: () => f.data.length,
    getDateCreated: () => new Date(f.created), setTrashed: (v) => { f.trashed = v; },
    getBlob: () => ({ getDataAsString: () => f.data }),
  });
  const env = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) },
    Utilities: { getUuid: () => `${nid('u')}-0123456789abcdef0123456789abcdef`,formatDate: () => `stamp${++g.seq}` },
    Logger: { log() {} },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    MailApp: { sendEmail: (to, subject, body) => g.mails.push({ to, subject, body }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
    DriveApp: {
      createFolder: () => { g.folder = folderObj; return folderObj; },
      getFolderById: () => g.folder || notFound(),
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
const names = Object.keys(env);
const gas = new Function(...names, `${code}\nreturn { doPost, setup };`)(...names.map((n) => env[n]));
gas.setup();
const secret = g.mails[0].body.match(/合言葉:\n(\w+)/)[1];
ok(secret.length >= 32, 'setup が合言葉を作って自分宛てに送る');
eq(g.mails[0].to, 'me@example.com', '連携情報は自分宛て');

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
ok(!sync.isValidGasUrl('https://evil.example.com/exec'), '他のドメインは拒否');
ok(sync.isValidGasUrl('https://script.google.com/a/macros/example.co.jp/s/AKfy_cb-1/exec'), 'Workspace のURLを受け付ける');
ok(sync.isValidGasUrl(' https://script.google.com/macros/s/AKfy\n_cb-1/exec '), '改行や空白が混ざっても受け付ける');
eq(sync.gasUrlProblem('https://script.google.com/macros/s/AKfy/exec'), null, '正しいURLは問題なし');
ok(sync.gasUrlProblem('https://script.google.com/macros/s/AKfy/dev').includes('/dev'), '/dev のURLは理由を説明する');
ok(sync.gasUrlProblem('https://script.google.com/u/0/home/projects/abc/edit').includes('エディタ'), 'エディタのURLは理由を説明する');
ok(sync.gasUrlProblem(''), '空のURLは拒否');
eq(sync.cleanCredential(' ab\ncd '), 'abcd', '合言葉の改行や空白を除去');
{
  const original = globalThis.fetch;
  let msg = null;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await sync.callGas('connect', {}, { url: GAS_URL, secret: 'x' }).catch((e) => { msg = e.message; });
  ok(msg?.includes('全員'), '接続できないときは公開設定の確認を案内');
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'Calendar is not defined' }));
  await sync.callGas('connect', {}, { url: GAS_URL, secret: 'x' }).catch((e) => { msg = e.message; });
  ok(msg?.includes('appsscript.json'), 'Calendar が未定義なら manifest の確認を案内');
  globalThis.fetch = original;
}
let badSecret = null;
await sync.connect(GAS_URL, 'wrong').catch((e) => { badSecret = e.message; });
ok(badSecret?.startsWith('合言葉が一致しません'), '合言葉が違えば接続できない');
ok(!sync.isLinked(), '失敗時は連携状態にならない');

await sync.connect(GAS_URL, secret);
eq(g.calendars.size, 1, '専用カレンダーを1つだけ作る');
const cal = [...g.calendars.values()][0];
eq(cal.summary, 'ラジオ番組', 'カレンダー名');
eq(cal.timeZone, 'Asia/Tokyo', 'カレンダーのタイムゾーン');
const desiredEvents = [...gcal.buildDesired().values()].filter((d) => d.kind === 'event').length;
eq(g.events.size, desiredEvents, '全予定が登録される');
eq(g.tasks.size, 1, '締切の ToDo が登録される');
eq(sync.syncStatus().pending, 0, '未送信なし');
ok(sync.syncStatus().lastSyncAt, '最終同期日時が記録される');

// 変更がなければ送らない
g.calls.length = 0;
const before = requests;
await sync.syncNow();
eq(requests, before, '差分がなければ通信しない');

// 更新：放送枠の時刻変更は1件の update になる
store.save('schedules', { ...store.get('schedules', sch.id), start: '26:00', end: '28:00' });
await sync.syncNow();
ok(g.calls.includes('update') && !g.calls.includes('insert'), '時刻変更は更新のみで二重登録しない');
const updated = [...g.events.values()].find((e) => e.extendedProperties.private.appKey === `sch:${sch.id}`);
eq(updated.start.dateTime, '2026-11-08T02:00:00+09:00', 'Google の予定が新しい時刻になる');

// 休止：EXDATE が増えるだけ
const occ21 = range('2026-11-22', '2026-11-23')[0];
episodes.saveEpisode(occ21, { status: 'cancelled' });
await sync.syncNow();
ok(updated && [...g.events.values()].find((e) => e.extendedProperties.private.appKey === `sch:${sch.id}`).recurrence[1].includes('20261122T020000'), '休止回をその回だけ除外');

// 番組単位で対象外にすると消える
g.calls.length = 0;
store.save('programs', { ...store.get('programs', prog.id), syncEnabled: false });
await sync.syncNow();
eq(g.events.size, 0, '番組を対象外にすると予定が消える');
store.save('programs', { ...store.get('programs', prog.id), syncEnabled: true });
await sync.syncNow();
ok(g.events.size > 0, '対象に戻すと予定が戻る');

// オフライン
online = false;
const e0 = g.events.size;
const off = store.save('programs', { name: 'オフライン追加', color: '#D50000', reminders: [5] });
store.save('schedules', { programId: off.id, dtstart: '2026-11-01', start: '9:00', end: '10:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
await sync.syncNow();
ok(sync.syncStatus().pending === 1 && sync.syncStatus().failed === 1, '通信できないときはキューに残り失敗件数に出る');
eq(g.events.size, e0, 'オフライン中は Google に届かない');
ok(store.getSetting('lastError'), 'エラー内容を記録');
online = true;
await sync.syncNow();
eq(sync.syncStatus().pending, 0, '通信が戻ると送信される');
eq(g.events.size, e0 + 1, '再送で1件だけ増える');
eq(store.getSetting('lastError', null), null, '成功するとエラーが消える');

// 一部失敗
g.fail = (b) => b.summary === '失敗する番組';
const failP = store.save('programs', { name: '失敗する番組', color: '#D50000' });
const failS = store.save('schedules', { programId: failP.id, dtstart: '2026-11-01', start: '9:00', end: '10:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
const okP = store.save('programs', { name: '成功する番組', color: '#D50000' });
store.save('schedules', { programId: okP.id, dtstart: '2026-11-01', start: '9:00', end: '10:00', rrule: 'FREQ=WEEKLY;BYDAY=WE' });
await sync.syncNow();
eq(sync.syncStatus().failed, 1, '失敗した1件だけ残る');
ok([...g.events.values()].some((e) => e.summary === '成功する番組'), '他の予定は登録される');
g.fail = null;
await sync.syncNow();
eq(sync.syncStatus().failed, 0, '再試行で解消');

// Google 側で消された予定：再同期で戻る
const gone = [...g.events.values()].find((e) => e.summary === '成功する番組');
g.events.delete(gone.id);
await sync.resyncAll();
ok([...g.events.values()].some((e) => e.summary === '成功する番組'), '手動再同期で消えた予定を復旧');
const beforeDup = g.events.size;
await sync.resyncAll();
eq(g.events.size, beforeDup, '再同期しても二重にならない');

// バックアップと復元
const res = await sync.backupToDrive();
ok(res.id, 'ドライブにバックアップ');
const saved = JSON.parse(g.files.at(-1).data);
ok(!JSON.stringify(saved).includes(secret), 'バックアップに合言葉を含めない');
ok(!JSON.stringify(saved).includes('script.google.com'), 'バックアップに連携URLを含めない');
const list = (await sync.listDriveBackups()).backups;
eq(list[0].id, res.id, 'バックアップ一覧');
store.save('programs', { name: '復元で消える番組', color: '#D50000' });
await sync.restoreFromDrive(res.id);
ok(!store.all('programs').some((p) => p.name === '復元で消える番組'), '復元でデータが戻る');
ok(store.get('programs', prog.id), '復元後も既存の番組がある');
eq(sync.isLinked(), true, '復元しても連携は保たれる');
const dupCheck = g.events.size;
await sync.syncNow();
eq(g.events.size, dupCheck, '復元後の同期で予定が二重にならない');

let wrong = null;
await sync.callGas('restore', { id: 'not-in-folder' }).catch((e) => { wrong = e.message; });
eq(wrong, 'バックアップが見つかりません', 'アプリ用フォルダ外のファイルは読めない');

let badImport = null;
await store.importAll({ foo: 1 }).catch((e) => { badImport = e.message; });
ok(badImport, '不正なファイルは読み込まない');
ok(store.get('programs', prog.id), '不正なファイルでデータは消えない');

// 永続化：読み直しても残る
const reread = await new Promise((resolve) => {
  const open = indexedDB.open('radio-calendar-test');
  open.onsuccess = () => {
    const r = open.result.transaction('programs').objectStore('programs').get(prog.id);
    r.onsuccess = () => { open.result.close(); resolve(r.result); };
  };
});
eq(reread?.name, '深夜テスト', 'IndexedDB に保存される');

// 論理削除
store.removeProgram(okP.id);
eq(store.get('programs', okP.id), null, '削除した番組は見えない');
ok(store.exportAll().tables.programs.some((p) => p.id === okP.id && p.deleted), '論理削除で残る');
await sync.syncNow();
ok(![...g.events.values()].some((e) => e.summary === '成功する番組'), '削除すると Google の予定も消える');
eq(failS.programId, failP.id, '放送枠の紐付け');

// 解除
await sync.disconnect({ deleteCalendar: true });
eq(g.calendars.size, 0, '解除時にカレンダーを削除');
eq(sync.isLinked(), false, '解除で連携情報を消す');
eq(store.gcalMap.size, 0, '解除で予定IDの対応表を消す');
globalThis.fetch = realFetch;

// ---- 性能：番組 200 件・放送枠 500 件 ----
for (let i = 0; i < 200; i++) {
  const p = store.save('programs', { name: `番組${i}`, color: '#039BE5' }, { silent: true });
  const n = i < 100 ? 3 : 2;
  for (let j = 0; j < n; j++) {
    store.save('schedules', { programId: p.id, dtstart: '2026-01-01', start: `${(i + j) % 24}:00`, end: `${(i + j) % 24 + 1}:00`, rrule: `FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][(i + j) % 7]}` }, { silent: true });
  }
}
const t0 = performance.now();
const big = episodes.occurrences(instant(ymdToDay('2026-11-01')), instant(ymdToDay('2026-12-06')));
episodes.marksInRange(ymdToDay('2026-11-01'), ymdToDay('2026-12-05'));
const elapsed = performance.now() - t0;
ok(big.length > 2000, `番組200・放送枠500の月計算（${big.length}回）`);
ok(elapsed < 300, `月の計算が 300ms 未満（実測 ${Math.round(elapsed)}ms）`);

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
