// Thin client for the official Garmin Connect Personal API (read-only).
// Runs unchanged in the Worker and in Node (scripts/backfill.ts): it only uses fetch.
import type {
  ActivitySummaryDTO,
  DailySleepDTO,
  DailySummariesV2Response,
  HrvDailySummaryDTO,
  SummarizedActivityDTO,
  UserDailySummaryDto,
} from './types.ts';

const BASE_URL = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const MAX_ATTEMPTS = 4;
// Measured: ~100 requests per minute per token; a 429 carries Retry-After (seconds).
const MAX_RETRY_AFTER_S = 60;

export class GarminApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string) {
    super(`Garmin API ${status} for ${path}`);
    this.status = status;
    this.path = path;
  }
}

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0)
    return Math.min(retryAfter, MAX_RETRY_AFTER_S) * 1000 + 250;
  return 1000 * 2 ** (attempt - 1);
}

export interface GarminClientOptions {
  /** Minimum gap between requests; the backfill uses it to stay under the rate limit. */
  minIntervalMs?: number;
}

export class GarminClient {
  private readonly accessToken: string;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  private constructor(accessToken: string, options: GarminClientOptions) {
    this.accessToken = accessToken;
    this.minIntervalMs = options.minIntervalMs ?? 0;
  }

  /** Exchanges the personal API key for a 24 h access token. There is no refresh token. */
  static async connect(apiKey: string, options: GarminClientOptions = {}): Promise<GarminClient> {
    const res = await fetch(BASE_URL + TOKEN_PATH, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${apiKey}` },
    });
    // The response body is the bare JWT as text/plain, not JSON.
    if (!res.ok) throw new GarminApiError(res.status, TOKEN_PATH);
    return new GarminClient((await res.text()).trim(), options);
  }

  /** Resolves to null when Garmin answers 2xx with an empty body (seen for dates before the account existed). */
  private async getJson<T>(path: string): Promise<T | null> {
    for (let attempt = 1; ; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      const res = await fetch(BASE_URL + path, {
        headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
      });
      if (res.ok) {
        const text = await res.text();
        return text.trim() ? (JSON.parse(text) as T) : null;
      }
      if (!isTransient(res.status) || attempt >= MAX_ATTEMPTS) throw new GarminApiError(res.status, path);
      await sleep(retryDelayMs(res, attempt));
    }
  }

  /** Up to 31 days. calendarDate is the wake-up day. */
  async sleepRange(start: string, end: string): Promise<DailySleepDTO[]> {
    return (
      (await this.getJson<DailySleepDTO[]>(
        `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${start}&endDate=${end}`,
      )) ?? []
    );
  }

  async hrvRange(start: string, end: string): Promise<HrvDailySummaryDTO> {
    return (await this.getJson<HrvDailySummaryDTO>(`/hrv-service/hrv/daily/${start}/${end}`)) ?? {};
  }

  /** Up to 1 year. */
  async dailySummariesV2(start: string, end: string): Promise<DailySummariesV2Response> {
    const path = `/usersummary-service/v2/dailysummaries?startDate=${start}&endDate=${end}`;
    return (await this.getJson<DailySummariesV2Response>(path)) ?? {};
  }

  async dailySummaryV1(date: string): Promise<UserDailySummaryDto> {
    const path = `/usersummary-service/usersummary/daily?calendarDate=${date}`;
    return (await this.getJson<UserDailySummaryDto>(path)) ?? {};
  }

  /** Dates filter on the activity's local start date, inclusive. */
  async activities(params: {
    start?: string;
    end?: string;
    offset?: number;
    limit?: number;
  }): Promise<SummarizedActivityDTO[]> {
    const query = new URLSearchParams({
      start: String(params.offset ?? 0),
      limit: String(params.limit ?? 100),
      sortOrder: 'desc',
    });
    if (params.start) query.set('startDate', params.start);
    if (params.end) query.set('endDate', params.end);
    const path = `/activitylist-service/activities/search/activities?${query}`;
    return (await this.getJson<SummarizedActivityDTO[]>(path)) ?? [];
  }

  /** Throws GarminApiError(404) for an unknown id. */
  activityDetail(activityId: number): Promise<ActivitySummaryDTO | null> {
    return this.getJson<ActivitySummaryDTO>(`/activity-service/activity/${activityId}`);
  }
}
