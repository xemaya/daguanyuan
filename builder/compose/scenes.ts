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
  placements?: ScenePlacement[];
  scatters?: SceneScatter[];
}

/** plan 里跟落位有关的那一小块，单独声明，免得 scenes 去认整个 GardenPlan。 */
interface AnchorablePlan {
  regions: {
    id: string;
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
