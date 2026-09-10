import test from 'node:test';
import assert from 'node:assert/strict';
import { ClusterGrid, BoundsIndex, distanceToPolyline } from '@engine/scatter/cluster.ts';
import { buildTerrainChunks } from '@engine/render/TerrainChunks.ts';
import { ClusteredInstancePool, makeInstanced } from '@engine/scatter/instancing.ts';
import { makeRng } from '@engine/core/Noise.ts';
import { instanceWindPadding } from '@engine/scatter/wind.ts';
import * as THREE from 'three';

test('网格分簇保留成员，负坐标与边界不会混入错误格', () => {
  const g = new ClusterGrid(64);
  g.add(10, 10, 'a'); g.add(20, 20, 'b'); g.add(200, 10, 'c');
  g.add(-0.01, 10, 'd'); g.add(64, 10, 'e');
  assert.equal(g.cells().length, 4);
  assert.deepEqual(g.cells().find(c => c.items.length === 2).items, ['a', 'b']);
  assert.deepEqual(new ClusterGrid(64).cells(), []);
});

test('远近草密度按整条路段判断，长段中间不能被当作远离游线',()=>{
  assert.equal(distanceToPolyline(50,3,[[0,0],[100,0]]),3);
  assert.equal(distanceToPolyline(-3,4,[[0,0],[100,0]]),5);
  assert.equal(distanceToPolyline(3,4,[[0,0],[0,0]]),5);
});

test('实例包围球的风动余量覆盖叶片加柔和最大实例振幅',()=>{
  const geo=new THREE.PlaneGeometry();
  geo.setAttribute('aFlex',new THREE.Float32BufferAttribute([1.45,0,1,0,.2,0,0,0],2));
  geo.setAttribute('aWind',new THREE.InstancedBufferAttribute(new Float32Array([0,1.45]),2));
  const mat=new THREE.MeshStandardMaterial();mat.userData.windScale=1.25;
  const mesh=new THREE.InstancedMesh(geo,mat,1);
  assert.ok(instanceWindPadding(mesh)>2.7);
  geo.dispose();mat.dispose();
});

test('独立草簇共享原型顶点，保留各自的实例风数据',()=>{
 const geo=new THREE.PlaneGeometry(),mat=new THREE.MeshStandardMaterial();
 const a=makeInstanced(geo,mat,2,makeRng(1)),b=makeInstanced(geo,mat,3,makeRng(2));
 assert.notEqual(a.geometry,b.geometry);
 assert.equal(a.geometry.attributes.position,b.geometry.attributes.position);
 assert.equal(a.geometry.index,b.geometry.index);
 assert.notEqual(a.geometry.attributes.aWind,b.geometry.attributes.aWind);
 assert.equal(a.geometry.attributes.aWind.count,2);assert.equal(b.geometry.attributes.aWind.count,3);
 a.geometry.dispose();b.geometry.dispose();geo.dispose();mat.dispose();
});

test('簇包围球包含每个成员的实际范围', () => {
  const g = new ClusterGrid(64);
  const pts = [{x:5,z:5,y:-2,r:1},{x:60,z:60,y:12,r:8},{x:30,z:10,y:3,r:2}];
  for(const p of pts) g.add(p.x,p.z,p,p.y,p.r);
  const c = g.cells()[0];
  for(const p of pts) assert.ok(Math.hypot(p.x-c.center.x,p.y-c.center.y,p.z-c.center.z)+p.r<=c.radius+1e-9);
});

test('区域索引扩大候选范围且保持原叠加顺序', () => {
  const index = new BoundsIndex(16);
  index.add({minX:-30,maxX:0,minZ:-3,maxZ:3}, 'first', 2);
  index.add({minX:-1,maxX:18,minZ:0,maxZ:4}, 'second');
  assert.deepEqual(index.query(0,1), ['first','second']);
  assert.ok(index.query(-31,0).includes('first'));
  assert.deepEqual(index.query(100,100), []);
  assert.throws(()=>new BoundsIndex(0));
});

test('地形块共享全局格点与法线，余下不整块也完整覆盖', () => {
  let calls=0;
  const field={height:(x,z)=>{calls++;return .2*x-.1*z+2;}};
  const bounds={minX:-7,maxX:14,minZ:3,maxZ:18};
  const chunks=buildTerrainChunks(field,bounds,8,{segX:21,segZ:15});
  assert.equal(chunks.length,6);
  assert.equal(calls,(21+3)*(15+3));
  const seen=new Map();let triangles=0;
  for(const mesh of chunks){
    const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal;
    triangles+=g.index.count/3;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i),key=`${x},${z}`;
      const actual=[p.getY(i),n.getX(i),n.getY(i),n.getZ(i)];
      assert.ok(Math.abs(actual[0]-(.2*x-.1*z+2))<1e-6);
      const len=Math.hypot(.2,1,.1);
      assert.ok(Math.abs(actual[1]+.2/len)<1e-6);
      if(seen.has(key))assert.deepEqual(actual,seen.get(key));
      seen.set(key,actual);
    }
    g.dispose();
  }
  assert.equal(triangles,21*15*2);
  assert.equal(seen.size,22*16);
});

test('实例分簇保持矩阵、颜色和风相位对应，画面外投影者仍由阴影相机剔除',()=>{
  const root=new THREE.Group(),geometry=new THREE.BoxGeometry(1,2,1);
  geometry.setAttribute('aWind',new THREE.InstancedBufferAttribute(new Float32Array([1,2,3,4]),2));
  const source=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial(),2);
  source.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-65,0,0));
  source.setMatrixAt(1,new THREE.Matrix4().makeTranslation(65,0,0));
  source.setColorAt(0,new THREE.Color(1,0,0));source.setColorAt(1,new THREE.Color(0,1,0));
  source.position.z=5;source.castShadow=true;root.add(source);
  const pool=new ClusteredInstancePool(root,32);pool.add([source]);
  const camera=new THREE.PerspectiveCamera();camera.position.set(0,1,0);camera.updateMatrixWorld();pool.update(camera);
  assert.equal(root.children.length,2);
  assert.equal(new Set(root.children.map(m=>m.geometry.attributes.position)).size,1);
  assert.equal(new Set(root.children.map(m=>m.geometry.attributes.aWind)).size,2);
  for(const mesh of root.children){
    assert.equal(mesh.visible,true);assert.equal(mesh.frustumCulled,true);
    const m=new THREE.Matrix4();mesh.getMatrixAt(0,m);
    const left=m.elements[12]<0;
    assert.equal(m.elements[14],5);
    assert.equal(mesh.geometry.attributes.aWind.getX(0),left?1:3);
    const c=new THREE.Color();mesh.getColorAt(0,c);assert.equal(c.r,left?1:0);
    mesh.geometry.dispose();
  }
});

test('按需簇只在接近时分配实例，重复访问不重建',()=>{
  const root=new THREE.Group(),pool=new ClusteredInstancePool(root);let builds=0;
  pool.addLazy(new THREE.Vector3(200,0,0),5,()=>{
    builds++;
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),3);
    for(let i=0;i<3;i++)mesh.setMatrixAt(i,new THREE.Matrix4().makeTranslation(200+i,0,0));
    return [mesh];
  },26);
  const camera=new THREE.PerspectiveCamera();camera.updateMatrixWorld();pool.update(camera);
  assert.equal(builds,0);
  camera.position.x=190;camera.updateMatrixWorld();pool.update(camera);
  assert.equal(builds,1);assert.equal(pool.stats().instances,3);
  camera.position.x=0;camera.updateMatrixWorld();pool.update(camera);
  assert.equal(root.children[0].visible,false);
  camera.position.x=190;camera.updateMatrixWorld();pool.update(camera);
  assert.equal(builds,1);
  root.children[0].geometry.dispose();
});
