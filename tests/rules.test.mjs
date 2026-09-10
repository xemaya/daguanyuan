/**
 * 规则加载器与状态机。
 *
 * 这些断言守的是一条底线:知识库能说出**自己不知道什么**。
 * 每一条"应当抛错"的测试都是在防同一件事——推导器拿一个编出来的数往下算。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleBook } from '@builder/derive/rules.ts';
import { AmbiguousRuleError, MissingRuleError, RefutedRuleError } from '@builder/derive/errors.ts';

const mk = (rules, opts) => RuleBook.fromRules(rules, 'fashi', opts);

test('ok 的规则直接可用,并记进 evidence', () => {
  const book = mk([
    {
      id: '01-05', name: '八等材尺寸表', status: 'ok', statement: '', paramSet: 'fashi',
      formula: 'table', table: [{ grade: 1, fenCun: 0.6 }], location: '卷四·材',
    },
  ]);
  assert.equal(book.table('01-05')[0].fenCun, 0.6);
  const p = book.provenance();
  assert.equal(p.evidence.length, 1);
  assert.equal(p.evidence[0].id, '01-05');
  assert.equal(p.evidence[0].location, '卷四·材');
  assert.equal(p.inference.length, 0);
  assert.equal(p.art.length, 0);
});

test('被驳倒的规则引用即抛,错误里带更正值与出处', () => {
  const book = mk([
    {
      id: '05-06', name: '递加个数', status: 'refuted', statement: '', paramSet: 'fashi',
      correction: '个 = 级数,总递加 = 个数 − 1', location: '营造法原·提栈',
    },
  ]);
  assert.throws(() => book.use('05-06'), (e) => {
    assert.ok(e instanceof RefutedRuleError, `应为 RefutedRuleError,实际 ${e.name}`);
    assert.equal(e.ruleId, '05-06');
    assert.match(e.message, /个 = 级数/);
    assert.match(e.message, /营造法原/);
    return true;
  });
});

test('存疑且有多口径时,不指定就抛;指定了记进 inference', () => {
  const rules = [
    {
      id: '01-09', name: '宋尺换算', status: 'contested', statement: '', paramSet: 'fashi',
      choices: [
        { key: 'chutu', value: 31.2, note: '出土宋尺下限' },
        { key: 'chen', value: 32.0, note: '陈明达,辽代' },
      ],
    },
  ];
  assert.throws(() => mk(rules).choice('01-09'), (e) => {
    assert.ok(e instanceof AmbiguousRuleError);
    assert.match(e.message, /chutu/);
    assert.match(e.message, /chen/);
    return true;
  });
  // 选了一个不存在的口径也要抛,而不是静默回落到第一个。
  assert.throws(() => mk(rules, { choices: { '01-09': 'nope' } }).choice('01-09'), AmbiguousRuleError);

  const book = mk(rules, { choices: { '01-09': 'chen' } });
  assert.equal(book.choice('01-09'), 32.0);
  assert.equal(book.provenance().inference[0].id, '01-09');
  assert.match(book.provenance().inference[0].note, /chen/);
  assert.equal(book.provenance().evidence.length, 0, '存疑项不得记进 evidence');
});

test('存疑但无多口径时,用更正值并记进 inference', () => {
  const book = mk([
    {
      id: '03-01', name: '柱径', status: 'contested', statement: '', paramSet: 'fashi',
      formula: 'D = 42', correction: '唐构实测约 29 分,允许覆盖',
    },
  ]);
  book.use('03-01');
  assert.equal(book.provenance().inference.length, 1);
  assert.match(book.provenance().inference[0].note, /唐构实测/);
});

test('欠定的规则不抛错,按 resolution 走并记进 art', () => {
  const book = mk([
    {
      id: '90-01', name: '竹丛数', status: 'underdetermined', statement: '', paramSet: 'fashi',
      resolution: { method: 'seeded_variant', note: '原文「千百竿」只约束量级,丛数取 12~20 的种子变体' },
    },
  ]);
  book.use('90-01');
  const p = book.provenance();
  assert.equal(p.art.length, 1);
  assert.equal(p.art[0].method, 'seeded_variant');
  assert.equal(p.evidence.length, 0, '欠定项不得记进 evidence——那会把艺术选择伪装成考据结论');
});

test('缺失的规则抛错并说明该查哪本书;显式覆盖则记进 art', () => {
  const rules = [
    {
      id: 'ZZ-01', name: '某条书里没有的规则', status: 'missing', statement: '', paramSet: 'fashi',
      whereToLook: { books: ['营造算例·大木'], keywords: ['檐柱高 斗口 反算'] },
    },
  ];
  assert.throws(() => mk(rules).use('ZZ-01'), (e) => {
    assert.ok(e instanceof MissingRuleError);
    assert.match(e.message, /营造算例/);
    assert.match(e.message, /檐柱高 斗口 反算/);
    return true;
  });
  const book = mk(rules, { overrides: { 'ZZ-01': 52.4 } });
  assert.equal(book.use('ZZ-01').value, 52.4);
  assert.equal(book.provenance().art[0].id, 'ZZ-01');
  assert.equal(book.provenance().art[0].method, 'override');
});

test('params 里没有的数取不到就抛,不回落到默认值', () => {
  const book = mk([
    { id: '03-13', name: '阑额尺寸', status: 'ok', statement: '', paramSet: 'fashi', formula: 'W=30; T=20' },
  ]);
  assert.throws(() => book.num('03-13', 'lanWFen'), (e) => {
    assert.ok(e instanceof MissingRuleError);
    assert.match(e.message, /params/);
    assert.match(e.message, /W=30/, '错误里要带上 formula,好知道该把哪个数结构化');
    return true;
  });
});

test('缺口条目 paramSet 为 none,但每套参数集都要能看见它', () => {
  const rules = [
    {
      id: '99-02', name: '由规模反算斗口的正向链', status: 'missing', statement: '', paramSet: 'none',
      whereToLook: { books: ['《营造算例》第一章大木'], keywords: ['檐柱高 斗口 反算'] },
    },
  ];
  for (const ps of ['fashi', 'qing', 'fayuan']) {
    assert.throws(() => RuleBook.fromRules(rules, ps).use('99-02'), (e) => {
      assert.ok(e instanceof MissingRuleError);
      assert.match(e.message, /营造算例/, `${ps} 参数集应看得见缺口条目并带出 whereToLook`);
      return true;
    });
  }
});

test('按 paramSet 取数,不按文件名:both 的条目两边都收', () => {
  const rules = [
    { id: 'A', name: 'a', status: 'ok', statement: '', paramSet: 'qing' },
    { id: 'B', name: 'b', status: 'ok', statement: '', paramSet: 'both' },
    { id: 'C', name: 'c', status: 'ok', statement: '', paramSet: 'fayuan' },
  ];
  assert.deepEqual(RuleBook.fromRules(rules, 'qing').ids().sort(), ['A', 'B']);
  assert.deepEqual(RuleBook.fromRules(rules, 'fayuan').ids().sort(), ['B', 'C']);
});

test('真规则表能加载,fashi 参数集拿得到八等材表', () => {
  const book = RuleBook.create('fashi');
  const t = book.table('01-05');
  assert.equal(t.length, 8);
  assert.equal(t[0].fenCun, 0.6);
  assert.equal(t[7].fenCun, 0.3);
});

test('真规则表里 01-09 尺长是多口径的,不选就抛', () => {
  assert.throws(() => RuleBook.create('fashi').choice('01-09'), AmbiguousRuleError);
});

test('规则号只在规则集内唯一:重号必须限定,不许后来者悄悄盖住前面的', () => {
  const rules = [
    { id: '06-01', set: 'fashi', name: '界深与提栈起算', status: 'ok', statement: '', paramSet: 'fashi', location: '营造法原' },
    { id: '06-01', set: 'fayuan', name: '清式屋顶形制等级序列', status: 'refuted', statement: '', paramSet: 'both' },
  ];
  const book = RuleBook.fromRules(rules, 'fashi');
  assert.throws(() => book.use('06-01'), (e) => {
    assert.ok(e instanceof AmbiguousRuleError);
    assert.match(e.message, /fashi:06-01/);
    assert.match(e.message, /fayuan:06-01/);
    return true;
  });
  // 限定之后各取各的:一条通过、一条驳倒,不会互相污染。
  assert.equal(book.use('fashi:06-01').name, '界深与提栈起算');
  assert.throws(() => book.use('fayuan:06-01'), RefutedRuleError);
});

test('真规则表里 fashi 参数集的重号被检出,而不是静默覆盖', () => {
  const c = RuleBook.create('fashi').collisions();
  // 06-01 与 06-07 都是 fashi 的《营造法原》对照章与 fayuan 的清式瓦作撞号。
  assert.ok(Object.keys(c).length >= 2, `应检出重号,实际 ${JSON.stringify(c)}`);
  assert.ok(c['06-01'], '06-01 应在重号里');
});
