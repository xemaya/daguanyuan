import type { RegionScene } from '@builder/compose/scenes';

/**
 * 落位清单的装载口(单子 Y，接缝 ①)。
 *
 * glob 是 eager 的，所以**加一个区只要往 `scenes/` 里丢一个 .json**——
 * 这个文件、`main.ts`、`terrain.ts` 一行都不用改。目标 1 的判据
 * (「加一个区，diff 里不许出现 `.ts`」)就落在这一行 glob 上。
 *
 * `BUILT_REGIONS` 顺带就是「哪些区已经建出来了」的真源：**有落位清单 = 建成**。
 * 地形采样窗口、plan 遍历、对账门的分母全读它，不许有第二份名单。
 * 排序固定，免得 glob 的枚举顺序在不同平台上换来换去，把确定性哈希也带跑。
 */
const files = import.meta.glob<{ default: RegionScene }>('./scenes/*.json', { eager: true });

export const SCENES: RegionScene[] = Object.keys(files)
  .sort()
  .map((k) => files[k].default);

export const BUILT_REGIONS: string[] = SCENES.map((s) => s.region);
