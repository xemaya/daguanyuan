import {compileConstruction,type Construction} from '../derive/construction';
import {deriveRusticBuilding,type RusticSpec} from '../derive/rustic/building';
import {deriveFayuan,type FayuanSpec} from '../derive/fayuan/index';
import {RuleBook} from '../derive/rules';
import {compileCorridor,type CorridorPathSpec} from './corridor-path';
import {compileWallPath,type WallPathSpec} from './wall-path';
import {containsRing,isSimpleRing,type Point2} from './geometry';
import {pathStations,stripPolygon} from './polyline';
import {allPlanLinears,type LinearPlan} from './linears';

export interface RoundDistantSpec extends FayuanSpec {
 shape:'round';tier:'C';form:'pavilion';
 design:{baseWidthM:number;eaveSupportM:number;platformH:number;platformMarginM:number;roofThicknessM:number;note:string};
}
export type DistantContent=
 |{id:string;kind:'house';at:Point2;yaw:number;construction:Construction}
 |{id:string;kind:'house-ref';object:string}
 |{id:string;kind:'rustic';at:Point2;yaw:number;spec:RusticSpec;platformH:number;facade:{doorWidthM:number;doorHeightM:number;windowWidthM:number;windowHeightM:number;windowY:number;windowX:number;frameM:number}}
 |{id:string;kind:'round';at:Point2;spec:RoundDistantSpec}
 |{id:string;kind:'corridor';spec:Omit<CorridorPathSpec,'id'|'elevation_m'>}
 |{id:string;kind:'wall';spec:Omit<WallPathSpec,'id'|'elevation_m'>}
 |{id:string;kind:'wall-ref';linear:string}
 |{id:string;kind:'paving';at:Point2;widthM:number;depthM:number;riseM:number}
 |{id:string;kind:'tree';at:Point2;heightM:number;radiusM:number;seed:number};
export interface DistantSceneSpec {
 id:string;name:string;at:Point2;polygon:Point2[];baseElevationM:number;foundationEmbedM:number;
 readiness:'distant-ready';contents:DistantContent[];basis:string;
}
interface PlanRefs {regions:{id:string;elevation_m:number;buildings:{id:string;x:number;z:number;facing:string;construction?:Construction}[]}[]}
const rect=(x:number,z:number,hx:number,hz:number,yaw=0):Point2[]=>[[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz],[-hx,-hz]].map(([a,b])=>[x+a*Math.cos(yaw)+b*Math.sin(yaw),z-a*Math.sin(yaw)+b*Math.cos(yaw)] as Point2);
const circle=(x:number,z:number,r:number):Point2[]=>Array.from({length:33},(_,i)=>[x+Math.cos(i*Math.PI/16)*r/Math.cos(Math.PI/32),z+Math.sin(i*Math.PI/16)*r/Math.cos(Math.PI/32)] as Point2);
const positive=(n:number)=>{if(!Number.isFinite(n)||n<=0)throw new Error('远景尺寸须为有限正数');};

export function deriveRoundDistant(spec:RoundDistantSpec) {
 if(spec.shape!=='round'||spec.form!=='pavilion'||spec.tier!=='C'||!spec.design?.note?.trim())throw new Error('圆亭须声明圆形亭与艺术侧样');
 for(const n of Object.entries(spec.design).filter(([k])=>k!=='note').map(([,n])=>n))positive(n as number);
 const f=deriveFayuan(RuleBook.create('fayuan'),spec),m=f.m;
 m.base=spec.design.baseWidthM;m.eaveY+=spec.design.eaveSupportM;m.ridgeY+=spec.design.eaveSupportM;
 if(m.base<=m.columnD)throw new Error('圆亭柱础须宽于柱径');
 const columnRadius=m.depthHalf/Math.cos(Math.PI/8),roofRadius=m.eaveHalf+m.yanchu;
 if(columnRadius+m.columnD/2>=roofRadius)throw new Error('圆亭屋盖未覆盖柱圈');
 const columns=Array.from({length:8},(_,i)=>[columnRadius*Math.cos(i*Math.PI/4),columnRadius*Math.sin(i*Math.PI/4)] as Point2);
 f.provenance.art.push({id:'project:round-distant',name:'圆亭远景侧样',method:'artistic_choice',note:spec.design.note+'；圆檐按提栈侧样旋转，不伪称已实现八角戗角细部。输入='+JSON.stringify(spec)});
 return {...f,columns,columnRadius,roofRadius,platformRadius:columnRadius+spec.design.platformMarginM,
  roofProfile:[...m.purlins.map(p=>({r:p.x,y:m.eaveY+p.y})),{r:roofRadius,y:m.eaveY-m.eaveTip.drop}]};
}

/** Resolve references once, preserving actual source construction data. */
export function compileDistantScene(scene:DistantSceneSpec,plan:PlanRefs) {
 if(scene.readiness!=='distant-ready'||!scene.contents?.length||!scene.basis||!isSimpleRing(scene.polygon)||!Number.isFinite(scene.baseElevationM))throw new Error('远景须有可执行内容、范围、基准标高和出处');
 positive(scene.foundationEmbedM);const ids=new Set<string>();
 const items=scene.contents.map(item=>{
  if(!item.id||ids.has(item.id))throw new Error('远景内容id缺失或重复');ids.add(item.id);
  let at:Point2=scene.at,yaw=0,elevation=scene.baseElevationM,footprint:Point2[],compiled:any=null,source:any=item;
  if(item.kind==='house'||item.kind==='house-ref') {
   let c:Construction;
   if(item.kind==='house-ref') {
    const matches=plan.regions.flatMap(r=>r.buildings.map(b=>({r,b}))).filter(x=>x.b.id===item.object);
    if(matches.length!==1||!matches[0].b.construction)throw new Error('远景房屋引用缺失或不唯一');
    const {r,b}=matches[0];c=b.construction!;at=[b.x,b.z];elevation=r.elevation_m;
    yaw=({south:0,west:-Math.PI/2,north:Math.PI,east:Math.PI/2} as Record<string,number>)[b.facing];
   } else {c=item.construction;at=item.at;yaw=item.yaw;}
   compiled=compileConstruction(c);
   if(!compiled.meshFactoryAvailable||c.spec.paramSet!=='fayuan')throw new Error('远景引用的详细房屋必须已有模型，不能静默套默认房屋');
   const m=compiled.modules[0].frame.m;footprint=rect(at[0],at[1],m.width/2+m.yanchu,m.eaveHalf+m.yanchu,yaw);
   source={...item,construction:c};
  } else if(item.kind==='rustic') {
   at=item.at;yaw=item.yaw;positive(item.platformH);compiled=deriveRusticBuilding(item.spec);
   for(const n of Object.values(item.facade))positive(n);
   if(item.facade.doorHeightM>=compiled.m.columnH||item.facade.windowX+item.facade.windowWidthM/2>=compiled.m.width/2-compiled.m.columnD/2||item.facade.windowY+item.facade.windowHeightM/2>=compiled.m.columnH)throw new Error('茅舍立面标识越出柱间净空');
   footprint=rect(at[0],at[1],compiled.m.width/2+compiled.m.yanchu,compiled.m.depthHalf+compiled.m.yanchu,yaw);
  } else if(item.kind==='round') {
   at=item.at;compiled=deriveRoundDistant(item.spec);footprint=circle(at[0],at[1],Math.max(compiled.roofRadius,compiled.platformRadius));
  } else if(item.kind==='corridor'||item.kind==='wall'||item.kind==='wall-ref') {
   if(item.kind==='wall-ref') {
    const matches=allPlanLinears(plan as unknown as LinearPlan).filter(s=>s.id===item.linear&&s.kind==='wall');
    if(matches.length!==1)throw new Error('远景院墙引用缺失或不唯一');source={...item,spec:matches[0]};elevation=source.spec.elevation_m;
   } else source={...item,spec:{...item.spec,id:scene.id+'.'+item.id,elevation_m:scene.baseElevationM}};
   compiled=item.kind==='corridor'?compileCorridor(source.spec):compileWallPath(source.spec);at=compiled.origin;
   if(item.kind==='corridor')footprint=compiled.roofPolygon.map((p:Point2)=>[p[0]+at[0],p[1]+at[1]] as Point2);
   else footprint=stripPolygon(pathStations(source.spec.points),.4);
  } else if(item.kind==='paving') {
   at=item.at;for(const n of [item.widthM,item.depthM,item.riseM])positive(n);footprint=rect(at[0],at[1],item.widthM/2,item.depthM/2);
  } else if(item.kind==='tree') {
   at=item.at;positive(item.heightM);positive(item.radiusM);if(!Number.isInteger(item.seed))throw new Error('背景树须声明种子');footprint=circle(at[0],at[1],item.radiusM);
  } else throw new Error('未知远景内容类型');
  if(!at.every(Number.isFinite)||!Number.isFinite(yaw)||!containsRing(scene.polygon,footprint))throw new Error(`${scene.id}/${item.id}内容超出预留范围`);
  return {id:item.id,kind:item.kind,at,yaw,elevation,groundMode:item.kind==='tree'?'terrain':'datum',footprint,compiled,source};
 });
 return {id:scene.id,origin:[scene.at[0],scene.baseElevationM,scene.at[1]] as [number,number,number],items,detail:'distant' as const,nearDetailReady:false};
}
