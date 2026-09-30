import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerPart } from '@builder/parts/registry';
import { stoneMaterial } from '@builder/parts/materials';
import { roundedBox, noiseDisplace, boxProjectedUV } from '@builder/parts/sculpt';
import { makeRng, rangeOf, clamp } from '@engine/core/Noise';

/**
 * 水边石作:曲桥、驳岸、石栏。
 *
 * 全部青石,一种材质、一次 draw。每块石头都是 roundedBox 倒角 + 种子随机的
 * 微旋转/微缩放/微位移,再用顶点色给每块一个略不同的灰,让拼缝读得出来。
 *
 * 约定:原点地面中心,+Z 正面,水面 y=0。
 *   zigzag  三折曲桥,9m 跨,桥面 y=0.35,像 ⌐¬⌐ 三段错开 1.5m。
 *   bank    4m 驳岸模块,XZ 平面 sin 微弯,首尾 z=0 且切线一致,可首尾相接。
 *   railing 3m 独立石栏(望柱+栏板+地栿),亭台复用。
 */

/* ------------------------------------------------------------------ */
/* 尺寸表(米)                                                          */
/* ------------------------------------------------------------------ */

const DECK_Y = 0.35; // 桥面
const DECK_W = 1.5; // 桥面宽
const SLAB_T = 0.08; // 石板厚
const SLAB_PITCH = 0.4; // 石板宽(沿行进方向)
const GAP = 0.005; // 板缝
const BEAM_T = 0.12; // 板下石梁
const PIER_S = 0.25; // 墩 见方
const PIER_BOTTOM = -0.6;
const STEP_Y = 0.15;

const RAIL_H = 0.45; // 栏总高(柱顶,帽另加)
const POST_S = 0.15; // 望柱 见方
const PANEL_T = 0.08; // 栏板厚
const SILL_H = 0.05; // 地栿高
const SILL_W = 0.2;
const PANEL_TOP = 0.34;

/* ------------------------------------------------------------------ */
/* 石块收集器                                                            */
/* ------------------------------------------------------------------ */

type Rng = () => number;

interface BlockOpts {
  /** 顶点色明度,1 = 原色。 */
  tint?: number;
  /** 顶点色微偏色(冷/暖),-1..1。 */
  hue?: number;
  /** 绕各轴随机微旋转上限(弧度)。 */
  jitterRot?: number;
  /** 随机微缩放上限。 */
  jitterScale?: number;
  /** 风化位移幅度(米),0 = 不做。 */
  weather?: number;
  weatherFreq?: number;
  /** 贴图投影缩放。 */
  uvScale?: number;
  /** 倒角。 */
  radius?: number;
  segments?: number;
}

/**
 * 把一堆石块攒成一张几何。每块独立倒角、独立扰动,最后合并成一个 mesh,
 * 一个材质,一次 draw call;顶点色装每块的灰度差。
 */
class StoneBatch {
  private geos: THREE.BufferGeometry[] = [];
  private seq = 0;
  constructor(private rng: Rng, private seed: number) {}

  /**
   * @param w,h,d 尺寸;@param p 中心;@param rotY 主朝向(绕 Y);
   */
  add(w: number, h: number, d: number, p: THREE.Vector3, rotY = 0, o: BlockOpts = {}): void {
    const rng = this.rng;
    const radius = o.radius ?? 0.02;
    const seg = o.segments ?? 2;
    const g = roundedBox(w, h, d, radius, seg);
    this.seq++;

    if (o.weather && o.weather > 0) {
      noiseDisplace(g, o.weather, o.weatherFreq ?? 4, this.seed * 131 + this.seq * 7, 3);
    }

    const jr = o.jitterRot ?? 0;
    const js = o.jitterScale ?? 0;
    const s = 1 + rangeOf(rng, -js, js);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rangeOf(rng, -jr, jr), rotY + rangeOf(rng, -jr, jr), rangeOf(rng, -jr, jr), 'YXZ'),
    );
    const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(s, s, s));
    g.applyMatrix4(m);

    // 世界空间盒投影 UV,再每块随机偏移/转向,凿痕方向块块不同。
    const uv = boxProjectedUV(g, o.uvScale ?? 0.9);
    const ou = rng() * 7;
    const ov = rng() * 7;
    const swap = rng() < 0.4;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (swap) uv.setXY(i, v + ou, u + ov);
      else uv.setXY(i, u + ou, v + ov);
    }
    g.setAttribute('uv', uv);

    // 顶点色:每块自己的灰,略偏冷或偏暖。
    const tint = (o.tint ?? 1) * (1 + rangeOf(rng, -0.09, 0.09));
    const hue = (o.hue ?? 0) + rangeOf(rng, -0.4, 0.4);
    const r = clamp(tint * (1 + hue * 0.04), 0.3, 1.2);
    const gg = clamp(tint * (1 + hue * 0.015), 0.3, 1.2);
    const b = clamp(tint * (1 - hue * 0.045), 0.3, 1.2);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) {
      col[i] = r;
      col[i + 1] = gg;
      col[i + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
  }

  build(): THREE.Mesh {
    const merged = mergeGeometries(this.geos, false)!;
    for (const g of this.geos) g.dispose();
    const mat = stoneMaterial(1,true);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/* ------------------------------------------------------------------ */
/* 共用件:石板铺面、石栏                                                 */
/* ------------------------------------------------------------------ */

/**
 * 在一块矩形区域铺青石板:沿 X 一排排,每排横向切成 2–3 块,长短错缝。
 * 区域 [x0,x1]×[z0,z1],板顶在 topY。
 */
function paveSlabs(
  b: StoneBatch,
  rng: Rng,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  topY: number,
): void {
  const len = x1 - x0;
  const rows = Math.max(1, Math.round(len / SLAB_PITCH));
  const pitch = len / rows;
  const width = z1 - z0;
  for (let r = 0; r < rows; r++) {
    const xa = x0 + r * pitch;
    const xb = xa + pitch;
    // 横向切 2–3 块,切点随机,与上一排错开。
    const n = rng() < 0.55 ? 2 : 3;
    const cuts: number[] = [z0];
    if (n === 2) {
      cuts.push(z0 + width * rangeOf(rng, 0.36, 0.64));
    } else {
      const a = rangeOf(rng, 0.24, 0.4);
      const c = rangeOf(rng, 0.6, 0.76);
      cuts.push(z0 + width * a, z0 + width * c);
    }
    cuts.push(z1);
    for (let i = 0; i < cuts.length - 1; i++) {
      const za = cuts[i];
      const zb = cuts[i + 1];
      const w = xb - xa - GAP;
      const d = zb - za - GAP;
      const y = topY - SLAB_T / 2 + rangeOf(rng, -0.005, 0.004);
      b.add(w, SLAB_T, d, new THREE.Vector3((xa + xb) / 2, y, (za + zb) / 2), 0, {
        radius: 0.02,
        segments: 2,
        jitterRot: 0.012,
        jitterScale: 0.006,
        weather: 0.009,
        weatherFreq: 4,
        tint: rng() < 0.25 ? 0.78 : 0.88,
        hue: rng() < 0.3 ? 0.5 : -0.2,
      });
    }
  }
}

/**
 * 沿折线铺石栏:每个转折与均分点立望柱,柱间嵌栏板,脚下压地栿。
 * baseY 是栏杆脚下的面(桥面/台面)。
 */
function railChain(b: StoneBatch, rng: Rng, pts: THREE.Vector2[], baseY: number, postPitch = 1.0): void {
  const capsAt: [number, number, number, number][] = [];
  const postAt = (x: number, z: number): void => {
    const h = RAIL_H - SILL_H;
    b.add(POST_S, h, POST_S, new THREE.Vector3(x, baseY + SILL_H + h / 2 - 0.004, z), 0, {
      radius: 0.02,
      segments: 2,
      jitterRot: 0.008,
      jitterScale: 0.012,
      tint: 0.9,
      hue: 0.1,
    });
    // 柱头小圆帽:半球压扁,坐在一圈小颈上。
    const capR = POST_S * 0.5 + 0.012;
    const capY = baseY + RAIL_H - 0.006;
    b.add(POST_S + 0.03, 0.03, POST_S + 0.03, new THREE.Vector3(x, capY + 0.005, z), 0, {
      radius: 0.012,
      segments: 1,
      tint: 0.86,
    });
    capsAt.push([x, capY + 0.02, z, capR]);
  };

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const dir = c.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const ang = Math.atan2(dir.x, dir.y); // rotY: 绕 Y 把 +Z 转到 dir
    const rotY = ang;
    const n = Math.max(1, Math.round(len / postPitch));
    // 地栿:整条压底,略沉进台面。
    b.add(SILL_W, SILL_H + 0.01, len + POST_S * 0.6, new THREE.Vector3((a.x + c.x) / 2, baseY + SILL_H / 2 - 0.006, (a.y + c.y) / 2), rotY, {
      radius: 0.015,
      segments: 1,
      tint: 0.74,
      hue: -0.4,
    });
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const p0 = a.clone().lerp(c, t0);
      const p1 = a.clone().lerp(c, t1);
      // 链头立一根;之后每段只立末柱,转折点由上一段的末柱负责。
      if (i === 0 && k === 0) postAt(p0.x, p0.y);
      postAt(p1.x, p1.y);
      // 栏板:柱间净长。
      const seg = len / n;
      const pl = seg - POST_S - 0.012;
      if (pl > 0.12) {
        const mid = p0.clone().lerp(p1, 0.5);
        const ph = PANEL_TOP - SILL_H;
        b.add(PANEL_T, ph, pl, new THREE.Vector3(mid.x, baseY + SILL_H + ph / 2 - 0.004, mid.y), rotY, {
          radius: 0.016,
          segments: 1,
          jitterRot: 0.004,
          jitterScale: 0.004,
          tint: 0.84,
          hue: 0.25,
        });
        // 栏板上的浅浮起心板,两面各凸 6mm。
        b.add(PANEL_T + 0.012, ph * 0.52, pl * 0.7, new THREE.Vector3(mid.x, baseY + SILL_H + ph * 0.52 - 0.004, mid.y), rotY, {
          radius: 0.012,
          segments: 1,
          tint: 0.9,
          hue: 0.1,
        });
      }
    }
  }
  pendingCaps.push(...capsAt);
}

/** 柱头圆帽单独做(半球),攒在一起再合进石批。 */
let pendingCaps: [number, number, number, number][] = [];

function flushCaps(rng: Rng): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const [x, y, z, r] of pendingCaps) {
    const g = new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
    // 压扁一点,像馒头;底口向下再封一小片没必要,颈块挡住了。
    const s = 1 + rangeOf(rng, -0.03, 0.03);
    g.scale(s, 0.78 * s, s);
    g.translate(x, y, z);
    const uv = boxProjectedUV(g, 0.9);
    g.setAttribute('uv', uv);
    const tint = 0.88 + rangeOf(rng, -0.05, 0.05);
    const col = new Float32Array(g.attributes.position.count * 3).fill(tint);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.push(g);
  }
  pendingCaps = [];
  return out;
}

function finish(b: StoneBatch, rng: Rng): THREE.Mesh {
  const caps = flushCaps(rng);
  const mesh = b.build();
  if (caps.length) {
    const merged = mergeGeometries([mesh.geometry, ...caps], false)!;
    mesh.geometry.dispose();
    for (const c of caps) c.dispose();
    mesh.geometry = merged;
  }
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  return mesh;
}

/* ------------------------------------------------------------------ */
/* zigzag 三折曲桥                                                       */
/* ------------------------------------------------------------------ */

function buildZigzag(seed: number): THREE.Group {
  const rng = makeRng(seed);
  const b = new StoneBatch(rng, seed);
  const g = new THREE.Group();

  // 三段矩形,首尾相接处共边 1.5m:⌐¬⌐。
  const segs: { x0: number; x1: number; z0: number; z1: number }[] = [
    { x0: -4.5, x1: -0.75, z0: 0, z1: DECK_W },
    { x0: -2.25, x1: 2.25, z0: -DECK_W, z1: 0 },
    { x0: 0.75, x1: 4.5, z0: 0, z1: DECK_W },
  ];

  for (const s of segs) {
    // 板下石梁(深色),比桥面窄 1.5cm 一侧,板缝里露出来就是缝的黑。
    const len = s.x1 - s.x0;
    b.add(len - 0.02, BEAM_T, DECK_W - 0.03, new THREE.Vector3((s.x0 + s.x1) / 2, DECK_Y - SLAB_T - BEAM_T / 2 + 0.006, (s.z0 + s.z1) / 2), 0, {
      radius: 0.02,
      segments: 1,
      tint: 0.42,
      hue: -0.6,
    });
    paveSlabs(b, rng, s.x0, s.x1, s.z0, s.z1, DECK_Y);

    // 桥墩:一对一对,沿段每 ~1.5m。
    const inner = len - 0.6;
    const n = Math.max(2, Math.round(inner / 1.5) + 1);
    for (let i = 0; i < n; i++) {
      const x = s.x0 + 0.3 + (inner * i) / (n - 1);
      for (const zz of [s.z0 + 0.3, s.z1 - 0.3]) {
        const top = DECK_Y - SLAB_T - BEAM_T + 0.01; // 插进石梁 1cm
        const h = top - PIER_BOTTOM;
        b.add(PIER_S, h, PIER_S, new THREE.Vector3(x, PIER_BOTTOM + h / 2, zz), 0, {
          radius: 0.02,
          segments: 1,
          jitterRot: 0.01,
          jitterScale: 0.01,
          tint: 0.76,
          hue: -0.6,
        });
        // 帽石:墩顶托梁,略宽。
        b.add(PIER_S + 0.1, 0.06, PIER_S + 0.1, new THREE.Vector3(x, top - 0.03, zz), 0, {
          radius: 0.015,
          segments: 1,
          jitterRot: 0.01,
          tint: 0.82,
          hue: -0.3,
        });
      }
    }
  }

  // 牙子石:沿桥面外轮廓压一圈边条,盖住石板的端头,桥沿读成一条线。
  // 轮廓 = 三段矩形的并集边界(入口两端也压,踏步顶到它)。
  const outline = [
    [-4.5, 0], [-4.5, DECK_W], [-0.75, DECK_W], [-0.75, 0], [0.75, 0], [0.75, DECK_W],
    [4.5, DECK_W], [4.5, 0], [2.25, 0], [2.25, -DECK_W], [-2.25, -DECK_W], [-2.25, 0], [-4.5, 0],
  ];
  const CURB_W = 0.13;
  const CURB_T = 0.1;
  const CURB_TOP = DECK_Y + 0.012;
  for (let e = 0; e < outline.length - 1; e++) {
    const [ax, az] = outline[e];
    const [cx, cz] = outline[e + 1];
    const dx = cx - ax;
    const dz = cz - az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    // 轮廓顺着 +Z→+X 绕,内侧法线 = (uz, -ux)。
    const nx = uz;
    const nz = -ux;
    const rotY = Math.atan2(ux, uz);
    // 切成 0.7–1.2m 的段,错开,别与石板缝对齐。
    let t = 0;
    while (t < len - 0.01) {
      let seg = rangeOf(rng, 0.7, 1.2);
      if (len - t - seg < 0.4) seg = len - t;
      const m = t + seg / 2;
      const px = ax + ux * m + nx * (CURB_W / 2 - 0.004);
      const pz = az + uz * m + nz * (CURB_W / 2 - 0.004);
      b.add(CURB_W, CURB_T, seg - 0.006, new THREE.Vector3(px, CURB_TOP - CURB_T / 2, pz), rotY, {
        radius: 0.02,
        segments: 1,
        jitterRot: 0.006,
        jitterScale: 0.004,
        tint: rng() < 0.3 ? 0.8 : 0.9,
        hue: -0.1,
      });
      t += seg;
    }
  }

  // 两端踏步:落到 y=0.15,两块石拼。
  for (const side of [-1, 1]) {
    const xEdge = side * 4.5;
    const depth = 0.4;
    const xc = xEdge + (side * depth) / 2 + side * 0.005;
    const split = DECK_W * rangeOf(rng, 0.4, 0.6);
    const pieces: [number, number][] = [[0, split], [split, DECK_W]];
    for (const [za, zb] of pieces) {
      const h = STEP_Y + 0.06;
      b.add(depth, h, zb - za - GAP, new THREE.Vector3(xc, STEP_Y - h / 2, (za + zb) / 2), 0, {
        radius: 0.02,
        segments: 2,
        jitterRot: 0.006,
        weather: 0.007,
        weatherFreq: 5,
        tint: 0.84,
      });
    }
    // 踏步下的裙脚:一圈略宽的矮石,压住地面。
    b.add(depth + 0.1, 0.08, DECK_W + 0.1, new THREE.Vector3(xc, -0.02, DECK_W / 2), 0, {
      radius: 0.015,
      segments: 1,
      tint: 0.55,
      hue: -0.6,
    });
  }

  // 石栏:外轮廓两条链,入口两端不设栏。内缩 0.12。
  const i = 0.12;
  const A = [
    new THREE.Vector2(-4.5 + i, DECK_W - i),
    new THREE.Vector2(-0.75 - i, DECK_W - i),
    new THREE.Vector2(-0.75 - i, -i),
    new THREE.Vector2(0.75 + i, -i),
    new THREE.Vector2(0.75 + i, DECK_W - i),
    new THREE.Vector2(4.5 - i, DECK_W - i),
  ];
  const B = [
    new THREE.Vector2(4.5 - i, i),
    new THREE.Vector2(2.25 - i, i),
    new THREE.Vector2(2.25 - i, -DECK_W + i),
    new THREE.Vector2(-2.25 + i, -DECK_W + i),
    new THREE.Vector2(-2.25 + i, i),
    new THREE.Vector2(-4.5 + i, i),
  ];
  railChain(b, rng, A, DECK_Y, 1.05);
  railChain(b, rng, B, DECK_Y, 1.05);

  g.add(finish(b, rng));
  return g;
}

/* ------------------------------------------------------------------ */
/* bank 驳岸                                                             */
/* ------------------------------------------------------------------ */

function buildBank(seed: number): THREE.Group {
  const rng = makeRng(seed);
  const b = new StoneBatch(rng, seed);
  const g = new THREE.Group();

  const L = 4;
  const TOP = 0.45;
  const BOTTOM = -0.5;
  // 微弯:基波 + 二次谐波,首尾 z=0、切线相同,模块能首尾相接。
  const A1 = rangeOf(rng, 0.14, 0.2);
  const A2 = rangeOf(rng, -0.06, 0.06);
  const sgn = rng() < 0.5 ? 1 : -1;
  const curve = (x: number) => sgn * (A1 * Math.sin((Math.PI * 2 * x) / L) + A2 * Math.sin((Math.PI * 4 * x) / L));
  // 沉降:横缝也不是尺子画的,沿 X 有 ±1.5cm 的缓慢起伏(首尾归零,好接)。
  const sagPhase = rangeOf(rng, 0, Math.PI * 2);
  const sag = (x: number) => 0.015 * Math.sin((Math.PI * 2 * x) / L + sagPhase) - 0.015 * Math.sin(sagPhase) * Math.cos((Math.PI * x) / L);

  /**
   * 沿曲线放一块:前脸两个角都落在曲线上(弦),块体从弦往 -Z 退 depth。
   * 相邻块共享角点,前脸拼缝不裂;弦与曲线的差留在后面看不见的地方。
   */
  const place = (xa: number, xb: number, yc: number, h: number, depth: number, proud: number, o: BlockOpts) => {
    const za = curve(xa);
    const zb = curve(xb);
    const dx = xb - xa;
    const dz = zb - za;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    // 前法线(+Z 一侧):弦方向逆时针转 90°。
    const nx = -uz;
    const nz = ux;
    const mx = (xa + xb) / 2 + nx * (proud - depth / 2);
    const mz = (za + zb) / 2 + nz * (proud - depth / 2);
    const rotY = -Math.atan2(uz, ux);
    b.add(len, h, depth, new THREE.Vector3(mx, yc, mz), rotY, o);
  };

  // 三层,每层高 ~0.3 略有出入;层内每块再各自差一点,顶边不成直线。
  const nC = 3;
  const total = TOP - BOTTOM;
  const weights = Array.from({ length: nC }, () => rangeOf(rng, 0.92, 1.08));
  const wsum = weights.reduce((a, c) => a + c, 0);
  let y = BOTTOM;
  for (let c = 0; c < nC; c++) {
    const h = (total * weights[c]) / wsum;
    const yc = y + h / 2;
    const isTop = c === nC - 1;
    // 收分:越高越往后退一点点。
    const setback = -c * 0.012;
    // 水线:底层泛潮发暗,越往上越干越亮。
    const wet = isTop ? 0.9 : 0.62 + c * 0.1;
    let x = -L / 2;
    let first = true;
    while (x < L / 2 - 0.05) {
      let len = rangeOf(rng, 0.5, 0.9);
      if (first) len = rangeOf(rng, 0.3, 0.75);
      first = false;
      const rest = L / 2 - x;
      if (rest - len < 0.3) len = rest; // 末块吃到头
      const xa = x;
      const xb = x + len;
      const dy = sag((xa + xb) / 2) * (c / (nC - 1));
      const depth = isTop ? rangeOf(rng, 0.42, 0.52) : rangeOf(rng, 0.5, 0.62);
      const opts = (k: number): BlockOpts => ({
        radius: 0.035,
        segments: 3,
        jitterRot: 0.02,
        jitterScale: 0.01,
        weather: 0.024,
        weatherFreq: 2.6,
        tint: wet * (1 + k),
        hue: isTop ? 0.15 : -0.5 + c * 0.2,
        uvScale: 0.8,
      });
      // 两成机会一个槽位塞两块薄石叠着(叠砌里常见的"找平"小料),打破整齐。
      if (!isTop && len < 0.75 && rng() < 0.22) {
        const split = rangeOf(rng, 0.38, 0.62);
        const h0 = h * split;
        const h1 = h - h0;
        const p0 = setback + rangeOf(rng, -0.02, 0.02);
        const p1 = setback + rangeOf(rng, -0.02, 0.02);
        place(xa - 0.006, xb + 0.006, y + h0 / 2 + dy, h0 - 0.006, depth, p0, opts(rangeOf(rng, -0.06, 0.06)));
        place(xa - 0.006, xb + 0.006, y + h0 + h1 / 2 + dy, h1 - 0.006, depth * rangeOf(rng, 0.9, 1.0), p1, opts(rangeOf(rng, -0.06, 0.06)));
      } else {
        const hh = h + rangeOf(rng, -0.02, 0.018);
        // 顶层压顶略出挑,别的层随机凸凹。
        const proud = (isTop ? 0.035 : 0) + setback + rangeOf(rng, -0.02, 0.028);
        // 顶层偶尔一块略高出线,顶边不成一条直线。
        const lift = isTop && rng() < 0.3 ? rangeOf(rng, 0.01, 0.025) : 0;
        place(xa - 0.006, xb + 0.006, yc + dy + ((h - hh) / 2) * (rng() < 0.5 ? 1 : -1) + lift, hh, depth, proud, opts(0));
      }
      x = xb;
    }
    y += h;
  }

  // 脚下裙脚:泥圈,埋在底层下面,深色,略往前吐。
  const nF = 7;
  for (let k = 0; k < nF; k++) {
    const xa = -L / 2 + (L * k) / nF;
    const xb = xa + L / nF;
    place(xa - 0.03, xb + 0.03, BOTTOM + 0.01, 0.1, 0.8, 0.035 + rangeOf(rng, -0.015, 0.015), {
      radius: 0.03,
      segments: 1,
      jitterRot: 0.012,
      tint: 0.42,
      hue: -0.6,
    });
  }

  g.add(finish(b, rng));
  return g;
}

/* ------------------------------------------------------------------ */
/* railing 独立石栏                                                      */
/* ------------------------------------------------------------------ */

function buildRailing(seed: number): THREE.Group {
  const rng = makeRng(seed);
  const b = new StoneBatch(rng, seed);
  const g = new THREE.Group();
  const L = 3;
  railChain(b, rng, [new THREE.Vector2(-L / 2, 0), new THREE.Vector2(L / 2, 0)], 0, 1.0);
  g.add(finish(b, rng));
  return g;
}

/* ------------------------------------------------------------------ */

function seedOf(variant: string, base: number): number {
  const m = /(\d+)$/.exec(variant);
  return base + (m ? Number(m[1]) * 7919 : 0);
}

registerPart('bridge', (variant) => {
  const v = variant.replace(/\d+$/, '');
  if (v === 'bank') return { root: buildBank(seedOf(variant, 2101)) };
  if (v === 'railing') return { root: buildRailing(seedOf(variant, 3301)) };
  return { root: buildZigzag(seedOf(variant, 1201)) };
});
