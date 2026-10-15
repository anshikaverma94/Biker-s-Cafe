import crypto from 'crypto';
import { getPool } from '../../lib/db';
import { getRazorpay } from '../../lib/razorpay';
import { finalizePaidBooking } from '../../lib/finalize';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Safety net: asks Razorpay about every unpaid booking from the last 3 days and finalises
// any whose order actually has a captured payment (tab closed, UPI app switch, missed webhook).
// Call it manually or from a scheduler:  GET /api/reconcile  with header  x-checkin-key: <CHECKIN_PASSWORD>
export default async function handler(req, res) {
  const pw = process.env.CHECKIN_PASSWORD;
  if (!pw || !safeEq(req.headers['x-checkin-key'], pw)) return res.status(401).json({ error: 'Unauthorized' });

  const { rows } = await getPool().query(
    `SELECT booking_id, order_id FROM bookings
      WHERE status IN ('created','failed') AND order_id IS NOT NULL AND created_at > now() - interval '3 days'`
  );
  const rzp = getRazorpay();
  const out = { checked: rows.length, fixed: [], errors: [] };
  for (const r of rows) {
    try {
      const pays = await rzp.orders.fetchPayments(r.order_id);
      const paid = pays.items.find((p) => p.status === 'captured');
      if (!paid) continue;
      await finalizePaidBooking({ bookingId: r.booking_id, orderId: r.order_id, paymentId: paid.id, source: 'reconcile' });
      out.fixed.push(r.booking_id);
    } catch (e) {
      out.errors.push({ bookingId: r.booking_id, error: e.message });
    }
  }
  return res.status(200).json(out);
}
