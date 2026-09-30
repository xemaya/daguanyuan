import test from 'node:test';
import assert from 'node:assert/strict';
import { VisitedRegions } from '@project/visited.ts';

// 仿 zhengmen:多边形 z∈[222,246],入口 (55,244),出生点 (55,248) 在南边 2 m 外。
const zhengmen = { id: 'zhengmen', polygon: [[15, 224], [95, 224], [95, 246], [15, 246], [15, 224]] };
const far = { id: 'xiaoxiangguan', polygon: [[-145, 58], [-65, 58], [-65, 125], [-145, 125], [-145, 58]] };

test('visited: inside, boundary margin and fresh-only-once', () => {
  const v = new VisitedRegions([zhengmen, far]);
  // 出生点在多边形外 2 m,边界余量(5 m)内——算到过。
  assert.deepEqual(v.update(55, 248), ['zhengmen']);
  assert.equal(v.has('zhengmen'), true);
  assert.equal(v.has('xiaoxiangguan'), false);
  // 同一区不重复报新解锁。
  assert.deepEqual(v.update(55, 240), []);
  // 远处的区不受影响;走到内部才解锁。
  assert.deepEqual(v.update(0, 150), []);
  assert.deepEqual(v.update(-100, 90), ['xiaoxiangguan']);
});

test('visited: margin reaches across the wall but not beyond', () => {
  const v = new VisitedRegions([zhengmen]);
  assert.deepEqual(v.update(55, 246 + 5), ['zhengmen']);
  const v2 = new VisitedRegions([zhengmen]);
  assert.deepEqual(v2.update(55, 246 + 5.1), []);
});
