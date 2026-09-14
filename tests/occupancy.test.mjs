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

/* ---- 单子 AF：墙体进占位场，但走另一条通道 ---------------------------- */

import {WALL_BAND_HALF,SOLID_RADIUS,solidRadiusOf} from '@builder/compose/occupancy.ts';

test('墙厚取的是 wall.ts 三层里最厚的那层,不是拍的数',()=>{
 // wall.ts 的 THICK/BASE_T/PLINTH_T 是模块私有常量,import 不到,所以直接读源码,
 // 把「PLINTH_T 仍是最厚的那层」这个前提焊住:哪天有人把墙身改厚过墙基,
 // 这条会红,提醒 WALL_BAND_HALF 的推导要跟着改。
 const src=readFileSync('builder/parts/qiangyuan/wall.ts','utf8');
 const grab=re=>{const m=src.match(re);return m?Number(m[1]):null;};
 const THICK=grab(/const THICK = ([0-9.]+)/), BASE_T=grab(/const BASE_T = ([0-9.]+)/);
 assert.ok(THICK!==null&&BASE_T!==null,'wall.ts 里找不到 THICK / BASE_T 了');
 assert.ok(src.includes('const PLINTH_T = WALL_STYLE.footHalf * 2'),
  'PLINTH_T 不再是 WALL_STYLE.footHalf*2 —— WALL_BAND_HALF 的推导失效了');
 const PLINTH_T=WALL_BAND_HALF*2;
 assert.ok(PLINTH_T>BASE_T&&BASE_T>THICK,`最厚的该是墙基:THICK ${THICK} < BASE_T ${BASE_T} < PLINTH_T ${PLINTH_T}`);
});

test('墙体带只占墙体本身:带厚等于墙基厚,不外扩',()=>{
 const f=buildOccupancy(plan,built,scenes);
 const east=f.wallBands().find(w=>w.id==='xiaoxiangguan.courtyard-wall#1');
 assert.ok(east,'潇湘馆东院墙那一段没进场');
 const xs=east.polygon.map(p=>p[0]);
 assert.ok(Math.abs((Math.max(...xs)-Math.min(...xs))-WALL_BAND_HALF*2)<1e-9,
  '东院墙沿 x=-91,带宽必须正好是墙基厚,多一点都是给墙加了净空');
});

test('⚠️ 墙不许影响 free()/distance()——那是植被散布器在读的',()=>{
 const withWalls=buildOccupancy(plan,built,scenes);
 // 同一份 plan,但把所有墙体数据拿掉:free()/distance() 必须逐点一模一样。
 const noWalls=structuredClone(plan);
 delete noWalls.wall;
 for(const r of noWalls.regions) r.linears=(r.linears??[]).filter(l=>l.kind!=='wall');
 const bare=buildOccupancy(noWalls,built,scenes);
 for(let x=-135;x<=-85;x+=2.5) for(let z=60;z<=125;z+=2.5){
  assert.equal(withWalls.free(x,z),bare.free(x,z),`free 在 (${x},${z}) 被墙改了`);
  assert.equal(withWalls.distance(x,z),bare.distance(x,z),`distance 在 (${x},${z}) 被墙改了`);
 }
 // 站在墙芯上,free 仍是 1:墙就是不进这条通道。
 assert.equal(withWalls.free(-91,100),1);
});

test('未建区的院墙不入场,与「未建区不占位」同口径',()=>{
 const f=buildOccupancy(plan,built,scenes);
 assert.ok(!f.wallBands().some(w=>w.id.startsWith('longcuian')));
 assert.ok(f.wallBands().some(w=>w.id.startsWith('xiaoxiangguan.courtyard-wall')));
 assert.ok(f.wallBands().some(w=>w.id.startsWith('plan.wall')),'园墙外环不属于任何区,建没建成都该在');
});

test('实体半径不是包围盒:枝叶不算,竿才算',()=>{
 // 名册里 bamboo:grove 的包围盒是 7.80×5.90×7.22(半展 3.9),里面包含枝叶。
 assert.equal(solidRadiusOf('bamboo','grove',[7.80,5.90,7.22]),2.95);
 assert.ok(2.95<7.80/2,'实体半径必须小于包围盒半展,否则「竹梢探出墙头」会被误报');
 // 石头从里到外都是实心的,包围盒就是实体。
 assert.equal(solidRadiusOf('taihu','peak4',[1.40,2.65,1.16]),0.7);
 // 表里没有的返回 null——跳过,但要被数出来,不许静默略过。
 assert.equal(solidRadiusOf('wall','plain',[6.16,2.68,0.61]),null);
 assert.ok(!('wall' in SOLID_RADIUS),'墙自己不该有实体半径,否则会拿墙去撞墙');
});

import {auditSolidVsWall} from '@builder/compose/occupancy.ts';

/** 潇湘馆东院墙沿 x=-91（折线 [-91,120]→[-91,66]），墙基半厚 0.23 → 近侧墙面 x=-91.23。 */
const rec=(part,variant,x,z,size,y=1)=>({id:part+':'+variant,part,variant,position:[x,y,z],size,planId:null});

test('⚠️ 枝叶越墙不许报——那是 07-07「翠竹遮映」要的景',()=>{
 const f=buildOccupancy(plan,built,scenes);
 // 一丛 clump：实体半径 1.1，但包围盒 3.41×3.22（半展 1.7）明显越过墙面。
 // 放在离墙面 1.3m 处：竿(1.1)清得出来，叶(1.7)越了墙。**必须是绿的。**
 const leafyButClear=rec('bamboo','clump',-92.53,100,[3.41,6.34,3.22]);
 assert.ok(1.7>1.3,'样例没构造对:包围盒必须越墙');
 assert.equal(auditSolidVsWall([leafyButClear],f).hits.length,0,
  '拿包围盒当实体范围了——竹梢探出墙头被误报成缺陷');
 // 同一丛再往墙里推 0.4m，竿也进墙了 → 必须报。
 const culmInWall=rec('bamboo','clump',-92.13,100,[3.41,6.34,3.22]);
 assert.equal(auditSolidVsWall([culmInWall],f).hits.length,1);
});

test('没有实体半径的构件跳过并计数,不许静默略过',()=>{
 const f=buildOccupancy(plan,built,scenes);
 const r=auditSolidVsWall([
  rec('wall','plain',-91,100,[6.16,2.68,0.61]),      // 墙自己,不拿墙去撞墙
  rec('luya','default',0,0,[213,0.62,149]),           // 世界空间铺地
  rec('bamboo','clump',-92.13,100,[3.41,6.34,3.22]),  // 有实体半径,要查
 ],f);
 assert.equal(r.skipped,2);
 assert.equal(r.checked,1);
 assert.equal(r.hits.length,1);
});

test('挂在檐下的灯在墙顶之上,不算插进墙里',()=>{
 const f=buildOccupancy(plan,built,scenes);
 const band=f.wallBands().find(w=>w.id==='xiaoxiangguan.courtyard-wall#1');
 // y 取墙顶之上；即便平面上正落在墙芯,也不该报。
 const aloft={id:'x',part:'taihu',variant:'peak4',position:[-91,band.topY+1,100],size:[1.4,2.65,1.16],planId:null};
 assert.equal(auditSolidVsWall([aloft],f).hits.length,0);
 // 同一个东西落到墙高之内就要报,证明上面那条不是因为别的原因绿的。
 const grounded={...aloft,position:[-91,1,100]};
 assert.equal(auditSolidVsWall([grounded],f).hits.length,1);
});

/** 三态测试（spec 单子 AF 的验收判据）：修前红 / 修后绿 / 挪回去再红。
 *  只验一头不算——只验「修后绿」的话，一个永远返回空的门也能过。 */
test('三态：潇湘馆那丛竹,修前穿墙 / 修后清出 / 挪回去再穿墙',()=>{
 const f=buildOccupancy(plan,built,scenes);
 const house=plan.regions.find(r=>r.id==='xiaoxiangguan').buildings.find(b=>b.id==='xiaoxiangguan.main-house');
 const groveAt=dx=>[{id:'bamboo:grove',part:'bamboo',variant:'grove',
  position:[house.x+dx,1,house.z+0.6],size:[7.80,5.90,7.22],planId:null}];
 const depth=dx=>{const h=auditSolidVsWall(groveAt(dx),f).hits;return h.length?h[0].depth:0;};

 const BEFORE=11.1;   // 用户报「竹子穿墙」时的那个数
 // 修后的数从**真文件**里读,这条测试因此同时守着这次修复:有人把它改回去就红。
 const entry=scenes.find(s=>s.region==='xiaoxiangguan').placements
  .find(p=>p.part==='bamboo'&&p.variant==='grove'&&p.dz===0.6);
 const AFTER=entry.dx;

 assert.ok(depth(BEFORE)>0, `修前必须穿墙,实际 ${depth(BEFORE)}`);
 assert.ok(Math.abs(depth(BEFORE)-0.28)<0.01, `修前深度该是 0.28m,实际 ${depth(BEFORE).toFixed(3)}`);
 assert.equal(depth(AFTER), 0, `修后必须清出墙体,dx=${AFTER} 仍穿 ${depth(AFTER).toFixed(3)}m`);
 assert.equal(depth(BEFORE), depth(11.1), '挪回去必须重新穿墙——门不是一次性的');

 // 别挪多了:只许刚清出,不许挪到院子中间。阈值实测在 dx=10.82。
 assert.ok(AFTER>=10.6, `dx=${AFTER} 挪过头了,07-07「遮映」要的是竹贴着墙`);
 assert.ok(AFTER<=10.82, `dx=${AFTER} 还没清出墙体`);
});
