import { Fn, attribute, positionGeometry, positionLocal, modelWorldMatrix, modelWorldMatrixInverse, cameraPosition, vec2, vec3, vec4, uv, varying, uniform, texture, sin, mix, smoothstep as nodeSmoothstep, max, varyingProperty } from 'three/tsl';
import { mrt, float } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { makeRng, rangeOf, fbm2, smoothstep, clamp, lerp } from '@engine/core/Noise';
import { NOISE, hexToRgb } from '@engine/core/TextureLab';

/**
 * Stylised cumulus clouds.
 *
 * The look we are after is Animal Crossing / Mario Odyssey: rounded cauliflower
 * puffs with a flat base, a bright sunlit crown, a cool blue underside and a
 * warm translucent rim where light scatters through the thin edge. That is a
 * *shape* problem, not a noise problem — stretching fbm across a quad gives grey
 * smoke every time.
 *
 * So a cloud is built from circles, the way an illustrator would draw one: a
 * chain of large spheres resting on a flat base, with smaller spheres stacked
 * on their crowns the way convective cumulus actually grow. Two fields fall
 * out of that arrangement:
 *
 *   D — a metaball density sum, used for the soft fused silhouette.
 *   H — the height of the *union surface* of the spheres, used for shading.
 *
 * Taking the normal from H rather than from D is the whole trick: a density sum
 * saturates into a featureless plateau in the interior, whereas the union
 * surface keeps every individual puff's dome and the creases between them. The
 * result is per-puff volumetric lighting baked into a single RGBA sprite.
 *
 * Four variants are baked into one 2x2 atlas so the whole sky is one draw call.
 */

const TILE = 512;
const ATLAS = TILE * 2;

/**
 * Angular drift of the whole cloud shell (rad/s of yaw). The ground shadow
 * map counter-rotates by the same angle, so shade patches track the clouds
 * exactly — the one thing a scrolling noise texture can never do.
 */
export const CLOUD_DRIFT_RATE = 0.0016;

interface Blob {
  x: number;
  y: number;
  r: number;
}

/**
 * Per-variant silhouette, hand-authored.
 *
 * Cumulus outlines are made of circular arcs, so the shapes are laid out as
 * explicit circles rather than grown procedurally — a random walk reliably
 * produces detached lumps and diagonal wedges, neither of which is a cloud.
 * Seeded jitter then varies each bake without ever breaking connectivity.
 *
 * Body circles sit with their centres at roughly half their radius above the
 * base line, so the flat-base cut slices a genuine chord off each one. That
 * flat underside is the single most recognisable feature of a fair-weather
 * cumulus.
 */
interface Recipe {
  circles: readonly (readonly [number, number, number])[];
  /** How many extra seeded bubbles to graft onto the upper surface. */
  bubbles: number;
  /** Target box in tile space: [u0, u1, w0, w1]. */
  box: [number, number, number, number];
}

const RECIPES: Recipe[] = [
  // 0 — long, low, lazy. The workhorse that reads well near the horizon.
  {
    circles: [
      [-0.62, 0.11, 0.22], [-0.30, 0.15, 0.30], [0.05, 0.17, 0.35],
      [0.40, 0.13, 0.27], [0.70, 0.10, 0.20],
      [-0.03, 0.42, 0.24], [0.26, 0.36, 0.19], [-0.34, 0.34, 0.18],
    ],
    bubbles: 3,
    box: [0.02, 0.98, 0.30, 0.72],
  },
  // 1 — a proper towering cumulus. The hero silhouette.
  {
    circles: [
      [-0.32, 0.13, 0.26], [0.02, 0.17, 0.34], [0.34, 0.12, 0.24],
      [-0.24, 0.34, 0.17], [-0.04, 0.44, 0.28], [0.20, 0.52, 0.21],
      [0.30, 0.40, 0.20], [-0.06, 0.68, 0.23], [0.02, 0.86, 0.17],
    ],
    bubbles: 3,
    box: [0.06, 0.94, 0.06, 0.94],
  },
  // 2 — compact rounded clump for scatter.
  {
    circles: [
      [-0.28, 0.13, 0.26], [0.06, 0.16, 0.32], [0.36, 0.12, 0.24],
      [0.00, 0.42, 0.25], [0.26, 0.36, 0.18],
    ],
    bubbles: 2,
    box: [0.04, 0.96, 0.20, 0.80],
  },
  // 3 — broad, two-lobed mass with a saddle in the middle.
  {
    circles: [
      [-0.78, 0.10, 0.20], [-0.50, 0.14, 0.28], [-0.18, 0.11, 0.22],
      [0.14, 0.15, 0.30], [0.46, 0.12, 0.25], [0.74, 0.09, 0.19],
      [-0.44, 0.40, 0.24], [-0.04, 0.20, 0.22], [0.18, 0.44, 0.26],
    ],
    bubbles: 3,
    box: [0.02, 0.98, 0.30, 0.72],
  },
];

/** Instantiates a template with seeded jitter and grafted bubbles. */
function growCloud(rng: () => number, rec: Recipe): Blob[] {
  const blobs: Blob[] = rec.circles.map(([x, y, r]) => ({
    x: x + rangeOf(rng, -0.022, 0.022),
    y: y + rangeOf(rng, -0.014, 0.020),
    r: r * rangeOf(rng, 0.93, 1.08),
  }));

  // Graft small puffs onto the upper surface of existing circles. Anchoring to
  // a parent guarantees they stay part of the mass.
  const seedCount = blobs.length;
  for (let i = 0; i < rec.bubbles; i++) {
    const parent = blobs[Math.floor(rng() * seedCount)];
    const br = parent.r * rangeOf(rng, 0.36, 0.56);
    const ang = rangeOf(rng, -0.85, 0.85); // measured from straight up
    blobs.push({
      x: parent.x + Math.sin(ang) * parent.r * 0.8,
      y: parent.y + Math.cos(ang) * parent.r * 0.8,
      r: br,
    });
  }

  return blobs;
}

/**
 * Uniformly scales and centres the arrangement into its target box, so every
 * variant fills its tile without ever distorting a sphere into an ellipse.
 * Instance quads stay square for the same reason.
 */
function fitToBox(blobs: Blob[], box: [number, number, number, number]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of blobs) {
    minX = Math.min(minX, b.x - b.r);
    maxX = Math.max(maxX, b.x + b.r);
    maxY = Math.max(maxY, b.y + b.r);
  }
  // The base line is a hard cut at y = 0, so that is the true bottom.
  const s = Math.min((box[1] - box[0]) / (maxX - minX), (box[3] - box[2]) / maxY);
  const ox = (box[0] + box[1]) * 0.5 - (minX + maxX) * 0.5 * s;
  const oy = box[2];
  for (const b of blobs) {
    b.x = b.x * s + ox;
    b.y = b.y * s + oy;
    b.r *= s;
  }
  return oy;
}

/**
 * Bakes the 2x2 cloud atlas. Returns an sRGB RGBA texture; alpha carries the
 * silhouette, rgb carries pre-shaded volume.
 */
export function bakeCloudAtlas(seed: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx2d.createImageData(ATLAS, ATLAS);
  const data = img.data;

  const LIT = hexToRgb(0xfcfaf4);
  const SHADE = hexToRgb(0x95b0d4);
  const DEEP = hexToRgb(0x88a4ca);
  const RIM = hexToRgb(0xfff7e8);
  const SKYBOUNCE = hexToRgb(0xc0d9f7);

  // Light direction in sprite space: high, a little to the right, tilted
  // toward the viewer. Identical for every variant so a sky full of clouds
  // reads as lit by one sun.
  const LX = 0.37;
  const LY = 0.80;
  const LZ = 0.47;

  const dens = new Float32Array(TILE * TILE);
  const surf = new Float32Array(TILE * TILE);

  for (let variant = 0; variant < 4; variant++) {
    const rng = makeRng((seed ^ 0x9e3779b9) + variant * 7919);
    const rec = RECIPES[variant];
    const blobs = growCloud(rng, rec);
    const base = fitToBox(blobs, rec.box);
    const warpU = rangeOf(rng, 0, 40);
    const warpV = rangeOf(rng, 0, 40);

    // ---- Pass 1: density + union-surface height --------------------------
    for (let py = 0; py < TILE; py++) {
      const w0 = 1 - (py + 0.5) / TILE; // 0 at the bottom of the sprite
      for (let px = 0; px < TILE; px++) {
        const u0 = (px + 0.5) / TILE;

        // Two-scale domain warp. The amplitude stays well under the smallest
        // blob radius: enough to kill the perfect arcs, not enough to shred
        // the puffs into wisps.
        const wLow = fbm2(NOISE.cloud, u0 * 3.4 + warpU, w0 * 3.4 + warpV, 3);
        const wLow2 = fbm2(NOISE.cloud, u0 * 3.4 + warpU + 17.3, w0 * 3.4 + warpV - 9.1, 3);
        const wHi = fbm2(NOISE.cloud, u0 * 13.0 + warpU, w0 * 13.0 + warpV, 3);
        const u = u0 + wLow * 0.015 + wHi * 0.0055;
        const w = w0 + wLow2 * 0.013 + wHi * 0.0045;

        let d = 0;
        let hp = 0;
        for (let i = 0; i < blobs.length; i++) {
          const b = blobs[i];
          const dx = u - b.x;
          const dy = w - b.y;
          const q = (dx * dx + dy * dy) / (b.r * b.r);
          if (q < 1) {
            const k = 1 - q;
            // Linear-in-q kernel: the silhouette threshold then lands at ~95%
            // of each circle's true radius instead of shrinking it to half.
            d += k;
            // Height of this sphere's front surface above the sprite plane.
            const hs = b.r * Math.sqrt(k);
            const h2 = hs * hs;
            hp += h2 * h2; // quartic power-sum = smooth union
          }
        }

        // Flat base. Cumulus bases are flat but never ruled — a slow, shallow
        // undulation keeps the chord from reading as a crop.
        const undulate = fbm2(NOISE.cloud, u0 * 4.2 + warpU + 61.7, warpV * 0.3, 2);
        const cut = base + undulate * 0.024 + wLow * 0.008;
        const gate = smoothstep(cut - 0.034, cut + 0.026, w0);

        const idx = py * TILE + px;
        dens[idx] = d * gate;
        // Fine surface relief so the big domes are not glassy. Low amplitude
        // and low frequency: enough to catch light, never popcorn.
        const relief = fbm2(NOISE.cloud, u0 * 10 + variant * 11, w0 * 10, 3) * 0.0020;
        surf[idx] = (hp > 0 ? Math.sqrt(Math.sqrt(hp)) : 0) * gate + (d > 0.06 ? relief : 0);
      }
    }

    // ---- Pass 2: shade from the union surface ----------------------------
    const col = variant % 2;
    const row = variant >> 1;
    const ox = col * TILE;
    const oy = row * TILE;

    for (let py = 0; py < TILE; py++) {
      const w0 = 1 - (py + 0.5) / TILE;
      const yUp = Math.max(0, py - 1);
      const yDn = Math.min(TILE - 1, py + 1);
      for (let px = 0; px < TILE; px++) {
        const xL = Math.max(0, px - 1);
        const xR = Math.min(TILE - 1, px + 1);

        const dC = dens[py * TILE + px];

        // Surface gradient. `surf` and the uv axes share units, so the raw
        // derivative is already the tangent slope — no magic scale factor.
        const half = TILE * 0.5;
        let sx = (surf[py * TILE + xR] - surf[py * TILE + xL]) * half;
        // Canvas y grows downward, so "up" is the smaller index.
        let sy = (surf[yUp * TILE + px] - surf[yDn * TILE + px]) * half;
        sx = clamp(sx, -3.5, 3.5);
        sy = clamp(sy, -3.5, 3.5);

        const nl = Math.hypot(sx, sy, 1);
        const nx = -sx / nl;
        const ny = -sy / nl;
        const nz = 1 / nl;

        const ndl = nx * LX + ny * LY + nz * LZ;
        // Wrapped diffuse — clouds scatter light around the terminator rather
        // than falling to black, which is exactly the soft look we want.
        const wrapped = clamp((ndl + 0.38) / 1.38, 0, 1);
        const shaped = smoothstep(0.10, 0.93, wrapped);

        let r = lerp(SHADE[0], LIT[0], shaped);
        let g = lerp(SHADE[1], LIT[1], shaped);
        let b = lerp(SHADE[2], LIT[2], shaped);

        // Self-shadowing from the puffs above, confined to the lower third so
        // the body of the cloud stays bright, then sky bounce back into the
        // base so the underside is blue rather than dirty.
        const hRel = smoothstep(base - 0.01, base + (rec.box[3] - rec.box[2]) * 0.42, w0);
        r = lerp(DEEP[0], r, hRel);
        g = lerp(DEEP[1], g, hRel);
        b = lerp(DEEP[2], b, hRel);
        const bounce = (1 - hRel) * 0.34;
        r = lerp(r, SKYBOUNCE[0], bounce);
        g = lerp(g, SKYBOUNCE[1], bounce);
        b = lerp(b, SKYBOUNCE[2], bounce);

        // ---- Silhouette ---------------------------------------------------
        // Wide, gentle ramp: cloud edges are translucent shells hundreds of
        // metres thick, not die-cut stickers.
        let a = smoothstep(0.010, 0.46, dC);

        // ---- Translucent rim ----------------------------------------------
        // Light punching through the thin outer shell. Peaks just inside the
        // silhouette and is strongest where the surface faces away from the
        // sun, which is what produces the classic bright cloud edge.
        const rimBand = smoothstep(0.03, 0.22, dC) * (1 - smoothstep(0.24, 0.85, dC));
        // Weighted by coverage so the warm tint never paints into the
        // near-transparent fringe, where it would read as a pink outline.
        const rimAmt = rimBand * (0.16 + (1 - shaped) * 0.42) * smoothstep(0.02, 0.30, dC);
        r = lerp(r, RIM[0], rimAmt);
        g = lerp(g, RIM[1], rimAmt);
        b = lerp(b, RIM[2], rimAmt);

        // Guard-band the tile so mip generation cannot bleed across the atlas.
        const u0 = (px + 0.5) / TILE;
        const winU = smoothstep(0.0, 0.03, u0) * smoothstep(1.0, 0.97, u0);
        const winV = smoothstep(0.0, 0.03, w0) * smoothstep(1.0, 0.97, w0);
        a *= winU * winV;

        const i = ((oy + py) * ATLAS + (ox + px)) * 4;
        // Colour is written even where alpha is zero: non-premultiplied
        // mipmaps would otherwise pull black into the feathered edges.
        data[i] = clamp(r, 0, 0.99) * 255;
        data[i + 1] = clamp(g, 0, 0.99) * 255;
        data[i + 2] = clamp(b, 0, 0.99) * 255;
        data[i + 3] = clamp(a, 0, 1) * 255;
      }
    }
  }

  ctx2d.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Cloud shadows (W1)                                                  */
/* ------------------------------------------------------------------ */

interface PlacedCloud {
  pos: THREE.Vector3;
  size: number;
  variant: number;
  bright: number;
  phase: number;
  flip: number;
  squash: number;
  d: number;
}

export interface CloudShadowMap {
  texture: THREE.Texture;
  /** Half-size (m) of the world XZ square the texture covers, centred on the origin. */
  extent: number;
}

/**
 * Bakes a low-frequency occlusion map of the cloud layer projected onto the
 * ground plane. Clouds ride a shell 70–370 m up, far beyond the shadow
 * camera's useful range, so a real shadow map would shatter; a baked blob per
 * cloud, displaced along the sun ray and softened to two tiers (a dense core
 * inside a wide faint skirt), is all the eye can verify from the ground.
 *
 * The map is baked for shell yaw 0; the consumer counter-rotates world XZ by
 * `windTime * CLOUD_DRIFT_RATE` before sampling, which keeps every patch
 * glued to its cloud. Texel = ~3.4 m at 384² over ±660 m — deliberately
 * coarse: this is a light-level modulation, not an occluder.
 */
export function bakeCloudShadow(placed: readonly PlacedCloud[], toSun: THREE.Vector3): CloudShadowMap {
  const SIZE = 384;
  const EXTENT = 660;
  const acc = new Float32Array(SIZE * SIZE);

  const worldFromPixel = (px: number) => ((px + 0.5) / SIZE) * 2 * EXTENT - EXTENT;

  for (const p of placed) {
    // Slide the cloud centre down the sun ray to y = 0.
    const t = p.pos.y / toSun.y;
    const gx = p.pos.x - toSun.x * t;
    const gz = p.pos.z - toSun.z * t;

    // Two tiers: a tight core that carries most of the darkening, inside a
    // wide faint skirt that reads as the soft outer penumbra. Higher clouds
    // get a slightly broader skirt (longer light path, more scatter).
    const coreR = p.size * 0.40;
    const skirtR = p.size * 0.50 + p.pos.y * 0.04;
    // Bigger, taller masses block more light; small scatter puffs barely shade.
    const peak = clamp(0.42 + p.size / 420, 0.42, 0.85);

    const x0 = Math.max(0, Math.floor(((gx - skirtR) + EXTENT) / (2 * EXTENT) * SIZE));
    const x1 = Math.min(SIZE - 1, Math.ceil(((gx + skirtR) + EXTENT) / (2 * EXTENT) * SIZE));
    const z0 = Math.max(0, Math.floor(((gz - skirtR) + EXTENT) / (2 * EXTENT) * SIZE));
    const z1 = Math.min(SIZE - 1, Math.ceil(((gz + skirtR) + EXTENT) / (2 * EXTENT) * SIZE));
    for (let pz = z0; pz <= z1; pz++) {
      const wz = worldFromPixel(pz);
      for (let px = x0; px <= x1; px++) {
        const wx = worldFromPixel(px);
        const dd = Math.hypot(wx - gx, wz - gz);
        const skirt = smoothstep(skirtR, skirtR * 0.45, dd) * 0.25;
        const core = smoothstep(coreR, coreR * 0.30, dd) * 0.75;
        const a = peak * (skirt + core);
        const idx = pz * SIZE + px;
        if (a > acc[idx]) acc[idx] = Math.min(a, 1); // max-composite: overlaps never double-darken
      }
    }
  }

  // Two box-blur passes kill texel quantisation; the map is meant to be felt
  // as a slow change in daylight, never as a shape with an edge.
  const blur = new Float32Array(acc.length);
  for (let passN = 0; passN < 2; passN++) {
    const src = passN === 0 ? acc : blur;
    const dst = passN === 0 ? blur : acc;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = clamp(y + dy, 0, SIZE - 1);
          for (let dx = -1; dx <= 1; dx++) sum += src[yy * SIZE + clamp(x + dx, 0, SIZE - 1)];
        }
        dst[y * SIZE + x] = sum / 9;
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx2d = canvas.getContext('2d')!;
  const img = ctx2d.createImageData(SIZE, SIZE);
  for (let py = 0; py < SIZE; py++) {
    // Canvas row 0 is the top of the image; with flipY that is v = 1, which
    // the shader maps to z = +extent — so row 0 bakes the +Z edge.
    const pz = SIZE - 1 - py;
    for (let px = 0; px < SIZE; px++) {
      const v = acc[pz * SIZE + px] * 255;
      const i = (py * SIZE + px) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx2d.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // data map, not imagery
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { texture: tex, extent: EXTENT };
}

/* ------------------------------------------------------------------ */
/* Cloud layer                                                         */
/* ------------------------------------------------------------------ */

export interface CloudLayerOptions {
  seed: number;
  count: number;
  hazeColor: THREE.Color;
  /** Linear-space multiplier; clouds sit slightly hot so they bloom at the rim. */
  exposure: number;
  /** Direction from the world origin *toward* the sun; used to project the shadow map. */
  sunDir: THREE.Vector3;
}

export interface CloudLayer {
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicNodeMaterial;
  /** Baked ground occlusion for this exact arrangement (W1). */
  shadow: CloudShadowMap;
  update: (windTime: number) => void;
}

export function buildCloudLayer(opts: CloudLayerOptions): CloudLayer {
  const { seed, count, hazeColor, exposure, sunDir } = opts;
  const rng = makeRng(seed ^ 0x5c10d);

  const atlas = bakeCloudAtlas(seed);

  const clock = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false,
  });
  const miscNode = attribute<'vec3'>('aMisc', 'vec3');
  // positionLocal has already received instanceMatrix in NodeMaterial.setupPosition.
  // The instance translation is recovered by subtracting the unit quad position.
  const centre = modelWorldMatrix.mul(vec4(positionLocal.sub(positionGeometry), 1)).xyz;
  const toCam = cameraPosition.sub(centre);
  const distance = toCam.length().max(0.0001);
  const forward = toCam.div(distance);
  const right = vec3(0, 1, 0).cross(forward).normalize();
  const up = forward.cross(right).normalize();
  const breathe = sin(clock.mul(0.11).add(miscNode.y)).mul(0.024).add(1);
  const squash = sin(clock.mul(0.09).add(miscNode.y.mul(1.7))).mul(-0.018).add(1);
  const quad = positionGeometry.xy.mul(attribute<'vec2'>('aScale', 'vec2')).mul(breathe).mul(vec2(miscNode.z,squash));
  const fade = varyingProperty('float');
  material.positionNode = Fn(() => {
    fade.assign(nodeSmoothstep(0.004,0.085,centre.y.sub(cameraPosition.y).div(distance)));
    return modelWorldMatrixInverse.mul(vec4(centre.add(right.mul(quad.x)).add(up.mul(quad.y)),1)).xyz;
  })();
  const bright = varying(miscNode.x);
  const tileUV = varying(attribute<'vec2'>('aUvOff', 'vec2').add(1.5/(TILE*2)).add(uv().mul(0.5-3/(TILE*2))));
  const texel = texture(atlas,tileUV);
  material.colorNode = Fn(() => {
    texel.a.lessThan(0.003).discard();
    const warm = mix(vec3(1),vec3(1.07,1.02,0.93),nodeSmoothstep(0.62,1,max(texel.r,max(texel.g,texel.b))));
    return mix(uniform(hazeColor.clone()),texel.rgb.mul(bright).mul(exposure).mul(warm),fade.mul(0.66).add(0.34));
  })();
  material.opacityNode = texel.a.mul(fade.mul(0.42).add(0.58));
  // Transparent color blends normally; preserve opaque MRT normals underneath.
  // AO belongs to opaque radiance: transparent coverage attenuates AO without writing depth.
  material.mrtNode = mrt({ normal: vec4(0,0,0,0), aoMask: vec4(0,0,0,float(material.opacityNode as import('three/src/nodes/core/Node.js').default<'float'>)) });
  material.name = 'CloudBillboard';

  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);

  const placed: PlacedCloud[] = [];

  /** Azimuth is measured from due north (-Z), turning east. */
  const push = (az: number, el: number, r: number, size: number, variant: number) => {
    const cosEl = Math.cos(el);
    const pos = new THREE.Vector3(
      Math.sin(az) * cosEl * r,
      Math.sin(el) * r + 30,
      -Math.cos(az) * cosEl * r,
    );
    placed.push({
      pos,
      size,
      variant,
      bright: rangeOf(rng, 0.94, 1.06),
      phase: rangeOf(rng, 0, Math.PI * 2),
      flip: rng() < 0.5 ? -1 : 1,
      squash: rangeOf(rng, 0.90, 1.07),
      d: pos.length(),
    });
  };

  // Hand-placed hero clouds. The establishing shots all look north over the
  // sea, so the strongest silhouettes are staged there and deliberately
  // off-centre, with one big tower behind the player for the backlit shot.
  const heroes: { az: number; el: number; r: number; size: number; variant: number }[] = [
    { az: -0.34, el: 0.30, r: 400, size: 175, variant: 1 },
    { az: 0.44, el: 0.17, r: 470, size: 195, variant: 3 },
    { az: -1.02, el: 0.13, r: 430, size: 160, variant: 0 },
    { az: 2.50, el: 0.36, r: 385, size: 168, variant: 1 },
    { az: 1.66, el: 0.11, r: 500, size: 200, variant: 0 },
    { az: -2.10, el: 0.22, r: 445, size: 172, variant: 3 },
  ];
  for (const h of heroes) push(h.az, h.el, h.r, h.size, h.variant);

  // Scatter the rest over stratified azimuth sectors with jitter, so there is
  // never a repeating rhythm and never a bald patch of sky.
  const fill = Math.max(0, count - heroes.length);
  for (let i = 0; i < fill; i++) {
    const sector = (i + rangeOf(rng, 0.12, 0.88)) / fill;
    const az = sector * Math.PI * 2 + rangeOf(rng, -0.10, 0.10);
    // Bias toward the lower half of the sky — that is where the camera looks —
    // but keep everything clear of the horizon line itself so the treeline
    // silhouettes against open sky rather than a bank of white.
    const u = rng();
    const el = 0.115 + u * u * 0.55;
    const r = rangeOf(rng, 330, 545);
    const variant = Math.floor(rng() * 4);
    // Wide size range with a square-law bias toward small: a few large
    // shapes plus many small ones is what gives a sky depth.
    const sz = rng();
    const size = (62 + sz * sz * 128) * (variant === 2 ? 0.82 : 1.0);
    push(az, el, r, size, variant);
  }

  // Far-to-near so the fixed instance order blends plausibly without sorting.
  placed.sort((a, b) => b.d - a.d);

  const n = placed.length;
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.name = 'Clouds';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = -900;

  const scales = new Float32Array(n * 2);
  const uvOffs = new Float32Array(n * 2);
  const misc = new Float32Array(n * 3);
  const m = new THREE.Matrix4();

  for (let i = 0; i < n; i++) {
    const p = placed[i];
    m.makeTranslation(p.pos.x, p.pos.y, p.pos.z);
    mesh.setMatrixAt(i, m);

    // Near-square quads: the sprite content already carries the proportion, so
    // a strongly non-square quad would squash the puffs into ellipses. A few
    // percent of jitter is invisible as distortion but stops two instances of
    // the same variant reading as copies.
    scales[i * 2] = p.size;
    scales[i * 2 + 1] = p.size * p.squash;

    const col = p.variant % 2;
    const row = p.variant >> 1;
    uvOffs[i * 2] = col * 0.5;
    // Canvas row 0 is the top of the image, which is v = 0.5..1.0.
    uvOffs[i * 2 + 1] = row === 0 ? 0.5 : 0.0;

    misc[i * 3] = p.bright;
    misc[i * 3 + 1] = p.phase;
    misc[i * 3 + 2] = p.flip;
  }

  mesh.instanceMatrix.needsUpdate = true;
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 2));
  geo.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(uvOffs, 2));
  geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 3));

  const group = new THREE.Group();
  group.name = 'CloudLayer';
  group.add(mesh);

  return {
    group,
    mesh,
    material,
    shadow: bakeCloudShadow(placed, sunDir),
    update: (windTime: number) => {
      clock.value = windTime;
      // Whole-shell yaw. At 200-400 m this reads as slow lateral drift with no
      // wrap-around pop, and costs one matrix update per frame.
      group.rotation.y = windTime * CLOUD_DRIFT_RATE;
    },
  };
}
