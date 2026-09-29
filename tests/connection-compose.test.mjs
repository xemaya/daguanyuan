// 单子 BE:composer 通走 plan.connections(P-37)。
// composer.ts 本身带 import.meta.glob,node 下 import 不了;判定与构件名映射在纯模块
// builder/compose/connections.ts 里,composer 与对账门读同一份——这里测那一份,
// 再用 composer 主循环的同一个调用 buildPart(part, id, {ground}) 把桥建出来,与棚拍比几何。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pickConnections, connectionPart } from '@builder/compose/connections.ts';
import { terrainWindow } from '@builder/plan/window.ts';
import { makeTerrainField } from '@builder/compose/terrain-from-plan.ts';
import { SEED } from '@builder/compose/config.ts';
import { buildPart } from '@builder/parts/registry.ts';
import { buildPlannedBridge } from '@project/construction.ts';
import { connectionCoverage, TERRAIN_PAD_M } from '../tools/manifest-diff.mjs';

const plan = JSON.parse(readFileSync('projects/daguanyuan/plan.json', 'utf8'));
const builtRegions = readdirSync('projects/daguanyuan/scenes').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const realWindow = () => terrainWindow(plan, builtRegions, TERRAIN_PAD_M, 0.48);

/** 构件几何指纹:逐 mesh 的矩阵、材质、各 attribute、index,按遍历顺序。 */
function geometrySha(root) {
  root.updateMatrixWorld(true);
  const h = createHash('sha256');
  let meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    h.update(`M${o.matrixWorld.elements.join(',')}|${mats.map((m) => `${m.type}:${m.color?.getHexString?.() ?? ''}`).join('|')}\n`);
    for (const name of Object.keys(o.geometry.attributes).sort()) {
      const a = o.geometry.attributes[name];
      h.update(`${name}:${a.itemSize}:`);
      h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    }
    if (o.geometry.index) h.update(Buffer.from(o.geometry.index.array.buffer, o.geometry.index.array.byteOffset, o.geometry.index.array.byteLength));
  });
  return { meshes, sha: h.digest('hex') };
}

test('BE1 · 真窗口(5 区建成)内建 daoxiang-creek 与 red-railing,窗口外两座跳过且点名出界折点', () => {
  const pick = pickConnections(plan.connections, realWindow());
  assert.deepEqual(pick.build.map((c) => c.id).sort(), ['connection.daoxiang-creek', 'connection.red-railing']);
  assert.deepEqual(pick.skipped.map((s) => s.id).sort(), ['connection.qinfang-sluice', 'connection.yihong-return']);
  for (const s of pick.skipped) { assert.equal(s.reason, '窗口外'); assert.ok(s.outside.length > 0, s.id); }
  for (const c of pick.build) assert.equal(connectionPart(c.kind), 'garden-bridge');
});

test('BE1 · 只要有一个折点出窗口就不建(查全部折点,不只首尾)', () => {
  const red = plan.connections.find((c) => c.id === 'connection.red-railing');
  const xs = red.points.map((p) => p[0]), zs = red.points.map((p) => p[1]);
  // 窗口正好是四个折点的 bbox:全在里面就建;再把第二个折点(中间折点)挪出窗口,首尾不动,就不许建。
  const win = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  assert.deepEqual(pickConnections([red], win).build.map((c) => c.id), [red.id]);
  const bent = { ...red, points: red.points.map((p, i) => (i === 1 ? [p[0], win.minZ - 1] : p)) };
  const pick = pickConnections([bent], win);
  assert.equal(pick.build.length, 0);
  assert.deepEqual(pick.skipped[0].outside, [[red.points[1][0], win.minZ - 1]]);
});

test('BE1 · 窗口临时扩到全园:窗口外两座也会建,几何与棚拍 bridge-path 逐位相同(不改真窗口)', () => {
  const win = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
  const pick = pickConnections(plan.connections, win);
  assert.equal(pick.build.length, plan.connections.length);
  assert.equal(pick.skipped.length, 0);
  // composer 主循环的地面是 ctx.collision.terrainHeight(同一 plan、同一 SEED 的解析场);棚拍用 construction.ts 的 previewGround。
  const ground = makeTerrainField(plan, { seed: SEED }).height;
  // 材质会烘焙贴图,Node 没有 OffscreenCanvas。这里只比几何,给一个只收像素不画的桩;两边吃同一个桩。
  globalThis.OffscreenCanvas ??= class {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() {
      return {
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
      };
    }
  };
  for (const id of ['connection.qinfang-sluice', 'connection.yihong-return', 'connection.red-railing', 'connection.daoxiang-creek']) {
    const c = pick.build.find((x) => x.id === id);
    const composed = buildPart(connectionPart(c.kind), c.id, { ground });
    assert.ok(composed, id);
    assert.equal(composed.kind, 'bridge-path', id);
    const studio = buildPlannedBridge(id);
    const a = geometrySha(composed.root), b = geometrySha(studio.root);
    assert.ok(a.meshes > 0, id);
    assert.deepEqual(a, b, `${id}: composer 建的与棚拍几何不同`);
  }
  // 真窗口没被动:仍然只建两座。
  assert.equal(pickConnections(plan.connections, realWindow()).build.length, 2);
});

test('BE1 · composer 真的走了这条路(源码守卫:删掉 connectionPlacements 就红)', () => {
  const src = readFileSync('builder/compose/composer.ts', 'utf8');
  assert.match(src, /pickConnections\(getPlan\(\)\.connections \?\? \[\], TERRAIN\)/);
  assert.match(src, /\.\.\.connectionPlacements\(\),/);
  assert.match(src, /未建:窗口外/);
  // 借道那一条已删:scenes 里不许再有人手挂 connection。
  for (const f of readdirSync('projects/daguanyuan/scenes').filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(`projects/daguanyuan/scenes/${f}`, 'utf8'));
    for (const pl of s.placements ?? []) assert.ok(!String(pl.variant ?? '').startsWith('connection.'), `${f} 仍借道挂 ${pl.variant}`);
  }
});

test('BE2 · 对账门的窗口边距与 terrain.ts 的 PAD 相同', () => {
  const src = readFileSync('builder/compose/terrain.ts', 'utf8');
  const m = src.match(/^const PAD = (\d+(?:\.\d+)?);/m);
  assert.ok(m, 'terrain.ts 里找不到 const PAD');
  assert.equal(Number(m[1]), TERRAIN_PAD_M);
});

test('BE2 · --coverage 连接栏:窗口内 2 座,缺一座就点名;窗口外的不算缺', () => {
  const win = realWindow();
  const full = { constructions: [
    { id: 'connection.daoxiang-creek', planId: 'connection.daoxiang-creek', part: 'garden-bridge', variant: 'connection.daoxiang-creek' },
    { id: 'connection.red-railing', planId: 'connection.red-railing', part: 'garden-bridge', variant: 'connection.red-railing' },
  ] };
  const ok = connectionCoverage(plan, full, win, pickConnections);
  assert.deepEqual(ok.built.sort(), ['connection.daoxiang-creek', 'connection.red-railing']);
  assert.equal(ok.expected.length, 2);
  assert.deepEqual(ok.missing, []);
  assert.deepEqual(ok.outside.sort(), ['connection.qinfang-sluice', 'connection.yihong-return']);
  // 突变:BE 之前的世界(只借道挂了稻香村那座)——门必须点名 red-railing。
  const before = { constructions: full.constructions.slice(0, 1) };
  const bad = connectionCoverage(plan, before, win, pickConnections);
  assert.deepEqual(bad.missing, ['connection.red-railing']);
  assert.equal(bad.built.length, 1);
});
