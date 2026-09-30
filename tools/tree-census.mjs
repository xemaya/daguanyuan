// tools/tree-census.mjs — 数一座山上有几棵树、几株灌木、离每组峰多近。
//
// 用法:node tools/tree-census.mjs --url http://127.0.0.1:5177/garden.html
//        [--hill hill.cuizhang] [--ridge 202] [--json] [--dump <file>]
//   --ridge  「山脊在哪」的 z,只影响最后那行「脊南 / 脊北」的分法(缺省 202)。
//   --json   只吐那一行 JSON,不吐散文——给脚本与回报用,免得靠 tail/grep 去捞。
//   --dump   把全园每棵树/每株灌木的实例位置(种、x、z、scaleY,四位小数)写成
//            一份排序过的 JSON。单子 AV-b1 的判据 diff 用它:改散布算法前后各
//            dump 一份,「翠嶂之外一棵不动」就是两份 dump 相减为空。
//
// 从跑着的世界里把 Trunk_* / Bush_* 的实例矩阵全解出来(与 tools/shot-list.mjs
// `mound_west` 注释里那次手工普查同一路数),按 plan.json 的山体多边形分内外,
// 再按 scenes/<区>.json 里 baishi 各组的世界坐标量六米内的树。这是
// knowledge/docs/scenes/cuizhang.md §5 / §7 的判据脚本:数字从这里来,不从回报来。
// 2026-09-17 从验收人的 scratch 脚本转正(单子 AV5)。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { url: 'http://127.0.0.1:5173/garden.html', hill: 'hill.cuizhang', ridge: 202, json: false, dump: null };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
  else if (process.argv[i] === '--hill') args.hill = process.argv[++i];
  else if (process.argv[i] === '--ridge') args.ridge = Number(process.argv[++i]);
  else if (process.argv[i] === '--dump') args.dump = process.argv[++i];
  else if (process.argv[i] === '--json') args.json = true;
}
if (!Number.isFinite(args.ridge)) { console.error('--ridge 需要一个数'); process.exit(2); }
/** 散文行走这里;`--json` 下全部闭嘴,只留最后那行 JSON。 */
const say = args.json ? () => {} : (...a) => console.log(...a);

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
// 「峰」与「石脚」要分开(单子 AV5)。判据说的是「任一组**峰**南侧 6 m 内的树」——
// 那一条问的是「有没有树挡在门与峰之间」。AV4 之后 scenes 里还多了一档 `skirt*`:
// 半埋的矮岩板,露头一米出头、宽三四米,它挡不住任何视线,却正好摆在峰脚朝门那一侧。
// 把它算成「峰」会让判据在任何合理的布局下都失败(峰脚前想种任何东西都不行),
// 那是判据被工具改写,不是布局出了问题。所以 skirt 照样列出来、照样数近旁的树,
// **但不计入 peakSouth6m**;它在判据写下的时候还不存在。
const isPeak = (v) => /^(group|peak)/.test(v ?? '');
const groups = [];
for (const n of scene.named ?? []) if (n.part === 'baishi' && anchors.has(n.object)) groups.push({ tag: `${n.variant}(named)`, peak: isPeak(n.variant), at: anchors.get(n.object) });
for (const p of scene.placements ?? []) if (p.part === 'baishi' && anchors.has(p.anchor)) {
  const a = anchors.get(p.anchor);
  groups.push({ tag: p.variant, peak: isPeak(p.variant), at: [a[0] + (p.dx ?? 0), a[1] + (p.dz ?? 0)] });
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 150000 });
const data = await page.evaluate(() => {
  const g = window.__GAME__, T = g.THREE, out = { trees: [], bushes: [], named: {}, dump: { trees: [], bushes: [] } };
  const m = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
  g.world.root.traverse((o) => {
    if (o.isInstancedMesh && /^Trunk_|^Bush_/.test(o.name)) {
      o.updateWorldMatrix(true, false);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); m.decompose(p, q, s);
        (o.name.startsWith('Trunk') ? out.trees : out.bushes).push([o.name.replace(/^(Trunk|Bush)_/, ''), +p.x.toFixed(1), +p.z.toFixed(1), +s.y.toFixed(2)]);
        // --dump 用全精度:判据说「一棵不动」,0.1m 的四舍五入会把两棵不同的树压成同一个键。
        (o.name.startsWith('Trunk') ? out.dump.trees : out.dump.bushes).push([o.name.replace(/^(Trunk|Bush)_/, '').replace(/@.*/, ''), +p.x.toFixed(4), +p.z.toFixed(4), +s.y.toFixed(4)]);
      }
    }
    if (/Wisteria|Moss_patches/.test(o.name)) out.named[o.name] = { count: o.count ?? 1 };
    // ⚠️ 实例被 ClusteredInstancePool 按空间格切成 `名字@格号` 的多个 mesh,
    // 所以「藤萝几根」不能按单一名字取——单子 AV3 落地时就在这儿读出过 0,
    // 而世界里实有 18 根。按前缀累加。
  });
  return out;
});
await browser.close();

if (args.dump) {
  // 排序后写盘:同一园子两次 dump 才能逐行 diff;键 = 种 + 位置 + 体量。
  for (const k of ['trees', 'bushes']) data.dump[k].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  writeFileSync(args.dump, JSON.stringify(data.dump, null, 1));
  say(`dumped ${data.dump.trees.length} trees / ${data.dump.bushes.length} bushes -> ${args.dump}`);
}

const poly = hill.polygon;
const onHill = data.trees.filter((t) => inside(poly, t[1], t[2]));
const bushOnHill = data.bushes.filter((b) => inside(poly, b[1], b[2]));
const bySp = {};
for (const t of onHill) bySp[t[0].replace(/@.*/, '')] = (bySp[t[0].replace(/@.*/, '')] || 0) + 1;
const sumNamed = (re) => Object.entries(data.named).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v.count, 0);
say(`trees total ${data.trees.length}, on ${args.hill} ${onHill.length}  ${JSON.stringify(bySp)}`);
say(`bushes total ${data.bushes.length}, on hill ${bushOnHill.length}`);
say(`named: ${JSON.stringify(data.named)}`);
say(`wisteria 合计 ${sumNamed(/^Wisteria/)} 根、moss 贴片合计 ${sumNamed(/^Moss_patches/)} 片(按名字前缀累加,实例被空间分格切成多个 mesh)`);
// 世界 +Z 朝南:门在 z=236,峰在 z≈202,「峰南侧」= z 比峰大 = 挡在门与峰之间。
let southViolations = 0;
for (const grp of groups) {
  const near = data.trees.filter((t) => Math.hypot(t[1] - grp.at[0], t[2] - grp.at[1]) < 6);
  const south = near.filter((t) => t[2] > grp.at[1]);
  if (grp.peak) southViolations += south.length;
  say(`${grp.peak ? '峰' : '脚'} ${grp.tag} @(${grp.at[0].toFixed(1)},${grp.at[1].toFixed(1)}): 6m 内 ${near.length} 棵, 其中南侧(挡门) ${south.length}${grp.peak ? '' : '(石脚,不计判据)'}  ` + near.map((t) => `${t[0].replace(/@.*/, '')}(${t[1]},${t[2]}) d=${Math.hypot(t[1] - grp.at[0], t[2] - grp.at[1]).toFixed(1)}`).join(' | '));
}
const ridgeZ = args.ridge;
say(`on-hill trees south of ridge z>${ridgeZ} (between gate and ridge): ${onHill.filter((t) => t[2] > ridgeZ).length}, north: ${onHill.filter((t) => t[2] <= ridgeZ).length}`);
console.log(JSON.stringify({
  hill: args.hill,
  ridge: ridgeZ,
  treesTotal: data.trees.length,
  treesOnHill: onHill.length,
  treesBySpecies: bySp,
  bushesTotal: data.bushes.length,
  bushesOnHill: bushOnHill.length,
  peakSouth6m: southViolations,
  wisteria: sumNamed(/^Wisteria/),
  mossPatches: sumNamed(/^Moss_patches/),
}));
