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
 *   基底起伏 → 墙外林岗 → 堆山 → 区域台基 → 水体 → 园路 → 桥侧回切 / 显式基础锁平
 *
 *   - 台基在山之后：凸碧堂（tubi_aojing）的台地会把山体局部削平到 elevation_m，
 *     这正是「山脊上的院子」该有的样子；
 *   - 水体在台基之后：南池、引泉沟从区域里穿过的，池底沟底照常下沉；
 *   - 园路在最后，且纵断面从挖完水的场上采样——游线过南池是沁芳亭桥，
 *     桥是构件不是地形，地形上它就是一个被坡度限制器抹缓的浅凹，
 *     绝不允许为了路面把水池填出水面。桥面标高可约束接岸道路的纵断面，但桥下
 *     网格仍保留河床；路不能抬高水下地形。显式陆地基础的锁平也不得覆盖水域。
 */

import { Simplex, fbm2, clamp, smoothstep, lerp } from '@engine/core/Noise';
import { BoundsIndex } from '@engine/scatter/cluster';
import {allPlanLinears,type LinearSpec} from '@builder/plan/linears';
import {compileBridgePath} from '@builder/plan/bridge-path';
import {terrainWindow} from '@builder/plan/window';
import { makeGrassCoverField, bareSoilAmount } from './grass-cover';

/* ------------------------------------------------------------------ */
/* plan.json 的数据契约（只取本模块消费的字段）                          */
/* ------------------------------------------------------------------ */

export interface PlanWater {
  name: string;
  depth_m: number;
  polygon: [number, number][];
  /** Optional identifier for cross-referencing a water body from another module (e.g. a stone edge). */
  id?: string;
  /** Optional centerline for a narrow channel — the line a bank-edging construct would follow. */
  centerline?: [number, number][];
  /** Optional full width (m) of a narrow channel, consumed by centerline-following constructs. */
  width_m?: number;
}

export interface PlanHill {
  name: string;
  height_m: number;
  polygon: [number, number][];
  /**
   * 这座山的地表苔化上限（单子 AV3）。缺省不苔——只有写了这个字段的山才苔化，
   * 其余五座山一个像素不变。数与依据写在 `plan.json` 该条的 `name` 里。
   */
  mossCover?: number;
}

export interface PlanPath {
  name: string;
  points: [number, number][];
  role?:string;
  compatibilityScope?:{regions:string[];margin_m:number;feather_m:number};
  /**
   * 路面全宽（米）。缺省走 PATH_HALF_WIDTH 常量档。
   * 原文只给性格不给米数：「羊腸一條」(07-41) 窄、「平坦寬闊大路」(17 回) 宽，
   * 具体米数是艺术取值，须在该条的 basis 与 pudi 构件的 provenance.art 里留痕。
   */
  width_m?: number;
  /** 铺装：cobble=石子漫(07-41)、slab=石板/砖(近门大路，17 回「宽阔大路」)。缺省土路。 */
  paving?: 'cobble' | 'slab';
  /** 路肩羽化（米）。窄路要收窄，否则 1.2m 的羊肠被 1.1m 羽化泡成 3.4m 的土带。 */
  feather_m?: number;
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
  linears?: LinearSpec[];
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
  connections?:LinearSpec[];
  canvas: { width_m: number; depth_m: number };
  wall: [number, number][];
  water: PlanWater[];
  hills: PlanHill[];
  paths: PlanPath[];
  regions: PlanRegion[];
}

export interface SurfaceMasks {
  dirt: number;
  /** 石子漫(鹅卵石)铺装权重。与 slab 互斥；两者都是「stone」表面。 */
  cobble: number;
  /** 石板/砖铺装权重（近门大路）。 */
  slab: number;
  sand: number;
  grass: number;
  /** 宏观明暗/踩踏变化，0 = 踩实发暗，1 = 丰茂发亮。 */
  wear: number;
  /** 苔化权重（07-41「土地下蒼苔布滿」），来自 plan 里 mossInside 的墙体线性。 */
  moss: number;
  /**
   * 露土权重（单子 T）。仅当草皮是兜底材质（非路非铺装非沙非苔）且草被
   * 低频洼地（grass-cover 的 gapN）落到阈值以下时生效——与 vegetation.ts
   * 的 grassDensity 同源同判定，草稀处就是露土处。打包在扩展 splat 的 R。
   */
  soil: number;
  /**
   * 湿痕权重（单子 T）。水线 ±1.2m 且高程贴近水面（waterLevel=0）的地带，
   * 复用沙带那趟水线距离计算。打包在扩展 splat 的 G。
   */
  wet: number;
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

/** Catmull-Rom 过控制点的密采样（与 terrain.ts 的 smoothPath 同一手法，不依赖 three）。
 *  导出给 pudi 的路牙挤出用——路牙要贴的那条线就是路面遮罩所认的这条线。 */
export function resamplePath(
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
    for(const [i,y] of pins)if(lower[i]>y+1e-7)throw new Error(`园路相邻固定台地标高无法满足限坡，须修改路线或台地（里程${s[i].toFixed(3)}m，固定${y}m，受其他固定点约束至少${lower[i].toFixed(3)}m）`);
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
  // 草被疏密场:masks.soil(露土)与 vegetation 的 grassDensity 共用同一实现。
  const grassCover = makeGrassCoverField(seed);

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

  interface Hill extends Poly2 { h: number; inradius: number; mossCover: number }
  const hills: Hill[] = plan.hills.map((h) => {
    const poly = makePoly(h.polygon);
    // 每座山的羽化带按它自己的内深自适应——翠嶂是 210m 长的带状山，
    // 用固定羽化会让长山变成一道陡墙，或让质心到不了标称高程。
    return { ...poly, h: h.height_m, inradius: inradiusOf(poly), mossCover: h.mossCover ?? 0 };
  });

  interface Water extends Poly2 {
    depth: number; feather: number; warpA: number; warpB: number;
    sandOuter: number; sandOuterMid: number; sandInnerFar: number; sandInnerNear: number;
    wetOuter: number; wetInner: number;
  }
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
      // 沙带/湿痕的米制常数同一模式收放（单子 AH）：原常数按池岸标定，
      // 直接套给尺许宽的引泉沟会是一条 4.8m 宽的沙疤。阈值在 inradius≈5.5m
      // 打满——南池等大水体的 inradius 远超此值，六个常数都会精确顶到
      // 与改动前相同的 cap，池岸沙带因此逐比特不变。
      sandOuter: Math.min(2.0, inradius * (2.0 / 5.5)),
      sandOuterMid: Math.min(0.2, inradius * (0.2 / 5.5)),
      sandInnerFar: Math.max(-2.8, -inradius * (2.8 / 5.5)),
      sandInnerNear: Math.max(-0.6, -inradius * (0.6 / 5.5)),
      wetOuter: Math.min(1.2, inradius * (1.2 / 5.5)),
      wetInner: Math.min(0.35, inradius * (0.35 / 5.5)),
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
  const bridges=allPlanLinears(plan).filter(l=>l.kind==='bridge').map(spec=>{
    const c=compileBridgePath(spec);
    return {...makePoly(c.polygon.map(p=>[p[0]+c.origin[0],p[1]+c.origin[1]] as [number,number])),elev:spec.elevation_m,approach:spec.approachElevation_m??spec.elevation_m,thickness:spec.deckThickness_m,feather:spec.cutFeather_m,gradeDry:spec.abutmentMode==='grade-dry'};
  });
  const bridgeIndex=new BoundsIndex<typeof bridges[number]>(16);
  for(const b of bridges)bridgeIndex.add(b,b,b.feather);
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
    scope?:{minX:number;maxX:number;minZ:number;maxZ:number;feather:number};
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
    /** 半宽/羽化/铺装按路分档（plan.paths[].width_m / feather_m / paving）。 */
    hw: number;
    feather: number;
    paving?: 'cobble' | 'slab';
    margin: number;
  }

  const scopeWeight=(p:PathProfile,x:number,z:number)=>{
    if(!p.scope)return 1;
    const s=p.scope,d=Math.max(0,s.minX-x,x-s.maxX,s.minZ-z,z-s.maxZ);
    return 1-smoothstep(0,s.feather,d);
  };
  const pathProfiles: PathProfile[] = plan.paths.map((p) => {
    // 路宽按路分档：plan.paths[].width_m 是全宽；缺省回到旧常量档（半宽 1.35m）。
    const hw = (p.width_m ?? PATH_HALF_WIDTH * 2) / 2;
    const feather = p.feather_m ?? PATH_FEATHER;
    const margin = hw + feather + 1.5;
    let scope:PathProfile['scope'];
    if(p.compatibilityScope) {
      const s=p.compatibilityScope;
      if(p.role!=='legacy-runtime'||!Number.isFinite(s.feather_m)||s.feather_m<=0)throw new Error('兼容域只用于旧路基，且须有正羽化距离');
      scope={...terrainWindow(plan,s.regions,s.margin_m),feather:s.feather_m};
    }
    const dense = resamplePath(p.points, 8);
    const t = new Float64Array(dense.xs.length);
    for (let i = 0; i < t.length; i++) t[i] = naturalHeight(dense.xs[i], dense.zs[i]);
    const pins = new Map<number,number>();
    for(let i=0;i<t.length;i++) for(const pad of foundationIndex.query(dense.xs[i],dense.zs[i])) {
      if(signedDist(dense.xs[i],dense.zs[i],pad)<=0) pins.set(i,pad.elev);
    }
    for(let i=0;i<t.length;i++)for(const b of bridgeIndex.query(dense.xs[i],dense.zs[i]))
      if(signedDist(dense.xs[i],dense.zs[i],b)<=1e-8)pins.set(i,b.approach);
    try {gradeLimit(t, dense.s, PATH_GRADE, pins);} catch(error) {throw new Error(`${p.name}：${(error as Error).message}`);}
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
      }, i, margin);
    }
    return { ...dense, t, minX, maxX, minZ, maxZ, segments, segmentIds, pins, scope, hw, feather, paving: p.paving, margin };
  });
  // Most splat texels are nowhere near a road. Reject them before evaluating
  // ten octaves of domain warp; padding includes the maximum 0.47m warp.
  const PATH_MAX_MARGIN = Math.max(...pathProfiles.map((p) => p.margin));
  const pathPresence = new BoundsIndex<boolean>(8);
  for (const p of pathProfiles) for (let i=0;i+1<p.xs.length;i++) {
    pathPresence.add({minX:Math.min(p.xs[i],p.xs[i+1]),maxX:Math.max(p.xs[i],p.xs[i+1]),
      minZ:Math.min(p.zs[i],p.zs[i+1]),maxZ:Math.max(p.zs[i],p.zs[i+1])},true,PATH_MAX_MARGIN+0.47);
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
        if(scopeWeight(p,p.xs[i],p.zs[i])<=0)continue;
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
      x < p.minX - p.margin || x > p.maxX + p.margin ||
      z < p.minZ - p.margin || z > p.maxZ + p.margin
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
   *
   * 路宽按路分档（07-41「羊腸」vs 17 回「宽阔大路」）：选中最近的那条之后，
   * 用**它自己的**半宽与羽化收边；宽度呼吸噪声也按半宽比缩放，
   * 否则 ±0.32m 的呼吸放在 0.6m 半宽的羊肠上会把路整个吞掉。
   */
  function pathBlend(x: number, z: number, pavedOnly = false): { w: number; t: number; d: number; hw: number; feather: number; paving?: 'cobble' | 'slab' } {
    if (indexed && pathPresence.query(x,z).length === 0) return {w:0,t:0,d:Infinity,hw:0,feather:0};
    const [wx, wz] = warp2(x, z, 0.35, 0.045, 0.12, 0.3);
    let bestD = Infinity, bestT = 0, bestScope = 1, best: PathProfile | null = null;
    for (const p of pathProfiles) {
      if (pavedOnly && !p.paving) continue;
      const scope=scopeWeight(p,x,z);if(scope<=0)continue;
      const r = pathQuery(wx, wz, p);
      if (r && r.d < bestD) {
        bestD = r.d;
        bestT = r.t;
        bestScope = scope;
        best = p;
      }
    }
    if (!best) return { w: 0, t: 0, d: Infinity, hw: 0, feather: 0 };
    // 半宽会呼吸：一条等宽的之字带仍然读成画上去的丝带。
    const ratio = best.hw / PATH_HALF_WIDTH;
    const hw =
      best.hw +
      (fbm2(nWear, x * 0.02 + 5.5, z * 0.02 - 2.2, 2) * 0.22 +
        fbm2(nWear, x * 0.09 + 9.4, z * 0.09, 2) * 0.1) * ratio;
    return {
      w: smoothstep(hw + best.feather, hw, bestD) * bestScope,
      t: bestT,
      d: bestD,
      hw,
      feather: best.feather,
      paving: best.paving,
    };
  }

  /** THE ground function。 */
  function height(x: number, z: number): number {
    const natural = naturalHeight(x, z);
    let h = natural;
    let wet: boolean | undefined;
    const isWater = () => wet ??= (indexed ? waterIndex.query(x,z) : waters).some(w=>waterMask(x,z,w)>.001);
    const path = pathBlend(x, z);
    if (path.w > 0.001) {
      h = lerp(h, path.t, path.w);
      // 百年脚步在路心踩出的几厘米微槽。
      h -= path.w * 0.04;
      // A route crossing a creek needs a deck, not an earth dam. Fixed dry
      // approach elevations may raise the path profile but cannot fill water.
      if(h>natural&&isWater())h=natural;
    }
    // A selected dry abutment may be graded up to the slab underside. Water
    // masks always take the cut-only branch, so an approach cannot dam a creek.
    for(const b of bridgeIndex.query(x,z)) {
      const d=signedDist(x,z,b);if(d>b.feather)continue;
      const cut=lerp(natural,b.elev-b.thickness,smoothstep(b.feather,0,Math.max(0,d)));
      if(b.gradeDry&&!isWater()&&natural<b.elev-b.thickness)
        h=lerp(h,b.elev-b.thickness,smoothstep(b.feather,0,Math.max(0,d)));
      else h=Math.min(h,natural,cut);
    }
    // Road rutting and hill preservation must not tilt an explicitly authored
    // foundation. Water still wins outside the dry pad core: feathering is not
    // permission to fill an adjacent creek or a sluice channel.
    const foundations = indexed ? foundationIndex.query(x,z) : pads.filter(p=>p.explicit);
    if (foundations.length && !isWater()) {
      for (const p of foundations) {
        const w = padMask(x,z,p);
        if (w>.001) h=lerp(h,p.elev,w);
      }
    }
    return h;
  }

  /* ---- 表面材质遮罩 ------------------------------------------------- */

  /*
   * 苔化地面（第四十回「土地下蒼苔布滿」07-41）：plan 里凡是带 mossInside 的
   * 线性(目前是潇湘馆院墙)其多边形内部的地面苔化。这是地表混合的事——
   * 苔不挡人、不改高程、不是新几何。强度是艺术取值，依据留痕在 plan.json 该条 basis。
   */
  const mossPolys: Poly2[] = allPlanLinears(plan as unknown as Parameters<typeof allPlanLinears>[0])
    .filter((l) => (l as { mossInside?: boolean }).mossInside === true)
    .map((l) => makePoly(l.points.map((pt) => [pt[0], pt[1]] as [number, number])));

  /*
   * 「官式地面」区（单子 AU3）：`style.rustic === 0` 的区，地面只有铺装与草，
   * **不刷路土**（`dirt`）。
   *
   * 用户 2026-09-16 试玩：「门前还是有一些黄土地，顺便清理下，都是青青草就好。」
   * 台矶两翼那两块黄土的来源不是羽化土肩，是 `legacy-ch17-roadwork`
   * （兼容路基，无铺装）斜切过广场的两条臂——它在两翼比「近门大路」更近，
   * 于是赢了选路、把广场刷成土。收掉土肩之后它仍在，所以还要按区收一道。
   *
   * **按 style 挑区，不写区名、不写坐标**（接缝 ②，与 `scatter-rules.ts` 同一口径）：
   * 规则说的是「不带荒野气的院子地面不露荒土」，不是「正门不露土」。
   * `rustic === 0` 现在正好落到两个区——正门(A)与省亲别墅(A)，两处都是
   * 官式院落：`07-01`「下面白石臺磯」、`17` 回「平坦寬闊大路」说的都是
   * 铺装地面，稻香村那种 `rustic 0.9` 的田舍不在其列，土路一寸不动。
   *
   * 边界羽化 3m：区界是一条直折线，硬切会在开阔地上留一道笔直的色边。
   *
   * ⚠️ **它只收路土，不收露土（`soil`）。** 第一版顺手把 `soil` 也乘了进去，
   * `tests/terrain-index.test.mjs`「露土掩码与草密度同源」当场红了——那条门守的是
   * 「草稀处 = 露土处」**逐点**成立：`vegetation.ts` 的 `grassDensity` 与这里的
   * `soil` 调同一个 grass-cover 场，单方面把 `soil` 压成 0，地上会画着满绿、
   * 低头却是一片秃草。要在正门区取消露土，得连草密度一起改（`vegetation.ts`，
   * 不在单子 AU 的文件域），已在回报里点名。
   */
  const FORMAL_GROUND_FEATHER = 3.0;
  const formalGrounds: Poly2[] = plan.regions
    .filter((r) => (r as unknown as { style?: { rustic?: number } }).style?.rustic === 0)
    .map((r) => makePoly(r.polygon));
  const formalIndex = new BoundsIndex<Poly2>(32);
  for (const g of formalGrounds) formalIndex.add(g, g, 0);
  /** 0..1：这一点有多「官式地面」，1 = 区内深处，0 = 区外。 */
  function formalGround(x: number, z: number): number {
    let best = 0;
    for (const g of indexed ? formalIndex.query(x, z) : formalGrounds) {
      if (!inBBox(x, z, g, 0)) continue;
      const d = signedDist(x, z, g);
      if (d >= 0) continue;
      const w = smoothstep(0, FORMAL_GROUND_FEATHER, -d);
      if (w > best) best = w;
    }
    return best;
  }

  function masks(x: number, z: number): SurfaceMasks {
    const path = pathBlend(x, z);

    // 水线一圈浅滩沙。园子里没有海滩，这只是池岸的湿脚。
    let sand = 0;
    // 湿痕(单子 T)与沙带同一趟水线距离计算:更窄的一圈(±1.2m),
    // 够不够湿还要再看高程贴不贴水面(下面 wet 一段)。
    let wetBand = 0;
    for (const w of indexed ? waterIndex.query(x, z) : waters) {
      if (!inBBox(x, z, w, 3.5)) continue;
      const [wx, wz] = warp2(x, z, w.warpA, 0.06, w.warpB, 0.24);
      const sd = signedDist(wx, wz, w);
      const band = smoothstep(w.sandOuter, w.sandOuterMid, sd) * smoothstep(w.sandInnerFar, w.sandInnerNear, sd);
      if (band > sand) sand = band * 0.85;
      const wb = smoothstep(w.wetOuter, w.wetInner, Math.abs(sd));
      if (wb > wetBand) wetBand = wb;
    }

    // 路与草皮的边界：形状不规则还不够，性格也不能均匀——
    // 没人走的草舌头咬进路面，抄近道的脚把浮土带出路外。
    const bandOuter = smoothstep(0.03, 0.34, path.w) * smoothstep(1.0, 0.62, path.w);
    const tongue = indexed && bandOuter === 0 ? 0 : smoothstep(0.42, 0.88, fbm2(nScuff, x * 0.11 + 31.7, z * 0.11 - 12.3, 3) + 0.5);
    let dirt = path.w * (1 - clamp(bandOuter * tongue * 0.9, 0, 0.95));

    /*
     * 铺地（单子 N）：plan.paths[] 里带 paving 的路才铺——原文点名的先铺
     * （潇湘馆院内「石子漫」07-41、近门大路 17 回「宽阔大路」），没点名的留土路。
     * 喂饱 cobble/slab 之后 ctx.collision.surfaceAt 回 'stone'，
     * 草散布器自己就退开（运行时查 surfaceAt，不需要改散布器）。
     *
     * **有铺装的路不留土肩**（单子 AU3，用户 2026-09-16「门前还是有一些黄土地，
     * 都是青青草就好」）。原先这里写的是 `dirt *= 1 - max(cobble, slab)`：
     * 铺装只在 `hw + feather*0.4` 以内，而 `path.w` 一直铺到 `hw + feather`，
     * 中间那一圈 `dirt` 没人扣，于是每条铺装路两侧各长出一条浮土带
     * ——近门大路 4.4m 宽、羽化 1.1m，门前就是两条黄土。石板路的边由
     * `luya` 路牙收住，不需要土来过渡；让给草，读出来才是「青青草」。
     *
     * ⚠️ **只对有铺装的路**。没有 `paving` 的土路行为一个字不动：园内
     * 大半路面本来就该是土路（脚下序列里那些 dirt 段是对的，不是缺陷）。
     */
    let cobble = 0;
    let slab = 0;
    // 铺装按「最近的**有铺装的**那条路」单算一次，不复用 `path`（最近的任意一条）。
    // ⚠️ 单子 AU3 量出来的真病根：`pathBlend` 取最近的一条，而
    // `legacy-ch17-roadwork`（兼容路基，无 paving）在正门广场上是一条斜切过去的
    // 折线——在 x≈56 一带它比真正的「近门大路」还近 0.2m，于是它赢了选路，
    // 广场被刷成 `dirt=1`。用户看到的「门前黄土地」主要是这一片，不是羽化土肩。
    // 高程仍旧由 `path` 决定（动它会改地形高度），这里只决定地表材质。
    const paved = path.paving ? path : pathBlend(x, z, true);
    if (paved.paving && paved.w > 0.001 && paved.d < Infinity) {
      const pave = smoothstep(paved.hw + paved.feather * 0.4, paved.hw - 0.22, paved.d) * paved.w;
      if (paved.paving === 'cobble') cobble = pave * 0.92;
      else slab = pave * 0.92;
      dirt = 0;
    }

    // 官式地面区不刷荒土（见 `formalGround` 头注）。
    dirt = clamp(dirt, 0, 1) * (1 - sand) * (1 - formalGround(x, z));
    const grass = clamp(1 - sand - cobble - slab - dirt, 0, 1);

    let wear = clamp(
      0.5 +
        fbm2(nWear, x * 0.008 + 2.1, z * 0.008 - 6.3, 2) * 1.0 +
        fbm2(nWear, x * 0.027, z * 0.027, 2) * 0.44,
      0,
      1,
    );
    wear *= 1 - path.w * 0.2;

    // 苍苔布满的是「土地」：路面与铺装上不长苔，路缝墙根才留一点。
    let moss = 0;
    for (const mp of mossPolys) {
      if (!inBBox(x, z, mp, 0.2)) continue;
      const d = signedDist(x, z, mp);
      if (d >= 0) continue;
      const patch = fbm2(nWear, x * 0.045 + 4.7, z * 0.045 - 1.9, 3) * 0.5 + 0.5;
      const m = smoothstep(0, 1.1, -d) * (0.30 + 0.70 * patch);
      if (m > moss) moss = m;
    }
    /*
     * 山体苔地（单子 AV3；用户 2026-09-17 拍板「山体地表从草坪改成偏暗的苔地」）。
     *
     * 07-03 说翠嶂「上面**苔蘚成斑**，藤蘿掩映」——「翠」字的来处是石上的苔与藤。
     * AM4 把苔做进了白石的顶点色，可**地表还是草皮**：4 m 高、36 m 进深的土坡
     * 读成一片黄绿果岭，白石峰像五根柱子插在高尔夫球道上（景需求文档 §6-4）。
     * 这一项让带 `mossCover` 的山，它的地表按山体权重混成苔地。
     *
     * `shade`（0.6…1.0）**不是**按「离最近一组峰多远」算的，虽然单子原文是那么写的。
     * 理由是一条硬约束：`makeTerrainField` 要能在**没有注入 scenes** 的纯 node 工具里
     * 跑（`tools/occlusion-probe.mjs`、地形探针、单元测试都这么用），而峰位只住在
     * scenes 里。让它去读 scenes，工具里要么抛、要么悄悄走另一条分支——
     * 那就成了「同一个函数两个答案」，正是这个项目反复栽过的跟头。
     * 改用一层低频噪声当背阴度：同样给出 0.6→1.0 的起伏、同样是「有浓有淡不是一片
     * 均匀绿」，而且**地形场自给自足**。峰脚真正的浓淡由 `vegetation.ts` 那边的
     * 蕨簇与灌木（它们读得到 scenes）去给。
     *
     * 后面那串乘子原样保留：路面、铺装上不长苔（「苍苔布满的是土地」）。
     */
    let hillMoss = 0;
    for (const hill of indexed ? hillIndex.query(x, z) : hills) {
      if (hill.mossCover <= 0) continue;
      const hm = hillMask(x, z, hill);
      if (hm <= 0.001) continue;
      const shade = 0.6 + 0.4 * smoothstep(0.34, 0.72, fbm2(nWear, x * 0.055 - 18.3, z * 0.055 + 7.1, 3) * 0.5 + 0.5);
      const v = hm * hill.mossCover * shade;
      if (v > moss) moss = v;
      // 山体苔单列一份(AV-b2):给下面的露土让位用。只收 hills[].mossCover
      // 这一路;mossInside(潇湘馆苔院)那一路不进 hillMoss,行为不动。
      if (v > hillMoss) hillMoss = v;
    }
    moss = clamp(moss, 0, 1) * (1 - path.w * 0.85) * (1 - Math.max(cobble, slab)) * 0.85;

    // 露土(单子 T):草被低频洼地落到阈值以下,且草皮是兜底材质
    // (非路非铺装非沙非苔)时,地面透出真土。与 vegetation.ts 的
    // grassDensity 调同一个 grass-cover 场:草稀处就是露土处,逐点对齐。
    // AV-b2:山体苔地让露土让位——`moss × 1.2` 只把苔 0.33–0.55 的露土压到
    // 34–60%,土台与南坡剩一层红棕斑;山苔过 0.4 露土归零。
    //
    // 5d(单子 AL 第 0 件):阈值从 smoothstep(0.15, 0.4) 收到 (0.03, 0.12)。
    // AV-b2 那一版只治了土台顶(hillMoss 0.4+),**治不到土台南脚**:z≈211–217
    // 那一带是翠嶂主体多边形的南沿,hillMask 只有 0.3–0.4、hillMoss ≈ 0.13–0.22,
    // 正落在 0.15 的起点上下,露土几乎没被压——`gate_face` 里正对门那片
    // splat 网格状红棕斑就是它(shots/AL-before/gate_face.png、patch_close.png)。
    // 取「阈值下移」而不是「hillMask × (mossCover>0) 当开关」那条:开关式
    // 一刀切会把山脚羽化带上**本来就该有**的零星露土也一起抹掉(山苔在那里
    // 只有零点零几),而这一条仍然是按实际苔量连续让位,苔浓露土退、苔尽露土留。
    const fallback = clamp(1 - sand - Math.max(cobble, slab) - dirt, 0, 1);
    const soil = clamp(
      bareSoilAmount(grassCover.gapN(x, z)) * fallback * (1 - Math.min(1, moss * 1.2)) * (1 - smoothstep(0.03, 0.12, hillMoss)) * 0.9,
      0,
      1,
    );
    // 苔多草稀：苔化的地面把草皮权重让出来一点，院内读成苔地而不是草坪。
    // 露土再从草皮里扣——土是从草里露出来的，不是盖在草上的一层。
    const grassOut = clamp(grass * (1 - moss * 0.55) - soil, 0, 1);

    // 湿痕(单子 T):水线 ±1.2m 之内,还要高程贴近水面(0,terrain.ts 的
    // ctx.terrain.waterLevel)——岸坡上离地高的部分不湿。只在湿带候选点
    // 才采样 height(),1024² 烘焙里这趟成本只落在池岸一圈。
    let wet = 0;
    if (wetBand > 0.01) {
      wet = wetBand * smoothstep(0.42, 0.12, Math.abs(height(x, z))) * 0.92;
    }

    return { dirt, cobble, slab, sand, grass: grassOut, wear, moss, soil, wet };
  }

  function surface(x: number, z: number): string {
    const m = masks(x, z);
    if (Math.max(m.cobble, m.slab) > 0.45) return 'stone';
    if (m.sand > 0.4) return 'sand';
    if (m.dirt > 0.4) return 'dirt';
    return 'grass';
  }

  return { height, surface, masks };
}
