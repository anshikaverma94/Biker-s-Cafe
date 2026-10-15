import { getBookingWithGuests } from '../../lib/db';
import { buildTickets } from '../../lib/tickets';
import { EVENT_DATE_LONG } from '../../lib/config';
import { rateLimit } from '../../lib/rateLimit';

// Retrieve tickets: booking id + the phone used at booking.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(req, res, { key: 'booking', max: 60, windowMs: 10 * 60 * 1000 })) return;
  const bookingId = String(req.body.bookingId || '').trim().toUpperCase();
  const phone = String(req.body.phone || '').trim();
  try {
    const full = await getBookingWithGuests(bookingId);
    if (!full || full.booking.status !== 'paid' || full.booking.phone !== phone) {
      return res.status(404).json({ error: 'No paid booking found for these details.' });
    }
    const tickets = await buildTickets(bookingId, full.guests, EVENT_DATE_LONG);
    return res.status(200).json({ bookingId, tickets });
  } catch (e) {
    console.error('booking lookup failed:', e);
    return res.status(500).json({ error: 'Could not fetch booking' });
  }
}
