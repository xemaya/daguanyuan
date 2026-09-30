import * as THREE from 'three';
import {compileDistantScene,type DistantSceneSpec} from '@builder/plan/distant-scene';
import {buildBuilding,type BuildingOptions} from '../damu/building';
import {buildCorridor} from '../damu/corridor-path';
import {buildWallPath} from '../qiangyuan/wall-path';
import {assembleStatic} from '../static-batches';
import {roundedBox,boxProjectedUV} from '../sculpt';
import {CN,TILE_UV,woodMaterial,tileMaterial,plasterMaps,stoneMaterial,paperMaterial} from '../materials';
import {bakeColorMap,bakeNormalMap,mixHex,NOISE} from '@engine/core/TextureLab';
import {tileableFbm} from '@engine/core/Noise';
import {buildDistantTreeGeometry} from '../zhiwu/vegetation';
import {leafMaps,barkSet,leafClusterTexture,canopyPerforationMap} from '../zhiwu/foliage-materials';
import type {PartBuild} from '../registry';

let earth:THREE.Material|undefined,thatch:THREE.Material|undefined;
function rusticMaterials() {
 if(!earth) {const m=plasterMaps(),tint=new THREE.Color().setRGB(...mixHex(CN.wood,CN.stone,.5)).convertSRGBToLinear();earth=new THREE.MeshStandardMaterial({map:m.map,normalMap:m.normalMap,color:tint,roughness:1});}
 if(!thatch) {
  const grain=(u:number,v:number)=>.5+tileableFbm(NOISE.bark,u*4,v*.12,32,3)*.24;
  const rgb=mixHex(CN.woodLight,CN.paper,.4);
  const map=bakeColorMap({size:256,color:(u,v)=>{const k=.7+.35*grain(u,v);return [rgb[0]*k,rgb[1]*k,rgb[2]*k];}});
  thatch=new THREE.MeshStandardMaterial({map,normalMap:bakeNormalMap({size:256,height:grain},.5),roughness:1});
 }
 return {earth:earth!,thatch:thatch!};
}
let treeMaterials:{trunk:THREE.Material;canopy:THREE.Material;fringe:THREE.Material}|undefined;
function foliage() {
 if(!treeMaterials) {
  const b=barkSet('distant-bark',CN.column,CN.woodLight,.6,256),l=leafMaps('distant-warm',0x4e8c3c,0xaadd6c,256);
  treeMaterials={trunk:new THREE.MeshStandardMaterial({map:b.map,normalMap:b.normalMap,roughness:.95,vertexColors:true}),
   canopy:new THREE.MeshStandardMaterial({map:l.map,normalMap:l.normalMap,roughness:.9,vertexColors:true,alphaMap:canopyPerforationMap(),alphaTest:.22}),
   fringe:new THREE.MeshStandardMaterial({map:leafClusterTexture('distant-canopy',1791,17,1),roughness:.9,vertexColors:true,alphaTest:.38,side:THREE.DoubleSide})};
 }
 return treeMaterials;
}
const mesh=(g:THREE.BufferGeometry,m:THREE.Material,x=0,y=0,z=0)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;return o;};

export function buildDistantScene(scene:DistantSceneSpec,compiled:ReturnType<typeof compileDistantScene>,ground:(x:number,z:number)=>number):PartBuild {
 const root=new THREE.Group(),records:any[]=[],stone=stoneMaterial(),wood=woodMaterial();
 for(const item of compiled.items) {
  let object:THREE.Object3D;let base=item.elevation;
  let foundation:{hx:number;hz:number;round?:boolean;floorH:number}|null=null;
  const s=item.source,c=item.compiled;
  if(item.kind==='house'||item.kind==='house-ref') {
    const part=buildBuilding({...s.construction.options,spec:s.construction.spec} as BuildingOptions);object=part.root;
    foundation={hx:part.platform.hx-.02,hz:part.platform.hz-.02,floorH:part.platform.y};
  }
  else if(item.kind==='corridor')object=buildCorridor(s.spec).root;
  else if(item.kind==='wall'||item.kind==='wall-ref')object=buildWallPath(s.spec).root;
  else if(item.kind==='paving') {object=mesh(roundedBox(s.widthM,s.riseM,s.depthM,.02,2),stone,0,s.riseM/2,0);foundation={hx:s.widthM/2-.01,hz:s.depthM/2-.01,floorH:s.riseM};}
  else if(item.kind==='rustic') {
   const group=new THREE.Group(),m=c.m,mat=rusticMaterials(),floor=s.platformH;
   group.add(mesh(roundedBox(m.width+.6,floor,m.depth+.6,.02,2),stone,0,floor/2,0));
   group.add(mesh(roundedBox(m.width,m.columnH,m.depth,.04,2),mat.earth,0,floor+m.columnH/2,0));
   const facade=s.facade,z=m.depthHalf+.025;
   group.add(mesh(roundedBox(facade.doorWidthM,facade.doorHeightM,.07,.01,2),wood,0,floor+facade.doorHeightM/2,z));
   for(const sign of [-1,1]) {
    const x=sign*facade.windowX,y=floor+facade.windowY,w=facade.windowWidthM,h=facade.windowHeightM,t=facade.frameM;
    group.add(mesh(roundedBox(w,h,.04,.008,2),paperMaterial(),x,y,z));
    for(const [dx,dy,sx,sy] of [[-w/2,0,t,h],[w/2,0,t,h],[0,-h/2,w,t],[0,h/2,w,t],[0,0,t,h],[0,0,w,t]])
     group.add(mesh(roundedBox(sx,sy,.045,.006,1),wood,x+dx,y+dy,z+.025));
   }
   for(const x of m.columnX)for(const z of [-m.depthHalf,m.depthHalf])group.add(mesh(new THREE.CylinderGeometry(m.columnD/2,m.columnD/2,m.columnH,10),wood,x,floor+m.columnH/2,z));
   for(const z of [-m.depthHalf,m.depthHalf])group.add(mesh(roundedBox(m.width,m.lan.w,m.lan.t,.01,2),wood,0,floor+m.columnH+m.lan.w/2,z));
   const gable=new THREE.Shape([new THREE.Vector2(-m.depthHalf,m.columnH),new THREE.Vector2(m.depthHalf,m.columnH),
    new THREE.Vector2(m.depthHalf,m.eaveY-s.spec.thatchThicknessM),new THREE.Vector2(0,m.ridgeY-s.spec.thatchThicknessM),new THREE.Vector2(-m.depthHalf,m.eaveY-s.spec.thatchThicknessM)]);
   for(const sign of [-1,1]) {
    const g=new THREE.ExtrudeGeometry(gable,{depth:.12,bevelEnabled:true,bevelSize:.012,bevelThickness:.012,bevelSegments:2,steps:1});g.rotateY(Math.PI/2);g.translate(sign*m.width/2-.06,floor,0);g.setAttribute('uv',boxProjectedUV(g));group.add(mesh(g,mat.earth));
   }
   const r=m.depthHalf+m.yanchu,tip=c.roofSection[0].y,top=m.ridgeY,t=s.spec.thatchThicknessM;
   const shape=new THREE.Shape([new THREE.Vector2(-r,tip),new THREE.Vector2(0,top),new THREE.Vector2(r,tip),new THREE.Vector2(r,tip-t),new THREE.Vector2(0,top-t),new THREE.Vector2(-r,tip-t)]);
   const geo=new THREE.ExtrudeGeometry(shape,{depth:m.width+2*m.yanchu,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:2,steps:1});
   geo.rotateY(Math.PI/2);geo.translate(-(m.width+2*m.yanchu)/2,floor,0);geo.setAttribute('uv',boxProjectedUV(geo));group.add(mesh(geo,mat.thatch));
   object=group;
   foundation={hx:m.width/2+.28,hz:m.depthHalf+.28,floorH:floor};
  } else if(item.kind==='round') {
   const group=new THREE.Group(),m=c.m,floor=s.spec.design.platformH;
   const pr=c.platformRadius,bevel=Math.min(.03,floor/4);
   const baseProfile=[[0,0],[pr-bevel,0],[pr,bevel],[pr,floor-bevel],[pr-bevel,floor],[0,floor]].map(([x,y])=>new THREE.Vector2(x,y));
   group.add(mesh(new THREE.LatheGeometry(baseProfile,64),stone));
   for(const [x,z] of c.columns) {
    group.add(mesh(new THREE.CylinderGeometry(m.columnD*.46,m.columnD/2,m.columnH,14),wood,x,floor+m.columnH/2,z));
    group.add(mesh(roundedBox(m.base,.12,m.base,.02,2),stone,x,floor+.06,z));
   }
   const profile=c.roofProfile.slice().reverse().map((p:{r:number;y:number})=>new THREE.Vector2(p.r,p.y+floor));
   const lower=profile.slice().reverse().map((p:THREE.Vector2)=>new THREE.Vector2(p.x,p.y-s.spec.design.roofThicknessM));
   const section=[...profile,...lower,profile[0]],distances=[0];
   for(let i=1;i<section.length;i++)distances.push(distances[i-1]+section[i].distanceTo(section[i-1]));
   const roof=new THREE.LatheGeometry(section,64),uv=roof.attributes.uv;
   for(let i=0;i<=64;i++)for(let j=0;j<section.length;j++)uv.setXY(i*section.length+j,i/64*c.roofRadius*2*Math.PI*TILE_UV.u,distances[j]*TILE_UV.v);
   roof.computeVertexNormals();group.add(mesh(roof,tileMaterial()));
   for(let i=0;i<8;i++) {
    const a=c.columns[i],b=c.columns[(i+1)%8],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const beam=mesh(roundedBox(length,m.lan.w,m.lan.t,.012,2),wood,(a[0]+b[0])/2,floor+m.eaveY-s.spec.design.roofThicknessM-m.lan.w/2,(a[1]+b[1])/2);
    beam.rotation.y=Math.atan2(-(b[1]-a[1]),b[0]-a[0]);group.add(beam);
   }
   object=group;
   foundation={hx:c.platformRadius-.02,hz:c.platformRadius-.02,round:true,floorH:floor};
  } else if(item.kind==='tree') {
   const g=buildDistantTreeGeometry(s.seed),m=foliage(),group=new THREE.Group();
   group.add(mesh(g.trunk,m.trunk),mesh(g.canopy,m.canopy),mesh(g.fringe,m.fringe));group.scale.setScalar(s.heightM/g.height);
   base=ground(item.at[0],item.at[1]);object=group;
  } else throw new Error('未实现远景类型');
  object.rotation.y=item.yaw;object.position.add(new THREE.Vector3(item.at[0]-compiled.origin[0],base-compiled.origin[1],item.at[1]-compiled.origin[2]));object.name=scene.id+'.'+item.id;
  // Fill only below a real platform/wall footprint, not under overhanging roofs
  // or across the opening in a tree canopy. Terrain itself remains untouched.
  if(item.kind!=='tree') {
   const b=new THREE.Box3().setFromObject(object);
   let low=Infinity,high=-Infinity;
   const sampleAxis=(half:number)=>Array.from({length:Math.ceil(half*4)+1},(_,i)=>-half+2*half*i/Math.ceil(half*4));
   const samples=foundation?sampleAxis(foundation.hx).flatMap(x=>sampleAxis(foundation.hz).map(z=>[
    item.at[0]+x*Math.cos(item.yaw)+z*Math.sin(item.yaw),item.at[1]-x*Math.sin(item.yaw)+z*Math.cos(item.yaw)])):
    [[b.min.x+compiled.origin[0],b.min.z+compiled.origin[2]],[b.max.x+compiled.origin[0],b.max.z+compiled.origin[2]]];
   for(const [x,z] of samples) {
    const h=ground(x,z);low=Math.min(low,h);high=Math.max(high,h);
   }
   if(foundation&&high>base+foundation.floorH-.03)throw new Error(`${scene.id}/${item.id}台基被地形埋入，须修订落位标高`);
   if(item.kind==='corridor') {
    for(const [x,z] of c.deckPolygon)if(ground(x+c.origin[0],z+c.origin[1])>base+s.spec.platformH_m-.03)
      throw new Error(`${scene.id}/${item.id}廊面被地形埋入`);
   }
   records.push({id:item.id,kind:item.kind,base,groundLow:low,groundHigh:high,position:[item.at[0],base,item.at[1]],source:s,
    provenance:c?.provenance??c?.modules?.map((m:any)=>m.frame.provenance)});
   // Walls and corridors already declare their own below-floor foundations.
   if(foundation&&low<base) {
    const h=base-low+scene.foundationEmbedM;
    // The platform dimensions come from the frame, rather than the larger roof bbox.
    const {hx,hz}=foundation;
    const shape=foundation.round?new THREE.CylinderGeometry(hx,hx,h,64):roundedBox(hx*2,h,hz*2,.025,2);
    const pad=mesh(shape,stone,item.at[0]-compiled.origin[0],base-compiled.origin[1]-h/2,item.at[1]-compiled.origin[2]);pad.rotation.y=item.yaw;root.add(pad);
   }
  } else records.push({id:item.id,kind:item.kind,base,source:s,note:'existing procedural broadleaf geometry at distant resolution; no species or near-detail claim'});
  root.add(object);
  object.updateWorldMatrix(true,true);
  const b=new THREE.Box3().setFromObject(object);records.at(-1).bounds={min:b.min.toArray(),max:b.max.toArray()};
  if(item.kind==='tree') {
   let radius=0;const p=new THREE.Vector3();
   object.traverse(o=>{if(!(o as THREE.Mesh).isMesh)return;const m=o as THREE.Mesh,positions=m.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){p.fromBufferAttribute(positions as THREE.BufferAttribute,i).applyMatrix4(m.matrixWorld);radius=Math.max(radius,Math.hypot(p.x-object.position.x,p.z-object.position.z));}});
   if(radius>s.radiusM+.001)throw new Error(`${scene.id}/${item.id}实际树冠半径${radius.toFixed(2)}m超出预留${s.radiusM}m`);
   records.at(-1).actualRadius=radius;
  }
 }
 root.updateWorldMatrix(true,true);
 const bounds=new THREE.Box3().setFromObject(root);
 const assembled=assembleStatic(root,8,64,{singleCluster:false});assembled.name=scene.id;
 assembled.userData.distant={id:scene.id,origin:compiled.origin,detail:'distant',nearDetailReady:false,records,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},basis:scene.basis};
 return {kind:'distant-scene',root:assembled};
}
