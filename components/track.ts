import { UAParser } from 'ua-parser-js';
import { v4 as uuid } from 'uuid';

export async function track(path: string) {
  /* ─── Client guards ─── */
  if (typeof window === 'undefined') return;           // SSR / Edge pass
  const { localStorage, sessionStorage, navigator, performance, document } =
    window;
  /* ────────────────────── */

  // visitor_id persistence
  let visitorId = localStorage.getItem('visitor_id') || '';
  if (!visitorId) {
    visitorId = uuid();
    localStorage.setItem('visitor_id', visitorId);
  }

  // session_id (per tab / sessionStorage)
  let sessionId = sessionStorage.getItem('session_id') || '';
  if (!sessionId) {
    sessionId = uuid();
    sessionStorage.setItem('session_id', sessionId);
  }

  // UA parsing
  const ua = new UAParser();
  const { name: browser, version: browserVer } = ua.getBrowser();
  const { name: os } = ua.getOS();
  const device_type = /mobile/i.test(ua.getDevice().type || '')
    ? 'mobile'
    : 'desktop';

  // performance
  const nav = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  const page_load_time_ms = nav ? Math.round(nav.duration) : 0;

  const row = {
    visitor_id: visitorId,
    session_id: sessionId,
    user_agent: navigator.userAgent,
    ip_address: '', // added in Edge route
    country: '',
    city: '',
    domain: location.hostname,
    page_url: path,
    referrer_url: document.referrer || '',
    timestamp: new Date().toISOString(),
    device_type,
    browser: `${browser ?? ''} ${browserVer ?? ''}`.trim(),
    os: os ?? '',
    is_new_visitor: sessionStorage.getItem('has_visited') ? 0 : 1,
    page_load_time_ms,
    time_on_page_seconds: 0,
  };

  // mark session so next hit isn't "new"
  sessionStorage.setItem('has_visited', '1');

  try {
    const debug =
      (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_MODE === 'true') ||
      false;
    const res = await fetch('/api/tb-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row) + '\n', // NDJSON newline
      keepalive: true,
    });

    if (!res.ok && debug) {
      console.warn('[track] /api/tb-events failed:', res.status, await res.text());
    }
  } catch (err) {
    const debug =
      (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_MODE === 'true') ||
      false;
    if (debug) {
      console.warn('[track] fetch threw:', err);
    }
  }
}
