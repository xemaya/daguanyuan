import plan from './plan.json' with { type: 'json' };
import { buildBuilding, type BuildingOptions, type BuildingResult } from '@builder/parts/damu/building';
import { registerPart,type PartContext } from '@builder/parts/registry';
import { buildWallPath } from '@builder/parts/qiangyuan/wall-path';
import type { WallPathSpec } from '@builder/plan/wall-path';
import {buildCorridor} from '@builder/parts/damu/corridor-path';
import type {CorridorPathSpec} from '@builder/plan/corridor-path';
import type {BridgePathSpec} from '@builder/plan/bridge-path';
import {buildBridgePath} from '@builder/parts/shuigong/bridge-path';
import {makeTerrainField,type GardenPlan} from '@builder/compose/terrain-from-plan';
import {SEED} from '@builder/compose/config';
import {allPlanLinears,type LinearPlan} from '@builder/plan/linears';

/** The project supplies data; generic builders never import a particular garden. */
export function buildPlannedBuilding(id: string): BuildingResult {
  const matches = plan.regions.flatMap(region => region.buildings.map(object => ({ region, object })))
    .filter(entry => entry.object.id === id);
  if (matches.length !== 1) throw new Error(`施工对象 ${id} 须唯一，实际 ${matches.length}`);
  const { region, object } = matches[0];
  if (object.kind !== 'building') throw new Error(`${id} 是 ${object.kind}，不能作为木构房屋生成`);
  if (!('construction' in object)) throw new Error(`${id} 施工spec尚未完成，不得替换成通用房屋`);
  const construction = object.construction;
  if (!construction) throw new Error(`${id} 施工spec为空`);
  if ('status' in construction && construction.status === 'frame-ready')
    throw new Error(`${id} 已有可执行施工骨架；P3分件/楼层几何尚未完成，不得静默替换成法式房屋`);
  const result = buildBuilding({ ...construction.options, spec: construction.spec } as BuildingOptions);
  result.root.name = id;
  result.root.userData.planObject = { id, region: region.id, name: object.name,
    sources: region.sources, legacyRoofLabel: object.roof };
  return result;
}

registerPart('garden-building', buildPlannedBuilding);

export function buildPlannedWall(id:string) {
  const matches=allPlanLinears(plan as unknown as LinearPlan).filter(w=>w.id===id&&w.kind==='wall') as WallPathSpec[];
  if(matches.length!==1)throw new Error(`墙路径 ${id} 须唯一，实际 ${matches.length}`);
  return buildWallPath(matches[0]);
}
registerPart('garden-wall',buildPlannedWall);

export function buildPlannedCorridor(id:string) {
  const matches=allPlanLinears(plan as unknown as LinearPlan).filter(c=>c.id===id&&c.kind==='corridor') as CorridorPathSpec[];
  if(matches.length!==1)throw new Error(`游廊路径 ${id} 须唯一，实际 ${matches.length}`);
  return buildCorridor(matches[0]);
}
registerPart('garden-corridor',buildPlannedCorridor);

let previewGround:((x:number,z:number)=>number)|undefined;
export function buildPlannedBridge(id:string,context?:PartContext) {
  const matches=allPlanLinears(plan as unknown as LinearPlan).filter(b=>b.id===id&&b.kind==='bridge') as BridgePathSpec[];
  if(matches.length!==1)throw new Error(`桥路径 ${id} 须唯一，实际 ${matches.length}`);
  const ground=context?.ground ?? (previewGround??=makeTerrainField(plan as unknown as GardenPlan,{seed:SEED}).height);
  return buildBridgePath(matches[0],ground);
}
registerPart('garden-bridge',buildPlannedBridge);
