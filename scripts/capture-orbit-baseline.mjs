// Capture only the pinned legacy orbit code. Never updates an existing fixture.
// Usage: node scripts/capture-orbit-baseline.mjs [--verify]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = '4f89ab2ad44b5209219f2d78405680ef826d9158';
const expectedBlob = '96953222ef5151e193a3d79f7a612c039244fc47';
const sourcePath = 'src/SolarSystemApp.tsx';
const target = path.join(root, 'fixtures/science/legacy-baseline.json');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--verify'), 'Only --verify is supported');
const verify = args[0] === '--verify';
if (!verify && fs.existsSync(target)) throw Error('Baseline exists: refusing overwrite; use --verify');
const git = (...a) => execFileSync('git', a, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const blob = git('rev-parse', `${commit}:${sourcePath}`).toString().trim();
assert.equal(blob, expectedBlob);
const bytes = git('cat-file', 'blob', blob);
const actualBlob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
assert.equal(actualBlob, expectedBlob, 'Git blob byte verification failed');
const source = bytes.toString('utf8');
// This verifies the frozen original, independently of later production relocation.
// test-legacy-orbits.mjs separately verifies the current production module and wiring.

// A narrow whitelist of top-level declarations, not a general dependency resolver.
// Parsing does not execute module imports or initialize any UI/resources.
const names = ['YEAR_S', 'START_MS', 'utcNowYears', 'JD_START', 'ELEMENTS', 'V3',
  'vadd', 'vscl', 'D2R', 'rotOrbit', 'orbElems', 'helioVec', 'moonState',
  'PLANET_IDS', 'AU_KM', 'DWARF_IDS', 'HELIO_IDS', 'moonVec'];
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0, 'Production source parse failure');
const snippets = [], locations = [];
for (const name of names) {
  const matches = ast.statements.filter(node => {
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name);
    return (ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name?.text === name;
  });
  assert.equal(matches.length, 1, `Expected one top-level declaration: ${name}`);
  const node = matches[0];
  if (ts.isVariableStatement(node)) assert.equal(node.declarationList.declarations.length, 1);
  snippets.push(node.getText(ast));
  locations.push({ name, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
}
const solarViews = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'SolarView');
assert.equal(solarViews.length, 1);
const solarViewStart = solarViews[0].getStart(ast);
const productionView = solarViews[0].getText(ast); // Inspect only; never execute SolarView.
function uniqueSlice(start, end) {
  const a = productionView.indexOf(start), b = productionView.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing production boundary: ${start}`);
  assert.equal(productionView.indexOf(start, a + 1), -1, `Ambiguous production boundary: ${start}`);
  locations.push({ name: start.trim(), line: source.slice(0, solarViewStart + a).split('\n').length });
  return productionView.slice(a, b);
}
const jdExpression = uniqueSlice('      const jd = JD_START + years * 365.25;', '      if (now - lastReport');
const composition = uniqueSlice('      const pos: Record<string, V3> = { sun: [0, 0, 0] };', '      // t145: 所有卫星');
assert.ok(composition.includes('for (const id of HELIO_IDS) pos[id] = vscl(helioVec(id, years), AU_KM);'));
assert.ok(composition.includes('const mrel = moonVec(jd);\n      pos.moon = vadd(pos.earth, mrel);'));
const executable = stripTypeScriptTypes(snippets.join('\n') + `
globalThis.capture = (inputJD) => {
  const years = (inputJD - JD_START) / 365.25;
  ${jdExpression}
  ${composition}
  return {years, jd, pos, mrel, earthSlotAU:helioVec('earth', years)};
};`, { mode: 'strip' });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function bits(value) {
  assert.equal(typeof value, 'number'); assert.ok(Number.isFinite(value), 'Non-finite number');
  const b = Buffer.alloc(8); b.writeDoubleBE(value); return b.toString('hex');
}
function scalar(value) { return { decimal: value, float64HexBE: bits(value) }; }
function vector(xyz, center, unit = 'km', meaning = '') {
  assert.equal(xyz.length, 3);
  return { xyz: Array.from(xyz), float64HexBE: Array.from(xyz, bits), unit, center,
    frame: 'Legacy intended J2000 ecliptic/equinox; X vernal equinox, Z ecliptic north; lunar approximation not independently validated', meaning };
}
const base = 2461346.1666667;
const dates = [2451545.0, base, 2469806.5, base + 0.25, base + 1, base + 7, base + 27, 2470172.5];
const bodyIds = ['sun','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','ceres','pluto','moon'];
function generate() {
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(executable, context, { timeout: 1000 });
  const capture = input => {
    assert.ok(typeof input === 'number' && Number.isFinite(input) && input > 0, 'Invalid JD');
    context.inputJD = input;
    const r = vm.runInContext('capture(inputJD)', context, { timeout: 1000 });
    bits(r.years); bits(r.jd);
    return r;
  };
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '2451545', 0, -1]) assert.throws(() => capture(bad));
  return dates.map((inputJD, index) => {
    const r = capture(inputJD);
    assert.deepEqual(Object.keys(r.pos).sort(), [...bodyIds].sort());
    for (const x of r.pos.sun) assert.ok(Object.is(x, 0));
    for (let i = 0; i < 3; i++) {
      assert.equal(bits(r.pos.moon[i]), bits(r.pos.earth[i] + r.mrel[i]), 'Moon composition changed');
    }
    const vectors = {};
    for (const id of bodyIds) vectors[id] = vector(r.pos[id], 'Sun', 'km',
      id === 'earth' ? 'Production Earth position: uncorrected approximate Earth-Moon barycenter slot; NOT an independently computed Earth center' :
      id === 'moon' ? 'Production Moon position: approximate EMB slot plus geocentric lunar vector; inherits mixed-center error' :
      id === 'sun' ? 'Exact production origin' : 'Legacy approximate heliocentric orbital-element position');
    vectors.earthSlotApproxEmbAU = vector(r.earthSlotAU, 'Sun', 'AU', 'earth coefficient slot: approximate Earth-Moon barycenter, no mass-ratio correction');
    vectors.earthSlotApproxEmbKm = vector(r.pos.earth, 'Sun', 'km', 'Same uncorrected earth slot used by production');
    vectors.moonRelativeEarth = vector(r.mrel, 'Earth center (lunar model)', 'km', 'moonVec(moonState): geocentric approximation before legacy composition');
    assert.equal(Object.keys(vectors).length, 15);
    return { inputJD: scalar(inputJD), years: scalar(r.years), productionJD: scalar(r.jd),
      scope: index === 7 ? 'Additional out-of-range behavior sample; no accuracy claim' : 'Requested fixed legacy sample; model validity not certified', vectors };
  });
}
const samples = generate();
assert.equal(samples.length, 8); assert.equal(new Set(dates).size, 8);
assert.deepEqual(generate(), samples, 'Fresh VM repeatability failed');
const provenance = { commit, sourcePath, gitBlob: blob, sourceSha256: sha256(bytes),
  extractedExecutableSha256: sha256(executable), declarationsAndProductionLocations: locations };
const baseline = {
  schema: 'SOL-legacy-orbit-baseline-v1', provenance,
  environment: { node: process.version, v8: process.versions.v8, typescript: ts.version,
    platform: process.platform, arch: process.arch, osRelease: os.release(), endianness: os.endianness() },
  interpretation: {
    purpose: 'Frozen old algorithm outputs, NOT NASA/JPL accuracy validation. Never auto-update.',
    time: 'Input JD is a numeric legacy argument. years=(inputJD-JD_START)/365.25; production recomputes JD_START+years*365.25. Runtime utcNowYears uses Date.now minus UTC START_MS divided by YEAR_S. No demonstrated UTC->TT/TDB or leap-second conversion.',
    coordinates: 'Raw production physical coordinates before scene compression, camera transforms or display scaling.',
    earth: 'Earth coefficients identify the approximate EMB slot; production treats it as Earth without barycenter-to-geocenter correction. Preserved, not fixed.',
    validity: 'Source comments cite planetary elements 1800-2050 and Ceres fit 2006-2046; some requested dates are outside a cited interval. Comments/accuracy claims are not independently verified.',
    encoding: 'JSON decimal Numbers round-trip IEEE-754 binary64; float64HexBE stores 8-byte big-endian bit patterns including signed zero.',
    repeatability: 'Exact comparison expected in recorded runtime; cross-runtime/platform transcendental last-bit equality is not guaranteed.'
  }, samples
};
// Check decimal/bit integrity again after JSON serialization.
const serialized = JSON.stringify(baseline, null, 2) + '\n';
const roundtrip = JSON.parse(serialized);
for (const s of roundtrip.samples) {
  for (const key of ['inputJD','years','productionJD']) assert.equal(bits(s[key].decimal), s[key].float64HexBE);
  for (const v of Object.values(s.vectors)) assert.deepEqual(v.xyz.map(bits), v.float64HexBE);
}
if (verify) {
  const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(saved.schema, baseline.schema);
  assert.deepEqual(saved.provenance, provenance);
  assert.deepEqual(saved.interpretation, baseline.interpretation);
  assert.deepEqual(saved.samples, samples, 'Baseline differs: never overwrite to hide failure');
  console.log('VERIFY PASS: 8 dates, 15 vectors/date, 360 vector components; decimal and Float64 bits match.');
  if (JSON.stringify(saved.environment) !== JSON.stringify(baseline.environment)) console.log('NOTE: runtime metadata differs from captured environment; numeric comparison still passed.');
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serialized, { flag: 'wx' });
  console.log('CAPTURE PASS: ' + target);
}
console.log(JSON.stringify({ dates: samples.map(s => s.inputJD.decimal),
  firstEarthKm: samples[0].vectors.earth.xyz,
  firstMoonRelativeKm: samples[0].vectors.moonRelativeEarth.xyz, rendererInitialized: false }));
