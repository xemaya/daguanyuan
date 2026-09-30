import * as THREE from 'three';
import { bakeNormalMap, bakeScalarMap, cached, recipeKey } from '@engine/core/TextureLab';
import { boxProjectedUV } from '@builder/parts/sculpt';
import { xifancaoUnit, type ScrollPattern } from '@builder/parts/ornament/pattern2d';

/**
 * 纹样 → 高度场 h(u,v) → 两个消费者(单子 AO)。
 *
 * **一份 h,两种输出。** 近景把 h 变成顶点位移(真几何),中景把同一个 h 烤成
 * 法线贴图 + 凹槽遮蔽贴到一块平面片上。两者共用 `bandHeight()` 这一个函数,
 * 中景 pixel diff 才有意义——各算各的高度场,差出来的数说明不了任何事。
 *
 * ---
 *
 * ## 「粘上去」与「刻出来」的分界
 *
 * 旧做法(`forecourt-terrace.ts` 的 `ridgeTube`)是沿卷草中线拉一根 6 段圆管,
 * 半径几毫米、整根凸在石面外 15mm——截面是圆的、边缘是断的,所以读成**一根
 * 粘在台矶上的铁丝**(台账 `C4`)。本文件的三条对症:
 *
 *   1. **截面是圆凸,不是圆管**——中间高、边上低,落到石面为止,背面没有"管壁";
 *   2. **分区高低**——主藤 4mm 最高、叶面 2.5mm 次之、石面 0,不是一根等粗的线;
 *   3. **边缘 2~3mm 缓缓落回石面**——`edgeSoft` 那一段。这一条是分界本身:
 *      硬边就是贴片,软边才是凿出来的。
 *
 * ## 各向异性
 *
 * 带子是长条(样件 0.30m × 0.11m 一个单元),纹样定义域是方的 [0,1]²。**所有
 * 距离一律在米制下量**(`toMetric` 把 uv 折成米),不许在 uv 空间里量距离——
 * 否则主藤沿带方向会比横向宽 2.7 倍。
 */

/* ------------------------------------------------------------------ */
/* 分层高度(无出处,艺术选择——消费方记 provenance.art)                 */
/* ------------------------------------------------------------------ */

export interface ReliefLevels {
  /** 主藤峰高(米)。 */
  spineH: number;
  /** 叶面高(米)。 */
  leafH: number;
  /** 主脉浅槽深(米,从叶面往下挖)。 */
  veinDepth: number;
  /** 主脉浅槽半宽(米)。 */
  veinHalfW: number;
  /** 边缘软过渡带宽(米)——「缓缓落回石面」的那一段。 */
  edgeSoft: number;
}

export const XIFANCAO_LEVELS: ReliefLevels = {
  spineH: 0.004,
  leafH: 0.0025,
  veinDepth: 0.0008,
  veinHalfW: 0.0013,
  edgeSoft: 0.002,
};

/* ------------------------------------------------------------------ */
/* 米制纹样(把 uv 折成米,并预算包围盒)                                */
/* ------------------------------------------------------------------ */

interface MetricLeaf {
  outline: number[];
  vein: number[];
  box: [number, number, number, number];
}

interface MetricPattern {
  spineX: Float64Array;
  spineY: Float64Array;
  spineHalfW: Float64Array;
  spineBox: [number, number, number, number];
  leaves: MetricLeaf[];
}

function bboxOf(pts: number[], pad: number): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

function toMetric(p: ScrollPattern, cellW: number, cellH: number, levels: ReliefLevels): MetricPattern {
  const n = p.spine.length;
  const spineX = new Float64Array(n);
  const spineY = new Float64Array(n);
  const spineHalfW = new Float64Array(n);
  const flat: number[] = [];
  let maxW = 0;
  for (let i = 0; i < n; i++) {
    spineX[i] = p.spine[i][0] * cellW;
    spineY[i] = p.spine[i][1] * cellH;
    spineHalfW[i] = p.spineWidth(i / (n - 1)) * cellH;
    maxW = Math.max(maxW, spineHalfW[i]);
    flat.push(spineX[i], spineY[i]);
  }
  const leaves = p.leaves.map((leaf) => {
    const outline: number[] = [];
    for (const [u, v] of leaf.outline) outline.push(u * cellW, v * cellH);
    const vein: number[] = [];
    for (const [u, v] of leaf.vein) vein.push(u * cellW, v * cellH);
    return { outline, vein, box: bboxOf(outline, levels.edgeSoft) };
  });
  return { spineX, spineY, spineHalfW, spineBox: bboxOf(flat, maxW + levels.edgeSoft), leaves };
}

/* ------------------------------------------------------------------ */
/* 几何谓词                                                            */
/* ------------------------------------------------------------------ */

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

function polylineDist(px: number, py: number, pts: number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const d = segDist2(px, py, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * 闭合多边形的内外判定——**非零环绕数**,不是奇偶射线法。
 *
 * 卷叶是一条带子卷起来的,叶尖压在叶身上,轮廓**会自交**。奇偶法在自交
 * 的重叠区判为"外",于是叶子上出现菱形的洞与硬边(2026-09-15 调形时看到
 * 的那几块三角飞边)。环绕数把绕两圈的地方仍然判为内,自交就不再是洞,
 * 只在叶缘留一道压痕——那正是一片叶子卷过自己该有的样子。
 */
function inPolygon(px: number, py: number, pts: number[]): boolean {
  let wind = 0;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xj = pts[j * 2];
    const yj = pts[j * 2 + 1];
    const xi = pts[i * 2];
    const yi = pts[i * 2 + 1];
    if (yj <= py) {
      if (yi > py && (xi - xj) * (py - yj) - (px - xj) * (yi - yj) > 0) wind++;
    } else if (yi <= py && (xi - xj) * (py - yj) - (px - xj) * (yi - yj) < 0) wind--;
  }
  return wind !== 0;
}

/** 闭合多边形的距离(边界上为 0),含闭合边。 */
function polygonDist(px: number, py: number, pts: number[]): number {
  let best = Infinity;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = segDist2(px, py, pts[j * 2], pts[j * 2 + 1], pts[i * 2], pts[i * 2 + 1]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 首尾斜率都为 0 的过渡——「缓缓落回石面」靠的就是它,不是线性插值。 */
function smootherstep(x: number): number {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/* ------------------------------------------------------------------ */
/* 单元高度                                                            */
/* ------------------------------------------------------------------ */

/**
 * 一个纹样单元在局部米制坐标 (x,y) 处的高度(米)。
 * x∈[0,cellW] 为沿带方向(可越界,由调用方喂邻格的偏移),y∈[0,cellH] 为横向。
 */
function cellHeight(mp: MetricPattern, x: number, y: number, levels: ReliefLevels): number {
  let h = 0;

  // ① 主藤:圆凸截面。R = 半宽 + 软边,中间高边上低,到 R 处斜率归零。
  const sb = mp.spineBox;
  if (x >= sb[0] && x <= sb[2] && y >= sb[1] && y <= sb[3]) {
    let best = Infinity;
    let bestI = 0;
    let bestT = 0;
    for (let i = 0; i + 1 < mp.spineX.length; i++) {
      const d = segDist2(x, y, mp.spineX[i], mp.spineY[i], mp.spineX[i + 1], mp.spineY[i + 1]);
      if (d < best) {
        best = d;
        bestI = i;
        const dx = mp.spineX[i + 1] - mp.spineX[i];
        const dy = mp.spineY[i + 1] - mp.spineY[i];
        const len2 = dx * dx + dy * dy;
        bestT = len2 > 0 ? clamp01(((x - mp.spineX[i]) * dx + (y - mp.spineY[i]) * dy) / len2) : 0;
      }
    }
    const d = Math.sqrt(best);
    const hw = mp.spineHalfW[bestI] + (mp.spineHalfW[bestI + 1] - mp.spineHalfW[bestI]) * bestT;
    const R = hw + levels.edgeSoft;
    if (d < R) {
      const skirt = smootherstep((R - d) / levels.edgeSoft);
      const dome = Math.sqrt(Math.max(0, 1 - (d / R) * (d / R)));
      h = Math.max(h, levels.spineH * skirt * (0.45 + 0.55 * dome));
    }
  }

  // ② 卷叶:叶面 + 沿主脉一道浅槽。软过渡骑在轮廓线上(内外各一半)。
  for (const leaf of mp.leaves) {
    const lb = leaf.box;
    if (x < lb[0] || x > lb[2] || y < lb[1] || y > lb[3]) continue;
    const dist = polygonDist(x, y, leaf.outline);
    const s = inPolygon(x, y, leaf.outline) ? dist : -dist;
    // 软过渡整段落在轮廓**外面**:叶面在轮廓线上就是满高,出了线才用 2mm
    // 倒圆落回石面。骑在轮廓上(内外各一半)的做法在窄处(卷心附近叶宽只有
    // 几毫米)会把整片叶子吃成一条刻线——那正是 2026-09-15 第一版的病。
    const mask = smootherstep((s + levels.edgeSoft) / levels.edgeSoft);
    if (mask <= 0) continue;
    const crown = 0.86 + 0.14 * clamp01(s / (3 * levels.edgeSoft));
    const groove = levels.veinDepth * (1 - smootherstep(polylineDist(x, y, leaf.vein) / levels.veinHalfW));
    h = Math.max(h, levels.leafH * mask * crown - groove * mask);
  }

  return h;
}

/* ------------------------------------------------------------------ */
/* 带子                                                                */
/* ------------------------------------------------------------------ */

export interface ReliefBand {
  /** 带长(米,沿墙面)。 */
  lengthM: number;
  /** 带高(米,横向)。 */
  heightM: number;
  /** 一个纹样单元的长度(米)。 */
  cellW: number;
  /** 逐格的纹样(长度 = lengthM / cellW)。 */
  cells: MetricPattern[];
  /** 逐格用的种子,进 provenance 与回报。 */
  seeds: number[];
  levels: ReliefLevels;
  /** 两端淡出长度(米)——样件只换一段,两头要能落回石面。 */
  endFadeM: number;
  /** 纹样单元的长宽比(见 `ScrollBandOptions.aspect`)。进烘焙键。 */
  aspect: number;
  /**
   * 首尾相接(单子 AS 加的参数,默认 `false` = 台矶样件的原行为)。
   *
   * 开了之后 `bandHeight` 算邻格时把下标环起来:第 0 格的左邻是最后一格、
   * 最后一格的右邻是第 0 格。**这是「一张图铺一条带」的前提**——绦环板的
   * 贴图版只烤四格的图集、靠 uv 重复铺满整扇,若两端各自截断,每四格就有
   * 一道竖缝,而且是有规律地重复出现,比单独一道缝更刺眼。
   */
  cyclic: boolean;
}

/**
 * 铺一条西番草带:按 `seeds` 轮着取单元,长度必须是单元长的整数倍。
 * 不整除就抛错——半个单元的接缝在石头上是读得出来的,不许静默取整。
 */
export interface ScrollBandOptions {
  /** 首尾相接(见 `ReliefBand.cyclic`)。默认 false。 */
  cyclic?: boolean;
  /**
   * 覆盖纹样的长宽比。默认 `cellW / heightM`,即"纹样按本带的真实单元比例生成"。
   *
   * 绦环板要覆盖它(单子 AS):全园格扇净宽 0.47~0.77m,各自求整得到的单元长
   * 在 0.156~0.194m 之间飘。若每扇都按自己的比例生成纹样,**每扇的叶形都不
   * 一样**,那张四格图集就只对某一种宽度成立。锁成同一个标称比例后,各扇之间
   * 只差一个整体拉伸——几何版与贴图版拉伸得一模一样,中景 pixel diff 才量的是
   * "位移 vs 法线",不是"两片形状不同的叶子"。
   */
  aspect?: number;
}

export function makeScrollBand(
  lengthM: number,
  heightM: number,
  cellW: number,
  seeds: number[],
  levels: ReliefLevels = XIFANCAO_LEVELS,
  endFadeM = 0.05,
  opts: ScrollBandOptions = {},
): ReliefBand {
  const n = Math.round(lengthM / cellW);
  if (n < 1 || Math.abs(n * cellW - lengthM) > 1e-6) {
    throw new Error(`卷草带长 ${lengthM}m 不是单元长 ${cellW}m 的整数倍`);
  }
  const aspect = opts.aspect ?? cellW / heightM;
  const used: number[] = [];
  const cells: MetricPattern[] = [];
  for (let i = 0; i < n; i++) {
    const seed = seeds[i % seeds.length];
    used.push(seed);
    cells.push(toMetric(xifancaoUnit(seed, aspect), cellW, heightM, levels));
  }
  return { lengthM, heightM, cellW, cells, seeds: used, levels, endFadeM, aspect, cyclic: opts.cyclic ?? false };
}

/**
 * 带子上一点的高度(米)。
 *
 * @param x 沿带,0..lengthM
 * @param y 横向,-heightM/2 .. +heightM/2(带中线为 0)
 *
 * 邻格一起算:卷叶的轮廓允许越出自己那一格(缠枝本来就压着接缝长),
 * 只算本格会在每个单元边界上切一刀。
 */
export function bandHeight(band: ReliefBand, x: number, y: number): number {
  const yb = y + band.heightM / 2;
  const i0 = Math.floor(x / band.cellW);
  const n = band.cells.length;
  let h = 0;
  for (let k = -1; k <= 1; k++) {
    const i = i0 + k;
    // 环起来的是**取哪一格的纹样**,不是**在哪儿求值**:偏移一律按未环绕的
    // i 算,邻格越界长出来的那半片叶子才落在接缝的正确一侧。
    const cell = band.cyclic ? band.cells[((i % n) + n) % n] : (i < 0 || i >= n ? null : band.cells[i]);
    if (!cell) continue;
    h = Math.max(h, cellHeight(cell, x - i * band.cellW, yb, band.levels));
  }
  if (h <= 0) return 0;
  // 两端缓缓落回石面:样件是一段,不是一圈,两头不能是断口。
  const fade = band.endFadeM > 0
    ? smootherstep(x / band.endFadeM) * smootherstep((band.lengthM - x) / band.endFadeM)
    : 1;
  return h * fade;
}

/* ------------------------------------------------------------------ */
/* 消费者①:近景几何                                                   */
/* ------------------------------------------------------------------ */

/**
 * 带状网格,顶点沿法线(+Z)位移 h。
 *
 * 局部坐标:x∈[-L/2,L/2] 沿带,y∈[-H/2,H/2] 横向,+Z 朝外。
 * **两长边的高度钉 0**——带边必须落在石面上,不许浮起(判据③)。
 * UV 走 `boxProjectedUV`(米制),与台矶其余石作同一套约定,合并后共用白石贴图。
 */
export function buildReliefBandGeometry(band: ReliefBand, alongStep: number, acrossStep: number): THREE.BufferGeometry {
  const cols = Math.max(2, Math.round(band.lengthM / alongStep));
  const rows = Math.max(2, Math.round(band.heightM / acrossStep));
  const pos = new Float32Array((cols + 1) * (rows + 1) * 3);
  let p = 0;
  for (let j = 0; j <= rows; j++) {
    const y = (j / rows) * band.heightM - band.heightM / 2;
    const edge = j === 0 || j === rows;
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * band.lengthM;
      pos[p++] = x - band.lengthM / 2;
      pos[p++] = y;
      pos[p++] = edge ? 0 : bandHeight(band, x, y);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      // 绕序必须让面法线朝 +Z(朝外)。反了整条带会被背面剔除——
      // 2026-09-15 第一版就是这样:顶点、三角数、包围盒全对,画面上什么都没有,
      // 查了三轮才发现。判据里那条"法线全部朝外"就是为这件事立的。
      index.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.setAttribute('uv', boxProjectedUV(geo));
  return geo;
}

/* ------------------------------------------------------------------ */
/* 消费者②:中景贴图                                                   */
/* ------------------------------------------------------------------ */

export interface ReliefMaps {
  normalMap: THREE.Texture;
  /** 凹槽遮蔽(灰度):槽底暗、石面亮。 */
  aoMap: THREE.Texture;
  /**
   * 法线的各向异性补偿。整条带(L×H)烤进一张方图,一个纹素在沿带方向代表
   * L/size 米、横向代表 H/size 米——Sobel 分不出这件事,算出来的 nx/ny 之比
   * 错了 L/H 倍。`normalScale` 是唯一能事后纠正这个比例的钮,贴图的消费方
   * 必须原样用上,不许自己拍一个 (1,1)。
   */
  normalScale: [number, number];
}

/**
 * 把同一个 `bandHeight` 烤成法线 + 凹槽遮蔽。
 *
 * 先把 h 采成一张 `size²` 的 LUT,法线与遮蔽都读它——采两遍会让两张图
 * 出自两次求值,以后谁改了 h 只改到一张,是个会静默漂的口子。
 */
export function bakeReliefBandMaps(band: ReliefBand, size: number, strength = 1.6): ReliefMaps {
  /**
   * 键必须把**所有会改像素的输入**叠进来(`TextureLab` 的 `cached` 只比字符串)。
   * 单子 AO 落地时只有台矶样件一个消费者,尺寸就够分;单子 AS 加了绦环板,它
   * 用的是抬过叶高的 `levels`、锁死的纹样比例、首尾相接的铺法——三件都不在
   * 尺寸里。哪天谁做一条与样件同尺寸的带,静默拿到的就是样件那张图。
   * **像素不变,只是键变长了一次**(记忆化是运行期的,busts 一次没有代价)。
   */
  const lv = band.levels;
  const key = `${band.lengthM}x${band.heightM}@${band.cellW}@${band.seeds.join('-')}`
    + `@${lv.spineH}-${lv.leafH}-${lv.veinDepth}-${lv.veinHalfW}-${lv.edgeSoft}`
    + `@${band.endFadeM}@${band.aspect}${band.cyclic ? '@cyc' : ''}`;
  const peak = band.levels.spineH; // h 的上界就是主藤峰高,不用量——量出来的峰值会随采样分辨率漂
  // LUT 是懒的:两张图都命中 cache 时(热重载、第二次进园)一格都不采。
  let lut: Float32Array | null = null;
  const fill = (): Float32Array => {
    if (lut) return lut;
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const by = ((y + 0.5) / size - 0.5) * band.heightM;
      for (let x = 0; x < size; x++) {
        out[y * size + x] = bandHeight(band, ((x + 0.5) / size) * band.lengthM, by) / peak;
      }
    }
    lut = out;
    return out;
  };
  const at = (u: number, v: number): number => {
    const g = fill();
    const x = Math.min(size - 1, Math.max(0, Math.floor(u * size)));
    const y = Math.min(size - 1, Math.max(0, Math.floor(v * size)));
    return g[y * size + x];
  };
  const normalMap = cached(recipeKey(`cn.xifancao.normal.${key}`, size, strength), () =>
    bakeNormalMap({ size, height: at }, strength),
  );
  /**
   * 凹槽遮蔽:比邻域最高点低多少就暗多少。
   *
   * 强度刻意压到 0.18——几何版在引擎里吃到的是半径 0.42m 的 GTAO,对一条
   * 4mm 深的槽几乎不产生压暗;贴图版若按"看起来像 AO"的直觉给 0.5,中景
   * 两版并排就是"一条浅浮雕"对"一条墨线"。这张图要对齐的是几何版的实际
   * 观感,不是某种理想的环境光遮蔽。
   */
  const aoMap = cached(recipeKey(`cn.xifancao.ao.${key}`, size), () =>
    bakeScalarMap(size, (u, v) => {
      const h = at(u, v);
      let hi = h;
      const r = 3 / size;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        hi = Math.max(hi, at(u + Math.cos(a) * r, v + Math.sin(a) * r));
      }
      return clamp01(1 - 0.18 * (hi - h));
    }),
  );
  for (const t of [normalMap, aoMap]) {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    // 整条带只烤一张、不平铺,v 的朝向就有意义了:flipY 默认 true 会把带子
    // 上下翻过来(纹样不是上下对称的),法线的 y 分量也跟着反号,浮雕会读成
    // 凹槽。TextureLab 其余调用方烤的都是各向同性噪声,从来没碰上这条。
    t.flipY = false;
    t.needsUpdate = true;
  }
  /**
   * `normalScale` 的推导(不是调出来的):
   *
   * Sobel 在纹素空间算,一个纹素在 u 上代表 `lengthM/size` 米、在 v 上代表
   * `heightM/size` 米。它给出的 nx/nz ≈ -8·strength·(∂hN/∂u)/size,而真实
   * 切空间法线要的是 -∂h_米/∂x = -peak·(∂hN/∂u)/lengthM。两者之比就是
   *
   *     k = peak·size / (lengthM · 8 · strength)
   *
   * y 方向同理,只是把 lengthM 换成 heightM,所以 ky = k·lengthM/heightM。
   */
  const k = (peak * size) / (band.lengthM * 8 * strength);
  return { normalMap, aoMap, normalScale: [k, (k * band.lengthM) / band.heightM] };
}

/** 贴图版的面片:一块平的带状面,uv 铺满整张贴图。 */
export function buildReliefBandPlane(band: ReliefBand): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(band.lengthM, band.heightM, 1, 1);
}

/** 几何版的三角数(回报与预算用)。 */
export function bandTriangleCount(band: ReliefBand, alongStep: number, acrossStep: number): number {
  const cols = Math.max(2, Math.round(band.lengthM / alongStep));
  const rows = Math.max(2, Math.round(band.heightM / acrossStep));
  return cols * rows * 2;
}
