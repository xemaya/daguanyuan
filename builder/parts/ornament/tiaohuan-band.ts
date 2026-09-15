import * as THREE from 'three';
import { CN, woodMaterial } from '@builder/parts/materials';
import { XIFANCAO_SEEDS } from '@builder/parts/ornament/pattern2d';
import {
  makeScrollBand, buildReliefBandGeometry, buildReliefBandPlane, bakeReliefBandMaps,
  bandTriangleCount, XIFANCAO_LEVELS, type ReliefBand, type ReliefLevels,
} from '@builder/parts/ornament/relief';

/**
 * 绦环板的西番草带(单子 AS)——AO 那条管线的第二个消费者,这一次落在人眼高度。
 *
 * `D-27` 拍板:雕饰的重心从台矶(带心 0.185m,任何站距下 ≤ 32px)移到格扇的
 * 绦环板(带心约 1.3m,站 1m 就能占满一条)。`07-01`「那門欄窗槅,皆是細雕
 * 新鮮花樣」站在这一边——细雕本来就钉在门窗上。
 *
 * ---
 *
 * ## 一份纹样、两种表示,以及为什么贴图版只有一张图
 *
 * `makeGeshan` 被全园 36 扇格扇调用。近景几何(顶点位移)一扇 4k 三角,全园
 * 铺开就是 15 万——那是台矶那一单已经证明看不见的钱。所以本单按角色分档:
 * 玩家穿门必贴着走的那几扇走几何版,其余走贴图版。
 *
 * 贴图版真正的风险不是三角,是 **draw call**:
 *
 *   - 每扇烤一张图 → 每扇一个材质 → `mergeByMaterial` 每扇一个桶 → 36 个 draw call;
 *   - 每扇共用一张图但尺寸各异 → 图得按尺寸分 → 还是好几个桶。
 *
 * 本文件的解法是**一张四格图集**:把四个种子的单元连成一条 **首尾相接**
 * (`cyclic`)的四格带,整条烤进一张 512²,然后每扇的面片按 `uv` 偏移去取
 * 其中连续的 n 格(`RepeatWrapping`,n 不是 4 的倍数也接得上,因为带是环的)。
 * 全园只烤这一次、只有这一个材质实例——每栋建筑合并后多出来的 draw call 是 1。
 *
 * ## 为什么纹样比例锁成标称值
 *
 * 全园格扇净宽 0.47~0.77m,各自求整以后单元长在 0.156~0.194m 之间飘。若纹样
 * 按各扇自己的比例生成,每扇的叶形都不一样,那张图集就只对某一种宽度成立。
 * 锁成标称比例(`TIAOHUAN_CELL_W / TIAOHUAN_BAND_H`)之后,各扇之间只差一个
 * 整体拉伸,几何版与贴图版拉伸得一模一样——中景 pixel diff 量的才是「顶点
 * 位移 vs 法线贴图」这件事本身。代价写在 `TIAOHUAN_CELL_W` 的注释里。
 *
 * ## 出处
 *
 * 纹样的「形」无出处(见 `pattern2d.ts` 文件头),带的尺寸、叶面抬高到 3.5mm、
 * 单元 17.5cm 这三件是艺术选择,依据是 `D-27` 与 AO 验收「叶弱藤强」那一条。
 * 消费方(`building.ts` 的 `makeGeshan`)沿用格扇既有的 `artChoice` 留痕。
 */

/* ------------------------------------------------------------------ */
/* 尺寸与档位(艺术选择)                                              */
/* ------------------------------------------------------------------ */

/**
 * 叶面抬一档:AO 的台矶样件验收说「叶弱藤强」——主藤 4mm、叶面 2.5mm,掠射下
 * 叶子几乎读不出厚度。绦环板离眼睛近十倍,把叶面抬到 3.5mm(仍低于主藤 4mm,
 * 主次关系不倒)。**其余档位一格不动**,台矶样件的测试要继续绿。
 */
export const TIAOHUAN_LEVELS: ReliefLevels = { ...XIFANCAO_LEVELS, leafH: 0.0035 };

/** 带高(米)。绦环板净高 0.172m(抹头之间),带子居中,上下各留 1.6cm 素板。 */
export const TIAOHUAN_BAND_H = 0.14;

/**
 * 标称单元长(米)。各扇的真实单元长 = 净宽 / 整数,落在 0.15~0.2 之间;
 * 图集与纹样比例按这个标称值生成,真实值只作整体拉伸(见文件头)。
 */
export const TIAOHUAN_CELL_W = 0.175;

/** 纹样比例(标称)。全园所有绦环板共用,是「一张图集铺全园」的前提。 */
export const TIAOHUAN_ASPECT = TIAOHUAN_CELL_W / TIAOHUAN_BAND_H;

/**
 * 几何版的网格步长(米)。台矶样件用 4mm,本单放宽到 6mm:浮雕最细的特征是
 * 主脉半宽 1.3mm 与边缘软过渡 2mm,6mm 采不住主脉的槽底——但槽深只有 0.8mm,
 * 在 1m 站距下贡献的是一道明暗,不是一条可分辨的沟。放宽到 6mm 把一扇从
 * 9k 三角压到 4k,这是「按角色分档」能成立的前提。
 */
export const TIAOHUAN_STEP = 0.006;

/** 图集边长(像素)。四格 0.7m 挤进一张方图:沿带 1.37mm/纹素,横向 0.27mm。 */
export const TIAOHUAN_TEX = 512;

/** 图集的格数 = 种子数。 */
export const TIAOHUAN_ATLAS_CELLS = XIFANCAO_SEEDS.length;

/** 带子离板面抬起的量(米)。h=0 的石面部分与板面共面就会 z-fighting。 */
export const TIAOHUAN_LIFT = 0.0006;

/** 窄于这个宽度的绦环板不上纹样(单元塞不下一格)。 */
export const TIAOHUAN_MIN_W = 0.2;

export type TiaohuanMode = 'geo' | 'tex';

/* ------------------------------------------------------------------ */
/* 带子                                                                */
/* ------------------------------------------------------------------ */

/**
 * 把净宽求整成单元长:取使单元长最接近标称 17.5cm 的格数,并把结果钉在
 * 15~20cm 之间(`D-27` 之前的绦环板没有形制约束,这个区间是艺术选择)。
 *
 * **不许静默取整**——`makeScrollBand` 会检查带长是单元长的整数倍,这里返回的
 * 永远是 `lengthM / n`,天然整除;判据里那条「不整除抛错」测的是 `relief.ts`
 * 的纪律仍然在岗,不是这个函数。
 */
export function tiaohuanCells(lengthM: number): number {
  let best = Math.max(1, Math.round(lengthM / TIAOHUAN_CELL_W));
  for (const n of [best - 1, best, best + 1]) {
    if (n < 1) continue;
    const w = lengthM / n;
    if (w >= 0.15 && w <= 0.2) return n;
  }
  return best;
}

/** 一扇绦环板自己的带(几何版用,也是贴图版算 uv 用的那份尺寸)。 */
export function tiaohuanBand(lengthM: number, heightM = TIAOHUAN_BAND_H): ReliefBand {
  const n = tiaohuanCells(lengthM);
  return makeScrollBand(lengthM, heightM, lengthM / n, XIFANCAO_SEEDS, TIAOHUAN_LEVELS, 0,
    { cyclic: true, aspect: TIAOHUAN_ASPECT });
}

/**
 * 四格图集的带:标称尺寸、首尾相接。
 *
 * **全园只有这一条带会被烤**。它首尾相接,所以按 uv 重复铺到任意格数都接得上;
 * 它用标称比例,所以铺到任意宽度的绦环板上只是一个整体拉伸。
 */
export function tiaohuanAtlasBand(): ReliefBand {
  return makeScrollBand(
    TIAOHUAN_ATLAS_CELLS * TIAOHUAN_CELL_W, TIAOHUAN_BAND_H, TIAOHUAN_CELL_W,
    XIFANCAO_SEEDS, TIAOHUAN_LEVELS, 0, { cyclic: true, aspect: TIAOHUAN_ASPECT },
  );
}

/* ------------------------------------------------------------------ */
/* 贴图版:一张图集 + 一个材质                                         */
/* ------------------------------------------------------------------ */

/** 供预热链与测试点名的烘焙入口(`bakeReliefBandMaps` 自己按 key 记忆)。 */
export function bakeTiaohuanAtlas(): ReturnType<typeof bakeReliefBandMaps> {
  const maps = bakeReliefBandMaps(tiaohuanAtlasBand(), TIAOHUAN_TEX);
  for (const t of [maps.normalMap, maps.aoMap]) {
    // ① 图集要横向重复铺(一扇 3~4 格,图集 4 格),所以 u 必须 Repeat;
    //    v 不重复:带高方向一张图就是一条带,夹到边。
    // ② 图集走**第二套 uv**(`channel = 1`)。第一套留给木作自己的底色/粗糙度
    //    ——它们是格扇共用的那张木纹,按面片 0..1 读才与旁边的裙板同一个尺度;
    //    图集的 uv 是「取图集里连续的 n 格」,两件事共用一套 uv 会互相扭曲。
    if (t.wrapS !== THREE.RepeatWrapping || t.channel !== 1) {
      t.wrapS = THREE.RepeatWrapping;
      t.channel = 1;
      t.needsUpdate = true;
    }
  }
  return maps;
}

/**
 * 贴图版的材质——**全园一个实例**(按木色记忆)。
 *
 * 这是本单最容易做爆的地方:材质实例是 `mergeByMaterial` 的桶键,每扇一个
 * 实例就是每扇一个 draw call。一个实例的代价是每栋建筑合并后多一个桶,
 * 也就是 draw call 每栋 +1,这是判据里那条预算。
 *
 * 代价另一半:木纹自己的法线让位给了浮雕法线(一张材质只有一张 normalMap),
 * 所以贴图版的绦环板上没有木纹的微观起伏——中景读不出,贴脸读得出。
 */
const texMaterials = new Map<number, THREE.MeshPhysicalMaterial>();

export function tiaohuanTexMaterial(tint: number = CN.wood): THREE.MeshPhysicalMaterial {
  const hit = texMaterials.get(tint);
  if (hit) return hit;
  const maps = bakeTiaohuanAtlas();
  const base = woodMaterial(tint, 1);
  const mat = base.clone();
  mat.normalMap = maps.normalMap;
  mat.normalScale = new THREE.Vector2(maps.normalScale[0], maps.normalScale[1]);
  mat.aoMap = maps.aoMap;
  mat.needsUpdate = true;
  texMaterials.set(tint, mat);
  return mat;
}

/**
 * 贴图版的面片:两个三角,uv 沿带方向取图集里连续的 n 格。
 *
 * `rotation` 让相邻的格扇不从同一格起头——同一张图集,靠 uv 偏移错开,
 * 比"每扇烤一张"便宜四个数量级。
 */
export function buildTiaohuanPlane(band: ReliefBand, rotation: number): THREE.BufferGeometry {
  const geo = buildReliefBandPlane(band);
  const n = Math.round(band.lengthM / band.cellW);
  const u0 = (((rotation % TIAOHUAN_ATLAS_CELLS) + TIAOHUAN_ATLAS_CELLS) % TIAOHUAN_ATLAS_CELLS) / TIAOHUAN_ATLAS_CELLS;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const atlas = uv.clone();
  for (let i = 0; i < atlas.count; i++) {
    atlas.setX(i, u0 + (uv.getX(i) * n) / TIAOHUAN_ATLAS_CELLS);
  }
  // 第一套 uv 原样留给木纹底色(面片 0..1,与裙板那块 roundedBox 同一个尺度),
  // 第二套装图集(`channel = 1`,见 bakeTiaohuanAtlas)。
  geo.setAttribute('uv1', atlas);
  return geo;
}

/* ------------------------------------------------------------------ */
/* 出口                                                                */
/* ------------------------------------------------------------------ */

/**
 * 一扇绦环板的浮雕带。局部坐标:带心在原点,+Z 朝外(与 `makeGeshan` 的
 * 格扇平面同一套),调用方只负责落位与 z 抬升。
 *
 * - `geo`:顶点位移。材质就是格扇自己的木作材质,合并器把它并进同一个桶——
 *   **draw call 不涨**,只涨三角。
 * - `tex`:一块面片 + 图集。材质全园共享一份,每栋多一个桶。
 */
export function buildTiaohuanRelief(
  mode: TiaohuanMode, lengthM: number, wood: THREE.Material, rotation: number,
  heightM = TIAOHUAN_BAND_H,
): THREE.Mesh {
  const band = tiaohuanBand(lengthM, heightM);
  if (mode === 'geo') {
    const geo = buildReliefBandGeometry(band, TIAOHUAN_STEP, TIAOHUAN_STEP);
    // `buildReliefBandGeometry` 给的是米制 `boxProjectedUV`(台矶那边石作的约定)。
    // 木作不是那套:格扇每块板都是 `roundedBox`,一面一张贴图。换成面片 0..1,
    // 浮雕带上的木纹才与它贴着的那块板同一个尺度。
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, pos.getX(i) / band.lengthM + 0.5, pos.getY(i) / band.heightM + 0.5);
    }
    uv.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, wood);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  const mesh = new THREE.Mesh(buildTiaohuanPlane(band, rotation), tiaohuanTexMaterial());
  mesh.receiveShadow = true;
  return mesh;
}

/** 几何版一扇的三角数(预算与回报用)。 */
export function tiaohuanTriangleCount(lengthM: number, heightM = TIAOHUAN_BAND_H): number {
  return bandTriangleCount(tiaohuanBand(lengthM, heightM), TIAOHUAN_STEP, TIAOHUAN_STEP);
}

/**
 * `?tiaohuan=tex` / `?tiaohuan=geo` 把全园的绦环板一律切到某一版(取证用)。
 * 默认 `null` = 按 `building.ts` 的角色分配表(AS2)走。
 */
export function tiaohuanOverride(): TiaohuanMode | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('tiaohuan');
  return v === 'tex' || v === 'geo' ? v : null;
}
