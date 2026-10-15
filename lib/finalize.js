import { markBookingPaid, getBookingWithGuests } from './db';
import { appendBookingToSheet, markLeadConverted } from './sheets';
import { sendServerEvent } from './fbConversions';
import { deliverTickets } from './deliver';
import { logEvent, errInfo } from './log';

// Single place that turns "Razorpay says this payment is captured" into: DB paid + payment id,
// Sheet row, lead row, ticket email, Purchase event. Used by the webhook, the browser
// confirmation and the reconcile job, so all three behave identically. Idempotent.
// Side effects are AWAITED so nothing is lost if the process is cut off after replying.
export async function finalizePaidBooking({ bookingId, orderId, paymentId, source, fb = {} }) {
  const base = { source, bookingId, orderId, paymentId };
  const justPaid = await markBookingPaid({ bookingId, paymentId, signature: `${source}:${paymentId}` });
  const full = await getBookingWithGuests(bookingId);
  if (!full) {
    await logEvent({ ...base, event: 'finalize.no_booking_row', level: 'error' });
    return { ok: false, reason: 'no booking row' };
  }
  await logEvent({ ...base, event: justPaid ? 'db.marked_paid' : 'db.already_paid', detail: { status: full.booking.status } });

  await deliverTickets(bookingId); // emails once; no-op if already sent
  if (!justPaid && full.booking.status === 'paid') return { ok: true, already: true, booking: full.booking, guests: full.guests };

  const b = full.booking;
  const step = (name, p) => p.then(
    () => logEvent({ ...base, event: `${name}.ok` }),
    (e) => logEvent({ ...base, event: `${name}.failed`, level: 'error', detail: errInfo(e) })
  );
  await Promise.all([
    step('sheet.booking', appendBookingToSheet({
      bookingId, orderId, eventDate: b.event_date, slotTime: b.slot_time, phone: b.phone, email: b.email,
      totalAmount: Number(b.total_amount), status: source === 'webhook' ? 'paid (via webhook)' : `paid (via ${source})`,
      paymentId,
      guests: full.guests.map((g) => ({ name: g.name, age: g.age, gender: g.gender })),
    })),
    step('sheet.lead', markLeadConverted({ leadId: b.lead_id, bookingId })),
    step('fb.purchase', sendServerEvent({
      eventName: 'Purchase', eventId: `purchase_${bookingId}`, email: b.email, phone: b.phone,
      value: Number(b.total_amount), eventSourceUrl: process.env.NEXT_PUBLIC_SITE_URL, ...fb,
    })),
  ]);
  return { ok: true, already: false, booking: b, guests: full.guests };
}
