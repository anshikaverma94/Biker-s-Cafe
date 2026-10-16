import crypto from 'crypto';
import { markBookingFailed, getBookingIdByOrderId } from '../../lib/db';
import { finalizePaidBooking } from '../../lib/finalize';
import { logEvent, errInfo } from '../../lib/log';

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
    await logEvent({ source: 'webhook', event: 'rejected.no_secret_configured', level: 'error' });
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-razorpay-signature'];
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigOk = !!signature && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!sigOk) {
    // Most common cause: RAZORPAY_WEBHOOK_SECRET on the server differs from the secret in the Razorpay dashboard.
    await logEvent({ source: 'webhook', event: 'rejected.bad_signature', level: 'error', detail: { hasSignature: !!signature, bodyBytes: rawBody.length, ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress } });
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    await logEvent({ source: 'webhook', event: 'rejected.invalid_json', level: 'error' });
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const payment = event.payload?.payment?.entity;
  const orderId = payment?.order_id || event.payload?.order?.entity?.id;
  const base = { source: 'webhook', orderId, paymentId: payment?.id };
  await logEvent({ ...base, event: `received.${event.event}`, detail: { razorpayEventId: req.headers['x-razorpay-event-id'], paymentStatus: payment?.status, method: payment?.method } });

  // payment.captured is the main signal; order.paid carries the same payment and is a second chance.
  const isPaid = event.event === 'payment.captured' || event.event === 'order.paid';
  if (!isPaid && event.event !== 'payment.failed') return res.status(200).json({ received: true, ignored: event.event });
  if (!payment || !orderId) {
    await logEvent({ ...base, event: 'ignored.no_payment_entity', level: 'error', detail: { type: event.event } });
    return res.status(200).json({ received: true });
  }

  try {
    const bookingId = payment.notes?.bookingId || (await getBookingIdByOrderId(orderId));
    if (!bookingId) {
      await logEvent({ ...base, event: 'unresolved.no_booking_for_order', level: 'error' });
      return res.status(200).json({ received: true }); // nothing to retry against
    }

    if (event.event === 'payment.failed') {
      await markBookingFailed(bookingId);
      await logEvent({ ...base, bookingId, event: 'db.marked_failed', detail: { reason: payment.error_description } });
      return res.status(200).json({ received: true });
    }

    // Razorpay gives up on a webhook that takes more than a few seconds, and finalising (Sheet, email,
    // Facebook) can take ~5s. Acknowledge now; the work continues in this long-running server process
    // and every step is logged. If saving the payment itself fails, the reconcile job picks it up.
    res.status(200).json({ received: true });
    finalizePaidBooking({ bookingId, orderId, paymentId: payment.id, source: 'webhook' }).then(
      (r) => logEvent({ ...base, bookingId, event: 'processed', detail: { already: !!r.already, ok: r.ok } }),
      (err) => logEvent({ ...base, bookingId, event: 'processing_error', level: 'error', detail: errInfo(err) })
    );
    return;
  } catch (err) {
    // 500 on purpose: Razorpay retries failed webhooks for ~24h, and finalize is idempotent.
    await logEvent({ ...base, event: 'processing_error', level: 'error', detail: errInfo(err) });
    return res.status(500).json({ error: 'Processing failed' });
  }
}
