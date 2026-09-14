import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MVP_REGIONS} from '@builder/compose/terrain.ts';

const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));

test('建成区名单是唯一真源，且都是 plan 里真实存在的区',()=>{
 assert.ok(MVP_REGIONS.length>0);
 for(const id of MVP_REGIONS)assert.ok(plan.regions.some(r=>r.id===id),`plan 里没有区 ${id}`);
});

test('建成四区的 plan 对象全集是 23 个——对账门的分母',()=>{
 const objs=[];
 for(const id of MVP_REGIONS){
  const r=plan.regions.find(x=>x.id===id);
  for(const b of r.buildings??[])objs.push(b.id);
  for(const b of r.rocks??[])objs.push(b.id);
  for(const l of r.linears??[])objs.push(l.id);
 }
 assert.equal(new Set(objs).size,objs.length,'plan 对象 id 在建成区内重复');
 assert.equal(objs.length,23);
});
