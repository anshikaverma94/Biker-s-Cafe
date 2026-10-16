// Paste this whole file into Extensions > Apps Script (inside your Google Sheet),
// replace the SECRET value below, then deploy it as a Web App (see README-SHEETS.md).

var SECRET = 'replace-with-a-long-random-string'; // must match SHEETS_WEBHOOK_SECRET in .env.local

var LEADS_HEADERS = ['Timestamp', 'Lead ID', 'Event Date', 'Slot', 'Phone', 'Email', 'Guest Count', 'Genders', 'Status'];
var BOOKINGS_HEADERS = ['Timestamp', 'Booking ID', 'Order ID', 'Event Date', 'Slot', 'Phone', 'Email', 'Guest Name', 'Guest Age', 'Gender', 'Amount (Rs)', 'Status'];

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ ok: false, error: 'Invalid JSON body' });
  }

  if (body.secret !== SECRET) {
    return jsonOutput({ ok: false, error: 'Unauthorized' });
  }

  try {
    if (body.action === 'addLead') return addLead(body);
    if (body.action === 'addBooking') return addBooking(body);
    if (body.action === 'markLeadConverted') return markLeadConverted(body);
    return jsonOutput({ ok: false, error: 'Unknown action: ' + body.action });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

// Creates the sheet with the given headers if it doesn't exist yet. If it
// already exists, adds any headers from the list that are missing as new
// columns at the end, so older sheets pick up new fields (like "Genders")
// without anyone having to edit the sheet by hand.
function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    return sh;
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    return sh;
  }

  var lastCol = sh.getLastColumn();
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  headers.forEach(function (h) {
    if (existing.indexOf(h) === -1) {
      lastCol += 1;
      sh.getRange(1, lastCol).setValue(h);
      existing.push(h);
    }
  });
  return sh;
}

// Builds a header-name -> value map into a row array matching the sheet's
// actual current header order, so column position never has to be hardcoded.
function rowFromMap(sh, map) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return headers.map(function (h) { return map[h] !== undefined ? map[h] : ''; });
}

function colIndex(sh, headerName) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return headers.indexOf(headerName) + 1; // 0 if not found
}

function addLead(body) {
  var sh = getOrCreateSheet('Leads', LEADS_HEADERS);
  var guests = body.guests || [];
  var genders = guests.map(function (g) { return g.gender || ''; }).filter(String).join(', ');
  sh.appendRow(rowFromMap(sh, {
    'Timestamp': new Date().toISOString(),
    'Lead ID': body.leadId || '',
    'Event Date': body.eventDate || '',
    'Slot': body.slotTime || '',
    'Phone': body.phone || '',
    'Email': body.email || '',
    'Guest Count': body.guestCount || '',
    'Genders': genders,
    'Status': 'Filled - not paid',
  }));
  return jsonOutput({ ok: true });
}

function addBooking(body) {
  var sh = getOrCreateSheet('Bookings', BOOKINGS_HEADERS);
  var timestamp = new Date().toISOString();
  var guests = body.guests || [];
  for (var i = 0; i < guests.length; i++) {
    var g = guests[i];
    sh.appendRow(rowFromMap(sh, {
      'Timestamp': timestamp,
      'Booking ID': body.bookingId || '',
      'Order ID': body.orderId || '',
      'Event Date': body.eventDate || '',
      'Slot': body.slotTime || '',
      'Phone': body.phone || '',
      'Email': body.email || '',
      'Guest Name': g.name || '',
      'Guest Age': g.age || '',
      'Gender': g.gender || (g.isChild ? 'Child' : 'Adult'),
      'Amount (Rs)': body.totalAmount || '',
      'Status': body.status || '',
    }));
  }
  return jsonOutput({ ok: true });
}

function markLeadConverted(body) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads');
  if (!sh) return jsonOutput({ ok: true }); // nothing to update yet, not an error
  var leadIdCol = colIndex(sh, 'Lead ID');
  var statusCol = colIndex(sh, 'Status');
  if (!leadIdCol || !statusCol) return jsonOutput({ ok: true });
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][leadIdCol - 1]) === String(body.leadId)) {
      sh.getRange(i + 1, statusCol).setValue('Paid - booking ' + body.bookingId);
      break;
    }
  }
  return jsonOutput({ ok: true });
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Lets you open the deployed URL in a browser to sanity-check it's live.
function doGet() {
  return jsonOutput({ ok: true, message: 'Bikers Cafe sheet webhook is live.' });
}
