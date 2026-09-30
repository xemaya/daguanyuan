import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { RollingShadow } from '@engine/render/RollingShadow.ts';
import { makeWaterWindow, bakeSeabed, bakeFlow } from '@engine/render/Water.ts';
import { makeTerrainField } from '@builder/compose/terrain-from-plan.ts';

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

/* ---- flowTex(单子 S:水要流起来) --------------------------------------- */

const flowTexel=(tex,win,x,z)=>{
  const dx=win.width/win.resX,dz=win.depth/win.resZ;
  const i=Math.round((x-win.minX)/dx-0.5),j=Math.round((z-win.minZ)/dz-0.5);
  const o=(j*win.resX+i)*4,d=tex.image.data;
  return {dir:[d[o]/255*2-1,d[o+1]/255*2-1],speed:d[o+2]/255,type:d[o+3]/255};
};

test('flowTex 与 bakeSeabed 同域平移不变且确定',()=>{
  const pool={id:'p',polygon:[[-6,-7],[6,-7],[6,7],[-6,7],[-6,-7]],flow_m_s:0};
  const creek={id:'c',polygon:[[-8,-3],[8,-3],[8,3],[-8,3],[-8,-3]],centerline:[[-8,0],[8,0]],flow_m_s:0.5};
  const base={minX:-12,maxX:12,minZ:-10,maxZ:10},offset={x:80,z:160};
  const shifted={minX:base.minX+offset.x,maxX:base.maxX+offset.x,minZ:base.minZ+offset.z,maxZ:base.maxZ+offset.z};
  const shift=sys=>sys.map(s=>({...s,polygon:s.polygon.map(([x,z])=>[x+offset.x,z+offset.z]),centerline:s.centerline?.map(([x,z])=>[x+offset.x,z+offset.z])}));
  const ground=(x,z)=>Math.hypot(x,z)/3-1.5;
  const a=makeWaterWindow(base),b=makeWaterWindow(shifted);
  const first=bakeFlow(ground,[pool,creek],a);
  const second=bakeFlow((x,z)=>ground(x-offset.x,z-offset.z),shift([pool,creek]),b);
  assert.deepEqual([...second.image.data],[...first.image.data]);
  // 确定性:同输入再烘一次完全一致
  const third=bakeFlow(ground,[pool,creek],a);
  assert.deepEqual([...third.image.data],[...first.image.data]);
  first.dispose();second.dispose();third.dispose();
});

test('溪段流向自动取地形下坡方向,数据写反会被纠正',()=>{
  const creek={id:'c',polygon:[[-8,-3],[8,-3],[8,3],[-8,3],[-8,-3]],centerline:[[-8,0],[8,0]],flow_m_s:0.5};
  const win=makeWaterWindow({minX:-12,maxX:12,minZ:-10,maxZ:10});
  // 地面向 +x 升高:水必须从 +x 流向 -x,与 authored 次序相反
  const risesEast=bakeFlow((x,z)=>0.1*x-1,[creek],win);
  const t=risesEast.image.data;
  const mid=flowTexel(risesEast,win,0,0);
  assert.ok(mid.dir[0]<-0.9&&Math.abs(mid.dir[1])<0.1,`应流向 -x,实际 ${mid.dir}`);
  assert.ok(mid.speed>0.4&&mid.type===1);
  // 坡度反转,流向随之反转
  const risesWest=bakeFlow((x,z)=>-0.1*x-1,[creek],win);
  const mid2=flowTexel(risesWest,win,0,0);
  assert.ok(mid2.dir[0]>0.9,`应流向 +x,实际 ${mid2.dir}`);
  // 平坡(高差噪声级)保留 authored 次序:+x
  const flat=bakeFlow(()=>-1,[creek],win);
  assert.ok(flowTexel(flat,win,0,0).dir[0]>0.9);
  risesEast.dispose();risesWest.dispose();flat.dispose();
});

test('池域流速为零、类型为池,陆地 texel 为中性',()=>{
  const pool={id:'p',polygon:[[-6,-7],[6,-7],[6,7],[-6,7],[-6,-7]],flow_m_s:0};
  const creek={id:'c',polygon:[[10,-3],[24,-3],[24,3],[10,3],[10,-3]],centerline:[[10,0],[24,0]],flow_m_s:0.5};
  const win=makeWaterWindow({minX:-12,maxX:28,minZ:-10,maxZ:10});
  const tex=bakeFlow(()=>-1,[pool,creek],win);
  const c=flowTexel(tex,win,0,0);
  assert.equal(c.speed,0);assert.equal(c.type,0);
  const land=flowTexel(tex,win,-10,8);
  assert.equal(land.speed,0);assert.equal(land.type,0);
  const cr=flowTexel(tex,win,17,0);
  assert.ok(cr.speed>0.4&&cr.type===1);
  tex.dispose();
});

test('真实水系:溪段中心线带速、流向不与地形下坡矛盾,池心为零速',()=>{
  const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
  const field=makeTerrainField(plan,{seed:17910000});
  const ground=(x,z)=>field.height(x,z);
  const win=makeWaterWindow({minX:-240,maxX:220,minZ:-240,maxZ:240},0.5);
  const tex=bakeFlow(ground,plan.water,win);
  const bankMax=(p,r)=>{let m=ground(p[0],p[1]);for(let k=0;k<8;k++){const a=k/8*Math.PI*2;m=Math.max(m,ground(p[0]+Math.cos(a)*r,p[1]+Math.sin(a)*r));}return m;};
  for(const w of plan.water){
    if(!(w.flow_m_s>0)){
      // 池心零速
      const xs=w.polygon.map(p=>p[0]),zs=w.polygon.map(p=>p[1]);
      const cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
      assert.equal(flowTexel(tex,win,cx,cz).speed,0,`${w.id} 池心应零速`);
      continue;
    }
    const line=w.centerline;
    // 每个中段折点的最近 texel:流速接近声明值、类型为溪
    for(let k=1;k+1<line.length;k++){
      const t=flowTexel(tex,win,line[k][0],line[k][1]);
      assert.ok(t.speed>w.flow_m_s*0.6,`${w.id} 折点${k} 流速 ${t.speed} 应接近 ${w.flow_m_s}`);
      assert.equal(t.type,1,`${w.id} 折点${k} 应为流动水体`);
    }
    // 下坡一致性:独立环采样两端岸高,差值超门槛时烘焙方向必须指向低端;
    // 园内平坡段(差值低于门槛)保留 authored 次序,不要求翻转。
    const r=6;
    const h0=bankMax(line[0],r),h1=bankMax(line[line.length-1],r);
    if(h1-h0>0.4){
      const k=Math.floor(line.length/2),a=line[k-1],b=line[k+1];
      const L=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const t=flowTexel(tex,win,line[k][0],line[k][1]);
      const dot=((b[0]-a[0])/L)*t.dir[0]+((b[1]-a[1])/L)*t.dir[1];
      assert.ok(dot<0,`${w.id} 端点下游岸高更高,流向应逆 authored 次序`);
    }
  }
  tex.dispose();
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
