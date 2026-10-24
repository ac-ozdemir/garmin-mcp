import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env.ts';
import { refreshActivity } from '../src/sync/refresh-activity.ts';

const ID = 1234567890;
const NOTE = 'RPE 3 · Ağrı: yok\nKolay tempo, nabız ≤145 — ğüşıöç';

function stubGarmin(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/token')) return new Response('jwt');
      const route = Object.keys(routes).find((prefix) => path.startsWith(prefix));
      return route ? routes[route]!() : new Response('', { status: 500 });
    }),
  );
}

type Executed = { sql: string; params: unknown[] };

/** Minimal D1 stand-in: remembers the previous description and captures every write, batched or not. */
function fakeEnv(previousDescription: string | null) {
  const runs: Executed[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        sql,
        params,
        first: async () => ({ description: previousDescription }),
        run: async () => {
          runs.push({ sql, params });
          return { success: true };
        },
      }),
    }),
    batch: async (statements: Executed[]) => {
      runs.push(...statements.map(({ sql, params }) => ({ sql, params })));
      return [];
    },
  };
  return { env: { DB: db, GARMIN_API_KEY: 'key' } as unknown as Env, runs };
}

/** Columns of the sync_runs insert, keyed by name. */
function syncRun(executed: Executed | undefined): Record<string, unknown> {
  const columns = executed?.sql.match(/INSERT INTO sync_runs \(([^)]+)\)/)?.[1]?.split(', ') ?? [];
  return Object.fromEntries(columns.map((c, i) => [c, executed?.params[i]]));
}

afterEach(() => vi.unstubAllGlobals());

describe('refreshActivity', () => {
  it('reports not_found for an id Garmin does not know', async () => {
    stubGarmin({ '/activity-service/activity/': () => new Response('', { status: 404 }) });
    const { env, runs } = fakeEnv(null);
    expect(await refreshActivity(env, ID)).toEqual({ status: 'not_found' });
    expect(runs).toHaveLength(1);
    expect(syncRun(runs[0])).toMatchObject({ trigger: 'manual', status: 'error' });
  });

  it('stores the new description from the list item and returns the old one', async () => {
    stubGarmin({
      '/activity-service/activity/': () =>
        Response.json({ activityId: ID, summaryDTO: { startTimeLocal: '2026-10-24 08:01:00' } }),
      '/activitylist-service/': () =>
        Response.json([
          { activityId: 1, activityName: 'other' },
          {
            activityId: ID,
            activityName: 'Morning Run',
            description: NOTE,
            startTimeLocal: '2026-10-24 09:29:41',
          },
        ]),
    });
    const { env, runs } = fakeEnv(null);
    const result = await refreshActivity(env, ID);

    expect(result).toMatchObject({
      status: 'updated',
      descriptionInGarminResponse: true,
      previousDescription: null,
    });
    expect(runs).toHaveLength(2);
    expect(runs[0]!.sql).toMatch(/^INSERT INTO activities .* ON CONFLICT \(activity_id\) DO UPDATE/);
    expect(runs[0]!.params).toContain(NOTE);
    const run = syncRun(runs[1]);
    expect(run).toMatchObject({ trigger: 'manual', status: 'ok', window_start: '2026-10-24', error: null });
    expect(JSON.parse(String(run.counts_json))).toEqual({ activities: 1, activity_id: ID, source: 'mcp' });
  });
});
