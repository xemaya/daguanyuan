import * as THREE from 'three';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { whiteStoneMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { mergeByMaterial } from '@builder/parts/merge';
import type { Provenance } from '@builder/derive/provenance';

/**
 * 抱鼓石 / 门枕石 — 正门口的"门当"。
 *
 * 一块门枕石:门内一端承门扇转轴(海窝从略),门外一端凿成圆鼓立在基座上,
 * 鼓面钉一圈鼓钉。第十七回写正门只到「白石台磯」为止,抱鼓石原文无据
 * (07-01 已核验段落内无此物),规则表(fashi/qing/fayuan/missing 全查过)
 * 也没有它的尺寸——所有数字都是为观感取的艺术选择,留痕在
 * `root.userData.provenance.art`,不当史料。
 *
 * 局部坐标:原点在基座底面中心,+Z 朝门外(鼓面朝向),门枕尾伸向 -Z(门内)。
 * 一对就是同一构件在门左右各放一份,不镜像——两边门枕都指向门洞进深。
 */

/** 鼓的半剖:平背 → 鼓帮微鼓 → 平脸,绕 Y 车出鼓形再立起来。 */
function drumGeometry(R: number, T: number): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.001, -T / 2),
    new THREE.Vector2(R * 0.6, -T / 2),
    new THREE.Vector2(R * 0.94, -T * 0.42),
    new THREE.Vector2(R, 0),
    new THREE.Vector2(R * 0.94, T * 0.42),
    new THREE.Vector2(R * 0.6, T / 2),
    new THREE.Vector2(0.001, T / 2),
  ];
  const g = new THREE.LatheGeometry(pts, 22);
  g.rotateX(Math.PI / 2); // 鼓轴从 Y 转到 Z:鼓面朝门内/门外
  return g;
}

// 尺寸全部无出处,为观感取值(见 userData.provenance.art)。用户 2026-09-14
// 走完正门拍板「做大、做精」(D6)：五间大门不施朱粉,气派要由尺度撑,原
// 0.54/1.04/0.34m 一档在 13.76m 门脸前读得单薄——整体放大到 ×1.3。
const SCALE = 1.3;
const BAOGUSHI_BASE_W_M = 0.54 * SCALE;
const BAOGUSHI_BASE_L_M = 1.04 * SCALE;
const BAOGUSHI_BASE_H_M = 0.14 * SCALE;
const BAOGUSHI_DRUM_R_M = 0.34 * SCALE;
const BAOGUSHI_DRUM_T_M = 0.18 * SCALE;
const BAOGUSHI_PILLOW_W_M = 0.24 * SCALE; // 门枕尾:伸到门槛下承门轴
const BAOGUSHI_PILLOW_H_M = 0.2 * SCALE;
export { BAOGUSHI_BASE_W_M, BAOGUSHI_BASE_L_M };

export function buildBaogushi(): PartBuild {
  const stone = whiteStoneMaterial(1);
  const g = new THREE.Group();
  g.name = 'Baogushi';

  const baseW = BAOGUSHI_BASE_W_M;
  const baseL = BAOGUSHI_BASE_L_M;
  const baseH = BAOGUSHI_BASE_H_M;
  const drumR = BAOGUSHI_DRUM_R_M;
  const drumT = BAOGUSHI_DRUM_T_M;
  const drumZ = baseL / 2 - drumT / 2 - 0.06; // 鼓坐在基座靠门外一端
  const pillowW = BAOGUSHI_PILLOW_W_M;
  const pillowH = BAOGUSHI_PILLOW_H_M;
  const pillowL = baseL - 0.1;

  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, stone);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // 基座:双层,上层略收(须弥座的意思,不做莲瓣——原文只到"西番草"于台磯,
  // 门枕座上再堆雕饰就过了)。
  add(roundedBox(baseW, baseH * 0.55, baseL, 0.02, 2), 0, (baseH * 0.55) / 2, 0);
  add(roundedBox(baseW - 0.08, baseH * 0.45, baseL - 0.08, 0.015, 2), 0, baseH * 0.55 + (baseH * 0.45) / 2, 0);
  // 门枕:基座上沿 -Z 伸出的长条,顶面与门槛平。
  add(roundedBox(pillowW, pillowH, pillowL, 0.015, 2), 0, baseH + pillowH / 2, -0.12);
  // 鼓。
  const drumY = baseH + pillowH + drumR - 0.04; // 鼓帮略沉进门枕,不悬空
  add(drumGeometry(drumR, drumT), 0, drumY, drumZ);
  // 鼓钉:前后脸各一圈十四颗,紧贴鼓面外缘(D6:原九颗等距半球铺满整个
  // 鼓面偏大,近观读成"麻子"——钉本身缩小、加密,且只沿边缘一圈,鼓心
  // 留素面,才读成"钉"而不是散点。不雕兽面(兽头大门是宁府门制,07-53)。
  const studGeo = new THREE.SphereGeometry(0.014, 6, 4);
  const studCount = 14;
  const studRingR = drumR * 0.86;
  for (const face of [-1, 1]) {
    for (let i = 0; i < studCount; i++) {
      const a = (i / studCount) * Math.PI * 2;
      add(
        studGeo,
        Math.cos(a) * studRingR,
        drumY + Math.sin(a) * studRingR,
        drumZ + face * (drumT / 2 + 0.003),
      );
    }
  }
  // 挟鼓:鼓脚两侧两块小斜楔,把鼓"抱"住。
  for (const sx of [-1, 1]) {
    const w = add(roundedBox(0.09 * SCALE, 0.24 * SCALE, drumT + 0.05, 0.015, 2), sx * (drumR * 0.55), baseH + pillowH + 0.02, drumZ);
    w.rotation.z = sx * 0.38;
  }

  const merged = mergeByMaterial(g);
  merged.name = 'Baogushi';
  const provenance: Provenance = {
    evidence: [],
    inference: [],
    art: [
      {
        id: 'project:baogushi-dimensions',
        name: '抱鼓石/门枕石尺寸与形制',
        method: 'artistic_choice',
        note:
          '《红楼梦》第十七回写正门无抱鼓石(07-01),规则表亦无门枕石条目;' +
          '设此物是因为它是"门"最强的视觉符号(ROADMAP PQ-7)。' +
          `鼓径 ${(drumR * 2).toFixed(2)}m、鼓厚 ${drumT.toFixed(2)}m、基座 ${baseW.toFixed(2)}×${baseL.toFixed(2)}m、门枕宽 ${pillowW.toFixed(2)}m,` +
          `均为观感取值,较此前一档整体放大 ${SCALE}× (用户 2026-09-14 反馈第 1/6 条拍板"做大做精");` +
          `鼓面朝内外、不雕兽面(兽头是宁府门制,07-53);鼓钉改为沿鼓面外缘一圈 ${studCount} 颗、` +
          '半径 0.014m,不再是原先九颗铺满整个鼓面偏大读成"麻子"的半球。',
      },
    ],
  };
  merged.userData.provenance = provenance;
  return { root: merged, groundRadius: 1.2 * SCALE };
}

registerPart('baogushi', () => buildBaogushi());
