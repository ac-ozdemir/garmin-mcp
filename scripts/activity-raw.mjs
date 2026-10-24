// Prints whether `description` is present in the raw list and detail responses for one activity.
// Usage: node scripts/activity-raw.mjs <activityId>
import fs from 'node:fs';
const id = process.argv[2];
if (!/^\d+$/.test(id ?? '')) throw new Error('usage: activity-raw.mjs <activityId>');
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
const get = async (p) => (await fetch(B + p, { headers: { Authorization: `Bearer ${token}` } })).json();
const detail = await get(`/activity-service/activity/${id}`);
const day = detail.summaryDTO?.startTimeLocal?.slice(0, 10);
const list = await get(
  `/activitylist-service/activities/search/activities?startDate=${day}&endDate=${day}&limit=100`,
);
const item = list.find((a) => String(a.activityId) === id);
for (const [name, obj] of [
  ['detail /activity-service/activity/{id}', detail],
  [`list item (startDate=endDate=${day})`, item],
]) {
  console.log(
    `${name}: description key ${obj && 'description' in obj ? 'PRESENT' : 'ABSENT'}`,
    obj && 'description' in obj ? JSON.stringify(obj.description) : '',
    '| name:',
    JSON.stringify(obj?.activityName),
  );
}
