import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileConstruction,constructionFootprints} from '@builder/derive/construction.ts';
import {deriveRusticBuilding} from '@builder/derive/rustic/building.ts';
import {interiorsOverlap,locatePoint} from '@builder/plan/geometry.ts';
import {makeTerrainField} from '@builder/compose/terrain-from-plan.ts';
import {auditConstructions} from '../tools/construction-audit.mjs';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const get=id=>plan.regions.flatMap(r=>r.buildings).find(b=>b.id===id);

test('all 32 building contracts compile; 10 frame contracts are not counted as available meshes',()=>{
 // 单子 BA4:稻香村两栋茅屋近景几何落地(thatch-cottage),frame-ready → 可建成,20/12 → 22/10。
 const a=auditConstructions(plan);assert.deepEqual(a.fails,[]);assert.equal(a.objects.length,32);
 assert.equal(a.meshFactories,22);assert.equal(a.frameOnly,10);
 assert.equal(a.objects.reduce((n,o)=>n+o.compiled.modules.length,0),38);
 const changed=structuredClone(plan);delete changed.regions.find(r=>r.id==='daoxiangcun').buildings[0].construction;
 assert.ok(auditConstructions(changed).fails.some(s=>s.includes('缺少施工spec')));
});

test('lianxia shares a full rear face and reserves a complete four-sided gallery',()=>{
 const b=get('hengwuyuan.main-house'),c=compileConstruction(b.construction),[main,annex]=c.modules;
 assert.equal(main.frame.m.columnX.length,6);assert.equal(main.frame.m.width,annex.frame.m.width);
 assert.ok(Math.abs(annex.at[2]+annex.frame.m.depthHalf+main.frame.m.depthHalf)<1e-9);
 const footprints=constructionFootprints(c,b);
 assert.equal(interiorsOverlap(footprints[0].body,footprints[1].body),false);
 assert.equal(c.gallery.points.length,5);assert.deepEqual(c.gallery.points[0],c.gallery.points.at(-1));
 assert.ok(c.gallery.frame.m.depth-c.gallery.frame.m.columnD>=1.3);
 assert.ok(c.pendingGeometry.includes('shared-eave-cut'));
 const broken=structuredClone(b.construction);delete broken.spec.gallery;
 assert.throws(()=>compileConstruction(broken),/四面廊/);
});

test('baoxia is a front projection rather than a second overlapping whole house',()=>{
 const b=get('yihongyuan.main-house'),c=compileConstruction(b.construction),[main,annex]=c.modules;
 assert.equal(main.frame.m.columnX.length,6);assert.ok(annex.frame.m.width<main.frame.m.width);
 assert.ok(Math.abs(annex.at[2]-annex.frame.m.depthHalf-main.frame.m.depthHalf)<1e-9);
 const f=constructionFootprints(c,b);assert.equal(interiorsOverlap(f[0].body,f[1].body),false);
 const centre=[b.x,b.z+annex.at[2]];
 assert.equal(locatePoint(f[0].body,centre),'outside');assert.equal(locatePoint(f[1].body,centre),'inside');
 const broken=structuredClone(b.construction);broken.spec.secondary.spec=broken.spec.primary;
 assert.throws(()=>compileConstruction(broken),/抱厦须窄于主屋/);
});

test('rustic roofs use the authored constant slope without a borrowed historical modulus',()=>{
 for(const id of ['daoxiangcun.main-cottage','daoxiangcun.side-cottage','luxueguang.reed-hall']) {
  const b=get(id),f=deriveRusticBuilding(b.construction.spec);
  assert.equal(f.m.columnX.length,b.bays+1);assert.equal(f.m.puzuoH,0);assert.equal(f.m.qiqiao,0);
  assert.deepEqual(f.provenance.inference,[]);assert.equal(f.provenance.evidence.length,1);
  const slopes=f.roofSection.slice(1).map((p,i)=>(p.y-f.roofSection[i].y)/(p.s-f.roofSection[i].s));
  assert.ok(slopes.every(s=>Math.abs(s-.4)<1e-10));
 }
 const b=get('daoxiangcun.main-cottage'),f=deriveRusticBuilding(b.construction.spec);
 assert.ok(Math.abs(f.m.width-8.2)<1e-10);assert.ok(Math.abs(f.m.ridgeY-4.32)<1e-10);
 assert.throws(()=>deriveRusticBuilding({...b.construction.spec,cover:'tile'}),/不接瓦作/);
 const side=get('luxueguang.reed-hall'),c=compileConstruction(side.construction);
 const fwest=constructionFootprints(c,{...side,facing:'west'})[0].body;
 const fsouth=constructionFootprints(c,{...side,facing:'south'})[0].body;
 const extent=(ring,k)=>+(Math.max(...ring.map(p=>p[k]))-Math.min(...ring.map(p=>p[k]))).toFixed(6);
 assert.deepEqual([extent(fwest,0),extent(fwest,1)],[5.2,11.2]);
 assert.deepEqual([extent(fsouth,0),extent(fsouth,1)],[11.2,5.2]);
});

test('boat berth remains water across its full usable width and connects to the existing creek',()=>{
 const b=get('zilingzhou.boathouse'),c=compileConstruction(b.construction),field=makeTerrainField(plan,{seed:17910000});
 assert.equal(b.bays,1);assert.equal(c.modules[0].frame.m.columnX.length,2);
 for(let x=-c.boat.berthWidthM/2;x<=c.boat.berthWidthM/2;x+=.25)
  for(let z=-c.boat.berthLengthM/2;z<=c.boat.berthLengthM/2;z+=.25)
   assert.ok(field.height(b.x+x,b.z+z)<=-c.boat.draftM,`boat draft at ${x},${z}`);
 for(let z=-86;z<=-55;z+=.5)assert.ok(field.height(-148,z)<=-c.boat.draftM);
 assert.ok(c.pendingGeometry.includes('side-walks-no-central-slab'));
 assert.equal(c.site.baseElevationM+c.platformH,1.15);
 const noSite=structuredClone(b.construction);delete noSite.site;
 assert.throws(()=>compileConstruction(noSite),/不能把河床/);
 const broken=structuredClone(plan);broken.water.find(w=>w.id===c.boat.waterRef).polygon=[[-151,-91],[-145,-91],[-145,-77],[-151,-77],[-151,-91]];
 assert.ok(auditConstructions(broken).fails.some(s=>s.includes('未接入现有水系')));
 const reversed=structuredClone(plan);reversed.regions.find(r=>r.id==='zilingzhou').buildings.find(b=>b.id==='zilingzhou.boathouse').facing='north';
 assert.ok(auditConstructions(reversed).fails.some(s=>s.includes('通舟口朝向')));
 const narrow=structuredClone(b.construction);narrow.spec.boat.clearWidthM=1;
 assert.throws(()=>compileConstruction(narrow),/净空不足/);
});
