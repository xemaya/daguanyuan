import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {auditConnections} from '../tools/connection-audit.mjs';
import {makeTerrainField} from '@builder/compose/terrain-from-plan.ts';
import {allPlanLinears} from '@builder/plan/linears.ts';
import {compileBridgePath} from '@builder/plan/bridge-path.ts';
import {CollisionWorld} from '@engine/player/Collision.ts';
import * as THREE from 'three';
import {deckGeometry} from '@builder/parts/shuigong/path-deck.ts';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));

test('four public bridge contracts cover their named route crossings without enlarging a region',()=>{
 const a=auditConnections(plan);assert.deepEqual(a.fails,[]);assert.equal(a.connections.length,4);
 assert.equal(allPlanLinears(plan).filter(l=>l.kind==='bridge').length,5);
 for(const b of a.connections) {
  assert.ok(b.compiled.clearWidth>=1.2);assert.ok(b.checks.some(c=>c.waterPoints.length>0));
  assert.equal(b.runtimeVerified,false);
 }
 const shortened=structuredClone(plan);shortened.connections[0].points=[[-196,-28],[-196,-35]];
 assert.ok(auditConnections(shortened).fails.some(e=>e.includes('未覆盖')));
 const dup=structuredClone(plan);dup.connections[0].id=dup.regions.find(r=>r.id==='cuizhang').linears[0].id;
 assert.ok(auditConnections(dup).fails.some(e=>e.includes('重复')));
});

test('graded dry abutments meet each slab while every creek still has its specified deep bed',()=>{
 const field=makeTerrainField(plan,{seed:17910000}),a=auditConnections(plan),world=new CollisionWorld();world.terrainHeight=field.height;
 for(const b of a.connections) {
  world.addPolygonPlatform(b.polygon,b.spec.elevation_m);
  for(const p of [b.spec.points[0],b.spec.points.at(-1)]) {
   const h=field.height(...p),step=b.spec.elevation_m-h;
   assert.ok(h>0,b.spec.id);assert.ok(step>=-.02&&step<=b.spec.deckThickness_m+.03,b.spec.id+': landing');
  }
  const wet=b.checks.flatMap(c=>c.waterPoints);
  const deepest=Math.min(...wet.map(p=>field.height(...p.point)));
  const depth=Math.min(...wet.map(p=>p.depth));
  assert.ok(deepest<=-.9*depth,b.spec.id+': water retained');
  for(const p of wet)assert.equal(world.groundHeight(...p.point),b.spec.elevation_m,b.spec.id+': real polygon deck');
 }
});

test('material and public-connection boundaries are explicit, never a generic red-wood fallback',()=>{
 const red=plan.connections.find(b=>b.railingMaterial==='vermilion');
 assert.equal(red.object,'liaoting_huaxu.red-railing-bridge');assert.equal(red.deckMaterial,'wood');
 const p=structuredClone(plan);p.connections[0].railingMaterial='vermilion';
 assert.ok(auditConnections(p).fails.some(e=>e.includes('朱栏例外')));
 assert.throws(()=>compileBridgePath({...red,deckMaterial:'glass'}),/未知桥面材料/);
 assert.throws(()=>compileBridgePath({...red,width_m:.4}),/净宽/);
 const p2=structuredClone(plan);p2.connections[0].points=[[-260,0],[-250,0]];
 assert.ok(auditConnections(p2).fails.some(e=>e.includes('园墙')));
});

test('beveled deck endpoints have a real top within 0.1mm of the nominal Float32 boundary',()=>{
 for(const spec of plan.connections) {
  const path=compileBridgePath(spec),points=path.stations.map(s=>s.point),geo=deckGeometry(points,spec.width_m/2,spec.deckThickness_m);
  const mat=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geo,mat);mesh.position.y=-spec.deckThickness_m;mesh.updateMatrixWorld();
  for(const [i,j] of [[0,1],[points.length-1,points.length-2]])for(const inset of [.0001,.02]) {
   const a=points[i],b=points[j],l=Math.hypot(b[0]-a[0],b[1]-a[1]);
   const ray=new THREE.Raycaster(new THREE.Vector3(a[0]+(b[0]-a[0])*inset/l,.4,a[1]+(b[1]-a[1])*inset/l),new THREE.Vector3(0,-1,0),0,1);
   const hit=ray.intersectObject(mesh)[0];assert.ok(hit&&Math.abs(hit.point.y)<.025,spec.id);
  }
  geo.dispose();mat.dispose();
 }
});
