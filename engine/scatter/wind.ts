import * as THREE from 'three';

/**
 * Writes the per-instance wind phase/amplitude buffer (`aWind`) that the
 * foliage shaders (see `builder/parts/zhiwu/foliage-materials.ts`) read to
 * offset each instance's sway so nothing sways in lockstep.
 */
export function applyWind(geo: THREE.BufferGeometry, count: number, rng: () => number, strength = 1): void {
  const wind = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    wind[i * 2] = rng() * Math.PI * 2 * 3.7;
    wind[i * 2 + 1] = strength * (0.55 + rng() * 0.9);
  }
  geo.setAttribute('aWind', new THREE.InstancedBufferAttribute(wind, 2));
}
