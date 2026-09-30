import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileConstruction} from '@builder/derive/construction.ts';
import {compileRearDoor,compileExteriorSteps} from '@builder/plan/building-access.ts';
import {auditNarrative} from '../tools/narrative-audit.mjs';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const house=plan.regions.find(r=>r.id==='xiaoxiangguan').buildings.find(b=>b.id==='xiaoxiangguan.main-house');

test('small rear door stays in the west room and rejects a hole through a column or beam',()=>{
 const c=compileConstruction(house.construction),m=c.modules[0].frame.m,s=house.construction.options.backDoor;
 assert.equal(c.rearDoor.z,-3.36);assert.equal(c.rearDoor.width,1.2);assert.equal(c.rearDoor.height,2.1);
 assert.ok(Math.abs((c.rearDoor.left+c.rearDoor.right)/2+3.3)<1e-9);
 assert.ok(c.rearDoor.right<m.columnX[1]-m.columnD/2);
 assert.ok(Math.abs(c.rearDoor.hingeX+s.leafThicknessM/2-c.rearDoor.left)<1e-9,'open leaf stays outside the declared clear opening');
 assert.throws(()=>compileRearDoor(m,.45,m.columnH-.02,{...s,widthM:4}),/不能跨柱/);
 assert.throws(()=>compileRearDoor(m,.45,m.columnH-.02,{...s,heightM:4}),/超过后墙/);
 assert.throws(()=>compileRearDoor(m,.45,m.columnH-.02,{...s,sillM:-.1}),/门槛/);
});

test('front and rear stair surfaces exactly span the platform-to-yard transition',()=>{
 const c=compileConstruction(house.construction),steps=c.walkSurfaces.filter(s=>s.tag.includes('step'));
 assert.equal(steps.length,6);assert.equal(c.walkSurfaces.length,7);
 for(const side of ['front','back']) {
  const s=steps.filter(s=>s.tag.startsWith(side));
  assert.deepEqual(s.map(p=>+p.y.toFixed(3)),[.45,.3,.15]);
  const near=s[0],far=s.at(-1),sign=side==='front'?1:-1;
  assert.ok(Math.abs(Math.abs(near.cz)-near.hz-4.26)<1e-9);
  assert.ok(Math.abs(far.cz)>Math.abs(near.cz));
  for(let i=1;i<s.length;i++)assert.ok(Math.abs(Math.abs(s[i].cz-s[i-1].cz)-s[i].hz-s[i-1].hz)<1e-9);
  assert.equal(Math.sign(near.cz),sign);
 }
 assert.ok(Math.abs(c.walkSurfaces.at(-1).y-.51)<1e-9);
 assert.throws(()=>compileExteriorSteps(.45,5.7,4.26,'back',{widthM:2,treadM:.3,maxRiserM:.15},5),/越出台基/);
});

test('Yihong passage declares three aligned openings without claiming its compound mesh exists',()=>{
 const b=plan.regions.find(r=>r.id==='yihongyuan').buildings.find(b=>b.id==='yihongyuan.main-house'),c=compileConstruction(b.construction);
 assert.deepEqual(c.passage.ports.map(p=>p.id),['entry','shared-wall','exit']);
 assert.ok(Math.abs(c.passage.ports[0].at[1]-5.6)<1e-9);assert.equal(c.passage.ports[1].at[1],3.36);assert.equal(c.passage.ports[2].at[1],-3.36);
 assert.equal(c.meshFactoryAvailable,false);
 const p=structuredClone(b.construction);p.spec.passage.axisXM=1.6;
 assert.throws(()=>compileConstruction(p),/碰柱或穿梁/);
 const a=auditNarrative(plan);assert.deepEqual(a.fails,[]);assert.ok(a.access.every(a=>a.contractSatisfied&&a.routeAligned));
 const misaligned=structuredClone(plan),e=misaligned.narrativeRoutes[0].legs[6];
 e.points=e.points.map(([x,z])=>[x===-108.3?-105:x,z]);
 e.points=e.points.filter((p,i,a)=>!i||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
 assert.ok(auditNarrative(misaligned).fails.some(s=>s.includes('未经过声明的净口')));
});
