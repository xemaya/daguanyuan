# 单子 AN2：材质加工尺度——白石两档、粉墙潮痕脱离贴图循环、鼓面 UV

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联。** 预算按 `D-25`（`manifest-diff --baseline`）。
> 依据：codex 评审 §3.1 / §5（`docs/reviews/2026-09-15-procedural-detail-review.md`）+ 核验稿 §2 / §6。
> **前提已满足**：AJ1–AJ3 已合回（`6b931477` / `46e0df5f` / `f77f3757`）。AN 单子原来的 AN2 一节由本单取代。
>
> **文件域**：`builder/parts/materials.ts`、`builder/parts/qiangyuan/wall.ts`（只许改 `projectUV` 与顶点色那一路，**不碰 `gexinGeometry`**——单子 AP 要用）、
> `builder/parts/shishan/baogushi.ts`、`builder/parts/qiangyuan/forecourt-terrace.ts`（只许改材质选择与 UV，**不碰西番草那一段**——单子 AO 要用）。
> **不许碰 `builder/parts/damu/building.ts`**（AP 在里面）。白石默认档改了，`building.ts` 里 `plinthMaterial === 'whiteStone'` 那一路会自动吃到。

---

## 题面

三处都是「加工方式没表达」：

1. **白石与青石共用一套各向异性凿痕**（`materials.ts:252` 与 `:293` 同一个 `tileableFbm(u*5, v*0.4)`），鼓面、台面、阶条石全是刨子纹；
2. **粉墙潮痕烘在贴图 v 里**（`materials.ts` 第 91 行「v=0 是墙脚」），`wall.ts` 的 `projectUV` 又把 v 按墙高铺——`smoothstep(0.42, 0, v)` 在墙高 42% 处出一条软边，**这是潇湘馆白墙横色带的头号嫌疑**（codex 评审说要分项排查，本单排查）；
3. **鼓面 UV 放射纹**：AJ2 重做了形制但鼓仍是 `LatheGeometry` 直接沿用旋转体 UV（`docs/reviews/2026-09-15-aj-findings.md` F-AJ-2 自认）。**这条本来是 AJ2 的补充，没做，并到这里。**

## AN2-1 · 白石两档

- `whiteStoneMaps(size, finish: 'fine' | 'rough')`：
  - **fine（细磨面，默认）**：各向同性弱颗粒（`fbm` 不拉伸），法线幅度降到现在的 1/3，粗糙度 0.55 一档，色相不动（07-01 暖白）；
  - **rough（粗档）**：保留现在的凿痕，给鼓帮、座脚、陡板石。
- `whiteStoneMaterial(repeat, finish = 'fine')`——**默认改 fine**，全仓不传参数的调用（`building.ts` 台基、`forecourt-terrace.ts` 台面）自动变细磨；
  `baogushi.ts` 鼓帮 / 须弥座束腰用 `'rough'`，鼓面 / 锦铺用 fine；`forecourt-terrace.ts` 陡板用 rough、阶条与面层用 fine。
- 青石 `stoneMaps`：凿痕幅度降一档（踏面「大面平整」），苔斑保留。**不做边缘圆磨**（那是几何倒角的事）。
- 文件头注释写清每种材质的**三档尺度**：米级色块 / 厘米级加工 / 毫米级微表面，贴图覆盖多少米、法线幅度多少毫米。

## AN2-2 · 潮痕脱离贴图 v

- `plasterMaps`：**删掉 damp 那一路**，贴图只剩抹灰起伏 + 砂感 + 低对比色差；
- `wall.ts`：潮痕改由**构件局部高度**写顶点色（`plasterMaterial(repeat, vertexColors = true)` 已支持），墙脚 0 → 0.45 m 淡出，与 repeat 无关；
  沿墙走向叠一路低频噪声让潮痕不是一条直线；
- **先排查再动**：改之前在 `xiaoxiang` / `moon_gate` 两镜量白墙那条横带的**高度占比**（像素行亮度曲线），改之后再量。如果横带不是 0.42 那条（比如是阴影级联或 AO 的边），**如实报，不要硬说修好了**。
- 院墙、侧墙、门屋槛墙走的是不是同一条 `projectUV`？三种都要拍到。

## AN2-3 · 鼓面 UV（AJ2 欠的）

- 鼓面：局部平面投影（沿鼓轴投），颜色 / 法线 / 粗糙度同一套；鼓帮：周向展开（u = 弧长，v = 厚度）；须弥座按长轴。
- **不改 AJ2 的形制与尺寸**——只改 UV 与两档材质的选用。判据：`cu_baogushi` 鼓面无放射纹。

## 判据

- `cu_baogushi`：鼓面细磨、鼓帮粗、无放射纹；
- `xiaoxiang` / `moon_gate`：白墙横色带**消失或归因清楚**（量出来的曲线前后贴回报）；
- `gate_approach` / `cu_terrace`：台面不再读成塑料板（与 AJ1 砌缝叠加后看）；
- `D-25` 四镜 ±3%；draw call 若因白石分两档多 1–2 个材质桶，如实报，验收人抬基线。
- 九道门 + `playtest` PASS。

## 回报

三档尺度的数；横带排查曲线；潮痕搬到哪、怎么算；UV 投影怎么做的；对照图；预算前后。
**规模**：中。**风险**：中——**最容易做过头**（把贵族园林做成废墟）；**潮痕最容易漏一类墙**。
