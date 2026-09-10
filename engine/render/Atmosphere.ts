import * as THREE from 'three';
import type { GameContext } from '@engine/core/Context';
import { createSkyMaterial, createSkyUniforms, SKY_PALETTE } from './SkyShader';
import { buildCloudLayer } from './Clouds';
import { RollingShadow } from './RollingShadow';

/**
 * Atmosphere — sky, clouds, light rig, environment map and fog.
 *
 * This module owns every light in the game (ART_DIRECTION §4). The rig is
 * deliberately tiny: one shadow-casting key, one hemisphere fill, one bounce
 * fake. Everything else that makes surfaces look expensive comes from the
 * PMREM environment generated out of this same sky shader, so the ambient
 * specular and the visible sky can never disagree.
 *
 * The single most important number here is the shadow ortho frustum. It is
 * computed from a viewer-local box and snapped in light space. Its resolution
 * stays local as the garden grows, while the texel grid remains stable under
 * camera motion. RollingShadow owns that transform.
 */

/** Late-morning sun, ~9:30. Elevation and azimuth per the art bible. */
const SUN_ELEVATION = THREE.MathUtils.degToRad(38);
/** Measured from due south (+Z) rotating toward east (+X). */
const SUN_AZIMUTH = THREE.MathUtils.degToRad(42);

/** Distance from the play-area centre to the virtual sun. */
const SUN_DISTANCE = 95;

/** Radius of the sky dome. Comfortably inside the camera far plane (600). */
const SKY_RADIUS = 460;

/**
 * Master brightness for the sky, in linear working space.
 *
 * Tuned by measuring the graded frame, not by taste: PostFX's ACES curve
 * compresses hard (linear 1.0 lands near 0.62), so the palette swatches have to
 * be pushed above 1.0 to come back out as themselves. At this value the zenith
 * and horizon land on `#3f7fd6` / `#bfe0f2` after the full chain, and only the
 * sun disc and the brightest cloud crowns cross the 1.02 bloom threshold.
 */
const SKY_INTENSITY = 1.55;

export function buildAtmosphere(ctx: GameContext): void {
  const { scene, stage, engine, env } = ctx;

  /* ---------------------------------------------------------------- */
  /* Sun geometry                                                      */
  /* ---------------------------------------------------------------- */

  const cosEl = Math.cos(SUN_ELEVATION);
  // Direction pointing *at* the sun from the world origin.
  const toSun = new THREE.Vector3(
    Math.sin(SUN_AZIMUTH) * cosEl,
    Math.sin(SUN_ELEVATION),
    Math.cos(SUN_AZIMUTH) * cosEl,
  ).normalize();

  const sunColor = new THREE.Color(SKY_PALETTE.sun);
  const skyColor = new THREE.Color(SKY_PALETTE.zenith);
  const horizonColor = new THREE.Color(SKY_PALETTE.horizon);
  const hazeColor = new THREE.Color(SKY_PALETTE.haze);
  const groundColor = new THREE.Color(0x6b8f4e);

  // Publish before anything else builds so vegetation, water and props can all
  // match the same sun.
  env.timeOfDay = 9.4;
  env.sunDirection.copy(toSun).multiplyScalar(-1); // from sun toward origin
  env.sunColor.copy(sunColor);
  env.skyColor.copy(skyColor);
  env.groundColor.copy(groundColor);

  /* ---------------------------------------------------------------- */
  /* Sky dome                                                          */
  /* ---------------------------------------------------------------- */

  const skyUniforms = createSkyUniforms(SKY_PALETTE);
  skyUniforms.uSunDir.value.copy(toSun);
  skyUniforms.uIntensity.value = SKY_INTENSITY;

  const skyMat = createSkyMaterial(skyUniforms);
  // Icosahedron rather than a UV sphere: no pole pinch, no seam, and an even
  // triangle distribution means the interpolated view ray is uniformly
  // accurate all the way round.
  const skyGeo = new THREE.IcosahedronGeometry(SKY_RADIUS, 4);
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.name = 'SkyDome';
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -1000;
  skyDome.castShadow = false;
  skyDome.receiveShadow = false;
  scene.add(skyDome);

  /* ---------------------------------------------------------------- */
  /* Clouds                                                            */
  /* ---------------------------------------------------------------- */

  const clouds = buildCloudLayer({
    seed: ctx.seed,
    count: 27,
    // Clouds dissolve into the same colour the dome shows at the horizon, so
    // the two layers share one horizon line.
    hazeColor: hazeColor.clone().multiplyScalar(SKY_INTENSITY * 0.95),
    exposure: SKY_INTENSITY * 1.06,
  });
  scene.add(clouds.group);

  /* ---------------------------------------------------------------- */
  /* Light rig                                                         */
  /* ---------------------------------------------------------------- */

  const centre = ctx.camera.position.clone();

  const key = new THREE.DirectionalLight(sunColor.getHex(), 3.2);
  key.name = 'SunKey';
  key.position.copy(centre).addScaledVector(toSun, SUN_DISTANCE);
  key.target.position.copy(centre);
  key.castShadow = true;
  scene.add(key);
  scene.add(key.target);

  const shadowSize = engine.quality.shadowMapSize;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  const rollingShadow = new RollingShadow(key, toSun);
  rollingShadow.update(centre, shadowSize);

  // Keep the offset in centimetres: the local PCF map resolves roof edges and
  // thin walls without lifting their contact shadows away from the surface.
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.022;
  key.shadow.radius = 2.0;
  key.shadow.blurSamples = 12;
  key.shadow.intensity = 1.0;

  // Sky fill. This is the core of the Animal Crossing read: shadows go blue
  // above and green below rather than grey.
  const fill = new THREE.HemisphereLight(0x8ec5f0, 0x6b8f4e, 0.9);
  fill.name = 'SkyFill';
  fill.position.set(0, 30, 0);
  scene.add(fill);

  // Ground bounce. Opposite the sun in azimuth and below the horizon so it
  // only reaches undersides — eaves, canopy interiors, the lip of the porch.
  const bounceDir = new THREE.Vector3(-toSun.x, -0.52, -toSun.z).normalize();
  const bounce = new THREE.DirectionalLight(0xffd9a8, 0.25);
  bounce.name = 'GroundBounce';
  bounce.position.copy(centre).addScaledVector(bounceDir, 60);
  bounce.target.position.copy(centre);
  bounce.castShadow = false;
  scene.add(bounce);
  scene.add(bounce.target);

  /* ---------------------------------------------------------------- */
  /* Environment map                                                   */
  /* ---------------------------------------------------------------- */

  buildEnvironment(ctx, skyUniforms);
  stage.environmentIntensity = 0.75;

  /* ---------------------------------------------------------------- */
  /* Fog                                                               */
  /* ---------------------------------------------------------------- */

  // Exponential-squared so the near and mid ground stay completely clear and
  // only the far treeline and the sea pick up the blue. Tuned against the
  // dome's own horizon radiance so distant geometry dissolves into the sky
  // instead of silhouetting against it.
  const fogColor = horizonColor.clone().lerp(hazeColor, 0.18).multiplyScalar(SKY_INTENSITY * 0.84);
  const fog = new THREE.FogExp2(0xffffff, 0.0031);
  fog.color.copy(fogColor);
  stage.fog = fog;

  /* ---------------------------------------------------------------- */
  /* Per-frame                                                         */
  /* ---------------------------------------------------------------- */

  const camPos = new THREE.Vector3();
  ctx.tick(() => {
    // The dome rides with the camera so the horizon never parallaxes and the
    // player can never walk far enough to see its far side.
    ctx.camera.getWorldPosition(camPos);
    skyDome.position.copy(camPos);
    rollingShadow.update(camPos, engine.quality.shadowMapSize);

    clouds.update(env.windTime.value);
  });
}

/* ------------------------------------------------------------------ */
/* PMREM environment                                                   */
/* ------------------------------------------------------------------ */

/**
 * Renders the sky shader into a cube and pre-filters it into a PMREM. Without
 * this every MeshStandardMaterial in the town falls back to a flat ambient
 * term and metal reads as grey plastic (ART_DIRECTION §5).
 */
function buildEnvironment(ctx: GameContext, skyUniforms: ReturnType<typeof createSkyUniforms>): void {
  const renderer = ctx.engine.renderer;

  const envScene = new THREE.Scene();
  const envMat = createSkyMaterial(skyUniforms);
  // Inside a tiny sphere at the origin the interpolated view ray is exactly
  // the vertex direction, so the cube camera sees the identical sky.
  const envMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(12, 4), envMat);
  envMesh.frustumCulled = false;
  envScene.add(envMesh);

  const pmrem = new THREE.PMREMGenerator(renderer);
  // A touch of blur folds the small sun disc into a broad, soft specular
  // highlight rather than a pinprick that aliases on curved surfaces.
  const target = pmrem.fromScene(envScene, 0.035, 0.5, 60);
  ctx.stage.environment = target.texture;

  pmrem.dispose();
  envMesh.geometry.dispose();
  envMat.dispose();
}
