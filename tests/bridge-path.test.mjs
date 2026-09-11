import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileBridgePath} from '@builder/plan/bridge-path.ts';
import {makeTerrainField} from '@builder/compose/terrain-from-plan.ts';
import {CollisionWorld} from '@engine/player/Collision.ts';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const bridge=plan.regions.find(r=>r.id==='cuizhang').linears.find(l=>l.kind==='bridge');

test('Cui Zhang crossing uses a real bridge surface while retaining the creek bed',()=>{
 const field=makeTerrainField(plan,{seed:17910000}),c=compileBridgePath(bridge),world=new CollisionWorld();
 world.terrainHeight=field.height;
 world.addPolygonPlatform(c.polygon.map(p=>[p[0]+c.origin[0],p[1]+c.origin[1]]),bridge.elevation_m);
 assert.equal(c.length,10);
 assert.equal(field.height(-37,202),-1);
 assert.equal(world.groundHeight(-37,202),2.6);
 assert.equal(world.blockedAt(-37,202),false);
 assert.equal(field.height(-40,196),2.6);
 for(const p of bridge.points) {
  assert.ok(field.height(...p)>0);
  assert.ok(Math.abs(bridge.elevation_m-field.height(...p))<=bridge.deckThickness_m+.01);
 }
});

test('bridge footings must be sampled from the current field, which changes with channel depth',()=>{
 const a=makeTerrainField(plan,{seed:17910000}),changed=structuredClone(plan);
 changed.water.find(w=>w.name.startsWith('沁芳溪·南段')).depth_m=1.5;
 const b=makeTerrainField(changed,{seed:17910000});
 assert.equal(a.height(-37,202),-1);assert.equal(b.height(-37,202),-1.5);
 assert.throws(()=>compileBridgePath({...bridge,width_m:0}),/有限正数/);
});
