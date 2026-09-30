import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeTerrainField} from '@builder/compose/terrain-from-plan.ts';
import {bakeSplatMainData,bakeSplatExtData,bakeSplatData} from '@builder/compose/splat.ts';
import {terrainWindow} from '@builder/plan/window.ts';

/* 单子 AX2:主 + 扩展 splat 一遍烘完,字节流必须与分开烘逐位相同——4 区与全园 19 区两个窗口都量。 */
test('splat 一遍烘完与分开烘逐位相同',()=>{
  const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
  for(const ids of [['zhengmen','cuizhang','qinfang_ting_qiao','xiaoxiangguan'],plan.regions.map(r=>r.id)]){
    const win=terrainWindow(plan,ids,15,0.48);
    const field=makeTerrainField(plan,{seed:17910000,bounds:win});
    const size=192;
    const one=bakeSplatData(field,win,size);
    assert.deepEqual(one.main,bakeSplatMainData(field,win,size));
    assert.deepEqual(one.ext,bakeSplatExtData(field,win,size));
    assert.ok(one.main.some(v=>v>0)&&one.ext.some(v=>v>0));
  }
});
