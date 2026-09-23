#!/usr/bin/env node
/**
 * frustum-census.mjs — 按「顶层类别 × 远近」数视锥里的三角。单子 AX 的尺子。
 *
 * **为什么需要它**：`capture.mjs` 只给每镜三角总数，答不了「涨的是地形、植被还是房子，
 * 是脚下的还是 200 m 外的」。WORKFLOW §5 第 3 条：归因要 A/B 按视锥逐类数，不要推理。
 * 2026-09-23 扩区复测就是靠它看出 19 区 `gate_approach` 多出来的三角大头是
 * **120 m 外的地形**（1.73M），不是房子。
 *
 * 口径：`world.root` 的直接子节点是类别（Terrain / Vegetation / Garden / Sea …）；
 * 可见 mesh 的包围球与相机视锥相交就算进来（与 three 的视锥剔除同一判据，
 * 不含阴影 pass）；InstancedMesh 按 count 乘；`far` = 包围球心水平距离 > `--far` 米。
 * 它是 CPU 侧的估数，与 `capture.mjs` 的 renderer 读数口径不同，**只拿来前后同口径比**。
 *
 * 用法：
 *   node tools/frustum-census.mjs --url http://127.0.0.1:5311/garden.html \
 *        [--shots gate_approach,xiaoxiang] [--far 120] [--out shots/ax/census.json]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SHOTS } from './shot-list.mjs';

const opt = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const url = opt('--url', 'http://127.0.0.1:5173/garden.html');
const ids = opt('--shots', 'gate_approach,mound_block,grass_close,xiaoxiang').split(',');
const far = Number(opt('--far', '120'));
const out = opt('--out', null);
const shots = ids.map(id => SHOTS.find(s => s.id === id) ?? (() => { throw new Error(`没有机位 ${id}`); })());

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // 19 区建时近一分钟，给足。
  await page.waitForFunction(() => window.__GAME__ || document.querySelector('#app pre'), null, { timeout: 540000 });
  if (await page.locator('#app pre').count()) throw new Error(await page.locator('#app pre').textContent());
  const report = { url, far, buildMs: await page.evaluate(() => window.__GAME__.world.buildDurationMs), shots: {} };
  for (const s of shots) {
    report.shots[s.id] = await page.evaluate(({ s, far }) => {
      const g = window.__GAME__, T = g.THREE, root = g.world.root;
      g.player.teleport(new T.Vector3(...s.pos), s.yaw); g.player.state.pitch = s.pitch;
      g.player.update(1 / 60); g.player.update(1 / 60);
      const cam = g.engine.camera; cam.updateMatrixWorld(true);
      const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const sph = new T.Sphere(), cats = {};
      root.traverseVisible(o => {
        if (!o.isMesh || !o.geometry) return;
        const geo = o.geometry;
        let top = o; while (top.parent && top.parent !== root) top = top.parent;
        const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
        if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); sph.copy(o.boundingSphere); }
        else { if (!geo.boundingSphere) geo.computeBoundingSphere(); sph.copy(geo.boundingSphere); }
        sph.applyMatrix4(o.matrixWorld);
        if (o.frustumCulled !== false && !fr.intersectsSphere(sph)) return;
        const c = cats[top.name || top.type] ??= { meshes: 0, tris: 0, farTris: 0 };
        c.meshes++; c.tris += tris;
        if (Math.hypot(sph.center.x - cam.position.x, sph.center.z - cam.position.z) > far) c.farTris += tris;
      });
      for (const c of Object.values(cats)) { c.tris = Math.round(c.tris); c.farTris = Math.round(c.farTris); }
      return cats;
    }, { s, far });
  }
  console.log(`buildMs ${Math.round(report.buildMs)}  (far = >${far} m)`);
  for (const [id, cats] of Object.entries(report.shots)) {
    console.log(`== ${id}`);
    for (const [k, c] of Object.entries(cats).sort((a, b) => b[1].tris - a[1].tris))
      console.log(`  ${k.padEnd(12)} ${String(c.meshes).padStart(4)} meshes  ${(c.tris / 1e3).toFixed(0).padStart(6)}k tris  ${(c.farTris / 1e3).toFixed(0).padStart(6)}k far`);
  }
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2)); }
} finally { await browser.close(); }
