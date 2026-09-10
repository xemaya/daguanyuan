/**
 * 举折:屋面曲线的真源。数字全部来自规则表 [04-*]。
 *
 * 举屋之法定脊槫高 H,折屋之法逐缝下折得每一槫的 (x, y)。
 * 坐标系:x 自脊槫心向檐(一侧),y 自橑檐枋背向上;单位与输入一致(分)。
 */
import type { RuleBook } from '../rules';
import { AmbiguousRuleError } from '../errors';

export type RoofClass = '殿阁' | '筒瓦厅堂' | '筒瓦廊屋' | '板瓦厅堂' | '板瓦廊屋';

/** 屋类 → 举高规则号 [04-03..04-06]。 */
const RATIO_RULE: Record<RoofClass, string> = {
  殿阁: '04-03',
  筒瓦厅堂: '04-04',
  筒瓦廊屋: '04-05',
  板瓦厅堂: '04-05',
  板瓦廊屋: '04-06',
};

export function ratioRuleId(cls: RoofClass): string {
  return RATIO_RULE[cls];
}

/**
 * 举高比 H/L [04-03..04-06]。每条都是多口径的存疑条目
 * (法式/唐/辽,或梁思成乘法/陈彤加法),必须在 RuleBook 的 choices 里显式选。
 *
 * 选中的口径若是一个**区间**(如唐构 [0.208, 0.227]),这里不替调用方取中值
 * ——中值没有出处。要单一数值就在 spec 里显式给 ratio,会记进 provenance 的 art。
 */
export function raiseRatio(book: RuleBook, cls: RoofClass): number {
  const id = RATIO_RULE[cls];
  const v = book.choice<number | number[]>(id);
  if (Array.isArray(v)) {
    throw new AmbiguousRuleError(
      id,
      `规则 ${id} 选中的口径给的是区间 [${v.join(', ')}],不是单值。` +
        ` 区间内取哪一点原文无据,在 JuzheSpec.ratio 里显式给,会记进 provenance 的 art 分支。`,
    );
  }
  return v;
}

/** 选中口径给出的区间(唐/辽等实测档),供调用方在区间内取点。 */
export function raiseRatioRange(book: RuleBook, cls: RoofClass): [number, number] | null {
  const v = book.choice<number | number[]>(RATIO_RULE[cls]);
  return Array.isArray(v) ? [v[0], v[v.length - 1]] : null;
}

export interface JuzheSpec {
  /** 前后橑檐枋心距(殿阁)或前后檐柱心距(余屋不出跳)[04-02]。 */
  spanL: number;
  /** 半跨内各架平长,自脊向檐 [04-11];缺省等分。 */
  jiaLengths?: number[];
  /** 半跨椽架数(总椽数/2),jiaLengths 缺省时用。 */
  halfRafters?: number;
  /** 举高比;不给按 raiseRatio(cls)。显式给等于在存疑区间里取点,是艺术决策。 */
  ratio?: number;
  cls?: RoofClass;
}

export interface Purlin {
  /** 离脊槫心的水平距离。 */
  x: number;
  /** 槫背高度(自橑檐枋背)。 */
  y: number;
  name: string;
}

export interface Juzhe {
  H: number;
  ratio: number;
  /** 自脊槫到橑檐枋的槫背坐标 [04-10]。 */
  purlins: Purlin[];
  /** 各架的坡度(dy/dx),自脊向檐。 */
  slopes: number[];
}

const NAMES = ['脊槫', '上平槫', '中平槫', '下平槫'];

function withSlopes(purlins: Purlin[], H: number, ratio: number): Juzhe {
  const slopes: number[] = [];
  for (let i = 1; i < purlins.length; i++) {
    slopes.push((purlins[i - 1].y - purlins[i].y) / (purlins[i].x - purlins[i - 1].x));
  }
  return { H, ratio, purlins, slopes };
}

/** 折屋之法 [04-08][04-10]。 */
export function deriveJuzhe(book: RuleBook, spec: JuzheSpec): Juzhe {
  const half = spec.spanL / 2;
  let a: number[];
  if (spec.jiaLengths) a = spec.jiaLengths.slice();
  else {
    const n = spec.halfRafters ?? 2;
    a = Array.from({ length: n }, () => half / n);
  }
  const sum = a.reduce((p, q) => p + q, 0);
  if (Math.abs(sum - half) > 1e-6 * Math.max(1, half)) {
    // 架道不匀时按比例缩到半跨 [04-09]。
    a = a.map((v) => (v * half) / sum);
  }
  const cls = spec.cls ?? '殿阁';
  const ratio = spec.ratio ?? raiseRatio(book, cls);
  const H = ratio * spec.spanL;

  // [04-08] 第一缝下折 H/10,以下逐缝减半。
  const firstFold = book.num('04-08', 'firstFoldRatio');
  const decay = book.num('04-08', 'foldDecay');

  const purlins: Purlin[] = [{ x: 0, y: H, name: NAMES[0] }];
  let fold = H * firstFold;
  let px = 0;
  let py = H;
  for (let k = 1; k < a.length; k++) {
    const x = px + a[k - 1];
    // 从上一缝已折定点向橑檐枋背拉直线,再下折 fold。
    const y = py + (0 - py) * ((x - px) / (half - px)) - fold;
    purlins.push({ x, y, name: k < NAMES.length ? NAMES[k] : `平槫${k}` });
    px = x;
    py = y;
    fold *= decay;
  }
  purlins.push({ x: half, y: 0, name: '橑檐枋' });
  return withSlopes(purlins, H, ratio);
}

/**
 * 斗尖(攒尖)亭榭 [04-29]:自橑檐枋背至角梁底举 1/5,至上簇角梁举 1/2;
 * 只用板瓦者 4/10。簇角梁三折同折屋之制 [04-08]。
 * @param D 对角方向橑檐枋心距(四角亭 = 边长 × √2)
 * @param upperFrac 上段水平占半跨的比例。原文无定量,是编码假设,调用方给。
 */
export function deriveDoujian(book: RuleBook, D: number, banwa = false, upperFrac = 0.42): Juzhe {
  const half = D / 2;
  const lowerRatio = book.num('04-29', 'lowerRatio');
  const upperRatio = book.num('04-29', 'upperRatio');
  const banwaRatio = book.num('04-29', 'banwaRatio');

  const lower = banwa ? banwaRatio * D : lowerRatio * D;
  const xUpper = half * upperFrac;
  const H = banwa ? lower : lower + xUpper * upperRatio;

  const purlins: Purlin[] = [
    { x: 0, y: H, name: '簇角梁顶' },
    { x: xUpper, y: lower, name: '角梁底' },
    { x: half, y: 0, name: '橑檐枋' },
  ];
  // 三折同折屋之制 [04-08]:在角梁底与檐之间再折一缝。
  const fold = H * book.num('04-08', 'firstFoldRatio');
  purlins.splice(2, 0, { x: (xUpper + half) / 2, y: purlins[1].y / 2 - fold, name: '折缝' });
  return withSlopes(purlins, H, H / D);
}
