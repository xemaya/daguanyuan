# 单子 BI：最重的几件构件——首建 ≤ 0.5 s，后台建造不再卡

> **依据**：`D-45`；验收记录 §30（BH2 量出 B 段最坏一帧 2.5 s、>100 ms 12 次，几乎全是 `wall:mud`）；`tools/profile-build.mjs` 的「起屋 原型首建」榜。
> **标准动作见 `STANDARD-ACTIONS.md`。**
>
> **病**（验收人 2026-10-01 `profile-build`，5 区，load 7）：首建 > 0.5 s 的原型——`wall:mud:daoxiangcun.mud-wall` 2.48 s、`baishi:group9` 1.54 s、`building:men` 1.36 s、
> `forecourt-terrace:default` 1.29 s、`caiqi:daoxiangcun.vegetable-plots` 1.28 s、`garden-wall:zhengmen.flanking-wall.west` 1.12 s，其余以 `profile-build --top 20` 为准。
> 一道 1.4 m 矮墙建 2.5 s 不正常——先剖析它慢在哪（逐版几何？逐顶点噪声？toNonIndexed / merge？贴图？）。
>
> **文件域**：首建 > 0.5 s 的那几个构件文件（只改「怎么算」，不改「算出什么」）、`tests/`。**不碰**：composer / world 编排、Engine、vegetation / scatter、机位、基线、单子。

## 做法

1. 逐件剖析（`performance.mark` 或 node 下直接 profile 构件 builder），回报每件的耗时分布。
2. 只做**不改输出**的优化：缓存可复用的中间结果、去掉重复计算、合并时少拷贝、按需而不是全量算……
   **输出必须不变**：每件优化前后几何按数值逐项相同（位置 / 法线 / UV / 索引 / 材质分组），名册相同。做不到逐位相同的优化，停下回报，不许自己放宽。
3. 若某件不改输出就压不到 0.5 s 以下，报它剩多少、慢在哪、要改什么输出才能更快——**停下给验收人判**，别改。

## 判据

- 原型首建：`wall:mud` ≤ 0.5 s；榜上其余 > 0.5 s 的每件报前后；
- BH2 的 `stream-probe`：B 段最坏一帧 **≤ 0.5 s**（报 >100 ms / >50 ms 帧数），A 段建时报前后；
- 几何逐项相同（每件给出比较脚本的输出）；四镜三角 / calls 与 `perf-baseline.json`（2026-10-01 版）逐位相同；`tree-census --dump` 逐字节相同；
- `check:all`、`playtest` 过。

## 回报

每件 sha；剖析表；每件前后耗时；几何逐项相同的证据；stream-probe 前后；你没压下来的件与原因。
