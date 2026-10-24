import { afterEach, describe, expect, it, vi } from 'vitest';
import { GarminApiError, GarminClient } from '../src/garmin/client.ts';

function stubFetch(responses: Response[]) {
  const fetchMock = vi.fn(async () => responses.shift() ?? new Response('', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('GarminClient', () => {
  it('reads the token as plain text and treats an empty 200 body as no data', async () => {
    stubFetch([new Response('header.payload.sig\n'), new Response(''), new Response('')]);
    const client = await GarminClient.connect('key');
    expect(await client.sleepRange('2022-08-01', '2022-08-31')).toEqual([]);
    expect(await client.dailySummaryV1('2022-08-01')).toEqual({});
  });

  it('does not retry a non-transient error', async () => {
    const fetchMock = stubFetch([new Response('jwt'), new Response('', { status: 400 })]);
    const client = await GarminClient.connect('key');
    await expect(client.hrvRange('2026-01-01', '2026-03-01')).rejects.toBeInstanceOf(GarminApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
