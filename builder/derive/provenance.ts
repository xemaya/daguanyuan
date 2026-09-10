/**
 * 出处三分。
 *
 * 一栋屋的数字来自三种性质完全不同的东西,混成一条链的后果是**艺术决策被当成史料**:
 *   evidence  原文/古籍/实测——有出处的事实
 *   inference 我们据证据做的裁决——存疑项选了哪个口径、用了哪个更正值
 *   art       为体验主动做的偏离——欠定项怎么定的、显式覆盖了什么
 *
 * 分开之后,点一根柱子可以说清:柱网规则出自《营造法式》卷四(史料)· 尺长取出土宋尺
 * 31.2cm(推定)· 柱径视觉增粗(艺术偏离)。见 spec §5。
 */
export interface ProvenanceEntry {
  id: string;
  name: string;
  /** 卷/篇/页。evidence 才有。 */
  location?: string;
  /** 为什么这么定。inference 与 art 必有。 */
  note?: string;
  /** art 分支:artistic_choice | seeded_variant | override */
  method?: string;
}

export interface Provenance {
  evidence: ProvenanceEntry[];
  inference: ProvenanceEntry[];
  art: ProvenanceEntry[];
}

export const BRANCHES = ['evidence', 'inference', 'art'] as const;
export type Branch = (typeof BRANCHES)[number];

export function emptyProvenance(): Provenance {
  return { evidence: [], inference: [], art: [] };
}

/** 合并多个推导步骤的出处,按 id 去重。 */
export function mergeProvenance(...ps: Provenance[]): Provenance {
  const out = emptyProvenance();
  for (const p of ps) {
    for (const b of BRANCHES) {
      for (const e of p[b]) {
        if (!out[b].some((x) => x.id === e.id)) out[b].push(e);
      }
    }
  }
  return out;
}

/** 人读的一行摘要,用于棚拍 manifest 与调试。 */
export function summarizeProvenance(p: Provenance): string {
  return BRANCHES.map((b) => `${b} ${p[b].length}`).join(' / ');
}
