import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { deriveRusticBuilding, type RusticSpec } from '@builder/derive/rustic/building';
import { deriveRusticDetail, type RusticDetail } from '@builder/derive/rustic/detail';
import { mergeByMaterial } from '../merge';
import { roundedBox, boxProjectedUV, noiseDisplace } from '../sculpt';
import { stoneMaterial, paperMaterial } from '../materials';
import { Simplex, makeRng, fbm2, clamp, smoothstep, lerp } from '@engine/core/Noise';
import { thatchUnderMaterial, freshThatchMaterial, freshStubbleMaterial, refinedPlasterMaterial, blueBrickMaterial, planedWoodMaterial } from './materials';
import { compileExteriorSteps } from '@builder/plan/building-access';
import { planItem } from './plan-data';
import { plaqueFromPlan } from '@builder/plan/objects';
import { makePlainPlaque } from '../xiaomu/plaque';
import { markFarLod, farBox } from './far-proxy';

/**
 * 茅屋近景(单子 BA2)——稻香村「數楹茅屋」「紙窗木榻」(07-11 / 07-13),C-r 乡野子档。
 *
 * 框架全部来自推导器 `deriveRusticBuilding`(开间、进深、柱高、坡 0.4、茅厚、出檐),
 * 近景细部来自 `deriveRusticDetail`(全部 provenance.art)。本文件**不另编尺寸**。
 *
 * 三件:
 *   茅苫 —— 悬山两坡。每坡一张顺坡起伏的苫面 + 两山出际的草卷(比苫厚、下垂出苫底)
 *          + 檐口一刀齐的草茬切面(自顶向下内收,迎光、比苫面亮)+ 椽上苇箔的苫底;
 *          屋脊压一道草把,草绳隔段捆扎。苫面贴图是逐根顺坡的草秆笔触,不是瓦垄。
 *   土壁 —— 黄泥版筑:逐版挤出(版与版之间是圆角相接的浅槽 = 层线),每版外皮随机进出几毫米;
 *          墙脚返潮走顶点色;门窗洞上下口对齐层线;纸窗 emissive 假透光(`P-05`,不许 transmission)。
 *   木构 —— 粗木无彩画:柱(微弯、微收分)、石柱础、额枋兼檐檩(两端出头)、脊檩金檩(两山悬出)、
 *          山面穿斗(中柱落地通脊、瓜柱立在穿枋上),檐下露椽头。柱头不出斗栱。
 *
 * 局部坐标:原点在台基底面中心,+Z 为正面(南),X 沿面阔。
 */

type V3 = [number, number, number];

export interface ThatchCottageOptions {
  spec: RusticSpec;
  platformH: number;
  /** plan 对象 id,只用于命名与 userData。 */
  id?: string;
  /** 匾的做法(plan 字段 `plaqueStyle`)。乡野只接 'plain-wood'(素木墨字);有匾文而没声明做法就抛。 */
  plaqueStyle?: string;
  seed?: number;
}

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });
  return o;
}
function addColor(geo: THREE.BufferGeometry, f: (x: number, y: number, z: number) => [number, number, number]): void {
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) col.set(f(p.getX(i), p.getY(i), p.getZ(i)), i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
function gridIndex(rows: number, cols: number, flip = false): number[] {
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  return idx;
}
/**
 * 让一块网格的朝向对上期望法线:逐三角把面法线投到「该朝的方向」上求和,反了就翻索引。
 * 闭合管(草脊)的面法线总和是零,不能只比一个常向量——`expect` 可以是按三角中心给方向的函数。
 */
function orient(geo: THREE.BufferGeometry, expect: THREE.Vector3 | ((c: THREE.Vector3) => THREE.Vector3)): void {
  const p = geo.attributes.position, ix = geo.index!;
  const n = new THREE.Vector3(), m = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let sum = 0;
  for (let t = 0; t < ix.count; t += 3) {
    a.fromBufferAttribute(p, ix.getX(t)); b.fromBufferAttribute(p, ix.getX(t + 1)); c.fromBufferAttribute(p, ix.getX(t + 2));
    n.subVectors(b, a).cross(c.clone().sub(a));
    m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    sum += n.dot(typeof expect === 'function' ? expect(m) : expect);
  }
  if (sum < 0) {
    const arr = ix.array as Uint32Array;
    for (let t = 0; t < arr.length; t += 3) { const s = arr[t + 1]; arr[t + 1] = arr[t + 2]; arr[t + 2] = s; }
    ix.needsUpdate = true;
  }
  geo.computeVertexNormals();
}
function meshGeo(pos: number[], uv: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  return g;
}

/** 圆木:沿 a→b,两端径 ra/rb,带微弯与表面起伏。 */
function log(a: V3, b: V3, ra: number, rb: number, seed: number, seg = 9, bend = 0.012): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const rings = Math.max(2, Math.ceil(len / 0.35));
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, rings, false);
  if (bend) {
    const p = g.attributes.position, s = new Simplex(seed);
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / len + 0.5, w = Math.sin(t * Math.PI) * bend;
      p.setX(i, p.getX(i) + w * s.noise2D(3.1, seed * 0.13));
      p.setZ(i, p.getZ(i) + w * s.noise2D(seed * 0.21, 7.7));
    }
  }
  noiseDisplace(g, Math.min(ra, rb) * 0.07, 7, seed, 2);
  const dir = B.clone().sub(A).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

/* ------------------------------------------------------------------ */
/* 茅苫                                                                 */
/* ------------------------------------------------------------------ */

interface RoofGeom { X: number; zTip: number; top: (z: number) => number; t: number; edge: number; belly: number; chamfer: number }

/**
 * 一坡茅苫(D-42 雅村,单子 BF1:新苫、修剪过)。截面(沿 X)= 左山**竖直切齐**的草边 → 饱满的苫面 → 右山切齐;
 * 顶角只倒一道小圆(`chamfer`),不再是鼓出下垂的草卷。沿坡逐站扫出:
 *   - 苫面顺坡**略鼓**(`belly`,中段最高),不是平板;起伏只剩毫米级(新苫压得匀);
 *   - 近檐 0.8 m 苫面往上加厚到 `edge`(檐口厚边 0.28 m,新苫檐口一层层压厚),苫底不动——椽不受影响;
 *   - 檐口站**竖直一刀切平**:切面用同一圈点三角化,与苫面共边,贴整齐的秆口贴图。
 */
function thatchSlope(g: RoofGeom, sign: 1 | -1, seed: number) {
  const { X, zTip, top, t, edge, belly, chamfer } = g;
  const extra = edge - t;
  const sec: { x: number; top: boolean; dy: number }[] = [];
  // 左山:自底向上竖直,再倒角上到苫面。
  for (let k = 0; k <= 4; k++) sec.push({ x: -X, top: false, dy: -t + ((t - chamfer) * k) / 4 });
  sec.push({ x: -X + chamfer * 0.3, top: true, dy: -chamfer * 0.3 });
  const N = Math.max(4, Math.ceil((2 * (X - chamfer)) / 0.15));
  for (let i = 0; i <= N; i++) sec.push({ x: -X + chamfer + (2 * (X - chamfer) * i) / N, top: true, dy: 0 });
  sec.push({ x: X - chamfer * 0.3, top: true, dy: -chamfer * 0.3 });
  for (let k = 4; k >= 0; k--) sec.push({ x: X, top: false, dy: -t + ((t - chamfer) * k) / 4 });
  const us: number[] = [0];
  for (let i = 1; i < sec.length; i++) us.push(us[i - 1] + Math.hypot(sec[i].x - sec[i - 1].x, sec[i].dy - sec[i - 1].dy));
  const C = sec.length;
  const NS = Math.max(6, Math.ceil(zTip / 0.12));
  const slopeLen = Math.hypot(1, (top(0) - top(zTip)) / zTip);
  const tint = new Simplex(seed + 91);
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const ends: V3[] = [];
  // 某站某点的高:基准坡 + 顺坡鼓 + 近檐加厚(加厚只加在上皮,且按点在截面里的高低比例摊:底边不动)。
  const yAt = (s: number, dy: number) => {
    const bump = belly * Math.sin((Math.PI * s) / zTip);
    const thick = extra * Math.pow(smoothstep(zTip - 0.8, zTip, s), 1.4);
    const f = clamp((dy + t) / t, 0, 1);
    return top(sign * s) + dy + (bump + thick) * f;
  };
  for (let j = 0; j <= NS; j++) {
    const s = (zTip * j) / NS, last = j === NS;
    for (let i = 0; i < C; i++) {
      const { x, dy } = sec[i];
      const y = yAt(s, dy), z = sign * s;
      pos.push(x, y, z);
      uv.push(us[i], s * slopeLen);
      const k = (1.02 - 0.05 * smoothstep(0.5 * zTip, zTip, s)) * (1 + 0.025 * tint.noise2D(x * 0.4, s * 0.5));
      col.push(k, k, k);
      if (last) ends.push([x, y, z]);
    }
  }
  const skin = meshGeo(pos, uv, gridIndex(NS + 1, C));
  skin.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  orient(skin, new THREE.Vector3(0, 1, 0.4 * sign));
  // 檐口切面:檐口站那一圈点(左山底 → 苫面 → 右山底)沿底边闭合,三角化。
  const tris = THREE.ShapeUtils.triangulateShape(ends.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const fp: number[] = [], fu: number[] = [], fi: number[] = [], fc: number[] = [];
  for (const [x, y, z] of ends) { fp.push(x, y, z + sign * 0.001); fu.push(x * 4, y * 4); fc.push(1, 1, 1); }
  for (const [a, b, c] of tris) fi.push(a, b, c);
  const face = meshGeo(fp, fu, fi);
  face.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
  orient(face, new THREE.Vector3(0, 0, sign));
  // 苫底(椽上苇箔)。
  const ux: number[] = [], uu: number[] = [], NX = 8, NZ = 6;
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const x = -X + (2 * X * i) / NX, s = (zTip * j) / NZ;
    ux.push(x, top(sign * s) - t, sign * s);
    uu.push(x * 2, s * slopeLen * 2);
  }
  const under = meshGeo(ux, uu, gridIndex(NZ + 1, NX + 1));
  orient(under, new THREE.Vector3(0, -1, 0));
  return { skin, face, under };
}

/**
 * 草脊(BF1 规整):一道圆润压实的脊筒——截面近圆、各处同粗;每 `tiePitch` 一道竹篾箍(微勒进 3%、箍本身是细管);
 * 两端平切收头(倒一道小圆),端面是整齐秆口。
 */
function ridgeRoll(X: number, y0: number, hw: number, hh: number, tiePitch: number) {
  const x0 = -X - 0.04, x1 = X + 0.04, SEG = 20;
  const NS = Math.ceil((x1 - x0) / 0.05);
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const ties: number[] = [];
  const nT = Math.max(1, Math.round((x1 - x0 - 0.5) / tiePitch));
  for (let i = 0; i <= nT; i++) ties.push(x0 + 0.25 + ((x1 - x0 - 0.5) * i) / nT);
  const radiusAt = (x: number) => {
    let k = 1;
    for (const tx of ties) k -= 0.03 * Math.exp(-(((x - tx) / 0.03) ** 2));
    const end = Math.min(x - x0, x1 - x);
    return k * (0.9 + 0.1 * smoothstep(0, 0.05, end));
  };
  const ringPt = (x: number, a: number): V3 => { const k = radiusAt(x); return [x, y0 + Math.sin(a) * hh * k, Math.cos(a) * hw * k]; };
  for (let j = 0; j <= NS; j++) {
    const x = x0 + ((x1 - x0) * j) / NS;
    for (let i = 0; i <= SEG; i++) {
      const a = (Math.PI * 2 * i) / SEG, p = ringPt(x, a);
      pos.push(...p);
      uv.push((a / (Math.PI * 2)) * Math.PI * (hw + hh), x);
      const k = 0.94 + 0.08 * Math.sin(a);
      col.push(k, k, k);
    }
  }
  const body = meshGeo(pos, uv, gridIndex(NS + 1, SEG + 1));
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  orient(body, (c) => new THREE.Vector3(0, c.y - y0, c.z));
  const caps: THREE.BufferGeometry[] = [];
  for (const [x, dir] of [[x0, -1], [x1, 1]] as const) {
    const cp: number[] = [x, y0, 0], cu: number[] = [0, 0], ci: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (Math.PI * 2 * i) / SEG, p = ringPt(x, a);
      cp.push(...p); cu.push(p[2] * 4, (p[1] - y0) * 4);
      if (i) ci.push(0, i, i + 1);
    }
    const cap = meshGeo(cp, cu, ci);
    cap.setAttribute('color', new THREE.Float32BufferAttribute(new Array((cp.length / 3) * 3).fill(1), 3));
    orient(cap, new THREE.Vector3(dir, 0, 0));
    caps.push(cap);
  }
  const ropes: THREE.BufferGeometry[] = [];
  for (const tx of ties) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 28; i++) {
      const a = (Math.PI * 2 * i) / 28, p = ringPt(tx, a);
      pts.push(new THREE.Vector3(p[0], y0 + (p[1] - y0) * 1.02, p[2] * 1.02));
    }
    ropes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 28, 0.018, 6, true));
  }
  return { body, caps, ropes };
}

/* ------------------------------------------------------------------ */
/* 雅村屋身的小木作(D-42,单子 BF2)                                    */
/* ------------------------------------------------------------------ */

/** 一根方料(x 宽、y 高、z 厚),中心 (cx,cy,cz)。刨光料:小倒角,不扰动。 */
function bar(w: number, h: number, t: number, cx: number, cy: number, cz: number, r = 0.006): THREE.BufferGeometry {
  const g = roundedBox(w, h, t, Math.min(r, Math.min(w, h, t) / 2 - 1e-4), 1);
  g.translate(cx, cy, cz);
  return g;
}
/**
 * 格心(简化步步锦):外一圈边条;横棂按 `pitch` 满跨,两横棂之间的竖棂在 1/4·3/4 与 1/2 两种位置间交替——
 * 一步一错,读成细密的格子而不是直棂。局部系:原点在格心中心,面朝 +Z。
 */
function lattice(w: number, h: number, b: number, pitch: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [], t = 0.022;
  out.push(bar(w, b, t, 0, h / 2 - b / 2, 0), bar(w, b, t, 0, -h / 2 + b / 2, 0), bar(b, h, t, -w / 2 + b / 2, 0, 0), bar(b, h, t, w / 2 - b / 2, 0, 0));
  const n = Math.max(2, Math.round(h / pitch)), m = Math.max(2, Math.round(w / pitch));
  for (let k = 1; k < n; k++) out.push(bar(w - b, b, t, 0, -h / 2 + (h * k) / n, 0));
  for (let k = 0; k < n; k++) {
    const y0 = -h / 2 + (h * k) / n, y1 = -h / 2 + (h * (k + 1)) / n;
    const xs = k % 2 ? [0.5] : m >= 4 ? [0.25, 0.75] : [0.5];
    for (const f of xs) out.push(bar(b, y1 - y0 - b, t, -w / 2 + w * f, (y0 + y1) / 2, 0));
  }
  return out;
}
/**
 * 一扇格扇(`door`)或槛窗扇:边梃抹头框;格扇自下而上 裙板 · 绦环板 · 格心,槛窗只有格心。
 * 格心后贴窗纸(`paperMaterial`,emissive 假透光,`P-05`)。局部系:原点在扇底中心,面朝 +Z。
 */
function leaf(w: number, h: number, door: boolean, stile: number, latBar: number, pitch: number) {
  const wood: THREE.BufferGeometry[] = [], paper: THREE.BufferGeometry[] = [], t = 0.045;
  wood.push(bar(stile, h, t, -w / 2 + stile / 2, h / 2, 0), bar(stile, h, t, w / 2 - stile / 2, h / 2, 0));
  const rails = door ? [0, 0.24, 0.33, 1] : [0, 1]; // 抹头(相对高),格扇四抹、槛窗两抹
  for (const f of rails) wood.push(bar(w - 2 * stile, stile, t, 0, stile / 2 + (h - stile) * f, 0));
  const inner = w - 2 * stile;
  if (door) {
    const y0 = stile, y1 = stile + (h - stile) * 0.24 - stile, y2 = stile + (h - stile) * 0.33 - stile;
    wood.push(bar(inner, y1 - y0 + 0.01, 0.02, 0, (y0 + y1) / 2, -0.008)); // 裙板
    wood.push(bar(inner, y2 - (y1 + stile) + 0.01, 0.02, 0, (y1 + stile + y2) / 2, -0.008)); // 绦环板
  }
  const g0 = door ? stile + (h - stile) * 0.33 : stile, g1 = h - stile, gh = g1 - g0;
  for (const g of lattice(inner, gh, latBar, pitch)) { g.translate(0, (g0 + g1) / 2, 0.004); wood.push(g); }
  const pane = new THREE.PlaneGeometry(inner, gh); pane.translate(0, (g0 + g1) / 2, -0.01); paper.push(pane);
  return { wood, paper };
}
/** 鼓形柱础:车削轮廓,腰鼓出。 */
function drumBase(r: number, h: number): THREE.BufferGeometry {
  const prof = [[0, 0], [r * 1.05, 0], [r * 1.12, h * 0.25], [r * 1.18, h * 0.55], [r * 1.08, h * 0.85], [r * 0.95, h], [0, h]].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(prof, 20);
}
/** 刨光圆料(柱、檩、椽):直、微收分,不弯不扰动。 */
function pole(a: V3, b: V3, ra: number, rb: number, seg = 12): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

/* ------------------------------------------------------------------ */
/* 装配                                                                 */
/* ------------------------------------------------------------------ */

export function buildThatchCottage(o: ThatchCottageOptions): PartBuild {
  const frame = deriveRusticBuilding(o.spec), m = frame.m, d: RusticDetail = deriveRusticDetail(frame);
  if (o.spec.window !== 'paper') throw new Error('竹牖(芦雪庵)尚无近景几何，不得替换成纸窗');
  if (!(o.platformH > 0)) throw new Error('茅屋须显式给台基高');
  const seed = o.seed ?? 1717;
  // D-42 雅村:台基按条石台基高(provenance.art),不再是 plan platformH 0.18 的土台。
  const fl = d.refined.stoneBaseM, slope = o.spec.roofSlope, t = o.spec.thatchThicknessM;
  const W = m.width, dh = m.depthHalf, zTip = dh + m.yanchu, X = W / 2 + d.gableOverhangM;
  const top = (z: number) => fl + m.ridgeY - Math.abs(z) * slope;
  const under = (z: number) => top(z) - t;
  const rd = d.rafterDM, pd = d.purlinDM;
  const beamTop = under(dh) - rd, beamBot = beamTop - m.lan.w;
  const wt = d.wallThicknessM, ow = d.wallOutsetM;

  const thatch = freshThatchMaterial(), stubble = freshStubbleMaterial(), reed = thatchUnderMaterial();
  const plaster = refinedPlasterMaterial(), brick = blueBrickMaterial(), wood = planedWoodMaterial(), stone = stoneMaterial(1), paper = paperMaterial();
  const group = new THREE.Group();
  const add = (g: THREE.BufferGeometry, mat: THREE.Material) => group.add(shadowed(new THREE.Mesh(g, mat)));

  /* --- 茅苫(BF1:新苫修齐)--- */
  const roofG: RoofGeom = { X, zTip, top, t, edge: d.eaveEdgeM, belly: d.roofBellyM, chamfer: d.vergeChamferM };
  for (const sign of [1, -1] as const) {
    const s = thatchSlope(roofG, sign, seed + (sign > 0 ? 0 : 50));
    add(s.skin, thatch); add(s.face, stubble); add(s.under, reed);
  }
  const ridge = ridgeRoll(X, top(0) + d.ridgeRollHalfHeightM * 0.45, d.ridgeRollHalfWidthM, d.ridgeRollHalfHeightM, d.ridgeTiePitchM);
  add(ridge.body, thatch);
  for (const c of ridge.caps) add(c, stubble);
  for (const r of ridge.ropes) add(r, reed);

  /* ================= 屋身(D-42 雅村,单子 BF2) ================= */
  const R = d.refined;
  const porch = m.columnX.length >= 4 ? R.porchDepthM : 0; // 三间以上出一步廊;两间厢舍不出廊(体量次一级)
  const zf = porch ? dh - porch : dh; // 前檐装修所在的缝:出廊则退到金柱缝
  const mg = d.platformMarginM;
  const PW = W + 2 * (ow + mg), PD = 2 * (dh + ow + mg);

  /* --- 椽(刨光、等距):出廊则廊内整段外露 --- */
  const xr0 = -X + 0.18, count = Math.max(2, Math.round((2 * -xr0) / d.rafterPitchM));
  const tipS = zTip - d.rafterTipSetbackM;
  for (let i = 0; i <= count; i++) {
    const x = xr0 + (-2 * xr0 * i) / count, r = rd / 2;
    const inGable = Math.abs(x) > W / 2 - 0.05;
    for (const sign of [1, -1]) {
      const s0 = inGable ? 0.12 : (sign > 0 ? zf : dh) - 0.05;
      const y = (s: number) => under(s) - r;
      add(pole([x, y(s0), sign * s0], [x, y(tipS), sign * tipS], r, r * 0.95, 8), wood);
    }
  }
  /* --- 檩:脊檩、前后金檩(两山悬出)--- */
  for (const z of [0, dh / 2, -dh / 2]) {
    const y = under(z) - rd - pd / 2;
    add(pole([-X + 0.18, y, z], [X - 0.18, y, z], pd / 2, pd / 2, 14), wood);
  }
  /* --- 额枋兼檐檩(前后,两端出头)、出廊时的金枋与穿插枋 --- */
  for (const z of [dh, -dh]) add(bar(2 * (X - 0.2), m.lan.w, m.lan.t, 0, (beamTop + beamBot) / 2, z, 0.012), wood);
  if (porch) {
    add(bar(W, m.lan.w, m.lan.t, 0, (beamTop + beamBot) / 2, zf, 0.012), wood);
    for (const x of m.columnX) add(bar(m.lan.t * 0.85, 0.16, porch + 0.1, x, beamBot - 0.2, (dh + zf) / 2, 0.01), wood);
  }
  /* --- 柱与鼓形柱础 --- */
  const colR = m.columnD / 2, colTop = beamTop - 0.03;
  const columnAt = (x: number, z: number, h1: number) => {
    const b = drumBase(colR * 1.25, R.drumH); b.translate(x, fl, z); add(b, stone);
    add(pole([x, fl + R.drumH - 0.01, z], [x, h1, z], colR, colR * 0.93), wood);
  };
  for (const x of m.columnX) {
    columnAt(x, dh, colTop); columnAt(x, -dh, colTop);
    if (porch) columnAt(x, zf, colTop);
  }
  /* --- 山面:穿枋、中柱、瓜柱(刨光,半露于山墙)--- */
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2);
    add(bar(m.lan.t, m.lan.w, 2 * dh + 0.3, x, (beamTop + beamBot) / 2, 0, 0.012), wood);
    columnAt(x, 0, under(0) - rd - pd + 0.02);
    for (const z of [dh / 2, -dh / 2]) add(pole([x, beamTop - 0.02, z], [x, under(z) - rd - pd + 0.02, z], 0.07, 0.066), wood);
  }

  /* --- 墙:细抹浅黄壁 + 青砖下碱(后檐墙、两山;出廊时两山直抵檐柱,成廊心墙)--- */
  const uvWall = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); g.setAttribute('uv', boxProjectedUV(g, 1 / 1.5)); return g; };
  const uvBrick = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); g.setAttribute('uv', boxProjectedUV(g, 1 / 0.96)); return g; };
  const aF = W / 2 + ow;
  {
    const zb = -(dh + ow) + wt / 2;
    add(uvWall(bar(2 * aF, beamBot - fl, wt, 0, (fl + beamBot) / 2, zb, 0.01)), plaster);
    add(uvBrick(bar(2 * aF + 0.02, R.dadoM, wt + 0.03, 0, fl + R.dadoM / 2, zb, 0.008)), brick);
    // 后檐额枋上、椽空当:封护檐(细抹)。
    add(uvWall(bar(W + 2 * ow - 0.04, under(dh) - beamTop + 0.02, wt * 0.6, 0, (under(dh) + beamTop) / 2, -dh + wt * 0.3 + 0.03, 0.01)), plaster);
  }
  const gableTop = (a: number) => under(a) - rd;
  for (const sx of [-1, 1]) {
    const A = dh + ow, yEdge = gableTop(A), yRidge = gableTop(0);
    const sh = new THREE.Shape([new THREE.Vector2(-A, fl), new THREE.Vector2(A, fl), new THREE.Vector2(A, yEdge), new THREE.Vector2(0, yRidge), new THREE.Vector2(-A, yEdge)]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: wt, bevelEnabled: false });
    g.translate(0, 0, -wt / 2); // 形状 X = 沿进深 z,Y = 高;挤出方向 = 墙厚
    g.rotateY(Math.PI / 2);
    g.translate(sx * (W / 2 + ow - wt / 2), 0, 0);
    add(uvWall(g), plaster);
    add(uvBrick(bar(wt + 0.03, R.dadoM, 2 * A + 0.02, sx * (W / 2 + ow - wt / 2), fl + R.dadoM / 2, 0, 0.008)), brick);
  }
  if (!porch) add(uvWall(bar(W + 2 * ow - 0.04, under(dh) - beamTop + 0.02, wt * 0.6, 0, (under(dh) + beamTop) / 2, dh - wt * 0.3 - 0.03, 0.01)), plaster);
  else add(uvWall(bar(W - 0.04, under(zf) - rd - beamTop + 0.02, 0.12, 0, (under(zf) - rd + beamTop) / 2, zf - 0.02, 0.01)), plaster); // 金枋上走马板

  /* --- 台基:条石(阶条石压面,缝 6 mm)+ 明间前踏跺 --- */
  add(bar(PW - 0.02, fl - 0.1, PD - 0.02, 0, (fl - 0.1) / 2, 0, 0.01), stone);
  add(bar(PW - 0.72, 0.1, PD - 0.72, 0, fl - 0.05, 0, 0.004), stone);
  {
    const band = 0.36, seg = 1.3;
    const lay = (len: number, along: 'x' | 'z', off: number) => {
      const n = Math.max(1, Math.round(len / seg));
      for (let k = 0; k < n; k++) {
        const c = -len / 2 + (len * (k + 0.5)) / n, L = len / n - 0.006;
        add(along === 'x' ? bar(L, 0.1, band, c, fl - 0.05, off, 0.006) : bar(band, 0.1, L, off, fl - 0.05, c, 0.006), stone);
      }
    };
    lay(PW, 'x', PD / 2 - band / 2); lay(PW, 'x', -PD / 2 + band / 2);
    lay(PD - 2 * band, 'z', PW / 2 - band / 2); lay(PD - 2 * band, 'z', -PW / 2 + band / 2);
  }
  const bays = m.columnX.slice(1).map((x1, i) => ({ c: (x1 + m.columnX[i]) / 2, w: x1 - m.columnX[i] }));
  const doorBay = Math.floor(bays.length / 2);
  const steps = compileExteriorSteps(fl, PW / 2, PD / 2, 'front', { widthM: bays[doorBay].w - 0.3, treadM: R.stepTreadM, maxRiserM: R.stepMaxRiserM }, bays[doorBay].c);
  for (const st of steps) add(bar(st.hx * 2, st.y, st.hz * 2, st.cx, st.y / 2, st.cz, 0.008), stone);

  /* --- 前檐装修:抱框、门槛、中槛、横披;明间格扇、次间槛墙 + 槛窗 --- */
  const woodG: THREE.BufferGeometry[] = [], paperG: THREE.BufferGeometry[] = [];
  const topY = beamBot, midY = beamBot - R.transomM, sill = 0.12;
  bays.forEach((b, i) => {
    const x0 = b.c - b.w / 2 + colR, x1 = b.c + b.w / 2 - colR, frame = 0.09, cw = x1 - x0 - 2 * frame;
    woodG.push(bar(frame, topY - fl, 0.12, x0 + frame / 2, (fl + topY) / 2, zf), bar(frame, topY - fl, 0.12, x1 - frame / 2, (fl + topY) / 2, zf));
    woodG.push(bar(cw, 0.1, 0.12, b.c, midY - 0.05, zf)); // 中槛
    // 横披:一整块格心。
    const th = topY - midY - 0.02;
    for (const g of lattice(cw, th, R.latticeBarM, R.latticePitchM)) { g.translate(b.c, midY + th / 2, zf + 0.02); woodG.push(g); }
    const tp = new THREE.PlaneGeometry(cw, th); tp.translate(b.c, midY + th / 2, zf); paperG.push(tp);
    const n = R.leavesPerBay, lw = cw / n;
    if (i === doorBay) {
      woodG.push(bar(cw + 2 * frame, sill, 0.14, b.c, fl + sill / 2, zf)); // 门槛
      const lh = midY - 0.1 - (fl + sill) - 0.01;
      for (let k = 0; k < n; k++) {
        const L = leaf(lw - 0.006, lh, true, R.stileM, R.latticeBarM, R.latticePitchM);
        const dx = b.c - cw / 2 + lw * (k + 0.5);
        for (const g of L.wood) { g.translate(dx, fl + sill, zf + 0.02); woodG.push(g); }
        for (const g of L.paper) { g.translate(dx, fl + sill, zf + 0.02); paperG.push(g); }
      }
    } else {
      const kh = R.kanWallM;
      add(uvBrick(bar(cw, kh, 0.26, b.c, fl + kh / 2, zf - 0.04, 0.006)), brick); // 槛墙
      woodG.push(bar(cw + 0.06, 0.06, 0.34, b.c, fl + kh + 0.03, zf, 0.008)); // 榻板
      const lh = midY - 0.1 - (fl + kh + 0.06) - 0.01;
      for (let k = 0; k < n; k++) {
        const L = leaf(lw - 0.006, lh, false, R.stileM, R.latticeBarM, R.latticePitchM);
        const dx = b.c - cw / 2 + lw * (k + 0.5);
        for (const g of L.wood) { g.translate(dx, fl + kh + 0.06, zf + 0.02); woodG.push(g); }
        for (const g of L.paper) { g.translate(dx, fl + kh + 0.06, zf + 0.02); paperG.push(g); }
      }
    }
  });
  for (const g of woodG) add(g, wood);
  for (const g of paperG) add(g, paper);

  /* --- 匾:素木板墨字,挂明间檐下(D-36 ④)。字从 plan 读,读不到就不挂 --- */
  const plaqueText = o.id ? plaqueFromPlan(o.id) : undefined;
  if (plaqueText && o.plaqueStyle !== 'plain-wood')
    throw new Error(`[xiangye] ${o.id} 有匾文「${plaqueText}」但 plaqueStyle 不是 plain-wood——乡野不施彩画,不许回落成黑漆金字`);
  if (plaqueText) {
    const b = bays[doorBay], pw = (m.columnX[doorBay + 1] - m.columnX[doorBay]) * 0.42;
    const pl = makePlainPlaque(plaqueText, pw);
    const ph = pw * 0.4;
    pl.rotation.x = 0.1;
    pl.position.set(b.c, beamTop - ph * 0.45, dh + m.lan.t / 2 + 0.035);
    group.add(shadowed(pl));
  }
  const root = mergeByMaterial(group);
  root.name = o.id ?? 'thatch-cottage';
  // 单子 BC2:远景档——台基一块、屋身一块、茅顶一道两坡(厚 t,前后挑出到檐口、两山挑出到出际)。
  // 120 m 外一个像素约 0.16 m:檐口乱茬、椽头、窗棂全在一个像素以下,体块与茅顶的色块才是那一眼读到的东西。
  {
    const bodyTop = beamTop;
    const plat = farBox(PW, fl, PD, 0, 0, 0, stone, 1);
    const body = farBox(W + 2 * ow, bodyTop - fl, (zf + dh + ow), 0, fl, (zf - dh - ow) / 2, plaster, 1.5);
    const prof = new THREE.Shape([
      new THREE.Vector2(-zTip, top(zTip) - t), new THREE.Vector2(0, top(0) - t), new THREE.Vector2(zTip, top(zTip) - t),
      new THREE.Vector2(zTip, top(zTip)), new THREE.Vector2(0, top(0)), new THREE.Vector2(-zTip, top(zTip)),
    ]);
    const rg = new THREE.ExtrudeGeometry(prof, { depth: 2 * X, bevelEnabled: false });
    rg.rotateY(-Math.PI / 2);
    rg.translate(X, 0, 0);
    rg.computeVertexNormals();
    const roof = new THREE.Mesh(rg, thatch);
    roof.castShadow = roof.receiveShadow = true;
    markFarLod(root, [plat, body, roof]);
  }
  root.userData.construction = { paramSet: 'rustic', tier: 'C-r', roofType: frame.roofType,
    provenance: { evidence: frame.provenance.evidence, inference: [], art: [...frame.provenance.art, ...d.provenance.art] } };
  if (o.id) root.userData.planObject = { id: o.id };
  // 入世界:装配器按 BuildingResult 登记台基平台、踏跺与阻挡。屋身(到前檐装修那一缝)整块挡人;
  // 出廊时廊子可站(从踏跺上去),檐柱各挡一小块。
  const blockers = [{ cx: 0, cz: (zf - dh - ow) / 2, hx: W / 2 + ow, hz: (zf + dh + ow) / 2 + 0.03, h: fl + m.columnH + m.lan.w }];
  if (porch) for (const x of m.columnX) blockers.push({ cx: x, cz: dh, hx: colR, hz: colR, h: fl + m.columnH });
  return { kind: 'building', root, groundRadius: Math.max(W, 2 * dh) * 1.1, frame,
    platform: { hx: PW / 2, hz: PD / 2, y: fl }, walkSurfaces: steps, blockers } as PartBuild;
}

/** 棚拍/落位:variant = plan 里的茅屋 id;default = 茆堂。 */
export function buildPlannedCottage(variant: string): PartBuild {
  const id = variant === 'default' ? 'daoxiangcun.main-cottage' : variant;
  const item = planItem(id);
  const c = item.construction;
  if (item.kind !== 'building' || !c) throw new Error(`[xiangye] ${id} 不是带施工规格的房屋`);
  const spec = c.spec as RusticSpec;
  if (spec.paramSet !== 'rustic') throw new Error(`[xiangye] ${id} 不是乡野子档，茅屋构件不接`);
  return buildThatchCottage({ spec, platformH: c.options.platformH!, id, plaqueStyle: (item as { plaqueStyle?: string }).plaqueStyle });
}
