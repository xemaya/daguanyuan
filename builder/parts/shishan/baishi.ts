import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { baishiMaterial } from '@builder/parts/materials';
import { plaqueFromPlan } from '@builder/plan/objects';
import { inscriptionTexture } from '@builder/parts/xiaomu/plaque';
import type { Ball } from '@builder/parts/sculpt';
import {
  buildStone,
  fieldAt,
  piecewise,
  transformStone,
  type HoleLine,
  type MossSpec,
  type StoneResult,
  type StoneSpec,
} from '@builder/parts/shishan/taihu';
import { makeRng, rangeOf, clamp, lerp } from '@engine/core/Noise';

/**
 * 白石峰 — 零资产程序化。07-03「只見一帶翠嶂擋在前面……上面**白石峻嶒**,
 * 或如鬼怪,或如猛獸,**縱橫拱立**」。
 *
 * **为什么不是 `taihu.ts` 的第四个 variant**:太湖石与白石峰是两种石头。
 * 湖石的看点是"瘦漏皱透"——腰细、头大、满身穿孔;白石峰是石灰岩的**峰**,
 * 看点是"峻嶒拱立"——高、瘦、上半身撑住体量到临顶才收、顶上碎成几个尖,孔很少。
 * 这两件事全在**球场**里(剖面 + 瘤的走向 + 孔的多少),所以这个文件自己排球场,
 * 后面那条噪声/皱/AO/UV 流水线一字不改地复用 `taihu.ts` 的 `buildStone`。
 *
 * variant:
 *   peakN   独峰,有效顶 4.8–5.5m(`taihu:peak` 是 2.4–2.8m,正好一倍)
 *   groupN  3–5 块峰互相倾着的一组,合并成**一个 mesh**(一组一个 draw call)
 * 数字换种子与配置:`peak2` / `group3`。
 *
 * **倾**(「拱立」):每块峰的峰头朝组心倾 5–12°,靠竖向错切实现,见
 * `transformStone` 的 `lean` 参数注释(为什么是错切不是旋转)。
 *
 * 材质 `baishiMaterial()`:冷灰白、粗糙度 0.78–0.96、竖向层理、无脉纹
 * ——这一档的头号做坏法是做成大理石,三条都是冲着它去的。
 */

/* ------------------------------------------------------------------ */
/* 苔(单子 AM4)                                                        */
/* ------------------------------------------------------------------ */

/**
 * 「翠嶂」那个**翠**字。07-03 只说「白石峻嶒」,没说树——一带纯白的石屏叫不成
 * 「翠」嶂,绿是**石上的苔**。做法照 `taihu.ts` 顶点色的老路加一层
 *(`MossSpec` 的注释讲了为什么是「朝上 smoothstep × 低频噪声」这两件事),
 * **零三角、零 draw call**:改的只是已经存在的 color 属性里的数。
 *
 * 这几个数是对着 `baishi:group1` 的 front/side 棚拍调出来的,判据是
 * 「看得出白石上有苔斑、不是纯白也不是刷绿漆」——**判据机位是 `mound_west`**
 * (计划 §AM4 原文)。AM4 当时误按 `mound_block` 判(单子简报把机位名抄错了,
 * 收尾单已改正,见计划文档裁定三与 `tools/shot-list.mjs` 的 `mound_west` 注释);
 * 好在两镜对这一层的约束同向,下面的推理与数一个都不用改:
 *   - `up 0.05 / upSoft 0.5`:实算的这条曲线(`smoothstep(−0.45, 0.55, snormal.y)`)——
 *     朝天 33° 以上 **1.00**、仰 17° 的肩 **0.84**、**竖壁 0.42**、俯 12° 的檐下 0.16、
 *     俯 27° 以下 **0**。竖壁给 0.42 不给 0 是被判据机位逼出来的:
 *     `mound_west` 贴着石壁站,眼高 **6.14 m** 而峰顶 8–10 m,是**从下往上看**,
 *     朝天的那些面大半看不见(`mound_block` 眼高 5.6 m,更是同一回事)——
 *     苔只长在朝天面时,这两个机位上都一点绿也读不到。竖壁上长苔
 *     本来也是石灰岩的常态,成不成斑交给下面那条噪声去管。
 *   - `patch 0.85 m`:峰高 3–5 m,斑的特征尺度取到峰宽(≈1 m)这一档,
 *     一块峰身上四五处斑。再大就成了「半边绿半边白」,再小就碎成噪点(读作贴图)。
 *   - `coverage 0.05 / edge 0.28`:噪声超过 0.05 才起苔(约四成面积),0.28 的软边
 *     让斑心浓、斑缘散。覆盖率是这一层里最敏感的旋钮——调到 −0.2 就明显是
 *     刷绿漆了。
 *   - `strength 0.88`:斑心几乎盖成苔色。苔不是滤镜,浓处就该是绿的;
 *     石头的褶与 AO 在 `lerp` 之前已经乘进去了,斑里照样看得见石纹。
 *     1.0 在 side 机位的掠射光下把几处斑烧成了亮黄绿(读作漆),0.88 收得回来。
 */
const BAISHI_MOSS: MossSpec = {
  color: [0.20, 0.37, 0.15],
  up: 0.05,
  upSoft: 0.5,
  patch: 0.85,
  coverage: 0.05,
  edge: 0.28,
  strength: 0.88,
};

/* ------------------------------------------------------------------ */
/* 峰的剖面                                                            */
/* ------------------------------------------------------------------ */

/**
 * 峰剖面:t∈[0,1] 自下而上。与太湖石剖面的分水岭在**上半段**——湖石在 0.78 处
 * 鼓到腰宽 +0.16(头大于腰),峰在 0.72 处才刚收到腰宽,0.87 之后才塌下去,
 * 到顶剩 0.44。**上半身保持体量、临了才收**,不是一路匀着细下去——匀着细的是
 * 笋,不是峰。裙脚也只比腰宽一档(湖石是 1.6 倍),免得整块读成一个锥。
 */
function defaultPeakProfile(t: number, spec: StoneSpec): number {
  const w = spec.waist;
  const pts: [number, number][] = [
    [0, 1.0],
    [0.1, 0.93],
    [0.28, w + 0.12],
    [0.52, w + 0.02],
    [0.72, w * 0.92],
    [0.87, w * 0.74],
    [1, w * 0.4],
  ];
  return spec.width * 0.5 * piecewise(t, pts);
}

/* ------------------------------------------------------------------ */
/* 球场                                                                */
/* ------------------------------------------------------------------ */

/**
 * 题字石的剖面(单子 AM3)。峰剖面从脚到顶一路收(3.4 m → 尖),9 m 高的一块
 * 照它走**读作一个锥**;题字石要的是「竖长白石」——**近乎等宽的一柱**,
 * 到 0.86 才碎成几个尖。两条理由都是量出来的:
 *   ① 字面窗口开在 t≈0.8,照峰剖面那里只剩 1.2 m 宽,五个字的列贴上去两边
 *      各留 0.1 m,读成「一条纸贴在笋上」;等宽剖面在那里有 2.1 m 可用。
 *   ② 裙脚不外张(0.98 而不是 1.0 起跳、且腰不细下去),锥感的一半来自
 *      「脚比腰宽一大截」,收掉它剪影才立得住。
 * 0.86 以上照样塌到 0.4 并由 `buildPeakBalls` 的碎顶补三四个尖——**顶还是峰**,
 * 不是一块切平的板。
 */
function tabletProfile(t: number, spec: StoneSpec): number {
  const w = spec.waist;
  const pts: [number, number][] = [
    [0, 0.98],
    [0.1, 0.92],
    [0.3, w],
    [0.55, w],
    [0.75, w - 0.07],
    [0.86, w * 0.76],
    [1, w * 0.4],
  ];
  return spec.width * 0.5 * piecewise(t, pts);
}

/** 沿脊线堆球 + 竖棱 + 碎顶 + 少量贯穿孔 + 纵向凿沟。 */
function buildPeakBalls(
  spec: StoneSpec,
  peakProfile: (t: number, spec: StoneSpec) => number = defaultPeakProfile,
): { balls: Ball[]; holes: HoleLine[] } {
  const rng = makeRng(spec.seed);
  const H = spec.height;
  const plate = spec.plate ?? 1.3;
  const balls: Ball[] = [];
  const holes: HoleLine[] = [];

  // 脊线:脚下站得稳,偏移按 t² 加权只给上半段——「顶略歪」是顶歪,不是整根棍子斜。
  const leanX = rangeOf(rng, -0.085, 0.085);
  const leanZ = rangeOf(rng, -0.07, 0.07);
  const ph1 = rangeOf(rng, 0, Math.PI * 2);
  const ph2 = rangeOf(rng, 0, Math.PI * 2);
  const spine = (y: number): [number, number] => {
    const t = clamp(y / H, 0, 1);
    return [
      leanX * H * t * t + 0.045 * H * Math.sin(t * 2.3 + ph1) * t,
      leanZ * H * t * t + 0.035 * H * Math.sin(t * 1.8 + ph2) * t,
    ];
  };

  // 裙脚:压扁的大球贴地,最宽圈落在地面。
  {
    const r = peakProfile(0, spec) / 1.09;
    balls.push({
      x: 0,
      y: 0.02,
      z: 0,
      r: r * 0.98,
      sx: rangeOf(rng, 1.0, 1.12) * plate,
      sy: 0.5,
      sz: rangeOf(rng, 1.0, 1.12) / plate,
    });
  }

  // 主体。步长按高度取 ~18 段:峰比湖石高一倍、顶又收到腰宽的 0.40,
  // 沿用湖石的 H/8.5 步长时顶上那几颗球**够不着彼此**(球半径约 0.10 而间距 0.56),
  // 峰尖会碎成一串珠子甚至整段消失。这是这个文件不能直接借 `buildBalls` 的原因之一。
  const step = clamp(H / 18, 0.18, 0.32);
  const n = Math.max(6, Math.round(H / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = t * H;
    const [sx0, sz0] = spine(y);
    const pr = peakProfile(t, spec) / 1.09;
    balls.push({
      x: sx0 + rangeOf(rng, -0.025, 0.025) * spec.width,
      y,
      z: sz0 + rangeOf(rng, -0.02, 0.02) * spec.width,
      r: pr * 0.84,
      // 板状:峰立着看的是一个"面",X 宽 Z 薄。
      sx: rangeOf(rng, 0.95, 1.12) * plate,
      sy: rangeOf(rng, 1.15, 1.45),
      sz: rangeOf(rng, 0.95, 1.12) / plate,
    });
  }

  // 竖棱:贴着石身的纵向长瘤。「皱褶走纵向」在**形**上的那一半
  //(另一半在位移噪声与贴图的层理条纹里)。
  for (let i = 0; i < 3; i++) {
    const t0 = rangeOf(rng, 0.12, 0.5);
    const len = rangeOf(rng, 0.26, 0.46);
    const tc = clamp(t0 + len / 2, 0, 1);
    const [sx0, sz0] = spine(tc * H);
    const pr = peakProfile(tc, spec);
    const a = rangeOf(rng, 0, Math.PI * 2);
    const r = pr * rangeOf(rng, 0.4, 0.56);
    balls.push({
      x: sx0 + Math.cos(a) * pr * rangeOf(rng, 0.55, 0.8),
      y: tc * H,
      z: sz0 + Math.sin(a) * pr * rangeOf(rng, 0.55, 0.8),
      r,
      sx: rangeOf(rng, 0.8, 1.05),
      // 沿 y 拉到这条棱该有的长度(支撑半径是 2·r·sy)。
      sy: clamp((len * H) / (2 * r), 1.6, 6),
      sz: rangeOf(rng, 0.8, 1.05),
    });
  }

  // 碎顶与肩:半腰以上三四个次尖,有的贴着主脊做"肩",有的探出来做小峰头。
  // 「峻嶒」不是一根锥子磨尖,是**一堆尖**——剪影上必须有三处以上的断口,
  // 否则不论多瘦都读作蜡烛/笋。
  const teeth = rng() < 0.5 ? 3 : 4;
  for (let i = 0; i < teeth; i++) {
    const t = lerp(0.55, 0.95, (i + rangeOf(rng, 0.15, 0.85)) / teeth);
    const [sx0, sz0] = spine(t * H);
    const pr = peakProfile(t, spec);
    const a = rangeOf(rng, 0, Math.PI * 2);
    const out = rangeOf(rng, 0.75, 1.15);
    balls.push({
      x: sx0 + Math.cos(a) * pr * out,
      y: t * H + rangeOf(rng, 0.03, 0.13) * H,
      z: sz0 + Math.sin(a) * pr * out,
      r: pr * rangeOf(rng, 0.55, 0.85),
      sx: rangeOf(rng, 0.7, 0.95),
      sy: rangeOf(rng, 1.4, 2.2),
      sz: rangeOf(rng, 0.7, 0.95),
    });
  }

  // 台阶:两道压扁的负球横着切进石身,切出**折**——上面探出来一点,下面收进去
  // 一点。剪影只有竖沟没有横断口时,再瘦也是一根柱子;这两刀是"嶒"字。
  for (let i = 0; i < 2; i++) {
    const t = rangeOf(rng, 0.38, 0.8);
    const [sx0, sz0] = spine(t * H);
    const pr = peakProfile(t, spec);
    const a = rangeOf(rng, 0, Math.PI * 2);
    const r = pr * rangeOf(rng, 0.55, 0.8);
    balls.push({
      x: sx0 + Math.cos(a) * pr * rangeOf(rng, 1.0, 1.25),
      y: t * H,
      z: sz0 + Math.sin(a) * pr * rangeOf(rng, 1.0, 1.25),
      r,
      strength: rangeOf(rng, -1.0, -1.6),
      sx: rangeOf(rng, 1.3, 1.9),
      sy: rangeOf(rng, 0.3, 0.46),
      sz: rangeOf(rng, 1.3, 1.9),
    });
  }

  // 贯穿孔:比太湖石**少**(湖石一块三个,峰 0–1 个),而且压在半腰以下
  // ——白石是石灰岩峰,不是湖石的漏透。
  const span = spec.width * 1.6;
  for (let i = 0; i < spec.holes; i++) {
    const alongZ = i % 2 === 0;
    const t = lerp(0.28, 0.58, (i + rangeOf(rng, 0.3, 0.7)) / Math.max(1, spec.holes));
    const y = t * H;
    const [sx0, sz0] = spine(y);
    const pr = peakProfile(t, spec);
    const r = clamp(pr * rangeOf(rng, 0.26, 0.34), 0.06, 0.18);
    // 孔轴偏离脊线,留一侧厚壁,不然把峰切断。
    const side = rng() < 0.5 ? -1 : 1;
    const off = pr * rangeOf(rng, 0.25, 0.45) * side;
    const x = alongZ ? sx0 + off : sx0;
    const z = alongZ ? sz0 : sz0 + off;
    const axisScale = span / (2 * r);
    // 负球强度跟着这一点的实心场走,固定强度在厚处挖不穿。
    const f0 = fieldAt(balls, x, y, z);
    balls.push({
      x,
      y,
      z,
      r,
      // 比湖石再狠一档:峰在半腰处最厚(剖面最宽 + plate 最高到 1.6),
      // 照搬湖石的 1.6/0.8 会有孔挖不穿,剩一个瞎眼坑。
      strength: -(f0 * 1.9 + 1.0),
      sx: alongZ ? rangeOf(rng, 0.85, 1.1) : axisScale,
      sy: rangeOf(rng, 1.15, 1.5),
      sz: alongZ ? axisScale : rangeOf(rng, 0.85, 1.1),
    });
    holes.push(
      alongZ
        ? { a: [x, y, span], b: [x, y, -span], view: 'front' }
        : { a: [span, y, z], b: [-span, y, z], view: 'side' },
    );
  }

  // 纵向凿沟:不穿透的负球,沿 y 拉长贴在表面——竖着的深沟,不是圆坑。
  for (let i = 0; i < spec.pits; i++) {
    const t = rangeOf(rng, 0.1, 0.88);
    const [sx0, sz0] = spine(t * H);
    const pr = peakProfile(t, spec);
    const a = rangeOf(rng, 0, Math.PI * 2);
    const d = pr * rangeOf(rng, 0.95, 1.15);
    balls.push({
      x: sx0 + Math.cos(a) * d,
      y: t * H,
      z: sz0 + Math.sin(a) * d,
      r: pr * rangeOf(rng, 0.26, 0.4),
      strength: rangeOf(rng, -0.7, -1.15),
      sy: rangeOf(rng, 2.2, 3.8),
    });
  }

  return { balls, holes };
}

/* ------------------------------------------------------------------ */
/* 两个 variant                                                        */
/* ------------------------------------------------------------------ */

export interface BaishiGeometry {
  geo: THREE.BufferGeometry;
  holes: HoleLine[];
  /** 每块峰自己的几何 + 孔(组里校验透孔时,邻峰挡住不算)。 */
  stones: { geo: THREE.BufferGeometry; holes: HoleLine[] }[];
  groundRadius: number;
  /** 题字石才有:磨平面上那一列字该挂在哪(构件局部坐标),`cell` 是一个字的高。 */
  inscription?: { object: string; cx: number; cy: number; cz: number; width: number; cell: number };
}

function parseVariant(variant: string): { kind: 'peak' | 'group' | 'tablet' | 'skirt'; n: number } {
  const m = /^(peak|group|tablet|skirt)/.exec(variant);
  const kind = (m?.[1] as 'peak' | 'group' | 'tablet' | 'skirt' | undefined) ?? 'peak';
  const d = /(\d+)/.exec(variant);
  return { kind, n: d ? Number(d[1]) : 0 };
}

function buildPeak(n: number): BaishiGeometry {
  const seed = 8101 + n * 97;
  const rng = makeRng(seed);
  const spec: StoneSpec = {
    height: rangeOf(rng, 4.45, 5.15), // 有效顶 4.8–5.5m
    width: rangeOf(rng, 1.06, 1.2),
    waist: rangeOf(rng, 0.54, 0.62),
    holes: 1,
    pits: 5,
    cell: 0.04,
    wrinkle: 1.25,
    wrinkleFreq: 1.7,
    plate: rangeOf(rng, 1.3, 1.45),
    moss: BAISHI_MOSS,
    seed: seed + 1,
  };
  const r = buildStone(spec, buildPeakBalls(spec));
  return { geo: r.geo, holes: r.holes, stones: [r], groundRadius: 2.6 };
}

/**
 * 一组的构图。**不是等距一排**:一主(最高最粗)、两次、一到两配,
 * 位置错开成簇不是成线,高度 4.75→3.1 拉开档次——等高等距的四块是一排蛋。
 * `cell` 按块头递减(主峰最细,配石最粗):三角预算花在最先被看见的那块上。
 *
 * `height` 是脊线顶高,有效顶再高 0.1–0.4(碎顶那几颗球探出去的)。最矮的一块
 * 连同 ±6% 的抖动也要落在计划给的 **3–6m** 档里,所以下限压在 3.1 不再往下。
 */
interface Slot {
  x: number;
  z: number;
  height: number;
  width: number;
  cell: number;
  /** 朝组心倾的角度(度)。 */
  lean: number;
}

const GROUP: Slot[] = [
  { x: -0.25, z: -0.65, height: 4.75, width: 1.18, cell: 0.04, lean: 7 },
  { x: -1.55, z: 0.35, height: 4.05, width: 1.02, cell: 0.044, lean: 11 },
  { x: 1.3, z: 0.7, height: 3.5, width: 0.96, cell: 0.046, lean: 9.5 },
  { x: 0.62, z: -1.35, height: 3.2, width: 0.86, cell: 0.048, lean: 8 },
  { x: 2.25, z: -0.3, height: 3.1, width: 0.8, cell: 0.05, lean: 12 },
];

/** 一组几块:3–5 轮换,`group1`(单子 AM2 绑主组的那一个)是 4 块。 */
const GROUP_COUNT = [4, 4, 5, 3, 4, 5, 3];

function buildGroup(n: number): BaishiGeometry {
  const seed = 8301 + n * 97;
  const rng = makeRng(seed);
  const count = GROUP_COUNT[n % GROUP_COUNT.length];
  const j = (a: number) => rangeOf(rng, -a, a);
  const slots = GROUP.slice(0, count).map((s) => ({
    ...s,
    x: s.x + j(0.2),
    z: s.z + j(0.2),
    height: s.height * rangeOf(rng, 0.96, 1.06),
    yaw: rangeOf(rng, 0, Math.PI * 2),
  }));
  // 组心:落脚点的形心。峰头都朝它倾,才是「拱立」/「拱揖」——
  // 一组石头互相作揖,不是各自站岗。
  const cx = slots.reduce((a, s) => a + s.x, 0) / slots.length;
  const cz = slots.reduce((a, s) => a + s.z, 0) / slots.length;

  const results: StoneResult[] = [];
  slots.forEach((s, i) => {
    const spec: StoneSpec = {
      height: s.height,
      width: s.width,
      waist: rangeOf(rng, 0.54, 0.62),
      // 主峰留一个孔,其余多数无孔——峰不是湖石。
      holes: i === 0 || rng() < 0.4 ? 1 : 0,
      pits: 4,
      cell: s.cell,
      wrinkle: 1.25,
      wrinkleFreq: 1.7,
      // 板状程度拉开:有的从正面看是一片薄岩板,有的是一坨方墩。
      plate: rangeOf(rng, 1.15, 1.6),
      moss: BAISHI_MOSS,
      seed: seed + 11 + i * 13,
    };
    const built = buildStone(spec, buildPeakBalls(spec));
    // `s.lean` 是**摆放**倾角;量出来的"顶心相对底心"还要加上这块峰自己的
    // 「顶略歪」(脊线的 t² 偏移,最多再 7° 左右),所以实测值会超出 5–12 一点,
    // 那是石头自己的姿态,不是摆放角越界。
    const dx = cx - s.x;
    const dz = cz - s.z;
    const l = Math.hypot(dx, dz) || 1;
    const k = Math.tan((s.lean * Math.PI) / 180);
    results.push(transformStone(built, s.x, 0, s.z, s.yaw, { kx: (dx / l) * k, kz: (dz / l) * k }));
  });

  // 一组合并成一个 geometry = 一个 mesh = 一个 draw call(单子要求 ≤3)。
  const geo = mergeGeometries(
    results.map((r) => r.geo),
    false,
  )!;
  geo.computeBoundingBox();
  return { geo, holes: results.flatMap((r) => r.holes), stones: results, groundRadius: 4.4 };
}

/* ------------------------------------------------------------------ */
/* 石脚(单子 AV4)                                                      */
/* ------------------------------------------------------------------ */

/**
 * 石脚剖面:一块半埋的矮石。与峰剖面**相反**——峰是「上半身保持体量、临了才收」,
 * 石脚是「出土就最宽、一路塌下去」,顶只剩 0.30。理由是它要读成**从土里露出来的
 * 一截岩床**,不是一个缩小的峰:峰的剖面缩到 1.2 m 高只会得到一只白色的笋尖,
 * 剪影上与峰同形,五块摆在峰脚等于在柱阵下面再加一圈小柱阵。
 */
function skirtProfile(t: number, spec: StoneSpec): number {
  const w = spec.waist;
  const pts: [number, number][] = [
    [0, 1.0],
    [0.22, 0.98],
    [0.5, w + 0.18],
    [0.74, w - 0.06],
    [0.9, w * 0.62],
    [1, 0.30],
  ];
  return spec.width * 0.5 * piecewise(t, pts);
}

/**
 * 峰脚的断续石壁(`skirt3` / `skirt4` / `skirt5`,数字就是块数)。
 *
 * **病**(景需求文档 §6-4):峰直接从草皮里冒出来,读作石柱阵——「石为骨、土为肉」,
 * 骨露在外面而没有肉裹着的那一段,就是峰脚。实物旁证是环秀山庄:主峰不是插在地上的,
 * 它坐在一层层横着的石壁上,峰与地之间永远隔着几层**横的**东西。
 *
 * 所以这一档的三条形是冲着「横」去的,不是把峰缩小:
 *   - **矮而横**:实测单块 2.2–4.5 m 宽 × 1.0–1.8 m 深 × 1.0–1.8 m 高(`buildBaishiGeometry`
 *     逐块量的,不是 spec 上的标称宽——`plate` 把 X 撑开了一倍多)。宽高比 2.2–2.5,
 *     峰是 0.3 上下,差了将近一个数量级。整件 5.7 / 6.3 / 7.3 m 宽(三 / 四 / 五块),
 *     与一组峰的 4.2–6.1 m 同一档,一件正好顶住一组的脚。
 *   - `plate` 拉到 1.9–2.6(峰是 1.15–1.6):从正面看是一片**横着的岩板**,不是柱。
 *     摆放时 yaw 让板面大致顺着山脊,于是几件连起来读成一道断续的壁。
 *   - 剖面见 `skirtProfile`:出土最宽、顶上塌掉。
 *
 * **半埋不在这里做**:几何仍从 y=0 起算(`buildStone` 的 `clipToGround` 照旧把
 * y<0 削掉),埋多深由 scenes 的 `dy` 给——同一件构件在缓坡与陡坡上该埋的深浅不同,
 * 写死在几何里就没法按落点调。落位那边取 `dy` = −(0.30…0.40)×高。
 *
 * 三角预算:`cell` 取 0.12(峰是 0.04–0.05)。矮石体量只有峰的十分之一,照峰的 cell
 * 量出来一件 13–18 k 三角,比一整组峰的三分之一还多——把三角花在脚上、把预算从
 * 峰身上抢走,本末倒置。0.12 实测**三块 1 883 / 四块 2 247 / 五块 2 384 三角**,
 * 单件落在单子给的「≤2 k」档上下(五块超 19%,如实报,不靠降块数糊弄)。
 */
const SKIRT_SLOT: { x: number; z: number; height: number; width: number; lean: number }[] = [
  { x: -1.55, z: 0.20, height: 0.86, width: 1.70, lean: 5 },
  { x: 0.65, z: -0.40, height: 0.68, width: 1.40, lean: 8 },
  { x: 2.60, z: 0.30, height: 0.54, width: 1.15, lean: 6 },
  { x: -3.55, z: -0.45, height: 0.62, width: 1.28, lean: 9 },
  { x: 4.15, z: -0.22, height: 0.48, width: 0.95, lean: 7 },
];

function buildSkirt(n: number): BaishiGeometry {
  const count = clamp(Math.round(n), 3, 5);
  const seed = 8701 + count * 97;
  const rng = makeRng(seed);
  const j = (a: number) => rangeOf(rng, -a, a);
  const slots = SKIRT_SLOT.slice(0, count).map((s) => ({
    ...s,
    x: s.x + j(0.22),
    z: s.z + j(0.30),
    height: s.height * rangeOf(rng, 0.92, 1.1),
    yaw: rangeOf(rng, -0.45, 0.45),
  }));
  // 组心:石脚也「拱」,但拱的是**峰**不是彼此——峰在 +Z 的反面(北),
  // 所以每块朝 −Z 倾一点,顶偏向山里,像被峰压着长出来的。
  const results: StoneResult[] = [];
  slots.forEach((s, i) => {
    const spec: StoneSpec = {
      height: s.height,
      width: s.width,
      waist: rangeOf(rng, 0.62, 0.74),
      holes: 0,
      pits: 3,
      cell: 0.09,
      // 皱的**幅度**按 `max(0.5, height/2.6)` 给,矮石一律吃到 0.6 的下限——
      // 照峰的 wrinkle 1.25 算出来只有 0.041 m 的位移(峰是 0.126 m),
      // 于是一块 1.5 m 的石头在 10 m 外读成一张光板(第一版 `mound_block` 就是这么翻的车)。
      // 2.4 把幅度提到 0.079 m,与它自己的体量成比例。
      wrinkle: 2.4,
      // 频率:scale 吃下限之后 (3.0/0.6)=5.0 已经比峰的 2.05 细,再乘 0.62 收到 3.1——
      // 比峰细一档(石头越小纹路越细),又不至于碎成噪点。
      wrinkleFreq: 0.62,
      plate: rangeOf(rng, 1.9, 2.6),
      moss: BAISHI_MOSS,
      seed: seed + 17 + i * 13,
    };
    const built = buildStone(spec, buildPeakBalls(spec, skirtProfile));
    const k = Math.tan((s.lean * Math.PI) / 180);
    results.push(transformStone(built, s.x, 0, s.z, s.yaw, { kx: 0, kz: -k }));
  });
  const geo = mergeGeometries(
    results.map((r) => r.geo),
    false,
  )!;
  geo.computeBoundingBox();
  return { geo, holes: results.flatMap((r) => r.holes), stones: results, groundRadius: 2.2 };
}

/* ------------------------------------------------------------------ */
/* 题字石(单子 AM3)                                                    */
/* ------------------------------------------------------------------ */

/**
 * 「鏡面白石」——正面磨平一块、其余面照旧皱的竖长白石,给 `cuizhang.rock-02`
 * 题「曲徑通幽處」(07-78「抬頭忽見山上有鏡面白石一塊,正是迎面留題處」)。
 *
 * **为什么是 8.4 m 而不是单子写的 4.5–5.5 m。** 单子那个数是按「站在平地上的
 * 一块石头」给的;而锚点 (−34, 200) 的实测地形是 **−1.00 m** ——它落在西山口
 * 那道溪的**河床**里:溪面在 y=0,北岸(z=198)3.32 m、南岸(z=205)2.35 m,
 * 是一条约 4 m 宽、3.4 m 深的沟。`named[]` 的落位一律读 plan 锚点、不许带
 * dx/dz(`scenes.ts` 的契约),所以石头只能站在这个点上。于是:
 *   - 判断「大不大」的不是构件高度,是**顶在世界里的高度**。这块顶在 y=8.47;
 *     同一座山上五组白石峰的顶实测 8.02 / 8.59 / 9.20 / 9.58 / 10.05 ——
 *     **落在同一档里,一点不出挑**。
 *   - 它的构件高度比峰组大一倍(9.47 对 4.9–5.2),只因为**脚低了 4.6 m**:
 *     水面以下 1.0 m,露出北岸岸顶 5.15 m、露出南岸 6.12 m。多出来的那一截
 *     正是单子要的「嵌在西口山体里,半埋,不是立在平地上的碑」——在这个
 *     地形上只能这么实现。
 * 字心因此落在世界 y=**5.70**(= 局部 6.7 − 1.0),离**该处地面 6.70 m**
 *(判据要 ≥3.5),高过来路上人眼(cu_inscription 机位眼高 3.95)**1.75 m**
 * ——「抬頭」是真抬。
 *
 * 磨面走 `taihu.ts` 的 `flattenFace`(见那边的 `FlattenSpec` 注释):把正面一扇
 * 窗口里的顶点投到同一竖直面上,窗口外一点不碰。所以正面是一块磨平的字面、
 * 四周与顶上还是峰石的皱与碎尖——不是一块立起来的板。
 */
/**
 * 这一档只服务 `cuizhang.rock-02` 一个对象——与 `garden-building` 的 variant
 * 直接就是 plan 对象 id 同一路数。字**不写在这里**,按这个 id 去 plan 取
 * (99-26);真要给第二块题字石用,照 `wall.ts` 的做法把 id 编进 variant 串。
 */
const TABLET_OBJECT = 'cuizhang.rock-02';
/** 磨面窗口中心离石脚的高度(m)。字心、贴图面中心都跟着它。 */
const TABLET_FACE_Y = 6.7;
/** 一个字占的高度(m)。字数从 plan 的字串来,这里只定字号。 */
const TABLET_CELL = 0.5;

function buildTablet(n: number): BaishiGeometry {
  const seed = 8501 + n * 97;
  const rng = makeRng(seed);
  const spec: StoneSpec = {
    height: 8.4,
    width: 1.56,
    waist: rangeOf(rng, 0.93, 0.97),
    // 不开孔:一块要刻字的石头开个窟窿是自相矛盾;峰本来也只 0–1 个。
    // 凿沟也只留 2 道、`plate` 也从 1.55 收到 1.38:`pits` 的负球半径按剖面给,
    // 板再薄一点第 3 道就**打穿了**(侧视图上一条黑缝),与「不开孔」自相矛盾。
    holes: 0,
    pits: 2,
    cell: 0.055,
    wrinkle: 1.05,
    // 石头越高纹路越粗(见 StoneSpec.wrinkleFreq);8.4 m 这一档要 2.3 才把
    // 竖沟收回人眼尺度,照 peak 的 1.7 会拉成从顶流到底的一条。
    wrinkleFreq: 2.3,
    plate: 1.38,
    // 不给苔(单子 AM4 裁定回合修正):磨面法线并不是水平的 +Z——磨面窗口只是把
    // 顶点**位置**投平,顶点法线仍按原石身算,`up` 判据在那里读出来是 0.425
    // (与竖壁同档),不是 0。字面窗口整个落在苔斑可及的范围内,冒着把刻字
    // 磨面弄花的风险(违背 AM3「鏡面白石」/07-01「並無朱粉塗飾」的立意)换一点
    // 装饰,不值——题字石本来就不需要长苔。
    seed: seed + 1,
  };
  const made = buildPeakBalls(spec, tabletProfile);
  // 磨面的横向中心不能写死 0:脊线的「顶略歪」在 8.4 m 上能把上半身带出 ±0.6 m,
  // 窗口照 x=0 开就开到了石头边上。按窗口高度那一带主体球的实际 x 取中。
  const near = made.balls.filter((b) => (b.strength ?? 1) > 0 && Math.abs(b.y - TABLET_FACE_Y) < 0.6);
  const cx = near.length ? near.reduce((a, b) => a + b.x, 0) / near.length : 0;
  // 椭圆窗口 1.7×4.0 m,把 0.8×2.5 m 的字列整个套进核心区(字的四角归一化半径
  // 0.78,落在 feather 0.2 的核心内)。磨面必须**包住**字:卡着字开的话,
  // 窗外留下的皱会在掠射角度横穿到字面前头,把笔画啃掉一截。
  spec.flatten = { cx, cy: TABLET_FACE_Y, hx: 0.85, hy: 2.0, feather: 0.2, q: 0.5 };
  const r = buildStone(spec, made);
  return {
    geo: r.geo,
    holes: r.holes,
    stones: [r],
    groundRadius: 2.2,
    inscription: {
      object: TABLET_OBJECT,
      cx,
      cy: TABLET_FACE_Y,
      // 贴在磨面前 2.5 cm:再近会与石面 z-fighting,再远字会从面上「浮」起来。
      cz: (r.flatZ ?? 0.3) + 0.025,
      width: 0.8,
      cell: TABLET_CELL,
    },
  };
}

/**
 * 每块峰的**峰顶与两肩**(构件局部坐标;单子 AV3)。
 *
 * 藤萝要「自峰顶垂落」(07-03「藤蘿掩映」)。旧实现把四个锚点写死在
 * `vegetation.ts` 里,再拿**地形高度场**去扫这四个点附近的最高处——峰是构件、
 * 不在高度场里,于是扫出来的"最高点"永远只是土坡,`best.y > baseY + 0.8` 这条
 * 门槛一次也没过,藤萝 mesh 从来没建出来过(景需求文档 §5 实测 0 根)。
 * 这个函数把锚点的来源换成**石头自己的几何**:不猜、不扫地形,一动峰就跟着动。
 *
 * 判法:逐块峰取顶点里 y 最大的那个当**顶**;再把顶点按绕该块中心的方位角分 8 扇,
 * 每扇取各自的最高点,在其中挑两处当**肩**——要求 (a) 高度不低于该块顶的 0.55,
 * (b) 水平离顶至少 0.35 m(挨着顶的那一圈仍是顶,不是肩)。
 * 返回顺序:每块「顶、肩、肩」,块与块之间按顶高从高到低。挂几条、挂哪一面
 * 由调用方挑(背阴面是北 / 西北)。
 */
export interface BaishiCrownPoint {
  x: number;
  y: number;
  z: number;
  /** 'top' = 峰顶,'shoulder' = 肩。 */
  kind: 'top' | 'shoulder';
  /** 第几块峰(按顶高降序)。 */
  stone: number;
}

export function baishiCrownPoints(variant: string): BaishiCrownPoint[] {
  const g = buildBaishiGeometry(variant);
  const stones = g.stones.map((st) => {
    st.geo.computeBoundingBox();
    return { geo: st.geo, top: st.geo.boundingBox!.max.y, box: st.geo.boundingBox! };
  });
  stones.sort((a, b) => b.top - a.top);
  const out: BaishiCrownPoint[] = [];
  stones.forEach((st, si) => {
    const pos = st.geo.attributes.position as THREE.BufferAttribute;
    const cx = (st.box.min.x + st.box.max.x) / 2;
    const cz = (st.box.min.z + st.box.max.z) / 2;
    const SECTORS = 8;
    const best: ({ x: number; y: number; z: number } | null)[] = new Array(SECTORS).fill(null);
    let top: { x: number; y: number; z: number } | null = null;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!top || y > top.y) top = { x, y, z };
      const a = Math.atan2(z - cz, x - cx);
      const k = Math.min(SECTORS - 1, Math.floor(((a + Math.PI) / (Math.PI * 2)) * SECTORS));
      if (!best[k] || y > best[k]!.y) best[k] = { x, y, z };
    }
    if (!top) return;
    out.push({ ...top, kind: 'top', stone: si });
    const shoulders = best
      .filter((b): b is { x: number; y: number; z: number } => !!b)
      .filter((b) => b.y >= st.top * 0.55 && Math.hypot(b.x - top!.x, b.z - top!.z) >= 0.35)
      .sort((a, b) => b.y - a.y)
      .slice(0, 2);
    for (const sh of shoulders) out.push({ ...sh, kind: 'shoulder', stone: si });
  });
  return out;
}

/** 纯几何入口(可在 node 里跑校验,不碰材质)。 */
export function buildBaishiGeometry(variant: string): BaishiGeometry {
  const { kind, n } = parseVariant(variant);
  if (kind === 'tablet') return buildTablet(n);
  if (kind === 'skirt') return buildSkirt(n);
  return kind === 'group' ? buildGroup(n) : buildPeak(n);
}

registerPart('baishi', (variant): PartBuild => {
  const g = buildBaishiGeometry(variant);
  const mesh = new THREE.Mesh(g.geo, baishiMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const root = new THREE.Group();
  root.add(mesh);
  if (g.inscription) {
    const ins = g.inscription;
    // 字面的真源是 plan.json(99-26「构件不写文字面量」);plan 没注入就不挂字,
    // 不回落字面量——屏幕上少一列字是数据的话,不是构件的话。
    const text = plaqueFromPlan(ins.object) ?? '';
    if (text) {
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(ins.width, ins.cell * text.length),
        new THREE.MeshStandardMaterial({
          map: inscriptionTexture(text),
          // 空白处直接丢掉:字以外的像素不写深度,免得一整块透明面参与排序、
          // 在草叶/竹子前后来回跳。不带 transparent——alphaTest 已经把它归到不透明
          // 队列(项目里 vegetation.ts/bamboo.ts/distant/scene.ts 的所有 alpha-cut
          // 材质都是这个搭配,没有一处再加 transparent),alphaToCoverage 吃掉硬切边缘。
          alphaTest: 0.2,
          alphaToCoverage: true,
          // 比石身(0.78–0.96)润一档,不上亮面——这园子没有一处磨光大理石。
          roughness: 0.62,
          metalness: 0,
        }),
      );
      face.position.set(ins.cx, ins.cy, ins.cz);
      // 石身两个 flag 都开;字面是薄贴面,只收阴影不投——它紧贴石身表面 2.5cm,
      // 自己投影到石头上会在字缝里叠一层多余的暗边,像素级没有意义还可能穿帮。
      face.receiveShadow = true;
      root.add(face);
    }
  }
  root.userData.holes = g.holes;
  return { root, groundRadius: g.groundRadius };
});
