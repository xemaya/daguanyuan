import {compileLinearLayout,layoutInside} from '../builder/plan/linear-layout.ts';
import {allPlanLinears} from '../builder/plan/linears.ts';
import {pointOnSegment,locatePoint} from '../builder/plan/geometry.ts';
export const LINEAR_KINDS=['wall','fence','railing','corridor','path','bridge','steps','dock','pergola','cave','watergate'];
function intersection(a,b,c,d) {
 const ax=b[0]-a[0],az=b[1]-a[1],bx=d[0]-c[0],bz=d[1]-c[1],den=ax*bz-az*bx;
 if(Math.abs(den)<1e-9)return null;
 const t=((c[0]-a[0])*bz-(c[1]-a[1])*bx)/den,u=((c[0]-a[0])*az-(c[1]-a[1])*ax)/den;
 return t>=0&&t<=1&&u>=0&&u<=1?[a[0]+t*ax,a[1]+t*az]:null;
}
export function auditLinearLayouts(plan) {
 const fails=[],objects=[],sources=allPlanLinears(plan),ids=new Set();
 const anchors=plan.regions.flatMap(r=>r.buildings);
 const entries=plan.regions.flatMap(r=>r.buildings.filter(b=>LINEAR_KINDS.includes(b.kind)).map(b=>({r,b})));
 entries.push(...(plan.linearLayouts??[]).map(b=>({r:plan.regions.find(r=>b.id.startsWith(r.id+'.')),b})));
 for(const {r,b} of entries)try {
  if(ids.has(b.id)||!r)throw new Error('线性身份重复或缺所属分区');ids.add(b.id);
  if(!b.layout)throw new Error('仍仅有点坐标，缺少线性施工图');
  if(b.layout.stage==='model-reference') {
   if(!b.layout.linearIds.length||new Set(b.layout.linearIds).size!==b.layout.linearIds.length)throw new Error('线性引用为空或重复');
   const refs=b.layout.linearIds.map(id=>{
    const found=sources.filter(s=>s.id===id&&s.kind===b.kind);
    if(found.length!==1)throw new Error('线性模型引用不存在或类型不匹配');return found[0];
   });
   if(!refs.some(s=>s.points.slice(1).some((p,i)=>pointOnSegment([b.x,b.z],s.points[i],p))))throw new Error('模型参照点不在线上');
   objects.push({id:b.id,kind:b.kind,stage:'model-reference',linearIds:b.layout.linearIds});continue;
  }
  const c=compileLinearLayout(b.layout);
  if(!layoutInside(c,plan.wall))throw new Error('施工包络超出园墙');
  if(b.layout.scope==='region'&&!layoutInside(c,r.polygon))throw new Error('施工包络超出所属区域');
  if(b.x!==undefined&&!c.runs.some(run=>run.segments.some(s=>pointOnSegment([b.x,b.z],s.a,s.b))))throw new Error('对象锚点不在施工折线上');
  for(const o of c.openings)if(o.object) {
   const a=anchors.find(a=>a.id===o.object);
   if(!a||Math.hypot(a.x-o.at[0],a.z-o.at[1])>1e-7)throw new Error('开口引用与真实锚点不同');
  }
  objects.push({id:b.id,kind:b.kind,scope:b.layout.scope,...c});
 }catch(e){fails.push(`${b.id}：${e.message}`);}
 const portals=[...objects.flatMap(o=>o.openings??[]),...sources.flatMap(s=>s.inserts??[])];
 for(const a of anchors.filter(a=>a.kind==='opening'))if(portals.filter(p=>p.object===a.id).length!==1)
   fails.push(`${a.id}：门洞须唯一依附于实际墙线`);
 const caveTop={verified:false,boatOverlapSamples:0,minRockM:Infinity,overlapStartM:Infinity,overlapEndM:0};
 let wallCrossings=0;
 for(const o of objects.filter(o=>['wall','fence','railing'].includes(o.kind)))for(const [i,r] of (o.runs??[]).entries())
  for(const s of r.segments)for(const l of plan.narrativeRoutes[0].legs)for(let j=1;j<l.points.length;j++) {
   const hit=intersection(s.a,s.b,l.points[j-1],l.points[j]);if(!hit)continue;
   wallCrossings++;
   if(!o.openings.some(op=>op.run===i&&Math.hypot(op.at[0]-hit[0],op.at[1]-hit[1])<=(op.widthM-l.widthM)/2+1e-7))fails.push(`${o.id}：${l.id}穿过围护线且未留足规划净口`);
  }
 try {
  const feature=plan.routeFeatures.find(f=>f.id==='ch17.huaxu-cave-top');
  const road=objects.find(o=>o.id===feature.layoutRef),cave=objects.find(o=>o.id===feature.caveRef);
  if(feature.readiness!=='layout-ready'||!road?.runs||!cave?.runs)throw new Error('洞顶通道缺施工断面');
  const legs=plan.narrativeRoutes[0].legs.slice(16,18),pts=[...legs[0].points,...legs[1].points.slice(1)];
  if(JSON.stringify(pts)!==JSON.stringify(road.runs[0].points))throw new Error('洞顶线形脱离第17/18路段');
  for(const r of cave.runs)if(r.sectionRole!=='clearance'||Math.min(...r.elevationsM)+r.heightM<feature.minBoatAirM)throw new Error('港洞净空不足，或被声明成实体');
  for(const r of road.runs)for(const s of r.segments) {
   const nx=-(s.b[1]-s.a[1])/s.length,nz=(s.b[0]-s.a[0])/s.length,n=Math.ceil(s.length/.1);
   for(let i=0;i<=n;i++)for(let j=0;j<=8;j++) {
    const t=i/n,side=(j/8-.5)*r.widthM,x=s.a[0]+(s.b[0]-s.a[0])*t+nx*side,z=s.a[1]+(s.b[1]-s.a[1])*t+nz*side;
    for(const c of cave.runs)if(locatePoint(c.footprint,[x,z])!=='outside') {
     const rock=s.y0+(s.y1-s.y0)*t-r.heightM-Math.max(...c.elevationsM)-c.heightM;
     caveTop.boatOverlapSamples++;caveTop.minRockM=Math.min(caveTop.minRockM,rock);
     caveTop.overlapStartM=Math.min(caveTop.overlapStartM,s.start+t*s.length);caveTop.overlapEndM=Math.max(caveTop.overlapEndM,s.start+t*s.length);
    }
   }
  }
  if(!caveTop.boatOverlapSamples||caveTop.minRockM<feature.minRoofThicknessM)throw new Error(`洞顶与船行净空未留足岩体：${caveTop.minRockM}m`);
  caveTop.verified=true;
 }catch(e){fails.push(`花溆洞顶：${e.message}`);}
 return {fails,objects,total:entries.length,caveTop,wallCrossings};
}
