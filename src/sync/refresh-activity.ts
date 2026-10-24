// On-demand refresh of one activity, e.g. after a note was added in Garmin Connect.
// The list endpoint is the source of truth for activity rows, so the detail call only supplies the date.
import type { Env } from '../env.ts';
import type { ActivityRow } from '../db/rows.ts';
import { insertSyncRun, upsertActivity, type Statement } from '../db/statements.ts';
import { GarminApiError, GarminClient } from '../garmin/client.ts';
import type { SummarizedActivityDTO } from '../garmin/types.ts';
import { OWNER_TIME_ZONE, todayIn } from '../shared/dates.ts';
import { errorDetail, log } from '../shared/log.ts';
import { toActivityRow } from './mappers.ts';

export type RefreshResult =
  | {
      status: 'updated';
      row: ActivityRow;
      descriptionInGarminResponse: boolean;
      previousDescription: string | null;
    }
  | { status: 'not_found' };

/** Finds one activity's list item. Shared with scripts/refresh-activity.ts. */
export async function fetchActivityItem(
  client: GarminClient,
  activityId: number,
): Promise<SummarizedActivityDTO | null> {
  let detail;
  try {
    detail = await client.activityDetail(activityId);
  } catch (error) {
    if (error instanceof GarminApiError && error.status === 404) return null;
    throw error;
  }
  const day = detail?.summaryDTO?.startTimeLocal?.slice(0, 10);
  if (!day) return null;
  return (await client.activities({ start: day, end: day })).find((a) => a.activityId === activityId) ?? null;
}

export const MANUAL_TRIGGER = 'manual';

/**
 * A sync_runs row for a one-activity refresh, so manual refreshes show up next to cron runs.
 * The window is the activity's local date (today when the activity was not found).
 */
export function manualRunStatement(run: {
  startedAt: string;
  activityId: number;
  day: string | null;
  source: 'mcp' | 'script';
  error: string | null;
}): Statement {
  const day = run.day ?? todayIn(OWNER_TIME_ZONE);
  return insertSyncRun({
    started_at: run.startedAt,
    finished_at: new Date().toISOString(),
    trigger: MANUAL_TRIGGER,
    window_start: day,
    window_end: day,
    status: run.error ? 'error' : 'ok',
    counts_json: JSON.stringify({
      activities: run.error ? 0 : 1,
      activity_id: run.activityId,
      source: run.source,
    }),
    error: run.error,
  });
}

const prepared = (db: D1Database, s: Statement) => db.prepare(s.sql).bind(...s.params);

export async function refreshActivity(env: Env, activityId: number): Promise<RefreshResult> {
  const startedAt = new Date().toISOString();
  const runFor = (day: string | null, error: string | null) =>
    prepared(env.DB, manualRunStatement({ startedAt, activityId, day, source: 'mcp', error }));

  let item;
  try {
    item = await fetchActivityItem(await GarminClient.connect(env.GARMIN_API_KEY), activityId);
  } catch (error) {
    log.error('activity refresh failed', { activityId, ...errorDetail(error) });
    await runFor(null, error instanceof Error ? error.message : String(error)).run();
    throw error;
  }
  if (!item) {
    await runFor(null, `activity ${activityId} not found at Garmin`).run();
    return { status: 'not_found' };
  }

  const previous = await env.DB.prepare('SELECT description FROM activities WHERE activity_id = ?')
    .bind(activityId)
    .first<{ description: string | null }>();
  const row = toActivityRow(item, startedAt);
  await env.DB.batch([
    prepared(env.DB, upsertActivity(row)),
    runFor(row.start_time_local?.slice(0, 10) ?? null, null),
  ]);

  log.info('activity refreshed', {
    activityId,
    trigger: MANUAL_TRIGGER,
    hasDescription: row.description != null,
  });
  return {
    status: 'updated',
    row,
    descriptionInGarminResponse: 'description' in item,
    previousDescription: previous?.description ?? null,
  };
}
