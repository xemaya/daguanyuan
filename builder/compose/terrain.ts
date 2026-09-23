import { positionWorld, normalWorldGeometry, normalView, cameraViewMatrix } from 'three/tsl';
import { bindUniforms } from '@engine/render/nodes/bindings';
import { terrainNodes } from './nodes/terrain';
import * as THREE from 'three/webgpu';
import { terrainWindow } from '@builder/plan/window';
import { buildTerrainChunks, TerrainLod, TERRAIN_LOD_HYSTERESIS, type TerrainLodLevel } from '@engine/render/TerrainChunks';
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
import { bakeSplatMainData, bakeSplatExtData } from './splat';

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
let injectedBuilt: readonly string[] = [];
/**
 * 单子 Y:第二个参数是**已建成区名单**,由项目层给。
 *
 * 它以前是本文件里的 `MVP_REGIONS` 常量,于是「加一个区」除了写 plan 与
 * scenes 之外还要回来改一行 `.ts`——目标 1 的判据(「加一个区,diff 里不许
 * 出现 .ts」)当场就不成立。现在真源是 `projects/daguanyuan/scenes/` 目录:
 * **一个区有落位清单,就算建成**。往那个目录里丢一个 .json,地形窗口、
 * plan 遍历、对账门的分母同时跟着走。
 */
export function setPlan(p: GardenPlan, builtRegions: readonly string[]): void {
  if (!builtRegions.length) throw new Error('[terrain] 已建成区名单为空:projects/daguanyuan/scenes/ 里一份落位清单都没有?');
  injectedBuilt = [...builtRegions];
  Object.assign(TERRAIN,terrainWindow(p,injectedBuilt,PAD,CELL));
  injectedPlan = p;
}
/** 已建成区名单(地形窗口、plan 遍历、对账门的分母都读它)。 */
export function builtRegions(): readonly string[] {
  if (!injectedBuilt.length) throw new Error('[terrain] 已建成区名单未注入:main.ts 必须先调用 setPlan(plan, regions)');
  return injectedBuilt;
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

/* 单子 AD 曾把「已建成区名单」这份真源收进本文件的 MVP_REGIONS 常量;
 * 单子 Y 把它整个搬进数据(projects/daguanyuan/scenes/ 的目录内容),
 * 见上面 setPlan 的注释。这里不再留常量——留着就会有人去抄第二份。 */

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
 * The sampling window is derived from the injected regions at this spacing.
 * **单子 AA:这个数不许随区数变。** 它是「地面网格精度」本身,窗口一大就调粗
 * 它等于用精度换面积——spec §1.3 的目标 3(b) 就是冲着这件事来的。 */
const CELL = 0.48;

/**
 * 单子 AX1:粗档步长,以 CELL 为单位——0.48 / 0.96 / 1.92 / 3.84 m。
 * 粗档的顶点就是 L0 格点的子集(同一份顶点缓冲),所以 CELL 仍是 L0 的精度本身。
 * 切到哪一档不在这里定:按每块每档量出来的最大误差,投影 < 1 px 才切(TerrainLod)。
 */
const LOD_STEPS = [2, 4, 8] as const;
/**
 * 每档的误差预算:一格边长的 1/16(0.06 / 0.12 / 0.24 m)。超预算的粗格留在 L0,
 * 所以驳岸、台基边这种陡坎只钉住自己那几格,不把整块钉在 L0(见 lodTriangles)。
 * 它**不是切档阈值**——切档仍按每块每档量出来的误差、投影 < 1 px 现算;预算只决定
 * 粗档多早能接管:按 1600×900、FOV 62° 折算,各档最晚在 45 / 90 / 180 m 接管,
 * 也就是每一档在自己一格投影到约 16 px 时接管。边长按比例涨,预算也按比例涨。
 */
const LOD_BUDGET = (step: number): number => (CELL * step) / 16;

/**
 * splat 每个纹素多少米——**单子 AA 的核心判据**。
 *
 * 以前 splat 是写死的 1024²「一张盖全场」。窗口一大,纹素密度就跟着摊薄:
 * 实测 MVP 四区(270×218m)是 26.4 cm/texel,全 19 区(500×514m)掉到 50.2——
 * **地面纹理精度直接掉一半**,而且是必然的。渲染做得再好,区一多就被摊薄,
 * 「优化渲染引擎样式就好看」这条目标在结构上不可能达成。
 *
 * 改成固定米/纹素之后,图的边长跟着窗口走,**精度与区数无关**。
 * 0.25 m 略优于今天的 26.4 cm,所以这一改不会让现状变糊。
 */
const METRES_PER_TEXEL = 0.25;

/**
 * splat 边长:按窗口与固定纹素密度算,向上取到 64 的倍数,夹在 GPU 扛得住的范围里。
 *
 * **不取 2 的幂**:第一版取了,270m 的窗口要 1080 个纹素却给到 2048,精度白白
 * 翻倍、烘焙时间从 19.4s 涨到 29.5s——判据是「不下降」,不是「翻倍」。
 * 64 的倍数已经够对齐,NPOT 纹理在 WebGPU / WebGL2 上带 mipmap 也没问题。
 */
export function splatSizeFor(win: { width: number; depth: number }): number {
  const want = Math.max(win.width, win.depth) / METRES_PER_TEXEL;
  return Math.min(4096, Math.max(1024, Math.ceil(want / 64) * 64));
}

/** Filled by setPlan before world creation; consumers share this object. */
export const TERRAIN = {
  minX:0,maxX:0,minZ:0,maxZ:0,width:0,depth:0,segX:0,segZ:0,
  playMinX:0,playMaxX:0,playMinZ:0,playMaxZ:0,
};

/* ------------------------------------------------------------------ */
/* Splat bake                                                          */
/* ------------------------------------------------------------------ */

/** Bake world-space masks at 1024²; F removes repeated work rather than thinning this field.
 *
 *  两张图的通道打包格式与纯像素循环都在 ./splat.ts（不依赖 three，测试直接
 *  断言同输入同字节流）；这里只包 DataTexture。主 splat 四通道装满
 *  dirt/pave/sand-moss/wear，单子 T 的露土(soil)与湿痕(wet)在扩展 splat 的
 *  R/G，B/A 留空备用。 */
function splatTexture(data: Uint8Array, size = 1024): THREE.DataTexture {
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

/**
 * 单子 AX1 的自报:各档格距、全窗口三角、每块最大误差的分布,以及按参考视口
 * (1600×900、当前相机 FOV)算出来的切档距离分布。manifest 里就是这一段。
 */
function lodReport(chunks: THREE.Mesh[], FOV: number) {
  const REF_HEIGHT = 900;
  const p11 = 1 / Math.tan((FOV / 2) * Math.PI / 180);
  const quant = (a: number[]) => { const v = [...a].sort((x, y) => x - y); const q = (f: number) => v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : 0; return { min: v[0] ?? 0, median: q(0.5), p90: q(0.9), max: v[v.length - 1] ?? 0 }; };
  const round = (o: Record<string, number>, d: number) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, Number(x.toFixed(d))]));
  return {
    reference: { viewport: [1600, REF_HEIGHT], fov: FOV, maxPixels: 1, hysteresis: TERRAIN_LOD_HYSTERESIS },
    levels: [1, ...LOD_STEPS].map((step, i) => {
      const lv = chunks.map((c) => (c.userData.lod as TerrainLodLevel[]).find((l) => l.step === step)).filter((l): l is TerrainLodLevel => !!l);
      const errs = lv.map((l) => l.maxError);
      return {
        level: i, step, cell: Number((CELL * step).toFixed(2)), chunks: lv.length,
        triangles: lv.reduce((n, l) => n + l.triangles, 0),
        maxErrorM: round(quant(errs), 3),
        switchDistanceM: round(quant(errs.map((e) => e * (REF_HEIGHT / 2) * p11)), 1),
      };
    }),
  };
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
  // 单子 AA:图的边长按窗口算,不再写死 1024——精度与区数解耦(见 METRES_PER_TEXEL)。
  const splatSize = splatSizeFor(TERRAIN);
  const splat = timed('splat', () => splatTexture(bakeSplatMainData(field, TERRAIN, splatSize), splatSize));
  const splatExt = timed('splat ext', () => splatTexture(bakeSplatExtData(field, TERRAIN, splatSize), splatSize));
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
    uSplat2: { value: splatExt },
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
  const surface = nodes.terrainSurface(positionWorld.xz, positionWorld.y, normalWorldGeometry).toVar();
  mat.colorNode = surface.element(0);
  mat.roughnessNode = surface.element(2).x;
  mat.normalNode = nodes.terrainNormal(normalView, surface.element(1), cameraViewMatrix);

  const terrain = new THREE.Group();
  terrain.name = 'Terrain';
  const chunks = timed('mesh', () => buildTerrainChunks(field, TERRAIN, 64, {
    segX: TERRAIN.segX, segZ: TERRAIN.segZ, material: mat, lodSteps: LOD_STEPS, lodBudget: LOD_BUDGET,
  }));
  terrain.add(...chunks);
  for (const chunk of chunks) for (const level of (chunk.userData.lod as TerrainLodLevel[]).slice(1)) terrain.add(level.mesh);
  const lod = new TerrainLod(chunks);
  const canvas = ctx.engine.renderer.domElement;
  // 挂在 world 的 tick 上(engine.add 的 world-sys 里、player-sys 之后),读到的是这一帧的相机。
  ctx.tick(() => lod.update(ctx.camera, canvas.height));
  ctx.scene.add(terrain);
  terrain.userData.chunkCount = chunks.length;
  terrain.userData.buildTimings = timings;
  /* 单子 AA:把「地面精度」自报出来,好让门去比。
   * manifest-diff 的 --coverage 会断言:区数涨了,这两个数不许变差。
   * 不自报就只能靠人记得去量,而 §1.3 那次精度掉一半,一年都没人发现。 */
  terrain.userData.resolution = {
    cell: CELL,
    cmPerTexel: (Math.max(TERRAIN.width, TERRAIN.depth) / splatSize) * 100,
    splatSize,
    window: [TERRAIN.width, TERRAIN.depth],
    vertices: TERRAIN.segX * TERRAIN.segZ,
    chunks: chunks.length,
    lod: lodReport(chunks, ctx.camera.fov),
  };

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
