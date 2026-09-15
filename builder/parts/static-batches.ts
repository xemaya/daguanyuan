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
    let instancedAnyCell=false;
    for(const cell of cells){
      /*
       * 单子 AQ-b1:**阈值按簇算,不按桶算**。
       *
       * 以前是"整桶 ≥ threshold 就实例化",然后再按簇网格切开——于是一个只落
       * 1~2 件的簇也会单独开一个 `InstancedMesh`,那是**拿一个 draw call 换一件
       * 东西**,而它本来可以并进末端的材质桶里、一个 draw call 都不花。
       * 撤掉构件内部的提前合并之后这件事当场发作:原型从 2 涨到 13,
       * `InstancedMesh` 却涨到 48 个,四镜 draw call +6~+17。
       *
       * 阈值还是 8(单子写死的那个),只是问法从"这个原型全园有几件"
       * 改成"这个原型**在这一簇里**有几件"。够不够本的判断本来就该在
       * 一次提交的粒度上做。不够的簇退回 `residual`,照常按材质合并。
       */
      if(cell.items.length<threshold){for(const entry of cell.items)residual.add(flatten(entry));continue;}
      instancedAnyCell=true;
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
    if(instancedAnyCell)prototypes++;
  }
  /*
   * 残余按材质合并——这一步 AQ-b1 之前就是这样,没有改。
   *
   * ⚠️ 它有一个**本单没有动**的已知缺陷:合出来的是全园一种材质一个 mesh,
   * 包围球罩住 280×226m,视锥剔除对它无效。按簇分开合能把四镜三角压下去
   * 7%~11%,代价是 draw call +4~+8——那越过了本单"draw call 不升"的判据,
   * 所以量完交验收人裁,数在 docs/reviews/2026-09-15-aqb-findings.md §5。
   */
  const merged=mergeByMaterial(residual);
  for(const child of [...merged.children])out.add(child);
  for(const entry of keep)out.add(flatten(entry));
  out.userData.staticBatches={instances,prototypes};
  return out;
}
