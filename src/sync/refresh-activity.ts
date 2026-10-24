// On-demand refresh of one activity, e.g. after a note was added in Garmin Connect.
// The list endpoint is the source of truth for activity rows, so the detail call only supplies the date.
import type { Env } from '../env.ts';
import type { ActivityRow } from '../db/rows.ts';
import { upsertActivity } from '../db/statements.ts';
import { GarminApiError, GarminClient } from '../garmin/client.ts';
import type { SummarizedActivityDTO } from '../garmin/types.ts';
import { log } from '../shared/log.ts';
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

export async function refreshActivity(env: Env, activityId: number): Promise<RefreshResult> {
  const client = await GarminClient.connect(env.GARMIN_API_KEY);
  const item = await fetchActivityItem(client, activityId);
  if (!item) return { status: 'not_found' };

  const previous = await env.DB.prepare('SELECT description FROM activities WHERE activity_id = ?')
    .bind(activityId)
    .first<{ description: string | null }>();
  const row = toActivityRow(item, new Date().toISOString());
  const statement = upsertActivity(row);
  await env.DB.prepare(statement.sql)
    .bind(...statement.params)
    .run();

  log.info('activity refreshed', { activityId, hasDescription: row.description != null });
  return {
    status: 'updated',
    row,
    descriptionInGarminResponse: 'description' in item,
    previousDescription: previous?.description ?? null,
  };
}
