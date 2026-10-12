import { Pool } from '@neondatabase/serverless';

let pool;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function createPendingBooking({
  bookingId, orderId, leadId, eventDate, slotTime, phone, email,
  guestCount, childCount, paidCount, totalAmount, guests,
}) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO bookings
        (booking_id, order_id, lead_id, event_date, slot_time, phone, email, guest_count, child_count, paid_count, total_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'created')`,
      [bookingId, orderId, leadId || null, eventDate, slotTime, phone, email, guestCount, childCount, paidCount, totalAmount]
    );
    for (const g of guests) {
      await client.query(
        `INSERT INTO guests (booking_id, name, age, is_child, gender) VALUES ($1,$2,$3,$4,$5)`,
        [bookingId, g.name, g.age, !!g.isChild, g.gender || null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Idempotent: only flips status if it isn't already 'paid'. Both the client-side
// verify-payment call AND the Razorpay webhook call this for the same booking —
// whichever arrives first does the update; the other gets null back and must
// skip re-appending to Sheets / re-firing the Purchase pixel event.
export async function markBookingPaid({ bookingId, paymentId, signature }) {
  const db = getPool();
  const { rows } = await db.query(
    `UPDATE bookings
       SET status = 'paid', payment_id = $2, razorpay_signature = $3, updated_at = now()
     WHERE booking_id = $1 AND status != 'paid'
     RETURNING *`,
    [bookingId, paymentId, signature]
  );
  return rows[0] || null;
}

export async function markBookingFailed(bookingId) {
  const db = getPool();
  await db.query(
    `UPDATE bookings SET status = 'failed', updated_at = now() WHERE booking_id = $1`,
    [bookingId]
  );
}

export async function getBookingIdByOrderId(orderId) {
  const db = getPool();
  const { rows } = await db.query(`SELECT booking_id FROM bookings WHERE order_id = $1`, [orderId]);
  return rows[0]?.booking_id || null;
}

export async function getBookingWithGuests(bookingId) {
  const db = getPool();
  const b = await db.query(`SELECT * FROM bookings WHERE booking_id = $1`, [bookingId]);
  if (!b.rows[0]) return null;
  const g = await db.query(`SELECT * FROM guests WHERE booking_id = $1 ORDER BY id`, [bookingId]);
  return { booking: b.rows[0], guests: g.rows };
}
