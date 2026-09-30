import {compileConstruction,constructionFootprints} from '../builder/derive/construction.ts';
import {containsRing,interiorsOverlap,locatePoint} from '../builder/plan/geometry.ts';

/** P2 input/footprint gate; available geometry remains a separate count. */
export function auditConstructions(plan) {
 const fails=[],objects=[];
 for(const region of plan.regions)for(const b of region.buildings.filter(b=>b.kind==='building')) {
  try {
   if(!b.construction)throw new Error('缺少施工spec');
   const c=compileConstruction(b.construction),footprints=constructionFootprints(c,b);
   if(c.modules[0].frame.m.columnX.length!==b.bays+1)throw new Error('施工柱网与声明开间不一致');
   for(const f of footprints)if(!containsRing(region.polygon,f.roof))throw new Error(`${f.id}屋面/廊外包络越出建设分区`);
   if(c.boat) {
    const matches=plan.water.filter(w=>w.id===c.boat.waterRef);
    if(matches.length!==1)throw new Error('舡坞水域引用必须唯一');
    if(matches[0].depth_m<c.boat.draftM)throw new Error('舡坞声明水深不足');
    const body=footprints[0].body,entry=[(body[2][0]+body[3][0])/2,(body[2][1]+body[3][1])/2];
    const distance=Math.hypot(entry[0]-b.x,entry[1]-b.z),scale=1+c.boat.berthLengthM/(2*distance);
    const approach=[b.x+(entry[0]-b.x)*scale,b.z+(entry[1]-b.z)*scale];
    if(locatePoint(matches[0].polygon,approach)==='outside')throw new Error('通舟口朝向与支港接近方向不一致');
    if(!plan.water.some(w=>w!==matches[0]&&interiorsOverlap(w.polygon,matches[0].polygon)))throw new Error('舡坞支港未接入现有水系');
   }
   objects.push({id:b.id,compiled:c,footprints});
  } catch(e) {fails.push(`${b.id}施工契约：${e.message}`);}
 }
 return {fails,objects,total:plan.regions.flatMap(r=>r.buildings).filter(b=>b.kind==='building').length,
   meshFactories:objects.filter(o=>o.compiled.meshFactoryAvailable).length,
   frameOnly:objects.filter(o=>!o.compiled.meshFactoryAvailable).length};
}
