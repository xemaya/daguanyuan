import * as THREE from 'three';
import {compileBridgePath,BRIDGE_RAIL,type BridgePathSpec} from '@builder/plan/bridge-path';
import {offsetStation} from '@builder/plan/polyline';
import type {Point2} from '@builder/plan/geometry';
import type {PartBuild} from '../registry';
import {stoneMaterial,woodMaterial,CN} from '../materials';
import {roundedBox} from '../sculpt';
import {assembleStatic} from '../static-batches';
import {deckGeometry} from './path-deck';
import {buildRusticPlankBridge} from './plank-bridge';
export interface BridgePathResult extends PartBuild {kind:'bridge-path';spec:BridgePathSpec;path:ReturnType<typeof compileBridgePath>}

export function buildBridgePath(spec:BridgePathSpec,ground:(x:number,z:number)=>number):BridgePathResult {
  // 单子 BB2:乡野板桥是新增的一支(plan 的 connection 声明 bridgeStyle:'rustic-plank'),园桥以下代码一行不经过。
  if((spec as {bridgeStyle?:string}).bridgeStyle==='rustic-plank')return buildRusticPlankBridge(spec,ground);
  const path=compileBridgePath(spec),root=new THREE.Group(),mat=stoneMaterial(1);
  const deck=spec.deckMaterial==='wood'?woodMaterial():mat;
  const rail=spec.railingMaterial==='vermilion'?woodMaterial(CN.bridgeVermilion):spec.railingMaterial==='wood'?woodMaterial():mat;
  const add=(geo:THREE.BufferGeometry,x=0,y=0,z=0,material:THREE.Material=mat)=>{const mesh=new THREE.Mesh(geo,material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;};
  add(deckGeometry(path.stations.map(s=>s.point),spec.width_m/2,spec.deckThickness_m),0,-spec.deckThickness_m,0,deck);
  const pierData:{point:Point2;bottom:number;top:number}[]=[];
  const postGeo=roundedBox(BRIDGE_RAIL.postWidth,spec.railingHeight_m,BRIDGE_RAIL.postWidth,.015,2),capGeo=roundedBox(BRIDGE_RAIL.capWidth,.08,BRIDGE_RAIL.capWidth,.025,2);
  const beam=(a:Point2,b:Point2,h:number,w:number,y:number)=>{
    const mesh=add(roundedBox(Math.hypot(b[0]-a[0],b[1]-a[1]),h,w,.015,2),(a[0]+b[0])/2,y,(a[1]+b[1])/2,rail);
    mesh.rotation.y=Math.atan2(-(b[1]-a[1]),b[0]-a[0]);
  };
  for(let i=1;i<path.stations.length;i++) {
    const a=path.stations[i-1],b=path.stations[i],length=b.distance-a.distance,n=Math.ceil(length/spec.pierPitch_m);
    const yaw=Math.atan2(-(b.point[1]-a.point[1]),b.point[0]-a.point[0]);
    for(let k=i===1?0:1;k<=n;k++) {
      const t=k/n,x=a.point[0]+(b.point[0]-a.point[0])*t,z=a.point[1]+(b.point[1]-a.point[1])*t;
      const bed=ground(x+path.origin[0],z+path.origin[1])-spec.elevation_m,top=-spec.deckThickness_m;
      if(!Number.isFinite(bed))throw new Error('桥墩地形采样无效');
      add(roundedBox(spec.pierFootWidth_m,spec.pierEmbed_m,spec.pierFootWidth_m,.025,2),x,bed-spec.pierEmbed_m/2,z).rotation.y=yaw;
      if(top>bed) add(roundedBox(spec.pierWidth_m,top-bed,spec.pierWidth_m,.02,2),x,(top+bed)/2,z).rotation.y=yaw;
      pierData.push({point:[x,z],bottom:bed-spec.pierEmbed_m,top});
    }
    for(const side of [-1,1]) {
      const p=offsetStation(a,side*(spec.width_m/2-BRIDGE_RAIL.inset)),q=offsetStation(b,side*(spec.width_m/2-BRIDGE_RAIL.inset));
      const count=Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/1.1);
      for(let k=i===1?0:1;k<=count;k++) {
        const t=k/count,x=p[0]+(q[0]-p[0])*t,z=p[1]+(q[1]-p[1])*t;
        add(postGeo,x,spec.railingHeight_m/2,z,rail);add(capGeo,x,spec.railingHeight_m+.02,z,rail);
      }
      beam(p,q,.08,.15,spec.railingHeight_m-.08);
      beam(p,q,spec.railingHeight_m*.5,.075,spec.railingHeight_m*.42);
    }
  }
  const assembled=assembleStatic(root,8,64,{singleCluster:path.length<=64});assembled.name=spec.id;
  assembled.userData.linear={id:spec.id,kind:'bridge',spec,origin:path.origin,length:path.length,piers:pierData};
  return {kind:'bridge-path',root:assembled,path,spec};
}
