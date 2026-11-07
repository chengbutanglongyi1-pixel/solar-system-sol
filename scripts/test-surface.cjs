// Executes extracted PUBLISHED production routing/binding/loader code with mock DOM + GL.
// NOT a browser, image decode, GPU pixel test, or iPhone acceptance test.
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const path=require('node:path'), R=__dirname;
const source=fs.readFileSync(path.join(R,'../src/SolarSystemApp.tsx'),'utf8');
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const registry=slice('// SURFACE_REGISTRY_BEGIN','const FRAG_SRC_SIMPLE');
const runtime=slice('    let pcMapsEnabled','    // A-step4: desktop large-viewport');
const selection=slice('    let surfaceProgram','    // ---------------- 每帧');
const ids=['sun','mercury','venus','earth','moon','mars','jupiter','saturn','uranus','neptune','io','europa','ganymede','callisto','titan','titania','triton','ceres','pluto','charon'];
const results=[]; function ok(name,fn){return Promise.resolve().then(fn).then(()=>results.push({name,pass:true}));}
function setup(mobile,opts={}) {
 let serial=0,active=0,error=0,lost=false,releaseDecode=null,rejectDecode=null; const binds={},uniforms={uAtlasWhich:0},calls={decode:0,image:0,upload:0,create:0,delete:0,heavy:0}; const timers=new Map(); let timerId=0;
 const gl={NO_ERROR:0,TEXTURE0:0,TEXTURE5:5,TEXTURE_2D:3553,TEXTURE_BINDING_2D:32873,ARRAY_BUFFER:34962,
 RGBA:6408,UNSIGNED_BYTE:5121,FLOAT:5126,TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,REPEAT:10497,CLAMP_TO_EDGE:33071,
 TEXTURE_MAG_FILTER:10240,TEXTURE_MIN_FILTER:10241,LINEAR:9729,LINEAR_MIPMAP_LINEAR:9987,UNPACK_FLIP_Y_WEBGL:37440,UNPACK_PREMULTIPLY_ALPHA_WEBGL:37441,
 createTexture(){calls.create++;return {texture:++serial}},deleteTexture(){calls.delete++},activeTexture(v){active=v},bindTexture(_,v){binds[active]=v},
 texImage2D(){calls.upload++;if(opts.uploadFail)error=1282},texParameteri(){},generateMipmap(){},pixelStorei(){},isContextLost(){return lost},getError(){let e=error;error=0;return e},
 uniform1i(k,v){if(k!=null)uniforms[k]=v},uniform1f(k,v){if(k!=null)uniforms[k]=v},uniform2f(){},getUniform(_,k){return uniforms[k]??0},getParameter(){return binds[active]},
 useProgram(){},getAttribLocation(){return -1},bindBuffer(){},enableVertexAttribArray(){},vertexAttribPointer(){},drawArrays(){}};
 const data='data:image/webp;base64,YQ=='; const maps=Object.fromEntries(ids.map(id=>[id,data]));
 const context={console,JSON,Object,String,Error,Uint8Array,Blob,gl,isMobileUA:mobile,embeddedBoot:!!opts.embedded,PB_MIN_W:520,maxedRef:{current:false},setGlDebug(){},DRAW_IDS:ids,
 ATLAS_P_ROW:opts.atlasRows||{},ATLAS_M_ROW:{},ATLAS_P_B64_PARTS:[],ATLAS_M_B64_PARTS:[],SOL_PC_PREBAKED_MAPS:maps,SOL_OFFICIAL_EUROPA_MAP:data,glc:{width:900,height:800},prog:{p:1},bootLoc:null,tex:{fallback:true},buf:{},fragUsed:mobile?'full':'simple',
 usePerBodyAsync:false,USE_PER_BODY_PROGS:false,upgradeStopped:true,detailProg:null,detailLoc:null,CLOSE_PXR:24,performance:{now:()=>0},
 ensurePerBodyProg(){calls.heavy++;throw Error('forbidden compile')},bumpPerBody(){calls.heavy++;throw Error('forbidden compile')},
 atob:x=>Buffer.from(x,'base64').toString('binary'),URL:{createObjectURL:()=> 'blob:mock',revokeObjectURL(){}},
 createImageBitmap:()=>{calls.decode++;return opts.decodeHang?new Promise((resolve,reject)=>{rejectDecode=reject;releaseDecode=()=>resolve({close(){},width:1024,height:512})}):opts.bitmapFail||opts.decodeFail?Promise.reject(Error('mock decode fail')):Promise.resolve({close(){},width:1024,height:512})},
 window:{innerWidth:opts.width??900,innerHeight:opts.height??800,setTimeout:(fn)=>{timers.set(++timerId,fn);return timerId},clearTimeout:(id)=>timers.delete(id)}};
 context.Image=class {set src(v){calls.image++;queueMicrotask(()=>{if(opts.decodeFail)this.onerror?.();else this.onload?.()})}};
 context.loc={uPcMap:'uPcMap',uPcMapped:'uPcMapped',uAtlasWhich:'uAtlasWhich',uMask:'uMask',uJupMap:'uJupMap',uMoonMap:'uMoonMap',uAtlasP:'uAtlasP',uAtlasM:'uAtlasM'};
 context.bootLoc=context.loc;
 vm.createContext(context);
 const ts=registry+'\n'+(opts.registryPatch||'')+'\n'+runtime+'\n'+selection;
 vm.runInContext(stripTypeScriptTypes(ts,{mode:'strip'}),context);
 const run=(s)=>vm.runInContext(s,context);
 const draw=id=>{context.id=id;run('selectSurface(id,1,0,0,1,100); gl.drawArrays(); recordSurfaceDraw(id);')};
 const snapshot=()=>context.window.__solarSurfaceDiagnostics();
 return {context,run,draw,snapshot,calls,uniforms,binds,timers,lose:()=>{lost=true},maps,release:()=>releaseDecode?.(),reject:()=>rejectDecode?.(Error("late rejected mock decoder"))};
}
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))};
(async()=>{
 await ok('registry: 20 bodies x 2 devices, desired source matrix + deliberate pending',()=>{
  const t=setup(true); for(const id of ids){t.context.id=id;assert.equal(t.run('solSurfacePlan(id,true,false,100).source'),id==='europa'?'official-map':'procedural');assert.equal(t.run('solSurfacePlan(id,false,true,100).source'),'pc-prebaked')}
  assert.match(t.run('SOL_SURFACE_REGISTRY.europa.pending'),/有意待同步/);assert.equal(t.calls.decode,0);assert.equal(t.calls.upload,0);
 });
 await ok('PC preview dimensions/iframe and 4px request/6px mapping gates preserved',()=>{
  const t=setup(false,{embedded:true,width:300,height:200});assert.equal(t.run('pcMapsEnabled'),false);t.draw('europa');assert.equal(t.calls.decode,0);
  assert.equal(t.run('solSurfacePlan("earth",false,true,3).request'),false);assert.equal(t.run('solSurfacePlan("earth",false,true,4).request'),true);assert.equal(t.run('solSurfacePlan("earth",false,true,5).map'),false);assert.equal(t.run('solSurfacePlan("earth",false,true,6).map'),true);
 });
 await ok('mobile iframe: official map not blocked by PC gate; real production draw entry',async()=>{
  const t=setup(true,{embedded:true,width:300,height:200});t.draw('europa');assert.equal(t.calls.decode,1);assert.equal(t.snapshot().states['mobile:europa'].adopted,false);await flush();t.draw('europa');const d=t.snapshot();assert.equal(d.states['asset:official:europa-warm'].decode,'成功');assert.equal(d.states['asset:official:europa-warm'].upload,'成功');assert.equal(d.states['mobile:europa'].adopted,true);assert.equal(d.states['mobile:europa'].pixelVerified,false);
 });
 await ok('mobile Europa -> Io -> Earth -> Moon -> Mars: mapping cleared, no leaked texture or extra decode',async()=>{
  const t=setup(true);t.draw('europa');await flush();t.draw('europa');assert.equal(t.uniforms.uPcMapped,1);
  for(const id of ['io','earth','moon','mars']){t.draw(id);assert.equal(t.uniforms.uPcMapped,0);assert.equal(t.binds[5].fallback,true);assert.equal(t.snapshot().states['mobile:'+id].adopted,false)}assert.equal(t.calls.decode,1);t.draw('europa');assert.equal(t.uniforms.uPcMapped,1);assert.equal(t.calls.upload,1);
 });
 await ok('PC Earth/Moon/Europa/Io/Mars map cache bounded at 2, mapping identities and pending retained',async()=>{
  const t=setup(false);for(const id of ['earth','moon','europa','io','mars']){t.draw(id);await flush();t.draw(id);assert.equal(t.uniforms.uPcMapped,1);assert.equal(t.snapshot().states['pc:'+id].adopted,true);assert.ok(t.run('Object.keys(pcMapCache).length')<=2)}assert.equal(t.calls.heavy,0);assert.match(t.snapshot().states['pc:europa'].pending,/有意待同步/);
 });
 await ok('missing registered official asset -> deterministic procedural fallback',()=>{
  const t=setup(true);t.run('SOL_SURFACE_ASSETS["official:europa-warm"]=()=>undefined');t.draw('europa');assert.equal(t.uniforms.uPcMapped,0);assert.equal(t.calls.decode,0);assert.match(t.snapshot().states['mobile:europa'].fallback,/资源缺失/);
 });
 await ok('missing PC asset -> lightweight fallback; no decoding',()=>{
  const t=setup(false);delete t.maps.earth;t.draw('earth');assert.equal(t.uniforms.uPcMapped,0);assert.equal(t.calls.decode,0);assert.match(t.snapshot().states['pc:earth'].fallback,/资源缺失/);
 });
 await ok('ImageBitmap rejected -> Image fallback succeeds once (mock decoder)',async()=>{
  const t=setup(true,{bitmapFail:true});t.draw('europa');await flush();t.draw('europa');assert.equal(t.calls.decode,1);assert.equal(t.calls.image,1);assert.equal(t.uniforms.uPcMapped,1);
 });
 await ok('both decoders fail -> official fallback does not retry every frame',async()=>{
  const t=setup(true,{decodeFail:true});t.draw('europa');await flush();for(let i=0;i<50;i++)t.draw('europa');assert.equal(t.uniforms.uPcMapped,0);assert.equal(t.calls.decode,1);assert.equal(t.calls.upload,0);assert.equal(t.snapshot().states['asset:official:europa-warm'].decode,'失败');
 });
 await ok('PC decode failure -> fallback, no per-frame retries',async()=>{
  const t=setup(false,{decodeFail:true});t.draw('earth');await flush();for(let i=0;i<50;i++)t.draw('earth');assert.equal(t.calls.decode,1);assert.equal(t.uniforms.uPcMapped,0);assert.equal(t.snapshot().states['asset:pc:earth'].decode,'失败');
 });
 await ok('mock GPU texImage error is upload failure, not a fake ready flag (both devices)',async()=>{
  for(const mobile of [true,false]){const t=setup(mobile,{uploadFail:true});t.draw('europa');await flush();t.draw('europa');assert.equal(t.uniforms.uPcMapped,0);assert.equal(t.snapshot().states[mobile?'asset:official:europa-warm':'asset:pc:europa'].upload,'失败')}
 });
 await ok('mock decode timeout (both devices) -> failure, no stuck loading/repeated work',async()=>{
  for(const mobile of [true,false]){const t=setup(mobile,{decodeHang:true});t.draw('europa');for(const fn of [...t.timers.values()])fn();t.draw('europa');assert.equal(t.uniforms.uPcMapped,0);assert.equal(t.calls.decode,1);assert.match(t.snapshot().states[mobile?'asset:official:europa-warm':'asset:pc:europa'].error,/超时/)}
 });
 await ok('uniform missing -> fallback; no false adopted status',async()=>{
  const t=setup(true);t.draw('europa');await flush();t.context.loc.uPcMapped=null;t.draw('europa');assert.equal(t.snapshot().states['mobile:europa'].adopted,false);assert.match(t.snapshot().states['mobile:europa'].fallback,/uniform/);
 });
 await ok('atlas bypass and uniform tamper detected AFTER submitted mock draw',async()=>{
  const t=setup(true);t.draw('europa');await flush();t.run('bindSurfacePlan(solSurfacePlan("europa",true,false,100));');t.uniforms.uAtlasWhich=1;t.run('recordSurfaceDraw("europa")');assert.equal(t.snapshot().states['mobile:europa'].adopted,false);
  const u=setup(true);u.draw('europa');await flush();u.run('bindSurfacePlan(solSurfacePlan("europa",true,false,100));');u.uniforms.uPcMapped=0;u.run('recordSurfaceDraw("europa")');assert.equal(u.snapshot().states['mobile:europa'].adopted,false);
 });
 await ok('target draw reached without binding -> explicit diagnosis, not success',()=>{
  const t=setup(true);t.run('recordSurfaceDraw("europa")');assert.equal(t.snapshot().states['mobile:europa'].adopted,false);assert.match(t.snapshot().states['mobile:europa'].drawReason,/未到达/);
 });
 await ok('diagnostics on changes only, 80 events maximum, no UI flag; no fake pixel acceptance',async()=>{
  const t=setup(true);t.draw('europa');await flush();t.draw('europa');const count=t.snapshot().events.length;for(let i=0;i<100;i++)t.draw('europa');assert.equal(t.snapshot().events.length,count);t.run('for(let i=0;i<200;i++)surfaceNote("test",{step:i})');assert.equal(t.snapshot().events.length,80);assert.equal(t.snapshot().states['mobile:europa'].pixelVerified,false);assert.equal(t.calls.heavy,0);
 });
 await ok('unknown registration and asset identity change never silently reuse old image',async()=>{
  const t=setup(true);assert.match(t.run('solSurfacePlan("unknown",true,false,100).reason'),/未登记/);t.draw('europa');await flush();t.draw('europa');t.run('SOL_SURFACE_ASSETS["official:test"]=()=>SOL_OFFICIAL_EUROPA_MAP; SOL_SURFACE_REGISTRY.io.mobile={source:"official-map",resource:"official:test",version:"mock"}');t.draw('io');assert.equal(t.uniforms.uPcMapped,0);await flush();t.draw('io');assert.equal(t.uniforms.uPcMapped,1);assert.equal(t.calls.delete,1);
 });

 await ok('timeout late decoder completion cannot upload or revive ready (both devices)',async()=>{
  for(const mobile of [true,false]){const t=setup(mobile,{decodeHang:true});t.draw('europa');for(const fn of [...t.timers.values()])fn();t.release();await flush();t.draw('europa');assert.equal(t.calls.upload,0);assert.equal(t.uniforms.uPcMapped,0)}
 });
 await ok('PC preview exit cancels timer, ignores late decode, clears cache statuses',async()=>{
  const t=setup(false,{decodeHang:true});t.draw('earth');assert.equal(t.timers.size,1);t.run('pcMapsEnabled=false;clearPcMaps();');assert.equal(t.timers.size,0);t.release();await flush();assert.equal(t.calls.upload,0);
 });
 await ok('on-demand next-draw recheck detects mapping tamper after an earlier successful submission',async()=>{
  const t=setup(true);t.draw('europa');await flush();t.draw('europa');assert.equal(t.snapshot().states['mobile:europa'].adopted,true);
  t.context.window.__solarSurfaceDiagnostics(true);t.run('bindSurfacePlan(solSurfacePlan("europa",true,false,100));');t.uniforms.uPcMapped=0;t.run('recordSurfaceDraw("europa")');assert.equal(t.snapshot().states['mobile:europa'].adopted,false);
 });
 await ok('future PC official registration still respects preview gate; no startup decode',()=>{
  const t=setup(false,{embedded:true,width:300,height:200});t.run('SOL_SURFACE_REGISTRY.europa.pc={source:"official-map",resource:"official:europa-warm",version:"mock"}');t.draw('europa');assert.equal(t.calls.decode,0);assert.equal(t.uniforms.uPcMapped,0);
 });

 await ok('Sun keeps existing shader-emission bypass registered; never claims map adoption',()=>{
  for(const mobile of [true,false]){const t=setup(mobile);const p=t.run('solSurfacePlan("sun",'+mobile+',true,100)');assert.equal(p.map,false);assert.equal(p.request,false);assert.ok(p.reason.includes('自发光'));t.draw('sun');assert.equal(t.calls.decode,0);assert.equal(t.snapshot().states[(mobile?'mobile':'pc')+':sun'].adopted,false)}
 });

 await ok('missing whole/platform registration: startup audit is null-safe and dynamic diagnostic is accurate',async()=>{
  for(const mobile of [true,false])for(const whole of [true,false]){
   const device=mobile?'mobile':'pc',patch=whole?'delete SOL_SURFACE_REGISTRY.europa':'delete SOL_SURFACE_REGISTRY.europa.'+device;
   const t=setup(mobile,{registryPatch:patch});t.draw('europa');const d=t.snapshot();assert.equal(d.states[device+':europa'].configured,false);assert.equal(d.states[device+':europa'].supported,false);assert.match(d.states[device+':europa'].fallback,whole?/天体未登记/:/平台条目缺失/);assert.ok(d.audit.some(v=>v.includes(whole?'未登记':'平台条目缺失')));assert.equal(t.calls.decode,0);
  }
  const t=setup(true);t.draw('europa');await flush();t.draw('europa');t.run('delete SOL_SURFACE_REGISTRY.europa.mobile');t.draw('europa');const s=t.snapshot().states['mobile:europa'];assert.equal(s.configured,false);assert.equal(s.adopted,false);assert.equal(s.resource,'');assert.equal(s.version,'unregistered');
 });
 await ok('unsupported mobile prebake and unknown source: deterministic fallback, no perpetual loading or decode',()=>{
  for(const source of ['pc-prebaked','unregistered-type']){const t=setup(true);t.context.src=source;t.run('SOL_SURFACE_REGISTRY.io.mobile={source:src,resource:"pc:io",version:"test"}');for(let i=0;i<50;i++)t.draw('io');const s=t.snapshot().states['mobile:io'];assert.equal(s.supported,false);assert.equal(s.adopted,false);assert.equal(s.version,'test');assert.match(s.fallback,/不支持|未支持/);assert.doesNotMatch(s.fallback,/解码\/上传中/);assert.equal(t.calls.decode,0);assert.equal(t.calls.heavy,0)}
 });
 await ok('PC ready cache invalidates resource or version change before bind, then adopts only replacement',async()=>{
  for(const versionOnly of [false,true]){const t=setup(false);t.draw('earth');await flush();t.draw('earth');const old=t.binds[5];t.run('SOL_SURFACE_REGISTRY.earth.pc={source:"pc-prebaked",resource:'+JSON.stringify(versionOnly?'pc:earth':'pc:mars')+',version:"replacement"}');t.draw('earth');assert.notEqual(t.binds[5],old);assert.equal(t.uniforms.uPcMapped,0);assert.equal(t.snapshot().states['pc:earth'].adopted,false);assert.equal(t.calls.decode,2);await flush();t.draw('earth');assert.equal(t.snapshot().states['pc:earth'].adopted,true);assert.equal(t.snapshot().states['pc:earth'].version,'replacement');assert.notEqual(t.binds[5],old);for(let i=0;i<100;i++)t.draw('earth');assert.equal(t.calls.decode,2);assert.ok(t.calls.delete>=1)}
 });
 await ok('PC failure is version-scoped: same identity does not retry, replacement can recover',async()=>{
  const opts={decodeFail:true};const t=setup(false,opts);t.draw('earth');await flush();for(let i=0;i<40;i++)t.draw('earth');assert.equal(t.calls.decode,1);opts.decodeFail=false;t.run('SOL_SURFACE_REGISTRY.earth.pc.version="recover-v2"');t.draw('earth');await flush();t.draw('earth');assert.equal(t.calls.decode,2);assert.equal(t.snapshot().states['pc:earth'].adopted,true);
 });
 await ok('PC in-flight same-body replacement: old result discarded, latest queued identity decoded once',async()=>{
  const t=setup(false,{decodeHang:true});t.draw('earth');t.run('SOL_SURFACE_REGISTRY.earth.pc={source:"pc-prebaked",resource:"pc:mars",version:"inflight-new"}');for(let i=0;i<20;i++)t.draw('earth');assert.equal(t.calls.decode,1);assert.equal(t.uniforms.uPcMapped,0);t.release();await flush();assert.equal(t.calls.upload,0);assert.equal(t.calls.decode,2);t.release();await flush();t.draw('earth');assert.equal(t.calls.upload,1);assert.equal(t.snapshot().states['pc:earth'].adopted,true);assert.equal(t.run('pcMapCache.earth.resource'),'pc:mars');
 });
 await ok('PC stale queued identity never decodes; fresh draw schedules changed queue target',async()=>{
  const t=setup(false,{decodeHang:true});t.draw('earth');t.draw('moon');t.run('SOL_SURFACE_REGISTRY.moon.pc.version="queue-new"');t.release();await flush();assert.equal(t.calls.decode,1);t.draw('moon');assert.equal(t.calls.decode,2);t.release();await flush();t.draw('moon');assert.equal(t.snapshot().states['pc:moon'].adopted,true);assert.equal(t.run('pcMapCache.moon.version'),'queue-new');
 });
 await ok('PC old late rejection cannot poison replacement failure or cache',async()=>{
  const t=setup(false,{decodeHang:true});t.draw('earth');t.run('SOL_SURFACE_REGISTRY.earth.pc.version="new-after-reject"');t.draw('earth');t.reject();await flush();assert.equal(t.calls.decode,2);assert.equal(t.run('!!pcMapFailed.earth'),false);t.release();await flush();t.draw('earth');assert.equal(t.snapshot().states['pc:earth'].adopted,true);
 });
 await ok('PC cached body deletion / changed registry: release and eviction do not dereference missing entries',async()=>{
  const t=setup(false);for(const id of ['earth','moon']){t.draw(id);await flush();t.draw(id)}t.run('delete SOL_SURFACE_REGISTRY.earth');t.draw('mars');await flush();t.draw('mars');assert.equal(t.snapshot().states['pc:mars'].adopted,true);t.run('delete SOL_SURFACE_REGISTRY.moon;clearPcMaps()');assert.equal(t.run('Object.keys(pcMapCache).length'),0);
 });
 await ok('official single-slot cache also invalidates same-resource version change',async()=>{
  const t=setup(true);t.draw('europa');await flush();t.draw('europa');const old=t.binds[5];t.run('SOL_SURFACE_REGISTRY.europa.mobile.version="official-next"');t.draw('europa');assert.equal(t.uniforms.uPcMapped,0);assert.notEqual(t.binds[5],old);await flush();t.draw('europa');assert.equal(t.snapshot().states['mobile:europa'].adopted,true);assert.equal(t.calls.decode,2);
 });
 await ok('legacy atlas restoration is audited and diagnosed even for procedural bodies',()=>{
  const t=setup(true,{atlasRows:{io:0}});assert.ok(t.snapshot().audit.some(v=>v.includes('未登记旧atlas')));t.draw('io');assert.equal(t.snapshot().states['mobile:io'].unregisteredAtlas,false);t.run('surfaceAtlasWhich=1');t.uniforms.uAtlasWhich=1;t.draw('io');const s=t.snapshot().states['mobile:io'];assert.equal(s.unregisteredAtlas,true);assert.equal(s.adopted,false);assert.match(s.drawReason,/未登记atlas/);const count=t.snapshot().events.length;for(let i=0;i<50;i++)t.draw('io');assert.equal(t.snapshot().events.length,count);t.run('surfaceAtlasWhich=0');t.uniforms.uAtlasWhich=0;t.draw('io');assert.equal(t.snapshot().states['mobile:io'].unregisteredAtlas,false);
 });
 const report={testKind:'Published source extracted into Node VM; MOCK DOM/decode/WebGL; NOT browser/GPU pixels/iPhone',pass:true,count:results.length,results};fs.writeFileSync(path.join(R,'mock-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(err=>{console.error(err);fs.writeFileSync(path.join(R,'mock-results.json'),JSON.stringify({pass:false,results,error:err.stack},null,2));process.exitCode=1});
