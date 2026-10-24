// Fetches one date window from Garmin and turns it into upsert statements.
// Shared by the cron sync (3 days) and the offline backfill (31-day windows).
import type { GarminClient } from '../garmin/client.ts';
import type { UserDailySummaryDto } from '../garmin/types.ts';
import { daysBetweenInclusive, eachDay } from '../shared/dates.ts';
import {
  upsertActivity,
  upsertDailyWellness,
  upsertHrv,
  upsertSleep,
  type Statement,
} from '../db/statements.ts';
import { hasSleepData, toActivityRow, toDailyWellnessRow, toHrvRow, toSleepRow } from './mappers.ts';

export const MAX_WINDOW_DAYS = 31;
const ACTIVITY_PAGE_SIZE = 100;

export interface WindowCounts {
  sleep: number;
  hrv: number;
  wellness: number;
  activities: number;
}

export interface WindowResult {
  statements: Statement[];
  counts: WindowCounts;
}

export async function fetchWindow(
  client: GarminClient,
  start: string,
  end: string,
  fetchedAt: string,
): Promise<WindowResult> {
  if (daysBetweenInclusive(start, end) > MAX_WINDOW_DAYS)
    throw new Error(`window ${start}..${end} exceeds 31 days`);

  const [sleeps, hrv, summaries] = await Promise.all([
    client.sleepRange(start, end),
    client.hrvRange(start, end),
    client.dailySummariesV2(start, end),
  ]);

  // The v1 summary is the only source of Body Battery gained during sleep; it is one call per day.
  const v1ByDate = new Map<string, UserDailySummaryDto>();
  for (const day of eachDay(start, end)) v1ByDate.set(day, await client.dailySummaryV1(day));

  const sleepRows = sleeps.filter(hasSleepData).map((s) => toSleepRow(s, fetchedAt));
  const hrvRows = (hrv.hrvSummaries ?? []).map((h) => toHrvRow(h, fetchedAt));
  const wellnessRows = (summaries.data ?? []).map((d) =>
    toDailyWellnessRow(d, v1ByDate.get(d.calendarDate), fetchedAt),
  );

  const activityRows = [];
  for (let offset = 0; ; offset += ACTIVITY_PAGE_SIZE) {
    const page = await client.activities({ start, end, offset, limit: ACTIVITY_PAGE_SIZE });
    activityRows.push(...page.map((a) => toActivityRow(a, fetchedAt)));
    if (page.length < ACTIVITY_PAGE_SIZE) break;
  }

  return {
    statements: [
      ...sleepRows.map(upsertSleep),
      ...hrvRows.map(upsertHrv),
      ...wellnessRows.map(upsertDailyWellness),
      ...activityRows.map(upsertActivity),
    ],
    counts: {
      sleep: sleepRows.length,
      hrv: hrvRows.length,
      wellness: wellnessRows.length,
      activities: activityRows.length,
    },
  };
}
