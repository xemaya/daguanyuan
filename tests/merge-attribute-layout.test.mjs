import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeByMaterial } from '@builder/parts/merge.ts';

/**
 * AQ-a2：`mergeByMaterial` 从"非 position/normal/uv/color 一律删除"改成
 * "按属性布局签名分桶,不删属性"。布局不同(比如带不带 uv2)进不同桶,
 * 各自合成一个 mesh——draw call 因此可能变多,但没有属性再被静默吃掉。
 */
function boxWithUv2(x = 0) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.setAttribute('uv2', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2).fill(0.5), 2));
  const m = new THREE.Mesh(g, MAT);
  m.position.x = x;
  return m;
}
function boxPlain(x = 0) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Mesh(g, MAT);
  m.position.x = x;
  return m;
}

const MAT = new THREE.MeshStandardMaterial();

test('带 uv2 的几何和不带的分两个桶，合并后 uv2 还活着', () => {
  const root = new THREE.Group();
  root.add(boxWithUv2(0), boxWithUv2(2), boxPlain(4), boxPlain(6), boxPlain(8));
  const out = mergeByMaterial(root);
  const meshes = out.children.filter((c) => c.isMesh);
  assert.equal(meshes.length, 2, `期望两个桶(带uv2/不带),实际 ${meshes.length} 个`);
  const withUv2 = meshes.find((m) => m.geometry.attributes.uv2);
  const withoutUv2 = meshes.find((m) => !m.geometry.attributes.uv2);
  assert.ok(withUv2, 'uv2 属性在合并后不见了——应当保留,不该被删');
  assert.ok(withoutUv2);
  // merge.ts 在合并前把带索引的几何转非索引(toNonIndexed):BoxGeometry
  // 12 个三角形、每个三角形独立 3 顶点,一个 box 非索引后是 36 顶点。
  assert.equal(withUv2.geometry.attributes.position.count, 36 * 2);
  assert.equal(withoutUv2.geometry.attributes.position.count, 36 * 3);
});

test('属性布局完全一致的几何合成一个桶（一个 draw call）', () => {
  const root = new THREE.Group();
  root.add(boxPlain(0), boxPlain(2), boxPlain(4));
  const out = mergeByMaterial(root);
  const meshes = out.children.filter((c) => c.isMesh);
  assert.equal(meshes.length, 1, `同布局应该只有一个桶,实际 ${meshes.length} 个`);
  assert.equal(meshes[0].geometry.attributes.position.count, 36 * 3);
});

test('缺失的 normal 仍然照旧补算，缺失的 uv 仍然照旧补零（既有行为不变）', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(g, MAT);
  const root = new THREE.Group();
  root.add(mesh);
  const out = mergeByMaterial(root);
  const merged = out.children.find((c) => c.isMesh);
  assert.ok(merged.geometry.attributes.normal, '缺 normal 的几何合并后应当补算出 normal');
  assert.ok(merged.geometry.attributes.uv, '缺 uv 的几何合并后应当补零 uv');
});

test('vertexColors 材质下缺 color 的几何被补白，仍然并进同一个桶（不因为补白多开 draw call）', () => {
  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true });
  const withColor = new THREE.BoxGeometry(1, 1, 1);
  withColor.setAttribute('color', new THREE.BufferAttribute(new Float32Array(withColor.attributes.position.count * 3).fill(0.5), 3));
  const a = new THREE.Mesh(withColor, vcMat);
  const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), vcMat);
  b.position.x = 2;
  const root = new THREE.Group();
  root.add(a, b);
  const out = mergeByMaterial(root);
  const meshes = out.children.filter((c) => c.isMesh);
  assert.equal(meshes.length, 1, 'vertexColors 材质下缺色几何补白后应当并入同一桶');
  assert.ok([...meshes[0].geometry.attributes.color.array.slice(-3)].every((v) => v === 1), '补的白色应为 1');
});

test('userData.keep 与 InstancedMesh 原样保留，不进任何合并桶', () => {
  // 注意:kept 节点世界坐标的精确值不是本单(AQ-a2)的改动面——keep 分支
  // 原样照抄自旧实现,这里只断言"没有被并进桶、原样多出一个节点"。
  const kept = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), MAT);
  kept.userData.keep = true;
  const root = new THREE.Group();
  root.add(kept, boxPlain(0), boxPlain(2));
  const out = mergeByMaterial(root);
  const merged = out.children.filter((c) => c.isMesh && !c.userData.keep);
  const keptOut = out.children.filter((c) => c.userData.keep);
  assert.equal(merged.length, 1, '两个同布局 box 应该合成一个桶');
  assert.equal(merged[0].geometry.attributes.position.count, 36 * 2, 'kept 节点不该混进合并桶的顶点数里');
  assert.equal(keptOut.length, 1, 'userData.keep 的节点应该原样多出一个,不进任何桶');
});

/**
 * `P-23`:`keep`(不参与合并、原样保留)那条路径以前是
 * `clone.applyMatrix4(k.matrixWorld)`。`clone()` 已经带着局部变换,
 * 再叠一次世界矩阵就是**位移翻倍**——父节点不是单位矩阵时当场错位。
 *
 * 这条坑在 AQ-a 记下来时还没人在真场景里触发(`ornament/scroll-sample.ts`
 * 那块 `userData.keep = true` 的样件,父链恰好是单位矩阵)。AQ-b1 把构件的
 * 内部合并撤掉之后,`keep` 的父链再也不保证是单位矩阵,所以先修它再动构件。
 */
test('keep 路径:父节点带变换时,保留件的世界位置不许翻倍（P-23）', () => {
  const root = new THREE.Group();
  const parent = new THREE.Group();
  parent.position.set(5, 0, 0);
  root.add(parent);

  const kept = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  kept.position.set(3, 0, 0);
  kept.rotation.y = 0.5;
  kept.userData.keep = true;
  parent.add(kept);

  root.updateWorldMatrix(true, true);
  const expected = kept.matrixWorld.clone();

  const out = mergeByMaterial(root);
  out.updateWorldMatrix(true, true);
  const survivor = out.children.find((c) => c.isMesh);
  assert.ok(survivor, 'keep 的 mesh 没有出现在合并结果里');
  survivor.updateWorldMatrix(true, true);
  survivor.matrixWorld.elements.forEach((n, i) => {
    assert.ok(
      Math.abs(n - expected.elements[i]) < 1e-6,
      `keep 件的世界矩阵第 ${i} 位 ${n} != ${expected.elements[i]}——位移翻倍(P-23)`,
    );
  });
});

test('keep 路径:非 keep 的普通件也不许因为父变换而错位', () => {
  const root = new THREE.Group();
  const parent = new THREE.Group();
  parent.position.set(-7, 2, 4);
  parent.rotation.y = 0.9;
  root.add(parent);
  const mat = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    m.position.set(i, 0, 0);
    parent.add(m);
  }
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  const out = mergeByMaterial(root);
  const merged = new THREE.Box3().setFromObject(out);
  for (const k of ['x', 'y', 'z']) {
    assert.ok(Math.abs(box.min[k] - merged.min[k]) < 1e-5 && Math.abs(box.max[k] - merged.max[k]) < 1e-5,
      `合并前后包围盒 ${k} 不一致:${box.min[k]}..${box.max[k]} vs ${merged.min[k]}..${merged.max[k]}`);
  }
});
