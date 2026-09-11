import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {compileDistantScene,deriveRoundDistant} from '@builder/plan/distant-scene.ts';
import {auditNarrative} from '../tools/narrative-audit.mjs';
import {makeTerrainField} from '@builder/compose/terrain-from-plan.ts';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));

test('five unentered scenes resolve sixteen real content recipes while retaining the planned return views',()=>{
 const all=plan.distantScenes.map(s=>compileDistantScene(s,plan));
 assert.equal(all.length,5);assert.equal(all.reduce((n,s)=>n+s.items.length,0),16);
 assert.ok(all.every(s=>s.detail==='distant'&&!s.nearDetailReady));
 assert.deepEqual(auditNarrative(plan).fails,[]);
 const temple=all.find(s=>s.id==='return.temple');
 assert.deepEqual(temple.items.filter(i=>i.kind==='house-ref').map(i=>i.source.object),['longcuian.mountain-gate','longcuian.main-hall','longcuian.east-hall']);
 assert.equal(temple.items.find(i=>i.kind==='wall-ref').source.spec.id,'longcuian.courtyard-wall');
 assert.equal(all.find(s=>s.id==='return.daofang').items.filter(i=>i.groundMode==='terrain').length,4);
});

test('round pavilion has an actual eight-column ring and a roof covering its circumradius',()=>{
 const s=plan.distantScenes.find(s=>s.id==='return.square-round').contents.find(c=>c.kind==='round').spec;
 const f=deriveRoundDistant(s);
 assert.equal(f.columns.length,8);
 const expected=1.5*(1+Math.SQRT2)/2/Math.cos(Math.PI/8);
 for(const p of f.columns)assert.ok(Math.abs(Math.hypot(...p)-expected)<1e-10);
 assert.ok(f.roofRadius>expected+f.m.columnD/2);assert.equal(f.m.columnH,2.8);
 assert.ok(f.provenance.art.some(p=>p.id==='project:round-distant'));
 assert.throws(()=>deriveRoundDistant({...s,shape:'square'}),/圆形亭/);
});

test('missing source models and oversized scenery cannot become generic fallbacks',()=>{
 let s=structuredClone(plan.distantScenes.find(s=>s.id==='return.temple'));s.contents[0].object='missing';
 assert.throws(()=>compileDistantScene(s,plan),/引用缺失/);
 s=structuredClone(plan.distantScenes.find(s=>s.id==='return.temple'));s.contents[0].object='shengqin_biesu.daguan-tower';
 assert.throws(()=>compileDistantScene(s,plan),/必须已有模型/);
 s=structuredClone(plan.distantScenes.find(s=>s.id==='return.daofang'));s.contents[1].radiusM=30;
 assert.throws(()=>compileDistantScene(s,plan),/超出预留范围/);
 s=structuredClone(plan.distantScenes[0]);s.contents[1].facade.doorHeightM=9;
 assert.throws(()=>compileDistantScene(s,plan),/柱间净空/);
});

test('legacy MVP grading no longer raises the distant temple floor, while MVP samples stay identical',()=>{
 const unscoped=structuredClone(plan);delete unscoped.paths[0].compatibilityScope;
 const old=makeTerrainField(unscoped,{seed:17910000}),current=makeTerrainField(plan,{seed:17910000});
 assert.ok(old.height(205.3,145.74)>3);assert.equal(current.height(205.3,145.74),2.2);
 for(let x=-158;x<=108;x+=7)for(let z=45;z<=259;z+=7) {
  assert.equal(current.height(x,z),old.height(x,z));assert.deepEqual(current.masks(x,z),old.masks(x,z));
 }
 assert.equal(auditNarrative(plan).routes[0].source.nodes.length,29,'the canonical route is still fully checked');
});
