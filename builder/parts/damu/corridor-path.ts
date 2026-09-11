import * as THREE from 'three';
import {compileCorridor,type CorridorPathSpec,type CompiledCorridor} from '@builder/plan/corridor-path';
import {offsetStation} from '@builder/plan/polyline';
import {deckGeometry} from '../shuigong/path-deck';
import type {Point2} from '@builder/plan/geometry';
import type {PartBuild} from '../registry';
import {CN,woodMaterial,stoneMaterial,tileMaterial} from '../materials';
import {roundedBox,boxProjectedUV} from '../sculpt';
import {assembleStatic} from '../static-batches';

export interface CorridorResult extends PartBuild {kind:'corridor-path';spec:CorridorPathSpec;path:CompiledCorridor}

export function buildCorridor(spec:CorridorPathSpec):CorridorResult {
  const path=compileCorridor(spec),root=new THREE.Group();
  const wood=woodMaterial(CN.wood,1),columnMat=woodMaterial(CN.column,1),stone=stoneMaterial(1),tile=tileMaterial(1,1);
  const add=(geo:THREE.BufferGeometry,mat:THREE.Material)=>{
    const mesh=new THREE.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;
  };
  add(deckGeometry(path.stations.map(s=>s.point),path.halfDeck,spec.platformH_m+spec.foundationDepth_m),stone).position.y=-spec.foundationDepth_m;
  const columnGeos=new Map<string,THREE.BufferGeometry>(),baseGeos=new Map<number,THREE.BufferGeometry>();
  for(const c of path.columns) {
    const key=`${c.diameter}:${c.height}`;
    let geo=columnGeos.get(key);
    if(!geo){geo=new THREE.CylinderGeometry(c.diameter/2*spec.columnTaperRatio,c.diameter/2,c.height,16);columnGeos.set(key,geo);}
    add(geo,columnMat).position.set(c.point[0],spec.platformH_m+c.height/2,c.point[1]);
    let base=baseGeos.get(c.baseWidth);
    if(!base){base=roundedBox(c.baseWidth,spec.footingHeight_m,c.baseWidth,.015,2);baseGeos.set(c.baseWidth,base);}
    add(base,stone).position.set(c.point[0],spec.platformH_m+spec.footingHeight_m/2,c.point[1]);
  }
  const beamGeos=new Map<string,THREE.BufferGeometry>();
  const beam=(a:Point2,b:Point2,h:number,w:number,top:number)=>{
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]),key=`${length}:${h}:${w}`;
    let geo=beamGeos.get(key);if(!geo){geo=roundedBox(length,h,w,.015,2);beamGeos.set(key,geo);}
    const mesh=add(geo,wood);
    mesh.position.set((a[0]+b[0])/2,top-h/2,(a[1]+b[1])/2);mesh.rotation.y=Math.atan2(-(b[1]-a[1]),b[0]-a[0]);
  };
  for(const b of path.crossBeams)beam(b.a,b.b,b.frame.m.lan.w,b.frame.m.lan.t,spec.platformH_m+b.frame.m.columnH);
  const frame=path.frames[0],m=frame.m;
  for(let i=1;i<path.stations.length;i++)for(const side of [-1,1]) {
    beam(offsetStation(path.stations[i-1],side*m.depthHalf),offsetStation(path.stations[i],side*m.depthHalf),
      Math.max(m.lan.w,m.eaveY-m.columnH),m.lan.t,spec.platformH_m+m.eaveY-spec.roofThickness_m+.003);
  }

  const left=frame.roofSection.map(p=>({z:p.s-path.halfRoof,y:p.y+spec.platformH_m}));
  const section=[...left,...left.slice(0,-1).reverse().map(p=>({z:-p.z,y:p.y}))];
  // Duplicate vertices at turns so the hip/valley crease has the correct normal;
  // position samples are shared numerically, so it cannot open a daylight gap.
  for(const bottom of [false,true]) {
    const positions:number[]=[],uv:number[]=[],indices:number[]=[];
    for(let i=1;i<path.stations.length;i++) {
      const first=positions.length/3;
      const a=path.stations[i-1],b=path.stations[i],length=b.distance-a.distance;
      const tx=(b.point[0]-a.point[0])/length,tz=(b.point[1]-a.point[1])/length;
      for(const station of [path.stations[i-1],path.stations[i]])for(const p of section) {
        const q=offsetStation(station,p.z);
        positions.push(q[0],p.y-(bottom?spec.roofThickness_m:0),q[1]);
        // Miter shear must not stretch the tile pitch. Project onto each leg's
        // physical tangent; the texture changes direction at the roof crease.
        uv.push((station.distance+(q[0]-station.point[0])*tx+(q[1]-station.point[1])*tz)/2.4,(p.z+path.halfRoof)/4.94);
      }
      const n=section.length;
      for(let k=0;k<n-1;k++) {
        const a=first+k,b=a+1,c=a+n,d=c+1;
        if(bottom)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
    add(geo,bottom?wood:tile);
  }
  // Continuous rounded eave boards run around bends without overlapping boxes.
  for(const side of [-1,1]) {
    const points=path.stations.map(s=>offsetStation(s,side*path.halfRoof));
    const geo=deckGeometry(points,.035,spec.roofThickness_m+.003);
    add(geo,wood).position.y=left[0].y-spec.roofThickness_m;
  }
  // The exposed section at each open end closes the roof shell, not the path.
  for(const i of [0,path.stations.length-1]) {
    const station=path.stations[i],positions:number[]=[],indices:number[]=[];
    for(const p of section) {
      const q=offsetStation(station,p.z);
      positions.push(q[0],p.y+.002,q[1],q[0],p.y-spec.roofThickness_m,q[1]);
    }
    for(let k=0;k<section.length-1;k++){const a=2*k;if(i===0)indices.push(a,a+1,a+2,a+1,a+3,a+2);else indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.setAttribute('uv',boxProjectedUV(geo));add(geo,wood);
  }
  const assembled=assembleStatic(root,8,64,{singleCluster:path.length<=64});assembled.name=spec.id;
  assembled.userData.linear={id:spec.id,kind:'corridor',spec,origin:path.origin,length:path.length,
    columns:path.columns.length,legs:path.frames.length,frames:path.frames.map(f=>({dimensions:f.m,provenance:f.provenance})),deckPolygon:path.deckPolygon};
  return {kind:'corridor-path',root:assembled,spec,path};
}
