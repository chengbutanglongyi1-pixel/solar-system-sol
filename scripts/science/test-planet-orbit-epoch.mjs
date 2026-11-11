// Exercise the two SolarView calculations offline, using the production formulas.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { convertTime, differenceSeconds } from './time-prototype.mjs';
import reference from '../../fixtures/science/time-prototype/erfa-reference.json' with { type: 'json' };

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const model = read('../../src/science/legacy-orbits.ts');
const app = ts.createSourceFile('SolarSystemApp.tsx', read('../../src/SolarSystemApp.tsx'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function declaration(name) {
  const matches = app.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && node.name?.text === name)
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.text === name)));
  assert.equal(matches.length, 1, `Production declaration: ${name}`);
  return matches[0].getText(app);
}

// Confirm the extracted functions are the consumers in the active path.
assert.match(declaration('App'), /<SolarView\b/);
const view = declaration('SolarView');
assert.match(view, /const years = P\.simRef\.current;/);
assert.match(view, /vscl\(helioVec\(id, years\), AU_KM\)/);
assert.match(view, /drawPoly\(planetOrbitKm\(id, years\),/);

const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
const declarations = ['vscl', 'AU_KM', 'PLANET_IDS', 'DWARF_IDS', 'HELIO_IDS', 'ORB_OFFS', 'planetOrbitKm'];
vm.runInContext(stripTypeScriptTypes([
  model.replace(/^export /gm, ''),
  ...declarations.map(declaration),
  // Record the epoch actually passed to the shared elements function. Delegate
  // unchanged to the original function, without reconstructing its formula.
  `const originalOrbElems = orbElems;
   const observed = [];
   orbElems = (id, centuries) => {
     observed.push(centuries);
     return originalOrbElems(id, centuries);
   };
   globalThis.origin = JD_START;
   globalThis.bodyIds = HELIO_IDS;
   globalThis.middle = ORB_OFFS.length;
   globalThis.evaluate = (id, positionYears, orbitYears) => {
     observed.length = 0;
     const position = vscl(helioVec(id, positionYears), AU_KM);
     const orbit = planetOrbitKm(id, orbitYears);
     return { position, orbit, epochs: [...observed] };
   };`,
].join('\n'), { mode: 'strip' }), context, { timeout: 1000 });
const bodyIds = Array.from(context.bodyIds);
assert.deepEqual(bodyIds, ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'ceres', 'pluto']);
assert.equal(context.middle, 160);

// Subtract the numeric origin before adding the small JD part. The old
// functions still materialize a binary64 JD inside their years adapter.
function adapt(jdTdb) {
  const years = ((jdTdb[0] - context.origin) + jdTdb[1]) / 365.25;
  return { years, modelJd: context.origin + years * 365.25 };
}

function evaluate(id, positionYears, orbitYears = positionYears) {
  const { position, orbit, epochs } = context.evaluate(id, positionYears, orbitYears);
  return {
    position: Array.from(position),
    orbit: Array.from(orbit, point => Array.from(point)),
    epochs: Array.from(epochs),
  };
}

let pairs = 0;
let maxEpochRoundTripSeconds = 0;
let maxModelVsErfaSeconds = 0;
const preview = { future: 'assume-no-new-leaps' };
for (const [name, utc, , , , , erfaTdb] of reference.cases) {
  const time = convertTime(utc, preview);
  const { years, modelJd } = adapt(time.jdTdb);
  const roundTrip = Math.abs(differenceSeconds([modelJd, 0], time.jdTdb));
  const vsErfa = Math.abs(differenceSeconds([modelJd, 0], erfaTdb));
  assert.ok(roundTrip <= 0.00005, `Legacy JD rounding: ${name}`);
  assert.ok(vsErfa <= 0.0001, `Legacy model time vs ERFA: ${name}`);
  maxEpochRoundTripSeconds = Math.max(maxEpochRoundTripSeconds, roundTrip);
  maxModelVsErfaSeconds = Math.max(maxModelVsErfaSeconds, vsErfa);
  for (const id of bodyIds) {
    const { position, orbit, epochs } = evaluate(id, years);
    const centuries = (modelJd - 2451545) / 36525;
    assert.deepEqual(epochs, [centuries, centuries], `${name} ${id}: same TDB epoch`);
    assert.equal(orbit.length, 321);
    assert.deepEqual(orbit[context.middle], position, `${name} ${id}: exact current-position vertex`);
    assert.ok(orbit.every(point => point.length === 3 && point.every(Number.isFinite)), `${name} ${id}: finite orbit`);
    pairs++;
  }
}
assert.equal(reference.cases.length, 409);

const equivalent = [
  ['2026-11-01T16:00:00Z', '2026-11-02T00:00:00+08:00', '2026-11-01T10:30:00-05:30'],
  ['2000-01-01T11:58:55.816099307Z', '2000-01-01T17:43:55.816099307+05:45'],
  ['2016-12-31T23:59:60.5Z', '2017-01-01T07:59:60.500+08:00'],
  ['2027-06-28T00:00:00Z', '2027-06-27T19:00:00-05:00'],
];
for (const [first, ...others] of equivalent) {
  const expectedTdb = convertTime(first, preview).jdTdb;
  const expectedYears = adapt(expectedTdb).years;
  for (const utc of others) {
    const tdb = convertTime(utc, preview).jdTdb;
    assert.deepEqual(tdb, expectedTdb, utc);
    for (const id of bodyIds) {
      assert.deepEqual(evaluate(id, adapt(tdb).years), evaluate(id, expectedYears), `${utc} ${id}: identical output`);
    }
  }
}

// Negative control. Intentionally feed the track a TDB epoch one second later.
const tdb = convertTime(equivalent[0][0]).jdTdb;
const project = adapt(tdb);
const later = adapt([tdb[0], tdb[1] + 1 / 86400]);
const mismatch = evaluate('earth', project.years, later.years);
assert.notEqual(mismatch.epochs[0], mismatch.epochs[1]);
const shiftedVertex = mismatch.orbit[context.middle];
const negativeControlKm = Math.hypot(...shiftedVertex.map((coordinate, axis) => coordinate - mismatch.position[axis]));
assert.ok(negativeControlKm > 0, 'A different epoch must move the track vertex');

console.log(JSON.stringify({
  instants: reference.cases.length, bodyIds, pairs, verticesPerTrack: 321,
  exactPositionToMiddleVertexKm: 0,
  equivalentTimeGroups: equivalent.length,
  equivalentAlternativePairs: equivalent.reduce((sum, group) => sum + (group.length - 1) * bodyIds.length, 0),
  maxEpochRoundTripSeconds, maxModelVsErfaSeconds, negativeControlKm,
}, null, 2));
