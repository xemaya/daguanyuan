import { getPlan } from '@builder/compose/terrain';
import { makeTerrainField, type GardenPlan } from '@builder/compose/terrain-from-plan';
import { SEED } from '@builder/compose/config';

/**
 * 乡野构件从 plan.json 取数的唯一入口(按稳定 id)。builder 不许 import 项目数据
 * (`check:layers`),所以同 `plaqueFromPlan` 一样走 `getPlan()`——棚拍台与世界都在建件前注入过。
 * 取不到就抛:不回落成字面量,不替换成别的房子。
 */
export type P2 = [number, number];
/** plan 里墙与篱共用的走线:`layout.runs[]` 折线 + 可选的 `openings[]`。 */
export interface PlanRun { points: P2[]; widthM: number; heightM: number; elevationsM?: number[]; material?: string; sectionRole?: string }
export interface PlanOpening { run: number; at: P2; widthM: number; heightM?: number }
export interface PlanLayout { stage?: string; basis?: string; runs: PlanRun[]; openings?: PlanOpening[] }
export interface PlanItem { id: string; kind: string; name: string; x: number; z: number; facing?: string; bays?: number; layout?: PlanLayout;
  construction?: { status?: string; spec: unknown; options: { platformH?: number } } }

export function planItem(id: string): PlanItem {
  const plan = getPlan() as unknown as { regions?: { buildings?: PlanItem[] }[] };
  const hits = (plan.regions ?? []).flatMap((r) => r.buildings ?? []).filter((b) => b.id === id);
  if (hits.length !== 1) throw new Error(`[xiangye] plan 对象 ${id} 须唯一，实际 ${hits.length}`);
  return hits[0];
}

export function planLayout(id: string, kind: 'wall' | 'fence'): PlanLayout {
  const item = planItem(id);
  if (item.kind !== kind || !item.layout?.runs?.length) throw new Error(`[xiangye] ${id} 不是带走线的 ${kind}`);
  for (const r of item.layout.runs) {
    if (r.points.length < 2 || !(r.widthM > 0) || !(r.heightM > 0)) throw new Error(`[xiangye] ${id} 走线缺截面或点`);
  }
  return item.layout;
}

/** 装配器没传 ground 时(棚拍)用 plan 现建的地形场,缓存一份——与 garden-bridge 预览同一路。 */
let GROUND: ((x: number, z: number) => number) | undefined;
export function planGround(): (x: number, z: number) => number {
  return (GROUND ??= makeTerrainField(getPlan() as unknown as GardenPlan, { seed: SEED }).height);
}
