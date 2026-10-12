# The Bikers Cafe — Garba Night booking

Next.js app: same visual design as the original page, now backed by Neon Postgres, Razorpay, Google Sheets, and Meta/Facebook Pixel tracking.

## 1. Install

```
npm install
```

## 2. Configure environment

Copy `.env.example` to `.env.local` and fill in real values (a `.env.local` with your Razorpay test keys already prefilled has been created for you — just add the rest).

- **DATABASE_URL** — from your Neon project (use the pooled connection string).
- **RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET** — already set with your test keys.
- **SHEETS_WEBHOOK_URL / SHEETS_WEBHOOK_SECRET** — a free Google Apps Script Web App, no GCP project needed. Full walkthrough in [README-SHEETS.md](README-SHEETS.md).
- **NEXT_PUBLIC_FB_PIXEL_ID / FB_CONVERSIONS_API_TOKEN** — from Meta Events Manager.

## 3. Create the database tables

```
npm run db:migrate
```

This runs `sql/schema.sql` against your Neon database (creates `bookings` and `guests` tables).

## 4. Run locally

```
npm run dev
```

Open http://localhost:3000.

## How the integrations work

- **Neon DB**: every "Pay now" click creates a `bookings` row (status `created`) plus one `guests` row per attendee. On successful payment verification the row is updated to `status = paid` with the Razorpay payment id and signature.
- **Razorpay**: `/api/create-order` creates a Razorpay order server-side. The browser opens Razorpay Checkout with that order id. On success, `/api/verify-payment` recomputes the HMAC signature server-side before trusting the payment.
- **Google Sheets**: when the form becomes fully valid (all fields filled correctly), a row is appended to the `Leads` tab with status `Filled – not paid` — this captures everyone who filled their details, whether or not they go on to pay. If that same visitor completes payment, the matching `Leads` row (matched by a hidden `Lead ID`) is updated in place to `Paid – booking <id>`, so you never get duplicate/stale leads. Every completed payment also gets one row per guest appended to the `Bookings` tab (full order details: date, slot, guest names/ages, amount, status).
- **Facebook Pixel**: three events are fired, each as both a browser pixel event and a matching server-side Conversions API call (deduped via a shared `event_id`):
  - `Lead` — fired once, the moment the booking form becomes fully valid (details filled).
  - `InitiateCheckout` — fired when the user clicks "Pay now".
  - `Purchase` — fired after payment is verified server-side.

## Deploying

Any Next.js host (Vercel, etc.) works. Set the same environment variables in the host's dashboard — do not commit `.env.local`.
