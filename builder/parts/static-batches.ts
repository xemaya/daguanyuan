import * as THREE from 'three';
import { ClusterGrid } from '@engine/scatter/cluster';
import { ScreenSizeCull, SMALL_PART_MAX_RADIUS } from '@engine/scatter/instancing';
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
  const out=new THREE.Group();
  const residualEntries:Entry[]=[];
  out.name=root.name;
  let instances=0,prototypes=0;
  // 单子 AX3:包围半径 < 0.5 m 的实例原型挂到这里,按簇、按屏幕尺寸藏远处的(见 ScreenSizeCull)。
  const smallParts=new ScreenSizeCull();
  const scale=new THREE.Vector3();
  const flatten=(entry:Entry)=>{
    const copy=entry.mesh.clone(false);
    copy.matrixAutoUpdate=false;copy.matrix.copy(entry.matrix);
    return copy;
  };
  for(const entries of buckets.values()){
    if(entries.length<threshold){residualEntries.push(...entries);continue;}
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
      if(cell.items.length<threshold){residualEntries.push(...cell.items);continue;}
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
      // 原型在世界里的包围半径 = 几何半径 × 这一簇里最大的实例缩放。
      let maxScale=0;
      for(const entry of cell.items){scale.setFromMatrixScale(entry.matrix);maxScale=Math.max(maxScale,scale.x,scale.y,scale.z);}
      const radius=geometry.boundingSphere!.radius*maxScale;
      if(radius<SMALL_PART_MAX_RADIUS)smallParts.addPart(mesh,cell.key,radius);
      else out.add(mesh);
      instances+=cell.items.length;
    }
    if(instancedAnyCell)prototypes++;
  }
  /*
   * 单子 AQ-c:残余先按簇分桶,簇内再按材质合并。
   *
   * AQ-b1 之前这里是 `mergeByMaterial(residual)` 一锅端——同材质全园一个 mesh,
   * 包围球罩住 280×226 m,视锥与阴影窗剔不掉,19 区时是 7.7M 三角的直接来源
   * (docs/reviews/2026-09-15-aqb-findings.md §5)。分桶用的还是本文件已有的
   * `ClusterGrid`,边长**与上面实例化用的 `cellSize` 无关**——128 m 是验收人
   * 就残余单独裁的(三档实测见单子文档),不许因为"复用同一个网格"就把两个
   * 边长焊成一个参数。跨簇不合并,同簇同材质仍然合。
   */
  const RESIDUAL_CLUSTER_SIZE=128;
  const residualGrid=new ClusterGrid<Entry>(RESIDUAL_CLUSTER_SIZE);
  for(const entry of residualEntries){
    const geometry=entry.mesh.geometry;
    if(!geometry.boundingSphere)geometry.computeBoundingSphere();
    const sphere=geometry.boundingSphere!.clone().applyMatrix4(entry.matrix);
    residualGrid.add(sphere.center.x,sphere.center.z,entry,sphere.center.y,sphere.radius);
  }
  for(const cell of residualGrid.cells()){
    const bucket=new THREE.Group();
    for(const entry of cell.items)bucket.add(flatten(entry));
    const merged=mergeByMaterial(bucket);
    for(const child of [...merged.children])out.add(child);
  }
  for(const entry of keep){
    const copy=flatten(entry);
    // 廊、桥、墙先各自 assembleStatic 过一遍,再整体进园子这一遍:里面那一遍挂上的小件
    // 在这里是 keep 的 InstancedMesh,要重新挂回这一遍的剔除器,不然就丢了。
    const small=(copy as THREE.InstancedMesh).isInstancedMesh?copy.userData.smallPart as {radius:number}|undefined:undefined;
    if(small){
      const mesh=copy as THREE.InstancedMesh;
      mesh.computeBoundingSphere();
      const c=mesh.boundingSphere!.center.clone().applyMatrix4(mesh.matrix);
      smallParts.addPart(mesh,`${Math.floor(c.x/cellSize)},${Math.floor(c.z/cellSize)}`,small.radius);
    }else out.add(copy);
  }
  if(smallParts.children.length)out.add(smallParts);
  out.userData.staticBatches={instances,prototypes};
  return out;
}
