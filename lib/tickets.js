import crypto from 'crypto';
import QRCode from 'qrcode';

function secret() {
  const s = process.env.TICKET_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!s) throw new Error('TICKET_SECRET is not set');
  return s;
}

const sign = (no) => crypto.createHmac('sha256', secret()).update(no).digest('hex').slice(0, 12);

export const ticketNo = (bookingId, idx) => `${bookingId}-${String(idx).padStart(2, '0')}`;

// The QR encodes this signed code; it can't be forged without the server secret.
export const ticketCode = (bookingId, idx) => {
  const no = ticketNo(bookingId, idx);
  return `${no}.${sign(no)}`;
};

export function parseTicketCode(code) {
  const m = /^([A-Z0-9]+-[A-Z0-9]{5})-(\d{2})\.([0-9a-f]{12})$/.exec(String(code || '').trim());
  if (!m) return null;
  const no = `${m[1]}-${m[2]}`;
  const a = Buffer.from(sign(no));
  const b = Buffer.from(m[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { bookingId: m[1], idx: parseInt(m[2], 10) };
}

export async function buildTickets(bookingId, guests, eventDateLong) {
  return Promise.all(guests.map(async (g, i) => ({
    idx: i + 1,
    name: g.name, age: g.age, gender: g.gender,
    date: eventDateLong,
    no: ticketNo(bookingId, i + 1),
    qr: await QRCode.toDataURL(ticketCode(bookingId, i + 1), { margin: 1, width: 300, errorCorrectionLevel: 'M' }),
  })));
}

// Plain printed ticket number (no signature), e.g. "RT26-9QWRU-01". Only for the
// password-protected check-in endpoint, as a manual fallback when a QR can't be scanned.
export function parseTicketNo(input) {
  const m = /^([A-Z0-9]+-[A-Z0-9]{5})-(\d{2})$/.exec(String(input || '').trim().toUpperCase());
  return m ? { bookingId: m[1], idx: parseInt(m[2], 10) } : null;
}
