import { describe, it, expect } from 'vitest';
import { isoLocal, stampDay } from '../src/isoLocal.js';

// The run stamp with the author's UTC offset (v5.9 CI fix of 2026-11-01): the page date is the stamp's first ten characters,
// so the committed pages reproduce under any TZ. The instant of the v5.9 report set, 2026-10-30T02:16:59.781Z, is the evening
// of 2026-10-29 in US Eastern time, where it was generated.
describe('isoLocal — the sidecar run stamp carries the author\'s offset', () => {
  const d = new Date(Date.UTC(2026, 9, 30, 2, 16, 59, 781));
  const s = isoLocal(d);
  const two = (n: number) => String(n).padStart(2, '0');
  it('has the ISO form with an explicit offset, never Z', () => {
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });
  it('denotes the same instant', () => {
    expect(new Date(s).getTime()).toBe(d.getTime());
  });
  it('starts with the calendar day of the machine that wrote it, in whatever zone the test runs', () => {
    const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    expect(s.slice(0, 10)).toBe(day);
    expect(stampDay(s)).toBe(day);
    expect(s.slice(11, 19)).toBe(`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`);
  });
  it('writes the machine offset of that instant (DST-aware)', () => {
    const m = /([+-])(\d{2}):(\d{2})$/.exec(s)!;
    const east = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    expect(east).toBe(0 - d.getTimezoneOffset()); // 0 - x, not -x: a UTC machine would give -0, which toBe tells from +0
  });
  it('stampDay reads a Z stamp of an earlier sidecar as the UTC day and refuses other values', () => {
    expect(stampDay('2026-10-30T02:16:59.781Z')).toBe('2026-10-30');
    expect(stampDay('2026-10-29T22:16:59.781-04:00')).toBe('2026-10-29');
    expect(stampDay('2026-10-27')).toBe('2026-10-27');
    expect(stampDay(undefined)).toBe('—');
    expect(stampDay('today')).toBe('—');
  });
});
