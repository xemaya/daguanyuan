import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {terrainWindow} from '@builder/plan/window.ts';
import {splatSizeFor} from '@builder/compose/terrain.ts';

const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const PAD=15, CELL=0.48;
const four=['zhengmen','cuizhang','qinfang_ting_qiao','xiaoxiangguan'];
const all=plan.regions.map(r=>r.id);
const cmPerTexel=ids=>{const w=terrainWindow(plan,ids,PAD,CELL);return Math.max(w.width,w.depth)/splatSizeFor(w)*100;};

/** spec §3 单子 AA 的验收判据：区从 4 开到 19，splat cm/texel 与地形 CELL 不变。 */
test('地面纹理精度与区数无关',()=>{
 const a=cmPerTexel(four), b=cmPerTexel(all);
 // 改之前实测:4 区 26.4、19 区 50.2 —— 掉一半,而且是必然的。
 assert.ok(a<=26.4, `4 区 ${a.toFixed(1)} cm/texel,不许比改之前的 26.4 差`);
 assert.ok(b<=26.4, `19 区 ${b.toFixed(1)} cm/texel,不许比改之前的 4 区还差`);
 assert.ok(Math.abs(a-b)<=2.0, `4 区 ${a.toFixed(1)} vs 19 区 ${b.toFixed(1)} cm/texel,精度随区数漂了`);
});

test('地形网格精度 CELL 不随窗口变——它是精度本身,不是预算旋钮',()=>{
 for(const ids of [four,all]){
  const w=terrainWindow(plan,ids,PAD,CELL);
  assert.ok(Math.abs(w.width/w.segX-CELL)<0.01, 'x 向格距偏离 CELL');
  assert.ok(Math.abs(w.depth/w.segZ-CELL)<0.01, 'z 向格距偏离 CELL');
 }
});

test('splat 边长不取 2 的幂——取了会白白翻倍',()=>{
 // 270m 的窗口要 1080 个纹素;取 2 的幂会给到 2048,实测建时 19.4s→29.5s。
 const w=terrainWindow(plan,four,PAD,CELL);
 const size=splatSizeFor(w);
 assert.equal(size%64,0);
 assert.ok(size<2048, `${size} 说明又回到 2 的幂了`);
 assert.ok(size>=Math.max(w.width,w.depth)/0.25, '边长不够,精度不达标');
});
