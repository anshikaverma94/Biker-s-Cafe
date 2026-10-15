import { Pool } from '@neondatabase/serverless';
import { TOTAL_SEATS, DISPLAY_SEATS_FLOOR, HOLD_MINUTES, MAX_HOLDS_PER_IP } from './config';

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

export const SeatsError = class extends Error {};

const HELD = `(status = 'paid' OR (status = 'created' AND created_at > now() - make_interval(mins => $1)))`;

export async function getSeatsLeft() {
  const { rows } = await getPool().query(
    `SELECT COALESCE(SUM(guest_count),0)::int AS taken FROM bookings WHERE ${HELD}`,
    [HOLD_MINUTES]
  );
  // Display only: counts down from TOTAL_SEATS but never shows below the floor,
  // even once real bookings (uncapped below) push taken past TOTAL_SEATS.
  return Math.max(DISPLAY_SEATS_FLOOR, TOTAL_SEATS - rows[0].taken);
}

// Atomically checks seat availability and reserves the seats (an unpaid booking holds them
// for HOLD_MINUTES). The Razorpay order id is attached afterwards via setBookingOrderId.
export async function reserveBooking({
  bookingId, leadId, eventDate, slotTime, phone, email, guestCount, totalAmount, guests, ip,
}) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7426001)'); // serialise seat counting
    // A retry from the same phone supersedes its own earlier unpaid attempts.
    await client.query(`UPDATE bookings SET status='failed', updated_at=now() WHERE phone=$1 AND status='created'`, [phone]);
    if (ip) {
      const held = await client.query(
        `SELECT COUNT(*)::int AS n FROM bookings WHERE ip=$1 AND status='created' AND created_at > now() - make_interval(mins => $2)`,
        [ip, HOLD_MINUTES]
      );
      if (held.rows[0].n >= MAX_HOLDS_PER_IP) throw new SeatsError('Too many pending bookings. Please try again in a few minutes.');
    }
    // No real capacity cap: bookings keep being accepted past TOTAL_SEATS — only the
    // displayed "seats left" count (getSeatsLeft) freezes at DISPLAY_SEATS_FLOOR.
    await client.query(
      `INSERT INTO bookings
        (booking_id, lead_id, event_date, slot_time, phone, email, guest_count, child_count, paid_count, total_amount, status, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$7,$8,'created',$9)`,
      [bookingId, leadId || null, eventDate, slotTime, phone, email, guestCount, totalAmount, ip || null]
    );
    for (const g of guests) {
      await client.query(
        `INSERT INTO guests (booking_id, name, age, is_child, gender) VALUES ($1,$2,$3,false,$4)`,
        [bookingId, g.name, g.age, g.gender]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // Housekeeping: abandoned unpaid rows are of no use after a day.
  getPool().query(`DELETE FROM bookings WHERE status='created' AND created_at < now() - interval '1 day'`).catch(() => {});
}

export async function setBookingOrderId(bookingId, orderId) {
  await getPool().query(`UPDATE bookings SET order_id=$2, updated_at=now() WHERE booking_id=$1`, [bookingId, orderId]);
}

// Atomically claims the right to email tickets (so webhook + browser flow never double-send).
export async function claimTicketEmail(bookingId) {
  const { rows } = await getPool().query(
    `UPDATE bookings SET tickets_emailed_at=now() WHERE booking_id=$1 AND status='paid' AND tickets_emailed_at IS NULL RETURNING booking_id`,
    [bookingId]
  );
  return rows.length > 0;
}
export async function markTicketsEmailed(bookingId) {
  await getPool().query(`UPDATE bookings SET tickets_emailed_at=now() WHERE booking_id=$1`, [bookingId]);
}
export async function releaseTicketEmail(bookingId) {
  await getPool().query(`UPDATE bookings SET tickets_emailed_at=NULL WHERE booking_id=$1`, [bookingId]);
}

export async function getPaidBookingByPhone(bookingId, phone) {
  const { rows } = await getPool().query(`SELECT booking_id FROM bookings WHERE booking_id=$1 AND phone=$2 AND status='paid'`, [bookingId, phone]);
  return rows.length > 0;
}

// Marks the nth guest (1-based) of a paid booking as checked in. Returns { status, guest }.
export async function checkInGuest(bookingId, n) {
  const db = getPool();
  const b = await db.query(`SELECT status FROM bookings WHERE booking_id=$1`, [bookingId]);
  if (!b.rows[0] || b.rows[0].status !== 'paid') return { status: 'invalid' };
  const g = await db.query(`SELECT * FROM guests WHERE booking_id=$1 ORDER BY id OFFSET $2 LIMIT 1`, [bookingId, n - 1]);
  const guest = g.rows[0];
  if (!guest) return { status: 'invalid' };
  const upd = await db.query(`UPDATE guests SET checked_in_at=now() WHERE id=$1 AND checked_in_at IS NULL RETURNING checked_in_at`, [guest.id]);
  if (!upd.rows[0]) return { status: 'used', guest };
  return { status: 'ok', guest };
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
