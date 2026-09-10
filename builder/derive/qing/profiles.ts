/**
 * 斗口制口径预设(qingOptions)。
 *
 * qing 参数集带 choices 的规则目前两条:02-05(举架系数,原文实例档/通行表档,
 * 差到并列值)、03-09(冲出口径,马炳坚放样/《工程做法》直加,两套不可通约)。
 * 逐条塞太吵,照 builder/derive/profiles.ts 的形状收成一份预设。
 *
 * **这里没有营造数字,只有口径的名字。** 数值仍只在规则表里,选中哪档也
 * 逐条记进 provenance 的 inference 分支。
 */
import type { RuleBookOptions } from '../rules';

/** 默认口径:02-05 原文实例档(《工程做法》卷九/卷十/卷十一/卷一,非通行表);
 * 03-09 马炳坚放样口径(冲量在正身法线方向,沿角梁斜向再 ×1.414)。 */
export const QING_CHOICES: Record<string, string> = {
  '02-05': 'yuanwen',
  '03-09': 'mabingjian',
};

/** 由预设得到 RuleBook 选项;`extra.choices` 逐条覆盖预设。 */
export function qingOptions(extra: RuleBookOptions = {}): RuleBookOptions {
  return {
    choices: { ...QING_CHOICES, ...(extra.choices ?? {}) },
    overrides: extra.overrides,
  };
}
