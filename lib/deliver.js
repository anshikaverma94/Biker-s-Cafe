import { getBookingWithGuests, claimTicketEmail, releaseTicketEmail } from './db';
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
