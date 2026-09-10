import test from 'node:test';
import assert from 'node:assert/strict';
import { poissonScatter } from '@engine/scatter/poisson.ts';
import { makeRng } from '@engine/core/Noise.ts';

test('泊松散布：点两两间距不小于半径，且落在给定矩形内', () => {
  const rng = makeRng(1234);
  const pts = poissonScatter({
    minX: -10, maxX: 10, minZ: -10, maxZ: 10,
    radius: 2, density: () => 1, rng,
  });
  assert.ok(pts.length > 20, `点太少：${pts.length}`);
  for (const p of pts) {
    assert.ok(p.x >= -10 && p.x <= 10 && p.z >= -10 && p.z <= 10, `点跑出矩形：${p.x},${p.z}`);
  }
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
      assert.ok(d >= 2 - 1e-6, `两点距离 ${d.toFixed(3)} 小于半径 2`);
    }
});

test('密度为零的区域不落点', () => {
  const rng = makeRng(99);
  const pts = poissonScatter({
    minX: -10, maxX: 10, minZ: -10, maxZ: 10,
    radius: 1.5, density: (x) => (x > 0 ? 1 : 0), rng,
  });
  assert.ok(pts.length > 0, '一个点都没有');
  for (const p of pts) assert.ok(p.x > -1e-6, `密度为零的半边落了点：${p.x}`);
});

test('同一种子给出同一批点', () => {
  const run = () => poissonScatter({
    minX: 0, maxX: 20, minZ: 0, maxZ: 20, radius: 2, density: () => 1, rng: makeRng(7),
  });
  assert.deepEqual(run(), run());
});
