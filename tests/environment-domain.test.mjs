import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RollingShadow } from '@engine/render/RollingShadow.ts';
import { makeWaterWindow, bakeSeabed } from '@engine/render/Water.ts';

const decode = byte => { const s=(byte/255-.5)*2;return Math.sign(s)*s*s*4; };

test('水深采样按传入世界窗口和水位工作，平移后深度及岸坡通道一致',()=>{
  const base={minX:-10,maxX:10,minZ:-8,maxZ:8},offset={x:80,z:160};
  const shifted={minX:base.minX+offset.x,maxX:base.maxX+offset.x,minZ:base.minZ+offset.z,maxZ:base.maxZ+offset.z};
  const a=makeWaterWindow(base),b=makeWaterWindow(shifted);
  const ground=(x,z)=>Math.hypot(x,z)/3-1.5;
  const first=bakeSeabed(ground,a,0);
  const second=bakeSeabed((x,z)=>ground(x-offset.x,z-offset.z)+3,b,3);
  assert.equal(a.resX,40);assert.equal(b.minZ,152);
  for(let i=0;i<first.image.data.length;i+=4)for(let c=0;c<3;c++)assert.equal(first.image.data[i+c],second.image.data[i+c]);
  const sample=(i,j)=>decode(first.image.data[(j*a.resX+i)*4]);
  assert.ok(sample(20,16)<-1);
  assert.ok(sample(0,0)>0);
  first.dispose();second.dispose();
});

test('滚动阴影在四个迁移后的区域覆盖玩家及身边构件',()=>{
  const light=new THREE.DirectionalLight(),direction=new THREE.Vector3(.52,.62,.58).normalize();
  const rolling=new RollingShadow(light,direction);
  for(const [x,y,z] of [[55,2,236],[8,12,202],[0,2,148],[-105,2,98]]){
    rolling.update(new THREE.Vector3(x,y,z),4096);
    for(const offset of [[0,0,0],[20,-2,10],[-20,8,-10],[0,-12,0]]){
      const p=new THREE.Vector3(x+offset[0],y+offset[1],z+offset[2]).project(light.shadow.camera);
      assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&Math.abs(p.z)<1,`${x},${z}: ${p.toArray()}`);
    }
  }
});

test('阴影投影按texel滚动，亚texel相机运动不改变接收点的XY投影',()=>{
  const light=new THREE.DirectionalLight(),rolling=new RollingShadow(light,new THREE.Vector3(.52,.62,.58));
  const point=new THREE.Vector3(2,0,2);
  rolling.update(new THREE.Vector3(),4096);
  const a=point.clone().project(light.shadow.camera);
  rolling.update(new THREE.Vector3(.0001,0,0),4096);
  const b=point.clone().project(light.shadow.camera);
  assert.ok(Math.abs(a.x-b.x)<1e-10&&Math.abs(a.y-b.y)<1e-10);
  rolling.update(new THREE.Vector3(1,0,0),4096);
  const c=point.clone().project(light.shadow.camera);
  for(const v of [(a.x-c.x)*2048,(a.y-c.y)*2048])assert.ok(Math.abs(v-Math.round(v))<1e-8);
});
