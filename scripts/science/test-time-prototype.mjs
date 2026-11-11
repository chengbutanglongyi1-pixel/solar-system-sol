import assert from 'node:assert/strict';
import fs from 'node:fs';
import { convertTime, differenceSeconds } from './time-prototype.mjs';
import leaps from '../../fixtures/science/time-prototype/leap-seconds.json' with { type: 'json' };
import reference from '../../fixtures/science/time-prototype/erfa-reference.json' with { type: 'json' };

const secondsTolerance = 0.0001;
const calendarTolerance = 1e-8;
const future = { future: 'assume-no-new-leaps' };
const dateAtMidnight = date => Date.parse(`${date}T00:00:00Z`);

assert.equal(leaps.entries.length, 28);
assert.equal(leaps.entries[0].effectiveDate, leaps.validFrom);
for (const [index, entry] of leaps.entries.entries()) {
  assert.equal(dateAtMidnight(entry.effectiveDate) / 86400000 + 40587, entry.mjd);
  assert.equal(entry.taiMinusUtcSeconds, 10 + index);
  if (index) assert.ok(entry.mjd > leaps.entries[index - 1].mjd);
}
assert.equal(reference.source.pyerfa, '2.0.1.5');
assert.equal(reference.source.erfa, '2.0.1');
assert.equal(reference.source.sofa, '20231011');
assert.equal(reference.cases.length, 409);
assert.equal(new Set(reference.cases.map(([name]) => name)).size, 409);

const byName = new Map();
const worst = { published: { seconds: 0 }, 'assumed-no-new-leaps': { seconds: 0 } };
const count = { published: 0, 'assumed-no-new-leaps': 0 };
for (const [name, utc, offset, jdUtc, tai, tt, tdb, delta] of reference.cases) {
  const assumed = utc.slice(0, 10) >= leaps.expiresExclusive;
  const actual = convertTime(utc, assumed ? future : undefined);
  const status = assumed ? 'assumed-no-new-leaps' : 'published';
  assert.equal(actual.provenance.utcStatus, status, name);
  assert.equal(actual.taiMinusUtcSeconds, offset, name);
  // For quasi-JD this is a representation check, not physical elapsed seconds.
  assert.ok(Math.abs(differenceSeconds(actual.jdUtcQuasi, jdUtc)) < calendarTolerance, name);
  assert.ok(Math.abs(differenceSeconds(actual.jdTai, tai)) < calendarTolerance, name);
  assert.ok(Math.abs(differenceSeconds(actual.jdTt, tt)) < calendarTolerance, name);
  const seconds = Math.abs(differenceSeconds(actual.jdTdb, tdb));
  assert.ok(seconds <= secondsTolerance, `${name}: TDB error ${seconds} s`);
  assert.ok(Math.abs(actual.tdbMinusTtSeconds - delta) <= secondsTolerance, name);
  if (seconds > worst[status].seconds) worst[status] = { name, utc, seconds };
  count[status]++;
  byName.set(name, actual);
}

assert.deepEqual(convertTime('2026-11-02T00:00:00+08:00'), byName.get('project-utc-epoch'));
assert.deepEqual(convertTime('2026-11-01T10:30:00-05:30'), byName.get('project-utc-epoch'));
assert.deepEqual(convertTime('2017-01-01T07:59:60.500+08:00'), byName.get('leap-2017-01-01-inside'));
assert.equal(convertTime('2024-02-29T23:59:59.999999999Z').utcUnixMs, Date.parse('2024-02-29T23:59:59.999Z'));
assert.equal(convertTime('1971-12-31T19:00:00-05:00').taiMinusUtcSeconds, 10);
assert.throws(() => convertTime('1972-01-01T00:00:00+01:00'), RangeError);

for (const { effectiveDate } of leaps.entries.slice(1)) {
  const before = byName.get(`leap-${effectiveDate}-before`);
  const inside = byName.get(`leap-${effectiveDate}-inside`);
  const after = byName.get(`leap-${effectiveDate}-after`);
  assert.ok(Math.abs(differenceSeconds(inside.jdTai, before.jdTai) - 1) < calendarTolerance);
  assert.ok(Math.abs(differenceSeconds(after.jdTai, inside.jdTai) - 1) < calendarTolerance);
  assert.equal(inside.utcUnixMs, null);
  assert.equal(after.taiMinusUtcSeconds, inside.taiMinusUtcSeconds + 1);
}

for (const invalid of [
  '1971-12-31T23:59:59Z', '1900-02-29T12:00:00Z', '2023-02-29T12:00:00Z',
  '2026-04-31T12:00:00Z', '2026-11-01T24:00:00Z', '2026-11-01T16:60:00Z',
  '2026-11-01T16:00:00', '2026-11-01T16:00:00Z\n', '2026-11-01T16:00:00-00:00',
  '2026-11-01T16:00:00+24:00', '2026-11-01T16:00:00+01:60',
  '2016-12-30T23:59:60Z', '2016-12-31T23:59:61Z', '2016-12-31T23:58:60Z',
  '2027-06-28T00:00:00Z',
]) assert.throws(() => convertTime(invalid), RangeError, invalid);
assert.throws(() => convertTime(null), TypeError);
assert.throws(() => convertTime('2052-01-01T00:00:00Z', future), RangeError);
assert.throws(() => convertTime('2051-12-31T23:59:60Z', future), RangeError);
assert.equal(byName.get('table-last-instant').provenance.utcStatus, 'published');
assert.equal(byName.get('table-expiry').provenance.utcStatus, 'assumed-no-new-leaps');
assert.ok(Math.abs(differenceSeconds(byName.get('j2000-tt').jdTt, [2451545, 0])) < calendarTolerance);
assert.ok(Math.abs(differenceSeconds(byName.get('j2000-tdb').jdTdb, [2451545, 0])) <= secondsTolerance);

const module = fs.readFileSync(new URL('../../src/science/legacy-orbits.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../src/SolarSystemApp.tsx', import.meta.url), 'utf8');
const jdStart = Number(module.match(/^export const JD_START = ([\d.]+);/m)[1]);
const startMs = Date.UTC(...app.match(/^const START_MS = Date\.UTC\(([^)]+)\);/m)[1].split(',').map(Number));
const project = byName.get('project-utc-epoch');
assert.equal(project.utcUnixMs, startMs);
const oldEpochOffsetMs = differenceSeconds([jdStart, 0], project.jdUtcQuasi) * 1000;
assert.ok(Math.abs(oldEpochOffsetMs - 2.88337469) < 1e-6, 'Old numeric JD vs UTC civil epoch');

console.log(JSON.stringify({ cases: reference.cases.length, count, worst, acceptanceSeconds: secondsTolerance,
  leapTransitions: leaps.entries.length - 1, oldEpochOffsetMs, project, j2000TdbUtc: byName.get('j2000-tdb').utcIso }, null, 2));
