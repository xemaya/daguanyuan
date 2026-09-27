import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { CN, plasterMaterial, stoneMaterial, tigerSkinMaterial, tileMaterial, woodMaterial } from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { Simplex, fbm2, makeRng, smoothstep, clamp, lerp } from '@engine/core/Noise';
import { WALL_STYLE } from './wall-style';
import { makePlaque } from '@builder/parts/xiaomu/plaque';
import { plaqueFromPlan } from '@builder/plan/objects';
import { mergeByMaterial } from '@builder/parts/merge';
import { XY, EARTH_TILE_M, earthWallMaterial, thatchMaterial, thatchEndMaterial, strawFringeMaterial } from '@builder/parts/xiangye/materials';
import { stations, splitByOpenings, arcAt, subPolyline, type P2 as XP2 } from '@builder/parts/xiangye/path';
import { liftSequence, rowsUpTo, lineWobble, mudPatch, tieHole } from '@builder/parts/xiangye/earth';
import { sweepSection, hangingStrip } from '@builder/parts/xiangye/sweep';
import { planLayout } from '@builder/parts/xiangye/plan-data';

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
 * 按法线主轴投影 UV。竖直面 v 从 y0 起按 h 归一,u 按 uScale 米一个 repeat;
 * 水平面按 h 平铺。`flipV`:CanvasTexture flipY 让烤图第 0 行落在 uv v=1,
 * 貼图内容若认「第 0 行在某一端」就要配这个开关——AN2 起粉墙贴图不再带
 * 方向性内容(潮渍已搬到顶点色,见 bakeDampGradient),这里仅剩历史选值,
 * 不影响正确性。
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

/**
 * 潮渍高度(单子 AN2):原先烤在 `plasterMaps` 贴图的 v 里,`projectUV` 又把 v
 * 按整段墙高(BODY_TOP)铺一次——同一条 smoothstep 软边不管这段墙 2.4m 还是
 * 8m 都出现在固定的高度**比例**上,跟 repeat 撞车,还查不清是不是白墙横色带
 * 的根(见 buildWall 里的排查记录)。改成只认**构件局部高度**(`bodyGeo` 的
 * y 本来就是 0=墙脚,不需要再传 yFoot/yDry):0→DAMP_FADE_M 线性退到干净,
 * 与这段墙多高、贴图 repeat 多少都无关。
 */
const DAMP_FADE_M = 0.45; // 墙脚起潮到退干净的高度
const DAMP_JITTER_M = 0.12; // 退干净高度的抖动幅度——潮痕不是一条直线

/** 顶点色:局部 y=0(墙脚)是潮渍色,DAMP_FADE_M(±沿墙走向的低频抖动)以上
 *  退净;中间线性(保证大三角形上插值不走样)。 */
function bakeDampGradient(geo: THREE.BufferGeometry, seed = 4409): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const stain = new THREE.Color(CN.plasterStain);
  const base = new THREE.Color(CN.plaster);
  const tint = new THREE.Color(stain.r / base.r, stain.g / base.g, stain.b / base.b);
  const simplex = new Simplex(seed);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // 沿墙走向(x)叠一路低频噪声,退干净的高度线不是死直线。
    const fade = Math.max(0.08, DAMP_FADE_M + fbm2(simplex, x * 0.55 + 2.7, 9.1, 3) * DAMP_JITTER_M);
    const t = clamp(y / fade, 0, 1);
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

export function buildWall(variant: string, options: { length?:number; flushEnds?:boolean; groundStation?:number } = {}): PartBuild {
  // 黄泥矮墙(稻香村,单子 BA3)走自己的一支,粉墙以下代码一行不经过。
  if (variant === 'mud' || variant.startsWith('mud:')) return buildMudWall(variant, options.length);
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
  // 青石、墙脚不沉。园墙以前都是 registry 直接摆的独立直墙段(flushEnds
  // 缺省 false);院墙都经 wall-path.ts 沿 plan 折线连续拼接首尾相接
  // (flushEnds 恒为 true,见 buildWallPath)。
  //
  // 单子 AI(2026-09-14)把 zhengmen.flanking-wall 也搬上 wall-path 之后,
  // "flushEnds 是否为真"就不能再直接当"是不是院墙"的信号了——正门这段
  // 墙既要 flushEnds:true(连续拼接、没有接缝),又要虎皮石随势起伏
  // (07-02「隨勢砌去」不能因为改了拼接方式就丢)。调用方(wall-path.ts
  // 的"园墙"分支)显式传 groundStation 来打破这个耦合:传了就说明"这段
  // 墙要虎皮石+起伏",不看 flushEnds;不传的路径(旧的独立摆放 wall、
  // 以及 xiaoxiangguan/longcuian 的 courtyard-wall)行为完全不变。
  const gardenFoot = options.groundStation !== undefined;
  const courtyard = !!options.flushEnds && !gardenFoot;
  // 同一颗噪声(借用云墙那颗、换一段不相关的取样区)按基脚位置给沉深——
  // 只沉不浮,见 WALL_STYLE.baseSink 的注释。A2:折点从每 ~1.5m 加密到每
  // ~0.4m——fbm 本身是平滑的,1.5m 的分段线性在远处读成规则锯齿(振幅
  // 0.08m、间距 45px 的低幅 zigzag),加密后插值贴着噪声走,锯齿消失。
  // 院墙(courtyard)没有这段沉深,groundSteps 退回默认的 1(墙脚是平的
  // 一条直线)。
  const groundSteps = courtyard ? 1 : Math.max(1, Math.round(L / 0.4));
  // gardenFoot 的墙取样坐标是"路径弧长"而不是本段局部 x:wall-path.ts
  // 传入的 groundStation 是这一段在整条折线上的起点里程(局部 x=-hl 处
  // 对应的里程),stationBase+x 就是该点在整条路径上的真实里程——相邻两
  // 段在拼接处的里程连续,同一条 fbm 曲线在同一里程取同一个值,墙脚沉深
  // 自然对得上,不用再对齐相位。独立摆放的墙(gardenFoot=false)仍按自己
  // 的本地 x 取样,行为不变。
  const stationBase = (options.groundStation ?? 0) + hl;
  const groundDip = courtyard
    ? () => 0
    : (x: number) => -WALL_STYLE.baseSink * (0.5 - 0.5 * fbm2(simplex, (gardenFoot ? stationBase + x : x) * 0.14 + 41.7, 5.2, 3));

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
  // 潮渍全靠顶点色(泛潮 §3 #b9b2a3 向上渐淡,见 bakeDampGradient);
  // 贴图(materials.ts 的 plasterMaps)自 AN2 起不再带潮渍,两套各管一段,
  // 不会互相打架。y 是构件局部高度上的分段线性函数,在任何三角剖分上
  // 插值都精确,不需要加密网格。
  bakeDampGradient(bodyGeo);
  group.add(shadowed(new THREE.Mesh(bodyGeo, plaster)));

  /* --- 虎皮石墙脚 + 石礓("下面虎皮石,隨勢砌去",07-02) --- */
  const baseBevel = 0.018;
  const baseOutline =
    kind === 'moon'
      ? notchedRect(-hl - baseEnd + baseBevel, baseBevel, hl + baseEnd - baseBevel, BASE_H - baseBevel, 0.02, MOON_CY, MOON_R + 0.006 + baseBevel, groundSteps)
      : roundedRect(-hl - baseEnd + baseBevel, baseBevel, hl + baseEnd - baseBevel, BASE_H - baseBevel, 0.02, 4, groundSteps);
  const baseGeo = extrudeSolid(baseOutline, [], BASE_T, baseBevel, 3);
  projectUV(baseGeo, 0, 2.8, 2.8);
  sinkIntoGround(baseGeo, BASE_H, groundDip);
  group.add(shadowed(new THREE.Mesh(baseGeo, footMaterial)));

  const plinthBevel = 0.014;
  const plinthOutline = roundedRect(-hl - plinthEnd + plinthBevel, plinthBevel, hl + plinthEnd - plinthBevel, PLINTH_H - plinthBevel, 0.01, 3, groundSteps);
  const plinthGeo = extrudeSolid(plinthOutline, [], PLINTH_T, plinthBevel, 2);
  projectUV(plinthGeo, 0, 2.8, 2.8);
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
      // 匾宽按「开间」算(单子 AG4):月洞门没有面阔柱缝,「开间」就是门洞净宽
      // (2×clearRadius)。别让这块匾还写死 0.95——大木作那块已经改成当心间
      // 净宽的函数,两处口径要一致,比例同取 0.62。
      const doorW = WALL_STYLE.gate.clearRadius * 2;
      const plaque = makePlaque(plaqueText, doorW * 0.62);
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

/* ================================================================== */
/* 黄泥矮墙(稻香村,单子 BA3)                                         */
/* ================================================================== */

/**
 * 07-11「一帶黃泥筑就矮牆,牆頭皆用稻莖掩護」。
 *
 * 墙身:黄泥版筑,版高不等(0.26–0.38 m,与茅屋土壁同一套 `xiangye/earth.ts`),逐版沿走线扫出,版与版之间
 * 圆角相接成浅槽(层线)且沿线起伏,泥抹痕盖掉一段段层线,两端版头塌角;底宽取 plan 的 widthM,顶收分;墙脚返潮走顶点色。
 * 墙头:一道**蓬松的稻茎草檐**——截面是中间拱起、两侧挑出墙面的草把,沿线逐站胖瘦不一,
 * 两侧挂参差的垂茬 alpha 卡;端头露草茬。**不是瓦压顶**:没有瓦垄、没有脊件。
 * 截面高宽取 plan(`heightM`/`widthM`),其余都是艺术取值,进 `userData.construction.provenance.art`。
 *
 * variant:
 *   mud                    6 m 直段(截面取 plan `daoxiangcun.mud-wall` 第一条 run)
 *   mud:<plan 对象 id>      按 plan 的 `layout.runs[]` 折线与 `openings[]` 开口生成(原点移到走线包围盒中心)
 */
const MUD = {
  /** 顶宽 / 底宽(收分)。 */
  taper: 0.86,
  /** 草檐:墙头以上的厚、两侧挑出、压进墙头的深、垂茬长。 */
  capRise: 0.16, capOverhang: 0.12, capSink: 0.05, fringe: 0.15,
};
const MUD_PROVENANCE = [
  { id: 'project:mud-wall-lift', name: '黄泥矮墙版高', method: 'artistic_choice', note: '版高 0.26–0.38 m 不等、层线起伏 ±2 cm、泥抹痕与穿棍孔、两端塌角(D-36 ② 返工),与茅屋土壁同一套;07-11 只给「黃泥筑就」名目。' },
  { id: 'project:mud-wall-taper', name: '泥墙收分', method: 'artistic_choice', note: '顶宽为底宽的 0.86;版筑墙上窄下宽,书无定数。' },
  { id: 'project:mud-wall-straw-cap', name: '稻茎墙头', method: 'artistic_choice', note: '07-11「牆頭皆用稻莖掩護」:草檐拱起 0.16 m、两侧挑出 0.12 m、垂茬 0.15 m;墙身顶 = plan heightM − 草檐拱起,总高仍为 plan heightM。' },
];

function mudRun(pts: XP2[], widthM: number, heightM: number, seed: number): THREE.Group {
  const group = new THREE.Group();
  const st = stations(pts, 0.25);
  const bodyTop = heightM - MUD.capRise, half0 = widthM / 2, half1 = half0 * MUD.taper;
  const rng = makeRng(seed), simplex = new Simplex(seed);
  const damp = new THREE.Color(XY.earthDamp), base = new THREE.Color(XY.earth);
  const tint = [damp.r / base.r, damp.g / base.g, damp.b / base.b];
  const color = (s: number, _n: number, y: number): [number, number, number] => {
    const fade = Math.max(0.12, 0.45 + 0.15 * fbm2(simplex, s * 0.7, 2.3, 3));
    const k = Math.pow(1 - clamp(y / fade, 0, 1), 0.7);
    const patch = 1 + 0.12 * fbm2(simplex, s * 0.55 + 9, y * 0.9, 4);
    return [lerp(1, tint[0], k) * patch, lerp(1, tint[1], k) * patch, lerp(1, tint[2], k) * patch];
  };
  // 墙身:逐版。
  // 版线:不等高(0.26–0.38 m)、沿线起伏 ±2 cm;每版一个泥色;两端版头随机缩进(塌角)。D-36 ②。
  const rows = rowsUpTo(liftSequence(seed + 5, bodyTop), bodyTop);
  const wob = lineWobble(seed + 6);
  const L = st[st.length - 1].s;
  const earth = earthWallMaterial();
  const widthAt = (y: number) => lerp(half0, half1, clamp(y / bodyTop, 0, 1));
  rows.forEach(([y0, y1, k], ri) => {
    const w0 = widthAt(y0), w1 = widthAt(y1), r = 0.014, j = (rng() - 0.5) * 0.01, tone = 0.9 + rng() * 0.16;
    const sec: [number, number][] = [
      [-w0 + r, y0], [w0 - r, y0], [w0 + j, y0 + r], [w1 + j, y1 - r], [w1 - r, y1], [-w1 + r, y1], [-w1 - j, y1 - r], [-w0 - j, y0 + r],
    ];
    const warp = (S: { s: number }, _j: number, _i: number, nn: number, y: number): [number, number] => {
      const lower = y < (y0 + y1) / 2, line = lower ? k : k + 1;
      const dy = line === 0 || (ri === rows.length - 1 && !lower) ? 0 : wob(line, S.s);
      return [nn * (1 + 0.025 * simplex.noise2D(S.s * 0.8, y * 3 + 5) + 0.012 * simplex.noise2D(S.s * 4.3, y * 7)), y + dy];
    };
    const c0 = rng() * rng() * 0.08, c1 = rng() * rng() * 0.08;
    const lst = stations(subPolyline(pts, c0, L - c1), 0.25).map((S) => ({ ...S, s: S.s + c0 }));
    const g = sweepSection(lst, sec, { tile: EARTH_TILE_M, color: (s0, n0, y) => color(s0, n0, y).map((v) => v * tone) as [number, number, number], warp });
    const m = new THREE.Mesh(g, earth); m.castShadow = m.receiveShadow = true; group.add(m);
  });
  // 泥抹痕(盖掉一段段层线)与穿棍孔,两面都有。
  const frameAt = (s0: number, side: number, y: number) => {
    let S = st[0];
    for (const x of st) if (Math.abs(x.s - s0) < Math.abs(S.s - s0)) S = x;
    const nl = Math.hypot(S.n[0], S.n[1]), nx = S.n[0] / nl, nz = S.n[1] / nl, off = widthAt(y) + 0.012;
    const X = new THREE.Vector3(S.t[0] * side, 0, S.t[1] * side), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(nx * side, 0, nz * side);
    return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(S.p[0] + nx * side * off, 0, S.p[1] + nz * side * off);
  };
  const decal = (g: THREE.BufferGeometry, s0: number, side: number, y: number) => {
    const uv: number[] = [], p = g.attributes.position;
    for (let i = 0; i < p.count; i++) uv.push((s0 + side * p.getX(i)) / EARTH_TILE_M, p.getY(i) / EARTH_TILE_M);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.applyMatrix4(frameAt(s0, side, y));
    g.computeVertexNormals();
    const c = g.getAttribute('color'), dc = color(s0, 0, y);
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * dc[0], c.getY(i) * dc[1], c.getZ(i) * dc[2]);
    const m = new THREE.Mesh(g, earth); m.receiveShadow = true; group.add(m);
  };
  for (const side of [-1, 1]) {
    for (let i = 0, n = Math.round(L * bodyTop * 1.6); i < n; i++) {
      const s0 = 0.25 + rng() * Math.max(0.01, L - 0.5), line = rows[(rng() * rows.length) | 0];
      const y = line[0] + (rng() - 0.3) * 0.2, rx = 0.15 + rng() * 0.4, ry = 0.07 + rng() * 0.12;
      if (y - ry < 0.06 || y + ry > bodyTop - 0.06) continue;
      decal(mudPatch(0, y + wob(line[2], s0), rx, ry, seed * 17 + i + side * 999, 0.8 + rng() * 0.38), s0, side, y);
    }
    rows.forEach(([y0, , k]) => {
      if (k === 0) return;
      for (let s0 = 0.3 + rng() * 0.4; s0 < L - 0.2; s0 += 0.55 + rng() * 0.5) {
        if (rng() < 0.45) continue;
        decal(tieHole(0, y0 + wob(k, s0), seed * 5 + k * 97 + ((s0 * 100) | 0) + side), s0, side, y0);
      }
    });
  }
  // 草檐截面:上拱、两侧挑出、底面压进墙头。
  const capH = half1 + MUD.capOverhang, yb = bodyTop - MUD.capSink, sec: [number, number][] = [];
  const NU = 14;
  for (let i = 0; i <= NU; i++) {
    const f = -1 + (2 * i) / NU, nn = f * capH;
    sec.push([nn, yb + 0.07 + (heightM - yb - 0.07) * (1 - Math.pow(Math.abs(f), 1.8))]);
  }
  sec.push([capH, yb + 0.02], [half1 * 0.7, yb], [-half1 * 0.7, yb], [-capH, yb + 0.02]);
  sec.reverse();
  const warp = (S: { s: number }, _j: number, i: number, nn: number, y: number): [number, number] => {
    const puff = 1 + 0.12 * simplex.noise2D(S.s * 1.3, 4.1) + 0.05 * simplex.noise2D(S.s * 5, i * 0.7);
    return [nn * (1 + 0.06 * simplex.noise2D(S.s * 2.1, 8.3)), yb + (y - yb) * puff];
  };
  const cap = sweepSection(st, sec, { arcV: true, tile: 1, warp, color: (s) => { const k = 0.92 + 0.08 * simplex.noise2D(s * 0.9, 1.7); return [k, k, k]; }, caps: false });
  const cm = new THREE.Mesh(cap, thatchMaterial()); cm.castShadow = cm.receiveShadow = true; group.add(cm);
  // 草檐端头草茬。
  for (const [S, dir] of [[st[0], -1], [st[st.length - 1], 1]] as const) {
    const tri = THREE.ShapeUtils.triangulateShape(sec.map(([a, b]) => new THREE.Vector2(a, b)), []);
    const pos: number[] = [], uv: number[] = [], col: number[] = [];
    const jj = dir < 0 ? 0 : st.length - 1;
    sec.forEach(([a, b], i) => {
      const [nn, y] = warp(S, jj, i, a, b);
      pos.push(S.p[0] + S.n[0] * nn + S.t[0] * dir * 0.01, y, S.p[1] + S.n[1] * nn + S.t[1] * dir * 0.01);
      uv.push(nn * 4, y * 4); col.push(0.95, 0.95, 0.95);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const idx = tri.flat();
    // 朝向沿切向朝外。
    const P = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const nrm = P(idx[1]).sub(P(idx[0])).cross(P(idx[2]).sub(P(idx[0])));
    if (nrm.x * S.t[0] * dir + nrm.z * S.t[1] * dir < 0) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, thatchEndMaterial()); m.castShadow = m.receiveShadow = true; group.add(m);
  }
  // 两侧垂茬。
  const fr = strawFringeMaterial();
  for (const side of [-1, 1]) {
    const g = hangingStrip(st, side * (capH - 0.03), (s) => yb + 0.04 + 0.01 * simplex.noise2D(s, side),
      side * (capH + 0.025), (s) => yb - MUD.fringe * (0.8 + 0.25 * simplex.noise2D(s * 1.7, side * 3)), 1.8, rng());
    const m = new THREE.Mesh(g, fr); m.castShadow = true; m.receiveShadow = true; group.add(m);
  }
  return group;
}

export function buildMudWall(variant: string, length?: number): PartBuild {
  const id = variant.startsWith('mud:') ? variant.slice(4) : '';
  const layout = planLayout(id || 'daoxiangcun.mud-wall', 'wall');
  const root = new THREE.Group();
  let runs: { pts: XP2[]; w: number; h: number }[];
  let origin: XP2 = [0, 0];
  if (!id) {
    const L = length ?? 6, r = layout.runs[0];
    runs = [{ pts: [[-L / 2, 0], [L / 2, 0]], w: r.widthM, h: r.heightM }];
  } else {
    const all = layout.runs.flatMap((r) => r.points);
    const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]);
    origin = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    runs = [];
    layout.runs.forEach((r, ri) => {
      const cuts = (layout.openings ?? []).filter((o) => o.run === ri).map((o) => {
        const hit = arcAt(r.points, o.at);
        if (hit.dist > 0.05) throw new Error(`[mud-wall] ${id} 开口 ${o.at} 不在第 ${ri} 条走线上`);
        return { s: hit.s, width: o.widthM };
      });
      for (const seg of splitByOpenings(r.points, cuts))
        runs.push({ pts: seg.map(([x, z]) => [x - origin[0], z - origin[1]] as XP2), w: r.widthM, h: r.heightM });
    });
  }
  runs.forEach((r, i) => root.add(mudRun(r.pts, r.w, r.h, 7303 + i * 101)));
  const merged = mergeByMaterial(root);
  merged.name = id || 'wall:mud';
  merged.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: MUD_PROVENANCE } };
  if (id) merged.userData.linear = { id, kind: 'wall', origin, segments: runs.length, basis: layout.basis };
  return { kind: 'wall-path', root: merged };
}
