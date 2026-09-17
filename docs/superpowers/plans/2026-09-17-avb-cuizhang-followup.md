# 单子 AV-b：翠嶂尾账三件——散布先撒后筛、苔地露土让位、当心间灯

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联；#15 适用：开工先读 `knowledge/docs/scenes/cuizhang.md` §6 第 7 条与 `knowledge/docs/scenes/zhengmen.md` §6，收工必须改它们。** 预算按 `D-25`。
> 依据：AV 验收 `docs/reviews/2026-09-15-detail-review-response.md` §19；`docs/PITFALLS.md` P-28。
>
> **文件域**：AV-b1 = `engine/scatter/`（泊松散布）、`builder/parts/zhiwu/vegetation.ts`（只许改 `treeDensity` 的调用方式与 `treeBudget` 语义）；
> AV-b2 = `builder/compose/terrain-from-plan.ts`（只许改 `soil` 那一行）；
> AV-b3 = `builder/compose/composer.ts`（只许改 `lanternSpotsFor` 的 `perBay` 分支）——**这一件要用户点头才做**，单子派出时看头部「裁定」一行。
> **不碰**：峰组、石脚、树的清单、正门其他任何文件（`D-28`）。

## 裁定（派单前填）

- AV-b3 当心间灯：**用户 2026-09-17 裁定「保持五盏」，本件不做。**

## AV-b1 · 散布先撒后筛（P-28）

**病**：AV2 只让山体多边形内的 `treeDensity` 返回 0，全园 180 棵树里 89 棵消失、92 棵新出现；潇湘馆视锥里的树从 36 棵涨到 49 棵（`xiaoxiang` 三角 +9.3%）。Bridson 算法下任何局部密度改动都是全局重洗。

**做法**：
1. `poissonScatter` 加一档「先撒后筛」：泊松只按 `radius` 撒满整个窗口（不看密度，全园稳定），每个候选点用**自身坐标的哈希**（不是顺序 rng）与 `density(x,z)` 比较决定留不留。老的按密度拒点的路径保留给别的调用方，树的 copse 散布切到新档。
2. `treeBudget` 的语义从「撒够 180」改成「筛后 ≤180」；筛后不足时不补撒（补撒又是顺序依赖）。
3. **判据**：dump 实例位置（`tools/tree-census.mjs` 的路数，加 `--dump <file>`），把翠嶂之外任一区的密度乘 0.5 再 dump，**其他区的树一棵不动**；然后把翠嶂 `treeDensity` 恢复成 AV 前再 dump，除翠嶂外一棵不动。两次 diff 都写回报。
4. 做完四镜 `--baseline`：`xiaoxiang` 应回落到接近 AV 前（225/2967908 ±3%）——回落就是这一件成立的证据；`gate_approach` / `mound_block` / `grass_close` 允许在新基线 ±3% 内。

## AV-b2 · 苔地露土让位

**病**：`terrain-from-plan.ts` 的 `soil = bareSoil × fallback × (1 − min(1, moss × 1.2)) × 0.9`，苔 0.33–0.55 时露土还剩 34–60%，`gate_face` / `mound_block` 里土台与山坡有一层红棕斑。

**做法**：山体苔（`hills[].mossCover` 那一路）算出来的 `moss` 单独记一个 `hillMoss`，`soil` 再乘 `(1 − smoothstep(0.15, 0.4, hillMoss))`——苔一过 0.4 露土归零；不动潇湘馆那一路（`mossInside`）的行为。**判据**：`gate_face` 与 `mound_block` 的土台与南坡不再有红棕斑（前后图 pixel-diff 变化只在山体多边形内），`cu_terrace` / `xiaoxiang` 像素不变（`tools/pixel-diff.mjs --mean 2`）。

## AV-b3 · 当心间灯（需用户点头）

**病**：五盏檐灯同一 `hangY`，当心间那盏挂在匾正下方被前倾的匾遮半截（`cu_gate_plaque`）。
**做法（若裁定「不挂」）**：`lanternSpotsFor` 的 `perBay` 分支跳过当心间（奇数间取中间那一间），四盏；`gate_approach` / `cu_gate_plaque` 前后图。若裁定「保持」，本件不做。

## 验收

- 九门 + `playtest` PASS；对账门 23/25、野生件 ≤ 53；
- AV-b1 两次 diff「其他区一棵不动」；`xiaoxiang` 回落到 AV 前 ±3%；
- AV-b2 前后 pixel-diff 只在山体多边形内变化；
- 景需求文档 `cuizhang.md` §6 第 7 条、`zhengmen.md` §6 台账改成做完之后的样子。

## 回报

两次 diff 的棵数；四镜前后；`soil` 那一行改成什么；当心间灯做没做；图拷到 `shots/AV-b/`。**规模**：小。**风险**：AV-b1 改的是 `engine/scatter`，全园所有散布（草、灌、花）都可能走同一函数——**只给树切新档，别的调用方不动**，回报里列出谁在调 `poissonScatter`。
