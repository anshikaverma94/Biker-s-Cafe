// Paste this whole file into Extensions > Apps Script (inside your Google Sheet),
// replace the SECRET value below, then deploy it as a Web App (see README-SHEETS.md).

var SECRET = 'replace-with-a-long-random-string'; // must match SHEETS_WEBHOOK_SECRET in .env.local

var LEADS_HEADERS = ['Timestamp', 'Lead ID', 'Event Date', 'Slot', 'Phone', 'Email', 'Guest Count', 'Status'];
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

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function addLead(body) {
  var sh = getOrCreateSheet('Leads', LEADS_HEADERS);
  sh.appendRow([
    new Date().toISOString(), body.leadId || '', body.eventDate || '', body.slotTime || '',
    body.phone || '', body.email || '', body.guestCount || '', 'Filled - not paid',
  ]);
  return jsonOutput({ ok: true });
}

function addBooking(body) {
  var sh = getOrCreateSheet('Bookings', BOOKINGS_HEADERS);
  var timestamp = new Date().toISOString();
  var guests = body.guests || [];
  for (var i = 0; i < guests.length; i++) {
    var g = guests[i];
    sh.appendRow([
      timestamp, body.bookingId || '', body.orderId || '', body.eventDate || '', body.slotTime || '',
      body.phone || '', body.email || '', g.name || '', g.age || '', g.gender || (g.isChild ? 'Child' : 'Adult'),
      body.totalAmount || '', body.status || '',
    ]);
  }
  return jsonOutput({ ok: true });
}

function markLeadConverted(body) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Leads');
  if (!sh) return jsonOutput({ ok: true }); // nothing to update yet, not an error
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(body.leadId)) {
      sh.getRange(i + 1, 8).setValue('Paid - booking ' + body.bookingId);
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
