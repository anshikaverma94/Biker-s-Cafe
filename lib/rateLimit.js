// Best-effort in-memory limiter (per server instance). Combined with the DB-backed
// per-IP hold limit in reserveBooking, this blunts casual abuse; for serious bots
// put Cloudflare/Vercel WAF rules or a captcha in front.
const hits = new Map();

export const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null;

export function rateLimit(req, res, { key, max, windowMs }) {
  const k = `${key}:${clientIp(req)}`;
  const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(k, arr);
  if (hits.size > 5000) for (const [kk, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(kk);
  if (arr.length > max) {
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return false;
  }
  return true;
}
