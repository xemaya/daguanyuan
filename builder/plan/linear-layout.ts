import {containsRing,isSimpleRing,pointOnSegment,type Point2} from './geometry';
import {pathStations,stripPolygon} from './polyline';

/** P2 construction envelopes. These are drawings, not substitutes for the P3
 * component factories or the P4 collision/terrain assembly. One object may
 * have several disconnected runs (two fences, walls flanking a gate, etc.). */
export interface LinearLayout {
  stage:'layout-ready';basis:string;scope:'region'|'garden';
  runs:{points:Point2[];widthM:number;heightM:number;elevationsM:number[];material:string;sectionRole:'envelope'|'clearance'|'walk-surface';stairs?:{segment:number;maxRiserM:number;minTreadM:number}[]}[];
  openings?:{run:number;at:Point2;widthM:number;heightM:number;object?:string}[];
  maxSlope?:number;
  threePortBridge?:{clearWidthsM:[number,number,number];pierWidthM:number;abutmentWidthM:number;bedY:number;soffitY:number;deckY:number};
}
export interface LinearReference {stage:'model-reference';linearIds:string[]}
export function compileLinearLayout(layout:LinearLayout) {
  if(layout.stage!=='layout-ready'||!layout.basis?.trim()||!['region','garden'].includes(layout.scope)||!layout.runs?.length)
    throw new Error('线性施工图须声明阶段、依据、范围与折线');
  const runs=layout.runs.map(run=>{
    const stations=pathStations(run.points);
    if(!Number.isFinite(run.widthM)||run.widthM<=0||!Number.isFinite(run.heightM)||run.heightM<0||!run.material?.trim()||!['envelope','clearance','walk-surface'].includes(run.sectionRole))
      throw new Error('线性截面或材料无效');
    if(run.elevationsM.length!==run.points.length||run.elevationsM.some(y=>!Number.isFinite(y)))throw new Error('每个控制点须有明确标高');
    const footprint=stripPolygon(stations,run.widthM/2);
    if(!isSimpleRing(footprint))throw new Error('线性构件宽度导致自交');
    const segments=stations.slice(1).map((b,i)=>({a:run.points[i],b:b.point,
      start:stations[i].distance,length:b.distance-stations[i].distance,
      y0:run.elevationsM[i],y1:run.elevationsM[i+1],
      slope:Math.abs(run.elevationsM[i+1]-run.elevationsM[i])/(b.distance-stations[i].distance)}));
    const stairs=(run.stairs??[]).map(stair=>{
      const s=segments[stair.segment];
      if(!s||run.sectionRole!=='walk-surface'||!Number.isFinite(stair.maxRiserM)||stair.maxRiserM<=0||!Number.isFinite(stair.minTreadM)||stair.minTreadM<=0||s.y0===s.y1)throw new Error('石階输入无效');
      const count=Math.ceil(Math.abs(s.y1-s.y0)/stair.maxRiserM),treadM=s.length/count,riserM=(s.y1-s.y0)/count;
      if(treadM<stair.minTreadM)throw new Error('石阶踏面小于声明净深');
      return {...stair,count,treadM,riserM,levels:Array.from({length:count+1},(_,i)=>({distance:s.start+i*treadM,y:s.y0+i*riserM}))};
    });
    if(new Set(stairs.map(s=>s.segment)).size!==stairs.length)throw new Error('同一路段重复声明石阶');
    const maxSlope=Math.max(...segments.map(s=>s.slope)),maxRampSlope=Math.max(0,...segments.filter((_,i)=>!stairs.some(s=>s.segment===i)).map(s=>s.slope));
    if(layout.maxSlope!==undefined&&(!Number.isFinite(layout.maxSlope)||layout.maxSlope<=0||maxRampSlope>layout.maxSlope+1e-8))throw new Error('路径纵坡超过设计限值');
    return {...run,stairs,stations,segments,footprint,length:stations.at(-1)!.distance,maxSlope,maxRampSlope};
  });
  const openings=(layout.openings??[]).map(o=>{
    const run=runs[o.run];
    if(!run||!(o.widthM>0&&o.heightM>0&&o.heightM<=run.heightM)||!Number.isFinite(o.widthM)||!Number.isFinite(o.heightM))throw new Error('线性开口尺寸或所属折线无效');
    const matches=run.segments.filter(s=>pointOnSegment(o.at,s.a,s.b));
    if(matches.length!==1)throw new Error('开口须位于唯一的直线段内');
    const s=matches[0],offset=Math.hypot(o.at[0]-s.a[0],o.at[1]-s.a[1]);
    if(Math.min(offset,s.length-offset)<o.widthM/2+.05)throw new Error('开口越过转角或端头');
    return {...o,distance:s.start+offset,elevation:s.y0+(s.y1-s.y0)*offset/s.length};
  });
  for(let i=0;i<openings.length;i++)for(let j=i+1;j<openings.length;j++)if(openings[i].run===openings[j].run&&Math.abs(openings[i].distance-openings[j].distance)<(openings[i].widthM+openings[j].widthM)/2)throw new Error('线性开口互相重叠');
  let bridgeSections:{from:number;to:number;role:'abutment'|'pier'|'water-opening';bottomY:number;topY:number}[]|undefined;
  if(layout.threePortBridge) {
    const b=layout.threePortBridge;
    if(runs.length!==1||b.clearWidthsM.length!==3||[...b.clearWidthsM,b.pierWidthM,b.abutmentWidthM].some(x=>!Number.isFinite(x)||x<=0)||![b.bedY,b.soffitY,b.deckY].every(Number.isFinite)||b.bedY>=b.soffitY||b.soffitY>=b.deckY)throw new Error('三港桥截面无效');
    const span=b.clearWidthsM.reduce((n,w)=>n+w,0)+2*b.pierWidthM+2*b.abutmentWidthM;
    if(Math.abs(span-runs[0].length)>1e-7||runs[0].elevationsM.some(y=>y!==b.deckY)||Math.abs(b.deckY-b.soffitY-runs[0].heightM)>1e-7)throw new Error('三港净口、桥墩与桥台之和不等于桥跨，或与桥面厚度不一致');
    bridgeSections=[];let d=0;
    const section=(w:number,role:'abutment'|'pier'|'water-opening')=>{bridgeSections!.push({from:d,to:d+w,role,bottomY:b.bedY,topY:b.soffitY});d+=w;};
    section(b.abutmentWidthM,'abutment');
    b.clearWidthsM.forEach((w,i)=>{section(w,'water-opening');if(i<2)section(b.pierWidthM,'pier');});
    section(b.abutmentWidthM,'abutment');
  }
  return {stage:'layout-ready' as const,runs,openings,bridgeSections,length:runs.reduce((n,r)=>n+r.length,0),meshFactoryAvailable:false};
}
export function layoutInside(layout:ReturnType<typeof compileLinearLayout>,boundary:Point2[]) {
  return layout.runs.every(r=>containsRing(boundary,r.footprint));
}
