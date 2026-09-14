import { getPlan } from '../compose/terrain';

/** Stable identities for plan objects. Human titles may change as research is
 * refined; they must never silently select a different building or rock.
 */
export const PLAN_OBJECT_KINDS = [
  'building', 'corridor', 'wall', 'fence', 'railing', 'path', 'pergola',
  'platform', 'steps', 'bridge', 'watergate', 'cave', 'dock', 'prop',
  'stone-archway', 'opening', 'planting',
] as const;
export type PlanObjectKind = typeof PLAN_OBJECT_KINDS[number];
export interface NamedPlanAnchor {
  id: string;
  name: string;
  x: number;
  z: number;
}
export interface PlanObject extends NamedPlanAnchor {
  kind: PlanObjectKind;
  /** Legacy author input. Only building specs may interpret this as wood bays;
   * bridge openings and stone archways need their own structural contracts.
   */
  bays: number;
  roof: string;
}
export interface AnchorRegion {
  id: string;
  buildings?: NamedPlanAnchor[];
  rocks?: NamedPlanAnchor[];
}

export function requirePlanAnchor(region: AnchorRegion, id: string): NamedPlanAnchor {
  if (!id.startsWith(`${region.id}.`)) throw new Error(`[plan] ${id} 不属于区域 ${region.id}`);
  const matches = [...region.buildings ?? [], ...region.rocks ?? []].filter(p => p.id === id);
  if (matches.length !== 1) throw new Error(`[plan] ${id} 必须唯一，实际找到 ${matches.length} 个锚点`);
  const anchor = matches[0];
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.z)) throw new Error(`[plan] ${id} 坐标非法`);
  return anchor;
}

/**
 * 匾额文字的单一真源是 plan.json 的 regions[].buildings[].plaque(missing 99-26):
 * 构件与预设不写字面量,按稳定 id 来这里取;取到 null 就是不挂——
 * 屏幕上少一块匾是数据的话,不是构件的话。
 * plan 未注入时(棚拍台之外的环境、纯推导单测)返回 undefined,同样不回落字面量。
 */
export function plaqueFromPlan(objectId: string): string | undefined {
  let plan: unknown;
  try {
    plan = getPlan();
  } catch {
    return undefined;
  }
  const regions = (plan as { regions?: { buildings?: { id: string; plaque?: string | null }[] }[] }).regions ?? [];
  for (const region of regions) {
    const hit = (region.buildings ?? []).find((b) => b.id === objectId);
    if (hit) return hit.plaque ?? undefined;
  }
  return undefined;
}

/**
 * 种植带(PQ-4 / A4):「花池」的唯一真源是 plan.json 里 `kind:'planting'` 的条目
 * (regions[].buildings[] 与 routeFeatures[] 两处都收)。条目带 `bed` 才落地成花:
 * `polygon` 给范围(缺省 = 以条目 x/z 为心、`radius` 米的圆),`tints` 给花色,
 * `density` 0–1 乘进散布密度。与 PE 的种植数据是同一套:`regions[].plants`
 * 记「这个区有什么植物」(名目),planting 条目记「种在哪」(位置),不另造体系。
 */
export interface PlantingBed {
  id: string;
  name?: string;
  x: number;
  z: number;
  /** 世界坐标闭合环;缺省时以 (x,z) 为心、radius 为半径。 */
  polygon?: [number, number][];
  radius?: number;
  /** 花色 hex 字符串(如 '#f25d7a'),逐色分桶实例化。 */
  tints?: string[];
  density?: number;
  basis?: string;
}

export function bedsFromPlan(): PlantingBed[] {
  let plan: unknown;
  try {
    plan = getPlan();
  } catch {
    return [];
  }
  const p = plan as {
    regions?: { buildings?: unknown[] }[];
    routeFeatures?: unknown[];
  };
  const out: PlantingBed[] = [];
  const push = (e: unknown): void => {
    const o = e as PlantingBed & { kind?: string; bed?: Partial<PlantingBed>; at?: [number, number] };
    if (o?.kind !== 'planting' || !o.bed) return;
    // regions[].buildings 用 x/z,routeFeatures 用 at:[x,z]。
    const x = Number.isFinite(o.x) ? o.x : o.at?.[0];
    const z = Number.isFinite(o.z) ? o.z : o.at?.[1];
    if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) return;
    out.push({
      id: o.id,
      name: o.name,
      x,
      z,
      polygon: o.bed.polygon,
      radius: o.bed.radius,
      tints: o.bed.tints,
      density: o.bed.density,
      basis: o.basis,
    });
  };
  for (const r of p.regions ?? []) for (const b of r.buildings ?? []) push(b);
  for (const f of p.routeFeatures ?? []) push(f);
  return out;
}

export function validatePlanObjects(regions: AnchorRegion[]): string[] {
  const errors: string[] = [], ids = new Set<string>();
  for (const r of regions) {
    for (const anchor of [...r.buildings ?? [], ...r.rocks ?? []]) {
      if (typeof anchor.id !== 'string' || !anchor.id.startsWith(`${r.id}.`))
        errors.push(`${r.id}/${anchor.name} 缺少本区稳定 id`);
      if (ids.has(anchor.id)) errors.push(`重复对象 id：${anchor.id}`);
      ids.add(anchor.id);
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.z)) errors.push(`${anchor.id} 坐标非法`);
    }
    for (const b of r.buildings ?? []) {
      const object = b as PlanObject;
      if (!PLAN_OBJECT_KINDS.includes(object.kind)) errors.push(`${object.id} 构件 kind 非法`);
    }
  }
  return errors;
}
