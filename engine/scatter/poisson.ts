import { rangeOf } from '@engine/core/Noise';

export interface ScatterPoint {
  x: number;
  z: number;
}

export interface PoissonScatterOptions {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Minimum centre-to-centre distance between accepted points. */
  radius: number;
  /** Sampling weight in [0, 1] at a candidate point; 0 rejects it outright. */
  density: (x: number, z: number) => number;
  rng: () => number;
  /** Dart-throwing attempts before giving up. Higher = denser fill near saturation. */
  tries?: number;
}

/**
 * Dart-throwing Poisson-disc rejection over a density field. Used where spacing
 * has to be genuinely enforced — trees, bushes, flower clusters — because a
 * jittered grid there produces visible rows the moment two neighbours line up.
 */
export function poissonScatter(o: PoissonScatterOptions): ScatterPoint[] {
  const attempts = o.tries ?? 12000;
  const cell = o.radius / Math.SQRT2;
  const gw = Math.ceil((o.maxX - o.minX) / cell) + 1;
  const gh = Math.ceil((o.maxZ - o.minZ) / cell) + 1;
  const grid = new Int32Array(gw * gh).fill(-1);
  const out: ScatterPoint[] = [];
  const d2 = o.radius * o.radius;

  for (let a = 0; a < attempts; a++) {
    const x = rangeOf(o.rng, o.minX, o.maxX);
    const z = rangeOf(o.rng, o.minZ, o.maxZ);
    const dens = o.density(x, z);
    if (dens <= 0.001 || o.rng() > dens) continue;

    const gi = Math.floor((x - o.minX) / cell);
    const gj = Math.floor((z - o.minZ) / cell);
    let ok = true;
    for (let j = Math.max(0, gj - 2); j <= Math.min(gh - 1, gj + 2) && ok; j++) {
      for (let i = Math.max(0, gi - 2); i <= Math.min(gw - 1, gi + 2); i++) {
        const id = grid[j * gw + i];
        if (id < 0) continue;
        const s = out[id];
        const dx = s.x - x;
        const dz = s.z - z;
        if (dx * dx + dz * dz < d2) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) continue;
    grid[gj * gw + gi] = out.length;
    out.push({ x, z });
  }
  return out;
}

export interface DensityMaskBounds {
  minX: number;
  minZ: number;
  width: number;
  depth: number;
}

/**
 * Bakes a scalar field to a grid and bilinear-samples it back.
 *
 * The source `sample` function is typically not cheap — it might re-walk
 * polylines or stack several noise octaves per call — and a scatter pass needs
 * on the order of a hundred thousand queries. Baking once turns a multi-second
 * stall into a fraction of that, and the blur across cells is what softens a
 * hard edge (a path boundary, a footprint wall) into something plants fade out
 * against instead of stopping dead on.
 */
export class DensityMask {
  readonly w: number;
  readonly h: number;
  private data: Float32Array;
  private bounds: DensityMaskBounds;

  constructor(sample: (x: number, z: number) => number, bounds: DensityMaskBounds, w = 256, h = 288) {
    this.w = w;
    this.h = h;
    this.bounds = bounds;
    this.data = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      const z = bounds.minZ + ((j + 0.5) / h) * bounds.depth;
      for (let i = 0; i < w; i++) {
        const x = bounds.minX + ((i + 0.5) / w) * bounds.width;
        this.data[j * w + i] = sample(x, z);
      }
    }
  }

  /** Bilinear sample. */
  at(x: number, z: number): number {
    const { minX, minZ, width, depth } = this.bounds;
    const u = ((x - minX) / width) * this.w - 0.5;
    const v = ((z - minZ) / depth) * this.h - 0.5;
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const fx = u - i0;
    const fz = v - j0;
    const g = (i: number, j: number) => {
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) return 0;
      return this.data[j * this.w + i];
    };
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(lerp(g(i0, j0), g(i0 + 1, j0), fx), lerp(g(i0, j0 + 1), g(i0 + 1, j0 + 1), fx), fz);
  }
}
