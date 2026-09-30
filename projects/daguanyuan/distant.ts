import plan from './plan.json' with {type:'json'};
import {registerPart,type PartContext} from '@builder/parts/registry';
import {compileDistantScene,type DistantSceneSpec} from '@builder/plan/distant-scene';
import {buildDistantScene} from '@builder/parts/distant/scene';
import {makeTerrainField,type GardenPlan} from '@builder/compose/terrain-from-plan';
import {SEED} from '@builder/compose/config';
let previewGround:((x:number,z:number)=>number)|undefined;
export function buildPlannedDistant(id:string,context?:PartContext) {
 const matches=plan.distantScenes.filter(s=>s.id===id);if(matches.length!==1)throw new Error(`远景${id}不存在或不唯一`);
 const scene=matches[0] as unknown as DistantSceneSpec;
 const compiled=compileDistantScene(scene,plan as any);
 const ground=context?.ground??(previewGround??=makeTerrainField(plan as unknown as GardenPlan,{seed:SEED}).height);
 return buildDistantScene(scene,compiled,ground);
}
registerPart('garden-distant',buildPlannedDistant);
