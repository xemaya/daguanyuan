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

/** Maximum world-space offset for the shared foliage shader, at windStrength=1. */
export function instanceWindPadding(mesh: THREE.InstancedMesh): number {
  const flex=mesh.geometry.getAttribute('aFlex'),wind=mesh.geometry.getAttribute('aWind');
  if(!flex||!wind)return 0;
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  const scale=Math.max(0,...materials.map(m=>Number(m.userData.windScale??0)));
  let compliance=0,multiplier=0;
  for(let i=0;i<flex.count;i++)compliance=Math.max(compliance,Math.abs(flex.getX(i)));
  for(let i=0;i<wind.count;i++)multiplier=Math.max(multiplier,Math.abs(wind.getY(i)));
  // |gust| and |flutter| <= 1; side amplitude=.26 and vertical <= .17+.09.
  return scale*compliance*multiplier*Math.hypot(1,.26,.26)+.01;
}
