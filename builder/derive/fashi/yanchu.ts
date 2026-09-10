/**
 * 出檐与翼角。数字全部来自规则表 [05-*]。
 * 本章实测最薄:檐出/飞子/生出是硬约束,起翘是自由参数 [05-13]。
 */
import type { RuleBook } from '../rules';

export interface YanchuSpec {
  /** 椽径(分)[05-02]:殿阁 9~10,厅堂 7~8,余屋 6~7。 */
  rafterDiaFen: number;
  /** 每分寸数(把寸制条文换成分)。 */
  fenCun: number;
  /** 面阔间数,决定生出 [05-08]。 */
  bays: number;
  /** 飞子 [05-05],默认有。 */
  feizi?: boolean;
  /**
   * 起翘(分)。**原文无定量** [05-13]:两名核验者一致认为原推算内部自相矛盾,
   * 可编码的只有两个几何约束(生头木顶 ≤ 角梁背;椽头背 = 角梁头背 − 1 椽径)。
   * 所以这是艺术参数,不给就是不起翘。
   */
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
  /** 起翘(分)[05-13,艺术参数]。 */
  qiqiaoFen: number;
  /** 角梁斜长系数 [05-10]。 */
  diag: number;
  /** 大角梁 广×厚(分)[05-09]。 */
  jiaoliang: { b: number; t: number };
  /** 飞子 广×厚(分)[05-06]。 */
  feizi: { b: number; t: number };
  xieshanTurn: 1 | 2;
  /** 椽间距(分)[05-03]。 */
  rafterPitchFen: number;
}

/** [05-02] 椽径按屋类,三档都是区间,取下限并留痕。 */
export function defaultRafterDiaFen(book: RuleBook, hall: '殿阁' | '厅堂' | '余屋'): number {
  const key = hall === '殿阁' ? 'diangeFen' : hall === '厅堂' ? 'tingtangFen' : 'yuwuFen';
  return book.pickInRange('05-02', key, 'lo');
}

/** [05-08] 一间 4 寸,三间 5 寸,五间 7 寸,以上随宜(每两间 +1 寸,编码假设)。 */
function shengchuCun(book: RuleBook, bays: number): number {
  const t = book.param('05-08', 'shengchuCun') as Record<string, number>;
  const keys = Object.keys(t)
    .map(Number)
    .sort((a, b) => a - b);
  let hit = t[String(keys[0])];
  for (const k of keys) if (bays >= k) hit = t[String(k)];
  const top = keys[keys.length - 1];
  return bays <= top ? hit : hit + Math.floor((bays - top) / 2);
}

export function deriveYanchu(book: RuleBook, spec: YanchuSpec): Yanchu {
  const d = spec.rafterDiaFen;
  const dCun = d * spec.fenCun;

  // [05-04] 椽径 3 寸 → 檐出 35 寸;5 寸 → 40~45 寸;其间内插。
  // 上档 40~45 是区间,取中值是编码假设,已在 05-04 的 notes 注明。
  const baseCun = book.num('05-04', 'baseCun');
  const dLo = book.num('05-04', 'dCunLo');
  const dHi = book.num('05-04', 'dCunHi');
  // 上档"40~45 寸"是区间,取中值是我们的决定,留痕。
  const addLo = book.num('05-04', 'addCunLo');
  const addHi = book.num('05-04', 'addCunHi');
  const add = book.artChoice('05-04', `椽径 ${dHi} 寸时檐出加 ${addLo}~${addHi} 寸,取中值`, (addLo + addHi) / 2);
  const t = Math.min(1, Math.max(0, (dCun - dLo) / (dHi - dLo)));
  const chuanCun = baseCun + t * add;
  const chuanFen = chuanCun / spec.fenCun;

  // [05-05] 飞子出 = 0.6 × 椽头出。
  const feiFen = spec.feizi === false ? 0 : chuanFen * book.num('05-05', 'feiRatio');

  // [05-09] 大角梁断面,两档都是区间。没有实测理由偏向哪一端,取中值。
  const jlB = book.pickInRange('05-09', 'daJiaoliangBFen', 'mid');
  const jlT = book.pickInRange('05-09', 'daJiaoliangTFen', 'mid');

  return {
    chuanFen,
    feiFen,
    totalFen: chuanFen + feiFen,
    shengchuFen: shengchuCun(book, spec.bays) / spec.fenCun,
    // [05-13] 原文无定量,不给就是 0(不起翘)。给了就是艺术决策,由调用方留痕。
    qiqiaoFen: spec.qiqiaoFen ?? 0,
    // [05-10] 角梁斜长 = 正身长 × √2。
    diag: Math.SQRT2,
    jiaoliang: { b: jlB, t: jlT },
    // [05-06] 飞子断面按椽径比。
    feizi: { b: book.num('05-06', 'bRatioToDia') * d, t: book.num('05-06', 'hRatioToDia') * d },
    xieshanTurn: spec.xieshanTurn ?? 2,
    rafterPitchFen: book.num('05-03', 'rafterPitchToDiaRatio') * d,
  };
}
