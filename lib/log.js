import { getPool } from './db';

// One structured line to stdout (pm2 logs) AND a row in Neon's payment_events table, so a
// payment can be traced afterwards:  SELECT * FROM payment_events WHERE booking_id='RT26-XXXXX' ORDER BY id;
// Never pass secrets or signatures in `detail`. Logging must never break a request.
export async function logEvent({ source, event, level = 'info', bookingId, orderId, paymentId, detail }) {
  const line = { t: new Date().toISOString(), source, event, level, bookingId, orderId, paymentId, detail };
  (level === 'error' ? console.error : console.log)('[payment]', JSON.stringify(line));
  try {
    await getPool().query(
      `INSERT INTO payment_events (source, event, level, booking_id, order_id, payment_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [source, event, level, bookingId || null, orderId || null, paymentId || null, detail ? JSON.stringify(detail) : null]
    );
  } catch (e) {
    console.error('[payment] could not persist log row:', e.message);
  }
}

export const errInfo = (e) => ({ message: e?.message, code: e?.code || e?.error?.code, status: e?.statusCode, description: e?.error?.description });
