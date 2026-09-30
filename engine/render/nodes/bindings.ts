import { uniform, texture } from 'three/tsl';
import type { IUniform, Texture } from 'three';

/** Bind legacy CPU environment cells to typed nodes; mutable clocks stay shared. */
export function bindUniforms<T extends Record<string, IUniform>>(cells: T): Record<string, any> {
  return Object.fromEntries(Object.entries(cells).map(([name, cell]) => [name,
    (cell.value as Texture)?.isTexture ? texture(cell.value as Texture) :
      uniform(cell.value).onFrameUpdate(() => cell.value),
  ]));
}
