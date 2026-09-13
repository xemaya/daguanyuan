import { restWorldPosition, worldOffsetToLocal } from './position';
import { diffuseContribution } from 'three/src/nodes/core/PropertyNode.js';
import { MeshStandardNodeMaterial, PhysicalLightingModel } from 'three/webgpu';
import { attribute, varying, Fn, vec3, vec4, normalView, normalWorld, cameraViewMatrix, positionViewDirection, diffuseColor,  mix, uniform, texture, positionLocal, modelWorldMatrix, modelWorldMatrixInverse, uv, varyingProperty } from 'three/tsl';
import type { LightingModelDirectInput } from 'three/src/nodes/core/LightingModel.js';
import type Node from 'three/src/nodes/core/Node.js';
import type NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import { windNodes } from './wind';

/** r185 applies instanceMatrix BEFORE positionNode. Inputs here are model-local,
 * already instanced; only model matrix maps them into world and back. */
export function foliagePosition(bindings: ReturnType<typeof import('./bindings').bindUniforms>, rest: ReturnType<typeof varyingProperty<'vec3'>>) {
  return Fn(() => {
    const world = restWorldPosition().toVar();
    rest.assign(world);
    const wind = windNodes(bindings).foliageWind(world, attribute<'vec2'>('aFlex','vec2').x, attribute<'vec2'>('aWind','vec2').x, attribute<'vec2'>('aWind','vec2').y.add(0.35));
    return positionLocal.add(worldOffsetToLocal(wind));
  })();
}

/** Wrapped diffuse/transmission remain in direct-light evaluation, so lightColor
 * carries shadow attenuation. Standard physical specular stays unchanged. */
class FoliageLighting extends PhysicalLightingModel {
  bindings: ReturnType<typeof import('./bindings').bindUniforms>;
  constructor(bindings: ReturnType<typeof import('./bindings').bindUniforms>) { super(); this.bindings = bindings; }
  direct(input: LightingModelDirectInput, builder: NodeBuilder): void {
    super.direct(input, builder);
    const { reflectedLight } = input;
    const lightDirection = vec3(input.lightDirection as Node<'vec3'>);
    const lightColor = vec3(input.lightColor as Node<'vec3'>);
    const u = this.bindings;
    const nl = normalView.dot(lightDirection);
    const wrapped = nl.add(u.uWrap).div(u.uWrap.add(1)).saturate();
    const tint = mix(u.uWrapTint, vec3(1), nl.saturate());
    // Replace only the Lambert contribution added by super.direct.
    vec3(reflectedLight.directDiffuse as Node<'vec3'>).addAssign(lightColor.mul(wrapped.mul(tint).sub(nl.saturate())).mul(diffuseContribution).mul(1/Math.PI));
    const transLight = lightDirection.add(normalView.mul(u.uTransDistort)).normalize();
    const back = positionViewDirection.dot(transLight.negate()).saturate().pow(u.uTransPower);
    const thick = varying(attribute<'vec2'>('aFlex', 'vec2').y).pow(2);
    vec3(reflectedLight.directDiffuse as Node<'vec3'>).addAssign(lightColor.mul(u.uTransColor).mul(back).mul(u.uTransStrength).mul(thick).mul(diffuseContribution));
  }
}

export class FoliageNodeMaterial extends MeshStandardNodeMaterial {
  foliageBindings!: ReturnType<typeof import('./bindings').bindUniforms>;
  setupLightingModel(): PhysicalLightingModel { return new FoliageLighting(this.foliageBindings); }
}
