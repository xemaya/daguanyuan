import type {Point2} from './geometry.ts';
import {isSimpleRing} from './geometry.ts';
import {pathStations,offsetStation,stripPolygon,type PathStation} from './polyline.ts';
import {deriveFayuanBuilding,type FayuanBuildingSpec,type FayuanBuildingFrame} from '../derive/fayuan/building.ts';

export interface CorridorPathSpec {
  id:string; kind:'corridor'; object:string; points:readonly Point2[]; elevation_m:number;
  maxBayWidth_m:number; platformH_m:number; platformMargin_m:number;
  foundationDepth_m:number;
  roofThickness_m:number; footingHeight_m:number; columnTaperRatio:number;
  section:FayuanBuildingSpec; basis:string;
}
export interface CorridorColumn {point:Point2; diameter:number; height:number; baseWidth:number}
export interface CompiledCorridor {
  origin:Point2; stations:PathStation[]; frames:FayuanBuildingFrame[];
  columns:CorridorColumn[]; crossBeams:{a:Point2;b:Point2;frame:FayuanBuildingFrame}[];
  deckPolygon:Point2[]; roofPolygon:Point2[]; halfDeck:number; halfRoof:number; length:number;
}
export function compileCorridor(spec:CorridorPathSpec):CompiledCorridor {
  if(spec.kind!=='corridor'||!spec.id||!spec.object||!spec.basis?.trim()||!Number.isFinite(spec.elevation_m))throw new Error('游廊须声明身份、依据及标高');
  for(const k of ['maxBayWidth_m','platformH_m','platformMargin_m','roofThickness_m','footingHeight_m','columnTaperRatio'] as const)
    if(!Number.isFinite(spec[k])||spec[k]<=0)throw new Error(`${k}须为有限正数`);
  if(!Number.isFinite(spec.foundationDepth_m)||spec.foundationDepth_m<0)throw new Error('游廊基础深度非法');
  if(spec.section.bayWidthsM!==undefined)throw new Error('游廊开间由路径分配，不得另给固定bayWidthsM');
  if(spec.platformH_m<.06||spec.roofThickness_m>=spec.section.design.eaveSupportHeightM||spec.columnTaperRatio>1)throw new Error('廊面/屋面/柱收分输入不成立');
  if(spec.section.paramSet!=='fayuan'||spec.section.form!=='hall'||spec.section.tier!=='C'||spec.section.roofType!=='硬山'||spec.section.ridgeStyle!=='rolled')
    throw new Error('当前游廊只接法原小式卷棚剖面，不替代清式复道');
  const world=pathStations(spec.points);
  const origin:Point2=[(Math.min(...spec.points.map(p=>p[0]))+Math.max(...spec.points.map(p=>p[0])))/2,
    (Math.min(...spec.points.map(p=>p[1]))+Math.max(...spec.points.map(p=>p[1])))/2];
  const stations=world.map(s=>({...s,point:[s.point[0]-origin[0],s.point[1]-origin[1]] as Point2}));
  const frames=stations.slice(1).map((s,i)=>{
    const length=s.distance-stations[i].distance,count=Math.ceil(length/spec.maxBayWidth_m);
    return deriveFayuanBuilding({...spec.section,bayWidthsM:Array(count).fill(length/count)});
  });
  const m=frames[0].m,halfDeck=m.depthHalf+spec.platformMargin_m,halfRoof=m.eaveHalf+m.yanchu;
  const deckPolygon=stripPolygon(stations,halfDeck),roofPolygon=stripPolygon(stations,halfRoof);
  if(!isSimpleRing(deckPolygon)||!isSimpleRing(roofPolygon))throw new Error('游廊转折太密，廊面或屋面相交');
  for(let i=1;i<stations.length;i++)for(const side of [-1,1]) {
    const a=offsetStation(stations[i-1],side*halfRoof),b=offsetStation(stations[i],side*halfRoof);
    const dx=stations[i].point[0]-stations[i-1].point[0],dz=stations[i].point[1]-stations[i-1].point[1];
    if((b[0]-a[0])*dx+(b[1]-a[1])*dz<=0)throw new Error('游廊直段过短，斜接屋面发生翻折');
  }
  const columns:CorridorColumn[]=[],crossBeams:CompiledCorridor['crossBeams']=[];
  for(let leg=0;leg<frames.length;leg++) {
    const frame=frames[leg],a=stations[leg],b=stations[leg+1],n=frame.m.columnX.length-1;
    const length=b.distance-a.distance,normal:Point2=[-(b.point[1]-a.point[1])/length,(b.point[0]-a.point[0])/length];
    for(let j=leg===0?0:1;j<=n;j++) {
      const t=j/n,s=j===0?a:j===n?b:{point:[a.point[0]+(b.point[0]-a.point[0])*t,a.point[1]+(b.point[1]-a.point[1])*t] as Point2,normal,distance:a.distance+length*t};
      // One pair of corner columns serves both legs. Use the larger adjacent
      // derived diameter; never stack duplicate columns at a turn.
      const diameter=j===n&&leg+1<frames.length?Math.max(frame.m.columnD,frames[leg+1].m.columnD):frame.m.columnD;
      const left=offsetStation(s,m.depthHalf),right=offsetStation(s,-m.depthHalf);
      for(const point of [left,right])columns.push({point,diameter,height:frame.m.columnH,baseWidth:frame.m.base});
      crossBeams.push({a:left,b:right,frame});
    }
  }
  return {origin,stations,frames,columns,crossBeams,deckPolygon,roofPolygon,halfDeck,halfRoof,length:stations.at(-1)!.distance};
}
