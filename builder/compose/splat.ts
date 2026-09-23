/**
 * Splat 烘焙 —— 把解析场 masks(x, z) 烘成 1024² 字节图的纯函数部分。
 *
 * 从 terrain.ts 搬出（原 bakeSplat 的像素循环逐字保留），不 import three，
 * 这样测试可以在 node 里直接断言烘焙确定性（同输入同字节流）。
 * DataTexture 的包装仍在 terrain.ts。
 *
 * 两张图（主 splat 四通道已满，单子 T 的露土/湿痕装第二张）：
 *
 *   主 splat（0.5 是分档线）：
 *     R dirt ｜ G <0.5=石子漫(cobble)×2、≥0.5=石板(slab)×2−1 ｜
 *     B <0.5=浅滩沙×2、≥0.5=苔(moss)×2−1 ｜ A wear
 *   G 里 cobble 与 slab 的区域在空间上不相邻（潇湘馆 vs 正门），B 里 moss 让位给
 *   sand（见 masks()，苔带与水线沙带重叠处留沙）——mipmap 平均出来的中间值只会
 *   出现在各自区域的边缘羽化带上，解码后仍是合法的弱权重，不会串成另一种材质。
 *
 *   扩展 splat（单子 T）：
 *     R soil 露土 ｜ G wet 湿痕 ｜ B 备用（恒 0）｜ A 备用（恒 0）
 *   soil/wet 都是单一标量权重，无分档；mip 平均出的中间值就是边缘羽化。
 */

import type { TerrainField } from './terrain-from-plan';

export interface SplatWindow {
  minX: number;
  minZ: number;
  width: number;
  depth: number;
}

export function bakeSplatMainData(
  field: TerrainField,
  win: SplatWindow,
  size = 1024,
): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = win.minZ + ((j + 0.5) / size) * win.depth;
    for (let i = 0; i < size; i++) {
      const x = win.minX + ((i + 0.5) / size) * win.width;
      const m = field.masks(x, z);
      const o = (j * size + i) * 4;
      data[o] = m.dirt * 255;
      data[o + 1] = m.slab > 0 ? 128 + Math.min(127, m.slab * 127) : m.cobble * 127;
      data[o + 2] = m.sand > 0.02 ? Math.min(127, m.sand * 127) : 128 + m.moss * 127;
      data[o + 3] = m.wear * 255;
    }
  }
  return data;
}

export function bakeSplatExtData(
  field: TerrainField,
  win: SplatWindow,
  size = 1024,
): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = win.minZ + ((j + 0.5) / size) * win.depth;
    for (let i = 0; i < size; i++) {
      const x = win.minX + ((i + 0.5) / size) * win.width;
      const m = field.masks(x, z);
      const o = (j * size + i) * 4;
      data[o] = m.soil * 255;
      data[o + 1] = m.wet * 255;
      // B、A 留空备用（见头注释的打包格式），恒 0。
    }
  }
  return data;
}

/**
 * 单子 AX2:主 splat 与扩展 splat **一遍烘完**。
 *
 * 上面两个函数在同一批纹素中心上各调一遍 `field.masks(x, z)`——19 区时各 5.1 s,
 * 一半是白算。这里每个纹素只取一次 masks,两张图的打包公式与上面逐字相同,
 * 所以字节流逐位一致(`tests/splat-single-pass.test.mjs` 断言)。上面两个函数留着当参照。
 */
export function bakeSplatData(
  field: TerrainField,
  win: SplatWindow,
  size = 1024,
): { main: Uint8Array; ext: Uint8Array } {
  const main = new Uint8Array(size * size * 4);
  const ext = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = win.minZ + ((j + 0.5) / size) * win.depth;
    for (let i = 0; i < size; i++) {
      const x = win.minX + ((i + 0.5) / size) * win.width;
      const m = field.masks(x, z);
      const o = (j * size + i) * 4;
      main[o] = m.dirt * 255;
      main[o + 1] = m.slab > 0 ? 128 + Math.min(127, m.slab * 127) : m.cobble * 127;
      main[o + 2] = m.sand > 0.02 ? Math.min(127, m.sand * 127) : 128 + m.moss * 127;
      main[o + 3] = m.wear * 255;
      ext[o] = m.soil * 255;
      ext[o + 1] = m.wet * 255;
    }
  }
  return { main, ext };
}
