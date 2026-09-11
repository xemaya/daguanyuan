import * as THREE from 'three';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { CN, woodMaterial, paperMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';

/**
 * 灯笼(小木作开张第一件)。第五十三回「大觀園正門上也挑著大明角燈,兩溜高照」
 * (honglou 07-70;那条"存疑"驳的是把十种灯的材质与工艺混计成十类,不是驳正门挂灯)
 * ——所以只做六角宫灯一种,不做十种并列灯型。
 *
 * **不许给灯笼配 PointLight**:前向渲染里每个点光都进所有材质的着色循环。
 * 纸面用 emissive 假装透光(与 PITFALLS P-05 窗纸同一招,transmission 会让
 * 整个场景多渲一遍),已有的 bloom 会自然晕开;白天它首先是"亮的物体"而非光源。
 *
 * 原点在吊索顶端的悬挂点(灯笼是吊件,不落地面),+Z 朝外。
 */

/** 纸面要比窗纸亮——它是"灯",bloom 按亮度晕开;但仍不配光源。 */
function lanternPaperMaterial(): THREE.MeshStandardMaterial {
  const base = paperMaterial();
  const m = base.clone();
  m.emissive = new THREE.Color(0xffd9a0);
  m.emissiveIntensity = 0.55;
  return m;
}
let lanternPaper: THREE.MeshStandardMaterial | undefined;

/** 全园共享一个纸材质实例,静态合并才能把一园子的灯合成一个 draw call(P-04)。 */
function lanternPaperShared(): THREE.MeshStandardMaterial {
  if (!lanternPaper) lanternPaper = lanternPaperMaterial();
  return lanternPaper;
}

function buildLantern(): PartBuild {
  const g = new THREE.Group();
  g.name = 'Lantern';
  const wood = woodMaterial(CN.column, 1);
  const paper = lanternPaperShared();

  const R = 0.16; // 灯身半径
  const H = 0.42; // 灯身高
  const ROD = 0.24; // 吊索长(原点 = 悬挂点,灯下挂)
  const topY = -ROD; // 灯顶(提梁处)
  // 吊索 + 提梁小结。
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, ROD, 6), wood);
  rod.position.y = -ROD / 2;
  g.add(rod);
  const knob = new THREE.Mesh(roundedBox(0.05, 0.04, 0.05, 0.01, 1), wood);
  knob.position.y = topY - 0.02;
  g.add(knob);
  // 六棱纸面(角灯之"角"):上下木口收住的六角筒。
  const bodyY = topY - 0.06 - H / 2;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 6, 1, true), paper);
  body.position.y = bodyY;
  body.castShadow = false;
  g.add(body);
  for (const s of [1, -1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R * 1.04, 0.055, 6), wood);
    cap.position.y = bodyY + (s * (H + 0.055)) / 2;
    cap.castShadow = true;
    g.add(cap);
  }
  // 六根立柱框条,贴在棱上。
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.024, H + 0.02, 0.024), wood);
    bar.position.set(Math.cos(a) * R, bodyY, Math.sin(a) * R);
    g.add(bar);
  }
  // 底部流苏结。
  const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.09, 6), wood);
  tassel.position.y = bodyY - H / 2 - 0.055 - 0.045;
  g.add(tassel);
  g.traverse((o) => {
    o.receiveShadow = true;
  });
  return { root: g, groundRadius: 0.5 };
}

/** 悬挂点(原点)到灯底的高度,装配器据此核通行净空。 */
export const LANTERN_DROP = 0.24 + 0.06 + 0.42 + 0.055 + 0.1;

registerPart('lantern', (variant) => {
  if (variant !== 'default' && variant !== 'gong') throw new Error(`未登记灯笼变体 ${variant}`);
  return buildLantern();
});
