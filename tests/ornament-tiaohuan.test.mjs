import test from 'node:test';
import assert from 'node:assert/strict';
import { XIFANCAO_SEEDS } from '../builder/parts/ornament/pattern2d.ts';
import {
  makeScrollBand, bandHeight, XIFANCAO_LEVELS,
} from '../builder/parts/ornament/relief.ts';
import {
  tiaohuanCells, tiaohuanBand, tiaohuanAtlasBand, tiaohuanTriangleCount,
  buildTiaohuanPlane, TIAOHUAN_LEVELS, TIAOHUAN_BAND_H, TIAOHUAN_CELL_W,
  TIAOHUAN_ASPECT, TIAOHUAN_ATLAS_CELLS,
} from '../builder/parts/ornament/tiaohuan-band.ts';

/* 全园格扇的真实净宽(= makeGeshan 的 w − 外框 2×3.5cm),2026-09-15 实测五种
 * (36 扇格扇的 w 只有 0.541/0.596/0.607/0.694/0.844 五个值)。测试与 building.ts
 * 用同一组数:哪天开间改了、这里的断言跟着动,不是重新调阈值。 */
const NET_WIDTHS = [0.471, 0.526, 0.537, 0.624, 0.774];

test('带长不整除单元长就抛错——半个单元的接缝读得出来,不许静默取整', () => {
  assert.throws(
    () => makeScrollBand(0.53, TIAOHUAN_BAND_H, 0.17, XIFANCAO_SEEDS, TIAOHUAN_LEVELS, 0),
    /不是单元长/,
    '0.53m 不是 0.17m 的整数倍,应该抛错',
  );
  // 本单自己求整出来的单元长永远整除——这一条是防回归,不是防用户。
  for (const L of NET_WIDTHS) {
    const band = tiaohuanBand(L);
    const n = tiaohuanCells(L);
    assert.equal(band.cells.length, n);
    assert.ok(Math.abs(n * band.cellW - L) < 1e-9, `${L}m 求整后没整除`);
  }
});

test('求整后的单元长落在 15~20cm——绦环板上一格卷草的尺度', () => {
  for (const L of NET_WIDTHS) {
    const w = L / tiaohuanCells(L);
    assert.ok(w >= 0.15 && w <= 0.2, `净宽 ${L}m 求出的单元长 ${w.toFixed(4)}m 越界`);
  }
});

test('几何版一扇 ≤ 8k 三角——6mm 步长是「按角色分档」能成立的前提', () => {
  for (const L of NET_WIDTHS) {
    const tris = tiaohuanTriangleCount(L);
    assert.ok(tris <= 8000, `净宽 ${L}m 的几何版 ${tris} 三角,超过一扇 8k 的上限`);
  }
});

test('叶面抬到 3.5mm,其余档位一格不动——台矶样件的判据不能被本单改掉', () => {
  assert.equal(TIAOHUAN_LEVELS.leafH, 0.0035);
  for (const k of ['spineH', 'veinDepth', 'veinHalfW', 'edgeSoft']) {
    assert.equal(TIAOHUAN_LEVELS[k], XIFANCAO_LEVELS[k], `${k} 被本单动了`);
  }
  // 主次不倒:叶面仍低于主藤。
  assert.ok(TIAOHUAN_LEVELS.leafH < TIAOHUAN_LEVELS.spineH);
});

test('全园共用一份四格图集:一条带、四个种子、比例锁在标称值', () => {
  const atlas = tiaohuanAtlasBand();
  assert.equal(atlas.cells.length, TIAOHUAN_ATLAS_CELLS, '图集格数应等于种子数');
  assert.deepEqual(atlas.seeds, XIFANCAO_SEEDS, '四个种子各占图集一格');
  assert.equal(atlas.cellW, TIAOHUAN_CELL_W);
  assert.equal(atlas.aspect, TIAOHUAN_ASPECT);
  assert.ok(atlas.cyclic, '图集必须首尾相接,否则每四格一道竖缝');
  // 各扇的带与图集共用同一个纹样比例——两版 pixel diff 量的才是表示方式本身。
  for (const L of NET_WIDTHS) assert.equal(tiaohuanBand(L).aspect, TIAOHUAN_ASPECT);
});

test('贴图版的 uv 只取图集里连续的 n 格——一张图铺全园靠的是偏移,不是每扇一张', () => {
  for (const L of NET_WIDTHS) {
    const band = tiaohuanBand(L);
    const n = band.cells.length;
    for (const rot of [0, 1, 2, 3, 7]) {
      const geo = buildTiaohuanPlane(band, rot);
      assert.equal(geo.attributes.position.count, 4, '贴图版必须是一块面片(两个三角)');
      const uv1 = geo.attributes.uv1;
      assert.ok(uv1, 'aoMap 走第二套 uv,面片必须带 uv1');
      const us = [];
      for (let i = 0; i < uv1.count; i++) us.push(uv1.getX(i));
      const u0 = Math.min(...us);
      const u1 = Math.max(...us);
      assert.ok(Math.abs(u0 - (rot % 4) / 4) < 1e-9, `rot=${rot} 的起点应落在图集第 ${rot % 4} 格`);
      assert.ok(Math.abs((u1 - u0) - n / TIAOHUAN_ATLAS_CELLS) < 1e-9, `跨度应是 ${n}/4 张图集`);
      // 第一套 uv 留给木纹(面片 0..1),没被图集偏移污染。
      const uv = geo.attributes.uv;
      const base = [];
      for (let i = 0; i < uv.count; i++) base.push(uv.getX(i));
      assert.equal(Math.min(...base), 0);
      assert.equal(Math.max(...base), 1);
    }
  }
});

test('首尾相接:图集按 uv 铺过去,接缝不比格与格之间更差', () => {
  const atlas = tiaohuanAtlasBand();
  const L = atlas.lengthM;
  const d = 0.0005;
  // ① 环起来之后 h 以 L 为周期——这是"一张图重复铺"在数学上成立的条件。
  for (let i = 0; i < 37; i++) {
    const x = (i / 37) * L;
    for (const y of [-0.04, -0.005, 0, 0.005, 0.04]) {
      // 浮点:x+L 与 x 是两条不同的加法路径,同一格的局部坐标差 1e-16,
      // h 跟着差 1e-13。周期性是精确的,断言给的是浮点的余量,不是容差。
      const dh = Math.abs(bandHeight(atlas, x + L, y) - bandHeight(atlas, x, y));
      assert.ok(dh < 1e-9, `h 在 x=${x} 处不以带长为周期(差 ${dh})`);
    }
  }
  // ② 接缝处的落差不比格与格之间大。**不是断言"落差为 0"**:卷叶的边缘本来就
  //    在 2mm 里从 0 涨到 3.5mm,拿两个相距 1mm 的采样点去比,量到的是这个坡,
  //    不是台阶(2026-09-15 第一版判据就栽在这儿)。要证的是"最后一格接回第一格"
  //    与"第一格接第二格"一样平——一道规律重复的竖缝比单独一道更刺眼。
  const seamDrop = (xb) => {
    let worst = 0;
    for (let j = 1; j < 120; j++) {
      const y = (j / 120 - 0.5) * atlas.heightM;
      const a = bandHeight(atlas, (xb - d + L) % L, y);
      const b = bandHeight(atlas, (xb + d) % L, y);
      worst = Math.max(worst, Math.abs(a - b));
    }
    return worst;
  };
  const inner = Math.max(seamDrop(atlas.cellW), seamDrop(atlas.cellW * 2), seamDrop(atlas.cellW * 3));
  assert.ok(seamDrop(0) <= inner * 1.05, `环接缝 ${(seamDrop(0) * 1000).toFixed(3)}mm 比格间 ${(inner * 1000).toFixed(3)}mm 更陡`);
  // ③ 对照:不环起来的同一条带,x=0 处左邻缺席,落差立刻比格间大一截。
  const cut = makeScrollBand(L, atlas.heightM, atlas.cellW, XIFANCAO_SEEDS, TIAOHUAN_LEVELS, 0);
  let cutDrop = 0;
  for (let j = 1; j < 120; j++) {
    const y = (j / 120 - 0.5) * atlas.heightM;
    cutDrop = Math.max(cutDrop, Math.abs(bandHeight(cut, L - d, y) - bandHeight(cut, d, y)));
  }
  assert.ok(cutDrop > seamDrop(0), '环与不环量不出差别,说明 cyclic 根本没起作用');
});

test('h 在带的两长边为 0——浮雕落在板面上,不是浮着的一片', () => {
  const band = tiaohuanBand(0.526);
  for (let i = 0; i <= 60; i++) {
    const x = (i / 60) * band.lengthM;
    assert.equal(bandHeight(band, x, -band.heightM / 2), 0);
    assert.equal(bandHeight(band, x, band.heightM / 2), 0);
  }
});

test('非环形带的行为一格不变——台矶样件不能被本单的参数改掉', () => {
  const plain = makeScrollBand(1.8, 0.11, 0.18, XIFANCAO_SEEDS);
  assert.equal(plain.cyclic, false);
  assert.equal(plain.endFadeM, 0.05);
  assert.equal(plain.aspect, 0.18 / 0.11);
  // 两端在 endFade 里被压到 0:样件是一段,不是一圈。
  assert.equal(bandHeight(plain, 0, 0), 0);
  assert.equal(bandHeight(plain, 1.8, 0), 0);
});
