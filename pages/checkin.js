import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';

// Door staff page: scan the QR (camera, where the browser supports it) or paste the code.
export default function CheckIn() {
  const [key, setKey] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef(null);
  const busyRef = useRef(false);
  const keyRef = useRef('');
  keyRef.current = key;

  useEffect(() => { try { setKey(sessionStorage.getItem('ck') || ''); } catch {} }, []);

  async function submit(c) {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setResult(null);
    try {
      try { sessionStorage.setItem('ck', keyRef.current); } catch {}
      const res = await fetch('/api/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-checkin-key': keyRef.current }, body: JSON.stringify({ code: c }) });
      const data = await res.json();
      setResult(res.ok ? data : { status: 'error', error: data.error });
    } catch { setResult({ status: 'error', error: 'Network error' }); }
    setLoading(false);
    setTimeout(() => { busyRef.current = false; }, scanning ? 2500 : 300); // camera: avoid re-reading the same QR instantly
  }

  useEffect(() => {
    if (!scanning) return;
    let stream; let stop = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) { alert('Camera needs a secure (https) page. Open the live site over https, or type the ticket number instead.'); setScanning(false); return; }
        // Chrome/Android has a native QR detector; Safari doesn't, so fall back to jsQR on canvas frames.
        const native = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
        const jsQR = native ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        videoRef.current.srcObject = stream; await videoRef.current.play();
        const read = async () => {
          const v = videoRef.current;
          if (native) { const r = await native.detect(v); return r[0]?.rawValue; }
          if (!v.videoWidth) return null;
          canvas.width = v.videoWidth; canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          return jsQR(img.data, img.width, img.height)?.data;
        };
        const tick = async () => {
          if (stop) return;
          try { const v = await read(); if (v) await submit(v); } catch {}
          setTimeout(tick, 300);
        };
        tick();
      } catch { setScanning(false); }
    })();
    return () => { stop = true; stream && stream.getTracks().forEach((t) => t.stop()); };
  }, [scanning]); // eslint-disable-line react-hooks/exhaustive-deps

  const colors = { ok: '#2E8B3E', used: '#C77700', invalid: '#B3242A', error: '#B3242A' };
  const labels = { ok: 'VALID — ENTRY OK', used: 'ALREADY USED', invalid: 'INVALID TICKET', error: 'ERROR' };
  const inputStyle = { height: 50, border: '1.5px solid rgba(232,160,124,.35)', borderRadius: 10, padding: '0 14px', fontSize: 17, width: '100%', background: '#1E1A1B', color: '#F5EEE8', fontFamily: 'inherit' };
  return (
    <>
      <Head>
        <title>Check-in · Garba Gone Single</title>
        <link rel="icon" type="image/png" href="/assets/bikers-cafe-logo.png" />
        <meta name="robots" content="noindex,nofollow" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Rozha+One&family=Mukta:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <style>{`html,body{margin:0;background:#141213;color:#F5EEE8;font-family:'Mukta',system-ui,sans-serif;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}@keyframes sp{to{transform:rotate(360deg)}}.spin{display:inline-block;width:16px;height:16px;border:3px solid rgba(255,255,255,.35);border-top-color:#E8A07C;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-3px;margin-right:6px}input:focus,button:focus-visible{outline:2px solid #E8A07C;outline-offset:1px}`}</style>
      </Head>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', height: 6 }}>
        {['#F07A1A', '#FFFFFF', '#D7262E', '#1F3FA8', '#F6C21B', '#2E8B3E', '#8A8A8A', '#6B2C91', '#0E8C88'].map((c, i) => <div key={i} style={{ background: c }}></div>)}
      </div>
      <main style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px 48px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <img src="/assets/bikers-cafe-logo.png" alt="" width={48} height={48} style={{ borderRadius: '50%', boxShadow: '0 0 0 2px #E8A07C' }} />
          <div><div style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#CFC4BC' }}>Garba Gone Single · Biker's Cafe</div>
          <h1 style={{ margin: 0, fontFamily: "'Rozha One',serif", fontWeight: 400, fontSize: 30, lineHeight: 1.1 }}>Entry check-in</h1></div>
        </header>
        <input type="password" placeholder="Staff password" value={key} onChange={(e) => setKey(e.target.value)} style={inputStyle} />
        <button onClick={() => setScanning((s) => !s)} style={{ height: 52, border: '1.5px solid #E8A07C', borderRadius: 14, background: 'transparent', color: '#E8A07C', font: "600 17px 'Mukta',sans-serif", cursor: 'pointer', width: '100%' }}>{scanning ? 'Stop camera' : 'Scan QR with camera'}</button>
        {scanning && <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 14, border: '2px solid #E8A07C' }} />}
        <form onSubmit={(e) => { e.preventDefault(); submit(code.trim()); setCode(''); }} style={{ display: 'flex', gap: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="…or type ticket no. (RT26-XXXXX-01)" style={{ ...inputStyle, flex: 1 }} />
          <button disabled={loading} style={{ opacity: loading ? .7 : 1, ...({ height: 52, border: 0, borderRadius: 14, background: '#D0262C', color: '#fff', font: "700 18px 'Mukta',sans-serif", cursor: 'pointer', boxShadow: '0 4px 0 #7A1519', width: '100%' }), width: 'auto', padding: '0 22px' }}>{loading ? <><span className="spin" /> Checking…</> : 'Check'}</button>
        </form>
        {loading && !result && (
          <div style={{ padding: 22, borderRadius: 16, background: '#1E1A1B', border: '1px solid rgba(232,160,124,.35)', display: 'flex', alignItems: 'center', gap: 12, color: '#E8A07C', fontWeight: 600 }}><span className="spin" /> Checking ticket…</div>
        )}
        {result && (
          <div style={{ padding: 22, borderRadius: 16, color: '#fff', background: colors[result.status] || '#555', boxShadow: '0 12px 30px rgba(0,0,0,.4)' }}>
            <div style={{ fontFamily: "'Rozha One',serif", fontSize: 28, lineHeight: 1.1 }}>{labels[result.status] || result.status}</div>
            {result.guest && <div style={{ fontSize: 20, fontWeight: 600, marginTop: 10 }}>{result.guest.name} · {result.guest.age} · {result.guest.gender}</div>}
            {result.status === 'used' && result.guest?.checkedInAt && <div style={{ marginTop: 4 }}>Checked in at {new Date(result.guest.checkedInAt).toLocaleTimeString()}</div>}
            {result.no && <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', marginTop: 8, opacity: .9 }}>{result.no}</div>}
            {result.error && <div>{result.error}</div>}
          </div>
        )}
      </main>
    </>
  );
}
