import {allPlanLinears} from '../builder/plan/linears.ts';
import {compileBridgePath} from '../builder/plan/bridge-path.ts';
import {containsRing,locatePoint,pointOnSegment,segmentLocations,interiorsOverlap} from '../builder/plan/geometry.ts';
import {compileNarrativeRoute} from '../builder/plan/narrative-route.ts';
import {auditConstructions} from './construction-audit.mjs';

/** Cross-region construction is checked against the garden, buildings and its
 * named walking legs. It is not a claim that P4 has instanced these meshes. */
export function auditConnections(plan) {
 const fails=[],connections=[];
 const all=allPlanLinears(plan);
 if(new Set(all.map(l=>l.id)).size!==all.length)fails.push('线性构件id在区域与公共连接之间重复');
 const route=compileNarrativeRoute(plan.narrativeRoutes[0]);
 const buildings=auditConstructions(plan).objects;
 for(const spec of plan.connections??[])try {
  if(spec.kind!=='bridge'||!spec.id.startsWith('connection.'))throw new Error('当前公共连接须为有独立id的桥路径');
  const c=compileBridgePath(spec),polygon=c.polygon.map(p=>[p[0]+c.origin[0],p[1]+c.origin[1]]);
  if(!containsRing(plan.wall,polygon))throw new Error('桥面越出园墙');
  if(c.clearWidth<1.2)throw new Error('桥栏内保守净宽不足1.2m');
  for(const b of buildings)for(const f of b.footprints)if(f.body.length&&interiorsOverlap(f.body,polygon))throw new Error(`桥面切入${b.id}/${f.id}主体`);
  if(spec.object) {
   const matches=plan.regions.flatMap(r=>r.buildings).filter(b=>b.id===spec.object&&b.kind==='bridge');
   if(matches.length!==1||!spec.points.slice(1).some((b,i)=>pointOnSegment([matches[0].x,matches[0].z],spec.points[i],b)))throw new Error('命名桥锚点未绑定在桥路径上');
  }
  if(spec.railingMaterial==='vermilion'&&spec.object!=='liaoting_huaxu.red-railing-bridge')throw new Error('本项目朱栏例外仅用于原文折带朱栏板桥');
  if(!spec.routeLegs?.length||new Set(spec.routeLegs).size!==spec.routeLegs.length)throw new Error('公共桥须声明不重复的路线关联');
  const checks=[];
  for(const id of spec.routeLegs) {
   const leg=route.legs.find(e=>e.id===id);
   if(!leg)throw new Error(`未知路线${id}`);
   if(!leg.segments.some(s=>segmentLocations(s.a,s.b,polygon).some(t=>t.location==='inside')))throw new Error(`桥未覆盖声明路段${id}`);
   const waterPoints=[];
   for(const s of leg.segments)for(const w of plan.water)for(const t of segmentLocations(s.a,s.b,w.polygon).filter(t=>t.location==='inside')) {
    const n=Math.max(1,Math.ceil((t.to-t.from)*s.length/.4));
    for(let i=0;i<=n;i++) {
     const a=t.from+(t.to-t.from)*i/n,p=[s.a[0]+(s.b[0]-s.a[0])*a,s.a[1]+(s.b[1]-s.a[1])*a];
     waterPoints.push({point:p,water:w.id,depth:w.depth_m});
     if(locatePoint(polygon,p)==='outside')throw new Error(`未覆盖${id}的跨水点${p}`);
    }
   }
   checks.push({leg:id,waterPoints});
  }
  connections.push({spec,compiled:c,polygon,checks,runtimeVerified:false});
 }catch(e){fails.push(`${spec.id}：${e.message}`);}
 return {fails,connections};
}
