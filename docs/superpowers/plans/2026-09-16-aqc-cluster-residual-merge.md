# 单子 AQ-c：末端残余合并按簇分桶（128 m）

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联。** 预算按 `D-25`。
> 依据：单子 AQ-b 发现清单 §5（`docs/reviews/2026-09-15-aqb-findings.md`）——AQ-b1 撤掉构件内提前合并后，
> `assembleStatic` 末端 `mergeByMaterial(residual)` 全园一锅端，同材质一个 mesh、包围球罩住 280×226 m，视锥与阴影窗剔不掉，
> 四镜三角 +1.3~2.8% 全在阴影 pass。agent 量了三档，**验收人裁：取 128 m**。
>
> **文件域**：`builder/parts/static-batches.ts` 末尾那一段、`tests/static-batches.test.mjs`。别的不碰。

## 做什么

残余按 `assembleStatic` 已有的簇网格（`cellSize` 参数那张）分桶再 `mergeByMaterial`，簇边长 **128 m**。
agent 的实测（AQ-b1 之后的四镜）：

| 残余簇边长 | gate_approach | mound_block | xiaoxiang | grass_close |
|---|---|---|---|---|
| 不分（现状） | 258 / 4395k | 243 / 4318k | 213 / 3214k | 274 / 4441k |
| **128 m** | **277 / 3913k** | **265 / 3937k** | **219 / 2913k** | **298 / 4062k** |

相对 AQ-b1 之前：draw call +5 / +8 / −32 / +4，三角 −8.5% / −6.9% / −10.6% / −7.3%。
**为什么取它**：`D-25` 两条容差在这里打架，裁的依据是**扩区**——接缝④「没走到的区不烘焙」本来就要按空间分桶，
全园一锅端的 mesh 在 19 区时是 7.7M 三角的直接来源；几个 draw call 在 WebGPU 上是零钱，几十万三角的阴影 pass 不是。

## 判据

- 四镜三角相对 AQ-b1 之前 **≤ −6%**，draw call **≤ +8**（xiaoxiang 应降）；`frameCostMs` 不升；
- 名册 LOST = 0；同机位 pixel diff `--mean` < 0.5 色阶（合批不改像素）；
- `playtest` PASS；测试补一条「残余按簇分桶，跨簇不合」；
- 回报：四镜前后、每簇的 mesh 数分布、世界构建时间前后（不许慢 +10%）。

**规模**：小。**风险**：低——最容易做成"再加一层通用分桶抽象"（不许，用现有簇网格）。
