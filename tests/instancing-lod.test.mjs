import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ClusteredInstancePool } from '@engine/scatter/instancing.ts';

/* 单子 BC1:簇的远近分档。硬约束是「只换画什么,不动种在哪」——
 * 近档网格的前缀 + 远档网格的前缀 = 全体成员、各一次(tree-census 按 count 读实例,靠的就是这一条)。 */

function source(name, xs) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.setAttribute('aWind', new THREE.InstancedBufferAttribute(new Float32Array(xs.length * 2).map((_, i) => i), 2));
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), xs.length);
  mesh.name = name;
  const m = new THREE.Matrix4();
  xs.forEach((x, i) => { m.makeTranslation(x, 0, 0); mesh.setMatrixAt(i, m); });
  return mesh;
}
const prefixX = (mesh) => Array.from({ length: mesh.count }, (_, i) => mesh.instanceMatrix.array[i * 16 + 12]);

test('远近分档:两组网格的前缀并起来恰好是全体成员,各一次;逐实例的风相跟着株走', () => {
  const root = new THREE.Group();
  const pool = new ClusteredInstancePool(root, 100);
  const xs = [0, 50, 119, 125, 200, 400];
  const src = source('Trunk_test', xs);
  root.add(src);
  pool.add([src], { lod: { dist: 120, geometries: [new THREE.BoxGeometry(0.5, 0.5, 0.5)] } });
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 0, 0);
  cam.updateMatrixWorld();
  pool.update(cam);
  const nears = root.children.filter((o) => o.name.startsWith('Trunk_test@') && o.name !== 'Trunk_test@far');
  // 100 m 一簇:六株分在四个簇里,近档是四组网格。
  const nearX = () => nears.flatMap((m) => prefixX(m));
  // 远档是整个种一组网格(不跟簇走),名字 `源名@far`——tree-census 按 `@` 截种名。
  const far = root.children.find((o) => o.name === 'Trunk_test@far');
  assert.equal(nears.length, 4);
  assert.deepEqual(nearX().sort((a, b) => a - b), [0, 50, 119]);
  assert.deepEqual(prefixX(far).sort((a, b) => a - b), [125, 200, 400]);
  // aWind 跟着株重排:x=125 的那一株原序号 3,风相 (6,7)。
  const k = prefixX(far).indexOf(125);
  assert.deepEqual(Array.from(far.geometry.getAttribute('aWind').array.slice(k * 2, k * 2 + 2)), [6, 7]);
  // 相机挪到 300:并集仍是全体,各一次。
  cam.position.set(300, 0, 0);
  cam.updateMatrixWorld();
  pool.update(cam);
  const all = [...nearX(), ...prefixX(far)].sort((a, b) => a - b);
  assert.deepEqual(all, [...xs].sort((a, b) => a - b));
  assert.deepEqual(nearX().sort((a, b) => a - b), [200, 400]);
});

import { DistanceSwitch } from '@engine/scatter/instancing.ts';

test('静态件远近两档:同组的近档与远景代理按同一个包围盒同时交接,只有一个在画', () => {
  const sw = new DistanceSwitch(120, 2);
  const near = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10), new THREE.MeshBasicMaterial());
  const far = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), new THREE.MeshBasicMaterial());
  sw.addItem(near, 'near', 'g'); sw.addItem(far, 'far', 'g');
  sw.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera();
  const at = (x) => { cam.position.set(x, 1.6, 0); cam.updateMatrixWorld(); sw.update(cam); return [near.visible, far.visible]; };
  assert.deepEqual(at(50), [true, false]);
  assert.deepEqual(at(200), [false, true]);
  // 滞回:从远处走回 5 + 120 m 处(盒边在 x=5,距盒 120 m)仍是远档,进到 5 + 117 m 才换回近档。
  assert.deepEqual(at(125), [false, true]);
  assert.deepEqual(at(122), [true, false]);
});
