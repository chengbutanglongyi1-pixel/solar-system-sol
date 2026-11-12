// The portable check needs only Node and the JSON bundle. Git modes reconstruct
// the same bundle from fixed objects, without reading source from a checkout.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const revision = '463f9f0fcbcc17435568fad9e9ff5865424bbc9a';
const originalRevision = '4f89ab2ad44b5209219f2d78405680ef826d9158';
const originalBlob = '96953222ef5151e193a3d79f7a612c039244fc47';
const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = new URL('../../fixtures/science/m3-portable-v1.json', import.meta.url);
const science = 'fixtures/science';
const legacyPath = `${science}/legacy-baseline.json`;
const utArchive = `${science}/horizons-time-frame`;
const timeArchive = `${science}/time-prototype`;
const timeConverter = 'scripts/science/time-prototype.mjs';
const utParser = 'scripts/science/fetch-horizons-ut.mjs';
const capture = 'scripts/capture-orbit-baseline.mjs';
const jdSamples = [2451545, 2461346.1666667, 2470172.5];
const timeCases = ['utc-start', 'j2000-utc-noon', 'j2000-tdb', 'leap-2017-01-01-before',
  'leap-2017-01-01-inside', 'leap-2017-01-01-after', 'project-utc-epoch', 'table-expiry', 'preview-last-instant'];
const modelSlots = {
  sun: ['sun', 'sun'], earth: ['emb-approx-used-as-earth', 'sun'],
  moon: ['moon-legacy-composite', 'sun'], moonRelativeEarth: ['moon-approx', 'geocenter-of-lunar-model'],
  jupiter: ['jupiter-system-approx', 'sun'],
};
const referenceTargets = {
  emb: [3, 10], earth: [399, 10], 'moon-sun': [301, 10], 'moon-earth': [301, 399],
  'jupiter-system': [5, 10], 'jupiter-body': [599, 10],
};
const seconds = (a, b) => ((a[0] - b[0]) + (a[1] - b[1])) * 86400;
const difference = (a, b) => a.map((v, i) => v - b[i]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });

function bits(value) {
  assert.equal(typeof value, 'number');
  assert.ok(Number.isFinite(value));
  const b = Buffer.alloc(8);
  b.writeDoubleBE(value);
  return b.toString('hex');
}

async function reconstruct(replay) {
  const tempParent = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(tempParent, 'sol-m3-portable-'));
  const provenance = {};
  let modulesJunction;
  function read(file, commit = revision) {
    const spec = `${commit}:${file}`;
    const bytes = git('cat-file', 'blob', spec);
    provenance[spec] = sha256(bytes);
    return bytes;
  }
  const json = file => JSON.parse(read(file));
  function stage(file) {
    const dest = path.join(scratch, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, read(file), { flag: 'wx' });
    return pathToFileURL(dest).href;
  }
  try {
    const originalPath = 'src/SolarSystemApp.tsx';
    assert.equal(git('rev-parse', `${originalRevision}:${originalPath}`).toString().trim(), originalBlob);
    const original = read(originalPath, originalRevision);
    assert.equal(createHash('sha1').update(`blob ${original.length}\0`).update(original).digest('hex'), originalBlob);
    const legacy = json(legacyPath);
    assert.equal(legacy.provenance.sourceSha256, sha256(original));
    stage(legacyPath);
    const parser = await import(stage(utParser));
    const analysis = json(`${utArchive}/analysis.json`);
    const observations = {};
    const referenceQueries = {};
    for (const [name, [target, center]] of Object.entries(referenceTargets)) {
      const raw = read(`${utArchive}/${name}.raw.json`);
      const { url, retrievedAt, parameters, sha256: rawHash, baselineSha256 } = json(`${utArchive}/${name}.request.json`);
      assert.deepEqual(parameters, parser.parameters(target, center));
      assert.equal(rawHash, sha256(raw));
      assert.equal(rawHash, analysis.hashes[name].ut);
      assert.equal(baselineSha256, provenance[`${revision}:${legacyPath}`]);
      const requestUrl = new URL(url);
      assert.equal(requestUrl.origin + requestUrl.pathname, 'https://ssd.jpl.nasa.gov/api/horizons.api');
      for (const [key, value] of Object.entries(parameters)) {
        assert.equal(requestUrl.searchParams.get(key), key === 'format' ? value : `'${value}'`);
      }
      assert.ok(Number.isFinite(Date.parse(retrievedAt)));
      observations[name] = parser.parse(raw, target, center);
      referenceQueries[name] = { target, center, url, retrievedAt, rawSha256: rawHash };
    }
    const positions = jdSamples.map(jd => {
      const old = legacy.samples.find(row => row.inputJD.decimal === jd);
      const timing = analysis.times.find(row => row.jdUTC === jd);
      const legacyVectors = Object.fromEntries(Object.entries(modelSlots).map(([key, [target, center]]) => {
        const { xyz, float64HexBE } = old.vectors[key];
        return [key, { target, center, xyz, float64HexBE }];
      }));
      const horizonsVectors = Object.fromEntries(Object.entries(observations).map(([key, rows]) => {
        const row = rows.find(item => item.jd === jd);
        assert.equal(row.calendar, timing.utcCalendar);
        assert.equal(row.tdbJD, timing.jdTDB);
        assert.equal(row.deltaTSeconds, timing.tdbMinusUTCSeconds);
        return [key, row.xyz];
      }));
      return { sampleKeyNumericJD: jd, range: jd === 2470172.5 ? 'planet-elements-extrapolation' : 'within-planet-elements-fit-years',
        legacy: { inputJD: old.inputJD, years: old.years, productionJD: old.productionJD, clockUtcLabel: timing.solClockUTC, vectors: legacyVectors },
        horizons: { utcCalendar: timing.utcCalendar, jdUtc: timing.jdUTC, jdTdb: timing.jdTDB, tdbMinusUtcSeconds: timing.tdbMinusUTCSeconds,
          futureLeapSecondsAssumed: timing.futureLeapSecondsAssumed, vectors: horizonsVectors } };
    });

    const ref = json(`${timeArchive}/erfa-reference.json`);
    const leapFile = `${timeArchive}/leap-seconds.json`;
    const leap = json(leapFile);
    stage(leapFile);
    const converter = await import(stage(timeConverter));
    const policy = { future: 'assume-no-new-leaps' };
    const timeSamples = timeCases.map(key => {
      const [id, utcIso, taiMinusUtcSeconds, jdUtcQuasi, jdTai, jdTt, jdTdb, tdbMinusTtSeconds] = ref.cases.find(row => row[0] === key);
      const actual = converter.convertTime(utcIso, policy);
      for (const [field, expected] of Object.entries({ jdUtcQuasi, jdTai, jdTt })) assert.ok(Math.abs(seconds(actual[field], expected)) < 1e-8, field);
      assert.equal(actual.taiMinusUtcSeconds, taiMinusUtcSeconds);
      assert.ok(Math.abs(seconds(actual.jdTdb, jdTdb)) <= 0.0001, id);
      return { id, utcIso, taiMinusUtcSeconds, utcStatus: actual.provenance.utcStatus,
        jdUtcQuasi, jdTai, jdTt, jdTdb, tdbMinusTtSeconds, jdUt1: null };
    });
    for (const utc of ['1971-12-31T23:59:59.999Z', '2052-01-01T00:00:00Z', '2200-01-01T00:00:00Z']) {
      assert.throws(() => converter.convertTime(utc, policy), RangeError);
    }

    const captureUrl = stage(capture);
    if (replay) {
      const require = createRequire(import.meta.url);
      const tsPackage = require.resolve('typescript/package.json');
      assert.equal(JSON.parse(fs.readFileSync(tsPackage)).version, legacy.environment.typescript);
      const modules = path.join(scratch, 'node_modules');
      fs.mkdirSync(modules);
      modulesJunction = path.join(modules, 'typescript');
      fs.symlinkSync(path.dirname(tsPackage), modulesJunction, process.platform === 'win32' ? 'junction' : 'dir');
      const gitDir = git('rev-parse', '--absolute-git-dir').toString().trim();
      const output = execFileSync(process.execPath, [fileURLToPath(captureUrl), '--verify'], { cwd: scratch,
        env: { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: scratch, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8' });
      assert.match(output, /VERIFY PASS: 8 dates, 15 vectors\/date, 360 vector components/);
      console.log(output.trim());
    }
    return { schema: 'SOL-M3-portable-v1', archive: { commit: revision, originalRevision, originalBlob, sourceSha256: provenance },
      geometry: { units: 'km', frame: 'right-handed J2000 ecliptic XYZ', legacyFrameStatus: 'intended by SOL; lunar approximation not independently validated',
        horizonsFrame: 'ICRF rotated to fixed J2000 ecliptic; 84381.448 arcsec obliquity; geometric positions',
        sunOrigin: [0, 0, 0], attitude: null },
      clock: { erfa: ref.source, leapTable: { version: leap.version, source: leap.source, sourceSha256: leap.sourceSha256,
        validFrom: leap.validFrom, expiresExclusive: leap.expiresExclusive, lastTaiMinusUtcSeconds: leap.entries.at(-1).taiMinusUtcSeconds },
      fixedPrototypeEndExclusive: '2052-01-01T00:00:00Z', samples: timeSamples },
      referenceQueries, positions };
  } finally {
    if (modulesJunction && fs.existsSync(modulesJunction)) {
      if (process.platform === 'win32') fs.rmdirSync(modulesJunction);
      else fs.unlinkSync(modulesJunction);
    }
    const target = fs.realpathSync(scratch);
    assert.equal(path.dirname(target), tempParent);
    assert.match(path.basename(target), /^sol-m3-portable-[A-Za-z0-9]+$/);
    fs.rmSync(target, { recursive: true });
  }
}

function verifyPortable(bundle) {
  assert.equal(bundle.schema, 'SOL-M3-portable-v1');
  assert.equal(bundle.archive.commit, revision);
  assert.equal(bundle.archive.originalRevision, originalRevision);
  assert.equal(bundle.archive.originalBlob, originalBlob);
  assert.equal(bundle.geometry.units, 'km');
  assert.equal(bundle.geometry.attitude, null);
  assert.deepEqual(bundle.geometry.sunOrigin, [0, 0, 0]);
  assert.deepEqual(bundle.positions.map(row => row.sampleKeyNumericJD), jdSamples);
  assert.deepEqual(Object.keys(bundle.referenceQueries), Object.keys(referenceTargets));
  for (const [name, pair] of Object.entries(referenceTargets)) {
    const { target, center } = bundle.referenceQueries[name];
    assert.deepEqual([target, center], pair);
  }
  let moonClosureKm = 0;
  for (const { sampleKeyNumericJD, legacy, horizons } of bundle.positions) {
    for (const key of ['inputJD', 'years', 'productionJD']) assert.equal(bits(legacy[key].decimal), legacy[key].float64HexBE);
    assert.equal(legacy.inputJD.decimal, sampleKeyNumericJD);
    assert.equal(horizons.jdUtc, sampleKeyNumericJD);
    assert.ok(Number.isFinite(horizons.jdTdb) && Number.isFinite(horizons.tdbMinusUtcSeconds));
    assert.deepEqual(Object.keys(legacy.vectors), Object.keys(modelSlots));
    for (const [key, [target, center]] of Object.entries(modelSlots)) {
      const vector = legacy.vectors[key];
      assert.deepEqual([vector.target, vector.center], [target, center]);
      assert.equal(vector.xyz.length, 3);
      assert.deepEqual(vector.xyz.map(bits), vector.float64HexBE);
    }
    assert.deepEqual(legacy.vectors.sun.xyz, [0, 0, 0]);
    assert.deepEqual(legacy.vectors.earth.xyz.map((x, i) => bits(x + legacy.vectors.moonRelativeEarth.xyz[i])), legacy.vectors.moon.float64HexBE);
    assert.deepEqual(Object.keys(horizons.vectors), Object.keys(referenceTargets));
    for (const xyz of Object.values(horizons.vectors)) assert.ok(xyz.length === 3 && xyz.every(Number.isFinite));
    const closure = difference(difference(horizons.vectors['moon-sun'], horizons.vectors.earth), horizons.vectors['moon-earth']);
    moonClosureKm = Math.max(moonClosureKm, Math.hypot(...closure));
  }
  assert.ok(moonClosureKm < 0.00001);
  assert.deepEqual(bundle.clock.samples.map(row => row.id), timeCases);
  for (const instant of bundle.clock.samples) {
    for (const key of ['jdUtcQuasi', 'jdTai', 'jdTt', 'jdTdb']) assert.ok(instant[key].length === 2 && instant[key].every(Number.isFinite));
    assert.equal(instant.jdUt1, null);
    assert.ok(Math.abs(seconds(instant.jdTt, instant.jdTai) - 32.184) < 1e-8);
    assert.ok(Math.abs(seconds(instant.jdTdb, instant.jdTt) - instant.tdbMinusTtSeconds) < 1e-8);
  }
  const [before, inside, after] = bundle.clock.samples.filter(row => row.id.startsWith('leap-2017'));
  assert.match(inside.utcIso, /:60\.500Z$/);
  assert.deepEqual([before, inside, after].map(row => row.taiMinusUtcSeconds), [36, 36, 37]);
  for (const [left, right] of [[before, inside], [inside, after]]) assert.ok(Math.abs(seconds(right.jdTai, left.jdTai) - 1) < 1e-8);
  return { dates: bundle.positions.length, legacyVectors: bundle.positions.length * 5,
    horizonsVectors: bundle.positions.length * 6, timeSamples: bundle.clock.samples.length, moonClosureKm };
}

const [mode, ...extra] = process.argv.slice(2);
assert.ok(extra.length === 0 && [undefined, '--git', '--replay', '--capture'].includes(mode));
let bundle;
if (mode === '--capture') {
  assert.ok(!fs.existsSync(fixture), 'Refusing to overwrite the portable baseline');
  bundle = await reconstruct(false);
  verifyPortable(bundle);
  fs.writeFileSync(fixture, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx' });
} else {
  bundle = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  if (mode) assert.deepEqual(await reconstruct(mode === '--replay'), bundle);
}
console.log(JSON.stringify({ mode: mode ?? 'portable', ...verifyPortable(bundle), sha256: sha256(fs.readFileSync(fixture)) }));
