import { positionWorld, normalWorld, normalView, cameraViewMatrix } from 'three/tsl';
import { bindUniforms } from '@engine/render/nodes/bindings';
import { terrainNodes } from './nodes/terrain';
import * as THREE from 'three/webgpu';
import { terrainWindow } from '@builder/plan/window';
import { buildTerrainChunks } from '@engine/render/TerrainChunks';
import type { GameContext } from '@engine/core/Context';
import { grassTurfMaps, cobbleMaps, type MaterialMaps } from '@engine/core/TextureLab';
import {
  sandMaps,
  trackEarthMaps,
  terrainWarpTexture,
  packNormalPair,
  packScalarQuad,
} from '@engine/render/TerrainMaterials';
import { makeTerrainField, type GardenPlan, type SurfaceMasks } from './terrain-from-plan';

export type { GardenPlan };

/**
 * `builder/` may not import `@project/` (see `check:layers`'s `FORBIDDEN`
 * table — a hard rule, not an oversight: it keeps this module reusable
 * across projects instead of hard-wired to one garden's data file). Task 6's
 * files are restricted to a fixed list that does not include
 * `builder/compose/world.ts` or `engine/core/Context.ts`, so `plan.json`
 * cannot be threaded through `GameContext` either. The remaining legal path
 * is dependency injection through a project-layer call: `main.ts` (which
 * *is* allowed to import `@project/plan.json`) calls `setPlan()` once before
 * `world.build()` runs. `composer.ts` reads the same instance via
 * `getPlan()` below rather than injecting its own copy.
 */
let injectedPlan: GardenPlan | undefined;
export function setPlan(p: GardenPlan): void {
  Object.assign(TERRAIN,terrainWindow(p,MVP_REGIONS,PAD,CELL));
  injectedPlan = p;
}
export function getPlan(): GardenPlan {
  if (!injectedPlan) {
    throw new Error(
      '[terrain] plan 未注入：main.ts 必须在 world.build() 之前调用 setPlan()（builder/ 不许 import @project/，见 check:layers）',
    );
  }
  return injectedPlan;
}

/**
 * Terrain — the heightfield everything else in the garden stands on.
 *
 * P1 · Task 6: this used to be a hand-authored 64×72m field (`makeField` in
 * this file, now deleted). The heightfield itself moved to Task 5's
 * `terrain-from-plan.ts`, which reads `plan.json`'s wall/water/hills/paths/
 * regions directly — no garden coordinate lives in code any more. This file's
 * job shrank to: pick the sampling window (the plan's canvas is 500×500m; a
 * VSM-shadow-receiving mesh at that size is unaffordable, so only the MVP
 * route's four regions plus a margin are meshed — see `terrain-from-plan.ts`'s
 * own docstring: `bounds` does not crop the field, it only tells *this* file's
 * grid/bake code which window to sample), bake the field into a mesh + splat
 * texture, and own the shader/material that reads it.
 *
 *  1. **The ground is a function, not a mesh.** `height(x, z)` is the plan-
 *     driven analytic field. The mesh is a *sample* of it, and
 *     `collision.groundHeight` is the very same function, so a prop placed at
 *     (x, z) sits exactly on the visible surface with no raycast, no BVH, and
 *     no drift when the mesh LOD changes. Same story for the surface masks:
 *     `surfaceAt` and the baked splat texture are two readings of one
 *     `masks(x, z)`.
 *
 *  2. **Flatten by mask, not by clamp.** Building pads and paths are graded
 *     inside `terrain-from-plan.ts`'s own field, not here.
 *
 * The material is a MeshStandardNodeMaterial with TSL expressions to
 * do a four-way height-aware splat blend (turf / dirt / cobble / sand). Going
 * through Standard lighting keeps the existing shadows, the
 * PMREM environment, fog and the HDR pipeline working for free.
 */

/* ------------------------------------------------------------------ */
/* Sampling window — the MVP route's four regions, padded.             */
/* ------------------------------------------------------------------ */

/** The four regions the 一期 route actually passes through. */
const MVP_REGIONS = ['zhengmen', 'cuizhang', 'qinfang_ting_qiao', 'xiaoxiangguan'] as const;

/**
 * Metres of margin outside the MVP regions' combined bounding box. Knob #2
 * from the P1 Task 6 plan's Step 0 ②: the full 500×500m canvas at any
 * sane grid resolution is an unaffordable VSM shadow receiver, so only the
 * route's neighbourhood is meshed. 20m left `理地`+`植树` (both scale off
 * this window) at 30.7s total build against the 30s ceiling with CELL alone
 * pushed to 0.9m; trimmed to 15m to buy the last bit of margin on both
 * steps at once rather than degrading the grid further.
 */
const PAD = 15;

/** Fine geometry restored after F's indexed sampling and worker texture preparation.
 * The sampling window is derived from the injected regions at this spacing. */
const CELL = 0.48;

/** Filled by setPlan before world creation; consumers share this object. */
export const TERRAIN = {
  minX:0,maxX:0,minZ:0,maxZ:0,width:0,depth:0,segX:0,segZ:0,
  playMinX:0,playMaxX:0,playMinZ:0,playMaxZ:0,
};

/* ------------------------------------------------------------------ */
/* Splat bake                                                          */
/* ------------------------------------------------------------------ */

type Field = ReturnType<typeof makeTerrainField>;

/** Bake world-space masks at 1024²; F removes repeated work rather than thinning this field.
 *
 *  通道打包（单子 N 铺地之后四通道要装六种权重，0.5 是分档线）：
 *    R dirt ｜ G <0.5=石子漫(cobble)×2、≥0.5=石板(slab)×2−1 ｜
 *    B <0.5=浅滩沙×2、≥0.5=苔(moss)×2−1 ｜ A wear
 *  G 里 cobble 与 slab 的区域在空间上不相邻（潇湘馆 vs 正门），B 里 moss 让位给
 *  sand（见 masks()，苔带与水线沙带重叠处留沙）——mipmap 平均出来的中间值只会
 *  出现在各自区域的边缘羽化带上，解码后仍是合法的弱权重，不会串成另一种材质。 */
function bakeSplat(field: Field, size = 1024): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = TERRAIN.minZ + ((j + 0.5) / size) * TERRAIN.depth;
    for (let i = 0; i < size; i++) {
      const x = TERRAIN.minX + ((i + 0.5) / size) * TERRAIN.width;
      const m = field.masks(x, z);
      const o = (j * size + i) * 4;
      data[o] = m.dirt * 255;
      data[o + 1] = m.slab > 0 ? 128 + Math.min(127, m.slab * 127) : m.cobble * 127;
      data[o + 2] = m.sand > 0.02 ? Math.min(127, m.sand * 127) : 128 + m.moss * 127;
      data[o + 3] = m.wear * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Material                                                            */
/* ------------------------------------------------------------------ */

function sharpen(maps: MaterialMaps): MaterialMaps {
  // Terrain is the one surface always seen at a grazing angle; it needs the
  // full anisotropic budget or the horizon smears.
  for (const t of [maps.map, maps.normalMap, maps.roughnessMap]) {
    if (t.anisotropy < 16) {
      t.anisotropy = 16;
      t.needsUpdate = true;
    }
  }
  return maps;
}

export function buildTerrain(ctx: GameContext): void {
  const timings: [string, number][] = [];
  const timed = <T>(label: string, build: () => T): T => {
    const start = performance.now();
    const result = build();
    timings.push([label, performance.now() - start]);
    return result;
  };
  const plan = getPlan();
  const field = makeTerrainField(plan, {
    seed: ctx.seed,
    bounds: { minX: TERRAIN.minX, maxX: TERRAIN.maxX, minZ: TERRAIN.minZ, maxZ: TERRAIN.maxZ },
  });

  // ---- publish the sampler first: everything downstream needs it -------
  ctx.collision.terrainHeight = (x: number, z: number) => field.height(x, z);
  ctx.collision.surfaceAt = (x: number, z: number) => field.surface(x, z);
  ctx.terrain = { bounds: TERRAIN, waterLevel: 0 };

  // ---- textures --------------------------------------------------------
  const turf = timed('turf maps', () => sharpen(grassTurfMaps()));
  // The worn-track maps, not the shared `dirtPathMaps`. That one is authored for
  // props at arm's length and its pebble layer is a *single* Worley at 22 cells
  // — one cell size everywhere, which is the definition of a lattice: at the
  // distance where a cell lands on a pixel the whole track reads as laid
  // cobblestone. `trackEarthMaps` stacks three incommensurate Worley grids with
  // a drifting size selector and a drifting density, so there is no dominant
  // wavelength left to find.
  const dirt = timed('dirt maps', () => sharpen(trackEarthMaps()));
  const cobble = timed('cobble maps', () => sharpen(cobbleMaps()));
  const sand = timed('sand maps', () => sharpen(sandMaps()));
  const splat = timed('splat', () => bakeSplat(field));
  const warp = timed('warp', () => terrainWarpTexture());
  const nrmTD = packNormalPair('turf-dirt', turf.normalMap, dirt.normalMap);
  const nrmCS = packNormalPair('cobble-sand', cobble.normalMap, sand.normalMap);
  const rough4 = packScalarQuad(
    'terrain',
    turf.roughnessMap,
    dirt.roughnessMap,
    cobble.roughnessMap,
    sand.roughnessMap,
  );

  // ---- material --------------------------------------------------------
  const mat = new THREE.MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
  });

  const uniforms = {
    uSplat: { value: splat },
    uWarp: { value: warp },
    uTurfMap: { value: turf.map },
    uDirtMap: { value: dirt.map },
    uCobMap: { value: cobble.map },
    uSandMap: { value: sand.map },
    uNrmTD: { value: nrmTD },
    uNrmCS: { value: nrmCS },
    uRough4: { value: rough4 },
    uExtent: {
      value: new THREE.Vector4(TERRAIN.minX, TERRAIN.minZ, TERRAIN.width, TERRAIN.depth),
    },
    uNormalStrength: { value: 1.15 },
  };

  const nodes = terrainNodes(bindUniforms(uniforms));
  const surface = nodes.terrainSurface(positionWorld.xz, positionWorld.y, normalWorld);
  mat.colorNode = surface.element(0);
  mat.roughnessNode = surface.element(2).x;
  mat.normalNode = nodes.terrainNormal(normalView, surface.element(1), cameraViewMatrix);

  const terrain = new THREE.Group();
  terrain.name = 'Terrain';
  const chunks = timed('mesh', () => buildTerrainChunks(field, TERRAIN, 64, {
    segX: TERRAIN.segX, segZ: TERRAIN.segZ, material: mat,
  }));
  terrain.add(...chunks);
  ctx.scene.add(terrain);
  terrain.userData.chunkCount = chunks.length;
  terrain.userData.buildTimings = timings;

  // ---- perimeter blockers ---------------------------------------------
  // Tall enough that a jump cannot clear them, deep enough that walking down
  // a slope never slips under them. Fences the *sampling window*, not the
  // real garden wall (see TERRAIN.playMinX/... doc comment above).
  const LO = -6;
  const HI = 9;
  const { playMinX, playMaxX, playMinZ, playMaxZ } = TERRAIN;
  const midX = (playMinX + playMaxX) / 2;
  const midZ = (playMinZ + playMaxZ) / 2;
  const halfX = (playMaxX - playMinX) / 2;
  const halfZ = (playMaxZ - playMinZ) / 2;
  const T = 1.5;

  ctx.collision.addBox(playMinX - T, midZ, T, halfZ + T * 2, LO, HI, 0, 'bounds-west');
  ctx.collision.addBox(playMaxX + T, midZ, T, halfZ + T * 2, LO, HI, 0, 'bounds-east');
  ctx.collision.addBox(midX, playMinZ - T, halfX + T * 2, T, LO, HI, 0, 'bounds-north');
  ctx.collision.addBox(midX, playMaxZ + T, halfX + T * 2, T, LO, HI, 0, 'bounds-south');
}
