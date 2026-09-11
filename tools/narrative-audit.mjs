import {compileNarrativeRoute} from '../builder/plan/narrative-route.ts';
import {isSimpleRing,containsRing,interiorsOverlap,locatePoint,segmentLocations} from '../builder/plan/geometry.ts';
import {readFileSync} from 'node:fs';
import {compileConstruction} from '../builder/derive/construction.ts';
const evidenceText=readFileSync(new URL('../knowledge/docs/plan/02-evidence.md',import.meta.url),'utf8')
 .split('## 一、第十七回游线')[1].split('## 二、证据表')[0];
const evidenceEvents=[...evidenceText.matchAll(/^\d+\. (.+)$/gm)].map(m=>m[1].trim());
const roadRectangle=(segment,width)=>{
 const {a,b,length}=segment,nx=-(b[1]-a[1])*width/(2*length),nz=(b[0]-a[0])*width/(2*length);
 return [[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz],[a[0]+nx,a[1]+nz]];
};

export function auditNarrative(plan) {
 const fails=[],routes=[],distant=[],access=[];
 const maps={object:plan.regions.flatMap(r=>r.buildings??[]),rock:plan.regions.flatMap(r=>r.rocks??[]),
  hill:plan.hills,water:plan.water,feature:plan.routeFeatures??[],distant:plan.distantScenes??[]};
 const resolve=ref=>{
  const entries=maps[ref.kind]?.filter(e=>e.id===ref.id)??[];
  if(entries.length!==1)throw new Error(`引用${ref.kind}:${ref.id}缺失或不唯一`);
  return entries[0];
 };
 for(const [kind,entries] of Object.entries(maps)) {
  if(entries.some(e=>!e.id)||new Set(entries.map(e=>e.id)).size!==entries.length)fails.push(`${kind}引用表缺id或重号`);
 }
 if(new Set((plan.narrativeRoutes??[]).map(r=>r.id)).size!==(plan.narrativeRoutes??[]).length)fails.push('叙事路线id重号');
 for(const s of plan.distantScenes??[]) {
  if(!s.id||!isSimpleRing(s.polygon)||!containsRing(plan.wall,s.polygon))fails.push(`${s.id}远景范围非法或越园墙`);
  if(s.entry!=='not-entered'||!s.source?.document||!s.basis||s.readiness!=='layout-only')fails.push(`${s.id}缺未入属性或规划出处`);
  for(const region of plan.regions)if(region.id!==s.regionRef&&interiorsOverlap(region.polygon,s.polygon))fails.push(`${s.id}远景侵入既有${region.id}分区`);
 }
 for(const source of plan.narrativeRoutes??[]) {
  try {
   const route=compileNarrativeRoute(source);
   if(source.id==='ch17'&&(source.nodes.length!==29||evidenceEvents.length!==29))throw new Error('第17回必须覆盖29个已核验节点');
   for(const n of source.nodes) {
    if(n.source.event!==evidenceEvents[n.order-1])throw new Error(`${n.id}原文事件与已核验位序不符`);
    for(const ref of n.refs)resolve(ref);
    if(n.region&&!plan.regions.some(r=>r.id===n.region))throw new Error(`${n.id}分区引用不存在`);
   }
   for(const requirement of source.accessRequirements??[]) {
    const object=resolve({kind:'object',id:requirement.object});
    const leg=route.legs.find(e=>e.id===requirement.leg);
    if(!leg)throw new Error(`${requirement.id}引用未知路段`);
    if(!(requirement.minWidthM>0&&requirement.minHeightM>0))throw new Error(`${requirement.id}缺通行净宽净高要求`);
    const c=compileConstruction(object.construction),options=object.construction.options;
    let ports=[],width=0,height=0;
    if(requirement.side==='back'&&options.back===requirement.surface&&c.rearDoor&&options.doorOpen!==false) {
     width=c.rearDoor.width;height=c.rearDoor.height;ports=[[options.backDoor.centerXM,c.rearDoor.z]];
    } else if(requirement.form==='through-house'&&c.passage) {
     width=c.passage.width;height=c.passage.height;ports=c.passage.ports.map(p=>p.at);
    }
    const available=ports.length>0&&width>=requirement.minWidthM&&height>=requirement.minHeightM;
    const yaw={south:0,west:-Math.PI/2,north:Math.PI,east:Math.PI/2}[object.facing],cs=Math.cos(yaw),sn=Math.sin(yaw);
    const aligned=available&&ports.every(([x,z])=>{
     const wx=object.x+x*cs+z*sn,wz=object.z-x*sn+z*cs;
     return leg.segments.some(({a,b})=>{
      const da=(a[0]-wx)*sn+(a[1]-wz)*cs,db=(b[0]-wx)*sn+(b[1]-wz)*cs;
      if(da*db>1e-8||Math.abs(da-db)<1e-8)return false;
      const t=da/(da-db),ix=a[0]+(b[0]-a[0])*t-wx,iz=a[1]+(b[1]-a[1])*t-wz;
      return Math.abs(ix*cs-iz*sn)<=(width-requirement.minWidthM)/2+1e-7;
     });
    });
    if(available&&!aligned)throw new Error(`${requirement.id}路线未经过声明的净口`);
    access.push({id:requirement.id,object:requirement.object,leg:requirement.leg,contractSatisfied:available,
     routeAligned:aligned,geometryAvailable:c.meshFactoryAvailable,runtimeVerified:false});
   }
   const waterCrossings=[];
   for(const leg of route.legs)for(const s of leg.segments) {
    if(!containsRing(plan.wall,roadRectangle(s,leg.widthM)))fails.push(`${leg.id}路面宽度越出园墙`);
    for(const water of plan.water)for(const interval of segmentLocations(s.a,s.b,water.polygon).filter(p=>p.location==='inside'))
     waterCrossings.push({leg:leg.id,water:water.id,from:s.start+s.length*interval.from,to:s.start+s.length*interval.to});
   }
   for(const o of source.observations) {
    if(o.leg!==route.legs[24].id)throw new Error('未入五景必须属于第25→26节点之间的归路');
    const s=resolve({kind:'distant',id:o.scene}),leg=route.legs.find(e=>e.id===o.leg);
    if(locatePoint(s.polygon,o.at)!=='outside')throw new Error(`${s.id}未入远景的观察点落在景内`);
    if(leg.segments.some(seg=>interiorsOverlap(roadRectangle(seg,leg.widthM),s.polygon)))throw new Error(`${s.id}未入远景却被主线路面穿入`);
    const distance=Math.hypot(o.at[0]-s.at[0],o.at[1]-s.at[1]);
    if(!Number.isFinite(s.maxViewingDistanceM)||s.maxViewingDistanceM<=0||distance>s.maxViewingDistanceM)throw new Error(`${s.id}观察距离超过声明的规划上限`);
    distant.push({id:s.id,observer:o.at,distance,geometryReady:false,visibilityVerified:false});
   }
   const beforeHengwu=route.legs[15],hengwu=plan.regions.find(r=>r.id==='hengwuyuan');
   if(beforeHengwu.segments.some(s=>segmentLocations(s.a,s.b,hengwu.polygon).some(p=>p.location==='inside')))
    throw new Error('芭蕉坞去花溆的路先穿入蘅芜苑，违反第17回位序');
   const returnLeg=route.legs.at(-1),screenHill=resolve({kind:'hill',id:'hill.cuizhang'});
   if(returnLeg.segments.some(s=>interiorsOverlap(roadRectangle(s,returnLeg.widthM),screenHill.polygon)))
    throw new Error('出园末段须绕翠嶂东界，不能切过山体直返正门');
   if(source.id==='ch17'&&(new Set(source.observations.map(o=>o.scene)).size!==5||source.observations.length!==5))throw new Error('第25节点须关联五组独立未入远景');
   routes.push({source,compiled:route,waterCrossings});
  }catch(e){fails.push(`${source.id}叙事路线：${e.message}`);}
 }
 if(!routes.some(r=>r.source.id==='ch17'))fails.push('缺少可编译的第17回路线');
 return {fails,routes,distant,access};
}
