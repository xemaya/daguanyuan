// tools/xiaoxiang-census.mjs — 潇湘馆竹夹路与甬路的判据尺子(单子 AL 验收 §22 转正,AL-b 用它验)。
//
//   node tools/xiaoxiang-census.mjs http://127.0.0.1:5177/garden.html
//
// 打一行 JSON:
//   bins    —— 院内 `bamboo.culm` 实例(节间段,不是竿)按「距 court-path 折线」分箱;
//   seg3m   —— z∈[100,119) 每 3 m 一段、路两侧(A/B = 折线左/右)距路 3 m 内的段数;
//   cuts    —— 折线每段中点取法向 ±1.5 m、步 0.02 m 采 `surfaceAt`,两侧最后一个 stone 的距离。
//              路牙内沿在中线外 0.70 m(`luya.ts` halfWidth+肩),cuts 与 0.70 之差就是草缝 / 压牙。
// 路轴与院墙多边形都从 plan.json 读,改了路不用改这里。
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://127.0.0.1:5173/garden.html';
const plan = JSON.parse(readFileSync(resolve(ROOT, 'projects/daguanyuan/plan.json'), 'utf8'));
const path = plan.paths.find((p) => p.id === 'xiaoxiangguan.court-path').points;
const region = plan.regions.find((r) => r.id === 'xiaoxiangguan').polygon;
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 800, height: 450 } });
await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 200000 });
const out = await pg.evaluate(({ path }) => {
  const g = window.__GAME__, T = g.THREE, names = {}, culm = [];
  const m = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
  g.world.root.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const base = o.name.replace(/@.*/, '');
    if (/amboo/i.test(base)) {
      names[base] = (names[base] || 0) + o.count;
      if (/culm/i.test(base)) { o.updateWorldMatrix(true, false);
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); m.decompose(p, q, s); culm.push([p.x, p.y, p.z]); } }
    }
  });
  // 横切:每段中点,法向 ±1.5 m,步 0.02
  const surf = (x, z) => g.world.ctx.collision.surfaceAt(x, z);
  const cuts = [];
  for (let i = 1; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, L = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / L, nz = (bx - ax) / L;
    const edge = (sg) => { let last = 0; for (let t = 0; t <= 1.5; t += 0.02) { if (surf(mx + nx * t * sg, mz + nz * t * sg) === 'stone') last = t; else if (t > 0.1) break; } return +last.toFixed(2); };
    cuts.push({ at: [+mx.toFixed(2), +mz.toFixed(2)], left: edge(1), right: edge(-1) });
  }
  return { names, culm, cuts };
}, { path });
await b.close();
const inside = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (x, z) => { let best = 1e9, side = 0; for (let i = 0; i < path.length - 1; i++) { const [ax, az] = path[i], [bx, bz] = path[i + 1]; const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t)); const px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz); if (d < best) { best = d; side = Math.sign(dx * (z - az) - dz * (x - ax)); } } return [best, side]; };
const inC = out.culm.filter((c) => inside(region, c[0], c[2]));
const bins = { '0-1.5': 0, '1.5-3': 0, '3-5': 0, '5-8': 0, '>8': 0 };
const seg = {};
for (const [x, , z] of inC) { const [d, sd] = segDist(x, z); bins[d < 1.5 ? '0-1.5' : d < 3 ? '1.5-3' : d < 5 ? '3-5' : d < 8 ? '5-8' : '>8']++;
  if (d < 3 && z >= 100 && z < 119) { const k = Math.floor((z - 100) / 3) * 3 + 100; seg[k] = seg[k] || { A: 0, B: 0 }; seg[k][sd > 0 ? 'A' : 'B']++; } }
console.log(JSON.stringify({ names: out.names, culmInRegion: inC.length, culmAll: out.culm.length, zRange: [Math.min(...inC.map((c) => c[2])).toFixed(1), Math.max(...inC.map((c) => c[2])).toFixed(1)], bins, seg3m: seg, cuts: out.cuts }, ));
