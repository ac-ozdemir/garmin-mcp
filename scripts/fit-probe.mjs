// Downloads and decodes FIT for given activity ids; prints message counts, record fields, set samples.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Decoder, Stream } from '@garmin/fitsdk';
const key = fs
  .readFileSync('.dev.vars', 'utf8')
  .match(/^GARMIN_API_KEY=(.+)$/m)[1]
  .trim();
const B = 'https://personal.connectapi.garmin.com';
const token = (
  await (
    await fetch(B + '/personalapitoken-service/personal-api/personal-api-key/token', {
      method: 'POST',
      headers: { Authorization: 'ApiKey ' + key },
    })
  ).text()
).trim();
for (const id of process.argv.slice(2)) {
  const detail = await (
    await fetch(`${B}/activity-service/activity/${id}`, { headers: { Authorization: 'Bearer ' + token } })
  ).json();
  fs.writeFileSync(`probe-output/detail-${id}.json`, JSON.stringify(detail, null, 1));
  console.log(
    '\n#',
    id,
    detail.activityTypeDTO?.typeKey,
    'description=',
    JSON.stringify(detail.description ?? null),
    'summaryKeys=',
    Object.keys(detail.summaryDTO || {}).length,
  );
  const zip = Buffer.from(
    await (
      await fetch(`${B}/download-service/files/activity/${id}`, {
        headers: { Authorization: 'Bearer ' + token },
      })
    ).arrayBuffer(),
  );
  fs.writeFileSync(`probe-output/${id}.zip`, zip);
  const list = execFileSync('unzip', ['-Z1', `probe-output/${id}.zip`])
    .toString()
    .trim()
    .split('\n');
  const fit = execFileSync('unzip', ['-p', `probe-output/${id}.zip`, list[0]]);
  console.log('zip entries', list, 'fit bytes', fit.length);
  const { messages, errors } = new Decoder(Stream.fromBuffer(fit)).read();
  console.log('counts', Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, v.length])));
  const rk = [...new Set((messages.recordMesgs ?? []).flatMap(Object.keys))];
  console.log('record fields', rk.join(','));
  if (messages.setMesgs) console.log('sets sample', JSON.stringify(messages.setMesgs.slice(0, 4)));
  const s = messages.sessionMesgs?.[0];
  if (s)
    console.log(
      'session dyn',
      JSON.stringify({
        vo: s.avgVerticalOscillation,
        gct: s.avgStanceTime,
        vr: s.avgVerticalRatio,
        stride: s.avgStepLength,
        cad: s.avgCadence,
      }),
    );
  if (errors.length)
    console.log(
      'errors',
      errors.map((e) => e.message),
    );
}
