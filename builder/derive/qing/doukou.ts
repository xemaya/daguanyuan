/**
 * 斗口 —— 清式推导链的起点(地位 = 宋材分制的材)。所有数字来自
 * knowledge/rules/qing.rules.json,方括号里是规则号。
 *
 * 模数方向是反的:斗口→构件断面在实物上成立,斗口→柱高/面阔全线被实测
 * 推翻(04 章结论,偏差 +26%~+82%)。所以斗口由调用方显式给(实测值优先),
 * 只给柱高时就得反算——而这条反函数书里没有 [missing 99-02],诚实地抛,
 * 不编除数。
 *
 * **这里不许出现营造数字的字面量。** 需要一个数就去规则表取;表里没有
 * 就补表,不要补代码(docs/DECISIONS.md D-09)。
 */
import type { RuleBook } from '../rules';

/** 斗口十一等表行 [01-01]。 */
export interface DoukouRow {
  grade: number;
  doukouCun: number;
}

/** 斗口十一等表:头等 6.0 寸,逐等减 0.5 至十一等 1.0 寸 [01-01]。 */
export function doukouTable(book: RuleBook): DoukouRow[] {
  return book.table<DoukouRow>('01-01');
}

export interface DoukouSpec {
  /** 实测斗口(mm)。优先于名义等第 [01-01 乙:十一等是立法阶梯,不是实测预测器]。 */
  doukouMm?: number;
  /** 斗口(营造寸),换算要尺长口径 [01-19 存疑,必须显式选]。 */
  doukouCun?: number;
  /** 斗口等第 1~11 [01-01]。 */
  doukouGrade?: number;
  /** 檐柱净高(米)。只给柱高不给斗口,就是要反算斗口 [99-02]。 */
  columnHeightM?: number;
  /** 项目或实测明确给柱径时不再用斗口正推整栋规模。 */
  columnDiameterM?: number;
}

/** 营造寸 → 米;尺长按 01-19 的选中口径取 [01-19 存疑:官式 32.0 / 吴 27.5,差 16.4%]。 */
function cunToM(book: RuleBook, cun: number): number {
  const chiCm = book.choice<number>('01-19');
  return (cun * chiCm) / 1000;
}

/**
 * 解析斗口(米)。
 *
 * 没有任何斗口来源时,该走的是"由规模/柱高反算斗口" [99-02]——六个口径
 * 互差 8%~21%,书里没有,use() 抛 MissingRuleError 并带上该查哪本书。
 * 调用方可以在 overrides 里给 '99-02' 一个斗口值(米)顶着,会记进 art。
 */
export function resolveDoukou(book: RuleBook, spec: DoukouSpec): number {
  if (spec.doukouMm !== undefined) return spec.doukouMm / 1000;
  if (spec.doukouCun !== undefined) return cunToM(book, spec.doukouCun);
  if (spec.doukouGrade !== undefined) {
    const row = doukouTable(book).find((r) => r.grade === spec.doukouGrade);
    if (!row) throw new Error(`斗口十一等表里没有第 ${spec.doukouGrade} 等 [01-01]`);
    return cunToM(book, row.doukouCun);
  }
  const missing = book.use('99-02');
  return missing.value as number;
}

export interface Doukou {
  /** 斗口(米)。 */
  dkM: number;
  /** 攒当(米)= 11 斗口 [01-04];攒当略大小于 11 时可调横栱长度。 */
  cuanDangM: number;
  /**
   * 檐柱净高(米)。调用方给了就用;不给按《工程做法》卷一立法值
   * 70 − 2(平板枋)− 斗科高 [04-04 存疑]。04-04 乙的更正:70 斗口只能当
   * 立法值/生成缺省,不能当实物规律——实测区间 52~88 斗口,存疑记进 inference。
   */
  columnHM: number;
  /** 檐柱径(米)= 6 斗口 [04-07 存疑,卷一立法值;实测 6.8~8.1 斗口见该条更正]。 */
  columnDM: number;
  /** 收分(米)= 7/1000 × 柱高(大式)[01-17];侧脚同收分,仅外檐柱。 */
  shoufenM: number;
}

export function deriveDoukou(
  book: RuleBook,
  spec: DoukouSpec,
  dkM: number,
  dougongHDk: number,
): Doukou {
  if (spec.columnDiameterM !== undefined && (!Number.isFinite(spec.columnDiameterM) || spec.columnDiameterM <= 0))
    throw new Error('显式柱径须为有限正数');
  const cuanDangM = book.num('01-04', 'cuanDangDk') * dkM;
  const columnHM =
    spec.columnHeightM ??
    (book.num('04-04', 'columnTotalDk') - book.num('04-04', 'pingbanFangDk') - dougongHDk) * dkM;
  const columnDM = spec.columnDiameterM !== undefined
    ? book.artChoice('project:column-diameter', '调用方显式柱径，不使用斗口正推柱径；实测依据须由施工spec另行记录', spec.columnDiameterM)
    : book.num('04-07', 'eaveColumnDiaDk') * dkM;
  const shoufenM = columnHM * book.num('01-17', 'shoufenDashiRate');
  return { dkM, cuanDangM, columnHM, columnDM, shoufenM };
}
