import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {buildOccupancy} from '@builder/compose/occupancy.ts';

const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const dir='projects/daguanyuan/scenes';
const scenes=readdirSync(dir).filter(f=>f.endsWith('.json')).sort()
 .map(f=>JSON.parse(readFileSync(dir+'/'+f,'utf8')));
const built=scenes.map(s=>s.region);

test('占位场从 plan 推导：每栋有施工spec的房子都占地',()=>{
 const f=buildOccupancy(plan,built,scenes);
 const ids=f.occupants().map(o=>o.id);
 for(const want of ['zhengmen.main-gate/main','qinfang_ting_qiao.pavilion/main','xiaoxiangguan.main-house/main'])
  assert.ok(ids.some(id=>id===want),`${want} 不在占位场里`);
 assert.equal(f.free(-105,98),0,'正房正中必须是被占的');
 assert.equal(f.free(55,236),0,'正门正中必须是被占的');
});

test('手抄表漏算了出檐与铺作出跳——推导场把树挡在檐外',()=>{
 const f=buildOccupancy(plan,built,scenes);
 // 手抄的正门 footprint 是 h=(7.4,3.2)，推导出来是 h=(10.0,6.1)。
 // 取一个「手抄表放行、推导场拦住」的点：门中轴外 8.5m。
 assert.equal(f.free(55+8.5,236),0,'离门心 8.5m 仍在檐下，手抄表会放树进来');
});

/** spec §3 单子 Z 的验收判据：把潇湘馆的房子挪 3m，植被要自己让开，
 *  不需要改任何表。
 *
 *  ⚠️ 这里挪的是**后房**不是正房，理由要写清楚：正房四周罩着一块
 *  「潇湘馆院内(留给点名竹)」的净空(hx 9.4 × hz 6.8)，比正房自己的檐口
 *  外包络(5.6 × 4.2)大得多，正房整个在它里面——所以院内找不到一个
 *  「只被正房占、不被净空占」的点，拿那种点做断言证明不了任何事。
 *  后房周围没有净空框，是干净的样本。正房那一侧改为直接验多边形位移。 */
test('突变测试：房子挪 3m，占位跟着走——不改任何表',()=>{
 const before=buildOccupancy(plan,built,scenes);
 const moved=structuredClone(plan);
 const region=moved.regions.find(r=>r.id==='xiaoxiangguan');
 region.buildings.find(b=>b.id==='xiaoxiangguan.rear-house').z-=3;  // plan 的 +z 向南，北移是减
 region.buildings.find(b=>b.id==='xiaoxiangguan.main-house').z-=3;
 const after=buildOccupancy(moved,built,scenes);

 // 后房：老位置要空出来、新位置要被占。占位里没有任何一张手抄表参与。
 assert.equal(before.free(-105,79),0,'挪之前，后房老位置的南沿被占');
 assert.equal(after.free(-105,79),1,'挪之后没空出来，就说明占位还是抄的');
 // 后房檐口外包络 z[71.8,80.2]，北移 3m 后是 z[68.8,77.2]。
 // 所以 z=79「挪前在内、挪后在外」，z=70「挪前在外、挪后在内」——两头都要验，
 // 只验一头的话，一个「把所有地都圈住」的退化实现也能过。
 assert.equal(before.free(-105,70),1,'挪之前，z=70 在后房北面的空地上');
 assert.equal(after.free(-105,70),0,'挪之后，z=70 必须被占');

 // 正房：直接验檐口外包络整体位移 3m。
 const poly=(f,id)=>f.occupants().find(o=>o.id===id).polygon;
 const a=poly(before,'xiaoxiangguan.main-house/main'),b=poly(after,'xiaoxiangguan.main-house/main');
 for(let i=0;i<a.length;i++){
  assert.ok(Math.abs(b[i][0]-a[i][0])<1e-9,'不该有横向位移');
  assert.ok(Math.abs((b[i][1]-a[i][1])+3)<1e-9,'檐口外包络没跟着房子走');
 }
 // 锚在正房上的净空也必须跟着走——这是 clearance 用相对锚点的全部理由。
 const c=(f)=>f.occupants().find(o=>o.id==='潇湘馆院内(留给点名竹)');
 assert.equal(c(after).polygon[0][1]-c(before).polygon[0][1],-3,'锚在正房上的净空没跟着挪');
});

test('未建区不占位：占位场只圈已建成的区',()=>{
 const f=buildOccupancy(plan,built,scenes);
 assert.ok(!f.occupants().some(o=>o.id.startsWith('daoxiangcun')));
 assert.equal(f.free(-202,-52),1,'稻香村没建，它的地不该被圈');
});
