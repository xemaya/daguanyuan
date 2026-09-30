// 单子 BH1:植被树皮 / 叶片的烘焙参数只许有一份(texture-jobs.ts 的 BARK_SETS / LEAF_SETS)。
// recipeKey 不含颜色——vegetation.ts 若在别处手写一组参数,worker 预热的图会顶着同一个 key 被当成缓存命中,
// 树悄悄换色而没有门会红。这里扫源码:vegetation.ts 里每一处 barkSet( / leafMaps( 都必须是展开那两张表。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BARK_SETS, LEAF_SETS, TEXTURE_JOBS } from '../builder/compose/texture-jobs.ts';

const src = readFileSync(new URL('../builder/parts/zhiwu/vegetation.ts', import.meta.url), 'utf8');

test('vegetation.ts 的 barkSet / leafMaps 调用只展开 BARK_SETS / LEAF_SETS', () => {
  const calls = [...src.matchAll(/\b(barkSet|leafMaps)\(([^)]*)\)/g)].filter((m) => !/^\s*$/.test(m[2]) && !m[0].includes('typeof'));
  assert.ok(calls.length >= 7, `只找到 ${calls.length} 处调用`);
  for (const [whole, fn, args] of calls) {
    const table = fn === 'barkSet' ? 'BARK_SETS' : 'LEAF_SETS';
    assert.match(args.trim(), new RegExp(`^\\.\\.\\.${table}\\.\\w+$`), `手写参数:${whole}`);
  }
});

test('foliage 在预热 job 里,两张表的套数没变', () => {
  assert.ok(TEXTURE_JOBS.includes('foliage'));
  assert.deepEqual(Object.keys(BARK_SETS), ['oak', 'ash', 'pale']);
  assert.deepEqual(Object.keys(LEAF_SETS), ['warm', 'cool', 'needle', 'apricot']);
});
