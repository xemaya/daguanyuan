/**
 * 口径预设(era profile)。
 *
 * 存疑且多口径的规则要求调用方显式选一个,不选就抛。这是对的——同一分值在
 * 不同尺长下厘米差可达 11%,举高比法式与唐构差 32%。但每栋屋逐条选一遍太吵,
 * 而这些选择本来就是**同一个决定的不同面**:这栋屋按哪个时代造。
 *
 * 所以预设只做一件事:把"时代"翻译成一张口径表。
 *
 * **这里没有营造数字,只有口径的名字。** 每个 key 对应的数值仍然只在规则表里,
 * 选中哪个口径也会逐条记进 provenance 的 inference 分支。换句话说,预设是一次
 * 有记录的裁决,不是一批藏在代码里的常量。
 */
import type { RuleBookOptions } from './rules';

export type Era = 'song' | 'tang' | 'liao';

/** 各时代的口径表。规则号见 knowledge/rules/fashi.rules.json。 */
export const ERA_CHOICES: Record<Era, Record<string, string>> = {
  /** 北宋《营造法式》本位:出土宋尺、法式举高、法式补间朵数。 */
  song: {
    '01-09': 'chutu', // 尺长 31.2cm,出土宋尺下限
    '02-19': 'chentong', // 下昂斜度,陈彤推算
    '02-25': 'fashi', // 当心间 2 朵、次间梢间各 1 朵
    '04-03': 'fashi', // 殿阁举高 L/3
    '04-04': 'liang', // 筒瓦厅堂,梁思成乘法读法
    '04-05': 'multi',
    '04-06': 'multi',
  },
  /** 唐构(佛光寺一系):举高远低于法式,无侧脚,每间一朵。 */
  tang: {
    '01-09': 'zhong',
    '02-19': 'chentong',
    '02-25': 'tangliao',
    '04-03': 'tang', // 区间 [0.208, 0.227],要单值须在 spec 里给 ratio
    '04-04': 'liang',
    '04-05': 'multi',
    '04-06': 'multi',
  },
  /** 辽构(独乐寺、奉国寺一系):尺长最长,举高约 L/4。 */
  liao: {
    '01-09': 'chen',
    '02-19': 'chentong',
    '02-25': 'tangliao',
    '04-03': 'liao',
    '04-04': 'liang',
    '04-05': 'multi',
    '04-06': 'multi',
  },
};

/** 由时代得到 RuleBook 选项;`overrides` 逐条覆盖预设。 */
export function eraOptions(era: Era, extra: RuleBookOptions = {}): RuleBookOptions {
  return {
    choices: { ...ERA_CHOICES[era], ...(extra.choices ?? {}) },
    overrides: extra.overrides,
  };
}
