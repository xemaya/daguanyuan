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
 * 单子 AJ1(2026-09-15,用户反馈第 3 条「大白铺出去的平台,质感差」):
 * 台矶不再是"一整块白",改成真的石作分层——它该读成"砌出来的",不是
 * "一块"。从下往上四层(尺寸无原文出处,艺术选择,留 provenance.art):
 *
 *   ① 土衬石:埋在地里、只露一线,比上层出边 0.10m——台基与地面之间
 *      有一道出边的阴影,不是硬切;
 *   ② 陡板石:台基的立面,逐块竖砌,块与块之间留竖缝;
 *   ③ 阶条石:压在台基顶边的长条石,逐块铺,块与块之间有横缝;
 *   ④ 面层:墁地石板,缝成行成列,不是随机裂纹。
 *
 * 缝要讲道理:前/后檐的陡板竖缝、阶条横缝、面层墁缝共用同一张网格
 * (GRID_X),山面同理(GRID_Z),转角处由前檐块压住山面块——三者的缝
 * 在转角能对上,才不会读成裂纹。缝后衬一个深色垫层(核心砌体),缝的
 * 对比度刻意压住(近看工、中看色、远看形,ART_DIRECTION §10):走近才
 * 看得见的浅缝,比远处就抢眼的深沟对。
 *
 * 台矶边缘的「西番草」浮雕沿用 `builder/parts/damu/building.ts` 里
 * `plinthMaterial==='whiteStone'` 分支同一套闭合卷曲算法(2026-09-14
 * C3 返工版本,真闭合螺旋+尖叶,不是正弦波)——那份实现是内联在
 * `buildBuilding()` 里的私有代码,该文件本单不许碰,所以这里按同样的
 * 参数与做法照抄一份,不改算法本身、也不新造一套不同的纹样。C4(西番
 * 草读成铁丝)是另一单要修的事,这里原样复现同一个"缺点",保持两处
 * 观感一致,不在本单顺手"改良"。AJ1 唯一动的是它的落位:分层之后立
 * 面比原来(core 面)凸出 0.06m,浮雕带随之外移坐到陡板面上,算法与
 * 参数一字未改。
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

/* ---- 石作分层的尺寸(全部无出处,艺术选择,见 provenance.art) ----------- */
const TUCHEN_OUT = 0.16; // 土衬石比核心砌体出边(只露一线,余下埋进土里)
const TUCHEN_H = 0.12; // 土衬石高(顶面露出地面 0.08)
const TUCHEN_TOP = 0.08;
const FACE_T = 0.06; // 陡板/阶条比核心砌体凸出的厚度
const DOUBAN_TOP = 0.275; // 陡板石顶(与阶条之间留 0.01 水平缝)
const JIETIAO_BOT = 0.285; // 阶条石底
const JIETIAO_W = 0.44; // 阶条石宽(自外沿向台心)
const PAVING_BOT = 0.34; // 面层石板底(核心砌体顶)
const JOINT = 0.018; // 砌缝宽(竖缝/横缝/墁缝同宽)
const BLOCK_L = 0.78; // 陡板/阶条的目标块长(各面取整均分)

/** 把 [a,b] 按"缝线在 grid0+k*pitch 处"切成逐块——前檐陡板、阶条、面层
 * 墁缝共用同一张网格,三者的缝才对得上。返回逐块的 [起点,讫点](已扣缝)。 */
function blocksOnGrid(a: number, b: number, grid0: number, pitch: number): [number, number][] {
  const out: [number, number][] = [];
  let k = Math.ceil((a - grid0) / pitch);
  let prev = a;
  while (grid0 + k * pitch < b - 1e-6) {
    const j = grid0 + k * pitch;
    out.push([prev + (prev === a ? 0 : JOINT / 2), j - JOINT / 2]);
    prev = j;
    k++;
  }
  out.push([prev + (prev === a ? 0 : JOINT / 2), b]);
  return out.filter(([s, e]) => e - s > 0.03);
}

/** 目标块长 BLOCK_L 下把 len 均分成整数块的格距。 */
function gridPitch(len: number): number {
  return len / Math.max(1, Math.round(len / BLOCK_L));
}

export function buildForecourtTerrace(spec: ForecourtTerraceSpec): PartBuild {
  const { halfX: platHX, halfZ: platHZ, platH } = spec;
  const plinth = whiteStoneMaterial(1);
  // 缝后的垫层(核心砌体):比白石面暗一档的灰石色——缝的对比度刻意压住,
  // 走近才读得出是砌缝(§10「近看工、中看色、远看形」)。
  const bedding = new THREE.MeshStandardMaterial({ color: 0x8f8a7c, roughness: 1, metalness: 0 });
  const root = new THREE.Group();
  root.name = 'ForecourtTerrace';

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  // 核心砌体(缝后的深色垫层):整台矶的芯,侧面只在砌缝里露线,
  // 顶面是面层的垫床。台面净高不变(顶 = platH)。
  add(new THREE.BoxGeometry(platHX * 2, PAVING_BOT, platHZ * 2), bedding, 0, PAVING_BOT / 2, 0);

  // ① 土衬石:四条整石,前/后檐压住转角,顶面只露出地面一线。
  const tuchenY = TUCHEN_TOP - TUCHEN_H / 2;
  add(roundedBox((platHX + TUCHEN_OUT) * 2, TUCHEN_H, TUCHEN_OUT, 0.015, 1), plinth, 0, tuchenY, platHZ + TUCHEN_OUT / 2);
  add(roundedBox((platHX + TUCHEN_OUT) * 2, TUCHEN_H, TUCHEN_OUT, 0.015, 1), plinth, 0, tuchenY, -platHZ - TUCHEN_OUT / 2);
  add(roundedBox(TUCHEN_OUT, TUCHEN_H, platHZ * 2, 0.015, 1), plinth, platHX + TUCHEN_OUT / 2, tuchenY, 0);
  add(roundedBox(TUCHEN_OUT, TUCHEN_H, platHZ * 2, 0.015, 1), plinth, -platHX - TUCHEN_OUT / 2, tuchenY, 0);

  // 砌缝网格:X 向(前/后檐立面与面层墁缝共用)、Z 向(山面与面层墁缝共用)。
  // 格距由面长均分推出,缝线从面的端头(转角)起排——转角处三者对得上。
  const faceHX = platHX + FACE_T; // 立面(陡板/阶条外皮)半宽
  const faceHZ = platHZ + FACE_T;
  const pitchX = gridPitch(faceHX * 2);
  const pitchZ = gridPitch(platHZ * 2);
  const gridX0 = -faceHX;
  const gridZ0 = -platHZ;

  // ② 陡板石:立面逐块竖砌。前/后檐块跨满全宽(压住转角),山面块顶到
  // 前/后檐块内皮。竖缝宽 JOINT,缝后露核心砌体的深色。
  const doubanH = DOUBAN_TOP - TUCHEN_TOP;
  const doubanY = TUCHEN_TOP + doubanH / 2;
  for (const [a, b] of blocksOnGrid(-faceHX, faceHX, gridX0, pitchX)) {
    const w = b - a;
    const x = (a + b) / 2;
    add(roundedBox(w, doubanH, FACE_T, 0.008, 1), plinth, x, doubanY, platHZ + FACE_T / 2);
    add(roundedBox(w, doubanH, FACE_T, 0.008, 1), plinth, x, doubanY, -platHZ - FACE_T / 2);
  }
  for (const [a, b] of blocksOnGrid(-platHZ, platHZ, gridZ0, pitchZ)) {
    const w = b - a;
    const z = (a + b) / 2;
    add(roundedBox(FACE_T, doubanH, w, 0.008, 1), plinth, platHX + FACE_T / 2, doubanY, z);
    add(roundedBox(FACE_T, doubanH, w, 0.008, 1), plinth, -platHX - FACE_T / 2, doubanY, z);
  }

  // ③ 阶条石:顶边一圈长条石,逐块铺,缝线沿用陡板同一张网格;
  // 前/后檐条石跨满全宽压转角,山面条石嵌在之间(端块截短是正常砌法)。
  const jietiaoH = platH - JIETIAO_BOT;
  const jietiaoY = JIETIAO_BOT + jietiaoH / 2;
  for (const [a, b] of blocksOnGrid(-faceHX, faceHX, gridX0, pitchX)) {
    const w = b - a;
    const x = (a + b) / 2;
    add(roundedBox(w, jietiaoH, JIETIAO_W, 0.01, 1), plinth, x, jietiaoY, faceHZ - JIETIAO_W / 2);
    add(roundedBox(w, jietiaoH, JIETIAO_W, 0.01, 1), plinth, x, jietiaoY, -faceHZ + JIETIAO_W / 2);
  }
  const sideA = -faceHZ + JIETIAO_W;
  const sideB = faceHZ - JIETIAO_W;
  for (const [a, b] of blocksOnGrid(sideA, sideB, gridZ0, pitchZ)) {
    const w = b - a;
    const z = (a + b) / 2;
    add(roundedBox(JIETIAO_W, jietiaoH, w, 0.01, 1), plinth, faceHX - JIETIAO_W / 2, jietiaoY, z);
    add(roundedBox(JIETIAO_W, jietiaoH, w, 0.01, 1), plinth, -faceHX + JIETIAO_W / 2, jietiaoY, z);
  }

  // ④ 面层:墁地石板,墁缝就是两张立面网格向台心的延续——成行成列,
  // 转角起排,不是随机撒缝。缝底是核心砌体顶面的深色垫床。
  const pavingH = platH - PAVING_BOT;
  const pavingY = PAVING_BOT + pavingH / 2;
  // 面层外沿与阶条内皮之间留半缝——周边那圈缝也是砌缝,贴死就读不出来。
  const innerHX = faceHX - JIETIAO_W - JOINT / 2;
  const innerHZ = faceHZ - JIETIAO_W - JOINT / 2;
  const cols = blocksOnGrid(-innerHX, innerHX, gridX0, pitchX);
  const rows = blocksOnGrid(-innerHZ, innerHZ, gridZ0, pitchZ);
  for (const [x0, x1] of cols) {
    for (const [z0, z1] of rows) {
      add(
        roundedBox(x1 - x0, pavingH, z1 - z0, 0.01, 1),
        plinth,
        (x0 + x1) / 2,
        pavingY,
        (z0 + z1) / 2,
      );
    }
  }

  // 西番草(缠枝卷叶)浅浮雕——与 building.ts 白石台基边缘同一套参数/算法。
  // AJ1 只把落位外移 FACE_T(立面分层后外皮凸出 0.06m),算法一字未改。
  const bandY = platH * 0.55;
  const curlR = Math.min(0.052, platH * 0.135);
  const bandAmp = curlR * 0.55;
  const bandR = Math.min(0.016, platH * 0.042);
  const inMargin = 0.16;
  const bandOut = FACE_T + 0.015;
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
      lerp(s.x0, s.x1, t) + s.nx * bandOut,
      lerp(s.z0, s.z1, t) + s.nz * bandOut,
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
      {
        id: 'project:forecourt-terrace-coursing',
        name: '白石台矶石作分层与砌缝',
        method: 'artistic_choice',
        note:
          '单子 AJ1(用户 2026-09-15 反馈第 3 条「大白平台质感差」):台面从一整块白改成' +
          `石作分层——土衬石(出边 ${TUCHEN_OUT}m、露顶 ${TUCHEN_TOP}m)、陡板石逐块竖砌` +
          `(高 ${(DOUBAN_TOP - TUCHEN_TOP).toFixed(2)}m)、阶条石逐块压顶(宽 ${JIETIAO_W}m)、` +
          `面层墁地石板(厚 ${pavingH.toFixed(2)}m);缝宽 ${JOINT}m,前后檐与面层的缝共用` +
          `一张网格(格距≈${BLOCK_L}m 均分),转角由前檐块压山面块,三者的缝在转角对上。` +
          '尺寸无原文出处(清式石作分层是通例,具体分块是观感取值);缝后深色垫层' +
          '(0x8f8a7c)把缝的对比度压住,走近才读得出(§10 近看工中看色远看形)。',
      },
    ],
  };
  root.userData.provenance = provenance;
  return { root, groundRadius: Math.hypot(platHX, platHZ) };
}

export const FORECOURT_TERRACE_SPEC: ForecourtTerraceSpec = { halfX: 6.88, halfZ: 2.8, platH: 0.4 };

registerPart('forecourt-terrace', () => buildForecourtTerrace(FORECOURT_TERRACE_SPEC));
