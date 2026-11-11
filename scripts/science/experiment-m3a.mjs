// Offline candidates only. No production imports with UI side effects and no network.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import ts from 'typescript';
import {root,dir,sha,baselineBytes,baseline,queries,parse} from './fetch-horizons-ut.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--verify'));
const read=p=>fs.readFileSync(path.join(root,p));
const GM={earth:398600.435507,moon:4902.800118,unit:'km^3/s^2',source:'https://ssd.jpl.nasa.gov/astro_par.html',ephemeris:'DE440 published rounded constants',checkedDate:'2026-11-12'};
const mu=GM.moon/(GM.earth+GM.moon);
const original=execFileSync('git',['cat-file','blob','96953222ef5151e193a3d79f7a612c039244fc47'],{cwd:root,maxBuffer:32e6});
assert.equal(sha(original),baseline.provenance.sourceSha256);
const ast=ts.createSourceFile('old.tsx',original.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function extract(name){const a=ast.statements.filter(n=>(ts.isFunctionDeclaration(n)&&n.name?.text===name)||(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.text===name)));assert.equal(a.length,1);return a[0].getText(ast);}
const module=read('src/science/legacy-orbits.ts').toString();
const lunar=['moonState','moonVec'].map(extract).join('\n');
const app=read('src/SolarSystemApp.tsx').toString().replace(/\r\n/g,'\n');
for(const name of ['moonState','moonVec'])assert.ok(app.includes(extract(name)),'Production lunar function differs');
const context=vm.createContext({});
vm.runInContext(stripTypeScriptTypes(module.replace(/^export /gm,'')+'\n'+lunar+'\n'+['AU_KM','vscl','vadd'].map(extract).join('\n')+`
globalThis.evaluate=(jdInput)=>{
 const years=(jdInput-JD_START)/365.25;
 const jd=JD_START+years*365.25;
 const pos={}; for(const id of ['earth','mars','jupiter'])pos[id]=vscl(helioVec(id,years),AU_KM);
 const mrel=moonVec(jd);pos.moon=vadd(pos.earth,mrel);pos.moonRelativeEarth=mrel;
 return pos;
};`,{mode:'strip'}),context,{timeout:1000});
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),scale=(a,k)=>a.map(v=>v*k),norm=a=>Math.hypot(...a);
const bits=n=>{assert.ok(Number.isFinite(n));const b=Buffer.alloc(8);b.writeDoubleBE(n);return b.toString('hex');};
const refs={},hashes={};
for(const [key,target,center] of queries){const raw=fs.readFileSync(path.join(dir,key+'.raw.json'));const meta=JSON.parse(fs.readFileSync(path.join(dir,key+'.request.json')));assert.equal(sha(raw),meta.sha256);assert.equal(meta.baselineSha256,sha(baselineBytes));refs[key]=parse(raw,target,center);hashes[key]=sha(raw);}
function evaluate(jd){assert.ok(Number.isFinite(jd)&&jd>0);context.jdInput=jd;return JSON.parse(JSON.stringify(vm.runInContext('evaluate(jdInput)',context,{timeout:1000})));}
function correct(p){const c=structuredClone(p);c.earth=sub(p.earth,scale(p.moonRelativeEarth,mu));c.moon=add(c.earth,p.moonRelativeEarth);
 assert.ok(norm(sub(sub(c.moon,c.earth),p.moonRelativeEarth))<1e-7);
 assert.ok(norm(sub(add(scale(c.earth,1-mu),scale(c.moon,mu)),p.earth))<1e-7);return c;}
const rows=[],instants=[];
for(const sample of baseline.samples){
 const jd=sample.inputJD.decimal,t=refs.emb.find(r=>r.jd===jd);assert.ok(t);
 const A=Object.fromEntries(['earth','moon','mars','jupiter','moonRelativeEarth'].map(id=>[id,sample.vectors[id].xyz]));
 const reproduced=evaluate(jd);for(const id of Object.keys(A))assert.deepEqual(reproduced[id].map(bits),sample.vectors[id].float64HexBE,'Original output mismatch');
 const B=evaluate(t.tdbJD),C=correct(A),D=correct(B),schemes={A,B,C,D};
 assert.deepEqual(B.mars,D.mars);assert.deepEqual(A.jupiter,C.jupiter);
 instants.push({jdUTC:jd,jdTDB:t.tdbJD,officialDeltaSeconds:t.deltaTSeconds,utc:t.calendar,scope:jd===2470172.5?'2051-out-of-range':'primary-seven'});
 for(const [key,,,slot] of queries){const ref=refs[key].find(r=>r.jd===jd);assert.equal(ref.deltaTSeconds,t.deltaTSeconds);
  // EMB comparison always uses raw EMB output, never the corrected Earth-center position.
  for(const [scheme,p] of Object.entries(schemes)){const xyz=key==='emb'?(scheme==='B'||scheme==='D'?B.earth:A.earth):p[slot];const diff=sub(xyz,ref.xyz);
   rows.push({jd,key,scheme,scope:jd===2470172.5?'2051-out-of-range':'primary-seven',positionKm:xyz,errorVectorKm:diff,errorKm:norm(diff)});
  }
 }
}
assert.equal(rows.length,256);assert.ok(rows.every(r=>[...r.positionKm,...r.errorVectorKm,r.errorKm].every(Number.isFinite)));
const summary=[];
for(const [key] of queries)for(const scheme of ['A','B','C','D']){const rs=rows.filter(r=>r.key===key&&r.scheme===scheme&&r.scope==='primary-seven');assert.equal(rs.length,7);summary.push({key,scheme,meanKm:rs.reduce((s,r)=>s+r.errorKm,0)/7,maxKm:Math.max(...rs.map(r=>r.errorKm)),improvedVsA:rs.filter(r=>r.errorKm<rows.find(a=>a.jd===r.jd&&a.key===key&&a.scheme==='A').errorKm).length});}
const output={GM,moonMassFraction:mu,environment:{node:process.version,v8:process.versions.v8},sources:{baseline:sha(baselineBytes),productionModule:sha(Buffer.from(module)),lunarCode:sha(Buffer.from(lunar)),utResponses:hashes},
 assumptions:'Reference instant = archived numeric JD interpreted as UT/UTC, with official per-date TDB-UT. Includes ~2.9 ms SOL epoch-label discrepancy; future leap seconds conditional. B shifts both planetary and lunar function arguments; lunar TT/TDB convention not independently certified.',instants,rows,summary};
const keys=queries.map(q=>q[0]);
function table(jd){return keys.map(k=>'| '+k+' | '+['A','B','C','D'].map(s=>rows.find(r=>r.jd===jd&&r.key===k&&r.scheme===s).errorKm.toFixed(3)).join(' | ')+' |').join('\n');}
const report=`# SOL M3-A 第一轮科学修复方案报告

## 推荐接口（尚未实施）

用户日期必须带 Z 或显式时区偏移；转换为统一时刻对象，不接受隐含本地时区。utcUnixMs 只作界面/普通 UTC 输入表示，不能表示闰秒 :60；需独立 UTC 日历字段与有效性标志处理闰秒，不能让 JavaScript Date 静默归一化。

建议时间对象保存 UTC、两部分 JD 的 TT/TDB、可选 UT1、转换来源/版本/有效区间和未来闰秒假设。UTC→TAI 使用版本化闰秒表，TAI→TT 按定义，TT→TDB 使用经过验证的天文库/星历实现；本轮仅在八个日期使用 Horizons 官方 delta-T，无插值、无固定 69.18 秒，不提供通用转换器。[JPL 时间定义](https://ssd.jpl.nasa.gov/horizons/manual.html#time)、[官方 delta-T 参数](https://ssd-api.jpl.nasa.gov/doc/horizons.html)。

行星函数输入明确叫 jdTdb，两部分 JD 可减小舍入；yearsTdb=(jdTdb−明确的TDB历元)/365.25 仅为兼容旧函数的适配量，不能与 UTC UI 年数共用含糊的 years。UI 时间推进在统一时刻接口完成，再派生各时间尺度，不在每个天体中独立转换。当前 JD_START 与 UTC START_MS 有约 2.9 ms 标签偏差，本轮未修复。

月球姿态未来按具体 IAU 模型声明所需 TT/TDB，地面观测的地球旋转另需 UT1 与 EOP 极移；不能拿 UTC 或 TDB 代替 UT1。对象缺少 EOP 或超出预测范围时必须显示限制，复用同一个实际时刻而非同一个含糊 JD。

## 中心与坐标契约

位置对象应携带 target、center、frame、epoch、unit。本轮采用太阳中心、J2000 黄道、右手 XYZ、km；模型内部 AU 只在边界转换。EMB、Earth、Moon 必须是不同 target。火星/木星明确 system barycenter 与 body center，不能默认等同。月球地心向量记作 r，EMB 日心位置记作 b。

推荐 e=b−μr，m=e+r=b+(1−μ)r；μ=GMmoon/(GMearth+GMmoon)。使用 [JPL DE440 参数](https://ssd.jpl.nasa.gov/astro_par.html)：地球 ${GM.earth}、月球 ${GM.moon} km³/s²，μ=${mu}。这是公开舍入参数，不声称等于所有 DE441 内部精确常量。每个样本检查 m−e=r 和质量加权中心返回 b。

## 四方案定义与结果

A：M1-A 原始位置；B：实际生产行星/月球函数接收官方换算的 JDTDB，仍保持原中心混用；C：只对原始输出做上述中心合成；D：B 加中心合成。没有重写轨道公式。月球简化理论本身的 TT/TDB 模型约定尚未单独认证，B/D 是统一动力学时间候选实验。四者均对同一套 UT 参考坐标，不混用首轮同数值 TDB 参考。

emb 行永远检查 EMB 模型输出，不把修正后的地心冒充 EMB。地心月球向量不会因 C 改变；火星、木星不会因 C 改变。表中单位均为三维位置误差 km。

### 典型日期 JD UTC 2461346.1666667

| 参考对象 | A | B | C | D |
|---|---:|---:|---:|---:|
${table(2461346.1666667)}

### 七个主样本（均值 / 最大值 km；括号为优于 A 的样本数）

| 对象 | A | B | C | D |
|---|---|---|---|---|
${keys.map(k=>'| '+k+' | '+['A','B','C','D'].map(s=>{const x=summary.find(r=>r.key===k&&r.scheme===s);return `${x.meanKm.toFixed(3)} / ${x.maxKm.toFixed(3)} (${x.improvedVsA}/7)`;}).join(' | ')+' |').join('\n')}

### 2051 越界观察（不进入主样本统计）

| 参考对象 | A | B | C | D |
|---|---:|---:|---:|---:|
${table(2470172.5)}

全部日期、差向量、候选位置及时间输入保存在 fixtures/science/m3a/experiment.json。2050/2051 的 UTC→TDB 是归档时 Horizons 的未来闰秒假设，不能承诺未来实际 UTC 精度。

## 如何解释与实施顺序

时间对齐并不保证每个误差范数都下降；中心修正也可能移除旧模型与错误原点之间的抵消。不得按单点最小值选择错误语义。B−A 反映只改变模型时间输入的影响，C−A 反映中心合成影响，D 体现两者组合；剩余不是纯开普勒误差，还涉及月球近似、系统/本体语义、时间预测和精密参考架实现。没有用 Horizons 地球位置反推生产模型来人为降低误差。

建议首先审核并实现独立、可测试的时间接口（需选择经验证转换实现及闰秒数据，尚未在本任务实现），再在独立提交中引入中心语义修正，不以“所有日期误差必须下降”为正确性标准。月球模型升级和行星近似替换留待统一契约后的证据审查。

最小未来改动：新增纯时间转换/状态模块；生产入口单点调用；legacy-orbits 原公式保持，由适配器传入 yearsTdb；Earth/Moon 组合集中到纯函数。姿态/渲染先不变。每项独立提交、保留旧路径与原基线；回退用撤销对应接线提交，不覆盖基线。正式接线前需要新时间接口的闰秒、历元、未来有效性测试及电脑/iPhone 回归。

## 验证

实验逐位重现 A，验证所有 256 组结果有限、七样本统计完整、中心合成闭合及 C 不改变火星/木星。离线复验命令：node scripts/science/experiment-m3a.mjs --verify。禁止自动覆盖已有结果。
`;
for(const [file,content] of [[path.join(root,'fixtures/science/m3a/experiment.json'),JSON.stringify(output,null,2)+'\n'],[path.join(root,'docs/science/m3a-report.md'),report]]){
 if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),content);else{assert.notEqual(process.argv[2],'--verify');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,{flag:'wx'});}
}
console.log('PASS: 256 offline comparisons; original binary64 reproduction; center closure; finite results.');console.log(table(2461346.1666667));console.log(JSON.stringify(summary));
