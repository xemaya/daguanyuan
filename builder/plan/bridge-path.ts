import type {Point2} from './geometry.ts';
import {isSimpleRing} from './geometry.ts';
import {pathStations,stripPolygon} from './polyline.ts';
export const BRIDGE_RAIL={inset:.08,postWidth:.14,capWidth:.2} as const;
export interface BridgePathSpec {
  id:string;kind:'bridge';points:readonly Point2[];elevation_m:number;width_m:number;
  deckThickness_m:number;pierPitch_m:number;pierWidth_m:number;pierFootWidth_m:number;pierEmbed_m:number;
  railingHeight_m:number;basis:string;
  cutFeather_m:number;
  object?:string;routeLegs?:string[];
  deckMaterial?:'stone'|'wood';railingMaterial?:'stone'|'wood'|'vermilion';
  abutmentMode?:'cut-only'|'grade-dry';
  /** Road grading may meet a landing below the independent bridge deck. */
  approachElevation_m?:number;
}
export function compileBridgePath(spec:BridgePathSpec) {
  if(spec.kind!=='bridge'||!spec.id||!spec.basis?.trim()||!Number.isFinite(spec.elevation_m))throw new Error('桥路径须声明身份、标高与依据');
  for(const k of ['width_m','deckThickness_m','pierPitch_m','pierWidth_m','pierFootWidth_m','pierEmbed_m','railingHeight_m','cutFeather_m'] as const)
    if(!Number.isFinite(spec[k])||spec[k]<=0)throw new Error(`桥 ${k} 须为有限正数`);
  if(spec.width_m<=2*BRIDGE_RAIL.inset+BRIDGE_RAIL.capWidth*Math.SQRT2||spec.deckThickness_m<=.03||spec.pierFootWidth_m<spec.pierWidth_m)throw new Error('桥面净宽、厚度或墩脚尺寸不成立');
  if(spec.deckMaterial!==undefined&&!['stone','wood'].includes(spec.deckMaterial))throw new Error('未知桥面材料');
  if(spec.railingMaterial!==undefined&&!['stone','wood','vermilion'].includes(spec.railingMaterial))throw new Error('未知桥栏材料');
  if(spec.abutmentMode!==undefined&&!['cut-only','grade-dry'].includes(spec.abutmentMode))throw new Error('未知桥台整地模式');
  if(spec.approachElevation_m!==undefined&&(!Number.isFinite(spec.approachElevation_m)||spec.approachElevation_m>spec.elevation_m||spec.elevation_m-spec.approachElevation_m>spec.deckThickness_m+.08))throw new Error('接路标高须在桥面允许单阶范围内');
  const world=pathStations(spec.points),origin:Point2=[(Math.min(...spec.points.map(p=>p[0]))+Math.max(...spec.points.map(p=>p[0])))/2,(Math.min(...spec.points.map(p=>p[1]))+Math.max(...spec.points.map(p=>p[1])))/2];
  const stations=world.map(s=>({...s,point:[s.point[0]-origin[0],s.point[1]-origin[1]] as Point2}));
  const polygon=stripPolygon(stations,spec.width_m/2);
  if(!isSimpleRing(polygon))throw new Error('桥面自交');
  return {origin,stations,polygon,length:world.at(-1)!.distance,
    clearWidth:spec.width_m-2*BRIDGE_RAIL.inset-BRIDGE_RAIL.capWidth*Math.SQRT2};
}
