import * as THREE from 'three';

/**
 * 构件登记表。
 *
 * 每个中式构件模块 export 一个 build 函数并在这里登记,棚拍台
 * (`/viewer.html?subject=<name>`) 与 `tools/shoot-part.mjs` 按名字取件。
 * 构件必须以米为单位、原点落在地面中心、+Z 朝正面(观者方向)。
 */
export interface PartBuild {
  /** 构件根节点。 */
  root: THREE.Object3D;
  /** 可选每帧更新(风、水)。 */
  update?: (dt: number, elapsed: number) => void;
  /** 棚拍时地面圆盘半径,默认按包围盒。 */
  groundRadius?: number;
}

export type PartBuilder = (variant: string) => PartBuild;

const PARTS = new Map<string, PartBuilder>();

export function registerPart(name: string, builder: PartBuilder): void {
  PARTS.set(name, builder);
}

export function buildPart(name: string, variant = 'default'): PartBuild | null {
  const b = PARTS.get(name);
  return b ? b(variant) : null;
}

export function partNames(): string[] {
  return [...PARTS.keys()].sort();
}
