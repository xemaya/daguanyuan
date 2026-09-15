import test from 'node:test';
import assert from 'node:assert/strict';
import { xifancaoUnit, XIFANCAO_SEEDS, patternVExtent } from '../builder/parts/ornament/pattern2d.ts';
import {
  makeScrollBand, bandHeight, buildReliefBandGeometry, bandTriangleCount, XIFANCAO_LEVELS,
} from '../builder/parts/ornament/relief.ts';

/* 样件的实际参数,测试与 forecourt-terrace.ts 用同一组数(改一处两处一起红)。 */
const L = 1.8;
const H = 0.11;
const CELL = 0.18;

test('同 seed 同输出——纹样是数据,不是随机画的', () => {
  for (const seed of XIFANCAO_SEEDS) {
    const a = xifancaoUnit(seed, CELL / H);
    const b = xifancaoUnit(seed, CELL / H);
    assert.deepEqual(a.spine, b.spine);
    assert.deepEqual(a.leaves, b.leaves);
    for (let i = 0; i <= 10; i++) assert.equal(a.spineWidth(i / 10), b.spineWidth(i / 10));
  }
});

test('四个种子彼此不重样', () => {
  const sigs = XIFANCAO_SEEDS.map((s) => JSON.stringify(xifancaoUnit(s, CELL / H)));
  assert.equal(new Set(sigs).size, XIFANCAO_SEEDS.length, '种子撞了,不是 3~4 个不重样的单元');
});

test('纹样不越 margin——上下留白留得住', () => {
  for (const seed of XIFANCAO_SEEDS) {
    const p = xifancaoUnit(seed, CELL / H);
    const [lo, hi] = patternVExtent(p);
    assert.ok(lo >= p.margin - 1e-9, `seed ${seed} 下缘 ${lo} 越过留白 ${p.margin}`);
    assert.ok(hi <= 1 - p.margin + 1e-9, `seed ${seed} 上缘 ${hi} 越过留白 ${1 - p.margin}`);
  }
});

test('主藤在单元接缝处值与斜率都接得上——不是一段一段搭的', () => {
  for (const seed of XIFANCAO_SEEDS) {
    const p = xifancaoUnit(seed, CELL / H);
    const first = p.spine[0];
    const last = p.spine[p.spine.length - 1];
    assert.ok(Math.abs(first[1] - last[1]) < 1e-9, '接缝两端不等高');
    const dIn = p.spine[1][1] - p.spine[0][1];
    const dOut = last[1] - p.spine[p.spine.length - 2][1];
    assert.ok(Math.abs(dIn - dOut) < 1e-6, `seed ${seed} 接缝斜率差 ${Math.abs(dIn - dOut)}`);
    assert.ok(Math.abs(p.spineWidth(0) - p.spineWidth(1)) < 1e-9, '接缝两端藤宽不等');
  }
});

test('h 在带的两长边为 0——带边落在石面上,不浮起', () => {
  const band = makeScrollBand(L, H, CELL, XIFANCAO_SEEDS);
  for (let i = 0; i <= 400; i++) {
    const x = (i / 400) * L;
    assert.equal(bandHeight(band, x, -H / 2), 0);
    assert.equal(bandHeight(band, x, H / 2), 0);
  }
});

test('h 两端淡出——样件只有一段,两头要落回石面', () => {
  const band = makeScrollBand(L, H, CELL, XIFANCAO_SEEDS);
  for (let j = 0; j <= 20; j++) {
    const y = (j / 20 - 0.5) * H;
    assert.equal(bandHeight(band, 0, y), 0);
    assert.equal(bandHeight(band, L, y), 0);
  }
});

test('分区高低:主藤最高、叶面次之、石面 0', () => {
  const band = makeScrollBand(L, H, CELL, XIFANCAO_SEEDS);
  let peak = 0;
  let onLeafOnly = 0;
  for (let i = 0; i < 900; i++) {
    for (let j = 0; j < 40; j++) {
      const h = bandHeight(band, (i / 900) * L, (j / 40 - 0.5) * H);
      peak = Math.max(peak, h);
      if (h > 0 && h <= XIFANCAO_LEVELS.leafH + 1e-9) onLeafOnly++;
    }
  }
  assert.ok(peak > XIFANCAO_LEVELS.leafH, '峰高没超过叶面高,主藤没起来');
  assert.ok(peak <= XIFANCAO_LEVELS.spineH + 1e-9, `峰高 ${peak} 超过主藤分层高`);
  assert.ok(onLeafOnly > 0, '没有只有叶面高度的采样点,分层没分出来');
});

test('单元长不整除带长要抛错,不许静默取整', () => {
  assert.throws(() => makeScrollBand(1.73, H, CELL, XIFANCAO_SEEDS), /整数倍/);
});

test('几何版:两长边顶点 z 为 0,三角数在样件预算内', () => {
  const band = makeScrollBand(L, H, CELL, XIFANCAO_SEEDS);
  const geo = buildReliefBandGeometry(band, 0.004, 0.004);
  const pos = geo.attributes.position;
  const tris = geo.index.count / 3;
  assert.equal(tris, bandTriangleCount(band, 0.004, 0.004));
  assert.ok(tris <= 40000, `${tris} 三角超过样件预算 40k`);
  let maxZ = 0;
  let edgeMax = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    maxZ = Math.max(maxZ, z);
    if (Math.abs(Math.abs(y) - H / 2) < 1e-9) edgeMax = Math.max(edgeMax, Math.abs(z));
  }
  assert.equal(edgeMax, 0, '带边顶点浮起来了');
  assert.ok(maxZ > XIFANCAO_LEVELS.spineH * 0.9, `最高点只有 ${maxZ}m,纹样没被网格采到`);
});

test('几何版:顶点法线一律朝外(+Z)——绕序反了会被背面剔除,画面上什么都没有', () => {
  const band = makeScrollBand(L, H, CELL, XIFANCAO_SEEDS);
  const geo = buildReliefBandGeometry(band, 0.004, 0.004);
  const nor = geo.attributes.normal;
  let worst = 1;
  for (let i = 0; i < nor.count; i++) worst = Math.min(worst, nor.getZ(i));
  assert.ok(worst > 0, `有顶点法线朝里(最小 nz=${worst}),带子会被背面剔除`);
});
