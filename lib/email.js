// Sends the ticket email through Resend (https://resend.com) using plain fetch.
// Env: RESEND_API_KEY, EMAIL_FROM (e.g. "Bikers Cafe <tickets@yourdomain.com>").
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function sendTicketEmail({ to, bookingId, tickets, eventName, eventDateLong, venue }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('RESEND_API_KEY / EMAIL_FROM not set');

  const attachments = tickets.map((t) => ({
    filename: `${t.no}.png`,
    content: t.qr.split(',')[1],
    content_id: `qr${t.idx}`,
  }));
  const cards = tickets.map((t) => `
    <div style="border:1px solid #e3d7cd;border-radius:12px;padding:16px;margin:12px 0;display:flex;gap:16px;align-items:center">
      <img src="cid:qr${t.idx}" width="140" height="140" alt="QR ${esc(t.no)}" />
      <div><b style="font-size:18px">${esc(t.name)}</b><br>Age ${esc(t.age)} · ${esc(t.gender)}<br>
      <span style="font-family:monospace">${esc(t.no)}</span><br>Pass ${t.idx} of ${tickets.length}</div>
    </div>`).join('');

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
    <h2>${esc(eventName)} — you're in!</h2>
    <p>Booking <b>${esc(bookingId)}</b> · ${esc(eventDateLong)} · ${esc(venue)}</p>
    ${cards}
    <p>Show the QR at the entry. Each pass works once. Singles only · Traditional attire · Carry photo ID (18+).</p></div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: `Your passes — ${eventName} (${bookingId})`, html, attachments }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
