#!/usr/bin/env node
/**
 * experience-audit.mjs — 造景关系(PE 体验层)的共享验法库。
 *
 * 从 check-plan.mjs 约束5 的翠嶂障景实例抽出来泛化(单子 X2):
 * 约束5 与 tools/check-experience.mjs 共用这里的 rayBlocked。
 *
 * 纪律(ROADMAP §PE-2):每加一条造景关系必须能被验,验不了的不许进数据。
 * 所以 validateExperienceEntry 把「该 type 的验法尚未实现」列为失败,
 * 不是警告。本期实现五种 type 的验法(occlusion/reveal/framed_view/
 * approach_axis/filtered_view),其余四种见 IMPLEMENTED_ASSERTS 注释。
 *
 * 所有验法都是**平面(2D)代理**:平面相交成立不等于三维体验成立
 * (山脊高程 vs 建筑顶部、竹竿高度 vs 屋檐,见 ART_DIRECTION §5.5 的告诫)。
 * 条目的 note/limitation 字段负责把这一点写进数据。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { segmentLocations, segmentRelation } from '../builder/plan/geometry.ts';
/* 单子 AL-b b4:filtered_view 要数到 `scatters[]` 落的丛,就得当场算落点——
 * 与 tools/check-scenes.mjs 同一套调用(纯函数,node 与游戏同一份)。
 * 那几个模块用了 `@builder` 别名,要先挂 ts-resolver 再动态 import。 */
import '../tests/ts-resolver.mjs';
const { alongPathScatter } = await import('../builder/compose/scatter-along-path.ts');
const { buildOccupancy } = await import('../builder/compose/occupancy.ts');
const { makeTerrainField } = await import('../builder/compose/terrain-from-plan.ts');
const { SEED } = await import('../builder/compose/config.ts');

export const EXPERIENCE_TYPES = [
  'occlusion', 'approach_axis', 'framed_view', 'filtered_view', 'flanked_view',
  'borrowed_view', 'reveal', 'sound_precedes_view', 'intentional_void',
];
export const EXPERIENCE_STATUS = ['ok', 'contested', 'refuted', 'underdetermined', 'missing'];

/** 本期实现的验法。未实现的四种及原因:
 *  flanked_view——翠嶂山缝(夹道)几何不在 plan 里,山体多边形不含缝,无可验实例;
 *  borrowed_view——四区游线上无园外借景实例;
 *  sound_precedes_view——plan 水系无声源半径数据,「忽闻水声潺潺」在蓼汀花溆,非本期四区;
 *  intentional_void——属 PE-4,要散布器配合,本期明确不做。 */
export const IMPLEMENTED_ASSERTS = {
  occlusion: 'ray',
  reveal: 'visibility-flip',
  framed_view: 'cone',
  approach_axis: 'angle',
  filtered_view: 'occlusion-ratio',
};

/**
 * 同一 type 的第二把尺子(单子 AL-c c1)。filtered_view 的 `occlusion-ratio` 是平面代理;
 * `occlusion-ratio-3d` 读 tools/visibility-probe.mjs 在活世界里量好落盘的像素比。
 * 平面那把保留给别的条目;哪条用哪把写在条目的 `assert` 里(X-05 改不改归验收人)。
 */
export const ALT_ASSERTS = { filtered_view: ['occlusion-ratio-3d'] };
const assertAllowed = (type, a) => a === IMPLEMENTED_ASSERTS[type] || (ALT_ASSERTS[type] ?? []).includes(a);

/** 3D 尺子的量值落盘处(相对仓库根)。 */
export const MEASURED_PATH = 'projects/daguanyuan/experience-measured.json';

/**
 * 视线走廊:条目 from 各视点与 targets 各锚点的包围盒,外扩 HASH_CORRIDOR_MARGIN_M。
 * 区多边形的包围盒与它不相交的区,房和墙都挡不到这条视线,不进指纹(BA:稻香村施工不该让潇湘馆的 X-05 过期)。
 * 解析不出锚点或区没有多边形时从严:算进指纹。
 */
function nearCorridor(plan, entry, region) {
  const pts = [...(entry.from ?? [])];
  for (const id of entry.targets ?? []) {
    const ref = resolveRefPoint(plan, id);
    if (!ref) return true;
    pts.push(ref.point);
  }
  if (!pts.length || !Array.isArray(region.polygon) || !region.polygon.length) return true;
  const m = HASH_CORRIDOR_MARGIN_M;
  const cx0 = Math.min(...pts.map((p) => p[0])) - m, cx1 = Math.max(...pts.map((p) => p[0])) + m;
  const cz0 = Math.min(...pts.map((p) => p[1])) - m, cz1 = Math.max(...pts.map((p) => p[1])) + m;
  const rx = region.polygon.map((p) => p[0]), rz = region.polygon.map((p) => p[1]);
  return !(Math.max(...rx) < cx0 || Math.min(...rx) > cx1 || Math.max(...rz) < cz0 || Math.min(...rz) > cz1);
}

/**
 * 3D 量值的输入指纹(AL-c c1)。量值只在这些输入不变时有效:
 *   - 条目自身决定「从哪看、看谁、数哪种遮挡物」的字段:id / from / targets / filters;
 *     **不含** ratio / assert / status / hold / note——摘 hold、改区间、换尺子都不该让量值作废;
 *   - 视线走廊(见 nearCorridor)碰得到的区的 regions[].buildings 与 regions[].linears(目标与别的房子、墙都会挡),加 plan.wall(墙段);
 *   - 遮挡物所在的那份落位清单 scenes/<filters.scene>.json(竹的点名与 scatters)。
 * 键排序后 JSON 序列化再 sha256,取前 16 位。改了其中任何一样就得重跑 visibility-probe。
 */
export const HASH_CORRIDOR_MARGIN_M = 60;

export function experienceInputsHash(plan, entry, scene) {
  const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
  const regions = plan.regions.filter((r) => nearCorridor(plan, entry, r));
  const payload = {
    entry: { id: entry.id, from: entry.from, targets: entry.targets, filters: entry.filters },
    buildings: regions.map((r) => [r.id, r.buildings ?? []]),
    walls: { wall: plan.wall ?? null, linears: regions.map((r) => [r.id, r.linears ?? []]) },
    scene: scene ?? null,
  };
  return createHash('sha256').update(JSON.stringify(sortKeys(payload))).digest('hex').slice(0, 16);
}

function defaultLoadMeasured() {
  const url = new URL(`../${MEASURED_PATH}`, import.meta.url);
  return existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : {};
}

const label = (e) => `${e.id}(${e.type})`;

/** 射线 a→b 是否穿过多边形内部。约束5 原来的内联写法,抽成共用。 */
export function rayBlocked(a, b, polygon) {
  return segmentLocations(a, b, polygon).some((s) => s.location === 'inside');
}

/** 按 id 找 plan 对象锚点:regions[].buildings / gates(按 name) / hills / water。 */
export function resolveRefPoint(plan, id) {
  for (const r of plan.regions) {
    const b = (r.buildings ?? []).find((b) => b.id === id);
    if (b) return { point: [b.x, b.z], label: `${r.id}/${b.name}` };
  }
  const gate = (plan.gates ?? []).find((g) => g.name === id || g.id === id);
  if (gate) return { point: [gate.x, gate.z], label: `gate/${gate.name}` };
  const hill = (plan.hills ?? []).find((h) => h.id === id);
  if (hill) {
    const pts = hill.polygon.slice(0, -1);
    return {
      point: [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length],
      label: `hill/${hill.name}`,
    };
  }
  return null;
}

/** 行进射线 at→dir 首次「入界」的点;射不中多边形返回 null。
 * 复用 segmentLocations:它把线段按多边形边界切段并标注内外,
 * 第一段 location==='inside' 的起参数就是首次入界处。
 * reach 取够长(园子尺度 ≪ 1000 m),因为 dir 来自 path,只表方向不表距离。 */
function firstRayEntry(at, dir, polygon, reach = 1000) {
  const len = Math.hypot(dir[0], dir[1]);
  if (!(len > 0)) return null;
  const far = [at[0] + dir[0] / len * reach, at[1] + dir[1] / len * reach];
  const span = segmentLocations(at, far, polygon).find((s) => s.location === 'inside');
  if (!span) return null;
  return [at[0] + (far[0] - at[0]) * span.from, at[1] + (far[1] - at[1]) * span.from];
}

function resolveSubjectPolygon(plan, id) {
  const hill = (plan.hills ?? []).find((h) => h.id === id);
  return hill && Array.isArray(hill.polygon) ? hill.polygon : null;
}

function auditOcclusion(plan, entry) {
  const fails = [];
  const polygon = resolveSubjectPolygon(plan, entry.subject);
  if (!polygon) return [`${label(entry)} 的遮挡体 ${entry.subject} 不存在或无多边形`];
  for (const from of entry.from ?? []) {
    for (const ref of entry.targets ?? []) {
      const target = resolveRefPoint(plan, ref);
      if (!target) { fails.push(`${label(entry)} 目标 ${ref} 不存在`); continue; }
      if (!rayBlocked(from, target.point, polygon))
        fails.push(`${label(entry)} 自 (${from}) 望 ${target.label} 未被 ${entry.subject} 遮挡`);
    }
  }
  return fails;
}

function auditReveal(plan, entry) {
  const fails = [];
  const polygon = resolveSubjectPolygon(plan, entry.subject);
  if (!polygon) return [`${label(entry)} 的遮挡体 ${entry.subject} 不存在或无多边形`];
  if (!Array.isArray(entry.samples) || entry.samples.length < 2)
    return [`${label(entry)} reveal 至少需前后两个采样点`];
  if (!entry.samples.some((s) => s.expect === 'occluded') || !entry.samples.some((s) => s.expect === 'visible'))
    return [`${label(entry)} reveal 须同时含 expect=occluded 与 expect=visible 的采样,否则构不成「豁然」`];
  for (const sample of entry.samples) {
    for (const ref of entry.targets ?? []) {
      const target = resolveRefPoint(plan, ref);
      if (!target) { fails.push(`${label(entry)} 目标 ${ref} 不存在`); continue; }
      const blocked = rayBlocked(sample.at, target.point, polygon);
      if (sample.expect === 'occluded' && !blocked)
        fails.push(`${label(entry)} 采样 ${sample.label ?? sample.at} 应看不见 ${target.label},实际无遮挡`);
      if (sample.expect === 'visible' && blocked)
        fails.push(`${label(entry)} 采样 ${sample.label ?? sample.at} 应看见 ${target.label},实际仍被 ${entry.subject} 遮挡`);
    }
  }
  return fails;
}

/** 找洞口所在墙段:返回 {center, dir}(沿墙单位向量)。 */
function findOpening(plan, objectId) {
  for (const r of plan.regions) {
    for (const w of r.linears ?? []) {
      if (w.kind !== 'wall') continue;
      for (const insert of w.inserts ?? []) {
        if (insert.object !== objectId) continue;
        for (let i = 0; i + 1 < w.points.length; i++) {
          const [a, b] = [w.points[i], w.points[i + 1]];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 1e-7) continue;
          const t = ((insert.at[0] - a[0]) * (b[0] - a[0]) + (insert.at[1] - a[1]) * (b[1] - a[1])) / (len * len);
          if (t >= -1e-7 && t <= 1 + 1e-7 &&
            Math.abs((insert.at[0] - a[0]) * (b[1] - a[1]) - (insert.at[1] - a[1]) * (b[0] - a[0])) / len < 1e-6)
            return { center: insert.at, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], wall: w.id, variant: insert.variant };
        }
        return { center: insert.at, dir: null, wall: w.id, variant: insert.variant };
      }
    }
  }
  return null;
}

function auditFramedView(plan, entry) {
  const fails = [];
  const opening = findOpening(plan, entry.subject);
  if (!opening) return [`${label(entry)} 的框(洞口对象 ${entry.subject})不在任何墙路径的嵌件里`];
  if (!opening.dir) return [`${label(entry)} 洞口 ${entry.subject} 未落在直墙段上`];
  const half = entry.frame?.apertureHalfWidth_m;
  if (!Number.isFinite(half) || half <= 0) return [`${label(entry)} 缺 frame.apertureHalfWidth_m(洞口净半宽)`];
  const [cx, cz] = opening.center, [dx, dz] = opening.dir;
  const edge1 = [cx - half * dx, cz - half * dz], edge2 = [cx + half * dx, cz + half * dz];
  for (const from of entry.from ?? []) {
    for (const ref of entry.targets ?? []) {
      const target = resolveRefPoint(plan, ref);
      if (!target) { fails.push(`${label(entry)} 目标 ${ref} 不存在`); continue; }
      if (segmentRelation(from, target.point, edge1, edge2) === 'none')
        fails.push(`${label(entry)} 自 (${from}) 望 ${target.label} 的视线不穿过 ${entry.subject} 的洞口`);
      const sign = (p) => Math.sign((p[0] - from[0]) * (target.point[1] - from[1]) - (p[1] - from[1]) * (target.point[0] - from[0]));
      if (sign(edge1) === sign(edge2) && sign(edge1) !== 0)
        fails.push(`${label(entry)} 自 (${from}) 看,${target.label} 落在 ${entry.subject} 洞口张成的锥体之外`);
    }
  }
  return fails;
}

/**
 * 只量不判的参照点:射线到最近一组**白石**的夹角(单子 AV5)。
 *
 * 为什么要它:X-04 问的是「穿门而入,迎面有没有东西挡着」,而它的判法落在
 * **土山多边形**上——多边形从 AM2 起没动过,石头摆在哪它一概不知。于是 2026-09-17
 * 复走时 `gate_face`(门内北望)拍出来一块石头也没有,X-04 却一直是绿的
 * (景需求文档 §6-1)。这个函数把「石头在不在正前方」也量出来。
 *
 * **它不进门,也不改 X-04 的 status。** 观感迭代期不加门(docs/DECISIONS.md):
 * 这一轮正在挪石头,焊一条阈值上去只会逼下一个人去调松它,或者把当下这个
 * 形态当成期望值焊死。「迎面有没有石头」这一轮由 `gate_face` 的图判,
 * 这里只负责把数打印出来,让下一轮能看见它往哪边走。
 *
 * 包络不现场建几何(那要把 three 与 metaball 拖进 check:plan,每跑一次多一秒多),
 * 而是读 scenes 的 `clearances[]`——那张表里的 hx/hz 正是同一批构件量出来的
 * 世界包围盒(单子 AV2 逐条用 buildBaishiGeometry 量的,basis 里写着)。
 * 认不出包络的件退化成一个点,不假装知道它多大。
 */
function measureRocks(plan, entry, loadScene) {
  const at = entry.at ?? entry.path?.[1];
  const dir = entry.path ? [entry.path[1][0] - entry.path[0][0], entry.path[1][1] - entry.path[0][1]] : null;
  if (!at || !dir) return null;
  const dl = Math.hypot(...dir);
  if (!(dl > 0)) return null;
  const regions = entry.rocksIn ?? plan.regions.map((r) => r.id);
  let best = null;
  for (const regionId of regions) {
    const scene = loadScene?.(regionId);
    if (!scene) continue;
    const anchors = new Map();
    const r = plan.regions.find((x) => x.id === regionId);
    for (const k of r?.rocks ?? []) anchors.set(k.id, [k.x, k.z]);
    const items = [];
    for (const n of scene.named ?? [])
      if (n.part === 'baishi' && /^(group|peak)/.test(n.variant ?? '') && anchors.has(n.object))
        items.push({ tag: `${regionId}/${n.variant}`, anchor: n.object, dx: 0, dz: 0, at: anchors.get(n.object) });
    for (const pl of scene.placements ?? [])
      if (pl.part === 'baishi' && /^(group|peak)/.test(pl.variant ?? '') && anchors.has(pl.anchor)) {
        const a = anchors.get(pl.anchor);
        items.push({ tag: `${regionId}/${pl.variant}`, anchor: pl.anchor, dx: pl.dx, dz: pl.dz, at: [a[0] + pl.dx, a[1] + pl.dz] });
      }
    for (const it of items) {
      const c = (scene.clearances ?? []).find(
        (q) => q.anchor === it.anchor && Math.abs((q.dx ?? 0) - it.dx) < 0.01 && Math.abs((q.dz ?? 0) - it.dz) < 0.01,
      );
      const hx = c?.hx ?? 0, hz = c?.hz ?? 0;
      const pts = hx > 0 || hz > 0
        ? [[it.at[0] - hx, it.at[1] - hz], [it.at[0] - hx, it.at[1] + hz], [it.at[0] + hx, it.at[1] - hz], [it.at[0] + hx, it.at[1] + hz], it.at]
        : [it.at];
      for (const q of pts) {
        const b = [q[0] - at[0], q[1] - at[1]];
        const bl = Math.hypot(...b);
        if (bl < 1e-9) continue;
        const deg = (Math.acos(Math.max(-1, Math.min(1, (dir[0] * b[0] + dir[1] * b[1]) / (dl * bl)))) * 180) / Math.PI;
        // 只认前方的:射线是「走出门的去向」,身后的石头不算迎面。
        if (deg > 90) continue;
        if (!best || deg < best.deg) best = { deg, tag: it.tag, dist: bl, boxed: hx > 0 || hz > 0 };
      }
    }
  }
  return best;
}

function auditApproachAxis(plan, entry, loadScene) {
  const fails = [];
  const path = entry.path;
  if (!Array.isArray(path) || path.length !== 2) return [`${label(entry)} approach_axis 需 path:[[起],[讫]] 给行进方向`];
  const at = entry.at ?? path[1];
  const threshold = entry.threshold_deg;
  if (!Number.isFinite(threshold) || threshold <= 0) return [`${label(entry)} 缺 threshold_deg`];
  const dir = [path[1][0] - path[0][0], path[1][1] - path[0][1]];
  for (const ref of entry.targets ?? []) {
    const target = resolveRefPoint(plan, ref);
    if (!target) { fails.push(`${label(entry)} 目标 ${ref} 不存在`); continue; }
    // 山体目标(多边形)改判「行进射线首次入界点」,不用形心(2026-09-15 用户拍板,甲-2 判法):
    // approach_axis 对山问的是「走出门正前方有没有山迎面」,那是命中测试,
    // 不是「山的几何中点在不在正前方」——山一收形,形心就偏出阈值,可山还堵在门口。
    // 只在这里改;resolveRefPoint 仍给形心,occlusion/reveal 要的正是稳定参考点。
    const polygon = resolveSubjectPolygon(plan, ref);
    let point = target.point;
    if (polygon) {
      const hit = firstRayEntry(at, dir, polygon);
      if (!hit) { fails.push(`${label(entry)} 在 (${at}) 行进方向的射线未命中 ${target.label} 的多边形`); continue; }
      point = hit;
    }
    const bearing = [point[0] - at[0], point[1] - at[1]];
    const cos = (dir[0] * bearing[0] + dir[1] * bearing[1]) / (Math.hypot(...dir) * Math.hypot(...bearing));
    const deg = Math.hypot(...bearing) < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    if (deg > threshold)
      fails.push(`${label(entry)} 在 (${at}) 行进方向与 ${target.label} 方位夹角 ${deg.toFixed(1)}° 超过阈值 ${threshold}°`);
  }
  // 只量不判(单子 AV5):同一条射线打到最近一组白石的夹角,附在 detail 里打印。
  const rocks = measureRocks(plan, entry, loadScene);
  const note = rocks
    ? `参照·白石(只量不判):最近一组 ${rocks.tag},夹角 ${rocks.deg.toFixed(1)}°、距 ${rocks.dist.toFixed(1)} m${rocks.boxed ? '(按 clearances 登记的世界包围盒取最近角)' : '(该件未登记占地,按落位点算)'}`
    : null;
  return { fails, note };
}

const distanceToSegment = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};

/**
 * 某区 along-path 规则的落点(AL-b b4)。建成区 = 能读到的全部落位清单的区,
 * 与 check:scenes 同口径;注入了 loadScene(测试)时只拿那一份,占位场也只由它建。
 * 地形场建一次要几秒,按 plan 对象缓存。
 */
const terrainCache = new WeakMap();
function alongPathSeeds(plan, sceneId, scene, loadScene) {
  let scenes = [scene];
  if (loadScene === defaultLoadScene) {
    const dir = new URL('../projects/daguanyuan/scenes/', import.meta.url);
    scenes = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
      .map((f) => (f === `${sceneId}.json` ? scene : loadScene(f.replace(/\.json$/, ''))))
      .filter(Boolean);
  }
  const built = scenes.map((s) => s.region);
  let terrain = terrainCache.get(plan);
  if (!terrain) { terrain = makeTerrainField(plan, { seed: SEED }); terrainCache.set(plan, terrain); }
  const runs = alongPathScatter(plan, scenes, built, {
    occupancy: buildOccupancy(plan, built, scenes),
    surface: terrain.surface,
    solidRadius: 1.1,
    footRadius: 0.55,
    buildingPad: 0.25,
  });
  return runs.filter((run) => run.region === sceneId).flatMap((run) => run.seeds);
}

function defaultLoadScene(id) {
  try { return JSON.parse(readFileSync(new URL(`../projects/daguanyuan/scenes/${id}.json`, import.meta.url), 'utf8')); }
  catch { return null; }
}

/**
 * filtered_view 的 3D 验法(AL-c c1):读 visibility-probe 落盘的量值比 ratio 区间。
 * 没量过、输入指纹对不上、视点看不见目标——三种都红,各报各的原因。
 */
function measured3d(plan, entry, loadScene, measured) {
  const m = measured?.[entry.id];
  if (!m) return { fail: `${label(entry)} 没有 3D 量值——先跑 node tools/visibility-probe.mjs --entry ${entry.id} --write` };
  const scene = entry.filters?.scene ? loadScene(entry.filters.scene) : null;
  const want = experienceInputsHash(plan, entry, scene);
  if (m.inputsHash !== want)
    return { m, fail: `${label(entry)} 输入变了(inputsHash ${m.inputsHash} ≠ ${want}),先跑 visibility-probe 重量`, stale: true };
  if (!m.visible || !Number.isFinite(m.ratio))
    return { m, fail: `${label(entry)} 3D:视点看不见目标(A 低于像素下限),不给比例` };
  return { m };
}

function auditFilteredView3d(plan, entry, loadScene, measured) {
  const range = entry.ratio;
  if (!Array.isArray(range) || range.length !== 2 || !(range[0] >= 0) || !(range[1] <= 1) || range[0] >= range[1])
    return [`${label(entry)} ratio 须为 [下界,上界] 且 0≤下界<上界≤1`];
  const r = measured3d(plan, entry, loadScene, measured);
  if (r.fail) return [r.fail];
  const views = r.m.views.map((v) => `(${v.from}) A ${v.A} B ${v.B} → ${v.ratio}`).join(';');
  const note = `3D 量值 ${r.m.ratio}(${views},@${r.m.commit})`;
  if (r.m.ratio < range[0] || r.m.ratio > range[1])
    return { fails: [`${label(entry)} 3D 遮挡比例 ${r.m.ratio} 不在 [${range}]`], note };
  return { fails: [], note };
}

function auditFilteredView(plan, entry, loadScene, measured) {
  if (entry.assert === 'occlusion-ratio-3d') return auditFilteredView3d(plan, entry, loadScene, measured);
  const flat = auditFilteredView2d(plan, entry, loadScene);
  // 平面尺子照判;有 3D 量值就跟着打出来(只量不判,AV5 的 note 口径),两把尺子的数并排看得见。
  if (!Array.isArray(flat)) return flat;
  const r = measured?.[entry.id] ? measured3d(plan, entry, loadScene, measured) : null;
  if (!r) return flat;
  const note = r.stale ? `参照·3D 量值 ${r.m.ratio} 已过期(输入变了)`
    : r.m?.visible === false ? '参照·3D:视点看不见目标'
    : `参照·3D(visibility-probe,只量不判):${r.m.ratio}(${r.m.views.map((v) => `(${v.from}) A ${v.A} B ${v.B}`).join(';')},@${r.m.commit})`;
  return { fails: flat, note };
}

function auditFilteredView2d(plan, entry, loadScene) {
  const fails = [];
  const spec = entry.filters;
  if (!spec?.scene || !spec.part || !spec.radius_m) return [`${label(entry)} 缺 filters{scene,part,radius_m}`];
  if (!loadScene) return [`${label(entry)} filtered_view 需要场景加载器`];
  const scene = loadScene(spec.scene);
  if (!scene) return [`${label(entry)} 场景 scenes/${spec.scene}.json 不存在`];
  const disks = (scene.placements ?? []).filter((p) => p.part === spec.part).map((p) => {
    const anchor = resolveRefPoint(plan, p.anchor);
    if (!anchor) return null;
    const r = spec.radius_m[p.variant];
    if (!Number.isFinite(r) || r <= 0) return null;
    return { center: [anchor.point[0] + p.dx, anchor.point[1] + p.dz], r };
  });
  if (disks.some((d) => !d)) return [`${label(entry)} 有 ${spec.part} 散布件锚点解析失败或 variant 未给半径`];
  /*
   * 单子 AL-b b4 · 修尺子:原来只数 `scene.placements`,AL3 用 `scatters[]`(along-path)
   * 落的竹夹路一丛都数不到,门报 0.25、是绿的,而眼睛看到的是正房被整片挡住(`D-32` ①)。
   * 现在把 along-path 的落点也算成遮挡盘:落点与 `check:scenes` 同一个函数、同一组参数
   * (solidRadius 1.1 / footRadius 0.55 / buildingPad 0.25,地表走 makeTerrainField)。
   * 半径取 `radius_m.clump`——`buildBambooRow` 的每一丛就是一个 clump 的长法。
   */
  const scatterRules = (scene.scatters ?? []).filter((r) => r.rule === 'along-path' && r.part === spec.part);
  if (scatterRules.length) {
    const r = spec.radius_m.clump;
    if (!Number.isFinite(r) || r <= 0) return [`${label(entry)} scatters[] 有 ${spec.part} 沿路散布,但 radius_m 未给 clump 半径`];
    for (const seed of alongPathSeeds(plan, spec.scene, scene, loadScene)) disks.push({ center: [seed.x, seed.z], r });
  }
  const range = entry.ratio;
  if (!Array.isArray(range) || range.length !== 2 || !(range[0] >= 0) || !(range[1] <= 1) || range[0] >= range[1])
    return [`${label(entry)} ratio 须为 [下界,上界] 且 0≤下界<上界≤1`];
  const SAMPLES = 24;
  for (const from of entry.from ?? []) {
    for (const ref of entry.targets ?? []) {
      const target = resolveRefPoint(plan, ref);
      if (!target) { fails.push(`${label(entry)} 目标 ${ref} 不存在`); continue; }
      const region = plan.regions.find((r) => (r.buildings ?? []).some((b) => b.id === ref));
      const pad = (region?.pads ?? []).find((p) => p.object === ref);
      if (!pad) { fails.push(`${label(entry)} 目标 ${ref} 无落脚面,取不出立面采样边`); continue; }
      // 立面=落脚面多边形中「法向最朝向视点」的那条边。
      let best = null;
      for (let i = 0; i + 1 < pad.polygon.length; i++) {
        const a = pad.polygon[i], b = pad.polygon[i + 1];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const out = [b[1] - a[1], -(b[0] - a[0])];
        const to = [from[0] - mid[0], from[1] - mid[1]];
        const score = (out[0] * to[0] + out[1] * to[1]) / (Math.hypot(...out) * Math.hypot(...to));
        if (!best || score > best.score) best = { a, b, score };
      }
      if (!best || best.score <= 0) { fails.push(`${label(entry)} 目标 ${ref} 没有朝向视点 (${from}) 的立面边`); continue; }
      let blocked = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const t = (i + 0.5) / SAMPLES;
        const p = [best.a[0] + (best.b[0] - best.a[0]) * t, best.a[1] + (best.b[1] - best.a[1]) * t];
        if (disks.some((d) => distanceToSegment(d.center, from, p) < d.r)) blocked++;
      }
      const ratio = blocked / SAMPLES;
      if (ratio < range[0] || ratio > range[1])
        fails.push(`${label(entry)} 自 (${from}) 望 ${target.label} 立面被 ${spec.part} 遮挡比例 ${ratio.toFixed(2)} 不在 [${range}]`);
    }
  }
  return fails;
}

const AUDITORS = {
  occlusion: auditOcclusion,
  reveal: auditReveal,
  framed_view: auditFramedView,
  approach_axis: auditApproachAxis,
  filtered_view: auditFilteredView,
};

/** 契约级校验:形状、状态口径、诚实规则。返回失败信息数组(空=通过)。 */
export function validateExperienceEntry(entry, seen = new Set()) {
  const fails = [];
  if (typeof entry.id !== 'string' || !/^X-\d+$/.test(entry.id)) fails.push(`条目 id 非法:${entry.id}`);
  if (seen.has(entry.id)) fails.push(`条目 id 重复:${entry.id}`);
  seen.add(entry.id);
  if (!EXPERIENCE_TYPES.includes(entry.type)) fails.push(`${label(entry)} type 非法:${entry.type}`);
  else if (!IMPLEMENTED_ASSERTS[entry.type])
    fails.push(`${label(entry)} type=${entry.type} 的验法本期未实现——验不了的不许进数据(ROADMAP §PE-2)`);
  else if (!assertAllowed(entry.type, entry.assert))
    fails.push(`${label(entry)} assert 应为 ${[IMPLEMENTED_ASSERTS[entry.type], ...(ALT_ASSERTS[entry.type] ?? [])].join(' 或 ')},实际 ${entry.assert}`);
  if (!EXPERIENCE_STATUS.includes(entry.status)) fails.push(`${label(entry)} status 非法:${entry.status}`);
  // `hold`:用户裁定「尺子错了、等换尺」时把一条断言挂起(D-33 起)。三项缺一不可——
  // 挂起必须说清是谁定的、为什么、等哪张单子,否则就是把红门悄悄关掉。
  if (entry.hold !== undefined) {
    const h = entry.hold;
    if (!h || typeof h !== 'object'
      || !/^D-\d+$/.test(h.decision ?? '')
      || typeof h.reason !== 'string' || h.reason.length < 10
      || typeof h.until !== 'string' || h.until.length === 0)
      fails.push(`${label(entry)} hold 须有 decision(D-编号)/reason/until 三项——挂起不许没有出处`);
  }
  if (!entry.source || typeof entry.source !== 'object') fails.push(`${label(entry)} 缺 source`);
  else {
    // 诚实规则一:status=ok 必须有原文出处(回目+逐字引文)。
    if (entry.status === 'ok' && !(Number.isInteger(entry.source.chapter) && typeof entry.source.quote === 'string' && entry.source.quote.length > 0))
      fails.push(`${label(entry)} status=ok 但 source 无原文回目与引文——ok 只给原文写得出的关系`);
    // 诚实规则二:我们造出来的关系(source.kind=art)不许标 ok。
    if (entry.source.kind === 'art' && entry.status === 'ok')
      fails.push(`${label(entry)} source.kind=art 却标 status=ok——造园手法产物不许安原文档级状态`);
  }
  return fails;
}

/**
 * 全量审计 plan.experience。返回 { fails, results }。
 * loadScene(sceneId) 可注入(测试用);缺省读 projects/daguanyuan/scenes/。
 */
export function auditExperience(plan, { loadScene, measured } = {}) {
  const read = loadScene ?? defaultLoadScene;
  const meas = measured ?? defaultLoadMeasured();
  const fails = [], results = [], held = [], seen = new Set();
  for (const entry of plan.experience ?? []) {
    const shapeFails = validateExperienceEntry(entry, seen);
    fails.push(...shapeFails);
    if (shapeFails.length || !AUDITORS[entry.type]) {
      results.push({ id: entry.id, type: entry.type, status: entry.status, pass: false, detail: shapeFails.join(';') || '验法未实现' });
      continue;
    }
    // 验法可以返回 string[](只有失败),也可以返回 { fails, note }——note 是
    // 「只量不判」的参照数(单子 AV5),跟着 detail 打印出来,既不进 fails 也不改 pass。
    const raw = AUDITORS[entry.type](plan, entry, read, meas);
    const assertFails = Array.isArray(raw) ? raw : raw.fails;
    const note = Array.isArray(raw) ? null : raw.note;
    /*
     * 挂起的条目照跑验法、照打实测值,断言失败进 `held` 不进 `fails`——门不因它置红,
     * 但每次都在输出里单列一行 HOLD,不许消失。挂起的条目若已通过,打印提示去撤 hold。
     */
    const onHold = entry.hold && !shapeFails.length;
    if (onHold) held.push(...assertFails); else fails.push(...assertFails);
    results.push({
      id: entry.id, type: entry.type, status: entry.status, pass: assertFails.length === 0,
      ...(onHold ? { hold: entry.hold } : null),
      detail: (assertFails.length ? assertFails.join(';') : '断言通过') + (note ? ` | ${note}` : ''),
      ...(note ? { note } : null),
    });
  }
  return { fails, results, held };
}
