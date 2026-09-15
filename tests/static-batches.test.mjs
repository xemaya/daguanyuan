import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {assembleStatic} from '@builder/parts/static-batches.ts';

test('小构件可合为单实例簇且不改变任何放置矩阵',()=>{
 const root=new THREE.Group(),geo=new THREE.BoxGeometry(1,2,1),mat=new THREE.MeshStandardMaterial();
 for(let i=0;i<12;i++){const m=new THREE.Mesh(geo,mat);m.position.set(i%2?-2:2,0,i%3?-3:3);m.rotation.y=i*.1;root.add(m);}
 root.updateMatrixWorld(true);const expected=root.children.map(m=>m.matrixWorld.toArray());
 const result=assembleStatic(root,8,64,{singleCluster:true});
 const meshes=result.children.filter(m=>m.isInstancedMesh);assert.equal(meshes.length,1);assert.equal(meshes[0].count,12);
 const matrix=new THREE.Matrix4();for(let i=0;i<12;i++){meshes[0].getMatrixAt(i,matrix);matrix.toArray().forEach((n,k)=>assert.ok(Math.abs(n-expected[i][k])<1e-6));}
});

/*
 * 单子 AQ-b1 改了这一条的密度,没改它的意图。
 *
 * 意图是「同一个原型落在两个空间簇里,仍然共享同一份几何,且每一件的世界矩阵
 * 一位不差」。原来用 10 件铺 3 个簇,每簇 3~4 件——阈值改成**按簇算**之后,
 * 那样的稀簇会退回合并(一个只装 1~2 件的 `InstancedMesh` 是拿一个 draw call
 * 换一件东西,不如并进材质桶)。所以这里把密度提到每簇 10 件、两个簇,
 * 断言一字未改:簇数 > 1、实例总数 = 摆放数、几何只有一份、矩阵逐位对上。
 */
test('重复构件跨空间簇共享一个几何，并保持父级平移与旋转',()=>{
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(2,3,4),material=new THREE.MeshStandardMaterial();
 root.position.set(10,2,-20);const expected=[];
 // 两个相距 200m 的簇,各 10 件——每簇都够阈值 8。
 for(const cx of [0,200])for(let i=0;i<10;i++){
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(cx+i*2,0,i%2*3);mesh.rotation.y=i*.1;
  mesh.castShadow=true;root.add(mesh);
 }
 root.updateMatrixWorld(true);for(const mesh of root.children)expected.push(mesh.matrixWorld.clone());
 const result=assembleStatic(root,8,64),meshes=result.children.filter(m=>m.isInstancedMesh);
 assert.ok(meshes.length>1);assert.equal(result.userData.staticBatches.instances,20);
 assert.equal(new Set(meshes.map(m=>m.geometry)).size,1);
 const actual=[];for(const mesh of meshes)for(let i=0;i<mesh.count;i++){
  const matrix=new THREE.Matrix4();mesh.getMatrixAt(i,matrix);actual.push(matrix);
 }
 for(const matrix of expected)assert.ok(actual.some(m=>m.elements.every((n,i)=>Math.abs(n-matrix.elements[i])<1e-5)));
 geometry.dispose();material.dispose();
});

/*
 * 单子 AQ-b1 的新规矩:**阈值按簇算,不按桶算**。
 *
 * 为什么要这一条:撤掉构件内部的提前合并之后,原型从 2 涨到 13,但
 * `InstancedMesh` 涨到 48 个、四镜 draw call +6~+17——涨的全是那些
 * 「整桶够 8 件、切到某个簇里只剩 1 件」的簇。一件东西一个 draw call,
 * 而它本来可以并进末端的材质桶、一分钱不花。
 */
test('整桶够阈值、但某个簇里只有零星几件时，那个簇退回合并而不是单开一个实例网格',()=>{
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
 // 一簇 9 件(够 8),另一簇 2 件(不够)。整桶 11 件,老规矩会开两个 InstancedMesh。
 for(let i=0;i<9;i++){const m=new THREE.Mesh(geometry,material);m.position.set(i,0,0);root.add(m);}
 for(let i=0;i<2;i++){const m=new THREE.Mesh(geometry,material);m.position.set(500+i,0,0);root.add(m);}
 root.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(root);
 const result=assembleStatic(root,8,64);
 const instanced=result.children.filter(m=>m.isInstancedMesh);
 assert.equal(instanced.length,1,`稀簇应退回合并,实际开了 ${instanced.length} 个实例网格`);
 assert.equal(instanced[0].count,9);
 assert.equal(result.userData.staticBatches.instances,9);
 // 退回去的两件必须还在原地——合并不许把东西弄丢或挪位(名册门 LOST=0 的同一件事)。
 const after=new THREE.Box3().setFromObject(result);
 for(const k of ['x','y','z'])assert.ok(Math.abs(box.min[k]-after.min[k])<1e-5&&Math.abs(box.max[k]-after.max[k])<1e-5,
  `退回合并的件挪位了:${k} ${box.min[k]}..${box.max[k]} vs ${after.min[k]}..${after.max[k]}`);
 geometry.dispose();material.dispose();
});
test('单独保留的构件不会把父级或自身变换应用两次',()=>{
 const root=new THREE.Group();root.position.x=10;
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
 mesh.position.x=3;mesh.userData.keep=true;root.add(mesh);
 const result=assembleStatic(root);result.updateMatrixWorld(true);
 assert.equal(result.children[0].getWorldPosition(new THREE.Vector3()).x,13);
 mesh.geometry.dispose();mesh.material.dispose();
});

test('实例化不会把缺少顶点色的共用材质几何渲成黑色',()=>{
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial({vertexColors:true});
 for(let i=0;i<8;i++){const m=new THREE.Mesh(geometry,material);m.position.x=i*2;root.add(m);}
 const result=assembleStatic(root),mesh=result.children.find(m=>m.isInstancedMesh);
 assert.ok([...mesh.geometry.attributes.color.array].every(v=>v===1));
 assert.equal(geometry.getAttribute('color'),undefined);
 mesh.geometry.dispose();geometry.dispose();material.dispose();
});

/*
 * 单子 AQ-c:残余按簇分桶,跨簇不合。
 *
 * AQ-b1 之前 `mergeByMaterial` 是对全部残余一锅端——同材质全园一个 mesh,
 * 包围球罩住整座园子,视锥与阴影窗剔不掉。分桶之后,相距一个簇边长以上的
 * 残余不该被合进同一个 mesh。
 */
test('残余按簇分桶，跨簇不合',()=>{
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
 // 每簇 3 件,不够阈值 8,全部退回残余;两簇相距 300 m,跨过 128 m 的簇边。
 for(const cx of [0,300])for(let i=0;i<3;i++){const m=new THREE.Mesh(geometry,material);m.position.set(cx+i,0,0);root.add(m);}
 root.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(root);
 const result=assembleStatic(root,8,64);
 const merged=result.children.filter(m=>m.isMesh&&!m.isInstancedMesh);
 assert.ok(merged.length>=2,`残余应按簇分成至少两个 mesh,实际 ${merged.length}`);
 for(const mesh of merged){
  mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
  assert.ok(b.max.x-b.min.x<128&&b.max.z-b.min.z<128,`单个残余 mesh 跨簇了:x ${b.min.x}..${b.max.x}`);
 }
 // 分桶合并不许把东西弄丢或挪位——同名册 LOST=0 的同一件事。
 const after=new THREE.Box3().setFromObject(result);
 for(const k of ['x','y','z'])assert.ok(Math.abs(box.min[k]-after.min[k])<1e-5&&Math.abs(box.max[k]-after.max[k])<1e-5,
  `残余分桶合并挪了位:${k} ${box.min[k]}..${box.max[k]} vs ${after.min[k]}..${after.max[k]}`);
 geometry.dispose();material.dispose();
});
