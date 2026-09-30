import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {buildOccupancy} from '@builder/compose/occupancy.ts';
import {polygonNearIndex} from '@engine/scatter/cluster.ts';

/*
 * 单子 AX2:植被散布里给占位查询加了格子预筛(vegetation.ts 的 outsideBuildings)。
 * 它只是缓存:预筛说「附近没有占位」的点,occupancyFree 必须逐位等于 1。
 * 用全园 19 区(plan 里每个区都当建成)去量——房子最多、最容易漏的情形。
 */
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const dir='projects/daguanyuan/scenes';
const scenes=readdirSync(dir).filter(f=>f.endsWith('.json')).sort().map(f=>JSON.parse(readFileSync(dir+'/'+f,'utf8')));
// vegetation.ts 里 outsideBuildings 用到的最大 pad。free() 随 pad 单调不增,最大 pad 下是 1,更小的 pad 也是 1。
const PAD_MAX=1.4;
const MARGIN=0.35+PAD_MAX+0.01;

test('占位预筛:判为「附近没有」的点,free() 在最大 pad 下都逐位是 1',()=>{
 const field=buildOccupancy(plan,plan.regions.map(r=>r.id),scenes);
 const polys=field.occupants().filter(o=>o.kind!=='wall').map(o=>o.polygon);
 assert.ok(polys.length>40,`全园占位多边形只有 ${polys.length} 块,量不出东西`);
 const near=polygonNearIndex(polys,MARGIN);
 let skipped=0,kept=0;
 const xs=polys.flat().map(p=>p[0]),zs=polys.flat().map(p=>p[1]);
 for(let z=Math.min(...zs)-10;z<=Math.max(...zs)+10;z+=1.37)for(let x=Math.min(...xs)-10;x<=Math.max(...xs)+10;x+=1.13){
  if(near(x,z)){kept++;continue;}
  skipped++;
  assert.ok(Object.is(field.free(x,z,PAD_MAX),1),`(${x.toFixed(2)},${z.toFixed(2)}) 被预筛跳过,但 free()=${field.free(x,z,PAD_MAX)}`);
 }
 // 预筛真的在省事:绝大多数点都跳过了。
 assert.ok(kept>300&&skipped>kept,`跳过 ${skipped} / 保留 ${kept}`);
});

test('占位预筛:紧贴多边形外沿 0.35 + pad 以内的点一定放行',()=>{
 const field=buildOccupancy(plan,plan.regions.map(r=>r.id),scenes);
 const polys=field.occupants().filter(o=>o.kind!=='wall').map(o=>o.polygon);
 const near=polygonNearIndex(polys,MARGIN);
 for(const poly of polys)for(const [x,z] of poly){
  for(const [dx,dz] of [[1.75,0],[-1.75,0],[0,1.75],[0,-1.75]])assert.ok(near(x+dx,z+dz));
 }
});
