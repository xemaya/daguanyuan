import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeTerrainField} from '@builder/compose/terrain-from-plan.ts';
import {makeGrassCoverField,bareSoilAmount,SOIL_GAP_FULL,SOIL_GAP_NONE} from '@builder/compose/grass-cover.ts';
import {bakeSplatMainData,bakeSplatExtData} from '@builder/compose/splat.ts';
import {terrainWindow} from '@builder/plan/window.ts';
import {makeRng} from '@engine/core/Noise.ts';

test('空间索引与穷举在地形、路口、湿岸和负坐标边界保持同值',()=>{
  const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
  const fast=makeTerrainField(plan,{seed:17910000});
  const reference=makeTerrainField(plan,{seed:17910000,spatialIndex:false});
  const rng=makeRng(9631),points=[];
  for(let i=0;i<1400;i++)points.push([(rng()-.5)*560,(rng()-.5)*560]);
  for(const p of [...plan.regions,...plan.water,...plan.hills])
    for(const [x,z] of p.polygon)for(const d of [-.2,0,.2])points.push([x+d,z-d]);
  for(const p of plan.paths)for(const [x,z] of p.points)
    for(const d of [-4,-2,0,2,4])points.push([x+d,z]);
  for(const [x,z] of points){
    assert.equal(fast.height(x,z),reference.height(x,z),`height at ${x},${z}`);
    assert.equal(fast.surface(x,z),reference.surface(x,z),`surface at ${x},${z}`);
    // deepEqual 覆盖全部 masks 字段,含单子 T 新增的 soil/wet。
    assert.deepEqual(fast.masks(x,z),reference.masks(x,z),`masks at ${x},${z}`);
  }
});

test('露土掩码与草密度同源:soil 生效当且仅当草被 gap 场落到阈值档',()=>{
  const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
  const field=makeTerrainField(plan,{seed:17910000});
  const cover=makeGrassCoverField(17910000);
  const rng=makeRng(4177);
  let bareSeen=0,grassSeen=0,pureSeen=0;
  for(let i=0;i<3000;i++){
    const x=(rng()-.5)*560,z=(rng()-.5)*560;
    const m=field.masks(x,z),gN=cover.gapN(x,z);
    // soil>0 只可能出现在 gapN 低于 SOIL_GAP_NONE 的地方。
    if(m.soil>0.05)assert.ok(gN<SOIL_GAP_NONE,`soil=${m.soil} but gapN=${gN} at ${x},${z}`);
    // 兜底草皮(路/铺装/沙/苔全为零)上,soil 必须与共享判定逐点同值。
    const pure=m.dirt===0&&m.cobble===0&&m.slab===0&&m.sand===0&&m.moss===0;
    if(pure){
      pureSeen++;
      assert.equal(m.soil,bareSoilAmount(gN)*0.9,`soil 与 bareSoil 判定不一致 at ${x},${z}`);
      if(gN<SOIL_GAP_FULL)bareSeen++;
      else if(gN>SOIL_GAP_NONE)grassSeen++;
    }
  }
  // 阈值必须真的落在场上:全裸档与丰茂档都要采到,否则上面的断言是空转。
  assert.ok(pureSeen>100,`只采到 ${pureSeen} 个兜底草皮点`);
  assert.ok(bareSeen>10,`只采到 ${bareSeen} 个全裸点`);
  assert.ok(grassSeen>10,`只采到 ${grassSeen} 个丰茂点`);
});

test('湿痕只出现在水线 ±1.2m 且高程贴水面的地带,且场上确实存在',()=>{
  const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
  const field=makeTerrainField(plan,{seed:17910000});
  const rng=makeRng(8111);
  let wetSeen=0;
  for(let i=0;i<3000;i++){
    const x=(rng()-.5)*560,z=(rng()-.5)*560;
    const m=field.masks(x,z);
    if(m.wet>0.05){
      assert.ok(Math.abs(field.height(x,z))<0.45,`wet=${m.wet} but h=${field.height(x,z)} at ${x},${z}`);
      wetSeen++;
    }
  }
  assert.ok(wetSeen>5,`只采到 ${wetSeen} 个湿痕点`);
});

test('两张 splat 图烘焙确定性:同 plan 同 seed 的两个场实例产出同字节流',()=>{
  const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
  const a=makeTerrainField(plan,{seed:17910000});
  const b=makeTerrainField(plan,{seed:17910000});
  const win=terrainWindow(plan,['zhengmen','cuizhang','qinfang_ting_qiao','xiaoxiangguan'],15,0.48);
  const size=160;
  assert.deepEqual(bakeSplatMainData(a,win,size),bakeSplatMainData(b,win,size));
  const extA=bakeSplatExtData(a,win,size),extB=bakeSplatExtData(b,win,size);
  assert.deepEqual(extA,extB);
  // 通道语义抽检:R=soil、G=wet,且 MVP 窗口里两者都真的烘出了非零像素。
  let soilPx=0,wetPx=0;
  for(let o=0;o<extA.length;o+=4){
    if(extA[o]>12)soilPx++;
    if(extA[o+1]>12)wetPx++;
    assert.equal(extA[o+2],0,'扩展 splat B 通道留空备用');
    assert.equal(extA[o+3],0,'扩展 splat A 通道留空备用');
  }
  assert.ok(soilPx>0,'扩展 splat 没有一个露土像素');
  assert.ok(wetPx>0,'扩展 splat 没有一个湿痕像素');
});
