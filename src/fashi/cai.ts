/**
 * 材分制 —— 推导链的起点。规则出处见 docs/fashi/01-caifen.md,方括号里是规则号。
 *
 * 一切尺寸先以「分」(fen°)表示,最后一步才乘 fenCm 变成厘米/米。
 * 分 ≠ 长度单位的分(0.1 寸);本模块里 fen 永远指材分 [01-14]。
 */

export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 八等材:广/厚(宋寸)与每分寸数 [01-05][01-06]。 */
export const GRADES: Record<Grade, { guangCun: number; houCun: number; fenCun: number; use: string }> = {
  1: { guangCun: 9.0, houCun: 6.0, fenCun: 0.6, use: '殿身九间至十一间' },
  2: { guangCun: 8.25, houCun: 5.5, fenCun: 0.55, use: '殿身五间至七间' },
  3: { guangCun: 7.5, houCun: 5.0, fenCun: 0.5, use: '殿身三间至五间,堂七间' },
  4: { guangCun: 7.2, houCun: 4.8, fenCun: 0.48, use: '殿三间,厅堂五间' },
  5: { guangCun: 6.6, houCun: 4.4, fenCun: 0.44, use: '殿小三间,厅堂大三间' },
  6: { guangCun: 6.0, houCun: 4.0, fenCun: 0.4, use: '亭榭或小厅堂' },
  7: { guangCun: 5.25, houCun: 3.5, fenCun: 0.35, use: '小殿及亭榭' },
  8: { guangCun: 4.5, houCun: 3.0, fenCun: 0.3, use: '殿内藻井或小亭榭铺作多者' },
};

/** 材/栔/足材的分值 [01-02][01-03][01-04]。栔广实物 6~7.5 分可调。 */
export const CAI = {
  guang: 15,
  hou: 10,
  qiGuang: 6,
  /** 栔厚原文 4 分,实物(保国寺)≈8 分,不参与几何推导 [01-03 存疑]。 */
  qiHou: 4,
  get zuCai(): number {
    return this.guang + this.qiGuang;
  },
} as const;

/**
 * 宋营造尺长度(厘米),学界无定论 [01-09 存疑]:
 * 30.5 钟晓青 / 31.2 出土宋尺常用值 / 31.6 布帛尺 / 32 陈明达辽代。
 * 默认取 31.2。
 */
export const CHI_CM_DEFAULT = 31.2;

export interface CaiSpec {
  /** 按材等选;与 fenCm 二选一。 */
  grade?: Grade;
  /** 直接给分值(厘米),用于唐构"超一等"或实测反推 [01-01 乙注][01-05 乙注]。 */
  fenCm?: number;
  /** 尺长(厘米),grade 路径才用到。 */
  chiCm?: number;
}

export interface Cai {
  grade: Grade | null;
  chiCm: number;
  /** 1 分 = 多少厘米。 */
  fenCm: number;
  /** 1 分 = 多少米。 */
  fenM: number;
  /** 材广/材厚/栔广/足材(厘米)。 */
  guangCm: number;
  houCm: number;
  qiCm: number;
  zuCaiCm: number;
}

/** 由材等或自定义分值得到换算表。 */
export function makeCai(spec: CaiSpec): Cai {
  const chiCm = spec.chiCm ?? CHI_CM_DEFAULT;
  let fenCm: number;
  let grade: Grade | null = null;
  if (spec.fenCm !== undefined) {
    fenCm = spec.fenCm;
  } else if (spec.grade !== undefined) {
    grade = spec.grade;
    fenCm = GRADES[grade].fenCun * (chiCm / 10);
  } else {
    throw new Error('makeCai: 需要 grade 或 fenCm');
  }
  return {
    grade,
    chiCm,
    fenCm,
    fenM: fenCm / 100,
    guangCm: CAI.guang * fenCm,
    houCm: CAI.hou * fenCm,
    qiCm: CAI.qiGuang * fenCm,
    zuCaiCm: CAI.zuCai * fenCm,
  };
}

export type BuildingType = '殿' | '殿身' | '堂' | '厅堂' | '亭榭' | '小殿' | '藻井';

/**
 * 材等选择函数 [01-08 存疑]:原文转写正确,但实物普遍比条文低 1~2 等,
 * 所以返回默认等与建议区间 [grade-1, grade+2],由调用方决定。
 */
export function pickGrade(type: BuildingType, bays: number, small = false): { grade: Grade; range: [Grade, Grade] } {
  let g: number;
  switch (type) {
    case '殿身':
      g = bays >= 9 ? 1 : bays >= 5 ? 2 : 3;
      break;
    case '殿':
      g = bays >= 5 ? 3 : small ? 5 : 4;
      break;
    case '堂':
      g = bays >= 7 ? 3 : 4;
      break;
    case '厅堂':
      g = bays >= 5 ? 4 : small ? 6 : 5;
      break;
    case '亭榭':
      g = small ? 7 : 6;
      break;
    case '小殿':
      g = 7;
      break;
    case '藻井':
      g = 8;
      break;
  }
  const clampG = (v: number) => Math.min(8, Math.max(1, v)) as Grade;
  return { grade: clampG(g), range: [clampG(g - 1), clampG(g + 2)] };
}

/** 副阶/挟屋减一等,廊屋减二等 [01-07]。 */
export function subordinateGrade(main: Grade, kind: '副阶' | '挟屋' | '廊屋'): Grade {
  const d = kind === '廊屋' ? 2 : 1;
  return Math.min(8, main + d) as Grade;
}
