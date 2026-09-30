# 单子 BH1：全局减负——白石几何缓存 · 调色不干等 · 植被材质进 worker

> **依据**：设计稿 `docs/superpowers/specs/2026-10-01-region-streaming-design.md` §6「BH1」（**范围、文件域、判据、对照图、回退全部照那一节**，本单不再抄）；`D-44`。
> **标准动作见 `STANDARD-ACTIONS.md`。**
>
> **验收人定稿的文件域**：设计稿 §6 BH1 列的那几个文件（`baishi.ts` 只加缓存、`world.ts` 只动步骤编排、`prewarm-textures.ts`、`texture-jobs.ts`、`texture-bake.worker.ts`、`vegetation.ts` 只动材质调度）、`tests/`，
> 以及把 BH0 的建时插桩**转正**成一个工具（放 `tools/`，名字你定，头注写口径）。**不碰** `engine/core/Engine.ts`（BG 在改）、规则、散布、材质参数、机位、基线。
>
> **硬判据摘要**（详见设计稿）：藤萝 3.2 s → ≤ 0.1 s；植被材质主线程 3.8 s → ≤ 0.5 s；5 区建时 43.2 → ≤ 33 s（三次中位、记 load）；
> 画面零变化（四镜三角 / calls 与基线完全相同、`pixel-diff --mean` < 0.5、`tree-census --dump` 字节相同、名册几何逐项相同、`--coverage` 不变）；`check:all`、`playtest` 过。

## 回报

三件各自 sha；判据表每行实测；2 区（正门 + 翠嶂）建时；主线程等 worker 秒数；对照图路径。
