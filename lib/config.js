// Single source of truth for pricing/limits. The server recomputes the amount from
// these values — never trust a price sent by the browser.
export const PRICE = 299;
export const DISPLAY_ORIGINAL_PRICE = 599; // shown struck-through next to PRICE, cosmetic only — doesn't affect what's charged
export const GST_RATE = 0.18;
export const MAX_QTY = 6;
export const TOTAL_SEATS = 60;
export const SEATS_LEFT = TOTAL_SEATS; // alias kept for validation
export const DISPLAY_SEATS_FLOOR = 10; // displayed "seats left" never drops below this, even once real bookings exceed TOTAL_SEATS
export const HOLD_MINUTES = 15; // unpaid bookings hold seats this long
export const MAX_HOLDS_PER_IP = 2; // concurrent unpaid bookings per IP
export const GENDERS = ['Female', 'Male', 'Other'];
export const MIN_AGE = 18;
export const MAX_AGE = 100;

// Computed in paise (integers) so GST keeps its exact 2 decimals — no rounding to whole rupees.
export function computeTotals(quantity) {
  const subtotalPaise = quantity * PRICE * 100;
  const gstPaise = Math.round(subtotalPaise * GST_RATE);
  const totalPaise = subtotalPaise + gstPaise;
  return { subtotal: subtotalPaise / 100, gst: gstPaise / 100, total: totalPaise / 100, totalPaise };
}

export const ENTRY_TYPES = ['stag', 'group'];

// Returns { guests } (cleaned) or { error }.
// Stag entry is females-only: enforced here too, not just in the browser.
export function sanitizeGuests(input, entryType = 'group') {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_QTY || input.length > SEATS_LEFT) {
    return { error: `Choose between 1 and ${MAX_QTY} passes.` };
  }
  const guests = [];
  for (let i = 0; i < input.length; i++) {
    const g = input[i] || {};
    const name = typeof g.name === 'string' ? g.name.trim().slice(0, 100) : '';
    const age = Number(g.age);
    if (name.length < 2) return { error: `Guest ${i + 1}: enter a valid name.` };
    if (!Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) return { error: `Guest ${i + 1}: age must be ${MIN_AGE}-${MAX_AGE}.` };
    if (!GENDERS.includes(g.gender)) return { error: `Guest ${i + 1}: select a gender.` };
    if (entryType === 'stag' && g.gender !== 'Female') return { error: `Guest ${i + 1}: Stag entry is for females only. Choose Group entry for male guests.` };
    guests.push({ name, age, gender: g.gender });
  }
  return { guests };
}

export const EVENT_NAME = 'Garba Gone Single';
export const EVENT_DATE_SHORT = '17 Oct 2026';
export const EVENT_DATE_LONG = '17th October 2026';
export const VENUE = 'The Bikers Cafe, Gurugram';
