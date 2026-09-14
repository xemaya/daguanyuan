import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
/** 单子 Y：「哪些区已经建出来了」的真源是 scenes 目录的内容——有落位清单 = 建成。
 *  运行时由 projects/daguanyuan/scenes.ts 的 eager glob 装载；这里按同一条规则读盘。 */
const MVP_REGIONS=readdirSync('projects/daguanyuan/scenes').filter(f=>f.endsWith('.json')).sort()
 .map(f=>JSON.parse(readFileSync('projects/daguanyuan/scenes/'+f,'utf8')).region);

test('建成区名单是唯一真源，且都是 plan 里真实存在的区',()=>{
 assert.ok(MVP_REGIONS.length>0);
 for(const id of MVP_REGIONS)assert.ok(plan.regions.some(r=>r.id===id),`plan 里没有区 ${id}`);
});

test('建成区的 plan 对象全集——对账门的分母',()=>{
 const objs=[];
 for(const id of MVP_REGIONS){
  const r=plan.regions.find(x=>x.id===id);
  for(const b of r.buildings??[])objs.push(b.id);
  for(const b of r.rocks??[])objs.push(b.id);
  for(const l of r.linears??[])objs.push(l.id);
 }
 assert.equal(new Set(objs).size,objs.length,'plan 对象 id 在建成区内重复');
 // 数会随着 scenes/ 里新增清单而变；这里只焊住「分母必须从 scenes 目录导出，
 // 且每个区都能在 plan 里找到对象」。具体覆盖率由 manifest-diff --coverage 报。
 assert.ok(objs.length>=23,`分母只应随新增区上升，现在是 ${objs.length}`);
});

import {coverage} from '../tools/manifest-diff.mjs';

/** 一份最小的假 manifest：只登记了正门本身，台矶与粉墙都没造。 */
const fakeManifest={
 builtRegions:['zhengmen'],
 constructions:[
  {id:'zhengmen.main-gate',part:'garden-building',variant:'zhengmen.main-gate',planId:'zhengmen.main-gate',position:[55,0,236],yaw:0},
  {id:'wall:plain',part:'wall',variant:'plain',planId:null,position:[65,0,236],yaw:0},
 ],
};

test('对账门把 zhengmen.forecourt-terrace 当成缺项报出来',()=>{
 const c=coverage(plan,fakeManifest);
 assert.deepEqual(c.builtRegions,['zhengmen']);
 assert.equal(c.built.total,4);              // main-gate + forecourt-terrace + flanking-wall + rock-01
 assert.equal(c.built.covered,1);
 assert.ok(c.built.missing.includes('zhengmen.forecourt-terrace'),'台矶必须被报为缺项');
 assert.ok(c.built.missing.includes('zhengmen.flanking-wall'));
});

test('planId=null 的构件进野生件表，不算缺项也不算覆盖',()=>{
 const c=coverage(plan,fakeManifest);
 assert.equal(c.feral.length,1);
 assert.equal(c.feral[0].variant,'plain');
});

test('未建区的对象是 known-gap，不进缺项',()=>{
 const c=coverage(plan,fakeManifest);
 assert.ok(c.knownGaps>0);
 assert.ok(!c.built.missing.some(id=>id.startsWith('daoxiangcun.')));
});

test('身份传递：建成的线性构件把它的 insert 与 model-reference 条目一起认领',()=>{
 const m={builtRegions:['xiaoxiangguan'],constructions:[
  {id:'xiaoxiangguan.courtyard-wall',part:'garden-wall',variant:'xiaoxiangguan.courtyard-wall',planId:'xiaoxiangguan.courtyard-wall',position:[0,0,0],yaw:0},
  {id:'xiaoxiangguan.west-corridor-path',part:'garden-corridor',variant:'xiaoxiangguan.west-corridor-path',planId:'xiaoxiangguan.west-corridor-path',position:[0,0,0],yaw:0},
 ]};
 const c=coverage(plan,m);
 assert.ok(!c.built.missing.includes('xiaoxiangguan.moon-gate'),'月洞门是已建院墙上的开口，不是缺项');
 assert.ok(!c.built.missing.includes('xiaoxiangguan.corridor'),'游廊的实体就是已建的 west-corridor-path');
});

test('身份传递不许过度吸收：线性构件没建时，它的 insert 与引用条目照样是缺项',()=>{
 const c=coverage(plan,{builtRegions:['xiaoxiangguan'],constructions:[]});
 assert.ok(c.built.missing.includes('xiaoxiangguan.moon-gate'));
 assert.ok(c.built.missing.includes('xiaoxiangguan.corridor'));
 assert.ok(c.built.missing.includes('xiaoxiangguan.courtyard-wall'));
});

import {auditRosterSeams} from '../tools/manifest-diff.mjs';

/** 正门六段粉墙的真实落位(composer 的 D_ZHENGMEN 平移结果)，宽度按 6m 算：
 *  65/71 首尾相接(缝 0)，71/78 之间空 1m。 */
const wallRoster=[
 {id:'wall:plain',part:'wall',variant:'plain',planId:null,position:[65,0.8,236],yaw:0,size:[6,2.7,0.4]},
 {id:'wall:lattice',part:'wall',variant:'lattice',planId:null,position:[71,0.8,236],yaw:0,size:[6,2.7,0.4]},
 {id:'wall:cloud',part:'wall',variant:'cloud',planId:null,position:[78,0.8,236],yaw:0,size:[6,2.7,0.4]},
];

test('名册侧接缝门：同一道墙上相邻两段之间的缝要报出来',()=>{
 const a=auditRosterSeams(wallRoster);
 assert.equal(a.seams.length,2,'三段墙应排成两对相邻');
 assert.ok(a.fails.some(f=>f.includes('1.00m 的缝')),`1 米的缝没报出来：${JSON.stringify(a.fails)}`);
 assert.ok(!a.fails.some(f=>f.includes('plain→lattice')&&f.includes('缝')),'首尾相接的一对不该报缝');
});

test('名册侧接缝门：标高差与互相插入都要报',()=>{
 const stepped=structuredClone(wallRoster);
 stepped[1].position[1]=1.0;                 // 抬 0.2m
 stepped[2].position[0]=76;                  // 往回挪 2m，与前一段插进去 1m
 const a=auditRosterSeams(stepped);
 assert.ok(a.fails.some(f=>f.includes('标高差')),'0.2m 标高差没报');
 assert.ok(a.fails.some(f=>f.includes('互相插入')),'互插没报');
});

test('名册侧接缝门不越界：横向岔开半个身位以上的不算同一道墙',()=>{
 const apart=structuredClone(wallRoster);
 apart[2].position[2]=246;                   // 挪到另一条线上
 const a=auditRosterSeams(apart);
 assert.equal(a.seams.length,1);
});

test('planId 不许从 anchor 推：散置件相对谁摆，不等于它就是谁',()=>{
 // 竹丛相对正房落位(scenes 的 placements)，它的 planId 必须是 null——
 // 否则对账门会把正房算成「已建成」两次，六段粉墙也会冒充正门。
 const m={builtRegions:['xiaoxiangguan'],constructions:[
  {id:'bamboo:clump',part:'bamboo',variant:'clump',planId:null,position:[-114.8,1,103],yaw:0},
 ]};
 const c=coverage(plan,m);
 assert.ok(c.built.missing.includes('xiaoxiangguan.main-house'),'正房没建，不许被相对它落位的竹丛顶掉');
 assert.equal(c.feral.length,1);
});
