/**
 * 世界对齐分块散布的小工具（`D-37`）。
 *
 * **病**：散布域曾经就是地形窗口。Bridson 的飞镖流从窗口一角撒起，窗口一变
 * （加一个建成区），整个园子的每一株都换了位置——BA1 入建成稻香村，灌木 352 丛 0 丛原位。
 *
 * **修法**：旧窗口钉死照旧撒；窗口外的新地按**世界坐标对齐的固定分块**撒，
 * 每一块的随机数只取块坐标，所以「以后加区只增块、不洗别处」。本文件只放与项目无关的
 * 通用件：块坐标、块种子、按格点烤的世界掩码、把一串 rng 拼接成两段的 `splitRng`。
 */

/** 块坐标（整数），块 `(bx, bz)` 覆盖 `[bx·size, (bx+1)·size) × [bz·size, (bz+1)·size)`。 */
export interface BlockKey {
  bx: number;
  bz: number;
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 块坐标 → 32 位种子。只取块坐标（两个大质数乘开再搅一下），与窗口、区数、遍历顺序都无关。 */
export function blockHash(bx: number, bz: number, salt = 0): number {
  let h = (Math.imul(bx | 0, 0x9e3779b1) ^ Math.imul(bz | 0, 0x85ebca77) ^ Math.imul(salt | 0, 0xc2b2ae3d)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * 整数格 → [0,1)。给「每个格点自己的几发随机数」用（草的抖动格网）：
 * 格点 `(i, j)` 的第 `k` 发只由 `(i, j, k, salt)` 决定，所以任何一块草都能单独生成，
 * 不必从某个原点把整张格网顺序撒一遍。
 */
export function latticeHash01(i: number, j: number, k: number, salt: number): number {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1) ^ (salt | 0)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 与 `rect` 相交的所有块（左闭右开，按 bz、bx 升序——顺序固定，但下游不许依赖它）。 */
export function blocksOver(rect: Rect, size: number): BlockKey[] {
  const out: BlockKey[] = [];
  const bx0 = Math.floor(rect.minX / size), bx1 = Math.floor(rect.maxX / size);
  const bz0 = Math.floor(rect.minZ / size), bz1 = Math.floor(rect.maxZ / size);
  for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) out.push({ bx, bz });
  return out;
}

export function blockRect(b: BlockKey, size: number): Rect {
  return { minX: b.bx * size, maxX: (b.bx + 1) * size, minZ: b.bz * size, maxZ: (b.bz + 1) * size };
}

export function insideRect(r: Rect, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

/** `inner` 是否整个落在 `outer` 里（闭区间）。 */
export function rectWithin(inner: Rect, outer: Rect): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ;
}

/**
 * 前 `n` 发取自 `a`，之后取自 `b`。
 *
 * 用处：一个实例网格的 `aWind` 是 `applyWind(count, rng)` 按实例序号顺序抽的。
 * 旧窗口那些实例要与旧版逐位相同，就得让它们吃到旧 rng 的同一串数；
 * 块里新增的实例接在后面，吃另一条 rng，**旧 rng 被消费的次数不变**，
 * 于是它后面的消费者（同一段里的逐株体量/色偏）也不变。
 */
export function splitRng(a: () => number, n: number, b: () => number): () => number {
  let k = 0;
  return () => (k++ < n ? a() : b());
}

/**
 * 按世界固定格点烤、按块懒加载、双线性采样的掩码。
 *
 * 与 `DensityMask` 同一个用途（贵的采样函数烤一次、散布时查十万次），区别是
 * **格点钉在世界上**（`x = i·step`），不跟窗口走：窗口一变，已经烤过的格点值不变，
 * 查到的就不变。只在块里的散布用它；旧窗口那一段仍用原来那张 `DensityMask`。
 */
export class LatticeMask {
  readonly step: number;
  readonly tileCells: number;
  private readonly sample: (x: number, z: number) => number;
  private readonly tiles = new Map<number, Float32Array>();
  /** 已烤的格点数（自报，给建时归因用）。 */
  baked = 0;

  constructor(sample: (x: number, z: number) => number, step = 1, tileCells = 32) {
    this.sample = sample;
    this.step = step;
    this.tileCells = tileCells;
  }

  private value(i: number, j: number): number {
    const T = this.tileCells;
    const ti = Math.floor(i / T), tj = Math.floor(j / T);
    const key = (ti + 32768) * 65536 + (tj + 32768);
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = new Float32Array(T * T);
      for (let b = 0; b < T; b++) {
        const z = (tj * T + b) * this.step;
        for (let a = 0; a < T; a++) tile[b * T + a] = this.sample((ti * T + a) * this.step, z);
      }
      this.baked += T * T;
      this.tiles.set(key, tile);
    }
    return tile[(j - tj * T) * T + (i - ti * T)];
  }

  at(x: number, z: number): number {
    const u = x / this.step, v = z / this.step;
    const i0 = Math.floor(u), j0 = Math.floor(v);
    const fx = u - i0, fz = v - j0;
    const a = this.value(i0, j0), b = this.value(i0 + 1, j0);
    const c = this.value(i0, j0 + 1), d = this.value(i0 + 1, j0 + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
  }
}
