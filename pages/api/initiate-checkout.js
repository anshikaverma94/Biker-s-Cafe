import { sendServerEvent } from '../../lib/fbConversions';

// Called right when the user clicks "Pay now" (order created, Razorpay sheet about to open).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, phone, totalAmount, fbEventId, fbp, fbc } = req.body;

  try {
    await sendServerEvent({
      eventName: 'InitiateCheckout',
      eventId: fbEventId,
      email,
      phone,
      value: totalAmount,
      eventSourceUrl: process.env.NEXT_PUBLIC_SITE_URL,
      clientIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      fbp,
      fbc,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('initiate-checkout event error:', err);
    return res.status(500).json({ error: 'Could not log event' });
  }
}
