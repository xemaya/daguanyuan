import * as THREE from 'three';
import { stations, type P2 } from './path';
import { sweepSection } from './sweep';

/**
 * 单子 BC2:乡野构件的远景档。
 *
 * 近档构件在 120 m 外换成这里做的简化件:茅屋 = 体块 + 茅顶,泥墙 = 一条泥色带 + 草檐色,
 * 青篱 = 一条绿带,菜畦 = 贴地色块。**只做「远处画什么」**——落位、碰撞、名册一概不动,
 * 远景件不进碰撞、不登记。换档在静态合批里做(`builder/parts/static-batches.ts` 按
 * `userData.farLod` 分近 / 远两档合并,交给 `DistanceSwitch`),这里只负责打标记与出几何。
 */

/**
 * 给一个构件根打远近档标记:原有的 mesh 全标 `near`(`keepBoth` 返回真的除外——两档都画,
 * 如菜畦的土片),再把远景件标 `far` 挂上。根上标 `farLodRoot`,合批按它所在的簇分组。
 */
export function markFarLod(root: THREE.Object3D, far: THREE.Object3D[], keepBoth: (m: THREE.Mesh) => boolean = () => false): void {
  root.userData.farLodRoot = true;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !keepBoth(m)) m.userData.farLod = 'near';
  });
  for (const f of far) {
    f.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.userData.farLod = 'far'; });
    root.add(f);
  }
}

/** 远景件自己的纯色材质(按键缓存:同色同一个实例,合批才合得起来)。 */
const plain = new Map<string, THREE.MeshStandardMaterial>();
export function farPlainMaterial(key: string, color: number, roughness = 1): THREE.MeshStandardMaterial {
  let m = plain.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }); m.name = `far.${key}`; plain.set(key, m); }
  return m;
}

/**
 * 沿折线扫一条远景带(泥墙身、草檐、青篱)。站距 2 m——120 m 外 2 m 是十几个像素,
 * 随地起伏照样跟得住;`rel` 是当地地面相对放置标高的差(与近档同一个函数)。
 */
export function farBand(pts: readonly P2[], section: [number, number][], material: THREE.Material,
  rel?: (x: number, z: number) => number, tile = 1): THREE.Mesh {
  const st = stations(pts, 2);
  const g = sweepSection(st, section, { tile, warp: (S, _j, _i, n, y) => [n, y + (rel ? rel(S.p[0], S.p[1]) : 0)] });
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 远景件的包围盒体块(uv 按米铺,近档贴图的色调在远处照样对得上)。 */
export function farBox(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, tile = 1): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
    const [su, sv] = ax > 0.5 ? [d, h] : ay > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
  }
  g.translate(x, y + h / 2, z);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
