import type {Point2} from './geometry';
import {pointOnSegment} from './geometry';
export interface NarrativeNode {
 id:string;order:number;name:string;kind:'station'|'waypoint'|'scene';at:Point2;region?:string;
 refs:{kind:'object'|'rock'|'hill'|'water'|'feature'|'distant';id:string}[];
 source:{chapter:number;document:string;section:string;sequenceIndex:number;event:string};placementBasis:string;
}
export interface NarrativeLeg {
 id:string;from:string;to:string;points:Point2[];widthM:number;readiness:'planned';basis:string;
 travel:'walk'|'walk-bridge'|'hill-path'|'courtyard';
}
export interface NarrativeRoute {
 id:string;name:string;readiness:'planned';metric:'horizontal-polyline-metres';transport:'foot';
 nodes:NarrativeNode[];legs:NarrativeLeg[];closure:{start:string;end:string};
 milestone:{node:string;range:[number,number];basis:string};
 observations:{scene:string;leg:string;at:Point2}[];
}
const distance=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const finite=(p:Point2)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);

/** Data compilation is not evidence that its bridge, cave or door is built. */
export function compileNarrativeRoute(route:NarrativeRoute) {
 if(!route.id||route.readiness!=='planned'||route.metric!=='horizontal-polyline-metres'||route.transport!=='foot')
  throw new Error('叙事路线须明确为待实景验收的步行平面折线');
 if(route.nodes.length<2||route.legs.length!==route.nodes.length-1)throw new Error('节点与顺序路段数量不匹配');
 const ids=new Set<string>(),legIds=new Set<string>();
 for(const [i,n] of route.nodes.entries()) {
  if(!n.id||ids.has(n.id)||n.order!==i+1||!n.name||!['station','waypoint','scene'].includes(n.kind)||!finite(n.at))
   throw new Error('叙事节点身份/次序/分类/坐标非法');
  ids.add(n.id);
  if(!n.refs?.length||!n.source?.document||!n.source.section||!n.source.event||n.source.sequenceIndex!==n.order||n.source.chapter!==17||!n.placementBasis)
   throw new Error(`${n.id}缺原文位序、引用或艺术落位依据`);
 }
 const first=route.nodes[0],last=route.nodes.at(-1)!;
 if(route.closure.start!==first.id||route.closure.end!==last.id||distance(first.at,last.at)>1e-7)
  throw new Error('步行环线首末节点必须闭合于同一门位');
 let length=0;
 const nodeDistances=new Map([[first.id,0]]);
 const legs=route.legs.map((e,i)=>{
  if(!e.id||legIds.has(e.id)||e.from!==route.nodes[i].id||e.to!==route.nodes[i+1].id)throw new Error('路段断链、重号或颠倒叙事顺序');
  legIds.add(e.id);
  if(!Number.isFinite(e.widthM)||e.widthM<=0||!e.basis||e.readiness!=='planned'||!['walk','walk-bridge','hill-path','courtyard'].includes(e.travel))
   throw new Error(`${e.id}缺步行路段类型、宽度或规划依据`);
  if(e.points.length<2||!e.points.every(finite)||distance(e.points[0],route.nodes[i].at)>1e-7||distance(e.points.at(-1)!,route.nodes[i+1].at)>1e-7)
   throw new Error(`${e.id}路段必须真正接到前后节点`);
  const start=length,segments=[];
  for(let j=1;j<e.points.length;j++) {
   const a=e.points[j-1],b=e.points[j],d=distance(a,b);
   if(d<=1e-7)throw new Error(`${e.id}含零长段`);
   segments.push({a,b,start:length,length:d});length+=d;
  }
  nodeDistances.set(e.to,length);
  return {...e,start,length:length-start,segments};
 });
 const at=nodeDistances.get(route.milestone.node),[lo,hi]=route.milestone.range;
 if(at===undefined||!route.milestone.basis||!(0<lo&&lo<=hi&&hi<1))throw new Error('里程检查节点或比例区间非法');
 const ratio=at/length;
 if(ratio<lo||ratio>hi)throw new Error(`选定路线到牌坊占比${(ratio*100).toFixed(2)}%不在${lo*100}–${hi*100}%`);
 for(const observation of route.observations) {
  const leg=legs.find(e=>e.id===observation.leg);
  if(!leg||!finite(observation.at)||!leg.segments.some(s=>pointOnSegment(observation.at,s.a,s.b)))
   throw new Error(`${observation.scene}观察点不在声明的实际路段上`);
 }
 return {id:route.id,length,legs,nodeDistances:Object.fromEntries(nodeDistances),milestone:{node:route.milestone.node,distance:at,ratio},
  kindCounts:Object.fromEntries(['station','waypoint','scene'].map(kind=>[kind,route.nodes.filter(n=>n.kind===kind).length])),runtimeVerified:false as const};
}

export function sampleNarrativeRoute(route:ReturnType<typeof compileNarrativeRoute>,spacing=1) {
 if(!Number.isFinite(spacing)||spacing<=0)throw new Error('路线采样步长须为有限正数');
 const result:{at:Point2;distance:number;leg:string;widthM:number}[]=[];
 for(const leg of route.legs)for(const s of leg.segments) {
  const n=Math.ceil(s.length/spacing);
  for(let i=0;i<n;i++)result.push({at:[s.a[0]+(s.b[0]-s.a[0])*i/n,s.a[1]+(s.b[1]-s.a[1])*i/n],distance:s.start+s.length*i/n,leg:leg.id,widthM:leg.widthM});
 }
 const end=route.legs.at(-1)!;
 result.push({at:end.points.at(-1)!,distance:route.length,leg:end.id,widthM:end.widthM});
 return result;
}
