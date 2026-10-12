/**
 * Exercise Log -> Google Sheet sync endpoint.
 * Paste into Extensions > Apps Script of the Google Sheet you want to fill,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 *
 * The app POSTs JSON as text/plain (no CORS preflight):
 *   { app: "exlog", sessions: [ {id, ...} ], sets: [ {id, ...} ] }
 * Rows are written to the "Sessions" and "Sets" tabs (created with headers if missing).
 * Idempotent by record id: a record that is sent again (e.g. after an edit or a retry)
 * overwrites its existing row instead of adding a duplicate.
 *
 * GET ?action=import returns your programmes file from Google Drive, so the app can
 * "Load my full file from Drive" (Settings > Google Sheet sync). Uses DriveApp, so the
 * script asks for Drive access once (run authorizeDrive in the editor, see SETUP.md).
 *
 * GET ?action=pull&since=<ISO> returns Sessions and Sets rows updated after `since`
 * (or all rows if since is empty) as JSON records with id, updatedAt, deleted and all fields.
 */

// Drive file the app loads with "Load my full file from Drive".
// Leave FILE_ID empty to use the newest file named IMPORT_FILE_NAME in your Drive, or paste a file ID
// (the long part of the file's Drive link, .../file/d/<FILE_ID>/view) to pin one exact file.
var FILE_ID = '';
var IMPORT_FILE_NAME = 'exercise-programmes-import.json';
var SET_COLS = ['id', 'session_id', 'date', 'start_time', 'routine', 'programme_week', 'block', 'exercise', 'exercise_id', 'swapped_from',
  'set_no', 'round', 'weight_kg', 'reps', 'rir', 'rpe', 'time_s', 'flights', 'avg_hr', 'variant', 'notes', 'deleted', 'updated_at'];
var SESSION_COLS = ['id', 'date', 'start_time', 'routine', 'programme_week', 'duration_s', 'rounds_done', 'effort', 'knee_before', 'knee_after',
  'series', 'session_no', 'title', 'ladder', 'notes', 'deleted', 'updated_at'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sessions = upsert_(ss, 'Sessions', SESSION_COLS, data.sessions || []);
    var sets = upsert_(ss, 'Sets', SET_COLS, data.sets || []);
    return json_({ ok: true, sessions: sessions, sets: sets });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : '';
  if (action === 'import') {
    try {
      var file = importFile_();
      if (!file) return json_({ ok: false, error: 'No file named ' + IMPORT_FILE_NAME + ' found in your Google Drive' });
      var pack = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
      return json_({ ok: true, app: 'exlog', name: file.getName(), updated: file.getLastUpdated().toISOString(), pack: pack });
    } catch (err) {
      return json_({ ok: false, error: String(err) });
    }
  }
  if (action === 'pull') {
    try {
      var since = (e.parameter && e.parameter.since) || '';
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      return json_({ ok: true, app: 'exlog', since: since,
        sessions: pull_(ss, 'Sessions', SESSION_COLS, since),
        sets: pull_(ss, 'Sets', SET_COLS, since) });
    } catch (err) {
      return json_({ ok: false, error: String(err) });
    }
  }
  return json_({ ok: true, app: 'exlog', message: 'Exercise Log sync endpoint is running.', import: true, pull: true });
}

function importFile_() {
  if (FILE_ID) return DriveApp.getFileById(FILE_ID);
  var it = DriveApp.getFilesByName(IMPORT_FILE_NAME), best = null;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed && f.isTrashed()) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  return best;
}

// Run this once from the editor (select it, click Run) so Google asks for Drive access.
function authorizeDrive() {
  var f = importFile_();
  Logger.log(f ? 'Found ' + f.getName() + ' (' + f.getSize() + ' bytes)' : 'No ' + IMPORT_FILE_NAME + ' in Drive yet');
}

function upsert_(ss, name, cols, records) {
  if (!records.length) return [];
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var lastCol = sh.getLastColumn();
  var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  if (!header.filter(String).length) {
    header = cols.slice();
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.setFrozenRows(1);
  } else {
    var missing = cols.filter(function (c) { return header.indexOf(c) < 0; });
    if (missing.length) {
      sh.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
      header = header.concat(missing);
    }
  }
  var idCol = header.indexOf('id');
  var lastRow = sh.getLastRow();
  var rowOf = {};
  if (lastRow > 1) {
    sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues().forEach(function (r, i) { if (r[0] !== '') rowOf[String(r[0])] = i + 2; });
  }
  var appends = [], appendIdx = {}, done = [];
  records.forEach(function (rec) {
    if (!rec || rec.id == null) return;
    if (!rec.updated_at) rec.updated_at = new Date().toISOString();
    var id = String(rec.id);
    var row = header.map(function (h) { var v = rec[h]; return v === undefined || v === null ? '' : v; });
    if (rowOf[id]) sh.getRange(rowOf[id], 1, 1, row.length).setValues([row]);
    else if (appendIdx[id] != null) appends[appendIdx[id]] = row;
    else { appendIdx[id] = appends.length; appends.push(row); }
    done.push(rec.id);
  });
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, header.length).setValues(appends);
  return done;
}

function pull_(ss, name, cols, since) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var lastCol = Math.max(sh.getLastColumn(), cols.length);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();
  var out = [];
  data.forEach(function (vals) {
    if (vals[header.indexOf('id')] === '' || vals[header.indexOf('id')] == null) return;
    var rec = rowToRec_(header, vals);
    if (since && rec.updatedAt && rec.updatedAt <= since) return;
    out.push(rec);
  });
  return out;
}

function rowToRec_(header, vals) {
  var rec = {};
  header.forEach(function (h, i) {
    if (!h) return;
    var v = vals[i];
    if (v instanceof Date) v = v.toISOString();
    else if (v === '') v = '';
    rec[h] = v;
  });
  rec.id = rec.id != null && rec.id !== '' ? String(rec.id) : '';
  var ua = rec.updated_at;
  if (ua instanceof Date) ua = ua.toISOString();
  rec.updatedAt = ua ? String(ua) : '';
  var d = rec.deleted;
  rec.deleted = d === true || d === 'TRUE' || d === 'true' || d === 1 || d === '1';
  return rec;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
