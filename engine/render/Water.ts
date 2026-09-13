import { positionLocal, modelWorldMatrix, vec4, vec3, positionWorld, positionView, normalView, cameraPosition, cameraViewMatrix } from 'three/tsl';
import { mrt, float } from 'three/tsl';
import { bindUniforms } from './nodes/bindings';
import { waterNodes } from './nodes/water';
import * as THREE from 'three/webgpu';
import type { GameContext } from '@engine/core/Context';
import { Simplex, clamp, smoothstep } from '@engine/core/Noise';
import { waterSwellNormal, waterChopNormal, waterDetailTexture } from './WaterMaterials';

/**
 * Garden water shares the terrain's world-space sampling domain. The signed
 * bed map carries depth and shore distance; pixels above the water level or
 * outside that domain are discarded instead of becoming an invented sea.
 * A second map carries the plan-driven flow field: creeks advect their ripple
 * normals along the centerline tangent while pools keep the still-water look.
 * Reflection work belongs to the post-WG reflection pass, not P3.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export interface WaterWindow {
  minX:number; minZ:number; width:number; depth:number; resX:number; resZ:number;
}

export function makeWaterWindow(bounds: {minX:number;maxX:number;minZ:number;maxZ:number}, cell=.5): WaterWindow {
  const width=bounds.maxX-bounds.minX,depth=bounds.maxZ-bounds.minZ;
  if(![bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ,cell].every(Number.isFinite) || !(width>0 && depth>0 && cell>0)) throw new Error('Invalid water sampling domain');
  return {minX:bounds.minX,minZ:bounds.minZ,width,depth,resX:Math.ceil(width/cell),resZ:Math.ceil(depth/cell)};
}

/** Encoding range for the depth channel, metres. */
const DEPTH_RANGE = 4.0;
/** Encoding range for the horizontal shore-distance channel, metres. */
const SHORE_RANGE = 8.0;

const COLOR_SHALLOW = 0x5aa08e;
const COLOR_DEEP = 0x1f4f4a;
const COLOR_FOAM = 0xeef6f4;

/* ------------------------------------------------------------------ */
/* Seabed map                                                          */
/* ------------------------------------------------------------------ */

/**
 * Signed square-root encoding. Byte textures spend their precision uniformly,
 * which is exactly backwards for a field whose interesting values all sit
 * within a few centimetres of zero. Square-rooting the magnitude gives sub-
 * millimetre resolution at the waterline and a still-useful 5 cm out at the
 * range limit.
 */
function enc(x: number, range: number): number {
  const s = Math.sign(x) * Math.sqrt(Math.min(Math.abs(x), range) / range);
  return s * 0.5 + 0.5;
}

export function bakeSeabed(ground: (x: number, z: number) => number, window: WaterWindow, waterLevel=0): THREE.DataTexture {
  const { minX, minZ, width, depth, resX, resZ } = window;
  const dx = width / resX;
  const dz = depth / resZ;

  // Pass 1: heights. One terrain-height call per texel — the gradient comes
  // from the grid itself rather than four extra samples, which is a 5x saving
  // on the most expensive function in the build.
  const h = new Float32Array(resX * resZ);
  for (let j = 0; j < resZ; j++) {
    const z = minZ + (j + 0.5) * dz;
    for (let i = 0; i < resX; i++) {
      const x = minX + (i + 0.5) * dx;
      h[j * resX + i] = ground(x,z) - waterLevel;
    }
  }

  // Pass 2: gradient -> horizontal distance to the waterline, and encode.
  const noise = new Simplex(0x0cea9f);
  const data = new Uint8Array(resX * resZ * 4);
  const at = (i: number, j: number) =>
    h[Math.min(resZ - 1, Math.max(0, j)) * resX + Math.min(resX - 1, Math.max(0, i))];

  for (let j = 0; j < resZ; j++) {
    for (let i = 0; i < resX; i++) {
      const v = h[j * resX + i];
      // Two-cell central differences: a wider stencil than the mesh uses,
      // because the foam wants the macro slope of the beach and not the
      // centimetre-scale ripple sitting on top of it.
      const gx = (at(i + 2, j) - at(i - 2, j)) / (4 * dx);
      const gz = (at(i, j + 2) - at(i, j - 2)) / (4 * dz);
      const slope = Math.hypot(gx, gz);
      const shore = v / Math.max(slope, 0.05);

      const x = minX + (i + 0.5) * dx;
      const z = minZ + (j + 0.5) * dz;
      const n = noise.noise2D(x * 0.055, z * 0.055) * 0.5 + 0.5;

      const o = (j * resX + i) * 4;
      data[o] = enc(v, DEPTH_RANGE) * 255;
      data[o + 1] = enc(shore, SHORE_RANGE) * 255;
      data[o + 2] = clamp(slope / 0.9, 0, 1) * 255;
      data[o + 3] = clamp(n, 0, 1) * 255;
    }
  }

  const tex = new THREE.DataTexture(data, resX, resZ, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // No mipmaps: this is a signed field, and a mipped waterline bleeds land
  // into sea and softens the foam edge into a 3 m smear at grazing angles.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Flow map                                                            */
/* ------------------------------------------------------------------ */

/** plan.json 水系条目的流向字段子集——engine 层不 import plan,由调用方注入。 */
export interface WaterFlowSpec {
  id?: string;
  polygon: number[][];
  centerline?: number[][];
  flow_m_s?: number;
}

/**
 * Speed encoding range for the flow map's B channel, m/s. Linear is fine here:
 * garden flows sit in 0–0.6 m/s, so a byte still resolves to 4 mm/s.
 */
export const FLOW_RANGE = 1.0;
/** Metres over which creek speed ramps up from the bank/pool edge inward. */
const FLOW_FEATHER = 2.0;
/** Outward margin for flowing systems, covering the terrain's edge warp. */
const FLOW_MARGIN = 1.6;
/**
 * 低于此端岸高差视为平坡,保留数据 authored 次序:园内地势本就平缓,
 * 而环采样受园路/台基整地影响有 ±0.3m 噪声,小差值不足以反转叙事流向。
 */
const DOWNHILL_EPS = 0.4;

let injectedFlows: readonly WaterFlowSpec[] = [];

/**
 * 与 builder/compose/terrain.ts 的 setPlan 同理:engine 层不许 import
 * builder/projects,水系流向由装配方注入。未注入时烘一张全零流速图,
 * 水面行为与引入流向之前完全一致。
 */
export function setWaterFlows(systems: readonly WaterFlowSpec[]): void {
  injectedFlows = systems ?? [];
}

/** Signed distance to a closed ring, metres — negative inside. */
function ringSD(x: number, z: number, ring: number[][]): number {
  let inside = false;
  let d2 = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) {
    const ax = ring[i][0], az = ring[i][1], bx = ring[i + 1][0], bz = ring[i + 1][1];
    const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
    const L = vx * vx + vz * vz;
    let t = L > 1e-12 ? (wx * vx + wz * vz) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = wx - vx * t, ez = wz - vz * t;
    const dd = ex * ex + ez * ez;
    if (dd < d2) d2 = dd;
    if ((az > z) !== (bz > z) && x < ax + ((bx - ax) * (z - az)) / (bz - az)) inside = !inside;
  }
  const d = Math.sqrt(d2);
  return inside ? -d : d;
}

/**
 * 河床挖到 -depth 后是平的,沿 centerline 本身量不出下坡。改取端点邻域的
 * 岸顶高程(环采样取最大,避开挖下去的河道;环半径按当地半河宽外扩 1.5m,
 * 宽溪的小半径环会整圈落在河床里),天然地形的两端高差即流向依据。
 */
function bankHeight(ground: (x: number, z: number) => number, p: number[], radius: number): number {
  let m = ground(p[0], p[1]);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    m = Math.max(m, ground(p[0] + Math.cos(a) * radius, p[1] + Math.sin(a) * radius));
  }
  return m;
}

/** Unit tangent of the polyline at the point nearest to (x, z), sign applied. */
function nearestTangent(line: number[][], x: number, z: number, sign: number): [number, number] {
  let bestD2 = Infinity, tx = sign, tz = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const ax = line[i][0], az = line[i][1], bx = line[i + 1][0], bz = line[i + 1][1];
    const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
    const L = vx * vx + vz * vz;
    let t = L > 1e-12 ? (wx * vx + wz * vz) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = wx - vx * t, ez = wz - vz * t;
    const dd = ex * ex + ez * ez;
    if (dd < bestD2) {
      bestD2 = dd;
      const len = Math.sqrt(L) || 1;
      tx = (vx / len) * sign;
      tz = (vz / len) * sign;
    }
  }
  return [tx, tz];
}

interface PreparedFlow {
  ring: number[][];
  bbox: [number, number, number, number];
  margin: number;
  flow: number;
  line: number[][] | null;
  sign: number;
  /** 流速羽化带宽,窄沟按半河宽收缩,否则 0.8m 的引泉沟整段被羽化吃掉。 */
  feather: number;
}

/**
 * Flow field over the same domain as the seabed map. Packing (RGBA8):
 *   R/G — flow direction, a world-space XZ unit vector mapped to [0,1]
 *         (0.5 = still; deliberately not renormalised in the shader so that
 *         linear filtering across a bend blends directions instead of
 *         producing a singular texel);
 *   B   — speed / FLOW_RANGE, ramped to zero from the polygon edge (over
 *         FLOW_FEATHER metres, shrunk to the local half-width for narrow
 *         channels) so creek meets pool without a visible seam;
 *   A   — water type, 0 = pool / 1 = flowing system (creek, ditch, inlet).
 * Texels outside every water polygon get the neutral still-water value.
 * Pure function of (ground, systems, window): no noise, no global state —
 * same translation invariance and determinism standard as bakeSeabed.
 */
export function bakeFlow(
  ground: (x: number, z: number) => number,
  systems: readonly WaterFlowSpec[],
  window: WaterWindow,
): THREE.DataTexture {
  const { minX, minZ, width, depth, resX, resZ } = window;
  const dx = width / resX;
  const dz = depth / resZ;

  const prepared: PreparedFlow[] = systems.map((w) => {
    const flow = w.flow_m_s ?? 0;
    const line = flow > 0 && w.centerline && w.centerline.length >= 2 ? w.centerline : null;
    const margin = line ? FLOW_MARGIN : 0;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [px, pz] of w.polygon) {
      x0 = Math.min(x0, px); z0 = Math.min(z0, pz);
      x1 = Math.max(x1, px); z1 = Math.max(z1, pz);
    }
    // 流向取地形下坡方向,防止手写数据写反:两端岸顶高程低的一端是下游。
    let sign = 1;
    let feather = FLOW_FEATHER;
    if (line) {
      const r0 = Math.max(2.5, Math.abs(ringSD(line[0][0], line[0][1], w.polygon)) + 1.5);
      const r1 = Math.max(2.5, Math.abs(ringSD(line[line.length - 1][0], line[line.length - 1][1], w.polygon)) + 1.5);
      if (bankHeight(ground, line[line.length - 1], r1) - bankHeight(ground, line[0], r0) > DOWNHILL_EPS) sign = -1;
      let half = Infinity;
      for (const p of line) half = Math.min(half, Math.abs(ringSD(p[0], p[1], w.polygon)));
      if (Number.isFinite(half)) feather = Math.min(FLOW_FEATHER, Math.max(half, 0.1));
    }
    return { ring: w.polygon, bbox: [x0 - margin, z0 - margin, x1 + margin, z1 + margin], margin, flow, line, sign, feather };
  });

  const data = new Uint8Array(resX * resZ * 4);
  for (let j = 0; j < resZ; j++) {
    const z = minZ + (j + 0.5) * dz;
    for (let i = 0; i < resX; i++) {
      const x = minX + (i + 0.5) * dx;
      const o = (j * resX + i) * 4;
      // 所在水系:流动水体优先于静水(溪穿池而过处两多边形重叠,
      // 池的静水不应截断溪);同类候选取内深最大者,不会双重计速。
      let best: PreparedFlow | null = null;
      let bestSD = Infinity;
      for (const s of prepared) {
        const [x0, z0, x1, z1] = s.bbox;
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        const sd = ringSD(x, z, s.ring);
        if (sd >= s.margin) continue;
        const better = best === null
          || (s.line !== null && best.line === null)
          || ((s.line !== null) === (best.line !== null) && sd < bestSD);
        if (better) { best = s; bestSD = sd; }
      }
      if (!best || !best.line) {
        // 陆地与静水池同为中性值:流向 (0,0)、流速 0、类型池。
        data[o] = 128;
        data[o + 1] = 128;
        continue;
      }
      const [tx, tz] = nearestTangent(best.line!, x, z, best.sign);
      const speed = best.flow * smoothstep(0, best.feather, -bestSD);
      data[o] = (tx * 0.5 + 0.5) * 255;
      data[o + 1] = (tz * 0.5 + 0.5) * 255;
      data[o + 2] = clamp(speed / FLOW_RANGE, 0, 1) * 255;
      data[o + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, resX, resZ, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // Same no-mipmap rule as the bed map: linear filtering is exactly the creek–
  // pool blend we want, a mip chain would smear bank stillness into midstream.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Shader                                                              */
/* ------------------------------------------------------------------ */

export function buildWater(ctx: GameContext): void {
  if (!ctx.terrain) throw new Error('Water requires the terrain sampling domain');
  const window = makeWaterWindow(ctx.terrain.bounds);
  const waterLevel = ctx.terrain.waterLevel;
  const ground = (x: number, z: number) => ctx.collision.terrainHeight(x, z);
  const bed = bakeSeabed(ground, window, waterLevel);
  const flow = bakeFlow(ground, injectedFlows, window);

  const swell = waterSwellNormal();
  const chop = waterChopNormal();
  const detail = waterDetailTexture();
  // The sea is the one surface always read at a grazing angle across hundreds
  // of metres; it needs the whole anisotropic budget.
  for (const t of [swell, chop, detail]) {
    t.anisotropy = 16;
    t.needsUpdate = true;
  }

  const uniforms = {
    uBed: { value: bed },
    uBedWindow: { value: new THREE.Vector4(window.minX, window.minZ, window.width, window.depth) },
    uFlow: { value: flow },
    uTime: { value: 0 },
    uWaveAmp: { value: 0.25 },
    uSwell: { value: swell },
    uChop: { value: chop },
    uDetail: { value: detail },
    uShallow: { value: new THREE.Color(COLOR_SHALLOW).convertSRGBToLinear() },
    uDeep: { value: new THREE.Color(COLOR_DEEP).convertSRGBToLinear() },
    uFoamColor: { value: new THREE.Color(COLOR_FOAM).convertSRGBToLinear() },
    uSkyTint: { value: new THREE.Color(0xbfe0f2).convertSRGBToLinear().multiplyScalar(0.9) },
    uSunDir: { value: ctx.env.sunDirection.clone().multiplyScalar(-1) },
    uSunColor: { value: ctx.env.sunColor.clone() },
  };

  const mat = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff,
    roughness: 0.23,
    metalness: 0.0,
    ior: 1.33,
    specularIntensity: 1.0,
    envMapIntensity: 0.80,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    dithering: true,
  });

  // Transparent color blends normally; preserve opaque MRT normals underneath.
  const nodes = waterNodes(bindUniforms(uniforms));
  const restWorld = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
  mat.positionNode = positionLocal.add(vec3(0, nodes.waveHeight(restWorld, cameraPosition), 0));
  const surface = nodes.waterSurface(positionWorld.xz, positionView.negate()).toVar();
  const params = surface.element(1);
  const far = surface.element(2).x;
  mat.colorNode = surface.element(0);
  mat.opacityNode = params.x;
  mat.roughnessNode = nodes.waterRoughness(0.23, far, params.z, params.y);
  mat.normalNode = nodes.waterNormal(positionWorld.xz, positionView.negate(), normalView, cameraViewMatrix, far, params.z, params.y);
  mat.emissiveNode = nodes.waterGlitter(positionWorld.xz, positionView.negate(), mat.normalNode, cameraViewMatrix, far, params.y);

  // AO belongs to opaque radiance: transparent coverage attenuates AO without writing depth.
  mat.mrtNode = mrt({ normal: vec4(0,0,0,0), aoMask: vec4(0,0,0,float(mat.opacityNode as import('three/src/nodes/core/Node.js').default<'float'>)) });
  const geometry = new THREE.PlaneGeometry(window.width,window.depth,Math.ceil(window.width/2),Math.ceil(window.depth/2));
  geometry.rotateX(-Math.PI/2);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = 'Sea';
  mesh.position.set(window.minX+window.width/2,waterLevel,window.minZ+window.depth/2);
  mesh.userData.water = { window, waterLevel, bed, flow };
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Transparent surfaces sort by distance to their origin; the disc's origin is
  // the town centre, which would place it in front of props it is behind. A
  // fixed render order puts the sea after the opaque pass and before nothing
  // else, which is exactly where it belongs.
  mesh.renderOrder = 2;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  ctx.scene.add(mesh);

  ctx.tick(() => {
    uniforms.uTime.value = ctx.env.windTime.value;
  });
}
