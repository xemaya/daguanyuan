import test from 'node:test';
import assert from 'node:assert/strict';
import { LatticeMask, blocksOver, blockHash, latticeHash01, splitRng } from '@engine/scatter/blocks.ts';
import { makeRng } from '@engine/core/Noise.ts';

/* D-37:块外散布的通用件。判据的核心是「与窗口无关」——这里把那几条焊住。 */

test('世界格点掩码:查同一点,与先烤了哪些块、烤了多少块无关', () => {
  const f = (x, z) => Math.sin(x * 0.37) * Math.cos(z * 0.21) * 0.5 + 0.5;
  const a = new LatticeMask(f, 1, 32), b = new LatticeMask(f, 1, 32);
  // b 先在远处烤一大片,a 不烤。
  for (let x = -300; x < 300; x += 17) b.at(x, -200);
  for (const [x, z] of [[-12.3, 44.7], [107.9, 258.2], [-240.5, -110.1], [0, 0]]) assert.equal(a.at(x, z), b.at(x, z));
  // 格点上正好等于采样函数。
  assert.equal(a.at(5, 7), Math.fround(f(5, 7)));
});

test('块:按世界坐标对齐,与窗口原点无关', () => {
  const small = blocksOver({ minX: -245, maxX: 108, minZ: -113, maxZ: 259 }, 32);
  const big = blocksOver({ minX: -251, maxX: 245, minZ: -251, maxZ: 259 }, 32);
  const key = (b) => `${b.bx},${b.bz}`;
  const bigSet = new Set(big.map(key));
  assert.ok(small.every((b) => bigSet.has(key(b))), '窗口变大,旧的块必须还在(同一块坐标)');
  assert.notEqual(blockHash(1, 2), blockHash(2, 1));
  assert.equal(blockHash(-7, 3, 5), blockHash(-7, 3, 5));
  assert.ok(latticeHash01(3, 4, 0, 9) >= 0 && latticeHash01(3, 4, 0, 9) < 1);
});

test('splitRng:前 n 发与原 rng 逐位同,之后换源,原 rng 只被吃 n 发', () => {
  const a = makeRng(42), ref = makeRng(42);
  const r = splitRng(a, 4, () => 0.5);
  const got = Array.from({ length: 6 }, r);
  const want = Array.from({ length: 4 }, ref);
  assert.deepEqual(got.slice(0, 4), want);
  assert.deepEqual(got.slice(4), [0.5, 0.5]);
  assert.equal(a(), ref(), '原 rng 之后的第一发必须与没拼接时相同');
});
