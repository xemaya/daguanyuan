import type { IUniform } from 'three';
import { positionWorld, cameraPosition, screenCoordinate } from 'three/tsl';
import { bindUniforms } from './nodes/bindings';
import { skyNodes } from './nodes/sky';
import * as THREE from 'three/webgpu';

/**
 * SkyShader — the analytic sky dome used by `Atmosphere`.
 *
 * The gradient is not a straight lerp: real sky radiance rises steeply in the
 * last few degrees above the horizon, so the dome mixes a broad zenith->horizon
 * ramp with a tight, brighter haze band and a Mie forward-scatter lobe around
 * the sun. That combination is what stops a stylised sky from reading as a
 * two-stop Photoshop gradient.
 *
 * Everything is authored in the renderer's linear working space and left in
 * HDR — the sun disc deliberately exceeds 1.0 so PostFX's bloom threshold
 * (1.02) catches it and nothing else.
 */

export interface SkyUniforms {
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uHaze: { value: THREE.Color };
  uNadir: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uIntensity: { value: number };
  uSunDiscSize: { value: number };
  uSunDiscGain: { value: number };
  uHaloGain: { value: number };
  uDither: { value: number };
  [k: string]: IUniform;
}

export interface SkyPalette {
  zenith: number;
  horizon: number;
  haze: number;
  nadir: number;
  sun: number;
}

export const SKY_PALETTE: SkyPalette = {
  zenith: 0x3f7fd6,
  horizon: 0xbfe0f2,
  // A hair warmer and brighter than the horizon swatch — this is the thin
  // band of near-white air that sits right on the sea line.
  haze: 0xd7ebfb,
  // Below the horizon line: the water/land haze the dome falls away to, so a
  // gap between terrain and dome never shows as a hard seam.
  nadir: 0x9fc3dc,
  sun: 0xfff3d6,
};

export function createSkyUniforms(palette: SkyPalette = SKY_PALETTE): SkyUniforms {
  return {
    uZenith: { value: new THREE.Color(palette.zenith) },
    uHorizon: { value: new THREE.Color(palette.horizon) },
    uHaze: { value: new THREE.Color(palette.haze) },
    uNadir: { value: new THREE.Color(palette.nadir) },
    uSunDir: { value: new THREE.Vector3(0.53, 0.62, 0.59).normalize() },
    uSunColor: { value: new THREE.Color(palette.sun) },
    uIntensity: { value: 1.0 },
    uSunDiscSize: { value: 0.0165 },
    uSunDiscGain: { value: 7.0 },
    uHaloGain: { value: 1.0 },
    uDither: { value: 1.0 },
  };
}

export function createSkyMaterial(uniforms: SkyUniforms): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  mat.colorNode = skyNodes(bindUniforms(uniforms)).skyColor(positionWorld.sub(cameraPosition), screenCoordinate.xy).rgb;
  mat.name = 'SkyDome';
  return mat;
}
