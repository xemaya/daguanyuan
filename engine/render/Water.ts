import { positionLocal, modelWorldMatrix, vec4, vec3, positionWorld, positionView, normalView, cameraPosition, cameraViewMatrix } from 'three/tsl';
import { bindUniforms } from './nodes/bindings';
import { waterNodes } from './nodes/water';
import * as THREE from 'three/webgpu';
import type { GameContext } from '@engine/core/Context';
import { Simplex, clamp } from '@engine/core/Noise';
import { waterSwellNormal, waterChopNormal, waterDetailTexture } from './WaterMaterials';

/**
 * Garden water shares the terrain's world-space sampling domain. The signed
 * bed map carries depth and shore distance; pixels above the water level or
 * outside that domain are discarded instead of becoming an invented sea.
 * Two normal layers, restrained displacement and the sky Fresnel response
 * retain the existing stylised material. Reflection work belongs to P3.
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
/* Shader                                                              */
/* ------------------------------------------------------------------ */

export function buildWater(ctx: GameContext): void {
  if (!ctx.terrain) throw new Error('Water requires the terrain sampling domain');
  const window = makeWaterWindow(ctx.terrain.bounds);
  const waterLevel = ctx.terrain.waterLevel;
  const bed = bakeSeabed((x, z) => ctx.collision.terrainHeight(x, z), window, waterLevel);

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

  const nodes = waterNodes(bindUniforms(uniforms));
  const restWorld = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
  mat.positionNode = positionLocal.add(vec3(0, nodes.waveHeight(restWorld, cameraPosition), 0));
  const surface = nodes.waterSurface(positionWorld.xz, positionView.negate());
  const params = surface.element(1);
  const far = surface.element(2).x;
  mat.colorNode = surface.element(0);
  mat.opacityNode = params.x;
  mat.roughnessNode = nodes.waterRoughness(0.23, far, params.z, params.y);
  mat.normalNode = nodes.waterNormal(positionWorld.xz, positionView.negate(), normalView, cameraViewMatrix, far, params.z, params.y);
  mat.emissiveNode = nodes.waterGlitter(positionWorld.xz, positionView.negate(), mat.normalNode, cameraViewMatrix, far, params.y);

  const geometry = new THREE.PlaneGeometry(window.width,window.depth,Math.ceil(window.width/2),Math.ceil(window.depth/2));
  geometry.rotateX(-Math.PI/2);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = 'Sea';
  mesh.position.set(window.minX+window.width/2,waterLevel,window.minZ+window.depth/2);
  mesh.userData.water = { window, waterLevel, bed };
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
