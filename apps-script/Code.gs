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
 * GET ?action=pull&since=<ISO> returns rows synced after `since` (or all rows if since is empty)
 * as JSON records with id, updatedAt, deleted and all fields.
 *
 * v2 (Oct 2026) tabs, readable columns first, sync ids on the right:
 *   Log        one row per set (was "Sets": renamed and re-ordered automatically on the first sync)
 *   Sessions   one row per workout (re-ordered automatically, rows kept)
 *   Exercises  exercise library incl. your own (json column = full definition)
 *   Routines   routine definitions (json column = structure)
 *   Settings   synced settings (reminder, active routines, rotation, equipment, notes)
 * Newest updated_at wins in the app; deletions are kept as rows with deleted = TRUE.
 * Older app versions keep working (they only send sessions + sets).
 */

// Drive file the app loads with "Load my full file from Drive".
// Leave FILE_ID empty to use the newest file named IMPORT_FILE_NAME in your Drive, or paste a file ID
// (the long part of the file's Drive link, .../file/d/<FILE_ID>/view) to pin one exact file.
var FILE_ID = '';
var IMPORT_FILE_NAME = 'exercise-programmes-import.json';
var LOG_COLS = ['date', 'session', 'routine', 'programme_week', 'block', 'exercise', 'set_no', 'round', 'weight_kg', 'reps', 'time', 'time_s', 'flights',
  'rpe', 'rir', 'avg_hr', 'variant', 'swapped_from', 'notes', 'exercise_id', 'session_id', 'start_time', 'id', 'updated_at', 'deleted', 'synced_at'];
var SESSION_COLS = ['date', 'start_time', 'routine', 'title', 'programme_week', 'duration', 'duration_s', 'rounds_done', 'effort', 'knee_before', 'knee_after',
  'series', 'session_no', 'ladder', 'notes', 'id', 'updated_at', 'deleted', 'synced_at'];
var EXERCISE_COLS = ['name', 'fields', 'equipment', 'group', 'notes', 'json', 'id', 'updated_at', 'deleted', 'synced_at'];
var ROUTINE_COLS = ['name', 'kind', 'subtitle', 'active', 'json', 'id', 'updated_at', 'deleted', 'synced_at'];
var SETTING_COLS = ['key', 'value', 'id', 'updated_at', 'deleted', 'synced_at'];
var TABS = { sessions: ['Sessions', SESSION_COLS], sets: ['Log', LOG_COLS], exercises: ['Exercises', EXERCISE_COLS], routines: ['Routines', ROUTINE_COLS], settings: ['Settings', SETTING_COLS] };

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet(); migrate_(ss);
    var now = new Date().toISOString(), out = { ok: true, v: 2, now: now };
    Object.keys(TABS).forEach(function (k) { out[k] = upsert_(ss, TABS[k][0], TABS[k][1], data[k] || [], now); });
    return json_(out);
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
      var ss = SpreadsheetApp.getActiveSpreadsheet(); migrate_(ss);
      var out = { ok: true, app: 'exlog', v: 2, since: since, now: new Date().toISOString() };
      Object.keys(TABS).forEach(function (k) { out[k] = pull_(ss, TABS[k][0], TABS[k][1], since); });
      return json_(out);
    } catch (err) {
      return json_({ ok: false, error: String(err) });
    }
  }
  return json_({ ok: true, app: 'exlog', v: 2, message: 'Exercise Log sync endpoint is running.', import: true, pull: true });
}

// v1 -> v2: rename Sets to Log, and put readable columns first in Log / Sessions (all rows and values kept).
function migrate_(ss) {
  var old = ss.getSheetByName('Sets');
  if (old && !ss.getSheetByName('Log')) old.setName('Log');
  [['Log', LOG_COLS], ['Sessions', SESSION_COLS]].forEach(function (t) {
    var sh = ss.getSheetByName(t[0]); if (!sh || !sh.getLastColumn()) return;
    var lastCol = sh.getLastColumn(), header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    if (header[0] !== 'id') return;   // already in the v2 order
    var extra = header.filter(function (h) { return h && t[1].indexOf(h) < 0; });
    var nh = t[1].concat(extra), n = sh.getLastRow();
    var data = n > 1 ? sh.getRange(2, 1, n - 1, lastCol).getValues() : [];
    var rows = data.map(function (vals) { return nh.map(function (h) { var i = header.indexOf(h); return i < 0 ? '' : vals[i]; }); });
    sh.getRange(1, 1, 1, nh.length).setValues([nh]);
    if (rows.length) sh.getRange(2, 1, rows.length, nh.length).setValues(rows);
    sh.setFrozenRows(1);
  });
}

function upsert_(ss, name, cols, records, now) {
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
    rec.synced_at = now || new Date().toISOString();
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
    var stamp = rec.synced_at || rec.updatedAt;   // server time of the last write (falls back to the app's updated_at)
    if (since && stamp && stamp <= since) return;
    out.push(rec);
  });
  return out;
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
  if (rec.synced_at instanceof Date) rec.synced_at = rec.synced_at.toISOString();
  var d = rec.deleted;
  rec.deleted = d === true || d === 'TRUE' || d === 'true' || d === 1 || d === '1';
  return rec;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
