import { locatePoint } from '@builder/plan/geometry';
import { scatterHash01 } from '@engine/scatter/index';
import type { OccupancyField, Point2 } from './occupancy';
import type { RegionScene } from './scenes';

/**
 * scatter-along-path.ts —— 接缝②的第一条规则:**沿一条 plan 路的两边种东西**
 * （单子 AL3）。
 *
 * `projects/daguanyuan/scenes/<region>.json` 的 `scatters[]` 从单子 Y 起就在
 * 契约里（`check:scenes` 校验它「只写条件不写坐标」），但**全仓没有任何代码
 * 消费它**——写得出来、落不下去。这一份让它第一次被消费。
 *
 * **只认一条规则 `rule: "along-path"`。** 不做通用散布 DSL（`D-18`
 * 「别让 compiler 吞掉大观园」）：一种 rule、一个函数，够用为止。下一条规则
 * 来的时候再加下一个函数，不要先造一台能表达所有规则的机器。
 *
 * **为什么单独一个模块、不写在 `composer.ts` 里**：`composer.ts` 进不了 node
 * （`builder/parts/index.ts` 用了 `import.meta.glob`），而 `check:scenes` 要能
 * 当场报「这条 scatter 会落多少个点」——那道门不起浏览器。所以把**纯几何**
 * 这一半单独放这儿：只吃 plan / scenes / 占位场 / 一个地表材质回调，不碰
 * THREE，node 与游戏读的是同一份。构件那一半（竹子怎么长）留在 `composer.ts`。
 *
 * 这一条规则本身写的是**条件**不是坐标：哪条路、离路多远、多大丛距、种在哪
 * 一侧、抖多少、围在哪条线性里面。坐标是算出来的。
 */

/** `scatters[]` 里 `rule: "along-path"` 那一条的形状。 */
export interface AlongPathScatter {
  part: string;
  rule: string;
  /** plan `paths[]` 的稳定 id。 */
  path: string;
  /** 只种在这条 plan 线性围出的多边形里（潇湘馆用院墙）。不给就不限。 */
  within?: string;
  /** 离路心的横向偏移（米）。 */
  offset_m: number;
  /** 沿路的丛距（米）。 */
  pitch_m: number;
  /** `both` / `left` / `right`。缺省 `both`。 */
  sides?: string;
  /** 抖动幅度（米）。**只沿路抖、只向外抖**，见下面 `jitter` 那一段。 */
  jitter_m?: number;
  /**
   * 视线让位（单子 AL-b b4，`D-32` ①）：丛心离「`from` → `to` 这条视线段」不足 `clear_m`
   * 的不种。`from` / `to` 写 plan 里建筑的 id（取它的 x/z），**不写坐标**——
   * 月洞门或正房挪了，缝跟着走。透视缝净宽 ≈ 2 × `clear_m`。
   */
  sightline?: { from: string; to: string; clear_m: number };
  basis?: string;
}

export interface AlongPathSeed {
  region: string;
  part: string;
  /** 世界坐标。 */
  x: number;
  z: number;
  /** 路心方向的方位角 `atan2(dz, dx)`——「夹」要的那个倾向。 */
  leanAz: number;
  /** 在路的哪一侧（+1 / −1）。 */
  side: number;
  /** 沿路里程（米）。 */
  s: number;
}

export interface AlongPathResult {
  region: string;
  rule: AlongPathScatter;
  seeds: AlongPathSeed[];
  /** 一共试了几个点（站 × 侧）。 */
  tried: number;
  rejected: { outside: number; wall: number; building: number; paving: number; sightline: number };
}

interface PathLite {
  id?: string;
  points: [number, number][];
}
interface PlanLite {
  paths?: PathLite[];
  regions: {
    id: string;
    linears?: { id: string; points?: [number, number][] }[];
    buildings?: { id: string; x: number; z: number }[];
  }[];
}

/** 点到线段的距离。 */
function distToSegment(x: number, z: number, a: Point2, b: Point2): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const l2 = ex * ex + ez * ez;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / l2));
  return Math.hypot(x - (a[0] + ex * t), z - (a[1] + ez * t));
}

/** 点到闭合环各边的最短距离（不分内外）。 */
function distToRing(x: number, z: number, ring: readonly Point2[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return best;
}

/** 落在环里（含边上）就算在里面。 */
function inRing(x: number, z: number, ring: readonly Point2[]): boolean {
  return locatePoint(ring as [number, number][], [x, z]) !== 'outside';
}

export interface AlongPathEnv {
  occupancy: OccupancyField;
  /**
   * 地表材质。给了才执行「不许压到路面」那一条；`check:scenes` 也给得起
   * （`makeTerrainField` 是纯函数），所以门报的数与世界里长出来的一样。
   */
  surface?: (x: number, z: number) => string;
  /**
   * 丛的实体半径（茎干展开 + 倾斜横移），问墙与房子用。与 `occupancy.ts`
   * 的 `SOLID_RADIUS` 同一个口径——那道 `AF` 门就是拿这个数去问墙的。
   */
  solidRadius: number;
  /**
   * 竿脚本身的散布半径，问铺装用。**不能用 `solidRadius`**：那个数把「竿在
   * 4~6m 高上倾出去的横移」也算进去了，而探出去的竹梢压在路面上空正是
   * 「夹路」要的景，竿脚踩在石子漫上才是缺陷。
   */
  footRadius: number;
  /** 离建筑檐口外包络至少让开这么多米。 */
  buildingPad: number;
}

/**
 * 算出每条 `along-path` 规则会落在哪些点。**纯函数**：同一份数据必然给出
 * 同一批点（抖动走坐标哈希，不吃顺序 rng，`P-28` 那条教训）。
 */
export function alongPathScatter(
  plan: unknown,
  scenes: readonly RegionScene[],
  builtRegions: readonly string[],
  env: AlongPathEnv,
): AlongPathResult[] {
  const p = plan as PlanLite;
  const built = new Set(builtRegions);
  const out: AlongPathResult[] = [];

  const buildings = env.occupancy.occupants().filter((o) => o.kind === 'building');

  for (const scene of scenes) {
    if (!built.has(scene.region)) continue;
    for (const raw of scene.scatters ?? []) {
      if (raw.rule !== 'along-path') continue;
      const rule = raw as unknown as AlongPathScatter;
      const path = (p.paths ?? []).find((x) => x.id === rule.path);
      if (!path || path.points.length < 2) continue;

      let within: Point2[] | null = null;
      if (rule.within) {
        for (const r of p.regions)
          for (const l of r.linears ?? [])
            if (l.id === rule.within && l.points && l.points.length > 2) within = l.points as Point2[];
      }

      let sight: { a: Point2; b: Point2; clear: number } | null = null;
      if (rule.sightline) {
        const find = (id: string): Point2 | null => {
          for (const r of p.regions) for (const b of r.buildings ?? []) if (b.id === id) return [b.x, b.z];
          return null;
        };
        const a = find(rule.sightline.from);
        const b = find(rule.sightline.to);
        // 引用解析不出来就当场抛：让位条件悄悄失效，比报错更糟（缝没了、门还是绿的）。
        if (!a || !b) throw new Error(`along-path sightline 引用的建筑不存在：${rule.sightline.from} → ${rule.sightline.to}`);
        sight = { a, b, clear: rule.sightline.clear_m };
      }

      const sides = rule.sides === 'left' ? [1] : rule.sides === 'right' ? [-1] : [1, -1];
      const jitter = rule.jitter_m ?? 0;
      const res: AlongPathResult = {
        region: scene.region,
        rule,
        seeds: [],
        tried: 0,
        rejected: { outside: 0, wall: 0, building: 0, paving: 0, sightline: 0 },
      };

      // 累计里程表：一次走完折线，之后按里程取点。
      const pts = path.points;
      const segLen: number[] = [];
      let total = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        segLen.push(d);
        total += d;
      }
      /** 里程 → 站点与单位切向。 */
      const at = (s: number): { x: number; z: number; tx: number; tz: number } => {
        let rest = Math.max(0, Math.min(total, s));
        for (let i = 0; i < segLen.length; i++) {
          if (rest > segLen[i] && i < segLen.length - 1) {
            rest -= segLen[i];
            continue;
          }
          const f = segLen[i] < 1e-9 ? 0 : rest / segLen[i];
          const tx = (pts[i + 1][0] - pts[i][0]) / (segLen[i] || 1);
          const tz = (pts[i + 1][1] - pts[i][1]) / (segLen[i] || 1);
          return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, z: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f, tx, tz };
        }
        return { x: pts[0][0], z: pts[0][1], tx: 0, tz: 1 };
      };

      for (let s = rule.pitch_m * 0.5; s < total; s += rule.pitch_m) {
        for (const side of sides) {
          res.tried++;
          /*
           * jitter：**只沿路抖、只向外抖**。
           *
           * 横向往里抖会把丛推进路心那条 1.4m 宽的走道里——人过不去，
           * 自动试玩当场卡死。所以横向只朝外（0…jitter×0.5），
           * 保证两侧丛心的净距永远不小于 2 × offset_m。
           * 抖动量走坐标哈希不走顺序 rng：改一处密度不重洗别处（`P-28`）。
           */
          const base = at(s);
          const h1 = scatterHash01(base.x + side * 7.3, base.z - side * 3.1);
          const h2 = scatterHash01(base.x - side * 11.9, base.z + side * 5.7);
          const st = at(s + (h1 * 2 - 1) * jitter);
          const off = rule.offset_m + h2 * jitter * 0.5;
          // 法向 = 切向左转 90°。
          const nx = -st.tz * side;
          const nz = st.tx * side;
          const x = st.x + nx * off;
          const z = st.z + nz * off;

          if (within && !inRing(x, z, within)) {
            res.rejected.outside++;
            continue;
          }
          if (sight && distToSegment(x, z, sight.a, sight.b) < sight.clear) {
            res.rejected.sightline++;
            continue;
          }
          if (env.occupancy.wallIntrusion(x, z, env.solidRadius)) {
            res.rejected.wall++;
            continue;
          }
          let hitBuilding = false;
          for (const b of buildings) {
            if (inRing(x, z, b.polygon) || distToRing(x, z, b.polygon) < env.solidRadius + env.buildingPad) {
              hitBuilding = true;
              break;
            }
          }
          if (hitBuilding) {
            res.rejected.building++;
            continue;
          }
          if (env.surface) {
            // 竿脚那一圈都不许踩在铺装上——路面上不长竹（竹梢探过去是另一回事）。
            const r = env.footRadius;
            const probes: [number, number][] = [
              [x, z],
              [x + r, z],
              [x - r, z],
              [x, z + r],
              [x, z - r],
            ];
            if (probes.some(([px, pz]) => env.surface!(px, pz) === 'stone')) {
              res.rejected.paving++;
              continue;
            }
          }

          res.seeds.push({
            region: scene.region,
            part: rule.part,
            x,
            z,
            // 倾向路心：从丛心指回站点。
            leanAz: Math.atan2(st.z - z, st.x - x),
            side,
            s,
          });
        }
      }
      out.push(res);
    }
  }
  return out;
}
