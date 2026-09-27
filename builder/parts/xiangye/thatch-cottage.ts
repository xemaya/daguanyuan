import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { deriveRusticBuilding, type RusticSpec } from '@builder/derive/rustic/building';
import { deriveRusticDetail, type RusticDetail } from '@builder/derive/rustic/detail';
import { mergeByMaterial } from '../merge';
import { roundedBox, boxProjectedUV, noiseDisplace } from '../sculpt';
import { stoneMaterial, paperMaterial } from '../materials';
import { Simplex, makeRng, fbm2, clamp, smoothstep, lerp } from '@engine/core/Noise';
import { XY, EARTH_TILE_M, thatchMaterial, thatchEndMaterial, thatchUnderMaterial, earthWallMaterial, roughWoodMaterial, strawFringeMaterial, tampedEarthMaterial } from './materials';
import { planItem } from './plan-data';
import { plaqueFromPlan } from '@builder/plan/objects';
import { makePlainPlaque } from '../xiaomu/plaque';
import { liftSequence, rowsUpTo, lineWobble, mudPatch, tieHole } from './earth';

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

interface RoofGeom { W: number; X: number; zTip: number; top: (z: number) => number; t: number; r: number; below: number; undercut: number }

/**
 * 一坡茅苫。截面(沿 X)= 左草卷(自底绕外侧到顶)→ 苫面 → 右草卷(自顶绕外侧到底);
 * 沿坡逐站扫出。最末一站是檐口:自顶向下内收 `undercut`,草茬切面用同一圈点三角化,
 * 与苫面共边、不留缝。
 */
function thatchSlope(g: RoofGeom, sign: 1 | -1, lump: (x: number, s: number) => number, seed: number) {
  const { X, zTip, top, t, r, below, undercut } = g;
  // --- 截面 ---
  const sec: { x: number; dy: number; roll: number }[] = [];
  const cy = -t - below + r, cxL = -X + r;
  const RS = 9;
  for (let i = 0; i <= RS; i++) { // 左卷:θ 从 -π/2 → -3π/2
    const th = -Math.PI / 2 - (Math.PI * i) / RS;
    sec.push({ x: cxL + r * Math.cos(th), dy: cy + r * Math.sin(th), roll: 1 - Math.max(0, Math.sin(th + Math.PI)) * 0 });
  }
  const flatTop = cy + r;
  const N = Math.max(4, Math.ceil((2 * (X - r)) / 0.12));
  for (let i = 1; i < N; i++) {
    const x = cxL + (2 * (X - r) * i) / N;
    // 离草卷 0.25 m 内苫面从卷顶缓落到苫面(卷比苫面鼓)。
    const e = Math.min(x - cxL, X - r - x);
    sec.push({ x, dy: lerp(flatTop, 0, smoothstep(0, 0.25, e)), roll: 0 });
  }
  for (let i = 0; i <= RS; i++) { // 右卷:θ 从 π/2 → -π/2
    const th = Math.PI / 2 - (Math.PI * i) / RS;
    sec.push({ x: -cxL + r * Math.cos(th), dy: cy + r * Math.sin(th), roll: 1 });
  }
  for (let i = 0; i <= RS; i++) sec[i].roll = 1;
  // u = 截面弧长。
  const us: number[] = [0];
  for (let i = 1; i < sec.length; i++) us.push(us[i - 1] + Math.hypot(sec[i].x - sec[i - 1].x, sec[i].dy - sec[i - 1].dy));
  const C = sec.length;
  // --- 沿坡站点 ---
  const NS = Math.max(6, Math.ceil(zTip / 0.12));
  const slopeLen = Math.hypot(1, (top(0) - top(zTip)) / zTip);
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const tint = new Simplex(seed + 91);
  const ends: V3[] = [];
  for (let j = 0; j <= NS; j++) {
    const s = (zTip * j) / NS, last = j === NS;
    for (let i = 0; i < C; i++) {
      const { x, dy, roll } = sec[i];
      // 苫面起伏(卷上减半),檐口最后 0.12 m 顶边圆下去一点(风雨磨圆)。
      const bump = lump(x, s) * (roll ? 0.5 : 1);
      const round = -0.035 * Math.pow(smoothstep(zTip - 0.14, zTip, s), 2) * smoothstep(-t, 0, dy);
      const y = top(sign * s) + dy + bump + round;
      // 檐口站:自顶向下内收。
      const back = last ? undercut * clamp(-dy / t, 0, 1.1) : 0;
      const z = sign * (s - back);
      pos.push(x, y, z);
      uv.push(us[i], s * slopeLen);
      // 顶点色:近檐发灰发暗(淋得多)、斑驳、草卷背阴面暗。
      const weather = lerp(1.04, 0.84, smoothstep(0.35 * zTip, zTip, s));
      const patch = 1 + 0.07 * fbm2(tint, x * 0.45, s * 0.6, 3);
      const under = roll && dy < cy ? lerp(1, 0.62, clamp((cy - dy) / r, 0, 1)) : 1;
      const k = weather * patch * under;
      col.push(k, k * 0.99, k * 0.96);
      if (last) ends.push([x, y, z]);
    }
  }
  const skin = meshGeo(pos, uv, gridIndex(NS + 1, C));
  skin.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  orient(skin, new THREE.Vector3(0, 1, 0.4 * sign));
  // --- 檐口草茬切面:用檐口站那一圈点三角化(沿底边闭合)---
  const shape = ends.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(shape, []);
  const fp: number[] = [], fu: number[] = [], fi: number[] = [], fc: number[] = [];
  const ft = new Simplex(seed + 7);
  for (const [x, y, z] of ends) {
    fp.push(x, y, z);
    fu.push(x * 4, y * 4);
    const k = 1.0 + 0.06 * ft.noise2D(x * 1.7, 0.3);
    fc.push(k, k, k);
  }
  for (const [a, b, c] of tris) fi.push(a, b, c);
  const face = meshGeo(fp, fu, fi);
  face.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
  orient(face, new THREE.Vector3(0, 0, sign));
  // --- 苫底(椽上苇箔)---
  const ux: number[] = [], uu: number[] = [], NX = 8, NZ = 6;
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const x = -X + r + (2 * (X - r) * i) / NX, s = ((zTip - undercut) * j) / NZ;
    ux.push(x, top(sign * s) - t, sign * s);
    uu.push(x * 2, s * slopeLen * 2);
  }
  const under = meshGeo(ux, uu, gridIndex(NZ + 1, NX + 1));
  orient(under, new THREE.Vector3(0, -1, 0));
  return { skin, face, under };
}

/** 草脊:沿 X 的一道草把,椭圆截面,隔段草绳勒一道;两端露草茬。 */
function ridgeRoll(X: number, y0: number, hw: number, hh: number, tiePitch: number, seed: number) {
  const s = new Simplex(seed);
  const x0 = -X - 0.05, x1 = X + 0.05, SEG = 16;
  const NS = Math.ceil((x1 - x0) / 0.06);
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const ties: number[] = [];
  for (let x = Math.ceil((x0 + 0.25) / tiePitch) * tiePitch; x <= x1 - 0.25; x += tiePitch) ties.push(x);
  if (!ties.length) ties.push(0);
  const radiusAt = (x: number, a: number) => {
    let k = 1 + 0.06 * s.noise2D(x * 2.2, a * 0.7) + 0.04 * s.noise2D(x * 7, a * 2);
    for (const tx of ties) k -= 0.13 * Math.exp(-(((x - tx) / 0.035) ** 2));
    const end = Math.min(x - x0, x1 - x);
    k *= lerp(0.55, 1, smoothstep(0, 0.16, end));
    return k;
  };
  const ringPt = (x: number, a: number): V3 => {
    const k = radiusAt(x, a);
    return [x, y0 + Math.sin(a) * hh * k, Math.cos(a) * hw * k];
  };
  for (let j = 0; j <= NS; j++) {
    const x = x0 + ((x1 - x0) * j) / NS;
    for (let i = 0; i <= SEG; i++) {
      const a = (Math.PI * 2 * i) / SEG;
      const p = ringPt(x, a);
      pos.push(...p);
      uv.push((a / (Math.PI * 2)) * Math.PI * (hw + hh), x);
      const k = (0.9 + 0.1 * Math.sin(a)) * (1 + 0.05 * s.noise2D(x * 0.8, 3));
      col.push(k, k, k * 0.97);
    }
  }
  const body = meshGeo(pos, uv, gridIndex(NS + 1, SEG + 1));
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  orient(body, (c) => new THREE.Vector3(0, c.y - y0, c.z));
  // 两端草茬:端环扇形封口。
  const caps: THREE.BufferGeometry[] = [];
  for (const [x, dir] of [[x0, -1], [x1, 1]] as const) {
    const cp: number[] = [x + dir * 0.012, y0, 0], cu: number[] = [0, 0], ci: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (Math.PI * 2 * i) / SEG, p = ringPt(x, a);
      cp.push(...p); cu.push(p[2] * 4, (p[1] - y0) * 4);
      if (i) ci.push(0, i, i + 1);
    }
    const cap = meshGeo(cp, cu, ci);
    cap.setAttribute('color', new THREE.Float32BufferAttribute(new Array((cp.length / 3) * 3).fill(0.95), 3));
    orient(cap, new THREE.Vector3(dir, 0, 0));
    caps.push(cap);
  }
  // 草绳:每道一圈细管。
  const ropes: THREE.BufferGeometry[] = [];
  for (const tx of ties) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (Math.PI * 2 * i) / 24, p = ringPt(tx, a);
      pts.push(new THREE.Vector3(p[0], y0 + (p[1] - y0) * 1.06, p[2] * 1.06));
    }
    ropes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 24, 0.016, 5, true));
  }
  return { body, caps, ropes };
}

/* ------------------------------------------------------------------ */
/* 土壁                                                                 */
/* ------------------------------------------------------------------ */

interface Opening { a0: number; a1: number; r0: number; r1: number }

/** 版筑行:截面圆角矩形(厚 × 版高)沿墙长挤出,沿长度加密。局部系 x=沿墙 a、y=高、z=外法线(外皮 z=0)。 */
function liftSlab(a0: number, a1: number, y0: number, y1: number, wt: number, out: number, rr = 0.014): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const n0 = 0, n1 = wt; // 形状 X = 入墙深 n
  sh.moveTo(n0 + rr, y0);
  sh.lineTo(n1 - rr, y0); sh.quadraticCurveTo(n1, y0, n1, y0 + rr);
  sh.lineTo(n1, y1 - rr); sh.quadraticCurveTo(n1, y1, n1 - rr, y1);
  sh.lineTo(n0 + rr, y1); sh.quadraticCurveTo(n0, y1, n0, y1 - rr);
  sh.lineTo(n0, y0 + rr); sh.quadraticCurveTo(n0, y0, n0 + rr, y0);
  const len = a1 - a0;
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, steps: Math.max(1, Math.ceil(len / 0.2)), bevelEnabled: false, curveSegments: 3 });
  // 形状 (X=n, Y=y, Z=a) → rotateY(π/2):x=Z=a、z=-X=-n。
  g.rotateY(Math.PI / 2);
  g.translate(a0, 0, out);
  return g;
}
/** 山尖行:版带与山墙五边形的交,沿墙厚挤出并倒圆(倒圆就是层线槽)。 */
function gableSlab(poly: [number, number][], wt: number, out: number): THREE.BufferGeometry {
  const sh = new THREE.Shape(poly.map(([a, y]) => new THREE.Vector2(a, y)));
  const bev = 0.014;
  const g = new THREE.ExtrudeGeometry(sh, { depth: wt - 2 * bev, bevelEnabled: true, bevelSize: bev * 0.8, bevelThickness: bev, bevelSegments: 2, curveSegments: 2 });
  g.translate(0, 0, out - wt + bev);
  return g;
}

/**
 * 一面土壁(局部系)。版线取全栋共用的 `seq`(不等高);层线沿墙起伏(`wob`),外皮逐段鼓瘪;
 * 墙端与门窗边的版头随机缩进(塌角);另撒泥抹痕与穿棍孔(`earth.ts`)。
 * 每块几何带 `userData.tone`(一版一个泥色,由调用方乘进顶点色)。
 */
function earthWall(opts: { a0: number; a1: number; height: number; topAt?: (a: number) => number; ridgeA?: number;
  wt: number; seq: number[]; openings: Opening[]; seed: number }): THREE.BufferGeometry[] {
  const { a0, a1, wt, seq, openings } = opts;
  const rng = makeRng(opts.seed), bump = new Simplex(opts.seed + 1);
  const wob = lineWobble(opts.seed + 2);
  const out: THREE.BufferGeometry[] = [];
  const flatTop = opts.height;
  const rows = rowsUpTo(seq, flatTop);
  const tones = rows.map(() => 0.9 + rng() * 0.16);
  rows.forEach(([y0, y1, k], ri) => {
    const jitter = (rng() - 0.5) * 0.01;
    const cuts = openings.filter((o) => k >= o.r0 && k < o.r1).sort((p, q) => p.a0 - q.a0);
    let at = a0;
    for (const o of [...cuts, { a0: a1, a1: a1, r0: 0, r1: 0 }]) {
      // 塌角:墙端缩进 0–6 cm,门窗边 0–2.5 cm。
      const s0 = at + (at === a0 ? rng() * rng() * 0.06 : rng() * 0.025);
      const s1 = o.a0 - (o.a0 === a1 ? rng() * rng() * 0.06 : rng() * 0.025);
      if (s1 - s0 > 0.05) {
        const g = liftSlab(s0, s1, y0, y1, wt, jitter);
        const p = g.attributes.position, mid = (y0 + y1) / 2;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          const lower = y < mid, line = lower ? k : k + 1;
          // 贴地那条线与最上一版的顶(压额枋 / 接山尖)不摆,其余层线起伏。
          const dy = line === 0 || (ri === rows.length - 1 && !lower) ? 0 : wob(line, x);
          const outer = z > jitter - wt / 2;
          const dz = outer ? 0.007 * bump.noise2D(x * 1.7, y * 2.3) + 0.004 * bump.noise2D(x * 6.1, y * 5.3) : 0;
          p.setXYZ(i, x, y + dy, z + dz);
        }
        g.computeVertexNormals();
        g.userData.tone = tones[ri];
        out.push(g);
      }
      at = Math.max(at, o.a1);
    }
  });
  // 山尖:平顶以上逐版切五边形(版高续用 seq)。
  if (opts.topAt && opts.ridgeA !== undefined) {
    const ridgeY = opts.topAt(opts.ridgeA), half = (a1 - a0) / 2, mid = (a0 + a1) / 2;
    const aAt = (y: number) => (y <= flatTop ? half : Math.max(0, half * (ridgeY - y) / (ridgeY - flatTop)));
    let y0 = flatTop, k = seq.findIndex((v) => v > flatTop + 0.1);
    while (y0 < ridgeY - 0.02) {
      const y1 = Math.min(ridgeY, k >= 0 && k < seq.length ? Math.max(seq[k], y0 + 0.2) : y0 + 0.32);
      const poly: [number, number][] = [[mid - aAt(y0), y0], [mid + aAt(y0), y0]];
      if (y1 >= ridgeY - 1e-6) poly.push([mid, ridgeY]);
      else poly.push([mid + aAt(y1), y1], [mid - aAt(y1), y1]);
      const g = gableSlab(poly, wt, (rng() - 0.5) * 0.01);
      g.userData.tone = 0.9 + rng() * 0.16;
      out.push(g);
      y0 = y1; k++;
    }
  }
  // 泥抹痕:盖掉一些层线(断续),避开门窗洞;穿棍孔:层线上隔段一个,有的有、有的没有。
  const top = opts.topAt ?? (() => flatTop);
  const inHole = (x: number, y: number, r: number) => openings.some((o) => x > o.a0 - r && x < o.a1 + r && y > seq[o.r0] - r && y < seq[o.r1] + r);
  const area = (a1 - a0) * flatTop;
  for (let i = 0, n = Math.round(area * 1.6); i < n; i++) {
    const x = lerp(a0 + 0.2, a1 - 0.2, rng());
    const line = rows[(rng() * rows.length) | 0];
    const y = line[0] + (rng() - 0.3) * 0.2;
    const rx = 0.15 + rng() * 0.4, ry = 0.07 + rng() * 0.14;
    if (y < 0.08 || y + ry > top(x) - 0.05 || inHole(x, y, Math.max(rx, ry))) continue;
    const g = mudPatch(x, y + wob(line[2], x), rx, ry, opts.seed * 31 + i, 0.8 + rng() * 0.38);
    g.translate(0, 0, 0.012);
    out.push(g);
  }
  rows.forEach(([y0, , k]) => {
    if (k === 0) return;
    for (let x = a0 + 0.3 + rng() * 0.4; x < a1 - 0.2; x += 0.55 + rng() * 0.5) {
      if (rng() < 0.45 || inHole(x, y0, 0.08)) continue;
      const g = tieHole(x, y0 + wob(k, x), opts.seed * 7 + k * 101 + ((x * 100) | 0));
      g.translate(0, 0, 0.011);
      out.push(g);
    }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* 门窗                                                                 */
/* ------------------------------------------------------------------ */

function doorLeaves(w: number, h: number, seed: number): THREE.BufferGeometry[] {
  const rng = makeRng(seed), out: THREE.BufferGeometry[] = [];
  const planks = 8, pw = (w - 0.02) / planks;
  for (let i = 0; i < planks; i++) {
    const g = roundedBox(pw - 0.008, h - 0.02 - rng() * 0.015, 0.045, 0.008, 1);
    g.translate(-w / 2 + 0.01 + pw * (i + 0.5), h / 2, (rng() - 0.5) * 0.006);
    out.push(g);
  }
  // 门钉般的两道横带(外面看得见的穿带)。
  for (const y of [h * 0.22, h * 0.78]) {
    const g = roundedBox(w - 0.06, 0.07, 0.03, 0.01, 1);
    g.translate(0, y, 0.035);
    out.push(g);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 装配                                                                 */
/* ------------------------------------------------------------------ */

export function buildThatchCottage(o: ThatchCottageOptions): PartBuild {
  const frame = deriveRusticBuilding(o.spec), m = frame.m, d: RusticDetail = deriveRusticDetail(frame);
  if (o.spec.window !== 'paper') throw new Error('竹牖(芦雪庵)尚无近景几何，不得替换成纸窗');
  if (!(o.platformH > 0)) throw new Error('茅屋须显式给台基高');
  const seed = o.seed ?? 1717;
  const fl = o.platformH, slope = o.spec.roofSlope, t = o.spec.thatchThicknessM;
  const W = m.width, dh = m.depthHalf, zTip = dh + m.yanchu, X = W / 2 + d.gableOverhangM;
  const top = (z: number) => fl + m.ridgeY - Math.abs(z) * slope;
  const under = (z: number) => top(z) - t;
  const rd = d.rafterDM, pd = d.purlinDM;
  const beamTop = under(dh) - rd, beamBot = beamTop - m.lan.w;
  const wt = d.wallThicknessM, ow = d.wallOutsetM;

  const thatch = thatchMaterial(), stubble = thatchEndMaterial(), reed = thatchUnderMaterial();
  const earth = earthWallMaterial(), wood = roughWoodMaterial(), stone = stoneMaterial(1), paper = paperMaterial();
  const group = new THREE.Group();
  const add = (g: THREE.BufferGeometry, mat: THREE.Material) => group.add(shadowed(new THREE.Mesh(g, mat)));

  /* --- 茅苫 --- */
  const lumpN = new Simplex(seed + 3);
  // 苫面起伏:大块鼓瘪(±2 cm)+ 顺坡拉长的草把沟(沿檐 0.2–0.4 m 一起伏、顺坡拉长 5 倍,随机不成垄)。
  const lump = (x: number, s: number) => 0.02 * fbm2(lumpN, x * 0.8 + 11, s * 1.0, 3) + 0.011 * fbm2(lumpN, x * 3.4, s * 0.65 + 5, 2);
  const roofG: RoofGeom = { W, X, zTip, top, t, r: d.vergeRollM, below: 0.02, undercut: d.eaveUndercutM };
  for (const sign of [1, -1] as const) {
    const s = thatchSlope(roofG, sign, lump, seed + (sign > 0 ? 0 : 50));
    add(s.skin, thatch); add(s.face, stubble); add(s.under, reed);
  }
  // 檐口乱茬:切面下沿挂一溜稻茎 alpha 卡(2–11 cm 参差),「一刀齐」之下仍是草不是板。
  {
    const fr = strawFringeMaterial(), frng = makeRng(seed + 13);
    const x0 = -X + d.vergeRollM * 0.6, x1 = X - d.vergeRollM * 0.6, n = Math.ceil((x1 - x0) / 0.45);
    for (const sign of [1, -1]) for (let i = 0; i < n; i++) {
      const w = (x1 - x0) / n + 0.08, x = x0 + ((x1 - x0) * (i + 0.5)) / n;
      const g = new THREE.PlaneGeometry(w, 0.13);
      const uvs = g.attributes.uv;
      const u0 = frng();
      for (let k = 0; k < uvs.count; k++) uvs.setX(k, u0 + uvs.getX(k) * w * 2);
      g.translate(0, -0.13 / 2, 0);
      g.rotateX(sign * 0.22);
      if (sign < 0) g.rotateY(Math.PI);
      g.translate(x, under(zTip) + 0.035 + (frng() - 0.5) * 0.01, sign * (zTip - d.eaveUndercutM - 0.015));
      add(g, fr);
    }
  }
  const ridge = ridgeRoll(X, top(0) + 0.035, d.ridgeRollHalfWidthM, d.ridgeRollHalfHeightM, d.ridgeTiePitchM, seed + 5);
  add(ridge.body, thatch);
  for (const c of ridge.caps) add(c, stubble);
  for (const r of ridge.ropes) add(r, reed);

  /* --- 椽:外露段(檐下自墙外皮起;两山出际下全长)--- */
  const rng = makeRng(seed + 11);
  const xr0 = -X + d.vergeRollM + 0.08, count = Math.max(2, Math.round((2 * -xr0) / d.rafterPitchM));
  const tipS = zTip - d.rafterTipSetbackM - d.eaveUndercutM;
  for (let i = 0; i <= count; i++) {
    const x = xr0 + (-2 * xr0 * i) / count + (rng() - 0.5) * 0.04;
    const r = (rd / 2) * (0.9 + rng() * 0.2);
    const inGable = Math.abs(x) > W / 2 - 0.05;
    for (const sign of [1, -1]) {
      const s0 = inGable ? 0.12 : dh - 0.05, s1 = tipS - rng() * 0.02;
      const y = (s: number) => under(s) - r;
      add(log([x, y(s0), sign * s0], [x, y(s1), sign * s1], r, r * 0.94, seed + i * 7 + (sign > 0 ? 0 : 3), 7, 0.006), wood);
    }
  }
  /* --- 檩:脊檩、前后金檩(两山悬出到草卷下)--- */
  for (const z of [0, dh / 2, -dh / 2]) {
    const y = under(z) - rd - pd / 2;
    add(log([-X + 0.18, y, z], [X - 0.18, y, z], pd / 2, pd / 2 * 0.95, seed + 31 + Math.round(z * 10), 10, 0.01), wood);
  }
  /* --- 额枋兼檐檩(前后),两端出头到出际下 --- */
  for (const z of [dh, -dh]) {
    const g = roundedBox(2 * (X - 0.2), m.lan.w, m.lan.t, 0.035, 3);
    noiseDisplace(g, 0.006, 4, seed + (z > 0 ? 41 : 43), 2);
    g.translate(0, (beamTop + beamBot) / 2, z);
    add(g, wood);
  }
  /* --- 柱与柱础 --- */
  const colTop = beamTop - 0.03;
  const baseH = 0.1;
  const columnAt = (x: number, z: number, h1: number, r: number, k: number) => {
    const b = roundedBox(m.base, baseH, m.base, 0.03, 2);
    noiseDisplace(b, 0.01, 6, seed + k, 2);
    b.translate(x, fl + baseH / 2 - 0.01, z);
    add(b, stone);
    add(log([x, fl + baseH - 0.01, z], [x, h1, z], r, r * 0.9, seed + 100 + k, 10, 0.018), wood);
  };
  let k = 0;
  for (const x of m.columnX) for (const z of [dh, -dh]) columnAt(x, z, colTop, m.columnD / 2, k++);
  /* --- 山面穿斗:穿枋、中柱落地通脊、瓜柱 --- */
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2);
    const tie = roundedBox(m.lan.t, m.lan.w, 2 * dh + 0.3, 0.03, 3);
    noiseDisplace(tie, 0.006, 4, seed + 51 + sx, 2);
    tie.translate(x, (beamTop + beamBot) / 2, 0);
    add(tie, wood);
    columnAt(x, 0, under(0) - rd - pd + 0.02, m.columnD / 2, k++);
    for (const z of [dh / 2, -dh / 2]) add(log([x, beamTop - 0.02, z], [x, under(z) - rd - pd + 0.02, z], 0.07, 0.065, seed + 60 + k++, 9, 0.006), wood);
  }

  /* --- 土壁 --- */
  // 全栋一套版线(四面同高),版高不等(D-36 ②)。门窗洞上下口仍对齐版线。
  const seq = liftSequence(seed + 191, fl + m.ridgeY + 1);
  const bays = m.columnX.slice(1).map((x1, i) => ({ c: (x1 + m.columnX[i]) / 2 }));
  const doorBay = Math.floor(bays.length / 2);
  const front: Opening[] = bays.map((b, i) => i === doorBay
    ? { a0: b.c - d.doorWidthM / 2, a1: b.c + d.doorWidthM / 2, r0: 0, r1: d.doorLifts }
    : { a0: b.c - d.windowWidthM / 2, a1: b.c + d.windowWidthM / 2, r0: d.windowSillLifts, r1: d.windowSillLifts + d.windowLifts });
  const doorH = seq[d.doorLifts], winY0 = seq[d.windowSillLifts], winH = seq[d.windowSillLifts + d.windowLifts] - winY0;
  const flatH = beamBot - fl;
  if (doorH > flatH - 0.13 || winY0 + winH > flatH - 0.13) throw new Error('乡野门窗洞按版线取高后顶到额枋');
  const dampN = new Simplex(seed + 77);
  const damp = new THREE.Color(XY.earthDamp), base = new THREE.Color(XY.earth);
  const dampTint = [damp.r / base.r, damp.g / base.g, damp.b / base.b];
  const wallColor = (a: number, y: number, tone: number): [number, number, number] => {
    const fade = Math.max(0.15, 0.55 + 0.18 * fbm2(dampN, a * 0.7, 2.3, 3));
    const kd = Math.pow(1 - clamp(y / fade, 0, 1), 0.7);
    // 大块泥色斑驳(雨淋、补泥):0.5–2 m 尺度,±12%;再乘一版一色的 tone。
    const patch = (1 + 0.12 * fbm2(dampN, a * 0.55 + 9, y * 0.9, 4)) * tone;
    return [lerp(1, dampTint[0], kd) * patch, lerp(1, dampTint[1], kd) * patch, lerp(1, dampTint[2], kd) * patch];
  };
  const placeWall = (geos: THREE.BufferGeometry[], rotY: number, tx: number, tz: number) => {
    for (const g of geos) {
      g.deleteAttribute('uv');
      g.setAttribute('uv', boxProjectedUV(g, 1 / EARTH_TILE_M));
      const own = g.getAttribute('color');
      const tone = (g.userData.tone as number | undefined) ?? 1;
      const pre = own ? Array.from(own.array as Float32Array) : null;
      addColor(g, (a, y) => wallColor(a + tx * 3 + tz * 5, y, tone));
      if (pre) { const c = g.getAttribute('color'); for (let i = 0; i < c.count * 3; i++) (c.array as Float32Array)[i] *= pre[i]; }
      g.rotateY(rotY);
      g.translate(tx, fl, tz);
      add(g, earth);
    }
  };
  const aF = W / 2 + ow;
  placeWall(earthWall({ a0: -aF, a1: aF, height: flatH, wt, seq, openings: front, seed: seed + 201 }), 0, 0, dh + ow);
  placeWall(earthWall({ a0: -aF, a1: aF, height: flatH, wt, seq, openings: [], seed: seed + 202 }), Math.PI, 0, -(dh + ow));
  const aS = dh + ow - wt;
  const gableTop = (a: number) => under(a) - rd - fl;
  for (const sx of [-1, 1]) {
    placeWall(earthWall({ a0: -aS, a1: aS, height: gableTop(aS), topAt: gableTop, ridgeA: 0, wt, seq, openings: [], seed: seed + 210 + sx }),
      sx * Math.PI / 2, sx * (W / 2 + ow), 0);
  }
  // 额枋上、椽空当:封檐泥(不让檐下露出屋里的黑洞)。
  for (const z of [dh, -dh]) {
    const g = roundedBox(W + 2 * ow - 0.04, under(dh) - beamTop + 0.02, wt * 0.6, 0.02, 2);
    g.deleteAttribute('uv'); g.setAttribute('uv', boxProjectedUV(g, 1 / EARTH_TILE_M));
    addColor(g, () => [0.9, 0.9, 0.9]);
    g.translate(0, (under(dh) + beamTop) / 2, z - Math.sign(z) * (wt * 0.3 + 0.03));
    add(g, earth);
  }
  /* --- 台基(夯土台)--- */
  {
    const mg = d.platformMarginM;
    const g = roundedBox(W + 2 * (ow + mg), fl, 2 * (dh + ow + mg), 0.05, 5);
    noiseDisplace(g, 0.008, 3, seed + 301, 2);
    g.deleteAttribute('uv'); g.setAttribute('uv', boxProjectedUV(g, 1 / 2.5));
    g.translate(0, fl / 2, 0);
    add(g, tampedEarthMaterial());
  }
  /* --- 门:门框、门槛、过木、板门(关) --- */
  {
    const b = bays[doorBay], w = d.doorWidthM, h = doorH, zf = dh + ow;
    const lintel = roundedBox(w + 0.36, 0.13, wt * 0.8, 0.02, 2);
    lintel.translate(b.c, fl + h + 0.065, zf - wt * 0.4 + 0.02);
    add(lintel, wood);
    for (const sx of [-1, 1]) {
      const post = roundedBox(0.1, h, 0.14, 0.015, 2);
      post.translate(b.c + sx * (w / 2 - 0.05), fl + h / 2, zf - 0.1);
      add(post, wood);
    }
    const sill = roundedBox(w + 0.04, 0.12, 0.14, 0.02, 2);
    sill.translate(b.c, fl + 0.06, zf - 0.12);
    add(sill, wood);
    for (const [sx, gap] of [[-1, 0], [1, 0]] as const) {
      for (const g of doorLeaves((w - 0.2) / 2, h - 0.14, seed + 400 + sx)) {
        g.translate(b.c + sx * (w - 0.2) / 4 + gap, fl + 0.12, zf - 0.16);
        add(g, wood);
      }
    }
  }
  /* --- 纸窗:窗框、直棂、窗纸(emissive,`P-05`)、窗台、过木 --- */
  bays.forEach((b, i) => {
    if (i === doorBay) return;
    const w = d.windowWidthM, y0 = fl + winY0, h = winH, zf = dh + ow;
    const fr = 0.06;
    for (const [cx, cy, sw, sh] of [[b.c - w / 2 + fr / 2, y0 + h / 2, fr, h], [b.c + w / 2 - fr / 2, y0 + h / 2, fr, h],
      [b.c, y0 + fr / 2, w, fr], [b.c, y0 + h - fr / 2, w, fr]] as const) {
      const g = roundedBox(sw, sh, 0.09, 0.012, 2);
      g.translate(cx, cy, zf - 0.07);
      add(g, wood);
    }
    const inner = w - 2 * fr, bars = Math.max(3, Math.round(inner / d.mullionPitchM) - 1);
    for (let j = 1; j <= bars; j++) {
      const g = roundedBox(d.mullionM, h - 2 * fr + 0.02, 0.04, 0.008, 1);
      g.translate(b.c - inner / 2 + (inner * j) / (bars + 1), y0 + h / 2, zf - 0.075);
      add(g, wood);
    }
    const pane = new THREE.PlaneGeometry(inner, h - 2 * fr);
    pane.translate(b.c, y0 + h / 2, zf - 0.1);
    add(pane, paper);
    const sillB = roundedBox(w + 0.16, 0.06, 0.12, 0.015, 2);
    sillB.translate(b.c, y0 - 0.03, zf - 0.03);
    add(sillB, wood);
    const lintel = roundedBox(w + 0.3, 0.1, wt * 0.8, 0.02, 2);
    lintel.translate(b.c, y0 + h + 0.05, zf - wt * 0.4 + 0.02);
    add(lintel, wood);
  });

  /* --- 匾:素木板墨字,挂明间檐下(D-36 ④)。字从 plan 读,读不到就不挂 --- */
  const plaqueText = o.id ? plaqueFromPlan(o.id) : undefined;
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
  root.userData.construction = { paramSet: 'rustic', tier: 'C-r', roofType: frame.roofType,
    provenance: { evidence: frame.provenance.evidence, inference: [], art: [...frame.provenance.art, ...d.provenance.art] } };
  if (o.id) root.userData.planObject = { id: o.id };
  return { kind: 'building', root, groundRadius: Math.max(W, 2 * dh) * 1.1 };
}

/** 棚拍/落位:variant = plan 里的茅屋 id;default = 茆堂。 */
export function buildPlannedCottage(variant: string): PartBuild {
  const id = variant === 'default' ? 'daoxiangcun.main-cottage' : variant;
  const item = planItem(id);
  const c = item.construction;
  if (item.kind !== 'building' || !c) throw new Error(`[xiangye] ${id} 不是带施工规格的房屋`);
  const spec = c.spec as RusticSpec;
  if (spec.paramSet !== 'rustic') throw new Error(`[xiangye] ${id} 不是乡野子档，茅屋构件不接`);
  return buildThatchCottage({ spec, platformH: c.options.platformH!, id });
}
