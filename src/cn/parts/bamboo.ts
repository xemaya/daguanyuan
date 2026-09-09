import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerPart, type PartBuild } from '../registry';
import { bambooMaterial, CN } from '../materials';
import { makeRng, rangeOf, tileableFbm, worley, clamp, smoothstep, lerp } from '../../core/Noise';
import { bakeColorMap, bakeScalarMap, bakeNormalMap, cached, mixHex, hexToRgb, NOISE } from '../../core/TextureLab';

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
 * 风:两种材质的 onBeforeCompile 共享一个 uTime;竿/枝/叶用同一条"随高度平方
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
function moundGeometry(rng: () => number, R: number, H: number, cx: number, cz: number): THREE.BufferGeometry {
  const RINGS = 6;
  const SEG = 36;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const seed = rng() * 10;
  pos.push(cx, H, cz);
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
      pos.push(cx + x, y, cz + z);
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
function leafMaterial(uTime: { value: number }): THREE.MeshStandardMaterial {
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
  const mat = new THREE.MeshStandardMaterial({
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
  attachWind(mat, uTime, true, `
    if ( !gl_FrontFacing ) diffuseColor.rgb *= vec3( ${backMul.join(', ')} );
  `);
  return mat;
}

/** 落叶土。 */
function litterMaterial(): THREE.MeshStandardMaterial {
  const litter = (u: number, v: number) => {
    // 细长的枯叶条:各向异性 fbm 取阈值,两个方向叠一层免得全朝一边。
    const a = tileableFbm(NOISE.paint, u * 5, v * 1, 14, 2) * 0.5 + 0.5;
    const b = tileableFbm(NOISE.fabric, u * 1, v * 5, 14, 2) * 0.5 + 0.5;
    const w = worley(u, v, 9, 4);
    const mask = smoothstep(0.35, 0.6, w.f1);
    return clamp(smoothstep(0.66, 0.76, a) + smoothstep(0.68, 0.78, b) * 0.8, 0, 1) * (0.3 + mask * 0.7);
  };
  return new THREE.MeshStandardMaterial({
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
function attachWind(
  mat: THREE.MeshStandardMaterial,
  uTime: { value: number },
  leaf: boolean,
  fragExtra = '',
): void {
  const flutter = leaf
    ? `
    float fl = sin( t * 3.1 + aBWind.z ) * 0.55 + sin( t * 5.7 + aBWind.z * 2.1 ) * 0.45;
    mvPosition.xyz += vec3( ${WIND_DIR.x.toFixed(3)} * 0.5, 1.0, ${WIND_DIR.y.toFixed(3)} * 0.5 ) * fl * uv.y * 0.009;`
    : '';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uBTime;
#ifdef USE_INSTANCING
attribute vec3 aBWind;
#else
const vec3 aBWind = vec3( 0.0 );
#endif`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
{
  float t = uBTime;
  float h = clamp( mvPosition.y / ${NOMINAL_H.toFixed(2)}, 0.0, 1.0 );
  float hh = h * h;
  float s = sin( t * 0.85 + aBWind.x ) + sin( t * 1.9 + aBWind.x * 1.37 ) * 0.35;
  vec2 dir = vec2( ${WIND_DIR.x.toFixed(4)}, ${WIND_DIR.y.toFixed(4)} );
  vec2 sway = dir * s * aBWind.y * hh;
  sway += vec2( -dir.y, dir.x ) * sin( t * 1.25 + aBWind.x * 0.71 ) * aBWind.y * 0.3 * hh;
  mvPosition.xz += sway;${flutter}
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
      );
    if (fragExtra) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        `#include <alphatest_fragment>\n${fragExtra}`,
      );
    }
  };
  mat.customProgramCacheKey = () => (leaf ? 'cn.bamboo.leaf' : 'cn.bamboo.culm');
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
    const az = Math.atan2(outward.z, outward.x) + rangeOf(rng, -0.6, 0.6);
    const tilt0 = rangeOf(rng, 0.02, 0.13) + (dist / spec.spread) * 0.05;
    const bend = rangeOf(rng, 0.08, 0.24);
    const baseLen = rangeOf(rng, 0.4, 0.46);

    // 竿脚不低于 y=0:棚拍台把构件最低点当地面,土丘(≥6.5cm 厚)把脚埋住。
    pos.set(spec.cx + f.x, 0.004, spec.cz + f.z);
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

  const culmMat = bambooMaterial();
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

  const moundMesh = new THREE.Mesh(mounds.length === 1 ? mounds[0] : mergeGeometries(mounds), litterMaterial());
  moundMesh.name = 'bamboo.mound';
  moundMesh.castShadow = true;
  moundMesh.receiveShadow = true;
  root.add(moundMesh);

  return {
    root,
    groundRadius,
    update: (_dt, elapsed) => {
      uTime.value = elapsed;
    },
  };
}

registerPart('bamboo', build);
