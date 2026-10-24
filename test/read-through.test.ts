import { describe, expect, it } from 'vitest';
import { eachDay } from '../src/shared/dates.ts';
import { datesToFetch, explainMissing, missingNotice } from '../src/sync/read-through.ts';

const TODAY = '2026-10-25';

describe('datesToFetch', () => {
  it('fetches only recent, past-or-today days that are not stored', () => {
    const dates = datesToFetch({
      start: '2026-09-28',
      end: '2026-10-26',
      today: TODAY,
      stored: new Set(['2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20']),
      recentOnDemand: [],
    });
    // 09-28 is an old gap (already checked by the backfill); 10-26 is in the future.
    expect(dates).toEqual(['2026-10-19', '2026-10-25']);
  });

  it('skips days checked on demand within the cooldown', () => {
    const dates = datesToFetch({
      start: TODAY,
      end: TODAY,
      today: TODAY,
      stored: new Set(),
      recentOnDemand: [{ start: TODAY, end: TODAY }],
    });
    expect(dates).toEqual([]);
  });

  it('does nothing when everything is stored', () => {
    expect(
      datesToFetch({ start: TODAY, end: TODAY, today: TODAY, stored: new Set([TODAY]), recentOnDemand: [] }),
    ).toEqual([]);
  });
});

describe('explainMissing', () => {
  it('gives every missing day an explicit reason', () => {
    const missing = explainMissing({
      start: '2026-09-28',
      end: '2026-10-26',
      today: TODAY,
      // Everything from 09-29 to 10-23 is stored; 09-28 is an old gap, 10-24/25 not synced, 10-26 future.
      stored: new Set(eachDay('2026-09-29', '2026-10-23')),
      fetchFailed: new Set(),
    });
    expect(missing).toEqual([
      { date: '2026-09-28', reason: 'no_data_at_garmin' },
      { date: '2026-10-24', reason: 'not_synced_yet' },
      { date: '2026-10-25', reason: 'not_synced_yet' },
      { date: '2026-10-26', reason: 'future_date' },
    ]);
  });

  it('marks days whose fetch failed as garmin_unavailable', () => {
    const missing = explainMissing({
      start: TODAY,
      end: TODAY,
      today: TODAY,
      stored: new Set(),
      fetchFailed: new Set([TODAY]),
    });
    expect(missing).toEqual([{ date: TODAY, reason: 'garmin_unavailable' }]);
  });
});

describe('missingNotice', () => {
  it('says plainly that the watch has not synced', () => {
    expect(missingNotice([{ date: TODAY, reason: 'not_synced_yet' }])).toMatch(/not synced/);
    expect(missingNotice([])).toBeNull();
  });
});
