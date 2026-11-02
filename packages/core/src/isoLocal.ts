/**
 * The run stamp written into every sidecar (`generated`): an ISO 8601 instant with the author's UTC offset, e.g.
 * `2026-10-29T22:16:59.781-04:00`, never the `Z` form of `Date#toISOString`. Its first ten characters are the author's calendar
 * day, which is the date a report page prints, so a renderer in any zone reproduces the page byte for byte (the second CI run of
 * v5.9, 2026-11-01, printed 2026-10-30 on the UTC runner for a run of the evening of 2026-10-29 in US Eastern time, because the
 * recipes formatted the stamp in the renderer's zone). `new Date(stamp)` recovers the exact instant. Stamps of earlier sidecars
 * keep the `Z` form; their page date is the UTC day.
 */
export function isoLocal(d: Date = new Date()): string {
  const east = -d.getTimezoneOffset(); // minutes east of UTC; a UTC machine prints +00:00
  const sign = east < 0 ? '-' : '+';
  const p = (n: number, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}${sign}${p(east / 60)}:${p(east % 60)}`;
}

/** The calendar day of a sidecar stamp as the report pages print it: its first ten characters; '—' for anything else. */
export function stampDay(stamp: unknown): string {
  return typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(stamp) ? stamp.slice(0, 10) : '—';
}
