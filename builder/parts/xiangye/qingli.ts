import * as THREE from 'three';
import type { PartBuild } from '../registry';
import { mergeByMaterial } from '../merge';
import { Simplex, makeRng, lerp, clamp } from '@engine/core/Noise';
import { XY, shootMaterial, hedgeLeafMaterial } from './materials';
import { stations, polylineLength, type P2, type Station } from './path';
import { planLayout } from './plan-data';

/**
 * 两溜青篱(单子 BA3)。07-11「外面卻是桑,榆,槿,柘,各色樹稚新條,隨其曲折,編就兩溜青篱」。
 *
 * 读法:**活的新条编的篱**——不是竹篱笆(竹竿等粗、有节、青黄),也不是木栅栏(削平的板条、等距)。
 *   桩   = 插下去生了根的粗条(桑榆槿柘),粗细不一、微斜微弯、高低参差,顶上抽出嫩梢;
 *   编条 = 细长的新条,在桩间一里一外地编(篱编),每根只编一两米就收头、起下一根,几道高低不齐;
 *   叶   = 桩顶、梢头、编条上冒出的叶枝(四种叶形的图集),嫩的黄绿、老的深绿——整道篱是绿的。
 * 全部沿折线走,转角处桩与编条跟着转(「隨其曲折」)。
 * 截面只取 plan 的 heightM(1.2 m)与 widthM;桩距、编条道数、叶量是艺术取值,进 provenance.art。
 *
 * variant:
 *   default                6 m 直段(截面取 plan `daoxiangcun.fence` 第一条 run)
 *   bend                   同截面,一段带两个转角的折线,看「隨其曲折」
 *   <plan 对象 id>          按 plan 的 `layout.runs[]` 两溜全出(原点移到包围盒中心)
 */
const HEDGE = {
  stakePitch: [0.42, 0.62] as [number, number],
  stakeTop: [0.78, 0.96] as [number, number], // × heightM
  weaveBands: Array.from({ length: 12 }, (_, i) => 0.1 + i * 0.055), // × heightM:0.10–0.71,一道一根,密编
  weaveAmp: 0.035,
  rodLen: [1.2, 2.6] as [number, number],
  leafPerM: 30,
};
const PROVENANCE = [
  { id: 'project:qingli-weave', name: '青篱编法', method: 'artistic_choice', note: '07-11「編就」:活桩插地、细条一里一外篱编;桩距 0.42–0.62 m、编条十二道(篱高的 0.10–0.71,间 0.055)、每根 1.2–2.6 m 收头——书无定数。' },
  { id: 'project:qingli-species', name: '桑榆槿柘叶图集', method: 'artistic_choice', note: '07-11 列四种:叶图集四格(桑阔卵心基、榆小椭圆、槿菱状卵浅裂、柘卵形全缘),同一道篱混用。' },
  { id: 'project:qingli-height', name: '篱高参差', method: 'artistic_choice', note: '桩顶取篱高的 0.78–0.96,嫩梢与叶枝把轮廓顶到 plan heightM 上下 ±0.12 m,「高低参差」。' },
];

type Tint = [number, number, number];
/** 条色:一年生新条橄榄绿到赭红;老桩灰褐——不能是竹的青黄。 */
function tintOf(rng: () => number, old = false): Tint {
  const c = new THREE.Color().setRGB(...(old ? lerpRgb(0x6f6150, XY.shootRed, rng() * 0.5) : lerpRgb(XY.shootGreen, XY.shootRed, 0.25 + rng() * 0.75)));
  const k = 0.85 + rng() * 0.3;
  return [c.r * k, c.g * k, c.b * k];
}
function lerpRgb(a: number, b: number, t: number): Tint {
  const A = new THREE.Color(a), B = new THREE.Color(b);
  return [lerp(A.r, B.r, t), lerp(A.g, B.g, t), lerp(A.b, B.b, t)];
}
/** 圆管沿曲线,带顶点色;shoot 材质的色全在顶点色里(贴图是白底细纹)。 */
function rod(pts: THREE.Vector3[], r0: number, r1: number, tint: Tint, radial = 5, perSeg = 3): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const segs = Math.max(2, (pts.length - 1) * perSeg);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  // 按管长收细:TubeGeometry 半径恒定,这里按 uv.x(沿管 0..1)重设半径。
  const p = g.attributes.position, uv = g.attributes.uv;
  const center = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const t = uv.getX(i);
    curve.getPointAt(Math.min(1, t), center);
    const r = lerp(r0, r1, t);
    p.setXYZ(i, center.x + (p.getX(i) - center.x) * r, center.y + (p.getY(i) - center.y) * r, center.z + (p.getZ(i) - center.z) * r);
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) col.set(tint, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 叶枝卡:十字两片,取图集一格;附着点在卡底中部,卡面朝 yaw。 */
function leafCard(at: THREE.Vector3, size: number, yaw: number, tilt: number, cell: number, shade: Tint, out: { pos: number[]; uv: number[]; col: number[]; idx: number[] }): void {
  const u0 = (cell % 2) * 0.5, v0 = cell < 2 ? 0.5 : 0; // 图集:上行(canvas 上半)对应 v 0.5..1
  for (const extra of [0, Math.PI / 2]) {
    const a = yaw + extra, dx = Math.cos(a) * size / 2, dz = Math.sin(a) * size / 2;
    const up = new THREE.Vector3(Math.sin(tilt) * Math.cos(a + Math.PI / 2), Math.cos(tilt), Math.sin(tilt) * Math.sin(a + Math.PI / 2)).multiplyScalar(size);
    const base = out.pos.length / 3;
    const b0 = [at.x - dx, at.y, at.z - dz], b1 = [at.x + dx, at.y, at.z + dz];
    out.pos.push(...b0, ...b1, b1[0] + up.x, b1[1] + up.y, b1[2] + up.z, b0[0] + up.x, b0[1] + up.y, b0[2] + up.z);
    out.uv.push(u0, v0, u0 + 0.5, v0, u0 + 0.5, v0 + 0.5, u0, v0 + 0.5);
    for (let k = 0; k < 4; k++) out.col.push(...shade);
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function hedgeRun(pts: P2[], heightM: number, seed: number): THREE.Group {
  const rng = makeRng(seed), noise = new Simplex(seed);
  const L = polylineLength(pts);
  const st = stations(pts, 0.1);
  const at = (s: number): Station => {
    // 线性插值到弧长 s 的站。
    let k = 1;
    while (k < st.length - 1 && st[k].s < s) k++;
    const a = st[k - 1], b = st[k], f = clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
    const n: P2 = [lerp(a.n[0], b.n[0], f), lerp(a.n[1], b.n[1], f)];
    return { p: [lerp(a.p[0], b.p[0], f), lerp(a.p[1], b.p[1], f)], t: b.t, n, s };
  };
  const world = (s: number, off: number, y: number) => { const S = at(s); return new THREE.Vector3(S.p[0] + S.n[0] * off, y, S.p[1] + S.n[1] * off); };
  const rods: THREE.BufferGeometry[] = [];
  const leaves = { pos: [] as number[], uv: [] as number[], col: [] as number[], idx: [] as number[] };
  const leafShade = (): Tint => { const k = 0.72 + rng() * 0.3; return [k * (0.95 + rng() * 0.1), k, k * (0.9 + rng() * 0.15)]; };

  // 桩:沿线,距离随机;折点处必有一根。
  const stakes: number[] = [0];
  for (let s = 0; s < L; ) { s += lerp(HEDGE.stakePitch[0], HEDGE.stakePitch[1], rng()); if (s < L - 0.2) stakes.push(s); }
  stakes.push(L);
  let acc = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (!stakes.some((s) => Math.abs(s - acc) < 0.15)) stakes.push(acc);
  }
  stakes.sort((a, b) => a - b);
  stakes.forEach((s, i) => {
    const top = heightM * lerp(HEDGE.stakeTop[0], HEDGE.stakeTop[1], rng());
    const r = 0.014 + rng() * 0.014, off = (rng() - 0.5) * 0.04, lean = (rng() - 0.5) * 0.12, S = at(s);
    const tint = tintOf(rng, true);
    const p0 = world(s, off, -0.05), p1 = world(s + lean * 0.3, off + lean * 0.5, top * 0.55), p2 = world(s + lean * 0.6, off + lean, top);
    rods.push(rod([p0, p1, p2], r, r * 0.6, tint, 6, 2));
    // 桩顶嫩梢 1–3 根,斜出,高过桩顶 0.1–0.35 m。
    const n = 1 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2, h = 0.1 + rng() * 0.25, reach = 0.06 + rng() * 0.12;
      const q0 = p2.clone(), q2 = p2.clone().add(new THREE.Vector3(Math.cos(a) * reach, h, Math.sin(a) * reach));
      const q1 = q0.clone().lerp(q2, 0.5).add(new THREE.Vector3(0, 0.03, 0));
      rods.push(rod([q0, q1, q2], r * 0.45, 0.003, tintOf(rng), 4, 2));
      leafCard(q2.clone().add(new THREE.Vector3(0, -0.05, 0)), 0.22 + rng() * 0.14, a + (rng() - 0.5), (rng() - 0.5) * 0.6, (rng() * 4) | 0, leafShade(), leaves);
    }
    // 桩身冒出的叶枝(生了根的条子会在半腰发叶)。
    if (rng() < 0.55) leafCard(world(s, off + (rng() - 0.5) * 0.1, top * (0.35 + rng() * 0.4)), 0.2 + rng() * 0.12, rng() * Math.PI * 2, (rng() - 0.5) * 1.2, (rng() * 4) | 0, leafShade(), leaves);
    void S; void i;
  });

  // 编条:每道若干根,各编 1.2–2.6 m,一里一外绕桩。
  HEDGE.weaveBands.forEach((band, b) => {
    for (let pass = 0; pass < 1; pass++) {
      let s = -rng() * 1.2;
      while (s < L) {
        const len = lerp(HEDGE.rodLen[0], HEDGE.rodLen[1], rng());
        const a = Math.max(0, s), e = Math.min(L, s + len);
        if (e - a > 0.4) {
          const y0 = heightM * band + (rng() - 0.5) * 0.06 + pass * 0.035;
          const within = stakes.filter((x) => x > a && x < e);
          const ctrl = [a, ...within, e];
          const phase = (b + pass) % 2;
          const P = ctrl.map((x, k) => world(x, (k + phase) % 2 ? HEDGE.weaveAmp : -HEDGE.weaveAmp, y0 + 0.015 * noise.noise2D(x * 2, b * 3 + pass)));
          if (P.length >= 2) rods.push(rod(P, 0.009 + rng() * 0.004, 0.005, tintOf(rng), 4, 3));
          // 编条上偶尔抽叶。
          for (let x = a + 0.3; x < e - 0.2; x += 0.5 + rng() * 0.6)
            if (rng() < 0.3) leafCard(world(x, (rng() - 0.5) * 0.12, y0 + 0.02), 0.16 + rng() * 0.12, rng() * Math.PI * 2, (rng() - 0.5) * 1.4, (rng() * 4) | 0, leafShade(), leaves);
        }
        s += len * (0.6 + rng() * 0.3);
      }
    }
  });
  // 篱顶一层叶枝:沿线加密,顶线高低参差。
  const topCount = Math.round(L * HEDGE.leafPerM * 0.5);
  for (let k = 0; k < topCount; k++) {
    const x = rng() * L, y = heightM * (0.58 + rng() * 0.3) + 0.08 * noise.noise2D(x * 0.9, 7);
    leafCard(world(x, (rng() - 0.5) * 0.2, y), 0.24 + rng() * 0.16, rng() * Math.PI * 2, (rng() - 0.5) * 0.9, (rng() * 4) | 0, leafShade(), leaves);
  }

  const group = new THREE.Group();
  const shoot = shootMaterial();
  for (const g of rods) { const m = new THREE.Mesh(g, shoot); m.castShadow = m.receiveShadow = true; group.add(m); }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(leaves.pos, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(leaves.uv, 2));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(leaves.col, 3));
  lg.setIndex(leaves.idx);
  lg.computeVertexNormals();
  // 叶卡法线统一朝上偏,双面卡不会一面亮一面黑。
  const nrm = lg.attributes.normal;
  for (let i = 0; i < nrm.count; i++) { const v = new THREE.Vector3(nrm.getX(i), Math.abs(nrm.getY(i)) + 0.8, nrm.getZ(i)).normalize(); nrm.setXYZ(i, v.x, v.y, v.z); }
  const lm = new THREE.Mesh(lg, hedgeLeafMaterial()); lm.castShadow = true; lm.receiveShadow = true; group.add(lm);
  return group;
}

export function buildQingli(variant: string): PartBuild {
  const planId = variant === 'default' || variant === 'bend' ? 'daoxiangcun.fence' : variant;
  const layout = planLayout(planId, 'fence');
  const root = new THREE.Group();
  let runs: { pts: P2[]; h: number }[];
  let origin: P2 = [0, 0];
  if (variant === 'default') runs = [{ pts: [[-3, 0], [3, 0]], h: layout.runs[0].heightM }];
  else if (variant === 'bend') runs = [{ pts: [[-3.2, 0.6], [-1.2, -0.4], [1.0, 0.5], [3.2, -0.3]], h: layout.runs[0].heightM }];
  else {
    const all = layout.runs.flatMap((r) => r.points);
    const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]);
    origin = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    runs = layout.runs.map((r) => ({ pts: r.points.map(([x, z]) => [x - origin[0], z - origin[1]] as P2), h: r.heightM }));
  }
  runs.forEach((r, i) => root.add(hedgeRun(r.pts, r.h, 9101 + i * 37)));
  const merged = mergeByMaterial(root);
  merged.name = variant === 'default' || variant === 'bend' ? `qingli:${variant}` : planId;
  merged.userData.construction = { paramSet: 'rustic', tier: 'C-r', provenance: { evidence: [], inference: [], art: PROVENANCE } };
  if (variant !== 'default' && variant !== 'bend') merged.userData.linear = { id: planId, kind: 'fence', origin, runs: runs.length, basis: layout.basis };
  return { root: merged };
}
