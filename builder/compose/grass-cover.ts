/**
 * 草被疏密场 —— 单子 T 的共享真源。
 *
 * 「草稀处」(vegetation.ts 的 grassDensity) 与「露土处」(terrain-from-plan.ts
 * 的 masks.soil) 必须是同一片地：草一稀，地表同步透土，否则低头看是秃草、
 * 地上却画着满绿（或反过来）。两边都调本模块的同一份实现，逐点对齐由
 * tests/terrain-index.test.mjs 断言。
 *
 * 核对结论：底层 fbm2/Simplex 是纯函数，不含 rng；种子沿用 vegetation.ts
 * 原 `clump` 的 `seed ^ 0x0c10ff`，频率与偏移逐字保留——草散布的每一点
 * 密度与抽取前完全相同，这次抽取不改变草分布。
 */

import { Simplex, fbm2, smoothstep, lerp } from '@engine/core/Noise';

export interface GrassCoverField {
  /** 中频团块系数，0.68..1.30。 */
  patch(x: number, z: number): number;
  /** 低频洼地裸值，约 0..1；越小草越稀。 */
  gapN(x: number, z: number): number;
  /** 密度档，0.28..1。 */
  gap(x: number, z: number): number;
}

/**
 * 露土阈值：gapN 降到 SOIL_GAP_FULL 以下土面全透，升到 SOIL_GAP_NONE 以上不露。
 * 与密度档的对应关系：gapN ≤ 0.34 时 gap 已到下限 0.28（最稀），此处
 * bareSoilAmount ≥ 0.84——草最稀的地方土几乎全露。
 */
export const SOIL_GAP_FULL = 0.3;
export const SOIL_GAP_NONE = 0.46;

/** 露土量 0..1，只由 gapN 决定；能否生效（是否兜底草皮）由 masks 侧判断。 */
export function bareSoilAmount(gapN: number): number {
  return smoothstep(SOIL_GAP_NONE, SOIL_GAP_FULL, gapN);
}

export function makeGrassCoverField(seed: number): GrassCoverField {
  // 与 vegetation.ts 其余植物共用的 clump 同一个种子；Simplex 无状态，
  // 同种子逐点同值，grassDensity 换调本实现后分布不变。
  const clump = new Simplex(seed ^ 0x0c10ff);
  const patch = (x: number, z: number): number =>
    0.68 + (fbm2(clump, x * 0.13, z * 0.13, 3) * 0.5 + 0.5) * 0.62;
  // 低频斑块(PQ-5d):一汪一汪地稀下去,草稀处地表自然露出。下限 0.28:
  // 再低正门前景一类的大片留白会秃成土场,0.28 保住「薄草见土」的读法。
  const gapN = (x: number, z: number): number =>
    fbm2(clump, x * 0.023 + 53, z * 0.023 + 17, 2) * 0.5 + 0.5;
  const gap = (x: number, z: number): number =>
    lerp(0.28, 1.0, smoothstep(0.34, 0.52, gapN(x, z)));
  return { patch, gapN, gap };
}
