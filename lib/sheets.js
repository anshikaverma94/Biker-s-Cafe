// Talks to a Google Apps Script Web App deployed from google-apps-script/Code.gs,
// which lives inside the target Google Sheet. No GCP project or service account needed.

async function callWebhook(action, payload) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error('SHEETS_WEBHOOK_URL / SHEETS_WEBHOOK_SECRET are not set');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Apps Script web apps issue a redirect on POST; fetch follows it by default.
    body: JSON.stringify({ action, secret, ...payload }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Sheet webhook returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!data.ok) throw new Error(data.error || 'Sheet webhook reported failure');
  return data;
}

// Logs every person who filled the form, whether or not they go on to pay.
export async function appendLeadToSheet({ leadId, eventDate, slotTime, phone, email, guestCount, guests = [] }) {
  // One cell per column; with several guests the values are comma-separated in the same order.
  const join = (k) => guests.map((g) => g[k]).join(', ');
  return callWebhook('addLead', {
    leadId, eventDate, slotTime, phone, email, guestCount,
    guestNames: join('name'), guestAges: join('age'), guestGenders: join('gender'),
  });
}

// Appends one row per guest — every completed (paid) booking lands here.
export async function appendBookingToSheet({
  bookingId, orderId, paymentId, eventDate, slotTime, phone, email, totalAmount, status, guests,
}) {
  return callWebhook('addBooking', { bookingId, orderId, paymentId, eventDate, slotTime, phone, email, totalAmount, status, guests });
}

// Finds the lead row by its Lead ID and flips its status to "Paid", so the
// Leads tab always shows who dropped off vs. who converted, without duplicates.
export async function markLeadConverted({ leadId, bookingId }) {
  if (!leadId) return;
  return callWebhook('markLeadConverted', { leadId, bookingId });
}
