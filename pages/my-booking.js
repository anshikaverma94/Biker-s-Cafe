import Head from 'next/head';
import { useState } from 'react';

export default function MyBooking() {
  const [bookingId, setBookingId] = useState('');
  const [phone, setPhone] = useState('');
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function find(e) {
    e.preventDefault();
    setError(''); setTickets(null); setLoading(true);
    try {
      const res = await fetch('/api/booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, phone }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Not found');
      setTickets(data.tickets);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  const input = { height: 50, border: '1.5px solid rgba(232,160,124,.35)', borderRadius: 10, padding: '0 14px', fontSize: 17, width: '100%', background: '#1E1A1B', color: '#F5EEE8', fontFamily: 'inherit' };
  const lab = { fontSize: 12, textTransform: 'uppercase', letterSpacing: '.1em', opacity: .8 };
  return (
    <>
      <Head>
        <title>My Booking · Garba Gone Single</title>
        <link rel="icon" type="image/png" href="/assets/bikers-cafe-logo.png" />
        <meta name="robots" content="noindex,nofollow" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Rozha+One&family=Mukta:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <style>{`html,body{margin:0;background:#141213;color:#F5EEE8;font-family:'Mukta',system-ui,sans-serif;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}input:focus,button:focus-visible{outline:2px solid #E8A07C;outline-offset:1px}`}</style>
      </Head>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', height: 6 }}>
        {['#F07A1A', '#FFFFFF', '#D7262E', '#1F3FA8', '#F6C21B', '#2E8B3E', '#8A8A8A', '#6B2C91', '#0E8C88'].map((c, i) => <div key={i} style={{ background: c }}></div>)}
      </div>
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px 48px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <img src="/assets/bikers-cafe-logo.png" alt="" width={48} height={48} style={{ borderRadius: '50%', boxShadow: '0 0 0 2px #E8A07C' }} />
          <div><div style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#CFC4BC' }}>Garba Gone Single · Biker's Cafe</div>
          <h1 style={{ margin: 0, fontFamily: "'Rozha One',serif", fontWeight: 400, fontSize: 30, lineHeight: 1.1 }}>Find your passes</h1></div>
        </header>
        <form onSubmit={find} style={{ display: 'grid', gap: 12 }}>
          <input style={input} placeholder="Booking ID (e.g. RT26-AB3CD)" value={bookingId} onChange={(e) => setBookingId(e.target.value)} required />
          <input style={input} placeholder="Mobile number used at booking" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} required />
          <button disabled={loading} style={{ height: 52, border: 0, borderRadius: 14, background: '#D0262C', color: '#fff', font: "700 18px 'Mukta',sans-serif", cursor: 'pointer', boxShadow: '0 4px 0 #7A1519', width: '100%' }}>{loading ? 'Searching…' : 'Show my passes'}</button>
        </form>
        {error && <div style={{ background: '#3A1A1B', border: '1px solid #D0262C', borderRadius: 12, padding: '12px 14px', color: '#FFDAD6' }}>{error}</div>}
        {tickets && tickets.map((t) => (
          <div key={t.idx} style={{ display: 'flex', flexWrap: 'wrap', borderRadius: 18, overflow: 'hidden', background: '#FBF7F3', color: '#1E1A1B', boxShadow: '0 18px 40px rgba(0,0,0,.35)' }}>
            <div style={{ flex: '1 1 240px', background: '#B3242A', color: '#FFF3EC', backgroundImage: 'radial-gradient(circle,rgba(255,255,255,.13) 1.4px,transparent 2px)', backgroundSize: '18px 18px', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontFamily: "'Rozha One',serif", fontSize: 28, lineHeight: 1.05 }}>Garba Gone Single</span>
              <div><span style={lab}>Guest</span><div style={{ fontSize: 19, fontWeight: 700 }}>{t.name}</div></div>
              <div style={{ display: 'flex', gap: 24 }}><div><span style={lab}>Age</span><div style={{ fontWeight: 700 }}>{t.age}</div></div><div><span style={lab}>Gender</span><div style={{ fontWeight: 700 }}>{t.gender}</div></div></div>
              <div><span style={lab}>Date</span><div style={{ fontWeight: 700 }}>{t.date}</div></div>
            </div>
            <div style={{ flex: '0 1 200px', margin: '0 auto', padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderLeft: '2px dashed #D6C5B8' }}>
              <img src={t.qr} alt={`QR ${t.no}`} width={150} height={150} />
              <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 14, fontWeight: 600 }}>{t.no}</span>
              <span style={{ fontSize: 13, color: '#6A5E5A' }}>Pass {t.idx} of {tickets.length}</span>
            </div>
          </div>
        ))}
      </main>
    </>
  );
}
