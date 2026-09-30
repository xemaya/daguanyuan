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

/* ---- 尺寸(单子 AU1:抬一档)------------------------------------------- */

/**
 * 灯身半径。**单子 AU1 从 0.16 抬到 0.28(直径 0.32 → 0.56m)。**
 *
 * 用户 2026-09-16 试玩：「灯笼只有两盏，而且不够大，略小气。」
 * 0.32m 的宫灯挂在 13.76m 宽的五间门脸下，在 1600×900 的 `gate_approach`
 * 里只有十几个像素——**它不是"小灯笼"，它是读不出来**。0.56m 是按门屋
 * 尺度反推的：当心间 300 分 ≈ 3.3m，灯直径约占开间的 1/6，远看有分量、
 * 近看不至于把额枋压住。无出处(53 回只说「大明角燈」不给尺寸)，
 * 艺术取值，留痕在 `building.ts` 的 provenance.art。
 */
const R = 0.28;
/**
 * 灯身高。**不按半径同比放大**（同比是 0.74，这里取 0.60）。
 *
 * ⚠️ **`LANTERN_DROP` 有一条硬天花板，就在下面这几个数上。** `composer.ts`
 * 的 `lanternSpotsFor` 有一道通行净空闸：`hangY − LANTERN_DROP < 台基面 + 2.05`
 * 就**整盏不挂**——不报警、不降级，直接消失。全园最矮的那一处是潇湘馆正房
 * （`columnH` 3.2 / `puzuoH` 0 / 台基 0.45），它给的上限是 **`LANTERN_DROP` ≤ 1.12**。
 *
 * 单子 AU1 第一版按半径同比放到 `H 0.70 / ROD 0.30`，`DROP` = 1.35，
 * **潇湘馆那三盏当场全没了**（AU-before 的 manifest 里有、AU-after 里没有），
 * 而正门这边看起来一切正常——这类回归只有对着 manifest 数灯才看得见。
 * 现在这一组是 `DROP` = 1.04，离 1.12 还有 8cm。**再加大灯身之前先重算这条。**
 */
const H = 0.60;
/** 吊索长(原点 = 悬挂点，灯下挂)。不按灯身同比放大——放大了灯会垂到额枋以下。 */
const ROD = 0.17;
/** 灯顶木口到吊索下端的空当。 */
const NECK = 0.06;
/** 上下木口高。 */
const CAP_H = 0.08;
/** 流苏结长。 */
const TASSEL_H = 0.13;

/** 灯身直径。高照杆顶那盏与檐下同款同径，所以导出来给 `gaozhao.ts` 用。 */
export const LANTERN_DIAMETER = R * 2;

/**
 * 造一盏灯，原点在**悬挂点**(吊索顶端)。
 * 高照杆把它倒过来用(杆顶托住)，所以这里 export 出去，不重复造一份几何。
 */
export function buildLanternMesh(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Lantern';
  const wood = woodMaterial(CN.column, 1);
  const paper = lanternPaperShared();

  const topY = -ROD; // 灯顶(提梁处)
  // 吊索 + 提梁小结。
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, ROD, 6), wood);
  rod.position.y = -ROD / 2;
  g.add(rod);
  const knob = new THREE.Mesh(roundedBox(0.085, 0.055, 0.085, 0.015, 1), wood);
  knob.position.y = topY - 0.027;
  g.add(knob);
  // 六棱纸面(角灯之"角"):上下木口收住的六角筒。
  const bodyY = topY - NECK - H / 2;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 6, 1, true), paper);
  body.position.y = bodyY;
  body.castShadow = false;
  g.add(body);
  for (const s of [1, -1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R * 1.04, CAP_H, 6), wood);
    cap.position.y = bodyY + (s * (H + CAP_H)) / 2;
    cap.castShadow = true;
    g.add(cap);
  }
  // 六根立柱框条,贴在棱上。
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.038, H + 0.03, 0.038), wood);
    bar.position.set(Math.cos(a) * R, bodyY, Math.sin(a) * R);
    g.add(bar);
  }
  // 底部流苏结。
  const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.034, TASSEL_H, 6), wood);
  tassel.position.y = bodyY - H / 2 - CAP_H - TASSEL_H / 2;
  g.add(tassel);
  g.traverse((o) => {
    o.receiveShadow = true;
  });
  return g;
}

function buildLantern(): PartBuild {
  return { root: buildLanternMesh(), groundRadius: 0.7 };
}

/** 悬挂点(原点)到灯底的高度,装配器据此核通行净空。 */
export const LANTERN_DROP = ROD + NECK + H + CAP_H + TASSEL_H;

registerPart('lantern', (variant) => {
  if (variant !== 'default' && variant !== 'gong') throw new Error(`未登记灯笼变体 ${variant}`);
  return buildLantern();
});
