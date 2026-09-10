/**
 * 地形生成器 —— 输入全部来自 plan.json（P1 · Task 5）。
 *
 * 纯函数，先不接进游戏；接线（替换 terrain.ts 的硬编码坐标）是 Task 6 的事。
 * 本模块不许出现任何园子坐标：水挖到 depth_m、山抬到 height_m、路压平、
 * 台基死平，全部从 plan 的 wall / water / hills / paths / regions 读。
 *
 * 手法沿用 terrain.ts 里已验证的那套：解析场（地面是函数不是网格）、
 * 圆角遮罩羽化、双 warp 让边界不规则、路径按折线距离施加影响。
 * 不一样的地方在装配顺序，500 米画布上各要素互相压盖，顺序就是语义：
 *
 *   基底起伏 → 墙外林岗 → 堆山 → 区域台基 → 水体 → 园路
 *
 *   - 台基在山之后：凸碧堂（tubi_aojing）的台地会把山体局部削平到 elevation_m，
 *     这正是「山脊上的院子」该有的样子；
 *   - 水体在台基之后：南池、引泉沟从区域里穿过的，池底沟底照常下沉；
 *   - 园路在最后，且纵断面从挖完水的场上采样——游线过南池是沁芳亭桥，
 *     桥是构件不是地形，地形上它就是一个被坡度限制器抹缓的浅凹，
 *     绝不允许为了路面把水池填出水面。
 */

import { Simplex, fbm2, clamp, smoothstep, lerp } from '@engine/core/Noise';
import { BoundsIndex } from '@engine/scatter/cluster';

/* ------------------------------------------------------------------ */
/* plan.json 的数据契约（只取本模块消费的字段）                          */
/* ------------------------------------------------------------------ */

export interface PlanWater {
  name: string;
  depth_m: number;
  polygon: [number, number][];
}

export interface PlanHill {
  name: string;
  height_m: number;
  polygon: [number, number][];
}

export interface PlanPath {
  name: string;
  points: [number, number][];
}

export interface PlanRegion {
  id: string;
  name?: string;
  elevation_m: number;
  polygon: [number, number][];
  buildings?: unknown[];
  /** A region boundary is not necessarily a foundation. Water gates and
   * mountain terraces use explicit pads instead of flattening the region. */
  grading?: 'region' | 'pads';
  pads?: PlanPad[];
}

export interface PlanPad {
  id: string;
  object?: string;
  kind: 'grade' | 'deck' | 'water-opening';
  anchor: [number, number];
  polygon: [number, number][];
  elevation_m: number;
  feather_m?: number;
  basis: string;
}

export interface GardenPlan {
  canvas: { width_m: number; depth_m: number };
  wall: [number, number][];
  water: PlanWater[];
  hills: PlanHill[];
  paths: PlanPath[];
  regions: PlanRegion[];
}

export interface SurfaceMasks {
  dirt: number;
  cobble: number;
  sand: number;
  grass: number;
  /** 宏观明暗/踩踏变化，0 = 踩实发暗，1 = 丰茂发亮。 */
  wear: number;
}

export interface TerrainField {
  height(x: number, z: number): number;
  surface(x: number, z: number): string;
  masks(x: number, z: number): SurfaceMasks;
}

export interface TerrainFieldOptions {
  seed: number;
  /** Reference path for parity checks; production uses the spatial index. */
  spatialIndex?: boolean;
  /**
   * 网格采样窗口。场本身是全局解析式，bounds 不改变任何函数值；
   * 它留给 Task 6/7 的网格与分块代码声明「只采这一片」。
   */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/* ------------------------------------------------------------------ */
/* 平面几何小件                                                         */
/* ------------------------------------------------------------------ */

interface Poly2 {
  pts: readonly (readonly [number, number])[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function makePoly(pts: readonly (readonly [number, number])[]): Poly2 {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { pts, minX, maxX, minZ, maxZ };
}

const inBBox = (x: number, z: number, p: Poly2, margin: number): boolean =>
  x >= p.minX - margin && x <= p.maxX + margin && z >= p.minZ - margin && z <= p.maxZ + margin;

function segDist(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): number {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const L = vx * vx + vz * vz;
  let t = L > 1e-9 ? (wx * vx + wz * vz) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(wx - vx * t, wz - vz * t);
}

/** 偶奇规则。闭合环（首末点相同）与开环都安全。 */
function pointInPoly(x: number, z: number, p: Poly2): boolean {
  const pts = p.pts;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToPolyEdge(x: number, z: number, p: Poly2): number {
  const pts = p.pts;
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

/** 有符号距离：多边形内为负。 */
function signedDist(x: number, z: number, p: Poly2): number {
  const d = distToPolyEdge(x, z, p);
  return pointInPoly(x, z, p) ? -d : d;
}

function centroidOf(pts: readonly (readonly [number, number])[]): [number, number] {
  // 闭合环末点与首点重复，不参与平均。
  const n = pts.length - 1;
  let x = 0, z = 0;
  for (let i = 0; i < n; i++) { x += pts[i][0]; z += pts[i][1]; }
  return [x / n, z / n];
}

/**
 * 近似内切圆半径。凸块用质心就够；带状环（溪流的 polygon 是
 * 去程一岸回程另一岸）的顶点平均质心落在环外，退到网格扫描找最深点。
 */
function inradiusOf(poly: Poly2): number {
  const [cx, cz] = centroidOf(poly.pts);
  if (pointInPoly(cx, cz, poly)) return distToPolyEdge(cx, cz, poly);
  let best = 0.2;
  const step = Math.max(poly.maxX - poly.minX, poly.maxZ - poly.minZ) / 60;
  for (let x = poly.minX; x <= poly.maxX; x += step) {
    for (let z = poly.minZ; z <= poly.maxZ; z += step) {
      if (!pointInPoly(x, z, poly)) continue;
      const d = distToPolyEdge(x, z, poly);
      if (d > best) best = d;
    }
  }
  return best;
}

/** Catmull-Rom 过控制点的密采样（与 terrain.ts 的 smoothPath 同一手法，不依赖 three）。 */
function resamplePath(
  pts: readonly (readonly [number, number])[],
  perSegment: number,
): { xs: Float64Array; zs: Float64Array; s: Float64Array } {
  const n = pts.length;
  const count = (n - 1) * perSegment + 1;
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  const P = (i: number): readonly [number, number] => pts[clamp(i, 0, n - 1)];
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let j = 0; j < perSegment; j++) {
      const t = j / perSegment, t2 = t * t, t3 = t2 * t;
      xs[k] =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      zs[k] =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      k++;
    }
  }
  xs[k] = pts[n - 1][0];
  zs[k] = pts[n - 1][1];
  const s = new Float64Array(count);
  for (let i = 1; i < count; i++) {
    s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  return { xs, zs, s };
}

/**
 * 纵断面坡度限制：前后向各扫一遍 clamp，结果对弧长 Lipschitz ≤ g。
 * 凸碧山、翠嶂上的盘道全靠它把 100%+ 的山坡压成走得上去的路。
 */
function gradeLimit(t: Float64Array, s: Float64Array, g: number, pins: Map<number,number> = new Map()): void {
  if (pins.size) {
    const lower = new Float64Array(t.length).fill(-Infinity);
    for(const [i,y] of pins) { lower[i]=y; t[i]=y; }
    // The greatest lower envelope imposed by fixed foundation elevations.
    // Raising a road into this envelope before limiting it avoids cutting a
    // mountain approach below the terrace it is meant to reach.
    for(let i=1;i<t.length;i++)lower[i]=Math.max(lower[i],lower[i-1]-g*(s[i]-s[i-1]));
    for(let i=t.length-2;i>=0;i--)lower[i]=Math.max(lower[i],lower[i+1]-g*(s[i+1]-s[i]));
    for(const [i,y] of pins)if(lower[i]>y+1e-7)throw new Error('园路相邻固定台地标高无法满足限坡，须修改路线或台地');
    for(let i=0;i<t.length;i++)t[i]=Math.max(t[i],lower[i]);
  }
  for (let i = 1; i < t.length; i++) {
    const d = g * (s[i] - s[i - 1]);
    t[i] = clamp(t[i], t[i - 1] - d, t[i - 1] + d);
  }
  for (let i = t.length - 2; i >= 0; i--) {
    const d = g * (s[i + 1] - s[i]);
    t[i] = clamp(t[i], t[i + 1] - d, t[i + 1] + d);
  }
}

/** 五抽头滑动平均。凸组合不放大 Lipschitz 常数，所以放在两遍 clamp 之间是安全的。 */
function smoothProfile(t: Float64Array): void {
  const src = Float64Array.from(t);
  for (let i = 2; i < t.length - 2; i++) {
    t[i] = (src[i - 2] + 2 * src[i - 1] + 3 * src[i] + 2 * src[i + 1] + src[i + 2]) / 9;
  }
}

/* ------------------------------------------------------------------ */
/* 场                                                                  */
/* ------------------------------------------------------------------ */

/** 园路纵断面的坡度上限。断言容差 12%，留余量给 warp 与弦弧差。 */
const PATH_GRADE = 0.1;
/** 路面半宽（米）。warp 振幅必须显著小于它，否则控制点上的遮罩达不到 1。 */
const PATH_HALF_WIDTH = 1.35;
const PATH_FEATHER = 1.1;
/** 台基向区域多边形外的羽化距离。 */
const PAD_FEATHER = 3.5;
/**
 * 台基外围的缓坡裙：把地基向区域标高提前带起，路径进场时不用在院里爬坡。
 * 没有它，从园外低地进 2.4m 的省亲别墅，限坡器会把爬坡段伸到区域质心脚下。
 */
const PAD_APRON = 16;
const PAD_APRON_STRENGTH = 0.8;
const HILL_WARP = 1.85;

export function makeTerrainField(plan: GardenPlan, opts: TerrainFieldOptions): TerrainField {
  const seed = opts.seed;
  const nBase = new Simplex(seed ^ 0x9e3779b9);
  const nRoll = new Simplex((seed * 3 + 17) | 0);
  const nFine = new Simplex((seed * 7 + 313) | 0);
  const nWarpA = new Simplex((seed * 11 + 977) | 0);
  const nWarpB = new Simplex((seed * 13 + 4441) | 0);
  const nWear = new Simplex((seed * 17 + 88301) | 0);
  const nScuff = new Simplex((seed * 19 + 60623) | 0);
  const nRim = new Simplex((seed * 23 + 1543) | 0);

  /** 双 warp：粗项扭整体边界，细项咬碎最后半米。频率按 500m 画布缩过。 */
  function warp2(x: number, z: number, amp1: number, f1: number, amp2: number, f2: number): [number, number] {
    return [
      x + fbm2(nWarpA, x * f1 + 21.3, z * f1, 3) * amp1 + fbm2(nWarpA, x * f2, z * f2 + 9, 2) * amp2,
      z + fbm2(nWarpB, x * f1, z * f1 + 17.7, 3) * amp1 + fbm2(nWarpB, x * f2 + 4, z * f2, 2) * amp2,
    ];
  }

  const wall = makePoly(plan.wall);
  const canvasHalfX = plan.canvas.width_m / 2;
  const canvasHalfZ = plan.canvas.depth_m / 2;

  interface Hill extends Poly2 { h: number; inradius: number }
  const hills: Hill[] = plan.hills.map((h) => {
    const poly = makePoly(h.polygon);
    // 每座山的羽化带按它自己的内深自适应——翠嶂是 210m 长的带状山，
    // 用固定羽化会让长山变成一道陡墙，或让质心到不了标称高程。
    return { ...poly, h: h.height_m, inradius: inradiusOf(poly) };
  });

  interface Water extends Poly2 { depth: number; feather: number; warpA: number; warpB: number }
  const waters: Water[] = plan.water.map((w) => {
    const poly = makePoly(w.polygon);
    const inradius = inradiusOf(poly);
    return {
      ...poly,
      depth: w.depth_m,
      feather: clamp(inradius * 0.35, 0.15, 8),
      // warp 振幅随水面宽度收放：尺许宽的引泉沟经不起米级的扭动。
      warpA: Math.min(1.1, inradius * 0.2),
      warpB: Math.min(0.35, inradius * 0.06),
    };
  });

  interface Pad extends Poly2 { elev: number; explicit: boolean; feather: number }
  const pads: Pad[] = plan.regions
    .flatMap((r) => [
      ...(r.grading !== 'pads' && r.buildings?.length
        ? [{ ...makePoly(r.polygon), elev:r.elevation_m, explicit:false, feather:PAD_FEATHER }] : []),
      ...(r.pads ?? []).filter(p => p.kind === 'grade').map(p =>
        ({...makePoly(p.polygon),elev:p.elevation_m,explicit:true,feather:p.feather_m ?? PAD_FEATHER})),
    ]);

  const indexed = opts.spatialIndex !== false;
  const hillIndex = new BoundsIndex<Hill>(32);
  const padIndex = new BoundsIndex<Pad>(32);
  const waterIndex = new BoundsIndex<Water>(32);
  const foundationIndex = new BoundsIndex<Pad>(32);
  for (const h of hills) hillIndex.add(h, h, HILL_WARP);
  for (const p of pads) {
    padIndex.add(p,p,p.explicit ? p.feather : PAD_APRON + .8);
    if (p.explicit) foundationIndex.add(p,p,p.feather);
  }
  // The same index serves excavation and the 3.5m surface wet band.
  for (const w of waters) waterIndex.add(w, w, Math.max(3.5, w.feather + w.warpA + w.warpB + 0.1));

  /* ---- 各要素遮罩 -------------------------------------------------- */

  function hillMask(x: number, z: number, hill: Hill): number {
    if (!inBBox(x, z, hill, HILL_WARP)) return 0;
    const [wx, wz] = warp2(x, z, 1.4, 0.05, 0.45, 0.21);
    const d = signedDist(wx, wz, hill);
    if (d >= 0) return 0;
    return Math.pow(smoothstep(0, hill.inradius * 0.85, -d), 0.9);
  }

  function waterMask(x: number, z: number, w: Water): number {
    if (!inBBox(x, z, w, w.feather + w.warpA + w.warpB + 0.1)) return 0;
    const [wx, wz] = warp2(x, z, w.warpA, 0.06, w.warpB, 0.24);
    const d = signedDist(wx, wz, w);
    if (d >= 0) return 0;
    return smoothstep(0, w.feather, -d);
  }

  function padMask(x: number, z: number, p: Pad): number {
    if (p.explicit) return inBBox(x,z,p,p.feather) ? smoothstep(p.feather,0,signedDist(x,z,p)) : 0;
    if (!inBBox(x, z, p, PAD_FEATHER + 0.8)) return 0;
    const [wx, wz] = warp2(x, z, 0.6, 0.08, 0.2, 0.3);
    const d = signedDist(wx, wz, p);
    // 多边形内部全平，羽化只向外——台基边线因此微微不规则，但院内死平。
    return smoothstep(PAD_FEATHER, 0, d);
  }

  function apronMask(x: number, z: number, p: Pad): number {
    if (p.explicit) return padMask(x,z,p);
    if (!inBBox(x, z, p, PAD_APRON + 0.8)) return 0;
    const [wx, wz] = warp2(x, z, 0.6, 0.08, 0.2, 0.3);
    const d = signedDist(wx, wz, p);
    return smoothstep(PAD_APRON, 0, d);
  }

  /* ---- 基底 + 墙 + 山 + 台基 + 水（园路之前的自然场） --------------- */

  function naturalHeight(x: number, z: number): number {
    let h =
      0.6 +
      fbm2(nRoll, x * 0.009 + 3.1, z * 0.009 - 7.7, 3) * 1.1 +
      fbm2(nBase, x * 0.031, z * 0.031, 3) * 0.32 +
      fbm2(nFine, x * 0.12, z * 0.12, 2) * 0.07;

    // 墙外抬成林岗，天际线用噪声起伏；画布边缘略回落，岗顶留在墙外不远处。
    if (inBBox(x, z, wall, 26)) {
      const dw = signedDist(x, z, wall);
      const m = smoothstep(2.5, 22, dw);
      if (m > 0) {
        const rimFall =
          1 -
          0.3 * smoothstep(canvasHalfX - 8, canvasHalfX, Math.abs(x)) -
          0.3 * smoothstep(canvasHalfZ - 8, canvasHalfZ, Math.abs(z));
        h +=
          m *
          rimFall *
          (2.3 +
            fbm2(nRim, x * 0.016 + 11.3, z * 0.016 - 5.1, 3) * 1.7 +
            fbm2(nRim, x * 0.06 - 3.7, z * 0.06 + 8.9, 2) * 0.5);
      }
    }

    // 山体核心区让台基让位：凸碧山庄的院子不能削掉凸碧山的主峰，
    // 削了山就没了。hillSum 强的地方台基退场，院落在山坡和山坳上随坡就势。
    let hillSum = 0;
    for (const hill of indexed ? hillIndex.query(x, z) : hills) {
      const m = hillMask(x, z, hill);
      hillSum += m;
      h += hill.h * m;
    }

    for (const pad of indexed ? padIndex.query(x, z) : pads) {
      // 缓坡裙先把地基带向台基标高，核心再压死平。
      const apron = apronMask(x, z, pad);
      if (apron > 0.001) h = lerp(h, pad.elev, apron * PAD_APRON_STRENGTH);
      const m = padMask(x, z, pad) * (pad.explicit ? 1 : 1 - smoothstep(0.25, 0.55, hillSum));
      if (m > 0.001) h = lerp(h, pad.elev, m);
    }

    // 岸坡先缓后陡：pow(m, 1.5) 让水线附近留一条浅滩，然后才落到 depth_m。
    for (const w of indexed ? waterIndex.query(x, z) : waters) {
      const m = waterMask(x, z, w);
      if (m > 0.001) h = lerp(h, -w.depth, Math.pow(m, 1.5));
    }
    return h;
  }

  /* ---- 园路 -------------------------------------------------------- */

  interface PathProfile {
    xs: Float64Array;
    zs: Float64Array;
    s: Float64Array;
    t: Float64Array;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    segments: BoundsIndex<number>;
    segmentIds: number[];
    pins: Map<number,number>;
  }

  const PATH_QUERY_MARGIN = PATH_HALF_WIDTH + PATH_FEATHER + 1.5;
  const pathProfiles: PathProfile[] = plan.paths.map((p) => {
    const dense = resamplePath(p.points, 8);
    const t = new Float64Array(dense.xs.length);
    for (let i = 0; i < t.length; i++) t[i] = naturalHeight(dense.xs[i], dense.zs[i]);
    const pins = new Map<number,number>();
    for(let i=0;i<t.length;i++) for(const pad of foundationIndex.query(dense.xs[i],dense.zs[i])) {
      if(signedDist(dense.xs[i],dense.zs[i],pad)<=0) pins.set(i,pad.elev);
    }
    gradeLimit(t, dense.s, PATH_GRADE, pins);
    smoothProfile(t);
    gradeLimit(t, dense.s, PATH_GRADE, pins);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < dense.xs.length; i++) {
      const x = dense.xs[i], z = dense.zs[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const segments = new BoundsIndex<number>(16);
    const segmentIds: number[] = [];
    for (let i = 0; i + 1 < dense.xs.length; i++) {
      segmentIds.push(i);
      segments.add({
        minX: Math.min(dense.xs[i], dense.xs[i+1]), maxX: Math.max(dense.xs[i], dense.xs[i+1]),
        minZ: Math.min(dense.zs[i], dense.zs[i+1]), maxZ: Math.max(dense.zs[i], dense.zs[i+1]),
      }, i, PATH_QUERY_MARGIN);
    }
    return { ...dense, t, minX, maxX, minZ, maxZ, segments, segmentIds, pins };
  });
  // Most splat texels are nowhere near a road. Reject them before evaluating
  // ten octaves of domain warp; padding includes the maximum 0.47m warp.
  const pathPresence = new BoundsIndex<boolean>(8);
  for (const p of pathProfiles) for (let i=0;i+1<p.xs.length;i++) {
    pathPresence.add({minX:Math.min(p.xs[i],p.xs[i+1]),maxX:Math.max(p.xs[i],p.xs[i+1]),
      minZ:Math.min(p.zs[i],p.zs[i+1]),maxZ:Math.max(p.zs[i],p.zs[i+1])},true,PATH_QUERY_MARGIN+0.47);
  }

  /*
   * 交叉口纵断面对齐。两条路在 1m 以内相遇就是同一个路口，高程必须一致——
   * 否则「最近者胜」的取值会在路口两侧跳变，路面上就是一个坑。
   * 只对齐不同的路：盘道的之字折返是同一条路在不同高程上平行，绝不许拉平。
   * 对齐（取均值）会破坏限坡，限坡又会推开对齐值，所以迭代三轮收敛。
   */
  {
    interface Node { path: number; i: number }
    const parent = new Map<number, number>();
    const find = (k: number): number => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let cur = k;
      while (parent.get(cur) !== cur) {
        const next = parent.get(cur)!;
        parent.set(cur, r);
        cur = next;
      }
      return r;
    };
    const key = (path: number, i: number): number => path * 100000 + i;
    const link = (a: number, b: number, i: number, j: number): void => {
      const ka = key(a, i), kb = key(b, j);
      if (!parent.has(ka)) parent.set(ka, ka);
      if (!parent.has(kb)) parent.set(kb, kb);
      parent.set(find(ka), find(kb));
    };
    // 空间哈希找 1m 内的异路密采样点。
    const CELL = 2;
    const grid = new Map<string, Node[]>();
    pathProfiles.forEach((p, pi) => {
      for (let i = 0; i < p.xs.length; i++) {
        const gx = Math.floor(p.xs[i] / CELL), gz = Math.floor(p.zs[i] / CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = grid.get(`${gx + dx},${gz + dz}`);
            if (!bucket) continue;
            for (const n of bucket) {
              if (n.path === pi) continue;
              const q = pathProfiles[n.path];
              const d = Math.hypot(p.xs[i] - q.xs[n.i], p.zs[i] - q.zs[n.i]);
              if (d < 1.0) link(pi, n.path, i, n.i);
            }
          }
        }
        const gk = `${gx},${gz}`;
        if (!grid.has(gk)) grid.set(gk, []);
        grid.get(gk)!.push({ path: pi, i });
      }
    });
    const clusters = new Map<number, Node[]>();
    for (const k of parent.keys()) {
      const r = find(k);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r)!.push({ path: Math.floor(k / 100000), i: k % 100000 });
    }
    for (let round = 0; round < 3; round++) {
      for (const members of clusters.values()) {
        let mean = 0;
        for (const m of members) mean += pathProfiles[m.path].t[m.i];
        mean /= members.length;
        for (const m of members) pathProfiles[m.path].t[m.i] = mean;
      }
      for (const p of pathProfiles) gradeLimit(p.t, p.s, PATH_GRADE, p.pins);
    }
    // 最后一轮对齐后不再限坡，让路口严格同高；残余坡度变化已在收敛后微乎其微。
    for (const members of clusters.values()) {
      let mean = 0;
      for (const m of members) mean += pathProfiles[m.path].t[m.i];
      mean /= members.length;
      for (const m of members) pathProfiles[m.path].t[m.i] = mean;
    }
  }

  /** 点到密采样折线的最近距离与对应纵断面高程。 */
  function pathQuery(x: number, z: number, p: PathProfile): { d: number; t: number } | null {
    if (
      x < p.minX - PATH_QUERY_MARGIN || x > p.maxX + PATH_QUERY_MARGIN ||
      z < p.minZ - PATH_QUERY_MARGIN || z > p.maxZ + PATH_QUERY_MARGIN
    ) {
      return null;
    }
    let best = Infinity, bt = 0;
    // Segments outside the padded query bucket cannot affect the path mask.
    // Candidate order is the original segment order, preserving nearest-point ties.
    for (const i of indexed ? p.segments.query(x, z) : p.segmentIds) {
      const ax = p.xs[i], az = p.zs[i];
      const vx = p.xs[i + 1] - ax, vz = p.zs[i + 1] - az;
      const wx = x - ax, wz = z - az;
      const L = vx * vx + vz * vz;
      let u = L > 1e-9 ? (wx * vx + wz * vz) / L : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const d = Math.hypot(wx - vx * u, wz - vz * u);
      if (d < best) {
        best = d;
        bt = p.t[i] + (p.t[i + 1] - p.t[i]) * u;
      }
    }
    return { d: best, t: bt };
  }

  /**
   * warp 后的查询点、路面遮罩与目标高程。多条路擦过时**最近者胜**，不做加权平均：
   * 环园东路贴着凸碧山庄台地 1.6m 处经过，两条路想要的高程差十余米，
   * 平均会把山顶的路拽到山脚——那是挡土墙，不是平均数。
   * 真正的交叉口（相距 1m 内）上面的对齐循环已把两条路拉到同一高程，
   * 最近者胜在路口因此不会跳变。
   */
  function pathBlend(x: number, z: number): { w: number; t: number } {
    if (indexed && pathPresence.query(x,z).length === 0) return {w:0,t:0};
    const [wx, wz] = warp2(x, z, 0.35, 0.045, 0.12, 0.3);
    // 半宽会呼吸：一条等宽的之字带仍然读成画上去的丝带。
    const hw =
      PATH_HALF_WIDTH +
      fbm2(nWear, x * 0.02 + 5.5, z * 0.02 - 2.2, 2) * 0.22 +
      fbm2(nWear, x * 0.09 + 9.4, z * 0.09, 2) * 0.1;
    let bestD = Infinity, bestT = 0;
    for (const p of pathProfiles) {
      const r = pathQuery(wx, wz, p);
      if (r && r.d < bestD) {
        bestD = r.d;
        bestT = r.t;
      }
    }
    if (bestD === Infinity) return { w: 0, t: 0 };
    return { w: smoothstep(hw + PATH_FEATHER, hw, bestD), t: bestT };
  }

  /** THE ground function。 */
  function height(x: number, z: number): number {
    let h = naturalHeight(x, z);
    const path = pathBlend(x, z);
    if (path.w > 0.001) {
      h = lerp(h, path.t, path.w);
      // 百年脚步在路心踩出的几厘米微槽。
      h -= path.w * 0.04;
    }
    // Road rutting and hill preservation must not tilt an explicitly authored
    // foundation. Water still wins outside the dry pad core: feathering is not
    // permission to fill an adjacent creek or a sluice channel.
    const foundations = indexed ? foundationIndex.query(x,z) : pads.filter(p=>p.explicit);
    if (foundations.length && !(indexed ? waterIndex.query(x,z) : waters).some(w=>waterMask(x,z,w)>.001)) {
      for (const p of foundations) {
        const w = padMask(x,z,p);
        if (w>.001) h=lerp(h,p.elev,w);
      }
    }
    return h;
  }

  /* ---- 表面材质遮罩 ------------------------------------------------- */

  function masks(x: number, z: number): SurfaceMasks {
    const path = pathBlend(x, z);

    // 水线一圈浅滩沙。园子里没有海滩，这只是池岸的湿脚。
    let sand = 0;
    for (const w of indexed ? waterIndex.query(x, z) : waters) {
      if (!inBBox(x, z, w, 3.5)) continue;
      const [wx, wz] = warp2(x, z, w.warpA, 0.06, w.warpB, 0.24);
      const sd = signedDist(wx, wz, w);
      const band = smoothstep(2.0, 0.2, sd) * smoothstep(-2.8, -0.6, sd);
      if (band > sand) sand = band * 0.85;
    }

    // 路与草皮的边界：形状不规则还不够，性格也不能均匀——
    // 没人走的草舌头咬进路面，抄近道的脚把浮土带出路外。
    const bandOuter = smoothstep(0.03, 0.34, path.w) * smoothstep(1.0, 0.62, path.w);
    const tongue = indexed && bandOuter === 0 ? 0 : smoothstep(0.42, 0.88, fbm2(nScuff, x * 0.11 + 31.7, z * 0.11 - 12.3, 3) + 0.5);
    let dirt = path.w * (1 - clamp(bandOuter * tongue * 0.9, 0, 0.95));

    const cobble = 0; // 铺地等 scenes 数据，地形层不猜。

    dirt = clamp(dirt, 0, 1) * (1 - sand);
    const grass = clamp(1 - sand - cobble - dirt, 0, 1);

    let wear = clamp(
      0.5 +
        fbm2(nWear, x * 0.008 + 2.1, z * 0.008 - 6.3, 2) * 1.0 +
        fbm2(nWear, x * 0.027, z * 0.027, 2) * 0.44,
      0,
      1,
    );
    wear *= 1 - path.w * 0.2;

    return { dirt, cobble, sand, grass, wear };
  }

  function surface(x: number, z: number): string {
    const m = masks(x, z);
    if (m.cobble > 0.45) return 'stone';
    if (m.sand > 0.4) return 'sand';
    if (m.dirt > 0.4) return 'dirt';
    return 'grass';
  }

  return { height, surface, masks };
}
