#!/usr/bin/env node
/**
 * profile-toggle.mjs — 单子 AZ z0 的尺子：按 mesh 名前缀逐项关掉，量每项的帧成本与三角。
 *
 * **为什么需要它**：`capture.mjs` 只告诉你一镜多少三角、多少毫秒，答不了「贵在哪一层」。
 * 竹子 `xiaoxiang` 331 万三角 44 fps，比 424 万三角的 `gate_approach` 还慢——三角可能不是病，
 * 5.6 万张 alpha 裁剪叶卡的片元开销才是嫌疑。只有逐项关掉再量，才分得清。
 *
 * **它怎么量**：启动、冻结、预热与 `capture.mjs` 同一套（`fixedTime`、关自适应分辨率、
 * 空转到连续 20 帧无停顿），计时也是同一个口径——`frameLimit` 抬开后 `postfx.render`
 * 两次返回之间的间隔，90 帧取中位数（`frameCostMs`）。每个开关：先还原、再施加、
 * 空转 12 帧、再量。每镜首尾各量一次「全开」，两次差就是这一镜的噪声底。
 *
 * **开关**（`--knobs` 可选子集，默认按单子 AZ 的五项 + 基线）：
 *   none    什么都不关（基线，首尾各一次）
 *   <前缀>  名字以它开头的 mesh `visible = false`（主 pass 与阴影 pass 一起没了）
 *   <前缀>:shadow  名字以它开头的 mesh `castShadow = false`（只去阴影 pass；本项目是 PCF，
 *           不是 VSM，关投影真的出阴影图——VSM 下接收者也会进阴影图，见 instancing.ts 注）
 *   `+` 连多个：`bamboo.:shadow+tree.:shadow`
 * **单子 BC0 追加的三个限定**（都可省；顺序 `[组/]前缀[>米|<米][#x0~z0~x1~z1][:shadow]`）：
 *   `组/`   只在 `world.root` 的这个顶层组里找（`Garden/` 里合批件没有名字，前缀留空即全组）
 *   `>120`  只动包围球心离相机水平距离 > 120 m 的 mesh（`<` 反之）——分远近量
 *   `#x0~z0~x1~z1`  只动包围球心落在这个矩形里的 mesh（按区量，如稻香村；用 `~` 分隔，因为 `--knobs` 本身按逗号切）
 *   例：`Vegetation/Canopy_>120+Vegetation/Leaves_>120`、`Garden/#-235~-105~-160~-2`
 * **默认不改世界**：每个开关量完就还原，最后一次「全开」是还原后的对账。
 *
 * 用法：
 *   node tools/profile-toggle.mjs --url http://127.0.0.1:5181/garden.html \
 *        --shots xiaoxiang,moon_gate,xx_court_gaze,gate_approach \
 *        --knobs none,bamboo.leaf,bamboo.branch,bamboo.culm,bamboo.:shadow,bamboo. \
 *        --out shots/AZ/z0-profile.json
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOTS } from './shot-list.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DEFAULT_KNOBS = ['none', 'bamboo.leaf', 'bamboo.branch', 'bamboo.culm', 'bamboo.:shadow', 'bamboo.'];

function parseArgs(argv) {
  const a = { url: 'http://127.0.0.1:5173/garden.html', shots: ['xiaoxiang'], knobs: DEFAULT_KNOBS, out: null, width: 1600, height: 900, frames: 90, repeat: 1 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--url') a.url = argv[++i];
    else if (k === '--shots') a.shots = argv[++i].split(',').map((s) => s.trim());
    else if (k === '--knobs') a.knobs = argv[++i].split(',').map((s) => s.trim());
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--frames') a.frames = Number(argv[++i]);
    else if (k === '--repeat') a.repeat = Number(argv[++i]);
    else if (k === '--width') a.width = Number(argv[++i]);
    else if (k === '--height') a.height = Number(argv[++i]);
  }
  return a;
}
const args = parseArgs(process.argv);
const selected = args.shots.map((id) => SHOTS.find((s) => s.id === id)).filter(Boolean);
if (selected.length !== args.shots.length) { console.error(`没有这些机位: ${args.shots.join(',')}`); process.exit(1); }

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-frame-rate-limit', '--force-device-scale-factor=1'],
});
const page = await browser.newPage({ viewport: { width: args.width, height: args.height }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

console.log(`> ${args.url}`);
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__GAME__ !== undefined || document.querySelector('#app pre') !== null, null, { timeout: 180000 });
const bootError = await page.evaluate(() => document.querySelector('#app pre')?.textContent ?? null);
if (bootError) { console.error('BOOT ERROR:\n' + bootError); await browser.close(); process.exit(3); }
await page.waitForTimeout(1400);

// 与 capture.mjs freezeGame 同一套。
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

const SETTLE = ({ pos, yaw, pitch }) => {
  const g = window.__GAME__;
  g.player.teleport(new g.THREE.Vector3(pos[0], pos[1], pos[2]), yaw);
  g.player.state.pitch = pitch;
  let stable = 0, last = g.player.state.position.y;
  for (let i = 0; i < 120 && stable < 5; i++) {
    g.player.update(1 / 60);
    const y = g.player.state.position.y;
    stable = Math.abs(y - last) < 1e-4 ? stable + 1 : 0;
    last = y;
  }
  g.player.state.pitch = pitch;
};
const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const s = () => (++k >= n ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }), n);

// 预热：走一遍机位，再空转到连续 20 帧无 >40ms 停顿。
for (const s of selected) { await page.evaluate(SETTLE, s); await frames(8); }
await page.evaluate(async () => {
  const t0 = performance.now(); let quiet = 0, last = performance.now();
  while (quiet < 20 && performance.now() - t0 < 4000) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now(); quiet = now - last > 40 ? 0 : quiet + 1; last = now;
  }
});

/** 施加 / 还原一个开关。还原靠第一次施加时存下的原值，所以永远回得到作者的状态。 */
const APPLY = (knob) => {
  const scene = window.__GAME__.engine.scene;
  const saved = (window.__TOGGLE_SAVED__ ??= new Map());
  // 先还原上一个开关。
  for (const [o, s] of saved) { o.visible = s.visible; o.castShadow = s.castShadow; o.layers.mask = s.layers; }
  if (knob === 'none') return { touched: 0 };
  let touched = 0, tris = 0;
  const g = window.__GAME__, T = g.THREE, cam = g.engine.camera.getWorldPosition(new T.Vector3());
  for (const part of knob.split('+')) {
    const [spec, mode] = part.split(':');
    const m = spec.match(/^(?:([^/]+)\/)?([^<>#]*)(?:([<>])([\d.]+))?(?:#([-\d.~]+))?$/);
    if (!m) throw new Error(`看不懂的开关 ${part}`);
    const [, group, prefix, cmp, dist, rect] = m;
    const root = group ? g.world.root.getObjectByName(group) : scene;
    if (!root) throw new Error(`没有顶层组 ${group}`);
    const box = rect ? rect.split('~').map(Number) : null;
    const where = (o) => {
      if (!cmp && !box) return true;
      const bs = o.boundingSphere ?? (o.geometry.boundingSphere ?? (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere));
      const c = bs.center.clone().applyMatrix4(o.matrixWorld);
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (cmp === '>' && !(d > Number(dist))) return false;
      if (cmp === '<' && !(d < Number(dist))) return false;
      if (box && !(c.x >= box[0] && c.z >= box[1] && c.x <= box[2] && c.z <= box[3])) return false;
      return true;
    };
    root.traverse((o) => {
      if (!o.isMesh || !o.name.startsWith(prefix) || !where(o)) return;
      if (!saved.has(o)) saved.set(o, { visible: o.visible, castShadow: o.castShadow, layers: o.layers.mask });
      touched++;
      const idx = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
      tris += (idx / 3) * (o.isInstancedMesh ? o.count : 1);
      if (mode === 'shadow') o.castShadow = false;
      // BC0:关可见改走 layers——植被簇(ClusteredInstancePool)每帧按距离重写 `visible`,
      // 写 visible 会被下一帧覆盖回来;layers 置 0 主相机与阴影相机都看不见,剔除器不碰它。
      else o.layers.mask = 0;
    });
  }
  return { touched, trisAuthored: tris };
};

const MEASURE = async (n) => {
  const e = window.__GAME__.engine;
  const med = (a) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : 0; };
  const prev = e.frameLimit;
  e.frameLimit = 10000;
  const gaps = [];
  const pr = e.postfx.render.bind(e.postfx);
  let last = performance.now();
  e.postfx.render = (dt) => { pr(dt); const t1 = performance.now(); gaps.push(t1 - last); last = t1; };
  await new Promise((res) => { let k = 0; const s = () => (++k >= n ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); });
  e.postfx.render = pr;
  e.frameLimit = prev;
  const info = e.renderer.info;
  return { frameCostMs: Number(med(gaps.slice(2)).toFixed(3)), triangles: info.render.triangles, drawCalls: info.render.drawCalls ?? info.render.calls };
};

const results = [];
for (const shot of selected) {
  await page.evaluate(SETTLE, shot);
  await frames(12);
  const order = ['none', ...args.knobs.filter((k) => k !== 'none'), 'none'];
  const rows = [];
  for (let r = 0; r < args.repeat; r++) {
    for (const [i, knob] of order.entries()) {
      const t = await page.evaluate(APPLY, knob);
      await frames(12);
      const m = await page.evaluate(MEASURE, args.frames);
      const label = knob === 'none' ? (i === 0 ? 'none(首)' : 'none(尾)') : knob;
      rows.push({ knob: label, round: r, ...t, ...m });
    }
  }
  await page.evaluate(APPLY, 'none');
  // 汇总：同一 knob 多轮取中位，Δ 对「首尾两次全开的中位」算。
  const med = (a) => { const v = [...a].sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  const labels = [...new Set(rows.map((r) => r.knob))];
  const agg = labels.map((k) => {
    const rs = rows.filter((r) => r.knob === k);
    return { knob: k, frameCostMs: med(rs.map((r) => r.frameCostMs)), triangles: med(rs.map((r) => r.triangles)), drawCalls: med(rs.map((r) => r.drawCalls)), touched: rs[0].touched };
  });
  const base = agg.filter((a) => a.knob.startsWith('none'));
  const baseMs = (base[0].frameCostMs + base[base.length - 1].frameCostMs) / 2;
  const baseTris = base[0].triangles;
  console.log(`\n${shot.id}  全开 ${base.map((b) => b.frameCostMs.toFixed(2)).join(' / ')} ms  ${(baseTris / 1000).toFixed(0)}k tris`);
  for (const a of agg) {
    if (a.knob.startsWith('none')) continue;
    a.dMs = Number((a.frameCostMs - baseMs).toFixed(3));
    a.dTris = a.triangles - baseTris;
    console.log(`  关 ${a.knob.padEnd(18)} ${a.frameCostMs.toFixed(2)} ms (Δ ${a.dMs >= 0 ? '+' : ''}${a.dMs.toFixed(2)})  ${(a.triangles / 1000).toFixed(0)}k tris (Δ ${(a.dTris / 1000).toFixed(0)}k)  calls ${a.drawCalls}  [${a.touched} mesh]`);
  }
  results.push({ shot: shot.id, baseMs: Number(baseMs.toFixed(3)), baseTris, rows, agg });
}

if (args.out) {
  const out = resolve(ROOT, args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ url: args.url, frames: args.frames, repeat: args.repeat, knobs: args.knobs, results, errors }, null, 2));
  console.log(`\n写入 ${args.out}`);
}
if (errors.length) console.log(`\n${errors.length} console error(s):\n  ` + errors.slice(0, 10).join('\n  '));
await browser.close();
