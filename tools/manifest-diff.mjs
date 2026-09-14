#!/usr/bin/env node
/**
 * manifest-diff.mjs — 比较两次截图的**结构**数字，以及拿 plan 对账世界清单。
 *
 * 为什么不用逐像素：场景里水面、竹叶、云一直在动，截图采到的动画相位每次都不同。
 * 实测同一份构建连拍两次，平均每像素差 7~17 个色阶、treeline 有 23% 的像素差超过
 * 24 阶——噪声底比任何有意义的阈值都高，逐像素在这里没有判别力。
 *
 * 而 draw calls / 三角数 / 几何数 / 材质数是确定性的：同样的场景图必然给出同样的数。
 * 骨架搬家时 builder/parts/index.ts 的 glob 没跟着改，构件全部登记失败，
 * 正是被 draw calls 从 180 掉到 80 抓出来的，逐像素反而淹没在噪声里。
 *
 * 但结构数字有一个结构性盲区：**它发现不了「少了一个东西」**。台矶哪天被谁删掉，
 * 三角数掉 3%，读起来像一次优化。所以单子 AD 加了两件事：
 *   - `--coverage`：plan 的对象全集 − 世界自报的清单，输出双向覆盖率表；
 *   - 两目录模式里的**名册比对**：同一个 part:variant 少了几个，直接报 LOST。
 *
 * 用法: node tools/manifest-diff.mjs <dirA> <dirB> [--tolerance 0]
 *       node tools/manifest-diff.mjs --coverage <dir>
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 单子 AD · 第一档对账：plan 的对象全集 − 世界自报的清单。
 *
 * 输出形态不是 pass/fail，是一张双向覆盖率表：
 *   - 已建成区内的 plan 对象必须 100% 有对应物体（缺一个就是红的）；
 *   - 未建区列为 known-gap，数量只许降不许升；
 *   - 世界里 planId=null 的构件单列为「野生件」——它们不是缺陷的反面，
 *     是「有实物、没出处」，正门那六段粉墙就在这一栏（它们该是
 *     zhengmen.flanking-wall 一个对象，现在是六个野生 wall）。
 *
 * 纯函数，不碰 IO，好让 tests/world-roster.test.mjs 直接喂假 manifest。
 */
export function coverage(plan, manifest) {
  const builtRegions = manifest.builtRegions ?? [];
  const objectsOf = (r) => [...(r.buildings ?? []), ...(r.rocks ?? []), ...(r.linears ?? [])].map((o) => o.id);
  const built = new Set(builtRegions);
  const roster = manifest.constructions ?? [];
  // 一个 plan 对象算「有对应物体」的条件：任一登记条目的 planId / id / variant 命中它。
  const claimed = new Set();
  for (const rec of roster) {
    for (const key of [rec.planId, rec.id, rec.variant]) if (key) claimed.add(key);
  }
  // 身份传递：同一个东西在 plan 里可能有两份记录，别把它算成缺项。
  //   ① 线性构件的 inserts[].object——月洞门是院墙上的一个开口,不是独立摆件;
  //   ② buildings[] 里 layout.stage==='model-reference' 的条目,它的实体就是
  //      layout.linearIds 指的那几条线性构件(潇湘馆游廊 = west-corridor-path)。
  // 这是身份建模,不是放松判据：两边都没建出来时它照样红(见
  // tests/world-roster.test.mjs 的「身份传递不许过度吸收」)。
  for (const region of plan.regions) {
    for (const l of region.linears ?? []) {
      if (!claimed.has(l.id)) continue;
      for (const ins of l.inserts ?? []) if (ins.object) claimed.add(ins.object);
    }
  }
  for (const region of plan.regions) {
    for (const o of region.buildings ?? []) {
      const ids = o.layout?.stage === 'model-reference' ? o.layout.linearIds ?? [] : [];
      if (ids.length && ids.every((id) => claimed.has(id))) claimed.add(o.id);
    }
  }
  const missing = [];
  let total = 0;
  let knownGaps = 0;
  for (const region of plan.regions) {
    const ids = objectsOf(region);
    if (!built.has(region.id)) { knownGaps += ids.length; continue; }
    total += ids.length;
    for (const id of ids) if (!claimed.has(id)) missing.push(id);
  }
  const feral = roster
    .filter((r) => !r.planId)
    .map((r) => ({ id: r.id, part: r.part, variant: r.variant, position: r.position }));
  return { builtRegions, built: { total, covered: total - missing.length, missing }, feral, knownGaps };
}

const loadManifest = (d) => JSON.parse(readFileSync(join(resolve(d), 'manifest.json'), 'utf8'));

/* 下面是 CLI。用 import.meta.url 守住，好让测试只 import coverage 而不触发退出。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const covIdx = process.argv.indexOf('--coverage');
  const tolArg = process.argv.indexOf('--tolerance');
  const TOL = tolArg > -1 ? Number(process.argv[tolArg + 1]) : 0;

  if (covIdx > -1) {
    const dir = positional[0];
    if (!dir) { console.error('用法: node tools/manifest-diff.mjs --coverage <dir>'); process.exit(2); }
    const plan = JSON.parse(readFileSync(resolve('projects/daguanyuan/plan.json'), 'utf8'));
    const c = coverage(plan, loadManifest(dir));
    const baselinePath = resolve('projects/daguanyuan/coverage-baseline.json');
    const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;

    console.log(`建成区 ${c.builtRegions.join(', ') || '(世界没报，manifest 是旧的？)'}`);
    console.log(`\n已建成区覆盖率  ${c.built.covered}/${c.built.total}`);
    for (const id of c.built.missing) console.log(`  缺  ${id}`);
    console.log(`\n野生件(有实物、无 plan 出处)  ${c.feral.length}`);
    for (const f of c.feral) console.log(`  野  ${`${f.part}:${f.variant}`.padEnd(26)} @ ${(f.position ?? []).map((v) => Number(v).toFixed(1)).join(', ')}`);
    console.log(`\nknown-gap(未建区的 plan 对象)  ${c.knownGaps}`);

    let bad = 0;
    if (c.built.missing.length) { console.log(`\nFAIL 已建成区内有 ${c.built.missing.length} 个 plan 对象在世界里没有对应物体`); bad++; }
    if (baseline && c.knownGaps > baseline.knownGaps) { console.log(`FAIL known-gap 从 ${baseline.knownGaps} 涨到 ${c.knownGaps}——未建区对象数只许降不许升`); bad++; }
    if (baseline && c.feral.length > baseline.feral) { console.log(`FAIL 野生件从 ${baseline.feral} 涨到 ${c.feral.length}`); bad++; }
    process.exit(bad ? 1 : 0);
  }

  const [dirA, dirB] = positional;
  if (!dirA || !dirB) {
    console.error('用法: node tools/manifest-diff.mjs <dirA> <dirB> [--tolerance 0]\n      node tools/manifest-diff.mjs --coverage <dir>');
    process.exit(2);
  }

  const load = (d) => new Map(loadManifest(d).shots.map((s) => [s.id, s]));
  const A = load(dirA);
  const B = load(dirB);

  /** fps 随机器负载浮动，不比。其余四项是场景图的函数，必须一致。 */
  const FIELDS = ['drawCalls', 'triangles', 'geometries', 'textures'];

  let bad = 0;
  for (const [id, a] of A) {
    const b = B.get(id);
    if (!b) {
      console.log(`MISSING ${id}（${dirB} 里没有这一镜）`);
      bad++;
      continue;
    }
    const diffs = FIELDS.filter((f) => {
      const x = a.stats[f];
      const y = b.stats[f];
      return TOL === 0 ? x !== y : Math.abs(x - y) / Math.max(1, y) > TOL;
    });
    if (diffs.length) {
      bad++;
      console.log(`DIFF ${id}`);
      for (const f of diffs) console.log(`       ${f}: ${a.stats[f]} vs ${b.stats[f]}`);
    } else {
      console.log(`ok   ${id.padEnd(16)} ${a.stats.drawCalls} calls  ${(a.stats.triangles / 1000) | 0}k tris`);
    }
  }
  for (const id of B.keys()) if (!A.has(id)) { console.log(`EXTRA ${id}（只在 ${dirB} 里）`); bad++; }

  /* 单子 AD · 第一档：名册也要比。三角数掉 3% 读起来像一次优化，
   * 但那可能是台矶被谁删掉了——结构数字发现不了「少了一个东西」。 */
  const rosterOf = (d) => {
    const m = new Map();
    for (const r of loadManifest(d).constructions ?? []) {
      const key = `${r.part ?? '?'}:${r.variant ?? '?'}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };
  const RA = rosterOf(dirA);
  const RB = rosterOf(dirB);
  for (const [key, n] of RA) {
    const m = RB.get(key) ?? 0;
    if (m < n) { console.log(`LOST  ${key}  ${n} → ${m}（少了 ${n - m} 个物体）`); bad++; }
    else if (m > n) console.log(`GAIN  ${key}  ${n} → ${m}`);
  }
  for (const [key, n] of RB) if (!RA.has(key)) console.log(`NEW   ${key}  0 → ${n}`);
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  console.log(`名册 ${sum(RA)} → ${sum(RB)} 件`);

  console.log(`\n${A.size} 镜，${bad} 处结构不一致`);
  process.exit(bad ? 1 : 0);
}
