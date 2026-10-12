import { verifySignature } from '../../lib/razorpay';
import { markBookingPaid, markBookingFailed, getBookingWithGuests } from '../../lib/db';
import { appendBookingToSheet, markLeadConverted } from '../../lib/sheets';
import { sendServerEvent } from '../../lib/fbConversions';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature, fbEventId, fbp, fbc, leadId,
    // Sent by the client as a fallback so Sheets/Pixel still work even if the DB row is missing.
    eventDate, slotTime, phone, email, totalAmount, guests,
  } = req.body;

  if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment fields' });
  }

  const valid = verifySignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });

  if (!valid) {
    await markBookingFailed(bookingId).catch(() => {});
    return res.status(400).json({ ok: false, error: 'Signature verification failed' });
  }

  // DB is a nice-to-have at this point: the signature already proves the payment is real,
  // so a missing/unavailable Neon database must not block confirming the booking.
  // `justPaid` is null if either the DB is unreachable, or (more importantly) the
  // Razorpay webhook already marked this booking paid moments ago — in that case
  // we must not re-append to Sheets / re-fire Purchase, to avoid duplicates.
  let justPaid = null;
  let alreadyProcessed = false;
  let guestRows = (guests || []).map((g) => ({ name: g.name, age: g.age, gender: g.gender || null }));

  try {
    justPaid = await markBookingPaid({ bookingId, paymentId: razorpay_payment_id, signature: razorpay_signature });
    const full = await getBookingWithGuests(bookingId);
    if (full) {
      guestRows = full.guests;
      alreadyProcessed = !justPaid && full.booking.status === 'paid';
    }
  } catch (dbErr) {
    console.error('DB update on verify-payment failed (continuing without it):', dbErr.message);
  }

  if (alreadyProcessed) {
    return res.status(200).json({ ok: true, bookingId, ticketCount: guestRows.length });
  }

  const finalEmail = justPaid?.email || email;
  const finalPhone = justPaid?.phone || phone;
  const finalAmount = justPaid?.total_amount ?? totalAmount;

  // Fire-and-forget side effects: a failure here must not block the paid confirmation.
  appendBookingToSheet({
    bookingId,
    orderId: razorpay_order_id,
    eventDate: justPaid?.event_date || eventDate,
    slotTime: justPaid?.slot_time || slotTime,
    phone: finalPhone,
    email: finalEmail,
    totalAmount: finalAmount,
    status: 'paid',
    guests: guestRows.map((g) => ({ name: g.name, age: g.age, gender: g.gender })),
  }).catch((e) => console.error('sheets append failed:', e));

  markLeadConverted({ leadId, bookingId }).catch((e) => console.error('mark lead converted failed:', e));

  sendServerEvent({
    eventName: 'Purchase',
    eventId: fbEventId || `purchase_${bookingId}`,
    email: finalEmail,
    phone: finalPhone,
    value: finalAmount,
    eventSourceUrl: process.env.NEXT_PUBLIC_SITE_URL,
    clientIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    fbp,
    fbc,
  }).catch((e) => console.error('fb purchase event failed:', e));

  return res.status(200).json({ ok: true, bookingId, ticketCount: guestRows.length });
}
