import * as THREE from 'three';
import {
  bakeColorMap,
  bakeNormalMap,
  bakeScalarMap,
  cached,
  recipeKey,
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
  /**
   * 白石峰:07-03「白石峻嶒」的石灰岩峰。**冷**灰白——比 `taihu`(暖灰绿)冷、
   * 比它亮一档;比 `whiteStone`(暖米白,台磯/门枕的加工面)冷得多,B 通道压过 R,
   * 而 `whiteStone` 是 R>G>B。三者放一起不会认错,也不是大理石(见 `baishiMaps`)。
   */
  baishi: 0xc4c7cc,
  baishiPit: 0x676c74,
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

/**
 * 石灰粉墙:细砂质感 + 偶尔的裂缝。**不带潮渍**(单子 AN2——潮渍原先烤在
 * 贴图 v 里,`wall.ts` 的 `projectUV` 又把 v 按整段墙高铺一次,`smoothstep`
 * 在墙高固定比例处出一条与 repeat 无关的软边,是潇湘馆白墙横色带头号
 * 嫌疑;潮渍改由 `wall.ts` 按构件局部高度写顶点色,与这张贴图脱钩)。
 */
export function plasterMaps(size = 1024): MaterialMaps {
  const h = (u: number, v: number) => {
    const grain = tileableFbm(NOISE.paint, u, v, 120, 3);
    const trowel = tileableFbm(NOISE.paint, u * 0.3 + 7, v * 3, 9, 3);
    return clamp(0.5 + grain * 0.18 + trowel * 0.08, 0, 1);
  };
  return {
    map: cached(recipeKey('cn.plaster.albedo', size), () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          const wear = tileableFbm(NOISE.paint, u, v, 6, 4) * 0.5 + 0.5;
          const base = mixHex(CN.plaster, 0xffffff, 0.15 * (h(u, v) - 0.5));
          const stain = hexToRgb(CN.plasterStain);
          const t = clamp((1 - wear) * 0.12, 0, 0.7);
          return [lerp(base[0], stain[0], t), lerp(base[1], stain[1], t), lerp(base[2], stain[2], t)];
        },
      }),
    ),
    normalMap: cached(recipeKey('cn.plaster.normal', size, 0.9), () => bakeNormalMap({ size, height: h }, 0.9)),
    roughnessMap: cached(recipeKey('cn.plaster.rough', 512), () =>
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
    map: cached(recipeKey('cn.tile.albedo', size), () =>
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
    normalMap: cached(recipeKey('cn.tile.normal', size, 2.4), () =>
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
    roughnessMap: cached(recipeKey('cn.tile.rough', 512), () =>
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
    map: cached(recipeKey(`cn.wood.${key}.albedo`, size), () =>
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
    normalMap: cached(recipeKey(`cn.wood.${key}.normal`, size, 0.8), () =>
      bakeNormalMap({ size, height: (u, v) => clamp(0.5 + (grain(u, v) - 0.5) * 0.6, 0, 1) }, 0.8),
    ),
    roughnessMap: cached(recipeKey(`cn.wood.${key}.rough`, 512), () =>
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

/**
 * 石类贴图的三档尺度(单子 AN2,白石/青石共用同一套约定):
 *
 *   - **米级色块**:`mixHex(暗,亮,h)` 的整体明暗分布——贴图在 `repeat=1` 且
 *     几何 UV 走 `boxProjectedUV`/`projectUV`(1 UV 单位=1 米)时,一张贴图
 *     覆盖约 1 米见方(调用方常传 `repeat>1` 把它压到几十厘米一格,见各
 *     construct site 的 `repeat`/`uScale`)。
 *   - **厘米级加工**:`chisel`(凿痕/刨子纹,`tileableFbm` 频率 50、u:v 拉伸
 *     比不同档不同)与 `pit`(疏密点蚀,频率 18)——在 1 米贴图里分别是
 *     约 2cm、5.5cm 一个周期,是"看得出工具走向"的那一层。
 *   - **毫米级微表面**:`bakeNormalMap` 的 `strength`(无量纲,乘在 Sobel
 *     斜率上)——数值越大,同一高度场读出的法线扰动越猛,视觉上对应几毫米
 *     级的粗糙感;白石 fine 档把它降到粗档的 1/3(见 `whiteStoneMaps`)。
 */

/** 青石:细密的凿痕 + 风化斑。台基、栏杆、驳岸、桥。
 *  AN2:凿痕(chisel)幅度降一档——踏面「大面平整」,不该处处是刨子纹;
 *  疏密点蚀(pit)与苔斑不动。不做边缘圆磨(那是几何倒角的事,不归贴图管)。 */
export function stoneMaps(size = 1024): MaterialMaps {
  const h = (u: number, v: number) => {
    const chisel = tileableFbm(NOISE.stone, u * 5, v * 0.4, 50, 3);
    const pit = tileableFbm(NOISE.stone, u + 3, v, 18, 4);
    return clamp(0.5 + chisel * 0.1 + pit * 0.2, 0, 1);
  };
  return {
    map: cached(recipeKey('cn.stone.albedo', size), () =>
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
    normalMap: cached(recipeKey('cn.stone.normal', size, 1.6), () => bakeNormalMap({ size, height: h }, 1.6)),
    roughnessMap: cached(recipeKey('cn.stone.rough', 512), () => bakeScalarMap(512, (u, v) => 0.7 + h(u, v) * 0.2)),
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

/**
 * 白石:色换成暖白(07-01「白石台磯」),不带青石的苔斑。两档加工尺度
 * (单子 AN2,codex 评审 §3.1——白石与青石此前共用同一套各向异性凿痕,
 * 鼓面、台面、阶条石全读成刨子纹):
 *
 *   - **fine(细磨面,默认)**:各向同性弱颗粒——`chisel`/`pit` 的 u/v 采样
 *     频率相同(不拉伸),不留方向性刀痕;法线幅度是 rough 档的 1/3;
 *     粗糙度压平到 0.55 一档(细磨面反光均匀,不该像粗石那样随高度起伏)。
 *     全仓不传 `finish` 的既有调用(`building.ts` 台基、`forecourt-terrace.ts`
 *     面层与阶条)自动吃到这一档。
 *   - **rough(粗档)**:保留旧的各向异性凿痕参数不变,给鼓帮、须弥座束腰、
 *     台矶陡板这类"看得出砌筑/雕凿走向"的立面。
 */
export function whiteStoneMaps(size = 1024, finish: 'fine' | 'rough' = 'fine'): MaterialMaps {
  const rough = finish === 'rough';
  const h = (u: number, v: number) => {
    const chisel = rough
      ? tileableFbm(NOISE.stone, u * 5, v * 0.4, 50, 3)
      : tileableFbm(NOISE.stone, u * 2.4, v * 2.4, 40, 3);
    const pit = tileableFbm(NOISE.stone, u + 3, v, 18, 4);
    return clamp(0.5 + chisel * (rough ? 0.13 : 0.045) + pit * (rough ? 0.14 : 0.05), 0, 1);
  };
  const normalStrength = rough ? 1.6 : 1.6 / 3;
  return {
    map: cached(recipeKey(`cn.whiteStone.${finish}.albedo`, size), () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          const t = h(u, v);
          const c = mixHex(CN.whiteStoneDark, CN.whiteStone, t);
          return [c[0], c[1], c[2]];
        },
      }),
    ),
    normalMap: cached(recipeKey(`cn.whiteStone.${finish}.normal`, size, normalStrength), () =>
      bakeNormalMap({ size, height: h }, normalStrength),
    ),
    roughnessMap: cached(recipeKey(`cn.whiteStone.${finish}.rough`, 512), () =>
      bakeScalarMap(512, (u, v) => (rough ? 0.74 + h(u, v) * 0.16 : 0.55 + (h(u, v) - 0.5) * 0.06)),
    ),
  };
}

export function whiteStoneMaterial(repeat = 1, finish: 'fine' | 'rough' = 'fine'): THREE.MeshStandardMaterial {
  return memo(`whiteStone:${repeat}:${finish}`, () => {
    const m = whiteStoneMaps(1024, finish);
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

/**
 * 虎皮石:不规则杂色毛石乱砌,缝是灰浆的浅色网(07-02「下面虎皮石,隨勢砌去」)。
 * 颜色就地取青石/白石两组既有色按石块分派,不新引颜色(一园一色)。
 *
 * P-07 教训:石块尺度要先按屏幕像素算,不能凭感觉调。这里沿用全园"石类贴图
 * 1.4m 一个周期"的既有换算的**两倍**(2.8m,wall.ts 的 projectUV 同步传 2.8);
 * CELLS=14 意味着单块石头仍约 0.2m,不会被 mipmap 拍成灰板。
 *
 * A2(2026-09-14):远处读成规则锯齿带,根因不是"看不见"(25m 处石块仍有 ~4px),
 * 是"太规则"——①worley 的 cell id 相邻相关,w.id%4 分色在 53m 墙上同相位重复;
 * ②整周期 mip 平均后底色处处相同,读成"一条带"。对症:CELLS 翻倍把周期拉大一倍、
 * 分色走 hash 打散相邻相关、再叠一层跨周期的低频明度斑块让远看的底色不均匀。
 */
export function tigerSkinMaps(size = 1024): MaterialMaps {
  const CELLS = 14;
  const cell = (u: number, v: number) => worley(u, v, CELLS, 4109);
  const jointT = (w: { f1: number; f2: number }) => smoothstep(0, 0.05, w.f2 - w.f1);
  // 乱砌:大小不一、形状不规则、颜色深浅斑驳——"虎皮"二字的来处。
  const PALETTE = [CN.stone, CN.stoneDark, CN.whiteStone, CN.whiteStoneDark];
  const mortar = CN.plasterStain; // 灰浆的浅色网,比石块本身更亮更暖
  // cell id 是相邻相关的,直接取模分色会在大墙上读成同相位的重复带。
  const hash = (id: number): number => {
    let x = (id * 2654435761) >>> 0;
    x ^= x >>> 15;
    x = (x * 2246822519) >>> 0;
    x ^= x >>> 13;
    return x >>> 0;
  };
  // 跨周期的低频明度斑块(约 2.6 个循环/周期):mip 把细节平均掉之后,
  // 底色本身不再均匀,远处就 read 不出"一条规则的带"。
  const blotch = (u: number, v: number) => tileableFbm(NOISE.stone, u * 2.6 + 7.3, v * 2.6, 31, 2);
  const h = (u: number, v: number) => {
    const w = cell(u, v);
    const bulge = tileableFbm(NOISE.stone, u * CELLS * 1.6 + (hash(w.id) % 977) * 0.01, v * CELLS * 1.6, 40, 3);
    return clamp(0.42 + jointT(w) * 0.34 + bulge * 0.14 + (blotch(u, v) - 0.5) * 0.1, 0, 1);
  };
  return {
    map: cached(recipeKey('cn.tigerSkin.albedo', size), () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          const w = cell(u, v);
          const joint = jointT(w);
          const idHash = hash(w.id);
          const base = PALETTE[idHash % PALETTE.length];
          const shade = tileableFbm(NOISE.stone, u * CELLS * 1.1, v * CELLS * 1.1, 22, 3) * 0.5 + 0.5;
          // 每块石头再按 hash 抖一点明度,同色的两块也不重样。
          const jitter = ((idHash >>> 8) % 1000) / 1000 - 0.5;
          const stoneC = mixHex(base, shade + jitter * 0.6 > 0.5 ? 0xffffff : 0x000000,
            clamp(Math.abs(shade + jitter * 0.6 - 0.5) * 0.2 + (blotch(u, v) - 0.5) * 0.16, 0, 0.3));
          const mc = hexToRgb(mortar);
          return [
            lerp(stoneC[0], mc[0], 1 - joint),
            lerp(stoneC[1], mc[1], 1 - joint),
            lerp(stoneC[2], mc[2], 1 - joint),
          ];
        },
      }),
    ),
    normalMap: cached(recipeKey('cn.tigerSkin.normal', size, 1.9), () => bakeNormalMap({ size, height: h }, 1.9)),
    roughnessMap: cached(recipeKey('cn.tigerSkin.rough', 512), () =>
      bakeScalarMap(512, (u, v) => lerp(0.86, 0.66, jointT(cell(u, v)))),
    ),
  };
}

export function tigerSkinMaterial(repeat = 1): THREE.MeshStandardMaterial {
  return memo(`tigerSkin:${repeat}`, () => {
    const m = tigerSkinMaps();
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
    map: cached(recipeKey('cn.taihu.albedo', size), () =>
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
    normalMap: cached(recipeKey('cn.taihu.normal', size, 2.2), () => bakeNormalMap({ size, height: h }, 2.2)),
    roughnessMap: cached(recipeKey('cn.taihu.rough', 512), () => bakeScalarMap(512, (u, v) => 0.62 + h(u, v) * 0.25)),
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

/**
 * 白石峰:07-03「白石峻嶒」的石灰岩峰身。与太湖石同一套机制(三平面投影、
 * 顶点色 AO 相乘),不同的是三件事——**这三件就是"不做成大理石"的全部内容**:
 *
 *   1. **色**:`CN.baishi`/`CN.baishiPit` 是冷灰白,不是 `whiteStone` 的暖米白。
 *   2. **纹**:主纹理是沿 v 拉长的层理条纹(`streak`,u:v 频率比约 6:1)。
 *      三平面投影里侧立面的 v 就是世界竖向,所以这层读作**竖着走的皱**
 *      ——与几何上的竖棱/凿沟同向。孔蚀(`worley`)只留太湖石的三分之一强度:
 *      白石是石灰岩峰,不是湖石的漏透。**不做贯通的脉纹**——一见脉就是大理石。
 *   3. **糙**:粗糙度 0.78–0.96(太湖石是 0.62–0.87),`roughness: 1` 打底、
 *      不加 clearcoat。磨光的白石是大理石,粗糙的白石才是山石。
 */
export function baishiMaps(size = 1024): MaterialMaps {
  const h = (u: number, v: number) => {
    // 层理:u 方向密、v 方向疏 —— 竖向的长条纹。
    // u/v 乘数必须是整数(tileableFbm 把 u→u·2π 映射到环面上做无缝包裹,
    // 非整数乘数会在纹理接缝处留下断层);6:1 的各向异性靠降低基频(46→8)
    // 而不是靠非整数乘数来维持同样的观感比例。
    const streak = tileableFbm(NOISE.stone, u * 6, v * 1, 8, 3);
    const grain = tileableFbm(NOISE.stone, u + 5, v, 26, 4);
    const pits = smoothstep(0.2, 0.04, worley(u, v, 9, 7109).f1);
    return clamp(0.56 + streak * 0.22 + grain * 0.14 - pits * 0.2, 0, 1);
  };
  return {
    map: cached(recipeKey('cn.baishi.albedo', size), () =>
      bakeColorMap({
        size,
        color: (u, v) => {
          const t = h(u, v);
          const c = mixHex(CN.baishiPit, CN.baishi, t);
          // 潮痕:同一石种里的冷调低频斑,不引绿——苔色是单子 AM4 的事。
          const damp = smoothstep(0.66, 0.98, tileableFbm(NOISE.water, u, v, 5, 3) * 0.5 + 0.5) * 0.16;
          const d = hexToRgb(0x93a0a3);
          return [lerp(c[0], d[0], damp), lerp(c[1], d[1], damp), lerp(c[2], d[2], damp)];
        },
      }),
    ),
    normalMap: cached(recipeKey('cn.baishi.normal', size, 2.0), () => bakeNormalMap({ size, height: h }, 2.0)),
    roughnessMap: cached(recipeKey('cn.baishi.rough', 512), () => bakeScalarMap(512, (u, v) => 0.78 + h(u, v) * 0.18)),
  };
}

/** 白石峰材质。顶点色开着:`buildStone` 把 cavity AO 与脚下泛青烤进 `color` 属性,
 *  关掉它整块石头就变成一张均匀的浅灰板。 */
export function baishiMaterial(): THREE.MeshStandardMaterial {
  return memo('baishi', () => {
    const m = baishiMaps();
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
      map: cached(recipeKey('cn.bamboo.albedo', 256), () =>
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
      map: cached(recipeKey('cn.paper.albedo', 256), () =>
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
