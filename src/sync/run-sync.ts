// Scheduled sync: re-pulls the last few days so late watch syncs and edited activities are picked up.
import type { Env } from '../env.ts';
import { GarminClient } from '../garmin/client.ts';
import { insertSyncRun, type Statement } from '../db/statements.ts';
import { addDays, OWNER_TIME_ZONE, todayIn } from '../shared/dates.ts';
import { errorDetail, log } from '../shared/log.ts';
import { fetchWindow, type WindowCounts } from './fetch-window.ts';

export const SYNC_LOOKBACK_DAYS = 3;

const toPrepared = (db: D1Database, s: Statement) => db.prepare(s.sql).bind(...s.params);

export async function runSync(env: Env, trigger: string, now: Date = new Date()): Promise<WindowCounts> {
  const startedAt = now.toISOString();
  const end = todayIn(OWNER_TIME_ZONE, now);
  const start = addDays(end, -(SYNC_LOOKBACK_DAYS - 1));
  const run = { started_at: startedAt, trigger, window_start: start, window_end: end };

  try {
    const client = await GarminClient.connect(env.GARMIN_API_KEY);
    const { statements, counts } = await fetchWindow(client, start, end, startedAt);
    const finished = { ...run, finished_at: new Date().toISOString(), status: 'ok' as const };
    await env.DB.batch(
      [...statements, insertSyncRun({ ...finished, counts_json: JSON.stringify(counts), error: null })].map(
        (s) => toPrepared(env.DB, s),
      ),
    );
    log.info('sync finished', { ...run, counts });
    return counts;
  } catch (error) {
    log.error('sync failed', { ...run, ...errorDetail(error) });
    const message = error instanceof Error ? error.message : String(error);
    await toPrepared(
      env.DB,
      insertSyncRun({
        ...run,
        finished_at: new Date().toISOString(),
        status: 'error',
        counts_json: '{}',
        error: message,
      }),
    ).run();
    throw error;
  }
}
