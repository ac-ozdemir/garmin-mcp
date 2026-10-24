// Measures the Personal API rate limit: sequential calls until the first 429, then prints its headers
// and how long until requests succeed again. Read-only; stops at the first 429.
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
const call = () =>
  fetch(`${B}/usersummary-service/usersummary/daily?calendarDate=2026-10-20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
const t0 = Date.now();
let n = 0;
for (;;) {
  const res = await call();
  n++;
  if (res.status === 429) {
    console.log(`429 after ${n} calls in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(Object.fromEntries([...res.headers].filter(([k]) => !/cookie|authorization/i.test(k))));
    console.log('body:', (await res.text()).slice(0, 300));
    break;
  }
  await res.arrayBuffer();
  if (n >= 400) {
    console.log('no 429 in 400 calls');
    process.exit(0);
  }
}
const t429 = Date.now();
for (const wait of [5, 10, 20, 30, 60, 60, 60, 120, 120, 300]) {
  await new Promise((r) => setTimeout(r, wait * 1000));
  const res = await call();
  await res.arrayBuffer();
  console.log(`+${Math.round((Date.now() - t429) / 1000)}s -> ${res.status}`);
  if (res.ok) break;
}
