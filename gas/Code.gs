/**
 * ラジオ番組カレンダー GAS 中継スクリプト
 *
 * 操作する Google のデータはこのスクリプトが作った次の3つだけです。
 *   - カレンダー「ラジオ番組」
 *   - ToDo リスト「ラジオ番組」
 *   - ドライブのフォルダ「ラジオ番組カレンダー」
 *
 * 設置手順は README.md を参照してください。
 */

var CALENDAR_NAME = 'ラジオ番組';
var TASKLIST_NAME = 'ラジオ番組';
var FOLDER_NAME = 'ラジオ番組カレンダー';
var KEEP_BACKUPS = 30;
var PROP_KEYS = { secret: 'SECRET', calendar: 'CALENDAR_ID', tasklist: 'TASKLIST_ID', folder: 'FOLDER_ID' };

/** 最初に1回だけエディタから実行する。合言葉を作り、実行ログと自分宛てメールに出力する */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty(PROP_KEYS.secret);
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty(PROP_KEYS.secret, secret);
  }
  var url = ScriptApp.getService().getUrl() || '（未デプロイ。デプロイ後にもう一度 setup を実行してください）';
  Logger.log('連携用URL: ' + url);
  Logger.log('合言葉: ' + secret);
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    'ラジオ番組カレンダー 連携情報',
    'アプリの「設定 > Google 連携」に貼り付けてください。このメールは他の人に見せないでください。\n\n' +
      '連携用URL:\n' + url + '\n\n合言葉:\n' + secret + '\n'
  );
}

function doGet() {
  return json_({ ok: true, app: 'radio-calendar' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  var secret = PropertiesService.getScriptProperties().getProperty(PROP_KEYS.secret);
  if (!secret || !req.secret || req.secret !== secret) {
    return json_({ ok: false, error: 'unauthorized' });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    return json_(dispatch_(req));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function dispatch_(req) {
  switch (req.action) {
    case 'connect': return connect_();
    case 'sync': return { ok: true, results: (req.ops || []).map(runOp_) };
    case 'backup': return saveBackup_(req.data);
    case 'listBackups': return listBackups_();
    case 'restore': return restoreBackup_(req.id);
    case 'disconnect': return disconnect_(req.deleteCalendar === true);
    default: return { ok: false, error: 'unknown action' };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function isGone_(err) {
  return /not found|404|410|deleted|gone/i.test(String(err && err.message || err));
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
  var created = Calendar.Calendars.insert({ summary: CALENDAR_NAME, timeZone: 'Asia/Tokyo' });
  props.setProperty(PROP_KEYS.calendar, created.id);
  return created.id;
}

function upsertEvent_(op) {
  var calId = calendarId_();
  var body = JSON.parse(JSON.stringify(op.payload));
  body.status = 'confirmed';
  body.extendedProperties = { private: { appKey: op.key } };
  var id = op.id;
  if (!id) {
    // 応答が届かず再送された場合や、復元後でも予定が二重にならないようにする
    var found = Calendar.Events.list(calId, { privateExtendedProperty: 'appKey=' + op.key, maxResults: 1 });
    if (found.items && found.items.length) id = found.items[0].id;
  }
  if (id) {
    try {
      return Calendar.Events.update(body, calId, id).id;
    } catch (err) {
      if (!isGone_(err)) throw err;
    }
  }
  return Calendar.Events.insert(body, calId).id;
}

function deleteEvent_(op) {
  if (!op.id) return;
  try {
    Calendar.Events.remove(calendarId_(), op.id);
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
      if (isTask) deleteTask_(op); else deleteEvent_(op);
      return { key: op.key, ok: true };
    }
    if (op.op === 'upsert') {
      return { key: op.key, ok: true, id: isTask ? upsertTask_(op) : upsertEvent_(op) };
    }
    return { key: op.key, ok: false, error: 'unknown op' };
  } catch (err) {
    return { key: op.key, ok: false, error: String(err && err.message || err) };
  }
}

// ---- ドライブ（バックアップ）----

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

function backupFiles_(folder) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  return files;
}

function saveBackup_(data) {
  if (!data) return { ok: false, error: 'no data' };
  var folder = folder_();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
  var file = folder.createFile('backup-' + stamp + '.json', data, 'application/json');
  backupFiles_(folder).slice(KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
  return { ok: true, id: file.getId(), name: file.getName() };
}

function listBackups_() {
  return {
    ok: true,
    backups: backupFiles_(folder_()).slice(0, 20).map(function (f) {
      return { id: f.getId(), name: f.getName(), createdAt: f.getDateCreated().getTime(), size: f.getSize() };
    }),
  };
}

function restoreBackup_(id) {
  // アプリ用フォルダ内のファイルだけを読む
  var match = backupFiles_(folder_()).filter(function (f) { return f.getId() === id; })[0];
  if (!match) return { ok: false, error: 'バックアップが見つかりません' };
  return { ok: true, data: match.getBlob().getDataAsString('UTF-8') };
}

// ---- 連携 ----

function connect_() {
  var calId = calendarId_();
  tasklistId_();
  folder_();
  return { ok: true, calendarId: calId, calendarName: CALENDAR_NAME };
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
  }
  return { ok: true };
}
