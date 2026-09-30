import * as THREE from 'three';
import { compileBridgePath, type BridgePathSpec } from '@builder/plan/bridge-path';
import type { Point2 } from '@builder/plan/geometry';
import { roundedBox, noiseDisplace } from '../sculpt';
import { assembleStatic } from '../static-batches';
import { roughWoodMaterial } from '../xiangye/materials';
import { makeRng } from '@engine/core/Noise';
import type { BridgePathResult } from './bridge-path';

/**
 * 乡野板桥(单子 BB2)——稻香村过西溪那一座。C-r 乡野子档「不施彩画」:
 * 两根原木作梁,上铺顺桥向的厚木板(板宽不齐、板头参差),木桩脚两根一排、上架一根帽木,
 * 只有一侧扶手(桩 + 一根原木横杆),全部粗木本色、不上漆。
 *
 * 接口与 `buildBridgePath` 同(`bridge-path` 的 path/spec 不变):装配器按同一份 path.polygon 登记桥面平台,
 * 两侧阻挡盒也照旧登记——没扶手那一侧仍挡人落水,读法与通行分开。
 * 走线、宽、标高、墩距、墩脚、桥台全部读 plan 的 connection 规格;下面的板厚、梁径、桩径、扶手是艺术取值。
 */
const PB = { plankT: 0.07, planks: 6, stringerR: 0.1, postR: 0.085, capH: 0.14, railPostR: 0.05, railR: 0.045, railPitch: 1.8 };
export const PLANK_BRIDGE_PROVENANCE = [{ id: 'project:rustic-plank-bridge', name: '乡野板桥', method: 'artistic_choice',
  note: 'BB2:C-r 不施彩画。顺桥向厚板六块(厚 0.07 m)、两根原木梁(径 0.2 m)、木桩两根一排上架帽木(桩径 0.17 m)、单侧原木扶手;原文未点名此桥,尺寸为艺术取值,走线/宽/标高/墩距读 plan。' }];

export function buildRusticPlankBridge(spec: BridgePathSpec, ground: (x: number, z: number) => number): BridgePathResult {
  const path = compileBridgePath(spec), root = new THREE.Group(), wood = roughWoodMaterial();
  const rng = makeRng(0x9b1d);
  const add = (geo: THREE.BufferGeometry) => { const m = new THREE.Mesh(geo, wood); m.castShadow = true; m.receiveShadow = true; root.add(m); return m; };
  /** 一根沿 a→b 的原木(水平或斜),两端各伸出 ext。 */
  const log = (a: THREE.Vector3, b: THREE.Vector3, r: number, seed: number, ext = 0) => {
    const dir = b.clone().sub(a), len = dir.length() + 2 * ext;
    const g = new THREE.CylinderGeometry(r * 0.92, r, len, 8, Math.max(1, Math.ceil(len / 0.5)));
    noiseDisplace(g, r * 0.08, 5, seed, 2);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return add(g);
  };
  const w = spec.width_m, half = w / 2, deckBottom = -PB.plankT, stringerY = deckBottom - PB.stringerR, capTop = stringerY - PB.stringerR;
  const pierData: { point: Point2; bottom: number; top: number }[] = [];
  const st = path.stations;
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i];
    const ax = a.point[0], az = a.point[1], bx = b.point[0], bz = b.point[1];
    const len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz, nz = tx;
    const yaw = Math.atan2(-(bz - az), bx - ax);
    // 顺桥向厚板:宽度不齐、板头参差,两头各多出一点压在相邻一跨上(转折处不露缝)。
    const widths = Array.from({ length: PB.planks }, () => 0.8 + rng() * 0.4), sum = widths.reduce((p, q) => p + q, 0);
    let off = -half;
    for (const k of widths) {
      const bw = (k / sum) * w, c = off + bw / 2;
      off += bw;
      const e0 = 0.1 + rng() * 0.18, e1 = 0.1 + rng() * 0.18, L = len + e0 + e1, s = (e1 - e0) / 2;
      const g = roundedBox(L, PB.plankT * (0.9 + rng() * 0.2), bw - 0.018, 0.012, 2);
      noiseDisplace(g, 0.004, 6, (i * 31 + ((c * 100) | 0)) >>> 0, 2);
      g.rotateY(yaw);
      g.translate(ax + tx * (len / 2 + s) + nx * c, -PB.plankT / 2, az + tz * (len / 2 + s) + nz * c);
      add(g);
    }
    // 两根原木梁。
    for (const side of [-1, 1]) {
      const o = side * (half - 0.28);
      log(new THREE.Vector3(ax + nx * o, stringerY, az + nz * o), new THREE.Vector3(bx + nx * o, stringerY, bz + nz * o), PB.stringerR, 400 + i * 7 + side, 0.15);
    }
    // 木桩脚:按 plan 墩距,两根一排,上架帽木;桩打进河床 pierEmbed。
    const n = Math.max(1, Math.ceil(len / spec.pierPitch_m));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const bed = ground(x + path.origin[0], z + path.origin[1]) - spec.elevation_m;
      if (!Number.isFinite(bed)) throw new Error('板桥桩脚地形采样无效');
      const bottom = bed - spec.pierEmbed_m;
      for (const side of [-1, 1]) {
        const o = side * (half - 0.28);
        if (capTop - PB.capH > bottom + 0.05)
          log(new THREE.Vector3(x + nx * o, bottom, z + nz * o), new THREE.Vector3(x + nx * o + (rng() - 0.5) * 0.05, capTop - PB.capH, z + nz * o), PB.postR, 500 + i * 13 + k * 3 + side);
      }
      const cap = roundedBox(w - 0.2, PB.capH, 0.16, 0.03, 2);
      noiseDisplace(cap, 0.006, 5, 600 + i * 11 + k, 2);
      cap.rotateY(yaw + Math.PI / 2);
      cap.translate(x, capTop - PB.capH / 2, z);
      add(cap);
      pierData.push({ point: [x, z], bottom, top: capTop });
    }
    // 单侧扶手(左手侧):桩 + 一根原木横杆。
    const ro = half - 0.1, count = Math.max(1, Math.ceil(len / PB.railPitch));
    for (let k = i === 1 ? 0 : 1; k <= count; k++) {
      const t = k / count, x = ax + (bx - ax) * t + nx * ro, z = az + (bz - az) * t + nz * ro;
      log(new THREE.Vector3(x, capTop, z), new THREE.Vector3(x, spec.railingHeight_m + 0.04, z), PB.railPostR, 700 + i * 17 + k);
    }
    log(new THREE.Vector3(ax + nx * ro, spec.railingHeight_m, az + nz * ro), new THREE.Vector3(bx + nx * ro, spec.railingHeight_m, bz + nz * ro), PB.railR, 800 + i, 0.12);
  }
  const assembled = assembleStatic(root, 8, 64, { singleCluster: path.length <= 64 });
  assembled.name = spec.id;
  assembled.userData.linear = { id: spec.id, kind: 'bridge', spec, origin: path.origin, length: path.length, piers: pierData, style: 'rustic-plank' };
  assembled.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: PLANK_BRIDGE_PROVENANCE } };
  return { kind: 'bridge-path', root: assembled, path, spec };
}
