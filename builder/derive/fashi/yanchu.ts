/**
 * 出檐与翼角。规则出处见 docs/fashi/05-yanchu.md。
 * 本章实测最薄:檐出/飞子/生出是硬约束,起翘是自由参数。
 */

export interface YanchuSpec {
  /** 椽径(分)[05-02]:殿阁 9~10,厅堂 7~8,余屋 6~7。 */
  rafterDiaFen: number;
  /** 每分寸数(把寸制条文换成分)。 */
  fenCun: number;
  /** 面阔间数,决定生出 [05-08]。 */
  bays: number;
  /** 飞子 [05-05],默认有。 */
  feizi?: boolean;
  /** 起翘(分),原文无定量 [05-13 存疑];缺省 0,江南由 fayuan 给。 */
  qiqiaoFen?: number;
  /** 歇山:角梁转过椽数 [05-11],厅堂 2、亭榭 1。 */
  xieshanTurn?: 1 | 2;
}

export interface Yanchu {
  /** 椽头出(分),自橑檐枋心 [05-04]。 */
  chuanFen: number;
  /** 飞子出(分)[05-05]。 */
  feiFen: number;
  /** 总檐出(分)。 */
  totalFen: number;
  /** 生出(分)[05-08]:角部檐口平面外推量。 */
  shengchuFen: number;
  /** 起翘(分)。 */
  qiqiaoFen: number;
  /** 角梁斜长系数 [05-10]。 */
  diag: number;
  /** 大角梁 广×厚(分)[05-09]。 */
  jiaoliang: { b: number; t: number };
  /** 飞子 广×厚(分)[05-06]。 */
  feizi: { b: number; t: number };
  xieshanTurn: 1 | 2;
  /** 椽间距(分),≈2×椽径 [05-03 近似]。 */
  rafterPitchFen: number;
}

export function deriveYanchu(spec: YanchuSpec): Yanchu {
  const d = spec.rafterDiaFen;
  const dCun = d * spec.fenCun;
  // [05-04] 椽径 3 寸→檐出 35 寸;5 寸→40~45 寸;其间内插(取中值 42.5)。
  const t = Math.min(1, Math.max(0, (dCun - 3) / 2));
  const chuanCun = 35 + t * (42.5 - 35);
  const chuanFen = chuanCun / spec.fenCun;
  const feiFen = spec.feizi === false ? 0 : chuanFen * 0.6; // [05-05]
  // [05-08] 一间 4 寸,三间 5 寸,五间 7 寸,以上随宜(每两间 +1 寸)。
  const b = spec.bays;
  const shengchuCun = b <= 1 ? 4 : b <= 3 ? 5 : b <= 5 ? 7 : 7 + Math.floor((b - 5) / 2);
  return {
    chuanFen,
    feiFen,
    totalFen: chuanFen + feiFen,
    shengchuFen: shengchuCun / spec.fenCun,
    qiqiaoFen: spec.qiqiaoFen ?? 0,
    diag: Math.SQRT2,
    jiaoliang: { b: 29, t: 19 },
    feizi: { b: 0.8 * d, t: 0.7 * d },
    xieshanTurn: spec.xieshanTurn ?? 2,
    rafterPitchFen: 2 * d,
  };
}
