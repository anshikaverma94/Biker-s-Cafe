import crypto from 'crypto';
import { getPool } from '../../lib/db';
import { sendTicketsNow } from '../../lib/deliver';
import { logEvent, errInfo } from '../../lib/log';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Staff-only bulk/manual ticket email. Header: x-checkin-key: <CHECKIN_PASSWORD>
//   GET /api/send-tickets?dryRun=1            -> who WOULD get an email (default: paid bookings never emailed)
//   GET /api/send-tickets                     -> send to up to `limit` (default 20) of them; call again until remaining=0
//   GET /api/send-tickets?bookingId=RT26-XXXXX -> (re)send one booking, even if already emailed
//   GET /api/send-tickets?all=1&offset=0      -> re-send to EVERYONE paid, in pages (use offset += limit)
export default async function handler(req, res) {
  const pw = process.env.CHECKIN_PASSWORD;
  if (!pw || !safeEq(req.headers['x-checkin-key'], pw)) return res.status(401).json({ error: 'Unauthorized' });

  const { bookingId, all, dryRun } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const offset = parseInt(req.query.offset, 10) || 0;

  let where = `status='paid' AND tickets_emailed_at IS NULL`;
  const params = [];
  if (bookingId) { where = `status='paid' AND booking_id=$1`; params.push(String(bookingId).toUpperCase()); }
  else if (all) where = `status='paid'`;

  const total = (await getPool().query(`SELECT COUNT(*)::int AS n FROM bookings WHERE ${where}`, params)).rows[0].n;
  const { rows } = await getPool().query(
    `SELECT booking_id, email, guest_count, tickets_emailed_at FROM bookings WHERE ${where} ORDER BY id LIMIT ${limit} OFFSET ${all ? offset : 0}`,
    params
  );

  if (dryRun) {
    return res.status(200).json({
      dryRun: true, matching: total,
      showing: rows.map((r) => ({ bookingId: r.booking_id, email: r.email, tickets: r.guest_count, lastEmailed: r.tickets_emailed_at })),
    });
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return res.status(500).json({ error: 'RESEND_API_KEY / EMAIL_FROM are not set on the server' });
  }

  const out = { sent: [], failed: [] };
  for (const r of rows) {
    try {
      await sendTicketsNow(r.booking_id);
      out.sent.push(r.booking_id);
    } catch (e) {
      out.failed.push({ bookingId: r.booking_id, error: e.message });
      await logEvent({ source: 'email', event: 'tickets_email_failed', level: 'error', bookingId: r.booking_id, detail: { ...errInfo(e), manual: true } });
    }
    await sleep(600); // stay under Resend's rate limit (2 requests/second on the default plan)
  }
  return res.status(200).json({
    ...out,
    remaining: all ? Math.max(0, total - offset - rows.length) : Math.max(0, total - out.sent.length),
    nextOffset: all ? offset + rows.length : undefined,
  });
}
