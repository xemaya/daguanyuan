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
import { readFileSync } from 'node:fs';
import { segmentLocations, segmentRelation } from '../builder/plan/geometry.ts';

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

function auditApproachAxis(plan, entry) {
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
  return fails;
}

const distanceToSegment = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};

function auditFilteredView(plan, entry, loadScene) {
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
  else if (entry.assert !== IMPLEMENTED_ASSERTS[entry.type])
    fails.push(`${label(entry)} assert 应为 ${IMPLEMENTED_ASSERTS[entry.type]},实际 ${entry.assert}`);
  if (!EXPERIENCE_STATUS.includes(entry.status)) fails.push(`${label(entry)} status 非法:${entry.status}`);
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
export function auditExperience(plan, { loadScene } = {}) {
  const read = loadScene ?? ((id) => {
    try { return JSON.parse(readFileSync(new URL(`../projects/daguanyuan/scenes/${id}.json`, import.meta.url), 'utf8')); }
    catch { return null; }
  });
  const fails = [], results = [], seen = new Set();
  for (const entry of plan.experience ?? []) {
    const shapeFails = validateExperienceEntry(entry, seen);
    fails.push(...shapeFails);
    if (shapeFails.length || !AUDITORS[entry.type]) {
      results.push({ id: entry.id, type: entry.type, status: entry.status, pass: false, detail: shapeFails.join(';') || '验法未实现' });
      continue;
    }
    const assertFails = AUDITORS[entry.type](plan, entry, read);
    fails.push(...assertFails);
    results.push({
      id: entry.id, type: entry.type, status: entry.status, pass: assertFails.length === 0,
      detail: assertFails.length ? assertFails.join(';') : '断言通过',
    });
  }
  return { fails, results };
}
