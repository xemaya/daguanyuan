import type {Point2} from './geometry.ts';
import {segmentRelation} from './geometry.ts';
export interface PathStation {point:Point2; normal:Point2; distance:number}
export function pathStations(points:readonly Point2[]):PathStation[] {
  if(points.length<2||points.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))))throw new Error('路径须有至少两个有限坐标点');
  const legs=points.slice(1).map((b,i)=>{
    const a=points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(l<.01)throw new Error('路径含零长或过短段');
    return {l,t:[(b[0]-a[0])/l,(b[1]-a[1])/l] as Point2};
  });
  for(let i=0;i<legs.length;i++)for(let j=i+1;j<legs.length;j++) {
    const r=segmentRelation(points[i],points[i+1],points[j],points[j+1]);
    if(j===i+1?r!=='touch':r!=='none')throw new Error('路径不得自交、回折或自接触');
  }
  let distance=0;
  return points.map((point,i)=>{
    if(i>0)distance+=legs[i-1].l;
    if(i===0)return {point,normal:[-legs[0].t[1],legs[0].t[0]] as Point2,distance};
    if(i===points.length-1)return {point,normal:[-legs[i-1].t[1],legs[i-1].t[0]] as Point2,distance};
    const a=legs[i-1].t,b=legs[i].t,dot=a[0]*b[0]+a[1]*b[1];
    if(dot<-.5)throw new Error('转角超过120度，须增加转折空间');
    return {point,normal:[(-a[1]-b[1])/(1+dot),(a[0]+b[0])/(1+dot)] as Point2,distance};
  });
}
export const offsetStation=(s:PathStation,offset:number):Point2=>[s.point[0]+s.normal[0]*offset,s.point[1]+s.normal[1]*offset];
/** Closed footprint of an open strip. */
export function stripPolygon(stations:readonly PathStation[],halfWidth:number):Point2[] {
  const left=stations.map(s=>offsetStation(s,halfWidth)),right=stations.map(s=>offsetStation(s,-halfWidth)).reverse();
  return [...left,...right,left[0]];
}
