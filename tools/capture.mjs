#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
/**
 * capture.mjs — deterministic screenshot harness for visual QA.
 *
 * Boots the game in headless Chromium with real GPU rasterisation, drives the
 * camera to a set of fixed shot positions, waits for the frame to settle, and
 * writes PNGs. Every visual review in this project reads these files, so the
 * shot list is the contract: same camera, same time of day, same seed, every
 * run. A change in a screenshot means a change in the art, never in the tool.
 *
 * Usage:
 *   node tools/capture.mjs                       # all shots -> shots/
 *   node tools/capture.mjs --shots exterior_wide,lab_door
 *   node tools/capture.mjs --out shots/round3 --width 1920 --height 1080
 *   node tools/capture.mjs --list
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * The shot list.
 *
 * `pos` is the player's feet position; the harness adds eye height. `yaw` is
 * radians, 0 = facing -Z. `pitch` positive looks up. These are chosen to cover
 * every surface a reviewer needs to judge: silhouettes, material response,
 * shadow contact, foliage density, and the two hero moments (town reveal and
 * the starter table).
 */
/*
 * P1 Task 6: coordinates moved to plan.json's coordinate system. Each shot's
 * old position is translated by its cluster's delta (same four constants as
 * `composer.ts`'s D_ZHENGMEN/D_CUIZHANG/D_QINFANG/D_XIAOXIANG) — this is a
 * pure translation, not a re-composition, so yaw/pitch (the framing angle)
 * are kept as-authored; only `grass_close`/`treeline` (which had no single
 * obvious anchor to follow) were re-picked to an equivalent dry spot in the
 * new window rather than mechanically translated.
 *   zhengmen bbox   x[15,95]    z[222,244]
 *   cuizhang bbox   x[-60,76]   z[184,220]
 *   qinfang bbox    x[-55,40]   z[116,178]  (南池 water centred ~(-4,148))
 *   xiaoxiang bbox  x[-145,-65] z[58,125]
 * Yaw convention: forward = (-sin(yaw), 0, -cos(yaw)). yaw 0 faces -Z (north).
 */
const SHOTS = [
  { id: 'gate_approach', pos: [57.4, 0, 245.1],  yaw: 0.08,  pitch: -0.02, desc: '园外南望正门——入园前的建立镜头。' },
  { id: 'mound_block',   pos: [8, 0, 208.5],  yaw: 0.0,   pitch: 0.04,  desc: '刚进门,翠嶂假山迎面挡住视线(曲径通幽)。' },
  { id: 'mound_west',    pos: [3.6, 0, 201], yaw: -0.9,  pitch: 0.02,  desc: '绕假山西侧,石壁近看。' },
  { id: 'pond_reveal',   pos: [-3.5, 0, 157.4], yaw: 0.15, pitch: -0.04, desc: '绕出假山豁然开朗:沁芳池与桥,全园第一眼。' },
  { id: 'bridge_mid',    pos: [-0.3, 0, 148.8], yaw: -0.4, pitch: -0.08, desc: '桥中望池面、驳岸、亭。' },
  { id: 'pond_north',    pos: [8, 0, 139.2], yaw: 2.6, pitch: 0.0,   desc: '池北岸(引桥尽头)回望亭桥与假山——反向建立镜头。' },
  { id: 'xiaoxiang',     pos: [-111.2, 0, 104.0], yaw: -0.62, pitch: 0.05, desc: '潇湘馆:进了月洞门,竹院与小三间。' },
  { id: 'moon_gate',     pos: [-105, 0, 122.4], yaw: 0.0,  pitch: 0.02, desc: 'plan月洞门南侧2.4m望内院；P2墙路径接入后跟随真实门位。' },
  { id: 'gate_plaque',   pos: [55, 0, 242.6],   yaw: 0.0,  pitch: 0.12, desc: '门前人视高抬头看「大观园」匾与开着的门。' },
  { id: 'ting_plaque',   pos: [-2.7, 0, 156.8], yaw: -0.30, pitch: 0.10, desc: '桥头人视高看沁芳亭正面匾。' },
  { id: 'bridge_head',   pos: [-4.5, 0, 159.0], yaw: -0.15, pitch: -0.25, desc: '南引桥头:桥阶与地面的接缝。' },
  { id: 'grass_close',   pos: [4.0, 0, 200.0], yaw: 0.35, pitch: -0.58, desc: '低头看地面材质与接地。' },
  { id: 'treeline',      pos: [-45, 0, 170.0], yaw: 1.10, pitch: 0.14, desc: '窗口边缘的林带与天(本窗口不是真墙,见 TERRAIN.playMinX 等阻挡体)。' },
  { id: 'backlit',       pos: [-0.9, 0, 154.4],    yaw: -2.57, pitch: 0.20,  desc: '逆光——bloom 与轮廓光。' },
  { id: 'creek_flow',    pos: [-2, 0, 195],     yaw: -0.38, pitch: -0.15, desc: 'PQ着色半新增：沁芳溪南段岸边顺流望——溪要流、池要静，肉眼一眼能分。' },
  /* 单子 AD · 第四档「贴脸机位」。上面这些机位全是全景，鼓钉、瓦当、格心
   * 纹样在 1600×900 里是两个像素——等于不存在。下面五个各盯一个关键部位，
   * 评审一个回合只看它们加一张联络表(tools/shoot-part.mjs --sheet)，
   * 不看 14 张全景。带 group 的机位默认不拍，用 --group closeup 单独取。 */
  { id: 'cu_gate_eave',    pos: [55, 0, 241.6],   yaw: 0.0,   pitch: 0.60,  group: 'closeup', desc: '贴脸·正门檐口:瓦当滴水与椽望的收头(用户反馈5「瓦与木架分层、无瓦当滴水」;单子 AJ3 重瞄到真檐口)。' },
  { id: 'cu_gate_plaque',  pos: [55, 0, 239.4],   yaw: 0.0,   pitch: 0.30,  group: 'closeup', desc: '贴脸·大观园匾:匾宽与当心间的关系(用户反馈10;第五档断言的取证机位)。' },
  { id: 'cu_baogushi',     pos: [53.3, 0, 238.4], yaw: -0.92, pitch: -0.28, group: 'closeup', desc: '贴脸·抱鼓石:须弥座/祥云托/鼓面螺旋纹与跨门槛落位(用户反馈1;单子 AJ2 改三段形制、鼓轴左右向)。' },
  { id: 'cu_wall_seam',    pos: [68.0, 0, 239.0], yaw: 1.35,  pitch: -0.08, group: 'closeup', desc: '贴脸·南墙接缝:六段粉墙相接处的墙脚与压顶(用户反馈3;名册侧接缝门报这里互插0.16~0.22m)。' },
  { id: 'cu_terrace',      pos: [58.5, 0, 246.8], yaw: 0.28,  pitch: -0.38, group: 'closeup', desc: '贴脸·白石台矶:石作分层(土衬/陡板/阶条/面层)与砌缝(用户反馈「大白平台质感差」;单子 AJ1)。' },
  { id: 'cu_lattice',      pos: [62.0, 0, 238.4], yaw: 1.35,  pitch: 0.06,  group: 'closeup', desc: '贴脸·格心:灯笼锦的纹样构成(用户反馈2「窗花粗糙」)。' },
  // 单子 AP:灯笼锦工艺样板的三视补位——正面看纹样收头与主辅比例,背光看框边对纸面的遮光。
  { id: 'cu_lattice_front',  pos: [62.0, 0, 240.6], yaw: 0.0,   pitch: 0.05,  group: 'closeup', desc: '贴脸·格心正面:正对次间窗,看灯笼锦完整纹样、边界收头与留白(单子 AP)。' },
  { id: 'cu_lattice_inside', pos: [62.0, 0, 236.0], yaw: 3.14,  pitch: 0.05,  group: 'closeup', desc: '贴脸·格心背光:门内朝南看同一扇窗,纸面退后后框边对纸面的遮光(单子 AP;不许给窗加私灯)。' },
];

/**
 * Named staging routines, evaluated inside the page.
 * Keeping them here rather than in the game keeps the shot list self-contained.
 */
const STAGES = {
  all_released: () => {
    const dbg = window.__GAME__.world.root.userData.starterDebug;
    if (!dbg) return 'no starterDebug';
    for (let i = 0; i < 3; i++) dbg.setRelease(i, 1);
    return 'released 3';
  },
};

/**
 * Runs before every shot.
 *
 * The lab's ambient intro fires whenever the camera comes within 2.8m of the
 * starter table, which is exactly where the interior shots are framed — so
 * without this the dialogue panel covers the bottom third of the three hero
 * shots and stays open into the next one. Reviewers need to see the room and
 * the creatures; the dialogue has its own shot.
 */
const CLEAR_DIALOGUE = () => {
  const hud = window.__GAME__.hud;
  if (hud && hud.dialogue && hud.dialogue.isOpen) hud.dialogue.close();
};

function parseArgs(argv) {
  const args = { out: 'shots', width: 1600, height: 900, shots: null, group: null, url: 'http://127.0.0.1:5173/garden.html', settle: 1400 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--width') args.width = Number(argv[++i]);
    else if (a === '--height') args.height = Number(argv[++i]);
    else if (a === '--shots') args.shots = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--settle') args.settle = Number(argv[++i]);
    else if (a === '--group') args.group = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.list) {
  for (const s of SHOTS) console.log(`${s.id.padEnd(16)} ${s.desc}`);
  process.exit(0);
}

const outDir = resolve(ROOT, args.out);
mkdirSync(outDir, { recursive: true });

let selected = args.shots ? SHOTS.filter((s) => args.shots.includes(s.id)) : SHOTS;
// 分组机位默认不进全景轮换：不带 --shots / --group 时，行为与单子 AD 之前完全一致。
if (args.group) selected = selected.filter((s) => s.group === args.group);
else if (!args.shots) selected = selected.filter((s) => !s.group);
if (selected.length === 0) {
  console.error(`No shots matched: ${args.shots?.join(',')}`);
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  args: [
    // Real GPU rasterisation in headless. Without these the WebGL context
    // either fails outright or falls back to a software path whose output
    // does not match what a player sees.
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-gpu',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-frame-rate-limit',
    '--force-device-scale-factor=1',
  ],
});

const page = await browser.newPage({
  viewport: { width: args.width, height: args.height },
  deviceScaleFactor: 1,
});

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.error(msg.text().slice(0,1200)); }
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

console.log(`> ${args.url}`);
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Wait for the game to publish its handle, or surface the boot error.
// NOTE: options are waitForFunction's THIRD argument — passed second they land
// in the `arg` slot and the default 30s timeout applies, which the ~40s world
// build now exceeds.
const ready = await page
  .waitForFunction(
    () => window.__GAME__ !== undefined || document.querySelector('#app pre') !== null,
    null,
    { timeout: 150000 },
  )
  .then(() => true)
  .catch(() => false);

if (!ready) {
  console.error('TIMEOUT: game never became ready.');
  console.error(consoleErrors.slice(0, 20).join('\n'));
  await browser.close();
  process.exit(2);
}

const bootError = await page.evaluate(() => {
  const pre = document.querySelector('#app pre');
  return pre ? pre.textContent : null;
});
if (bootError) {
  console.error('BOOT ERROR:\n' + bootError);
  await browser.close();
  process.exit(3);
}

// Let texture bakes, shader compiles and the first shadow update finish.
await page.waitForTimeout(args.settle);

async function freezeGame() {
await page.evaluate(() => {
  const e = window.__GAME__.engine;
  e.adaptiveResolution = false;
  e.fixedTime = 10;
  e.governResolution = () => {};
  const world = window.__GAME__.world;
  const update = world.update.bind(world);
  world.update = (dt) => { world.ctx.env.windTime.value = 10 - dt; update(dt,10); };
  e.renderer.setPixelRatio(1);
  e.postfx.setSize(innerWidth, innerHeight);
});
}
await freezeGame();

/**
 * Warms up every pipeline the selected shots will need.
 *
 * WebGPU compiles render pipelines lazily, on first use of a given
 * material/geometry/blend-mode combination. `capture.mjs` used to teleport
 * straight into each shot and read `engine.fps` a dozen frames later — if
 * that shot was the first to bring a given material into view, the
 * compile stall landed inside the fps window and the manifest recorded a
 * one-off number (e.g. 8fps) that had nothing to do with sustained
 * rendering — after warmup, shots that read wildly low now sit in the
 * same steady-state band as their neighbours.
 * Doing one dry, unmeasured pass over the exact same positions first pays
 * that one-time compile cost before any fps number is read.
 */
const warmupStart = Date.now();
for (const shot of selected) {
  await page.evaluate(
    ({ pos, yaw, pitch }) => {
      const g = window.__GAME__;
      const T = g.THREE;
      g.player.teleport(new T.Vector3(pos[0], pos[1], pos[2]), yaw);
      g.player.state.pitch = pitch;
      g.player.update(1 / 60);
      g.player.update(1 / 60);
    },
    shot,
  );
  await page.evaluate(
    () => new Promise((res) => { let n = 0; const s = () => (++n >= 8 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }),
  );
}
const warmupMs = Date.now() - warmupStart;
console.log(`> warmed up ${selected.length} shot(s) in ${warmupMs}ms`);

const manifest = [];

/** Waits until the game handle exists again after a reload. */
async function waitForGame(timeout = 90000) {
  await page.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout });
  await freezeGame();
  await page.waitForTimeout(args.settle);
}

/**
 * Captures one shot.
 *
 * Retries on "Execution context was destroyed": Vite hot-reloads the page
 * whenever a source file changes, and several agents edit sources while
 * captures are running. Without this the harness fails spuriously and a
 * reviewer reads it as a broken build.
 */
async function captureShot(shot, attempt = 0) {
  try {
    await page.evaluate(
      ({ pos, yaw, pitch }) => {
        const g = window.__GAME__;
        const T = g.THREE;
        g.player.teleport(new T.Vector3(pos[0], pos[1], pos[2]), yaw);
        g.player.state.pitch = pitch;
        // Two manual updates: one to apply the transform, one to let any
        // per-frame smoothing settle onto the new pose.
        g.player.update(1 / 60);
        g.player.update(1 / 60);
      },
      shot,
    );

    if (shot.stage && STAGES[shot.stage]) {
      // Settle BEFORE staging. A teleport into the lab lands the player at the
      // interior floor height, but the outdoor ground sampler clamps them back
      // up until the interior's own tick notices and claims them — so staging
      // on the same frame as the teleport posed the scene while the camera was
      // still outdoors, and the shot came back empty.
      await page.evaluate(
        () => new Promise((res) => { let n = 0; const s = () => (++n >= 14 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }),
      );

      const staged = await page.evaluate(STAGES[shot.stage]);
      if (typeof staged === 'string' && staged.startsWith('no ')) {
        console.log(`    (stage ${shot.stage}: ${staged})`);
      }
      // The release animation drives creature scale from its target, so give
      // it a few more frames to settle into the posed state before grabbing.
      await page.evaluate(
        () => new Promise((res) => { let n = 0; const s = () => (++n >= 10 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }),
      );
    }

    // Render several frames so temporal effects (SMAA history, adaptive
    // resolution, wind phase) reach steady state before the grab.
    await page.evaluate(
      () =>
        new Promise((res) => {
          let n = 0;
          const step = () => (++n >= 12 ? res() : requestAnimationFrame(step));
          requestAnimationFrame(step);
        }),
    );
    // Dismiss last, after the proximity trigger has had its frames to fire.
    await page.evaluate(CLEAR_DIALOGUE);
    await page.waitForTimeout(220);

    const buf = await page.screenshot({ type: 'png' });
    writeFileSync(resolve(outDir, `${shot.id}.png`), buf);

    const stats = await page.evaluate(() => {
      const g = window.__GAME__;
      const info = g.engine.renderer.info;
      return {
        fps: Math.round(g.engine.fps),
        drawCalls: info.render.drawCalls ?? info.render.calls,
        renderer: g.engine.backend ?? 'webgl-legacy',
        statisticsVersion: g.engine.statisticsVersion ?? 1,
        statisticsScope: g.engine.statisticsVersion ? 'all-frame-submissions' : 'shadow-plus-main',
        triangles: info.render.triangles,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
        programs: info.memory.programs ?? info.programs?.length ?? null,
        sceneSubmissions: g.engine.postfx.sceneStats,
        frameSubmissions: g.engine.postfx.frameStats,
      };
    });

    manifest.push({ ...shot, file: `${args.out}/${shot.id}.png`, stats });
    console.log(
      `  ${shot.id.padEnd(16)} ${stats.drawCalls} calls  ${(stats.triangles / 1000).toFixed(0)}k tris  ${stats.fps} fps`,
    );
  } catch (err) {
    const reloaded = /Execution context was destroyed|Target closed|detached/i.test(String(err));
    if (reloaded && attempt < 3) {
      console.log(`    (page reloaded mid-shot, retrying ${shot.id})`);
      await waitForGame();
      return captureShot(shot, attempt + 1);
    }
    throw err;
  }
}

for (const shot of selected) {
  await captureShot(shot);
}

const constructions = await page.evaluate(() =>
  window.__GAME__.engine.scene.getObjectByName('Garden')?.userData.constructions ?? []);
// 单子 AD · 第一档对账：世界自报建成了哪几个区，对账门拿它当分母，不另抄一份区名。
const builtRegions = await page.evaluate(() =>
  window.__GAME__.engine.scene.getObjectByName('Garden')?.userData.builtRegions ?? []);
// 单子 AA:地面精度(CELL / cm per texel / 窗口 / 顶点数)由世界自报,门拿它比。
const terrain = await page.evaluate(() =>
  window.__GAME__.engine.scene.getObjectByName('Terrain')?.userData.resolution ?? null);
const rendering = await page.evaluate(() => {
  const e = window.__GAME__.engine;
  return { backend: e.backend ?? 'webgl-legacy', statisticsVersion: e.statisticsVersion ?? 1,
    viewport: [innerWidth,innerHeight], pixelRatio: e.renderer.getPixelRatio(), quality: e.quality.name,
    fixedTime: e.fixedTime, adaptiveResolution: e.adaptiveResolution, bootTimings: window.__GAME__.bootTimings };
});
rendering.warmupMs = warmupMs;
rendering.fpsMethodology = 'measured after a dry warmup pass over the same shots, so lazy pipeline-compile stalls (WebGPU) land before any fps read, not inside it';
const buildMs = await page.evaluate(() => window.__GAME__.world.buildDurationMs);
const linears = await page.evaluate(() => window.__GAME__.engine.scene.getObjectByName('Garden')?.userData.linears ?? []);
const entry=resolve(ROOT,'artifacts/wg-current/dist/garden.html');
const source={gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
  buildEntrySha256:existsSync(entry)?createHash('sha256').update(readFileSync(entry)).digest('hex'):null,
  buildMtime:existsSync(entry)?statSync(entry).mtime.toISOString():null};
const geometry=await page.evaluate(async()=>{
 const hash=async array=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(array.buffer,array.byteOffset,array.byteLength)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const seen=new Set(), geometries=[],transforms=[];let meshes=0,instances=0;
 window.__GAME__.engine.scene.updateMatrixWorld(true);
 const pending=[];
 window.__GAME__.engine.scene.traverse(o=>{
  if(!o.isMesh)return;meshes++;
  const g=o.geometry;
  if(!seen.has(g)){seen.add(g);pending.push((async()=>{const pos=g.attributes.position.array;geometries.push({vertices:g.attributes.position.count,indices:g.index?.count??0,position:await hash(pos),index:g.index?await hash(g.index.array):null})})())}
  const matrices=[];
  if(o.isInstancedMesh){const a=o.instanceMatrix.array;instances+=a.length/16;for(let i=0;i<a.length;i+=16)matrices.push(Array.from(a.slice(i,i+16)).join(','));matrices.sort()}
  transforms.push(JSON.stringify({name:o.name,world:o.matrixWorld.elements,matrices}));
 });
 await Promise.all(pending);geometries.sort((a,b)=>a.position.localeCompare(b.position));transforms.sort();
 const encoded=new TextEncoder().encode(JSON.stringify({geometries,transforms}));
 return{meshes,uniqueGeometries:geometries.length,instanceCapacity:instances,geometryAndTransformsSha256:await hash(encoded)};
});
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify({ source, shots: manifest, consoleErrors, constructions, builtRegions, terrain, linears, buildMs, rendering, geometry }, null, 2));
if(rendering.statisticsVersion>=2){const expected=new URL(args.url).searchParams.get('backend')==='webgl2'?'webgl2':'webgpu';if(rendering.backend!==expected){console.error(`Expected ${expected}, received ${rendering.backend}`);process.exitCode=1}}


if (consoleErrors.length) {
  console.log(`\n${consoleErrors.length} console error(s):`);
  console.log(consoleErrors.slice(0, 15).map((e) => '  ' + e).join('\n'));
}

await browser.close();
console.log(`\nWrote ${manifest.length} shot(s) to ${args.out}/`);

if (consoleErrors.length) process.exitCode = 1;
