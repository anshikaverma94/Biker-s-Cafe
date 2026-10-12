# Deploying

This is a standard Next.js app — `npm run build` + `npm run start`, or any host
that runs Next.js natively. The easiest free option is **Vercel** (built by the
same team as Next.js, zero config). Steps below cover Vercel; the "any host"
section at the bottom covers a plain VPS/Node server instead.

## Option A — Vercel (recommended, free tier)

1. Push this project to a GitHub repo (private is fine).
2. Go to vercel.com → **Add New → Project** → import that repo.
3. Before the first deploy, add your environment variables: **Settings → Environment
   Variables**. Copy every key from `.env.local` into there (same names), with real
   values — do not upload `.env.local` itself.
   - Set `NEXT_PUBLIC_SITE_URL` to your real deployed URL, e.g. `https://bikerscafe-garba.vercel.app`
     (or your custom domain once you attach one).
4. Click **Deploy**. Vercel builds and gives you a live URL.
5. Run the one-time setup steps **against your production database/sheet**:
   - Easiest: temporarily point your local `.env.local`'s `DATABASE_URL` at the
     same Neon database you set in Vercel (it's the same string either way —
     Neon isn't environment-specific), then run `npm run db:migrate` locally.
   - The Google Sheet webhook (`SHEETS_WEBHOOK_URL`) is already live regardless
     of where the app runs — no extra step needed there.
6. Once deployed, go to Razorpay Dashboard and set up the **webhook** (see below)
   pointing at your live URL.
7. When you're ready to accept real money, switch `RAZORPAY_KEY_ID` /
   `RAZORPAY_KEY_SECRET` / `NEXT_PUBLIC_RAZORPAY_KEY_ID` from your `rzp_test_...`
   keys to your `rzp_live_...` keys in Vercel's environment variables, then
   redeploy.

## Option B — Any VPS / plain Node server

```bash
npm install
npm run build
npm run start      # serves on port 3000 by default; put a reverse proxy (nginx/Caddy) in front for HTTPS
```

Run `npm run db:migrate` once against the server's `DATABASE_URL`. Use a process
manager (pm2, systemd) to keep `npm run start` running and restart on crash/reboot.

## Razorpay webhook (do this after your domain is live)

Without this, a completed payment is only recorded if the customer's browser
stays open long enough to call back after paying. The webhook is a safety net:
Razorpay tells your server directly, server-to-server, so a dropped connection
or closed tab can't lose a paid booking.

1. Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**.
2. **Webhook URL**: `https://<your-domain>/api/razorpay-webhook`
3. **Secret**: generate one (e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
   and put the same value in `RAZORPAY_WEBHOOK_SECRET` on your host.
4. **Active events**: check `payment.captured` and `payment.failed`.
5. Save. Razorpay will send a test ping — the endpoint responds 200 to anything
   it doesn't need to act on, so this should succeed immediately.

## Pre-launch checklist

- [ ] `DATABASE_URL` points at your real Neon database, and `npm run db:migrate` has been run against it.
- [ ] `SHEETS_WEBHOOK_URL` / `SHEETS_WEBHOOK_SECRET` match your deployed Apps Script.
- [ ] `NEXT_PUBLIC_SITE_URL` is your real production URL (used in Pixel event metadata).
- [ ] `NEXT_PUBLIC_FB_PIXEL_ID` / `FB_CONVERSIONS_API_TOKEN` are your real Meta values, not placeholders.
- [ ] Razorpay webhook is configured and `RAZORPAY_WEBHOOK_SECRET` is set.
- [ ] Razorpay keys are switched from `rzp_test_...` to `rzp_live_...` only once you're ready for real transactions.
- [ ] `public/assets/bikers-cafe-logo.png` and `public/assets/garba-hero.jpg` are real images, not missing files.
