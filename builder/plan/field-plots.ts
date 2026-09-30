import { Simplex } from '@engine/core/Noise';
import type { Point2 } from './geometry.ts';

/**
 * 菜畦范围(单子 BD3):「这一点在不在菜畦里」的**唯一**判定。
 *
 * 菜畦构件(`builder/parts/xiangye/caiqi.ts`,BB6)铺土垄与菜株、地面 splat 的「菜畦」地类(`terrain-from-plan.ts`)
 * 都问这一个函数——两处各写一份,脚下报的地类与眼睛看到的畦就会对不上。
 * 纯函数,不碰 three,只读 plan:`kind: 'planting'` 且带 `field` 规格的对象(稻香村 `daoxiangcun.vegetable-plots`)。
 * 判定与 BB6 原样一致:区多边形内、南沿噪声抖边以北、离水 ≥ waterClearM、不在落脚面、离墙篱 ≥ wallClearM、
 * 离 roads 走线 ≥ roadClearM、在背山脚椭圆(8×10 m 外放 hillClearM)之外。
 */
export interface FieldSpec {
  clipSouthZ: number; roadClearM: number; waterClearM: number; wallClearM: number; hillClearM: number;
  roads: string[]; hill: string; rapeShare: number; plotM: number; bedM: number; furrowM: number; baulkM: number;
}
interface FieldPlan {
  regions: { id: string; polygon: Point2[]; buildings?: { id: string; kind?: string; x: number; z: number; field?: FieldSpec; layout?: { runs: { points: Point2[] }[] } }[]; rocks?: { id: string; x: number; z: number }[]; pads?: { polygon: Point2[] }[] }[];
  water: { id?: string; polygon?: Point2[] }[];
  paths?: { id: string; points: Point2[] }[];
  narrativeRoutes?: { legs: { id: string; points: Point2[] }[] }[];
}
export interface CompiledField {
  id: string; spec: FieldSpec; region: string; polygon: Point2[];
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number };
  inside(x: number, z: number): boolean;
}

const inPoly = (poly: readonly Point2[], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const segD = (px: number, pz: number, a: Point2, b: Point2) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L));
  return Math.hypot(a[0] + dx * t - px, a[1] + dz * t - pz);
};
export const lineDistance = (pts: readonly Point2[], x: number, z: number) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segD(x, z, pts[i - 1], pts[i])); return d; };
export const pointInPolygon = inPoly;

export function compileFields(planIn: unknown): CompiledField[] {
  const plan = planIn as FieldPlan, out: CompiledField[] = [];
  for (const region of plan.regions) for (const item of region.buildings ?? []) {
    if (item.kind !== 'planting' || !item.field) continue;
    const F = item.field;
    const legs = (plan.narrativeRoutes ?? []).flatMap((r) => r.legs);
    const roads = F.roads.map((rid) => (plan.paths ?? []).find((p) => p.id === rid)?.points ?? legs.find((l) => l.id === rid)?.points);
    if (roads.some((r) => !r)) throw new Error(`[field] ${item.id} 的 roads 有找不到的走线`);
    const walls = (region.buildings ?? []).flatMap((b) => b.layout?.runs.map((r) => r.points) ?? []);
    const hill = [...(region.rocks ?? []), ...(region.buildings ?? [])].find((o) => o.id === F.hill);
    if (!hill) throw new Error(`[field] 找不到背山 ${F.hill}`);
    const waters = plan.water.filter((w) => w.polygon).map((w) => w.polygon!);
    const waterBoxes = waters.map((w) => ({ w, minX: Math.min(...w.map((p) => p[0])) - F.waterClearM, maxX: Math.max(...w.map((p) => p[0])) + F.waterClearM, minZ: Math.min(...w.map((p) => p[1])) - F.waterClearM, maxZ: Math.max(...w.map((p) => p[1])) + F.waterClearM }));
    const edge = new Simplex(0xca1);
    const xs = region.polygon.map((p) => p[0]), zs = region.polygon.map((p) => p[1]);
    const bbox = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.min(Math.max(...zs), F.clipSouthZ + 4) };
    const inside = (x: number, z: number) => {
      if (x < bbox.minX || x > bbox.maxX || z < bbox.minZ || z > bbox.maxZ) return false;
      if (!inPoly(region.polygon, x, z)) return false;
      if (z > F.clipSouthZ + 2.2 * edge.noise2D(x / 6, 1.7) + 1.1 * edge.noise2D(x / 2.3, 5)) return false;
      for (const b of waterBoxes) {
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        if (inPoly(b.w, x, z) || lineDistance([...b.w, b.w[0]], x, z) < F.waterClearM) return false;
      }
      for (const p of region.pads ?? []) if (inPoly(p.polygon, x, z)) return false;
      for (const r of walls) if (lineDistance(r, x, z) < F.wallClearM) return false;
      for (const r of roads) if (lineDistance(r!, x, z) < F.roadClearM) return false;
      // 背山脚:BB7 的背山椭圆 8×10 m(beishan.ts),外放 hillClear。
      if (((x - hill.x) / (8 + F.hillClearM)) ** 2 + ((z - hill.z) / (10 + F.hillClearM)) ** 2 < 1) return false;
      return true;
    };
    out.push({ id: item.id, spec: F, region: region.id, polygon: region.polygon, bbox, inside });
  }
  return out;
}
