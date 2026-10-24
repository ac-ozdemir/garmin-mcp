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

/** Minimal D1 stand-in: remembers the previous description and captures the upsert. */
function fakeEnv(previousDescription: string | null) {
  const runs: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        first: async () => ({ description: previousDescription }),
        run: async () => {
          runs.push({ sql, params });
          return { success: true };
        },
      }),
    }),
  };
  return { env: { DB: db, GARMIN_API_KEY: 'key' } as unknown as Env, runs };
}

afterEach(() => vi.unstubAllGlobals());

describe('refreshActivity', () => {
  it('reports not_found for an id Garmin does not know', async () => {
    stubGarmin({ '/activity-service/activity/': () => new Response('', { status: 404 }) });
    const { env, runs } = fakeEnv(null);
    expect(await refreshActivity(env, ID)).toEqual({ status: 'not_found' });
    expect(runs).toHaveLength(0);
  });

  it('stores the new description from the list item and returns the old one', async () => {
    stubGarmin({
      '/activity-service/activity/': () =>
        Response.json({ activityId: ID, summaryDTO: { startTimeLocal: '2026-10-24 08:01:00' } }),
      '/activitylist-service/': () =>
        Response.json([
          { activityId: 1, activityName: 'other' },
          { activityId: ID, activityName: 'Morning Run', description: NOTE },
        ]),
    });
    const { env, runs } = fakeEnv(null);
    const result = await refreshActivity(env, ID);

    expect(result).toMatchObject({
      status: 'updated',
      descriptionInGarminResponse: true,
      previousDescription: null,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.sql).toMatch(/^INSERT INTO activities .* ON CONFLICT \(activity_id\) DO UPDATE/);
    expect(runs[0]!.params).toContain(NOTE);
  });
});
