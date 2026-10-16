import { verifySignature, getRazorpay } from '../../lib/razorpay';
import { EVENT_DATE_LONG } from '../../lib/config';
import { buildTickets } from '../../lib/tickets';
import { finalizePaidBooking } from '../../lib/finalize';
import { logEvent, errInfo } from '../../lib/log';

// Called by the browser right after Razorpay's checkout succeeds. The Razorpay webhook and the
// reconcile job do the same work if this call never arrives, so everything here is idempotent.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature, fbp, fbc } = req.body;
  const ids = { source: 'verify', bookingId, orderId: razorpay_order_id, paymentId: razorpay_payment_id };

  if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    await logEvent({ ...ids, event: 'rejected.missing_fields', level: 'error' });
    return res.status(400).json({ error: 'Missing payment fields' });
  }
  await logEvent({ ...ids, event: 'received' });

  const valid = verifySignature({ orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature });
  if (!valid) {
    // Don't flip the booking to failed on an unverifiable call; a real payment is still picked up by the webhook/reconcile.
    await logEvent({ ...ids, event: 'rejected.bad_signature', level: 'error' });
    return res.status(400).json({ ok: false, error: 'Signature verification failed' });
  }

  // Extra check that the order belongs to this booking. A Razorpay API hiccup must NOT block a
  // customer whose signature is already valid, so only a definite mismatch is fatal.
  try {
    const order = await getRazorpay().orders.fetch(razorpay_order_id);
    if (order.receipt !== bookingId) {
      await logEvent({ ...ids, event: 'rejected.order_mismatch', level: 'error', detail: { receipt: order.receipt } });
      return res.status(400).json({ ok: false, error: 'Order mismatch' });
    }
  } catch (e) {
    await logEvent({ ...ids, event: 'order_fetch.failed_continuing', level: 'error', detail: errInfo(e) });
  }

  try {
    const r = await finalizePaidBooking({
      bookingId, orderId: razorpay_order_id, paymentId: razorpay_payment_id, source: 'verify',
      fb: { fbp, fbc, clientIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress, userAgent: req.headers['user-agent'] },
    });
    if (!r.ok) return res.status(500).json({ ok: false, error: 'Booking not found' });
    const tickets = await buildTickets(bookingId, r.guests, EVENT_DATE_LONG);
    await logEvent({ ...ids, event: 'responded.ok', detail: { tickets: tickets.length, already: !!r.already } });
    return res.status(200).json({ ok: true, bookingId, ticketCount: tickets.length, tickets });
  } catch (err) {
    // The payment IS valid. Tell the client to keep checking; the webhook/reconcile will finish the job.
    await logEvent({ ...ids, event: 'finalize_error', level: 'error', detail: errInfo(err) });
    return res.status(500).json({ ok: false, pending: true, error: 'Payment received, confirmation in progress' });
  }
}
