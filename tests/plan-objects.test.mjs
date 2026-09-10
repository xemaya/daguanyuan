import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requirePlanAnchor, validatePlanObjects } from '@builder/plan/objects.ts';
const plan = JSON.parse(readFileSync('projects/daguanyuan/plan.json', 'utf8'));

test('all 73 plan objects and landscape rocks have unique region-scoped identities', () => {
  assert.deepEqual(validatePlanObjects(plan.regions), []);
  const objects = plan.regions.flatMap(r => r.buildings);
  assert.equal(objects.length, 73);
  assert.equal(objects.filter(b => b.kind === 'building').length, 32);
  const byId = new Map(objects.map(b => [b.id, b]));
  assert.equal(byId.get('qinfang_ting_qiao.three-opening-bridge').kind, 'bridge');
  assert.equal(byId.get('shengqin_biesu.stone-archway').kind, 'stone-archway');
  assert.equal(byId.get('xiaoxiangguan.moon-gate').kind, 'opening');
  assert.equal(byId.get('zilingzhou.boathouse').kind, 'building');
  assert.equal(byId.get('huajia_huapu.banana-grove').kind, 'planting');
});

test('MVP anchor migration preserves actual P1 world positions', () => {
  for (const [region, id, expected] of [
    ['zhengmen','main-gate',[55,236]],
    ['cuizhang','screen-rocks',[8,202]],
    ['qinfang_ting_qiao','three-opening-bridge',[0,152]],
    ['qinfang_ting_qiao','pavilion',[0,148]],
    ['xiaoxiangguan','main-house',[-105,98]],
  ]) {
    const b = requirePlanAnchor(plan.regions.find(r => r.id === region), `${region}.${id}`);
    assert.deepEqual([b.x,b.z], expected);
  }
});

test('renaming/reordering buildings never changes the selected anchor', () => {
  const region = structuredClone(plan.regions.find(r => r.id === 'xiaoxiangguan'));
  const target = requirePlanAnchor(region, 'xiaoxiangguan.main-house');
  target.name = '重题的堂名';
  region.buildings.reverse();
  region.buildings.unshift({ ...target, id: 'xiaoxiangguan.other-house', name: '正房', x: 42 });
  assert.equal(requirePlanAnchor(region, target.id), target);
  assert.throws(() => requirePlanAnchor(region, '正房'), /不属于区域/);
  assert.throws(() => requirePlanAnchor(region, 'xiaoxiangguan.missing'), /实际找到 0/);
  region.buildings.push({ ...target });
  assert.throws(() => requirePlanAnchor(region, target.id), /实际找到 2/);
  assert.ok(validatePlanObjects([region]).some(e => e.includes('重复对象 id')));
});
