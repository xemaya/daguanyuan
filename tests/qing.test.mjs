import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleBook } from '@builder/derive/rules.ts';
import { MissingRuleError, RefutedRuleError } from '@builder/derive/errors.ts';
import { deriveQing } from '@builder/derive/qing/index.ts';
import { qingOptions } from '@builder/derive/qing/profiles.ts';

const within = (a, e, pct, label) => {
  const err = Math.abs(a - e) / e;
  assert.ok(err <= pct, `${label}: ${a.toFixed(2)} vs ${e} (${(err * 100).toFixed(1)}% > ${pct * 100}%)`);
};

test('斗口十一等表：一等 6.0 寸，逐等减 0.5 [qing 01-01]', () => {
  const book = RuleBook.create('qing');
  // qing 参数集 collisions() 为空,裸 id 即可。
  const t = book.table('01-01');
  assert.equal(t[0].doukouCun, 6.0);
  assert.equal(t[1].doukouCun, 5.5);
  assert.equal(t.length, 11);
});

test('由柱高反算斗口是缺失规则，必须抛错并说明该查哪本书 [missing 99-02]', () => {
  const book = RuleBook.create('qing');
  assert.throws(
    () => deriveQing(book, { tier: 'A', columnHeightM: 3.67, bays: 5, rafters: 6, roofType: '歇山' }),
    (e) => {
      assert.ok(e instanceof MissingRuleError, `应抛 MissingRuleError，实际 ${e.name}`);
      assert.match(e.message, /斗口|反算/);
      return true;
    },
  );
});

test('显式给了斗口就能推下去：长春宫，斗口 70mm', () => {
  // 带 choices 的规则不选就抛,跟状态无关(更正①)。推导链上有 02-05(举架系数两档)
  // 与 03-09(冲三两套口径)两条,照 profiles.ts 的形状用预设一次选完。
  // 步架长 02-02 已驳倒,必须由调用方给(不给会走 missing 99-03 抛错)。
  const book = RuleBook.create('qing', qingOptions());
  const fr = deriveQing(book, {
    tier: 'A', doukouMm: 70, bays: 5, rafters: 6, roofType: '歇山',
    bayWidthsM: [6.34, 4.60, 3.60], puzuo: { cai: 7 },
    stepsM: [1.20, 1.10, 1.10],
  });
  // 故宫院刊精测:檐柱净高 3.67 m。规则档 56.8 斗口 → 3.976 m,偏 +8.3%,在 10% 内。
  within(fr.m.columnH, 3.67, 0.10, '檐柱净高');
});

test('被 tiers.md 禁用的规则引用即抛 [qing 01-05 攒数推面阔]', () => {
  const book = RuleBook.create('qing');
  assert.throws(() => book.use('01-05'), RefutedRuleError);
});

test('举架逐步累加，坡度自下而上变陡（与宋式举折自上而下相反）', () => {
  const book = RuleBook.create('qing', qingOptions());
  const fr = deriveQing(book, {
    tier: 'A', doukouMm: 70, bays: 5, rafters: 6, roofType: '歇山',
    bayWidthsM: [6.34, 4.60, 3.60], puzuo: { cai: 7 },
    stepsM: [1.20, 1.10, 1.10],
  });
  const s = fr.m.purlins;
  for (let i = 1; i < s.length - 1; i++) {
    const k0 = (s[i - 1].y - s[i].y) / (s[i].x - s[i - 1].x);
    const k1 = (s[i].y - s[i + 1].y) / (s[i + 1].x - s[i].x);
    assert.ok(k0 > k1, `第 ${i} 架应比外一架陡：${k0.toFixed(3)} vs ${k1.toFixed(3)}`);
  }
});
