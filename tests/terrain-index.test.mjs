import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeTerrainField} from '@builder/compose/terrain-from-plan.ts';
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
    assert.deepEqual(fast.masks(x,z),reference.masks(x,z),`masks at ${x},${z}`);
  }
});
