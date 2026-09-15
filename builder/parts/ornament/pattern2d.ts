/**
 * 二维纹样描述（单子 AO）。
 *
 * **这不是画图,是数据。** 一份纹样只说"主藤走哪儿、多宽,卷叶的轮廓与主脉
 * 在哪儿",不说它最后变成三角面还是变成法线贴图——那是 `relief.ts` 的事。
 * 同一份 `ScrollPattern` 喂两个消费者(近景几何 / 中景贴图),两者才可能在
 * 中景 pixel diff 上对得上;各画各的必然对不上。
 *
 * 目前**只有西番草一种纹样**(`xifancaoUnit`)。`07-76`③ 记「西番草 = 缠枝
 * 卷叶」是二手判断(甲已核其自洽、乙待核),**纹样的"形"本身无出处**——
 * 一段 S 形主藤 + 两片反向卷叶是艺术选择,消费方须记 `provenance.art`。
 *
 * ---
 *
 * ## 坐标与各向异性
 *
 * 纹样单元的定义域是 `[0,1]×[0,1]`,但它贴到的带子是**长条**(样件 0.30m ×
 * 0.11m,`aspect ≈ 2.7`)。若在 uv 空间里画一个圆,落到石头上就是一个沿带
 * 方向拉长 2.7 倍的椭圆——卷叶会变成"压扁的蜗牛"。
 *
 * 所以:**凡是有"形状"的东西(卷叶的卷曲)一律在等比空间 `(u*aspect, v)` 里
 * 生成,最后除以 `aspect` 存回 uv**;凡是"宽度/距离"一律留给 `relief.ts` 在
 * 米制下量(它知道 cellW/cellH)。`aspect` 因此是纹样的一部分,存进结构里,
 * 消费方对不上就抛错,不许默默按方的算。
 */

/** 一片卷叶:封闭轮廓 + 主脉折线。两者都在 uv 单元坐标里。 */
export interface ScrollLeaf {
  /** 封闭轮廓(首尾不重复,消费方自行闭合)。 */
  outline: [number, number][];
  /** 主脉(叶面中线),从叶基到叶尖。 */
  vein: [number, number][];
}

export interface ScrollPattern {
  /** 主藤中线,单位化到一个纹样单元 [0,1]×[0,1]。 */
  spine: [number, number][];
  /** 主藤半宽沿路径变化(t = spine 的归一化下标 i/(n-1)),单位是 v 的份额。 */
  spineWidth: (t: number) => number;
  /** 卷叶(本纹样固定两片,反向)。 */
  leaves: ScrollLeaf[];
  /** 纹样离带边的留白(v 的份额,上下各一份)。 */
  margin: number;
  /** 单元的长宽比 = cellW / cellH。见文件头「坐标与各向异性」。 */
  aspect: number;
  /** 生成本单元的种子(回报与 provenance 用)。 */
  seed: number;
}

/* ------------------------------------------------------------------ */
/* 确定性随机                                                          */
/* ------------------------------------------------------------------ */

/** 整数散列:同 seed 同输出,与 Math.random 无关(判据①要求可复现)。 */
function hash32(seed: number, salt: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2545f491) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

/** [0,1) 的确定性伪随机。 */
function rnd(seed: number, salt: number): number {
  return hash32(seed, salt) / 4294967296;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ------------------------------------------------------------------ */
/* 西番草单元                                                          */
/* ------------------------------------------------------------------ */

/**
 * 主藤基频振幅(v 份额)。**不随 seed 变**——这是单元之间能接上的前提:
 * `sin(2πu)` 在 u=0/1 处值为 0、斜率为 2π·A0,相邻单元只有 A0 相同,主藤
 * 才是一根连续的藤,不是一段一段搭起来的。
 */
const SPINE_A0 = 0.085;

/**
 * seed 控制的二次谐波幅度。基函数取 `sin(4πu) - 2·sin(2πu)`:它在 u=0/1
 * 处**值与斜率都是 0**,所以怎么变都不破坏上面那条接缝条件——这就是
 * "3~4 个不重样的单元"与"主藤连续"能同时成立的办法。
 */
const SPINE_B_MAX = 0.03;

/** 主藤半宽(v 份额)的基准值与起伏。 */
const SPINE_W_BASE = 0.034;
const SPINE_W_SWING = 0.3;

/** 主藤中线采样点数(折线近似;relief 量的是到折线的距离)。 */
const SPINE_STEPS = 64;
/** 单片卷叶的中线采样点数。 */
const LEAF_STEPS = 26;

/** 纹样离带边的留白(v 份额,上下各一份)。 */
const MARGIN = 0.12;

function spineV(u: number, b: number): number {
  return 0.5 + SPINE_A0 * Math.sin(2 * Math.PI * u) + b * (Math.sin(4 * Math.PI * u) - 2 * Math.sin(2 * Math.PI * u));
}

/**
 * 一片卷叶 = **一段对数螺线**。
 *
 * 卷草的叶子不是"一根带子随便卷一下":它有一个**卷心**(eye),叶身绕着卷心
 * 由宽到窄转进去,半径按固定比例收缩。写成极坐标就一行:
 *
 *     r(f) = R0 · (Rend/R0)^f      θ(f) = θ0 + Θ·f
 *
 * 这个写法比"逐步转一点"好在两件事上:
 *   1. **卷心的紧度是直接参数**(Rend/R0),不是步长与转速凑出来的副作用;
 *   2. **相邻两圈的间距可算**——每圈半径乘 q = (Rend/R0)^(2π/Θ),圈间净空
 *      是 (1-q)·r。只要叶宽 2·kw·r 小于它,叶身就**不会自交**。自交是上一版
 *      (逐步转)最终读成"一团肉"的根因:轮廓自己穿过自己,填充算法给出的
 *      是一个实心水滴,卷心不见了。
 *
 * 叶宽正比于半径(`kw·r`):叶基最宽(从藤上长出来的地方),越往卷心越窄,
 * 最后 `taper` 把它收成一个点——「收尖」。
 */
function curledLeaf(
  baseU: number,
  baseV: number,
  toEye: number,
  turn: number,
  r0: number,
  rEnd: number,
  kw: number,
  aspect: number,
): ScrollLeaf {
  // 卷心在叶基的 toEye 方向、距离 r0 处——叶子因此从藤上伸出去约 2·r0。
  const ex = baseU * aspect + Math.cos(toEye) * r0;
  const ey = baseV + Math.sin(toEye) * r0;
  const theta0 = toEye + Math.PI;
  const mid: [number, number][] = [];
  const norm: [number, number][] = [];
  const half: number[] = [];
  for (let k = 0; k <= LEAF_STEPS; k++) {
    const f = k / LEAF_STEPS;
    const r = r0 * Math.pow(rEnd / r0, f);
    const ang = theta0 + turn * f;
    const x = ex + Math.cos(ang) * r;
    const y = ey + Math.sin(ang) * r;
    mid.push([x, y]);
    // 切向:dr/df·u_r + r·dθ/df·u_θ
    const dr = r * Math.log(rEnd / r0);
    const tx = dr * Math.cos(ang) - r * turn * Math.sin(ang);
    const ty = dr * Math.sin(ang) + r * turn * Math.cos(ang);
    const tl = Math.hypot(tx, ty) || 1;
    norm.push([-ty / tl, tx / tl]);
    // 叶基先收一道颈(前 12% 走到满宽):叶子要从藤里长出来,基宽若大过藤宽,
    // 那道横切口就会从藤两侧支棱出来,读成"贴上去的一片"。叶尖侧照旧收尖。
    const neck = Math.min(1, 0.45 + f * 5);
    half.push(kw * r * neck * Math.pow(Math.min(1, (1 - f) * 3.2), 0.7));
  }
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let k = 0; k <= LEAF_STEPS; k++) {
    left.push([mid[k][0] + norm[k][0] * half[k], mid[k][1] + norm[k][1] * half[k]]);
    right.push([mid[k][0] - norm[k][0] * half[k], mid[k][1] - norm[k][1] * half[k]]);
  }
  // 叶基收一个半圆帽:直接拿一条弦封口,在石头上就是一道横切的硬边。
  const cap: [number, number][] = [];
  const bx = mid[0][0];
  const by = mid[0][1];
  const a0 = Math.atan2(right[0][1] - by, right[0][0] - bx);
  const a1 = Math.atan2(left[0][1] - by, left[0][0] - bx);
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  for (let k = 1; k < 6; k++) {
    const a = a0 + (sweep * k) / 6;
    cap.push([bx + Math.cos(a) * half[0], by + Math.sin(a) * half[0]]);
  }
  const outline = left.concat(right.reverse(), cap);
  // 主脉只走叶身前段(到卷心就没有中脉了)——一条贯穿到卷心的槽会把整片叶
  // 剖成两条平行的窄脊,远看是两根线,不是一片叶。
  const veinEnd = Math.round(LEAF_STEPS * 0.45);
  return {
    outline: outline.map(([px, py]) => [px / aspect, py] as [number, number]),
    vein: mid.slice(0, veinEnd + 1).map(([px, py]) => [px / aspect, py] as [number, number]),
  };
}

/**
 * 把一片叶子按基点等比缩小,直到整片落进留白线以内。
 *
 * **不是夹紧坐标**——夹紧会把卷心压成一条直线。等比缩小保形,而且是确定性
 * 的:同 seed 仍然同输出。判据「纹样不越 margin」由这一步保证对**所有**
 * seed 成立,不是靠参数碰巧调对了。
 */
function fitLeafToMargin(leaf: ScrollLeaf, baseU: number, baseV: number, margin: number): ScrollLeaf {
  let s = 1;
  for (const [, v] of leaf.outline) {
    if (v > baseV) s = Math.min(s, (1 - margin - baseV) / (v - baseV));
    else if (v < baseV) s = Math.min(s, (baseV - margin) / (baseV - v));
  }
  s = Math.max(0, Math.min(1, s));
  if (s >= 1) return leaf;
  const shrink = (p: [number, number][]): [number, number][] =>
    p.map(([u, v]) => [baseU + (u - baseU) * s, baseV + (v - baseV) * s] as [number, number]);
  return { outline: shrink(leaf.outline), vein: shrink(leaf.vein) };
}

/**
 * 西番草一个单元 = 一段 S 形主藤 + 两片反向卷叶。
 *
 * @param seed   0..3 各出一个不重样的单元(卷叶开合 + 主藤振幅)。
 * @param aspect 单元的长宽比 cellW/cellH。见文件头。
 */
export function xifancaoUnit(seed: number, aspect: number): ScrollPattern {
  if (!(aspect > 0) || !Number.isFinite(aspect)) throw new Error('纹样单元须给正的长宽比');
  const b = lerp(-SPINE_B_MAX, SPINE_B_MAX, rnd(seed, 1));

  const spine: [number, number][] = [];
  for (let i = 0; i <= SPINE_STEPS; i++) {
    const u = i / SPINE_STEPS;
    spine.push([u, spineV(u, b)]);
  }

  /**
   * 主藤半宽:弯处饱满、拐点处收细。**在 t=0/1(单元接缝)取同一个值**,
   * 相邻单元接得上。缠枝的藤是通的,不收尖——收尖是叶子的事。
   */
  const spineWidth = (t: number): number =>
    SPINE_W_BASE * (1 - SPINE_W_SWING + SPINE_W_SWING * 2 * Math.abs(Math.sin(2 * Math.PI * t)));

  // 两片反向卷叶:一片从上弯的藤背向上卷,一片从下弯的藤腹向下卷。
  const leaves: ScrollLeaf[] = [];
  for (let i = 0; i < 2; i++) {
    const up = i === 0;
    const uBase = up ? 0.25 : 0.75;
    const vBase = spineV(uBase, b);
    // 叶基**埋进藤心**:主藤(4mm)比叶面(2.5mm)高,叶基那道横切口因此
    // 被藤压住看不见——叶子读成"从藤上长出来",而不是一片贴在藤边上的板。
    const vEdge = vBase;
    const dirSign = up ? 1 : -1;
    // 卷心相对叶基的方向:偏向带边、略顺着藤走。
    const toEye = dirSign * lerp(0.34, 0.5, rnd(seed, 50 + i)) * Math.PI;
    // 总转角(卷叶开合):转得多卷心就紧。同时决定圈间净空,见 curledLeaf。
    const turn = dirSign * lerp(1.9, 2.35, rnd(seed, 10 + i)) * Math.PI;
    const r0 = lerp(0.17, 0.205, rnd(seed, 20 + i));
    const leaf = curledLeaf(
      uBase,
      vEdge,
      toEye,
      turn,
      r0,
      r0 * lerp(0.13, 0.18, rnd(seed, 60 + i)),
      lerp(0.36, 0.42, rnd(seed, 30 + i)),
      aspect,
    );
    leaves.push(fitLeafToMargin(leaf, uBase, vEdge, MARGIN));
  }

  return { spine, spineWidth, leaves, margin: MARGIN, aspect, seed };
}

/** 样件用的四个种子。3~4 个不重样的单元,轮着排,不逐格随机。 */
export const XIFANCAO_SEEDS = [0, 1, 2, 3];

/**
 * 纹样的"墨迹"在 v 上的极值(含主藤半宽与叶片),用于判据「不越 margin」。
 * 返回 [vMin, vMax]。
 */
export function patternVExtent(p: ScrollPattern): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < p.spine.length; i++) {
    const t = i / (p.spine.length - 1);
    const hw = p.spineWidth(t);
    lo = Math.min(lo, p.spine[i][1] - hw);
    hi = Math.max(hi, p.spine[i][1] + hw);
  }
  for (const leaf of p.leaves) {
    for (const [, v] of leaf.outline) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return [lo, hi];
}
