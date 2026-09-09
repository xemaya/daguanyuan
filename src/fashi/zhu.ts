/**
 * 柱:径、高、生起、侧脚、阑额、柱础。规则出处见 docs/fashi/03-zhu.md。
 */
import { CAI } from './cai';

export type Hall = '殿阁' | '厅堂' | '余屋';

export interface ZhuSpec {
  hall: Hall;
  /** 间广列表(分),自西向东;长度 = 间数。 */
  bayWidthsFen: number[];
  /**
   * 檐柱高(分)。原文只给"不越间之广"[03-03][03-24];
   * 缺省取当心间广 × 0.85(实例比值 0.72~1.0 的中值)。
   */
  columnHeightFen?: number;
  /** 柱径(分),缺省按屋类 [03-01];唐构实物≈2 材(29 分)可覆盖。 */
  columnDiameterFen?: number;
  /** 角柱生起(寸),缺省按间数表 [03-04];唐构可给 0。 */
  cornerRiseCun?: number;
  /** 每分寸数,用于把寸制的生起换成分。 */
  fenCun: number;
  /** 侧脚:宋式 true(正面 1/100、侧面 8/1000)[03-08][03-09];唐构 false。 */
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

export function deriveZhu(spec: ZhuSpec): Zhu {
  const bays = spec.bayWidthsFen.length;
  if (bays < 1) throw new Error('至少一间');
  const centerIdx = Math.floor(bays / 2);
  const centerW = spec.bayWidthsFen[centerIdx];

  // [03-03][03-24] 檐柱高 ≤ 当心间广。
  const H = Math.min(spec.columnHeightFen ?? centerW * 0.85, centerW);

  // [03-01] 殿阁 42~45 / 厅堂 36 / 余屋 21~30(分);唐构实物≈29。
  const D =
    spec.columnDiameterFen ??
    (spec.hall === '殿阁' ? 2 * CAI.guang + 2 * CAI.qiGuang : spec.hall === '厅堂' ? 2 * CAI.guang + CAI.qiGuang : 2 * CAI.guang);

  // [03-04] 三间 2 寸 … 十三间 1 尺 2 寸 → (n-1) 寸;偶数间取邻档。
  const riseCun = spec.cornerRiseCun ?? Math.max(0, bays - 1);
  const riseCornerFen = riseCun / spec.fenCun;

  // 柱位 x 与生起:[03-05] 自平柱向角逐间递增、势圜和;按间广线性分配是编码假设。
  const xFen: number[] = [0];
  for (const w of spec.bayWidthsFen) xFen.push(xFen[xFen.length - 1] + w);
  const total = xFen[xFen.length - 1];
  const mid = total / 2;
  // "平柱谓当心间两柱也":当心间两柱为 0,从它们向角起算。
  const inner = bays % 2 === 1 ? centerW / 2 : 0;
  const half = Math.max(1e-6, mid - inner);
  const riseFen = xFen.map((x) => {
    const t = Math.min(1, Math.max(0, Math.abs(x - mid) - inner) / half); // 0 在平柱,1 在角
    // 平柱(当心间两柱)为 0,再向角按 smooth 递增,"令势圜和"。
    const s = t * t * (3 - 2 * t);
    return riseCornerFen * s;
  });

  const cejiao = spec.cejiao ?? true;
  return {
    columnHeightFen: H,
    columnDiameterFen: D,
    riseFen,
    xFen,
    cejiaoFront: cejiao ? H * 0.01 : 0,
    cejiaoSide: cejiao ? H * 0.008 : 0,
    lan: { w: 2 * CAI.guang, t: (2 * CAI.guang * 2) / 3 },
    baseFen: 2 * D,
  };
}
