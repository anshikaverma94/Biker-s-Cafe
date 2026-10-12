import crypto from 'crypto';
import { markBookingPaid, markBookingFailed, getBookingWithGuests, getBookingIdByOrderId } from '../../lib/db';
import { appendBookingToSheet, markLeadConverted } from '../../lib/sheets';
import { sendServerEvent } from '../../lib/fbConversions';

// Razorpay webhooks need the raw request body to verify the signature.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Server-to-server backup for payment confirmation: the browser-driven
// /api/verify-payment call is normally what confirms a booking, but if the
// user's tab closes/crashes right after paying, that call never happens even
// though Razorpay captured the money. This webhook catches that case.
//
// Configure in Razorpay Dashboard -> Settings -> Webhooks:
//   URL: https://<your-domain>/api/razorpay-webhook
//   Active events: payment.captured, payment.failed
//   Secret: put the same value in RAZORPAY_WEBHOOK_SECRET
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not set; rejecting webhook call');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-razorpay-signature'];
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (!signature || signature !== expected) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Acknowledge immediately for event types we don't act on.
  if (!['payment.captured', 'payment.failed'].includes(event.event)) {
    return res.status(200).json({ received: true });
  }

  const payment = event.payload?.payment?.entity;
  if (!payment) return res.status(200).json({ received: true });

  const bookingId = payment.notes?.bookingId || (await getBookingIdByOrderId(payment.order_id).catch(() => null));
  if (!bookingId) {
    console.error('Webhook: could not resolve bookingId for order', payment.order_id);
    return res.status(200).json({ received: true });
  }

  if (event.event === 'payment.failed') {
    await markBookingFailed(bookingId).catch((e) => console.error('markBookingFailed (webhook) failed:', e));
    return res.status(200).json({ received: true });
  }

  // payment.captured
  try {
    const justPaid = await markBookingPaid({
      bookingId,
      paymentId: payment.id,
      signature: 'webhook:' + payment.id, // the browser flow already verified a real HMAC; this just marks provenance
    });

    const full = await getBookingWithGuests(bookingId);
    if (!full) return res.status(200).json({ received: true }); // no DB row to work from, nothing more we can do

    const alreadyProcessed = !justPaid && full.booking.status === 'paid';
    if (alreadyProcessed) return res.status(200).json({ received: true }); // the client-side call already handled it

    appendBookingToSheet({
      bookingId,
      orderId: payment.order_id,
      eventDate: full.booking.event_date,
      slotTime: full.booking.slot_time,
      phone: full.booking.phone,
      email: full.booking.email,
      totalAmount: full.booking.total_amount,
      status: 'paid (via webhook)',
      guests: full.guests.map((g) => ({ name: g.name, age: g.age, gender: g.gender })),
    }).catch((e) => console.error('sheets append (webhook) failed:', e));

    markLeadConverted({ leadId: full.booking.lead_id, bookingId }).catch(() => {});

    sendServerEvent({
      eventName: 'Purchase',
      eventId: `purchase_${bookingId}`, // same id the client would have used, so Meta de-dupes if both fire
      email: full.booking.email,
      phone: full.booking.phone,
      value: full.booking.total_amount,
      eventSourceUrl: process.env.NEXT_PUBLIC_SITE_URL,
    }).catch((e) => console.error('fb purchase event (webhook) failed:', e));

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Still 200 — Razorpay retries on non-2xx, and retrying won't fix a code bug.
    return res.status(200).json({ received: true });
  }
}
