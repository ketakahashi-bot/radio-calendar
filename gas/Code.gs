/**
 * ラジオ番組カレンダー GAS 中継スクリプト（第2版）
 *
 * 操作する Google のデータはこのスクリプトが作った次の3つだけです。
 *   - カレンダー「ラジオ番組」
 *   - ToDo リスト「ラジオ番組」
 *   - ドライブのフォルダ「ラジオ番組カレンダー」
 *
 * 定期処理（setup を実行すると登録されます）
 *   - 1時間ごと：YouTube・ポッドキャストの RSS を確認し、今日・明日の「今日のまとめ」を更新
 *   - 毎日4時台：バックアップの世代整理と、古い「今日のまとめ」の削除
 *
 * 設置・更新の手順は README.md を参照してください。
 */

var VERSION = 2;
var CALENDAR_NAME = 'ラジオ番組';
var TASKLIST_NAME = 'ラジオ番組';
var FOLDER_NAME = 'ラジオ番組カレンダー';
var TZ = 'Asia/Tokyo';
var DAY_MS = 86400000;
var BACKUP_DAYS = 30;
var MAX_FEEDS = 50;
var MAX_ITEMS = 500;
var PROP_KEYS = {
  secret: 'SECRET', calendar: 'CALENDAR_ID', tasklist: 'TASKLIST_ID', folder: 'FOLDER_ID',
  lastBackup: 'LAST_BACKUP_AT', testEvent: 'TEST_EVENT_ID',
};

// ---- エディタから実行する関数 ----

/** 最初に1回（GAS を更新したときも1回）実行する。合言葉を作り、定期処理を登録し、連携情報を自分宛てに送る */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty(PROP_KEYS.secret);
  if (!secret) {
    secret = newSecret_();
    props.setProperty(PROP_KEYS.secret, secret);
  }
  ensureTriggers_();
  sendLinkMail_(secret, '連携情報');
}

/** 端末をなくして合言葉が分からないときに実行する。古い合言葉はすぐ使えなくなる */
function resetSecret() {
  var secret = newSecret_();
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.secret, secret);
  sendLinkMail_(secret, '合言葉を再発行しました');
}

function newSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function sendLinkMail_(secret, title) {
  // エディタから実行するとテスト用の /dev のURLが返ることがあるので、/exec のときだけ案内に使う
  var serviceUrl = ScriptApp.getService().getUrl() || '';
  var url = /\/exec$/.test(serviceUrl)
    ? serviceUrl
    : '「デプロイ > デプロイを管理」に出ている、末尾が /exec のウェブアプリURLをコピーしてください';
  Logger.log('連携用URL: ' + url);
  Logger.log('合言葉: ' + secret);
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    'ラジオ番組カレンダー ' + title,
    'アプリの「設定 > Google 連携」に貼り付けてください。このメールは他の人に見せないでください。\n\n' +
      '連携用URL:\n' + url + '\n\n合言葉:\n' + secret + '\n'
  );
}

/** 定期処理を登録する。すでにあれば作り直さない */
function ensureTriggers_() {
  var wanted = { onHourly: true, onDaily: true };
  var have = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var name = t.getHandlerFunction();
    if (!wanted[name]) return;
    if (have[name]) ScriptApp.deleteTrigger(t); else have[name] = true;
  });
  if (!have.onHourly) ScriptApp.newTrigger('onHourly').timeBased().everyHours(1).create();
  if (!have.onDaily) ScriptApp.newTrigger('onDaily').timeBased().everyDays(1).atHour(4).inTimezone(TZ).create();
}

function triggersReady_() {
  try {
    var names = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    return names.indexOf('onHourly') >= 0 && names.indexOf('onDaily') >= 0;
  } catch (err) {
    return false;
  }
}

// ---- 定期処理 ----

function onHourly() {
  withLock_(function () {
    checkFeeds_(null);
    refreshSummaries_();
  });
}

function onDaily() {
  withLock_(function () {
    pruneBackups_();
    removeOldSummaries_();
  });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---- Web アプリの入口 ----

function doGet() {
  return json_({ ok: true, app: 'radio-calendar', version: VERSION });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad request', version: VERSION });
  }
  var secret = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.secret);
  if (!secret || !req.secret || req.secret !== secret) {
    return json_({ ok: false, error: 'unauthorized', version: VERSION });
  }
  try {
    var out = withLock_(function () { return dispatch_(req); });
    out.version = VERSION;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err), version: VERSION });
  }
}

function dispatch_(req) {
  switch (req.action) {
    case 'connect': return connect_();
    case 'info': return { ok: true, triggers: triggersReady_() };
    case 'sync': return { ok: true, results: (req.ops || []).map(runOp_) };
    case 'backup': return saveBackup_(req.data, req.meta || {});
    case 'listBackups': return listBackups_();
    case 'restore': return restoreBackup_(req.id);
    case 'disconnect': return disconnect_(req.deleteCalendar === true);
    case 'rotateSecret': return rotateSecret_();
    case 'testNotification': return testNotification_(req.minutes);
    case 'setFeeds': return setFeeds_(req.feeds || []);
    case 'feedItems': return feedItems_(Number(req.since) || 0);
    case 'resolveFeed': return resolveFeed_(req.url);
    case 'setDigest': return setDigest_(req.digest);
    default: return { ok: false, error: 'unknown action' };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function isGone_(err) {
  return /not found|404|410|deleted|gone/i.test(String(err && err.message || err));
}

function ymd_(ms) {
  return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd');
}

function atJst_(ymd, hm) {
  var p = hm.split(':');
  var h = ('0' + p[0]).slice(-2);
  return new Date(ymd + 'T' + h + ':' + p[1] + ':00+09:00').getTime();
}

function iso_(ms) {
  return Utilities.formatDate(new Date(ms), TZ, "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
}

// ---- カレンダー ----

function calendarId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_KEYS.calendar);
  if (id) {
    try {
      Calendar.Calendars.get(id);
      return id;
    } catch (err) {
      if (!isGone_(err)) throw err;
    }
  }
  var created = Calendar.Calendars.insert({ summary: CALENDAR_NAME, timeZone: TZ });
  props.setProperty(PROP_KEYS.calendar, created.id);
  return created.id;
}

function findEventByKey_(calId, key) {
  var found = Calendar.Events.list(calId, { privateExtendedProperty: 'appKey=' + key, maxResults: 1 });
  return found.items && found.items.length ? found.items[0].id : null;
}

/** 予定を作るか更新する。id がなければアプリのキーで探し、二重に作らない */
function putEvent_(key, payload, id) {
  var calId = calendarId_();
  var body = JSON.parse(JSON.stringify(payload));
  body.status = 'confirmed';
  body.extendedProperties = { private: { appKey: key } };
  if (!id) id = findEventByKey_(calId, key);
  if (id) {
    try {
      return Calendar.Events.update(body, calId, id).id;
    } catch (err) {
      if (!isGone_(err)) throw err;
    }
  }
  return Calendar.Events.insert(body, calId).id;
}

function removeEvent_(id) {
  if (!id) return;
  try {
    Calendar.Events.remove(calendarId_(), id);
  } catch (err) {
    if (!isGone_(err)) throw err;
  }
}

// ---- ToDo リスト ----

function tasklistId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_KEYS.tasklist);
  if (id) {
    try {
      Tasks.Tasklists.get(id);
      return id;
    } catch (err) {
      if (!isGone_(err)) throw err;
    }
  }
  var created = Tasks.Tasklists.insert({ title: TASKLIST_NAME });
  props.setProperty(PROP_KEYS.tasklist, created.id);
  return created.id;
}

function upsertTask_(op) {
  var listId = tasklistId_();
  var marker = '[radio:' + op.key + ']';
  var body = {
    title: op.payload.title,
    notes: (op.payload.notes ? op.payload.notes + '\n' : '') + marker,
    due: op.payload.due,
  };
  var id = op.id;
  if (!id) {
    var list = Tasks.Tasks.list(listId, { showCompleted: true, showHidden: true, maxResults: 100 });
    (list.items || []).forEach(function (t) {
      if (t.notes && t.notes.indexOf(marker) >= 0) id = t.id;
    });
  }
  if (id) {
    try {
      return Tasks.Tasks.patch(body, listId, id).id;
    } catch (err) {
      if (!isGone_(err)) throw err;
    }
  }
  return Tasks.Tasks.insert(body, listId).id;
}

function deleteTask_(op) {
  if (!op.id) return;
  try {
    Tasks.Tasks.remove(tasklistId_(), op.id);
  } catch (err) {
    if (!isGone_(err)) throw err;
  }
}

function runOp_(op) {
  try {
    var isTask = op.kind === 'task';
    if (op.op === 'delete') {
      if (isTask) deleteTask_(op); else removeEvent_(op.id);
      return { key: op.key, ok: true };
    }
    if (op.op === 'upsert') {
      return { key: op.key, ok: true, id: isTask ? upsertTask_(op) : putEvent_(op.key, op.payload, op.id) };
    }
    return { key: op.key, ok: false, error: 'unknown op' };
  } catch (err) {
    return { key: op.key, ok: false, error: String(err && err.message || err) };
  }
}

// ---- ドライブ ----

function folder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_KEYS.folder);
  if (id) {
    try {
      var existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (err) {
      if (!isGone_(err)) throw err;
    }
  }
  var folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty(PROP_KEYS.folder, folder.getId());
  return folder;
}

/** アプリ用フォルダ内の作業ファイル（RSS の設定や新着の回など）を読む */
function readJson_(name, fallback) {
  var it = folder_().getFilesByName(name);
  if (!it.hasNext()) return fallback;
  try {
    return JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
  } catch (err) {
    return fallback;
  }
}

function writeJson_(name, obj) {
  var folder = folder_();
  var it = folder.getFilesByName(name);
  var text = JSON.stringify(obj);
  if (it.hasNext()) it.next().setContent(text);
  else folder.createFile(name, text, 'application/json');
}

function backupFiles_(folder) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (/^backup-/.test(f.getName())) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  return files;
}

function metaOf_(f) {
  try {
    return JSON.parse(f.getDescription() || '{}');
  } catch (err) {
    return {};
  }
}

function saveBackup_(data, meta) {
  if (!data) return { ok: false, error: 'no data' };
  var folder = folder_();
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
  var type = meta.type === 'pre-overwrite' ? 'pre-overwrite' : 'regular';
  var file = folder.createFile('backup-' + stamp + (type === 'pre-overwrite' ? '-before' : '') + '.json', data, 'application/json');
  file.setDescription(JSON.stringify({ type: type, version: meta.version || 1, counts: meta.counts || null, device: meta.device || '' }));
  if (type === 'regular') PropertiesService.getScriptProperties().setProperty(PROP_KEYS.lastBackup, String(Date.now()));
  pruneBackups_();
  return { ok: true, id: file.getId(), name: file.getName() };
}

/**
 * 世代整理（F-MIG-06）。直近24時間は新しい20件、それより前は1日1件（その日の最後のもの）を30日分残す。
 * 上書き前のバックアップは30日間すべて残す。
 */
function pruneBackups_() {
  var now = Date.now();
  var seenDays = {};
  var recent = 0;
  backupFiles_(folder_()).forEach(function (f) {
    var created = f.getDateCreated().getTime();
    var meta = metaOf_(f);
    var age = now - created;
    var keep;
    if (age > BACKUP_DAYS * DAY_MS) keep = false;
    else if (meta.type === 'pre-overwrite') keep = true;
    else if (age <= DAY_MS) keep = ++recent <= 20;
    else {
      var day = ymd_(created);
      keep = !seenDays[day];
      seenDays[day] = true;
    }
    if (!keep) f.setTrashed(true);
  });
}

function listBackups_() {
  return {
    ok: true,
    backups: backupFiles_(folder_()).slice(0, 60).map(function (f) {
      return { id: f.getId(), name: f.getName(), createdAt: f.getDateCreated().getTime(), size: f.getSize(), meta: metaOf_(f) };
    }),
  };
}

function restoreBackup_(id) {
  // アプリ用フォルダ内のバックアップだけを読む
  var match = backupFiles_(folder_()).filter(function (f) { return f.getId() === id; })[0];
  if (!match) return { ok: false, error: 'バックアップが見つかりません' };
  return { ok: true, data: match.getBlob().getDataAsString('UTF-8') };
}

// ---- 連携 ----

function connect_() {
  var calId = calendarId_();
  tasklistId_();
  folder_();
  var triggers = true;
  try {
    ensureTriggers_();
  } catch (err) {
    triggers = false; // 権限が足りないときは、エディタで setup を実行すれば登録される
  }
  return { ok: true, calendarId: calId, calendarName: CALENDAR_NAME, triggers: triggers };
}

function disconnect_(deleteCalendar) {
  var props = PropertiesService.getScriptProperties();
  if (deleteCalendar) {
    var calId = props.getProperty(PROP_KEYS.calendar);
    var listId = props.getProperty(PROP_KEYS.tasklist);
    if (calId) {
      try { Calendar.Calendars.remove(calId); } catch (err) { if (!isGone_(err)) throw err; }
      props.deleteProperty(PROP_KEYS.calendar);
    }
    if (listId) {
      try { Tasks.Tasklists.remove(listId); } catch (err) { if (!isGone_(err)) throw err; }
      props.deleteProperty(PROP_KEYS.tasklist);
    }
    writeJson_('summaries.json', {});
  }
  return { ok: true };
}

function rotateSecret_() {
  var secret = newSecret_();
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.secret, secret);
  return { ok: true, secret: secret };
}

function testNotification_(minutes) {
  var props = PropertiesService.getScriptProperties();
  removeEvent_(props.getProperty(PROP_KEYS.testEvent));
  var start = Date.now() + Math.min(Math.max(Number(minutes) || 3, 1), 30) * 60000;
  var id = putEvent_('test:' + start, {
    summary: '通知テスト（ラジオ番組カレンダー）',
    description: 'この通知が鳴れば、放送開始の通知も届きます。確認後は削除してかまいません。',
    start: { dateTime: iso_(start), timeZone: TZ },
    end: { dateTime: iso_(start + 5 * 60000), timeZone: TZ },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
  }, null);
  props.setProperty(PROP_KEYS.testEvent, id);
  return { ok: true, at: start };
}

// ---- 新着の自動検知（F-FEED）----

var NS = {
  yt: 'http://www.youtube.com/xml/schemas/2015',
  itunes: 'http://www.itunes.com/dtds/podcast-1.0.dtd',
};

function text_(el) {
  return el ? String(el.getText() || '').trim() : '';
}

function durationMinutes_(s) {
  if (!s) return null;
  var parts = String(s).trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  var sec = parts.reduce(function (acc, n) { return acc * 60 + n; }, 0);
  return Math.max(1, Math.round(sec / 60));
}

/** RSS 2.0（ポッドキャスト）と Atom（YouTube）を読む */
function parseFeed_(xml) {
  var root = XmlService.parse(xml).getRootElement();
  var out = { title: '', entries: [] };
  if (root.getName() === 'feed') {
    var atom = root.getNamespace();
    var yt = XmlService.getNamespace('yt', NS.yt);
    out.title = text_(root.getChild('title', atom));
    out.entries = root.getChildren('entry', atom).map(function (e) {
      var link = e.getChildren('link', atom).filter(function (l) {
        var rel = l.getAttribute('rel');
        return !rel || rel.getValue() === 'alternate';
      })[0];
      var vid = text_(e.getChild('videoId', yt));
      var published = text_(e.getChild('published', atom)) || text_(e.getChild('updated', atom));
      return {
        extId: vid || text_(e.getChild('id', atom)),
        title: text_(e.getChild('title', atom)),
        publishedAt: Date.parse(published) || Date.now(),
        url: link && link.getAttribute('href') ? link.getAttribute('href').getValue() : '',
        audioUrl: '',
        duration: null,
      };
    });
    return out;
  }
  var channel = root.getChild('channel');
  if (!channel) throw new Error('RSS ではありません');
  var it = XmlService.getNamespace('itunes', NS.itunes);
  out.title = text_(channel.getChild('title'));
  out.entries = channel.getChildren('item').map(function (e) {
    var enc = e.getChild('enclosure');
    var link = text_(e.getChild('link'));
    var guid = text_(e.getChild('guid'));
    return {
      extId: guid || link || text_(e.getChild('title')),
      title: text_(e.getChild('title')),
      publishedAt: Date.parse(text_(e.getChild('pubDate'))) || Date.now(),
      url: link || (enc && enc.getAttribute('url') ? enc.getAttribute('url').getValue() : ''),
      audioUrl: enc && enc.getAttribute('url') ? enc.getAttribute('url').getValue() : '',
      duration: durationMinutes_(text_(e.getChild('duration', it))),
    };
  });
  return out;
}

/** タイトルの絞り込み（F-FEED-06）。含む語はどれか1つ、除く語はどれも含まないこと */
function passesFilter_(title, feed) {
  var t = String(title || '');
  var inc = feed.include || [];
  var exc = feed.exclude || [];
  if (inc.length && !inc.some(function (w) { return t.indexOf(w) >= 0; })) return false;
  return !exc.some(function (w) { return t.indexOf(w) >= 0; });
}

function setFeeds_(feeds) {
  var list = feeds.slice(0, MAX_FEEDS);
  writeJson_('feeds.json', list);
  var state = readJson_('feed-state.json', {});
  var ids = {};
  list.forEach(function (f) { ids[f.id] = true; });
  Object.keys(state).forEach(function (id) { if (!ids[id]) delete state[id]; });
  writeJson_('feed-state.json', state);
  // 新しく登録された RSS はすぐに確認する
  var fresh = list.filter(function (f) { return !state[f.id] || state[f.id].url !== f.url; }).map(function (f) { return f.id; });
  if (fresh.length) checkFeeds_(fresh);
  return { ok: true, count: list.length };
}

function checkFeeds_(onlyIds) {
  var feeds = readJson_('feeds.json', []).filter(function (f) { return !onlyIds || onlyIds.indexOf(f.id) >= 0; });
  if (!feeds.length) return 0;
  var store = readJson_('feed-items.json', { items: [] });
  var state = readJson_('feed-state.json', {});
  var now = Date.now();
  var responses = UrlFetchApp.fetchAll(feeds.map(function (f) {
    return { url: f.url, muteHttpExceptions: true, followRedirects: true };
  }));
  var added = 0;
  feeds.forEach(function (f, i) {
    var st = state[f.id] && state[f.id].url === f.url ? state[f.id] : { url: f.url, seen: [] };
    try {
      var res = responses[i];
      if (res.getResponseCode() >= 400) throw new Error('HTTP ' + res.getResponseCode());
      var parsed = parseFeed_(res.getContentText());
      var first = !st.lastChecked;
      parsed.entries.forEach(function (e) {
        if (!e.extId || st.seen.indexOf(e.extId) >= 0) return;
        st.seen.push(e.extId);
        // 初回は直近7日の回だけ取り込み、過去の回で未聴リストを埋めない
        if (first && now - e.publishedAt > 7 * DAY_MS) return;
        if (!passesFilter_(e.title, f)) return;
        var item = {
          id: f.id + ':' + e.extId, channelId: f.id, extId: e.extId, title: e.title,
          publishedAt: e.publishedAt, duration: e.duration, url: e.url, audioUrl: e.audioUrl, detectedAt: now,
        };
        store.items.push(item);
        added++;
        if (f.calendar) addFeedEvent_(f, item);
      });
      st.seen = st.seen.slice(-300);
      st.lastChecked = now;
      st.error = null;
      st.failStreak = 0;
    } catch (err) {
      st.lastChecked = now;
      st.error = String(err && err.message || err);
      st.failStreak = (st.failStreak || 0) + 1;
    }
    st.programName = f.programName;
    state[f.id] = st;
  });
  store.items = store.items.slice(-MAX_ITEMS);
  writeJson_('feed-items.json', store);
  writeJson_('feed-state.json', state);
  return added;
}

/** 新着の回を通知なしの予定として登録する（F-FEED-05）。個別通知の番組だけ通知を付ける */
function addFeedEvent_(feed, item) {
  try {
    var start = item.publishedAt;
    putEvent_('feed:' + item.id.slice(0, 120), {
      summary: '🆕 ' + feed.programName + '：' + item.title,
      description: item.url || '',
      colorId: feed.colorId,
      start: { dateTime: iso_(start), timeZone: TZ },
      end: { dateTime: iso_(start + (item.duration || 30) * 60000), timeZone: TZ },
      reminders: { useDefault: false, overrides: feed.notify ? [{ method: 'popup', minutes: 0 }] : [] },
    }, null);
  } catch (err) {
    // 予定の登録に失敗しても、新着の回の記録は残す
  }
}

function feedItems_(since) {
  var store = readJson_('feed-items.json', { items: [] });
  var state = readJson_('feed-state.json', {});
  var status = {};
  Object.keys(state).forEach(function (id) {
    status[id] = { lastChecked: state[id].lastChecked || null, error: state[id].error || null, failStreak: state[id].failStreak || 0, programName: state[id].programName || '' };
  });
  return {
    ok: true,
    now: Date.now(),
    items: store.items.filter(function (i) { return i.detectedAt > since; }),
    status: status,
  };
}

/** チャンネルや番組ページの URL から RSS を見つけ、読めることを確かめる（F-FEED-02） */
function resolveFeed_(url) {
  if (!/^https?:\/\//.test(String(url || ''))) return { ok: false, error: 'URL を入力してください' };
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() >= 400) return { ok: false, error: 'ページを開けません（HTTP ' + res.getResponseCode() + '）' };
  var body = res.getContentText();
  var feedUrl = url;
  if (!/<(rss|feed)[\s>]/.test(body.slice(0, 2000))) {
    var m = body.match(/https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/)
      || body.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/);
    var alt = body.match(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]+href="([^"]+)"/);
    if (m) feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + m[1];
    else if (alt) feedUrl = alt[1].replace(/&amp;/g, '&');
    else return { ok: false, error: 'このページから RSS が見つかりません。RSS の URL を直接入力してください' };
    body = UrlFetchApp.fetch(feedUrl, { muteHttpExceptions: true, followRedirects: true }).getContentText();
  }
  var parsed = parseFeed_(body);
  return {
    ok: true, feedUrl: feedUrl, title: parsed.title, count: parsed.entries.length,
    kind: /youtube\.com\/feeds/.test(feedUrl) ? 'youtube' : 'podcast',
    latest: parsed.entries.slice(0, 3).map(function (e) { return e.title; }),
  };
}

// ---- 今日のまとめ（F-NTF-04）----

function setDigest_(digest) {
  writeJson_('digest.json', digest || null);
  refreshSummaries_();
  return { ok: true };
}

/** 今日と明日のまとめの予定を作り直す。まとめの時刻を過ぎた日は触らない */
function refreshSummaries_() {
  var digest = readJson_('digest.json', null) || { time: '7:00', enabled: true, days: {} };
  var map = readJson_('summaries.json', {});
  var now = Date.now();
  [0, 1].forEach(function (offset) {
    var day = ymd_(now + offset * DAY_MS);
    var at = atJst_(day, digest.time || '7:00');
    if (at <= now) return;
    var content = digest.enabled === false ? null : summaryContent_(digest.days[day], at);
    if (!content) {
      if (map[day]) { removeEvent_(map[day]); delete map[day]; }
      return;
    }
    map[day] = putEvent_('sum:' + day, {
      summary: content.title,
      description: content.body,
      start: { dateTime: iso_(at), timeZone: TZ },
      end: { dateTime: iso_(at + 15 * 60000), timeZone: TZ },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    }, map[day] || null);
  });
  writeJson_('summaries.json', map);
}

function summaryContent_(day, at) {
  day = day || { tonight: [], deadlines: [], expiring: [], notes: [] };
  var store = readJson_('feed-items.json', { items: [] });
  var fresh = store.items.filter(function (i) { return i.detectedAt > at - DAY_MS && i.detectedAt <= at; }).length;
  var notes = (day.notes || []).slice();
  var state = readJson_('feed-state.json', {});
  var failing = Object.keys(state).filter(function (id) { return (state[id].failStreak || 0) >= 3; });
  if (failing.length) notes.push('RSS の確認に3回続けて失敗しています（' + failing.length + '件）。アプリの設定画面を確認してください');
  var lastBackup = Number(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.lastBackup) || 0);
  if (lastBackup && at - lastBackup > 7 * DAY_MS) notes.push('7日以上バックアップされていません。アプリを開いてください');

  var sections = [];
  var add = function (title, lines) { if (lines && lines.length) sections.push('▼' + title + '\n' + lines.map(function (l) { return '・' + l; }).join('\n')); };
  add('今夜の番組', day.tonight);
  add('締切が近いお題', day.deadlines);
  add('聴取期限が1日以内の回', day.expiring);
  if (fresh) sections.push('▼新着の回 ' + fresh + '件（アプリの「未聴」で確認できます）');
  add('お知らせ', notes);
  if (!sections.length) return null;
  var parts = [];
  if ((day.tonight || []).length) parts.push('番組' + day.tonight.length);
  if ((day.deadlines || []).length) parts.push('締切' + day.deadlines.length);
  if ((day.expiring || []).length) parts.push('期限' + day.expiring.length);
  if (fresh) parts.push('新着' + fresh);
  return { title: '今日のまとめ' + (parts.length ? '（' + parts.join('・') + '）' : ''), body: sections.join('\n\n') };
}

function removeOldSummaries_() {
  var map = readJson_('summaries.json', {});
  var limit = ymd_(Date.now() - 7 * DAY_MS);
  Object.keys(map).forEach(function (day) {
    if (day < limit) {
      try { removeEvent_(map[day]); } catch (err) { /* 次回に再試行 */ }
      delete map[day];
    }
  });
  writeJson_('summaries.json', map);
}
