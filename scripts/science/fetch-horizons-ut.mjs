import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const dir=path.join(root,'fixtures/science/horizons-time-frame');
export const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export const baselineBytes=fs.readFileSync(path.join(root,'fixtures/science/legacy-baseline.json'));
export const baseline=JSON.parse(baselineBytes);
export const dates=baseline.samples.map(s=>s.inputJD.decimal);
export const queries=[['emb',3,10,'earth'],['earth',399,10,'earth'],['moon-sun',301,10,'moon'],['moon-earth',301,399,'moonRelativeEarth'],['mars-system',4,10,'mars'],['mars-body',499,10,'mars'],['jupiter-system',5,10,'jupiter'],['jupiter-body',599,10,'jupiter']];
export function parameters(target,center){return {format:'json',COMMAND:String(target),CENTER:`500@${center}`,MAKE_EPHEM:'YES',OBJ_DATA:'YES',EPHEM_TYPE:'VECTORS',REF_SYSTEM:'ICRF',REF_PLANE:'ECLIPTIC',VEC_CORR:'NONE',TIME_TYPE:'UT',VEC_DELTA_T:'YES',TLIST_TYPE:'JD',OUT_UNITS:'KM-S',VEC_TABLE:'2',CSV_FORMAT:'YES',TLIST:dates.join(',')};}
export function parse(raw,target,center){
 const j=JSON.parse(raw); assert.equal(j.signature?.source,'NASA/JPL Horizons API'); assert.ok(!j.error,j.error);
 const s=j.result; assert.equal(typeof s,'string');
 for(const [label,id] of [['Target',target],['Center',center]])assert.match(s,new RegExp(`${label} body name:[^\\n]*\\(${id}\\)`));
 for(const re of [/Center-site name:\s+BODY CENTER/,/Output units\s+: KM-S/,/Output type\s+: GEOMETRIC cartesian states/,/Output format\s+: 2 \(position and velocity\)/,/Reference frame\s+: Ecliptic of J2000.0/,/Calendar Date \(UT[ ~]\)/,/X-axis\s+: ICRF/,/NO corrections or aberrations applied/])assert.match(s,re);
 assert.equal(s.split('$$SOE').length,2);assert.equal(s.split('$$EOE').length,2);
 const rows=s.split('$$SOE')[1].split('$$EOE')[0].trim().split(/\r?\n/).map(line=>{
  const c=line.split(',').map(x=>x.trim()); assert.equal(c.length,10);assert.equal(c[9],'');
  const numeric=[c[0],...c.slice(2,9)];assert.ok(numeric.every(x=>/^[+-]?\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?$/.test(x)));
  const numbers=numeric.map(Number);assert.ok(numbers.every(Number.isFinite));
  return {jd:numbers[0],calendar:c[1],deltaTSeconds:numbers[1],tdbJD:numbers[0]+numbers[1]/86400,xyz:numbers.slice(2,5),velocity:numbers.slice(5)};
 });
 assert.equal(rows.length,8);assert.equal(new Set(rows.map(r=>r.jd)).size,8);
 assert.deepEqual(rows.map(r=>r.jd).sort((a,b)=>a-b),[...dates].sort((a,b)=>a-b));
 return rows;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,2);fs.mkdirSync(dir,{recursive:true});
 for(const [key,target,center] of queries){
  const rawFile=path.join(dir,key+'.raw.json'),metaFile=path.join(dir,key+'.request.json');
  const params=parameters(target,center),url=new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,k==='format'?v:`'${v}'`);
  if(fs.existsSync(rawFile)||fs.existsSync(metaFile)){
   const raw=fs.readFileSync(rawFile),meta=JSON.parse(fs.readFileSync(metaFile));
   assert.equal(meta.sha256,sha(raw));assert.deepEqual(meta.parameters,params);parse(raw,target,center);console.log('CACHED '+key);continue;
  }
  let raw;
  for(let attempt=1;attempt<=3;attempt++){
   try{raw=execFileSync('pwsh',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $r=Invoke-WebRequest -Uri $env:SOL_HORIZONS_URL -TimeoutSec 45 -UseBasicParsing; [Console]::Out.Write($r.Content)"],{env:{...process.env,SOL_HORIZONS_URL:url.href},maxBuffer:2e6,timeout:50000});parse(raw,target,center);break;}
   catch(e){if(attempt===3)throw e;console.error('Retry '+key);await new Promise(r=>setTimeout(r,2000));}
  }
  fs.writeFileSync(rawFile,raw,{flag:'wx'});
  fs.writeFileSync(metaFile,JSON.stringify({url:url.href,parameters:params,retrievedAt:new Date().toISOString(),transport:'Windows PowerShell Invoke-WebRequest HTTPS; default certificate validation',sha256:sha(raw),baselineSha256:sha(baselineBytes)},null,2)+'\n',{flag:'wx'});
  console.log('FETCHED '+key);await new Promise(r=>setTimeout(r,1000));
 }
}
