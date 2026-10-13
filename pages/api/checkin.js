import crypto from 'crypto';
import { parseTicketCode, parseTicketNo } from '../../lib/tickets';
import { checkInGuest } from '../../lib/db';
import { rateLimit } from '../../lib/rateLimit';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Door staff endpoint. Protected by CHECKIN_PASSWORD (sent as x-checkin-key).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(req, res, { key: 'checkin', max: 120, windowMs: 60 * 1000 })) return;
  const pw = process.env.CHECKIN_PASSWORD;
  if (!pw) return res.status(500).json({ error: 'CHECKIN_PASSWORD not configured' });
  if (!safeEq(req.headers['x-checkin-key'], pw)) return res.status(401).json({ error: 'Wrong password' });

  const parsed = parseTicketCode(req.body.code) || parseTicketNo(req.body.code);
  if (!parsed) return res.status(200).json({ status: 'invalid' });
  try {
    const r = await checkInGuest(parsed.bookingId, parsed.idx);
    const g = r.guest;
    return res.status(200).json({
      status: r.status,
      guest: g ? { name: g.name, age: g.age, gender: g.gender, checkedInAt: g.checked_in_at } : null,
      no: `${parsed.bookingId}-${String(parsed.idx).padStart(2, '0')}`,
    });
  } catch (e) {
    console.error('checkin failed:', e);
    return res.status(500).json({ error: 'Check-in failed' });
  }
}
