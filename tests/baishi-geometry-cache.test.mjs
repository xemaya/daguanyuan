// 单子 BH1:白石几何按 variant 记忆化——同一 variant 只算一次,且缓存出来的与现算的逐位相同。
// 藤萝找挂点(baishiCrownPoints)与构件本身共用这一份,不许谁就地改它。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBaishiGeometry, buildBaishiGeometryFresh, baishiCrownPoints } from '../builder/parts/shishan/baishi.ts';

const same = (a, b, what) => {
  assert.equal(a.length, b.length, `${what} 长度`);
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) assert.fail(`${what}[${i}] ${a[i]} ≠ ${b[i]}`);
};

for (const variant of ['group3', 'skirt3']) {
  test(`${variant}:同一 variant 返回同一份几何`, () => {
    assert.equal(buildBaishiGeometry(variant), buildBaishiGeometry(variant));
  });

  test(`${variant}:缓存 = 现算,逐位相同(合并几何与每块峰)`, () => {
    const cached = buildBaishiGeometry(variant);
    const fresh = buildBaishiGeometryFresh(variant);
    same(cached.geo.attributes.position.array, fresh.geo.attributes.position.array, 'position');
    same(cached.geo.attributes.normal.array, fresh.geo.attributes.normal.array, 'normal');
    same(cached.geo.index?.array ?? [], fresh.geo.index?.array ?? [], 'index');
    assert.equal(cached.stones.length, fresh.stones.length);
    cached.stones.forEach((st, i) => same(st.geo.attributes.position.array, fresh.stones[i].geo.attributes.position.array, `stone${i}`));
  });

  test(`${variant}:找挂点不改几何,两次结果相同`, () => {
    const before = buildBaishiGeometry(variant).geo.attributes.position.array.slice();
    const a = baishiCrownPoints(variant);
    const b = baishiCrownPoints(variant);
    assert.deepEqual(a, b);
    same(buildBaishiGeometry(variant).geo.attributes.position.array, before, 'position(找挂点之后)');
  });
}
