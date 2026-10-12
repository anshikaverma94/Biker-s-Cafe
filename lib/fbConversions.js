import crypto from 'crypto';

const sha256 = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

// Sends a server-side event via Meta Conversions API (mirrors/backstops the browser pixel event).
export async function sendServerEvent({ eventName, eventId, email, phone, value, currency = 'INR', eventSourceUrl, clientIp, userAgent, fbp, fbc }) {
  const pixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID;
  const token = process.env.FB_CONVERSIONS_API_TOKEN;
  if (!pixelId || !token) return; // not configured, skip silently

  const body = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: eventSourceUrl,
        user_data: {
          em: email ? [sha256(email)] : undefined,
          ph: phone ? [sha256(phone)] : undefined,
          client_ip_address: clientIp,
          client_user_agent: userAgent,
          fbp: fbp || undefined,
          fbc: fbc || undefined,
        },
        custom_data: value != null ? { value, currency } : undefined,
      },
    ],
  };
  if (process.env.FB_TEST_EVENT_CODE) body.test_event_code = process.env.FB_TEST_EVENT_CODE;

  const url = `https://graph.facebook.com/v20.0/${pixelId}/events?access_token=${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('FB Conversions API error:', res.status, text);
  }
}
