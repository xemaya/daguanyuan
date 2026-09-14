import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { CN, plasterMaterial, stoneMaterial, tigerSkinMaterial, tileMaterial, woodMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { Simplex, fbm2, makeRng, smoothstep, clamp, lerp } from '@engine/core/Noise';
import { WALL_STYLE } from './wall-style';
import { makePlaque } from '@builder/parts/xiaomu/plaque';
import { plaqueFromPlan } from '@builder/plan/objects';

/**
 * 江南园林粉墙系列。
 *
 * 分层(自下而上):青石石礓(裙脚)→ 青石墙脚 0.35m 略外凸 → 粉墙体 0.30m 厚 →
 * 小青瓦两坡压顶 + 微翘的脊。原点在地面中心,长度沿 X,+Z 为正面。
 *
 * variant:
 *   plain          6m 直墙
 *   moon           6m 墙中开月洞门(Ø2.2m,青石门槛 + 青石门套)
 *   lattice[:sub]  6m 墙中开两扇 1×1m 漏窗;sub = ice(默认冰裂纹) | wan(万字) | haitang(海棠)
 *   cloud          8m 云墙,墙顶起伏,压顶瓦沿波浪走
 */

type P2 = [number, number];

/* ------------------------------------------------------------------ */
/* 尺寸                                                                */
/* ------------------------------------------------------------------ */

const THICK = 0.3; // 粉墙体厚
const BEVEL = 0.02; // 墙体倒角
const BASE_H = 0.35; // 青石墙脚高
const BASE_T = 0.38; // 墙脚厚(每侧外凸 4cm)
const PLINTH_H = 0.05; // 石礓(裙脚)高
const PLINTH_T = WALL_STYLE.footHalf * 2;
const BODY_TOP = WALL_STYLE.bodyTop; // 墙体顶(藏在压顶里)
const COPING_Y = 2.38; // 压顶剖面基准 y
const COPING_OVERHANG_X = 0.06; // 压顶在墙端外挑
const RIDGE_LIFT = 0.06; // 脊两端微翘
const RIDGE_LIFT_SPAN = 0.7;

// 瓦贴图:一个 repeat 里 12 垄,每垄 0.18m;沿坡每片瓦 0.1m,一个 repeat 19.2 片。
const TILE_PITCH = 0.18;
const TILE_U = TILE_PITCH * 12;
const TILE_V = 1.92;
const TILE_BUMP = 0.012; // 瓦垄真几何起伏
const SAMPLE_DX = TILE_PITCH / 4;

/** 压顶剖面右半(z ≥ 0),y 相对 COPING_Y;从脊顶出发经坡面、滴水、檐底回到墙内。 */
const COPING_HALF: P2[] = [
  [0.0, 0.14],
  [0.07, 0.126],
  [0.14, 0.1],
  [0.21, 0.064],
  [0.27, 0.028],
  [0.3, 0.006],
  [0.305, -0.016],
  [0.285, -0.036],
  [0.23, -0.028],
  [0.17, -0.006],
  [0.14, 0.0],
];
const COPING_BUMP_UNTIL = 7; // 索引 ≤7 的点(坡面 + 滴水)吃瓦垄起伏

/* ------------------------------------------------------------------ */
/* 2D 轮廓                                                             */
/* ------------------------------------------------------------------ */

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, segs: number, out: P2[]): void {
  for (let i = 0; i <= segs; i++) {
    const a = lerp(a0, a1, i / segs);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
}

/**
 * 圆角矩形,逆时针。`bottomSteps`>1 时给底边(贴地那条)加密取样点——
 * 单靠两端点连一条直线没法在中段按 x 施加高程扰动("随势砌去",见
 * buildWall 的 sinkIntoGround)。默认 1 与旧行为完全一致。
 */
function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, segs = 4, bottomSteps = 1): P2[] {
  const pts: P2[] = [];
  const H = Math.PI / 2;
  arcPts(x1 - r, y0 + r, r, -H, 0, segs, pts);
  arcPts(x1 - r, y1 - r, r, 0, H, segs, pts);
  arcPts(x0 + r, y1 - r, r, H, 2 * H, segs, pts);
  arcPts(x0 + r, y0 + r, r, 2 * H, 3 * H, segs, pts);
  for (let i = 1; i < bottomSteps; i++) pts.push([lerp(x0 + r, x1 - r, i / bottomSteps), y0]);
  return pts;
}

function circlePts(cx: number, cy: number, r: number, n: number): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** 顶边是曲线的矩形(云墙),逆时针。 */
function wavyRect(x0: number, y0: number, x1: number, top: (x: number) => number, r: number): P2[] {
  const pts: P2[] = [];
  const H = Math.PI / 2;
  arcPts(x1 - r, y0 + r, r, -H, 0, 4, pts);
  arcPts(x1 - r, top(x1) - r, r, 0, H, 4, pts);
  const n = Math.ceil((x1 - x0 - 2 * r) / 0.08);
  for (let i = 1; i < n; i++) pts.push([lerp(x1 - r, x0 + r, i / n), top(lerp(x1 - r, x0 + r, i / n))]);
  arcPts(x0 + r, top(x0) - r, r, H, 2 * H, 4, pts);
  arcPts(x0 + r, y0 + r, r, 2 * H, 3 * H, 4, pts);
  return pts;
}

/**
 * 墙脚被月洞切出的缺口:矩形顶边中段沿圆弧下凹。圆心 (0,cy) 半径 R 与 y1 相交处
 * 进弧,绕过圆底再回到 y1。逆时针。
 */
function notchedRect(x0: number, y0: number, x1: number, y1: number, r: number, cy: number, R: number, bottomSteps = 1): P2[] {
  const pts: P2[] = [];
  const H = Math.PI / 2;
  arcPts(x1 - r, y0 + r, r, -H, 0, 4, pts);
  arcPts(x1 - r, y1 - r, r, 0, H, 4, pts);
  const xi = Math.sqrt(Math.max(0, R * R - (y1 - cy) * (y1 - cy)));
  const a1 = Math.atan2(y1 - cy, xi); // 右交点角(负)
  // 从右交点顺时针绕过圆底(-90°)到左交点 -π-a1。
  arcPts(0, cy, R, a1, -Math.PI - a1, 48, pts);
  arcPts(x0 + r, y1 - r, r, H, 2 * H, 4, pts);
  arcPts(x0 + r, y0 + r, r, 2 * H, 3 * H, 4, pts);
  // 缺口挖在顶边(月洞),底边(贴地)仍是完整一条,同样按 bottomSteps 加密。
  for (let i = 1; i < bottomSteps; i++) pts.push([lerp(x0 + r, x1 - r, i / bottomSteps), y0]);
  return pts;
}

/** 环扇(月洞门套):内外半径,底部被门槛水平截断。逆时针。 */
function ringSector(cy: number, rIn: number, rOut: number, yCut: number, n: number): P2[] {
  const pts: P2[] = [];
  const aOut = Math.asin(clamp((yCut - cy) / rOut, -1, 1)); // 右下端角(负)
  const aIn = Math.asin(clamp((yCut - cy) / rIn, -1, 1));
  // 外弧:右下 → 上 → 左下(逆时针)
  arcPts(0, cy, rOut, aOut, Math.PI - aOut, n, pts);
  // 内弧:左下 → 上 → 右下(顺时针)
  arcPts(0, cy, rIn, Math.PI - aIn, aIn, n, pts);
  return pts;
}

/* ------------------------------------------------------------------ */
/* 挤出实体 + 投影 UV                                                   */
/* ------------------------------------------------------------------ */

/**
 * 轮廓 + 洞 → 带圆倒角的实体,居中于 z=0。轮廓给的是端面尺寸,侧面会向外长 bevel;
 * 调用方要按设计尺寸把轮廓内缩 / 洞外扩 bevel。
 */
function extrudeSolid(outline: P2[], holes: P2[][], thickness: number, bevel: number, segs = 3): THREE.BufferGeometry {
  const toV2 = (ps: P2[]) => ps.map((p) => new THREE.Vector2(p[0], p[1]));
  const shape = new THREE.Shape(toV2(outline));
  for (const h of holes) shape.holes.push(new THREE.Path(toV2(h)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - 2 * bevel,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: segs,
    curveSegments: 1,
  });
  geo.translate(0, 0, -(thickness / 2 - bevel));
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const merged = mergeVertices(geo, 1e-5);
  merged.computeVertexNormals();
  return merged;
}

/**
 * 按法线主轴投影 UV。竖直面 v 从 y0 起按 h 归一(粉墙贴图 v=0 是泛潮的墙脚),
 * u 按 uScale 米一个 repeat;水平面按 h 平铺。
 */
function projectUV(geo: THREE.BufferGeometry, y0: number, h: number, uScale: number, flipV = false): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ny > nx && ny > nz) {
      u = x / h;
      v = z / h;
    } else {
      u = (nx >= nz ? z : x) / uScale;
      // CanvasTexture flipY:烤图第 0 行落在 uv v=1。粉墙的潮渍烤在第 0 行附近,
      // 要让它出现在墙脚就得把 v 反过来。
      v = flipV ? (y0 + h - y) / h : (y - y0) / h;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * 虎皮石墙基"随势砌去":让贴地的石作沿 x 起伏地"沉"进地面,顶部(topH,
 * 与上方粉墙/构件的接缝处)锁死不动——只动底,接缝还是原来那条平直线,
 * 不会露馅。`dip` 必须 ≤0(只沉不浮,见 WALL_STYLE.baseSink 的注释)。
 */
function sinkIntoGround(geo: THREE.BufferGeometry, topH: number, dip: (x: number) => number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = clamp(1 - y / topH, 0, 1);
    pos.setY(i, y + dip(x) * t);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/* ------------------------------------------------------------------ */
/* 沿 X 扫掠闭合剖面(压顶、脊)                                          */
/* ------------------------------------------------------------------ */

interface Frame {
  y: number; // 剖面原点世界 y
  theta: number; // 绕 Z 倾角(跟随云墙坡度)
  sy: number; // 剖面 y 向缩放(绕 pivot)
  sz: number; // 剖面 z 向缩放
  pivot: number; // y 向缩放支点(剖面坐标)
}

function shoelace(p: P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/**
 * 闭合剖面沿 X 扫掠成实体(带端盖)。剖面在 (z,y) 平面;bump(x) 加在被 mask 的点的 y 上,
 * 做真几何瓦垄。UV:u = x/uScale,v = 剖面弧长/vScale。
 */
function sweepX(
  profileIn: P2[],
  xs: number[],
  frameAt: (x: number) => Frame,
  bumpMask: boolean[] | null,
  bumpAt: (x: number) => number,
  uScale: number,
  vScale: number,
): THREE.BufferGeometry {
  // 统一成 (z,y) 顺时针,配合下面的三角顺序让法线朝外。
  const profile = profileIn.slice();
  const mask = bumpMask ? bumpMask.slice() : null;
  if (shoelace(profile) > 0) {
    profile.reverse();
    if (mask) mask.reverse();
  }
  const K = profile.length;
  // 闭合:末尾复制首点,v 连续到 1。
  const ring: P2[] = [...profile, profile[0]];
  const ringMask = mask ? [...mask, mask[0]] : null;
  const arc: number[] = [0];
  for (let k = 1; k <= K; k++) {
    const a = ring[k - 1];
    const b = ring[k];
    arc.push(arc[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }

  const N = xs.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const place = (x: number, k: number, out: number[]): void => {
    const f = frameAt(x);
    const p = ring[k];
    const bump = ringMask && ringMask[k] ? bumpAt(x) : 0;
    const pz = p[0] * f.sz;
    const py = f.pivot + (p[1] - f.pivot) * f.sy + bump;
    const s = Math.sin(f.theta);
    const c = Math.cos(f.theta);
    out.push(x - py * s, f.y + py * c, pz);
  };

  for (let i = 0; i < N; i++) {
    for (let k = 0; k <= K; k++) {
      place(xs[i], k, positions);
      uvs.push(xs[i] / uScale, arc[k] / vScale);
    }
  }
  const stride = K + 1;
  for (let i = 0; i < N - 1; i++) {
    for (let k = 0; k < K; k++) {
      const a = i * stride + k;
      const b = (i + 1) * stride + k;
      const c = (i + 1) * stride + k + 1;
      const d = i * stride + k + 1;
      indices.push(a, c, b, a, d, c);
    }
  }

  // 端盖:各自独立顶点(平法线)。
  const tris = THREE.ShapeUtils.triangulateShape(
    profile.map((p) => new THREE.Vector2(p[0], p[1])),
    [],
  );
  for (const end of [0, N - 1]) {
    const base = positions.length / 3;
    const x = xs[end];
    for (let k = 0; k < K; k++) {
      place(x, k, positions);
      uvs.push(profile[k][0] / vScale, profile[k][1] / vScale);
    }
    const want = end === 0 ? -1 : 1;
    // 用第一个三角判定朝向,不对就整体翻。
    const [t0, t1, t2] = tris[0];
    const p0 = new THREE.Vector3().fromArray(positions, (base + t0) * 3);
    const p1 = new THREE.Vector3().fromArray(positions, (base + t1) * 3);
    const p2 = new THREE.Vector3().fromArray(positions, (base + t2) * 3);
    const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
    const flip = Math.sign(n.x) !== want;
    for (const t of tris) {
      if (flip) indices.push(base + t[0], base + t[2], base + t[1]);
      else indices.push(base + t[0], base + t[1], base + t[2]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function linspace(x0: number, x1: number, dx: number): number[] {
  const n = Math.max(2, Math.ceil((x1 - x0) / dx) + 1);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(lerp(x0, x1, i / (n - 1)));
  return xs;
}

/* ------------------------------------------------------------------ */
/* 压顶(两坡小青瓦 + 脊)                                                */
/* ------------------------------------------------------------------ */

function copingProfile(): { pts: P2[]; mask: boolean[] } {
  const pts: P2[] = [];
  const mask: boolean[] = [];
  for (let i = 0; i < COPING_HALF.length; i++) {
    pts.push(COPING_HALF[i]);
    mask.push(i <= COPING_BUMP_UNTIL);
  }
  for (let i = COPING_HALF.length - 1; i >= 1; i--) {
    pts.push([-COPING_HALF[i][0], COPING_HALF[i][1]]);
    mask.push(i <= COPING_BUMP_UNTIL);
  }
  return { pts, mask };
}

const RIDGE_W = 0.1;
const RIDGE_H = 0.1;
const RIDGE_Y0 = COPING_HALF[0][1] - 0.05; // 脊底沉进坡顶 5cm
function ridgeProfile(): P2[] {
  return roundedRect(-RIDGE_W / 2, RIDGE_Y0, RIDGE_W / 2, RIDGE_Y0 + RIDGE_H, 0.03, 2);
}

/** 瓦垄相位与 tileMaps 的 arch 对齐:col = x/0.18,峰在 0.5。 */
function tileBump(x: number): number {
  const f = x / TILE_PITCH - Math.floor(x / TILE_PITCH);
  return TILE_BUMP * Math.sin(f * Math.PI);
}

function buildCoping(halfLen: number, wave: (x: number) => number, flush = false): THREE.Mesh[] {
  const x0 = -halfLen - (flush ? 0 : COPING_OVERHANG_X);
  const x1 = halfLen + (flush ? 0 : COPING_OVERHANG_X);
  const xs = linspace(x0, x1, SAMPLE_DX);
  const slope = (x: number) => (wave(x + 0.01) - wave(x - 0.01)) / 0.02;
  const frame = (x: number): Frame => ({ y: COPING_Y + wave(x), theta: Math.atan(slope(x)), sy: 1, sz: 1, pivot: 0 });

  const { pts, mask } = copingProfile();
  // A short flat end tile seats each joined module on the same profile. The
  // relief remains in the span, without a 12mm height discontinuity at joins.
  const relief = flush ? (x:number)=>tileBump(x)*smoothstep(x0,x0+TILE_PITCH,x)*smoothstep(x1,x1-TILE_PITCH,x) : tileBump;
  const copingGeo = sweepX(pts, xs, frame, mask, relief, TILE_U, TILE_V);
  const coping = new THREE.Mesh(copingGeo, tileMaterial(1, 1));

  // 脊:两端微翘(纹头)。只抬脊顶不抬脊底,底始终坐在坡顶里,不露缝。
  const lift = (x: number) => {
    if (flush) return 0;
    const t = smoothstep(halfLen - RIDGE_LIFT_SPAN, halfLen + COPING_OVERHANG_X, Math.abs(x));
    return t * t;
  };
  const ridgeFrame = (x: number): Frame => ({
    y: COPING_Y + wave(x),
    theta: Math.atan(slope(x)),
    sy: 1 + (RIDGE_LIFT / RIDGE_H) * lift(x),
    sz: 1 + 0.12 * lift(x),
    pivot: RIDGE_Y0,
  });
  const ridgeGeo = sweepX(ridgeProfile(), linspace(x0, x1, SAMPLE_DX * 2), ridgeFrame, null, () => 0, TILE_U * 0.5, 0.36);
  const ridge = new THREE.Mesh(ridgeGeo, tileMaterial(1, 1));
  return [coping, ridge];
}

/* ------------------------------------------------------------------ */
/* 漏窗花格                                                             */
/* ------------------------------------------------------------------ */

type Seg = [P2, P2];
const BAR = 0.03;
const WIN = 1.0;
const HALF = WIN / 2;
const EMBED = 0.015; // 棂条插进窗套

/** 线段裁到矩形 [-hw,hw]×[-hh,hh];返回 null 表示全在外面。 */
function clipToRect(a: P2, b: P2, hw: number, hh: number): Seg | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edges: [number, number][] = [
    [-dx, a[0] + hw], // x >= -hw
    [dx, hw - a[0]], // x <= hw
    [-dy, a[1] + hh],
    [dy, hh - a[1]],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1],
  ];
}

function onBoundary(s: Seg, hw: number, hh: number): boolean {
  const eps = 1e-4;
  const half = [hw, hh];
  const [a, b] = s;
  for (const ax of [0, 1]) {
    if (Math.abs(Math.abs(a[ax]) - half[ax]) < eps && Math.abs(Math.abs(b[ax]) - half[ax]) < eps && Math.sign(a[ax]) === Math.sign(b[ax])) return true;
  }
  return false;
}

/** 冰裂纹:抖动网格种子点的 Voronoi 边。格子以短边的三分为目标,正方形时与旧方窗逐位一致。 */
function iceCrackSegs(w: number, h: number, seed: number): Seg[] {
  const rng = makeRng(seed);
  const cell = Math.min(w, h) / 3;
  const nx = Math.max(2, Math.round(w / cell));
  const ny = Math.max(2, Math.round(h / cell));
  const pts: P2[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      pts.push([
        -w / 2 + ((i + 0.5) / nx) * w + (rng() - 0.5) * (w / nx) * 0.75,
        -h / 2 + ((j + 0.5) / ny) * h + (rng() - 0.5) * (h / ny) * 0.75,
      ]);
    }
  }
  const u = Math.min(w, h);
  pts.push([(rng() - 0.5) * 0.7 * u, (rng() - 0.5) * 0.7 * u]);
  pts.push([(rng() - 0.5) * 0.9 * u, (rng() - 0.5) * 0.9 * u]);

  const segs: Seg[] = [];
  const BIG = 4;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const pi = pts[i];
      const pj = pts[j];
      const mx = (pi[0] + pj[0]) / 2;
      const my = (pi[1] + pj[1]) / 2;
      let dx = -(pj[1] - pi[1]);
      let dy = pj[0] - pi[0];
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      let t0 = -BIG;
      let t1 = BIG;
      // 半平面 |p-pi|² ≤ |p-pk|²  ⇔  2 p·(pk-pi) ≤ |pk|²-|pi|²
      for (let k = 0; k < pts.length; k++) {
        if (k === i || k === j) continue;
        const pk = pts[k];
        const ax = pk[0] - pi[0];
        const ay = pk[1] - pi[1];
        const c = (pk[0] * pk[0] + pk[1] * pk[1] - pi[0] * pi[0] - pi[1] * pi[1]) / 2;
        const a0 = mx * ax + my * ay - c; // + t*(dx*ax+dy*ay) ≤ 0
        const b = dx * ax + dy * ay;
        if (Math.abs(b) < 1e-9) {
          if (a0 > 0) {
            t0 = 1;
            t1 = 0;
            break;
          }
          continue;
        }
        const r = -a0 / b;
        if (b > 0) t1 = Math.min(t1, r);
        else t0 = Math.max(t0, r);
        if (t0 >= t1) break;
      }
      if (t1 - t0 < 1e-4) continue;
      const clipped = clipToRect([mx + dx * t0, my + dy * t0], [mx + dx * t1, my + dy * t1], w / 2, h / 2);
      if (!clipped) continue;
      const L = Math.hypot(clipped[1][0] - clipped[0][0], clipped[1][1] - clipped[0][1]);
      if (L < 0.035) continue;
      segs.push(clipped);
    }
  }
  return segs;
}

/** 万字不到头:卍 按旋转方格点阵 (4u,2u)/(−2u,4u) 咬合,共线笔画合并。
 *  u 取短边 1/12,纹样保持方形、超出长边的部分裁掉("不到头"本是无限连续纹)。 */
function wanSegs(w: number, h: number): Seg[] {
  const u = Math.min(w, h) / 12;
  const hw = w / 2;
  const hh = h / 2;
  const horiz = new Map<number, [number, number][]>(); // y -> intervals in x
  const vert = new Map<number, [number, number][]>();
  const key = (v: number) => Math.round(v / u);
  const addH = (y: number, xa: number, xb: number) => {
    const k = key(y);
    if (!horiz.has(k)) horiz.set(k, []);
    horiz.get(k)!.push([Math.min(xa, xb), Math.max(xa, xb)]);
  };
  const addV = (x: number, ya: number, yb: number) => {
    const k = key(x);
    if (!vert.has(k)) vert.set(k, []);
    vert.get(k)!.push([Math.min(ya, yb), Math.max(ya, yb)]);
  };
  const R = 4 + Math.ceil(Math.max(w, h) / (8 * u)); // 高窄的隔扇格心要更多圈点才盖得住
  for (let a = -R; a <= R; a++) {
    for (let b = -R; b <= R; b++) {
      const cx = (a * 4 - b * 2) * u;
      const cy = (a * 2 + b * 4) * u;
      if (Math.abs(cx) > hw + 2 * u || Math.abs(cy) > hh + 2 * u) continue;
      // 四臂
      addH(cy, cx - 2 * u, cx + 2 * u);
      addV(cx, cy - 2 * u, cy + 2 * u);
      // 四钩(顺时针)
      addV(cx - 2 * u, cy, cy + 2 * u); // 左臂端向上
      addH(cy + 2 * u, cx, cx + 2 * u); // 上臂端向右
      addV(cx + 2 * u, cy, cy - 2 * u); // 右臂端向下
      addH(cy - 2 * u, cx, cx - 2 * u); // 下臂端向左
    }
  }
  const segs: Seg[] = [];
  const merge = (m: Map<number, [number, number][]>, isH: boolean) => {
    for (const [k, ivs] of m) {
      ivs.sort((p, q) => p[0] - q[0]);
      const out: [number, number][] = [];
      for (const iv of ivs) {
        const last = out[out.length - 1];
        if (last && iv[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], iv[1]);
        else out.push([iv[0], iv[1]]);
      }
      const c = k * u;
      for (const [p, q] of out) {
        const s = isH ? clipToRect([p, c], [q, c], hw, hh) : clipToRect([c, p], [c, q], hw, hh);
        if (!s || onBoundary(s, hw, hh)) continue;
        if (Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) < 0.02) continue;
        segs.push(s);
      }
    }
  };
  merge(horiz, true);
  merge(vert, false);
  return segs;
}

/** 直棂条:两端各多伸 EMBED 插进相邻构件;plain 用直箱(细棂条倒角看不见,省 15 倍三角)。 */
function barGeometry(s: Seg, bar: number, plain = false): THREE.BufferGeometry {
  const [a, b] = s;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) + EMBED * 2;
  const g = plain ? new THREE.BoxGeometry(L, bar, bar) : roundedBox(L, bar, bar, Math.min(0.009, bar * 0.3), 1);
  const m = new THREE.Matrix4()
    .makeTranslation((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(Math.atan2(dy, dx)));
  g.applyMatrix4(m);
  return g;
}

/** 海棠纹:四瓣花沿 3×3 排布,瓣尖相触;花用闭合方管。 */
class RoseCurve extends THREE.Curve<THREE.Vector3> {
  private cx: number; private cy: number; private R: number;
  constructor(cx: number, cy: number, R: number) {
    super();
    this.cx=cx;this.cy=cy;this.R=R;
  }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 2;
    const petal = Math.sqrt(Math.abs(Math.cos(2 * a)));
    const r = this.R * (0.56 + 0.44 * petal);
    return target.set(this.cx + Math.cos(a) * r, this.cy + Math.sin(a) * r, 0);
  }
}

function haitangGeometry(w: number, h: number, bar: number): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];
  const p = w / 3; // 花格单元边长:横向三朵
  const ny = Math.max(1, Math.round(h / p));
  const R = p / 2 + EMBED * 0.6;
  const y0 = -(ny * p) / 2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < 3; i++) {
      const cx = -w / 2 + (i + 0.5) * p;
      const cy = y0 + (j + 0.5) * p;
      const tube = new THREE.TubeGeometry(new RoseCurve(cx, cy, R), 28, bar * 0.5, 4, true);
      geos.push(tube);
    }
  }
  // 瓣尖之间的菱形空档里放一根短斜撑,把花连成整体。
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= 3; i++) {
      const x = -w / 2 + i * p;
      const y = y0 + j * p;
      if (Math.abs(x) >= w / 2 - 1e-6 || j === 0 || j === ny) continue;
      const d = p * 0.27;
      geos.push(barGeometry([[x - d, y - d], [x + d, y + d]], bar));
      geos.push(barGeometry([[x - d, y + d], [x + d, y - d]], bar));
    }
  }
  return geos;
}

/**
 * 格心几何:在 w×h 矩形(XY 平面,居中,z=0)里生成指定纹样的棂条并合成一份几何。
 * 墙漏窗(1×1)与建筑隔扇门窗的格心(高大於宽)共用——PQ-2 把这组生成器
 * 从墙垣搬到门户,纹样不变,只是裁切框变成了矩形。
 */
export function gexinGeometry(sub: string, w: number, h: number, bar: number, seed: number, plain = false): THREE.BufferGeometry {
  let geos: THREE.BufferGeometry[];
  if (sub === 'wan') geos = wanSegs(w, h).map((s) => barGeometry(s, bar, plain));
  else if (sub === 'haitang') geos = haitangGeometry(w, h, bar);
  else geos = iceCrackSegs(w, h, seed).map((s) => barGeometry(s, bar, plain));
  // 统一成非索引再合并(tube / roundedBox 属性集相同:position/normal/uv)。
  const merged = mergeGeometries(
    geos.map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  );
  if (!merged) throw new Error('lattice merge failed');
  return merged;
}

/* ------------------------------------------------------------------ */
/* 装配                                                                */
/* ------------------------------------------------------------------ */

/** 顶点色:yFoot 处是潮渍色,yDry 以上纯白;中间线性(保证大三角形上插值不走样)。 */
function bakeDampGradient(geo: THREE.BufferGeometry, yFoot: number, yDry: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const stain = new THREE.Color(CN.plasterStain);
  const base = new THREE.Color(CN.plaster);
  const tint = new THREE.Color(stain.r / base.r, stain.g / base.g, stain.b / base.b);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp((pos.getY(i) - yFoot) / (yDry - yFoot), 0, 1);
    const k = 1 - t; // 墙脚 1 → 干处 0
    col[i * 3] = lerp(1, tint.r, k);
    col[i * 3 + 1] = lerp(1, tint.g, k);
    col[i * 3 + 2] = lerp(1, tint.b, k);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function shadowed<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildWall(variant: string, options: { length?:number; flushEnds?:boolean } = {}): PartBuild {
  // 保留纹样一级别名；路径与棚拍也可完整传入 lattice:wan 这类变体。
  // moon 可带对象 id(moon:xiaoxiangguan.moon-gate):门额文字按 id 从 plan.json 读。
  const parts = variant.split(':');
  const SUBS = ['ice', 'wan', 'haitang'];
  const kind = SUBS.includes(parts[0]) ? 'lattice' : parts[0] || 'plain';
  const sub = SUBS.includes(parts[0]) ? parts[0] : (parts[1] ?? '');
  if (!['plain','cloud','moon','lattice'].includes(kind)) throw new Error(`未知墙体 ${variant}`);
  if ((kind==='lattice'&&sub&&!SUBS.includes(sub))||(kind==='lattice'&&parts.length>2)||
    (kind!=='lattice'&&kind!=='moon'&&parts.length>1)||(kind==='moon'&&parts.length>2))
    throw new Error(`未知墙体纹样 ${variant}`);
  const L = options.length ?? (kind === 'cloud' ? 8 : 6);
  if (!Number.isFinite(L)||L<.65||((kind==='moon'||kind==='lattice')&&L<4.3))throw new Error('墙段长度不能容纳该构件');
  const baseEnd=options.flushEnds?0:.02, plinthEnd=options.flushEnds?0:.08;
  const hl = L / 2;
  const group = new THREE.Group();

  // 云墙的起伏:sin 叠 fbm,幅度 ±0.4m。
  const simplex = new Simplex(7031);
  const wave =
    kind === 'cloud'
      ? (x: number) => 0.4 * (0.72 * Math.sin((x / 3.2) * Math.PI * 2 + 0.9) + 0.4 * fbm2(simplex, x * 0.45 + 3.1, 0.37, 3))
      : () => 0;
  // 虎皮石墙基"隨勢砌去"只吃 07-02「左右一望」那段园墙——院墙(潇湘馆
  // 一类的粉垣,07-07 只说"一带粉垣",没说虎皮石)退回原来的做法:实心
  // 青石、墙脚不沉。园墙都是 registry 直接摆的独立直墙段(flushEnds 缺省
  // false);院墙都经 wall-path.ts 沿 plan 折线连续拼接首尾相接
  // (flushEnds 恒为 true,见 buildWallPath)——目前全园仅 xiaoxiangguan/
  // longcuian 两条 courtyard-wall 走这条路径,借这个已有信号分墙种,不再
  // 新增一条跨文件的"墙类别"参数。
  const courtyard = !!options.flushEnds;
  // 同一颗噪声(借用云墙那颗、换一段不相关的取样区)按墙的本地 x 给基脚
  // 沉深——只沉不浮,见 WALL_STYLE.baseSink 的注释。每约 1.5m 给一个起伏,
  // 太密会读成锯齿,太疏又摊不开"随势"的感觉。院墙没有这段沉深,
  // groundSteps 退回默认的 1(墙脚是平的一条直线,与沉深前的几何一致)。
  const groundSteps = courtyard ? 1 : Math.max(1, Math.round(L / 1.5));
  const groundDip = courtyard
    ? () => 0
    : (x: number) => -WALL_STYLE.baseSink * (0.5 - 0.5 * fbm2(simplex, x * 0.14 + 41.7, 5.2, 3));

  const plaster = plasterMaterial(1,true);
  const stone = stoneMaterial(1);
  const footMaterial = courtyard ? stone : tigerSkinMaterial(1);

  /* --- 墙体 --- */
  const bodyHoles: P2[][] = [];
  const MOON_R = WALL_STYLE.gate.radius;
  const MOON_CY = WALL_STYLE.gate.centerY;
  const WIN_Y0 = 1.3;
  const WIN_X = [-1.5, 1.5];
  if (kind === 'moon') bodyHoles.push(circlePts(0, MOON_CY, MOON_R + BEVEL, 96).reverse());
  if (kind === 'lattice') {
    for (const wx of WIN_X) {
      bodyHoles.push(
        roundedRect(wx - HALF - BEVEL, WIN_Y0 - BEVEL, wx + HALF + BEVEL, WIN_Y0 + WIN + BEVEL, 0.04, 5).reverse(),
      );
    }
  }
  const bodyOutline =
    kind === 'cloud'
      ? wavyRect(-hl + BEVEL, BEVEL, hl - BEVEL, (x) => BODY_TOP + wave(x) - BEVEL, 0.025)
      : roundedRect(-hl + BEVEL, BEVEL, hl - BEVEL, BODY_TOP - BEVEL, 0.025, 5);
  const bodyGeo = extrudeSolid(bodyOutline, bodyHoles, THICK, BEVEL, 3);
  projectUV(bodyGeo, 0.0, BODY_TOP, 2.6, true);
  // 棚拍的 key 光把 #f1ece2 推进 ACES 肩部,贴图里 8% 的潮渍差被压到看不见。
  // 用顶点色给墙脚压一层 泛潮(§3 #b9b2a3)向上渐淡:只是 y 的线性函数,
  // 在任何三角剖分上插值都精确,不需要加密网格。
  bakeDampGradient(bodyGeo, 0.35, 1.9);
  group.add(shadowed(new THREE.Mesh(bodyGeo, plaster)));

  /* --- 虎皮石墙脚 + 石礓("下面虎皮石,隨勢砌去",07-02) --- */
  const baseBevel = 0.018;
  const baseOutline =
    kind === 'moon'
      ? notchedRect(-hl - baseEnd + baseBevel, baseBevel, hl + baseEnd - baseBevel, BASE_H - baseBevel, 0.02, MOON_CY, MOON_R + 0.006 + baseBevel, groundSteps)
      : roundedRect(-hl - baseEnd + baseBevel, baseBevel, hl + baseEnd - baseBevel, BASE_H - baseBevel, 0.02, 4, groundSteps);
  const baseGeo = extrudeSolid(baseOutline, [], BASE_T, baseBevel, 3);
  projectUV(baseGeo, 0, 1.4, 1.4);
  sinkIntoGround(baseGeo, BASE_H, groundDip);
  group.add(shadowed(new THREE.Mesh(baseGeo, footMaterial)));

  const plinthBevel = 0.014;
  const plinthOutline = roundedRect(-hl - plinthEnd + plinthBevel, plinthBevel, hl + plinthEnd - plinthBevel, PLINTH_H - plinthBevel, 0.01, 3, groundSteps);
  const plinthGeo = extrudeSolid(plinthOutline, [], PLINTH_T, plinthBevel, 2);
  projectUV(plinthGeo, 0, 1.4, 1.4);
  sinkIntoGround(plinthGeo, PLINTH_H, groundDip);
  group.add(shadowed(new THREE.Mesh(plinthGeo, footMaterial)));

  /* --- 压顶 --- */
  for (const m of buildCoping(hl, wave, options.flushEnds)) group.add(shadowed(m));

  /* --- 月洞门:门槛 + 门套 --- */
  if (kind === 'moon') {
    const sillGeo = roundedBox(WALL_STYLE.gate.sillWidth, WALL_STYLE.gate.sillY, WALL_STYLE.gate.sillDepth, 0.02, 3);
    const sill = shadowed(new THREE.Mesh(sillGeo, stone));
    sill.position.set(0, WALL_STYLE.gate.sillY / 2, 0);
    group.add(sill);

    const ringBevel = 0.015;
    const ringOutline = ringSector(MOON_CY, WALL_STYLE.gate.clearRadius + ringBevel, MOON_R + 0.12 - ringBevel, WALL_STYLE.gate.sillY - .01 + ringBevel, 72);
    const ringGeo = extrudeSolid(ringOutline, [], 0.42, ringBevel, 3);
    projectUV(ringGeo, 0, 1.4, 1.4);
    group.add(shadowed(new THREE.Mesh(ringGeo, stone)));

    // 门额:字从 plan.json 读(99-26),给不出字就是不挂——不回落字面量。
    // 第二十六回「舉目望門上一看,只見匾上寫著『瀟湘館』三字」(07-61):匾在院门上。
    const plaqueText = parts[1] ? plaqueFromPlan(parts[1]) : undefined;
    if (plaqueText) {
      const plaque = makePlaque(plaqueText, 0.95);
      // 拱顶之上没有整段空墙(券脸顶 2.37,墙身上沿 2.44),门额骑跨券脸
      // 上段、突出墙面,如苏园月洞门题的装法;微俯让人在洞前仰头可读。
      plaque.position.set(0, 2.26, 0.24);
      plaque.rotation.x = 0.08;
      plaque.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      group.add(plaque);
    }
  }

  /* --- 漏窗:窗套 + 花格 --- */
  if (kind === 'lattice') {
    const wood = woodMaterial(CN.wood, 1);
    const frameBevel = 0.012;
    const FR = 0.07;
    WIN_X.forEach((wx, idx) => {
      const cy = WIN_Y0 + HALF;
      const outer = roundedRect(wx - HALF - FR + frameBevel, cy - HALF - FR + frameBevel, wx + HALF + FR - frameBevel, cy + HALF + FR - frameBevel, 0.03, 4);
      const inner = roundedRect(wx - HALF + 0.01 - frameBevel, cy - HALF + 0.01 - frameBevel, wx + HALF - 0.01 + frameBevel, cy + HALF - 0.01 + frameBevel, 0.03, 4).reverse();
      const frameGeo = extrudeSolid(outer, [inner], THICK + 0.04, frameBevel, 2);
      projectUV(frameGeo, 0, 1.4, 1.4);
      group.add(shadowed(new THREE.Mesh(frameGeo, stone)));

      const latticeGeo = gexinGeometry(sub, WIN, WIN, BAR, 1201 + idx * 977);
      const lattice = shadowed(new THREE.Mesh(latticeGeo, wood));
      lattice.position.set(wx, cy, 0);
      group.add(lattice);
    });
  }

  return { root: group, groundRadius: L * 0.85 };
}

registerPart('wall', (variant) => buildWall(variant === 'default' ? 'plain' : variant));
