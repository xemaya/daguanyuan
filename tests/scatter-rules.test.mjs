import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCATTER_RULES,ruleMatches,rulesForRegion,ruleCoverage,validateRules} from '@builder/compose/scatter-rules.ts';

const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));

test('规则表自己合契约：每条都有 id / part / basis，区间合法',()=>{
 assert.deepEqual(validateRules(),[]);
});

test('目标2的判据：能当场列出每条规则落到哪几个区',()=>{
 const table=ruleCoverage(plan.regions);
 assert.equal(table.length,SCATTER_RULES.length);
 for(const {rule,regions} of table){
  assert.ok(regions.length>0,`规则 ${rule.id} 一个区都不落,那它等于不存在`);
  assert.ok(regions.length<plan.regions.length,`规则 ${rule.id} 落到全部 19 个区,门槛等于没设`);
 }
});

test('style 五维真的被消费：稻香村不挂灯，潇湘馆挂',()=>{
 const lantern=SCATTER_RULES.find(r=>r.id==='灯笼-檐下');
 const daoxiang=plan.regions.find(r=>r.id==='daoxiangcun');     // ornament 0.05
 const xiaoxiang=plan.regions.find(r=>r.id==='xiaoxiangguan');
 assert.equal(ruleMatches(lantern,daoxiang),false,'17 回「纸窗木榻,富贵气象一洗皆尽」——田舍不该挂宫灯');
 assert.equal(ruleMatches(lantern,xiaoxiang),true);
});

test('新增一条规则,不改任何按区的表,就有区吃到',()=>{
 const fresh={id:'试验件',part:'taihu',appliesTo:{jiangnan:[0.8,1]},basis:'测试用'};
 const hit=ruleCoverage(plan.regions,[fresh])[0].regions;
 assert.ok(hit.length>0,'一条新规则必须自己挑得出区来——这就是目标 2');
 // 且它挑的确实是江南气重的那些区,不是随便挑的。
 for(const id of hit) assert.ok(plan.regions.find(r=>r.id===id).style.jiangnan>=0.8);
});

test('tier 白名单与五维区间同时生效',()=>{
 const onlyA={id:'只给A',part:'x',appliesTo:{tier:['A']},basis:'测试用'};
 for(const id of ruleCoverage(plan.regions,[onlyA])[0].regions)
  assert.equal(plan.regions.find(r=>r.id===id).tier,'A');
 assert.equal(rulesForRegion(plan.regions.find(r=>r.tier!=='A'),[onlyA]).length,0);
});
