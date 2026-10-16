import { appendLeadToSheet } from '../../lib/sheets';
import { sanitizeGuests } from '../../lib/config';
import { rateLimit } from '../../lib/rateLimit';
import { sendServerEvent } from '../../lib/fbConversions';

// Called once when the form becomes fully valid (details filled), before payment.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!rateLimit(req, res, { key: 'lead', max: 10, windowMs: 10 * 60 * 1000 })) return;
  const { leadId, eventDate, slotTime, phone, email, guestCount, guests, fbEventId, fbp, fbc } = req.body;
  if (!phone || !email) return res.status(400).json({ error: 'Missing contact details' });
  const guests = sanitizeGuests(req.body.guests).guests || [];

  try {
    await appendLeadToSheet({ leadId, eventDate, slotTime, phone, email, guestCount, guests }).catch((e) =>
      console.error('sheets lead append failed:', e)
    );

    await sendServerEvent({
      eventName: 'Lead',
      eventId: fbEventId,
      email,
      phone,
      eventSourceUrl: process.env.NEXT_PUBLIC_SITE_URL,
      clientIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      fbp,
      fbc,
    }).catch((e) => console.error('fb lead event failed:', e));

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead error:', err);
    return res.status(500).json({ error: 'Could not log lead' });
  }
}
