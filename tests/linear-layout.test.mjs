import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {compileLinearLayout} from '@builder/plan/linear-layout.ts';
import {auditLinearLayouts} from '../tools/linear-layout-audit.mjs';
import {auditP2} from '../tools/p2-audit.mjs';
const p=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const object=(plan,id)=>plan.regions.flatMap(r=>r.buildings).find(b=>b.id===id);
test('all named linear objects and three supplementary enclosures/banks have real strips or live references',()=>{
 const a=auditLinearLayouts(p);assert.deepEqual(a.fails,[]);assert.equal(a.total,32);assert.equal(a.objects.length,32);
 assert.equal(a.objects.filter(o=>o.stage==='model-reference').length,4);
 const fences=a.objects.find(o=>o.id==='daoxiangcun.fence');assert.equal(fences.runs.length,2);
 assert.ok(fences.runs.every(r=>r.footprint.length>4));
});
test('P2 acceptance distinguishes complete geometry inputs from unfinished full-garden assembly',()=>{
 const a=auditP2(p);assert.equal(a.complete,true);assert.equal(a.fullGardenComplete,false);assert.equal(a.fullGardenPending.length,6);
 const bad=structuredClone(p);delete object(bad,'qinfang_ting_qiao.three-opening-bridge').layout.threePortBridge;
 assert.equal(auditP2(bad).complete,false);
 const bridge=auditLinearLayouts(p).objects.find(o=>o.id==='qinfang_ting_qiao.three-opening-bridge');
 assert.deepEqual(bridge.bridgeSections.map(s=>s.role),['abutment','water-opening','pier','water-opening','pier','water-opening','abutment']);
 assert.equal(bridge.bridgeSections.at(-1).to,10);
});
test('the return route must enter Yihong at the moon gate instead of cutting through its walls',()=>{
 const bad=structuredClone(p),l=bad.narrativeRoutes[0].legs[24],i=l.points.findIndex(pt=>pt[0]===157);
 l.points.splice(i+1,3,[148,173],[145,185],[132,192]);
 assert.ok(auditLinearLayouts(bad).fails.some(s=>s.includes('穿过围护线')));
});
test('Huaxu follows both narrative legs, clears the boat envelope and descends on eighteen actual steps',()=>{
 const a=auditLinearLayouts(p);assert.equal(a.caveTop.verified,true);assert.ok(a.caveTop.boatOverlapSamples>400);assert.ok(a.caveTop.minRockM>.7);
 const r=a.objects.find(o=>o.id==='liaoting_huaxu.mountain-path').runs[0],s=r.stairs[0];
 assert.equal(s.count,18);assert.ok(Math.abs(s.riserM)<.16);assert.ok(s.treadM>.5);
 assert.equal(s.levels[0].y,3.25);assert.equal(s.levels.at(-1).y,.5);assert.ok(r.maxRampSlope<.124);
 const bad=structuredClone(p);object(bad,'liaoting_huaxu.mountain-path').layout.runs[0].elevationsM[8]=2;
 assert.ok(auditLinearLayouts(bad).fails.some(s=>s.includes('未留足岩体')));
});
test('point placeholders, detached openings and dangling model references fail the layout gate',()=>{
 let bad=structuredClone(p);delete object(bad,'daoxiangcun.fence').layout;
 assert.ok(auditLinearLayouts(bad).fails.some(s=>s.includes('仍仅有点坐标')));
 bad=structuredClone(p);object(bad,'yihongyuan.moon-gate').x+=.5;
 assert.ok(auditLinearLayouts(bad).fails.some(s=>s.includes('开口引用')));
 bad=structuredClone(p);object(bad,'xiaoxiangguan.corridor').layout.linearIds=['missing'];
 assert.ok(auditLinearLayouts(bad).fails.some(s=>s.includes('引用不存在')));
});
test('width, contour, elevation count, stair tread and corner openings are structural constraints',()=>{
 const base=object(p,'daoxiangcun.fence').layout;
 let b=structuredClone(base);b.runs[0].widthM=-1;assert.throws(()=>compileLinearLayout(b),/截面/);
 b=structuredClone(base);b.runs[0].elevationsM.pop();assert.throws(()=>compileLinearLayout(b),/标高/);
 b=structuredClone(base);b.openings=[{run:0,at:[-207,-26],widthM:1,heightM:1}];assert.throws(()=>compileLinearLayout(b),/唯一/);
 b=structuredClone(object(p,'liaoting_huaxu.mountain-path').layout);b.runs[0].stairs[0].minTreadM=2;assert.throws(()=>compileLinearLayout(b),/踏面/);
});
