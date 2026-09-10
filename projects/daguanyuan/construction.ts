import plan from './plan.json' with { type: 'json' };
import { buildBuilding, type BuildingOptions, type BuildingResult } from '@builder/parts/damu/building';
import { registerPart } from '@builder/parts/registry';

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
  const result = buildBuilding({ ...construction.options, spec: construction.spec } as BuildingOptions);
  result.root.name = id;
  result.root.userData.planObject = { id, region: region.id, name: object.name,
    sources: region.sources, legacyRoofLabel: object.roof };
  return result;
}

registerPart('garden-building', buildPlannedBuilding);
