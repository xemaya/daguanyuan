import type {Point2} from './geometry.ts';
import {isSimpleRing} from './geometry.ts';
import {pathStations,stripPolygon} from './polyline.ts';
export interface BridgePathSpec {
  id:string;kind:'bridge';points:readonly Point2[];elevation_m:number;width_m:number;
  deckThickness_m:number;pierPitch_m:number;pierWidth_m:number;pierFootWidth_m:number;pierEmbed_m:number;
  railingHeight_m:number;basis:string;
  cutFeather_m:number;
}
export function compileBridgePath(spec:BridgePathSpec) {
  if(spec.kind!=='bridge'||!spec.id||!spec.basis?.trim()||!Number.isFinite(spec.elevation_m))throw new Error('桥路径须声明身份、标高与依据');
  for(const k of ['width_m','deckThickness_m','pierPitch_m','pierWidth_m','pierFootWidth_m','pierEmbed_m','railingHeight_m','cutFeather_m'] as const)
    if(!Number.isFinite(spec[k])||spec[k]<=0)throw new Error(`桥 ${k} 须为有限正数`);
  const world=pathStations(spec.points),origin:Point2=[(Math.min(...spec.points.map(p=>p[0]))+Math.max(...spec.points.map(p=>p[0])))/2,(Math.min(...spec.points.map(p=>p[1]))+Math.max(...spec.points.map(p=>p[1])))/2];
  const stations=world.map(s=>({...s,point:[s.point[0]-origin[0],s.point[1]-origin[1]] as Point2}));
  const polygon=stripPolygon(stations,spec.width_m/2);
  if(!isSimpleRing(polygon))throw new Error('桥面自交');
  return {origin,stations,polygon,length:world.at(-1)!.distance};
}
