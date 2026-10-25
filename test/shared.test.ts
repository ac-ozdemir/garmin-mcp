import { describe, expect, it } from 'vitest';
import { isIsoDate, todayIn, windowsBackwards } from '../src/shared/dates.ts';
import { toSqlText, updateDailyCalories, upsertSleep } from '../src/db/statements.ts';
import { toSleepRow } from '../src/sync/mappers.ts';
import { formatPace } from '../src/mcp/present.ts';

describe('dates', () => {
  it('uses the Istanbul calendar day, not UTC', () => {
    // 22:30 UTC on the 23rd is 01:30 on the 24th in Istanbul (UTC+3).
    expect(todayIn('Europe/Istanbul', new Date('2026-10-23T22:30:00Z'))).toBe('2026-10-24');
  });

  it('rejects impossible dates', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-10-24')).toBe(true);
    expect(isIsoDate('24.10.2026')).toBe(false);
  });

  it('splits a range into newest-first windows that cover it exactly', () => {
    const windows = windowsBackwards('2026-09-01', '2026-10-24', 31);
    expect(windows).toEqual([
      { start: '2026-09-24', end: '2026-10-24' },
      { start: '2026-09-01', end: '2026-09-23' },
    ]);
  });
});

describe('updateDailyCalories', () => {
  it('touches only the calorie columns of an existing day', () => {
    const { sql, params } = updateDailyCalories({
      calendar_date: '2026-10-23',
      burned_total_kcal: 3000,
      burned_active_kcal: 1000,
      burned_resting_kcal: 2000,
    });
    expect(sql).toMatch(
      /^UPDATE daily_wellness SET burned_total_kcal = \?, burned_active_kcal = \?, burned_resting_kcal = \? WHERE/,
    );
    expect(sql).not.toMatch(/body_battery|resting_hr/);
    expect(params).toEqual([3000, 1000, 2000, '2026-10-23']);
  });
});

describe('toSqlText', () => {
  it('inlines params with quote escaping and NULLs', () => {
    const sql = toSqlText(
      upsertSleep(toSleepRow({ calendarDate: "2026-10-24'--", sleepTimeSeconds: 1 }, 'now')),
    );
    expect(sql).toContain("'2026-10-24''--'");
    expect(sql).toContain('NULL');
    expect(sql.endsWith(';')).toBe(true);
  });
});

describe('formatPace', () => {
  it('converts m/s to min/km and ignores missing speed', () => {
    expect(formatPace(2.778)).toBe('6:00');
    expect(formatPace(null)).toBeNull();
    expect(formatPace(0)).toBeNull();
  });
});
