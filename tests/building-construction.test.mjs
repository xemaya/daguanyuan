import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveFayuanBuilding } from '@builder/derive/fayuan/building.ts';
import { deriveFayuan } from '@builder/derive/fayuan/index.ts';
import { RuleBook } from '@builder/derive/rules.ts';
import { buildPart } from '@builder/parts/registry.ts';
import { buildPlannedBuilding } from '@project/construction.ts';
const plan = JSON.parse(readFileSync('projects/daguanyuan/plan.json', 'utf8'));
const objects = plan.regions.flatMap(r => r.buildings).filter(b => b.construction?.spec.paramSet === 'fayuan');
const house = () => structuredClone(objects.find(b => b.id === 'xiaoxiangguan.main-house').construction.spec);

test('20 authored garden construction specs produce finite column grids and supported roofs', () => {
  assert.equal(objects.length, 20);
  for (const object of objects) {
    const spec = object.construction.spec, frame = deriveFayuanBuilding(spec), m = frame.m;
    assert.equal(m.columnX.length, object.bays + 1, object.id);
    assert.ok(m.columnX.every(Number.isFinite));
    assert.ok(m.depth > 0 && m.width > 0 && m.base > m.columnD);
    assert.ok(m.eaveY > m.columnH && m.ridgeY > m.eaveY);
    assert.equal(m.puzuoH, 0, '江南样板不得继承宋式铺作');
    assert.ok(frame.roofSection.every(p => Number.isFinite(p.s) && Number.isFinite(p.y)));
    for (let i = 1; i < frame.roofSection.length; i++)
      assert.ok(frame.roofSection[i].s > frame.roofSection[i-1].s, object.id);
    assert.ok(frame.provenance.art.some(p => p.id === 'project:building-dimensions' && p.note.includes(spec.design.note)));
  }
});

test('Tier C hall uses a hall grid and explicit height, never pavilion proportions', () => {
  const spec = { tier:'C', form:'hall', bayWidthsM:[3,3.6,3], columnHeightM:3,
    jieDepthChi:3.5, jieCount:6, chiCm:32 };
  const f = deriveFayuan(RuleBook.create('fayuan'), spec);
  assert.deepEqual(f.m.columnX.map(n=>Number(n.toFixed(3))), [-4.8,-1.8,1.8,4.8]);
  assert.equal(f.m.columnH, 3);
  assert.equal(f.qiangjiao, null);
  assert.ok(!f.provenance.evidence.some(e => e.id === '05-11' || e.id === '05-02'));
  assert.throws(() => deriveFayuan(RuleBook.create('fayuan'), {...spec, columnHeightM:undefined}), /显式给 columnHeightM/);
});

test('a short hall requires explicit side-section values, preserving the missing-rule boundary', () => {
  const spec = { tier:'C', form:'hall', bayWidthsM:[3], columnHeightM:3, jieDepthChi:3.5, jieCount:4, chiCm:32 };
  assert.throws(() => deriveFayuan(RuleBook.create('fayuan'), spec), e => e.name === 'MissingRuleError' && e.ruleId === '99-08');
  const f = deriveFayuan(RuleBook.create('fayuan'), {...spec, suanSeq:[5,6.5]});
  assert.ok(Math.abs(f.m.ridgeY - 4.288) < 1e-10);
  assert.ok(f.provenance.art.some(e => e.id === '99-08'));
  for (const seq of [[5], [5,6,7], [5,NaN], [-1,6]])
    assert.throws(() => deriveFayuan(RuleBook.create('fayuan'), {...spec,suanSeq:seq}), /suanSeq/);
  const short = deriveFayuan(RuleBook.create('fayuan'), {...spec,jieCount:2,suanSeq:[5]});
  assert.deepEqual(short.m.purlins.map(p=>p.name), ['脊桁','廊桁']);
});

test('rolled roof has a continuous rounded summit and a pair of lower top purlins', () => {
  const s = house(), rolled = deriveFayuanBuilding(s), straight = deriveFayuanBuilding({...s,ridgeStyle:'raised'});
  const last = rolled.roofSection.at(-1), near = rolled.roofSection.at(-2);
  assert.equal(last.y, rolled.m.ridgeY);
  assert.ok((last.y-near.y)/(last.s-near.s) < 0.06);
  assert.ok(rolled.m.ridgeY < straight.m.ridgeY);
  assert.equal(rolled.m.purlins[0].x, s.design.rolledHalfSpanM);
  assert.ok(rolled.m.eaveY + rolled.m.purlins[0].y < rolled.m.ridgeY);
  assert.deepEqual(rolled.m.columnX, straight.m.columnX);
});

test('missing detailing and unsupported forms fail instead of borrowing a legacy house', () => {
  const s = house();
  assert.throws(() => deriveFayuanBuilding({...s,design:{...s.design,eaveSupportHeightM:undefined}}), /eaveSupportHeightM/);
  assert.throws(() => deriveFayuanBuilding({...s,design:{...s.design,note:''}}), /design.note/);
  assert.throws(() => deriveFayuanBuilding({...s,roofType:'庑殿'}), /未实现屋顶/);
  const pavilion = structuredClone(objects.find(b=>b.id === 'qinfang_ting_qiao.pavilion').construction.spec);
  assert.throws(() => deriveFayuanBuilding({...pavilion,shape:'hexagon'}), /多边形亭/);
  assert.throws(() => deriveFayuanBuilding({...pavilion,ridgeStyle:'rolled'}), /不可叠作/);
  assert.throws(() => deriveFayuanBuilding({...s,bayWidthsM:[3,-1,3]}), /有限正数/);
  assert.throws(() => buildPart('building','tang:typo'), /不可静默替换/);
  assert.throws(() => buildPlannedBuilding('zhengmen.main-gate'), /P3分件\/楼层几何尚未完成/);
  assert.throws(() => buildPlannedBuilding('qinfang_ting_qiao.three-opening-bridge'), /不能作为木构房屋/);
});
