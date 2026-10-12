// Client-side helpers for firing Facebook Pixel events with an event_id shared
// with the server-side Conversions API call, so Meta de-dupes the pair.

export function genEventId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getCookie(name) {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : undefined;
}

export function trackPixel(eventName, eventId, params = {}) {
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    window.fbq('trackCustom', eventName, params, { eventID: eventId });
  }
}

export function trackStandardPixel(eventName, eventId, params = {}) {
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    window.fbq('track', eventName, params, { eventID: eventId });
  }
}

export function fbCookies() {
  return { fbp: getCookie('_fbp'), fbc: getCookie('_fbc') };
}
