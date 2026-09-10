import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {assembleStatic} from '@builder/parts/static-batches.ts';

test('重复构件跨空间簇共享一个几何，并保持父级平移与旋转',()=>{
 const root=new THREE.Group(),geometry=new THREE.BoxGeometry(2,3,4),material=new THREE.MeshStandardMaterial();
 root.position.set(10,2,-20);const expected=[];
 for(let i=0;i<10;i++){
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(i*18,0,i%2*10);mesh.rotation.y=i*.1;
  mesh.castShadow=true;root.add(mesh);
 }
 root.updateMatrixWorld(true);for(const mesh of root.children)expected.push(mesh.matrixWorld.clone());
 const result=assembleStatic(root,8,64),meshes=result.children.filter(m=>m.isInstancedMesh);
 assert.ok(meshes.length>1);assert.equal(result.userData.staticBatches.instances,10);
 assert.equal(new Set(meshes.map(m=>m.geometry)).size,1);
 const actual=[];for(const mesh of meshes)for(let i=0;i<mesh.count;i++){
  const matrix=new THREE.Matrix4();mesh.getMatrixAt(i,matrix);actual.push(matrix);
 }
 for(const matrix of expected)assert.ok(actual.some(m=>m.elements.every((n,i)=>Math.abs(n-matrix.elements[i])<1e-5)));
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
