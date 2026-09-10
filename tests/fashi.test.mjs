/**
 * 法式推导链的手算断言。
 *
 * 数值全部对着实测建筑或原文 worked example,不是对着代码当前的输出。
 * 最后一条是突变测试:改坏 JSON 里的数,这里必须红——那是"规则表真的在驱动
 * 代码"的唯一证据。没有它,规则表随时可能退化成一份没人读的文档。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCai, grades, pickGrade, subordinateGrade } from '@builder/derive/fashi/cai.ts';
import { derivePuzuo } from '@builder/derive/fashi/puzuo.ts';
import { deriveZhu } from '@builder/derive/fashi/zhu.ts';
import { deriveJuzhe, raiseRatio, raiseRatioRange } from '@builder/derive/fashi/juzhe.ts';
import { deriveYanchu } from '@builder/derive/fashi/yanchu.ts';
import { deriveBuilding, deriveWithBook } from '@builder/derive/index.ts';
import { RuleBook } from '@builder/derive/rules.ts';
import { eraOptions } from '@builder/derive/profiles.ts';
import { AmbiguousRuleError } from '@builder/derive/errors.ts';

const within = (actual, expected, pct, label) => {
  const err = Math.abs(actual - expected) / expected;
  assert.ok(err <= pct, `${label}: ${actual.toFixed(4)} vs ${expected} (${(err * 100).toFixed(1)}% > ${pct * 100}%)`);
};

const song = (extra) => RuleBook.create('fashi', eraOptions('song', extra));
const tang = (extra) => RuleBook.create('fashi', eraOptions('tang', extra));

test('八等材分值自洽:广/15 = 厚/10 = 每分寸数 [01-05][01-06]', () => {
  const book = song();
  for (const r of grades(book)) {
    within(r.guangCun / 15, r.fenCun, 1e-9, `grade ${r.grade} 广`);
    within(r.houCun / 10, r.fenCun, 1e-9, `grade ${r.grade} 厚`);
  }
});

test('晋祠圣母殿殿身四等材 7.2 寸 → 分值 ≈ 1.48cm(@30.9 尺)', () => {
  const c = makeCai(song(), { grade: 4, chiCm: 30.9 });
  within(c.fenCm, 1.48, 0.02, '分值');
  within(c.guangCm, 22.2, 0.02, '材广');
});

test('佛光寺东大殿超一等材:自定义分值 2cm → 材 30×20cm、足材 42cm', () => {
  const c = makeCai(song(), { fenCm: 2 });
  assert.equal(c.guangCm, 30);
  assert.equal(c.houCm, 20);
  assert.equal(c.zuCaiCm, 42);
});

test('材等选择给出区间而非定值 [01-08 存疑]', () => {
  const book = song();
  const r = pickGrade(book, '殿身', 7);
  assert.equal(r.grade, 2);
  assert.deepEqual(r.range, [1, 4]);
  // 存疑条目必须落进 inference,不能冒充证据。
  assert.ok(book.provenance().inference.some((e) => e.id === '01-08'));
});

test('副阶降一等、廊屋降二等 [01-07]', () => {
  const book = song();
  assert.equal(subordinateGrade(book, 3, '副阶'), 4);
  assert.equal(subordinateGrade(book, 3, '廊屋'), 5);
});

test('铺作 P=T+3,总高 33+21T [02-02][02-29]:佛光寺七铺作 ≈ 120 分(实测 252cm/2.1cm)', () => {
  const p = derivePuzuo(tang(), { puzuo: 7, jumpFen: 25, angDropFen: 0 });
  assert.equal(p.T, 4);
  within(p.heightFen, 120, 0.05, '铺作高');
  // 唐辽跳距 25 分:总出跳 ≈ 96 分,落在实测 93~101 内 [02-05 乙注]。
  within(p.outFen, 97, 0.05, '出跳总长');
});

test('法式标准跳距 30 分,七铺作第二跳减四分 → 116 分 [02-03][02-04]', () => {
  const p = derivePuzuo(song(), { puzuo: 7, angDropFen: 0 });
  assert.equal(p.outFen, 116);
  assert.deepEqual(p.jumpsFen, [30, 26, 30, 30]);
});

test('补间朵数是存疑多口径 [02-25]:法式心间 2 朵、唐辽每间 1 朵,不选就抛', () => {
  assert.equal(derivePuzuo(song(), { puzuo: 5 }).bujianDuo.center, 2);
  assert.equal(derivePuzuo(tang(), { puzuo: 5 }).bujianDuo.center, 1);
  const bare = RuleBook.create('fashi');
  assert.throws(() => derivePuzuo(bare, { puzuo: 5 }), AmbiguousRuleError);
});

test('柱:厅堂径 36 分、阑额 30×20、础方 2D、生起当心 0 角最大 [03-01][03-13][03-21][03-04]', () => {
  const book = song();
  const z = deriveZhu(book, { hall: '厅堂', bayWidthsFen: [200, 250, 200], fenCun: 0.44 });
  assert.equal(z.columnDiameterFen, 36);
  assert.deepEqual(z.lan, { w: 30, t: 20 });
  assert.equal(z.baseFen, 72);
  assert.equal(z.riseFen[2], 0);
  // 三间生起 (3−1)×1 寸 = 2 寸 / 0.44 寸每分 ≈ 4.5 分。
  within(z.riseFen[0], 2 / 0.44, 1e-6, '角柱生起');
  assert.equal(z.riseFen[1], 0, '三间只有角柱与平柱,平柱为 0');
  const z5 = deriveZhu(book, { hall: '厅堂', bayWidthsFen: [200, 220, 250, 220, 200], fenCun: 0.44 });
  assert.ok(z5.riseFen[1] > 0 && z5.riseFen[1] < z5.riseFen[0], '五间次角柱生起介于平柱与角柱之间');
  assert.ok(z.columnHeightFen <= 250, '檐柱高不越当心间广 [03-24]');
});

test('檐柱高未指定时贴着"不越间广"的上界走,并记进 art [03-24]', () => {
  const book = song();
  const z = deriveZhu(book, { hall: '厅堂', bayWidthsFen: [200, 250, 200], fenCun: 0.44 });
  assert.equal(z.columnHeightFen, 250);
  const art = book.provenance().art.find((e) => e.id === '03-24');
  assert.ok(art, '取上界是我们的决定,必须留痕');
  assert.match(art.note, /上界/);
});

test('佛光寺:檐柱高 ≈ 252 分,柱径实物 29 分可覆盖,唐构无侧脚 [03-24 乙注][03-01 乙注][03-08 乙注]', () => {
  const z = deriveZhu(tang(), {
    hall: '殿阁',
    bayWidthsFen: [220, 252, 252, 252, 252, 252, 220],
    columnHeightFen: 252,
    columnDiameterFen: 29,
    cornerRiseCun: 0,
    fenCun: 0.64,
    cejiao: false,
  });
  assert.equal(z.columnHeightFen, 252);
  assert.equal(z.cejiaoFront, 0);
  assert.equal(z.riseFen[0], 0);
});

test('折屋之法 worked example [04-08][04-10]:殿阁 8 椽 L=60 尺 → 20/13.000/7.667/3.333/0', () => {
  const j = deriveJuzhe(song(), { spanL: 60, halfRafters: 4, cls: '殿阁' });
  const ys = j.purlins.map((p) => p.y);
  within(ys[0], 20, 1e-6, '脊槫');
  within(ys[1], 13.0, 1e-3, '上平槫');
  within(ys[2], 7.667, 1e-3, '中平槫');
  within(ys[3], 3.333, 1e-3, '下平槫');
  assert.equal(ys[4], 0);
  for (let i = 1; i < j.slopes.length; i++) assert.ok(j.slopes[i] < j.slopes[i - 1], '逐架变缓');
});

test('举高比是时代口径 [04-03]:法式 L/3;唐构给的是区间,不许替调用方取中值', () => {
  within(raiseRatio(song(), '殿阁'), 1 / 3, 1e-9, '法式殿阁');
  // 唐档是实测区间,单值取不到——取中值没有出处,所以宁可抛。
  assert.throws(() => raiseRatio(tang(), '殿阁'), AmbiguousRuleError);
  const [lo, hi] = raiseRatioRange(tang(), '殿阁');
  const foguang = 4851 / 21548; // 佛光寺实测举高/前后橑檐枋距
  assert.ok(lo <= foguang && foguang <= hi, `佛光寺实测 ${foguang.toFixed(4)} 应落在唐档区间 [${lo}, ${hi}]`);
  within(deriveJuzhe(tang(), { spanL: 21548, ratio: foguang, halfRafters: 4 }).H, 4851, 1e-9, '佛光寺举高 mm');
});

test('檐出 [05-04][05-05]:椽径 3 寸→35 寸,飞子 0.6 → 总 56 寸;三间生出 5 寸 [05-08]', () => {
  const book = song();
  // 三等材 0.5 寸/分:椽径 6 分 = 3 寸。
  const y = deriveYanchu(book, { rafterDiaFen: 6, fenCun: 0.5, bays: 3 });
  within(y.chuanFen * 0.5, 35, 1e-9, '椽头出寸');
  within(y.totalFen * 0.5, 56, 1e-9, '总檐出寸');
  within(y.shengchuFen * 0.5, 5, 1e-9, '生出寸');
  // 椽径 10 分 = 5 寸 → 35 + (5+10)/2 = 42.5 寸(区间中值,记进 art)。
  within(deriveYanchu(book, { rafterDiaFen: 10, fenCun: 0.5, bays: 5 }).chuanFen * 0.5, 42.5, 1e-9, '上档');
});

test('推导器:六等材小三间厅堂,数值在合理量级', () => {
  const fr = deriveBuilding({
    cai: { grade: 6 },
    hall: '厅堂',
    bayWidthsFen: [220, 260, 220],
    rafters: 4,
    puzuo: { puzuo: 4 },
    roofType: '歇山',
  });
  const m = fr.m;
  // 六等材 1 分 = 0.4 寸 × 3.12 cm/寸 = 1.248cm → 面阔 700 分 ≈ 8.74m。
  within(m.width, 8.74, 0.02, '面阔');
  assert.ok(m.columnH > 2.2 && m.columnH < 3.6, `柱高 ${m.columnH}`);
  assert.ok(m.ridgeY > m.eaveY, '脊高于檐');
  assert.equal(m.purlins[0].x, 0);
  within(m.purlins[m.purlins.length - 1].x, m.eaveHalf, 1e-9, '橑檐枋位置');
  assert.ok(m.yanchu > 0.8 && m.yanchu < 1.8, `檐出 ${m.yanchu}`);
});

test('每栋屋都带回三支出处,且证据与艺术分得开', () => {
  const fr = deriveBuilding({
    cai: { grade: 6 },
    hall: '厅堂',
    bayWidthsFen: [220, 260, 220],
    rafters: 4,
    puzuo: { puzuo: 4 },
    roofType: '歇山',
  });
  const p = fr.provenance;
  assert.ok(p.evidence.length > 5, `证据 ${p.evidence.length} 条`);
  assert.ok(p.inference.some((e) => e.id === '01-09'), '尺长口径是推定,不是证据');
  assert.ok(p.art.length > 0, '区间取点必须留痕');
  const ids = new Set([...p.evidence, ...p.inference].map((e) => e.id));
  for (const e of p.evidence) {
    assert.ok(e.location, `证据 ${e.id} 必须有出处`);
  }
  assert.ok(!p.evidence.some((e) => p.inference.some((i) => i.id === e.id)), '同一条不能既是证据又是推定');
  assert.ok(ids.has('01-05'), '八等材表应在链上');
});

test('突变测试:改坏规则表里的数,手算断言立刻红', () => {
  const all = RuleBook.allRules();
  // 注意用 set 限定:01-05 在 fashi 与 qing 两个规则集里都有,是两条完全不同的规则。
  const bent = all.map((r) =>
    r.set === 'fashi' && r.id === '01-05'
      ? { ...r, table: r.table.map((row) => ({ ...row, fenCun: row.fenCun * 2 })) }
      : r,
  );
  const spec = { cai: { grade: 6 }, hall: '厅堂', bayWidthsFen: [220, 260, 220], rafters: 4, puzuo: { puzuo: 4 }, roofType: '歇山' };
  const good = deriveBuilding(spec);
  const bad = deriveWithBook(RuleBook.fromRules(bent, 'fashi', eraOptions('song')), spec);
  within(bad.m.width, good.m.width * 2, 1e-9, '篡改八等材表应当直接改变面阔');
  assert.notEqual(good.m.width, bad.m.width, '规则表没有在驱动代码');
});

test('尺长是存疑多口径,不选口径就抛 [01-09]', () => {
  assert.throws(() => makeCai(RuleBook.create('fashi'), { grade: 6 }), AmbiguousRuleError);
});
