import { positionLocal, modelWorldMatrix, modelWorldMatrixInverse, vec4 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

/** r185 positionNode sees model-local coordinates AFTER instance transforms.
 * Instance matrices must never be applied again. Use w=0 for world offsets so
 * translations cannot enter a wind vector; the inverse also cancels root yaw. */
export const restWorldPosition = () => modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
export const worldOffsetToLocal = (offset: Node<'vec3'>) => modelWorldMatrixInverse.mul(vec4(offset, 0)).xyz;
