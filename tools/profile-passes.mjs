#!/usr/bin/env node
/**
 * profile-passes.mjs — 单子 AQ-b0 的尺子：把一帧拆成各个 render pass，逐 pass 量 GPU 时间。
 *
 * **为什么需要它**：`capture.mjs` 只给一个 fps 和两个提交计数（`sceneSubmissions` 主场景+阴影、
 * `frameSubmissions` 整帧）。`gate_approach` 低于其余三镜时，这两个数答不了「低在哪一层」——
 * 三角与 `mound_block` 相当，所以不是三角的锅（单子 AQ-b0 的前提）。
 *
 * **它怎么量**：`?profile` 打开 `WebGPURenderer` 的 `trackTimestamp`，每个 render context
 * （阴影贴图一趟、主场景一趟、GTAO/去噪/bloom/SMAA/输出各一趟 quad pass）在 GPU 上各有一对
 * timestamp query。three 把结果写进 `backend.timestampQueryPool.render.timestamps`，键是
 * `r:<帧内第几次 render>:<renderContext.id>:f<帧号>`。**但这个键不带任何语义**，所以这里挂上
 * `renderer.inspector.beginRender/finishRender`（three 自己留的钩子，`Renderer._renderScene`
 * 调用），在同一个 uid 上记下这一趟的 scene / camera / renderTarget 与 draw call、三角增量，
 * 于是「哪一趟」有了名字。
 *
 * **判据上的注意**：GPU 时间是异步读回的，`resolveQueriesAsync` 会把上次 resolve 以来
 * 所有 context 的 query 一起解析；池子默认只有 256 个 query（128 趟），所以这里每 4 帧
 * resolve 一次，绝不攒。逐帧读数有抖动，输出取中位数。
 *
 * 用法：
 *   node tools/profile-passes.mjs --url http://127.0.0.1:5311/garden.html \
 *        --shots gate_approach,mound_block,grass_close,xiaoxiang --out shots/aqb-profile.json
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 机位表与 capture.mjs 同源：这里只需要 pos/yaw/pitch，照抄会漂，所以从 capture.mjs 读。 */
const { SHOTS } = await import(resolve(__dirname, 'shot-list.mjs'));

function parseArgs(argv) {
  const a = { url: 'http://127.0.0.1:5173/garden.html', shots: ['gate_approach'], rounds: 8, framesPerRound: 4, out: null, width: 1600, height: 900, ablate: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--url') a.url = argv[++i];
    else if (k === '--shots') a.shots = argv[++i].split(',').map((s) => s.trim());
    else if (k === '--rounds') a.rounds = Number(argv[++i]);
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--ablate') a.ablate = true;
    else if (k === '--width') a.width = Number(argv[++i]);
    else if (k === '--height') a.height = Number(argv[++i]);
  }
  return a;
}
const args = parseArgs(process.argv);
const selected = SHOTS.filter((s) => args.shots.includes(s.id));
if (!selected.length) { console.error(`没有这些机位: ${args.shots.join(',')}`); process.exit(1); }

const url = args.url + (args.url.includes('?') ? '&' : '?') + 'profile';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle','--use-angle=metal','--enable-gpu','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--enable-webgl','--disable-frame-rate-limit','--force-device-scale-factor=1'],
});
const page = await browser.newPage({ viewport: { width: args.width, height: args.height }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror:', e.message));

console.log(`> ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const ready = await page.waitForFunction(() => window.__GAME__ !== undefined || document.querySelector('#app pre') !== null, null, { timeout: 180000 }).then(() => true).catch(() => false);
if (!ready) { console.error('TIMEOUT: 世界没建起来'); await browser.close(); process.exit(2); }
await page.waitForTimeout(2000);

/** 与 capture.mjs 的 freezeGame 同一套：固定时间、固定分辨率，别让自适应分辨率参与。 */
await page.evaluate(() => {
  const e = window.__GAME__.engine;
  e.adaptiveResolution = false;
  e.fixedTime = 10;
  e.governResolution = () => {};
  const world = window.__GAME__.world;
  const update = world.update.bind(world);
  world.update = (dt) => { world.ctx.env.windTime.value = 10 - dt; update(dt, 10); };
  e.renderer.setPixelRatio(1);
  e.postfx.setSize(innerWidth, innerHeight);
});

/**
 * 挂 inspector：给每个 uid 记下它是哪一趟，以及**它的父趟是谁**。
 *
 * 为什么要父子：TSL 的 `RenderPipeline` 是惰性求值的——一趟 quad pass 在
 * `updateBefore` 里把它依赖的那趟**就地渲出来**，于是 render 调用是嵌套的
 * （输出 → bloom → 场景 RTT → 主场景 MRT → 阴影贴图）。timestamp 量的是
 * pass 的起止，**父趟的读数天然含着子趟**。第一版这里用单槽变量记 open，
 * 嵌套一进来就被覆盖，主场景那趟报出来是「0 draw call」——数字自己把这个
 * 结构说出来了。改成栈，并在汇总时减掉子趟，得到**独占**时间。
 */
const hooked = await page.evaluate(() => {
  const r = window.__GAME__.engine.renderer;
  if (!r.backend.trackTimestamp) return { ok: false, why: 'trackTimestamp 关着——URL 少了 ?profile' };
  const insp = r.inspector;
  const labels = new Map();
  window.__PASSLABELS__ = labels;
  const info = r.info.render;
  const stack = [];
  const b = insp.beginRender.bind(insp), f = insp.finishRender.bind(insp);
  insp.beginRender = (uid, scene, camera, renderTarget) => {
    const rec = {
      order: Number(String(uid).split(':')[1]),
      depth: stack.length,
      parent: stack.length ? stack[stack.length - 1].uid : null,
      scene: scene ? (scene.name || scene.type) + '#' + scene.id : null,
      camera: camera ? (camera.name || camera.type) + '#' + camera.id : null,
      target: renderTarget ? (renderTarget.texture?.name || renderTarget.name || 'rt') + '#' + renderTarget.id + '@' + renderTarget.width + 'x' + renderTarget.height + (renderTarget.textures?.length > 1 ? `x${renderTarget.textures.length}mrt` : '') : 'canvas',
      calls: 0, tris: 0,
    };
    labels.set(uid, rec);
    stack.push({ uid, rec, calls0: info.drawCalls, tris0: info.triangles });
    return b(uid, scene, camera, renderTarget);
  };
  insp.finishRender = (uid) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].uid !== uid) continue;
      const open = stack[i];
      open.rec.calls = info.drawCalls - open.calls0;
      open.rec.tris = info.triangles - open.tris0;
      stack.length = i;
      break;
    }
    return f(uid);
  };
  return { ok: true };
});
if (!hooked.ok) { console.error(hooked.why); await browser.close(); process.exit(3); }

const SETTLE = ({ pos, yaw, pitch }) => {
  const g = window.__GAME__, T = g.THREE;
  g.player.teleport(new T.Vector3(pos[0], pos[1], pos[2]), yaw);
  g.player.state.pitch = pitch;
  let stable = 0, last = g.player.state.position.y;
  for (let i = 0; i < 120 && stable < 5; i++) {
    g.player.update(1 / 60);
    const y = g.player.state.position.y;
    stable = Math.abs(y - last) < 1e-4 ? stable + 1 : 0;
    last = y;
  }
  g.player.state.pitch = pitch;
  return { cameraY: Number(g.engine.camera.position.y.toFixed(3)) };
};
const WAIT = (n) => new Promise((res) => { let i = 0; const s = () => (++i >= n ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); });

// 预热：先把所有机位走一遍，管线编译不许落进读数里（同 capture.mjs 的理由）。
for (const shot of selected) { await page.evaluate(SETTLE, shot); await page.evaluate(WAIT, 10); }

const report = {};
for (const shot of selected) {
  const { cameraY } = await page.evaluate(SETTLE, shot);
  await page.evaluate(WAIT, 20);
  // 丢掉一轮：进场那几帧还带着上一个机位的剔除状态。
  await page.evaluate(async (n) => {
    const r = window.__GAME__.engine.renderer;
    await new Promise((res) => { let i = 0; const s = () => (++i >= n ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); });
    await r.resolveTimestampsAsync('render');
    r.backend.timestampQueryPool.render.timestamps.clear();
  }, args.framesPerRound);

  const rounds = [];
  for (let k = 0; k < args.rounds; k++) {
    const round = await page.evaluate(async (n) => {
      const r = window.__GAME__.engine.renderer;
      await new Promise((res) => { let i = 0; const s = () => (++i >= n ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); });
      await r.resolveTimestampsAsync('render');
      const pool = r.backend.timestampQueryPool.render;
      const out = [];
      for (const [uid, ms] of pool.timestamps) {
        const l = window.__PASSLABELS__.get(uid);
        out.push({ uid, ms, frame: Number(String(uid).split(':f')[1]), ...(l ?? {}) });
      }
      pool.timestamps.clear();
      return out;
    }, args.framesPerRound);
    rounds.push(round);
  }

  /*
   * 汇总。
   *
   * **不减子趟**。第一版减了,outer 出来是负数——说明这些 pass 的 timestamp
   * 窗口不是「父含子」:WebGPU 里每个 render pass 是独立的 GPU pass,CPU 侧的
   * 嵌套(TSL 惰性求值,一趟 quad pass 在 updateBefore 里就地把依赖渲出来)
   * 不等于 GPU 时间轴上的嵌套。所以逐 pass 读数**本身就是独占的**,直接列。
   * draw call / 三角则相反——`renderer.info` 是全帧累加的计数器,CPU 侧嵌套
   * 会让父趟把子趟数进去,那两列减子趟。
   *
   * **这张表的可信度**:逐 pass 的 ms 之和明显大于同一台机上量到的帧时
   * (mound_block 逐 pass 求和 28ms,而 47fps ≈ 21ms/帧),说明 Metal/Dawn 给的
   * pass 级 timestamp 里含着排队与等待,不是纯粹的执行时间。**所以逐 pass 的
   * 绝对值只当排序用,不当预算用**;真要问「这一层值多少」,用下面的消融
   * (`--ablate`):同一台机、同一帧、只拆掉一层,量整帧 GPU 之差。
   */
  const byPass = new Map();
  const frameTotals = new Map();
  for (const round of rounds) {
    for (const e of round) {
      if (!Number.isFinite(e.ms)) continue;
      let childCalls = 0, childTris = 0;
      for (const c of round) if (c.parent === e.uid) { childCalls += c.calls; childTris += c.tris; }
      const key = `${String(e.order).padStart(2, '0')}|${e.scene}|${e.camera}|${e.target}`;
      if (!byPass.has(key)) byPass.set(key, { key, order: e.order, depth: e.depth, scene: e.scene, camera: e.camera, target: e.target, samples: [], callSamples: [], triSamples: [] });
      const p = byPass.get(key);
      p.samples.push(e.ms);
      p.callSamples.push(e.calls - childCalls);
      p.triSamples.push(e.tris - childTris);
      frameTotals.set(e.frame, (frameTotals.get(e.frame) ?? 0) + e.ms);
    }
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const passes = [...byPass.values()]
    .map((p) => ({ order: p.order, depth: p.depth, scene: p.scene, camera: p.camera, target: p.target, ms: med(p.samples), calls: med(p.callSamples), tris: med(p.triSamples), n: p.samples.length }))
    .sort((a, b) => a.order - b.order);
  const frameMedian = med([...frameTotals.values()]);
  const fps = await page.evaluate(() => Math.round(window.__GAME__.engine.fps));
  report[shot.id] = { cameraY, fps, frameGpuMedianMs: frameMedian, passes };
  console.log(`\n== ${shot.id}  (cameraY ${cameraY}, fps ${fps}, 逐 pass 求和中位 ${frameMedian.toFixed(2)} ms)`);
  for (const p of passes) {
    console.log(`  ${p.ms.toFixed(3).padStart(7)} ms  ${String(p.calls).padStart(4)} calls ${String(Math.round(p.tris / 1000)).padStart(5)}k  ${p.target}  ${p.scene}`);
  }
}

/* ------------------------------------------------------------------ */
/* 消融:同一台机、同一次世界构建,只拆掉一层,量整帧 GPU 之差            */
/* ------------------------------------------------------------------ */
if (args.ablate) {
  /* 每个开关都只改 PostFX 已有的只读旋钮再 `applyQuality` 重建节点图——
   * 不新建 URL、不改默认值,拆完还原。`shadow` 那一档走 `light.castShadow`,
   * 因为阴影不在节点图里。 */
  const KNOBS = {
    base:    () => {},
    ao:      'ao',
    dof:     'dof',
    skyfx:   'skyfx',
    bloom:   'bloom',
    shadow:  'shadow',
    scene:   'scene',
  };
  const APPLY = (knob) => {
    const g = window.__GAME__, e = g.engine, fx = e.postfx;
    // 还原
    fx.aoOverride = null; fx.skyFxOn = true; fx.settings.dofStrength = window.__DOF0__;
    e.quality = { ...e.quality, bloom: true, ssao: true };
    for (const l of window.__SUNS__) l.castShadow = true;
    if (window.__HIDDEN__) { for (const o of window.__HIDDEN__) o.visible = true; window.__HIDDEN__ = null; }
    if (knob === 'ao') { fx.aoOverride = false; e.quality = { ...e.quality, ssao: false }; }
    if (knob === 'dof') fx.settings.dofStrength = 0;
    if (knob === 'skyfx') fx.skyFxOn = false;
    if (knob === 'bloom') e.quality = { ...e.quality, bloom: false };
    if (knob === 'shadow') for (const l of window.__SUNS__) l.castShadow = false;
    if (knob === 'scene') {
      // 「主场景一趟本身值多少」：把 Garden 整棵树藏掉，只剩天与地。
      const hidden = [];
      const garden = e.scene.getObjectByName('Garden');
      if (garden) { garden.visible = false; hidden.push(garden); }
      window.__HIDDEN__ = hidden;
    }
    fx.applyQuality(e.quality);
    return knob;
  };
  await page.evaluate(() => {
    const e = window.__GAME__.engine;
    window.__DOF0__ = e.postfx.settings.dofStrength;
    window.__SUNS__ = [];
    e.scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) window.__SUNS__.push(o); });
    window.__HIDDEN__ = null;
  });

  const ablation = {};
  for (const shot of selected) {
    await page.evaluate(SETTLE, shot);
    ablation[shot.id] = {};
    for (const knob of Object.keys(KNOBS)) {
      await page.evaluate(APPLY, knob);
      await page.evaluate(WAIT, 24);
      await page.evaluate(async (n) => {
        const r = window.__GAME__.engine.renderer;
        await new Promise((res) => { let i = 0; const s = () => (++i >= n ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); });
        await r.resolveTimestampsAsync('render');
        r.backend.timestampQueryPool.render.timestamps.clear();
      }, args.framesPerRound);
      const totals = [];
      for (let k = 0; k < args.rounds; k++) {
        totals.push(await page.evaluate(async (n) => {
          const r = window.__GAME__.engine.renderer;
          await new Promise((res) => { let i = 0; const s = () => (++i >= n ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); });
          await r.resolveTimestampsAsync('render');
          const pool = r.backend.timestampQueryPool.render;
          const byFrame = new Map();
          for (const [uid, ms] of pool.timestamps) {
            const f = Number(String(uid).split(':f')[1]);
            byFrame.set(f, (byFrame.get(f) ?? 0) + ms);
          }
          pool.timestamps.clear();
          const v = [...byFrame.values()].sort((a, b) => a - b);
          return v.length ? v[Math.floor(v.length / 2)] : 0;
        }, args.framesPerRound));
      }
      const m = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const fps = await page.evaluate(() => Math.round(window.__GAME__.engine.fps));
      ablation[shot.id][knob] = { gpuMs: m(totals), fps };
    }
    await page.evaluate(APPLY, 'base');
    const base = ablation[shot.id].base.gpuMs;
    console.log(`\n== 消融 ${shot.id}  (整帧 GPU 基线 ${base.toFixed(2)} ms)`);
    for (const [knob, v] of Object.entries(ablation[shot.id])) {
      if (knob === 'base') continue;
      console.log(`  拆掉 ${knob.padEnd(7)} → ${v.gpuMs.toFixed(2).padStart(6)} ms  (省 ${(base - v.gpuMs).toFixed(2).padStart(6)} ms, ${((base - v.gpuMs) / base * 100).toFixed(1).padStart(5)}%)  fps ${v.fps}`);
    }
  }
  for (const id of Object.keys(ablation)) report[id].ablation = ablation[id];
}

if (args.out) {
  const out = resolve(ROOT, args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n写入 ${args.out}`);
}
await browser.close();
