import { compileConstruction, constructionFootprints } from '@builder/derive/construction';
import { WALL_STYLE } from '@builder/parts/qiangyuan/wall-style';
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
 *
 * ---
 *
 * **单子 AF：墙体也进占位场，但走的是另一条通道。**
 *
 * 起因是用户 2026-09-14 报的「竹子穿墙」：一根竹竿从压顶穿下来插在白墙中段。
 * 四道验场门一道都没抓到——因为 `Occupant.kind` 只有 building / clearance 两种，
 * **墙体线性根本不在占位场里**。
 *
 * 但墙不能和房子同一个待遇，有两条硬理由：
 *
 * 1. **墙只占墙体本身那条带，不带 feather、不带 pad。**
 *    `07-07`「一帶粉垣，里面數楹修舍，有千百竿翠竹**遮映**」——竹子探出墙头
 *    本来就是江南园林的常景，是我们要的景，不是要躲的东西。给墙加一圈净空，
 *    全园每道墙外就会多一条秃边，而且正好和原文顶着干。
 * 2. **墙不参与 `free()` / `distance()`。** 那两个函数是植被散布器在读的
 *    （`vegetation.ts` 的 `outsideBuildings()` 16 处调用点），把墙加进去等于
 *    在不碰 `vegetation.ts` 的情况下改了植被行为——灌木要贴着墙角长、
 *    杂草要长在房子的背阴面，这些都会被连带改掉。
 *
 * 所以墙体带单独存一份，只由 `wallBands()` / `wallIntrusion()` 读，
 * 给「实体不许落在墙体内」那道门用（架构稿 §2 接缝 ③ 与 ⑥）。
 * 判据分得很清：**枝叶越墙允许且想要；茎干/实体落在墙体之内是缺陷。**
 */

export type Point2 = [number, number];

/** 一块占位。凸多边形（建筑檐口外包络）、轴对齐盒（clearance）或墙体带（wall）。 */
interface Occupant {
  id: string;
  kind: 'building' | 'clearance' | 'wall';
  /** 闭合凸环（首末点相同）。 */
  polygon: Point2[];
  /** 墙体带才有：墙基底与压顶的世界高度，用来排除"从墙上方飞过"的东西。 */
  baseY?: number;
  topY?: number;
}

/**
 * 墙体带的半厚（米）。
 *
 * `builder/parts/qiangyuan/wall.ts` 有三层厚度：墙身 `THICK` 0.30、
 * 墙脚 `BASE_T` 0.38、墙基 `PLINTH_T`。**取最厚的那层**，也就是 `PLINTH_T`——
 * 而 `PLINTH_T` 在 wall.ts 里就写成 `WALL_STYLE.footHalf * 2`，所以这里直接读
 * 同一个常量，不另拍一个数（那三个常量是模块私有的，不能 import；
 * `tests/occupancy.test.mjs` 有一条断言直接读 wall.ts 的源码，
 * 焊住「PLINTH_T 仍是最厚的那层」这个前提）。
 */
export const WALL_BAND_HALF = WALL_STYLE.footHalf;

export interface OccupancyField {
  /** 1 = 空地，0 = 被占，边缘 0.7m 羽化。`pad` 是额外让开的米数。 */
  free(x: number, z: number, pad?: number): number;
  /**
   * 到最近一块占位边界的**有符号**距离：外部为正、内部为负。
   * 灌木要贴着墙角长、杂草要长在房子的背阴面——它们要的不是「在不在里面」，
   * 是「离边多远」。
   */
  distance(x: number, z: number): number;
  /** 门与调试用：这一场是由哪些东西占出来的（含墙体带）。 */
  occupants(): readonly { id: string; kind: string; polygon: readonly Point2[] }[];
  /**
   * 墙体带。**不参与 `free()` / `distance()`**——理由见文件头注释：
   * 那两个是植被散布器在读的，墙加进去等于偷偷改了植被行为；
   * 而且墙一旦带净空，全园每道墙外就多一条秃边，与「翠竹遮映」顶着干。
   */
  wallBands(): readonly { id: string; polygon: readonly Point2[]; baseY: number; topY: number }[];
  /**
   * 一个半径 `solidRadius` 的实心圆盘落在 (x, z) 时，插进墙体多深。
   * 没插进去返回 `null`。给 `y` 就顺带排除"从墙上方飞过"的东西（挂在檐下的灯）。
   *
   * **只问茎干/实体，不问枝叶**：`solidRadius` 是竿/干的展开半径，
   * 不是包围盒——拿包围盒会把"竹梢探出墙头"这个正确的景报成缺陷。
   */
  wallIntrusion(
    x: number,
    z: number,
    solidRadius: number,
    y?: number,
  ): { depth: number; wall: string } | null;
}

/**
 * 各构件的**实体半径**（茎干/干体的展开半径，米）。
 *
 * 为什么不用名册里的 `size` 包围盒：`bamboo:grove` 的包围盒是 7.80 × 7.22
 * （半展 3.9），里面**包含枝叶**。而 `07-07`「千百竿翠竹**遮映**」要的就是
 * 叶子探出墙头——拿包围盒当实体范围，会把我们想要的景报成缺陷。
 *
 * `'bbox'` 表示这个构件从里到外都是实心的（石头），包围盒就是实体，
 * 半径取 `max(size.x, size.z) / 2`。
 *
 * 数是从 `builder/parts/zhiwu/bamboo.ts` 的几何参数推的，不是拍的：
 *   - `grove`：五丛种子点最大轴向 |x| = 2.15，加逐轴抖动 ±0.25，
 *     加丛内 `spread` ≤ 0.55 → **2.95**。竿的倾斜（tilt 0.02~0.18 rad）与叶
 *     都不计——那是「遮映」。
 *   - `clump`：单丛 `spread` 0.55，加竿在 4~6 m 高上的倾斜横移约 0.55 → **1.10**。
 *   - `single`：单竿 `spread` 0.01，只剩倾斜横移 → **0.60**。
 *
 * ⚠️ 这张表理想上该由构件自报（`root.userData.solidRadius`），本单子的改动面
 * 不含 `builder/parts/`，所以先放在这里并留下推导。挪进构件时数不该变。
 */
export const SOLID_RADIUS: Record<string, number | 'bbox'> = {
  'bamboo:grove': 2.95,
  'bamboo:clump': 1.1,
  'bamboo:single': 0.6,
  taihu: 'bbox',
  baogushi: 'bbox',
};

/**
 * 查一条名册记录的实体半径。表里没有的返回 `null`——**跳过，而且要被数出来**，
 * 不许静默略过（门会把跳过的条数打印出来）。
 */
export function solidRadiusOf(
  part: string,
  variant: string,
  size?: readonly number[] | null,
): number | null {
  const spec = SOLID_RADIUS[`${part}:${variant}`] ?? SOLID_RADIUS[part];
  if (spec === undefined) return null;
  if (spec !== 'bbox') return spec;
  if (!size || size.length < 3) return null;
  return Math.max(size[0], size[2]) / 2;
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
    /** 线性构件；这里只关心 `kind: 'wall'` 的那些。 */
    linears?: { id: string; kind: string; points?: Point2[]; elevation_m?: number; foundationDepth_m?: number }[];
  }[];
  /** 园墙外环。 */
  wall?: Point2[];
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

/**
 * 沿一段直线按墙厚挤出的矩形带。**不沿走向外扩、不加 feather、不加 pad**
 * ——占的就是墙体本身那条带（见文件头）。
 *
 * 折角处两段带在内侧重叠、外侧留一个小楔形没盖住：对「实体插进墙体」这个
 * 判据来说宁可漏报也不误报（误报会把「翠竹遮映」这个正确的景判成缺陷）。
 */
function bandRing(a: Point2, b: Point2, half: number): Point2[] | null {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  const nx = (-dz / len) * half;
  const nz = (dx / len) * half;
  return [
    [a[0] + nx, a[1] + nz],
    [b[0] + nx, b[1] + nz],
    [b[0] - nx, b[1] - nz],
    [a[0] - nx, a[1] - nz],
    [a[0] + nx, a[1] + nz],
  ];
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
  /** 墙体带单独存,**不进 `list`**——list 是 free()/distance() 遍历的那一份。 */
  const walls: Occupant[] = [];
  const built = new Set(builtRegions);

  const pushWall = (id: string, points: Point2[], elevation: number, foundation: number): void => {
    for (let i = 0; i < points.length - 1; i++) {
      const ring = bandRing(points[i], points[i + 1], WALL_BAND_HALF);
      if (!ring) continue;
      walls.push({
        id: `${id}#${i}`,
        kind: 'wall',
        polygon: ring,
        baseY: elevation - foundation,
        topY: elevation + WALL_STYLE.collisionTop,
      });
    }
  };

  // 园墙外环:它不属于任何一个区,建没建成都在那儿,所以不按 built 过滤。
  if (p.wall && p.wall.length > 1) {
    const ring = [...p.wall];
    const [first] = ring;
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    pushWall('plan.wall', ring, 0, 0.45);
  }

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

    // 区内的墙体线性(院墙)。未建区不入场,与「未建区不占位」保持一致。
    for (const l of region.linears ?? []) {
      if (l.kind !== 'wall' || !l.points || l.points.length < 2) continue;
      pushWall(l.id, l.points, l.elevation_m ?? 0, l.foundationDepth_m ?? 0.45);
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
    occupants: () => [...list, ...walls],
    wallBands: () => walls.map((w) => ({ id: w.id, polygon: w.polygon, baseY: w.baseY ?? 0, topY: w.topY ?? 0 })),
    wallIntrusion(x: number, z: number, solidRadius: number, y?: number) {
      let best: { depth: number; wall: string } | null = null;
      for (const w of walls) {
        // 从墙上方飞过的东西(挂在檐下的灯)不算插进墙里。
        if (y !== undefined && (y > (w.topY ?? 0) || y < (w.baseY ?? 0) - 2)) continue;
        const d = convexDistance(x, z, w.polygon);
        if (d >= solidRadius) continue;
        const depth = solidRadius - d;
        if (!best || depth > best.depth) best = { depth, wall: w.id };
      }
      return best;
    },
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
