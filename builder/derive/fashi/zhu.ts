/**
 * 柱:径、高、生起、侧脚、阑额、柱础。数字全部来自规则表 [03-*]。
 */
import type { RuleBook } from '../rules';

export type Hall = '殿阁' | '厅堂' | '余屋';

export interface ZhuSpec {
  hall: Hall;
  /** 间广列表(分),自西向东;长度 = 间数。 */
  bayWidthsFen: number[];
  /**
   * 檐柱高(分)。原文只给"不越间之广"[03-03][03-24];
   * 不给就按 [03-24] 的典型复原值与"不越当心间广"取小。
   */
  columnHeightFen?: number;
  /** 柱径(分)。不给按屋类 [03-01];唐构实物≈2 材(29 分)可覆盖。 */
  columnDiameterFen?: number;
  /** 角柱生起(寸)。不给按间数 [03-04];唐构可给 0。 */
  cornerRiseCun?: number;
  /** 每分寸数,用于把寸制的生起换成分。 */
  fenCun: number;
  /** 侧脚:宋式 true [03-08][03-09];唐构 false。 */
  cejiao?: boolean;
}

export interface Zhu {
  columnHeightFen: number;
  columnDiameterFen: number;
  /** 各柱位(从西到东,长度 = 间数 + 1)的生起(分)[03-04][03-05]。 */
  riseFen: number[];
  /** 各柱位离西端的 x(分)。 */
  xFen: number[];
  /** 侧脚:柱首向内偏移量(分),正面/侧面 [03-08][03-09]。 */
  cejiaoFront: number;
  cejiaoSide: number;
  /** 阑额 广×厚(分)[03-13]。 */
  lan: { w: number; t: number };
  /** 柱础方(分)[03-21]。 */
  baseFen: number;
}

/**
 * [03-01] 殿阁 42~45 / 厅堂 36 / 余屋 21~30(分)。
 * 殿阁与余屋是区间,取哪一点原文无据,走 pickInRange 留痕。
 * 乙注:唐构佛光寺实测柱径≈29 分,只到区间下限的 65%——所以取下限。
 */
function defaultDiameterFen(book: RuleBook, hall: Hall): number {
  if (hall === '厅堂') return book.num('03-01', 'tingtangFen');
  return book.pickInRange('03-01', hall === '殿阁' ? 'diangeFen' : 'yuwuFen', 'lo');
}

export function deriveZhu(book: RuleBook, spec: ZhuSpec): Zhu {
  const bays = spec.bayWidthsFen.length;
  if (bays < 1) throw new Error('至少一间');
  const centerIdx = Math.floor(bays / 2);
  const centerW = spec.bayWidthsFen[centerIdx];

  // [03-03][03-24] 檐柱高 ≤ 当心间广。
  // 条文只给上界"不越间之广"与一个典型复原值 375 分,没给"该取多少"。
  // 不给就贴着上界走,这是我们的决定,记进 art。
  const maxRatio = book.num('03-24', 'maxRatioToCenterBay');
  const bound = centerW * maxRatio;
  const H =
    spec.columnHeightFen !== undefined
      ? Math.min(spec.columnHeightFen, bound)
      : book.artChoice('03-24', `条文只给上界"檐柱高不越当心间广";未指定时贴上界取 ${bound.toFixed(1)} 分`, Math.min(book.num('03-24', 'typicalHFen'), bound));

  const D = spec.columnDiameterFen ?? defaultDiameterFen(book, spec.hall);

  // [03-04] 三间 2 寸 … 十三间 1 尺 2 寸 → (n − 1) 寸。
  const riseCun =
    spec.cornerRiseCun ??
    Math.max(0, (bays - book.num('03-04', 'baseBays')) * book.num('03-04', 'riseCunPerBay'));
  const riseCornerFen = riseCun / spec.fenCun;

  // 柱位 x 与生起:[03-05] 自平柱向角逐间递增、势圜和;按间广平滑分配是编码假设。
  const xFen: number[] = [0];
  for (const w of spec.bayWidthsFen) xFen.push(xFen[xFen.length - 1] + w);
  const total = xFen[xFen.length - 1];
  const mid = total / 2;
  // "平柱谓当心间两柱也":当心间两柱为 0,从它们向角起算。
  const inner = bays % 2 === 1 ? centerW / 2 : 0;
  const half = Math.max(1e-6, mid - inner);
  const riseFen = xFen.map((x) => {
    const t = Math.min(1, Math.max(0, Math.abs(x - mid) - inner) / half); // 0 在平柱,1 在角
    const s = t * t * (3 - 2 * t); // smoothstep:"令势圜和"
    return riseCornerFen * s;
  });

  const cejiao = spec.cejiao ?? true;
  const lanW = book.num('03-13', 'lanGuangFen');
  return {
    columnHeightFen: H,
    columnDiameterFen: D,
    riseFen,
    xFen,
    cejiaoFront: cejiao ? H * book.num('03-08', 'rateFront') : 0,
    cejiaoSide: cejiao ? H * book.num('03-09', 'rateSide') : 0,
    // [03-13] 阑额广 30 分厚 20 分;[03-14] 无补间铺作时厚取广之半。
    lan: { w: lanW, t: book.num('03-13', 'lanHouFen') },
    baseFen: book.num('03-21', 'baseToDiaRatio') * D,
  };
}
