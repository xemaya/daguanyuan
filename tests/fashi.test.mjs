import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCai, GRADES, pickGrade } from '../src/fashi/cai.ts';
import { derivePuzuo } from '../src/fashi/puzuo.ts';

const within = (actual, expected, pct, label) => {
  const err = Math.abs(actual - expected) / expected;
  assert.ok(err <= pct, `${label}: ${actual.toFixed(2)} vs ${expected} (${(err * 100).toFixed(1)}% > ${pct * 100}%)`);
};

test('八等材分值自洽:广/15 = 厚/10 = 每分寸数 [01-06]', () => {
  for (const g of Object.keys(GRADES)) {
    const r = GRADES[g];
    within(r.guangCun / 15, r.fenCun, 1e-9, `grade ${g} 广`);
    within(r.houCun / 10, r.fenCun, 1e-9, `grade ${g} 厚`);
  }
});

test('晋祠圣母殿殿身四等材 7.2 寸 → 分值 ≈ 1.48cm(@30.9 尺)', () => {
  const c = makeCai({ grade: 4, chiCm: 30.9 });
  within(c.fenCm, 1.48, 0.02, '分值');
  within(c.guangCm, 22.2, 0.02, '材广');
});

test('佛光寺东大殿超一等材:自定义分值 2cm → 材 30×20cm、足材 42cm', () => {
  const c = makeCai({ fenCm: 2 });
  assert.equal(c.guangCm, 30);
  assert.equal(c.houCm, 20);
  assert.equal(c.zuCaiCm, 42);
});

test('材等选择给出区间而非定值 [01-08 存疑]', () => {
  const r = pickGrade('殿身', 7);
  assert.equal(r.grade, 2);
  assert.deepEqual(r.range, [1, 4]);
});

test('铺作 P=T+3,总高 33+21T [02-02][02-29]:佛光寺七铺作 ≈ 120 分(实测 252cm/2.1cm)', () => {
  const p = derivePuzuo({ puzuo: 7, jumpFen: 25, angDropFen: 0 });
  assert.equal(p.T, 4);
  within(p.heightFen, 120, 0.05, '铺作高');
  // 唐辽跳距 25 分:总出跳 ≈ 96 分,落在实测 93~101 内 [02-05 乙注]。
  within(p.outFen, 97, 0.05, '出跳总长');
});

test('法式标准跳距 30 分,七铺作第二跳减四分 → 116 分 [02-04][02-05]', () => {
  const p = derivePuzuo({ puzuo: 7 });
  assert.equal(p.outFen, 116);
  assert.deepEqual(p.jumpsFen, [30, 26, 30, 30]);
});

import { deriveZhu } from '../src/fashi/zhu.ts';

test('柱:厅堂径 36 分、阑额 30×20、础方 2D、生起当心 0 角最大 [03-01][03-13][03-21][03-04]', () => {
  const z = deriveZhu({ hall: '厅堂', bayWidthsFen: [200, 250, 200], fenCun: 0.44 });
  assert.equal(z.columnDiameterFen, 36);
  assert.deepEqual(z.lan, { w: 30, t: 20 });
  assert.equal(z.baseFen, 72);
  assert.equal(z.riseFen[2], 0);
  // 三间生起 2 寸 / 0.44 寸每分 ≈ 4.5 分。
  within(z.riseFen[0], 2 / 0.44, 1e-6, '角柱生起');
  // 三间只有角柱与平柱:平柱(当心间两柱)为 0。
  assert.equal(z.riseFen[1], 0);
  const z5 = deriveZhu({ hall: '厅堂', bayWidthsFen: [200, 220, 250, 220, 200], fenCun: 0.44 });
  assert.ok(z5.riseFen[1] > 0 && z5.riseFen[1] < z5.riseFen[0], '五间次角柱生起介于平柱与角柱之间');
  assert.ok(z.columnHeightFen <= 250);
});

test('佛光寺:檐柱高 ≈ 252 分,柱径实物 29 分可覆盖,唐构无侧脚 [03-24 乙注][03-01 乙注][03-08 乙注]', () => {
  const z = deriveZhu({ hall: '殿阁', bayWidthsFen: [220, 252, 252, 252, 252, 252, 220], columnHeightFen: 252, columnDiameterFen: 29, cornerRiseCun: 0, fenCun: 0.64, cejiao: false });
  assert.equal(z.columnHeightFen, 252);
  assert.equal(z.cejiaoFront, 0);
  assert.equal(z.riseFen[0], 0);
});

import { deriveJuzhe, raiseRatio } from '../src/fashi/juzhe.ts';

test('折屋之法 worked example [04-10]:殿阁 8 椽 L=60 尺 → 20/13.000/7.667/3.333/0', () => {
  const j = deriveJuzhe({ spanL: 60, halfRafters: 4, cls: '殿阁' });
  const ys = j.purlins.map((p) => p.y);
  within(ys[0], 20, 1e-9, '脊槫');
  within(ys[1], 13.0, 1e-3, '上平槫');
  within(ys[2], 7.667, 1e-3, '中平槫');
  within(ys[3], 3.333, 1e-3, '下平槫');
  assert.equal(ys[4], 0);
  // 坡度自脊向檐递减(凹曲面)。
  for (let i = 1; i < j.slopes.length; i++) assert.ok(j.slopes[i] < j.slopes[i - 1], '逐架变缓');
});

test('举高比时代性 [04-03 乙注]:保国寺 ≈ 0.33,佛光寺 ≈ 0.225', () => {
  within(raiseRatio('殿阁', 'fashi'), 0.3315, 0.01, '保国寺');
  within(raiseRatio('殿阁', 'tang'), 0.225, 0.01, '佛光寺');
  within(deriveJuzhe({ spanL: 21548, era: 'tang', halfRafters: 4 }).H, 4851, 0.01, '佛光寺举高 mm');
});

import { deriveBuilding } from '../src/fashi/derive.ts';

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
  // 六等材 1 分 = 0.4 寸 = 1.248cm → 面阔 700 分 ≈ 8.7m。
  within(m.width, 8.74, 0.02, '面阔');
  assert.ok(m.columnH > 2.2 && m.columnH < 3.3, `柱高 ${m.columnH}`);
  assert.ok(m.ridgeY > m.eaveY, '脊高于檐');
  assert.equal(m.purlins[0].x, 0);
  within(m.purlins[m.purlins.length - 1].x, m.eaveHalf, 1e-9, '橑檐枋位置');
  assert.ok(m.yanchu > 0.8 && m.yanchu < 1.8, `檐出 ${m.yanchu}`);
});

import { deriveYanchu } from '../src/fashi/yanchu.ts';

test('檐出 [05-04][05-05]:椽径 3 寸→35 寸,飞子 0.6 → 总 56 寸;三间生出 5 寸 [05-08]', () => {
  // 三等材 0.5 寸/分:椽径 6 分 = 3 寸。
  const y = deriveYanchu({ rafterDiaFen: 6, fenCun: 0.5, bays: 3 });
  within(y.chuanFen * 0.5, 35, 1e-9, '椽头出寸');
  within(y.totalFen * 0.5, 56, 1e-9, '总檐出寸');
  within(y.shengchuFen * 0.5, 5, 1e-9, '生出寸');
  // 椽径 10 分 = 5 寸 → 42.5 寸(40~45 中值)。
  within(deriveYanchu({ rafterDiaFen: 10, fenCun: 0.5, bays: 5 }).chuanFen * 0.5, 42.5, 1e-9, '上档');
});
