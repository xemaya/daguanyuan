import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 按材质合并一个构件树下的静态 Mesh。
 *
 * 程序化构件动辄几百根棂条、几十块石板,每块一个 draw call 会把 260 的预算
 * 一栋房子就吃光。合并后同材质一个 mesh;带 skip 标记(userData.keep)的
 * 节点(要单独动的、要单独换材质的)原样保留。
 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateWorldMatrix(true, true);
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean }>();
  const keep: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if ((m as THREE.InstancedMesh).isInstancedMesh || m.userData.keep || Array.isArray(m.material)) {
      keep.push(m);
      return;
    }
    const g = m.geometry.clone();
    // 合并要求属性集一致:统一只留 position/normal/uv(+color)。
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    g.applyMatrix4(m.matrixWorld);
    const key = m.material as THREE.Material;
    let b = buckets.get(key);
    if (!b) {
      b = { geos: [], cast: false, recv: false };
      buckets.set(key, b);
    }
    b.geos.push(g);
    b.cast ||= m.castShadow;
    b.recv ||= m.receiveShadow;
  });
  const out = new THREE.Group();
  out.name = root.name;
  for (const [mat, b] of buckets) {
    // color 属性不齐会合并失败:分两桶。
    // 材质开了 vertexColors 而几何没有 color 属性时,WebGL 会把缺省属性读成黑:补一份白。
    if ((mat as THREE.MeshStandardMaterial).vertexColors) {
      for (const g of b.geos) {
        if (!g.attributes.color) {
          g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        }
      }
    }
    const withColor = b.geos.filter((g) => g.attributes.color);
    const noColor = b.geos.filter((g) => !g.attributes.color);
    for (const list of [withColor, noColor]) {
      if (!list.length) continue;
      // Extrude/Shape 是非索引几何,其余带索引:统一转非索引再合。
      const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.recv;
      out.add(mesh);
    }
  }
  for (const k of keep) {
    const clone = k.clone();
    clone.applyMatrix4(k.matrixWorld);
    out.add(clone);
  }
  return out;
}
