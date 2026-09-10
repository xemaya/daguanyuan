/**
 * 材分制 —— 推导链的起点。所有数字来自 knowledge/rules/fashi.rules.json,
 * 方括号里是规则号,查号即可看到原文、出处与两名核验者的裁决。
 *
 * 一切尺寸先以「分」(fen°)表示,最后一步才乘 fenCm 变成厘米/米。
 * 分 ≠ 长度单位的分(0.1 寸);本模块里 fen 永远指材分 [01-14]。
 *
 * **这里不许出现营造数字的字面量。** 需要一个数就去 rules 表取;
 * 表里没有就补表,不要补代码——见 docs/DECISIONS.md D-09。
 */
import type { RuleBook } from '../rules';

export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface GradeRow {
  grade: number;
  guangCun: number;
  houCun: number;
  fenCun: number;
  use: string;
}

/** 八等材:广/厚(宋寸)与每分寸数 [01-05][01-06]。 */
export function grades(book: RuleBook): GradeRow[] {
  return book.table<GradeRow>('01-05');
}

export function gradeRow(book: RuleBook, g: Grade): GradeRow {
  const row = grades(book).find((r) => r.grade === g);
  if (!row) throw new Error(`八等材表里没有第 ${g} 等 [01-05]`);
  return row;
}

/** 材/栔/足材的分值 [01-02][01-03][01-04]。 */
export interface CaiModule {
  guang: number;
  hou: number;
  qiGuang: number;
  qiHou: number;
  zuCai: number;
}

export function caiModule(book: RuleBook): CaiModule {
  const guang = book.num('01-02', 'caiGuangFen');
  const hou = book.num('01-02', 'caiHouFen');
  // [01-03 存疑] 栔广实物 6~7.5 分;栔厚 4 分唯一实测点是它的两倍,不参与几何推导。
  const qiGuang = book.num('01-03', 'qiGuangFen');
  const qiHou = book.num('01-03', 'qiHouFen');
  const zuCai = book.num('01-04', 'zuCaiGuangFen');
  return { guang, hou, qiGuang, qiHou, zuCai };
}

export interface CaiSpec {
  /** 按材等选;与 fenCm 二选一。 */
  grade?: Grade;
  /** 直接给分值(厘米),用于唐构"超一等"或实测反推 [01-01 乙注][01-05 乙注]。 */
  fenCm?: number;
  /**
   * 尺长(厘米),grade 路径才用到。不给就从 [01-09] 取——而 01-09 是存疑多口径,
   * 不在 RuleBookOptions.choices 里选一个就会抛 AmbiguousRuleError。
   * **这是有意的**:同一分值在不同尺长下厘米差可达 11% [01-06 乙注]。
   */
  chiCm?: number;
}

export interface Cai {
  grade: Grade | null;
  chiCm: number;
  /** 1 分 = 多少厘米。 */
  fenCm: number;
  /** 1 分 = 多少米。 */
  fenM: number;
  /** 1 分 = 多少寸(该材等的每分寸数)。 */
  fenCun: number;
  /** 材广/材厚/栔广/足材(厘米)。 */
  guangCm: number;
  houCm: number;
  qiCm: number;
  zuCaiCm: number;
  mod: CaiModule;
}

/** 由材等或自定义分值得到换算表。 */
export function makeCai(book: RuleBook, spec: CaiSpec): Cai {
  const mod = caiModule(book);
  const chiCm = spec.chiCm ?? book.choice<number>('01-09');
  const cunCm = chiCm / 10;

  let fenCm: number;
  let grade: Grade | null = null;
  if (spec.fenCm !== undefined) {
    fenCm = spec.fenCm;
  } else if (spec.grade !== undefined) {
    grade = spec.grade;
    fenCm = gradeRow(book, grade).fenCun * cunCm;
  } else {
    throw new Error('makeCai: 需要 grade 或 fenCm');
  }

  return {
    grade,
    chiCm,
    fenCm,
    fenM: fenCm / 100,
    fenCun: fenCm / cunCm,
    guangCm: mod.guang * fenCm,
    houCm: mod.hou * fenCm,
    qiCm: mod.qiGuang * fenCm,
    zuCaiCm: mod.zuCai * fenCm,
    mod,
  };
}

export type BuildingType = '殿' | '殿身' | '堂' | '厅堂' | '亭榭' | '小殿' | '藻井';

/**
 * 材等选择函数 [01-08 存疑]:原文转写正确,但实物普遍比条文低 1~2 等,
 * 所以返回默认等与建议区间,由调用方决定。区间宽度按 01-08 的更正值
 * "[grade−1, grade+2]"。
 */
export function pickGrade(
  book: RuleBook,
  type: BuildingType,
  bays: number,
  small = false,
): { grade: Grade; range: [Grade, Grade] } {
  // 这条存疑:原文转写正确,但实物普遍比条文低 1~2 等,所以给区间不给定值。
  const lookup = book.param('01-08', 'lookup') as Record<
    string,
    { minBays: number; grade: number; small?: boolean }[]
  >;
  const rows = lookup[type];
  if (!rows) throw new Error(`01-08 的选等表里没有屋类「${type}」`);
  const hit =
    rows.find((r) => bays >= r.minBays && Boolean(r.small) === small) ??
    rows.find((r) => bays >= r.minBays) ??
    rows[rows.length - 1];

  const n = grades(book).length;
  const clampG = (v: number) => Math.min(n, Math.max(1, v)) as Grade;
  const lo = book.num('01-08', 'rangeLo');
  const hi = book.num('01-08', 'rangeHi');
  return { grade: clampG(hit.grade), range: [clampG(hit.grade + lo), clampG(hit.grade + hi)] };
}

/** 副阶/挟屋减一等,廊屋减二等 [01-07]。 */
export function subordinateGrade(book: RuleBook, main: Grade, kind: '副阶' | '挟屋' | '廊屋'): Grade {
  const d =
    kind === '廊屋'
      ? book.num('01-07', 'langwuDelta')
      : kind === '副阶'
        ? book.num('01-07', 'fujieDelta')
        : book.num('01-07', 'xiewuDelta');
  return Math.min(grades(book).length, main + d) as Grade;
}
