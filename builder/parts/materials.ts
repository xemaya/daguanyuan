import * as THREE from 'three';
import {
  bakeColorMap,
  bakeNormalMap,
  bakeScalarMap,
  cached,
  mixHex,
  hexToRgb,
  NOISE,
  type MaterialMaps,
} from '@engine/core/TextureLab';
import { tileableFbm, worley, clamp, smoothstep, lerp } from '@engine/core/Noise';

/**
 * 江南园林材质库。
 *
 * 所有中式构件只从这里取材质,一园一色。色板见 ART_DIRECTION.md §3,
 * 这里的 hex 与那张表一致;要改色改表,不要在构件里另起炉灶。
 *
 * 每个函数返回 MeshStandard/PhysicalMaterial,贴图走 TextureLab 现烤,
 * 同一 key 全园共享一张 GPU 纹理。
 */

export const CN = {
  /** 粉墙:石灰白,偏暖,绝不是纯白。 */
  plaster: 0xf1ece2,
  plasterStain: 0xb9b2a3,
  /** 黛瓦:青灰偏蓝黑。 */
  tile: 0x3b3f45,
  tileLight: 0x5c6168,
  /** 木作:栗壳色,苏式不用朱红。 */
  wood: 0x8a5a3e,
  woodLight: 0xa8744f,
  /** 第17回折带朱栏板桥专用，不外推为全园木色。 */
  bridgeVermilion: 0x944b40,
  /** 柱:比梁枋再深一档。 */
  column: 0x6e4230,
  /** 青石:台基、驳岸、铺地。 */
  stone: 0x8c8f8a,
  stoneDark: 0x5f625e,
  /** 白石:正门台磯、门枕、抱鼓石。第十七回「下面白石台磯」(07-01),不是青石。 */
  whiteStone: 0xd9d5c8,
  whiteStoneDark: 0xa9a496,
  /** 太湖石:灰白带青,孔洞里深。 */
  taihu: 0xb9b7ad,
  taihuPit: 0x6f6d66,
  /** 竹。 */
  bamboo: 0x6e9a4a,
  bambooNode: 0x8fb56a,
  /** 匾额底:黑漆;字:金。 */
  lacquer: 0x1c1a18,
  gold: 0xc9a84c,
  /** 窗纸。 */
  paper: 0xf4ead4,
} as const;
/** Existing tile atlas: 12 columns at .2m, 19 rows at .26m. Texture scale is
 * a rendering convention, not a historical measurement. */
export const TILE_UV={u:1/(.2*12),v:1/(.26*19)} as const;

/**
 * 材质实例缓存:同一种材质全园只有一个实例,装配器才能按材质把几十个构件
 * 合成几个 draw call。要改某个实例的属性(vertexColors 等)请 clone 再改。
 */
const MAT_CACHE = new Map<string, THREE.Material>();
function memo<T extends THREE.Material>(key: string, make: () => T): T {
  let m = MAT_CACHE.get(key) as T | undefined;
  if (!m) {
    m = make();
    MAT_CACHE.set(key, m);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* 粉墙                                                                */
/* ------------------------------------------------------------------ */

/** 石灰粉墙:细砂质感 + 低处泛潮的水渍 + 偶尔的裂缝。 */
export function plasterMaps(size = 1024): MaterialMaps {
  const h = (u: number, v: number) => {
    const grain = tileableFbm(NOISE.paint, u, v, 120, 3);
    const trowel = tileableFbm(NOISE.paint, u * 0.3 + 7, v * 3, 9, 3);
    return clamp(0.5 + grain * 0.18 + trowel * 0.08, 0, 1);
  };
  return {
    map: cached('cn.plaster.albedo', () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          // v=0 是墙脚:潮渍从下往上淡出。
          const damp = smoothstep(0.42, 0.0, v) * (0.55 + tileableFbm(NOISE.soil, u, v, 5, 3) * 0.45);
          const wear = tileableFbm(NOISE.paint, u, v, 6, 4) * 0.5 + 0.5;
          const base = mixHex(CN.plaster, 0xffffff, 0.15 * (h(u, v) - 0.5));
          const stain = hexToRgb(CN.plasterStain);
          const t = clamp(damp * 0.6 + (1 - wear) * 0.12, 0, 0.7);
          return [lerp(base[0], stain[0], t), lerp(base[1], stain[1], t), lerp(base[2], stain[2], t)];
        },
      }),
    ),
    normalMap: cached('cn.plaster.normal', () => bakeNormalMap({ size, height: h }, 0.9)),
    roughnessMap: cached('cn.plaster.rough', () =>
      bakeScalarMap(512, (u, v) => 0.82 + tileableFbm(NOISE.paint, u, v, 30, 2) * 0.08),
    ),
  };
}

export function plasterMaterial(repeat = 1, vertexColors = false): THREE.MeshStandardMaterial {
  return memo(`plaster:${repeat}:${vertexColors}`, () => {
    const m = plasterMaps();
    const mat = new THREE.MeshStandardMaterial({
      map: m.map,
      normalMap: m.normalMap,
      roughnessMap: m.roughnessMap,
      roughness: 1,
      metalness: 0,
      vertexColors,
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    setRepeat(mat, repeat);
    return mat;
  });
}

/* ------------------------------------------------------------------ */
/* 黛瓦                                                                */
/* ------------------------------------------------------------------ */

/**
 * 小青瓦:江南是仰瓦+盖瓦(筒瓦)交替的瓦垄。这张贴图沿 v 是瓦垄方向,
 * 沿 u 是一垄一垄的起伏;用在屋面时 u 沿檐口、v 沿坡。
 */
export function tileMaps(rows = 12, size = 1024): MaterialMaps {
  const ridge = (u: number, v: number) => {
    const col = u * rows;
    const cf = col - Math.floor(col);
    // 盖瓦圆拱在中间,仰瓦凹槽在两侧。
    const arch = Math.sin(cf * Math.PI);
    // 沿坡每片瓦压前一片,形成台阶。
    const step = ((v * rows * 1.6) % 1);
    const lip = smoothstep(0.0, 0.12, step) * smoothstep(1.0, 0.94, step);
    return { arch, lip, ci: Math.floor(col), ri: Math.floor(v * rows * 1.6) };
  };
  return {
    map: cached('cn.tile.albedo', () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          const { arch, lip, ci, ri } = ridge(u, v);
          const jitter = ((Math.sin(ri * 12.9898 + ci * 78.233) * 43758.5453) % 1 + 1) % 1;
          const moss = smoothstep(0.55, 0.9, tileableFbm(NOISE.grass, u, v, 7, 3) * 0.5 + 0.5) * (1 - arch) * 0.35;
          const c = mixHex(CN.tile, CN.tileLight, arch * 0.55 + jitter * 0.18);
          const m = hexToRgb(0x5e6b3e);
          return [
            lerp(c[0], m[0], moss) * (0.8 + lip * 0.2),
            lerp(c[1], m[1], moss) * (0.8 + lip * 0.2),
            lerp(c[2], m[2], moss) * (0.8 + lip * 0.2),
          ];
        },
      }),
    ),
    normalMap: cached('cn.tile.normal', () =>
      bakeNormalMap(
        {
          size,
          height: (u, v) => {
            const { arch, lip } = ridge(u, v);
            return clamp(arch * 0.7 * lip + 0.15, 0, 1);
          },
        },
        2.4,
      ),
    ),
    roughnessMap: cached('cn.tile.rough', () =>
      bakeScalarMap(512, (u, v) => 0.6 + (tileableFbm(NOISE.stone, u, v, 30, 3) * 0.5 + 0.5) * 0.22),
    ),
  };
}

export function tileMaterial(repeatU = 1, repeatV = 1): THREE.MeshPhysicalMaterial {
  return memo(`tile:${repeatU}:${repeatV}`, () => {
    const m = tileMaps();
    const mat = new THREE.MeshPhysicalMaterial({
      map: m.map,
      normalMap: m.normalMap,
      roughnessMap: m.roughnessMap,
      roughness: 1,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.7,
      side: THREE.DoubleSide,
    });
    setRepeat(mat, repeatU, repeatV);
    return mat;
  });
}

/* ------------------------------------------------------------------ */
/* 木作                                                                */
/* ------------------------------------------------------------------ */

/** 桐油/生漆木:顺 v 的直纹,微微的漆面。 */
export function woodMaps(key: string, tint: number, size = 1024): MaterialMaps {
  const grain = (u: number, v: number) =>
    tileableFbm(NOISE.bark, u * 6, v * 0.25, 36, 4) * 0.5 + 0.5;
  return {
    map: cached(`cn.wood.${key}.albedo`, () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          const g = grain(u, v);
          const wear = tileableFbm(NOISE.paint, u, v, 5, 3) * 0.5 + 0.5;
          const c = mixHex(tint, 0x2a1a12, (1 - g) * 0.35);
          const k = 0.92 + wear * 0.12;
          return [c[0] * k, c[1] * k, c[2] * k];
        },
      }),
    ),
    normalMap: cached(`cn.wood.${key}.normal`, () =>
      bakeNormalMap({ size, height: (u, v) => clamp(0.5 + (grain(u, v) - 0.5) * 0.6, 0, 1) }, 0.8),
    ),
    roughnessMap: cached(`cn.wood.${key}.rough`, () =>
      bakeScalarMap(512, (u, v) => 0.48 + (1 - grain(u, v)) * 0.2),
    ),
  };
}

export function woodMaterial(tint: number = CN.wood, repeat = 1): THREE.MeshPhysicalMaterial {
  return memo(`wood:${tint}:${repeat}`, () => {
    const m = woodMaps(tint.toString(16), tint);
    const mat = new THREE.MeshPhysicalMaterial({
      map: m.map,
      normalMap: m.normalMap,
      roughnessMap: m.roughnessMap,
      roughness: 1,
      metalness: 0,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    setRepeat(mat, repeat);
    return mat;
  });
}

/* ------------------------------------------------------------------ */
/* 石                                                                  */
/* ------------------------------------------------------------------ */

/** 青石:细密的凿痕 + 风化斑。台基、栏杆、驳岸、桥。 */
export function stoneMaps(size = 1024): MaterialMaps {
  const h = (u: number, v: number) => {
    const chisel = tileableFbm(NOISE.stone, u * 5, v * 0.4, 50, 3);
    const pit = tileableFbm(NOISE.stone, u + 3, v, 18, 4);
    return clamp(0.5 + chisel * 0.16 + pit * 0.2, 0, 1);
  };
  return {
    map: cached('cn.stone.albedo', () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          const t = h(u, v);
          const lichen = smoothstep(0.6, 0.95, tileableFbm(NOISE.grass, u * 2, v * 2, 9, 3) * 0.5 + 0.5) * 0.3;
          const c = mixHex(CN.stoneDark, CN.stone, t);
          const l = hexToRgb(0x7c8a5a);
          return [lerp(c[0], l[0], lichen), lerp(c[1], l[1], lichen), lerp(c[2], l[2], lichen)];
        },
      }),
    ),
    normalMap: cached('cn.stone.normal', () => bakeNormalMap({ size, height: h }, 1.6)),
    roughnessMap: cached('cn.stone.rough', () => bakeScalarMap(512, (u, v) => 0.7 + h(u, v) * 0.2)),
  };
}

export function stoneMaterial(repeat = 1, vertexColors = false): THREE.MeshStandardMaterial {
  return memo(`stone:${repeat}:${vertexColors}`, () => {
    const m = stoneMaps();
    const mat = new THREE.MeshStandardMaterial({
      map: m.map,
      normalMap: m.normalMap,
      roughnessMap: m.roughnessMap,
      roughness: 1,
      metalness: 0,
      vertexColors,
    });
    setRepeat(mat, repeat);
    return mat;
  });
}

/** 白石:与青石同一套凿痕高度场,色换成暖白(07-01「白石台磯」),不带青石的苔斑。 */
export function whiteStoneMaps(size = 1024): MaterialMaps {
  const h = (u: number, v: number) => {
    const chisel = tileableFbm(NOISE.stone, u * 5, v * 0.4, 50, 3);
    const pit = tileableFbm(NOISE.stone, u + 3, v, 18, 4);
    return clamp(0.5 + chisel * 0.13 + pit * 0.14, 0, 1);
  };
  return {
    map: cached('cn.whiteStone.albedo', () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          const t = h(u, v);
          const c = mixHex(CN.whiteStoneDark, CN.whiteStone, t);
          return [c[0], c[1], c[2]];
        },
      }),
    ),
    normalMap: cached('cn.whiteStone.normal', () => bakeNormalMap({ size, height: h }, 1.6)),
    roughnessMap: cached('cn.whiteStone.rough', () => bakeScalarMap(512, (u, v) => 0.74 + h(u, v) * 0.16)),
  };
}

export function whiteStoneMaterial(repeat = 1): THREE.MeshStandardMaterial {
  return memo(`whiteStone:${repeat}`, () => {
    const m = whiteStoneMaps();
    const mat = new THREE.MeshStandardMaterial({
      map: m.map,
      normalMap: m.normalMap,
      roughnessMap: m.roughnessMap,
      roughness: 1,
      metalness: 0,
    });
    setRepeat(mat, repeat);
    return mat;
  });
}

/** 太湖石:灰白石灰岩,坑洞里发暗、发青。用三平面投影,不依赖 UV。 */
export function taihuMaps(size = 1024): MaterialMaps {
  const h = (u: number, v: number) => {
    const w = worley(u, v, 14, 5);
    const pits = smoothstep(0.32, 0.05, w.f1);
    const n = tileableFbm(NOISE.stone, u, v, 22, 4) * 0.5 + 0.5;
    return clamp(0.6 + n * 0.3 - pits * 0.5, 0, 1);
  };
  return {
    map: cached('cn.taihu.albedo', () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          const t = h(u, v);
          const c = mixHex(CN.taihuPit, CN.taihu, t);
          const wet = smoothstep(0.7, 0.98, tileableFbm(NOISE.water, u, v, 6, 3) * 0.5 + 0.5) * 0.25;
          const b = hexToRgb(0x6f7d7a);
          return [lerp(c[0], b[0], wet), lerp(c[1], b[1], wet), lerp(c[2], b[2], wet)];
        },
      }),
    ),
    normalMap: cached('cn.taihu.normal', () => bakeNormalMap({ size, height: h }, 2.2)),
    roughnessMap: cached('cn.taihu.rough', () => bakeScalarMap(512, (u, v) => 0.62 + h(u, v) * 0.25)),
  };
}

export function taihuMaterial(): THREE.MeshStandardMaterial {
  return memo('taihu', () => {
    const m = taihuMaps();
    return new THREE.MeshStandardMaterial({
      map: m.map,
      normalMap: m.normalMap,
      roughnessMap: m.roughnessMap,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    });
  });
}

/* ------------------------------------------------------------------ */
/* 竹 / 纸 / 漆                                                        */
/* ------------------------------------------------------------------ */

export function bambooMaterial(): THREE.MeshStandardMaterial {
  return memo('bamboo', () => {
    return new THREE.MeshStandardMaterial({
      color: CN.bamboo,
      roughness: 0.55,
      metalness: 0,
      map: cached('cn.bamboo.albedo', () =>
        bakeColorMap({
          size: 256,
          color: (u, v) => {
            // v 沿竿:竹节是一圈亮环。
            const node = smoothstep(0.03, 0.0, Math.abs(((v * 4) % 1) - 0.5) - 0.44);
            const streak = tileableFbm(NOISE.grass, u * 8, v * 0.5, 20, 2) * 0.5 + 0.5;
            const c = mixHex(CN.bamboo, CN.bambooNode, node * 0.9 + streak * 0.15);
            return c;
          },
        }),
      ),
    });
  });
}

export function paperMaterial(): THREE.MeshStandardMaterial {
  return memo('paper', () => {
    return new THREE.MeshStandardMaterial({
      color: CN.paper,
      roughness: 0.9,
      metalness: 0,
      // P-05: rough window paper needs a soft light lift, not a second render
      // of every opaque object behind the pane.
      emissive: CN.paper,
      emissiveIntensity: 0.18,
      side: THREE.DoubleSide,
      map: cached('cn.paper.albedo', () =>
        bakeColorMap({
          size: 256,
          color: (u, v) => {
            const fiber = tileableFbm(NOISE.fabric, u, v, 40, 3) * 0.5 + 0.5;
            return mixHex(CN.paper, 0xffffff, fiber * 0.1);
          },
        }),
      ),
    });
  });
}

export function lacquerMaterial(color: number = CN.lacquer): THREE.MeshPhysicalMaterial {
  return memo(`lacquer:${color}`, () => {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.28,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
    });
  });
}

export function goldMaterial(): THREE.MeshStandardMaterial {
  return memo('gold', () => {
    return new THREE.MeshStandardMaterial({ color: CN.gold, roughness: 0.35, metalness: 0.85 });
  });
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function setRepeat(mat: THREE.MeshStandardMaterial, ru: number, rv = ru): void {
  for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) {
    if (!t) continue;
    // 同一 key 的贴图是共享的,repeat 不同就 clone 一份 Texture(GPU 纹理仍共享)。
    const c = t.clone();
    c.repeat.set(ru, rv);
    c.needsUpdate = true;
    if (t === mat.map) mat.map = c;
    else if (t === mat.normalMap) mat.normalMap = c;
    else mat.roughnessMap = c;
  }
}
