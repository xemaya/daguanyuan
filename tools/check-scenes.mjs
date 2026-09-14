#!/usr/bin/env node
/**
 * check-scenes.mjs — 落位清单契约门（单子 Y，接缝 ①）。
 *
 * 跑的是 builder/compose/scenes.ts 的 validateScenes——与运行时同一份判据，
 * 命令行与游戏里不许有两套说法。
 *
 *   node tools/check-scenes.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import '../tests/ts-resolver.mjs';
const { validateScenes } = await import('../builder/compose/scenes.ts');
const { SCATTER_RULES, ruleCoverage, validateRules } = await import('../builder/compose/scatter-rules.ts');
const { buildOccupancy } = await import('../builder/compose/occupancy.ts');

const dir = resolve('projects/daguanyuan/scenes');
const plan = JSON.parse(readFileSync(resolve('projects/daguanyuan/plan.json'), 'utf8'));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
const scenes = files.map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')));

const fails = [...validateScenes(scenes, plan), ...validateRules()];
for (const f of fails) console.error(`失败：${f}`);

for (const s of scenes) {
  const n = (s.named ?? []).length, p = (s.placements ?? []).length, sc = (s.scatters ?? []).length;
  console.log(`${s.region.padEnd(20)} 点名绑定 ${String(n).padStart(2)}  散置落位 ${String(p).padStart(2)}  散布规则 ${String(sc).padStart(2)}`);
}
/* 单子 Z · 接缝 ③:手写的落位也要读占位场。
 *
 * 散布器已经读它了(composer 的 scatterPlacements),但 `placements[]` 是人写的,
 * 不该被代码偷偷挪走——所以这里只报不改。抓的是「石头站在台基上」「竹子进屋」
 * 这一类:锚点算出来的世界坐标落在建筑檐口外包络里。
 * buildOccupancy 是纯函数(只吃 plan + scenes),所以这道检查不用起浏览器。
 *
 * ⚠️ 它现在就是红的。红的留着——挪一块石头是观感决定,不是机器该替人做的。 */
const built = scenes.map((s) => s.region);
/* 只拿**建筑**的檐口外包络发问，不拿 clearances：
 *   - clearances 是「这块地不散布」，不是「这块地不许有东西」。潇湘馆院内那块
 *     净空存在的理由就是留给点名竹，竹落进去是本意不是冲突；
 *   - 建筑占位才是「不该有别的东西」的那种占位。
 * 所以这里喂一份剥掉 clearances 的 scenes。 */
const field = buildOccupancy(plan, built, scenes.map((s) => ({ ...s, clearances: [] })));
/* 深度门槛 0.3m：墙与建筑在檐口下相接本来就会咬进出檐几厘米，那是接头不是
 * 穿模（实测正门两侧粉墙各咬进 0.05m）。0.3m 以上才是「站进去了」。
 * ⚠️ 这个数是用来分「接头」和「穿模」的，不是用来把门调绿的。 */
const INTRUDE_TOL = 0.3;
const anchorXZ = new Map();
for (const r of plan.regions)
  for (const o of [...(r.buildings ?? []), ...(r.rocks ?? [])]) anchorXZ.set(o.id, [o.x, o.z]);
const intruders = [];
for (const scene of scenes)
  for (const pl of scene.placements ?? []) {
    const a = anchorXZ.get(pl.anchor);
    if (!a) continue;
    const [x, z] = [a[0] + pl.dx, a[1] + pl.dz];
    const d = field.distance(x, z);
    if (d < -INTRUDE_TOL) intruders.push({ region: scene.region, pl, x, z, d });
  }
console.log(`\n手写落位与占位场的冲突  ${intruders.length} 处`);
for (const i of intruders)
  console.log(`  撞  ${i.region}/${i.pl.part}:${i.pl.variant ?? 'default'} 陷进占位 ${(-i.d).toFixed(2)}m（@ ${i.x.toFixed(1)}, ${i.z.toFixed(1)}，锚 ${i.pl.anchor}）`);

/* 目标 2 的判据(spec §0)：**新做一个构件，不去任何一张表里逐区手写，就有区
 * 吃到；`check:scenes` 能当场列出它会出现在哪几个区。** 下面这张表就是那句话。
 * 建成区用 ✓ 标出来——没建的区先记着，建到那儿自然吃到。 */
const builtSet = new Set(built);
console.log('\n选料规则会落到哪几个区（✓ = 已建成区，现在就吃得到）');
for (const { rule, regions } of ruleCoverage(plan.regions)) {
  const shown = regions.map((r) => (builtSet.has(r) ? `${r}✓` : r));
  console.log(`  ${rule.id.padEnd(12)} ${rule.part}${rule.variant ? ':' + rule.variant : ''}`);
  console.log(`    ${regions.length}/${plan.regions.length} 区：${shown.join(' ') || '(一个都不落)'}`);
}

console.log(`\n${files.length} 份落位清单、${SCATTER_RULES.length} 条选料规则，${fails.length} 项不合契约。`);
process.exit(fails.length ? 1 : 0);
