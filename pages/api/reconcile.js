import crypto from 'crypto';
import { reconcileUnpaid } from '../../lib/reconcile';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Manual trigger:  curl -H "x-checkin-key: <CHECKIN_PASSWORD>" https://<site>/api/reconcile
// (The server also runs this automatically every few minutes — see instrumentation.js.)
export default async function handler(req, res) {
  const pw = process.env.CHECKIN_PASSWORD;
  if (!pw || !safeEq(req.headers['x-checkin-key'], pw)) return res.status(401).json({ error: 'Unauthorized' });
  return res.status(200).json(await reconcileUnpaid({ limit: 200 }));
}
