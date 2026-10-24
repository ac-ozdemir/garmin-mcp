import { describe, expect, it } from 'vitest';
import { hasSleepData, toActivityRow, toDailyWellnessRow, toSleepRow } from '../src/sync/mappers.ts';
import { presentSleep } from '../src/mcp/present.ts';

const FETCHED = '2026-10-24T07:30:00.000Z';

// Shaped like a real response (night 23->24, illustrative values), trimmed to the fields we map.
const sleep24 = {
  calendarDate: '2026-10-24',
  sleepTimeSeconds: 25200,
  deepSleepSeconds: 5400,
  lightSleepSeconds: 14400,
  remSleepSeconds: 4500,
  awakeSleepSeconds: 900,
  awakeCount: 1,
  sleepStartTimestampLocal: Date.UTC(2026, 9, 23, 23, 41),
  sleepScores: { overall: { value: 78, qualifierKey: 'FAIR' }, restlessness: { qualifierKey: 'FAIR' } },
};

describe('toSleepRow', () => {
  it('maps the validated night and keeps absent fields null', () => {
    const row = toSleepRow(sleep24, FETCHED);
    expect(row).toMatchObject({
      calendar_date: '2026-10-24',
      sleep_score: 78,
      sleep_score_qualifier: 'FAIR',
      restlessness_qualifier: 'FAIR',
      total_sleep_s: 25200,
      sleep_start_local: '2026-10-23T23:41',
    });
    expect(row.avg_respiration).toBeNull();
    expect(row.nap_s).toBeNull();
  });

  it('formats durations like the Garmin app (7h00 / 1h30 / 4h00 / 1h15 / 15m)', () => {
    const { computed } = presentSleep(toSleepRow(sleep24, FETCHED));
    expect(computed).toEqual({ total: '7h00', deep: '1h30', light: '4h00', rem: '1h15', awake: '15m' });
  });

  it('treats stub days without durations as no data', () => {
    expect(hasSleepData({ calendarDate: '2026-10-25' })).toBe(false);
    expect(hasSleepData(sleep24)).toBe(true);
  });
});

describe('toDailyWellnessRow', () => {
  it('merges v2 range data with the v1 sleep Body Battery gain', () => {
    const row = toDailyWellnessRow(
      { calendarDate: '2026-10-24', heartRate: { restingValue: 52 }, bodyBattery: { chargedValue: 60 } },
      { bodyBatteryDuringSleep: 58, bodyBatteryAtWakeTime: 66 },
      FETCHED,
    );
    expect(row).toMatchObject({ resting_hr: 52, body_battery_charged: 60, body_battery_during_sleep: 58 });
    expect(row.steps).toBeNull();
  });

  it('leaves v1-only fields null when the v1 call is skipped', () => {
    const row = toDailyWellnessRow({ calendarDate: '2026-10-24' }, undefined, FETCHED);
    expect(row.body_battery_during_sleep).toBeNull();
    expect(row.resting_hr_7d_avg).toBeNull();
  });
});

describe('toActivityRow', () => {
  it('nulls a blank description and keeps a real 0 from Garmin', () => {
    const row = toActivityRow(
      { activityId: 1, description: '  ', hrTimeInZone_1: 3600, hrTimeInZone_2: 0 },
      FETCHED,
    );
    expect(row.description).toBeNull();
    expect(JSON.parse(row.extras_json).hr_time_in_zone_s).toEqual([3600, 0, null, null, null]);
  });

  it('stores no zone array when Garmin sent none', () => {
    const row = toActivityRow({ activityId: 2 }, FETCHED);
    expect(JSON.parse(row.extras_json)).toEqual({
      hr_time_in_zone_s: null,
      split_summaries: null,
      exercise_sets: null,
    });
  });
});
