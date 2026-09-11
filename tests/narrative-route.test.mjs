import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileNarrativeRoute,sampleNarrativeRoute} from '@builder/plan/narrative-route.ts';
import {auditNarrative} from '../tools/narrative-audit.mjs';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const source=plan.narrativeRoutes[0],copy=()=>structuredClone(source);

test('29 evidence events compile to 28 contiguous legs and an actual planning mileage',()=>{
 const audit=auditNarrative(plan);assert.deepEqual(audit.fails,[]);
 const r=compileNarrativeRoute(source);
 assert.equal(source.nodes.length,29);assert.equal(r.legs.length,28);
 assert.deepEqual(r.kindCounts,{station:9,waypoint:13,scene:7});
 let independent=0;
 for(const e of source.legs)for(let i=1;i<e.points.length;i++)independent+=Math.hypot(e.points[i][0]-e.points[i-1][0],e.points[i][1]-e.points[i-1][1]);
 assert.ok(Math.abs(independent-r.length)<1e-9);
 assert.ok(r.milestone.ratio>=.5&&r.milestone.ratio<=.62);
 assert.equal(r.milestone.node,'ch17.n23');assert.equal(r.runtimeVerified,false);
 const sampled=sampleNarrativeRoute(r,1);
 assert.deepEqual(sampled[0].at,source.nodes[0].at);assert.deepEqual(sampled.at(-1).at,source.nodes.at(-1).at);
 for(let i=1;i<sampled.length;i++) {
  assert.ok(sampled[i].distance>sampled[i-1].distance);
  assert.ok(sampled[i].distance-sampled[i-1].distance<=1+1e-9);
 }
 assert.equal(audit.access.find(a=>a.object==='xiaoxiangguan.main-house').contractSatisfied,false,'rear wall remains a reported P2 access requirement');
 assert.ok(source.nodes[4].at[1]<source.nodes[3].at[1],'leaving the cave proceeds north to Qinfang');
 assert.equal(audit.routes[0].waterCrossings.filter(s=>['ch17.e16','ch17.e17'].includes(s.leg)).length,0,'west-bank observation and ascent avoid extra creek crossings');
});

test('a gap, zero segment, reordered node or swapped source event cannot masquerade as a tour',()=>{
 let p=copy();p.legs[4].points[0]=[1,1];assert.throws(()=>compileNarrativeRoute(p),/接到前后节点/);
 p=copy();p.legs[8].points.splice(1,0,p.legs[8].points[0]);assert.throws(()=>compileNarrativeRoute(p),/零长段/);
 p=copy();[p.nodes[10],p.nodes[11]]=[p.nodes[11],p.nodes[10]];assert.throws(()=>compileNarrativeRoute(p),/次序/);
 const changed=structuredClone(plan);changed.narrativeRoutes[0].nodes[10].source.event=source.nodes[11].source.event;
 assert.ok(auditNarrative(changed).fails.some(s=>s.includes('原文事件')));
 p=copy();p.transport='boat';assert.throws(()=>compileNarrativeRoute(p),/步行/);
});

test('milestone uses the named 23rd event rather than a nearest entrance or a region centroid',()=>{
 const altered=copy();altered.milestone.node='ch17.n05';assert.throws(()=>compileNarrativeRoute(altered),/占比/);
 const shifted=structuredClone(plan);shifted.regions.find(r=>r.id==='shengqin_biesu').entrances=[[0,0]];
 assert.equal(auditNarrative(shifted).routes[0].compiled.milestone.ratio,compileNarrativeRoute(source).milestone.ratio);
});

test('unentered scenery is viewed along the return leg, without entering the five footprints',()=>{
 const a=auditNarrative(plan);assert.equal(a.distant.length,5);
 assert.ok(a.distant.every(s=>!s.geometryReady&&!s.visibilityVerified));
 const p=copy();p.observations[0].at=[0,0];assert.throws(()=>compileNarrativeRoute(p),/不在声明的实际路段/);
 const changed=structuredClone(plan),s=changed.distantScenes[0],o=changed.narrativeRoutes[0].observations[0];
 const [x,z]=o.at;s.polygon=[[x-2,z-2],[x+2,z-2],[x+2,z+2],[x-2,z+2],[x-2,z-2]];
 assert.ok(auditNarrative(changed).fails.some(s=>s.includes('落在景内')));
});

test('the flower-to-cave leg cannot take the old shortcut through Hengwu before event21',()=>{
 const p=structuredClone(plan);p.narrativeRoutes[0].legs[15].points.splice(3,0,[-116,-155]);
 assert.ok(auditNarrative(p).fails.some(s=>s.includes('先穿入蘅芜苑')));
 const p2=structuredClone(plan);p2.narrativeRoutes[0].nodes[7].refs[0].id='hill.missing';
 assert.ok(auditNarrative(p2).fails.some(s=>s.includes('引用hill:hill.missing')));
 const shortcut=structuredClone(plan);const last=shortcut.narrativeRoutes[0].legs.at(-1);
 last.points=[last.points[0],last.points.at(-1)];
 assert.ok(auditNarrative(shortcut).fails.some(s=>s.includes('绕翠嶂东界')));
});
