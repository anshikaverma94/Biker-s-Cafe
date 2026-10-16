import crypto from 'crypto';
import { getPool } from '../../lib/db';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Debug trail:  curl -H "x-checkin-key: <CHECKIN_PASSWORD>" "https://<site>/api/payment-events?bookingId=RT26-XXXXX"
// Optional filters: orderId, paymentId, level=error, limit (default 100).
export default async function handler(req, res) {
  const pw = process.env.CHECKIN_PASSWORD;
  if (!pw || !safeEq(req.headers['x-checkin-key'], pw)) return res.status(401).json({ error: 'Unauthorized' });
  const { bookingId, orderId, paymentId, level } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const { rows } = await getPool().query(
    `SELECT id, created_at, source, event, level, booking_id, order_id, payment_id, detail FROM payment_events
      WHERE ($1::text IS NULL OR booking_id=$1) AND ($2::text IS NULL OR order_id=$2)
        AND ($3::text IS NULL OR payment_id=$3) AND ($4::text IS NULL OR level=$4)
      ORDER BY id DESC LIMIT $5`,
    [bookingId || null, orderId || null, paymentId || null, level || null, limit]
  );
  return res.status(200).json({ count: rows.length, events: rows });
}
