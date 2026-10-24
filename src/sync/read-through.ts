// Read-through for get_sleep / get_daily_wellness: recent days missing from D1 are fetched from Garmin
// at question time, so "last night" works before the next cron run. Older gaps were already checked by the
// backfill and cron, so they are reported, not re-fetched.
import type { Env } from '../env.ts';
import { insertSyncRun, type Statement } from '../db/statements.ts';
import { GarminClient } from '../garmin/client.ts';
import { addDays, eachDay, OWNER_TIME_ZONE, todayIn } from '../shared/dates.ts';
import { errorDetail, log } from '../shared/log.ts';
import { fetchWindow, type WindowCounts } from './fetch-window.ts';

export const ON_DEMAND_TRIGGER = 'on_demand';
/** Today plus the 6 days before it. */
export const READ_THROUGH_DAYS = 7;
/** A date checked on demand this recently is not fetched again (watch not synced yet). */
export const ON_DEMAND_COOLDOWN_MS = 10 * 60 * 1000;

export type ReadThroughTable = 'sleep_nights' | 'daily_wellness';

export type MissingReason =
  /** Today or yesterday, checked just now, Garmin has nothing yet: the watch has probably not synced. */
  | 'not_synced_yet'
  /** Checked (now, by the cron or by the backfill) and Garmin has no record for the day. */
  | 'no_data_at_garmin'
  /** The on-demand fetch failed; stored data is returned as is. */
  | 'garmin_unavailable'
  | 'future_date';

export interface MissingDay {
  date: string;
  reason: MissingReason;
}

export interface ReadThroughResult {
  missing: MissingDay[];
  /** Dates fetched from Garmin during this call. */
  fetched: string[];
}

interface Window {
  start: string;
  end: string;
}

/** Recent, past-or-today dates absent from D1 and not checked on demand within the cooldown. */
export function datesToFetch(params: {
  start: string;
  end: string;
  today: string;
  stored: Set<string>;
  recentOnDemand: Window[];
}): string[] {
  const oldestRecent = addDays(params.today, -(READ_THROUGH_DAYS - 1));
  return eachDay(params.start, params.end).filter(
    (date) =>
      date >= oldestRecent &&
      date <= params.today &&
      !params.stored.has(date) &&
      !params.recentOnDemand.some((w) => w.start <= date && date <= w.end),
  );
}

export function explainMissing(params: {
  start: string;
  end: string;
  today: string;
  stored: Set<string>;
  fetchFailed: Set<string>;
}): MissingDay[] {
  const yesterday = addDays(params.today, -1);
  return eachDay(params.start, params.end)
    .filter((date) => !params.stored.has(date))
    .map((date): MissingDay => {
      if (date > params.today) return { date, reason: 'future_date' };
      if (params.fetchFailed.has(date)) return { date, reason: 'garmin_unavailable' };
      if (date >= yesterday) return { date, reason: 'not_synced_yet' };
      return { date, reason: 'no_data_at_garmin' };
    });
}

/** Short text Claude can relay; null when nothing is missing. */
export function missingNotice(missing: MissingDay[]): string | null {
  if (missing.length === 0) return null;
  const by = (reason: MissingReason) => missing.filter((m) => m.reason === reason).map((m) => m.date);
  const parts: string[] = [];
  const notSynced = by('not_synced_yet');
  if (notSynced.length)
    parts.push(
      `Garmin has no data yet for ${notSynced.join(', ')}: it was checked just now, the watch has probably ` +
        'not synced to Garmin Connect. Sync the watch (open the Connect app) and ask again.',
    );
  const unavailable = by('garmin_unavailable');
  if (unavailable.length)
    parts.push(
      `Could not reach Garmin for ${unavailable.join(', ')}; these days are not stored yet. Try again shortly.`,
    );
  const none = by('no_data_at_garmin');
  if (none.length) parts.push(`Garmin has no record for ${none.join(', ')} (e.g. the watch was not worn).`);
  const future = by('future_date');
  if (future.length) parts.push(`${future.join(', ')} is in the future.`);
  return parts.join(' ');
}

async function storedDates(db: D1Database, table: ReadThroughTable, start: string, end: string) {
  const { results } = await db
    .prepare(`SELECT calendar_date FROM ${table} WHERE calendar_date BETWEEN ? AND ?`)
    .bind(start, end)
    .all<{ calendar_date: string }>();
  return new Set(results.map((r) => r.calendar_date));
}

async function recentOnDemandWindows(db: D1Database, now: Date): Promise<Window[]> {
  const since = new Date(now.getTime() - ON_DEMAND_COOLDOWN_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT window_start AS start, window_end AS end FROM sync_runs
        WHERE trigger = ? AND status = 'ok' AND started_at >= ?`,
    )
    .bind(ON_DEMAND_TRIGGER, since)
    .all<Window>();
  return results;
}

function onDemandRun(
  startedAt: string,
  window: Window,
  tool: string,
  counts: WindowCounts | null,
  error: string | null,
): Statement {
  return insertSyncRun({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    trigger: ON_DEMAND_TRIGGER,
    window_start: window.start,
    window_end: window.end,
    status: error ? 'error' : 'ok',
    counts_json: JSON.stringify({ ...(counts ?? {}), source: tool }),
    error,
  });
}

const prepared = (db: D1Database, s: Statement) => db.prepare(s.sql).bind(...s.params);

/**
 * Makes sure recent days of `table` in [start, end] are in D1, fetching them from Garmin if needed,
 * and explains every day that is still missing afterwards.
 */
export async function ensureRecentDays(
  env: Env,
  params: { table: ReadThroughTable; start: string; end: string; tool: string },
  now: Date = new Date(),
): Promise<ReadThroughResult> {
  const today = todayIn(OWNER_TIME_ZONE, now);
  const { table, start, end, tool } = params;
  const [stored, recentOnDemand] = await Promise.all([
    storedDates(env.DB, table, start, end),
    recentOnDemandWindows(env.DB, now),
  ]);
  const toFetch = datesToFetch({ start, end, today, stored, recentOnDemand });

  const fetchFailed = new Set<string>();
  if (toFetch.length > 0) {
    // One contiguous window: at most 7 days, so ~12 Garmin requests.
    const window = { start: toFetch[0]!, end: toFetch[toFetch.length - 1]! };
    const startedAt = now.toISOString();
    try {
      const client = await GarminClient.connect(env.GARMIN_API_KEY);
      const { statements, counts } = await fetchWindow(client, window.start, window.end, startedAt);
      await env.DB.batch(
        [...statements, onDemandRun(startedAt, window, tool, counts, null)].map((s) => prepared(env.DB, s)),
      );
      log.info('on-demand fetch finished', { tool, ...window, counts });
    } catch (error) {
      log.error('on-demand fetch failed', { tool, ...window, ...errorDetail(error) });
      toFetch.forEach((date) => fetchFailed.add(date));
      const message = error instanceof Error ? error.message : String(error);
      await prepared(env.DB, onDemandRun(startedAt, window, tool, null, message)).run();
    }
  }

  const storedAfter = toFetch.length > 0 ? await storedDates(env.DB, table, start, end) : stored;
  return {
    missing: explainMissing({ start, end, today, stored: storedAfter, fetchFailed }),
    fetched: toFetch,
  };
}
