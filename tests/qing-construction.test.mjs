import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveQingBuilding,deriveQingConstruction} from '@builder/derive/qing/building.ts';
import {containsRing} from '@builder/plan/geometry.ts';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));
const objects=plan.regions.flatMap(region=>region.buildings.map(object=>({region,object})))
 .filter(({object})=>object.construction?.spec.paramSet==='qing');
const gate=()=>structuredClone(objects.find(({object})=>object.id==='zhengmen.main-gate').object.construction);

test('five Qing contracts derive eight independent frames and fit their planning regions',()=>{
 assert.equal(objects.length,5);let frames=0;
 for(const {region,object} of objects) {
  const c=object.construction,a=deriveQingConstruction(c);
  for(const f of [a.lower,a.upper].filter(Boolean)) {
   frames++;
   assert.equal(f.m.columnX.length,object.bays+1);
   assert.ok(f.roofSection.every(p=>Number.isFinite(p.s)&&Number.isFinite(p.y)));
   for(let i=1;i<f.roofSection.length;i++)assert.ok(f.roofSection[i].s>f.roofSection[i-1].s);
   assert.ok(f.provenance.art.some(e=>e.id==='project:qing-dimensions'));
   assert.ok(![...f.provenance.evidence,...f.provenance.inference].some(e=>['04-04','04-07','01-05','02-02','99-02'].includes(e.id)),object.id);
  }
  const m=a.lower.m,hx=m.width/2+m.yanchu+m.puzuoOut,hz=m.eaveHalf+m.yanchu;
  const polygon=[[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz],[-hx,-hz]].map(([x,z])=>[x+object.x,z+object.z]);
  assert.ok(containsRing(region.polygon,polygon),object.id+' roof envelope');
  assert.equal(a.geometryReady,false,'A frame is not a completed detailed building');
  assert.ok(a.totalHeight>a.floors.at(-1));
 }
 assert.equal(frames,8);
});

test('gate dimensions follow explicit inputs; doubling doukou does not double its column grid or height',()=>{
 const c=gate(),s=c.spec,a=deriveQingBuilding(s),b=deriveQingBuilding({...s,doukouMm:s.doukouMm*2});
 assert.deepEqual(a.m.columnX.map(x=>+x.toFixed(3)),[-7.8,-5,-1.8,1.8,5,7.8]);
 assert.equal(a.m.columnH,4.2);assert.equal(a.m.columnD,.42);
 assert.equal(a.m.puzuoH,.72);assert.ok(Math.abs(a.m.eaveY-5.08)<1e-10);
 assert.deepEqual(a.m.columnX,b.m.columnX);assert.equal(a.m.columnH,b.m.columnH);assert.equal(a.m.columnD,b.m.columnD);
 assert.equal(a.m.puzuoH,b.m.puzuoH);assert.notEqual(a.m.rafterDia,b.m.rafterDia,'real derived cross sections still respond');
});

test('incomplete Qing dimensions and an impossible storey cannot silently use defaults',()=>{
 const c=gate(),s=c.spec;
 for(const key of ['columnDiameterM','columnHeightM','doukouMm'])assert.throws(()=>deriveQingBuilding({...s,[key]:undefined}),/有限正数/);
 assert.throws(()=>deriveQingBuilding({...s,puzuo:{cai:5}}),/有限正数/);
 assert.throws(()=>deriveQingBuilding({...s,puzuo:{...s.puzuo,cai:4}}),/踩数/);
 assert.throws(()=>deriveQingBuilding({...s,bayWidthsM:[3,-2,3]}),/有限正数/);
 const tower=structuredClone(objects.find(({object})=>object.id.endsWith('daguan-tower')).object.construction);
 assert.throws(()=>deriveQingConstruction({...tower,upperStorey:{...tower.upperStorey,floorHeightM:1}}),/楼面/);
 assert.throws(()=>deriveQingConstruction({...tower,upperStorey:{...tower.upperStorey,spec:tower.spec}}),/缩入/);
 assert.throws(()=>deriveQingConstruction({...tower,upperStorey:{...tower.upperStorey,lowerRoof:'full'}}),/不能叠/);
});
