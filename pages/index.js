import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PRICE, DISPLAY_ORIGINAL_PRICE, MAX_QTY, TOTAL_SEATS, GENDERS, EVENT_NAME, EVENT_DATE_SHORT, EVENT_DATE_LONG, VENUE, MIN_AGE, MAX_AGE, computeTotals } from '../lib/config';
import { genEventId, trackStandardPixel, fbCookies } from '../lib/pixel';

const METHODS = [
  { id: 'upi', label: 'UPI', sub: 'GPay, PhonePe, Paytm' },
  { id: 'card', label: 'Card', sub: 'Visa, Mastercard, RuPay' },
  { id: 'nb', label: 'Netbanking', sub: 'All major banks' },
];

const inr = (n) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Home() {
  const [people, setPeople] = useState([{ name: '', age: '', gender: '' }]);
  const [quantity, setQuantity] = useState(1);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState([]);
  const [stage, setStage] = useState('form'); // form | checkout | processing | failed | success
  const [bookingId, setBookingId] = useState('');
  const [orderInfo, setOrderInfo] = useState(null);
  const [ticketSnapshot, setTicketSnapshot] = useState(null);
  const [notified, setNotified] = useState(false);
  const [seatsLeft, setSeatsLeft] = useState(TOTAL_SEATS);
  const [serverError, setServerError] = useState('');
  const [maleLimitNotice, setMaleLimitNotice] = useState(false);
  const [entryType, setEntryType] = useState('stag'); // stag | group
  const leadFiredRef = useRef(false);
  const rzpOpenRef = useRef(false);
  const leadIdRef = useRef(null);

  const { subtotal, gst, total } = computeTotals(quantity);

  const refreshSeats = () => fetch('/api/seats').then((r) => r.json()).then((d) => { if (typeof d.seatsLeft === 'number') setSeatsLeft(d.seatsLeft); }).catch(() => {});
  useEffect(() => { refreshSeats(); }, []);
  const soldOut = seatsLeft <= 0;
  const maxQty = Math.max(1, Math.min(MAX_QTY, seatsLeft));
  useEffect(() => { if (quantity > maxQty) setQuantity(maxQty); }, [maxQty]); // eslint-disable-line react-hooks/exhaustive-deps

  // One details row per pass: keep the array in step with the quantity.
  useEffect(() => {
    setPeople((p) => Array.from({ length: quantity }, (_, i) => p[i] || { name: '', age: '', gender: '' }));
  }, [quantity]);

  const updatePerson = (i, patch) => { setPeople((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x))); setErrors([]); };
  const selectEntryType = (type) => {
    setEntryType(type);
    if (type === 'stag') setPeople((p) => p.map((x) => (x.gender === 'Male' ? { ...x, gender: '' } : x)));
    setErrors([]);
  };
  const personProblem = (g) => {
    const a = parseInt(g.age, 10);
    if (g.name.trim().length < 2) return 'name';
    if (isNaN(a) || a < MIN_AGE || a > MAX_AGE) return 'age';
    if (!GENDERS.includes(g.gender)) return 'gender';
    return null;
  };

  const isFormValid = useMemo(() => {
    if (people.length !== quantity || people.some(personProblem)) return false;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY || quantity > seatsLeft) return false;
    if (!/^[6-9]\d{9}$/.test(phone)) return false;
    if (!/^\S+@\S+\.\S+$/.test(email)) return false;
    if (!agree) return false;
    return true;
  }, [people, quantity, seatsLeft, phone, email, agree]);

  // Fire the "details filled" Lead event once, the first time the whole form becomes valid.
  useEffect(() => {
    if (isFormValid && !leadFiredRef.current) {
      leadFiredRef.current = true;
      const leadId = genEventId('lead');
      leadIdRef.current = leadId;
      trackStandardPixel('Lead', leadId, { content_name: 'Garba Gone Single booking form' });
      const { fbp, fbc } = fbCookies();
      fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId, eventDate: EVENT_DATE_SHORT, slotTime: '', phone, email, guestCount: quantity,
          guests: buildGuests(), fbEventId: leadId, fbp, fbc,
        }),
      }).catch(() => {});
    }
  }, [isFormValid]); // eslint-disable-line react-hooks/exhaustive-deps

  function validate() {
    const e = [];
    people.forEach((g, i) => {
      const pr = personProblem(g);
      const who = quantity > 1 ? `Guest ${i + 1}: ` : '';
      if (pr === 'name') e.push(who + 'enter the full name.');
      if (pr === 'age') e.push(who + 'this is a singles-only, 18+ event — enter a valid age.');
      if (pr === 'gender') e.push(who + 'select a gender.');
    });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) e.push(`Choose between 1 and ${MAX_QTY} passes.`);
    if (soldOut) e.push('Sold out.');
    else if (quantity > seatsLeft) e.push(`Only ${seatsLeft} passes left.`);
    if (!/^[6-9]\d{9}$/.test(phone)) e.push('Enter a valid 10-digit mobile number.');
    if (!/^\S+@\S+\.\S+$/.test(email)) e.push('Enter a valid email address.');
    if (!agree) e.push('Please accept the eligibility, dress code and house rules.');
    return e;
  }

  function buildGuests() {
    return people.map((g) => ({ name: g.name.trim(), age: parseInt(g.age, 10), gender: g.gender }));
  }

  async function payNow() {
    const e = validate();
    if (e.length) return setErrors(e);

    const eventId = genEventId('checkout');
    trackStandardPixel('InitiateCheckout', eventId, { value: total, currency: 'INR' });

    rzpOpenRef.current = false;
    setStage('checkout');
    try {
      const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventDate: EVENT_DATE_SHORT, slotTime: '', phone, email,
          guests: buildGuests(),
                    leadId: leadIdRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Business errors (sold out, too many holds, bad input) go back to the form, not the payment-failed screen.
        if ([400, 409, 429].includes(res.status)) {
          setServerError(data.error || 'Could not start payment.');
          setErrors([data.error || 'Could not start payment.']);
          setStage('form');
          refreshSeats();
          return;
        }
        throw new Error(data.error || 'Order creation failed');
      }
      setBookingId(data.bookingId);
      setOrderInfo(data);

      const { fbp, fbc } = fbCookies();
      fetch('/api/initiate-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone, totalAmount: total, fbEventId: eventId, fbp, fbc }),
      }).catch(() => {});
    } catch (err) {
      console.error(err);
      setStage('failed');
    }
  }

  function openRazorpay() {
    if (!orderInfo || typeof window === 'undefined' || !window.Razorpay) return;
    if (rzpOpenRef.current) return; // never open two checkout windows
    rzpOpenRef.current = true;
    const rzp = new window.Razorpay({
      key: orderInfo.keyId,
      amount: orderInfo.amount,
      currency: orderInfo.currency,
      order_id: orderInfo.orderId,
      name: 'The Bikers Cafe',
      description: 'Garba Gone Single — Singles Only Garba Night',
      prefill: { contact: '+91' + phone, email },
      theme: { color: '#D0262C' },
      handler: async (response) => {
        setStage('processing');
        try {
          const { fbp, fbc } = fbCookies();
          const purchaseEventId = genEventId('purchase');
          const res = await fetch('/api/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              fbEventId: purchaseEventId, fbp, fbc, leadId: leadIdRef.current,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Verification failed');

          trackStandardPixel('Purchase', purchaseEventId, { value: total, currency: 'INR' });
          setTicketSnapshot(data.tickets);
          setStage('success');
          setTimeout(() => setNotified(true), 1600);
        } catch (err) {
          console.error(err);
          setStage('failed');
        }
      },
      modal: { ondismiss: () => { rzpOpenRef.current = false; setStage('failed'); } },
    });
    rzp.on('payment.failed', () => { rzpOpenRef.current = false; setStage('failed'); });
    rzp.open();
  }

  useEffect(() => {
    if (stage === 'checkout' && orderInfo) openRazorpay();
  }, [stage, orderInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetAll() {
    setStage('form');
    setPeople([{ name: '', age: '', gender: '' }]);
    setQuantity(1);
    setAgree(false);
    setErrors([]);
    setBookingId('');
    setOrderInfo(null);
    rzpOpenRef.current = false;
    setTicketSnapshot(null);
    setNotified(false);
    refreshSeats();
    leadFiredRef.current = false;
    leadIdRef.current = null;
    window.scrollTo(0, 0);
  }

  const hasErrors = errors.length > 0;
  const showCheckout = ['checkout', 'processing', 'failed'].includes(stage);
  const isChoosing = stage === 'checkout' || stage === 'failed';
  const showSuccess = stage === 'success';

  function scrollToBook() {
    const el = document.getElementById('book');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  }

  return (
    <>
      <Head>
        <title>Garba Gone Single · Biker's Cafe &amp; Social Nxt</title>
        <link rel="icon" type="image/png" href="/assets/bikers-cafe-logo.png" />
        <link rel="apple-touch-icon" href="/assets/bikers-cafe-logo.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Rozha+One&family=Mukta:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <style jsx global>{`
        html,body{margin:0;background:#F5EEE8;color:#1E1A1B;font-family:'Mukta',system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
        *{box-sizing:border-box;min-width:0}
        a{color:#B3242A;text-decoration:none}a:hover{color:#7A1519;text-decoration:underline}
        input{font-family:inherit}
        input:focus{outline:2px solid #B3242A;outline-offset:1px}
        @keyframes rt-spin{to{transform:rotate(360deg)}}
        @keyframes rt-shake{0%,60%,100%{transform:rotate(0deg)}65%{transform:rotate(-8deg)}70%{transform:rotate(8deg)}75%{transform:rotate(-6deg)}80%{transform:rotate(6deg)}85%{transform:rotate(-3deg)}90%{transform:rotate(3deg)}95%{transform:rotate(0deg)}}
        .shake-btn{animation:rt-shake 4s ease-in-out infinite;transform-origin:center center;display:inline-block}
        @keyframes rt-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
        .alert-badge{position:absolute;top:-8px;right:-8px;min-width:22px;height:22px;padding:0 5px;border-radius:999px;background:#2E8B3E;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #141213;animation:rt-pulse 1.6s ease-in-out infinite}
        .night-photo{position:relative}
        .night-photo:hover img{transform:scale(1.07)}
        @media (max-width:640px){.hero-ctas{justify-content:center;text-align:center;width:100%}.hero-ctas button{width:100%}}
        @media (max-width:700px){
          .header-inner{justify-content:center;text-align:center;gap:8px;padding-top:10px;padding-bottom:10px}
          .header-brand{justify-content:center;flex-wrap:wrap}
          .header-nav{width:100%;justify-content:center;gap:16px;flex-wrap:wrap}
        }
        @media (max-width:380px){.header-citytag{display:none}}
        .mobile-paybar{display:none}
        @media (max-width:760px){
          body{padding-bottom:78px}
          .mobile-paybar{
            display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;
            align-items:center;justify-content:space-between;gap:14px;
            padding:12px 16px calc(12px + env(safe-area-inset-bottom));
            background:#141213;border-top:1px solid rgba(232,160,124,.3);
            box-shadow:0 -8px 24px rgba(0,0,0,.35);
          }
          .mobile-paybar-price{display:flex;flex-direction:column;line-height:1.15;color:#F5EEE8}
          .mobile-paybar-label{font-size:12px;color:#B4A79F;text-transform:uppercase;letter-spacing:.08em}
          .mobile-paybar-amount{font-family:'Rozha One',serif;font-size:22px;color:#E8A07C}
          .mobile-paybar button{
            flex:none;height:48px;padding:0 28px;border:0;border-radius:999px;
            background:#D0262C;color:#fff;font:700 16px 'Mukta',sans-serif;cursor:pointer;
            box-shadow:0 4px 0 #7A1519;
          }
        }
        @media print{
          [data-noprint]{display:none!important}
          [data-print-root]{position:static!important;overflow:visible!important;background:#fff!important}
          *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
        }
      `}</style>

      <div data-noprint="1">
        <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(20,18,19,.94)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(232,160,124,.25)' }}>
          <div className="header-inner" style={{ maxWidth: 1200, margin: '0 auto', padding: '12px clamp(16px,4vw,32px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img src="/assets/bikers-cafe-logo.png" alt="The Bikers Cafe logo" style={{ width: 44, height: 44, borderRadius: '50%', display: 'block', flex: 'none' }} />
              <span style={{ fontFamily: "'Rozha One',serif", fontSize: 22, color: '#E8A07C', lineHeight: 1 }}>Garba Gone Single</span>
              <span className="header-citytag" style={{ fontSize: 13, color: '#CFC4BC', letterSpacing: '.08em', textTransform: 'uppercase' }}>Gurugram</span>
            </div>
            <nav className="header-nav" style={{ display: 'flex', alignItems: 'center', gap: 'clamp(12px,3vw,28px)', fontSize: 15 }}>
              <a href="#night" style={{ color: '#EFE7E1' }}>The night</a>
              <a href="#rules" style={{ color: '#EFE7E1' }}>House rules</a>
              <button onClick={scrollToBook} style={{ background: '#E8A07C', color: '#141213', border: 0, borderRadius: 999, padding: '9px 18px', font: "600 15px 'Mukta',sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' }}>Book · ₹{PRICE}</button>
            </nav>
          </div>
        </header>

        <section style={{ background: 'radial-gradient(circle,rgba(232,160,124,.22) 1.6px,transparent 2.2px) 0 0/24px 24px,radial-gradient(circle,rgba(208,38,44,.2) 1.6px,transparent 2.2px) 12px 12px/24px 24px,#141213', color: '#F5EEE8' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(40px,7vw,88px) clamp(16px,4vw,32px) clamp(48px,7vw,96px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,440px),1fr))', gap: 'clamp(32px,5vw,64px)', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, letterSpacing: '.14em', textTransform: 'uppercase', color: '#E8A07C', fontWeight: 600 }}>
                <span style={{ width: 28, height: 2, background: '#E8A07C' }}></span>{EVENT_DATE_SHORT} · Singles Only
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <img src="/assets/bikers-cafe-logo.png" alt="The Bikers Cafe" style={{ width: 40, height: 40, borderRadius: '50%', display: 'block', flex: 'none', boxShadow: '0 0 0 2px rgba(232,160,124,.5)' }} />
                <span style={{ fontSize: 18, color: '#E8A07C', fontWeight: 700 }}>×</span>
                <img src="/assets/Logo2.png" alt="Social Nxt" style={{ width: 40, height: 40, borderRadius: 10, display: 'block', flex: 'none', boxShadow: '0 0 0 2px rgba(232,160,124,.5)', objectFit: 'cover' }} />
                <span style={{ fontSize: 15, color: '#CFC4BC', fontWeight: 600, letterSpacing: '.02em' }}>Biker's Cafe &amp; Social Nxt presents</span>
              </div>
              <h1 style={{ margin: 0, fontFamily: "'Rozha One',serif", fontWeight: 400, fontSize: 'clamp(40px,6.5vw,76px)', lineHeight: .95, letterSpacing: '-.01em', textTransform: 'uppercase' }}>Garba Gone <span style={{ color: '#E8A07C' }}>Single</span></h1>
              <p style={{ margin: 0, fontSize: 'clamp(18px,1.8vw,22px)', lineHeight: 1.5, color: '#F6CDB4', fontWeight: 600, maxWidth: 520 }}>Who needs dating apps when you've got Dandiya sticks?</p>
              <p style={{ margin: 0, fontSize: 'clamp(16px,1.4vw,18px)', lineHeight: 1.6, color: '#DDD3CB', maxWidth: 520 }}>Get ready for a night of Garba, crazy icebreakers, new faces, and unexpected connections. No awkward DMs, no third-wheeling. Just singles, music, and a whole lot of madness!</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', padding: '18px 0', borderTop: '1px solid rgba(232,160,124,.3)', borderBottom: '1px solid rgba(232,160,124,.3)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 13, color: '#B4A79F', textTransform: 'uppercase', letterSpacing: '.1em' }}>Date</span><span style={{ fontSize: 18, fontWeight: 600 }}>{EVENT_DATE_SHORT}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 13, color: '#B4A79F', textTransform: 'uppercase', letterSpacing: '.1em' }}>Time</span><span style={{ display: 'inline-block', width: 'fit-content', fontSize: 15, fontWeight: 700, color: '#141213', background: '#E8A07C', padding: '3px 12px', borderRadius: 999, letterSpacing: '.01em' }}>7:00 PM onwards</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 13, color: '#B4A79F', textTransform: 'uppercase', letterSpacing: '.1em' }}>Venue</span><span style={{ fontSize: 18, fontWeight: 600 }}>{VENUE}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 13, color: '#B4A79F', textTransform: 'uppercase', letterSpacing: '.1em' }}>Entry</span><span style={{ fontSize: 18, fontWeight: 600 }}>₹{PRICE} / person</span></div>
              </div>
              <div className="hero-ctas" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <button onClick={scrollToBook} style={{ background: '#D0262C', color: '#fff', border: 0, borderRadius: 999, padding: '15px 30px', font: "600 18px 'Mukta',sans-serif", cursor: 'pointer', boxShadow: '0 6px 0 #7A1519' }}>Book Your Spot</button>
                <a href="#rules" style={{ color: '#E8A07C', fontWeight: 600, fontSize: 16, padding: '12px 8px' }}>Check the House Rules →</a>
              </div>
            </div>
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
              <div style={{ position: 'relative', width: 'min(100%,460px)', aspectRatio: '4/5' }}>
                <div style={{ position: 'absolute', inset: -14, border: '2px solid #E8A07C', borderRadius: '240px 240px 20px 20px' }}></div>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '230px 230px 14px 14px', overflow: 'hidden', background: '#2A2627' }}>
                  <img src="/assets/hero-dance.jpg" alt="Garba circle" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ position: 'absolute', left: -18, bottom: 28, background: '#E8A07C', color: '#141213', padding: '12px 16px', borderRadius: 12, display: 'flex', flexDirection: 'column', boxShadow: '0 10px 24px rgba(0,0,0,.35)' }}>
                  <span style={{ fontFamily: "'Rozha One',serif", fontSize: 28, lineHeight: 1 }}>{seatsLeft}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Passes Left</span>
                </div>
                <div style={{ position: 'absolute', right: -28, top: 32, width: '38%', aspectRatio: '4/5', borderRadius: 16, overflow: 'hidden', border: '5px solid #F5EEE8', boxShadow: '0 18px 36px rgba(0,0,0,.45)', transform: 'rotate(5deg)' }}>
                  <img src="/assets/hero-accent.jpg" alt="Guests dressed up for the night" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', height: 10 }}>
          {['#F07A1A', '#FFFFFF', '#D7262E', '#1F3FA8', '#F6C21B', '#2E8B3E', '#8A8A8A', '#6B2C91', '#0E8C88'].map((c, i) => <div key={i} style={{ background: c }}></div>)}
        </div>

        <section id="book" style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(56px,8vw,104px) clamp(16px,4vw,32px)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 36 }}>
            <span style={{ fontSize: 14, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, color: '#B3242A' }}>Book Passes</span>
            <h2 style={{ margin: 0, fontFamily: "'Rozha One',serif", fontWeight: 400, fontSize: 'clamp(34px,5vw,56px)', lineHeight: 1 }}>One Ticket Away From a Plot Twist.</h2>
            <p style={{ margin: 0, fontSize: 17, color: '#6A5E5A' }}>Garba Partner Chahiye? Pehle Ticket Lo!</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
            <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 36 }}>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#6A5E5A' }}>Entry Type</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[{ id: 'stag', label: 'Stag', sub: 'Solo — females only' }, { id: 'group', label: 'Group', sub: 'Males welcome' }].map((t) => {
                      const on = entryType === t.id;
                      return (
                        <button key={t.id} onClick={() => selectEntryType(t.id)} style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${on ? '#B3242A' : '#D6C5B8'}`, background: on ? '#B3242A' : '#fff', color: on ? '#fff' : '#1E1A1B', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                          <span style={{ fontWeight: 700, fontSize: 15 }}>{t.label}</span>
                          <span style={{ fontSize: 12, opacity: .85 }}>{t.sub}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 30, height: 30, borderRadius: '50%', background: '#141213', color: '#E8A07C', display: 'grid', placeItems: 'center', fontWeight: 700 }}>1</span><span style={{ fontSize: 20, fontWeight: 700 }}>{quantity > 1 ? 'Details of every guest' : 'Your details'}</span></div>
                {people.map((g, i) => (
                  <div key={i} style={{ background: '#FBF7F3', border: '1px solid #E3D7CD', borderRadius: 14, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {quantity > 1 && <div style={{ flex: '1 1 100%', fontSize: 14, fontWeight: 700, color: '#B3242A' }}>Guest {i + 1}{i === 0 ? ' (you)' : ''}</div>}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '3 1 240px', minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#6A5E5A' }}>Full Name</span>
                      <input value={g.name} maxLength={100} onChange={(e) => updatePerson(i, { name: e.target.value })} placeholder="As on photo ID" style={{ height: 48, border: '1.5px solid #D6C5B8', borderRadius: 10, padding: '0 14px', fontSize: 17, background: '#fff', color: '#1E1A1B', width: '100%' }} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 120px', minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#6A5E5A' }}>Age</span>
                      <input value={g.age} onChange={(e) => updatePerson(i, { age: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" placeholder="18+" style={{ height: 48, border: '1.5px solid #D6C5B8', borderRadius: 10, padding: '0 12px', fontSize: 17, background: '#fff', color: '#1E1A1B', width: '100%' }} />
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '2 1 220px', minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#6A5E5A' }}>Gender</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {GENDERS.map((opt) => {
                          const on = g.gender === opt;
                          return (
                            <button
                              key={opt}
                              onClick={() => (opt === 'Male' && entryType !== 'group' ? setMaleLimitNotice(true) : updatePerson(i, { gender: opt }))}
                              style={{ flex: 1, height: 48, borderRadius: 10, border: `1.5px solid ${on ? '#B3242A' : '#D6C5B8'}`, background: on ? '#B3242A' : '#fff', color: on ? '#fff' : '#1E1A1B', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 30, height: 30, borderRadius: '50%', background: '#141213', color: '#E8A07C', display: 'grid', placeItems: 'center', fontWeight: 700 }}>2</span><span style={{ fontSize: 20, fontWeight: 700 }}>How many passes?</span></div>
                <div style={{ background: '#FBF7F3', border: '1px solid #E3D7CD', borderRadius: 14, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, color: '#6A5E5A' }}>₹{PRICE} per pass · up to {MAX_QTY} per booking</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <button onClick={() => { setQuantity((q) => Math.max(1, q - 1)); setErrors([]); }} aria-label="Decrease" style={{ width: 44, height: 44, borderRadius: 10, border: '1.5px solid #D6C5B8', background: '#fff', fontSize: 20, fontWeight: 700, cursor: 'pointer', color: '#1E1A1B' }}>−</button>
                    <span style={{ fontFamily: "'Rozha One',serif", fontSize: 28, minWidth: 32, textAlign: 'center' }}>{quantity}</span>
                    <button onClick={() => { setQuantity((q) => Math.min(maxQty, q + 1)); setErrors([]); }} aria-label="Increase" style={{ width: 44, height: 44, borderRadius: 10, border: '1.5px solid #D6C5B8', background: '#fff', fontSize: 20, fontWeight: 700, cursor: 'pointer', color: '#1E1A1B' }}>+</button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 30, height: 30, borderRadius: '50%', background: '#141213', color: '#E8A07C', display: 'grid', placeItems: 'center', fontWeight: 700 }}>3</span><span style={{ fontSize: 20, fontWeight: 700 }}>Where should we send your pass?</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 14, fontWeight: 600, color: '#6A5E5A' }}>Mobile Number (for SMS)</span>
                    <div style={{ display: 'flex', height: 48, border: '1.5px solid #D6C5B8', borderRadius: 10, background: '#fff', overflow: 'hidden' }}><span style={{ display: 'grid', placeItems: 'center', padding: '0 12px', background: '#EEE3DA', fontSize: 16, fontWeight: 600 }}>+91</span><input value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setErrors([]); }} inputMode="tel" placeholder="98XXXXXXXX" style={{ flex: 1, minWidth: 0, border: 0, padding: '0 12px', fontSize: 17, color: '#1E1A1B' }} /></div>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 14, fontWeight: 600, color: '#6A5E5A' }}>Email Address</span>
                    <input value={email} onChange={(e) => { setEmail(e.target.value.trim()); setErrors([]); }} type="email" placeholder="you@example.com" style={{ height: 48, border: '1.5px solid #D6C5B8', borderRadius: 10, padding: '0 14px', fontSize: 17, background: '#fff', color: '#1E1A1B', width: '100%' }} />
                  </label>
                </div>
                <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer', fontSize: 16, lineHeight: 1.5, padding: '4px 0' }}>
                  <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setErrors([]); }} style={{ width: 22, height: 22, marginTop: 2, accentColor: '#B3242A', flex: 'none' }} />
                  <span>I confirm that all guests meet the singles-only event eligibility requirements, will follow the dress code, and accept the <a href="#rules">house rules</a> and non-refundable booking terms.</span>
                </label>
              </div>
            </div>

            <aside style={{ flex: '1 1 340px', position: 'sticky', top: 84, background: '#141213', color: '#F5EEE8', borderRadius: 20, overflow: 'hidden', minWidth: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', height: 6 }}>
                {['#F07A1A', '#FFFFFF', '#D7262E', '#1F3FA8', '#F6C21B', '#2E8B3E', '#8A8A8A', '#6B2C91', '#0E8C88'].map((c, i) => <div key={i} style={{ background: c }}></div>)}
              </div>
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ fontFamily: "'Rozha One',serif", fontSize: 26, lineHeight: 1.1 }}>Your Booking</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 16, borderBottom: '1px dashed rgba(232,160,124,.4)' }}>
                  <span style={{ fontSize: 18, fontWeight: 600 }}>{EVENT_NAME}</span>
                  <span style={{ fontSize: 16, color: '#CFC4BC' }}>{EVENT_DATE_LONG}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 17 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><span>Passes × {quantity} <span style={{ color: '#B4A79F' }}>@ <span style={{ textDecoration: 'line-through', color: '#B4A79F', fontSize: 14 }}>₹{DISPLAY_ORIGINAL_PRICE}</span></span> <span style={{ color: '#D4AF37', fontWeight: 700, fontSize: 19 }}>₹{PRICE}</span></span><span>{inr(subtotal)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: '#B4A79F', fontSize: 15 }}><span>GST (18%)</span><span>{inr(gst)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: '#B4A79F', fontSize: 15 }}><span>Convenience Fee</span><span>₹0</span></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 16, borderTop: '1px solid rgba(232,160,124,.4)' }}>
                  <span style={{ fontSize: 16, color: '#CFC4BC' }}>Total Payable</span>
                  <span style={{ fontFamily: "'Rozha One',serif", fontSize: 40, color: '#E8A07C', lineHeight: 1 }}>{inr(total)}</span>
                </div>
                {hasErrors && (
                  <div style={{ background: '#3A1A1B', border: '1px solid #D0262C', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15, color: '#FFDAD6' }}>
                    {errors.map((e, i) => <span key={i}>• {e}</span>)}
                  </div>
                )}
                <div style={{ position: 'relative' }}>
                  <button onClick={payNow} className="shake-btn" style={{ width: '100%', height: 56, border: 0, borderRadius: 14, background: '#D0262C', color: '#fff', font: "700 19px 'Mukta',sans-serif", cursor: soldOut ? 'not-allowed' : 'pointer', boxShadow: '0 5px 0 #7A1519', opacity: soldOut ? .5 : 1 }} disabled={soldOut}>{soldOut ? 'Sold Out' : `Pay Now · ${inr(total)}`}</button>
                  {!soldOut && <span className="alert-badge">{quantity}</span>}
                </div>
                <span style={{ fontSize: 14, color: '#B4A79F', textAlign: 'center', lineHeight: 1.4 }}>Secured by Razorpay · UPI, Cards &amp; Netbanking. Passes sent by email.</span>
              </div>
            </aside>
          </div>
        </section>

        <section id="night" style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(56px,8vw,104px) clamp(16px,4vw,32px)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: 20, marginBottom: 40 }}>
            <div style={{ maxWidth: 620 }}>
              <h2 style={{ margin: 0, fontFamily: "'Rozha One',serif", fontWeight: 400, fontSize: 'clamp(34px,5vw,56px)', lineHeight: 1 }}>Swipe Less. Spin More.</h2>
              <p style={{ margin: '12px 0 0', fontSize: 17, lineHeight: 1.55, color: '#6A5E5A' }}>Garba ke steps milenge ya dil ke connections?</p>
            </div>
            <p style={{ margin: 0, maxWidth: 380, fontSize: 17, lineHeight: 1.55, color: '#6A5E5A' }}>One night, a room full of singles, and endless possibilities!</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 20 }}>
            {[
              ['01', 'Dandiya Pe Dil Aa Gaya', "Two sticks. One dance floor. Endless chances to find your perfect dance partner. You just bring your moves, we'll bring the vibe!", '/assets/dandiya-sticks.jpg'],
              ['02', 'Awkwardness? Game Over!', 'Forget boring introductions. Fun icebreakers, quirky challenges, and interactive games will get everyone talking, laughing, and connecting.', '/assets/live-dj.jpg'],
              ['03', 'Sip, Sip, Sanedo!', 'Your ₹299 pass includes one mocktail or cocktail. Sip, mingle, and let the conversations flow while the Dandiya goes on!', '/assets/festive-drinks.jpg'],
            ].map(([num, title, desc, img]) => (
              <div key={num} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="night-photo" style={{ aspectRatio: '4/3', borderRadius: 14, overflow: 'hidden', background: '#E6DAD0' }}>
                  <img src={img} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform .5s ease' }} />
                </div>
                <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}><span style={{ fontFamily: "'Rozha One',serif", color: '#B3242A', fontSize: 22, flex: 'none', minWidth: 34 }}>{num}</span><div><div style={{ fontSize: 20, fontWeight: 700 }}>{title}</div><div style={{ fontSize: 16, color: '#6A5E5A', lineHeight: 1.5 }}>{desc}</div></div></div>
              </div>
            ))}
          </div>
        </section>

        <section id="rules" style={{ background: '#B3242A', color: '#FFF3EC', backgroundImage: 'radial-gradient(circle,rgba(255,255,255,.12) 1.4px,transparent 2px)', backgroundSize: '20px 20px' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(56px,8vw,96px) clamp(16px,4vw,32px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 'clamp(32px,5vw,64px)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <span style={{ fontSize: 14, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, color: '#F6CDB4' }}>Before You Arrive</span>
              <h2 style={{ margin: 0, fontFamily: "'Rozha One',serif", fontWeight: 400, fontSize: 'clamp(34px,5vw,56px)', lineHeight: 1 }}>Rules of the Circles!</h2>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, maxWidth: 400 }}>A little discipline, a lot of Dandiya! Follow these house rules so everyone can enjoy the night.</p>
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
              {[
                ['i.', 'Single Ho Toh Swagat Hai!', "Exclusively for singles. Come solo or bring your single gang. Couples, this one's not your night!"],
                ['ii.', 'Desi Fits Only!', 'Traditional attire is mandatory. Kurtas, lehengas, sarees, chaniya cholis, just bring your festive A-game!'],
                ['iii.', 'One Pass. One Person.', 'Each pass is valid for one attendee and the booked event slot only. Be on time and keep your booking confirmation ready.'],
                ['iv.', 'ID Dikhao, Entry Pao!', 'Carry a valid government-issued photo ID. Your name must match your booking details.'],
                ['v.', 'Good Vibes, Good Behaviour!', 'Respect personal boundaries and venue rules. Passes are non-refundable and non-transferable.'],
              ].map(([num, title, desc], i, arr) => (
                <li key={num} style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 12, padding: '16px 0', borderTop: '1px solid rgba(255,255,255,.3)', borderBottom: i === arr.length - 1 ? '1px solid rgba(255,255,255,.3)' : undefined }}>
                  <span style={{ fontFamily: "'Rozha One',serif", fontSize: 22, color: '#F6CDB4' }}>{num}</span>
                  <div><div style={{ fontSize: 19, fontWeight: 700 }}>{title}</div><div style={{ fontSize: 16, lineHeight: 1.5, opacity: .92 }}>{desc}</div></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <footer style={{ background: '#141213', color: '#CFC4BC' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', padding: '48px clamp(16px,4vw,32px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 28, fontSize: 16, lineHeight: 1.6 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}><img src="/assets/bikers-cafe-logo.png" alt="The Bikers Cafe" style={{ width: 84, height: 84, borderRadius: '50%', display: 'block' }} /><a href="https://share.google/lleTPgF3ygdo79uaS" style={{ color: '#CFC4BC' }}>Palm Spring Plaza (PSP), Ground Floor, Unit 12, Golf Course Rd, Sector 54, Gurugram, Haryana 122009 ↗</a></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ color: '#fff', fontWeight: 600 }}>Help at the gate</span><a href="tel:+918527453334" style={{ color: '#E8A07C' }}>+91 85274 53334</a><a href="https://www.instagram.com/thebikerscafe/" style={{ color: '#E8A07C' }}>@thebikerscafe</a></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ color: '#fff', fontWeight: 600 }}>Policies</span><a href="#rules" style={{ color: '#CFC4BC' }}>Terms &amp; house rules</a><span>Refunds: not applicable</span></div>
          </div>
        </footer>
      </div>

      <div className="mobile-paybar" data-noprint="1">
        <div className="mobile-paybar-price">
          <span className="mobile-paybar-label">Total</span>
          <span className="mobile-paybar-amount">{inr(total)}</span>
        </div>
        <div style={{ position: 'relative', flex: 'none' }}>
          <button onClick={payNow} className="shake-btn">Pay Now</button>
          <span className="alert-badge">{quantity}</span>
        </div>
      </div>

      {showCheckout && (
        <div data-noprint="1" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(10,9,9,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(100%,420px)', background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.45)', color: '#1F2433' }}>
            <div style={{ background: '#141213', color: '#fff', padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img src="/assets/bikers-cafe-logo.png" alt="" style={{ width: 40, height: 40, borderRadius: '50%', display: 'block' }} />
                <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontWeight: 700, fontSize: 16 }}>Garba Gone Single</span><span style={{ fontSize: 13, opacity: .75 }}>Order {orderInfo?.orderId || ''}</span></div>
              </div>
              <button onClick={() => setStage('form')} aria-label="Close" style={{ background: 'transparent', border: 0, color: '#fff', fontSize: 24, cursor: 'pointer', width: 44, height: 44 }}>×</button>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={{ color: '#5B6275' }}>Amount</span><span style={{ fontSize: 28, fontWeight: 700 }}>{inr(total)}</span></div>
              {stage === 'processing' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '28px 0' }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', border: '4px solid #E3E7F0', borderTopColor: '#2B6BEA', animation: 'rt-spin .8s linear infinite' }}></div>
                  <span style={{ fontSize: 16, color: '#5B6275' }}>Confirming payment with your bank…</span>
                </div>
              )}
              {stage === 'failed' && (
                <div style={{ background: '#FDECEC', color: '#9B1C1C', borderRadius: 10, padding: '12px 14px', fontSize: 15 }}>Payment didn't go through. No money was deducted — please try again.</div>
              )}
              {isChoosing && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {METHODS.map((m) => <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 52, padding: '0 16px', borderRadius: 10, border: '1.5px solid #E3E7F0', background: '#fff', fontWeight: 600, fontSize: 16, color: '#1F2433' }}><span>{m.label}</span><span style={{ fontWeight: 400, color: '#5B6275', fontSize: 14 }}>{m.sub}</span></div>)}
                  </div>
                  <button onClick={openRazorpay} style={{ height: 52, border: 0, borderRadius: 10, background: '#2B6BEA', color: '#fff', font: "700 17px 'Mukta',sans-serif", cursor: 'pointer' }}>Pay {inr(total)} with Razorpay</button>
                </>
              )}
              <span style={{ fontSize: 13, color: '#8A90A0', textAlign: 'center' }}>Secured by Razorpay Standard Checkout</span>
            </div>
          </div>
        </div>
      )}

      {maleLimitNotice && (
        <div data-noprint="1" style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(10,9,9,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setMaleLimitNotice(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(100%,380px)', background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.45)', color: '#1E1A1B', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 40 }}>🚫</span>
            <span style={{ fontSize: 19, fontWeight: 700 }}>Stag male entry is sold out</span>
            <span style={{ fontSize: 15, color: '#6A5E5A' }}>Solo (stag) male passes have hit their limit for this event. Switch to <strong>Group</strong> entry at the top to book for a male guest.</span>
            <button onClick={() => setMaleLimitNotice(false)} style={{ height: 48, border: 0, borderRadius: 10, background: '#B3242A', color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>Got it</button>
          </div>
        </div>
      )}

      {showSuccess && ticketSnapshot && (
        <div data-print-root="1" style={{ position: 'fixed', inset: 0, zIndex: 60, overflow: 'auto', background: 'radial-gradient(circle,rgba(232,160,124,.18) 1.6px,transparent 2.2px) 0 0/24px 24px,#141213', color: '#F5EEE8' }}>
          <div style={{ maxWidth: 980, margin: '0 auto', padding: 'clamp(28px,5vw,64px) clamp(16px,4vw,32px)', display: 'flex', flexDirection: 'column', gap: 28 }}>
            <div data-noprint="1" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ background: '#2E8B3E', color: '#fff', fontWeight: 700, fontSize: 14, padding: '5px 12px', borderRadius: 999, letterSpacing: '.06em', textTransform: 'uppercase' }}>Payment successful · {inr(total)}</span>
              <h2 style={{ margin: 0, fontFamily: "'Rozha One',serif", fontWeight: 400, fontSize: 'clamp(36px,6vw,64px)', lineHeight: 1 }}>See you on the dance floor!</h2>
              <p style={{ margin: 0, fontSize: 18, color: '#DDD3CB' }}>Booking <strong style={{ color: '#E8A07C' }}>{bookingId}</strong> · {ticketSnapshot.length} {ticketSnapshot.length === 1 ? 'pass' : 'passes'} for {EVENT_DATE_LONG}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
                <button onClick={() => window.print()} style={{ height: 52, padding: '0 26px', border: 0, borderRadius: 999, background: '#E8A07C', color: '#141213', font: "700 17px 'Mukta',sans-serif", cursor: 'pointer' }}>Download passes (PDF)</button>
                <button onClick={resetAll} style={{ height: 52, padding: '0 26px', border: '1.5px solid #E8A07C', borderRadius: 999, background: 'transparent', color: '#E8A07C', font: "600 17px 'Mukta',sans-serif", cursor: 'pointer' }}>Book another pass</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {ticketSnapshot.map((t) => (
                <div key={t.idx} style={{ display: 'flex', flexWrap: 'wrap', borderRadius: 18, overflow: 'hidden', background: '#FBF7F3', color: '#1E1A1B', boxShadow: '0 18px 40px rgba(0,0,0,.35)' }}>
                  <div style={{ flex: '1 1 380px', minWidth: 0, background: '#B3242A', color: '#FFF3EC', backgroundImage: 'radial-gradient(circle,rgba(255,255,255,.13) 1.4px,transparent 2px)', backgroundSize: '18px 18px', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase', color: '#F6CDB4', fontWeight: 600 }}>Biker's Cafe &amp; Social Nxt</span><span style={{ fontFamily: "'Rozha One',serif", fontSize: 32, lineHeight: 1.05 }}>Garba Gone Single</span></div>
                      <img src="/assets/bikers-cafe-logo.png" alt="" style={{ width: 56, height: 56, borderRadius: '50%', display: 'block', flex: 'none', boxShadow: '0 0 0 2px #F6CDB4' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 14 }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.1em', opacity: .8 }}>Guest</span><span style={{ fontSize: 19, fontWeight: 700 }}>{t.name}</span></div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.1em', opacity: .8 }}>Age</span><span style={{ fontSize: 19, fontWeight: 700 }}>{t.age}</span></div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.1em', opacity: .8 }}>Gender</span><span style={{ fontSize: 19, fontWeight: 700 }}>{t.gender}</span></div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.1em', opacity: .8 }}>Date</span><span style={{ fontSize: 19, fontWeight: 700 }}>{t.date}</span></div>
                    </div>
                    <span style={{ fontSize: 14, opacity: .9 }}>Singles only · Traditional attire mandatory · Carry photo ID</span>
                  </div>
                  <div style={{ flex: '0 1 220px', minWidth: 200, margin: '0 auto', padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, borderLeft: '2px dashed #D6C5B8' }}>
                    <img src={t.qr} alt={`QR for ${t.no}`} width={150} height={150} style={{ background: '#fff', padding: 6, boxSizing: 'content-box', display: 'block' }} />
                    <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 14, fontWeight: 600, letterSpacing: '.04em' }}>{t.no}</span>
                    <span style={{ fontSize: 13, color: '#6A5E5A' }}>Pass {t.idx} of {ticketSnapshot.length}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
