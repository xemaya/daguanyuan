import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requirePlanAnchor, validatePlanObjects } from '@builder/plan/objects.ts';
const plan = JSON.parse(readFileSync('projects/daguanyuan/plan.json', 'utf8'));

test('all 75 plan objects and landscape rocks have unique region-scoped identities', () => {
  assert.deepEqual(validatePlanObjects(plan.regions), []);
  const objects = plan.regions.flatMap(r => r.buildings);
  assert.equal(objects.length, 75);
  assert.equal(objects.filter(b => b.kind === 'building').length, 32);
  const byId = new Map(objects.map(b => [b.id, b]));
  assert.equal(byId.get('qinfang_ting_qiao.three-opening-bridge').kind, 'bridge');
  assert.equal(byId.get('shengqin_biesu.stone-archway').kind, 'stone-archway');
  assert.equal(byId.get('xiaoxiangguan.moon-gate').kind, 'opening');
  assert.equal(byId.get('zilingzhou.boathouse').kind, 'building');
  assert.equal(byId.get('huajia_huapu.banana-grove').kind, 'planting');
});

test('planting beds (PQ-4): closed rings, tints and density, one truth in plan.json', () => {
  const beds = [...plan.regions.flatMap(r => r.buildings), ...plan.routeFeatures]
    .filter(e => e.kind === 'planting' && e.bed);
  // 潇湘馆甬路两池 + 蔷薇院 + 芍药圃;芭蕉坞是叶木不是花,无 bed。
  assert.equal(beds.length, 4);
  for (const b of beds) {
    assert.ok(b.basis, `${b.id} 缺 basis 留痕`);
    assert.ok(Array.isArray(b.bed.tints) && b.bed.tints.length > 0, `${b.id} 缺花色`);
    if (b.bed.polygon) {
      const ring = b.bed.polygon;
      const [x0, z0] = ring[0];
      const [x1, z1] = ring[ring.length - 1];
      assert.ok(ring.length >= 4 && x0 === x1 && z0 === z1, `${b.id} 的 bed.polygon 不是闭合环`);
    } else {
      assert.ok(b.bed.radius > 0, `${b.id} 缺范围(polygon 或 radius)`);
    }
  }
});

/* 这条门守的是「P1 那次坐标系迁移没有把锚点搬错」,不是「这些锚点从此不许动」。
 * 2026-09-17 单子 AV1 有意把 `cuizhang.screen-rocks` 从 (8,202) 挪到 (53,200):
 * 门轴 x=55 上一块石头也没有,五组峰全在轴的西边(景需求文档 §6-1)。
 * 期望值跟着落地改,改的理由与量过的数写在 plan.json 该 rock 的 layout_basis 里。
 * **别把这条改成「读 plan 自己的值」**——那样它就永远绿,什么也守不住了。 */
test('MVP anchor migration preserves actual P1 world positions', () => {
  for (const [region, id, expected] of [
    ['zhengmen','main-gate',[55,236]],
    ['cuizhang','screen-rocks',[53,200]],   // AV1 有意移位,见上注
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
