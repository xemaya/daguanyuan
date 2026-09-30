/**
 * scenes.ts —— 一个区一份落位清单的契约与注入口（单子 Y，接缝 ①）。
 *
 * 为什么要有这一层：`composer.ts` 以前持有一张 689 行文件里的手写 `SCENE`
 * 常量，于是「加一个区」要改 `.ts`。而那张表里一半条目是零信息量的——
 * `garden-building` / `garden-wall` / `garden-corridor` / `garden-bridge` 四个
 * 计划驱动件的 `variant` 就是 `plan.json` 里对象的稳定 id，尺寸从该对象的
 * `construction.spec` 读，坐标从 plan 的锚点读，**没有携带任何 plan 里没有
 * 的信息**。这类条目应当由一次 plan 遍历生成，不需要任何人手写。
 *
 * 真正需要人写的是两类，都住在 `projects/daguanyuan/scenes/<region>.json`：
 *   - `named[]`：plan 点名了位置、但构件推不出来的（正门是 frame-ready，
 *     P3 分件未完，暂用通用门构件顶替；翠嶂用 taihu:mound 顶替一堆山石）。
 *     **位置仍然从 plan 读**，这里只绑构件。
 *   - `placements[]`：plan 里根本没有锚点的散置件（散石、竹丛、灯）。
 *     **坐标一律相对锚点**——`D_ZHENGMEN` 那四个批量平移常量是「旧世界补丁」，
 *     它们存在的每一天都在等着制造下一个「竹子进屋」。
 *   - `scatters[]`：只写条件不写坐标，让散布器算。**本单子只定形状，
 *     实现归单子 Z（接缝 ②）。**
 *
 * 注入而不是 import：`check:layers` 不许 `builder/` import `@project/`，
 * 所以 `main.ts` 在 `world.build()` 之前调 `setScenes()`，与 `terrain.ts` 的
 * `setPlan()` 同一路数。
 */

import { locatePoint } from '@builder/plan/geometry';
/**
 * `SPECIES_INDEX` 是「哪些树种真的有骨架」的真源，在 `vegetation.ts` 里。
 * 这条 import 与 `vegetation.ts` 里那条 `getScenes()` 构成一个**循环依赖**，
 * 是有意为之、而且实测安全：两边在**模块初始化期都不碰对方**——`SPECIES_INDEX`
 * 只在 `validateScenes()` 的函数体里读，`getScenes()` 只在 `buildVegetation()`
 * 里调。两个入口（`main.ts` 先进 vegetation、`tools/check-scenes.mjs` 先进
 * scenes）都跑过。换成在这里手抄一份种名清单才是真的坏：两份清单迟早对不上，
 * 而对不上的那天没人知道哪一份是对的（`tools/shot-list.mjs` 头注里的同一条教训）。
 */
import { SPECIES_INDEX } from '@builder/parts/zhiwu/vegetation';

/**
 * **点名种的树**（单子 AV2）。
 *
 * 为什么它是这一层里唯一写世界绝对坐标的东西：树没有锚点。`placements[]` 的
 * 「一律相对锚点」治的是 99-25 那笔债——房子一挪，贴着它的竹子该跟着挪；而一棵
 * 「落在某组峰东侧五米、朝峰倾十度」的松，它的参照物是**那一组峰**，峰是
 * `named[]`/`placements[]` 上的构件，不是 plan 的可锚对象（plan 的 `rocks[]` 只有
 * 一个点代表整座翠嶂）。拿 `cuizhang.screen-rocks` 当锚点写 dx/dz 会假装它跟着
 * 那个点走，而六组峰各在各的位置上——那是一条**会骗人的**相对坐标。老的
 * `HERO_TREES` 本来就是绝对坐标写在 `.ts` 里，这里只是把它搬进数据、并要求写 basis。
 *
 * 校验（`validateScenes`）：种在 `SPECIES_INDEX` 里、坐标落在本区多边形内、
 * 有 tag 有 basis。**「峰前 6 m 内不种」「山上不超过 12 棵」这类判据不在这里**——
 * 那是 `tools/tree-census.mjs` 从**跑起来的世界**里数出来的，数据层看不见散布器
 * 会不会自己在那儿长一棵。
 */
export interface SceneTree {
  /** 世界绝对坐标（见上：树没有锚点）。 */
  x: number;
  z: number;
  /** `vegetation.ts` 的 `SPECIES_INDEX` 键。 */
  species: string;
  /** 缺省走散布器那条随机尺度；点名树给定值，免得改一次种子它就换个高矮。 */
  scale?: number;
  /** 倾角（弧度）。 */
  tilt?: number;
  /**
   * 倾向的方位。约定与 `vegetation.ts` 组装实例矩阵那一段一致：
   * 树顶倒向 `(-sin(tiltAz), cos(tiltAz))`。要倒向一点 (px,pz)，
   * 取 `tiltAz = atan2(-(px-x), pz-z)`。
   */
  tiltAz?: number;
  tag: string;
  basis: string;
}

export interface ScenePlacement {
  part: string;
  variant?: string;
  /** 本区 plan 对象（buildings / rocks / linears）的稳定 id。 */
  anchor: string;
  /** 相对锚点的偏移。不许写世界绝对坐标（`validateScenes` 拦着）。 */
  dx: number;
  dz: number;
  /** 绕 Y 的朝向（弧度），0 = 构件正面朝南(+Z)。 */
  yaw?: number;
  /** 相对地面的抬升。 */
  dy?: number;
  /** 出处。艺术选择也行，**写出来就行，不写不许进**（与 plan.json 同口径）。 */
  basis: string;
  tag?: string;
}

export interface SceneNamed {
  /** plan 对象的稳定 id；位置从 plan 的 x/z 读，这里只绑构件。 */
  object: string;
  part: string;
  variant?: string;
  yaw?: number;
  dy?: number;
  y?: number;
  pier?: boolean;
  basis: string;
  tag?: string;
}

/**
 * 不种东西的地（单子 Z，接缝 ③）。
 *
 * 建筑的占地是**推导**出来的（`occupancy.ts` 从 `construction.spec` 编译檐口
 * 外包络），不需要写在这里。这里写的是 plan 说不出来的那类取舍：门外甬道
 * 要留净空、院内这块地留给点名竹、假山占多大。**同样相对锚点**——房子一挪，
 * 它跟着挪，这正是 99-25 那笔债的修法。
 */
export interface SceneClearance {
  anchor: string;
  dx: number;
  dz: number;
  /** 半宽 / 半深（米），轴对齐。 */
  hx: number;
  hz: number;
  basis: string;
  tag?: string;
}

/**
 * 「这个 plan 对象的实体在别处」（单子 Z）。
 *
 * plan 的 `rocks[]` 里有一半根本不是要摆的石头，是对别处实现的标注：
 * `zhengmen.rock-01` 是「虎皮石墙基」（墙构件自带的基座）、
 * `xiaoxiangguan.rock-01` 是「石子漫成甬路」（铺装）、
 * `cuizhang.rock-03` 是「西山口·羊肠小径」（石栈桥）。
 * 拿太湖石去把它们摆出来是**伪造覆盖率**——地上会多出三块本不该有的石头。
 *
 * 但也不能让对账门静默豁免它们。所以做成一条**写出来、可复核的声明**：
 * `by` 说实体是什么，`basis` 说凭什么这么认（最好是能复验的观测，
 * 不是「我觉得」）。对账门把它们单列一栏打印，永远看得见。
 */
export interface SceneAccountedFor {
  /** plan 对象的稳定 id。 */
  object: string;
  /** 它的实体实际上是什么。 */
  by: string;
  basis: string;
}

/** 单子 Z 的入口。Y 只让它通过校验、不消费。 */
export interface SceneScatter {
  part: string;
  rule: string;
  [key: string]: unknown;
}

export interface RegionScene {
  region: string;
  $comment?: string;
  named?: SceneNamed[];
  trees?: SceneTree[];
  placements?: ScenePlacement[];
  clearances?: SceneClearance[];
  accountedFor?: SceneAccountedFor[];
  scatters?: SceneScatter[];
}

/** plan 里跟落位有关的那一小块，单独声明，免得 scenes 去认整个 GardenPlan。 */
interface AnchorablePlan {
  regions: {
    id: string;
    /** 区轮廓。点名树的坐标要落在它里面（单子 AV2）。 */
    polygon?: [number, number][];
    buildings?: { id: string }[];
    rocks?: { id: string }[];
    linears?: { id: string }[];
  }[];
}

let injected: RegionScene[] | undefined;

export function setScenes(list: RegionScene[]): void {
  injected = list;
}

export function getScenes(): RegionScene[] {
  if (!injected) {
    throw new Error(
      '[scenes] 未注入：main.ts 必须在 world.build() 之前调用 setScenes()（builder/ 不许 import @project/，见 check:layers）',
    );
  }
  return injected;
}

/** 某个区的落位清单；没有就返回一份空的（未建区、或这个区不需要散置件）。 */
export function sceneFor(region: string): RegionScene {
  return getScenes().find((s) => s.region === region) ?? { region };
}

/** 本区所有可用作锚点的 plan 对象 id。 */
function anchorIds(plan: AnchorablePlan, region: string): Set<string> {
  const r = plan.regions.find((x) => x.id === region);
  if (!r) return new Set();
  return new Set([
    ...(r.buildings ?? []).map((o) => o.id),
    ...(r.rocks ?? []).map((o) => o.id),
    ...(r.linears ?? []).map((o) => o.id),
  ]);
}

/** 绝对坐标字段黑名单：写了这些就是在绕开「一律相对锚点」这条纪律。 */
const ABSOLUTE_FIELDS = ['x', 'z', 'position', 'world'];

/**
 * 契约校验。返回失败消息数组（空数组 = 通过），不抛异常——
 * `check:scenes` 要一次把所有问题列全，不是遇到第一个就停。
 */
export function validateScenes(scenes: RegionScene[], plan: unknown): string[] {
  const p = plan as AnchorablePlan;
  const fails: string[] = [];
  const seen = new Set<string>();
  for (const scene of scenes) {
    const where = `scenes/${scene.region}.json`;
    if (!scene.region) { fails.push(`${where}：缺 region 字段`); continue; }
    if (seen.has(scene.region)) fails.push(`${where}：region ${scene.region} 有两份清单`);
    seen.add(scene.region);
    if (!p.regions.some((r) => r.id === scene.region)) {
      fails.push(`${where}：plan 里没有区 ${scene.region}`);
      continue;
    }
    const anchors = anchorIds(p, scene.region);

    for (const [i, n] of (scene.named ?? []).entries()) {
      const tag = `${where} named[${i}]`;
      if (!n.object) { fails.push(`${tag}：缺 object`); continue; }
      if (!anchors.has(n.object)) fails.push(`${tag}：${n.object} 不在本区的 plan 对象里`);
      if (!n.part) fails.push(`${tag}：缺 part`);
      if (!n.basis) fails.push(`${tag}：缺 basis——点名件绑哪个构件是一次取舍，写出来就行，不写不许进`);
      for (const f of ABSOLUTE_FIELDS)
        if (f in (n as unknown as Record<string, unknown>))
          fails.push(`${tag}：写了 ${f}——点名件的位置从 plan 读，不许在这里覆盖世界绝对坐标`);
    }

    const regionPoly = p.regions.find((r) => r.id === scene.region)?.polygon;
    for (const [i, t] of (scene.trees ?? []).entries()) {
      const tag = `${where} trees[${i}]`;
      if (!t.species) fails.push(`${tag}：缺 species`);
      else if (!(t.species in SPECIES_INDEX))
        fails.push(`${tag}：species ${t.species} 不在 vegetation.ts 的 SPECIES_INDEX 里——骨架没做的种不许点名，落代关系写进 knowledge/docs/plants/00-catalog.md`);
      if (!Number.isFinite(t.x) || !Number.isFinite(t.z)) fails.push(`${tag}：x/z 必须是有限数`);
      else if (regionPoly && locatePoint(regionPoly, [t.x, t.z]) === 'outside')
        fails.push(`${tag}：(${t.x},${t.z}) 落在区 ${scene.region} 的多边形外`);
      if (!t.tag) fails.push(`${tag}：缺 tag——点名树要能在回报与普查里被指名道姓`);
      if (!t.basis) fails.push(`${tag}：缺 basis——种一棵树在哪、朝哪倾是一次取舍，写出来就行，不写不许进`);
    }

    for (const [i, pl] of (scene.placements ?? []).entries()) {
      const tag = `${where} placements[${i}]`;
      if (!pl.part) fails.push(`${tag}：缺 part`);
      if (!pl.anchor) fails.push(`${tag}：缺 anchor——落位一律相对锚点`);
      else if (!anchors.has(pl.anchor)) fails.push(`${tag}：锚点 ${pl.anchor} 不在本区的 plan 对象里`);
      if (!Number.isFinite(pl.dx) || !Number.isFinite(pl.dz)) fails.push(`${tag}：dx/dz 必须是有限数`);
      if (!pl.basis) fails.push(`${tag}：缺 basis——摆一块石头是艺术选择也行，写出来就行，不写不许进`);
      for (const f of ABSOLUTE_FIELDS)
        if (f in (pl as unknown as Record<string, unknown>))
          fails.push(`${tag}：写了 ${f}——不许写世界绝对坐标，只许 anchor + dx/dz`);
    }

    for (const [i, c] of (scene.clearances ?? []).entries()) {
      const tag = `${where} clearances[${i}]`;
      if (!c.anchor) fails.push(`${tag}：缺 anchor——净空一律相对锚点，房子挪了它才会跟着挪`);
      else if (!anchors.has(c.anchor)) fails.push(`${tag}：锚点 ${c.anchor} 不在本区的 plan 对象里`);
      for (const f of ['dx', 'dz', 'hx', 'hz'] as const)
        if (!Number.isFinite(c[f])) fails.push(`${tag}：${f} 必须是有限数`);
      if (c.hx <= 0 || c.hz <= 0) fails.push(`${tag}：hx/hz 是半宽半深，必须为正`);
      if (!c.basis) fails.push(`${tag}：缺 basis——「这块地不种」是一次取舍，写出来就行，不写不许进`);
      for (const f of ABSOLUTE_FIELDS)
        if (f in (c as unknown as Record<string, unknown>))
          fails.push(`${tag}：写了 ${f}——不许写世界绝对坐标，只许 anchor + dx/dz`);
    }

    for (const [i, a] of (scene.accountedFor ?? []).entries()) {
      const tag = `${where} accountedFor[${i}]`;
      if (!a.object) { fails.push(`${tag}：缺 object`); continue; }
      if (!anchors.has(a.object)) fails.push(`${tag}：${a.object} 不在本区的 plan 对象里`);
      if (!a.by) fails.push(`${tag}：缺 by——必须说清实体到底是什么，不能只说「在别处」`);
      if (!a.basis) fails.push(`${tag}：缺 basis——凭什么这么认，最好是能复验的观测`);
      if ((scene.named ?? []).some((n) => n.object === a.object))
        fails.push(`${tag}：${a.object} 同时出现在 named 里——要么有实体要么在别处，不能两头占`);
    }

    for (const [i, sc] of (scene.scatters ?? []).entries()) {
      const tag = `${where} scatters[${i}]`;
      if (!sc.part) fails.push(`${tag}：缺 part`);
      if (!sc.rule) fails.push(`${tag}：缺 rule`);
      for (const f of [...ABSOLUTE_FIELDS, 'dx', 'dz'])
        if (f in sc) fails.push(`${tag}：写了 ${f}——scatters 不写坐标，只写条件（接缝 ②）`);
    }
  }
  return fails;
}
