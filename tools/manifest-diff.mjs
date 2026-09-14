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

/**
 * 单子 AD · 第三档「接缝连续性」的世界名册那一侧。
 *
 * connection-audit.mjs 的 auditSeams 只看 plan 的线性构件——而正门那六段粉墙
 * 根本不在 plan 里(它们是对账门报出的野生件)，所以纯 plan 的扫描从定义上
 * 看不见 spec §2⑥ 第三档点名的那个案例。这是同一个病的另一面：门只查数据，
 * 查不到世界里真正摆出来的东西。
 *
 * 这里补上：把名册里同一类、同朝向、同标高的构件按轴向排成链，量相邻两件
 * 的端到端间距。size 是构件本地包围盒(composer 量的)，yaw 给出它的走向。
 *
 * 判据与出处：
 *   - 间距 > 0.15m 报「缝」：一块城砖长边的一半，站在墙前看得见的漏光；
 *   - 间距 < -0.15m 报「叠」：两段互相插进去 15cm 以上，不是收分是穿模；
 *   - 标高差 > 0.05m 报：压顶是一条连续线。
 * 不做「该不该连成一条」的判断——只对已经排成一列的相邻件发问。
 */
const CHAIN_GAP_TOL = 0.15;
const CHAIN_ELEV_TOL = 0.05;
/** 只有细长件才谈得上「一段段拼起来」。实测各构件长厚比：
 *    wall 10.1~13.6 | bridge:zigzag 3.2 | bamboo 1.1 | taihu 0.9~1.4
 *  5:1 把墙与散置件分干净，也排掉 z 形曲桥——它相邻两折本来就按设计重叠，
 *  桥自己的验收在 auditConnections(净宽、越界、切入建筑)，不归这道门。
 *  ⚠️ 这个数是用来分类的，不是阈值。不许为了让门变绿去调它。 */
const CHAIN_MIN_ASPECT = 5;

export function auditRosterSeams(roster) {
  const chains = new Map();
  for (const r of roster ?? []) {
    if (!r.size || !r.position) continue;
    if (r.size[0] / Math.max(1e-3, r.size[2]) < CHAIN_MIN_ASPECT) continue;
    const yaw = Number(r.yaw ?? 0);
    // 同一类、同朝向(16 分之一圈为一档)的构件归一条链。
    const key = `${r.part}|${Math.round(yaw / (Math.PI / 8))}`;
    if (!chains.has(key)) chains.set(key, []);
    chains.get(key).push({ ...r, yaw });
  }
  const seams = [], fails = [];
  for (const [key, items] of chains) {
    if (items.length < 2) continue;
    const yaw = items[0].yaw;
    // 构件的长边在本地 X 上；世界里它的走向是 (cos yaw, -sin yaw)。
    const ux = Math.cos(yaw), uz = -Math.sin(yaw);
    const along = (p) => p.position[0] * ux + p.position[2] * uz;
    const sorted = [...items].sort((a, b) => along(a) - along(b));
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const gap = (along(b) - b.size[0] / 2) - (along(a) + a.size[0] / 2);
      // 只对「排在一条线上」的相邻件发问：横向偏移超过半个身位的不是同一道墙。
      const lateral = Math.abs((b.position[0] - a.position[0]) * -uz + (b.position[2] - a.position[2]) * ux);
      if (lateral > 0.5) continue;
      if (gap > 6) continue; // 隔了半条街，不是一道墙上的两段
      const dElev = Math.abs(a.position[1] - b.position[1]);
      seams.push({ chain: key, a: a.id, b: b.id, gap, dElev, lateral });
      if (gap > CHAIN_GAP_TOL) fails.push(`${a.part} ${a.variant}→${b.variant} 之间有 ${gap.toFixed(2)}m 的缝（@ x≈${a.position[0].toFixed(1)}, z≈${a.position[2].toFixed(1)}）`);
      else if (gap < -CHAIN_GAP_TOL) fails.push(`${a.part} ${a.variant}→${b.variant} 互相插入 ${(-gap).toFixed(2)}m（@ x≈${a.position[0].toFixed(1)}, z≈${a.position[2].toFixed(1)}）`);
      if (dElev > CHAIN_ELEV_TOL) fails.push(`${a.part} ${a.variant}→${b.variant} 标高差 ${dElev.toFixed(3)}m（@ x≈${a.position[0].toFixed(1)}）`);
    }
  }
  return { seams, fails };
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

    const rs = auditRosterSeams(loadManifest(dir).constructions);
    console.log(`\n接缝(名册侧，成链构件 ${rs.seams.length} 对)  ${rs.fails.length} 处`);
    for (const f of rs.fails) console.log(`  缝  ${f}`);

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
