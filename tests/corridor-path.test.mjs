import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {compileCorridor} from '@builder/plan/corridor-path.ts';
import {containsRing,locatePoint} from '@builder/plan/geometry.ts';
import {CollisionWorld} from '@engine/player/Collision.ts';
import {makeTerrainField} from '@builder/compose/terrain-from-plan.ts';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const spec=plan.regions.find(r=>r.id==='xiaoxiangguan').linears.find(l=>l.kind==='corridor');

test('curved corridor derives actual bays and shares columns at all three turns',()=>{
 const c=compileCorridor(spec);
 assert.equal(c.length,54);assert.equal(c.frames.length,4);assert.equal(c.columns.length,42);
 assert.equal(new Set(c.columns.map(p=>p.point.map(n=>n.toFixed(6)).join(','))).size,42);
 assert.ok(containsRing(c.roofPolygon,c.deckPolygon));
 for(const f of c.frames){assert.equal(f.m.columnH,2.75);assert.equal(f.m.puzuoH,0);assert.deepEqual(f.roofSection,c.frames[0].roofSection);assert.ok(f.provenance.art.length>0);}
 assert.deepEqual(c.frames.map(f=>f.m.width),[10,10,24,10]);
});

test('the whole corridor centreline stays on the polygon floor and clear of columns',()=>{
 const c=compileCorridor(spec),world=new CollisionWorld();world.terrainHeight=()=>-1;
 world.addPolygonPlatform(c.deckPolygon,1.25,'corridor');
 for(const p of c.columns)world.addCircle(...p.point,p.diameter/2,1.25,4,'column');
 for(let i=1;i<c.stations.length;i++) {
  const a=c.stations[i-1].point,b=c.stations[i].point,n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.1);
  for(let j=0;j<=n;j++) {
   const x=a[0]+(b[0]-a[0])*j/n,z=a[1]+(b[1]-a[1])*j/n;
   assert.equal(world.groundHeight(x,z),1.25);
   assert.equal(world.blockedAt(x,z),false);
   assert.ok(world.resolve(x,z,1.37,2.87,.32,new THREE.Vector2()).distanceTo(new THREE.Vector2(x,z))<1e-7);
  }
 }
 const outside=[0,0]; // Inside the enclosing box, outside the actual zigzag floor.
 assert.equal(locatePoint(c.deckPolygon,outside),'outside');
 assert.equal(world.groundHeight(...outside),-1);assert.equal(world.blockedAt(...outside),true);
});

test('polygon platforms include edges but never fill the empty part of a concave box',()=>{
 const c=new CollisionWorld();c.terrainHeight=()=>-2;
 c.addPolygonPlatform([[0,0],[4,0],[4,1],[1,1],[1,4],[0,4],[0,0]],1);
 assert.equal(c.groundHeight(.5,3),1);assert.equal(c.groundHeight(1,3),1);
 assert.equal(c.groundHeight(3,3),-2);assert.equal(c.blockedAt(3,3),true);
 c.addPlatform(10,10,2,1,2,Math.PI/2);
 assert.equal(c.groundHeight(10,11.5),2);assert.equal(c.groundHeight(11.5,10),-2);
 assert.throws(()=>c.addPolygonPlatform([[0,0],[0,0],[1,1]],0),/zero edge/);
});

test('corridor ends meet dry ground within one step and the crossed creek stays underwater',()=>{
 const field=makeTerrainField(plan,{seed:17910000}),c=compileCorridor(spec),floor=spec.elevation_m+spec.platformH_m;
 for(const point of [spec.points[0],spec.points.at(-1)]) {
  const h=field.height(...point);
  assert.ok(h>.06,'廊端必须接陆地');
  assert.ok(Math.abs(floor-h)<=spec.platformH_m+.08,'廊端不可变成悬空高坎');
 }
 const water=plan.water.find(w=>w.name.startsWith('潇湘馆穿院'));
 const covered=water.centerline.filter(([x,z])=>locatePoint(c.deckPolygon,[x-c.origin[0],z-c.origin[1]])!=='outside');
 assert.ok(covered.length>0,'确实跨过沟，不以移走水域规避验证');
 for(const p of covered)assert.ok(field.height(...p)<0,`沟 ${p} 被道路填平`);
});

test('tight folded roofs and conflicting bay sources are rejected',()=>{
 assert.throws(()=>compileCorridor({...spec,points:[[0,0],[4,0],[4,1],[0,1]]}),/相交|翻折/);
 assert.throws(()=>compileCorridor({...spec,section:{...spec.section,bayWidthsM:[3.2]}}),/不得另给/);
 assert.throws(()=>compileCorridor({...spec,section:{...spec.section,tier:'A'}}),/不替代清式/);
});
