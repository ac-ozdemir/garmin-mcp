// Calendar dates are plain 'YYYY-MM-DD' strings in the owner's time zone, matching Garmin's calendarDate.

export const OWNER_TIME_ZONE = 'Europe/Istanbul';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Splits [start, end] into consecutive windows of at most `maxDays`, newest first. */
export function windowsBackwards(
  start: string,
  end: string,
  maxDays: number,
): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  for (let windowEnd = end; windowEnd >= start; windowEnd = addDays(windowEnd, -maxDays)) {
    const windowStart = addDays(windowEnd, -(maxDays - 1));
    windows.push({ start: windowStart < start ? start : windowStart, end: windowEnd });
  }
  return windows;
}
