/**
 * scatter-rules.ts —— 选料规则（单子 Z，接缝 ②）。
 *
 * 这是目标 2 的机制：**基建提升全局收益，新增基础构件块所有区域都用起来**。
 *
 * 以前新做一个构件要被用起来，必须有人去 `composer.ts` 的 `SCENE` 表里手写
 * 条目（单子 Y 之后是去 `scenes/<region>.json` 里手写）。4 个区还行，19 个区不行。
 * 最扎眼的例子是檐下灯笼：`lanternSpotsFor` 里写死着
 * `p.variant === 'qinfang_ting_qiao.pavilion'`、`'xiaoxiangguan.main-house'`
 * 这样的白名单——**加一个区，灯就得回来改一行 `.ts`**。
 *
 * 而 `plan.json` 的 19 个区每一个都带 `style` 五维：
 *
 *   "tier": "B",
 *   "style": { official, jiangnan, rustic, enclosure, ornament }
 *
 * 这五个数在单子 Z 之前**没有任何代码消费**。它们本来就是为这件事准备的。
 * 于是「哪个区吃到哪个构件」变成一次匹配：**新增一个构件 = 加一条规则，
 * 所有匹配的区当场吃到，一行落位都不用写。**
 *
 * ⚠️ 这条最容易做过头（spec §2 ②）。判据只要求 `check:scenes` 能列出
 * 「哪条规则会落到哪几个区」——**不要去做一个通用的约束求解器**
 * （`D-18`「别让 compiler 吞掉大观园」）。所以这里只有两种谓词：
 * 五维区间与 tier 白名单。没有布尔组合、没有优先级、没有回溯。
 *
 * 规则住在 `builder/` 里，**不认识大观园**：它们说的是「江南气重、装饰度高的
 * B 类院子檐下挂灯」，不是「潇湘馆挂灯」。
 */

/** `plan.json` 的 `regions[].style` 五维。 */
export type StyleDimension = 'official' | 'jiangnan' | 'rustic' | 'enclosure' | 'ornament';

export interface StyledRegion {
  id: string;
  tier?: string;
  style?: Partial<Record<StyleDimension, number>>;
}

export interface ScatterRule {
  id: string;
  /** 这条规则要往区里放什么构件。 */
  part: string;
  variant?: string;
  /** 挑区的条件。五维是闭区间 `[lo, hi]`；`tier` 是白名单。都不写 = 所有区。 */
  appliesTo?: Partial<Record<StyleDimension, [number, number]>> & { tier?: string[] };
  /**
   * 放多少 / 放哪儿，由消费这条规则的那一层解释（`composer` 的檐下灯、
   * 以后的地面散置各自认自己的字段）。规则层只管**挑区**，不管几何。
   */
  where?: Record<string, unknown>;
  /** 强度，由消费方按自己的量纲用（灯是每面檐下几盏，地面散置是每平米几个）。 */
  amount?: number;
  /** 出处。与 plan.json 同口径，不写不许进（`check:scenes` 拦着）。 */
  basis: string;
}

/**
 * 规则表。
 *
 * 加一条就多一个构件被全园吃到；不需要去任何一张按区的表里手写。
 * `npm run check:scenes` 会当场列出每条规则落到哪几个区。
 */
export const SCATTER_RULES: ScatterRule[] = [
  {
    id: '灯笼-檐下',
    part: 'lantern',
    variant: 'gong',
    // 官式气重的门屋与装饰度够的院子挂灯；荒村野舍(rustic 高、ornament 低)不挂。
    appliesTo: { ornament: [0.25, 1] },
    // `perBay` 列的是**构件档**(建筑预设),不是栋名:凡是门屋(`men` 档)就每间
    // 一盏,换一座门屋进来照样吃到,加一个区也不用回来改这一行(接缝 ②)。
    // 其余建筑仍按 `amount: 2`。
    where: { under: 'eave', perBay: ['men'] },
    amount: 2,
    basis:
      '53 回「大觀園正門上也挑著大明角燈,兩溜高照,各處皆有路燈」(07-70)。'
      + '「各處皆有」是全园口径,所以这是一条按区 style 自动匹配的规则,不是逐栋点名。'
      + '门槛取 ornament ≥ 0.25:稻香村(ornament 0.05)那样的田舍不挂灯,与 17 回「纸窗木榻,富贵气象一洗皆尽」相合。'
      + '单子 AU1:门屋每间一盏(`perBay`)——07-70 说的是正门这一处「挑著大明角燈」,'
      + '两盏挂在 13.76m 宽的五间门脸下读成"小气"(用户 2026-09-16)。',
  },
  {
    id: '散石-墙根',
    part: 'taihu',
    // variant 由消费方按位置轮换 edge1..edge5,规则不指定具体哪一块。
    appliesTo: { rustic: [0.1, 1] },
    where: { surface: 'grass', nearOccupancy: [0.8, 3.2] },
    amount: 0.05,
    basis:
      '17 回全园「或如鬼怪,或如猛兽」的散石是园林做法的常态:墙脚屋角压一块石,'
      + '让建筑与草地的接边不是一条硬线。门槛取 rustic ≥ 0.1(几乎所有区都过),'
      + '官式气最重、rustic 最低的正门区(0.15)也吃得到,但密度由 amount 统一压住。'
      + '这一条是艺术选择,不是原文明句——写出来备查。',
  },
];

/** 区的某一维落在区间里吗？维度缺省按 0 算（plan 的 style 五维是必填的）。 */
function dimensionMatches(region: StyledRegion, dim: StyleDimension, range: [number, number]): boolean {
  const v = region.style?.[dim] ?? 0;
  return v >= range[0] && v <= range[1];
}

/** 这条规则落到这个区吗？ */
export function ruleMatches(rule: ScatterRule, region: StyledRegion): boolean {
  const a = rule.appliesTo;
  if (!a) return true;
  if (a.tier && !a.tier.includes(region.tier ?? '')) return false;
  for (const dim of ['official', 'jiangnan', 'rustic', 'enclosure', 'ornament'] as StyleDimension[]) {
    const range = a[dim];
    if (range && !dimensionMatches(region, dim, range)) return false;
  }
  return true;
}

/** 这个区吃到哪几条规则。 */
export function rulesForRegion(region: StyledRegion, rules: readonly ScatterRule[] = SCATTER_RULES): ScatterRule[] {
  return rules.filter((r) => ruleMatches(r, region));
}

/**
 * 每条规则会落到哪几个区——目标 2 的判据就是这张表能当场列出来
 * （`npm run check:scenes` 打印它）。
 */
export function ruleCoverage(
  regions: readonly StyledRegion[],
  rules: readonly ScatterRule[] = SCATTER_RULES,
): { rule: ScatterRule; regions: string[] }[] {
  return rules.map((rule) => ({ rule, regions: regions.filter((r) => ruleMatches(rule, r)).map((r) => r.id) }));
}

/** 规则表自己的契约校验（`check:scenes` 一并跑）。 */
export function validateRules(rules: readonly ScatterRule[] = SCATTER_RULES): string[] {
  const fails: string[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    if (!r.id) { fails.push('规则缺 id'); continue; }
    if (seen.has(r.id)) fails.push(`规则 id 重复：${r.id}`);
    seen.add(r.id);
    if (!r.part) fails.push(`规则 ${r.id}：缺 part`);
    if (!r.basis) fails.push(`规则 ${r.id}：缺 basis——「这个构件该出现在哪些区」是一次取舍，写出来就行，不写不许进`);
    for (const [dim, range] of Object.entries(r.appliesTo ?? {})) {
      if (dim === 'tier') continue;
      const [lo, hi] = range as [number, number];
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi)
        fails.push(`规则 ${r.id}：${dim} 的区间 [${lo}, ${hi}] 非法`);
    }
  }
  return fails;
}
