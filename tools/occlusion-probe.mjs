#!/usr/bin/env node
/**
 * occlusion-probe.mjs — 翠嶂挡住了多少射线，数出来，不靠「我看着是挡住了」。
 *
 * ## 这是尺子，不是门（2026-09-16 起）
 *
 * **它曾经是单子 AM2 的硬数值判据（≥97%），那条判据已经退休。**
 * 见 `docs/superpowers/plans/2026-09-15-am-cuizhang-rebuild.md`「验收裁定·裁定一」：
 * AM2 把山从 212 m×11 m 收到 135 m×4 m 之后实测只挡住 **40.89%**；进一步测出
 * 就算把整个新多边形（x∈[−55,80]）填满实心石料到顶，**天花板也只有 91.90%**——
 * 探针的 94° 视场在山脊距离处横向覆盖到 x≈91.5，而山体东边只到 x=80，
 * **97% 在这个多边形宽度下物理上够不到**，与峰群摆得多密无关。判据本身设错了。
 *
 * 「一进门看不到全景」这句话真正落数的地方是 `plan.json` `experience` 的 **`X-01`**
 * （`assert: 'ray'`，三个具名目标：沁芳亭 / 滴翠亭 / 潇湘馆正房），它焊在
 * `check:experience` 里，是门。这个脚本留下来干另一件事：**给后续单子当一把一致的尺子**
 * ——谁再动这座山（加峰、改轮廓、改高程），跑一遍，和 40.89% 这个基准比，
 * 数字往哪边走、漏在哪个方位，一眼看得出。
 *
 * 所以它**默认只报数、不判 PASS/FAIL、退出码恒为 0**。真要当门用（比如某个单子
 * 自己立一条「不得低于 X%」的回归线），显式给 `--threshold <百分数>`。
 * 非零退出码只留给**工具本身坏了**：读不到 plan、场景里一个 baishi 落位都没有等等。
 *
 * 07-03 里贾政那句「非此一山，一進來園中所有之景悉入目中，則有何趣」仍是这座山存在的
 * 全部理由；cuizhang.md §5 把「该多高多宽」算成了一条遮挡断言的解，这个脚本是那条
 * 断言的**度量器**——只是「合格线画在哪」不再由它说了算。
 *
 * ## 只读
 *
 * 纯 Node，不起浏览器、不起 dev server、不写任何文件、不碰任何世界状态。读三样东西：
 *   1. `projects/daguanyuan/plan.json`  → `makeTerrainField()` 的高程场（含 hill.cuizhang 的贡献）
 *   2. `projects/daguanyuan/scenes/<region>.json` → `named[]`/`placements[]` 里所有 `part:"baishi"` 的落位
 *   3. `builder/parts/shishan/baishi.ts` 的 `buildBaishiGeometry()` → 每组峰**自己的真实包络**
 *
 * 第 3 条是这个脚本最容易被做假的地方：包络必须是构件几何自己的 bounding box，
 * 不许手填一个大盒子——一个看不见的巨盒能把任何遮挡率刷到 100%。所以这里
 * 一个数都不从 JSON 读包络，全部现场从几何量（和 scenes 的 clearances 同源同口径）。
 *
 * ## 判法
 *
 * 视点 (55,236)，眼高 3.17 m = zhengmen 区标高 0.8 + 台基 0.75 + `EYE_HEIGHT` 1.62
 * （`engine/player/PlayerController.ts`）。水平方位 −47°…+47°、1° 步（94° = fovBase 62
 * 竖向 @16:9 的水平视场，cuizhang.md §5），俯仰 0°…+6°、0.5° 步 → 95×13 = 1235 条。
 *
 * 每条射线从眼点沿方向步进，**在越过 z = 184（山北边界，「山北」）之前**只要
 * 射线高度落到地形高程之下、或进入任何一组峰的包络盒，就算挡住；一直走到 z ≤ 184
 * 都没挡住，就算漏。判据：**挡住 ≥ 97%**。
 *
 * 漏掉的射线逐条打出方位/俯仰，方便人一眼看出漏在哪个方向——一个百分比不够，
 * 得能顺着方向去看是不是该漏（比如东口「出接平坦宽阔大路」本来就是敞的）。
 * 现状记一笔：1235 条里漏 730 条，其中**眼高档（俯仰 ≤1°）的 57 条全部落在方位
 * +29°…+47°**，也就是东侧那一片——与 `check-plan.mjs` 约束 5 的 6→21 对得上，
 * 见裁定一末段。
 *
 * 用法：
 *   node --import ./tests/ts-resolver.mjs tools/occlusion-probe.mjs
 *   node --import ./tests/ts-resolver.mjs tools/occlusion-probe.mjs --json
 *   node --import ./tests/ts-resolver.mjs tools/occlusion-probe.mjs --threshold 40   # 显式当门用
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { makeTerrainField } = await import('../builder/compose/terrain-from-plan.ts');
const { SEED } = await import('../builder/compose/config.ts');
const { buildBaishiGeometry } = await import('../builder/parts/shishan/baishi.ts');

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const REGION = arg('--region', 'cuizhang');
const AS_JSON = process.argv.includes('--json');

/* ---- 判据常数。改这里等于改判据，不要在别处复制一份。 ---------------- */
const EYE = { x: 55, z: 236, y: 3.17 };
const YAW_DEG = { min: -47, max: 47, step: 1 };
const PITCH_DEG = { min: 0, max: 6, step: 0.5 };
const NORTH_EDGE_Z = 184; // 山北边界：射线越过它还没被挡住 = 漏
const MARCH_STEP = 0.2;   // 水平步长(m)
const MARCH_MAX = 160;    // 水平最长行程(m)，够从 z=236 斜着走出 z=184
/* 合格线：默认**没有**（这是尺子不是门，见文件头）。`--threshold <百分数>` 才立一条线，
 * 那是调用方自己立的回归线，不是本脚本的判据。退休的 97% 只作为历史注记留在文件头。 */
const THRESHOLD_PCT = (() => {
  if (!process.argv.includes('--threshold')) return null;
  const raw = arg('--threshold', undefined);
  // 给了 `--threshold` 却没给值,不许静默降级成「不设门」——那正好是调用方以为有门、
  // 实际没门的那种失败。
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 100) {
    console.error(`[occlusion-probe] --threshold 需要 0…100 的百分数，实际收到 ${raw}`);
    process.exit(2);
  }
  return v;
})();

/* ---- 读世界快照 ------------------------------------------------------ */
const plan = JSON.parse(readFileSync(resolve(ROOT, 'projects/daguanyuan/plan.json'), 'utf8'));
const scene = JSON.parse(readFileSync(resolve(ROOT, `projects/daguanyuan/scenes/${REGION}.json`), 'utf8'));
const field = makeTerrainField(plan, { seed: SEED });

/** plan 里某个区的锚点坐标（rocks/buildings/linears 与 composer 的 findAnchor 同源）。 */
function anchorXZ(regionId, objectId) {
  const r = plan.regions.find((x) => x.id === regionId);
  if (!r) throw new Error(`plan 里没有区 ${regionId}`);
  for (const key of ['rocks', 'buildings']) {
    const o = (r[key] ?? []).find((x) => x.id === objectId);
    if (o) return [o.x, o.z];
  }
  throw new Error(`区 ${regionId} 里没有锚点 ${objectId}`);
}

/**
 * 把 scenes 的落位编译成世界里的包络盒。
 *
 * 位置口径与 `builder/compose/composer.ts` 的 `resolvePosition()`/主循环一致：
 * 世界坐标 = 锚点 + (dx,dz)，落地高 y = ground(x,z) + (dy ?? 0)。
 * 包络取构件几何的 bounding box，按 yaw 绕 y 转后取水平 AABB（盒子只会变大不会变小，
 * 这个方向的近似是**保守的反面**——它会让遮挡率偏高，所以下面额外做了一次
 * 「真实旋转矩形」的精确判定，AABB 只用来做粗筛）。
 */
function peakBoxes() {
  const out = [];
  const add = (part, variant, anchor, dx = 0, dz = 0, yaw = 0, dy = 0, tag = '') => {
    if (part !== 'baishi') return;
    const g = buildBaishiGeometry(variant);
    g.geo.computeBoundingBox();
    const b = g.geo.boundingBox;
    const [ax, az] = anchorXZ(REGION, anchor);
    const x = ax + dx, z = az + dz;
    const baseY = field.height(x, z) + dy;
    out.push({
      tag: tag || `${part}:${variant}`,
      variant, x, z, yaw,
      peaks: g.stones.length,
      // 局部包络（未转），判定时把采样点反转回局部系再比，比转盒子准。
      lx0: b.min.x, lx1: b.max.x, lz0: b.min.z, lz1: b.max.z,
      y0: baseY, y1: baseY + b.max.y,
      // 粗筛半径：局部包络四角到原点的最大距离，与 yaw 无关。
      r: Math.max(Math.hypot(b.min.x, b.min.z), Math.hypot(b.min.x, b.max.z),
                  Math.hypot(b.max.x, b.min.z), Math.hypot(b.max.x, b.max.z)),
    });
  };
  for (const n of scene.named ?? []) add(n.part, n.variant, n.object, 0, 0, n.yaw ?? 0, n.dy ?? 0, n.tag);
  for (const p of scene.placements ?? []) add(p.part, p.variant, p.anchor, p.dx, p.dz, p.yaw ?? 0, p.dy ?? 0, p.tag);
  return out;
}

const boxes = peakBoxes();
if (!boxes.length) {
  console.error(`[occlusion-probe] scenes/${REGION}.json 里一个 baishi 落位都没有——这个脚本是给白石峰群用的`);
  process.exit(1);
}

function insideBox(b, x, y, z) {
  if (y < b.y0 || y > b.y1) return false;
  const dx = x - b.x, dz = z - b.z;
  if (dx * dx + dz * dz > b.r * b.r) return false; // 粗筛
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  // composer 的 yaw 是绕 +y 转；把世界点反转回构件局部系。
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return lx >= b.lx0 && lx <= b.lx1 && lz >= b.lz0 && lz <= b.lz1;
}

/* ---- 打射线 ---------------------------------------------------------- */
const rad = (d) => (d * Math.PI) / 180;
const rays = [];
for (let a = YAW_DEG.min; a <= YAW_DEG.max + 1e-9; a += YAW_DEG.step)
  for (let p = PITCH_DEG.min; p <= PITCH_DEG.max + 1e-9; p += PITCH_DEG.step)
    rays.push({ yaw: Math.round(a * 100) / 100, pitch: Math.round(p * 100) / 100 });

const leaks = [];
let blocked = 0;
let byTerrain = 0, byPeak = 0;

for (const ray of rays) {
  // 前向是 −z（穿门往园里走）；yaw>0 偏东(+x)，yaw<0 偏西(−x)。
  const dx = Math.sin(rad(ray.yaw));
  const dz = -Math.cos(rad(ray.yaw));
  const dy = Math.tan(rad(ray.pitch)); // 每 1 m 水平行程升高
  let hit = null;
  for (let t = MARCH_STEP; t <= MARCH_MAX; t += MARCH_STEP) {
    const x = EYE.x + dx * t;
    const z = EYE.z + dz * t;
    const y = EYE.y + dy * t;
    if (z <= NORTH_EDGE_Z) break; // 越过山北还没挡住 = 漏
    if (y < field.height(x, z)) { hit = 'terrain'; break; }
    for (const b of boxes) if (insideBox(b, x, y, z)) { hit = 'peak'; break; }
    if (hit) break;
  }
  if (hit) { blocked++; hit === 'terrain' ? byTerrain++ : byPeak++; }
  else leaks.push(ray);
}

const ratio = blocked / rays.length;
// 没给 --threshold 就没有「过不过」这回事——只报数。
const pass = THRESHOLD_PCT === null ? null : ratio * 100 >= THRESHOLD_PCT;

if (AS_JSON) {
  console.log(JSON.stringify({
    eye: EYE, yaw: YAW_DEG, pitch: PITCH_DEG, northEdgeZ: NORTH_EDGE_Z,
    rays: rays.length, blocked, byTerrain, byPeak,
    ratio, threshold: THRESHOLD_PCT === null ? null : THRESHOLD_PCT / 100, pass,
    boxes: boxes.map((b) => ({ tag: b.tag, variant: b.variant, peaks: b.peaks, x: b.x, z: b.z, yaw: b.yaw,
      y0: +b.y0.toFixed(3), y1: +b.y1.toFixed(3),
      hx: +((b.lx1 - b.lx0) / 2).toFixed(3), hz: +((b.lz1 - b.lz0) / 2).toFixed(3) })),
    leaks,
  }, null, 2));
} else {
  console.log(`视点 (${EYE.x},${EYE.z}) 眼高 ${EYE.y} m；方位 ${YAW_DEG.min}°…${YAW_DEG.max}°/${YAW_DEG.step}°，俯仰 ${PITCH_DEG.min}°…${PITCH_DEG.max}°/${PITCH_DEG.step}°`);
  console.log(`峰组 ${boxes.length} 组、${boxes.reduce((s, b) => s + b.peaks, 0)} 块峰：`);
  for (const b of boxes)
    console.log(`  ${b.tag.padEnd(10)} ${b.variant.padEnd(7)} ${b.peaks} 块  世界 (${b.x.toFixed(1)}, ${b.z.toFixed(1)})  y ${b.y0.toFixed(2)}→${b.y1.toFixed(2)} m  半宽/半深 ${((b.lx1 - b.lx0) / 2).toFixed(2)}/${((b.lz1 - b.lz0) / 2).toFixed(2)}`);
  console.log(`射线 ${rays.length} 条：挡住 ${blocked}（地形 ${byTerrain} / 峰石 ${byPeak}），漏 ${leaks.length}`);
  if (THRESHOLD_PCT === null)
    console.log(`遮挡率 ${(ratio * 100).toFixed(2)}%（参考尺子，不是门；97% 判据已退休，见计划文档裁定一。要当门用加 --threshold <百分数>）`);
  else
    console.log(`遮挡率 ${(ratio * 100).toFixed(2)}%  调用方给的线 ≥${THRESHOLD_PCT}%  → ${pass ? 'PASS' : 'FAIL'}`);
  if (leaks.length) {
    const byYaw = new Map();
    for (const l of leaks) byYaw.set(l.yaw, [...(byYaw.get(l.yaw) ?? []), l.pitch]);
    console.log('漏的射线（方位 → 俯仰）：');
    for (const [yaw, pitches] of [...byYaw.entries()].sort((a, b) => a[0] - b[0]))
      console.log(`  方位 ${String(yaw).padStart(4)}°  俯仰 ${pitches.join('/')}`);
  }
}

// 默认恒 0：低遮挡率不是工具失败，是一条要被人读的数。只有显式给了线才判退出码。
process.exit(pass === false ? 1 : 0);
