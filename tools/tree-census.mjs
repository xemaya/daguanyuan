// tools/tree-census.mjs — 数一座山上有几棵树、几株灌木、离每组峰多近。
//
// 用法:node tools/tree-census.mjs --url http://127.0.0.1:5177/garden.html [--hill hill.cuizhang]
//
// 从跑着的世界里把 Trunk_* / Bush_* 的实例矩阵全解出来(与 tools/shot-list.mjs
// `mound_west` 注释里那次手工普查同一路数),按 plan.json 的山体多边形分内外,
// 再按 scenes/<区>.json 里 baishi 各组的世界坐标量六米内的树。这是
// knowledge/docs/scenes/cuizhang.md §5 / §7 的判据脚本:数字从这里来,不从回报来。
// 2026-09-17 从验收人的 scratch 脚本转正(单子 AV5)。
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { url: 'http://127.0.0.1:5173/garden.html', hill: 'hill.cuizhang' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
  else if (process.argv[i] === '--hill') args.hill = process.argv[++i];
}

const plan = JSON.parse(readFileSync(resolve(ROOT, 'projects/daguanyuan/plan.json'), 'utf8'));
const hill = plan.hills.find((h) => h.id === args.hill);
if (!hill) { console.error(`no hill ${args.hill}`); process.exit(2); }
const regionId = args.hill.replace(/^hill\./, '');
const scene = JSON.parse(readFileSync(resolve(ROOT, `projects/daguanyuan/scenes/${regionId}.json`), 'utf8'));

function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// 峰组:named 里绑 baishi 的锚点 + placements 里的 baishi 件(锚点 + dx/dz)。
const anchors = new Map();
for (const r of plan.regions) for (const k of r.rocks ?? []) anchors.set(k.id, [k.x, k.z]);
const groups = [];
for (const n of scene.named ?? []) if (n.part === 'baishi' && anchors.has(n.object)) groups.push({ tag: `${n.variant}(named)`, at: anchors.get(n.object) });
for (const p of scene.placements ?? []) if (p.part === 'baishi' && anchors.has(p.anchor)) {
  const a = anchors.get(p.anchor);
  groups.push({ tag: p.variant, at: [a[0] + (p.dx ?? 0), a[1] + (p.dz ?? 0)] });
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 150000 });
const data = await page.evaluate(() => {
  const g = window.__GAME__, T = g.THREE, out = { trees: [], bushes: [], named: {} };
  const m = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
  g.world.root.traverse((o) => {
    if (o.isInstancedMesh && /^Trunk_|^Bush_/.test(o.name)) {
      o.updateWorldMatrix(true, false);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); m.decompose(p, q, s);
        (o.name.startsWith('Trunk') ? out.trees : out.bushes).push([o.name.replace(/^(Trunk|Bush)_/, ''), +p.x.toFixed(1), +p.z.toFixed(1), +s.y.toFixed(2)]);
      }
    }
    if (/Wisteria|Moss_patches/.test(o.name)) out.named[o.name] = { count: o.count ?? 1 };
  });
  return out;
});
await browser.close();

const poly = hill.polygon;
const onHill = data.trees.filter((t) => inside(poly, t[1], t[2]));
const bushOnHill = data.bushes.filter((b) => inside(poly, b[1], b[2]));
const bySp = {};
for (const t of onHill) bySp[t[0].replace(/@.*/, '')] = (bySp[t[0].replace(/@.*/, '')] || 0) + 1;
console.log(`trees total ${data.trees.length}, on ${args.hill} ${onHill.length}  ${JSON.stringify(bySp)}`);
console.log(`bushes total ${data.bushes.length}, on hill ${bushOnHill.length}`);
console.log(`named: ${JSON.stringify(data.named)}`);
// 世界 +Z 朝南:门在 z=236,峰在 z≈202,「峰南侧」= z 比峰大 = 挡在门与峰之间。
let southViolations = 0;
for (const grp of groups) {
  const near = data.trees.filter((t) => Math.hypot(t[1] - grp.at[0], t[2] - grp.at[1]) < 6);
  const south = near.filter((t) => t[2] > grp.at[1]);
  southViolations += south.length;
  console.log(`${grp.tag} @(${grp.at[0]},${grp.at[1]}): 6m 内 ${near.length} 棵, 其中南侧(挡门) ${south.length}  ` + near.map((t) => `${t[0].replace(/@.*/, '')}(${t[1]},${t[2]}) d=${Math.hypot(t[1] - grp.at[0], t[2] - grp.at[1]).toFixed(1)}`).join(' | '));
}
const ridgeZ = 202;
console.log(`on-hill trees south of ridge z>${ridgeZ} (between gate and ridge): ${onHill.filter((t) => t[2] > ridgeZ).length}, north: ${onHill.filter((t) => t[2] <= ridgeZ).length}`);
console.log(JSON.stringify({ treesOnHill: onHill.length, bushesOnHill: bushOnHill.length, peakSouth6m: southViolations, wisteria: data.named['Wisteria_cuizhang']?.count ?? 0 }));
