import * as THREE from 'three';
import type { GameContext } from '@engine/core/Context';
import { buildPart, type PartBuild } from '@builder/parts/registry';
import '@builder/parts/index';
import type { BuildingResult } from '@builder/parts/damu/building';
import { stoneMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { assembleStatic } from '@builder/parts/static-batches';
import { getPlan } from './terrain';
import { requirePlanAnchor, type NamedPlanAnchor } from '@builder/plan/objects';

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
  buildings?: NamedPlanAnchor[];
  rocks?: NamedPlanAnchor[];
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
 * 平移量:旧 64×72m 园子里每簇构件相对该簇参照点的偏移,平移到新 plan
 * 锚点之后原样保留——两套坐标系的轴向与朝向一致(旧世界"+z 朝正门",
 * 新 plan"+z 向南"且正门就在南墙,进园都是从大 z 走向小 z),纯平移不需要
 * 旋转。推导过程见 Task 6 提交信息。
 */
const D_ZHENGMEN: [number, number] = [55, 211.6]; // 旧正门(0,24.4) → 新锚点(55,236)
const D_CUIZHANG: [number, number] = [8, 189]; // 旧假山(0,13.0) → 新锚点(8,202)
const D_QINFANG: [number, number] = [-0.9, 150.4]; // 旧亭(0.9,-2.4) → 新锚点(0,148)
const D_XIAOXIANG: [number, number] = [-114.4, 118.6]; // 旧正房(9.4,-20.6) → 新锚点(-105,98)

const shift = ([x, z]: [number, number], [dx, dz]: [number, number]): [number, number] => [
  x + dx,
  z + dz,
];

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

/** 十七回游线:正门 → 翠嶂 → 沁芳亭桥 → 潇湘馆。 */
const SCENE: Placement[] = [
  // ---- 正门与南墙(锚点 + 平移簇) ----------------------------------
  { part: 'building', variant: 'men', region: 'zhengmen', anchor: 'zhengmen.main-gate', x: 0, z: 0, yaw: 0, tag: '正门' },
  // 只留南墙(六段,紧贴正门的粉墙——plan.json 的 zhengmen.buildings 里确实有
  // 「雪白粉墙·下面虎皮石」这一项)。旧场景里另有六段东西墙,那是旧 64×72m
  // 小镇自己的外边界标记("东西墙(只做南段,北段由林岗围合)"——只框住
  // 门前一小片院子,北边立刻交给地形围合),按簇平移只保留相对位置,新游线
  // 却要从这里一路向西走进几百米外的翠嶂/潇湘馆——机械平移会把"旧世界的
  // 边"焊死在新游线正中间,变成走不过去的墙(键盘试玩当场卡死)。TERRAIN 的
  // 窗口阻挡体已经接管"别让人走出网格"这件事,这六段东西墙没有对应物可留,
  // 直接不放。
  ...(
    [
      ['plain', 10.8, 25.2, 0],
      ['lattice', 16.8, 25.2, 0],
      ['cloud', 23.8, 25.2, 0],
      ['plain', -10.8, 25.2, 0],
      ['lattice', -16.8, 25.2, 0],
      ['cloud', -23.8, 25.2, 0],
    ] as [string, number, number, number][]
  ).map(([variant, x, z, yaw]) => {
    const [wx, wz] = shift([x, z], D_ZHENGMEN);
    return { part: 'wall', variant, x: wx, z: wz, yaw } as Placement;
  }),

  // ---- 翠嶂假山:进门迎面,缝从南入北出(锚点 + 平移簇) ------------
  { part: 'taihu', variant: 'mound', region: 'cuizhang', anchor: 'cuizhang.screen-rocks', x: 0, z: 0, yaw: 0, tag: '翠嶂' },
  { part: 'taihu', variant: 'peak2', ...pt(shift([-6.2, 15.5], D_CUIZHANG)), yaw: 0.6 },
  { part: 'taihu', variant: 'edge3', ...pt(shift([4.4, 10.2], D_CUIZHANG)), yaw: 1.2 },

  // ---- 沁芳亭桥:锚点驱动的亭与桥,曲桥链补足开阔水面 ----------------
  {
    part: 'bridge',
    variant: 'zigzag',
    region: 'qinfang_ting_qiao',
    anchor: 'qinfang_ting_qiao.three-opening-bridge',
    x: 0,
    z: 0,
    yaw: Math.PI / 2,
    y: 0,
    tag: '沁芳桥',
  },
  {
    part: 'building',
    variant: 'ting',
    region: 'qinfang_ting_qiao',
    anchor: 'qinfang_ting_qiao.pavilion',
    x: 0,
    z: 0,
    // 亭子预设 railingSides:['e','w'],开口在 n/s(局部 +Z 世界方向 =
    // (sin yaw, cos yaw),yaw=0 时是 (0,1) 即正南)——桥就在正南方,
    // 零旋转天然对齐桥轴,不是巧合(P-09 教训:阻挡体带旋转、开口对着桥)。
    yaw: 0,
    y: 0,
    pier: true,
    tag: '沁芳亭',
  },
  ...CAUSEWAY,

  // ---- 潇湘馆:院墙 + 月洞门 + 漏窗 + 正房 + 廊 + 竹(锚点 + 平移簇) --
  // 已知冲突①(报告不修):正房锚点(-105,98)脚下 6m 见方内有 1.30m 高差,
  // 来源是 plan.water 的「潇湘馆穿院引泉沟」。建筑自己的台基(platform)
  // 把落脚面钉死平,穿沟的落差留给地形——不挪锚点。
  { part: 'building', variant: 'tang', region: 'xiaoxiangguan', anchor: 'xiaoxiangguan.main-house', x: 0, z: 0, yaw: 0, tag: '潇湘馆' },
  ...(
    [
      ['wall', 'plain', 2.6, -13.5, 0, undefined],
      ['wall', 'moon', 8.6, -13.5, 0, '潇湘馆月洞门'],
      ['wall', 'lattice:wan', 14.6, -13.5, 0, undefined],
      ['wall', 'plain', 17.6, -16.5, Math.PI / 2, undefined],
      ['wall', 'plain', 17.6, -22.5, Math.PI / 2, undefined],
      ['wall', 'cloud', -0.4, -17.5, -Math.PI / 2, undefined],
      ['wall', 'plain', -0.4, -23.5, -Math.PI / 2, undefined],
      ['wall', 'plain', 5.6, -26.5, 0, undefined],
      ['wall', 'plain', 11.6, -26.5, 0, undefined],
      ['building', 'lang', 2.4, -20.0, Math.PI / 2, '潇湘馆西廊'],
      ['taihu', 'peak4', 5.0, -17.0, 0.4, undefined],
    ] as [string, string, number, number, number, string | undefined][]
  ).map(([part, variant, x, z, yaw, tag]) => {
    const [wx, wz] = shift([x, z], D_XIAOXIANG);
    return { part, variant, x: wx, z: wz, yaw, tag } as Placement;
  }),
  ...(
    [
      ['grove', 14.2, -17.6],
      ['clump', 4.6, -15.6],
      ['clump', 12.6, -24.4],
      ['grove', 20.5, -20.0],
      ['clump', -3.4, -15.2],
      ['clump', -6.0, -12.0],
      ['clump', 11.8, -9.6],
    ] as [string, number, number][]
  ).map(([variant, x, z]) => {
    const [wx, wz] = shift([x, z], D_XIAOXIANG);
    return { part: 'bamboo', variant, x: wx, z: wz } as Placement;
  }),
];

/** 世界坐标 helper,给 spread 用。 */
function pt([x, z]: [number, number]): { x: number; z: number } {
  return { x, z };
}

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

export function buildGarden(ctx: GameContext): void {
  const ground = ctx.collision.terrainHeight;
  const pond = pondEllipse();

  // 沁芳亭桥一带的驳石(taihu peak/peak3),按旧簇平移后落进了新南池的开阔
  // 水面(旧池半径~9m,新池半径~30余m,平移不会自动落岸)——沿它们原来
  // 相对池心的方向,重新钉到刚露出水面的岸边,而不是任由它们沉在水底。
  const qinfangCenter = shift([0.6, -1.6], D_QINFANG); // 旧 POND.cx/cz 平移后的参照点
  const peakRaw = shift([8.4, 1.6], D_QINFANG);
  const peak3Raw = shift([-8.2, -6.4], D_QINFANG);
  const [peakX, peakZ] = shoreTowards(qinfangCenter, peakRaw, ground, 60);
  const [peak3X, peak3Z] = shoreTowards(qinfangCenter, peak3Raw, ground, 60);

  const causewayEnds: [number, number][] = [
    [-2.7, 171.3],
    [0, 156.5],
    [0, 146],
    [-40, 128],
  ];

  const all: Placement[] = [
    ...SCENE,
    { part: 'taihu', variant: 'peak', x: peakX, z: peakZ, yaw: 2.4 },
    { part: 'taihu', variant: 'peak3', x: peak3X, z: peak3Z, yaw: -1.1 },
    ...shoreStones(ground, pond, causewayEnds),
  ];

  const cache = new Map<string, PartBuild>();
  const updaters: ((dt: number, t: number) => void)[] = [];
  const stone = stoneMaterial(1);
  const group = new THREE.Group();
  group.name = 'Garden';
  ctx.scene.add(group);
  // 静态件(墙/石/桥/屋)先收进这里,最后按材质合并;会动的(竹)直接进 group。
  const staticGroup = new THREE.Group();

  let calls = 0;
  for (const p of all) {
    const key = `${p.part}:${p.variant ?? 'default'}`;
    let part = cache.get(key);
    let fresh = false;
    if (!part) {
      part = buildPart(p.part, p.variant) ?? undefined;
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
    }
    calls++;
    const [wx, wz] = resolvePosition(p);
    const yaw = p.yaw ?? 0;
    const y = p.y ?? ground(wx, wz) + (p.dy ?? 0);
    const obj = fresh ? part.root : part.root.clone();
    obj.position.set(wx, y, wz);
    obj.rotation.y = yaw;
    obj.name = p.tag ?? key;
    if (part.update) group.add(obj);
    else staticGroup.add(obj);

    registerColliders(ctx, p.part, p.variant ?? 'default', part, wx, y, wz, yaw);

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
  if (part === 'building') {
    const b = built as BuildingResult;
    col.addPlatform(x, z, b.platform.hx, b.platform.hz, y + b.platform.y, yaw, '台基');
    for (const bl of b.blockers) {
      const [cx, cz] = toWorld(x, z, yaw, bl.cx, bl.cz);
      col.addBox(cx, cz, bl.hx, bl.hz, y, y + bl.h, yaw + (bl.rot ?? 0));
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
