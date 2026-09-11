import * as THREE from 'three';
import { ClusterGrid } from '@engine/scatter/cluster';
import { mergeByMaterial } from './merge';

interface Entry { mesh: THREE.Mesh; matrix: THREE.Matrix4 }

/** Instance repeated prototypes before material merging would duplicate their vertices. */
export function assembleStatic(root: THREE.Object3D, threshold = 8, cellSize = 64, options:{singleCluster?:boolean} = {}): THREE.Group {
  root.updateWorldMatrix(true,true);
  const buckets=new Map<string,Entry[]>(),keep:Entry[]=[];
  root.traverseVisible(object=>{
    const mesh=object as THREE.Mesh;
    if(!mesh.isMesh)return;
    const entry={mesh,matrix:mesh.matrixWorld.clone()};
    if((mesh as THREE.InstancedMesh).isInstancedMesh||mesh.userData.keep||Array.isArray(mesh.material)||entry.matrix.determinant()<0){
      keep.push(entry);return;
    }
    const key=[mesh.geometry.uuid,mesh.material.uuid,mesh.castShadow,mesh.receiveShadow,mesh.renderOrder,mesh.layers.mask].join(':');
    let list=buckets.get(key);if(!list){list=[];buckets.set(key,list);}list.push(entry);
  });
  const out=new THREE.Group(),residual=new THREE.Group();
  out.name=root.name;
  let instances=0,prototypes=0;
  const flatten=(entry:Entry)=>{
    const copy=entry.mesh.clone(false);
    copy.matrixAutoUpdate=false;copy.matrix.copy(entry.matrix);
    return copy;
  };
  for(const entries of buckets.values()){
    if(entries.length<threshold){for(const entry of entries)residual.add(flatten(entry));continue;}
    const source=entries[0].mesh,material=source.material as THREE.Material;
    let geometry=source.geometry;
    if((material as THREE.MeshStandardMaterial).vertexColors&&!geometry.getAttribute('color')){
      geometry=geometry.clone();
      geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count*3).fill(1),3));
    }
    if(!geometry.boundingSphere)geometry.computeBoundingSphere();
    // Small parts otherwise split into four cells merely because their local
    // origin is centred at zero. Keeping their light repeated geometry together
    // saves submissions without changing a vertex or the instance transforms.
    let cells:{key:string;items:Entry[]}[];
    if(options.singleCluster)cells=[{key:'part',items:entries}];
    else {
      const grid=new ClusterGrid<Entry>(cellSize);
      for(const entry of entries){
        const sphere=geometry.boundingSphere!.clone().applyMatrix4(entry.matrix);
        grid.add(sphere.center.x,sphere.center.z,entry,sphere.center.y,sphere.radius);
      }
      cells=grid.cells();
    }
    for(const cell of cells){
      // Every cell references the same BufferGeometry, so the prototype's
      // vertex/index buffers are uploaded once, not copied for each placement.
      const mesh=new THREE.InstancedMesh(geometry,material,cell.items.length);
      cell.items.forEach((entry,i)=>mesh.setMatrixAt(i,entry.matrix));
      mesh.instanceMatrix.needsUpdate=true;
      mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;
      mesh.customDepthMaterial=source.customDepthMaterial;mesh.customDistanceMaterial=source.customDistanceMaterial;
      mesh.renderOrder=source.renderOrder;mesh.layers.mask=source.layers.mask;
      mesh.name=`StaticInstances_${prototypes}_${cell.key}`;
      mesh.userData.placements=cell.items.map(entry=>entry.mesh.parent?.name||entry.mesh.name);
      mesh.computeBoundingSphere();mesh.computeBoundingBox();
      out.add(mesh);instances+=cell.items.length;
    }
    prototypes++;
  }
  const merged=mergeByMaterial(residual);
  for(const child of [...merged.children])out.add(child);
  for(const entry of keep)out.add(flatten(entry));
  out.userData.staticBatches={instances,prototypes};
  return out;
}
