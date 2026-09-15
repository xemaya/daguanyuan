import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 一个 mesh 的属性布局签名:属性名 + itemSize,排序后拼串。
 *
 * `mergeGeometries` 要求参与合并的几何属性集完全一致,所以布局不同的几何
 * 不能同桶——AQ-a2:以前的做法是把 position/normal/uv/color 之外的属性全部
 * 删掉,统一成一种布局;现在改成按布局分桶,不删属性,`surfaceId`、第二套
 * uv、湿度这些下游需要的数据能活着走出合并。全仓现在没人写第二套属性,
 * 所以现状下每种材质仍然只会分出 1~2 个桶(有没有 color 属性),draw call
 * 不变;将来谁加了新属性,谁的桶多一个、谁付这个 draw call,这是对的
 * (`D-18`:只分桶,不做通用属性系统)。
 */
function attributeLayoutSignature(g: THREE.BufferGeometry): string {
  return Object.keys(g.attributes)
    .sort()
    .map((name) => `${name}:${(g.attributes[name] as THREE.BufferAttribute).itemSize}`)
    .join('|');
}

/**
 * 按材质合并一个构件树下的静态 Mesh。
 *
 * 程序化构件动辄几百根棂条、几十块石板,每块一个 draw call 会把 260 的预算
 * 一栋房子就吃光。合并后同材质(同属性布局)一个 mesh;带 skip 标记
 * (userData.keep)的节点(要单独动的、要单独换材质的)原样保留。
 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateWorldMatrix(true, true);
  // 复合桶键:材质 -> 属性布局签名 -> 几何列表。
  const buckets = new Map<THREE.Material, Map<string, { geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean }>>();
  const keep: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if ((m as THREE.InstancedMesh).isInstancedMesh || m.userData.keep || Array.isArray(m.material)) {
      keep.push(m);
      return;
    }
    const g = m.geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    const mat = m.material as THREE.Material;
    // 材质开了 vertexColors 而几何没有 color 属性时,WebGL 会把缺省属性读成
    // 黑:补一份白。要在算布局签名之前做,否则这份几何会被分去"没有 color"
    // 的桶,材质却仍然开着 vertexColors,补丁就白补了。
    if ((mat as THREE.MeshStandardMaterial).vertexColors && !g.attributes.color) {
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    }
    g.applyMatrix4(m.matrixWorld);
    const layout = attributeLayoutSignature(g);
    let byLayout = buckets.get(mat);
    if (!byLayout) {
      byLayout = new Map();
      buckets.set(mat, byLayout);
    }
    let b = byLayout.get(layout);
    if (!b) {
      b = { geos: [], cast: false, recv: false };
      byLayout.set(layout, b);
    }
    b.geos.push(g);
    b.cast ||= m.castShadow;
    b.recv ||= m.receiveShadow;
  });
  const out = new THREE.Group();
  out.name = root.name;
  for (const [mat, byLayout] of buckets) {
    for (const b of byLayout.values()) {
      // Extrude/Shape 是非索引几何,其余带索引:统一转非索引再合。
      const merged = mergeGeometries(b.geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
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
