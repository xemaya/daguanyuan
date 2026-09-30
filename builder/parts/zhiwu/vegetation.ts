import { applyCanopyShadow } from './foliage-materials';
import {allPlanLinears} from '@builder/plan/linears';
import * as THREE from 'three';
import { positionWorld, vec2, vec3, mix, add, mx_fractal_noise_float } from 'three/tsl';
import { BoundsIndex, polygonNearIndex } from '@engine/scatter/cluster';
import {compileCorridor} from '@builder/plan/corridor-path';
import {compileBridgePath} from '@builder/plan/bridge-path';
import {locatePoint,type Point2} from '@builder/plan/geometry';
import {bedsFromPlan} from '@builder/plan/objects';
import type { GameContext } from '@engine/core/Context';
import { Simplex, fbm2, makeRng, rangeOf, clamp, smoothstep, lerp } from '@engine/core/Noise';
import { poissonScatter, scatterHash01, DensityMask, makeInstanced, ClusteredInstancePool, distanceToPolyline, instanceWindPadding } from '@engine/scatter/index';
import { cached, recipeKey } from '@engine/core/TextureLab';
import { LatticeMask, blocksOver, blockRect, blockHash, latticeHash01, insideRect, rectWithin, splitRng, type BlockKey, type Rect } from '@engine/scatter/blocks';
import { metaSurface, noiseDisplace, boxProjectedUV, type Ball } from '@builder/parts/sculpt';
import {
  createFoliageMaterial,
  leafMaps,
  barkSet,
  litterTexture,
  grassCardTexture,
  leafCardTexture,
  leafClusterTexture,
  canopyPerforationMap,
  petalMaps,
  taperedTube,
  curvedCard,
  twigCluster,
  mergeGeos,
  setFlex,
  bakeCanopyShading,
} from './foliage-materials';
import { occupancyFree, occupancyDistance, getOccupancy, type OccupancyField } from '@builder/compose/occupancy';
import { baishiCrownPoints } from '@builder/parts/shishan/baishi';
import { registerObject } from '@builder/compose/roster';
import { TERRAIN, getPlan } from '@builder/compose/terrain';
import { getScenes } from '@builder/compose/scenes';
import { makeGrassCoverField } from '@builder/compose/grass-cover';
import { BARK_SETS, LEAF_SETS } from '@builder/compose/texture-jobs';
import {
  bananaClusterGeometry,
  wisteriaDrapeGeometry,
  mossPatchGeometry,
  pearBlossomGeometry,
  bankFlowerGeometry,
} from './garden-plants';
/** Formerly the tall-grass encounter mask; the garden has none, so everything is clear. */
const wildGrassClearance = (_x: number, _z: number, _pad = 0): number => 1;

/**
 * Vegetation — 大观园四区的活物。
 *
 * Three ideas carry the whole system:
 *
 *  1. **A tree is a swept spine, not a cylinder.** Trunks are tubes along a
 *     leaning Catmull-Rom curve with a radius function that flares into root
 *     buttresses at the base and tapers to nothing at the crown, plus limbs
 *     grown off the same curve. Canopies are metaball clusters — five to eight
 *     overlapping blobs fused into one skin and then noise-displaced — so the
 *     silhouette is lumpy and asymmetric from every angle. PQ-5c: 树种已从
 *     pallet-town-3d 的温带森林（橡/桦/梣）换成 plan.json 植物清单里游线
 *     点名的几种（古松横展、堤柳下垂、梨花白冠），换的是参数与一个新增的
 *     `droop` 自由度，骨架不动。种什么由 region 定，不再是全场同一个
 *     洗牌分布。
 *
 *  2. **Foliage is a lighting problem, not a modelling problem.** See
 *     `foliage-materials.ts`: wrapped diffuse, shadow-correct back-lit
 *     transmission, and interior occlusion baked into vertex colours. A canopy
 *     without those three reads as a painted ball no matter how good its
 *     silhouette is.
 *
 *  3. **The ground is never empty.** Grass, clover, flowers and weeds are
 *     scattered against a baked plantability grid so nothing grows on the path,
 *     the forecourt, inside a building footprint or below the waterline.
 *     PQ-5b: 草从单一抖动网格改成三个互质周期、各自转过角度的抖动网格叠加
 *     （单网格的俯视周期是肉眼最先抓到的东西），再用低频噪声把密度压出
 *     斑块——疏处让地表露出来。露土的**着色**不归本单（WG 之后的 PQ 着色半）。
 *
 *  芭蕉、垂蔓、苔斑与两种花型（梨花、隔岸花）的几何在
 *  `./garden-plants.ts`；本文件只管材质、散布与装配。
 */

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/**
 * **D-37：旧窗口钉死。** 散布域曾经就是 `TERRAIN` 窗口内缩 2 m（P1 Task 6），于是
 * 窗口一变——BA1 稻香村入建成，270×218 → 357×376 m——Bridson 的飞镖流从新的一角撒起，
 * 全园每一株都换了位置（灌木 352 丛 0 丛原位，冻结的正门 60 m 内 73 → 46）。
 *
 * 下面两组数是 **`719171d0`（BA0 落地、四区建成）那一刻的窗口**，由
 * `terrainWindow(plan@719171d0, [cuizhang, qinfang_ting_qiao, xiaoxiangguan, zhengmen], 15, 0.48)`
 * 实算：`{minX:-160, maxX:110, minZ:43, maxZ:261}`，内缩 2 m 即旧散布盒。
 * 这个盒子里的一切散布按**原原点、原参数、原调用顺序**照旧撒——四区逐位不变；
 * 盒子外、当前窗口内的地走 `EXT_BLOCK` 世界对齐分块（见 `@engine/scatter/blocks`）。
 * **这两组数永远不许跟着区数改**——改了就是把全园再洗一遍。
 */
const LEGACY_WINDOW = { minX: -160, maxX: 110, minZ: 43, maxZ: 261 } as const;
const LEGACY_SCATTER: Rect = { minX: -158, maxX: 108, minZ: 45, maxZ: 259 };
/** 旧窗口那张植物掩码的烘焙域：就是旧窗口本身（原来是 `TERRAIN` 的四个数）。 */
const LEGACY_MASK_BOUNDS = { minX: LEGACY_WINDOW.minX, minZ: LEGACY_WINDOW.minZ, width: 270, depth: 218 } as const;
/**
 * 块边长 32 m（`D-37`）。取法：
 *   - 要比最大的散布半径（灌木丛心 8.5 m）大三倍以上，块内的泊松才撒得饱，块边的接缝才是少数；
 *   - 又不能太大：加一个区时，与新窗口相交的块整块算，块越大白算的窗口外面积越多；
 *   - 32 = 1024 m²，是旧散布盒（266×214 = 56 924 m²）的 1.8%，各层的飞镖数按这个面积比缩（见 `extTries`）。
 * 草不用这个块：草是逐格点哈希的抖动格网，天生与原点无关，只按 13 m 的世界对齐草块分网格。
 */
const EXT_BLOCK = 32;
/**
 * 单子 BC1:树换远景档的水平距离,米。BC0 剖析(`shots/BC/bc0-profile-*.json`):四镜关掉「包围球心 120 m 外」
 * 的树,帧成本 −2.40 / −1.35 / −0.15 / −0.90 ms、三角 −2.04M / −1.73M / −1.95M / −0.71M,是四镜里最贵的一类;
 * 120 m 处 1600×900、FOV 62° 一个像素 ≈ 0.16 m,缘叶卡(0.3–1 m)只剩两到六个像素,远景档的冠面与卡数够用。
 */
const TREE_FAR_M = 120;
/** 块外的草块边长（世界对齐 k·13 m）：与旧草块同一个 13 m，理由见 `VEG.chunk`。 */
const EXT_GRASS_CHUNK = 13;
/** 块里用的世界格点掩码格距，米。旧掩码是 270/256 × 218/288 = 1.05 × 0.76 m，取 1 m 同一量级。 */
const EXT_MASK_STEP = 1;
const inLegacy = (x: number, z: number): boolean => insideRect(LEGACY_SCATTER, x, z);
const inLegacyWindow = (x: number, z: number): boolean =>
  x >= LEGACY_WINDOW.minX && x <= LEGACY_WINDOW.maxX && z >= LEGACY_WINDOW.minZ && z <= LEGACY_WINDOW.maxZ;
/** 旧散布盒的飞镖数按面积折到一块上：`round(旧 tries × 块面积 / 旧盒面积)`，至少 1。 */
const extTries = (legacyTries: number, legacyRect: Rect = LEGACY_SCATTER): number =>
  Math.max(1, Math.round(legacyTries * (EXT_BLOCK * EXT_BLOCK) /
    ((legacyRect.maxX - legacyRect.minX) * (legacyRect.maxZ - legacyRect.minZ))));

const VEG = {
  /**
   * **当前**窗口内缩 2 m——只拿来给块里撒出来的点**事后裁边**（块整块撒，窗口外的扔掉），
   * 不再是任何一层散布的撒点域。旧窗口那一段一律读 `LEGACY_SCATTER`（D-37）。
   * 改过名（原 `scatterMin*`），免得哪一处漏改的旧写法编译通过、悄悄又跟窗口走。
   */
  get curMinX() { return TERRAIN.minX + 2; },
  get curMaxX() { return TERRAIN.maxX - 2; },
  get curMinZ() { return TERRAIN.minZ + 2; },
  get curMaxZ() { return TERRAIN.maxZ - 2; },
  /** Grass chunk edge, metres. Trades draw calls against cull granularity. */
  chunk: 13,
  /** Everything beyond this from the camera is hidden. */
  cullRadius: 41,
  /**
   * 草丛散布网格的基准周期，米。PQ-5b：实际散布用三个互质周期的旋转网格
   * 叠加（见 buildVegetation 的 GRASS_LATTICES），此值只作远景稀化的参照。
   */
  grassCell: 0.32,
  /** Minimum ground height a plant may sit at. Water is at y = 0. */
  minPlantY: 0.2,

  /**
   * Per-category draw distance, metres.
   *
   * These are not "how far can you see a plant" — they are "how far away does a
   * plant stop contributing a pixel". A clover leaf is 5cm across: past ~20m it
   * is comfortably sub-pixel and every one of its 21 triangles is spent drawing
   * nothing. A grass tuft is 30cm and holds up until the turf texture takes
   * over. Trees and bushes have no distance cut at all — they are silhouette,
   * and a tree vanishing at the treeline would be instantly visible.
   */
  drawDist: {
    grass: 26,
    clover: 16,
    flowers: 27,
    weeds: 23,
  },
} as const;

/**
 * Building footprints to keep clear, derived from the terrain's flat pads.
 * Slightly inset from the pad so plants still crowd right up against the walls
 * — a bare halo around a house looks like a bug, a bush touching the cladding
 * looks like a garden.
 */
/**
 * P1 Task 6: these are the same clearance boxes as before, each translated
 * by its cluster's delta (see `builder/compose/composer.ts` — the same four
 * constants, kept in sync there because that's where the SCENE placements
 * that these footprints have to match actually live).
 */
/* 单子 Z:手抄的 FOOTPRINTS 表已删(missing 99-25)。占位改读 occupancy.ts
 * 那一份真源——它从 plan 的 construction.spec 编译檐口外包络,所以**房子一挪,
 * 树自己让开**,不需要回来改任何表。实测手抄的那份还漏算了出檐与铺作出跳:
 * 正门的真实占地是 h=(10.0,6.1),手抄写的是 (7.4,3.2),树本来能长进檐下。 */

/**
 * Hand-placed hero trees, keyed by species. P1 Task 6: repositioned by the same
 * cluster deltas as `composer.ts`'s SCENE. PQ-5c: 换成大观园的树种——翠嶂
 * 石间是古松与老槐，正门外两株古松（「门前古松」，门外净空故只点两株），
 * 沁芳池岸的柳由 `plantBankWillows` 从 plan.json 的水系岸线读出来，
 * 潇湘馆后院的大株梨花单独落位。
 */
/* 单子 AV2:翠嶂那五棵(松 (-4.9,197.8)/(19.4,201.4)/(19.4,209.2)、槐 (-2.2,208.4)、
 * 柏 (-6.4,205.2))从这张表里删掉,搬进 `projects/daguanyuan/scenes/cuizhang.json`
 * 的 `trees[]` 重排。理由不是「数据比代码好」这种口号:这五棵是**对着某一组峰**
 * 落的位(松探石、槐收脚),而峰住在 scenes 里;分家两处的结果就是 AM2 把峰群
 * 换了位置、这五棵还留在旧主组周围,谁也没发现。剩下的三棵(潇湘馆院外的槐、
 * 正门前两株古松)各自贴着自己的建筑,留在这里不碍事;哪天它们也要跟着某个
 * 构件走,照同一条路搬。 */
const HERO_TREES: [number, number, string][] = [
  // x, z, species key
  [-126.6, 110, 'locust'], // xiaoxiang 院外
  [40.5, 244.2, 'pine-old'], // 正门前东侧
  [69.5, 244.2, 'pine-old'], // 正门前西侧
  // 潇湘馆后院：「有大株梨花兼著芭蕉」（第十七回）。在房屋台基与引泉沟之间落位。
  [-108, 84.5, 'pear'],
];

/* ------------------------------------------------------------------ */
/* 按区选种                                                            */
/* ------------------------------------------------------------------ */

/**
 * 园子长什么由 `plan.json` 的 `regions[].plants` 定，不再全场一副牌洗匀。
 *
 * 这里只列**已经做了几何的种**与区域的对应；清单里有而骨架还没做的
 * （桂花、梧桐、荷、芦苇……）用最接近的已有种落代，落代关系逐条记在
 * `knowledge/docs/plants/00-catalog.md` 的 open_questions 里，不算考据结论。
 * `mix: []` 是硬约束：蘅芜苑「一株花木也无」，芦苇荡不长树。
 */
const REGION_TREES: Record<string, { mix: string[]; density: number }> = {
  zhengmen: { mix: ['pine-old'], density: 0.18 }, // 门前古松,净空
  cuizhang: { mix: ['pine-old', 'locust', 'locust'], density: 1 },
  qinfang_ting_qiao: { mix: ['willow', 'willow', 'peach'], density: 1 },
  xiaoxiangguan: { mix: ['pear', 'locust'], density: 1 },
  // 单子 BA4:以杏为主(07-11「有幾百株杏花,如噴火蒸霞一般」),榆仍代桑榆槿柘。成片的杏林不走这张牌堆,
  // 另在泥墙与茅屋之间按林带撒(见 buildVegetation 的 APRICOT_GROVE);这里管的是区内其余散布树。
  daoxiangcun: { mix: ['apricot', 'apricot', 'apricot', 'elm'], density: 1 }, // 杏花如霞 + 桑榆槿柘
  hengwuyuan: { mix: [], density: 0 }, // 一株花木也无
  yihongyuan: { mix: ['haitang', 'willow', 'peach'], density: 1 },
  shengqin_biesu: { mix: ['cypress', 'pine-old'], density: 1 }, // 青松拂檐
  ouxiangxie: { mix: ['elm'], density: 0.8 }, // 桂花→常绿阔叶近似
  zilingzhou: { mix: [], density: 0 }, // 菱蓼芦苇,水生
  qiushuangzhai: { mix: ['locust'], density: 1 }, // 梧桐→槐形近似
  longcuian: { mix: ['cypress', 'peach'], density: 1 }, // 青松 + 红梅(花色近似)
  tubi_aojing: { mix: ['elm'], density: 0.8 }, // 桂→常绿阔叶近似
  nuanxiangwu: { mix: ['peach'], density: 0.7 }, // 腊梅→粉花小乔木近似
  qinfangzha: { mix: ['peach', 'willow'], density: 1 }, // 桃花 + 柳
  liaoting_huaxu: { mix: ['willow', 'willow', 'peach'], density: 1 }, // 垂柳杂桃杏
  luxueguang: { mix: [], density: 0 }, // 四面芦苇
  jiayintang: { mix: ['locust', 'elm'], density: 1 }, // 老槐 + 桂(近似)
  huajia_huapu: { mix: ['pear'], density: 0.5 },
};

/**
 * **按区调通用野花**（单子 AL4）。0 = 这个区一株草甸野花都不长，1 = 照旧。
 * 没写的区默认 1，行为一个字不动。
 *
 * 为什么要有它：下面那个野花散布器的 `density` **完全不认区**——它那两项
 * `green` / `skirt` 还是 pallet-town 的镇中心坐标（`smoothstep(16,4,hypot(x,z-6))`
 * 那一段，`P` 系列遗留，本单不顺手改，标准动作第 13 条，记在回报里）。于是
 * 潇湘馆院内长出 142 株草甸野花，而 `07-41` 那一段只点了竹、苔、石子三样，
 * `07-07` 加梨与蕉——**没有草甸野花**。
 *
 * ⚠️ 系数**不是乘进 `density` 的**。`poissonScatter` 的非 hash 档是
 * `dens <= 0.001 || rng() > dens`：密度一旦被乘成 0，那一发顺序 `rng` 就不吃了，
 * 整条飞镖流后移，**全园野花重洗一遍**（`P-28`，AV2 那次 89 棵消失 / 92 棵新出现
 * 就是这么来的）。而本单的判据写着「院外照旧」。所以系数落在**撒完点之后的
 * 逐株筛子**上，用坐标哈希判、不吃 rng：院内的筛掉，院外的一株不动。
 */
/**
 * 花池里那朵花的花冠尺度（单子 AL4，用户 2026-09-21 拍板 `D-30`「改素色**小**花」）。
 *
 * 花池与自然散布共用同一个 `flowerGeometry`，而那朵花是按「草甸里隔几米一丛」
 * 画的：`cu_xx_path` 贴脸实测花冠直径约 0.4m，在 1.0m 净宽的羊肠路边上，
 * 三朵就横满半条路，读成「草地雏菊」。0.62 把它收到约 0.25m——路边花池里的
 * 素花，不是草地上的大雏菊。只作用在花池那一档，自然散布的花一个字不动。
 */
const BED_FLOWER_SCALE = 0.62;

const REGION_GROUND_FLOWERS: Record<string, number> = {
  // 07-41「土地下蒼苔布滿，中間羊腸一條石子漫的路」+ 兩邊翠竹——竹、苔、石子三样；
  // 07-07 再加大株梨花与芭蕉。原文没有草甸野花，这一景的性格是「幽」。
  xiaoxiangguan: 0,
};

/**
 * **院内按区压三叶草 / 杂草**（单子 AL-b b5，用户 2026-09-23 拍板 `D-32` ④）。
 * 0 = 院内一株不留，1 = 照旧；没写的区不压。
 *
 * 为什么要有它：潇湘馆院内地形的 `moss` 早已是苔地（均值 0.724），可 `Clover` 992、
 * `Weeds_*` 183 照样满地长——它们的密度来自 `mask`（`surfaceAt === "grass"` 的四分类），
 * 与 `moss` 无关，院子于是读成亮绿草坪（§6 未决 6）。`D-32` 不给 `surface()` 加苔档，
 * 只按区压。
 *
 * 与 `REGION_GROUND_FLOWERS` 同一个做法，但有两处不同，都是为了「院外逐株不变」：
 *   - **作用范围是院墙（该区带 `mossInside` 的线性）以内**，不是 plan 的区多边形——
 *     潇湘馆的区多边形比院墙大一圈，按区多边形筛，墙外那圈草也会被压；
 *   - **筛在「整批实例都生成完之后」**：三叶草与杂草的每株体量、朝向、色偏、风相位
 *     都吃同一条顺序 rng（`makeInstanced` 按株数吃风相位），在撒点那一层 `continue`
 *     会让院外每一株之后的样子全错位。所以照旧全量生成，再把留下的株连同矩阵、颜色、
 *     风相位原样搬进一只新的 InstancedMesh（`keepInstances`）。
 * 系数落在坐标哈希上，不乘 `density`、不动 rng（`P-28` / `P-33`）。
 *
 * `xiaoxiangguan` 的值：三叶草 0.12（992 → 约 120，判据 ≤150）、杂草 0.25（183 → 约 45，
 * 判据 ≤60）。不取 0：苍苔地里零星一点三叶草与书带草是「幽」，一株不剩反而像刚除过草。
 */
const REGION_COURT_GROUND: Record<string, { clover: number; weeds: number }> = {
  xiaoxiangguan: { clover: 0.12, weeds: 0.25 },
};

let courtPolys: { id: string; poly: readonly (readonly [number, number])[] }[] | null = null;

/** 院内按区系数筛子：这一株留不留（`kind` 决定取哪一列、哈希加哪个盐）。 */
function keepInCourt(x: number, z: number, kind: 'clover' | 'weeds'): boolean {
  if (!courtPolys) {
    courtPolys = [];
    const regions = (getPlan() as { regions?: { id: string; linears?: { mossInside?: boolean; points?: [number, number][] }[] }[] }).regions ?? [];
    for (const r of regions) {
      if (!REGION_COURT_GROUND[r.id]) continue;
      for (const l of r.linears ?? []) if (l.mossInside && l.points && l.points.length > 2) courtPolys.push({ id: r.id, poly: l.points });
    }
  }
  for (const c of courtPolys) {
    if (locatePoint(c.poly, [x, z]) === 'outside') continue;
    const k = REGION_COURT_GROUND[c.id][kind];
    if (k <= 0) return false;
    if (k >= 1) return true;
    return scatterHash01(x + (kind === 'clover' ? 29.1 : -17.3), z + (kind === 'clover' ? -8.9 : 5.3)) < k;
  }
  return true;
}

/**
 * 只留 `keep` 为真的那几株，矩阵 / 颜色 / 实例属性（风相位）原样搬过去（AL-b b5）。
 * 一株不删就原样返回，行为一个字节不动。
 */
function keepInstances(mesh: THREE.InstancedMesh, keep: boolean[]): THREE.InstancedMesh {
  const kept = keep.reduce((n, k) => n + (k ? 1 : 0), 0);
  if (kept === mesh.count) return mesh;
  const g = mesh.geometry;
  for (const [name, attr] of Object.entries(g.attributes)) {
    const a = attr as THREE.InstancedBufferAttribute;
    if (!a.isInstancedBufferAttribute) continue;
    const Ctor = a.array.constructor as new (n: number) => typeof a.array;
    const arr = new Ctor(kept * a.itemSize);
    let j = 0;
    for (let i = 0; i < mesh.count; i++) {
      if (!keep[i]) continue;
      for (let c = 0; c < a.itemSize; c++) arr[j * a.itemSize + c] = a.array[i * a.itemSize + c];
      j++;
    }
    g.setAttribute(name, new THREE.InstancedBufferAttribute(arr, a.itemSize, a.normalized, a.meshPerAttribute));
  }
  const out = new THREE.InstancedMesh(g, mesh.material, kept);
  out.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let j = 0;
  for (let i = 0; i < mesh.count; i++) {
    if (!keep[i]) continue;
    mesh.getMatrixAt(i, m);
    out.setMatrixAt(j, m);
    if (mesh.instanceColor) {
      mesh.getColorAt(i, c);
      out.setColorAt(j, c);
    }
    j++;
  }
  return out;
}

/** 区域之外的背景混交：园子里不出橡/桦/梣/枫那一套温带森林。 */
const FALLBACK_MIX = ['elm', 'elm', 'locust', 'cypress', 'pine-old'];

interface RegionPoly {
  id: string;
  poly: readonly (readonly [number, number])[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

let regionPolys: RegionPoly[] | null = null;

/** plan.json 的 region 轮廓是闭合折线,世界坐标与 plan 坐标同一套(P1 Task 6)。 */
function regionOf(x: number, z: number): string | null {
  if (!regionPolys) {
    regionPolys = [];
    const regions = (getPlan() as { regions?: { id: string; polygon?: [number, number][] }[] }).regions ?? [];
    for (const r of regions) {
      if (!r.polygon || r.polygon.length < 3) continue;
      const xs = r.polygon.map((p) => p[0]);
      const zs = r.polygon.map((p) => p[1]);
      regionPolys.push({
        id: r.id,
        poly: r.polygon,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      });
    }
  }
  for (const r of regionPolys) {
    if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
    if (locatePoint(r.poly, [x, z]) !== 'outside') return r.id;
  }
  return null;
}

/** plan.json 水系的岸线环(去闭合重复点)。找不到返回 null。 */
function waterRingPoints(id: string): [number, number][] | null {
  type WaterPoly = { id?: string; polygon?: [number, number][] };
  const waters = (getPlan() as { water?: WaterPoly[] }).water ?? [];
  const w = waters.find((e) => e.id === id);
  if (!w?.polygon || w.polygon.length < 3) return null;
  const raw = w.polygon;
  const closed =
    raw.length > 1 &&
    raw[0][0] === raw[raw.length - 1][0] &&
    raw[0][1] === raw[raw.length - 1][1];
  return closed ? raw.slice(0, -1) : raw;
}

/* ------------------------------------------------------------------ */
/* Species                                                             */
/* ------------------------------------------------------------------ */

/** `apricot`:杏花(单子 BA4,见 SPECIES 里的 apricot)。叶面贴图换成花色,不是换树形。 */
type LeafSet = 'warm' | 'cool' | 'needle' | 'apricot';
type BarkSet = 'oak' | 'ash' | 'pale';

interface TreeDef {
  key: string;
  /** Trunk spine length before the crown takes over. */
  h: number;
  r: number;
  flare: number;
  lean: number;
  curve: number;
  limbs: number;
  limbStart: number;
  /** How far up the spine the topmost limb sits. Low = a stubby, forked tree. */
  limbEnd: number;
  /** Root buttresses sweeping out of the base into the ground. */
  roots: number;
  crown: 'broad' | 'dome' | 'conic' | 'open';
  crownR: number;
  crownSquash: number;
  res: number;
  leafSet: LeafSet;
  bark: BarkSet;
  /**
   * Per-species bark colour, applied as an instance tint over the shared bark
   * albedo. This is the channel that separates a warm brown oak from a
   * grey-green ash from a chalk-white birch without baking a third set of maps
   * per species, and it is multiplicative over a near-white material colour so
   * the value here is the trunk's actual hue.
   */
  barkTint: number;
  tint: number;
  lumpy: number;
  /**
   * 垂枝度，0 = 枝条上扬（默认），1 = 垂柳。PQ-5c 新增的自由度：
   * 骨架原本只有「枝向光上弯」一个方向，柳的剪影（长枝先平出再垂落）
   * 表不出来。droop 压低枝的出射角、加长枝长、并让枝梢沿程下垂。
   */
  droop?: number;
}

/**
 * 大观园游线上的树，不是温带森林。
 *
 * PQ-5c 换血：旧的八种（橡/梣/松/云杉/白桦/枫/棘）继承自 pallet-town-3d，
 * 是 D-01 记下的代价。现在按 `plan.json` 的 regions[].plants 与
 * `knowledge/rules/plants.rules.json` 换成名目有据的种。骨架不动
 * （脊线 + 分枝 + 冠球 + 轮廓碎叶卡），换的是参数；柳的垂枝加了
 * `droop` 一个自由度，芭蕉的大叶丛生骨架装不下，单独成件
 * （`garden-plants.ts`）。
 *
 * 剪影仍然按结构区分，还是那四条，只是落点换了：
 *
 *  - **高度差大于 2 : 1**（3.2 m 的海棠对 6.6 m 的青松）。
 *  - **细长度**独立变化：`h / r` 从槐的 ~11 到松的 ~27。
 *  - **分枝的位置**。低分叉开张的古松与一干到顶的青松不像亲戚。
 *  - **倾侧与弯度**，从笔直的青松到 0.26 倾侧、0.46 弯度的古松；
 *    柳再多一个垂枝方向。
 */
const SPECIES: TreeDef[] = [
  {
    // 榆——背景杂树主力，江南庭院常见。SPECIES[0] 同时供远景构件
    // （distant/scene.ts 的 buildDistantTreeGeometry），保持平实阔叶形。
    key: 'elm',
    h: 4.2, r: 0.30, flare: 0.28, lean: 0.10, curve: 0.20,
    limbs: 5, limbStart: 0.42, limbEnd: 0.95, roots: 5,
    crown: 'broad', crownR: 2.0, crownSquash: 0.80,
    res: 22, leafSet: 'warm', bark: 'oak',
    barkTint: 0xb08a5e, tint: 0xdff0c4, lumpy: 0.34,
  },
  {
    // 老槐——苍劲开张的深色阔叶。嘉荫堂点名，也作园中骨架树。
    key: 'locust',
    h: 5.4, r: 0.50, flare: 0.46, lean: 0.07, curve: 0.16,
    limbs: 7, limbStart: 0.30, limbEnd: 0.88, roots: 6,
    crown: 'open', crownR: 2.5, crownSquash: 0.72,
    res: 22, leafSet: 'warm', bark: 'oak',
    barkTint: 0x8f6c42, tint: 0xd6e6b4, lumpy: 0.40,
  },
  {
    // 古松——横展虬枝，平顶微垂。「门前古松」「青松拂檐」的门面。
    // 针叶冠 + 宽冠幅 + 强倾侧弯曲 + 一点垂枝,读作盆景松而不是圣诞松。
    key: 'pine-old',
    h: 5.2, r: 0.38, flare: 0.30, lean: 0.26, curve: 0.46,
    limbs: 6, limbStart: 0.30, limbEnd: 0.92, roots: 6,
    crown: 'open', crownR: 2.7, crownSquash: 0.50,
    res: 21, leafSet: 'needle', bark: 'oak',
    barkTint: 0x96604a, tint: 0xc2d8b4, lumpy: 0.42,
    droop: 0.3,
  },
  {
    // 青松——挺拔圆锥的那一棵,省亲主轴与山寺用。
    key: 'cypress',
    h: 6.6, r: 0.24, flare: 0.15, lean: 0.02, curve: 0.06,
    limbs: 5, limbStart: 0.44, limbEnd: 0.99, roots: 3,
    crown: 'conic', crownR: 1.45, crownSquash: 1.80,
    res: 20, leafSet: 'needle', bark: 'ash',
    barkTint: 0x7a6a52, tint: 0xb8d2ae, lumpy: 0.30,
  },
  {
    // 堤柳——「绕堤柳借三篙翠」。droop 拉满:长枝先平出再垂落,
    // 冠球挂在垂枝梢上,读成垂帘。
    key: 'willow',
    h: 4.8, r: 0.28, flare: 0.22, lean: 0.14, curve: 0.30,
    limbs: 8, limbStart: 0.42, limbEnd: 0.98, roots: 4,
    crown: 'open', crownR: 2.4, crownSquash: 0.60,
    res: 20, leafSet: 'cool', bark: 'ash',
    barkTint: 0x77644c, tint: 0xd8ebae, lumpy: 0.30,
    droop: 1.0,
  },
  {
    // 梨树——「大株梨花」。花期白冠,tint 即是花色。
    key: 'pear',
    h: 4.0, r: 0.26, flare: 0.24, lean: 0.10, curve: 0.24,
    limbs: 5, limbStart: 0.38, limbEnd: 0.92, roots: 4,
    crown: 'broad', crownR: 2.0, crownSquash: 0.82,
    res: 21, leafSet: 'warm', bark: 'ash',
    barkTint: 0x6e5640, tint: 0xf4f2e4, lumpy: 0.36,
  },
  {
    // 碧桃/杏——粉花小乔。「一径引人绕着碧桃花」「几百株杏花如喷火蒸霞」。
    key: 'peach',
    h: 3.4, r: 0.22, flare: 0.20, lean: 0.16, curve: 0.30,
    limbs: 5, limbStart: 0.40, limbEnd: 0.95, roots: 4,
    crown: 'dome', crownR: 1.7, crownSquash: 0.95,
    res: 20, leafSet: 'warm', bark: 'ash',
    barkTint: 0x6a4a34, tint: 0xf6d2c8, lumpy: 0.34,
  },
  {
    // 西府海棠——「其势若伞,丝垂翠缕,葩吐丹砂」。低干、平顶伞冠。
    key: 'haitang',
    h: 3.2, r: 0.22, flare: 0.20, lean: 0.06, curve: 0.14,
    limbs: 4, limbStart: 0.55, limbEnd: 0.95, roots: 4,
    crown: 'open', crownR: 2.1, crownSquash: 0.48,
    res: 20, leafSet: 'warm', bark: 'ash',
    barkTint: 0x7a5c40, tint: 0xf2dcd2, lumpy: 0.32,
    droop: 0.35,
  },
  {
    // 杏——「有幾百株杏花,如噴火蒸霞一般」(07-11,稻香村)。单子 BA4:**树形借桃**(骨架参数逐项同 peach),
    // 只换花色:杏先花后叶,盛花时冠是花不是叶,所以冠面贴图换成花色(leafSet 'apricot')——比桃更红,
    // 深处取含苞的胭脂 0xa8344c、亮处取初绽的粉白里透红 0xf4a494(花色是艺术取值,provenance.art)。
    // 排在表尾:前面各种的下标与建树种子((seed ^ 0x7ee0) + i·7919)一个不动。
    key: 'apricot',
    h: 3.4, r: 0.22, flare: 0.20, lean: 0.16, curve: 0.30,
    limbs: 5, limbStart: 0.40, limbEnd: 0.95, roots: 4,
    crown: 'dome', crownR: 1.7, crownSquash: 0.95,
    res: 20, leafSet: 'apricot', bark: 'ash',
    barkTint: 0x5e3e2e, tint: 0xfff2ee, lumpy: 0.34,
  },
];

/** 哪些树种真的有骨架。`builder/compose/scenes.ts` 校验点名树的种时读它（单子 AV2）。 */
export const SPECIES_INDEX: Record<string, number> = Object.fromEntries(
  SPECIES.map((d, i) => [d.key, i]),
);

/**
 * 杏花的冠缘卡片贴图(单子 BA4)。
 *
 * 冠缘卡片是逆光时最亮的那一层,用绿叶簇贴图去乘粉色只会得到土褐——所以取同一张叶簇的
 * **形与透明度**,按亮度重新上色:暗处胭脂(含苞)、亮处粉白里透红(初绽)。
 * 只在本文件里做(`foliage-materials.ts` 不在本单文件域),用同一套 `cached` 记忆化。
 */
function blossomClusterTexture(src: THREE.Texture): THREE.Texture {
  return cached(recipeKey('leafcluster.canopy.apricot-blossom', 512), () => {
    const img = src.image as HTMLCanvasElement;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const c = canvas.getContext('2d')!;
    c.drawImage(img, 0, 0);
    const data = c.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    const bud = [0xa8, 0x34, 0x4c], open = [0xf7, 0xb8, 0xaa];
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      // 原图是绿叶:亮度主要在 G 通道,取 0.3R+0.6G+0.1B 并拉开到 0–1。
      const l = clamp(((0.3 * px[i] + 0.6 * px[i + 1] + 0.1 * px[i + 2]) / 255 - 0.25) / 0.55, 0, 1);
      px[i] = lerp(bud[0], open[0], l);
      px[i + 1] = lerp(bud[1], open[1], l);
      px[i + 2] = lerp(bud[2], open[2], l);
    }
    c.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = src.anisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  });
}

/* ------------------------------------------------------------------ */
/* Plantability grid                                                   */
/* ------------------------------------------------------------------ */

/**
 * A baked 25cm grid of "may something grow here".
 *
 * `surfaceAt` is analytic but not cheap — it re-walks the path polylines and
 * several fbm octaves per call — and the scatter needs on the order of a
 * hundred thousand queries. Baking once and bilinear-sampling turns a
 * three-second stall into a tenth of a second, and because it is baked from the
 * same function the terrain shader splats from, the mask cannot disagree with
 * what is painted on the ground.
 */
function plantMaskSampler(ctx: GameContext): (x: number, z: number) => number {
  const surfaceAt = ctx.collision.surfaceAt;
  const groundHeight = ctx.collision.groundHeight;
  const wallEdges = new BoundsIndex<readonly [readonly [number,number],readonly [number,number]]>(16);
  const corridorFloors=new BoundsIndex<readonly Point2[]>(16);
  for(const linear of allPlanLinears(getPlan()))if(linear.kind==='corridor') {
    const c=compileCorridor(linear),poly=c.deckPolygon.map(p=>[p[0]+c.origin[0],p[1]+c.origin[1]] as Point2);
    corridorFloors.add({minX:Math.min(...poly.map(p=>p[0])),maxX:Math.max(...poly.map(p=>p[0])),minZ:Math.min(...poly.map(p=>p[1])),maxZ:Math.max(...poly.map(p=>p[1]))},poly,.4);
  } else if(linear.kind==='bridge') {
    const c=compileBridgePath(linear),poly=c.polygon.map(p=>[p[0]+c.origin[0],p[1]+c.origin[1]] as Point2);
    corridorFloors.add({minX:Math.min(...poly.map(p=>p[0])),maxX:Math.max(...poly.map(p=>p[0])),minZ:Math.min(...poly.map(p=>p[1])),maxZ:Math.max(...poly.map(p=>p[1]))},poly,.4);
  }
  for(const wall of allPlanLinears(getPlan()))if(wall.kind==='wall')for(let i=1;i<wall.points.length;i++) {
    const a=wall.points[i-1],b=wall.points[i];
    wallEdges.add({minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minZ:Math.min(a[1],b[1]),maxZ:Math.max(a[1],b[1])},[a,b],.8);
  }
  // D-37:采样函数与烘焙域拆开。旧窗口那张 `DensityMask` 的烘焙域钉在
  // `LEGACY_MASK_BOUNDS`(原来读 `TERRAIN`——窗口一变,256×288 个格子的位置全变,
  // 于是每个点查到的掩码值都变);块里的散布用同一个函数烤的世界格点掩码 `LatticeMask`。
  return (x, z) => {
      const grass = surfaceAt(x, z) === 'grass' ? 1 : 0;
      const dry = groundHeight(x, z) > VEG.minPlantY ? 1 : 0;
      const atWall=wallEdges.query(x,z).some(edge=>distanceToPolyline(x,z,edge)<.7);
      const atCorridor=corridorFloors.query(x,z).some(poly=>locatePoint(poly,[x,z])!=='outside'||distanceToPolyline(x,z,poly)<.4);
      return atWall||atCorridor ? 0 : grass * dry;
  };
}

/** 1 outside every building footprint, 0 inside, with a short feather.
 *  单子 Z:数据来自 `occupancy.ts` 的占位场(plan 的檐口外包络 + scenes 的
 *  clearances),不再是本文件里的手抄副本。函数名与签名保持不变——16 处调用
 *  点一个都不用改,换的是真源不是用法。 */
function outsideBuildings(x: number, z: number, pad = 0): number {
  if (pad <= NEAR_PAD_MAX && !nearOccupant(x, z)) return 1;
  return occupancyFree(x, z, pad);
}

/**
 * 单子 AX2:占位查询的空间预筛——**只是缓存,结果逐位不变**。
 *
 * `occupancyFree` 对全园每块占位多边形线性扫(19 区时草散布里 1.47M 次调用、15.5 s)。
 * 它取的是 `min(smoothstep(-0.35, 0.35, 距离 − pad))`:离所有多边形都超过 0.35 + pad 的点,
 * 每一项都恰好是 1(smoothstep 夹到 1,`t*t*(3-2t)` 在 t=1 时逐位得 1),结果就是 1。
 * 所以先用包围盒(外扩 0.35 + 本文件用到的最大 pad)的格子索引问「附近有没有占位」:
 * 没有就直接回 1;有就照旧整份去算。算的函数、顺序、提前返回都还是 occupancy.ts 那一份。
 * 包围盒到点的距离 ≤ 点到多边形的距离,所以预筛只会多放行、不会漏。
 *
 * 更顺的位置是在 `occupancy.ts` 的 `free()` 里建索引,但那个文件不在本单的文件域里,
 * 记在回报里。占位场按对象身份缓存:热重载换了一份就重建。
 */
const NEAR_PAD_MAX = 1.4;
let nearCache: { field: OccupancyField | undefined; near: ((x: number, z: number) => boolean) | null } = { field: undefined, near: null };
function nearOccupant(x: number, z: number): boolean {
  const field = getOccupancy();
  if (nearCache.field !== field) {
    // free() 不读墙体带(occupancy.ts 文件头第 2 条),所以预筛也只收房子与净空。
    const polys = field ? field.occupants().filter((o) => o.kind !== 'wall').map((o) => o.polygon) : null;
    nearCache = { field, near: polys ? polygonNearIndex(polys, 0.35 + NEAR_PAD_MAX + 0.01) : null };
  }
  // 没注入占位场:occupancyFree 自己回 1,这里交给它。
  return !nearCache.near || nearCache.near(x, z);
}

/* ------------------------------------------------------------------ */
/* Scatter helpers                                                     */
/* ------------------------------------------------------------------ */

interface Spot {
  x: number;
  z: number;
}

/* ------------------------------------------------------------------ */
/* Leaf shell                                                          */
/* ------------------------------------------------------------------ */

/**
 * Skins the outer shell of a blob with alpha-cut leaf-cluster cards.
 *
 * A metaball crown, however lumpy, always presents a *smooth* silhouette
 * against the sky, and a smooth green silhouette reads as a surface — moss, a
 * gumdrop, a painted ball — never as leaves. Everything else in this file is
 * downstream of that one fact: the vertex-colour occlusion, the transmission
 * and the wind all make the blob look like a good blob.
 *
 * Breaking the edge is what makes it a tree. Cards are seated on the blob's own
 * vertices (so their occlusion and thickness match the surface they grow out
 * of), tilted along the surface normal with a bias toward the sky, buried to
 * roughly half their height, and jittered in size and roll. The blob stays as
 * the opaque mass that catches light and casts the shadow; the cards only have
 * to break the outline, so they are cheap and never shadow-cast.
 */
function shellCards(
  surface: THREE.BufferGeometry,
  o: {
    seed: number;
    count: number;
    minSize: number;
    maxSize: number;
    /** How hard cards rotate from the surface normal toward world up. */
    upBias: number;
    /** Fraction of the card's height buried inside the blob. */
    sink: number;
    /** Extra wind compliance over the surface vertex the card grows from. */
    flexBoost: number;
    /** Bias placement toward the top of the blob. 0 = uniform. */
    crownBias?: number;
    /** 卡片宽比,默认 1。垂枝树（柳）给 0.6 上下,让碎叶读成条而不是片。 */
    narrow?: number;
    /**
     * C2:轮廓边缘一圈用有真体积的 twigCluster 换掉平卡片(见 twigCluster 的
     * 注释)。fraction 是"曝光度够高的候选里,有多大比例换成 twig"——不是全
     * 冠的比例,越靠冠内部(up01 低)的从不参与,所以整体面数增幅远小于
     * fraction 本身暗示的数字（约 1.5-2.5x 单卡片,不是 1.5-2.5x 全冠）。
     */
    volumetric?: { fraction: number; leaves?: number };
  },
): THREE.BufferGeometry {
  const rng = makeRng(o.seed);
  const pos = surface.attributes.position as THREE.BufferAttribute;
  const nor = surface.attributes.normal as THREE.BufferAttribute;
  const colA = surface.attributes.color as THREE.BufferAttribute | undefined;
  const flexA = surface.attributes.aFlex as THREE.BufferAttribute | undefined;
  const n = pos.count;
  if (n === 0) return new THREE.BufferGeometry();

  surface.computeBoundingBox();
  const bb = surface.boundingBox!;
  const spanY = Math.max(1e-3, bb.max.y - bb.min.y);

  const parts: THREE.BufferGeometry[] = [];
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const stride = n / o.count;

  for (let i = 0; i < o.count; i++) {
    const idx = Math.min(n - 1, Math.floor(i * stride + rng() * stride));
    p.fromBufferAttribute(pos, idx);
    dir.fromBufferAttribute(nor, idx);

    const up01 = clamp((p.y - bb.min.y) / spanY, 0, 1);
    // Undersides get fewer, smaller leaves — they are in shadow and mostly
    // hidden, and cards hanging off the bottom of a crown read as a beard.
    const keep = lerp(1, 0.28 + up01 * 0.9, o.crownBias ?? 0.6);
    if (rng() > keep) continue;

    dir.normalize().addScaledVector(up, o.upBias).normalize();
    q.setFromUnitVectors(up, dir);
    roll.setFromAxisAngle(up, rng() * Math.PI * 2);
    q.multiply(roll);

    const thick = flexA ? flexA.getY(idx) : 1;
    // Exposed shell vertices carry the biggest clumps; buried ones get a scrap
    // that only shows through a gap.
    const h = rangeOf(rng, o.minSize, o.maxSize) * (0.66 + thick * 0.45);
    const w = h * rangeOf(rng, 0.95, 1.35) * (o.narrow ?? 1);

    // C2:only the outer, most-exposed ring (up01 high) is a candidate for a
    // twig — the interior stays flat cards, which is most of the crown by
    // vertex count, so the real cost stays well under `fraction` of the total.
    // A deterministic stride on `i` (not another rng() draw) keeps every other
    // card's random sequence identical to before this option existed.
    const vol = o.volumetric;
    const isTwig = !!vol && up01 > 0.55 && i % 5 < Math.round(vol.fraction * 5);
    const card = isTwig
      ? twigCluster(h * 0.9, w * 0.09, w * 0.62, h * 0.62, vol!.leaves ?? 3, o.narrow ?? 1, rng)
      : curvedCard(w, h, rangeOf(rng, -0.16, 0.16) * h, rangeOf(rng, -0.12, 0.12) * h, 2);
    m.compose(p.clone().addScaledVector(dir, -h * o.sink), q, new THREE.Vector3(1, 1, 1));
    card.applyMatrix4(m);

    const cpos = card.attributes.position as THREE.BufferAttribute;
    const cuv = card.attributes.uv as THREE.BufferAttribute;
    const colors = new Float32Array(cpos.count * 3);
    const flex = new Float32Array(cpos.count * 2);
    const baseR = colA ? colA.getX(idx) : 1;
    const baseG = colA ? colA.getY(idx) : 1;
    const baseB = colA ? colA.getZ(idx) : 1;
    const baseFlex = flexA ? flexA.getX(idx) : 0.5;
    for (let k = 0; k < cpos.count; k++) {
      // Along the card: buried root dark, exposed tip catches the sky. The
      // gradient is what gives each clump its own little form instead of a
      // flat-lit chip.
      const t = cuv.getY(k);
      const g = 0.88 + t * 0.30;
      colors[k * 3] = baseR * g;
      colors[k * 3 + 1] = baseG * g;
      colors[k * 3 + 2] = baseB * g;
      flex[k * 2] = baseFlex * (1 + o.flexBoost) + t * o.flexBoost * 0.5;
      flex[k * 2 + 1] = clamp(lerp(thick, 1, 0.45) * (0.55 + t * 0.5), 0, 1);
    }
    card.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    card.setAttribute('aFlex', new THREE.BufferAttribute(flex, 2));
    parts.push(card);
  }

  if (parts.length === 0) return new THREE.BufferGeometry();
  const geo = mergeGeos(parts);
  geo.computeBoundingSphere();
  return geo;
}

/* ------------------------------------------------------------------ */
/* Tree construction                                                   */
/* ------------------------------------------------------------------ */

interface TreeGeo {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  /** Alpha-cut leaf clusters breaking the canopy silhouette. */
  fringe: THREE.BufferGeometry;
  /** Total height, used for wind flex normalisation and collider extents. */
  height: number;
  trunkR: number;
}

/**
 * `far`(单子 BC1):同一棵树的远景档——**同种子、同骨架、同冠形**(树干脊线、枝位、冠球都吃同一串 rng,
 * 与近档逐球相同),只降分辨率:干 13×11 → 5×5 环段,枝 6×7 → 3×4,根不画(远处埋在草里),
 * 冠面 metaball 分辨率降到约四成,缘叶卡数取三成、每张放大 1.5 倍补回覆盖、不做有体积的小枝簇。
 * 用在 120 m 外——那里一张 0.5 m 的卡只有三四个像素。
 */
function buildTree(def: TreeDef, seed: number, far = false): TreeGeo {
  const rng = makeRng(seed);

  /* ---- spine ------------------------------------------------------ */
  // Lean azimuth is per-species-instance, so no two generated variants of the
  // same species tilt the same way.
  const leanAz = rng() * Math.PI * 2;
  const lx = Math.cos(leanAz);
  const lz = Math.sin(leanAz);
  const curveAz = leanAz + rangeOf(rng, -1.4, 1.4);

  const spine: THREE.Vector3[] = [];
  const SEG = 6;
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const y = def.h * t;
    const leanOff = def.lean * def.h * t * t;
    // A sine bulge on top of the lean gives an S — a trunk that leans one way
    // low down and recovers higher up reads as grown, a straight tilt reads as
    // a knocked-over pole.
    const bulge = Math.sin(t * Math.PI) * def.curve * def.h * 0.34;
    spine.push(
      new THREE.Vector3(
        lx * leanOff + Math.cos(curveAz) * bulge + rangeOf(rng, -0.03, 0.03) * def.h * t,
        y,
        lz * leanOff + Math.sin(curveAz) * bulge + rangeOf(rng, -0.03, 0.03) * def.h * t,
      ),
    );
  }
  const curve = new THREE.CatmullRomCurve3(spine, false, 'catmullrom', 0.5);

  const rootPhase = rng() * Math.PI * 2;
  const rootCount = 3 + Math.floor(rng() * 2);
  /**
   * Taper to a leader, not to a stub.
   *
   * The old profile held 31% of the base radius at t = 1 (`0.1 ^ 0.55`), and
   * `taperedTube` builds an open tube — so every trunk terminated in a
   * fat, flat, back-facing hole. On the trees whose crown sits behind another
   * tree's canopy that hole is what you see, and a trunk cut off square reads as
   * a sawn stump. 8% of the base radius with a slightly harder exponent closes
   * it to a shoot thin enough to disappear into the leaves.
   */
  const radiusAt = (t: number) =>
    def.r * Math.pow(Math.max(0.001, 1 - t * 0.985), 0.62) + def.flare * Math.exp(-t * 11) * 0.55;

  const trunkGeo = taperedTube({
    spine,
    rings: far ? 5 : 13,
    radial: far ? 5 : 11,
    // Bark texel density is now fixed per metre of trunk rather than per trunk.
    // At 0.42 * h a four-metre spine got 1.7 v repeats, so a single bark fissure
    // was stretched over two metres — the vertical streak in the treeline shot.
    // 1.5 repeats per metre puts a fissure at ~20 cm, which is what bark is.
    vScale: def.h * 1.5,
    radius: radiusAt,
    lobe: (t, theta) => {
      // Root buttresses: a few ridges that flare hard at the very base and are
      // gone by knee height. This is the single detail that separates a trunk
      // from a pipe at close range.
      const root = Math.exp(-t * 11);
      const flute = Math.max(0, Math.cos(theta * rootCount + rootPhase));
      const ridge = Math.sin(theta * 7 + t * 5.5) * 0.045;
      return 1 + root * 0.72 * Math.pow(flute, 1.6) + ridge * (1 - root * 0.5);
    },
  });

  /* ---- limbs ------------------------------------------------------ */
  const parts: THREE.BufferGeometry[] = [trunkGeo];

  /* ---- roots ------------------------------------------------------ */
  /**
   * Root buttresses that sweep out of the base and dive under the turf.
   *
   * The lobe function above widens the trunk at its foot, but a widened cylinder
   * still terminates in a *circle*, and a circle sitting on a lawn is a fence
   * post. What makes a tree look grown out of the ground is a handful of roots
   * crossing the boundary — the silhouette of the base becomes irregular and the
   * eye stops looking for the seam. They live in the trunk geometry, so they
   * ride the same instance matrix and cost no extra draw call.
   */
  {
    const baseR = radiusAt(0);
    const rootN = def.roots;
    const az0 = rng() * Math.PI * 2;
    for (let i = 0; i < rootN; i++) {
      const az = az0 + (i / rootN) * Math.PI * 2 + rangeOf(rng, -0.35, 0.35);
      const reach = baseR * rangeOf(rng, 1.5, 2.9);
      const rr = baseR * rangeOf(rng, 0.30, 0.46);
      const bendAz = az + rangeOf(rng, -0.5, 0.5);
      const rp: THREE.Vector3[] = [];
      const RS = 4;
      for (let k = 0; k <= RS; k++) {
        const u = k / RS;
        // Shoulder high at the trunk, plunging below the turf at the tip: a
        // quarter-circle in section, which is the shape of a real buttress.
        const y = 0.30 * baseR * (1 - u) - u * u * 0.42 * baseR - u * 0.06;
        const d = reach * u;
        rp.push(
          new THREE.Vector3(
            Math.cos(az) * d * 0.7 + Math.cos(bendAz) * d * 0.3,
            y + 0.16 * baseR,
            Math.sin(az) * d * 0.7 + Math.sin(bendAz) * d * 0.3,
          ),
        );
      }
      // 远景档不画根(上面那串 rng 照抽,冠与枝才与近档逐位同形)。
      if (!far) parts.push(
        taperedTube({
          spine: rp,
          rings: 5,
          radial: 6,
          vScale: reach * 1.6,
          radius: (u) => rr * Math.pow(1 - u * 0.82, 0.6) + 0.01,
          // Flattened in section — roots spread sideways, they are not dowels.
          lobe: (_u, theta) => 1 + Math.cos(theta * 2) * 0.22,
        }),
      );
    }
  }
  const limbTips: THREE.Vector3[] = [];
  const attach = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  for (let i = 0; i < def.limbs; i++) {
    const t = clamp(
      def.limbStart + (i / Math.max(1, def.limbs - 1)) * (def.limbEnd - def.limbStart) +
        rangeOf(rng, -0.06, 0.06),
      0.14,
      0.99,
    );
    curve.getPointAt(t, attach);
    curve.getTangentAt(t, tangent);

    // Golden-angle phyllotaxis plus jitter: limbs spiral round the trunk the
    // way they do on a real tree instead of sitting on one plane.
    const az = i * 2.39996 + rng() * 0.9;
    // droop flattens the launch angle and lengthens the limb, then pulls the
    // tip down quadratically: willow hangs, pine-old spreads level, upright
    // species leave it 0 and keep the original upward bend.
    const droop = def.droop ?? 0;
    const rise = lerp(1.15, 0.5, t) * (1 - droop * 0.6) + rng() * 0.35;
    const len = def.h * rangeOf(rng, 0.3, 0.52) * (1 - t * 0.35) * (1 + droop * 0.5);
    const dir = new THREE.Vector3(Math.cos(az), rise, Math.sin(az)).normalize();

    const lp: THREE.Vector3[] = [];
    const LS = 4;
    for (let k = 0; k <= LS; k++) {
      const u = k / LS;
      // Limbs bend upward toward the light as they extend; droop species
      // sag past the midpoint instead.
      const up = u * u * 0.42;
      lp.push(
        new THREE.Vector3(
          attach.x + dir.x * len * u + tangent.x * len * u * 0.25,
          attach.y + dir.y * len * u + len * up * 0.5 - droop * u * u * len * 0.8,
          attach.z + dir.z * len * u + tangent.z * len * u * 0.25,
        ),
      );
    }
    const baseR = radiusAt(t) * rangeOf(rng, 0.42, 0.6);
    parts.push(
      taperedTube({
        spine: lp,
        rings: far ? 3 : 6,
        radial: far ? 4 : 7,
        vScale: len * 0.6,
        radius: (u) => baseR * Math.pow(1 - u * 0.94, 0.7) + 0.012,
        lobe: (_u, theta) => 1 + Math.sin(theta * 5) * 0.04,
      }),
    );
    limbTips.push(lp[LS].clone());
  }

  const trunk = mergeGeos(parts);
  const totalH = def.h + def.crownR * def.crownSquash * 1.5;

  // Bark contact darkening. Trunks are lit from one side and lose everything in
  // the grass at the base; baking it means the tree meets the ground instead of
  // being dropped onto it.
  {
    const pos = trunk.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      // Two stacked terms. The wide one is the ambient gradient up the bole; the
      // tight one is the contact ring in the first 25 cm, where the turf, the
      // litter and the roots occlude nearly all of the sky. Without the tight
      // term the trunk is uniformly lit right down to the blade of grass it
      // touches, which is exactly what "planted on the ground" looks like.
      const amb = lerp(0.68, 1.0, smoothstep(-0.05, 1.5, y));
      const contact = lerp(0.30, 1.0, smoothstep(-0.12, 0.46, y));
      const ao = amb * contact;
      colors[i * 3] = ao;
      // Bounce off the litter is warm, so the shaded base goes brown, not grey.
      colors[i * 3 + 1] = ao * lerp(0.96, 1.0, smoothstep(0, 1.2, y));
      colors[i * 3 + 2] = ao * lerp(0.82, 1.0, smoothstep(0, 1.2, y));
    }
    trunk.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    setFlex(trunk, (_x, y) => [Math.pow(clamp(y / totalH, 0, 1), 2.1) * 0.55, 0.12]);
  }

  /* ---- crown ------------------------------------------------------ */
  const balls: Ball[] = [];
  const top = curve.getPointAt(1, new THREE.Vector3());
  const cR = def.crownR;

  if (def.crown === 'conic') {
    // Eight closely-spaced layers rather than five widely-spaced ones. The
    // spacing has to stay below the sum of adjacent radii or the top of the
    // cone stops fusing with the layer under it and flies off as a free blob.
    const layers = 8;
    const spread = cR * def.crownSquash * 1.45;
    for (let i = 0; i < layers; i++) {
      const u = i / (layers - 1);
      const r = cR * lerp(1.0, 0.22, Math.pow(u, 0.92));
      balls.push({
        x: top.x + rangeOf(rng, -0.22, 0.22) * r,
        y: top.y - cR * 0.35 + u * spread,
        z: top.z + rangeOf(rng, -0.22, 0.22) * r,
        r,
        sy: 0.88,
      });
    }
  } else if (def.crown === 'open') {
    // Separated masses so daylight punches through the crown — the point of an
    // "open" tree is the gaps. They still have to reach the core, though: a
    // satellite further out than about 1.6x its own radius stops fusing and
    // ends up as a lump of leaves floating in the sky.
    balls.push({
      x: top.x, y: top.y + cR * 0.30, z: top.z,
      r: cR * 0.74, sy: def.crownSquash,
    });
    for (const tip of limbTips) {
      const r = cR * rangeOf(rng, 0.56, 0.86);
      const reach = Math.min(1, (cR * 0.74 + r) * 0.94 / Math.max(0.001, Math.hypot(tip.x, tip.z)));
      balls.push({
        x: tip.x * reach,
        y: top.y + cR * 0.3 + (tip.y - top.y - cR * 0.3) * 0.75 + cR * rangeOf(rng, 0.05, 0.3),
        z: tip.z * reach,
        r,
        sy: def.crownSquash,
      });
    }
  } else {
    /**
     * A ring of lobes around a *small* core, not one big ball with bumps.
     *
     * The old crown was a ball of radius `cR` with satellites pulled in to 80%
     * of touching distance, so every lump was swallowed by the core and the
     * result was a single convex mass — a smooth ceiling with no holes. Two
     * numbers fix it: the core drops to ~0.8 of its old radius, and the
     * satellites push out to 92% of touching distance instead of 80%. They still
     * fuse (past ~1.1 they detach and fly off as free blobs of leaves), but the
     * saddles between them now dip deep enough to be gaps, and gaps are what
     * lets daylight through the canopy and what makes the silhouette read as
     * several masses of leaves rather than one shell.
     */
    const central = def.crown === 'dome' ? 0.78 : 0.84;
    balls.push({
      x: top.x, y: top.y + cR * (def.crown === 'dome' ? 0.62 : 0.36), z: top.z,
      r: cR * central, sy: def.crownSquash,
    });
    for (const tip of limbTips) {
      const r = cR * rangeOf(rng, 0.52, 0.80);
      const reach = Math.min(1, (cR * central + r) * 0.92 / Math.max(0.001, Math.hypot(tip.x, tip.z)));
      balls.push({
        x: tip.x * reach,
        y: tip.y + cR * rangeOf(rng, 0.06, 0.26),
        z: tip.z * reach,
        r,
        sy: def.crownSquash * rangeOf(rng, 0.85, 1.1),
      });
    }
    // One deliberately off-centre lobe. Perfect radial symmetry is the tell
    // that a canopy was generated rather than grown.
    const az = rng() * Math.PI * 2;
    balls.push({
      x: top.x + Math.cos(az) * cR * 0.85,
      y: top.y + cR * rangeOf(rng, 0.1, 0.55),
      z: top.z + Math.sin(az) * cR * 0.85,
      r: cR * rangeOf(rng, 0.42, 0.6),
      sy: def.crownSquash,
    });
  }

  // Padding matters: the Wyvill isosurface sits at ~1.17x a lone ball's radius
  // and further where blobs overlap, so a tight bounding box slices the crown
  // flat at the top. Scale the pad with the crown instead of using a constant.
  const canopy = metaSurface(balls, {
    resolution: far ? Math.max(8, Math.round(def.res * 0.42)) : def.res,
    isoLevel: 1.0,
    padding: cR * 0.4,
    smooth: 0.85,
  });
  noiseDisplace(canopy, cR * def.lumpy, 1.05 / cR, seed ^ 0x9e37, 3);
  noiseDisplace(canopy, cR * def.lumpy * 0.34, 3.4 / cR, seed ^ 0x51ed, 2);

  canopy.setAttribute('uv', boxProjectedUV(canopy, 0.40));

  // Blend the geometric normal toward the direction out of the crown centre.
  // Full geometric normals make every metaball lump shade as its own sphere;
  // fully spherified normals lose the lumps. Just under half-way keeps the
  // silhouette detail while the shading reads as one soft volume.
  {
    canopy.computeVertexNormals();
    const pos = canopy.attributes.position as THREE.BufferAttribute;
    const nor = canopy.attributes.normal as THREE.BufferAttribute;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const b of balls) {
      cx += b.x;
      cy += b.y;
      cz += b.z;
    }
    cx /= balls.length;
    cy /= balls.length;
    cz /= balls.length;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz).normalize();
      n.fromBufferAttribute(nor, i).lerp(v, 0.42).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    nor.needsUpdate = true;
  }

  const thick = bakeCanopyShading(canopy, balls as { x: number; y: number; z: number; r: number }[], {
    interior: 0.62,
    underside: 0.24,
    cool: 0.55,
  });

  {
    const pos = canopy.attributes.position as THREE.BufferAttribute;
    const flex = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const rad = Math.hypot(pos.getX(i), pos.getZ(i)) / Math.max(0.4, cR);
      const f = Math.pow(clamp(y / totalH, 0, 1), 1.25) * (0.62 + 0.38 * clamp(rad, 0, 1));
      flex[i * 2] = f;
      flex[i * 2 + 1] = thick[i];
    }
    canopy.setAttribute('aFlex', new THREE.BufferAttribute(flex, 2));
    canopy.computeBoundingSphere();
  }

  // Leaf clusters over the crown. Count scales with surface area so a big oak
  // is not skinned at the same density as a spruce. Both the count and the card
  // size are up hard on the old values and the cards sit proud of the surface
  // rather than half-buried: the blob's silhouette is the thing that reads as
  // 2004, and only these cards break it.
  const droopN = def.droop ?? 0;
  const fringe = shellCards(canopy, {
    seed: seed ^ 0x1eaf,
    count: Math.round((150 + cR * cR * def.crownSquash * 88) * (far ? 0.3 : 1)),
    // A wider size band for the same card count. The silhouette of a real crown
    // is broken at several scales at once — big terminal clumps with scraps
    // between them — and a narrow band gives an evenly scalloped edge, which is
    // its own kind of procedural tell. Less sink for the same reason: the cards
    // have to stand proud of the blob to break its outline at all.
    // Droop species (willow) get smaller, narrower cards so the fringe reads
    // as hanging twigs with leaf strips rather than broad pads.
    minSize: cR * (droopN > 0 ? 0.15 : 0.20) * (far ? 1.5 : 1),
    // 0.66 was too far: the biggest cards are wider than the opaque pad at the
    // root of the cluster texture is tall, so a card caught face-on showed that
    // pad as a bare green lozenge sitting on the crown. 0.56 keeps the size
    // spread without any single card being large enough to read as a panel.
    maxSize: cR * (droopN > 0 ? 0.42 : 0.56) * (far ? 1.5 : 1),
    upBias: def.crown === 'conic' ? 0.12 : droopN > 0 ? 0.1 : 0.26,
    sink: 0.30,
    flexBoost: 0.45 + droopN * 0.35,
    crownBias: 0.68,
    narrow: droopN > 0 ? 0.6 : 1,
    // C2(2026-09-14 backlog):「植物……质感还是假发片」——real depth only on the
    // outer, most-exposed ring (see shellCards' volumetric option / twigCluster).
    volumetric: far ? undefined : { fraction: 0.4, leaves: 3 },
  });
  // Re-normalise compliance against the whole tree so a card 6m up moves like
  // the branch under it rather than like a blade of grass on the ground.
  if (fringe.attributes.aFlex) {
    const fa = fringe.attributes.aFlex as THREE.BufferAttribute;
    const fp = fringe.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fa.count; i++) {
      fa.setX(i, fa.getX(i) * Math.pow(clamp(fp.getY(i) / totalH, 0, 1), 0.9));
    }
    fa.needsUpdate = true;
  }

  trunk.computeBoundingSphere();
  return { trunk, canopy, fringe, height: totalH, trunkR: def.r + def.flare * 0.4 };
}

/* ------------------------------------------------------------------ */
/* Bush construction                                                   */
/* ------------------------------------------------------------------ */

function buildBush(
  seed: number,
  size: number,
  lobes: number,
): { shell: THREE.BufferGeometry; fringe: THREE.BufferGeometry } {
  const rng = makeRng(seed);
  const balls: Ball[] = [];
  for (let i = 0; i < lobes; i++) {
    const az = i * 2.39996 + rng();
    const rad = i === 0 ? 0 : size * rangeOf(rng, 0.34, 0.62);
    balls.push({
      x: Math.cos(az) * rad,
      y: size * rangeOf(rng, 0.42, 0.78) * (i === 0 ? 1.05 : 1),
      z: Math.sin(az) * rad,
      r: size * rangeOf(rng, 0.44, 0.66),
      sy: rangeOf(rng, 0.74, 0.96),
    });
  }
  // 分辨率 16 → 12(单子 AV3)。16 是给老镇子写的,那里灌木「几乎每一镜都在
  // 齐眼到齐膝的高度上」(下面那条注释),所以壳做得细。大观园里它是配景:
  // 贴着石脚与墙根、42 m 外就剔除,一丛顶多占十几个像素高。16 实测一丛壳 957 三角、
  // 叶片 909,全园数百丛就是百万级——四镜 draw call 一度翻倍。12 把壳收到 ~540,
  // 剪影上看不出差别(丛本来就是一团圆疙瘩),省下来的三角留给峰。
  const geo = metaSurface(balls, { resolution: 12, isoLevel: 1.0, padding: size * 0.4, smooth: 1.1 });
  noiseDisplace(geo, size * 0.15, 1.7 / size, seed ^ 0x2b45, 3);
  geo.setAttribute('uv', boxProjectedUV(geo, 0.85));
  geo.computeVertexNormals();

  const thick = bakeCanopyShading(geo, balls as { x: number; y: number; z: number; r: number }[], {
    interior: 0.58,
    underside: 0.44,
    cool: 0.5,
  });
  geo.computeBoundingBox();
  const maxY = geo.boundingBox!.max.y || 1;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const flex = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    flex[i * 2] = Math.pow(clamp(pos.getY(i) / maxY, 0, 1), 1.3);
    flex[i * 2 + 1] = thick[i];
  }
  geo.setAttribute('aFlex', new THREE.BufferAttribute(flex, 2));
  geo.computeBoundingSphere();

  // A bush sits at eye-to-knee height in almost every shot in the town, so its
  // silhouette is scrutinised harder than a canopy twenty metres away. It gets
  // proportionally more, larger cards than a tree does.
  // 单子 AV3:卡片数减半(105+205·size → 58+112·size)。理由同上——这句话是
  // 老镇子的实情,不是大观园的:这里灌木不在游线的齐眼高度上,它贴着石脚。
  // 减半后一丛叶片 ~460 三角,剪影仍碎(卡片是**沿壳面**撒的,数量减半只是稀一点,
  // 不会退回「一个光滑的绿疙瘩」那种失败态)。
  const fringe = shellCards(geo, {
    seed: seed ^ 0x1eaf,
    count: Math.round(58 + size * 112),
    minSize: size * 0.23,
    maxSize: size * 0.42,
    upBias: 0.5,
    sink: 0.32,
    flexBoost: 0.6,
    crownBias: 0.5,
  });
  return { shell: geo, fringe };
}

/* ------------------------------------------------------------------ */
/* Ground-cover geometry                                               */
/* ------------------------------------------------------------------ */

/** A tuft: three curved cards fanned out and tilted, so it reads from above. */
function grassTuftGeometry(seed: number, cards = 3, height = 0.44): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < cards; i++) {
    const h = height * rangeOf(rng, 0.78, 1.18);
    // Two segments, not three. A tuft is ~30cm tall and there are twenty-two
    // thousand of them; the third segment adds two triangles of curve to a
    // blade that is a handful of pixels tall even when you are standing on it,
    // and multiplied out it was ~130k triangles in every pass of every frame.
    const card = curvedCard(h * rangeOf(rng, 0.85, 1.1), h, rangeOf(rng, 0.05, 0.14) * h, 0, 2);
    // Tilt outward so a top-down camera sees leaf area instead of a razor edge.
    card.rotateX(rangeOf(rng, 0.12, 0.3));
    card.rotateY((i / cards) * Math.PI * 2 + rangeOf(rng, -0.3, 0.3));
    card.translate(rangeOf(rng, -0.05, 0.05), 0, rangeOf(rng, -0.05, 0.05));
    parts.push(card);
  }
  const geo = mergeGeos(parts);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const maxY = geo.boundingBox!.max.y || 1;
  // Root-to-tip occlusion. Without it a tuft is a flat cut-out standing on the
  // lawn; with it, the base sinks into the turf and the tips catch the sun.
  // (It is also mandatory: a vertexColors material with no colour attribute
  // reads the attribute default of black.)
  tintByHeight(geo, maxY, 0.42, 0x86a35e);
  setFlex(geo, (_x, y) => {
    const t = clamp(y / maxY, 0, 1);
    return [Math.pow(t, 1.5), 0.35 + t * 0.65];
  });
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A scrap of forest floor: two overlapping cards of leaf litter lying almost
 * flat, at slightly different heights and angles.
 *
 * The ground under the treeline was flat green with hard-edged splat patches, and
 * no amount of grass fixes that — grass is the *same* colour as the problem.
 * Litter works because it is the wrong hue: warm browns and tired ochres against
 * a green lawn, which breaks up both the value and the hue of the turf and reads
 * as the layer of dead leaves that is actually under every real tree.
 *
 * Two cards rather than one, offset and tilted, so the patch has a broken outline
 * of its own and does not read as a rectangular decal from a grazing angle.
 */
function litterPatchGeometry(seed: number, size: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const R = size * 0.5;
  const RAD = 9;
  const RING = 3;

  /**
   * A drift, not a decal.
   *
   * The previous version was two flat `PlaneGeometry` quads laid at
   * `ground(x, z) + 12 mm`, and that is wrong in two ways at once, both of which
   * were plainly visible in the treeline and exterior shots:
   *
   *  - **It is coplanar with the terrain.** 12 mm of separation does not survive
   *    a depth buffer at 40 m of far plane, so every patch z-fought with the turf
   *    and rendered as a dense stipple of interleaved brown and green.
   *  - **It is flat and the ground is not.** The treeline sits on the slope
   *    rising to y ~ 2.6, and a rigid 1.45 m quad on a 15 degree slope buries one
   *    edge and floats the other. What remains above the turf is a
   *    *straight-edged* sliver, so the wood was littered with hard-cornered dark
   *    rectangles that read as scorch marks in a lawn.
   *
   * The fix is the same one the buildings use for their dirt skirts: drape rather
   * than lay. This is a low mound — a radial dome about 12% of its radius high,
   * whose outer ring dives *below* the ground. Nothing is coplanar (every face
   * is tilted, so it catches its own shade and z-fighting is impossible), and the
   * terrain cuts the mound along its curved buried rim rather than across a
   * straight edge, so a patch on a slope reads as litter thinning into grass.
   *
   * The radius is also wobbled per-vertex, so the outline is a lobed blob rather
   * than a circle, and the alpha-cut leaf texture breaks it further.
   */
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // Per-spoke radius and height wobble, generated once so the ring seam closes.
  const wob: number[] = [];
  const hWob: number[] = [];
  for (let a = 0; a < RAD; a++) {
    wob.push(rangeOf(rng, 0.68, 1.22));
    hWob.push(rangeOf(rng, 0.7, 1.3));
  }
  // Ring radii, and their height as a fraction of R. The last ring is negative:
  // it is the buried skirt that absorbs whatever the terrain does underneath.
  const rr = [0, 0.42, 0.78, 1.0];
  // The skirt dives only 5% of the radius, not 15%. A deep skirt is a band of
  // outward- and *downward*-facing wall, and on the treeline's slope the downhill
  // half of that band stands clear of the turf — where, facing away from both the
  // sun and the sky, it rendered as a black dash. From twenty of those per screen
  // the forest floor looked cracked. The rim barely needs to dip at all: the
  // radial UV puts the outer ring at the edge of the litter texture, which is
  // transparent there, so the alpha test does most of the burying.
  const hh = [0.13, 0.105, 0.05, -0.055];
  for (let k = 0; k <= RING; k++) {
    for (let a = 0; a <= RAD; a++) {
      const ai = a % RAD;
      const th = (a / RAD) * Math.PI * 2;
      const r = R * rr[k] * lerp(1, wob[ai], rr[k]);
      const y = R * hh[k] * (k === RING ? 1 : hWob[ai]);
      positions.push(Math.cos(th) * r, y, Math.sin(th) * r);
      // Radial UV so one litter texture covers the whole mound once.
      uvs.push(0.5 + Math.cos(th) * rr[k] * 0.5, 0.5 + Math.sin(th) * rr[k] * 0.5);
    }
  }
  const stride = RAD + 1;
  for (let k = 0; k < RING; k++) {
    for (let a = 0; a < RAD; a++) {
      const i0 = k * stride + a;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      if (k === 0) {
        indices.push(i0, i2, i3);
      } else {
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  /**
   * Flatten the normals toward world up.
   *
   * Litter is a *ground* surface: physically it is a 2 cm layer of leaves, and
   * every part of it — including the part draped over the shoulder of the mound —
   * sees the same sky the turf beside it sees. The mound's geometric normals do
   * not say that. The rim's point outward and slightly down, which under a sky
   * fill and a 38 degree sun is nearly unlit, so the shoulder of every patch came
   * out as a dark rind around a lit centre. Biasing 78% toward +Y keeps just
   * enough of the real shape to give the mound a soft form while lighting it like
   * the ground it is part of.
   */
  {
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const n = new THREE.Vector3();
    for (let i = 0; i < nor.count; i++) {
      n.fromBufferAttribute(nor, i);
      n.y += 0.78 * (1 - n.y);
      n.normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    nor.needsUpdate = true;
  }

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // Value break across the mound, a little darker in the rim where the grass
    // closes over it. This is the contact shading that stops the patch reading as
    // a sticker laid on top of the turf. Only a shallow gradient though — the rim
    // used to reach 0.62 and that, multiplied into an already grazing-lit face,
    // is what made the edge of a drift read as a hole rather than as a hollow.
    const rel = clamp(pos.getY(i) / (R * 0.13), -1, 1);
    const v = rangeOf(rng, 0.86, 1.06) * lerp(0.82, 1.0, smoothstep(-0.9, 0.45, rel));
    colors[i * 3] = v;
    colors[i * 3 + 1] = v * 0.98;
    colors[i * 3 + 2] = v * 0.92;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Dead leaves on the ground do not sway; they still need the attribute.
  setFlex(geo, () => [0, 0.1]);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A fallen branch: one bent, tapered stick with a side stub, resting on the
 * ground along its own local +X.
 *
 * This is the piece of detail that makes a forest floor read as a forest rather
 * than as a lawn with trees standing on it. It shares the bark material, so it
 * is free of a texture bake, and because it is instanced the whole wood's
 * deadfall is one draw call.
 */
function deadfallGeometry(seed: number, len: number, r: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const bendAz = rng() * Math.PI * 2;
  const sag = rangeOf(rng, 0.05, 0.14);
  const spine: THREE.Vector3[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    spine.push(
      new THREE.Vector3(
        t * len,
        // Sits on the ground at both ends, bowed up in the middle: a stick lying
        // on turf is supported at its ends, and the gap under the bow is what
        // makes it read as *on* the ground rather than half sunk into it.
        r * 0.9 + Math.sin(t * Math.PI) * r * sag * 9,
        Math.sin(t * 2.3 + bendAz) * len * 0.07,
      ),
    );
  }
  const main = taperedTube({
    spine,
    rings: 5,
    radial: 6,
    vScale: len * 1.5,
    radius: (t) => r * Math.pow(1 - t * 0.66, 0.55) + 0.008,
    lobe: (_t, theta) => 1 + Math.sin(theta * 5 + 1.1) * 0.07,
  });

  // One side shoot. A straight bare stick reads as dropped dowel.
  const az = rangeOf(rng, 0.7, 1.5) * (rng() < 0.5 ? 1 : -1);
  const at = rangeOf(rng, 0.35, 0.65);
  const base = spine[Math.round(at * 4)];
  const sl = len * rangeOf(rng, 0.22, 0.38);
  const sp: THREE.Vector3[] = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    sp.push(
      new THREE.Vector3(
        base.x + Math.cos(az) * sl * t,
        base.y - t * r * 0.5,
        base.z + Math.sin(az) * sl * t,
      ),
    );
  }
  const stub = taperedTube({
    spine: sp,
    rings: 3,
    radial: 5,
    vScale: sl * 1.5,
    radius: (t) => r * 0.5 * Math.pow(1 - t * 0.9, 0.6) + 0.006,
  });

  const geo = mergeGeos([main, stub]);
  geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // Dead wood is greyer and darker than a living trunk, and the underside is
    // in permanent contact shadow.
    const ao = lerp(0.52, 1.0, clamp(pos.getY(i) / (r * 2.2), 0, 1));
    colors[i * 3] = ao * 0.86;
    colors[i * 3 + 1] = ao * 0.82;
    colors[i * 3 + 2] = ao * 0.74;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  setFlex(geo, () => [0, 0.08]);
  geo.computeBoundingSphere();
  return geo;
}

/** Darkens a plant toward its base and cools the shadow rather than greying it. */
function tintByHeight(
  geo: THREE.BufferGeometry,
  maxY: number,
  baseDark: number,
  coolHex: number,
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cool = new THREE.Color(coolHex);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(pos.getY(i) / maxY, 0, 1);
    const ao = lerp(1 - baseDark, 1.0, smoothstep(0, 0.72, t));
    const k = (1 - ao) * 0.8;
    colors[i * 3] = lerp(ao, cool.r * 1.6 * ao, k);
    colors[i * 3 + 1] = lerp(ao, cool.g * 1.4 * ao, k);
    colors[i * 3 + 2] = lerp(ao, cool.b * 1.5 * ao, k);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Three rounded clover leaves on short stalks. */
function cloverGeometry(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const r = rangeOf(rng, 0.045, 0.072);
    // A 5-6cm leaf: five segments read as round once the dome below curves it,
    // and there are ~5800 clovers paying for every extra triangle three times.
    const leaf = new THREE.CircleGeometry(r, 4);
    // Dome the leaf so it catches a highlight rather than reading as a decal.
    const pos = leaf.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const d = Math.hypot(pos.getX(k), pos.getY(k)) / r;
      pos.setZ(k, (1 - d * d) * r * 0.34);
    }
    leaf.rotateX(-Math.PI / 2 + rangeOf(rng, -0.42, -0.16));
    const az = (i / 3) * Math.PI * 2 + rng() * 0.5;
    leaf.rotateY(az);
    leaf.translate(Math.cos(az) * r * 0.86, rangeOf(rng, 0.035, 0.075), Math.sin(az) * r * 0.86);
    parts.push(leaf);
  }
  const geo = mergeGeos(parts);
  geo.computeVertexNormals();
  const colors = new Float32Array((geo.attributes.position as THREE.BufferAttribute).count * 3);
  colors.fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  setFlex(geo, (_x, y) => [clamp(y / 0.1, 0, 1) * 0.6, 0.8]);
  geo.computeBoundingSphere();
  return geo;
}

/** Oversized diorama flower: stem, five petals, a domed centre. */
function flowerGeometry(seed: number, accent: THREE.Color): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const height = rangeOf(rng, 0.18, 0.3);
  const tiltAz = rng() * Math.PI * 2;
  const tilt = rangeOf(rng, 0.06, 0.3);

  const spine: THREE.Vector3[] = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    spine.push(
      new THREE.Vector3(
        Math.cos(tiltAz) * tilt * height * t * t,
        height * t,
        Math.sin(tiltAz) * tilt * height * t * t,
      ),
    );
  }
  const stem = taperedTube({
    spine,
    rings: 3,
    // An 8mm stem. Four sides is already more than the silhouette can show.
    radial: 4,
    vScale: 1,
    radius: (t) => 0.008 * (1 - t * 0.35),
  });
  const head = spine[3];

  const parts: THREE.BufferGeometry[] = [stem];
  const petals = 5 + Math.floor(rng() * 2);
  const pr = rangeOf(rng, 0.042, 0.062);
  for (let i = 0; i < petals; i++) {
    const p = curvedCard(pr * 1.15, pr * 1.7, -pr * 0.42, 0, 2);
    p.rotateX(-Math.PI / 2 + rangeOf(rng, 0.5, 0.86));
    p.rotateY((i / petals) * Math.PI * 2 + rangeOf(rng, -0.1, 0.1));
    p.translate(head.x, head.y, head.z);
    parts.push(p);
  }
  // The flower centre is a ~2cm dome. Six-by-three was 24 triangles on
  // something that is never more than a few pixels of solid yellow.
  const centre = new THREE.SphereGeometry(pr * 0.42, 4, 2);
  centre.scale(1, 0.62, 1);
  centre.translate(head.x, head.y + pr * 0.12, head.z);
  parts.push(centre);

  const geo = mergeGeos(parts);
  geo.computeVertexNormals();

  // Vertex colours carry the part identity — green stem, accent petals, gold
  // centre — so one draw call covers a whole flower.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const stemCount = (stem.attributes.position as THREE.BufferAttribute).count;
  const centreStart = pos.count - (centre.attributes.position as THREE.BufferAttribute).count;
  const gold = new THREE.Color(0xffd447);
  const green = new THREE.Color(0x5f9b3e);
  for (let i = 0; i < pos.count; i++) {
    let c: THREE.Color;
    if (i < stemCount) c = green;
    else if (i >= centreStart) c = gold;
    else {
      // Petals pale slightly toward the tip; a flat-coloured petal reads as
      // plastic at the diorama scale the art bible asks for.
      const t = clamp((pos.getY(i) - head.y) / (pr * 1.4) + 0.5, 0, 1);
      c = accent.clone().lerp(new THREE.Color(0xfaf3e4), t * 0.34);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  setFlex(geo, (_x, y) => [Math.pow(clamp(y / height, 0, 1), 1.4), 0.7]);
  geo.computeBoundingSphere();
  return geo;
}

/** A leafy weed / small fern — five leaf cards fanned from one point. */
function weedGeometry(seed: number, size: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const h = size * rangeOf(rng, 0.7, 1.15);
    // Two segments, not three: a 50 cm fern frond a metre from the camera does
    // not show the third segment's curvature, and there are thousands of them.
    const card = curvedCard(h * 0.72, h, rangeOf(rng, 0.16, 0.34) * h, 0, 2);
    card.rotateX(rangeOf(rng, 0.24, 0.52));
    card.rotateY((i / n) * Math.PI * 2 + rangeOf(rng, -0.35, 0.35));
    parts.push(card);
  }
  const geo = mergeGeos(parts);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const maxY = geo.boundingBox!.max.y || 1;
  tintByHeight(geo, maxY, 0.36, 0x8aa668);
  setFlex(geo, (_x, y) => {
    const t = clamp(y / maxY, 0, 1);
    return [Math.pow(t, 1.4), 0.4 + t * 0.6];
  });
  geo.computeBoundingSphere();
  return geo;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export function buildVegetation(ctx: GameContext): void {
  const rng = makeRng(ctx.seed ^ 0x5eed1e5);
  const ground = ctx.collision.groundHeight;
  const plantSample = plantMaskSampler(ctx);
  /** 旧窗口的植物掩码(D-37:烘焙域钉在 `LEGACY_MASK_BOUNDS`,与 `719171d0` 逐格相同)。旧散布盒里的散布只读它。 */
  const mask = new DensityMask(plantSample, LEGACY_MASK_BOUNDS);
  /** 块里的植物掩码:同一个采样函数,世界格点,按块懒烤。块里的散布只读它。 */
  const wmask = new LatticeMask(plantSample, EXT_MASK_STEP, 32);
  /** 定点落位(堤柳、隔岸花……)用:旧窗口里读旧掩码(与旧版逐位同),窗口外读世界掩码。 */
  const anyMaskAt = (x: number, z: number): number => (inLegacyWindow(x, z) ? mask.at(x, z) : wmask.at(x, z));
  /** 块里撒出来的点最后一道裁:在当前窗口里、不在旧散布盒里。 */
  const keepExt = (x: number, z: number): boolean =>
    !inLegacy(x, z) && x >= VEG.curMinX && x <= VEG.curMaxX && z >= VEG.curMinZ && z <= VEG.curMaxZ;
  /** 与当前散布窗口相交、且不整个落在旧散布盒里的块(D-37)。 */
  const curRect: Rect = { minX: VEG.curMinX, maxX: VEG.curMaxX, minZ: VEG.curMinZ, maxZ: VEG.curMaxZ };
  const extBlocks: BlockKey[] = blocksOver(curRect, EXT_BLOCK).filter((b) => !rectWithin(blockRect(b, EXT_BLOCK), LEGACY_SCATTER));
  const blockRng = (b: BlockKey, salt: number) => makeRng((ctx.seed ^ blockHash(b.bx, b.bz, salt)) >>> 0);
  const clump = new Simplex(ctx.seed ^ 0x0c10ff);
  // 草被疏密场(单子 T):grassDensity 与地形 masks.soil(露土)共用同一实现,
  // 种子/频率与原内联写法逐字相同——草分布不因这次抽取而变。
  const grassCover = makeGrassCoverField(ctx.seed);

  const group = new THREE.Group();
  group.name = 'Vegetation';
  ctx.scene.add(group);
  // 单子 AX2-0:「植树」往下再拆一层,量的是每一段从上一个 mark 到这里的墙钟时间。
  // 只量不改:不碰任何规则、随机数与遍历顺序。结果挂在 group.userData.buildTimings。
  const buildTimings: [string, number][] = [];
  let markAt = performance.now();
  const mark = (label: string): void => { const now = performance.now(); buildTimings.push([label, now - markAt]); markAt = now; };

  mark('setup(mask/草被场)');
  /* ---------------- materials -------------------------------------- */

  /**
   * Three bark surfaces, not one.
   *
   * The old wood used `TextureLab.barkMaps` for every species: one grey-brown
   * albedo whose noise is stretched 8 : 1 in u : v, which is where the vertical
   * streak down every trunk came from. `barkSet` (see FoliageMaterials) replaces
   * it with a plated Worley field — cracks between plates, fine fibre inside
   * them, horizontal checking across them — authored in a warm palette and baked
   * with a deliberately violent normal map, because a trunk fills a third of the
   * frame in the treeline shot and relief is the only thing that stops it
   * reading as a painted tube.
   *
   * `roughShare` slides the same field from a deeply fissured oak to an almost
   * smooth birch, so three bakes cover the whole wood. Material colour is white:
   * hue arrives entirely as the per-species `barkTint` instance colour, which
   * means eight species of trunk cost three textures and zero extra draw calls.
   */
  // 单子 BH1:参数的真源搬到 `texture-jobs.ts` 的 BARK_SETS(worker 预热同一份);下面的取色理由照旧留在这里。
  const barkSets: Record<BarkSet, ReturnType<typeof barkSet>> = {
    oak: barkSet(...BARK_SETS.oak),
    // Was 0x4e4335 → 0xa8977a: both neutral, and the crack colour in particular
    // was a dead grey, so the deepest, most visible part of the relief carried no
    // hue at all. Warm both ends and the whole surface reads as wood.
    ash: barkSet(...BARK_SETS.ash),
    // Birch: the paper is warm-white, the lenticels are grey-brown.
    pale: barkSet(...BARK_SETS.pale),
  };
  const makeBarkMat = (set: BarkSet) =>
    createFoliageMaterial(ctx.env, {
      color: 0xffffff,
      map: barkSets[set].map,
      // The albedo is mid-value by construction, so it only needs a light lift
      // to survive a stylised sky. Lifting harder is what bleached the old
      // trunks to grey card.
      mapContrast: 0.86,
      normalMap: barkSets[set].normalMap,
      roughnessMap: barkSets[set].roughnessMap,
      normalScale: set === 'pale' ? 1.2 : 2.0,
      roughness: 0.94,
      windScale: 0.16,
      // Bark is opaque, but a low wrap keeps the shaded side of a trunk from
      // going to flat black under one low sun.
      wrap: 0.34,
      transStrength: 0.0,
      haloStrength: 0.0,
      side: THREE.FrontSide,
    });
  const barkMats: Record<BarkSet, ReturnType<typeof createFoliageMaterial>> = {
    oak: makeBarkMat('oak'),
    ash: makeBarkMat('ash'),
    pale: makeBarkMat('pale'),
  };

  // Three leaf palettes rather than six: species read apart on silhouette and
  // instance tint, and three 512² bakes is already a noticeable slice of the
  // loading budget.
  const leafSets: Record<LeafSet, ReturnType<typeof leafMaps>> = {
    // 单子 BH1:参数真源在 `texture-jobs.ts` 的 LEAF_SETS。
    warm: leafMaps(...LEAF_SETS.warm),
    cool: leafMaps(...LEAF_SETS.cool),
    needle: leafMaps(...LEAF_SETS.needle),
    apricot: leafMaps(...LEAF_SETS.apricot),
  };

  const canopyMat = (set: LeafSet, tint: number, wind: number, tri = 0.55) =>
    createFoliageMaterial(ctx.env, {
      color: tint,
      map: leafSets[set].map,
      normalMap: leafSets[set].normalMap,
      roughnessMap: leafSets[set].roughnessMap,
      normalScale: 0.9,
      roughness: 0.86,
      windScale: wind,
      wrap: 0.52,
      transColor: set === 'needle' ? 0x8fc86a : set === 'apricot' ? 0xff9e8a : 0xb2e065,
      // Backlit leaves have to *glow*, not merely be lit. transPower down and
      // strength up widens the transmission lobe so the whole sunward half of a
      // crown lifts instead of only the few vertices pointing at the sun.
      transStrength: 2.9,
      transPower: 2.1,
      haloStrength: 0.18,
      triplanar: tri,
    });

  // The leaf-cluster cards that break every blob silhouette. One texture, one
  // material per leaf palette — the cards read apart through per-instance tint
  // and the vertex gradient baked into each card, not through extra bakes.
  // Two clump scales, because a leaf is an absolute size and a canopy is not.
  // The tree texture is coarse so its scallops still read from twenty metres;
  // the shrub texture packs three times as many, much smaller leaves, because a
  // bush is looked at from two metres and 40cm leaves make it a houseplant.
  const clusterTex = leafClusterTexture('canopy', ctx.seed ^ 0x1eafc1, 17, 1.0);
  const shrubTex = leafClusterTexture('shrub', ctx.seed ^ 0x1eafc2, 40, 0.46);
  const makeFringeMat = (set: LeafSet, tex: THREE.Texture) =>
    createFoliageMaterial(ctx.env, {
      color: set === 'needle' ? 0xc9e0b4 : set === 'cool' ? 0xdcf0c2 : set === 'apricot' ? 0xffffff : 0xe8f4cc,
      map: tex,
      roughness: 0.88,
      windScale: 1.25,
      wrap: 0.62,
      transColor: set === 'needle' ? 0x8fc86a : set === 'apricot' ? 0xff9e8a : 0xb2e065,
      // The cards are one leaf thick and they are the part of the crown the sky
      // is actually behind, so they carry the strongest transmission in the
      // scene. This is what makes a backlit treeline read as foliage.
      transStrength: 3.4,
      transPower: 2.0,
      haloStrength: 0.2,
      alphaTest: 0.38,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
    });

  const fringeMats: Record<LeafSet, ReturnType<typeof createFoliageMaterial>> = {
    warm: makeFringeMat('warm', clusterTex),
    cool: makeFringeMat('cool', clusterTex),
    needle: makeFringeMat('needle', clusterTex),
    apricot: makeFringeMat('apricot', blossomClusterTexture(clusterTex)),
  };
  const shrubMats: Record<'warm' | 'cool', ReturnType<typeof createFoliageMaterial>> = {
    warm: makeFringeMat('warm', shrubTex),
    cool: makeFringeMat('cool', shrubTex),
  };

  /**
   * The canopy's shadow-pass stand-in: the same blob, alpha-cut by a coarse hole
   * mask so the shade it throws is dappled rather than solid.
   *
   * `DoubleSide` deliberately. Three.js normally shadow-renders a `FrontSide`
   * material from its back faces to push the acne behind the geometry, but a
   * perforated blob is no longer a closed volume — cutting a hole in the front
   * exposes the inside of the back, and a single-sided depth pass would then let
   * light through the *whole* crown rather than through one gap.
   */


  mark('materials');
  /* ---------------- species geometry ------------------------------- */

  const built = SPECIES.map((def, i) => ({
    def,
    geo: buildTree(def, (ctx.seed ^ 0x7ee0) + i * 7919),
    /** BC1 远景档:同种子(骨架与冠形同近档),只降分辨率,见 buildTree 的 `far`。 */
    farGeo: buildTree(def, (ctx.seed ^ 0x7ee0) + i * 7919, true),
    mat: canopyMat(def.leafSet, def.tint, 1.0),
    fringeMat: fringeMats[def.leafSet],
    barkMat: barkMats[def.bark],
    spots: [] as { x: number; z: number; s: number; yaw: number; tilt: number; tiltAz: number; ext?: boolean }[],
  }));

  mark('species geometry');
  /* ---------------- tree placement --------------------------------- */

  /**
   * Background planting reads the current terrain domain and route clearance.
   * A low-frequency clump field gives dry rising land distinct copses while
   * preserving the route foreground for later region-specific planting.
   */
  const treePaths = getPlan().paths;

  /**
   * 山上不撒树（单子 AV2）。
   *
   * 病：下面 `land` 那一项按地面标高从 0.045 升到 0.595——**地越高树越密**。
   * 那条曲线是给「干燥的高地长林子」写的，在一座假山上它的意思变成了
   * 「山越高树越多」：翠嶂是这一带最高的地，于是 36 棵树落在它的多边形里
   * （全园 180 棵的 20%），21 棵挤在山脊南侧、正好挡在门与峰之间，
   * `mound_block` 里整组峰顶盖在槐冠底下（景需求文档 §6-2）。
   *
   * 修法不是给翠嶂开一条特例，而是**山上的树一律点名种**：落在任何一座
   * `plan.hills[]` 多边形内（含 3 m 羽化带）的散布点一概返回 0，山上要树就
   * 写进 `scenes/<区>.json` 的 `trees[]`。理由：一座假山上的树是造景，
   * 位置是被峰、被路、被视线决定的，不是被「这里地高而干」决定的——
   * 散布器算不出「松探石」。羽化带 3 m 是把山脚那一圈也让开，
   * 免得树贴着多边形边界排成一条沿等高线的篱笆。
   *
   * ⚠️ 这一改**作用于全园六座山**（翠嶂 / 大主山 / 青山 / 凸碧 / 花溆 / 稻香坡），
   * 不只翠嶂。其余五座山现在会变秃，那是这一条的**已知代价**：它们各自的
   * 点名种植还没做，要做时照 `scenes/cuizhang.json` 的 `trees[]` 补。
   * 全园树数与各镜三角的前后差写在单子 AV 的回报里。
   */
  const planHills = (getPlan() as unknown as { hills?: { polygon: [number, number][] }[] }).hills ?? [];
  const HILL_FEATHER = 3;
  const hillBoxes = planHills.map((h) => {
    const xs = h.polygon.map((q) => q[0]);
    const zs = h.polygon.map((q) => q[1]);
    return {
      poly: h.polygon as unknown as Point2[],
      minX: Math.min(...xs) - HILL_FEATHER, maxX: Math.max(...xs) + HILL_FEATHER,
      minZ: Math.min(...zs) - HILL_FEATHER, maxZ: Math.max(...zs) + HILL_FEATHER,
    };
  });
  const onPlanHill = (x: number, z: number): boolean => {
    for (const h of hillBoxes) {
      if (x < h.minX || x > h.maxX || z < h.minZ || z > h.maxZ) continue;
      if (locatePoint(h.poly, [x, z]) !== 'outside') return true;
      if (distanceToPolyline(x, z, h.poly) < HILL_FEATHER) return true;
    }
    return false;
  };

  /** `scenes/<区>.json` 点名的树（单子 AV2）。位置是绝对坐标，理由见 `SceneTree`。 */
  const sceneTrees = getScenes().flatMap((sc) => sc.trees ?? []);

  /**
   * scenes 里每一件白石的世界落位（单子 AV3）。
   *
   * 口径与 `builder/compose/composer.ts` 的 `resolvePosition()` 一致：
   * `named[]` 读 plan 锚点本身，`placements[]` 读锚点 + dx/dz。**一个坐标都不手抄**
   * ——峰一挪，贴石的灌木、峰脚的蕨、峰顶的藤萝全都跟着挪，这正是旧藤萝
   * 「锚点写死四个数、峰换了位置没人发现」那个坑的修法（景需求文档 §5）。
   *
   * `kind` 分峰与石脚：灌木和蕨要贴的是**峰**，藤萝更要挂在峰上，
   * 半埋的 `skirt*` 岩板只有一米来高，挂不住三米长的垂蔓。
   */
  const baishiWorld: { variant: string; x: number; z: number; yaw: number; kind: 'peak' | 'skirt' | 'other' }[] = (() => {
    const anchors = new Map<string, [number, number]>();
    for (const r of (getPlan() as unknown as { regions: { rocks?: { id: string; x: number; z: number }[] }[] }).regions)
      for (const k of r.rocks ?? []) anchors.set(k.id, [k.x, k.z]);
    const kindOf = (v: string): 'peak' | 'skirt' | 'other' =>
      /^group|^peak/.test(v) ? 'peak' : /^skirt/.test(v) ? 'skirt' : 'other';
    const out: { variant: string; x: number; z: number; yaw: number; kind: 'peak' | 'skirt' | 'other' }[] = [];
    for (const sc of getScenes()) {
      for (const n of sc.named ?? []) {
        if (n.part !== 'baishi') continue;
        const a = anchors.get(n.object);
        if (a) out.push({ variant: n.variant ?? '', x: a[0], z: a[1], yaw: n.yaw ?? 0, kind: kindOf(n.variant ?? '') });
      }
      for (const pl of sc.placements ?? []) {
        if (pl.part !== 'baishi') continue;
        const a = anchors.get(pl.anchor);
        if (a) out.push({ variant: pl.variant ?? '', x: a[0] + pl.dx, z: a[1] + pl.dz, yaw: pl.yaw ?? 0, kind: kindOf(pl.variant ?? '') });
      }
    }
    return out;
  })();
  const baishiPeaks = baishiWorld.filter((b) => b.kind === 'peak');
  /** 到最近一组峰的水平距离；没有峰就是 Infinity。 */
  const peakDistance = (x: number, z: number): number => {
    let d = Infinity;
    for (const b of baishiPeaks) {
      const t = Math.hypot(x - b.x, z - b.z);
      if (t < d) d = t;
    }
    return d;
  };
  /**
   * 背阴度：1 = 峰的背阴面，0.4 = 向阳面。
   *
   * 光从 +X/+Z 方向、仰角 38° 打过来（`SunKey`，与 `tools/shot-list.mjs` 的
   * `mound_west` 注释里那次实测同一个判断），所以峰的 −X/−Z 半边是背阴面。
   */
  const peakShade = (x: number, z: number): number => {
    let best = 0.4;
    for (const b of baishiPeaks) {
      const dx = x - b.x, dz = z - b.z;
      const l = Math.hypot(dx, dz);
      if (l < 1e-6 || l > 9) continue;
      const dot = (dx / l) * -0.7071 + (dz / l) * -0.7071;
      const v = lerp(0.4, 1.0, smoothstep(-0.35, 0.55, dot));
      if (v > best) best = v;
    }
    return best;
  };

  /** D-37:树的密度拆成「用哪张掩码」与「撒在哪」两半。旧散布盒读旧掩码、盒外为 0(与旧版逐位同);块里读世界掩码、盒内为 0。 */
  const treeDensityOn = (mk: { at(x: number, z: number): number }, x: number, z: number): number => {
    const m = mk.at(x, z);
    if (m < 0.55) return 0;
    if (onPlanHill(x, z)) return 0;
    if (HERO_TREES.some(([hx,hz]) => Math.hypot(x-hx,z-hz)<2.5)) return 0;
    if (sceneTrees.some((t) => Math.hypot(x - t.x, z - t.z) < 2.5)) return 0;
    // 区域硬约束先行:蘅芜苑「一株花木也无」、芦苇荡不长树,mix 为空即全区无树。
    const reg = regionOf(x, z);
    const rt = reg ? REGION_TREES[reg] : undefined;
    if (rt && rt.mix.length === 0) return 0;
    // Background copses occupy dry rising land, leaving the authored route and
    // its sightline foreground open until region-specific planting lands in P3.
    const routeDistance = Math.min(...treePaths.map(p => distanceToPolyline(x,z,p.points)));
    const routeClearance = smoothstep(18,28,routeDistance);
    if (routeClearance <= 0) return 0;
    const land = 0.045 + smoothstep(1.8,5.5,ground(x,z)) * 0.55;
    const c = fbm2(clump, x * 0.09, z * 0.09, 3) * 0.5 + 0.5;
    return clamp(land * (0.35+c*0.95),0,1) * routeClearance * outsideBuildings(x,z,1.4) * (rt?.density ?? 1);
  };
  const treeDensity = (x: number, z: number): number => (inLegacy(x, z) ? treeDensityOn(mask, x, z) : 0);
  const treeDensityExt = (x: number, z: number): number => (inLegacy(x, z) ? 0 : treeDensityOn(wmask, x, z));

  /**
   * Copses, not a lattice.
   *
   * A single Poisson pass with a fixed minimum distance is a *jammed packing*
   * once the attempt count saturates, and a jammed packing at 2.3 m looks
   * exactly like what it is: fifteen trunks at near-uniform spacing. It was the
   * second-worst thing about the treeline after the trunks themselves.
   *
   * So placement is two-tier. Poisson picks copse centres at 3.7 m — chosen so
   * that centres times mean cluster size reproduces the old total, because the
   * wood's overall mass was fine — and each centre grows one to five trees with
   * a radius distribution biased toward the middle. The result is stands of two
   * and three trees almost touching, with genuine clearings between them, and a
   * 1.5 m hard separation so nothing interpenetrates.
   */
  const treeSpots: Spot[] = [];
  // treeBudget 语义（单子 AV-b1）：「筛后 ≤180」的纯上限，不是「撒够 180」——
  // 筛后不足不补撒（补撒又是顺序依赖）。旧的 `min(180, 面积/400)` 按当前地形
  // 包围盒算出 148,预算常年打满——**预算截断本身就是顺序依赖的补撒**:
  // 一区密度下降,候选序列后排的丛就顶进名额,「其他区一棵不动」永远过不了。
  // 所以预算固定 180、落到永远触不到的位置,树数由下面的密度筛自然决定。
  const treeBudget = 180;
  {
    // 树的 copse 散布走「先撒后筛」档（P-28）：候选丛心全园稳定，
    // 留不留由丛心坐标哈希决定；局部密度改动不再全局重洗。
    // 用专用 rng,不吃共享流——树这路的飞镖消耗不再影响灌木/花草的位置。
    // tries 9000→7000 之外还要说明:24000 撒出的筛后树数约 379,会顶穿
    // treeBudget 的 180 上限触发截断补撒;7000 的筛后约 147,与 AV 前的
    // 146 同量级,上限永远触不到。
    const copses = poissonScatter({
      ...LEGACY_SCATTER,
      radius: 3.7, tries: 7000, density: treeDensity, rng: makeRng(ctx.seed ^ 0x7eee), filterByHash: true,
    });
    // Bucketed by copse for the separation test: over a few hundred trees a
    // naive all-pairs check is fine, but a copse only ever collides with its own
    // members and its immediate neighbours, so test against a local window.
    const MIN_SEP2 = 1.5 * 1.5;
    for (const c of copses) {
      if (treeSpots.length >= treeBudget) break;
      // 每个丛的生长参数用丛心坐标播种,不吃共享 rng 的顺序——否则筛掉一个丛,
      // 后面所有丛的簇形、每棵树的种与姿态都会整体平移（P-28 的另一半）。
      const copseRng = makeRng((ctx.seed ^ Math.floor(scatterHash01(c.x, c.z) * 4294967296)) >>> 0);
      // Cluster size skewed low: mostly singles and pairs, occasional thicket.
      const n = 1 + Math.floor(Math.pow(copseRng(), 1.35) * 5);
      const spread = rangeOf(copseRng, 0.9, 3.1);
      for (let i = 0; i < n && treeSpots.length < treeBudget; i++) {
        const a = copseRng() * Math.PI * 2;
        const r = i === 0 ? 0 : spread * Math.pow(copseRng(), 0.55);
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (treeDensity(x, z) <= 0.02) continue;
        let ok = true;
        // Copses arrive in random order, so checking only the previous 24
        // entries cannot enforce separation against a nearby older copse.
        for (let k = 0; k < treeSpots.length; k++) {
          const dx = treeSpots[k].x - x;
          const dz = treeSpots[k].z - z;
          if (dx * dx + dz * dz < MIN_SEP2) {
            ok = false;
            break;
          }
        }
        if (ok) treeSpots.push({ x, z });
      }
    }
  }

  /* ---------------- D-37:旧散布盒外的树,按世界对齐的块撒 ---------------- */

  /**
   * 块里两级散布(丛心 → 株)的共用骨架(树与灌木)。
   *
   * 一块的候选只取决于这一块:丛心是块内的泊松(飞镖流用块坐标播种),株位用丛心坐标播种,
   * 块内按生成顺序做株间硬隔,再与旧散布盒里已定的株做硬隔(旧的永远赢)。
   * 跨块的株间硬隔**不走顺序**:两块的候选挨得比 `sep` 近,坐标哈希小的留、大的让——
   * 这是对称规则,结果只取决于两块各自的候选,与遍历顺序、窗口、区数都无关。
   * 为此窗口边上的块要把外面一圈邻块的候选也算出来(只拿来比,不落地)。
   */
  const cellKey = (bx: number, bz: number): number => (bx + 32768) * 65536 + (bz + 32768);
  const extClusterSpots = <T extends Spot>(candidatesOf: (b: BlockKey) => T[], sep: number): T[] => {
    const need = new Map<number, BlockKey>();
    for (const b of extBlocks)
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const k = { bx: b.bx + dx, bz: b.bz + dz };
        if (!rectWithin(blockRect(k, EXT_BLOCK), LEGACY_SCATTER)) need.set(cellKey(k.bx, k.bz), k);
      }
    const cand = new Map<number, T[]>();
    for (const [k, b] of need) cand.set(k, candidatesOf(b));
    const sep2 = sep * sep;
    const out: T[] = [];
    for (const b of extBlocks) {
      for (const p of cand.get(cellKey(b.bx, b.bz)) ?? []) {
        if (!keepExt(p.x, p.z)) continue;
        const hp = scatterHash01(p.x, p.z);
        let lose = false;
        for (let dz = -1; dz <= 1 && !lose; dz++) for (let dx = -1; dx <= 1 && !lose; dx++) {
          if (dx === 0 && dz === 0) continue;
          for (const q of cand.get(cellKey(b.bx + dx, b.bz + dz)) ?? []) {
            if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 >= sep2) continue;
            const hq = scatterHash01(q.x, q.z);
            if (hq < hp || (hq === hp && (q.x < p.x || (q.x === p.x && q.z < p.z)))) { lose = true; break; }
          }
        }
        if (!lose) out.push(p);
      }
    }
    return out;
  };

  /* ---------------- 杏林(单子 BA4):泥墙与茅屋之间成片 ---------------- */

  /**
   * 「轉過山怀中,隱隱露出一帶黃泥筑就矮牆……有幾百株杏花,如噴火蒸霞一般。里面數楹茅屋。」(07-11)
   * `dx_approach` 那一眼要的是「墙后杏花成片、杏花后露茅屋顶」,所以林带取**泥墙与茅屋之间**:
   *   - 东西:泥墙走线的两端(plan `daoxiangcun.mud-wall` 的 runs);
   *   - 南北:从墙线往里 1 m(杏干不贴墙,冠可以探出墙头),到茆堂落脚面的后沿(plan pads);
   *   - 让开:房子(占位场 + 1.5 m)、落脚面(1.5 m)、墙篱走线(1 m)、路(plan.paths 与 connection.daoxiang-* 中线 2.5 m)、
   *     茆堂前院(落脚面前沿往外 10 m、与茆堂同宽——D-35「前院整片旱地」;10 m 是艺术取值);
   *   - 不问草皮掩码(果林底下是土),只要脚下站得住。
   * **先撒后筛**(`P-28` / `P-33`):泊松飞镖流不看密度、坐标哈希决定留不留;撒在 D-37 的块里,
   * 飞镖只按块坐标播种——旧散布盒一株都碰不到(林带整个在盒外,且块里的点在盒内一律丢)。
   * 株数不是拍的:最小株距 2.0 m(冠径 3.4 m,冠与冠搭三成多,远看连成一片霞),每块飞镖撒到饱和,
   * 留存率 0.92(哈希筛,让林子有疏有密)——林带面积定株数,回报里写实测。
   */
  const APRICOT_GROVE = (() => {
    const plan = getPlan() as unknown as {
      regions: { id: string; polygon: Point2[]; pads?: { id: string; polygon: Point2[] }[];
        buildings: { id: string; layout?: { runs: { points: Point2[] }[] } }[] }[];
      paths: { points: Point2[] }[];
      connections?: { id: string; points: Point2[] }[];
    };
    const reg = plan.regions.find((r) => r.id === 'daoxiangcun');
    const wall = reg?.buildings.find((b) => b.id === 'daoxiangcun.mud-wall')?.layout?.runs ?? [];
    const mainPad = reg?.pads?.find((q) => q.id === 'daoxiangcun.main-foundation')?.polygon;
    if (!reg || !wall.length || !mainPad) return null;
    const wx = wall.flatMap((r) => r.points.map((q) => q[0])), wz = wall.flatMap((r) => r.points.map((q) => q[1]));
    const px = mainPad.map((q) => q[0]), pz = mainPad.map((q) => q[1]);
    const wallZ = Math.min(...wz);
    const rect: Rect = { minX: Math.min(...wx), maxX: Math.max(...wx), minZ: Math.min(...pz), maxZ: wallZ - 1 };
    const court: Rect = { minX: Math.min(...px), maxX: Math.max(...px), minZ: Math.max(...pz), maxZ: Math.max(...pz) + 10 };
    const lines = reg.buildings.flatMap((b) => b.layout?.runs.map((r) => r.points) ?? []);
    const pads = (reg.pads ?? []).map((q) => q.polygon);
    const roads = [...plan.paths.map((q) => q.points),
      ...(plan.connections ?? []).filter((c) => c.id.startsWith('connection.daoxiang')).map((c) => c.points)];
    const density = (x: number, z: number): number => {
      if (!insideRect(rect, x, z) || insideRect(court, x, z)) return 0;
      if (locatePoint(reg.polygon, [x, z]) === 'outside') return 0;
      if (ground(x, z) < VEG.minPlantY) return 0;
      if (outsideBuildings(x, z, 1.5) < 0.5) return 0;
      if (pads.some((q) => locatePoint(q, [x, z]) !== 'outside' || distanceToPolyline(x, z, q) < 1.5)) return 0;
      if (lines.some((l) => distanceToPolyline(x, z, l) < 1.0)) return 0;
      if (roads.some((l) => distanceToPolyline(x, z, l) < 2.5)) return 0;
      return 0.92;
    };
    return { rect, density };
  })();

  const extTreeSpots: (Spot & { grove?: boolean })[] = extClusterSpots((b) => {
    const out: (Spot & { grove?: boolean })[] = [];
    // 杏林先落(它是这一带的主角),丛植的树再与它硬隔。
    const br = blockRect(b, EXT_BLOCK);
    if (APRICOT_GROVE &&
        br.maxX > APRICOT_GROVE.rect.minX && br.minX < APRICOT_GROVE.rect.maxX &&
        br.maxZ > APRICOT_GROVE.rect.minZ && br.minZ < APRICOT_GROVE.rect.maxZ) {
      for (const g of poissonScatter({
        ...br, radius: 2.0, tries: 6000,
        density: (x, z) => (inLegacy(x, z) ? 0 : APRICOT_GROVE.density(x, z)),
        rng: blockRng(b, 0xa9c07), filterByHash: true,
      })) out.push({ x: g.x, z: g.z, grove: true });
    }
    // 与旧散布盒同一套参数(3.7 m 丛心、1–5 株、0.9–3.1 m 散开、1.5 m 硬隔),飞镖数按面积折。
    // treeBudget 不进块:预算截断是顺序依赖的补撒,块里一株都不许依赖别的块。
    const copses = poissonScatter({
      ...blockRect(b, EXT_BLOCK),
      radius: 3.7, tries: extTries(7000), density: treeDensityExt, rng: blockRng(b, 0x7eee), filterByHash: true,
    });
    const MIN_SEP2 = 1.5 * 1.5;
    for (const c of copses) {
      const copseRng = makeRng((ctx.seed ^ Math.floor(scatterHash01(c.x, c.z) * 4294967296)) >>> 0);
      const n = 1 + Math.floor(Math.pow(copseRng(), 1.35) * 5);
      const spread = rangeOf(copseRng, 0.9, 3.1);
      for (let i = 0; i < n; i++) {
        const a = copseRng() * Math.PI * 2;
        const r = i === 0 ? 0 : spread * Math.pow(copseRng(), 0.55);
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (treeDensityExt(x, z) <= 0.02) continue;
        const near = (t: Spot) => (t.x - x) ** 2 + (t.z - z) ** 2 < MIN_SEP2;
        if (out.some(near) || treeSpots.some(near)) continue;
        out.push({ x, z });
      }
    }
    return out;
  }, 1.5);
  const groveCount = extTreeSpots.filter((s) => s.grove).length;
  mark('D-37 块里的树(候选 + 跨块硬隔)');

  const placeTree = (
    x: number,
    z: number,
    speciesIdx: number,
    /** 点名树给的定值（单子 AV2）；不给就走下面那条随机档。 */
    fixed?: { scale?: number; tilt?: number; tiltAz?: number },
    /** 散布树按坐标播种的 rng（单子 AV-b1）；点名树 / 古树 / 柳树不传，走共享流。 */
    rand: () => number = rng,
    /** D-37:块里的树。实例化时排在本种最后,吃另一条 rng,旧的实例逐位不变。 */
    ext = false,
  ) => {
    const b = built[speciesIdx];
    // Bigger trees deeper into the wood; the trees nearest the town are the
    // small ones, which keeps the treeline from crowding the eye line.
    const edge = smoothstep(1.0, 5.5, ground(x,z));
    // A 1.75 : 1 spread on top of the species' own 2.3 : 1 height spread. The
    // old 0.82–1.08 was a 1.3 : 1 band, which is inside the range a viewer
    // reads as "the same asset".
    const s = fixed?.scale ?? rangeOf(rand, 0.70, 1.22) * lerp(0.86, 1.22, edge);
    // 随机档照抽不误,即使 fixed 覆盖了它——抽掉的是同一串 rng,不抽会让
    // 后面所有树的随机序列整体平移,一棵点名树能把全园的树换一遍样子。
    const rTilt = rangeOf(rand, 0.02, 0.16);
    const rAz = rand() * Math.PI * 2;
    b.spots.push({
      x, z, s,
      yaw: rand() * Math.PI * 2,
      // Up to 9 degrees of lean, and never exactly zero. The old 4 degree cap
      // was small enough that every trunk read as vertical.
      tilt: fixed?.tilt ?? rTilt,
      tiltAz: fixed?.tiltAz ?? rAz,
      ...(ext ? { ext: true } : {}),
    });
  };

  for (const s of treeSpots) {
    // 按区选种:园子长什么由 plan.json 的 regions[].plants 定(REGION_TREES),
    // 区域之外用 FALLBACK_MIX 的背景混交。mix 是带权重复键的牌堆,抽一张即得种。
    // 选种与形态用树位坐标播种的 rng(单子 AV-b1):一棵树的存废不再平移
    // 其他树的种 / 尺度 / 姿态,dump diff 的「一棵不动」才有意义。
    const spotRng = makeRng((ctx.seed ^ Math.floor(scatterHash01(s.x, s.z) * 4294967296) ^ 0x9e3779b9) >>> 0);
    const reg = regionOf(s.x, s.z);
    const rt = reg ? REGION_TREES[reg] : undefined;
    const mix = rt && rt.mix.length > 0 ? rt.mix : FALLBACK_MIX;
    const idx = SPECIES_INDEX[mix[Math.floor(spotRng() * mix.length)]];
    placeTree(s.x, s.z, idx, undefined, spotRng);
  }

  for (const [x, z, key] of HERO_TREES) {
    // 手放点只管脚下站得住(不是水面/深沟);古树可以立在铺装与台基旁,
    // 不受草皮 mask 约束。
    if (ground(x, z) < VEG.minPlantY) continue;
    placeTree(x, z, SPECIES_INDEX[key]);
  }

  mark('tree placement');
  /* ---------------- 点名种的树(单子 AV2) ----------------------------- */

  // 与 HERO_TREES 同一路 placeTree,只是位置、种、尺度、倾角从数据来。
  // 种名合不合法由 `check:scenes` 的 `validateScenes` 拦在数据层(它读同一份
  // SPECIES_INDEX);这里再兜一次底,免得没跑门的分支静默少一棵树。
  for (const t of sceneTrees) {
    const idx = SPECIES_INDEX[t.species];
    if (idx === undefined) throw new Error(`[vegetation] scenes 点名树的种 ${t.species} 不在 SPECIES_INDEX 里(${t.tag})`);
    if (ground(t.x, t.z) < VEG.minPlantY) continue;
    placeTree(t.x, t.z, idx, { scale: t.scale, tilt: t.tilt, tiltAz: t.tiltAz });
  }

  /* ---------------- 沁芳堤柳 ---------------------------------------- */

  // 「繞堤柳借三篙翠」(第十七回沁芳联)。柳不走 copse 散布:沿 plan.json 的
  // pool.south(南池·沁芳亭桥池)岸线逐段向外 2.2 m 落位,间距 4.5 m,
  // 让柳真正「绕堤」而不是碰巧长在池边。
  {
    const ring = waterRingPoints('pool.south');
    const willowIdx = SPECIES_INDEX['willow'];
    if (ring && willowIdx !== undefined) {
      const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
      const cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const planted: { x: number; z: number }[] = [];
      for (let e = 0; e < ring.length; e++) {
        const [ax, az] = ring[e];
        const [bx, bz] = ring[(e + 1) % ring.length];
        const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 4));
        for (let s = 0; s < steps; s++) {
          const vx = lerp(ax, bx, s / steps);
          const vz = lerp(az, bz, s / steps);
          const dx = vx - cx;
          const dz = vz - cz;
          const dl = Math.hypot(dx, dz) || 1;
          const x = vx + (dx / dl) * 2.2;
          const z = vz + (dz / dl) * 2.2;
          if (ground(x, z) < VEG.minPlantY) continue;
          if (anyMaskAt(x, z) < 0.3) continue;
          if (outsideBuildings(x, z, 0.5) < 0.5) continue;
          if (planted.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5)) continue;
          planted.push({ x, z });
          placeTree(x, z, willowIdx);
        }
      }
    }
  }

  // D-37:块里的树放在所有旧的树之后——每个种的 `spots` 里旧的在前、块里的在后,
  // 实例化时旧的那一段吃旧的 rng(见 tree instancing)。选种与形态同散布树,按坐标播种。
  for (const s of extTreeSpots) {
    const spotRng = makeRng((ctx.seed ^ Math.floor(scatterHash01(s.x, s.z) * 4294967296) ^ 0x9e3779b9) >>> 0);
    const reg = regionOf(s.x, s.z);
    const rt = reg ? REGION_TREES[reg] : undefined;
    const mix = rt && rt.mix.length > 0 ? rt.mix : FALLBACK_MIX;
    const drawn = SPECIES_INDEX[mix[Math.floor(spotRng() * mix.length)]];
    // 杏林里的一律是杏(照样抽一张牌,rng 序列与别的散布树同形)。
    const idx = s.grove ? SPECIES_INDEX['apricot'] : drawn;
    placeTree(s.x, s.z, idx, undefined, spotRng, true);
  }

  mark('named trees + 堤柳');
  /* ---------------- tree instancing -------------------------------- */

  const culler = new ClusteredInstancePool(group);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scl = new THREE.Vector3();
  const pos3 = new THREE.Vector3();
  const col = new THREE.Color();
  const treeBases: { x: number; z: number; r: number; y: number; ext?: boolean }[] = [];
  /**
   * D-37:实例属性按「旧的一段 + 块里的一段」拼。`applyWind(count, rng)` 按实例序号顺序抽 2 发,
   * 块里那一段吃这里给的逐株坐标数(第 k 发只由那一株的坐标决定),旧 rng 被消费的次数不变。
   */
  const coordSeq = (pts: readonly Spot[], salt: number): (() => number) => {
    let k = 0;
    return () => {
      const s = pts[k >> 1];
      const v = latticeHash01(Math.round(s.x * 4096), Math.round(s.z * 4096), k & 1, salt);
      k++;
      return v;
    };
  };

  const barkTint = new THREE.Color();

  for (const b of built) {
    const n = b.spots.length;
    if (n === 0) continue;
    // D-37:种子里的 n 取「旧的那一段」的株数——块里多了树,旧实例的风相不许跟着变。
    const nOld = b.spots.filter((s) => !s.ext).length;
    const cRng = makeRng(ctx.seed ^ (b.def.key.length * 7717) ^ nOld);
    // Species bark colour rides in as an instance tint over a white bark
    // material, so a birch is genuinely pale and an oak genuinely warm-brown
    // without a fourth texture bake or a fourth draw call.
    barkTint.setHex(b.def.barkTint);
    const btR = barkTint.r;
    const btG = barkTint.g;
    const btB = barkTint.b;
    const trunkMesh = makeInstanced(b.geo.trunk, b.barkMat, n, splitRng(cRng, 2 * nOld, coordSeq(b.spots.slice(nOld), 0x7d37)), 1);
    const canopyMesh = makeInstanced(b.geo.canopy, b.mat, n, cRng, 1);
    const fringeMesh = makeInstanced(b.geo.fringe, b.fringeMat, n, cRng, 1);
    // Dappled light. The crown stays a solid mass in the beauty pass and is
    // rendered *perforated* into the shadow map, so sun-flecks fall through it
    // onto the forest floor. See `canopyPerforationMap`. One shared depth
    // material across every species: it samples nothing species-specific, and a
    // material per species would be eight programs for one effect.
    applyCanopyShadow(canopyMesh.material as THREE.Material);
    // All three meshes must share phases or the crown will sway off its own
    // trunk and the leaf cards will slide off the crown.
    canopyMesh.geometry.setAttribute('aWind', trunkMesh.geometry.getAttribute('aWind'));
    fringeMesh.geometry.setAttribute('aWind', trunkMesh.geometry.getAttribute('aWind'));

    for (let i = 0; i < n; i++) {
      const sp = b.spots[i];
      // 每棵树的径/高/色相抖动按它自己的坐标播种(单子 AV-b1,P-28 的另一半):
      // 用种内顺序 cRng 的话,任何一个种的成员增减都会把该种后面所有实例的
      // 抖动整体平移——树没动,样子变了,dump diff 照样红。
      const iRng = makeRng((ctx.seed ^ (b.def.key.length * 7717) ^ Math.floor(scatterHash01(sp.x, sp.z) * 4294967296)) >>> 0);
      // Slope- and girth-aware sink.
      //
      // A trunk is a vertical cylinder with a root flare, so on any gradient its
      // downhill side lifts clear of the surface: half the flare's width times
      // the slope. A fixed 9cm sink covers that on the flat town but not on the
      // hillside at x ~ +/-30, where trees were left visibly hovering with sky
      // under their bases. The tilt applied below pivots about the origin and
      // lifts the base further, so that is folded in too.
      const probe = 0.45 * sp.s;
      const gh = ground(sp.x, sp.z);
      const slope = Math.max(
        Math.abs(ground(sp.x + probe, sp.z) - ground(sp.x - probe, sp.z)),
        Math.abs(ground(sp.x, sp.z + probe) - ground(sp.x, sp.z - probe)),
      ) / (2 * probe);
      const flare = 0.34 * sp.s;
      const y = gh - 0.09 * sp.s - flare * slope - Math.tan(sp.tilt) * flare;
      euler.set(
        Math.cos(sp.tiltAz) * sp.tilt,
        sp.yaw,
        Math.sin(sp.tiltAz) * sp.tilt,
        'ZYX',
      );
      q.setFromEuler(euler);
      pos3.set(sp.x, y, sp.z);
      // Independent girth and height. A uniformly scaled tree is the *same*
      // tree seen from further away — what the eye reads is proportion, not
      // size, so slenderness has to vary per instance or two neighbours of one
      // species still read as copies. Costs nothing: it is one matrix.
      const girth = sp.s * rangeOf(iRng, 0.78, 1.28);
      scl.set(girth, sp.s * rangeOf(iRng, 0.80, 1.28), girth);
      m4.compose(pos3, q, scl);
      trunkMesh.setMatrixAt(i, m4);
      canopyMesh.setMatrixAt(i, m4);
      fringeMesh.setMatrixAt(i, m4);

      // Hue / value jitter. Warm-yellow in the light, cool-blue in the shade,
      // per ART_DIRECTION §3 — never a flat brightness scale.
      const warm = rangeOf(iRng, -1, 1);
      col.setRGB(
        1 + warm * 0.075 + rangeOf(iRng, -0.05, 0.05),
        1 + rangeOf(iRng, -0.055, 0.055),
        1 - warm * 0.1 + rangeOf(iRng, -0.05, 0.05),
      );
      canopyMesh.setColorAt(i, col);
      fringeMesh.setColorAt(i, col);
      // Value and warmth jitter on the bark, wide enough that a stand of one
      // species still has light trunks and dark trunks in it.
      const bt = rangeOf(iRng, -0.15, 0.15);
      col.setRGB(btR * (1 + bt), btG * (1 + bt * 0.85), btB * (1 + bt * 0.6));
      trunkMesh.setColorAt(i, col);

      treeBases.push({ x: sp.x, z: sp.z, r: b.geo.trunkR * girth, y, ...(sp.ext ? { ext: true } : {}) });

      // Only things the player can reach need a blocker; the perimeter boxes
      // already stop them long before the outer wood.
      if (sp.x >= TERRAIN.playMinX && sp.x <= TERRAIN.playMaxX && sp.z >= TERRAIN.playMinZ && sp.z <= TERRAIN.playMaxZ) {
        ctx.collision.addCircle(
          sp.x, sp.z,
          b.geo.trunkR * girth * 1.05 + 0.12,
          y - 1.0,
          y + b.geo.height * sp.s * 0.75,
          'tree',
        );
      }
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    fringeMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
    if (fringeMesh.instanceColor) fringeMesh.instanceColor.needsUpdate = true;

    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;
    // The blob under the cards already casts the crown's shadow; making forty
    // thousand alpha-tested quads cast as well would double the shadow pass and
    // only add fringe noise to the shadow's edge.
    fringeMesh.castShadow = false;
    fringeMesh.receiveShadow = true;
    trunkMesh.name = `Trunk_${b.def.key}`;
    canopyMesh.name = `Canopy_${b.def.key}`;
    fringeMesh.name = `Leaves_${b.def.key}`;
    trunkMesh.computeBoundingSphere();
    canopyMesh.computeBoundingSphere();
    fringeMesh.computeBoundingSphere();
    group.add(trunkMesh, canopyMesh, fringeMesh);

    // One decision for the whole tree, and the shared wind buffer travels with
    // the permutation so crowns stay on their trunks. No distance cut: a tree
    // is silhouette, and the treeline thinning out would be the first thing a
    // reviewer noticed.
    // Trees remain visible much farther than ground cover. Larger tree-only
    // buckets trade some clipped vertices for fewer material submissions;
    // grass and small plants keep their finer spatial buckets.
    // 单子 BC1:水平距离 > TREE_FAR_M 的树逐株换远景档(簇不变、位置不变,只换画什么)。
    culler.add([trunkMesh, canopyMesh, fringeMesh], {
      skipShadow: [fringeMesh], cellSize: 128,
      lod: { dist: TREE_FAR_M, geometries: [b.farGeo.trunk, b.farGeo.canopy, b.farGeo.fringe] },
    });
  }

  mark('tree instancing');
  /* ---------------- bushes ----------------------------------------- */

  const bushGeos = [
    buildBush(ctx.seed ^ 0xb0511, 0.72, 4),
    buildBush(ctx.seed ^ 0xb0512, 0.55, 5),
    buildBush(ctx.seed ^ 0xb0513, 0.95, 6),
  ];
  // The shell is now backing, not surface: the leaf cards carry the read, so
  // it is darkened to act as the shrub's interior and its triplanar frequency
  // is tripled — at the old scale a single flat facet of the low-poly shell
  // showed one big smooth blob of leaf texture from a metre away.
  const bushMats = [
    canopyMat('warm', 0xbdd693, 1.35, 3.0),
    canopyMat('cool', 0xaccb85, 1.5, 3.4),
    canopyMat('warm', 0xc6da9c, 1.25, 2.7),
  ];
  const bushFringeMats: ReturnType<typeof createFoliageMaterial>[] = [
    shrubMats.warm, shrubMats.cool, shrubMats.warm,
  ];

  /**
   * 灌木往哪儿长（单子 AV3 重写）。
   *
   * **旧版全园 0 株,不是密度调小了,是坐标过期了。** 那两项 `nearWood`
   * (|x| 11.5–21) 与 `nearSouth`(z 18.5–28) 是 pallet-town 老镇子的常量,
   * 而大观园四区在 z≈80–250、x≈−145…80;更要命的是散布窗口写死
   * `minX −24…24 / minZ −24…30`——**整个窗口落在园子外的空地上**。
   * 于是「灌木 0 株」在数据上是对的:没有一处能长。(景需求文档 §5)
   *
   * 三项都换成数据驱动,一个坐标常量都不留:
   *   - **贴石**:离最近一组白石峰 2–7 m 的环带(判据要山上 40–60 株,实测 47)。背阴半圆权重 1.0、向阳 0.4
   *     (`peakShade`);石头是这一层里灌木唯一真正该抱住的东西——
   *     07-03 说翠嶂的绿是石上的苔与藤,丛植的灌木是把石脚与草地之间那道
   *     生硬的接边做软。
   *   - **贴建筑角**:原样保留(单子 Z 已经从 occupancy 场读,不是手抄表)。
   *   - **贴林缘**:`treeDensity` 那个低频 clump 场的**边界带**——林子里不长、
   *     空地上不长,只长在林子的边上。这是「灌木是林与草之间的过渡」这句话
   *     唯一可计算的写法。
   * 散布窗口跟着 `VEG.scatter*` 走(与树、草同一个窗口),不再自带一个小盒子。
   * (D-37 起旧窗口钉成 `LEGACY_SCATTER`,盒外走世界对齐的块,见 `extClusterSpots`。)
   */
  const bushDensityOn = (mk: { at(x: number, z: number): number }, x: number, z: number): number => {
    if (mk.at(x, z) < 0.75) return 0;
    if (ground(x, z) < 0.35) return 0;
    // 贴石:2–7 m 环带,背阴浓、向阳稀。
    const pd = peakDistance(x, z);
    const nearRock = pd < 40 ? smoothstep(2.0, 3.1, pd) * smoothstep(7.0, 4.5, pd) * peakShade(x, z) : 0;
    // 单子 Z:距离从 occupancy 场读(plan 推导的檐口外包络),不再遍历手抄表。
    // `>= -0.4` 保留原来的语义:只贴边,不往建筑深处长。
    const cornerD = occupancyDistance(x, z);
    const corner = cornerD >= -0.4 ? smoothstep(1.9, 0.25, cornerD) : 0;
    // 贴林缘:copse 低频场的过渡带(场值既不高也不低的那一圈)。
    const c = fbm2(clump, x * 0.09, z * 0.09, 3) * 0.5 + 0.5;
    const woodEdge = smoothstep(0.30, 0.46, c) * smoothstep(0.70, 0.54, c);
    /*
     * 自由散布那一项**删掉了**(原来是 `scatter * 0.25`)。它在老镇子那个
     * 48×54 m 的窗口里是「一角丛植」;散布窗口换成全园 500×500 m 之后,
     * 同一个权重算出来是**全园 696 株**——实测光灌木就是 374 个 mesh、
     * 130 万三角,四镜的 draw call 直接翻倍(271→568)、三角 +42%,fps 从 47 掉到 42。
     * 灌木在这个园子里该抱住的是石头与房子,不是把每一片空地都点上一丛。
     */
    const d = clamp(
      Math.max(nearRock * 0.85, corner * 0.40, woodEdge * 0.03),
      0,
      1,
    );
    return d * outsideBuildings(x, z, 0.25) * wildGrassClearance(x, z);
  };
  /** 旧散布盒:与旧版同一个函数(旧掩码,不看盒子——丛内株位本来就可以伸出盒边 2.6 m)。 */
  const bushDensity = (x: number, z: number): number => bushDensityOn(mask, x, z);
  /** 块里(D-37):世界掩码,旧散布盒内为 0。 */
  const bushDensityExt = (x: number, z: number): number => (inLegacy(x, z) ? 0 : bushDensityOn(wmask, x, z));

  /**
   * 丛，不是网格（单子 AV3；与上面树的 copse 同一路数，理由也同一条）。
   *
   * 单点 Poisson 在饱和之后就是一个**塞满的堆积**，读出来是「每隔两米一株」的
   * 程序化垃圾；单子要的是「成丛 3–7 株」。所以两级：Poisson 先在 8.5 m 上选丛心，
   * 每个丛心长 3–6 株、半径 1.1–2.6 m，株间硬隔 0.95 m 不互穿。
   *
   * 第一版没分级、环带也开得宽（2–7.4 m、权重 0.95、半径 2.2 m），实测**全园
   * 2 463 株、山上 202 株**——判据要的是 40–60。收到现在这一档是量出来的，
   * 不是估的：前后两次普查的数写在单子 AV 的回报里。
   */
  /*
   * 单子 AL-b b0（`P-33`，`D-32` ③）：灌木走「先撒后筛」档，与树的 copse 同一档。
   * 原来丛心是带 `density` 的 Bridson、丛内株位与分桶又吃共享顺序 `rng`——AL2 只改了
   * 潇湘馆一条路，全园 355 丛里 293 丛换了位置，正门 60 m 内 61 丛。现在：
   *   - 丛心：专用 rng 撒飞镖（每次恰好 2 发，飞镖流全园稳定），留不留看坐标哈希；
   *   - 丛内株数 / 散开半径 / 株位 / 分桶 / 每株体量朝向：全部由**坐标哈希派生的局部 rng**给，
   *     不再碰共享 `rng`（共享流在这一段之后已无消费者，所以这一改不连带别的散布层）。
   * 筛后总量靠 `tries` 定，不动 `bushDensity`（密度是「长在哪」，飞镖数是「长多少」）：
   * 先撒后筛与旧档期望通过率相同，但同样 26000 发实测筛后只有 316 丛（山上 36）；
   * 32000 → 339、36000 → 366、**34000 → 352**（山上 36），取 34000 对齐改前的 354。
   * 加飞镖只在流尾追加候选，前 26000 发的丛心不变。
   * 稳定性实验（单子 AL-b b0 判据）：`court-path` 中点挪 0.5 m，`tree-census --dump` 前后
   * 灌木 352 → 352、逐株 0 差异；同一实验下旧代码是 354 → 347、逐株全变。
   */
  const spotRng = (x: number, z: number, salt: number) =>
    makeRng((ctx.seed ^ salt ^ Math.floor(scatterHash01(x, z) * 4294967296)) >>> 0);
  const bushSpots: (Spot & { bucket: number })[] = [];
  {
    const centres = poissonScatter({
      ...LEGACY_SCATTER,
      radius: 8.5, tries: 34000, density: bushDensity, rng: makeRng(ctx.seed ^ 0xb05b), filterByHash: true,
    });
    const MIN_SEP2 = 0.95 * 0.95;
    for (const c of centres) {
      const cRng = spotRng(c.x, c.z, 0xb0c0);
      const n = 3 + Math.floor(cRng() * 4);
      const spread = rangeOf(cRng, 1.1, 2.6);
      for (let i = 0; i < n; i++) {
        const a = cRng() * Math.PI * 2;
        const r = i === 0 ? 0 : spread * Math.pow(cRng(), 0.6);
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (bushDensity(x, z) <= 0.02) continue;
        if (bushSpots.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < MIN_SEP2)) continue;
        bushSpots.push({ x, z, bucket: Math.floor(scatterHash01(x + 0.5, z - 0.5) * 3) % 3 });
      }
    }
  }

  // D-37:块里的灌木。同一套丛(8.5 m 丛心、3–6 株、1.1–2.6 m、0.95 m 硬隔),飞镖数按面积折;
  // 与旧的株硬隔(旧的赢),跨块走哈希对称规则(见 extClusterSpots)。分桶同旧版:坐标哈希。
  const extBushSpots = extClusterSpots((b) => {
    const centres = poissonScatter({
      ...blockRect(b, EXT_BLOCK),
      radius: 8.5, tries: extTries(34000), density: bushDensityExt, rng: blockRng(b, 0xb05b), filterByHash: true,
    });
    const MIN_SEP2 = 0.95 * 0.95;
    const out: (Spot & { bucket: number })[] = [];
    for (const c of centres) {
      const cRng = spotRng(c.x, c.z, 0xb0c0);
      const n = 3 + Math.floor(cRng() * 4);
      const spread = rangeOf(cRng, 1.1, 2.6);
      for (let i = 0; i < n; i++) {
        const a = cRng() * Math.PI * 2;
        const r = i === 0 ? 0 : spread * Math.pow(cRng(), 0.6);
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (bushDensityExt(x, z) <= 0.02) continue;
        const near = (q: Spot) => (q.x - x) ** 2 + (q.z - z) ** 2 < MIN_SEP2;
        if (out.some(near) || bushSpots.some(near)) continue;
        out.push({ x, z, bucket: Math.floor(scatterHash01(x + 0.5, z - 0.5) * 3) % 3 });
      }
    }
    return out;
  }, 0.95);

  // 每桶旧的在前、块里的在后:桶的 `bRng` 先给 `applyWind` 顺序抽,旧实例吃到的数不变。
  const bushBuckets: { x: number; z: number }[][] = [[], [], []];
  for (const s of bushSpots) bushBuckets[s.bucket].push(s);
  const bushOld = bushBuckets.map((l) => l.length);
  for (const s of extBushSpots) bushBuckets[s.bucket].push(s);

  bushBuckets.forEach((spots, bi) => {
    if (spots.length === 0) return;
    const bRng = makeRng(ctx.seed ^ (0x8005 + bi * 131));
    const mesh = makeInstanced(bushGeos[bi].shell, bushMats[bi], spots.length,
      splitRng(bRng, 2 * bushOld[bi], coordSeq(spots.slice(bushOld[bi]), 0xb37)), 1);
    const leaves = makeInstanced(bushGeos[bi].fringe, bushFringeMats[bi], spots.length, bRng, 1);
    leaves.geometry.setAttribute('aWind', mesh.geometry.getAttribute('aWind'));
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      // 每株体量/朝向/色偏用本株坐标派生的 rng（AL-b b0）：桶里少一株，别的株不变样。
      const pRng = spotRng(s.x, s.z, 0xb0d0);
      const sc = rangeOf(pRng, 0.62, 1.12);
      euler.set(rangeOf(pRng, -0.09, 0.09), pRng() * Math.PI * 2, rangeOf(pRng, -0.09, 0.09), 'ZYX');
      q.setFromEuler(euler);
      pos3.set(s.x, ground(s.x, s.z) - 0.14 * sc, s.z);
      scl.set(sc * rangeOf(pRng, 0.9, 1.15), sc * rangeOf(pRng, 0.82, 1.1), sc * rangeOf(pRng, 0.9, 1.15));
      m4.compose(pos3, q, scl);
      mesh.setMatrixAt(i, m4);
      leaves.setMatrixAt(i, m4);
      const warm = rangeOf(pRng, -1, 1);
      col.setRGB(1 + warm * 0.08, 1 + rangeOf(pRng, -0.05, 0.05), 1 - warm * 0.1);
      mesh.setColorAt(i, col);
      leaves.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    leaves.castShadow = false;
    leaves.receiveShadow = true;
    mesh.name = `Bush_${bi}`;
    leaves.name = `BushLeaves_${bi}`;
    mesh.computeBoundingSphere();
    leaves.computeBoundingSphere();
    group.add(mesh, leaves);

    /*
     * 灌木吃**距离剔除**(单子 AV3):`maxDist 30`、`cellSize 20`。
     *
     * 30 这个数不是拍的:这个文件自己的 `VEG.drawDist` 里草 26、杂草 23、花 27——
     * 灌木比杂草大一档,落在 30 正好接上那张表。
     * 文件开头写过「Trees and bushes have no distance cut at all — they are
     * silhouette」。对树成立,对灌木不成立:一棵 8 m 的树在 80 m 外仍是天际线上
     * 一个形,一丛 0.9 m 的灌木在 30 m 外只有 17 个像素高,而且它从来不在天际线上
     * ——它贴着石头和墙根,前面永远有别的东西。代价是实打实的:不剔除时
     * 全园灌木每帧都进**阴影 pass**(`castShadow` 开着,阴影相机罩住大半个园子),
     * 这正是 draw call 翻倍的那一半。`cellSize` 从默认 64 收到 20,是为了让这条
     * 距离线切得准——64 m 的格子里只要有一株在 30 m 内,整格 100 多株都得画。
     */
    culler.add([mesh, leaves], { skipShadow: [leaves], maxDist: 30, cellSize: 20 });
  });

  mark('bushes');
  /* ---------------- 点名种植(PQ-5c) --------------------------------- */

  /**
   * 游线上点了名的三样:潇湘馆后院的芭蕉、翠嶂石间的藤萝垂蔓、苍苔斑。
   * 依据见 knowledge/rules/plants.rules.json 与 docs/plants/00-catalog.md。
   * 这里只落几何与位置,着色沿用既有 foliage 材质管线。
   */
  {
    const nRng = makeRng(ctx.seed ^ 0x9a1de7);

    // —— 芭蕉:「有大株梨花兼著芭蕉」(第十七回),潇湘馆后院两丛,大叶丛生。——
    {
      const spots = [
        { x: -102.0, z: 86.5 },
        { x: -106.5, z: 88.2 },
      ].filter((s) => ground(s.x, s.z) >= VEG.minPlantY && outsideBuildings(s.x, s.z, 0.3) > 0.5);
      if (spots.length) {
        const mesh = makeInstanced(
          bananaClusterGeometry(ctx.seed ^ 0xbaba),
          canopyMat('warm', 0xd8ecb0, 1.7, 0.5),
          spots.length, nRng, 1,
        );
        for (let i = 0; i < spots.length; i++) {
          const s = spots[i];
          const sc = rangeOf(nRng, 0.85, 1.15);
          const y = ground(s.x, s.z);
          euler.set(0, nRng() * Math.PI * 2, 0, 'ZYX');
          q.setFromEuler(euler);
          pos3.set(s.x, y - 0.05, s.z);
          scl.set(sc, sc, sc);
          m4.compose(pos3, q, scl);
          mesh.setMatrixAt(i, m4);
          ctx.collision.addCircle(s.x, s.z, 0.55, y - 0.5, y + 2.2, 'banana');
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = 'Banana_xiaoxiang';
        mesh.computeBoundingSphere();
        group.add(mesh);
        culler.add([mesh], {});
      }
    }

    // —— 藤萝:翠嶂「藤萝薜荔」攀于山石。垂蔓锚在假山肩部,向下垂落。
    // 锚点不手猜高度:在每个候选点附近 ±1.2 m 扫 5×5,取地面场最高的点
    // (即石顶/石肩),锚在其表面下 0.12 m;扫不到明显高于基面的点就放弃,
    // 免得垂蔓浮空。——
    /*
     * 单子 AV3:锚点改从**白石几何**取,不再扫地形。
     *
     * 旧写法(留在下面 git 历史里)把四个坐标写死在 (5.4,200.8) 一带,再在每个点
     * 周围 ±1.2 m 扫 5×5 个地形采样,取最高的那个当峰顶,还要求它高出基面 0.8 m。
     * 两个致命处:① 峰是**构件**,不在地形高度场里——扫出来的最高点永远只是土坡,
     * 0.8 m 那道门槛一次也没过过,`Wisteria_cuizhang` 这个 mesh 从来没建出来,
     * 全园藤萝 0 根(景需求文档 §5 实测);② 那四个坐标是旧太湖石土丘周围的,
     * AM2 把它换成白石峰群、AV1 又把主组挪上门轴,它们早就不指向任何东西了。
     *
     * 现在:`baishiCrownPoints(variant)` 给出每块峰的顶与两肩(构件局部坐标),
     * 按该件的 yaw 与世界落位转成世界锚点,挂在**背阴面**(北 / 西北,与灌木
     * `peakShade` 同一个光向判断)。每组 2–4 条,`scale` 1.15–1.6 把原生 0.8–1.7 m
     * 的垂蔓拉到 0.9–2.7 m。峰一挪,藤萝跟着挪。
     */
    {
      const anchors: { x: number; z: number; y: number; s: number }[] = [];
      for (const b of baishiPeaks) {
        const gy = ground(b.x, b.z);
        const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
        const cands = baishiCrownPoints(b.variant)
          .map((q) => ({
            x: b.x + q.x * c + q.z * sn,
            z: b.z + (-q.x * sn + q.z * c),
            y: gy + q.y,
            kind: q.kind,
          }))
          // 背阴面:峰心的 −X/−Z 半边(光从 +X/+Z 来)。**顶点也要挑边**——
          // 第一版放行了所有 `top`,结果 `mound_west`(贴着 group3 东南面往上看)
          // 的右上角被一条从正顶垂下来的蔓盖掉三分之一,而那一镜是 AM4 苔斑的
          // 判据机位。挂在背阴面的本意就是「从来路看不见它糊在峰脸上」。
          .filter((q) => (q.x - b.x) * -0.7071 + (q.z - b.z) * -0.7071 > 0.05)
          .sort((q, r) => r.y - q.y);
        const want = 2 + (cands.length >= 6 ? 1 : 0) + (cands.length >= 10 ? 1 : 0);
        for (const q of cands) {
          if (anchors.filter((a) => Math.hypot(a.x - b.x, a.z - b.z) < 9).length >= want) break;
          // 两条蔓不挂在同一块石头的同一处。
          if (anchors.some((a) => Math.hypot(a.x - q.x, a.z - q.z) < 0.9)) continue;
          anchors.push({ x: q.x, z: q.z, y: q.y, s: rangeOf(nRng, 1.15, 1.6) });
        }
      }
      if (anchors.length) {
        const mesh = makeInstanced(
          wisteriaDrapeGeometry(ctx.seed ^ 0x7e17),
          createFoliageMaterial(ctx.env, {
            color: 0xd8e6b8,
            map: shrubTex,
            roughness: 0.85,
            windScale: 1.5,
            wrap: 0.6,
            transColor: 0xb2e065,
            transStrength: 2.6,
            transPower: 2.0,
            haloStrength: 0.15,
            alphaTest: 0.36,
            side: THREE.DoubleSide,
          }),
          anchors.length, nRng, 1,
        );
        for (let i = 0; i < anchors.length; i++) {
          const a = anchors[i];
          const sc = a.s;
          euler.set(0, nRng() * Math.PI * 2, 0, 'ZYX');
          q.setFromEuler(euler);
          pos3.set(a.x, a.y - 0.12, a.z);
          scl.set(sc, sc, sc);
          m4.compose(pos3, q, scl);
          mesh.setMatrixAt(i, m4);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.name = 'Wisteria_cuizhang';
        mesh.computeBoundingSphere();
        group.add(mesh);
        culler.add([mesh], { maxDist: 42, skipShadow: [mesh] });
      }
    }

    // —— 苍苔:「土地下苍苔布满」(潇湘馆,第四十回)与翠嶂石阴。苔是贴地低丘,
    // 无贴图纯顶点色,近看才生效,所以距离剔除收得很近。——
    {
      const spots: { x: number; z: number; s: number }[] = [];
      // 翠嶂石阴环带
      for (let i = 0; i < 12; i++) {
        const a = nRng() * Math.PI * 2;
        const r = rangeOf(nRng, 3.8, 7.5);
        spots.push({ x: 8 + Math.cos(a) * r, z: 202 + Math.sin(a) * r, s: rangeOf(nRng, 0.7, 1.4) });
      }
      // 潇湘馆入口石子路两侧(月洞门 → 正房)。路向 (-0.292,-0.956),法向 (0.956,-0.292)。
      for (let i = 0; i < 10; i++) {
        const t = i / 9;
        const px = lerp(-100, -105.5, t);
        const pz = lerp(122, 104, t);
        const side = nRng() < 0.5 ? -1 : 1;
        const off = rangeOf(nRng, 1.0, 1.8);
        spots.push({ x: px + side * 0.956 * off, z: pz - side * 0.292 * off, s: rangeOf(nRng, 0.5, 1.0) });
      }
      // 后院梨树下
      for (let i = 0; i < 3; i++) {
        const a = nRng() * Math.PI * 2;
        const r = rangeOf(nRng, 0.8, 2.0);
        spots.push({ x: -108 + Math.cos(a) * r, z: 84.5 + Math.sin(a) * r, s: rangeOf(nRng, 0.6, 1.1) });
      }
      const ok = spots.filter(
        (s) => ground(s.x, s.z) >= VEG.minPlantY && outsideBuildings(s.x, s.z, 0.1) > 0.5,
      );
      if (ok.length) {
        const mesh = makeInstanced(
          mossPatchGeometry(ctx.seed ^ 0x7055, 0.5),
          createFoliageMaterial(ctx.env, {
            color: 0x7d8f56,
            roughness: 0.98,
            windScale: 0,
            wrap: 0.55,
            transStrength: 0.0,
            haloStrength: 0.0,
          }),
          ok.length, nRng, 1,
        );
        for (let i = 0; i < ok.length; i++) {
          const s = ok[i];
          euler.set(0, nRng() * Math.PI * 2, 0, 'ZYX');
          q.setFromEuler(euler);
          pos3.set(s.x, ground(s.x, s.z) + 0.01, s.z);
          scl.set(s.s, s.s, s.s);
          m4.compose(pos3, q, scl);
          mesh.setMatrixAt(i, m4);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.name = 'Moss_patches';
        mesh.computeBoundingSphere();
        group.add(mesh);
        culler.add([mesh], { maxDist: 22, skipShadow: [mesh] });
      }
    }
  }

  mark('点名种植');
  /* ---------------- forest floor ------------------------------------ */

  /**
   * Leaf litter and deadfall.
   *
   * Everything else in this file grows *up*. The floor of the wood needs the
   * opposite: warm dead matter lying flat, thickest at the foot of a trunk where
   * it actually accumulates, thinning out into the clearings. Two instanced
   * meshes and two draw calls buy the whole forest floor, and both are distance
   * culled hard because a 40 cm patch of brown is sub-pixel by 25 m.
   */
  {
    const litTex = litterTexture('floor', ctx.seed ^ 0x11a7e2, 3);
    const litMat = createFoliageMaterial(ctx.env, {
      // Toned from 0xcdbb9c. The litter texture is already authored in warm mid
      // browns; multiplying it by a near-cream material colour pushed the
      // brightest dead leaves up into a saturated brick that read as spilled
      // paint on the turf rather than as debris under a tree. Litter should be
      // *darker* than the grass it lies on, and only warmer in hue — but not so
      // dark that it disappears: the point of it is that the forest floor stops
      // being flat green, and a litter layer you cannot see does not do that.
      color: 0xb9a583,
      map: litTex,
      roughness: 0.96,
      windScale: 0.0,
      wrap: 0.5,
      transStrength: 0.0,
      haloStrength: 0.0,
      alphaTest: 0.42,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
    });
    // Two mound sizes. Pulled in from 0.85 / 1.45 m: a draped mound absorbs
    // terrain slope across its own radius, so the smaller it is the less of it
    // ends up buried on a hillside, and the treeline is *all* hillside. At 1.05 m
    // the big variant still reads as a drift from six metres — which is the whole
    // reason the patches were enlarged in the first place — while spanning only
    // ~28 cm of rise on the steepest ground the wood grows on.
    const litGeos = [
      litterPatchGeometry(ctx.seed ^ 0x1177, 0.62),
      litterPatchGeometry(ctx.seed ^ 0x1178, 1.05),
    ];

    const lRng = makeRng(ctx.seed ^ 0x11a770);
    const litSpots: { x: number; z: number; v: number }[] = [];

    // Rings at the foot of every trunk: this is where litter is, and it is also
    // the seam the eye goes looking for, so it is where the detail pays.
    // D-37:只绕旧的树(块里的树排在每个种的末尾,滤掉后顺序与旧版逐位同);块里的树见下面。
    for (const t of treeBases.filter((b) => !b.ext)) {
      const n = 4 + Math.floor(lRng() * 6);
      for (let i = 0; i < n; i++) {
        const a = lRng() * Math.PI * 2;
        const r = t.r * rangeOf(lRng, 1.0, 5.5);
        const x = t.x + Math.cos(a) * r;
        const z = t.z + Math.sin(a) * r;
        if (mask.at(x, z) < 0.35) continue;
        litSpots.push({ x, z, v: lRng() < 0.6 ? 0 : 1 });
      }
    }
    // Plus a drift through the wood itself so the ground between the trunks is
    // not clean turf either.
    for (const s of poissonScatter({
      minX: -28, maxX: 28, minZ: -28, maxZ: 32,
      // Widened with the patch size, so the drift covers the same ground for
      // roughly half the instances it used to take.
      radius: 1.25, tries: 14000,
      density: (x, z) => {
        if (mask.at(x, z) < 0.6) return 0;
        // The z band starts at 19 rather than 17. Litter is what falls off a
        // canopy, so it has no business on open ground — and the old band put a
        // drift of dead leaves right across the near foreground of the wide
        // establishing shot, where there is nothing overhead to shed it.
        const wood = Math.max(smoothstep(11.0, 17.0, Math.abs(x)), smoothstep(19.0, 25.0, z));
        const n = fbm2(clump, x * 0.19 + 61, z * 0.19, 3) * 0.5 + 0.5;
        return clamp(wood * (0.2 + n * 0.8), 0, 1) * outsideBuildings(x, z, 0.2) * wildGrassClearance(x, z);
      },
      rng: lRng,
    })) {
      litSpots.push({ x: s.x, z: s.z, v: lRng() < 0.5 ? 0 : 1 });
    }

    // D-37:块里的树脚落叶。每棵树自己的坐标播种,落在世界掩码上,裁到当前窗口、旧散布盒外。
    // (上面那片 -28…28 的「林间落叶带」是 pallet-town 老镇子的常量,查的是旧窗口的掩码,
    // 在旧窗口外永远是 0——它从 719171d0 起就一片都不长,本单照旧,不接块。)
    const litExt: { x: number; z: number; v: number }[] = [];
    for (const t of treeBases) {
      if (!t.ext) continue;
      const tRng = makeRng((ctx.seed ^ 0x11a770 ^ Math.floor(scatterHash01(t.x, t.z) * 4294967296)) >>> 0);
      const n = 4 + Math.floor(tRng() * 6);
      for (let i = 0; i < n; i++) {
        const a = tRng() * Math.PI * 2;
        const r = t.r * rangeOf(tRng, 1.0, 5.5);
        const x = t.x + Math.cos(a) * r;
        const z = t.z + Math.sin(a) * r;
        const v = tRng() < 0.6 ? 0 : 1;
        if (!keepExt(x, z) || wmask.at(x, z) < 0.35) continue;
        litExt.push({ x, z, v });
      }
    }

    for (let v = 0; v < litGeos.length; v++) {
      const subset = litSpots.filter((s) => s.v === v);
      const subExt = litExt.filter((s) => s.v === v);
      if (!subset.length && !subExt.length) continue;
      const all = [...subset, ...subExt];
      const mesh = makeInstanced(litGeos[v], litMat, all.length, splitRng(lRng, 2 * subset.length, coordSeq(subExt, 0x11737)), 1);
      for (let i = 0; i < all.length; i++) {
        const s = all[i];
        const ext = i >= subset.length;
        const lR = ext ? makeRng((ctx.seed ^ 0x11a7e ^ Math.floor(scatterHash01(s.x, s.z) * 4294967296)) >>> 0) : lRng;
        const sc = rangeOf(lR, 0.7, 1.5);
        euler.set(0, lR() * Math.PI * 2, 0, 'ZYX');
        q.setFromEuler(euler);
        // Set *below* the surface, not above it. The mound carries its own height
        // (apex ~7 cm) and its outer ring dives another 15% of its radius under,
        // so sinking the origin is what buries the rim and lets the turf close
        // over the edge of the drift instead of the drift ending in mid-air.
        pos3.set(s.x, ground(s.x, s.z) - 0.025, s.z);
        scl.set(sc, sc, sc * rangeOf(lR, 0.8, 1.25));
        m4.compose(pos3, q, scl);
        mesh.setMatrixAt(i, m4);
        // Litter runs from fresh yellow-brown to weathered grey-brown.
        const age = lR();
        col.setRGB(1 - age * 0.16, 1 - age * 0.10, 0.9 + age * 0.14);
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = `Litter_${v}`;
      mesh.computeBoundingSphere();
      group.add(mesh);
      // Kept out of the shadow map: it is a flat card lying on the ground, so it
      // can only occlude what it is already touching.
      culler.add([mesh], { maxDist: 21, skipShadow: [mesh] });
    }

    // ---- deadfall ---------------------------------------------------
    const fallGeos = [
      deadfallGeometry(ctx.seed ^ 0xfa11, 1.35, 0.055),
      deadfallGeometry(ctx.seed ^ 0xfa12, 2.30, 0.105),
    ];
    const fRng2 = makeRng(ctx.seed ^ 0xfa1100);
    const fallSpots = poissonScatter({
      minX: -27, maxX: 27, minZ: -27, maxZ: 31,
      // 3.5 m rather than 2.6 m. At 2.6 the wood had a fallen branch every
      // couple of paces, which is not a forest floor, it is a woodpile — and
      // deadfall is the most expensive floor detail per unit of read, since each
      // stick is a swept tube rather than a card. Fewer, further apart, larger.
      radius: 3.5, tries: 5000,
      density: (x, z) => {
        if (mask.at(x, z) < 0.7) return 0;
        if (ground(x, z) < 0.3) return 0;
        const wood = Math.max(smoothstep(11.5, 17.5, Math.abs(x)), smoothstep(17.5, 23.5, z));
        return clamp(wood * 0.8, 0, 1) * outsideBuildings(x, z, 0.8) * wildGrassClearance(x, z);
      },
      rng: fRng2,
    });
    const fallBuckets: { x: number; z: number }[][] = [[], []];
    for (const s of fallSpots) fallBuckets[fRng2() < 0.62 ? 0 : 1].push(s);

    fallBuckets.forEach((list, fi) => {
      if (!list.length) return;
      const mesh = makeInstanced(fallGeos[fi], barkMats.ash, list.length, fRng2, 1);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const sc = rangeOf(fRng2, 0.75, 1.3);
        // Lying down: yaw freely, and roll a little so it is not perfectly level.
        euler.set(rangeOf(fRng2, -0.14, 0.14), fRng2() * Math.PI * 2, rangeOf(fRng2, -0.10, 0.10), 'ZYX');
        q.setFromEuler(euler);
        pos3.set(s.x, ground(s.x, s.z) - 0.03, s.z);
        scl.set(sc, sc * rangeOf(fRng2, 0.85, 1.15), sc);
        m4.compose(pos3, q, scl);
        mesh.setMatrixAt(i, m4);
        // Dead wood is *grey*: the lignin has weathered out of it and it is the
        // one thing in the wood allowed to be desaturated. It shares the living
        // bark material, so the whole colour shift has to happen here — and at
        // the old near-1.0 value the sticks were as warm as a living oak, which
        // is why a branch lying in grass read as a bright orange streak.
        const g = rangeOf(fRng2, 0.52, 0.76);
        col.setRGB(g, g * 0.97, g * 0.90);
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Deadfall_${fi}`;
      mesh.computeBoundingSphere();
      group.add(mesh);
      culler.add([mesh], { maxDist: 34 });
    });
  }

  mark('forest floor');
  /* ---------------- ground cover ----------------------------------- */


  // ---- grass -------------------------------------------------------
  const grassTex = grassCardTexture('turf', ctx.seed ^ 0x9ea55, 11);
  const grassMat = createFoliageMaterial(ctx.env, {
    color: 0xe8f0d8,
    map: grassTex,
    roughness: 0.9,
    windScale: 1.9,
    wrap: 0.6,
    transColor: 0xc4ea6a,
    transStrength: 2.6,
    transPower: 2.2,
    haloStrength: 0.14,
    alphaTest: 0.34,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
  });
  // ---- 草色相斑块(单子 T) ----------------------------------------------
  // 世界坐标低频 fbm 调制乘进 colorNode,叠在逐簇 instanceColor 抖动之上
  // (不替换,instanceColor 走 diffuseColor 链自动乘入):一片偏黄一片偏绿、
  // 明度微差。强度刻意收敛——俯视看不出平铺感就够,不把草地画花。
  {
    const hueA = mx_fractal_noise_float(positionWorld.xz.mul(0.031), 2, 2.0, 0.55).mul(0.5).add(0.5).saturate();
    const hueB = mx_fractal_noise_float(positionWorld.xz.mul(0.011).add(vec2(7.3, 2.9)), 2, 2.0, 0.55).mul(0.5).add(0.5).saturate();
    const warmth = hueA.mul(0.62).add(hueB.mul(0.38));
    const patchTint = mix(vec3(0.95, 1.01, 0.92), vec3(1.09, 1.01, 0.82), warmth);
    const baseColor = grassMat.colorNode! as unknown as import('three/src/nodes/core/Node.js').default<'vec3'>;
    grassMat.colorNode = baseColor.mul(patchTint).mul(add(0.94, hueB.mul(0.12)));
  }
  // Two variants only: every extra variant multiplies the chunk draw calls, and
  // the per-instance yaw / non-uniform scale plus an eleven-blade texture
  // already make repeats impossible to spot.
  const tuftGeos = [
    grassTuftGeometry(ctx.seed ^ 0x1111, 3, 0.30),
    grassTuftGeometry(ctx.seed ^ 0x2222, 4, 0.21),
  ];

  const grassDensityOn = (mk: { at(x: number, z: number): number }, x: number, z: number): number => {
    const m = mk.at(x, z);
    if (m < 0.12) return 0;
    const patch = grassCover.patch(x, z);
    // 低频斑块(PQ-5d):一汪一汪地稀下去,草稀处地表自然露出。单子 T 起,
    // 露土着色也接上了:masks.soil 与本场同一个 gapN(grass-cover.ts),
    // 草稀处就是地表透土处,逐点对齐由 terrain-index 测试断言。
    const gap = grassCover.gap(x, z);
    return clamp(Math.pow(m, 1.35) * patch * gap, 0, 1) * outsideBuildings(x, z, 0.05);
  };
  const grassDensity = (x: number, z: number): number => grassDensityOn(mask, x, z);

  // Chunk grid: each chunk is its own InstancedMesh so the renderer can
  // frustum-cull it, and a distance test hides the rest. One giant instanced
  // grass mesh can never be culled at all — it has a single bounding sphere.
  type ChunkList = { x: number; z: number; v: number; g: number }[];
  // D-37:旧草块网格钉在旧散布盒上(原点、行列数与 719171d0 逐位同);盒外的草走世界对齐草块,见下。
  const chunkCols = Math.ceil((LEGACY_SCATTER.maxX - LEGACY_SCATTER.minX) / VEG.chunk);
  const chunkRows = Math.ceil((LEGACY_SCATTER.maxZ - LEGACY_SCATTER.minZ) / VEG.chunk);
  const chunks: ChunkList[] = Array.from({ length: chunkCols * chunkRows }, () => []);
  const paths = getPlan().paths;
  const denseChunks = chunks.map((_, ci) => {
    const x = LEGACY_SCATTER.minX + (ci % chunkCols + 0.5) * VEG.chunk;
    const z = LEGACY_SCATTER.minZ + (Math.floor(ci / chunkCols) + 0.5) * VEG.chunk;
    // Anything visible from a route keeps every lattice at full share. Only
    // distant ground applies each lattice's `far` fraction; path-boundary
    // chunks stay dense.
    const margin = VEG.drawDist.grass + VEG.chunk * Math.SQRT2 / 2 + 8;
    return paths.some(p => distanceToPolyline(x,z,p.points) < margin);
  });

  /**
   * One tuft variant per chunk rather than both in every chunk.
   *
   * Every (chunk, variant) pair is its own InstancedMesh, so carrying two
   * variants everywhere doubled the grass draw calls — forty of them, the single
   * largest block in the frame, on a budget of 260. Assigning the variant by a
   * hash of the chunk index halves that outright, and it is invisible: the two
   * variants differ only in blade count and rest height, and the per-instance
   * scale jitter spans 0.62-1.77, which is a far wider spread than the
   * difference between them.
   */
  const chunkVariant = (ci: number): number =>
    Math.imul(ci ^ 0x9e3779b9, 2654435761) >>> 31;

  const chunkOf = (x: number, z: number): number => {
    const ci = clamp(Math.floor((x - LEGACY_SCATTER.minX) / VEG.chunk), 0, chunkCols - 1);
    const cj = clamp(Math.floor((z - LEGACY_SCATTER.minZ) / VEG.chunk), 0, chunkRows - 1);
    return cj * chunkCols + ci;
  };

  /**
   * 三档旋转抖动网格叠加,取代单一 0.32 m 方格(PQ-5d)。
   *
   * 旧做法是一张轴对齐的抖动网格,俯视时 0.32 m 的周期直接读成方格。
   * 这里叠三张互相旋转、周期不成整数比的格网(0.31 / 0.47 / 0.74 m),
   * 各自的周期在叠加里互相错开,任何单一频率都不再主导;每档带份额
   * 抽数(share)控制该档贡献,`far` 是该档在远景 chunk 里的保留比例
   * (0 = 远景整档跳过)。三档各自独立 rng,格网绕散布盒中心旋转。
   */
  const GRASS_LATTICES = [
    { cell: 0.31, share: 0.6, rot: 0.31, ox: 0.13, oz: 0.71, far: 0 },
    { cell: 0.47, share: 0.36, rot: -0.83, ox: 0.57, oz: 0.23, far: 0.3 },
    { cell: 0.74, share: 0.2, rot: 1.21, ox: 0.91, oz: 0.44, far: 1 },
  ];

  {
    const L = LEGACY_SCATTER;
    const cx0 = (L.minX + L.maxX) / 2;
    const cz0 = (L.minZ + L.maxZ) / 2;
    // 旋转后格网要盖住整个轴对齐散布盒,取对角线一半为半径。
    const half =
      Math.hypot(L.maxX - L.minX, L.maxZ - L.minZ) / 2 + 1;
    for (const lat of GRASS_LATTICES) {
      const gRng = makeRng(ctx.seed ^ Math.imul(Math.round(lat.cell * 1000), 7919) ^ 0x9ea5501);
      const cosR = Math.cos(lat.rot);
      const sinR = Math.sin(lat.rot);
      const n = Math.ceil((half * 2) / lat.cell);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          // Jittered lattice rather than dart-throwing: at this tuft count the
          // rejection test dominates build time and buys nothing, because
          // overlapping grass is exactly what a lawn looks like.
          const lx = (i + gRng() - n / 2) * lat.cell + lat.ox;
          const lz = (j + gRng() - n / 2) * lat.cell + lat.oz;
          const x = cx0 + lx * cosR - lz * sinR;
          const z = cz0 + lx * sinR + lz * cosR;
          if (x < L.minX || x > L.maxX || z < L.minZ || z > L.maxZ) continue;
          if (gRng() > lat.share) continue;
          const acceptance = gRng();
          const ci = chunkOf(x, z);
          if (!denseChunks[ci]) {
            if (lat.far <= 0) continue;
            if (gRng() > lat.far) continue;
          }
          if (acceptance > grassDensity(x, z)) continue;
          chunks[ci].push({ x, z, v: chunkVariant(ci), g: 0 });
        }
      }
    }
  }

  mark('grass setup + lattice scatter');
  // Contact detail: a thicker ruff of grass at the foot of every trunk so
  // nothing appears to be pushed through the ground (ART_DIRECTION §2.5).
  {
    const sRng = makeRng(ctx.seed ^ 0x5c1f7);
    for (const t of treeBases.filter((b) => !b.ext)) {
      const n = 5 + Math.floor(sRng() * 5);
      for (let i = 0; i < n; i++) {
        const a = sRng() * Math.PI * 2;
        const r = t.r * rangeOf(sRng, 0.9, 2.4);
        const x = t.x + Math.cos(a) * r;
        const z = t.z + Math.sin(a) * r;
        if (!inLegacy(x, z)) continue;
        if (mask.at(x, z) < 0.3) continue;
        const ci = chunkOf(x, z);
        chunks[ci].push({ x, z, v: chunkVariant(ci), g: 0 });
      }
    }
  }

  /* ---- D-37:旧散布盒外的草——世界对齐的 13 m 草块,逐格点哈希的抖动格网 ----
   *
   * 三档旋转格网与旧版同参数(格距、份额、转角、偏移、远景保留比),只是**绕世界原点转**、
   * 每个格点的抖动 / 份额 / 接受 / 远景四发随机数由 `(档, i, j)` 哈希给——任何一块草都能单独生成,
   * 与窗口、区数、遍历顺序无关。每个草块只收**落在自己方框里**的格点,所以相邻草块不重不漏。 */
  const extChunks = new Map<number, { kx: number; kz: number; list: ChunkList; dense: boolean; v: number }>();
  const extChunkOf = (x: number, z: number) => {
    const kx = Math.floor(x / EXT_GRASS_CHUNK), kz = Math.floor(z / EXT_GRASS_CHUNK), key = cellKey(kx, kz);
    let c = extChunks.get(key);
    if (!c) {
      const cx = (kx + 0.5) * EXT_GRASS_CHUNK, cz = (kz + 0.5) * EXT_GRASS_CHUNK;
      const margin = VEG.drawDist.grass + EXT_GRASS_CHUNK * Math.SQRT2 / 2 + 8;
      c = { kx, kz, list: [], dense: paths.some((p) => distanceToPolyline(cx, cz, p.points) < margin), v: blockHash(kx, kz, 0x9e37) >>> 31 };
      extChunks.set(key, c);
    }
    return c;
  };
  {
    const G = EXT_GRASS_CHUNK;
    for (let kz = Math.floor(curRect.minZ / G); kz <= Math.floor(curRect.maxZ / G); kz++) {
      for (let kx = Math.floor(curRect.minX / G); kx <= Math.floor(curRect.maxX / G); kx++) {
        const r: Rect = { minX: kx * G, maxX: (kx + 1) * G, minZ: kz * G, maxZ: (kz + 1) * G };
        if (rectWithin(r, LEGACY_SCATTER)) continue;
        const chunk = extChunkOf(r.minX + G / 2, r.minZ + G / 2);
        GRASS_LATTICES.forEach((lat, li) => {
          const cosR = Math.cos(lat.rot), sinR = Math.sin(lat.rot);
          // 草块四角转进格网坐标系,取包围范围,外扩一格(抖动最多一格)。
          let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
          for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]]) {
            const lx = x * cosR + z * sinR, lz = -x * sinR + z * cosR;
            lx0 = Math.min(lx0, lx); lx1 = Math.max(lx1, lx); lz0 = Math.min(lz0, lz); lz1 = Math.max(lz1, lz);
          }
          const salt = (ctx.seed ^ Math.imul(Math.round(lat.cell * 1000), 7919) ^ 0x9ea5501 ^ (li + 1)) | 0;
          const i0 = Math.floor((lx0 - lat.ox) / lat.cell) - 1, i1 = Math.ceil((lx1 - lat.ox) / lat.cell) + 1;
          const j0 = Math.floor((lz0 - lat.oz) / lat.cell) - 1, j1 = Math.ceil((lz1 - lat.oz) / lat.cell) + 1;
          for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
              const lx = (i + latticeHash01(i, j, 0, salt)) * lat.cell + lat.ox;
              const lz = (j + latticeHash01(i, j, 1, salt)) * lat.cell + lat.oz;
              const x = lx * cosR - lz * sinR;
              const z = lx * sinR + lz * cosR;
              if (x < r.minX || x >= r.maxX || z < r.minZ || z >= r.maxZ) continue;
              if (!keepExt(x, z)) continue;
              if (latticeHash01(i, j, 2, salt) > lat.share) continue;
              const acceptance = latticeHash01(i, j, 3, salt);
              if (!chunk.dense) {
                if (lat.far <= 0) continue;
                if (latticeHash01(i, j, 4, salt) > lat.far) continue;
              }
              if (acceptance > grassDensityOn(wmask, x, z)) continue;
              chunk.list.push({ x, z, v: chunk.v, g: 0 });
            }
          }
        });
      }
    }
    // 块里的树脚一圈密草(同旧版 ruff),每棵树自己的坐标播种。
    for (const t of treeBases) {
      if (!t.ext) continue;
      const tRng = makeRng((ctx.seed ^ 0x5c1f7 ^ Math.floor(scatterHash01(t.x, t.z) * 4294967296)) >>> 0);
      const n = 5 + Math.floor(tRng() * 5);
      for (let i = 0; i < n; i++) {
        const a = tRng() * Math.PI * 2;
        const r = t.r * rangeOf(tRng, 0.9, 2.4);
        const x = t.x + Math.cos(a) * r;
        const z = t.z + Math.sin(a) * r;
        if (!keepExt(x, z)) continue;
        if (wmask.at(x, z) < 0.3) continue;
        const c = extChunkOf(x, z);
        c.list.push({ x, z, v: c.v, g: 0 });
      }
    }
  }
  mark('D-37 块外草格网 + 树脚');

  /** 一个草块的懒建工厂。旧草块与块外草块共用;只有种子与名字不同。 */
  const registerGrassChunk = (list: ChunkList, cx: number, cz: number, rngFor: (v: number) => () => number, nameFor: (v: number) => string): void => {
    // The factory owns matrices and attributes; distant chunks retain only placement data.
    // Conservative height allowance covers steep banks and the grass wind displacement.
    culler.addLazy(new THREE.Vector3(cx, ground(cx, cz), cz), Math.hypot(VEG.chunk, VEG.chunk) / 2 + 20, () => {
    const generated: THREE.InstancedMesh[] = [];
    // One mesh per (chunk, tuft variant): variants must not share a geometry.
    for (let v = 0; v < tuftGeos.length; v++) {
      const subset = list.filter((s) => s.v === v);
      if (subset.length === 0) continue;
      const cRng = rngFor(v);
      const mesh = makeInstanced(tuftGeos[v], grassMat, subset.length, cRng, 1);
      for (let i = 0; i < subset.length; i++) {
        const s = subset[i];
        // Cubed so the distribution is bottom-heavy: mostly short lawn with a
        // scattering of taller tufts, which is what a mown-but-loved green does.
        const sc = 0.62 + Math.pow(cRng(), 2.4) * 1.15;
        euler.set(rangeOf(cRng, -0.1, 0.1), cRng() * Math.PI * 2, rangeOf(cRng, -0.1, 0.1), 'ZYX');
        q.setFromEuler(euler);
        pos3.set(s.x, ground(s.x, s.z) - 0.035, s.z);
        scl.set(sc * rangeOf(cRng, 0.9, 1.25), sc * rangeOf(cRng, 0.82, 1.25), sc);
        m4.compose(pos3, q, scl);
        mesh.setMatrixAt(i, m4);
        const warm = rangeOf(cRng, -1, 1);
        col.setRGB(1 + warm * 0.1, 1 + rangeOf(cRng, -0.07, 0.07), 1 - warm * 0.14);
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Grass is billboard filler; ART_DIRECTION §2.4 exempts it from casting,
      // and fourteen thousand alpha-tested shadow casters would cost more than
      // the whole rest of the town.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      // Grass deliberately stays in the VSM shadow pass even though it does not
      // cast. Being a receiver puts it in the map, and the soft tuft-shaped
      // darkening that falls on the turf as a result is the ground contact
      // shadowing ART_DIRECTION §9 asks for. Taking grass out flattens the lawn
      // into an even sheet of green — measured, it is worth ~330k triangles a
      // frame and it is not worth having.
      mesh.name = nameFor(v);
      mesh.computeBoundingSphere();
      mesh.boundingSphere!.radius += instanceWindPadding(mesh);
      generated.push(mesh);
    }
    return generated;
    }, VEG.drawDist.grass);
  };

  chunks.forEach((list, ci) => {
    if (list.length === 0) return;
    const colIndex = ci % chunkCols, rowIndex = Math.floor(ci / chunkCols);
    const cx = LEGACY_SCATTER.minX + (colIndex + 0.5) * VEG.chunk;
    const cz = LEGACY_SCATTER.minZ + (rowIndex + 0.5) * VEG.chunk;
    registerGrassChunk(list, cx, cz, (v) => makeRng(ctx.seed ^ (ci * 2654435761) ^ (v * 40503)), (v) => `Grass_${ci}_${v}`);
  });
  for (const c of extChunks.values()) {
    if (c.list.length === 0) continue;
    const cx = (c.kx + 0.5) * EXT_GRASS_CHUNK, cz = (c.kz + 0.5) * EXT_GRASS_CHUNK;
    registerGrassChunk(c.list, cx, cz, (v) => makeRng((ctx.seed ^ blockHash(c.kx, c.kz, 0x6a55 + v)) >>> 0), (v) => `Grass_x${c.kx}_z${c.kz}_${v}`);
  }

  mark('grass ruff + chunk register');
  // ---- clover ------------------------------------------------------
  {
    const cloverGeo = cloverGeometry(ctx.seed ^ 0xc10e);
    const cloverMat = createFoliageMaterial(ctx.env, {
      color: 0x7fbe4c,
      map: leafSets.warm.map,
      normalMap: leafSets.warm.normalMap,
      roughnessMap: leafSets.warm.roughnessMap,
      normalScale: 0.6,
      roughness: 0.84,
      windScale: 0.7,
      wrap: 0.55,
      transColor: 0xb2e065,
      transStrength: 2.0,
      haloStrength: 0.10,
      side: THREE.DoubleSide,
    });

    const cRng = makeRng(ctx.seed ^ 0xc10e5);
    const patches = poissonScatter({
      ...LEGACY_SCATTER,
      radius: 2.3, tries: 2600,
      density: (x, z) => (mask.at(x, z) > 0.85 ? 0.85 * outsideBuildings(x, z, 0.1) : 0),
      rng: cRng,
    });

    const spots: { x: number; z: number }[] = [];
    for (const p of patches) {
      const n = 12 + Math.floor(cRng() * 26);
      const spread = rangeOf(cRng, 0.5, 1.35);
      for (let i = 0; i < n; i++) {
        // Gaussian-ish falloff from the patch centre: real clover grows out
        // from a runner, so density has to decay, not stop at a hard rim.
        const a = cRng() * Math.PI * 2;
        const r = spread * Math.pow(cRng(), 0.65);
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (mask.at(x, z) < 0.6) continue;
        spots.push({ x, z });
      }
    }
    // D-37:块里的三叶草。同参数(2.3 m 丛心、12–37 株、0.5–1.35 m),飞镖数按面积折,
    // 丛心与株位都用块 / 丛心坐标播种,撒完裁到当前窗口、旧散布盒外。接在旧的后面。
    const nOldClover = spots.length;
    for (const b of extBlocks) {
      const bR = blockRng(b, 0xc10e5);
      const ps = poissonScatter({
        ...blockRect(b, EXT_BLOCK), radius: 2.3, tries: extTries(2600),
        density: (x, z) => (inLegacy(x, z) ? 0 : wmask.at(x, z) > 0.85 ? 0.85 * outsideBuildings(x, z, 0.1) : 0),
        rng: bR,
      });
      for (const p of ps) {
        const pR = makeRng((ctx.seed ^ 0xc10e5 ^ Math.floor(scatterHash01(p.x, p.z) * 4294967296)) >>> 0);
        const n = 12 + Math.floor(pR() * 26);
        const spread = rangeOf(pR, 0.5, 1.35);
        for (let i = 0; i < n; i++) {
          const a = pR() * Math.PI * 2;
          const r = spread * Math.pow(pR(), 0.65);
          const x = p.x + Math.cos(a) * r;
          const z = p.z + Math.sin(a) * r;
          if (!keepExt(x, z) || wmask.at(x, z) < 0.6) continue;
          spots.push({ x, z });
        }
      }
    }

    if (spots.length) {
      let mesh = makeInstanced(cloverGeo, cloverMat, spots.length, splitRng(cRng, 2 * nOldClover, coordSeq(spots.slice(nOldClover), 0xc137)), 1);
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        const R = i < nOldClover ? cRng : makeRng((ctx.seed ^ 0xc1037 ^ Math.floor(scatterHash01(s.x, s.z) * 4294967296)) >>> 0);
        const sc = rangeOf(R, 0.75, 1.5);
        euler.set(rangeOf(R, -0.14, 0.14), R() * Math.PI * 2, rangeOf(R, -0.14, 0.14), 'ZYX');
        q.setFromEuler(euler);
        pos3.set(s.x, ground(s.x, s.z) - 0.012, s.z);
        scl.set(sc, sc * rangeOf(R, 0.85, 1.2), sc);
        m4.compose(pos3, q, scl);
        mesh.setMatrixAt(i, m4);
        const warm = rangeOf(R, -1, 1);
        col.setRGB(1 + warm * 0.09, 1 + rangeOf(R, -0.06, 0.06), 1 - warm * 0.12);
        mesh.setColorAt(i, col);
      }
      // 院内按区压（AL-b b5）：全量生成完再筛，院外每株的样子不变。
      mesh = keepInstances(mesh, spots.map((sp) => keepInCourt(sp.x, sp.z, 'clover')));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = 'Clover';
      mesh.computeBoundingSphere();
      group.add(mesh);
      // Clover is the one piece of ground scatter that is kept out of the
      // shadow map. Grass, flowers and weeds stand up off the turf and their
      // shadows are the contact detail §9 asks for; a clover leaf is a 5cm dome
      // lying flat on the ground, so at 1.7cm a shadow texel, blurred, it
      // occludes nothing it is not already touching.
      culler.add([mesh], { maxDist: VEG.drawDist.clover, skipShadow: [mesh] });
    }
  }

  mark('clover');
  // ---- flowers -----------------------------------------------------
  {
    const petal = petalMaps();
    const ACCENTS = [0xf25d7a, 0xffd447, 0xf5f0ea, 0xb57fe0];
    const fRng = makeRng(ctx.seed ^ 0xf10e72);

    // Flowers grow in single-species drifts. A mixed confetti scatter is the
    // classic procedural tell; real meadows are patchy and monochrome per patch.
    const driftDensityOn = (mk: { at(x: number, z: number): number }, x: number, z: number): number => {
        if (mk.at(x, z) < 0.9) return 0;
        // Denser on the town green and along the treeline skirt.
        const green = smoothstep(16, 4, Math.hypot(x, z - 6));
        const skirt = smoothstep(9.5, 13.5, Math.abs(x)) * smoothstep(20, 14, Math.abs(x));
        return clamp(0.22 + green * 0.6 + skirt * 0.55, 0, 1) * outsideBuildings(x, z, 0.2);
    };
    const DRIFT_RECT: Rect = { minX: LEGACY_SCATTER.minX + 1, maxX: LEGACY_SCATTER.maxX - 1, minZ: LEGACY_SCATTER.minZ + 1, maxZ: LEGACY_SCATTER.maxZ - 1 };
    const drifts = poissonScatter({
      ...DRIFT_RECT,
      radius: 3.1, tries: 2200,
      density: (x, z) => driftDensityOn(mask, x, z),
      rng: fRng,
    });

    const buckets: { x: number; z: number }[][] = ACCENTS.map(() => []);
    /** D-37:块里的花。每丛的色 / 株数 / 散开用丛心坐标播种,株照旧由区调筛。接在每色旧的后面。 */
    const bucketsExt: { x: number; z: number }[][] = ACCENTS.map(() => []);
    const keepFlower = (x: number, z: number): boolean => {
        // 按区调（单子 AL4）：坐标哈希当筛子，**不吃 rng**，也不动上面的
        // `density`——理由见 `REGION_GROUND_FLOWERS` 的头注（`P-28`）。
        const reg = regionOf(x, z);
        const gf = reg ? REGION_GROUND_FLOWERS[reg] ?? 1 : 1;
        return !(gf <= 0 || (gf < 1 && scatterHash01(x + 13.7, z - 21.3) >= gf));
    };
    for (const b of extBlocks) {
      const ds = poissonScatter({
        ...blockRect(b, EXT_BLOCK), radius: 3.1, tries: extTries(2200, DRIFT_RECT),
        density: (x, z) => (inLegacy(x, z) ? 0 : driftDensityOn(wmask, x, z)),
        rng: blockRng(b, 0xf10e72),
      });
      for (const d of ds) {
        const dR = makeRng((ctx.seed ^ 0xf10e72 ^ Math.floor(scatterHash01(d.x, d.z) * 4294967296)) >>> 0);
        const which = Math.floor(dR() * ACCENTS.length) % ACCENTS.length;
        const n = 5 + Math.floor(dR() * 14);
        const spread = rangeOf(dR, 0.42, 1.15);
        for (let i = 0; i < n; i++) {
          const a = dR() * Math.PI * 2;
          const r = spread * Math.pow(dR(), 0.6);
          const x = d.x + Math.cos(a) * r;
          const z = d.z + Math.sin(a) * r;
          if (!keepExt(x, z) || wmask.at(x, z) < 0.7 || !keepFlower(x, z)) continue;
          bucketsExt[which].push({ x, z });
        }
      }
    }
    for (const d of drifts) {
      const which = Math.floor(fRng() * ACCENTS.length) % ACCENTS.length;
      const n = 5 + Math.floor(fRng() * 14);
      const spread = rangeOf(fRng, 0.42, 1.15);
      for (let i = 0; i < n; i++) {
        const a = fRng() * Math.PI * 2;
        const r = spread * Math.pow(fRng(), 0.6);
        const x = d.x + Math.cos(a) * r;
        const z = d.z + Math.sin(a) * r;
        if (mask.at(x, z) < 0.7) continue;
        // 按区调（单子 AL4）：坐标哈希当筛子，**不吃 rng**，也不动上面的
        // `density`——理由见 `REGION_GROUND_FLOWERS` 的头注（`P-28`）。
        // 放在这里而不是 drift 那一层：drift 被 `continue` 掉会让后面每一丛的
        // 颜色与株数都错位，位置虽然没变，院外的花也算被动过了。
        const reg = regionOf(x, z);
        const gf = reg ? REGION_GROUND_FLOWERS[reg] ?? 1 : 1;
        if (gf <= 0 || (gf < 1 && scatterHash01(x + 13.7, z - 21.3) >= gf)) continue;
        buckets[which].push({ x, z });
      }
    }

    ACCENTS.forEach((hex, ai) => {
      const nOld = buckets[ai].length;
      const spots = [...buckets[ai], ...bucketsExt[ai]];
      if (!spots.length) return;
      const accent = new THREE.Color(hex);
      const geo = flowerGeometry((ctx.seed ^ 0xf10) + ai * 977, accent);
      const mat = createFoliageMaterial(ctx.env, {
        color: 0xffffff,
        map: petal.map,
        normalMap: petal.normalMap,
        normalScale: 0.5,
        roughness: 0.72,
        windScale: 1.35,
        wrap: 0.6,
        transColor: hex,
        transStrength: 1.6,
        haloStrength: 0.12,
        side: THREE.DoubleSide,
      });
      const mesh = makeInstanced(geo, mat, spots.length, splitRng(fRng, 2 * nOld, coordSeq(spots.slice(nOld), 0xf137 + ai)), 1);
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        const R = i < nOld ? fRng : makeRng((ctx.seed ^ (0xf1037 + ai) ^ Math.floor(scatterHash01(s.x, s.z) * 4294967296)) >>> 0);
        const sc = rangeOf(R, 0.8, 1.45);
        euler.set(rangeOf(R, -0.16, 0.16), R() * Math.PI * 2, rangeOf(R, -0.16, 0.16), 'ZYX');
        q.setFromEuler(euler);
        pos3.set(s.x, ground(s.x, s.z) - 0.01, s.z);
        scl.set(sc, sc * rangeOf(R, 0.85, 1.25), sc);
        m4.compose(pos3, q, scl);
        mesh.setMatrixAt(i, m4);
        col.setRGB(rangeOf(R, 0.9, 1.08), rangeOf(R, 0.9, 1.08), rangeOf(R, 0.9, 1.08));
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = `Flowers_${ai}`;
      mesh.computeBoundingSphere();
      group.add(mesh);
      culler.add([mesh], { maxDist: VEG.drawDist.flowers });
    });

    // —— 梨花:潇湘馆后院「大株梨花」树下的花莛(PQ-5b 新花型之一)。
    // 院里是土地不是草皮,这里只验脚下站得住,绕开草皮 mask;
    // 「花该长在哪些地表」的门槛整体归 PQ-4,本单子只交花型。——
    {
      const spots: { x: number; z: number }[] = [];
      for (let i = 0; i < 14; i++) {
        const a = fRng() * Math.PI * 2;
        const r = rangeOf(fRng, 1.0, 2.2);
        const x = -108 + Math.cos(a) * r;
        const z = 84.5 + Math.sin(a) * r;
        if (ground(x, z) < VEG.minPlantY) continue;
        if (outsideBuildings(x, z, 0.1) < 0.5) continue;
        spots.push({ x, z });
      }
      if (spots.length) {
        const mesh = makeInstanced(
          pearBlossomGeometry(ctx.seed ^ 0x9ea2),
          createFoliageMaterial(ctx.env, {
            color: 0xffffff,
            map: petal.map,
            normalMap: petal.normalMap,
            normalScale: 0.5,
            roughness: 0.7,
            windScale: 1.3,
            wrap: 0.62,
            transColor: 0xfff6ea,
            transStrength: 1.7,
            haloStrength: 0.12,
            side: THREE.DoubleSide,
          }),
          spots.length, fRng, 1,
        );
        for (let i = 0; i < spots.length; i++) {
          const s = spots[i];
          const sc = rangeOf(fRng, 0.85, 1.3);
          euler.set(rangeOf(fRng, -0.12, 0.12), fRng() * Math.PI * 2, rangeOf(fRng, -0.12, 0.12), 'ZYX');
          q.setFromEuler(euler);
          pos3.set(s.x, ground(s.x, s.z) - 0.01, s.z);
          scl.set(sc, sc * rangeOf(fRng, 0.9, 1.2), sc);
          m4.compose(pos3, q, scl);
          mesh.setMatrixAt(i, m4);
          col.setRGB(rangeOf(fRng, 0.92, 1.05), rangeOf(fRng, 0.92, 1.05), rangeOf(fRng, 0.9, 1.02));
          mesh.setColorAt(i, col);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.name = 'Flowers_pear_xiaoxiang';
        mesh.computeBoundingSphere();
        group.add(mesh);
        culler.add([mesh], { maxDist: VEG.drawDist.flowers });
      }
    }

    // —— 隔岸花:「隔岸花分一脈香」(第十七回沁芳联)。沿南池岸外 1–3.2 m
    // 一条花带,三种淡色(粉/米白/淡紫)分株混生,高莛锥序读作远远一带花气。——
    {
      const ring = waterRingPoints('pool.south');
      if (ring) {
        const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
        const cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        const TINTS: [number, number, number][] = [
          [0.95, 0.78, 0.85],
          [0.97, 0.94, 0.88],
          [0.79, 0.71, 0.91],
        ];
        const buckets: { x: number; z: number }[][] = TINTS.map(() => []);
        let prev: { x: number; z: number } | null = null;
        for (let e = 0; e < ring.length; e++) {
          const [ax, az] = ring[e];
          const [bx, bz] = ring[(e + 1) % ring.length];
          const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.8));
          for (let s = 0; s < steps; s++) {
            const vx = lerp(ax, bx, s / steps);
            const vz = lerp(az, bz, s / steps);
            const dx = vx - cx;
            const dz = vz - cz;
            const dl = Math.hypot(dx, dz) || 1;
            const out = rangeOf(fRng, 1.0, 3.2);
            const x = vx + (dx / dl) * out;
            const z = vz + (dz / dl) * out;
            if (ground(x, z) < VEG.minPlantY) continue;
            if (anyMaskAt(x, z) < 0.5) continue;
            if (outsideBuildings(x, z, 0.2) < 0.5) continue;
            if (prev && Math.hypot(prev.x - x, prev.z - z) < 0.8) continue;
            prev = { x, z };
            buckets[Math.floor(fRng() * TINTS.length) % TINTS.length].push({ x, z });
          }
        }
        buckets.forEach((spots, ti) => {
          if (!spots.length) return;
          const tint = TINTS[ti];
          const mesh = makeInstanced(
            bankFlowerGeometry((ctx.seed ^ 0xba9f10) + ti * 613, tint),
            createFoliageMaterial(ctx.env, {
              color: 0xffffff,
              map: petal.map,
              normalMap: petal.normalMap,
              normalScale: 0.5,
              roughness: 0.72,
              windScale: 1.4,
              wrap: 0.6,
              transColor: new THREE.Color(tint[0], tint[1], tint[2]).getHex(),
              transStrength: 1.6,
              haloStrength: 0.12,
              side: THREE.DoubleSide,
            }),
            spots.length, fRng, 1,
          );
          for (let i = 0; i < spots.length; i++) {
            const s = spots[i];
            const sc = rangeOf(fRng, 0.85, 1.35);
            euler.set(rangeOf(fRng, -0.14, 0.14), fRng() * Math.PI * 2, rangeOf(fRng, -0.14, 0.14), 'ZYX');
            q.setFromEuler(euler);
            pos3.set(s.x, ground(s.x, s.z) - 0.01, s.z);
            scl.set(sc, sc * rangeOf(fRng, 0.9, 1.25), sc);
            m4.compose(pos3, q, scl);
            mesh.setMatrixAt(i, m4);
            col.setRGB(rangeOf(fRng, 0.92, 1.06), rangeOf(fRng, 0.92, 1.06), rangeOf(fRng, 0.92, 1.06));
            mesh.setColorAt(i, col);
          }
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          mesh.name = `Flowers_bank_${ti}`;
          mesh.computeBoundingSphere();
          group.add(mesh);
          culler.add([mesh], { maxDist: VEG.drawDist.flowers });
        });
      }
    }

    // —— 种植带(PQ-4):plan.json 里 kind:'planting' 且带 bed 的条目是人种的花——
    // 花池里不看草皮掩码(铺装的院子也长),只验脚下站得住、不在建筑里。
    // 范围与花色全在数据里(bedsFromPlan):regions[].plants 记名目、planting
    // 条目记位置,与 PE 的种植数据同一套真源,不另造体系。整条在地形窗口外
    // 的(如蔷薇院/芍药圃)现在跳过,等 PE 建到那区自然长出来。——
    {
      const bedRing = (bed: ReturnType<typeof bedsFromPlan>[number]): Point2[] => {
        const radius = bed.radius ?? 1.5;
        return bed.polygon
          ? bed.polygon.map(([px, pz]) => [px, pz] as Point2)
          : Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2;
              return [bed.x + Math.cos(a) * radius, bed.z + Math.sin(a) * radius] as Point2;
            });
      };
      /** 一条花池落地:分色、建网格、逐株体量色偏。`R` 是这一段吃的 rng(旧窗口是共享的 `fRng`,块外是这条花池自己的)。 */
      const emitBed = (bed: ReturnType<typeof bedsFromPlan>[number], spots: { x: number; z: number }[], R: () => number, name: (ti: number) => string): void => {
        const tints = (bed.tints?.length ? bed.tints : ['#f5f0ea']).map((t) => new THREE.Color(t).getHex());
        const bedBuckets: { x: number; z: number }[][] = tints.map(() => []);
        for (const s of spots) bedBuckets[Math.floor(R() * tints.length) % tints.length].push(s);
        bedBuckets.forEach((list, ti) => {
          if (!list.length) return;
          const mesh = makeInstanced(
            flowerGeometry((ctx.seed ^ 0xbed0) + ti * 389, new THREE.Color(tints[ti])),
            createFoliageMaterial(ctx.env, {
              color: 0xffffff,
              map: petal.map,
              normalMap: petal.normalMap,
              normalScale: 0.5,
              roughness: 0.72,
              windScale: 1.35,
              wrap: 0.6,
              transColor: tints[ti],
              transStrength: 1.6,
              haloStrength: 0.12,
              side: THREE.DoubleSide,
            }),
            list.length, R, 1,
          );
          for (let i = 0; i < list.length; i++) {
            const s = list[i];
            const sc = rangeOf(R, 0.8, 1.45) * BED_FLOWER_SCALE;
            euler.set(rangeOf(R, -0.16, 0.16), R() * Math.PI * 2, rangeOf(R, -0.16, 0.16), 'ZYX');
            q.setFromEuler(euler);
            pos3.set(s.x, ground(s.x, s.z) - 0.01, s.z);
            scl.set(sc, sc * rangeOf(R, 0.85, 1.25), sc);
            m4.compose(pos3, q, scl);
            mesh.setMatrixAt(i, m4);
            col.setRGB(rangeOf(R, 0.9, 1.08), rangeOf(R, 0.9, 1.08), rangeOf(R, 0.9, 1.08));
            mesh.setColorAt(i, col);
          }
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          mesh.name = name(ti);
          mesh.computeBoundingSphere();
          group.add(mesh);
          culler.add([mesh], { maxDist: VEG.drawDist.flowers });
        });
      };
      const bedDensityFn = (bed: ReturnType<typeof bedsFromPlan>[number], ring: Point2[]) => {
        const bedDensity = bed.density ?? 1;
        return (x: number, z: number): number => {
          // 花池不问地表是不是草——这是它与自然散布的唯一区别。
          if (locatePoint(ring, [x, z]) === 'outside') return 0;
          if (ground(x, z) < VEG.minPlantY) return 0;
          return bedDensity * outsideBuildings(x, z, 0.1);
        };
      };
      const registerBed = (bed: ReturnType<typeof bedsFromPlan>[number], flowers: number): void => {
        // 单子 Z:「植树」这一步也要自报。以前整步不登记,于是对账门把这两条
        // 好好长在那儿的花池(xiaoxiangguan.path-bed-west/east)报成「数据说有、
        // 世界没有」——spec §1.5 ②「世界自报的清单是残缺的」在另一层复发。
        registerObject({
          id: bed.id, name: bed.name, part: 'flower-bed', variant: bed.id,
          position: [bed.x, ground(bed.x, bed.z), bed.z], yaw: 0,
          planId: bed.id, size: null, flowers, basis: bed.basis,
        });
      };
      const registeredBeds = new Set<string>();
      // 旧散布盒:与 719171d0 同一条 fRng、同一个裁边(D-37:裁边钉在 LEGACY_SCATTER)。
      for (const bed of bedsFromPlan()) {
        const ring = bedRing(bed);
        const bxs = ring.map((p) => p[0]);
        const bzs = ring.map((p) => p[1]);
        const minX = Math.max(Math.min(...bxs), LEGACY_SCATTER.minX);
        const maxX = Math.min(Math.max(...bxs), LEGACY_SCATTER.maxX);
        const minZ = Math.max(Math.min(...bzs), LEGACY_SCATTER.minZ);
        const maxZ = Math.min(Math.max(...bzs), LEGACY_SCATTER.maxZ);
        if (minX >= maxX || minZ >= maxZ) continue;
        const spots = poissonScatter({
          minX, maxX, minZ, maxZ,
          radius: 0.34, tries: 400,
          density: bedDensityFn(bed, ring),
          rng: fRng,
        });
        if (!spots.length) continue;
        registerBed(bed, spots.length);
        registeredBeds.add(bed.id);
        emitBed(bed, spots, fRng, (ti) => `FlowerBed_${bed.id}_${ti}`);
      }
      // D-37:伸出旧散布盒的花池(蔷薇院、芍药圃……),盒外那一段按整条花池的包围盒撒
      // (不按窗口裁——裁了就跟窗口走),种子只取花池锚点,撒完再裁到当前窗口、旧盒外。
      for (const bed of bedsFromPlan()) {
        const ring = bedRing(bed);
        const bb: Rect = {
          minX: Math.min(...ring.map((p) => p[0])), maxX: Math.max(...ring.map((p) => p[0])),
          minZ: Math.min(...ring.map((p) => p[1])), maxZ: Math.max(...ring.map((p) => p[1])),
        };
        if (rectWithin(bb, LEGACY_SCATTER)) continue;
        const bR = makeRng((ctx.seed ^ blockHash(Math.round(bed.x * 16), Math.round(bed.z * 16), 0xbed37)) >>> 0);
        const dens = bedDensityFn(bed, ring);
        const spots = poissonScatter({
          ...bb, radius: 0.34, tries: 400,
          density: (x, z) => (inLegacy(x, z) ? 0 : dens(x, z)),
          rng: bR,
        }).filter((sp) => keepExt(sp.x, sp.z));
        if (!spots.length) continue;
        const partial = registeredBeds.has(bed.id);
        if (!partial) registerBed(bed, spots.length);
        emitBed(bed, spots, bR, (ti) => `FlowerBed_${bed.id}_${ti}${partial ? '_ext' : ''}`);
      }
    }
  }

  mark('flowers');
  // ---- weeds / ferns ----------------------------------------------
  {
    const wRng = makeRng(ctx.seed ^ 0x3e2d);
    const weedTex = leafCardTexture('fern', ctx.seed ^ 0x1eaf);
    const weedMat = createFoliageMaterial(ctx.env, {
      color: 0xdcecc0,
      map: weedTex,
      roughness: 0.88,
      windScale: 1.35,
      wrap: 0.58,
      transColor: 0xa8dd60,
      transStrength: 2.3,
      haloStrength: 0.12,
      alphaTest: 0.36,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
    });

    const geos = [weedGeometry(ctx.seed ^ 0x4e1, 0.48), weedGeometry(ctx.seed ^ 0x4e2, 0.74)];
    const weedDensityOn = (mk: { at(x: number, z: number): number }, x: number, z: number): number => {
        if (mk.at(x, z) < 0.8) return 0;
        // Weeds go where a mower would not: against the wood, the south shelf,
        // and the shady side of the houses.
        const wood = smoothstep(9.5, 14.5, Math.abs(x));
        const south = smoothstep(16.5, 22, z);
        // 单子 Z:同上,距离读 occupancy 场。
        const wall = smoothstep(1.6, 0.2, occupancyDistance(x, z));
        const n = fbm2(clump, x * 0.22 + 41, z * 0.22, 3) * 0.5 + 0.5;
        /*
         * 峰脚蕨簇(单子 AV3)。「翠」的三层里最贴地的那一层:石与土交界的那一圈
         * 潮阴处长蕨与书带草,它同时是 AV4 的石脚与草地之间那道缝的填充物——
         * 石脚落位时特意给蕨留了 0.28–0.46 m。
         * 环带 0.9–4.3 m:再近就长进石头里(峰的世界包围盒半宽 1.9–3.0 m),
         * 再远就散成普通杂草、失掉「贴着石脚一圈」的读法。
         */
        const pd = peakDistance(x, z);
        const foot = pd < 40 ? smoothstep(0.55, 1.1, pd) * smoothstep(4.3, 2.6, pd) : 0;
        return clamp(
          (Math.max(wood, south) * 0.75 + wall * 0.7) * (0.3 + n) + foot * (0.5 + n * 0.6),
          0,
          1,
        ) * outsideBuildings(x, z, 0.1);
    };
    const spots = poissonScatter({
      ...LEGACY_SCATTER,
      radius: 0.7, tries: 12000,
      density: (x, z) => weedDensityOn(mask, x, z),
      rng: wRng,
    });

    const groups: { x: number; z: number }[][] = [[], []];
    for (const s of spots) groups[wRng() < 0.6 ? 0 : 1].push(s);
    // D-37:块里的杂草/蕨。同参数(0.7 m),飞镖数按面积折,分组用坐标哈希,接在每组旧的后面。
    const groupsExt: { x: number; z: number }[][] = [[], []];
    for (const b of extBlocks) {
      for (const sp of poissonScatter({
        ...blockRect(b, EXT_BLOCK), radius: 0.7, tries: extTries(12000),
        density: (x, z) => (inLegacy(x, z) ? 0 : weedDensityOn(wmask, x, z)),
        rng: blockRng(b, 0x3e2d),
      })) {
        if (!keepExt(sp.x, sp.z)) continue;
        groupsExt[scatterHash01(sp.x - 3.1, sp.z + 7.7) < 0.6 ? 0 : 1].push(sp);
      }
    }

    groups.forEach((old, gi) => {
      const list = [...old, ...groupsExt[gi]];
      if (!list.length) return;
      let mesh = makeInstanced(geos[gi], weedMat, list.length, splitRng(wRng, 2 * old.length, coordSeq(groupsExt[gi], 0x3e37 + gi)), 1);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const R = i < old.length ? wRng : makeRng((ctx.seed ^ (0x3e2d37 + gi) ^ Math.floor(scatterHash01(s.x, s.z) * 4294967296)) >>> 0);
        const sc = rangeOf(R, 0.7, 1.45);
        euler.set(rangeOf(R, -0.12, 0.12), R() * Math.PI * 2, rangeOf(R, -0.12, 0.12), 'ZYX');
        q.setFromEuler(euler);
        pos3.set(s.x, ground(s.x, s.z) - 0.03, s.z);
        scl.set(sc, sc * rangeOf(R, 0.85, 1.25), sc);
        m4.compose(pos3, q, scl);
        mesh.setMatrixAt(i, m4);
        const warm = rangeOf(R, -1, 1);
        col.setRGB(1 + warm * 0.09, 1 + rangeOf(R, -0.06, 0.06), 1 - warm * 0.11);
        mesh.setColorAt(i, col);
      }
      // 院内按区压（AL-b b5）：同三叶草，全量生成完再筛。
      mesh = keepInstances(mesh, list.map((sp) => keepInCourt(sp.x, sp.z, 'weeds')));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = `Weeds_${gi}`;
      mesh.computeBoundingSphere();
      group.add(mesh);
      culler.add([mesh], { maxDist: VEG.drawDist.weeds });
    });
  }

  mark('weeds');
  /* ---------------- culling ----------------------------------------- */

  // Prime the spawn neighbourhood before reporting world build complete. Three's
  // per-camera frustum tests retain off-screen casters in the shadow camera.
  culler.update(ctx.camera);
  mark('culler prime(出生点附近按需簇现建)');
  ctx.tick(() => culler.update(ctx.camera));
  group.userData.vegDebug = {
    setCulling: (on: boolean) => culler.setEnabled(on),
    setFrustumCulling: (on: boolean) => culler.setFrustumCulling(on),
    setDistanceCulling: (on: boolean) => culler.setDistanceCulling(on),
    stats: () => culler.stats(),
  };
  group.userData.buildTimings = buildTimings;
  group.userData.treePlacements = treeBases;
  group.userData.naturalTreeCount = treeSpots.length;
  // D-37 自报:块数、块里的树/灌木株数、世界掩码烤了多少格点(建时归因用)。
  group.userData.apricotGrove = groveCount;
  group.userData.d37 = { blocks: extBlocks.length, extTrees: extTreeSpots.length, extBushes: extBushSpots.length,
    extGrassChunks: [...extChunks.values()].filter((c) => c.list.length).length, worldMaskSamples: wmask.baked };
  group.userData.grassCoverage = { denseChunks: denseChunks.filter(Boolean).length,
    chunks: denseChunks.length, lattices: GRASS_LATTICES.map((l) => l.cell) };
}

/** Static distant backgrounds reuse the existing broadleaf generator at a
 * smaller mesh resolution. This is not a species claim or the P3 plant pack. */
export function buildDistantTreeGeometry(seed:number):TreeGeo {
  return buildTree({...SPECIES[0],res:12,limbs:3},seed);
}
