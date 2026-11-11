// Executes bounded production snippets only. No renderer, real shader, image, or GPU.
// Baselines protect existing behavior; they do not certify astronomy or device performance.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../src/SolarSystemApp.tsx'), 'utf8');
function part(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Production boundaries missing: ${start}`);
  assert.equal(source.indexOf(start, a + 1), -1, `Ambiguous start: ${start}`);
  return source.slice(a, b);
}
function run(code, inputs, result) {
  const ctx = vm.createContext({ ...inputs });
  vm.runInContext(stripTypeScriptTypes(code + '\n;globalThis.result = (' + result + ');', { mode: 'strip' }), ctx, { timeout: 1000 });
  return ctx.result;
}
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name, e); }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const boot = part('    let embeddedBoot = false;', '    // A-step4: per-body async ONLY');
const ua = { pc: 'Windows', ios: 'iPhone', ipad: 'Macintosh', android: 'Android' };
function device(kind, embedded = false, w = 900, h = 800) {
  const self = {};
  return { navigator: { userAgent: ua[kind], maxTouchPoints: kind === 'ipad' ? 5 : 0 },
    window: { self, top: embedded ? {} : self, innerWidth: w, innerHeight: h, devicePixelRatio: 3 },
    wrap: { clientWidth: w, clientHeight: h } };
}
function start(kind, embedded, succeeds, w = 900, h = 800) {
  const calls = [];
  const result = run(boot, { ...device(kind, embedded, w, h), FRAG_SRC_SIMPLE: 'simple', VERT_SRC: 'stub',
    getFullFrag: () => 'full', getSafeFrag: () => 'safe',
    linkProg: (_, label) => { calls.push(label); return label === succeeds ? {} : null; } }, '({isMobileUA, solarLiteBoot, embeddedBoot, previewish, fragUsed})');
  return { calls, ...result };
}
test('A desktop normal/embed: simple only even when linking fails', () => {
  for (const embed of [false, true]) for (const success of ['simple', 'none'])
    assert.deepEqual(start('pc', embed, success).calls, ['simple']);
});
test('A mobile full -> safe -> simple, stop on first success including small iframe', () => {
  for (const kind of ['ios', 'ipad', 'android']) for (const embed of [false, true])
    for (const [success, expected] of [['full',['full']], ['safe',['full','safe']], ['simple',['full','safe','simple']], ['none',['full','safe','simple']]])
      assert.deepEqual(start(kind, embed, success, 300, 200).calls, expected);
});
const bakeSize = part('    const maxTex = gl.getParameter', '    let jupTex:');
const bake = part('    const skipHeavyBake = !isMobileUA;', '    if (bakeVs && bakeFs');
const moon = part('    const moonFs = skipHeavyBake', '    const moonProg =');
test('B desktop never requests heavy bake sources; mobile retains Jupiter and Moon compile path', () => {
  for (const mobile of [false, true]) {
    const calls = [];
    run(bake + moon, { isMobileUA: mobile, gl: { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, createProgram: () => ({}) },
      JUP_BAKE_VERT: 'vertex', MOON_USE_V2: true, compile: (_, s) => { calls.push(s); return {}; },
      getJupBakeFrag: () => 'jupiter', getMoonBakeFragV2: () => 'moon-v2', getMoonBakeFrag: () => 'moon' }, '0');
    assert.deepEqual(calls, mobile ? ['vertex','jupiter','moon-v2'] : []);
  }
});
test('B bake resolution retains mobile policy inside small embeds', () => {
  for (const [kind, maxTex, expected] of [['ios',4096,2048], ['android',4096,4096], ['android',2048,2048], ['ios',1024,1024]]) {
    const d = device(kind, true, 300, 200);
    assert.equal(run(bakeSize, { ...d, isMobileUA: true, solarLiteBoot: true, embeddedBoot: true, previewish: true,
      gl: { MAX_TEXTURE_SIZE: 1, getParameter: () => maxTex } }, 'JUP_W'), expected);
  }
});
const gate = part('        const iframeLarge =', '        if (mapsNow !==');
test('B live PC loading gate: width 360 and iframe 520x500 boundaries, maximize, mobile exclusion', () => {
  for (const [mobile, embed, maxed, w, h, wrapW, expected] of [
    [false,false,false,900,800,359,false], [false,false,false,900,800,360,true],
    [false,true,false,519,500,520,false], [false,true,false,520,499,520,false],
    [false,true,false,520,500,520,true], [false,true,true,300,200,360,true], [true,false,true,900,800,900,false]])
    assert.equal(run(gate, { window: { innerWidth:w, innerHeight:h }, wrap:{clientWidth:wrapW}, PB_MIN_W:520,
      isMobileUA:mobile, embeddedBoot:embed, maxedRef:{current:maxed} }, 'mapsNow'), expected);
});
const sizing = part('    let cw = 2;', '    const ro = new ResizeObserver');
const maxPx = part('const GL_MAX_PX =', '\n');
function size(kind, embed, w, h, dpr) {
  const d = device(kind, embed, w, h); d.window.devicePixelRatio = dpr;
  return run(maxPx + sizing, { ...d, solarLiteBoot:start(kind,embed,'simple',w,h).solarLiteBoot,
    back:{}, top:{}, glc:{} }, '({maxDim,maxArea,os,q,w:glc.width,h:glc.height})');
}
test('C platform/window budget matrix and DPR cap', () => {
  for (const [kind,embed,w,h,dim,area] of [['pc',false,900,800,2048,3200000], ['ios',false,900,800,2048,3200000],
    ['ipad',false,900,800,2048,3200000], ['android',false,900,800,2560,5000000],
    ['android',true,900,800,2048,3200000], ['android',false,519,800,2048,3200000], ['android',false,520,419,2048,3200000], ['android',false,520,420,2560,5000000]]) {
    const s = size(kind,embed,w,h,4); assert.equal(s.maxDim,dim); assert.equal(s.maxArea,area);
    assert.ok(s.os <= 3); assert.ok(s.w*s.h <= area+5000); assert.ok(Math.max(s.w,s.h)<=dim);
  }
  assert.equal(size('android',false,600,500,4).os,3);
  assert.equal(size('pc',false,900,800,1).os,1);
});
test('C area constraint and extreme-container lower-bound behavior (known limitation)', () => {
  near(size('pc',false,2000,2000,3).os, Math.sqrt(3200000/4000000));
  const huge = size('pc',false,10000,10000,3);
  assert.equal(huge.os,0.3); assert.equal(huge.w,3000); // Existing budget breach, not a safety certification.
});
const quality = part('      if (dtReal > 0 && dtReal < 1)', '      // 时间');
function qualityAt(overrides) {
  return run(quality, { dtReal:0.04, fpsAcc:0, fpsN:0, fps:0, window:{}, slowT:0, fastT:0, q:1,
    now:10000, lastQ:0, cw:1000, ch:800, os:1, glc:{}, ...overrides }, '({q,slowT,fastT,lastQ})');
}
test('C dynamic quality slowdown threshold and lower bound', () => {
  assert.equal(qualityAt({slowT:1.16}).q,1);
  near(qualityAt({slowT:1.2}).q,0.82);
  assert.equal(qualityAt({slowT:1.2,q:0.46}).q,0.45);
  assert.equal(qualityAt({slowT:2,q:0.45}).q,0.45);
});
test('C dynamic quality recovery, cooldown, upper bound, long-frame exclusion', () => {
  near(qualityAt({dtReal:0.01,fastT:4,q:0.5}).q,0.575);
  assert.equal(qualityAt({dtReal:0.01,fastT:4,q:0.9}).q,1);
  assert.equal(qualityAt({dtReal:0.01,fastT:4,q:0.5,now:6000}).q,0.5);
  assert.equal(qualityAt({dtReal:1,slowT:2}).q,1);
});
const delta = part('      if (!(now - last >= 0))', '      // 帧率与自适应分辨率');
const time = part('      const spN = Number(P.speed);', '      const years = P.simRef.current;');
function tick(speed, playing, now, last = 0) {
  return run(delta + time, { now,last,P:{speed,playing,simRef:{current:10}}, YEAR_S:31557600, utcNowYears:()=>42 }, '({dtRaw,value:P.simRef.current})');
}
test('D real-speed wall clock anchoring and pause', () => {
  assert.equal(tick('1',true,5000).value,42);
  for (const speed of [1,100000]) assert.equal(tick(speed,false,5000).value,10);
});
test('D accelerated normal/long frames clamp real delta before multiplying (background undercount baseline)', () => {
  for (const [ms,dt] of [[0,0],[16,0.016],[100,0.1],[101,0.1],[5000,0.1]]) {
    const t = tick(100000,true,ms); near(t.dtRaw,dt); near(t.value,10+dt*100000/31557600);
  }
  assert.equal(tick(100,true,5,10).dtRaw,0);
});
const spin = part('      const phase: Record<string, number> = {};', '      // 聚焦与相机');
function rotate(rate, playing, initial, id='probe', direction=-1) {
  return run(spin, { SPIN_IDS:[id], VIS:{[id]:{rotH:id==='earth'?-1:1}}, spN:rate*3600,
    jd:2451545, D2R:Math.PI/180, TAU:Math.PI*2, spinW:()=>7, spinSign:()=>direction,
    spinAcc:initial===undefined?{}:{[id]:initial}, P:{playing}, dtRaw:0.1 }, `phase[${JSON.stringify(id)}]`);
}
test('E threshold below/at uses real-phase function; above uses fixed visual speed', () => {
  for (const rate of [0,0.149999,0.15]) assert.equal(rotate(rate,true,99),7);
  for (const rate of [0.150001,1000]) near(rotate(rate,true,2),2-Math.PI*2*0.01);
});
test('E initialization, pause and signed visual rotation including Earth special path', () => {
  assert.equal(rotate(1,false,undefined),7); assert.equal(rotate(1,false,2),2);
  near(rotate(1,true,undefined),7-Math.PI*2*0.01);
  near(rotate(1,true,2,'probe',1),2+Math.PI*2*0.01);
  near(rotate(1,true,2,'earth',1),2-Math.PI*2*0.01);
  near(rotate(0.15,true,99,'earth'),280.46061837*Math.PI/180);
});
console.log(JSON.stringify({passed,failed,manualAcceptance:'Desktop/iPhone/Android pixels, actual compile/bake, frame rate, memory and astronomical orientation remain unverified.'}));
process.exitCode = failed ? 1 : 0;
