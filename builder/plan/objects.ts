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
