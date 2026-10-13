-- Run once against your Neon database (npm run db:migrate does this automatically).

CREATE TABLE IF NOT EXISTS bookings (
  id               SERIAL PRIMARY KEY,
  booking_id       TEXT UNIQUE NOT NULL,
  order_id         TEXT,
  lead_id          TEXT,
  payment_id       TEXT,
  razorpay_signature TEXT,
  event_date       TEXT NOT NULL,
  slot_time        TEXT NOT NULL,
  phone            TEXT NOT NULL,
  email            TEXT NOT NULL,
  guest_count      INTEGER NOT NULL,
  child_count      INTEGER NOT NULL,
  paid_count       INTEGER NOT NULL,
  total_amount     NUMERIC(10,2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'created', -- created | paid | failed
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guests (
  id          SERIAL PRIMARY KEY,
  booking_id  TEXT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  age         INTEGER NOT NULL,
  is_child    BOOLEAN NOT NULL DEFAULT false,
  gender      TEXT
);

CREATE INDEX IF NOT EXISTS idx_guests_booking_id ON guests(booking_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Safe to re-run: adds columns to tables created before this column existed.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lead_id TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE bookings ALTER COLUMN total_amount TYPE NUMERIC(10,2);

-- Ticketing hardening: IP-based hold limits, check-in, one-time ticket email.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tickets_emailed_at TIMESTAMPTZ;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at);
