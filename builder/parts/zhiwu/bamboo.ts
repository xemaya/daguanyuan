import { worldOffsetToLocal } from '@engine/render/nodes/position';
import { positionLocal, attribute, uniform, vec2, vec3, sin, uv, texture, frontFacing, mix, float } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { bambooMaterial, CN } from '@builder/parts/materials';
import { makeRng, rangeOf, tileableFbm, worley, clamp, smoothstep, lerp } from '@engine/core/Noise';
import { bakeColorMap, bakeScalarMap, bakeNormalMap, cached, mixHex, hexToRgb, NOISE } from '@engine/core/TextureLab';

/**
 * 竹丛 — 潇湘馆的主角植物。零资产,全程序化。
 *
 * 结构:
 *   竿  = 一段"节间"几何(带节环)全丛实例化;每竿由 9–15 段沿一条微弯曲线拼成,
 *         竿径逐段收细,顶部两段急收,不留空心洞。
 *   枝  = 一段预弯的细锥管,只在竿的顶部 1/3 出,一节 1–2 根、左右交替。
 *   叶  = 4 三角的披针形叶卡(alpha 卡裁形),3–5 片一簇挂在枝上,全丛一个 InstancedMesh。
 *   裙脚= 落叶土丘,竿脚埋进去(艺术圣经 §2.5 不穿地)。
 *
 * 风:两种节点材质共享一个 uTime;竿/枝/叶用同一条"随高度平方
 * 增大"的摆动公式,所以叶不会从枝上滑走;叶再叠一层自己的高频小抖。
 *
 * draw calls:竿 + 枝 + 叶 + 土丘 = 4(grove 把五丛塞进同四个 mesh,仍是 4)。
 */

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

const NOMINAL_H = 5.2; // 风摆归一化用的名义高度(米)
const WIND_DIR = new THREE.Vector2(0.78, 0.62).normalize();

interface ClumpSpec {
  cx: number;
  cz: number;
  /** 竿数。 */
  culms: number;
  /** 丛半径(竿脚散布半径,米)。 */
  spread: number;
  /** 高度范围。 */
  hMin: number;
  hMax: number;
  /**
   * 竿脚的高度。缺省 0——`build()` 建的那三个变体由 composer 整件落位,
   * 构件自己贴地;`buildBambooRow` 把一整列丛塞进同一组 mesh(见文件末),
   * 整件只能落在一个 y 上,所以每丛自己的地面高要烤进矩阵里。
   */
  cy?: number;
  /**
   * 竹稍倾向的方位角(`atan2(dz, dx)`)。给了才有「夹」的样子:
   * `07-41`「兩邊翠竹**夾路**」——夹是竹稍压向路心,不是竹脚挤到路上,
   * 所以这一项动的是竿的方位与上部弯度,不动 `cx`/`cz`。
   * 不给就完全不改行为(连一发 rng 都不多吃,三个老变体逐位不变)。
   */
  leanAz?: number;
}

/* ------------------------------------------------------------------ */
/* 几何:节间段 / 枝 / 叶卡 / 土丘                                       */
/* ------------------------------------------------------------------ */

/**
 * 单位节间段:y 0→1,半径 1。两端各半个节环(r 1.15),相邻两段在节环最粗处
 * 相接,不重叠不共面。uv.v 走 0→0.25 正好落 bambooMaterial 贴图的一个节周期,
 * 亮环压在几何节环上。
 */
function culmSegmentGeometry(): THREE.BufferGeometry {
  const RADIAL = 8;
  const rows: [number, number][] = [
    [0.0, 1.15],
    [0.045, 1.0],
    [0.955, 1.0],
    [1.0, 1.15],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    const [y, rad] = rows[r];
    for (let i = 0; i <= RADIAL; i++) {
      const a = (i / RADIAL) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, y, Math.sin(a) * rad);
      uv.push(i / RADIAL, y * 0.25);
    }
  }
  const W = RADIAL + 1;
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < RADIAL; i++) {
      const a = r * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 枝的预弯曲线:局部 y 沿枝,向 +z 翘起。JS 与几何共用同一条,叶才挂得准。 */
const BRANCH_CURL = 0.22;
function branchPoint(t: number, len: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(0, t * len, BRANCH_CURL * t * t * len);
}
function branchTangent(t: number, len: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(0, len, 2 * BRANCH_CURL * t * len).normalize();
}

/** 单位枝:长 1、基半径 1,末端收到 0.45,5 边 2 段。 */
function branchGeometry(): THREE.BufferGeometry {
  const RADIAL = 5;
  const SLICES = 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let s = 0; s <= SLICES; s++) {
    const f = s / SLICES;
    branchPoint(f, 1, p);
    branchTangent(f, 1, t);
    // 法平面基:n ⟂ t 在 yz 平面,b = x 轴。
    n.set(0, -t.z, t.y);
    b.set(1, 0, 0);
    const rad = lerp(1, 0.45, f);
    for (let i = 0; i <= RADIAL; i++) {
      const a = (i / RADIAL) * Math.PI * 2;
      pos.push(
        p.x + (b.x * Math.cos(a) + n.x * Math.sin(a)) * rad,
        p.y + (b.y * Math.cos(a) + n.y * Math.sin(a)) * rad,
        p.z + (b.z * Math.cos(a) + n.z * Math.sin(a)) * rad,
      );
      uv.push(i / RADIAL, f * 0.25 + 0.08);
    }
  }
  const W = RADIAL + 1;
  for (let s = 0; s < SLICES; s++) {
    for (let i = 0; i < RADIAL; i++) {
      const a = s * W + i;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 单位叶卡:基部在原点,y 0→1 为叶长,x ±0.5 为叶宽,叶尖向 -z 微垂。4 三角。 */
function leafGeometry(): THREE.BufferGeometry {
  const rows = [0, 0.5, 1];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    const v = rows[r];
    const z = -0.14 * v * v;
    for (const x of [-0.5, 0.5]) {
      pos.push(x, v, z);
      uv.push(x + 0.5, v);
    }
  }
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 落叶土丘:圆盘 + 圆顶 + 噪声,边缘归零贴地。 */
function moundGeometry(rng: () => number, R: number, H: number, cx: number, cz: number, y0 = 0): THREE.BufferGeometry {
  const RINGS = 6;
  const SEG = 36;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const seed = rng() * 10;
  pos.push(cx, y0 + H, cz);
  uv.push(0.5, 0.5);
  for (let r = 1; r <= RINGS; r++) {
    const f = r / RINGS;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const wob = 1 + 0.12 * Math.sin(a * 3 + seed) + 0.07 * Math.sin(a * 7 + seed * 2.3);
      const rad = f * R * wob;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      const dome = 1 - smoothstep(0.38, 1, f);
      const n = tileableFbm(NOISE.soil, x * 0.35 + seed, z * 0.35, 3, 2) * 0.35;
      const y = f >= 1 ? 0 : Math.max(0, H * dome * (1 + n));
      pos.push(cx + x, y0 + y, cz + z);
      uv.push(0.5 + (x / R) * 0.5, 0.5 + (z / R) * 0.5);
    }
  }
  const ringStart = (r: number) => 1 + (r - 1) * SEG;
  for (let i = 0; i < SEG; i++) {
    idx.push(0, ringStart(1) + ((i + 1) % SEG), ringStart(1) + i);
  }
  for (let r = 1; r < RINGS; r++) {
    for (let i = 0; i < SEG; i++) {
      const a = ringStart(r) + i;
      const b = ringStart(r) + ((i + 1) % SEG);
      const c = ringStart(r + 1) + i;
      const d = ringStart(r + 1) + ((i + 1) % SEG);
      idx.push(a, d, c, a, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* 材质                                                                */
/* ------------------------------------------------------------------ */

const LEAF_BACK = 0x4d7236;

/** 披针形叶:alpha 裁形 + 中脉 + 基深尖浅的渐变。 */
function leafMaterial(uTime: { value: number }): THREE.MeshStandardNodeMaterial {
  const halfWidth = (v: number) => {
    // 披针形:最宽在 30% 处,尖端收成针。
    const w = Math.pow(v, 0.45) * Math.pow(1 - v, 1.05);
    return (w / 0.406) * 0.44;
  };
  const inside = (u: number, v: number) => {
    if (v < 0.015 || v > 0.985) return 0;
    const hw = halfWidth(v);
    return smoothstep(hw + 0.012, hw - 0.012, Math.abs(u - 0.5));
  };
  const map = cached('cn.bamboo.leaf.albedo', () =>
    bakeColorMap({
      size: 128,
      color: (u, v) => {
        const base = mixHex(0x4c7434, 0x668f45, Math.pow(v, 0.8) * 0.6 + 0.2);
        const rib = smoothstep(0.035, 0.0, Math.abs(u - 0.5)) * (1 - v) * 0.3;
        const vein = Math.max(0, Math.sin((u - 0.5) * 40 + v * 6)) * 0.04;
        const n = tileableFbm(NOISE.grass, u * 2, v, 6, 2) * 0.1;
        const lit = hexToRgb(CN.bambooNode);
        const t = clamp(rib + vein + n, -0.15, 0.45);
        return [lerp(base[0], lit[0], t), lerp(base[1], lit[1], t), lerp(base[2], lit[2], t)];
      },
    }),
  );
  const alphaMap = cached('cn.bamboo.leaf.alpha', () => bakeScalarMap(128, inside));
  const mat = new THREE.MeshStandardNodeMaterial({
    map,
    alphaMap,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0,
    // 平叶卡正对 key light 比圆竿亮一大截,整体压一档才和竿同色系。
    color: new THREE.Color(0.82, 0.88, 0.78),
  });
  const back = hexToRgb(LEAF_BACK);
  const front = hexToRgb(CN.bamboo);
  const backMul = [back[0] / front[0], back[1] / front[1], back[2] / front[2]].map((x) => x.toFixed(3));
  attachWind(mat, uTime, true);
  mat.colorNode = uniform(mat.color).rgb.mul(texture(map).rgb).mul(mix(vec3(...backMul.map(Number) as [number,number,number]),vec3(1),float(frontFacing)));
  return mat;
}

/** 落叶土。 */
function litterMaterial(): THREE.MeshStandardNodeMaterial {
  const litter = (u: number, v: number) => {
    // 细长的枯叶条:各向异性 fbm 取阈值,两个方向叠一层免得全朝一边。
    const a = tileableFbm(NOISE.paint, u * 5, v * 1, 14, 2) * 0.5 + 0.5;
    const b = tileableFbm(NOISE.fabric, u * 1, v * 5, 14, 2) * 0.5 + 0.5;
    const w = worley(u, v, 9, 4);
    const mask = smoothstep(0.35, 0.6, w.f1);
    return clamp(smoothstep(0.66, 0.76, a) + smoothstep(0.68, 0.78, b) * 0.8, 0, 1) * (0.3 + mask * 0.7);
  };
  return new THREE.MeshStandardNodeMaterial({
    roughness: 0.95,
    metalness: 0,
    map: cached('cn.bamboo.litter.albedo', () =>
      bakeColorMap({
        size: 512,
        color: (u, v) => {
          const soil = tileableFbm(NOISE.soil, u, v, 9, 3) * 0.5 + 0.5;
          const c = mixHex(0x34291e, 0x4e3f2c, soil);
          const dead = hexToRgb(0x7f6d3f);
          const moss = hexToRgb(0x4f6432);
          const l = litter(u, v) * 0.6;
          const m = smoothstep(0.5, 0.85, tileableFbm(NOISE.grass, u + 0.3, v, 5, 3) * 0.5 + 0.5) * 0.6;
          return [
            lerp(lerp(c[0], moss[0], m), dead[0], l),
            lerp(lerp(c[1], moss[1], m), dead[1], l),
            lerp(lerp(c[2], moss[2], m), dead[2], l),
          ];
        },
      }),
    ),
    normalMap: cached('cn.bamboo.litter.normal', () =>
      bakeNormalMap(
        { size: 512, height: (u, v) => clamp(0.4 + litter(u, v) * 0.35 + tileableFbm(NOISE.soil, u, v, 20, 3) * 0.15, 0, 1) },
        1.4,
      ),
    ),
  });
}

/* ------------------------------------------------------------------ */
/* 风                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 每实例 aBWind = (竿相位, 竿振幅, 叶相位)。竿/枝/叶共用同一条随高度平方增大的
 * 摆动,所以叶不会从枝上滑走;叶再叠一层高频小抖(按 uv.y 从基到尖增大)。
 */
function attachWind(mat: THREE.MeshStandardNodeMaterial, uTime: { value: number }, leaf: boolean): void {
  const time = uniform(0).onFrameUpdate(() => uTime.value);
  const wind = attribute<'vec3'>('aBWind', 'vec3');
  // r185 positionLocal is already instance-transformed; do not multiply twice.
  const h = positionLocal.y.div(NOMINAL_H).clamp(0,1).pow(2);
  const wave = sin(time.mul(0.85).add(wind.x)).add(sin(time.mul(1.9).add(wind.x.mul(1.37))).mul(0.35));
  const dir = vec2(WIND_DIR.x,WIND_DIR.y);
  const sway = dir.mul(wave).mul(wind.y).mul(h).add(vec2(-WIND_DIR.y,WIND_DIR.x).mul(sin(time.mul(1.25).add(wind.x.mul(0.71)))).mul(wind.y).mul(0.3).mul(h));
  let offset: import('three/src/nodes/core/Node.js').default<'vec3'> = vec3(sway.x,0,sway.y);
  if (leaf) {
    const flutter = sin(time.mul(3.1).add(wind.z)).mul(0.55).add(sin(time.mul(5.7).add(wind.z.mul(2.1))).mul(0.45));
    offset = offset.add(vec3(WIND_DIR.x*0.5,1,WIND_DIR.y*0.5).mul(flutter).mul(uv().y).mul(0.009));
  }
  // NodeMaterial reuses this position for beauty, shadow and MRT normal/depth.
  mat.positionNode = positionLocal.add(worldOffsetToLocal(offset));
}

/* ------------------------------------------------------------------ */
/* 装配                                                                */
/* ------------------------------------------------------------------ */

interface Inst {
  m: THREE.Matrix4[];
  wind: number[];
  color: THREE.Color[];
}

const UP = new THREE.Vector3(0, 1, 0);

function quatFromDir(dir: THREE.Vector3, roll: number, out: THREE.Quaternion): THREE.Quaternion {
  out.setFromUnitVectors(UP, dir);
  const r = new THREE.Quaternion().setFromAxisAngle(UP, roll);
  return out.multiply(r);
}

/** 让局部 +y 对准 dir、局部 +z 尽量朝 upHint(枝翘的方向)。 */
function quatFromDirUp(dir: THREE.Vector3, upHint: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const y = dir.clone().normalize();
  const z = upHint.clone().addScaledVector(y, -upHint.dot(y));
  if (z.lengthSq() < 1e-6) z.set(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return out.setFromRotationMatrix(m);
}

function buildClump(spec: ClumpSpec, rng: () => number, culm: Inst, branch: Inst, leaf: Inst): void {
  // 竿脚:泊松式散布,避免两竿互穿。
  const feet: { x: number; z: number }[] = [];
  let guard = 0;
  while (feet.length < spec.culms && guard++ < 400) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * spec.spread;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (feet.every((f) => (f.x - x) ** 2 + (f.z - z) ** 2 > 0.13 ** 2)) feet.push({ x, z });
  }

  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  for (const f of feet) {
    const H = rangeOf(rng, spec.hMin, spec.hMax);
    const R0 = rangeOf(rng, 0.015, 0.025);
    const phase = rng() * Math.PI * 2;
    const amp = (0.03 + rng() * 0.025) * (H / NOMINAL_H);
    const windOfCulm = [phase, amp, 0];
    // 每竿一个色:老竿偏黄,新竿偏青。
    const age = rng();
    const culmColor = new THREE.Color().setRGB(
      lerp(0.86, 1.0, age) * (0.92 + rng() * 0.12),
      lerp(0.98, 0.96, age) * (0.94 + rng() * 0.1),
      lerp(1.04, 0.78, age) * (0.9 + rng() * 0.12),
    );

    // 倾向:向丛外倾,上部再多弯一点。
    const dist = Math.hypot(f.x, f.z) + 1e-4;
    const outward = tmp2.set(f.x / dist, 0, f.z / dist);
    let az = Math.atan2(outward.z, outward.x) + rangeOf(rng, -0.6, 0.6);
    const tilt0 = rangeOf(rng, 0.02, 0.13) + (dist / spec.spread) * 0.05;
    let bend = rangeOf(rng, 0.08, 0.24);
    // 竹稍向路心微倾(只有竹夹路那一列给 leanAz;不给就一发 rng 都不多吃)。
    if (spec.leanAz !== undefined) {
      const target = spec.leanAz + rangeOf(rng, -0.4, 0.4);
      let d = target - az;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      az += d * 0.62;
      bend += 0.1;
    }
    const baseLen = rangeOf(rng, 0.4, 0.46);

    // 竿脚不低于 y=0:棚拍台把构件最低点当地面,土丘(≥6.5cm 厚)把脚埋住。
    pos.set(spec.cx + f.x, (spec.cy ?? 0) + 0.004, spec.cz + f.z);
    let climbed = 0;
    let seg = 0;
    const nodes: { p: THREE.Vector3; d: THREE.Vector3; r: number; t: number }[] = [];
    while (climbed < H) {
      const t = climbed / H;
      // 节间:基部短,中段长,顶部又短。
      let len = baseLen * (0.82 + 0.3 * Math.sin(Math.PI * Math.pow(t, 0.85)));
      if (climbed + len > H) len = Math.max(0.12, H - climbed);
      const tiltNow = tilt0 + bend * t * t;
      dir.set(Math.cos(az) * Math.sin(tiltNow), Math.cos(tiltNow), Math.sin(az) * Math.sin(tiltNow));
      // 顶部两段急收,不露空心口。
      const taper = lerp(1, 0.55, t);
      const tip = smoothstep(0.86, 1.0, t) * 0.5;
      const r = R0 * taper * (1 - tip);
      quatFromDir(dir, rng() * Math.PI * 2, q);
      scl.set(r, len, r);
      culm.m.push(new THREE.Matrix4().compose(pos, q, scl));
      culm.wind.push(...windOfCulm);
      culm.color.push(culmColor);
      nodes.push({ p: pos.clone(), d: dir.clone(), r, t });
      pos.addScaledVector(dir, len);
      climbed += len;
      seg++;
    }
    const top = { p: pos.clone(), d: dir.clone(), r: R0 * 0.3, t: 1 };
    nodes.push(top);

    // 出枝:顶部 1/3 的节,每节 1–2 根,左右交替。
    let side = rng() < 0.5 ? 1 : -1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.t < 0.62 && i !== nodes.length - 1) continue;
      const isTop = i === nodes.length - 1;
      const count = isTop ? 2 : rng() < 0.45 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        side = -side;
        // 枝方向:从竿轴向外张 50–70°,方位左右交替带抖。
        const perp = tmp.set(-n.d.z, 0, n.d.x).normalize();
        const spreadA = isTop ? rangeOf(rng, 0.35, 0.7) : rangeOf(rng, 0.85, 1.25);
        const azJ = rangeOf(rng, -0.5, 0.5) + (k === 1 ? Math.PI * 0.5 : 0);
        const around = new THREE.Vector3().copy(perp).applyAxisAngle(n.d, azJ + (side > 0 ? 0 : Math.PI));
        const bd = new THREE.Vector3().copy(n.d).multiplyScalar(Math.cos(spreadA)).addScaledVector(around, Math.sin(spreadA)).normalize();
        // 上部的枝略下垂,末端翘起(几何自带翘)。
        bd.y -= lerp(0.0, 0.25, n.t) * (isTop ? 0 : 1);
        bd.normalize();
        const len = rangeOf(rng, 0.26, 0.48) * (isTop ? 0.75 : 1);
        const br = rangeOf(rng, 0.0035, 0.0055);
        const bq = quatFromDirUp(bd, UP, new THREE.Quaternion());
        const bpos = n.p.clone().addScaledVector(n.d, n.r * 0.2);
        // 枝从竿皮长出。
        bpos.addScaledVector(bd, n.r * 0.6);
        branch.m.push(new THREE.Matrix4().compose(bpos, bq, new THREE.Vector3(br, len, br)));
        branch.wind.push(...windOfCulm);
        branch.color.push(culmColor);

        // 叶簇:枝上 3 处 + 枝尖,每处 3–5 片。
        const stops = [0.25, 0.45, 0.65, 0.83, 1.0];
        for (const s of stops) {
          if (s < 1 && rng() < 0.22) continue;
          const lp = branchPoint(s, len, new THREE.Vector3()).applyQuaternion(bq).add(bpos);
          const lt = branchTangent(s, len, new THREE.Vector3()).applyQuaternion(bq);
          // 一簇叶在水平面上摊成扇(不是绕枝一圈的瓶刷),再各自下垂。
          const nLeaf = s === 1 ? 6 + Math.floor(rng() * 3) : 4 + Math.floor(rng() * 3);
          const right = new THREE.Vector3().crossVectors(UP, lt);
          if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
          right.normalize();
          const fwd = new THREE.Vector3().crossVectors(right, UP).normalize();
          const fanSpan = s === 1 ? 2.4 : 1.9;
          for (let l = 0; l < nLeaf; l++) {
            const fanA = (l / (nLeaf - 1) - 0.5) * fanSpan + rangeOf(rng, -0.18, 0.18);
            const ld = new THREE.Vector3().copy(fwd).multiplyScalar(Math.cos(fanA)).addScaledVector(right, Math.sin(fanA));
            ld.y = -rangeOf(rng, 0.25, 0.7) + (s === 1 ? 0.1 : 0);
            ld.normalize();
            // 叶面朝上(局部 -z 是叶尖下垂方向,所以让 +z 朝天),再小角度翻转。
            const lq = quatFromDirUp(ld, UP, new THREE.Quaternion());
            lq.multiply(new THREE.Quaternion().setFromAxisAngle(UP, rangeOf(rng, -0.35, 0.35)));
            const L = rangeOf(rng, 0.12, 0.19);
            const W = rangeOf(rng, 0.02, 0.03);
            const lpos = lp.clone().addScaledVector(ld, 0.004);
            leaf.m.push(new THREE.Matrix4().compose(lpos, lq, new THREE.Vector3(W, L, W)));
            leaf.wind.push(phase + rangeOf(rng, -0.25, 0.25), amp, rng() * Math.PI * 2);
            const yellow = rng();
            leaf.color.push(
              new THREE.Color().setRGB(
                0.78 + rng() * 0.22 + (yellow > 0.85 ? 0.1 : 0),
                0.82 + rng() * 0.18,
                0.72 + rng() * 0.28 - (yellow > 0.85 ? 0.2 : 0),
              ),
            );
          }
        }
      }
    }
  }
}

function makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, inst: Inst): THREE.InstancedMesh {
  const g = geo.clone();
  g.setAttribute('aBWind', new THREE.InstancedBufferAttribute(new Float32Array(inst.wind), 3));
  const mesh = new THREE.InstancedMesh(g, mat, inst.m.length);
  for (let i = 0; i < inst.m.length; i++) {
    mesh.setMatrixAt(i, inst.m[i]);
    mesh.setColorAt(i, inst.color[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

function build(variant: string): PartBuild {
  const rng = makeRng(variant === 'grove' ? 0x5a5a01 : variant === 'single' ? 0x0c0c03 : 0x8fb56a);
  const uTime = { value: 0 };
  const root = new THREE.Group();

  let clumps: ClumpSpec[];
  let groundRadius: number;
  if (variant === 'grove') {
    // 5 丛错落在 6×6,丛间留空 1–2m。
    const seeds: [number, number][] = [
      [-2.0, -1.9],
      [1.7, -2.2],
      [-1.95, 1.6],
      [2.15, 1.3],
      [0.1, -0.15],
    ];
    clumps = seeds.map(([x, z]) => ({
      cx: x + rangeOf(rng, -0.25, 0.25),
      cz: z + rangeOf(rng, -0.25, 0.25),
      culms: 10 + Math.floor(rng() * 8),
      spread: rangeOf(rng, 0.42, 0.55),
      hMin: rangeOf(rng, 3.6, 4.2),
      hMax: rangeOf(rng, 5.2, 6.0),
    }));
    groundRadius = 5.2;
  } else if (variant === 'single') {
    clumps = [{ cx: 0, cz: 0, culms: 1, spread: 0.01, hMin: 5, hMax: 5.5 }];
    groundRadius = 1.6;
  } else {
    clumps = [{ cx: 0, cz: 0, culms: 12 + Math.floor(rng() * 7), spread: 0.55, hMin: 4, hMax: 6 }];
    groundRadius = 2.6;
  }

  const culm: Inst = { m: [], wind: [], color: [] };
  const branch: Inst = { m: [], wind: [], color: [] };
  const leaf: Inst = { m: [], wind: [], color: [] };
  const mounds: THREE.BufferGeometry[] = [];
  for (const c of clumps) {
    buildClump(c, rng, culm, branch, leaf);
    if (variant !== 'single') mounds.push(moundGeometry(rng, c.spread + 0.5, 0.1, c.cx, c.cz));
    else mounds.push(moundGeometry(rng, 0.4, 0.07, c.cx, c.cz));
  }

  assemble(root, uTime, culm, branch, leaf, mounds);

  return {
    root,
    groundRadius,
    update: (_dt, elapsed) => {
      uTime.value = elapsed;
    },
  };
}

/**
 * 把攒好的竿/枝/叶实例与土丘几何装成**四个** mesh 挂到 root 上。
 * 几丛都一样——这正是「整条竹夹路只有 4 个 draw call」的来处。
 */
function assemble(
  root: THREE.Object3D,
  uTime: { value: number },
  culm: Inst,
  branch: Inst,
  leaf: Inst,
  mounds: THREE.BufferGeometry[],
): void {
  const culmMat = new THREE.MeshStandardNodeMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(culmMat, bambooMaterial());
  attachWind(culmMat, uTime, false);
  const culmMesh = makeInstanced(culmSegmentGeometry(), culmMat, culm);
  culmMesh.name = 'bamboo.culm';
  root.add(culmMesh);

  if (branch.m.length) {
    const branchMesh = makeInstanced(branchGeometry(), culmMat, branch);
    branchMesh.name = 'bamboo.branch';
    root.add(branchMesh);
  }

  if (leaf.m.length) {
    const leafMesh = makeInstanced(leafGeometry(), leafMaterial(uTime), leaf);
    leafMesh.name = 'bamboo.leaf';
    root.add(leafMesh);
  }

  if (mounds.length) {
    const moundMesh = new THREE.Mesh(mounds.length === 1 ? mounds[0] : mergeGeometries(mounds), litterMaterial());
    moundMesh.name = 'bamboo.mound';
    moundMesh.castShadow = true;
    moundMesh.receiveShadow = true;
    root.add(moundMesh);
  }
}

registerPart('bamboo', build);

/* ------------------------------------------------------------------ */
/* 竹夹路:一整列丛 = 一个构件 = 4 个 draw call                          */
/* ------------------------------------------------------------------ */

/** 一丛的世界落位与形态。坐标是**世界坐标**——整列共用一组 mesh,不能各自变换。 */
export interface BambooRowSeed {
  x: number;
  z: number;
  /** 这一丛脚下的地面高(烤进矩阵,见 `ClumpSpec.cy`)。 */
  y: number;
  culms: number;
  /** 丛半径(竿脚散布半径,米)。 */
  spread: number;
  hMin: number;
  hMax: number;
  /** 竹稍倾向的方位角(指向路心)。 */
  leanAz: number;
}

/**
 * 竹夹路整列(单子 AL3)。
 *
 * **为什么要有这个入口**:`07-41`「兩邊翠竹夾路」要的是沿甬路两侧一路种下去,
 * 20 m 路按 1.8 m 丛距是 22 丛。如果每丛各自走 `buildPart('bamboo','clump')`
 * 出一件,那就是 22 件 × 4 个 InstancedMesh = **88 个 draw call**——
 * `assembleStatic` 不合并 InstancedMesh(竹子带 `update`,根本不进静态批),
 * 这一镜的 251 calls 会直接顶到 340。
 *
 * 正解是把整列所有丛的竿/枝/叶**塞进同一组四个 InstancedMesh**——`grove`
 * 变体早就这么干了(五丛仍是 4 call),这里只是把丛的位置从写死的五个种子点
 * 换成调用方给的一串。**整条竹夹路 = 4 个 draw call,与一丛同价。**
 *
 * 代价与边界:
 * - 整列共用一个包围球,视锥剔除只能整列剔——20 m 长的一列在院内镜头里
 *   本来也整列可见,不亏;真要按段剔,拆成几列各自调一次就是了。
 * - 每丛的地面高烤进矩阵(`cy`),所以 composer 必须以 `x:0,z:0,y:0` 落位,
 *   和 `luya` / `shiyabian` 那两个世界坐标构件同一路数。
 */
export function buildBambooRow(seeds: readonly BambooRowSeed[], seed = 0xb0c8ed): PartBuild {
  const rng = makeRng(seed);
  const uTime = { value: 0 };
  const root = new THREE.Group();
  root.name = 'BambooRow';
  const culm: Inst = { m: [], wind: [], color: [] };
  const branch: Inst = { m: [], wind: [], color: [] };
  const leaf: Inst = { m: [], wind: [], color: [] };
  const mounds: THREE.BufferGeometry[] = [];
  for (const s of seeds) {
    buildClump(
      { cx: s.x, cz: s.z, cy: s.y, culms: s.culms, spread: s.spread, hMin: s.hMin, hMax: s.hMax, leanAz: s.leanAz },
      rng,
      culm,
      branch,
      leaf,
    );
    // 土丘比散丛的小一圈(+0.45 → +0.10):夹路的丛离路心只有 1.2m,
    // 老尺寸的裙脚半径能到 1.0m,整条石子漫会被落叶土盖掉半幅。
    mounds.push(moundGeometry(rng, s.spread + 0.1, 0.09, s.x, s.z, s.y));
  }
  assemble(root, uTime, culm, branch, leaf, mounds);
  // TEMP-AB: 归因实验,量影子 pass 占多少
  return {
    root,
    update: (_dt, elapsed) => {
      uTime.value = elapsed;
    },
  };
}
