import { getRazorpay } from '../../lib/razorpay';
import { createPendingBooking } from '../../lib/db';

function rid(n) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { eventDate, slotTime, phone, email, guests, totalAmount, paidCount, childCount, leadId } = req.body;

    if (!eventDate || !phone || !email || !Array.isArray(guests) || guests.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid booking details' });
    }
    if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const bookingId = 'RT26-' + rid(5);
    const razorpay = getRazorpay();

    const order = await razorpay.orders.create({
      amount: totalAmount * 100, // paise
      currency: 'INR',
      receipt: bookingId,
      notes: { bookingId, eventDate, slotTime, phone, email },
    });

    // Persisting to Neon must not block checkout: if the DB isn't configured yet
    // (or is briefly unavailable), the Razorpay order still goes through.
    try {
      await createPendingBooking({
        bookingId,
        orderId: order.id,
        leadId,
        eventDate,
        slotTime,
        phone,
        email,
        guestCount: guests.length,
        childCount: childCount || 0,
        paidCount: paidCount ?? guests.length,
        totalAmount,
        guests: guests.map((g) => ({ name: g.name, age: g.age, gender: g.gender || null })),
      });
    } catch (dbErr) {
      console.error('createPendingBooking failed (continuing with payment):', dbErr.message);
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
