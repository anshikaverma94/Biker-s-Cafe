import { markBookingPaid, getBookingWithGuests } from './db';
import { appendBookingToSheet, markLeadConverted } from './sheets';
import { sendServerEvent } from './fbConversions';
import { deliverTickets } from './deliver';

// Shared by the Razorpay webhook and the reconcile job: marks a booking paid and runs the
// side effects exactly once. Side effects are AWAITED — on serverless hosts, un-awaited
// promises can be killed as soon as the response is sent, which loses Sheet updates.
export async function finalizePaidBooking({ bookingId, orderId, paymentId, source }) {
  const justPaid = await markBookingPaid({ bookingId, paymentId, signature: `${source}:${paymentId}` });
  const full = await getBookingWithGuests(bookingId);
  if (!full) return { ok: false, reason: 'no booking row' };

  await deliverTickets(bookingId); // emails once, no-op if already sent
  const alreadyProcessed = !justPaid && full.booking.status === 'paid';
  if (alreadyProcessed) return { ok: true, already: true };

  const b = full.booking;
  const log = (what) => (e) => console.error(`${what} (${source}) failed:`, e);
  await Promise.allSettled([
    appendBookingToSheet({
      bookingId, orderId, eventDate: b.event_date, slotTime: b.slot_time, phone: b.phone, email: b.email,
      totalAmount: Number(b.total_amount), status: source === 'webhook' ? 'paid (via webhook)' : `paid (via ${source})`,
      guests: full.guests.map((g) => ({ name: g.name, age: g.age, gender: g.gender })),
    }).catch(log('sheets append')),
    markLeadConverted({ leadId: b.lead_id, bookingId }).catch(log('mark lead converted')),
    sendServerEvent({
      eventName: 'Purchase', eventId: `purchase_${bookingId}`, email: b.email, phone: b.phone,
      value: Number(b.total_amount), eventSourceUrl: process.env.NEXT_PUBLIC_SITE_URL,
    }).catch(log('fb purchase')),
  ]);
  return { ok: true, already: false };
}
