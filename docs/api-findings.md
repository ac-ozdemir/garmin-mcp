# Garmin Connect Personal API — Phase 0 findings

Probed on 2026-10-24 against a real account with `scripts/probe.mjs`, `scripts/fit-probe.mjs`
and `scripts/history-probe.mjs`. Raw responses live in `probe-output/` (gitignored).

Sources:

- https://developer.garmin.com/gc-developer-program/personal/personal-api/
- https://developer.garmin.com/gc-developer-program/personal/personal-faq/
- https://developer.garmin.com/gc-developer-program/personal/swagger-docs/ — the OpenAPI 3.0.1 spec
  embedded in that page (not redistributed here: it is Garmin's content).

## Verdict

The architecture holds. All endpoints are plain HTTPS + Bearer JWT, no browser session or SSO.
The real responses match the spec, with a few extra undocumented fields (`retro`) and some
documented ones missing (see "Sleep" below). Calls from a Cloudflare Worker are verified at deploy time
(README, "Verification").

## Auth

| Item           | Finding                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key            | Created at connect.garmin.com/app/settings/personalApiToken; expiry 30/90/180/365 days; shown once. Garmin emails a week before expiry.          |
| Token endpoint | `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token`, header `Authorization: ApiKey <key>` |
| Token response | `200`, `content-type: text/plain`, body is the **bare JWT** (≈1141 chars), not JSON.                                                             |
| Token lifetime | `exp - iat` = **24 h** (FAQ: 24 h or until key expiry).                                                                                          |
| Refresh        | No refresh token. Call the token endpoint again.                                                                                                 |
| Scopes         | `CONNECT_READ`, `PERSONAL_API_FITNESS_READ`, `PERSONAL_API_NUTRITION_READ`, `PERSONAL_API_USER_READ`, `PERSONAL_API_WELLNESS_READ` — read only.  |
| API calls      | `Authorization: Bearer <jwt>` against `https://personal.connectapi.garmin.com`                                                                   |

## Rate limits

Not documented, but real (`scripts/rate-probe.mjs`): about **100 requests per minute** per token.
Successful responses carry no rate headers. Request 101 returned:

```
HTTP 429, retry-after: 7
{"count":101,"limit":100,"retryInSeconds":7,"rateLimitMetaData":1}
```

Requests succeeded again ~16 s later. The client honours `Retry-After` (up to 4 attempts). The cron
sync uses 8 requests per run. The backfill paces itself to one request per 700 ms (~85/min).

## Range limits (verified)

| Endpoint                                                    | Max range      | Check                               |
| ----------------------------------------------------------- | -------------- | ----------------------------------- |
| `sleep-service/sleep/dailySleepSummariesByDate`             | 31 days        | 31 d → 200, 33 d → 400              |
| `usersummary-service/v2/dailysummaries`                     | 1 year         | 365 d → 200 (364 docs), 367 d → 400 |
| `hrv-service/hrv/daily/{from}/{to}`                         | spec silent    | 31 d → 200                          |
| `wellness-service/wellness/bodyBattery/reports/daily`       | 31 days (spec) | 5 d → 200                           |
| `usersummary-service/stats/steps/daily`, `.../stress/daily` | 28 days (spec) | 24 d → 200                          |

## History depth (question 3)

No documented window for the Personal API (the Business "Starter" tier says historical data is not included;
Personal says nothing). The full backfill pulled **everything back to the account's first day**:

| Table          | First      | Last       | Rows |
| -------------- | ---------- | ---------- | ---- |
| Sleep nights   | 2022-10-01 | 2026-10-24 | 1333 |
| Daily wellness | 2022-09-30 | 2026-10-24 | 1463 |
| Activities     | 2022-09-30 | 2026-10-24 | 658  |

Single nights can be missing (watch not worn), e.g. 2025-06-15. For dates before the account existed,
some endpoints answer `200` with an **empty body** instead of `[]`; the client treats that as "no data".

## Sleep (question 2)

`GET /sleep-service/sleep/dailySleep?date=YYYY-MM-DD` and the 31-day range variant return `DailySleepDTO`.
`calendarDate` = the day you wake up (24.10 = night of 23→24), as wanted.

| Wanted field                                  | Source                                                                                                                        | Example (illustrative)              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Score                                         | `sleepScores.overall.value`                                                                                                   | 78                                  |
| Quality                                       | `sleepScores.overall.qualifierKey` (`sleepQualityTypePK` documented but **always null**)                                      | FAIR                                |
| Total / deep / light / REM / awake            | `sleepTimeSeconds`, `deepSleepSeconds`, `lightSleepSeconds`, `remSleepSeconds`, `awakeSleepSeconds`                           | 25200 / 5400 / 14400 / 4500 / 900 s |
| Awake count                                   | `awakeCount`                                                                                                                  | 2                                   |
| Overnight HRV                                 | **not in sleep DTO** → `hrv-service/hrv/daily` `lastNightAvg`                                                                 | 60                                  |
| HRV 7-day avg / status                        | `hrvSummaries[].weeklyAvg`, `.status`                                                                                         | 62 / BALANCED                       |
| Resting HR                                    | **not in sleep DTO** → `v2/dailysummaries` `heartRate.restingValue`                                                           | 52                                  |
| Body Battery change in sleep                  | **not in sleep DTO** → `usersummary/daily` `bodyBatteryDuringSleep` (only the per-day v1 endpoint has it)                     | 60                                  |
| Restlessness                                  | `sleepScores.restlessness` has only `qualifierKey` (FAIR) and the optimal range 0–5; **no numeric value** anywhere in the API | —                                   |
| Avg sleep stress, respiration                 | `avgSleepStress`, `averageRespirationValue`                                                                                   | present                             |
| `avgHeartRate`, SpO2, `userNote`, `sleepNeed` | documented, **absent** in real responses for this device                                                                      | —                                   |

## Daily wellness

`GET /usersummary-service/v2/dailysummaries` (≤1 year) gives per day: `heartRate.restingValue`,
`bodyBattery.{minValue,maxValue,chargedValue,drainedValue}`, `stress.avgLevel/maxLevel`, `movement.steps`.
`GET /usersummary-service/usersummary/daily?calendarDate=` (one day per call) adds
`bodyBatteryDuringSleep`, `bodyBatteryAtWakeTime`, `lastSevenDaysAvgRestingHeartRate`.
Example (illustrative): RHR 52, 7-day RHR 51, BB min 10 / max 70, BB at wake 68, avg stress 28.

**Calories** come from v2 `calories`: `burnedTotal` = `burnedActive` + `burnedResting` (BMR), true for all
1463 stored days. Example (illustrative): 3000 = 1000 + 2000. For today the values are partial (BMR accrues
through the day). `consumed*` fields are only filled when food is logged in Garmin Connect; they are not
stored. Per-activity calories (`calories`, `bmrCalories`) are in the activity list.

## Activities (question 1)

- `GET /activitylist-service/activities/search/activities?startDate&endDate&start&limit` → `SummarizedActivityDTO[]`.
- `GET /activity-service/activity/{id}` → `ActivitySummaryDTO` with `summaryDTO` (51 keys for a run).
- **Description: yes.** When a note exists, `description` is in both the list item and the detail response,
  verbatim (newlines, Turkish characters, `≤`, `—` intact). Verified 2026-10-24 on a real activity
  after adding a note in Garmin Connect (`scripts/activity-raw.mjs`). When there is no note the key is
  **omitted**, not `null`; that is why all 20 recent activities first looked empty. Notes written in Strava
  do not flow back to Garmin, so replacing Strava means writing the note in Garmin Connect.
  A note added after the 3-day sync window is picked up with the `refresh_activity` tool.
- Strength sessions on this account are recorded as `hiit`; `summarizedExerciseSets` has one aggregate entry.

## FIT (question 5)

`GET /download-service/files/activity/{id}` → `application/x-zip-compressed`, one entry `<id>_ACTIVITY.fit`.
Decoded with Garmin's official `@garmin/fitsdk`:

- **Run** (7901 records): `heartRate`, `enhancedSpeed`, `cadence`, `fractionalCadence`, `power`,
  `verticalOscillation`, `verticalRatio`, `stanceTime`, `stanceTimeBalance`, `stepLength`,
  `enhancedAltitude`, `enhancedRespirationRate`, GPS. Running dynamics: **yes**.
  Session-level averages for all four running-dynamics metrics are present too.
- **HIIT** (3224 records: `heartRate`, `distance`, respiration): 9 `setMesgs` with `setType`
  (active/rest), `startTime`, `duration`. **No exercise category, reps or weight**, because the
  session was recorded as HIIT, not as a Strength activity with exercises. Recording with the watch's
  Strength profile should fill `category/repetitions/weight`. Not verified, because no such activity exists yet.

## Validation against the manual log

Three nights from a hand-kept log (screenshots of the Garmin app) were compared field by field with the
API output. Score, total / deep / light / REM / awake time, resting HR, overnight HRV and Body Battery
gained in sleep matched exactly on all three nights. The only miss is restlessness: the app shows a count,
the API exposes only a qualifier (`FAIR`), so the tools return `restlessness_value: null` and say why.
The values themselves are left out here because they are personal health data.
