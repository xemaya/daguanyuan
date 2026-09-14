import * as THREE from 'three';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { whiteStoneMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { lerp } from '@engine/core/Noise';
import type { Provenance } from '@builder/derive/provenance';

/**
 * 白石台矶(zhengmen.forecourt-terrace)——07-01「下面白石台磯,鑿成西番
 * 草花樣」。正门自己的台基(`menSpec` 的 `platformMarginM: 0.9`)只比门
 * 屋本身宽 0.9m,读不出「台磯」,门前那段地此前一直是裸土(用户
 * 2026-09-14 反馈第 6/8 条)。这里单独造一块更宽的台矶,垫在正门台阶前。
 *
 * 台矶边缘的「西番草」浮雕沿用 `builder/parts/damu/building.ts` 里
 * `plinthMaterial==='whiteStone'` 分支同一套闭合卷曲算法(2026-09-14
 * C3 返工版本,真闭合螺旋+尖叶,不是正弦波)——那份实现是内联在
 * `buildBuilding()` 里的私有代码,该文件本单不许碰(单子 AG 在动),所以
 * 这里按同样的参数与做法照抄一份,不改算法本身、也不新造一套不同的
 * 纹样。C4(西番草读成铁丝)是另一单要修的事,这里原样复现同一个"缺点"，
 * 保持两处观感一致，不在本单顺手"改良"。
 *
 * 局部坐标:原点在台矶底面中心,+Z 朝门外。
 */

/** 沿一条折线拉一根圆管——从 building.ts 的 `ridgeTube` 原样复制(该文件
 * 不许改，这里不从它 import，是独立的同名工具函数)。径向段数从 8 降到 6:
 * 台矶周长(13.76×5.6m)远大于门屋自身台基，卷草带原样复制会让三角预算
 * 超编(见下方 SIDE_LEN_PER_PERIOD 的注释)，径向段数是对这条管子本身
 * 影响最小的省法——浅浮雕本来就贴着台面看不到管壁截面。 */
function ridgeTube(points: THREE.Vector3[], r: number, mat: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2);
  const geo = new THREE.TubeGeometry(curve, Math.max(6, points.length * 3), r, 6, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export interface ForecourtTerraceSpec {
  /** 半宽(米,X 向)。跟五间门脸讲道理,不是跟台基 margin 讲道理。 */
  halfX: number;
  /** 半深(米,Z 向,朝门外一侧)。 */
  halfZ: number;
  /** 台面高度(米)。 */
  platH: number;
}

export function buildForecourtTerrace(spec: ForecourtTerraceSpec): PartBuild {
  const { halfX: platHX, halfZ: platHZ, platH } = spec;
  const plinth = whiteStoneMaterial(1);
  const root = new THREE.Group();
  root.name = 'ForecourtTerrace';

  const plat = new THREE.Mesh(roundedBox(platHX * 2, platH, platHZ * 2, 0.03, 3), plinth);
  plat.position.y = platH / 2;
  plat.receiveShadow = true;
  plat.castShadow = true;
  root.add(plat);
  // 阶条石一圈略凸,同 building.ts 台基做法。
  const rim = new THREE.Mesh(roundedBox(platHX * 2 + 0.08, 0.1, platHZ * 2 + 0.08, 0.02, 2), plinth);
  rim.position.y = platH - 0.05;
  rim.receiveShadow = true;
  root.add(rim);

  // 西番草(缠枝卷叶)浅浮雕——与 building.ts 白石台基边缘同一套参数/算法。
  const bandY = platH * 0.55;
  const curlR = Math.min(0.052, platH * 0.135);
  const bandAmp = curlR * 0.55;
  const bandR = Math.min(0.016, platH * 0.042);
  const inMargin = 0.16;
  type Side = { x0: number; z0: number; x1: number; z1: number; nx: number; nz: number };
  const sides: Side[] = [
    { x0: -platHX + inMargin, z0: platHZ, x1: platHX - inMargin, z1: platHZ, nx: 0, nz: 1 },
    { x0: -platHX + inMargin, z0: -platHZ, x1: platHX - inMargin, z1: -platHZ, nx: 0, nz: -1 },
    { x0: -platHX, z0: -platHZ + inMargin, x1: -platHX, z1: platHZ - inMargin, nx: -1, nz: 0 },
    { x0: platHX, z0: -platHZ + inMargin, x1: platHX, z1: platHZ - inMargin, nx: 1, nz: 0 },
  ];
  for (const s of sides) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    if (len < 0.3) continue;
    const ux = (s.x1 - s.x0) / len;
    const uz = (s.z1 - s.z0) / len;
    // building.ts 的原公式(wavelength = curlR*4.4)是按门屋自身台基的边长调的；
    // 台矶单侧最长 13.76m，原样搬过来会摊出 27 个卷心，三角预算超编。这里
    // 只放大卷心的"复现间距"(×3.4)，不改卷心本身的闭合算法——同一个纹样，
    // 摊得更疏,适配这块大得多的台面,不是发明第二套纹样。
    const wavelength = Math.max(2.9, curlR * 4.4 * 3.4);
    const nPeriods = Math.max(2, Math.round(len / wavelength));
    const pts: THREE.Vector3[] = [];
    const leafSpots: { pos: THREE.Vector3; out: THREE.Vector3 }[] = [];
    const along = (t: number): [number, number] => [
      lerp(s.x0, s.x1, t) + s.nx * 0.015,
      lerp(s.z0, s.z1, t) + s.nz * 0.015,
    ];
    {
      const [x0, z0] = along(0);
      pts.push(new THREE.Vector3(x0, bandY, z0));
    }
    for (let i = 0; i < nPeriods; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const t0 = i / nPeriods;
      const t1 = (i + 1) / nPeriods;
      const tPeak = t0 + (t1 - t0) * 0.5;
      const riseSteps = 4;
      for (let k = 1; k <= riseSteps; k++) {
        const lt = k / riseSteps;
        const t = lerp(t0, tPeak, lt);
        const [x, z] = along(t);
        const y = bandY + sign * bandAmp * Math.sin((lt * Math.PI) / 2);
        pts.push(new THREE.Vector3(x, y, z));
      }
      const [px, pz] = along(tPeak);
      const peakY = bandY + sign * bandAmp;
      const centerY = peakY + sign * curlR;
      const loopSteps = 10;
      for (let k = 1; k <= loopSteps; k++) {
        const ang = -Math.PI / 2 + (k / loopSteps) * Math.PI * 2 * -sign;
        const alongOff = Math.cos(ang) * curlR;
        const y = centerY + Math.sin(ang) * curlR * sign;
        pts.push(new THREE.Vector3(px + ux * alongOff, y, pz + uz * alongOff));
        if (k === Math.round(loopSteps * 0.32)) {
          const outX = px + ux * alongOff * 1.3;
          const outZ = pz + uz * alongOff * 1.3;
          leafSpots.push({
            pos: new THREE.Vector3(outX, y, outZ),
            out: new THREE.Vector3(ux * alongOff, Math.sin(ang) * curlR * sign, uz * alongOff).normalize(),
          });
        }
      }
      const fallSteps = 4;
      for (let k = 1; k <= fallSteps; k++) {
        const lt = k / fallSteps;
        const t = lerp(tPeak, t1, lt);
        const [x, z] = along(t);
        const y = bandY + sign * bandAmp * Math.sin(((1 - lt) * Math.PI) / 2);
        pts.push(new THREE.Vector3(x, y, z));
      }
    }
    root.add(ridgeTube(pts, bandR, plinth));
    for (const leaf of leafSpots) {
      const geo = new THREE.ConeGeometry(bandR * 2.1, bandR * 5.2, 4, 1);
      geo.scale(1, 1, 0.42);
      const mesh = new THREE.Mesh(geo, plinth);
      mesh.position.copy(leaf.pos).addScaledVector(leaf.out, 0.012);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), leaf.out);
      mesh.castShadow = true;
      root.add(mesh);
    }
  }

  const provenance: Provenance = {
    evidence: [],
    inference: [
      {
        id: 'project:forecourt-terrace-material-pattern',
        name: '白石台矶材质与西番草纹样',
        method: 'derived',
        note: '07-01「下面白石台磯,鑿成西番草花樣」:材质白石、边缘卷草浮雕直接依原文；' +
          '几何是 building.ts 白石台基卷草的同一套算法参数(未改动),不新造第二套纹样。',
      },
    ],
    art: [
      {
        id: 'project:forecourt-terrace-size',
        name: '白石台矶尺寸',
        method: 'artistic_choice',
        note:
          `原文未给台矶米制尺寸。宽度按实测正门五间门脸(13.76m)取半宽 ${platHX.toFixed(2)}m` +
          '——与门脸同宽,不是延用门屋自身 0.9m 台基 margin 那个不成比例的小台;' +
          `深度 ${platHZ.toFixed(2)}m、高度 ${platH.toFixed(2)}m 为观感取值,深度另需满足` +
          'playtest 脚下序列连续为石面、不露黄土这条可复验判据(用户反馈第 6/8 条)。',
      },
    ],
  };
  root.userData.provenance = provenance;
  return { root, groundRadius: Math.hypot(platHX, platHZ) };
}

export const FORECOURT_TERRACE_SPEC: ForecourtTerraceSpec = { halfX: 6.88, halfZ: 2.8, platH: 0.4 };

registerPart('forecourt-terrace', () => buildForecourtTerrace(FORECOURT_TERRACE_SPEC));
