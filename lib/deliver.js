import { getBookingWithGuests, claimTicketEmail, releaseTicketEmail, markTicketsEmailed } from './db';
import { buildTickets } from './tickets';
import { sendTicketEmail } from './email';
import { logEvent, errInfo } from './log';
import { EVENT_NAME, EVENT_DATE_LONG, VENUE } from './config';

// Emails tickets exactly once per booking. Never throws.
export async function deliverTickets(bookingId) {
  try {
    if (!(await claimTicketEmail(bookingId))) return;
    try {
      const full = await getBookingWithGuests(bookingId);
      const tickets = await buildTickets(bookingId, full.guests, EVENT_DATE_LONG);
      await sendTicketEmail({ to: full.booking.email, bookingId, tickets, eventName: EVENT_NAME, eventDateLong: EVENT_DATE_LONG, venue: VENUE });
      await logEvent({ source: 'email', event: 'tickets_emailed', bookingId });
    } catch (e) {
      await releaseTicketEmail(bookingId).catch(() => {});
      throw e;
    }
  } catch (e) {
    await logEvent({ source: 'email', event: 'tickets_email_failed', level: 'error', bookingId, detail: errInfo(e) });
  }
}

// Sends (or re-sends) the ticket email for a paid booking regardless of whether it was sent before.
// Used by the bulk/manual send endpoint. Throws on failure.
export async function sendTicketsNow(bookingId) {
  const full = await getBookingWithGuests(bookingId);
  if (!full || full.booking.status !== 'paid') throw new Error('booking is not paid');
  const tickets = await buildTickets(bookingId, full.guests, EVENT_DATE_LONG);
  await sendTicketEmail({ to: full.booking.email, bookingId, tickets, eventName: EVENT_NAME, eventDateLong: EVENT_DATE_LONG, venue: VENUE });
  await markTicketsEmailed(bookingId);
  await logEvent({ source: 'email', event: 'tickets_emailed', bookingId, detail: { manual: true } });
}
