/** Formatting helpers (bilingual units). */
export type Lang = 'zh' | 'en';

export function fmtPct(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)} %`;
}

export function fmtNum(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '—';
  const a = Math.abs(x);
  if (a >= 1e9) return `${(x / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${(x / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `${(x / 1e3).toFixed(digits > 1 ? 1 : 0)}K`;
  if (a >= 100) return x.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 1) return x.toLocaleString('en-US', { maximumFractionDigits: digits });
  if (a === 0) return '0';
  if (a >= 0.001) return x.toFixed(Math.max(digits, 3));
  return x.toExponential(2);
}

export function fmtInt(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return Math.round(x).toLocaleString('en-US');
}

export function fmtMoney(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (Math.abs(x) >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  return `$${x.toFixed(0)}`;
}

export function fmtDuration(seconds: number, lang: Lang = 'en', digits = 1): string {
  if (!Number.isFinite(seconds)) return '∞';
  const u = lang === 'zh' ? { s: '秒', min: '分', h: '小时', d: '天', y: '年' } : { s: 's', min: 'min', h: 'h', d: 'd', y: 'y' };
  const sep = lang === 'zh' ? ' ' : ' ';
  if (seconds < 120) return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(0)}${sep}${u.s}`;
  if (seconds < 7200) return `${(seconds / 60).toFixed(digits)}${sep}${u.min}`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(digits)}${sep}${u.h}`;
  if (seconds < 86400 * 3650) return `${(seconds / 86400).toFixed(digits)}${sep}${u.d}`;
  return `${(seconds / (86400 * 365.25)).toFixed(0)}${sep}${u.y}`;
}

export function fmtHours(h: number, lang: Lang = 'en'): string {
  return fmtDuration(h * 3600, lang);
}

/** per-hour rate shown per million unit-hours */
export function fmtRatePerMillion(r: number): string {
  if (!Number.isFinite(r)) return '—';
  const x = r * 1e6;
  return x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toExponential(2);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
