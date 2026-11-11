// Strict relocation and binary64 regression checks, without loading the UI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import ts from 'typescript';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const blob = '96953222ef5151e193a3d79f7a612c039244fc47';
const raw = execFileSync('git',['cat-file','blob',blob],{cwd:root,maxBuffer:32*1024*1024});
assert.equal(crypto.createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex'),blob);
const original = raw.toString('utf8');
const ast = ts.createSourceFile('original.tsx',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(name) {
  const found=ast.statements.filter(n => (ts.isVariableStatement(n) && n.declarationList.declarations.some(d=>d.name.text===name)) ||
    ((ts.isFunctionDeclaration(n)||ts.isTypeAliasDeclaration(n)) && n.name?.text===name));
  assert.equal(found.length,1,name); return found[0];
}
const moved=['JD_START','ELEMENTS','rotOrbit','orbElems','helioVec'];
const header='// Unchanged legacy planetary formulas from production commit 4f89ab2.\n// Earth remains the approximate EMB slot; no time-scale or center correction.\n';
const expectedModule=header+['V3','D2R',...moved].map(name=>(moved.includes(name)?'export ':'')+declaration(name).getText(ast)).join('\n\n')+'\n';
const moduleSource=read('src/science/legacy-orbits.ts');
assert.equal(moduleSource,expectedModule,'Module must contain unchanged original formulas/constants only');
let expectedApp=original;
for(const node of moved.map(declaration).sort((a,b)=>b.getStart(ast)-a.getStart(ast)))
  expectedApp=expectedApp.slice(0,node.getStart(ast))+expectedApp.slice(node.end);
expectedApp='import { JD_START, ELEMENTS, rotOrbit, orbElems, helioVec } from "./science/legacy-orbits";\n'+expectedApp;
assert.equal(read('src/SolarSystemApp.tsx'),expectedApp,'Only approved declaration relocation and production import are allowed');
const context=vm.createContext({}, {codeGeneration:{strings:false,wasm:false}});
vm.runInContext(stripTypeScriptTypes(moduleSource.replace(/^export /gm,'')+'\nglobalThis.api={helioVec,orbElems,rotOrbit,ELEMENTS,JD_START};',{mode:'strip'}),context,{timeout:1000});
const fixture=JSON.parse(read('fixtures/science/legacy-baseline.json'));
assert.equal(fixture.provenance.gitBlob,blob); assert.equal(fixture.samples.length,8);
const ids=['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','ceres','pluto'];
assert.deepEqual(Object.keys(context.api.ELEMENTS),ids);
const bits=n=>{assert.ok(Number.isFinite(n));const b=Buffer.alloc(8);b.writeDoubleBE(n);return b.toString('hex');};
// AU conversion uses the original production helper and constant, not a replacement formula.
vm.runInContext(stripTypeScriptTypes(['V3','vscl','AU_KM'].map(n=>declaration(n).getText(ast)).join('\n'),{mode:'strip'}),context,{timeout:1000});
let checked=0;
for(const sample of fixture.samples) {
  context.years=sample.years.decimal;
  for(const id of ids) {
    context.id=id;
    const xyz=vm.runInContext('vscl(api.helioVec(id,years),AU_KM)',context,{timeout:1000});
    assert.deepEqual(Array.from(xyz,bits),sample.vectors[id].float64HexBE,`${id} JD ${sample.inputJD.decimal}`);
    assert.deepEqual(Array.from(xyz),sample.vectors[id].xyz);
    checked+=3;
  }
  const earth=vm.runInContext('api.helioVec("earth",years)',context,{timeout:1000});
  assert.deepEqual(Array.from(earth,bits),sample.vectors.earthSlotApproxEmbAU.float64HexBE);
}
console.log(`PASS: exact production relocation; 8 dates x 10 bodies = ${checked} km components plus 24 Earth AU components, all Float64-identical. Not an astronomical accuracy certification.`);
