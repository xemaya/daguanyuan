import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateScenes} from '@builder/compose/scenes.ts';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));

test('placements 缺 basis 不许进',()=>{
 const bad=[{region:'zhengmen',placements:[{part:'wall',variant:'plain',anchor:'zhengmen.main-gate',dx:10,dz:0}]}];
 assert.ok(validateScenes(bad,plan).some(f=>f.includes('basis')));
});

test('anchor 必须是本区真实存在的 plan 对象',()=>{
 const bad=[{region:'zhengmen',placements:[{part:'wall',anchor:'xiaoxiangguan.main-house',dx:0,dz:0,basis:'x'}]}];
 assert.ok(validateScenes(bad,plan).some(f=>f.includes('锚点')));
});

test('placements 不许出现世界绝对坐标字段',()=>{
 const bad=[{region:'zhengmen',placements:[{part:'wall',anchor:'zhengmen.main-gate',x:65,z:236,dx:0,dz:0,basis:'x'}]}];
 assert.ok(validateScenes(bad,plan).some(f=>f.includes('绝对坐标')));
});

test('named 绑定的 object 必须在本区',()=>{
 const bad=[{region:'zhengmen',named:[{object:'xiaoxiangguan.main-house',part:'building',variant:'men',basis:'x'}]}];
 assert.ok(validateScenes(bad,plan).some(f=>f.includes('不在本区')));
});

test('region 必须是 plan 里真实存在的区',()=>{
 assert.ok(validateScenes([{region:'nowhere'}],plan).some(f=>f.includes('plan 里没有')));
});
