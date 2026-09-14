import * as THREE from 'three';
import type { GameContext } from '@engine/core/Context';
import { buildPart, type PartBuild } from '@builder/parts/registry';
import '@builder/parts/index';
import type { BuildingResult } from '@builder/parts/damu/building';
import type { WallPathResult } from '@builder/parts/qiangyuan/wall-path';
import type {CorridorResult} from '@builder/parts/damu/corridor-path';
import type {BridgePathResult} from '@builder/parts/shuigong/bridge-path';
import {offsetStation} from '@builder/plan/polyline';
import { stoneMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { assembleStatic } from '@builder/parts/static-batches';
import { getPlan, MVP_REGIONS } from './terrain';
import { sceneFor, type ScenePlacement, type SceneNamed } from './scenes';
import { requirePlanAnchor, type NamedPlanAnchor } from '@builder/plan/objects';
import { LANTERN_DROP } from '@builder/parts/xiaomu/lantern';

/**
 * 装配器:把构件按 scene 表放进园子,并把每类构件的落脚(平台)与阻挡登记
 * 到碰撞层。构件自己不知道园子,园子也不读构件内部——只认 registry 的名字。
 *
 * P1 · Task 6:落位坐标系换成 plan.json 的(见 docs/superpowers/plans/
 * 2026-09-10-p1-foundation.md Task 6 · 更正④)。plan 中按稳定 id 登记的构件(正门、
 * 翠嶂白石群、沁芳亭、石桥三港、潇湘馆正房)按 `buildings[]`/`rocks[]` 的
 * 绝对 x/z 落位——这是平面真源写下的锚点,不是我们算出来的区域质心派生量,
 * 派生量不许盖过真源(`missing.rules.json` 99-24)。没点名的(墙段、竹丛、
 * 驳石)用「区域 + 局部偏移」兜底,或者干脆是绝对世界坐标——旧 64×72m 园子
 * 本就是按真实米制设计的,只是锚在了错的地方,所以这批直接按各自区域的
 * 锚点位移量整体平移,不做旋转、不做缩放。
 */

/** plan.json 里 composer 需要的字段——terrain-from-plan.ts 的 GardenPlan
 *  没有 buildings/rocks/entrances(那个模块不消费它们),这里单独声明。 */
interface PlanRegionFull {
  id: string;
  name?: string;
  elevation_m: number;
  polygon: [number, number][];
  /** 单子 Y:plan 遍历要读 kind 与 construction 来推构件,所以这里不能只收
   *  NamedPlanAnchor(它只有 id/name/x/z)。字段按需声明,不重复 plan 的全量类型。 */
  buildings?: (NamedPlanAnchor & { kind?: string; construction?: { spec?: unknown; status?: string } })[];
  rocks?: NamedPlanAnchor[];
  /** 线性构件(墙/廊/桥)的施工折线。几何自带世界位置。 */
  linears?: { id: string; kind: string }[];
  entrances?: [number, number][];
}
interface PlanWaterFull {
  name: string;
  depth_m: number;
  polygon: [number, number][];
}
interface PlanFull {
  regions: PlanRegionFull[];
  water: PlanWaterFull[];
}

/** `getPlan()` (from `./terrain`) is the injected instance — see terrain.ts's
 *  doc comment on `setPlan`/`getPlan` for why: `builder/` may not import
 *  `@project/plan.json` itself (`check:layers`), so `main.ts` injects it once
 *  before `world.build()` runs and both terrain.ts and this module read the
 *  same object back. Called lazily (inside functions, not at module top
 *  level) since module-top-level code runs before `main.ts`'s inject call. */
function plan(): PlanFull {
  return getPlan() as unknown as PlanFull;
}

function findRegion(id: string): PlanRegionFull {
  const r = plan().regions.find((x) => x.id === id);
  if (!r) throw new Error(`[garden] plan.json 缺区域：${id}`);
  return r;
}

/** 闭合环(首末点相同),末点不参与平均。 */
function regionCentroid(region: PlanRegionFull): [number, number] {
  const pts = region.polygon;
  const n = pts.length - 1;
  let x = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    x += pts[i][0];
    z += pts[i][1];
  }
  return [x / n, z / n];
}

/** Stable ids prevent similarly named halls from stealing an existing anchor. */
function findAnchor(region: PlanRegionFull, id: string): [number, number] {
  const hit = requirePlanAnchor(region, id);
  return [hit.x, hit.z];
}

interface Placement {
  part: string;
  variant?: string;
  /** plan.json 的区域 id。给了 anchor 或把 x/z 当局部偏移时必填。 */
  region?: string;
  /** plan.json 里该区 buildings[].id 或 rocks[].id，按其 x/z 落位。 */
  anchor?: string;
  /** 这个 placement **就是** plan 的哪个对象。
   *  ⚠️ 不能从 `anchor` 推：竹丛相对正房摆，不等于竹丛就是正房。
   *  只有 plan 遍历生成的点名件才有值；散置件一律没有，对账门把它们列为野生件。 */
  planId?: string;
  /** 有 region 无 anchor 时,x/z 是相对该区质心的局部偏移;都没有时是世界坐标。
   *  有 anchor 时,x/z 是相对锚点的局部微调(通常是 0,0)。 */
  x: number;
  z: number;
  /** 绕 Y 的朝向(弧度),0 = 构件正面朝南(+Z)。 */
  yaw?: number;
  /** 相对地面的抬升;`y` 给了就用绝对高度。 */
  dy?: number;
  y?: number;
  /** 建筑离水面时垫一块青石墩到地。 */
  pier?: boolean;
  tag?: string;
}

/** 解析落位世界坐标:anchor → region+局部偏移 → 绝对世界坐标。 */
function resolvePosition(p: Placement): [number, number] {
  if (p.anchor) {
    if (!p.region) throw new Error(`[garden] ${p.tag ?? p.part} 给了 anchor 但没给 region`);
    const [ax, az] = findAnchor(findRegion(p.region), p.anchor);
    return [ax + p.x, az + p.z];
  }
  if (p.region) {
    const [cx, cz] = regionCentroid(findRegion(p.region));
    return [cx + p.x, cz + p.z];
  }
  return [p.x, p.z];
}

/**
 * 9m 一折的曲桥,沿折线首尾相接铺一串,过整段开阔水面。bridge.ts 的
 * zigzag 局部几何三折错位,但两端(局部 x=-4.5 与 x=+4.5)都落在同一侧向
 * 偏移(z=[0,DECK_W])上,所以同一 yaw 下按桥长间隔摆放,首尾能对上不露缝
 * ——沿线转弯处分段处理,每段仍是直线链。见 Task 6 · Step 0 ③:68.6m 的
 * 水面,现桥总长只有约 25m,这里用「加曲桥段」(而非改游线绕开)补足。
 */
function bridgeChain(via: [number, number][], step = 8.8): Placement[] {
  const out: Placement[] = [];
  for (let leg = 0; leg < via.length - 1; leg++) {
    const [ax, az] = via[leg];
    const [bx, bz] = via[leg + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    // toWorld() 的约定(见下方 toWorld 与既有南北墙的 yaw 用法交叉验证过):
    // 局部 +X 的世界方向 = (cos(yaw), -sin(yaw))。
    const yaw = Math.atan2(-dz, dx);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      out.push({ part: 'bridge', variant: 'zigzag', x: ax + dx * t, z: az + dz * t, yaw, y: 0 });
    }
  }
  return out;
}

/** 十七回游线水下段(里程 156.5→225.1m,约 (-3,171) 到 (-40,128))的曲桥链。
 *  南段接石桥三港南沿(0,156.5);北段起点 (0,146)。
 *  亭子(railingSides:['e','w'])东西两侧是连续栏杆,z 范围 146.36–149.64,
 *  只有中轴 n/s 是敞的——这段起点得先沿中轴直下、出了栏杆的 z 范围
 *  (<146.36)才能折向西去接桥面,不能一出亭子就斜切向西:试过把起点本身
 *  往北挪(147→151.5)想让桥面躲开亭栏转角柱,结果挪多了在亭台与桥面之间
 *  露出真水面缺口——柱子挡的是"走位斜切",不是"桥离得不够远",航点顺序
 *  的修法在 tools/playtest.mjs。 */
const CAUSEWAY: Placement[] = [
  ...bridgeChain([
    [-2.7, 171.3],
    [0, 156.5],
  ]),
  ...bridgeChain([
    [0, 146],
    [-14, 138],
    [-27, 133],
    [-40, 128],
  ]),
];

/**
 * 池岸驳石:「白石为栏环抱池沿」——从南池水域轮廓的 bbox 近似一个椭圆,
 * 沿等角度找"刚露出水"的地方摆小石。南池已经比旧 9m 半径的池子大得多,
 * 搜索半径要跟着放大。
 */
function pondEllipse(): { cx: number; cz: number; rx: number; rz: number } {
  const w = plan().water.find((x) => x.name.startsWith('南池'));
  if (!w) throw new Error('[garden] plan.json 缺水体：南池');
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of w.polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, rx: (maxX - minX) / 2, rz: (maxZ - minZ) / 2 };
}

/** 从池心朝给定方向径向走,直到刚露出水面——用来把「按旧簇平移」落进水里
 *  的驳石重新钉回岸边(池子比旧世界大了近 5 倍,平移不会自动落在岸上)。 */
function shoreTowards(
  center: [number, number],
  towards: [number, number],
  ground: (x: number, z: number) => number,
  maxR: number,
): [number, number] {
  const [cx, cz] = center;
  const a = Math.atan2(towards[1] - cz, towards[0] - cx);
  let x = cx;
  let z = cz;
  for (let r = 0.5; r < maxR; r += 0.25) {
    x = cx + Math.cos(a) * r;
    z = cz + Math.sin(a) * r;
    if (ground(x, z) > 0.22) break;
  }
  return [x, z];
}

/** 池岸的驳石:沿池边等角度找"刚露出水"的地方摆小石。 */
function shoreStones(
  ground: (x: number, z: number) => number,
  pond: { cx: number; cz: number; rx: number; rz: number },
  exclude: [number, number][],
): Placement[] {
  const out: Placement[] = [];
  const n = 18;
  const maxR = Math.max(pond.rx, pond.rz) + 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.13;
    let r = 0.5;
    let x = pond.cx;
    let z = pond.cz;
    for (; r < maxR; r += 0.25) {
      x = pond.cx + Math.cos(a) * r * (pond.rx / Math.max(pond.rx, pond.rz));
      z = pond.cz + Math.sin(a) * r * (pond.rz / Math.max(pond.rx, pond.rz));
      if (ground(x, z) > 0.22) break;
    }
    // 桥头/causeway 端点附近不摆,留给路。
    if (exclude.some(([ex, ez]) => Math.hypot(x - ex, z - ez) < 3.0)) continue;
    if (i % 3 === 0) continue;
    out.push({ part: 'taihu', variant: `edge${(i % 5) + 1}`, x, z, yaw: a + i * 0.7, dy: -0.08 });
  }
  return out;
}

/**
 * 灯笼吊点(局部坐标)。第五十三回「大觀園正門上也挑著大明角燈,兩溜高照,
 * 各處皆有路燈」(honglou 07-70):正门次间檐下两盏,沁芳亭与潇湘馆正房各取一处。
 * 只给一两种灯、每处一两盏——那条"存疑"驳的是十种灯型并列,不是驳挂灯。
 * **不配 PointLight**:纸面 emissive 已经够亮(见 xiaomu/lantern.ts)。
 */
function lanternSpotsFor(p: Placement, built: PartBuild): { lx: number; lz: number; hangY: number }[] | null {
  if (built.kind !== 'building') return null;
  const b = built as BuildingResult;
  const m = b.frame.m;
  const front = m.depthHalf + 0.3; // 阑额外皮一线,吊在檐下
  // 悬挂点贴在阑额下皮;灯底低于台面 2.05m 就不挂(通行净空)。
  const hangY = b.platform.y + m.columnH + m.puzuoH - 0.03;
  if (hangY - LANTERN_DROP < b.platform.y + 2.05) return null;
  if (p.part === 'building' && p.variant === 'men') {
    const x = m.columnX;
    return [
      { lx: (x[1] + x[2]) / 2, lz: front, hangY },
      { lx: (x[x.length - 3] + x[x.length - 2]) / 2, lz: front, hangY },
    ];
  }
  if (p.variant === 'qinfang_ting_qiao.pavilion') return [{ lx: 0, lz: front, hangY }];
  if (p.variant === 'xiaoxiangguan.main-house') {
    const mid = (m.columnX[0] + m.columnX[m.columnX.length - 1]) / 2;
    return [
      { lx: mid - m.width / 4, lz: front, hangY },
      { lx: mid + m.width / 4, lz: front, hangY },
    ];
  }
  return null;
}

/**
 * 抱鼓石(门当)的摆放(局部坐标):正门前踏跺两侧一对,立在台基前缘外的
 * 地面上。07-01 原文无此物,设它是"门"最强的视觉符号——纯艺术选择,
 * 尺寸与形制的留痕在构件的 `root.userData.provenance.art` 里。
 */
function baogushiSpotsFor(p: Placement, built: PartBuild): { lx: number; lz: number }[] | null {
  if (p.part !== 'building' || p.variant !== 'men' || built.kind !== 'building') return null;
  const b = built as BuildingResult;
  return [
    { lx: -2.0, lz: b.platform.hz + 0.42 },
    { lx: 2.0, lz: b.platform.hz + 0.42 },
  ];
}

/**
 * 单子 Y · 接缝 ①：落位不再来自一张手写的 `SCENE` 常量，而是两处——
 *
 *   ① **点名件由 plan 遍历生成**。plan 里带 `construction.spec` 的房子、
 *      `linears[]` 里的墙/廊/桥，`variant` 就是对象的稳定 id，尺寸从 spec 读、
 *      坐标从锚点读——这类条目**不携带任何 plan 里没有的信息**，本来就是
 *      能生成的（spec §1.2）。19 区 75 个建筑条目里有 32 个带 spec，
 *      一个都不需要人手写落位。
 *   ② **plan 里没有锚点的东西**写在 `scenes/<region>.json`，坐标一律相对锚点。
 *
 * 推导顺序，先命中先算：
 *   1. `scenes[region].named[]` 绑定了构件的 → 用它，位置读 plan 对象的 x/z；
 *   2. `kind==='building'` 且有 `construction.spec` 且不是 `frame-ready`
 *      → `garden-building`，variant = 对象 id；
 *   3. `region.linears[]` 的 wall/corridor/bridge → `garden-wall`/`garden-corridor`
 *      /`garden-bridge`，variant = linear id；
 *   4. 其余不生成——对账门会把它报成缺项，**那是对的**，不是漏。
 */
function plannedPlacements(): Placement[] {
  const out: Placement[] = [];
  for (const regionId of MVP_REGIONS) {
    const region = findRegion(regionId);
    const scene = sceneFor(regionId);
    const bound = new Map<string, SceneNamed>();
    for (const n of scene.named ?? []) bound.set(n.object, n);

    const emit = (id: string, fallback: { part: string; variant?: string } | null): void => {
      const n = bound.get(id);
      if (n) {
        out.push({ part: n.part, variant: n.variant, region: regionId, anchor: id, planId: id, x: 0, z: 0,
          yaw: n.yaw, dy: n.dy, y: n.y, pier: n.pier, tag: n.tag });
        bound.delete(id);
        return;
      }
      if (fallback) out.push({ part: fallback.part, variant: fallback.variant, region: regionId, anchor: id, planId: id, x: 0, z: 0 });
    };

    for (const b of region.buildings ?? []) {
      const c = b.construction;
      const buildable = b.kind === 'building' && !!c?.spec && c.status !== 'frame-ready';
      emit(b.id, buildable ? { part: 'garden-building', variant: b.id } : null);
    }
    for (const r of region.rocks ?? []) emit(r.id, null);
    for (const l of region.linears ?? []) {
      const part = l.kind === 'wall' ? 'garden-wall' : l.kind === 'corridor' ? 'garden-corridor'
        : l.kind === 'bridge' ? 'garden-bridge' : null;
      // 线性构件的几何自带世界位置，不能再叠 Placement 变换(见主循环的断言)，
      // 所以它不走 anchor，x/z 留 0 让 resolvePosition 走绝对分支。
      if (part) out.push({ part, variant: l.id, planId: l.id, x: 0, z: 0, tag: l.id });
    }
    // named 里绑了、但 plan 遍历没走到的对象是契约错误，宁可当场炸，别静默丢件。
    for (const id of bound.keys())
      throw new Error(`[garden] scenes/${regionId}.json 的 named 绑定了 ${id}，但 plan 的该区对象里没有它`);
  }
  return out;
}

/** `scenes/<region>.json` 的 `placements[]`：plan 里没有锚点的散置件。 */
function scenePlacements(): Placement[] {
  const out: Placement[] = [];
  for (const regionId of MVP_REGIONS) {
    for (const pl of sceneFor(regionId).placements ?? []) {
      out.push({ part: pl.part, variant: pl.variant, region: regionId, anchor: pl.anchor,
        x: pl.dx, z: pl.dz, yaw: pl.yaw, dy: pl.dy, tag: pl.tag });
    }
  }
  return out;
}

export function buildGarden(ctx: GameContext): void {  const ground = ctx.collision.terrainHeight;
  const pond = pondEllipse();

  // 沁芳亭桥一带的驳石(taihu peak/peak3):沿「从池心朝某个方向」找刚露出水面
  // 的岸边落位——这是算出来的，不是摆出来的，所以不进 scenes(那里只放人写的
  // 落位)。单子 Y:三个参照点原来是旧世界平移常量 D_QINFANG 的派生量，现在
  // 改挂 plan 的亭锚点，把最后一个 D_* 也清掉；数值与平移写法逐位相同。
  const tingAnchor = findAnchor(findRegion('qinfang_ting_qiao'), 'qinfang_ting_qiao.pavilion');
  const fromTing = ([dx, dz]: [number, number]): [number, number] => [tingAnchor[0] + dx, tingAnchor[1] + dz];
  const qinfangCenter = fromTing([-0.3, 0.8]); // 旧 POND.cx/cz 的等价点
  const peakRaw = fromTing([7.5, 4.0]);
  const peak3Raw = fromTing([-9.1, -4.0]);
  const [peakX, peakZ] = shoreTowards(qinfangCenter, peakRaw, ground, 60);
  const [peak3X, peak3Z] = shoreTowards(qinfangCenter, peak3Raw, ground, 60);

  const causewayEnds: [number, number][] = [
    [-2.7, 171.3],
    [0, 156.5],
    [0, 146],
    [-40, 128],
  ];

  const all: Placement[] = [
    ...plannedPlacements(),
    ...scenePlacements(),
    // 曲桥链与池岸驳石是**算出来的**(沿折线铺桥段、沿池边找刚露出水的位置)，
    // 不是人摆的，所以不进 scenes——scenes 的 placements 只放人写的落位。
    // 它们是接缝 ② 的活(写条件不写坐标)，归单子 Z。
    ...CAUSEWAY,
    { part: 'taihu', variant: 'peak', x: peakX, z: peakZ, yaw: 2.4 },
    { part: 'taihu', variant: 'peak3', x: peak3X, z: peak3Z, yaw: -1.1 },
    // 铺地收边:路牙沿 plan.paths 里带 paving 的路在 world 空间直接挤出
    // (07-41 石子漫、17 回宽阔大路),几何自带世界坐标,必须零变换落位。
    { part: 'luya', variant: 'default', x: 0, z: 0, y: 0, tag: '路牙' },
    ...shoreStones(ground, pond, causewayEnds),
  ];

  const cache = new Map<string, PartBuild>();
  /** key → 构件本地包围盒 [sx, sy, sz]，见下面 fresh 分支里量它的理由。 */
  const partSize = new Map<string, [number, number, number]>();
  const updaters: ((dt: number, t: number) => void)[] = [];
  const stone = stoneMaterial(1);
  const group = new THREE.Group();
  group.name = 'Garden';
  // Static merging discards individual roots. Keep their construction identity
  // and provenance separately so a batched scene is still reviewable.
  const constructionRecords: Record<string, unknown>[] = [];
  group.userData.constructions = constructionRecords;
  // 单子 AD · 第一档对账：世界要自报「我建了哪几个区」,工具不许再抄一份区名。
  group.userData.builtRegions = [...MVP_REGIONS];
  const linearRecords:Record<string,unknown>[]=[];
  group.userData.linears=linearRecords;
  ctx.scene.add(group);
  // 静态件(墙/石/桥/屋)先收进这里,最后按材质合并;会动的(竹)直接进 group。
  const staticGroup = new THREE.Group();

  let calls = 0;
  const lanternSpots: { x: number; y: number; z: number }[] = [];
  const baogushiSpots: { x: number; z: number }[] = [];
  for (const p of all) {
    const key = `${p.part}:${p.variant ?? 'default'}`;
    let part = cache.get(key);
    let fresh = false;
    if (!part) {
      part = buildPart(p.part, p.variant,{ground}) ?? undefined;
      if (!part) {
        console.warn(`[garden] 未登记构件 ${key}`);
        continue;
      }
      cache.set(key, part);
      fresh = true;
      let tris = 0;
      part.root.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (!mm.isMesh) return;
        const g = mm.geometry;
        const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        tris += n * ((mm as THREE.InstancedMesh).isInstancedMesh ? (mm as THREE.InstancedMesh).count : 1);
      });
      console.info(`[garden] ${key} ${(tris / 1000).toFixed(1)}k tris`);
      if (part.update) updaters.push(part.update);
      // 单子 AD · 第三档：构件的本地包围盒尺寸,登记进世界清单。
      // 接缝门要判「两段墙之间有没有缝」,光有落位没有尺寸算不出端点。
      // 只在 fresh(原型第一次建出来)时量一次,之后从 cache 拿。
      const box = new THREE.Box3().setFromObject(part.root);
      partSize.set(key, box.isEmpty() ? [0, 0, 0] : [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]);
    }
    calls++;
    const linear=part.kind==='wall-path'||part.kind==='corridor-path'||part.kind==='bridge-path'?part as WallPathResult|CorridorResult|BridgePathResult:null;
    if(linear&&(p.x!==0||p.z!==0||p.y!==undefined||p.yaw))throw new Error('plan线性构件已含世界位置，不能再叠加Placement变换');
    const [wx, wz] = linear ? linear.path.origin : resolvePosition(p);
    const yaw = p.yaw ?? 0;
    const y = linear ? linear.spec.elevation_m : p.y ?? ground(wx, wz) + (p.dy ?? 0);
    const obj = fresh ? part.root : part.root.clone();
    obj.position.set(wx, y, wz);
    obj.rotation.y = yaw;
    obj.name = p.tag ?? key;
    // 单子 AD · 第一档对账：**每个** placement 都要登记。
    // 以前只有 kind==='building' 登记,所以六段墙、竹丛、太湖石、桥、游廊、院墙、
    // 灯笼在世界的自报清单里一条都没有——「台矶没造」这类缺陷从定义上就在所有门
    // 的视野之外(spec §1.5 ①②)。静态合并会丢掉 root,清单是合并后唯一的可审身份。
    //
    // planId 与 id 分开:planId 能对上 plan 对象才有值,对不上就是 null。
    // 正门那六段墙正是 planId=null 的野生件(它们该是 zhengmen.flanking-wall),
    // 对账门靠这个字段把「世界有、数据没有」单列出来,不与缺项混为一谈。
    const planId =
      p.planId ??
      (linear ? linear.spec.id : undefined) ??
      ((obj.userData.planObject as { id?: string } | undefined)?.id) ??
      (p.variant && p.variant.includes('.') ? p.variant : undefined) ??
      null;
    constructionRecords.push({
      id: planId ?? key,
      name: obj.name,
      part: p.part,
      variant: p.variant ?? 'default',
      position: [wx, y, wz],
      yaw,
      planId,
      size: partSize.get(key) ?? null,
      ...(part.kind === 'building' ? obj.userData.construction : null),
      ...(obj.userData.planObject ? { planObject: obj.userData.planObject } : null),
      ...(part.root.userData.provenance ? { provenance: part.root.userData.provenance } : null),
    });
    if(linear)linearRecords.push({...linear.root.userData.linear,position:[wx,y,wz]});
    if (part.update) group.add(obj);
    else staticGroup.add(obj);

    registerColliders(ctx, p.part, p.variant ?? 'default', part, wx, y, wz, yaw);

    // 灯笼挂在檐下(07-70):跟着建筑走,不是独立摆件。
    for (const s of lanternSpotsFor(p, part) ?? []) {
      const [lx, lz] = toWorld(wx, wz, yaw, s.lx, s.lz);
      lanternSpots.push({ x: lx, y: y + s.hangY, z: lz });
    }

    // 抱鼓石守在正门口(艺术选择,07-01 无此物):跟着正门走。
    for (const s of baogushiSpotsFor(p, part) ?? []) {
      const [bx, bz] = toWorld(wx, wz, yaw, s.lx, s.lz);
      baogushiSpots.push({ x: bx, z: bz });
    }

    if (p.pier) {
      // 从地面(池底)砌一块青石墩到构件底面。
      const b = part as BuildingResult;
      const hx = b.platform?.hx ?? 2;
      const hz = b.platform?.hz ?? 2;
      const gy = ground(wx, wz);
      const h = Math.max(0.05, y - gy + 0.02);
      const pier = new THREE.Mesh(roundedBox(hx * 2 - 0.1, h, hz * 2 - 0.1, 0.03, 2), stone);
      pier.position.set(wx, gy + h / 2 - 0.01, wz);
      pier.rotation.y = yaw;
      pier.receiveShadow = true;
      pier.castShadow = true;
      group.add(pier);
    }
  }
  if (lanternSpots.length) {
    const lantern = buildPart('lantern', 'gong', { ground });
    if (lantern) {
      for (const s of lanternSpots) {
        const l = lantern.root.clone();
        l.position.set(s.x, s.y, s.z);
        l.name = '灯笼';
        staticGroup.add(l);
        constructionRecords.push({ id: 'zhengmen.lantern', name: '灯笼',
          part: 'lantern', variant: 'gong', position: [s.x, s.y, s.z], yaw: 0, planId: null,
          provenance: lantern.root.userData.provenance });
      }
    }
  }
  if (baogushiSpots.length) {
    const baogushi = buildPart('baogushi', 'default', { ground });
    if (baogushi) {
      for (const s of baogushiSpots) {
        const gy = ground(s.x, s.z);
        const st = baogushi.root.clone();
        st.position.set(s.x, gy, s.z);
        st.name = '抱鼓石';
        staticGroup.add(st);
        // 挡人不挡路:两颗石在踏跺两侧,门轴中线(x=55)畅通。
        ctx.collision.addCircle(s.x, s.z, 0.34, gy, gy + 0.95, '抱鼓石');
        constructionRecords.push({
          id: 'zhengmen.baogushi',
          name: '抱鼓石(门当)',
          part: 'baogushi',
          variant: 'default',
          position: [s.x, gy, s.z],
          yaw: 0,
          planId: null,
          provenance: baogushi.root.userData.provenance,
        });
      }
    }
  }
  const merged = assembleStatic(staticGroup);
  merged.name = 'GardenStatic';
  group.add(merged);
  console.info(`[garden] ${calls} 件, ${cache.size} 种, 合并后 ${merged.children.length} 个 mesh`);

  ctx.tick((dt, t) => {
    for (const u of updaters) u(dt, t);
  });
}

/** 把局部 (lx, lz) 按 yaw 转到世界。 */
function toWorld(x: number, z: number, yaw: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

function registerColliders(
  ctx: GameContext,
  part: string,
  variant: string,
  built: PartBuild,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const col = ctx.collision;
  const kind = variant.replace(/[:\d].*$/, '');
  if(built.kind==='bridge-path') {
    const bridge=built as BridgePathResult;
    col.addPolygonPlatform(bridge.path.polygon.map(p=>[x+p[0],z+p[1]]),y,bridge.spec.id);
    for(let i=1;i<bridge.path.stations.length;i++)for(const side of [-1,1]) {
      const a=offsetStation(bridge.path.stations[i-1],side*(bridge.spec.width_m/2-.08)),b=offsetStation(bridge.path.stations[i],side*(bridge.spec.width_m/2-.08));
      col.addBox(x+(a[0]+b[0])/2,z+(a[1]+b[1])/2,Math.hypot(b[0]-a[0],b[1]-a[1])/2,.1,y,y+bridge.spec.railingHeight_m,Math.atan2(-(b[1]-a[1]),b[0]-a[0]),bridge.spec.id);
    }
    return;
  }
  if(built.kind==='corridor-path') {
    const corridor=built as CorridorResult;
    col.addPolygonPlatform(corridor.path.deckPolygon.map(p=>[x+p[0],z+p[1]]),y+corridor.spec.platformH_m,corridor.spec.id);
    for(const c of corridor.path.columns)col.addCircle(x+c.point[0],z+c.point[1],c.diameter/2,y+corridor.spec.platformH_m,y+corridor.spec.platformH_m+c.height,corridor.spec.id);
    return;
  }
  if(built.kind==='wall-path') {
    const wall=built as WallPathResult;
    for(const b of wall.path.blockers)col.addBox(x+b.cx,z+b.cz,b.hx,b.hz,y+b.minY,y+b.maxY,b.rot,wall.spec.id);
    for(const j of wall.path.joints)col.addCircle(x+j.center[0],z+j.center[1],j.radius,y+j.minY,y+j.maxY,wall.spec.id);
    for(const p of wall.path.platforms)col.addPlatform(x+p.cx,z+p.cz,p.hx,p.hz,y+p.y,p.rot,'月洞门槛');
    return;
  }
  if (built.kind === 'building') {
    const b = built as BuildingResult;
    col.addPlatform(x, z, b.platform.hx, b.platform.hz, y + b.platform.y, yaw, '台基');
    for(const s of b.walkSurfaces) {
      const [cx,cz]=toWorld(x,z,yaw,s.cx,s.cz);
      col.addPlatform(cx,cz,s.hx,s.hz,y+s.y,yaw,s.tag);
    }
    for (const bl of b.blockers) {
      const [cx, cz] = toWorld(x, z, yaw, bl.cx, bl.cz);
      col.addBox(cx, cz, bl.hx, bl.hz, y+(bl.minY??0), y + bl.h, yaw + (bl.rot ?? 0));
    }
    return;
  }
  if (part === 'wall') {
    const box = new THREE.Box3().setFromObject(built.root);
    const hx = (box.max.x - box.min.x) / 2;
    col.addBox(x, z, hx, 0.2, y, y + 2.7, yaw, 'wall');
    if (kind === 'moon') {
      // 月洞门:墙体两段留中间 2.2m 通行。
      col.colliders.pop();
      const gap = 1.15;
      const [ax, az] = toWorld(x, z, yaw, -(gap + (hx - gap) / 2), 0);
      const [bx, bz] = toWorld(x, z, yaw, gap + (hx - gap) / 2, 0);
      col.addBox(ax, az, (hx - gap) / 2, 0.2, y, y + 2.7, yaw, 'wall');
      col.addBox(bx, bz, (hx - gap) / 2, 0.2, y, y + 2.7, yaw, 'wall');
    }
    return;
  }
  if (part === 'taihu') {
    if (kind === 'mound') {
      for (const sx of [-1, 1]) {
        const [cx, cz] = toWorld(x, z, yaw, sx * 1.9, 0);
        col.addCircle(cx, cz, 1.25, y, y + 3, '假山');
      }
    } else {
      const box = new THREE.Box3().setFromObject(built.root);
      const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.36;
      col.addCircle(x, z, r, y, y + (box.max.y - box.min.y), '石');
    }
    return;
  }
  if (part === 'bridge' && kind === 'zigzag') {
    const segs = [
      { x0: -4.5, x1: -0.75, z0: 0, z1: 1.5 },
      { x0: -2.25, x1: 2.25, z0: -1.5, z1: 0 },
      { x0: 0.75, x1: 4.5, z0: 0, z1: 1.5 },
    ];
    for (const s of segs) {
      const [cx, cz] = toWorld(x, z, yaw, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
      col.addPlatform(cx, cz, (s.x1 - s.x0) / 2, (s.z1 - s.z0) / 2, y + 0.35, yaw, '桥面');
    }
    // 踏步。
    for (const sx of [-1, 1]) {
      const [cx, cz] = toWorld(x, z, yaw, sx * 4.7, sx < 0 ? 0.75 : 0.75);
      col.addPlatform(cx, cz, 0.3, 0.75, y + 0.15, yaw, '桥阶');
    }
    // 栏杆:外沿 + 转折处的横档。
    const rails: [number, number, number, number][] = [
      [-4.5, 1.5, -0.75, 1.5],
      [-4.5, 0, -2.25, 0],
      [-2.25, -1.5, 2.25, -1.5],
      [-0.75, 0, 0.75, 0],
      [0.75, 1.5, 4.5, 1.5],
      [2.25, 0, 4.5, 0],
      [-0.75, 0, -0.75, 1.5],
      [-2.25, -1.5, -2.25, 0],
      [2.25, -1.5, 2.25, 0],
      [0.75, 0, 0.75, 1.5],
    ];
    for (const [ax, az, bx, bz] of rails) {
      const [cx, cz] = toWorld(x, z, yaw, (ax + bx) / 2, (az + bz) / 2);
      const len = Math.hypot(bx - ax, bz - az);
      const along = Math.atan2(-(bz - az), bx - ax);
      col.addBox(cx, cz, len / 2, 0.06, y + 0.3, y + 1.0, yaw + along, '桥栏');
    }
    return;
  }
  if (part === 'bamboo' && kind === 'clump') {
    col.addCircle(x, z, 0.4, y, y + 2, '竹');
  }
}
