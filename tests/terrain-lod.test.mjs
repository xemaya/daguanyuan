import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTerrainChunks, lodTriangles, lodMaxError, TerrainLod, TERRAIN_LOD_HYSTERESIS } from '@engine/render/TerrainChunks.ts';

/* 单子 AX1:地形分档。起伏场故意不平——平面场上任何一档误差都是 0,什么也证明不了。
 * 缓坡上带一道 1.2 m 的陡坎(驳岸的样子):整块最大误差被它拉高,预算要只钉住它那几格。 */
const field = { height: (x, z) => .3 * Math.sin(x * .2) + .2 * Math.cos(z * .15) + .01 * x * z + 1.2 * Math.min(1, Math.max(0, (x - 5.3) / .6)) };
const bounds = { minX: -20, maxX: 21, minZ: 5, maxZ: 37 };
// 带预算的一份:误差超预算的粗格留在 L0,块里就同时有粗格、留细的格、以及两者之间的缝合扇。
const BUDGET = (step) => .03 * step;
const build = (lodBudget = BUDGET) => buildTerrainChunks(field, bounds, 16, { segX: 82, segZ: 64, lodSteps: [2, 4, 8], lodBudget });
const lattice = (mesh, v) => { const nx = mesh.userData.lattice.nx; return [v % (nx + 1), Math.floor(v / (nx + 1))]; };

test('粗档每个顶点的高度与 L0 同位置的格点逐位相同', () => {
  const chunks = build();
  const l0 = new Map();
  for (const m of chunks) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) l0.set(`${p.getX(i)},${p.getZ(i)}`, p.array[i * 3 + 1]);
  }
  let checked = 0;
  for (const m of chunks) for (const level of m.userData.lod.slice(1)) {
    const g = level.mesh.geometry, p = g.attributes.position, idx = g.index.array;
    // 共用同一份缓冲:粗档没有自己的顶点,"子集"是字面意义上的。
    assert.equal(p, m.geometry.attributes.position);
    assert.equal(g.attributes.normal, m.geometry.attributes.normal);
    for (const v of idx) {
      const key = `${p.getX(v)},${p.getZ(v)}`;
      assert.ok(Object.is(p.array[v * 3 + 1], l0.get(key)), `${level.mesh.name} 顶点 ${key} 与 L0 不逐位相同`);
      assert.ok(Object.is(Math.fround(field.height(p.getX(v), p.getZ(v))), p.array[v * 3 + 1]));
      checked++;
    }
  }
  assert.ok(checked > 1000);
});

test('缝合:每一档的块边都是 L0 的整条边折线,相邻块任取两档都不裂;块内留细的格与粗格之间也不裂', () => {
  for (const m of [...build(), ...build(() => Infinity)]) {
    const { nx, nz } = m.userData.lattice;
    const border = [];
    for (let i = 0; i < nx; i++) border.push([i, 0, i + 1, 0], [i, nz, i + 1, nz]);
    for (let j = 0; j < nz; j++) border.push([0, j, 0, j + 1], [nx, j, nx, j + 1]);
    for (const level of m.userData.lod) {
      const idx = level.mesh.geometry.index.array, edges = new Map();
      let area = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((v) => lattice(m, v));
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        assert.ok(cross < 0, `${level.mesh.name} 绕向与 L0 不一致或退化`);
        area -= cross / 2;
        for (const [p, q] of [[a, b], [b, c], [c, a]]) {
          const key = [p, q].map(String).sort().join('|');
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      // 面积闭合 + 绕向一致 = 不重叠、不留洞。块内每条内边恰好两个三角共用(没有 T 形接头)。
      for (const [key, n] of edges) {
        const [p, q] = key.split('|').map((s) => s.split(',').map(Number));
        const onBorder = (p[0] === q[0] && (p[0] === 0 || p[0] === nx)) || (p[1] === q[1] && (p[1] === 0 || p[1] === nz));
        assert.equal(n, onBorder ? 1 : 2, `${level.mesh.name} 边 ${key} 被 ${n} 个三角共用`);
      }
      assert.equal(area, nx * nz, `${level.mesh.name} 覆盖面积不等于整块`);
      // 块边上每一段 L0 小边都恰好是一条三角边——相邻块共享的就是这一条折线。
      for (const [i0, j0, i1, j1] of border) {
        const key = [[i0, j0], [i1, j1]].map(String).sort().join('|');
        assert.equal(edges.get(key), 1, `${level.mesh.name} 块边 ${key} 没有按 L0 缝上`);
      }
    }
  }
});

test('误差是逐格点量出来的:与暴力重算一致,平面场为零', () => {
  const chunks = build();
  let coarseSeen = 0;
  for (const m of chunks) {
    const lod = m.userData.lod;
    assert.equal(lod[0].maxError, 0);
    for (const level of lod.slice(1)) {
      coarseSeen++;
      assert.ok(level.maxError > 0, '起伏场上粗档误差不可能是 0');
      assert.equal(level.maxError, lodMaxError(m.geometry.attributes.position.array, m.userData.lattice.nx, [...level.mesh.geometry.index.array]));
    }
  }
  assert.ok(coarseSeen > 0);
  // 预算真的生效:每档量出来的误差不超预算,而且确实有格因为超预算留在了 L0(三角比纯粗档多)。
  let refinedSomewhere = false;
  const loose = build(() => Infinity);
  chunks.forEach((m, c) => m.userData.lod.slice(1).forEach((level) => {
    assert.ok(level.maxError <= BUDGET(level.step) + 1e-6, `${level.mesh.name} 误差 ${level.maxError} 超预算`);
    const same = loose[c].userData.lod.find((l) => l.step === level.step);
    if (same && level.triangles > same.triangles) refinedSomewhere = true;
  }));
  assert.ok(refinedSomewhere);
  const flat = buildTerrainChunks({ height: (x, z) => .3 * x - .2 * z }, bounds, 16, { segX: 82, segZ: 64, lodSteps: [2, 4, 8] });
  for (const m of flat) for (const level of m.userData.lod) assert.ok(level.maxError < 1e-4, `平面场 ${level.mesh.name} 误差 ${level.maxError}`);
});

test('块宽不足两个粗格的那一档不建,选档停在细一档', () => {
  assert.equal(lodTriangles([], 4, 20, 4), null);
  assert.ok(lodTriangles(new Float32Array(6 * 21 * 3), 5, 20, 4), "余下 1 格的窄粗格也算一列");
  const narrow = buildTerrainChunks(field, { minX: 0, maxX: 4, minZ: 0, maxZ: 40 }, 64, { segX: 8, segZ: 80, lodSteps: [2, 4, 8] });
  assert.deepEqual(narrow[0].userData.lod.map((l) => l.step), [1, 2, 4]);
});

test('选档:投影误差 < 1 px 的最粗一档;往粗切要越过 10% 滞回,往细切一到阈值就切', () => {
  const chunks = build();
  const lod = new TerrainLod(chunks);
  const cam = new THREE.PerspectiveCamera(62, 16 / 9, .06, 600);
  cam.updateProjectionMatrix();
  const H = 900, k = (H / 2) * cam.projectionMatrix.elements[5];
  const c = lod.chunks[0], box = c.box, err = c.levels[1].maxError;
  const at = (d) => { cam.position.set(box.max.x + d, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2); cam.updateMatrixWorld(); lod.update(cam, H); return c.current; };
  const d1 = err * k;
  assert.equal(at(0), 0);
  assert.equal(at(d1 * 1.05), 0, '阈值以外 5% 还在滞回带里,不该往粗切');
  assert.ok(at(d1 * (1 + TERRAIN_LOD_HYSTERESIS) * 1.001) >= 1);
  const before = c.current;
  if (before === 1) assert.equal(at(d1 * 1.05), 1, '已在 L1,退回带里不该跳回 L0');
  assert.equal(at(d1 * .999), 0, '到阈值以内必须立刻切回细档(误差不许超 1 px)');
  // 任何时刻挑中的那一档,投影误差都 < 1 px。
  for (const d of [3, 10, 30, 60, 120, 240, 480]) {
    at(d);
    for (const ch of lod.chunks) {
      const b = ch.box, p = cam.position;
      const dd = Math.hypot(Math.max(b.min.x - p.x, 0, p.x - b.max.x), Math.max(b.min.y - p.y, 0, p.y - b.max.y), Math.max(b.min.z - p.z, 0, p.z - b.max.z));
      if (ch.current) assert.ok(ch.levels[ch.current].maxError * k / Math.max(dd, 1e-9) < 1.0000001);
      assert.equal(ch.levels.filter((l) => l.mesh.visible).length, 1, '每块只许一档可见');
    }
  }
});
