import { compileConstruction, constructionFootprints } from '@builder/derive/construction';
import type { RegionScene, SceneClearance } from './scenes';

/**
 * occupancy.ts —— 占位的**唯一真源**（单子 Z，接缝 ③；销 `missing` 99-25）。
 *
 * 这笔账记了两年。`builder/compose/world.ts` 的实际构建顺序是
 * 开天→理地→引水→**植树**→起屋叠石：植被先于建筑散布。树不长穿门廊，
 * 靠的是 `builder/parts/zhiwu/vegetation.ts` 里一份**手抄的 `FOOTPRINTS` 副本**
 * ——与建筑真实 footprint 是两份真源，建筑布局一改就可能长穿。
 * `world.ts` 的头注释还特意警告过：**不要靠调换步骤来修**，那会让手抄的那份
 * 变成唯一真源，债挖得更深。
 *
 * 正解就是这里：一次占位预计算，从 `plan.json` + `scenes/*.json` 算出占位场，
 * 植被（以后还有散置层）都读它。建筑的占地由 `construction.spec` 编译出来的
 * **檐口外包络**给出（`constructionFootprints` 的 `roof`，已含出檐、铺作出跳、
 * 生出），不是任何人抄的数——**房子一挪，占位跟着挪，不需要改任何表**。
 *
 * 推不出来的那部分（门外甬道净空、院内留给点名竹的地、假山占地）写在
 * `scenes/<region>.json` 的 `clearances[]` 里：**同样相对锚点，同样必须有 basis**。
 * 它们不是第二份真源——手抄表抄的是「房子在哪」（plan 已经说了），
 * 而 clearance 说的是「这块地不种」（plan 没说，是一次取舍）。
 */

export type Point2 = [number, number];

/** 一块占位。凸多边形（建筑檐口外包络）或轴对齐盒（clearance）。 */
interface Occupant {
  id: string;
  kind: 'building' | 'clearance';
  /** 闭合凸环（首末点相同）。 */
  polygon: Point2[];
}

export interface OccupancyField {
  /** 1 = 空地，0 = 被占，边缘 0.7m 羽化。`pad` 是额外让开的米数。 */
  free(x: number, z: number, pad?: number): number;
  /**
   * 到最近一块占位边界的**有符号**距离：外部为正、内部为负。
   * 灌木要贴着墙角长、杂草要长在房子的背阴面——它们要的不是「在不在里面」，
   * 是「离边多远」。
   */
  distance(x: number, z: number): number;
  /** 门与调试用：这一场是由哪些东西占出来的。 */
  occupants(): readonly { id: string; kind: string; polygon: readonly Point2[] }[];
}

/** plan 里占位预计算要读的那一小块。 */
interface OccupancyPlan {
  regions: {
    id: string;
    buildings?: {
      id: string;
      kind?: string;
      x: number;
      z: number;
      facing?: string;
      construction?: unknown;
    }[];
    rocks?: { id: string; x: number; z: number }[];
  }[];
}

/**
 * 点到闭合凸环的有符号距离：外部为正、内部为负。
 *
 * 距离本身取「到最近一条边（线段，不是直线）的距离」，内外由叉积定。
 * 环的绕向不假设：`convexDistance` 正反各判一次取 min——点在内部时只有
 * 绕向对的那一次给负值，在外部时两次给同一个正值，所以 min 在两种情形
 * 下都是对的。构件的环来自 `constructionFootprints` 与本文件的 `boxRing`，
 * 都是凸的，不做凹多边形。
 */
function signedDistanceToConvex(x: number, z: number, ring: readonly Point2[]): number {
  let inside = true;
  let nearest = Infinity;
  let edges = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    edges++;
    if ((ex * (z - az) - ez * (x - ax)) / len > 0) inside = false;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (len * len)));
    nearest = Math.min(nearest, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  if (!edges) return Infinity;
  return inside ? -nearest : nearest;
}

function convexDistance(x: number, z: number, ring: readonly Point2[]): number {
  return Math.min(signedDistanceToConvex(x, z, ring), signedDistanceToConvex(x, z, [...ring].reverse()));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function boxRing(cx: number, cz: number, hx: number, hz: number): Point2[] {
  return [
    [cx - hx, cz - hz],
    [cx + hx, cz - hz],
    [cx + hx, cz + hz],
    [cx - hx, cz + hz],
    [cx - hx, cz - hz],
  ];
}

/**
 * 从 plan + scenes 算出占位场。
 *
 * 建筑那一半是**推导**的：每个带 `construction` 的 `kind==='building'` 对象
 * 编译出檐口外包络。`frame-ready`（P3 分件未完）的也算——它照样占地，
 * 占位跟「有没有做完分件几何」无关。
 */
export function buildOccupancy(
  plan: unknown,
  builtRegions: readonly string[],
  scenes: readonly RegionScene[],
): OccupancyField {
  const p = plan as OccupancyPlan;
  const list: Occupant[] = [];
  const built = new Set(builtRegions);

  for (const region of p.regions) {
    if (!built.has(region.id)) continue;
    const anchors = new Map<string, { x: number; z: number }>();
    for (const o of [...(region.buildings ?? []), ...(region.rocks ?? [])]) anchors.set(o.id, { x: o.x, z: o.z });

    for (const b of region.buildings ?? []) {
      if (b.kind !== 'building' || !b.construction) continue;
      let footprints;
      try {
        footprints = constructionFootprints(
          compileConstruction(b.construction as Parameters<typeof compileConstruction>[0]),
          b as { x: number; z: number; facing: string },
        );
      } catch {
        // 施工 spec 编译不过是 check:plan 的事（那道门会红）；占位场不该
        // 因为一栋房子的 spec 有问题就整个建不出来，跳过并让门去报。
        continue;
      }
      for (const f of footprints) {
        if (f.roof.length < 4) continue;
        list.push({ id: `${b.id}/${f.id}`, kind: 'building', polygon: f.roof as Point2[] });
      }
    }

    const scene = scenes.find((s) => s.region === region.id);
    for (const [i, c] of (scene?.clearances ?? []).entries()) {
      const a = anchors.get(c.anchor);
      if (!a) continue; // validateScenes 已经拦过；这里不重复报错，只是不占位
      list.push({
        id: c.tag ?? `${region.id}.clearance[${i}]`,
        kind: 'clearance',
        polygon: boxRing(a.x + c.dx, a.z + c.dz, c.hx, c.hz),
      });
    }
  }

  return {
    free(x: number, z: number, pad = 0): number {
      let m = 1;
      for (const o of list) {
        const d = convexDistance(x, z, o.polygon) - pad;
        m = Math.min(m, smoothstep(-0.35, 0.35, d));
        if (m <= 0) return 0;
      }
      return m;
    },
    distance(x: number, z: number): number {
      let d = Infinity;
      for (const o of list) d = Math.min(d, convexDistance(x, z, o.polygon));
      return d;
    },
    occupants: () => list,
  };
}

/* ---- 注入口：与 setPlan/setScenes 同路数 ------------------------------- */

let injected: OccupancyField | undefined;

export function setOccupancy(field: OccupancyField): void {
  injected = field;
}

/**
 * 1 = 空地，0 = 被占。**没有注入时返回 1（到处都是空地）而不是抛异常**：
 * 棚拍台（viewer.html）与图解页只建单个构件，不跑 world.build()，
 * 让它们为了一个散布遮罩去装配全园占位场是本末倒置。园子里漏注入会被
 * `tests/occupancy.test.mjs` 与对账门一起抓到。
 */
export function occupancyFree(x: number, z: number, pad = 0): number {
  return injected ? injected.free(x, z, pad) : 1;
}

/** 到最近一块占位边界的有符号距离；没注入时是 Infinity（到处都是空地）。 */
export function occupancyDistance(x: number, z: number): number {
  return injected ? injected.distance(x, z) : Infinity;
}

export function getOccupancy(): OccupancyField | undefined {
  return injected;
}
