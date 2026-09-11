import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { compileWallPath, wallMiterX, type WallPathSpec, type CompiledWallPath } from '@builder/plan/wall-path';
import { buildWall } from './wall';
import { WALL_STYLE } from './wall-style';
import { roundedBox } from '../sculpt';
import { stoneMaterial } from '../materials';
import { assembleStatic } from '../static-batches';

export interface WallPathResult extends PartBuild {
  kind:'wall-path';
  path:CompiledWallPath;
  spec:WallPathSpec;
}

/** Each opening keeps its native size. Plain spans are built at their actual
 * length; repeated spans share geometry, while end spans meet on miter planes.
 */
export function buildWallPath(spec:WallPathSpec):WallPathResult {
  const path=compileWallPath(spec),root=new THREE.Group(),cache=new Map<string,THREE.Object3D>();
  root.name=spec.id;
  for(const panel of path.panels) {
    // 月洞门的嵌件带 plan 对象 id 时一并传入,门额文字由 wall.ts 按 id 从 plan.json 读(99-26)。
    const variant=panel.variant==='moon'&&panel.insert?.object?`moon:${panel.insert.object}`:panel.variant;
    const key=JSON.stringify([variant,panel.length,panel.startMiter,panel.endMiter,spec.foundationDepth_m]);
    let prototype=cache.get(key);
    if(!prototype) {
      prototype=buildWall(variant,{length:panel.length,flushEnds:true}).root;
      if(spec.foundationDepth_m>0) {
        const footing=new THREE.Mesh(roundedBox(panel.length,spec.foundationDepth_m,WALL_STYLE.footHalf*2,.015,2),stoneMaterial(1));
        footing.position.y=-spec.foundationDepth_m/2;
        footing.castShadow=true;footing.receiveShadow=true;prototype.add(footing);
      }
      if(panel.startMiter||panel.endMiter)prototype.traverse(object=>{
        const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
        // Deform a private geometry; the source prototype may be reused elsewhere.
        const geo=mesh.geometry.clone(),p=geo.attributes.position;
        for(let i=0;i<p.count;i++)p.setX(i,wallMiterX(p.getX(i),p.getZ(i),panel.length,panel.startMiter,panel.endMiter));
        p.needsUpdate=true;geo.computeVertexNormals();mesh.geometry=geo;
      });
      cache.set(key,prototype);
    }
    const object=prototype.clone();
    object.position.set(panel.center[0],0,panel.center[1]);object.rotation.y=panel.yaw;
    object.name=panel.insert?.object??`${spec.id}:panel`;
    root.add(object);
  }
  const assembled=assembleStatic(root);
  assembled.name=spec.id;
  assembled.userData.linear={id:spec.id,kind:'wall',spec,origin:path.origin,length:path.length,
    panels:path.panels.length,prototypes:cache.size,openings:spec.inserts.filter(i=>i.variant==='moon')};
  return {kind:'wall-path',root:assembled,path,spec};
}
