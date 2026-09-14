import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditPlan } from '../tools/plan-audit.mjs';
import { terrainWindow } from '@builder/plan/window.ts';
import { setPlan, TERRAIN } from '@builder/compose/terrain.ts';
import { makeTerrainField } from '@builder/compose/terrain-from-plan.ts';
const plan = JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const ids = ['zhengmen','cuizhang','qinfang_ting_qiao','xiaoxiangguan'];

test('all region entrances, anchors and explicit pads are valid without legacy waivers', () => {
  const result=auditPlan(plan);
  assert.deepEqual(result.fails,[]);
  assert.ok(!result.pending.some(s=>s.includes('区域外')));
  const bad=structuredClone(plan);
  bad.regions.find(r=>r.id==='zhengmen').entrances.push([55,249]);
  assert.ok(auditPlan(bad).fails.some(s=>s.includes('entrance')));
});

test('moving a foundation into water fails even when its anchor is still in the region', () => {
  const p=structuredClone(plan),r=p.regions.find(r=>r.id==='tubi_aojing');
  const pad=r.pads.find(p=>p.id.endsWith('aojing-foundation'));
  pad.polygon=[[160,15],[172,15],[172,25],[160,25],[160,15]];
  assert.ok(auditPlan(p).fails.some(s=>s.includes('陆地基础与水体')));
});

test('south-facing Nuanxiang gate puts the courtyard north of the lane', () => {
  const result=auditPlan(plan);
  assert.equal(result.diagnostics.nuanxiangLane.southOfGate,true);
  const p=structuredClone(plan);
  const gate=p.regions.find(r=>r.id==='nuanxiangwu').buildings.find(b=>b.id.endsWith('south-gate'));
  gate.z=-16;
  assert.ok(auditPlan(p).fails.some(s=>s.startsWith('约束7')));
});

test('terrain/water/scatter window follows live plan injection instead of stale constants', () => {
  const w=terrainWindow(plan,ids);
  assert.deepEqual([w.minX,w.maxX,w.minZ,w.maxZ],[-160,110,43,261]);
  assert.ok(w.segX*w.segZ*2<600000);
  setPlan(plan, ids);
  assert.deepEqual(TERRAIN,w);
  const p=structuredClone(plan);
  for(const point of p.regions.find(r=>r.id==='zhengmen').polygon)point[1]+=10;
  setPlan(p, ids);
  assert.equal(TERRAIN.maxZ,271);
  assert.equal(TERRAIN.playMaxZ,269);
  setPlan(plan, ids);
  assert.throws(()=>terrainWindow(plan,['missing']),/缺区域/);
});

test('Tubi retains a high mountain outside the explicitly graded ridge terrace', () => {
  const f=makeTerrainField(plan,{seed:17910000});
  assert.equal(f.height(190,86),10.2);
  assert.equal(f.height(205.5,33),1.2);
  let peak=-Infinity;
  for(let x=152;x<=226;x+=4)for(let z=52;z<=130;z+=4)peak=Math.max(peak,f.height(x,z));
  assert.ok(peak>=18*.8,`实际峰值 ${peak}，不能为台地削掉山体`);
});
