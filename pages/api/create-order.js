import { getRazorpay } from '../../lib/razorpay';
import { reserveBooking, setBookingOrderId, markBookingFailed, SeatsError } from '../../lib/db';
import { computeTotals, sanitizeGuests, EVENT_DATE_SHORT } from '../../lib/config';
import { rateLimit, clientIp } from '../../lib/rateLimit';

function rid(n) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!rateLimit(req, res, { key: 'order', max: 8, windowMs: 10 * 60 * 1000 })) return;

  try {
    const { phone, email, leadId } = req.body;
    const eventDate = EVENT_DATE_SHORT;
    const slotTime = '';

    if (!/^[6-9]\d{9}$/.test(String(phone || '')) || !/^\S+@\S+\.\S+$/.test(String(email || '')) || String(email).length > 200) {
      return res.status(400).json({ error: 'Invalid phone or email' });
    }
    const cleaned = sanitizeGuests(req.body.guests);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    const guests = cleaned.guests;
    // Price is always computed here; any amount sent by the client is ignored.
    const { total: totalAmount, totalPaise } = computeTotals(guests.length);

    const bookingId = 'RT26-' + rid(5);

    // The booking MUST be saved (and seats reserved) before we take any money.
    try {
      await reserveBooking({
        bookingId, leadId, eventDate, slotTime, phone, email,
        guestCount: guests.length, totalAmount, guests, ip: clientIp(req),
      });
    } catch (dbErr) {
      if (dbErr instanceof SeatsError) return res.status(409).json({ error: dbErr.message });
      console.error('reserveBooking failed:', dbErr);
      return res.status(503).json({ error: 'Booking is temporarily unavailable. Please try again shortly.' });
    }

    let order;
    try {
      order = await getRazorpay().orders.create({
        amount: totalPaise,
        currency: 'INR',
        receipt: bookingId,
        notes: { bookingId, eventDate, slotTime, phone, email },
      });
      await setBookingOrderId(bookingId, order.id);
    } catch (err) {
      await markBookingFailed(bookingId).catch(() => {}); // release the held seats
      throw err;
    }

    return res.status(200).json({
      bookingId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('create-order error:', err);
    return res.status(500).json({ error: 'Could not create order' });
  }
}
