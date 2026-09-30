import * as THREE from 'three';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { whiteStoneMaterial, whiteStoneMaps } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { XIFANCAO_SEEDS } from '@builder/parts/ornament/pattern2d';
import {
  makeScrollBand, buildReliefBandGeometry, buildReliefBandPlane, bakeReliefBandMaps,
  type ReliefBand,
} from '@builder/parts/ornament/relief';

/**
 * 西番草浮雕**样件**(单子 AO)——一份纹样的两种输出,以及它们的棚拍身份。
 *
 * 带子的尺寸住在这里、不住在 `forecourt-terrace.ts`,因为消费它的有三方:
 * 台矶(落位)、`texture-jobs.ts`(预热)、棚拍台(取证)。落位参数才是台矶的事。
 *
 * **为什么单独登记成一个构件**:园里的机位站在 1.62m 的人眼上,浮雕在 0.19m
 * 的陡板上——站得再近,视线与石面的夹角也压到 50° 以上,一条 0.11m 的带子
 * 在 1600×900 里最多占 32px(站距 1.4m 时的极值,再近反而更斜)。**"贴脸"
 * 这件事在园内机位里做不到**,得让棚拍台按构件自动取景。园内那两个
 * `cu_scroll_*` 机位保留,但它们证的是"在真太阳下、在真台矶上成不成立",
 * 不是"看不看得清工"。
 */

/* ---- 带子的尺寸(艺术选择,留痕在 forecourt-terrace 的 provenance.art) ---- */

/** 样件长(米)。必须是单元长的整数倍。 */
export const SAMPLE_LEN = 1.8;
/** 一个纹样单元的长度(米)。1.8 / 0.18 = 10 格,四个种子轮排。 */
export const SAMPLE_CELL = 0.18;
/** 带高(米)。陡板净高 0.195m,带子居中,上下各留一线石面。 */
export const SAMPLE_BAND_H = 0.11;
/** 几何版的网格步长(米)。浮雕 4mm 高、软边 2mm,4mm 一格是采得住的上限。 */
export const SAMPLE_STEP = 0.004;
/** 贴图版两张图的边长。 */
export const SAMPLE_TEX = 512;

/** 特写用的短带:两格,棚拍台按包围盒取景才够"贴脸"(见文件头)。 */
export const SAMPLE_DETAIL_CELLS = 2;

export function scrollSampleBand(cells = SAMPLE_LEN / SAMPLE_CELL): ReliefBand {
  return makeScrollBand(cells * SAMPLE_CELL, SAMPLE_BAND_H, SAMPLE_CELL, XIFANCAO_SEEDS);
}

/** 预热贴图版的两张图(Worker 预热链调用,见 `builder/compose/texture-jobs.ts`)。 */
export function bakeScrollSampleMaps(): void {
  bakeReliefBandMaps(scrollSampleBand(), SAMPLE_TEX);
}

/** 把共享的白石贴图克隆一份,uv 改按米读——与几何版的 boxProjectedUV 对齐。 */
function metricClone(t: THREE.Texture | null, w: number, h: number): THREE.Texture | null {
  if (!t) return null;
  const c = t.clone();
  c.repeat.set(w, h);
  c.offset.set(-w / 2, -h / 2);
  c.needsUpdate = true;
  return c;
}

export type ReliefMode = 'geo' | 'tex';

/**
 * 样件的两种输出。局部坐标:带心在原点,+Z 朝外。
 *
 * - `geo`:带状网格,顶点沿法线位移 h。材质就是台矶自己的白石 fine 档,
 *   合并器把它并进同一个桶——**draw call 不涨**。
 * - `tex`:一块平面片 + 同一个 h 烤出来的法线/遮蔽。材质独一份,多一个 draw call。
 *   底色与粗糙度仍走白石 fine 档,并把 uv 折成米,好让两版逐像素可比;代价是
 *   石头自己的微观法线让位给了浮雕法线(一张材质只有一张 normalMap)。
 *   另一项代价写在 `bakeReliefBandMaps` 的注释里:整条 1.8m×0.11m 的带子挤进
 *   一张方图,沿带方向每纹素 3.5mm、横向 0.22mm——沿带是欠采的。这两项差异
 *   在几米外读不出来、在一米内读得出来,**本单量的就是这个分界**。
 */
export function buildScrollSample(mode: ReliefMode, stone: THREE.Material, band = scrollSampleBand()): THREE.Mesh {
  if (mode === 'geo') {
    const mesh = new THREE.Mesh(buildReliefBandGeometry(band, SAMPLE_STEP, SAMPLE_STEP), stone);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  const maps = bakeReliefBandMaps(band, SAMPLE_TEX);
  const base = whiteStoneMaps(1024, 'fine');
  const mat = new THREE.MeshStandardMaterial({
    map: metricClone(base.map, SAMPLE_LEN, SAMPLE_BAND_H),
    roughnessMap: metricClone(base.roughnessMap, SAMPLE_LEN, SAMPLE_BAND_H),
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(maps.normalScale[0], maps.normalScale[1]),
    aoMap: maps.aoMap,
    roughness: 1,
    metalness: 0,
  });
  const geo = buildReliefBandPlane(band);
  // aoMap 默认读第二套 uv;这块面片只有一套,补一份同值的 uv1。
  geo.setAttribute('uv1', (geo.attributes.uv as THREE.BufferAttribute).clone());
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.keep = true; // 材质独一份,说清不进白石合并桶
  return mesh;
}

/* ---- 棚拍身份 -------------------------------------------------------- */

/** 棚拍衬板:一段陡板石(净高 0.195m),让浮雕有石面可落,不是浮在空中。 */
const BACKING_H = 0.195;
const BACKING_T = 0.06;

/**
 * `scroll-relief:<geo|tex>[-detail]`。
 *
 * `-detail` 只铺两格、衬板也收到贴着带边——棚拍台按包围盒取景,构件越小
 * 机位越近,`detail` 的等效视距约 0.9m,整带版约 3.9m。本单要的"贴脸 0.6m"
 * 就靠这一档,不靠改棚拍台的取景逻辑(那是别人的文件)。
 */
registerPart('scroll-relief', (variant): PartBuild => {
  const detail = variant.endsWith('-detail');
  const mode: ReliefMode = variant.startsWith('tex') ? 'tex' : 'geo';
  const band = scrollSampleBand(detail ? SAMPLE_DETAIL_CELLS : SAMPLE_LEN / SAMPLE_CELL);
  const backH = detail ? SAMPLE_BAND_H + 0.05 : BACKING_H;
  const root = new THREE.Group();
  root.name = `ScrollRelief_${variant}`;
  const back = new THREE.Mesh(
    roundedBox(band.lengthM + (detail ? 0.06 : 0.16), backH, BACKING_T, 0.008, 1),
    whiteStoneMaterial(1, 'rough'),
  );
  back.position.set(0, backH / 2, BACKING_T / 2);
  back.receiveShadow = true;
  back.castShadow = true;
  root.add(back);
  const mesh = buildScrollSample(mode, whiteStoneMaterial(1), band);
  mesh.position.set(0, backH / 2, BACKING_T + 0.001);
  root.add(mesh);
  return { root, groundRadius: band.lengthM * 0.75 };
});
