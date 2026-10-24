// Read side used by the MCP tools.
import type { ActivityRow, DailyWellnessRow, HrvRow, SleepRow, SyncRunRow } from './rows.ts';

export type SleepNight = SleepRow &
  Partial<
    Pick<
      HrvRow,
      'last_night_avg' | 'weekly_avg' | 'status' | 'baseline_balanced_low' | 'baseline_balanced_upper'
    >
  > &
  Partial<Pick<DailyWellnessRow, 'resting_hr' | 'body_battery_during_sleep' | 'body_battery_at_wake'>>;

export async function sleepNights(db: D1Database, start: string, end: string): Promise<SleepNight[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, h.last_night_avg, h.weekly_avg, h.status, h.baseline_balanced_low, h.baseline_balanced_upper,
              w.resting_hr, w.body_battery_during_sleep, w.body_battery_at_wake
         FROM sleep_nights s
         LEFT JOIN hrv_nights h ON h.calendar_date = s.calendar_date
         LEFT JOIN daily_wellness w ON w.calendar_date = s.calendar_date
        WHERE s.calendar_date BETWEEN ? AND ?
        ORDER BY s.calendar_date DESC`,
    )
    .bind(start, end)
    .all<SleepNight>();
  return results;
}

export async function dailyWellness(db: D1Database, start: string, end: string): Promise<DailyWellnessRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM daily_wellness WHERE calendar_date BETWEEN ? AND ? ORDER BY calendar_date DESC')
    .bind(start, end)
    .all<DailyWellnessRow>();
  return results;
}

export async function activitiesBetween(
  db: D1Database,
  start: string,
  end: string,
  activityType: string | undefined,
): Promise<ActivityRow[]> {
  // start_time_local is 'YYYY-MM-DD HH:MM:SS'; compare on the date part.
  const typeFilter = activityType ? 'AND activity_type = ?' : '';
  const params = activityType ? [start, end, activityType] : [start, end];
  const { results } = await db
    .prepare(
      `SELECT * FROM activities WHERE substr(start_time_local, 1, 10) BETWEEN ? AND ? ${typeFilter}
        ORDER BY start_time_local DESC`,
    )
    .bind(...params)
    .all<ActivityRow>();
  return results;
}

export function activityById(db: D1Database, activityId: number): Promise<ActivityRow | null> {
  return db.prepare('SELECT * FROM activities WHERE activity_id = ?').bind(activityId).first<ActivityRow>();
}

export interface SyncStatus {
  lastRuns: Array<SyncRunRow & { id: number }>;
  coverage: Array<{ table: string; first: string | null; last: string | null; rows: number }>;
}

export async function syncStatus(db: D1Database): Promise<SyncStatus> {
  const [runs, sleep, wellness, acts] = await db.batch([
    db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 5'),
    db.prepare(
      'SELECT MIN(calendar_date) AS first, MAX(calendar_date) AS last, COUNT(*) AS rows FROM sleep_nights',
    ),
    db.prepare(
      'SELECT MIN(calendar_date) AS first, MAX(calendar_date) AS last, COUNT(*) AS rows FROM daily_wellness',
    ),
    db.prepare(
      'SELECT MIN(substr(start_time_local,1,10)) AS first, MAX(substr(start_time_local,1,10)) AS last, COUNT(*) AS rows FROM activities',
    ),
  ]);
  type Coverage = { first: string | null; last: string | null; rows: number };
  const cov = (table: string, r: D1Result) => ({ table, ...(r.results[0] as Coverage) });
  return {
    lastRuns: (runs?.results ?? []) as SyncStatus['lastRuns'],
    coverage: [cov('sleep_nights', sleep!), cov('daily_wellness', wellness!), cov('activities', acts!)],
  };
}
