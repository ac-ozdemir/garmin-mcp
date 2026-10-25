// Builds parameterised upserts once, so the Worker (D1 binding) and the backfill script (SQL file) share them.
import type { ActivityRow, DailyWellnessRow, HrvRow, SleepRow, SyncRunRow } from './rows.ts';

export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params: SqlValue[];
}

function upsert(table: string, key: string, row: object): Statement {
  const columns = Object.keys(row);
  const updates = columns.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`);
  return {
    sql:
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ` +
      `ON CONFLICT (${key}) DO UPDATE SET ${updates.join(', ')}`,
    params: Object.values(row) as SqlValue[],
  };
}

export const upsertSleep = (row: SleepRow) => upsert('sleep_nights', 'calendar_date', row);
export const upsertHrv = (row: HrvRow) => upsert('hrv_nights', 'calendar_date', row);
export const upsertDailyWellness = (row: DailyWellnessRow) => upsert('daily_wellness', 'calendar_date', row);

/**
 * Sets only the calorie columns of an existing day. Used by the calories-only backfill, which reads v2 alone:
 * a full upsert would null the v1-only columns (Body Battery during sleep, 7-day resting HR).
 */
export function updateDailyCalories(
  row: Pick<
    DailyWellnessRow,
    'calendar_date' | 'burned_total_kcal' | 'burned_active_kcal' | 'burned_resting_kcal'
  >,
): Statement {
  return {
    sql: 'UPDATE daily_wellness SET burned_total_kcal = ?, burned_active_kcal = ?, burned_resting_kcal = ? WHERE calendar_date = ?',
    params: [row.burned_total_kcal, row.burned_active_kcal, row.burned_resting_kcal, row.calendar_date],
  };
}
export const upsertActivity = (row: ActivityRow) => upsert('activities', 'activity_id', row);

export function insertSyncRun(row: SyncRunRow): Statement {
  const columns = Object.keys(row);
  return {
    sql: `INSERT INTO sync_runs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    params: Object.values(row) as SqlValue[],
  };
}

function literal(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot write non-finite number ${value}`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/** Inlines params for `wrangler d1 execute --file`. Only used offline by the backfill script. */
export function toSqlText(statement: Statement): string {
  let index = 0;
  const sql = statement.sql.replace(/\?/g, () => literal(statement.params[index++] ?? null));
  if (index !== statement.params.length) throw new Error('placeholder/param count mismatch');
  return `${sql};`;
}
