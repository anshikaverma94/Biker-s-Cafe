import { getPool } from './db';
import { getRazorpay } from './razorpay';
import { finalizePaidBooking } from './finalize';
import { logEvent, errInfo } from './log';

// Asks Razorpay about unpaid bookings (last 3 days, older than 1 minute) and finalises the ones
// whose order has a captured payment. Safe to run any number of times.
export async function reconcileUnpaid({ limit = 50 } = {}) {
  const { rows } = await getPool().query(
    `SELECT booking_id, order_id FROM bookings
      WHERE status IN ('created','failed') AND order_id IS NOT NULL
        AND created_at > now() - interval '3 days' AND created_at < now() - interval '1 minute'
      ORDER BY created_at DESC LIMIT $1`, [limit]
  );
  const rzp = getRazorpay();
  const out = { checked: rows.length, fixed: [], errors: [] };
  for (const r of rows) {
    try {
      const pays = await rzp.orders.fetchPayments(r.order_id);
      const paid = pays.items.find((p) => p.status === 'captured');
      if (!paid) continue;
      await logEvent({ source: 'reconcile', event: 'found_captured_payment', bookingId: r.booking_id, orderId: r.order_id, paymentId: paid.id, level: 'error', detail: { note: 'webhook/browser missed this payment' } });
      await finalizePaidBooking({ bookingId: r.booking_id, orderId: r.order_id, paymentId: paid.id, source: 'reconcile' });
      out.fixed.push(r.booking_id);
    } catch (e) {
      out.errors.push({ bookingId: r.booking_id, error: e.message });
      await logEvent({ source: 'reconcile', event: 'error', level: 'error', bookingId: r.booking_id, orderId: r.order_id, detail: errInfo(e) });
    }
  }
  return out;
}
