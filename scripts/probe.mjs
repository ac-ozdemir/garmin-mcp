// Phase 0 probe: calls the documented Personal API endpoints with the real account
// and saves raw responses to probe-output/ (gitignored) for docs/api-findings.md.
// Usage: node scripts/probe.mjs   (reads GARMIN_API_KEY from .dev.vars)
import fs from 'node:fs';
import path from 'node:path';
import { Decoder, Stream } from '@garmin/fitsdk';

const BASE = 'https://personal.connectapi.garmin.com';
const OUT = 'probe-output';

function readApiKey() {
  const line = fs
    .readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .find((l) => l.startsWith('GARMIN_API_KEY='));
  const key = line?.slice('GARMIN_API_KEY='.length).trim();
  if (!key) throw new Error('GARMIN_API_KEY missing in .dev.vars');
  return key;
}

function save(name, body) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

// Only headers that tell us about limits/caching; never auth headers.
function interestingHeaders(res) {
  return Object.fromEntries(
    [...res.headers].filter(([k]) => /rate|limit|retry|remaining|cache|server|cf-|x-/i.test(k)),
  );
}

async function obtainToken(apiKey) {
  const res = await fetch(`${BASE}/personalapitoken-service/personal-api/personal-api-key/token`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${apiKey}` },
  });
  const text = (await res.text()).trim();
  if (!res.ok) {
    save('token-response.json', { status: res.status, headers: interestingHeaders(res) });
    throw new Error(`token request failed: ${res.status}`);
  }
  // The endpoint returns the bare JWT as text/plain. Keep only its claims (no signature) for the report.
  const claims = JSON.parse(Buffer.from(text.split('.')[1], 'base64url').toString());
  save('token-response.json', {
    status: res.status,
    contentType: res.headers.get('content-type'),
    headers: interestingHeaders(res),
    tokenLength: text.length,
    claimKeys: Object.keys(claims),
    scope: claims.scope,
    iat: claims.iat,
    exp: claims.exp,
    lifetimeHours: (claims.exp - claims.iat) / 3600,
  });
  return text;
}

async function get(token, pathAndQuery, name) {
  const started = Date.now();
  const res = await fetch(BASE + pathAndQuery, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const ms = Date.now() - started;
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await res.json().catch(() => null) : null;
  const summary = { path: pathAndQuery, status: res.status, ms, type, headers: interestingHeaders(res) };
  console.log(`${res.status} ${ms}ms ${pathAndQuery}`);
  if (name) save(`${name}.json`, { ...summary, body });
  return { res, body, summary };
}

async function probeFit(token, activityId, name) {
  const res = await fetch(`${BASE}/download-service/files/activity/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`${res.status} FIT ${activityId} ${res.headers.get('content-type')} ${buf.length}B`);
  save(`${name}.bin`, buf);
  // Original-format download may be a zip wrapping the .fit; note it rather than guess.
  const isZip = buf.subarray(0, 2).toString() === 'PK';
  if (!res.ok || isZip) return { status: res.status, isZip, bytes: buf.length };
  const decoder = new Decoder(Stream.fromBuffer(buf));
  const { messages, errors } = decoder.read();
  const counts = Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, v.length]));
  const recordKeys = [...new Set((messages.recordMesgs ?? []).slice(0, 50).flatMap(Object.keys))];
  save(`${name}.decoded.json`, {
    counts,
    recordKeys,
    sets: messages.setMesgs ?? [],
    session: messages.sessionMesgs,
    errors,
  });
  return { status: res.status, isZip, bytes: buf.length, counts, recordKeys };
}

async function main() {
  const token = await obtainToken(readApiKey());
  const report = {};
  const r = async (name, p) => (report[name] = (await get(token, p, name)).summary);

  await r('sleep-day-2026-10-24', '/sleep-service/sleep/dailySleep?date=2026-10-24');
  await r(
    'sleep-range',
    '/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-09-24&endDate=2026-10-24',
  );
  await r(
    'sleep-range-32d',
    '/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-09-22&endDate=2026-10-24',
  );
  await r('hrv-day', '/hrv-service/hrv/2026-10-24');
  await r('hrv-range', '/hrv-service/hrv/daily/2026-09-24/2026-10-24');
  await r('usersummary-day', '/usersummary-service/usersummary/daily?calendarDate=2026-10-24');
  await r(
    'dailysummaries-v2',
    '/usersummary-service/v2/dailysummaries?startDate=2026-09-24&endDate=2026-10-24',
  );
  await r(
    'bodybattery-range',
    '/wellness-service/wellness/bodyBattery/reports/daily?startDate=2026-10-20&endDate=2026-10-24',
  );
  await r('stress-range', '/usersummary-service/stats/stress/daily/2026-10-01/2026-10-24');
  await r('steps-range', '/usersummary-service/stats/steps/daily/2026-10-01/2026-10-24');
  await r('dailyhr-day', '/wellness-service/wellness/dailyHeartRate?date=2026-10-24');
  await r('activities-latest', '/activitylist-service/activities/search/activities?limit=20');

  // History depth: probe a few old dates to find where data stops.
  for (const d of ['2026-01-15', '2025-06-15', '2024-06-15', '2022-06-15', '2019-06-15']) {
    await r(`history-sleep-${d}`, `/sleep-service/sleep/dailySleep?date=${d}`);
    await r(`history-summary-${d}`, `/usersummary-service/usersummary/daily?calendarDate=${d}`);
  }
  await r(
    'history-activities-oldest',
    '/activitylist-service/activities/search/activities?limit=5&sortOrder=asc',
  );

  // Activity detail + FIT for the latest run-like and strength-like activities.
  const activities = JSON.parse(fs.readFileSync(path.join(OUT, 'activities-latest.json'), 'utf8')).body ?? [];
  const pick = (re) => activities.find((a) => re.test(a.activityType?.typeKey ?? ''));
  const targets = { run: pick(/run/), strength: pick(/strength/), any: activities[0] };
  for (const [kind, a] of Object.entries(targets)) {
    if (!a) continue;
    await r(`activity-${kind}`, `/activity-service/activity/${a.activityId}`);
    await r(`activity-${kind}-workouts`, `/activity-service/activity/${a.activityId}/workouts`);
    report[`fit-${kind}`] = await probeFit(token, a.activityId, `fit-${kind}`);
  }

  // Burst to look for rate-limit headers / 429 behaviour (small, read-only).
  const burst = [];
  for (let i = 0; i < 30; i++)
    burst.push((await get(token, '/userprofile-service/userprofile/settings')).summary.status);
  report.burst30 = burst;

  save('report.json', report);
  console.log('done; see probe-output/report.json');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
