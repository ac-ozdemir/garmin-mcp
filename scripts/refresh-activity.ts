// Refreshes one activity in the remote D1 from a local shell (same code path as the refresh_activity tool).
// Usage: node scripts/refresh-activity.ts <activityId>   (reads GARMIN_API_KEY from .dev.vars)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { GarminClient } from '../src/garmin/client.ts';
import { toSqlText, upsertActivity } from '../src/db/statements.ts';
import { toActivityRow } from '../src/sync/mappers.ts';
import { fetchActivityItem } from '../src/sync/refresh-activity.ts';

const DATABASE = 'garmin';

async function main(): Promise<void> {
  const activityId = Number(process.argv[2]);
  if (!Number.isSafeInteger(activityId) || activityId <= 0)
    throw new Error('usage: refresh-activity.ts <activityId>');
  const apiKey = fs
    .readFileSync('.dev.vars', 'utf8')
    .match(/^GARMIN_API_KEY=(.+)$/m)?.[1]
    ?.trim();
  if (!apiKey) throw new Error('GARMIN_API_KEY missing in .dev.vars');

  const item = await fetchActivityItem(await GarminClient.connect(apiKey), activityId);
  if (!item) throw new Error(`Garmin has no activity ${activityId}`);
  const row = toActivityRow(item, new Date().toISOString());

  const sql = toSqlText(upsertActivity(row));
  execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, '--remote', '--command', sql, '--yes'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log(`refreshed ${activityId}; description in Garmin response: ${'description' in item}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
