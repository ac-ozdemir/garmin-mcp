// MCP tools. They read D1. get_sleep / get_daily_wellness fetch missing recent days from Garmin first
// (read-through); refresh_activity re-pulls one activity on explicit request.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../env.ts';
import { activitiesBetween, activityById, dailyWellness, sleepNights, syncStatus } from '../db/queries.ts';
import { addDays, daysBetweenInclusive, isIsoDate, OWNER_TIME_ZONE, todayIn } from '../shared/dates.ts';
import { errorDetail, log } from '../shared/log.ts';
import { ensureRecentDays, missingNotice, READ_THROUGH_DAYS } from '../sync/read-through.ts';
import { refreshActivity } from '../sync/refresh-activity.ts';
import { presentActivityDetail, presentActivitySummary, presentSleep, presentWellness } from './present.ts';

const MAX_RANGE_DAYS = 120;

const dateArg = z.string().describe('YYYY-MM-DD');
const rangeArgs = {
  start_date: dateArg.optional().describe('YYYY-MM-DD, inclusive. Defaults to today (Europe/Istanbul).'),
  end_date: dateArg.optional().describe('YYYY-MM-DD, inclusive. Defaults to start_date.'),
};

const SOURCE_NOTE =
  'Values come from Garmin Connect (Personal API) unless they sit under `computed`, which this server derives ' +
  '(formatted durations, km, pace). null means Garmin did not report the value; it is never replaced with 0.';

type Range = { start: string; end: string } | { error: string };

function resolveRange(startDate: string | undefined, endDate: string | undefined): Range {
  const start = startDate ?? todayIn(OWNER_TIME_ZONE);
  const end = endDate ?? start;
  if (!isIsoDate(start) || !isIsoDate(end)) return { error: 'Dates must be valid YYYY-MM-DD.' };
  if (end < start) return { error: 'end_date is before start_date.' };
  if (daysBetweenInclusive(start, end) > MAX_RANGE_DAYS)
    return { error: `Range is limited to ${MAX_RANGE_DAYS} days.` };
  return { start, end };
}

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }],
});
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

const READ_THROUGH_NOTE =
  `Days of the last ${READ_THROUGH_DAYS} that are not stored yet are fetched from Garmin during the call. ` +
  'Every requested day without data is listed in `missing` with a reason (not_synced_yet: Garmin has nothing ' +
  'yet, the watch has probably not synced; no_data_at_garmin; garmin_unavailable; future_date) and summarised ' +
  'in `notice`. Tell the user about `notice` instead of presenting missing days as empty values. ';

export function createMcpServer(env: Env): McpServer {
  const server = new McpServer({ name: 'garmin', version: '0.1.0' });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    'get_sleep',
    {
      title: 'Sleep by night',
      description:
        'Sleep per night for a date range. The date is the WAKE-UP day: "last night" is today, the night of ' +
        '23->24 Oct is 2026-10-24. Fields: sleep_score + qualifier, total/deep/light/REM/awake seconds, awake_count, ' +
        'restlessness_qualifier (Garmin exposes only a label; restlessness_value is always null because the API has ' +
        'no number), avg_sleep_stress, avg_respiration, overnight HRV (hrv_last_night_ms, hrv_weekly_avg_ms, ' +
        'hrv_status, balanced range; from Garmin HRV service), resting_hr and Body Battery gained during sleep / ' +
        'at wake (from the Garmin daily summary of that day). ' +
        READ_THROUGH_NOTE +
        SOURCE_NOTE,
      inputSchema: rangeArgs,
      annotations: { ...readOnly, openWorldHint: true, title: 'Sleep by night' },
    },
    async ({ start_date, end_date }) => {
      const range = resolveRange(start_date, end_date);
      if ('error' in range) return fail(range.error);
      const { missing, fetched } = await ensureRecentDays(env, {
        table: 'sleep_nights',
        ...range,
        tool: 'get_sleep',
      });
      const nights = await sleepNights(env.DB, range.start, range.end);
      return json({
        start_date: range.start,
        end_date: range.end,
        notice: missingNotice(missing),
        missing,
        fetched_from_garmin_now: fetched,
        nights: nights.map(presentSleep),
      });
    },
  );

  server.registerTool(
    'get_daily_wellness',
    {
      title: 'Daily wellness',
      description:
        'Daily wellness per calendar day: resting_hr, resting_hr_7d_avg, min/max HR, Body Battery ' +
        '(min, max, charged, drained, during_sleep, at_wake), stress (avg, max, qualifier), steps and step goal. ' +
        'Today is partial until the day ends. ' +
        READ_THROUGH_NOTE +
        SOURCE_NOTE,
      inputSchema: rangeArgs,
      annotations: { ...readOnly, openWorldHint: true, title: 'Daily wellness' },
    },
    async ({ start_date, end_date }) => {
      const range = resolveRange(start_date, end_date);
      if ('error' in range) return fail(range.error);
      const { missing, fetched } = await ensureRecentDays(env, {
        table: 'daily_wellness',
        ...range,
        tool: 'get_daily_wellness',
      });
      const days = await dailyWellness(env.DB, range.start, range.end);
      return json({
        start_date: range.start,
        end_date: range.end,
        notice: missingNotice(missing),
        missing,
        fetched_from_garmin_now: fetched,
        days: days.map(presentWellness),
      });
    },
  );

  server.registerTool(
    'list_activities',
    {
      title: 'List activities',
      description:
        'Activities whose local start date is in the range, newest first: id, type, name, the user-written ' +
        'description (null if none was written in Garmin Connect), distance, duration, avg HR, training load. ' +
        'Defaults to the last 7 days. Use get_activity for full detail. ' +
        SOURCE_NOTE,
      inputSchema: {
        ...rangeArgs,
        activity_type: z
          .string()
          .optional()
          .describe('Garmin type key, e.g. running, hiit, strength_training'),
      },
      annotations: { ...readOnly, title: 'List activities' },
    },
    async ({ start_date, end_date, activity_type }) => {
      const today = todayIn(OWNER_TIME_ZONE);
      const range = resolveRange(
        start_date ?? addDays(today, -6),
        end_date ?? (start_date ? undefined : today),
      );
      if ('error' in range) return fail(range.error);
      const rows = await activitiesBetween(env.DB, range.start, range.end, activity_type);
      return json({
        start_date: range.start,
        end_date: range.end,
        activities: rows.map(presentActivitySummary),
      });
    },
  );

  server.registerTool(
    'get_activity',
    {
      title: 'Activity detail',
      description:
        'One activity by id: summary, user description, HR (avg/max, seconds in zones 1-5), speed, cadence, ' +
        'running dynamics averages (vertical oscillation cm, ground contact ms, stride length cm, vertical ratio %), ' +
        'power, training effect/load, Garmin split summaries (run/walk/stand or workout rounds), and exercise sets ' +
        '(category, reps, weight in grams; only filled for activities recorded with the Strength profile). ' +
        'Per-second streams and laps are not included. ' +
        SOURCE_NOTE,
      inputSchema: { activity_id: z.number().int().positive() },
      annotations: { ...readOnly, title: 'Activity detail' },
    },
    async ({ activity_id }) => {
      const row = await activityById(env.DB, activity_id);
      return row ? json(presentActivityDetail(row)) : fail(`No stored activity with id ${activity_id}.`);
    },
  );

  server.registerTool(
    'get_sync_status',
    {
      title: 'Sync status',
      description:
        "Today's date in Europe/Istanbul, the last sync runs (twice daily) and the date coverage of the stored " +
        'data. Use it to tell whether last night is synced yet.',
      inputSchema: {},
      annotations: { ...readOnly, title: 'Sync status' },
    },
    async () => json({ today: todayIn(OWNER_TIME_ZONE), ...(await syncStatus(env.DB)) }),
  );

  server.registerTool(
    'refresh_activity',
    {
      title: 'Refresh one activity',
      description:
        'Pulls one activity fresh from Garmin Connect and overwrites the stored copy. Use it when the user says ' +
        'they just added or edited a note/description, or renamed an activity, and the stored data is stale ' +
        '(the scheduled sync only re-reads the last 3 days). Returns the same shape as get_activity plus ' +
        '`refresh`: whether Garmin sent a description and what was stored before. Read-only towards Garmin.',
      inputSchema: { activity_id: z.number().int().positive() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ activity_id }) => {
      try {
        const result = await refreshActivity(env, activity_id);
        if (result.status === 'not_found') return fail(`Garmin has no activity with id ${activity_id}.`);
        return json({
          ...presentActivityDetail(result.row),
          refresh: {
            fetched_at: result.row.fetched_at,
            description_in_garmin_response: result.descriptionInGarminResponse,
            previous_description: result.previousDescription,
          },
        });
      } catch (error) {
        log.error('refresh_activity failed', { activityId: activity_id, ...errorDetail(error) });
        return fail('Could not reach Garmin right now; the stored copy is unchanged. Try again in a minute.');
      }
    },
  );

  return server;
}
