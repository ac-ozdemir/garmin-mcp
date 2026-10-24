// Finds the earliest date with sleep data (binary search) and checks the 1-year daily summary range.
import fs from 'node:fs';
const key = fs
  .readFileSync('.dev.vars', 'utf8')
  .match(/^GARMIN_API_KEY=(.+)$/m)[1]
  .trim();
const B = 'https://personal.connectapi.garmin.com';
const token = (
  await (
    await fetch(`${B}/personalapitoken-service/personal-api/personal-api-key/token`, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${key}` },
    })
  ).text()
).trim();
const get = async (p) => {
  const r = await fetch(B + p, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const day = (d) => d.toISOString().slice(0, 10);
const hasSleepAround = async (d) => {
  // A single night can be missing; look at a 31-day window ending at d.
  const start = new Date(d);
  start.setUTCDate(start.getUTCDate() - 30);
  const { body } = await get(
    `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${day(start)}&endDate=${day(d)}`,
  );
  return (body ?? []).some((s) => s.sleepTimeSeconds);
};
let lo = new Date('2024-01-01'),
  hi = new Date('2026-01-15');
while (hi - lo > 31 * 864e5) {
  const mid = new Date((+lo + +hi) / 2);
  if (await hasSleepAround(mid)) hi = mid;
  else lo = mid;
}
const start = new Date(hi);
start.setUTCDate(start.getUTCDate() - 30);
const { body } = await get(
  `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${day(start)}&endDate=${day(hi)}`,
);
console.log(
  'earliest sleep night:',
  (body ?? [])
    .filter((s) => s.sleepTimeSeconds)
    .map((s) => s.calendarDate)
    .sort()[0],
);
const hrvOld = await get('/hrv-service/hrv/daily/2025-09-01/2025-09-30');
console.log('hrv 2025-09 nights:', hrvOld.body?.hrvSummaries?.length ?? hrvOld.status);
const y = await get('/usersummary-service/v2/dailysummaries?startDate=2025-10-25&endDate=2026-10-24');
console.log('v2 1-year:', y.status, 'days:', y.body?.data?.length);
const y2 = await get('/usersummary-service/v2/dailysummaries?startDate=2025-10-23&endDate=2026-10-24');
console.log('v2 >1-year:', y2.status);
