import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {root,dir,sha,baselineBytes,baseline,dates,queries,parameters,parse} from './fetch-horizons-ut.mjs';
import {parse as parseTDB} from '../fetch-horizons-v1.mjs';
assert.ok(process.argv.length===2||process.argv[2]==='--verify');
const read=p=>fs.readFileSync(path.join(root,p));
const sub=(a,b)=>a.map((x,i)=>x-b[i]),add=(a,b)=>a.map((x,i)=>x+b[i]),norm=a=>Math.hypot(...a),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const old={},ut={},hashes={};
for(const [key,target,center] of queries){
 const raw=fs.readFileSync(path.join(dir,key+'.raw.json')),m=JSON.parse(fs.readFileSync(path.join(dir,key+'.request.json')));
 assert.equal(sha(raw),m.sha256);assert.equal(m.baselineSha256,sha(baselineBytes));assert.deepEqual(m.parameters,parameters(target,center));
 const url=new URL(m.url);assert.equal(url.origin,'https://ssd.jpl.nasa.gov');assert.equal(url.pathname,'/api/horizons.api');
 for(const [k,v] of Object.entries(m.parameters))assert.equal(url.searchParams.get(k),k==='format'?v:`'${v}'`);
 assert.ok(Number.isFinite(Date.parse(m.retrievedAt)));ut[key]=parse(raw,target,center);
 const oldRaw=read(`fixtures/science/horizons-v1/${key}.raw.json`),oldMeta=JSON.parse(read(`fixtures/science/horizons-v1/${key}.request.json`));
 assert.equal(sha(oldRaw),oldMeta.sha256);old[key]=parseTDB(oldRaw,target,center);
 for(const marker of ['Target body name:','Center body name:']){
  const header=s=>JSON.parse(s).result.split('\n').find(l=>l.startsWith(marker));
  assert.equal(header(raw),header(oldRaw),'Ephemeris source changed: cannot isolate time only');
 }
 hashes[key]={ut:sha(raw),old:sha(oldRaw)};
}
const rows=[],times=[],centers=[];
for(const s of baseline.samples){
 const jd=s.inputJD.decimal,get=(collection,key)=>collection[key].find(r=>r.jd===jd),t=get(ut,'emb');
 times.push({jdUTC:jd,utcCalendar:t.calendar,tdbMinusUTCSeconds:t.deltaTSeconds,jdTDB:t.tdbJD,
  solClockUTC:new Date(Date.UTC(2026,10,1,16)+s.years.decimal*31557600*1000).toISOString(),futureLeapSecondsAssumed:jd>=2469806.5});
 for(const [key,,,slot] of queries){
  const a=get(old,key),b=get(ut,key),sol=s.vectors[slot].xyz;assert.equal(b.deltaTSeconds,t.deltaTSeconds);
  const oldError=sub(sol,a.xyz),utError=sub(sol,b.xyz),shift=sub(b.xyz,a.xyz);
  assert.ok(norm(sub(utError,sub(oldError,shift)))<1e-7);
  rows.push({jd,key,group:jd===2470172.5?'2051-out-of-range':'primary-seven',oldErrorKm:norm(oldError),utErrorKm:norm(utError),referenceShiftKm:norm(shift),errorChangeKm:norm(utError)-norm(oldError),oldErrorVectorKm:oldError,utErrorVectorKm:utError,referenceShiftVectorKm:shift});
 }
 const sol=s.vectors.earth.xyz,emb=get(ut,'emb').xyz,earth=get(ut,'earth').xyz;
 const embError=sub(sol,emb),embMinusEarth=sub(emb,earth),earthError=sub(sol,earth);
 assert.ok(norm(sub(earthError,add(embError,embMinusEarth)))<1e-7);
 assert.ok(norm(sub(sub(get(ut,'moon-sun').xyz,earth),get(ut,'moon-earth').xyz))<1e-5);
 const moonError=sub(s.vectors.moon.xyz,get(ut,'moon-sun').xyz),lunarError=sub(s.vectors.moonRelativeEarth.xyz,get(ut,'moon-earth').xyz);
 assert.ok(norm(sub(moonError,add(earthError,lunarError)))<1e-5);
 centers.push({jd,embError,embMinusEarth,earthError,cancellationCosine:dot(embError,embMinusEarth)/norm(embError)/norm(embMinusEarth),lunarError,moonError,
  marsSystemMinusBody:sub(get(ut,'mars-system').xyz,get(ut,'mars-body').xyz),jupiterSystemMinusBody:sub(get(ut,'jupiter-system').xyz,get(ut,'jupiter-body').xyz)});
}
// Exercise actual production rotOrbit with basis vectors; never render or fit rotations.
const module=read('src/science/legacy-orbits.ts').toString(),context=vm.createContext({});
vm.runInContext(stripTypeScriptTypes(module.replace(/^export /gm,'')+'\nglobalThis.rotate=rotOrbit;',{mode:'strip'}),context);
for(const angles of [[0,0,0],[0.3,-1.2,2.4],[Math.PI/2,0,0]]){
 const x=Array.from(context.rotate(1,0,...angles)),y=Array.from(context.rotate(0,1,...angles)),z=cross(x,y);
 assert.ok(Math.abs(norm(x)-1)<1e-14&&Math.abs(norm(y)-1)<1e-14&&Math.abs(dot(x,y))<1e-14);
 assert.ok(Math.abs(dot(x,cross(y,z))-1)<1e-14);
}
assert.deepEqual(Array.from(context.rotate(1,0,0,0,0)),[1,0,0]);assert.deepEqual(Array.from(context.rotate(0,1,0,0,0)),[0,1,0]);
assert.ok(norm(sub(Array.from(context.rotate(0,1,Math.PI/2,0,0)),[0,0,1]))<1e-14);
const app=read('src/SolarSystemApp.tsx').toString();assert.ok(app.includes('const AU_KM = 149597870.7;'));
const evidence={};for(const [file,tokens] of [['src/science/legacy-orbits.ts',['const ELEMENTS','function rotOrbit','function helioVec']],['src/SolarSystemApp.tsx',['const START_MS','function utcNowYears','const AU_KM','pos.moon = vadd']]]){
 const text=read(file).toString();evidence[file]={sha256:sha(read(file)),locations:tokens.map(token=>({token,line:text.slice(0,text.indexOf(token)).split('\n').length}))};
}
const output={baselineSha256:sha(baselineBytes),hashes,evidence,times,rows,centers,frameBasisChecks:'PASS: identity, +inclination maps +Y toward +Z, orthonormal right-handed basis'};
function finite(x){if(typeof x==='number')assert.ok(Number.isFinite(x));else if(x&&typeof x==='object')Object.values(x).forEach(finite);}finite(output);assert.equal(rows.length,64);
const typical=2461346.1666667,c=centers.find(r=>r.jd===typical),t=times.find(r=>r.jdUTC===typical);
const table=jd=>rows.filter(r=>r.jd===jd).map(r=>`| ${r.key} | ${r.oldErrorKm.toFixed(3)} | ${r.utErrorKm.toFixed(3)} | ${r.referenceShiftKm.toFixed(3)} |`).join('\n');
const report=`# SOL M2-2 时间与参考架验证报告

## 时间证据与限制

[JPL 时间定义](https://ssd.jpl.nasa.gov/horizons/manual.html#time)说明：本批日期的 UT 是 UTC；TDB 是动力学独立时间。未来 UTC 依赖最后已知闰秒与 EOP 预测。请求 VEC_DELTA_T=YES 获取官方逐日秒差，未假设固定值。依据 [API 参数](https://ssd-api.jpl.nasa.gov/doc/horizons.html)。

| JD UTC | UTC 日历（官方） | TDB−UTC 秒 | 对应 JD TDB |
|---|---|---:|---:|
${times.map(t=>`| ${t.jdUTC} | ${t.utcCalendar} | ${t.tdbMinusUTCSeconds} | ${t.jdTDB} |`).join('\n')}

对应 TDB JD 由官方 delta-T/86400 加到 JD UTC 得出（只做单位转换，未自建时间模型；保留官方秒差精度与浮点舍入）。2050/2051 的 UTC 是预测假设，不是已知未来闰秒历表。

SOL 的 Date.now→years 使用 UTC 毫秒；JD_START=2461346.1666667 与 START_MS 的 UTC 历元存在约 2.9 毫秒截断偏移。因此这里是按同数值 JD 的 UT 解释匹配 SOL 时钟意图，仍有毫秒级历元差，并非无条件的严格同物理时刻认证。基线各日期对应 SOL 时钟另存 solClockUTC。

## 代表日期 ${typical}

误差与参考位移均为三维长度 km。UT 列不是“修复后的 SOL”，只更换时间含义正确的参考时刻。官方秒差为 ${t.tdbMinusUTCSeconds} s。

| 比较 | 旧 TDB 误差 km | UT 对照误差 km | Horizons 时间位移 km |
|---|---:|---:|---:|
${table(typical)}

## 2051 越界样本（单列，不参与主样本精度结论）

| 比较 | 旧 TDB 误差 km | UT 对照误差 km | Horizons 时间位移 km |
|---|---:|---:|---:|
${table(2470172.5)}

全部 64 行差向量及误差变化见 analysis.json；未把未来样本与正常适用范围混合汇总。

## 参考架核查

| 项目 | 证据与结论 |
|---|---|
| 根数平面/历元 | [JPL 表1与公式步骤5](https://ssd.jpl.nasa.gov/planets/approx_pos.html)：J2000 平黄道/春分点，时间参数预期 JDTDB；SOL ELEMENTS 的地球槽数值对应 EM Bary。 |
| XYZ / 手系 | rotOrbit 的六个系数与官方步骤5一致；零角度输出 +X/+Y，正倾角将 +Y 转向 +Z。直接执行生产函数的基向量与正交性测试通过，完成为右手系；无轴交换/符号反转证据。 |
| Horizons | 原始响应为 Ecliptic of J2000.0；X 为 ICRF 基准，黄道北极 +Z，IAU76 黄赤交角 84381.448 角秒；不是赤道 XYZ，也不是日期黄道。 |
| 原点/单位 | 原生产 helioVec 输出太阳中心 AU，再乘 149597870.7 得 km。月球 moonVec 为地心 km；最终加到未修正 earth 槽。 |
| 是否需坐标变换 | 名义平面、轴约定一致，未发现可证实的大角度/手系/单位不一致，不实施任意拟合旋转。J2000 平春分点与 ICRF 的细微实现差未单独测定，不能据此声称完全同一精密参考架。 |

代码行号与 SHA-256：${JSON.stringify(evidence)}。月球简化理论的 J2000 转换近似未在本轮认证。

## 参考中心抵消（UT 代表日期，km）

定义 eB=SOL−EMB，d=EMB−Earth，则 eE=eB+d。实测：

- eB = ${JSON.stringify(c.embError)}
- d = ${JSON.stringify(c.embMinusEarth)}
- eE = ${JSON.stringify(c.earthError)}
- eB 与 d 的方向余弦 = ${c.cancellationCosine}；负值表示抵消，不是地心模型正确的证据。
- 火星系统−本体 = ${JSON.stringify(c.marsSystemMinusBody)}
- 木星系统−本体 = ${JSON.stringify(c.jupiterSystemMinusBody)}

每日期验证地心/质心向量恒等式，月球日心误差=地球槽对地心误差+月球地心误差（闭合容差 0.00001 km，仅容纳参考输出小数舍入）。完整向量在 analysis.json。不能把两个长度简单相减当作中心修正。

## 结论与后续

时间解释改变参考位置且可能让总误差变大或变小；剩余量仍包含模型近似、中心混用、微小参考架实现和未来时间预测影响，不能宣布为纯轨道误差。优先建立 UTC→TDB 与历元契约，其次明确 EMB/地心及系统/本体接口，最后以统一契约重新评估各模型残差并设计科学修复。本次无生产改动。

离线验证：node scripts/science/compare-time-frame.mjs --verify。八组目标/中心、参数、单位、时标、日期、原始响应 SHA-256 及旧新星历来源标识均检查。没有覆盖旧数据。
`;
for(const [file,content] of [[path.join(dir,'analysis.json'),JSON.stringify(output,null,2)+'\n'],[path.join(root,'docs/science/horizons-time-frame-report.md'),report]]){
 if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),content);else{assert.notEqual(process.argv[2],'--verify');fs.writeFileSync(file,content,{flag:'wx'});}
}
console.log('PASS time/frame/center: 64 comparisons; official delta-T; source and closure checks.');console.log(table(typical));console.log(JSON.stringify(c));
