import * as THREE from 'three';
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
 * The material is a MeshStandardMaterial patched through `onBeforeCompile` to
 * do a four-way height-aware splat blend (turf / dirt / cobble / sand). Going
 * through Standard rather than a raw ShaderMaterial keeps VSM shadows, the
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

/** Bake world-space masks at 1024²; F removes repeated work rather than thinning this field. */
function bakeSplat(field: Field, size = 1024): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = TERRAIN.minZ + ((j + 0.5) / size) * TERRAIN.depth;
    for (let i = 0; i < size; i++) {
      const x = TERRAIN.minX + ((i + 0.5) / size) * TERRAIN.width;
      const m = field.masks(x, z);
      const o = (j * size + i) * 4;
      data[o] = m.dirt * 255;
      data[o + 1] = m.cobble * 255;
      data[o + 2] = m.sand * 255;
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

const TERRAIN_FRAG_DECL = /* glsl */ `
varying vec2 vTerXZ;
varying float vTerH;
varying vec3 vTerN;
uniform sampler2D uSplat;
uniform sampler2D uWarp;
uniform sampler2D uTurfMap;
uniform sampler2D uDirtMap;
uniform sampler2D uCobMap;
uniform sampler2D uSandMap;
uniform sampler2D uNrmTD;
uniform sampler2D uNrmCS;
uniform sampler2D uRough4;
uniform vec4 uExtent;
uniform float uNormalStrength;
vec3 gAlbedo;
vec3 gNrm;
float gRough;
// Packed normals keep XY only; Z comes back from the unit-length constraint.
vec3 decodeN( vec2 xy, float k ) {
  vec2 n = xy * 2.0 - 1.0;
  float z = sqrt( max( 1.0 - dot( n, n ), 0.0 ) );
  return vec3( n * k, z );
}
`;

const TERRAIN_BLEND = /* glsl */ `
{
  vec2 tXZ = vTerXZ;
  const vec3 LUM = vec3( 0.2126, 0.7152, 0.0722 );

  // ---- world-scale variation --------------------------------------------
  // One 256px noise sampled at four scales. Each macro term averages two
  // *different* channels at two *different* periods: a single repeating
  // texture driving a visible brightness field prints its own tiling grid
  // across the whole map, which is exactly the failure this system exists to
  // prevent. Averaging two incommensurate periods pushes the beat far beyond
  // the size of the island.
  vec4 w0 = texture2D( uWarp, tXZ * 0.014170 );                        // ~70.6 m
  vec4 wM = texture2D( uWarp, tXZ * 0.031300 + vec2( 0.71, 0.19 ) );   // ~31.9 m
  vec4 w1 = texture2D( uWarp, tXZ * 0.073700 + vec2( 0.37, 0.61 ) );   // ~13.6 m
  vec4 w2 = texture2D( uWarp, tXZ * 0.830000 + vec2( 0.13, 0.77 ) );   // ~1.2 m
  vec4 w3 = texture2D( uWarp, tXZ * 3.970000 + vec2( 0.53, 0.29 ) );   // ~0.25 m
  // The baked noise is now authored to fill the byte range (see
  // terrainWarpTexture), so these remaps are near pass-throughs that only clip
  // the tails. They used to squeeze a 6%-wide field, which is why 60 m of lawn
  // came out one flat tone.
  float macroA = smoothstep( 0.12, 0.88, w0.b );
  float macroM = smoothstep( 0.14, 0.86, wM.b * 0.55 + w1.a * 0.45 );
  float macroB = smoothstep( 0.14, 0.86, w1.b * 0.55 + wM.a * 0.45 );
  float cloud  = smoothstep( 0.16, 0.84, w0.a * 0.50 + w1.a * 0.50 );

  // The high-frequency terms are what turn the splat's bilinear ramps into a
  // ragged, finger-y boundary. Without them the path edge reads as a contour
  // line no matter how much noise went into the bake. The 25 cm term matters
  // most: without a sub-decimetre jitter the boundary snaps to the texel grid
  // and walks as a visible staircase of blocks. It mips away with distance,
  // which is exactly right — there is nothing to break up once a texel is
  // subpixel.
  vec2 warpOff = ( w0.rg - 0.5 ) * 1.35 + ( wM.rg - 0.5 ) * 0.72
               + ( w1.rg - 0.5 ) * 0.58 + ( w2.rg - 0.5 ) * 0.44
               + ( w3.rg - 0.5 ) * 0.14;

  // ---- splat lookup ------------------------------------------------------
  vec2 sUv = ( tXZ + warpOff - uExtent.xy ) / uExtent.zw;
  vec4 sp = texture2D( uSplat, clamp( sUv, vec2( 0.0015 ), vec2( 0.9985 ) ) );
  // How far into the middle of the track we are. 1 along the centreline,
  // falling away through the shoulders — the profile of where feet actually go.
  float centre = smoothstep( 0.42, 0.95, sp.r );

  // ---- detail UVs. Two turf scales + per-layer warp kills the tile grid --
  vec2 uvTa = ( tXZ + warpOff * 0.30 ) * 0.6300;
  vec2 uvTb = vec2( tXZ.x * 0.8660 - tXZ.y * 0.5000,
                    tXZ.x * 0.5000 + tXZ.y * 0.8660 ) * 0.2070 + vec2( 2.7, 5.1 );
  // The dirt is the one layer that runs as a long thin ribbon through the
  // frame, so its tile period is on screen at every distance at once. Scaling
  // its UVs by a 32m noise means the grain size itself drifts along the track:
  // there is no single period left for the eye to lock onto.
  float dScale = 0.7900 + macroM * 0.4400;
  vec2 uvD  = ( tXZ + warpOff * 0.62 ) * dScale;
  vec2 uvC  = ( tXZ + warpOff * 0.14 ) * 0.5150 + vec2( 0.15, 0.42 );
  vec2 uvS  = ( tXZ + warpOff * 0.34 ) * 0.6400;

  float turfMix = clamp( 0.22 + cloud * 0.58, 0.0, 1.0 );

  vec3 aT = mix( texture2D( uTurfMap, uvTa ).rgb, texture2D( uTurfMap, uvTb ).rgb, turfMix );
  vec2 uvD2 = vec2( tXZ.x * 0.9397 + tXZ.y * 0.3420,
                   -tXZ.x * 0.3420 + tXZ.y * 0.9397 ) * 0.3170 + vec2( 4.1, 8.7 );
  vec3 aD = mix( texture2D( uDirtMap, uvD ).rgb, texture2D( uDirtMap, uvD2 ).rgb, turfMix );
  vec3 aC = texture2D( uCobMap,  uvC ).rgb;
  // Sand gets the same two-scale treatment as turf: a beach is a large,
  // uninterrupted expanse and a single tile shows its wavelength instantly.
  vec2 uvS2 = vec2( tXZ.x * 0.6428 + tXZ.y * 0.7660,
                   -tXZ.x * 0.7660 + tXZ.y * 0.6428 ) * 0.2110 + vec2( 6.3, 1.9 );
  vec3 aS = mix( texture2D( uSandMap, uvS ).rgb, texture2D( uSandMap, uvS2 ).rgb, turfMix );

  // The shared dirt and cobble maps are authored for props seen at arm's
  // length, where high grit contrast reads well. Spread over a whole path
  // they turn to confetti, so roll the highlights off and warm them before
  // they enter the blend. Turf loses a little saturation for the same reason:
  // a whole field of it at full chroma reads as astroturf.
  // Feet wear a track smooth up the middle and sweep the loose grit out to the
  // shoulders, so the gravel contrast is pulled down by the centre weight. The
  // flat term is the same texture read 12x magnified — its own low-frequency
  // content, i.e. a smooth compacted-soil colour, for one fetch and no constants.
  vec3 aDflat = texture2D( uDirtMap, uvD * 0.0820 + vec2( 0.31, 0.67 ) ).rgb;
  aD = mix( aD, aDflat, centre * 0.40 );

  float dl = dot( aD, LUM );
  aD *= mix( 1.0, 0.80, smoothstep( 0.20, 0.55, dl ) );
  // Chroma, not just value. Half the track is in tree shade, lit only by a blue
  // sky, and a low-chroma brown under a blue fill is grey — the south approach
  // was reading as tarmac. Bare earth has to carry enough saturation to still be
  // earth-coloured when the sun is off it.
  aD  = mix( vec3( dot( aD, LUM ) ), aD, 0.90 );
  aD  = ( aD * 0.90 + 0.050 ) * vec3( 1.26, 0.99, 0.68 );

  // Cobble ships a cool quarried grey; the bible's stone is warm (#b8b3a8),
  // and a cold forecourt in a warm town reads as a puddle from 20 m away.
  // Cobble: neutralise, then lift the mortar and compress the range before
  // tinting warm. Deep mortar joints under a blue sky fill turn a forecourt
  // into a slate roof lying on the ground; sun-bleached stone needs its
  // blacks raised, not its highlights lowered.
  aC  = mix( vec3( dot( aC, LUM ) ), aC, 0.50 );
  aC  = aC * 0.78 + 0.115;
  aC *= vec3( 1.32, 1.12, 0.74 );
  // Per-stone warm/cool jitter so the forecourt is laid, not printed.
  aC *= mix( vec3( 0.93, 0.96, 1.00 ), vec3( 1.09, 1.02, 0.88 ), macroB );

  aT  = mix( vec3( dot( aT, LUM ) ), aT, 0.84 ) * vec3( 1.07, 1.00, 0.84 );
  aS  = mix( vec3( dot( aS, LUM ) ), aS, 0.94 ) * vec3( 1.22, 1.05, 0.72 );

  // ---- height-aware blend ----------------------------------------------
  // Linear lerping four surfaces gives a soapy dissolve. Biasing each weight
  // by the layer's own luminance (a good proxy for surface height in all four
  // of these maps) makes pebbles poke through grass and grass fill the mortar
  // joints, which is what sells the transition.
  vec4 wgt = vec4( clamp( 1.0 - sp.r - sp.g - sp.b, 0.0, 1.0 ), sp.r, sp.g, sp.b );
  vec4 hgt = vec4( dot( aT, LUM ), dot( aD, LUM ), dot( aC, LUM ), dot( aS, LUM ) );
  vec4 bias = wgt + hgt * 0.52;
  float peak = max( max( bias.x, bias.y ), max( bias.z, bias.w ) ) - 0.21;
  // The gate was 0.035 wide. On a splat that is metres-per-texel-ish that is a
  // hard contour, and a hard contour on a bilinear ramp is a staircase: the
  // grass/dirt boundary showed as a row of dark texel-sized blocks close up.
  // 0.10 keeps the height blend crisp enough for pebbles to poke through turf
  // while giving the ramp somewhere to live.
  vec4 bl = max( bias - peak, 0.0 ) * smoothstep( 0.0, 0.10, wgt );
  bl /= max( bl.x + bl.y + bl.z + bl.w, 1e-4 );

  vec3 albedo = aT * bl.x + aD * bl.y + aC * bl.z + aS * bl.w;

  vec3 nrm =
      decodeN( texture2D( uNrmTD, uvTa ).rg, 1.32 ) * bl.x +
      decodeN( texture2D( uNrmTD, uvD  ).ba, 0.62 * ( 1.0 - centre * 0.38 ) ) * bl.y +
      decodeN( texture2D( uNrmCS, uvC  ).rg, 1.00 ) * bl.z +
      decodeN( texture2D( uNrmCS, uvS  ).ba, 0.58 ) * bl.w;

  float rgh =
      texture2D( uRough4, uvTa ).r * bl.x +
      texture2D( uRough4, uvD  ).g * bl.y +
      texture2D( uRough4, uvC  ).b * bl.z +
      texture2D( uRough4, uvS  ).a * bl.w;

  // ---- macro colour ------------------------------------------------------
  // Four independent scales of hue and value drift. This is the single most
  // important thing keeping a broad field of one texture from reading as one
  // texture: the eye finds the repeat in the *colour* long before the detail.
  float band = macroA * 0.50 + macroM * 0.34 + macroB * 0.16;
  vec3 sunTint  = vec3( 1.215, 1.100, 0.700 );  // sun-bleached, yellow-green
  vec3 lushTint = vec3( 0.735, 0.955, 0.800 );  // shaded, blue-green
  vec3 tint = mix( lushTint, sunTint, smoothstep( 0.16, 0.84, band ) );
  albedo *= mix( vec3( 1.0 ), tint, bl.x * 0.94 + 0.06 );

  // P1 Task 6: the old "different green under the treeline" term keyed off
  // absolute |x|/z distance from the map centre (tuned to the old 64m town's
  // fixed treeline at x≈±30). At this window's scale (280×226m, MVP-region
  // centred rather than origin-centred) that constant would tint nearly the
  // whole map as "shaded", so it is disabled rather than reworked — there is
  // no equivalent fixed treeline geometry to key off yet.
  float edge = 0.0;
  albedo *= mix( vec3( 1.0 ), vec3( 0.855, 0.965, 0.895 ), edge * bl.x * 0.8 );

  // Patchy mown-lawn value break-up, three scales stacked. Sun-bleached crowns
  // against damp hollows; the macro channels behind these now carry real
  // variance, so the swing here is visible from the far end of the town.
  albedo *= 0.875 + macroB * 0.265;
  albedo *= 0.895 + macroM * 0.215;
  albedo *= 0.855 + sp.a  * 0.275;

  // Banks and cut slopes wear through to bare earth at the top of the fall.
  float slope = clamp( ( 1.0 - vTerN.y ) * 5.2, 0.0, 1.0 );
  albedo = mix( albedo, albedo * vec3( 1.06, 0.90, 0.72 ), slope * bl.x * 0.55 );

  // Hollows hold water: the turf goes deeper and cooler where the ground dips.
  float damp = smoothstep( 0.40, 0.05, vTerH ) * bl.x * ( 0.30 + macroM * 0.95 );
  albedo *= mix( vec3( 1.0 ), vec3( 0.745, 0.885, 0.785 ), clamp( damp, 0.0, 1.0 ) * 0.62 );

  // ---- shoreline damp band ---------------------------------------------
  // Tight around the waterline: a wide gradient turns the whole beach grey.
  float wet = smoothstep( 0.13, -0.09, vTerH );
  float sandy = bl.w + bl.y * 0.22;
  albedo *= mix( vec3( 1.0 ), vec3( 0.50, 0.49, 0.53 ), wet * sandy );
  rgh = mix( rgh, 0.13, wet * sandy * 0.92 );

  gAlbedo = albedo;
  gRough  = clamp( rgh, 0.06, 1.0 );
  gNrm    = nrm;
}
diffuseColor.rgb *= gAlbedo;
`;

const TERRAIN_NORMAL = /* glsl */ `
{
  // The detail UVs run along world +X and +Z, so the tangent frame is those
  // two axes brought into view space and re-orthogonalised against the
  // interpolated surface normal. No derivatives, no seams on the shore slope.
  vec3 T = ( viewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz;
  vec3 B = ( viewMatrix * vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz;
  T = normalize( T - normal * dot( normal, T ) );
  B = normalize( B - normal * dot( normal, B ) - T * dot( T, B ) );
  vec3 mn = gNrm;
  mn.xy *= uNormalStrength;
  normal = normalize( T * mn.x + B * mn.y + normal * max( mn.z, 0.15 ) );
}
`;

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

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
  const mat = new THREE.MeshStandardMaterial({
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

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vTerXZ;\nvarying float vTerH;\nvarying vec3 vTerN;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvTerN = normalize( mat3( modelMatrix ) * objectNormal );',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n{ vec4 terWp = modelMatrix * vec4( transformed, 1.0 ); vTerXZ = terWp.xz; vTerH = terWp.y; }',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_FRAG_DECL)
      .replace('#include <map_fragment>', TERRAIN_BLEND)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gRough;')
      .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL);
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v3';

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
