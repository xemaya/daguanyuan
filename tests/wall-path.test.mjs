import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {compileWallPath,wallMiterX,wallLocalPoint} from '@builder/plan/wall-path.ts';
import {CollisionWorld} from '@engine/player/Collision.ts';
import {auditPlan} from '../tools/plan-audit.mjs';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const spec=plan.regions.find(r=>r.id==='xiaoxiangguan').linears[0];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('wall path covers all authored lengths and preserves the registered moon gate',()=>{
 const c=compileWallPath(spec);
 near(c.length,190);near(c.panels.reduce((s,p)=>s+p.length,0),190);
 const gate=c.panels.find(p=>p.variant==='moon');
 assert.equal(gate.length,6);
 assert.deepEqual([gate.center[0]+c.origin[0],gate.center[1]+c.origin[1]],[-105,120]);
 assert.ok(c.panels.filter(p=>p.length===6&&p.startMiter===0&&p.endMiter===0&&p.variant==='plain').length>=8);
 assert.deepEqual(auditPlan(plan).fails,[]);
});

test('convex and concave corners share the same miter plane for both wall faces',()=>{
 const c=compileWallPath(spec);
 for(let i=0;i<c.panels.length;i++) {
  const a=c.panels[i],b=c.panels[(i+1)%c.panels.length];
  for(const z of [-.305,0,.305]) {
   const p=wallLocalPoint(a,wallMiterX(a.length/2,z,a.length,a.startMiter,a.endMiter),z);
   const q=wallLocalPoint(b,wallMiterX(-b.length/2,z,b.length,b.startMiter,b.endMiter),z);
   near(p[0],q[0]);near(p[1],q[1]);
  }
 }
});

test('moon opening passes the player centrally but blocks stone edges and excessive height',()=>{
 const c=compileWallPath(spec),col=new CollisionWorld();
 for(const b of c.blockers)col.addBox(b.cx+c.origin[0],b.cz+c.origin[1],b.hx,b.hz,b.minY+1,b.maxY+1,b.rot);
 for(const p of c.platforms)col.addPlatform(p.cx+c.origin[0],p.cz+c.origin[1],p.hx,p.hz,p.y+1,p.rot);
 const center=col.resolve(-105,120,1.37,2.87,.32,new THREE.Vector2());
 near(center.x,-105);near(center.y,120);
 const edge=col.resolve(-104.1,120,1.37,2.87,.32,new THREE.Vector2());
 assert.ok(edge.distanceTo(new THREE.Vector2(-104.1,120))>.05);
 const tall=col.resolve(-105,120,1.37,3.5,.32,new THREE.Vector2());
 assert.ok(tall.distanceTo(new THREE.Vector2(-105,120))>.05);
 near(col.groundHeight(-105,120),1.25);
});

test('invalid path layouts fail before allocating geometry',()=>{
 assert.throws(()=>compileWallPath({...spec,inserts:[{at:[-118,120],variant:'moon'}]}),/转角/);
 assert.throws(()=>compileWallPath({...spec,inserts:[{at:[-105,120],variant:'moon'},{at:[-103,120],variant:'moon'}]}),/重叠/);
 assert.throws(()=>compileWallPath({...spec,points:[[0,0],[10,10],[0,10],[10,0]],inserts:[]}),/自交/);
 assert.throws(()=>compileWallPath({...spec,points:[[0,0],[10,0],[1,1]],inserts:[]}),/120/);
 const p=structuredClone(plan);p.regions.find(r=>r.id==='xiaoxiangguan').linears[0].inserts[0].at=[-104,120];
 assert.ok(auditPlan(p).fails.some(e=>e.includes('绑定对象坐标')));
});
