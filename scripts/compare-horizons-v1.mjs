import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {root,dir,sha,baselineBytes,baseline,dates,queries,parameters,parse} from './fetch-horizons-v1.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--verify'));
const subtract=(a,b)=>a.map((x,i)=>x-b[i]);
const norm=a=>Math.hypot(...a);
function metrics(a,b){
 assert.ok([...a,...b].every(Number.isFinite));assert.ok(norm(a)>0&&norm(b)>0);
 const differenceKm=subtract(a,b),cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const result={differenceKm,positionErrorKm:norm(differenceKm),radialDifferenceKm:norm(a)-norm(b),angleArcsec:Math.atan2(norm(cross),a.reduce((v,x,i)=>v+x*b[i],0))*180/Math.PI*3600};
 assert.ok([...differenceKm,result.positionErrorKm,result.radialDifferenceKm,result.angleArcsec].every(Number.isFinite));return result;
}
assert.equal(metrics([1,0,0],[1,0,0]).positionErrorKm,0);
assert.equal(metrics([0,1,0],[1,0,0]).angleArcsec,324000);
assert.equal(metrics([2,0,0],[1,0,0]).radialDifferenceKm,1);
const references={},provenance={};
for(const [key,target,center] of queries){
 const raw=fs.readFileSync(path.join(dir,key+'.raw.json')),meta=JSON.parse(fs.readFileSync(path.join(dir,key+'.request.json')));
 assert.equal(meta.sha256,sha(raw));assert.equal(meta.baselineSha256,sha(baselineBytes));assert.deepEqual(meta.parameters,parameters(target,center));
 const u=new URL(meta.url);assert.equal(u.origin,'https://ssd.jpl.nasa.gov');assert.equal(u.pathname,'/api/horizons.api');
 for(const [k,v] of Object.entries(meta.parameters))assert.equal(u.searchParams.get(k),k==='format'?v:`'${v}'`);
 assert.ok(Number.isFinite(Date.parse(meta.retrievedAt)));
 references[key]=parse(raw,target,center);provenance[key]={sha256:meta.sha256,retrievedAt:meta.retrievedAt};
}
const rows=[];
for(const sample of baseline.samples){
 assert.equal(sample.productionJD.decimal,sample.inputJD.decimal,'Same numeric JD comparison requires exact equality');
 for(const [key,target,center,slot] of queries){
  const ref=references[key].find(r=>r.jd===sample.inputJD.decimal);assert.ok(ref);
  rows.push({jd:ref.jd,calendarTDB:ref.calendar,group:ref.jd===2470172.5?'out-of-range-2051':'primary-seven',comparison:key,target,center,solSlot:slot,
   ...metrics(sample.vectors[slot].xyz,ref.xyz)});
 }
}
assert.equal(rows.length,64);
// Independent Horizons center-composition cross-check, allowing printed decimal rounding.
for(const jd of dates){
 const get=key=>references[key].find(r=>r.jd===jd).xyz;
 assert.ok(norm(subtract(subtract(get('moon-sun'),get('earth')),get('moon-earth')))<0.00001,'Reference center composition mismatch');
}
const centerOffsets=dates.map(jd=>{const get=k=>references[k].find(r=>r.jd===jd).xyz;return {jd,embEarthKm:norm(subtract(get('emb'),get('earth'))),marsSystemBodyKm:norm(subtract(get('mars-system'),get('mars-body'))),jupiterSystemBodyKm:norm(subtract(get('jupiter-system'),get('jupiter-body')))};});
const summaries=queries.map(([key])=>({comparison:key,primaryMaxKm:Math.max(...rows.filter(r=>r.comparison===key&&r.group==='primary-seven').map(r=>r.positionErrorKm)),outOfRange2051Km:rows.find(r=>r.comparison===key&&r.group==='out-of-range-2051').positionErrorKm}));
const output={label:'Same numeric JD preliminary comparison; SOL UTC-like runtime and Horizons TDB are NOT aligned',baselineSha256:sha(baselineBytes),provenance,definitions:{difference:'SOL minus Horizons, xyz km',positionError:'Euclidean norm of difference',radialDifference:'SOL norm minus Horizons norm about the specified center; Moon-Earth is geocentric, NOT solar radial error',angle:'atan2(cross magnitude,dot), arcseconds, about the specified center; Moon-Earth angle is geocentric'},rows,summaries,centerOffsets};
const typical=rows.filter(r=>r.jd===2461346.1666667);
const labels={'emb':'地球槽 → 地月质心','earth':'地球槽 → 地心','moon-sun':'月球 → 日心月心','moon-earth':'月球地心向量','mars-system':'火星 → 系统质心','mars-body':'火星 → 本体中心','jupiter-system':'木星 → 系统质心','jupiter-body':'木星 → 本体中心'};
const table=rs=>rs.map(r=>`| ${labels[r.comparison]} | ${r.positionErrorKm.toFixed(3)} | ${r.radialDifferenceKm.toFixed(3)} | ${r.angleArcsec.toFixed(3)} |`).join('\n');
const report=`# SOL M2 第一次 JPL Horizons 位置误差报告

本轮为相同 JD 数值的初步对照，不是严格 UTC → TDB 对齐后的算法误差认证。未修改任何生产公式或基线。

## 数据与校验

8 组官方 HTTPS 查询，各 8 个日期；原始 JSON、完整参数、获取时间及 SHA-256 均保存在 fixtures/science/horizons-v1。离线读取逐一核对 NASA/JPL signature、目标/中心、KM-S、JDTDB、ICRF 的 J2000 黄道平面、几何无修正和全部日期。月心日心位置减地心日心位置与月心地心向量的闭合差小于 0.00001 km。原始响应包含所用星历来源标识。

官方依据：[API 参数](https://ssd-api.jpl.nasa.gov/doc/horizons.html)、[坐标及时间说明](https://ssd.jpl.nasa.gov/horizons/manual.html)。Windows PowerShell HTTPS 获取成功；Node fetch 直连超时，未关闭证书验证。

## 典型日期 JD 2461346.1666667

位置误差为三维差向量长度；径向差为 SOL 距离减 Horizons 距离。除月球地心行外均相对太阳；月球地心行的径向差和角度均相对地心。完整带符号 xyz 差见 comparison.json。

| 比较对象 | 三维误差 km | 径向差 km | 夹角角秒 |
|---|---:|---:|---:|
${table(typical)}

## 分组统计（不代表整个适用年代的最大误差）

| 比较对象 | 七个主样本最大位置差 km | 2051 越界样本位置差 km |
|---|---:|---:|
${summaries.map(r=>`| ${labels[r.comparison]} | ${r.primaryMaxKm.toFixed(3)} | ${r.outOfRange2051Km.toFixed(3)} |`).join('\n')}

2051（JD 2470172.5）单列，不纳入七个主样本统计。其余日期也只是离散测量，不是连续区间精度保证。

## 参考中心和未解决因素

典型日期 Horizons 的 EMB–地心间距为 ${centerOffsets[1].embEarthKm.toFixed(3)} km，火星系统质心–本体间距为 ${centerOffsets[1].marsSystemBodyKm.toFixed(6)} km，木星对应间距为 ${centerOffsets[1].jupiterSystemBodyKm.toFixed(3)} km。这些是参考位置的实测间距，不能将两个误差长度之差当作中心修正量。

SOL earth 槽对应近似 EMB，却被生产当作地球；月球日心位置也沿用该原点，已原样对照。地心月球向量另行比较以避免混淆。Horizons 的黄道平面与旧代码声明的 J2000 黄道相符；旧模型的实现精度、参考架近似仍未独立分解。

未进行 UTC/TDB 转换，也未假设固定秒差。尤其不能把总位置差完全归咎于轨道公式；本轮没有可靠分离时间尺度、坐标实现近似和模型截断的贡献。

## 后续优先顺序（本次未实施）

1. 明确并验证时间尺度、历元和参考架契约，分离时间输入影响。
2. 明确地球/地月质心及行星系统质心/本体语义，再设计中心修正验证。
3. 按分离后的残差，分别评估月球理论及行星近似模型；补充日期后决定改进方案。

离线复验：node scripts/compare-horizons-v1.mjs --verify。文件已存在时不会自动覆盖以掩盖差异。原始数据获取时间与 SHA-256 见各 request.json；完整数值与统计见 comparison.json。
`;
function save(file,content){if(fs.existsSync(file)){assert.equal(fs.readFileSync(file,'utf8'),content,'Existing result differs; refusing overwrite: '+file);}else{assert.notEqual(process.argv[2],'--verify','Missing artifact');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,{flag:'wx'});}}
save(path.join(dir,'comparison.json'),JSON.stringify(output,null,2)+'\n');save(path.join(root,'docs/science/horizons-v1-report.md'),report);
console.log('PASS: 8 queries / 64 comparisons, finite results, metadata/hashes/dates/center closure verified.');
console.log(table(typical));
