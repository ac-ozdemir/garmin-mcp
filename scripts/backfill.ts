// One-off history import. Runs locally (Node >= 23 strips the types) because a full history is thousands of
// Garmin calls, far over a Worker invocation's subrequest limit. Uses the same fetch/mapping code as the cron.
//
// Usage: npm run backfill -- [--until YYYY-MM-DD] [--since YYYY-MM-DD] [--local] [--calories-only]
//   Walks back from --until (default: yesterday) in 31-day windows until --since or until
//   EMPTY_WINDOWS_TO_STOP consecutive windows return nothing. Reads GARMIN_API_KEY from .dev.vars.
//   --calories-only fills just the daily calorie columns from the v2 summary in 1-year windows
//   (a handful of calls instead of one v1 call per day); other columns are left untouched.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { GarminClient } from '../src/garmin/client.ts';
import { insertSyncRun, toSqlText, updateDailyCalories, type Statement } from '../src/db/statements.ts';
import { addDays, isIsoDate, OWNER_TIME_ZONE, todayIn, windowsBackwards } from '../src/shared/dates.ts';
import { fetchWindow, MAX_WINDOW_DAYS } from '../src/sync/fetch-window.ts';
import { toDailyWellnessRow } from '../src/sync/mappers.ts';

const EMPTY_WINDOWS_TO_STOP = 3;
// ~85 requests/minute, under the measured limit of 100/minute.
const MIN_REQUEST_INTERVAL_MS = 700;
const WINDOWS_PER_IMPORT = 6;
const OUT_DIR = '.wrangler/backfill'; // gitignored: these files contain health data
const DATABASE = 'garmin';
const EARLIEST = '2006-01-01';
/** The v2 daily summary accepts up to one year per call. */
const V2_WINDOW_DAYS = 365;

function readApiKey(): string {
  const match = fs.readFileSync('.dev.vars', 'utf8').match(/^GARMIN_API_KEY=(.+)$/m);
  if (!match?.[1]?.trim()) throw new Error('GARMIN_API_KEY missing in .dev.vars');
  return match[1].trim();
}

function importSql(statements: Statement[], label: string, local: boolean): void {
  if (statements.length === 0) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${label}.sql`);
  fs.writeFileSync(file, statements.map(toSqlText).join('\n') + '\n');
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DATABASE, local ? '--local' : '--remote', '--file', file, '--yes'],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  fs.rmSync(file);
}

type Options = { since: string; until: string; local: boolean };

function syncRun(startedAt: string, windowStart: string, windowEnd: string, counts: object): Statement {
  return insertSyncRun({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    trigger: 'backfill',
    window_start: windowStart,
    window_end: windowEnd,
    status: 'ok',
    counts_json: JSON.stringify(counts),
    error: null,
  });
}

async function backfillAll(client: GarminClient, { since, until, local }: Options): Promise<void> {
  const startedAt = new Date().toISOString();
  const totals = { sleep: 0, hrv: 0, wellness: 0, activities: 0 };
  let pending: Statement[] = [];
  let emptyStreak = 0;
  let oldest = until;
  let batch = 0;

  for (const window of windowsBackwards(since, until, MAX_WINDOW_DAYS)) {
    const { statements, counts } = await fetchWindow(client, window.start, window.end, startedAt);
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += counts[key];
    console.log(`${window.start}..${window.end}`, counts);
    pending.push(...statements);
    oldest = window.start;

    const isEmpty = counts.sleep + counts.wellness + counts.activities === 0;
    emptyStreak = isEmpty ? emptyStreak + 1 : 0;
    if (++batch % WINDOWS_PER_IMPORT === 0) {
      importSql(pending, `batch-${batch}`, local);
      pending = [];
    }
    if (emptyStreak >= EMPTY_WINDOWS_TO_STOP) break;
  }

  importSql([...pending, syncRun(startedAt, oldest, until, totals)], 'final', local);
  console.log('backfill done', { from: oldest, to: until, ...totals });
}

async function backfillCalories(client: GarminClient, { since, until, local }: Options): Promise<void> {
  const startedAt = new Date().toISOString();
  const statements: Statement[] = [];
  let oldest = until;

  for (const window of windowsBackwards(since, until, V2_WINDOW_DAYS)) {
    const days = (await client.dailySummariesV2(window.start, window.end)).data ?? [];
    const rows = days
      .map((d) => toDailyWellnessRow(d, undefined, startedAt))
      .filter((r) => r.burned_total_kcal != null);
    console.log(`${window.start}..${window.end}`, { days: days.length, withCalories: rows.length });
    statements.push(...rows.map(updateDailyCalories));
    oldest = window.start;
    if (days.length === 0) break;
  }

  const counts = { mode: 'calories-only', days_with_calories: statements.length };
  importSql([...statements, syncRun(startedAt, oldest, until, counts)], 'calories', local);
  console.log('calories backfill done', { from: oldest, to: until, ...counts });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      until: { type: 'string' },
      since: { type: 'string' },
      local: { type: 'boolean' },
      'calories-only': { type: 'boolean' },
    },
  });
  const until = values.until ?? addDays(todayIn(OWNER_TIME_ZONE), -1);
  const since = values.since ?? EARLIEST;
  if (!isIsoDate(until) || !isIsoDate(since)) throw new Error('--until/--since must be YYYY-MM-DD');

  const client = await GarminClient.connect(readApiKey(), { minIntervalMs: MIN_REQUEST_INTERVAL_MS });
  const options = { since, until, local: values.local ?? false };
  if (values['calories-only']) await backfillCalories(client, options);
  else await backfillAll(client, options);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
