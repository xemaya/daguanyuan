/**
 * fayuan 参数集(《营造法原》界与提栈)。
 *
 * 这套是重号重灾区:开工先跑过 `RuleBook.create('fayuan').collisions()`,
 * 结果为空——fashi 的 06-01/06-07 是 paramSet: fashi,不进 fayuan 参数集;
 * 撞号发生在 fashi 那侧(fayuan 的 06-01/06-07 是 paramSet: both)。
 * 但 05-06 一律写限定形式 `fayuan:05-06`,不因当前无撞号就放松(PITFALLS P-16)。
 *
 * 口径实况:fayuan 参数集里没有任何规则带 choices,故无需 choices 选项;
 * 若日后规则表补了 choices,带 choices 的一律要选,跟状态无关(计划 Task 1 更正①)。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleBook } from '@builder/derive/rules.ts';
import { RefutedRuleError } from '@builder/derive/errors.ts';
import { deriveFayuan } from '@builder/derive/fayuan/index.ts';

const within = (a, e, pct, label) => {
  const err = Math.abs(a - e) / e;
  assert.ok(err <= pct, `${label}: ${a.toFixed(3)} vs ${e} (${(err * 100).toFixed(1)}% > ${pct * 100}%)`);
};

test('05-06 递加「个」的读法已被驳倒,引用即抛,错误里带正确读法', () => {
  const book = RuleBook.create('fayuan');
  assert.throws(() => book.use('fayuan:05-06'), (e) => {
    assert.ok(e instanceof RefutedRuleError, `应抛 RefutedRuleError,实际 ${e.name}`);
    // 正确读法:个 = 被点名的提栈级数,总递加 = 个数 − 1。照抄原读法会把屋面抬高一倍。
    assert.match(e.message, /个.*级数/);
    assert.match(e.message, /总递加.*个数/);
    return true;
  });
});

test('网师园月到风来亭:界深对边距 [fayuan 05-*],误差 10% 内', () => {
  const book = RuleBook.create('fayuan');
  const fr = deriveFayuan(book, {
    tier: 'C', shape: 'hexagon', sideM: 2.10, columnHeightM: 3.00, jieCount: 4, chiCm: 27.5,
  });
  // verify-suzhou.md A.1.2:对边距 = √3×边长,实测口径闭合 −1.0%。
  // 这里边长 2.10 → 对边距 3.637,对 verify 记录的 3.64 m 判 10%。
  within(fr.m.width, 3.64, 0.10, '对边距');
});

test('提栈逐界递加:脊界最陡,檐界最缓', () => {
  const book = RuleBook.create('fayuan');
  const fr = deriveFayuan(book, {
    tier: 'B', bayWidthsM: [3.2, 3.8, 3.2], jieDepthChi: 4.0, jieCount: 6,
    columnHeightM: 3.04, chiCm: 27.5,
  });
  const p = fr.m.purlins;
  const slope = (i) => (p[i - 1].y - p[i].y) / (p[i].x - p[i - 1].x);
  for (let i = 2; i < p.length; i++) {
    assert.ok(slope(i - 1) > slope(i), `第 ${i} 界应比外一界缓`);
  }
});

test('界深落在算例表之外时,插值方式必须显式声明,否则抛', () => {
  const book = RuleBook.create('fayuan');
  assert.throws(
    () => deriveFayuan(book, {
      tier: 'B', bayWidthsM: [3.2, 3.8, 3.2], jieDepthChi: 4.2, jieCount: 6,
      columnHeightM: 3.04, chiCm: 27.5,
    }),
    /插值|interpolat/i,
  );
  // 声明了就放行——书里只有四行算例,插值是我们加的,得留痕(进 provenance.art)。
  const fr = deriveFayuan(book, {
    tier: 'B', bayWidthsM: [3.2, 3.8, 3.2], jieDepthChi: 4.2, jieCount: 6,
    columnHeightM: 3.04, chiCm: 27.5, interpolate: 'linear',
  });
  assert.ok(fr.provenance.art.some((e) => e.id === '99-08'), '插值决策应记进 provenance.art 的 99-08');
});
