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
 */
var SET_COLS = ['id', 'session_id', 'date', 'start_time', 'routine', 'programme_week', 'block', 'exercise', 'exercise_id', 'swapped_from',
  'set_no', 'round', 'weight_kg', 'reps', 'rir', 'rpe', 'time_s', 'flights', 'variant', 'notes', 'deleted', 'updated_at'];
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

function doGet() {
  return json_({ ok: true, app: 'exlog', message: 'Exercise Log sync endpoint is running.' });
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

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
