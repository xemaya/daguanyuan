# 单子 AS：绦环板换浮雕——AO 工具的第二个消费者，落在人眼高度

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联。** 预算按 `D-25`。
> 依据：**`D-27`**（用户拍板：雕饰重心放人眼高度的构件）+ `07-01`「門欄窗槅，皆是細雕新鮮花樣」+ codex 评审 §4.1。
> AO 交付的工具：`builder/parts/ornament/`（`pattern2d.ts` 纹样、`relief.ts` 高度场 → 几何 / 贴图、`scroll-sample.ts` 台矶样件）。
>
> **派单时机**：现在。**AQ-b 排在本单之后**（它要用本单产出的两种表示做距离档，且两单都碰 `building.ts`）。
> **文件域**：`builder/parts/damu/building.ts`（**只许改 `makeGeshan` 的绦环板那一段**，格心 / 裙板 / 外框不碰；`:1619` 那行合并不碰）、
> `builder/parts/ornament/`（新增 `tiaohuan-band.ts`，`relief.ts` 只许加参数不改现有输出——AO 的测试要继续绿）、
> `builder/compose/texture-jobs.ts`（登记烘焙）、`tools/capture.mjs`（只追加一个机位）、`tests/`。

---

## 现状

`building.ts:474` 绦环板：「复用脊那根 `ridgeTube`，一条波形藤蔓 + 几个卷叶点」——管 + 三个压扁球，就是评审说的铁丝。
`makeGeshan` 被**全园所有格扇**调用（正门 `:1465` 每间 `ceil(len/0.85)` 扇、潇湘馆 `:1524/:1560/:1589`……），
所以这一段一改，全园吃到——这正是 `D-27` 要的，也正是预算的风险所在。

## 做法：同一份纹样，两种表示，按角色分配

### AS1 · `tiaohuan-band.ts`

- 用 `makeScrollBand(lengthM, heightM, cellW, seeds, levels)` 出绦环板的带：长 = 格扇净宽（0.6–0.85 m），高 = `tiaoH`（0.07–0.2 m），
  `cellW` 取 长/⌈长/0.17⌉（单元 0.15–0.2 m，不整除要抛错——`relief.ts` 已有这条纪律）；
- **叶面抬一档**：`levels = { ...XIFANCAO_LEVELS, leafH: 0.0035 }`（AO 验收说样件「叶弱藤强」）。**别的档位不动**，台矶样件的测试要继续绿；
- 两种输出：`buildReliefBandGeometry(band, 0.006, 0.006)`（**6 mm 步长**，不是台矶的 4 mm——绦环板 0.85×0.12 m 在 6 mm 下 ≈ 5.7k 三角一扇）
  与 `bakeReliefBandMaps(band, 512)` + `buildReliefBandPlane(band)`（贴图版，≈ 0 三角）；
- 贴图版的材质：木作 `woodMaterial` 克隆一份挂 normal/cavity——**一栋建筑里所有贴图版绦环板共用同一个材质实例**（否则 `mergeByMaterial` 每扇一个桶，draw call 炸）；
  纹样 seed 按扇轮换但**贴图只烤 4 张**（`XIFANCAO_SEEDS` 四个种子各一张，UV 偏移选），不许每扇烤一张。

### AS2 · 按角色分配表示（AQ-b 之前的静态分档）

| 格扇 | 表示 | 理由 |
|---|---|---|
| **正门当心间两侧、门道两旁**的格扇（玩家穿门必贴着走的那 ≤ 4 扇） | 几何版 | 视张角最大（1.4 m 高、0.5–1 m 站距，带子 ≥ 100 px） |
| 正门其余格扇、全园其他建筑的格扇 | 贴图版 | 中景以外几何与贴图 diff < 0.5 色阶（AO 实测） |

`makeGeshan` 加一个参数 `tiaohuan: 'geo' | 'tex'`，**默认 `'tex'`**；只有 `building.ts:1465` 那一路（正门板门两侧）按扇序传 `'geo'`。
这是临时的按角色分档，**AQ-b 会把它改成按距离分档**——所以两种表示的接口要留干净：同一个 `band`、同一个落位、只换 mesh。

### AS3 · 拆掉旧的

绦环板那一段的 `ridgeTube` + `SphereGeometry` 叶点**全部删除**（两种模式下都不再有）。裙板的圆饰、台矶的老圆管**不碰**。

## 判据

- 新机位 `cu_tiaohuan`（`group: 'closeup'`，站 (60.6, 239.6) 正对东梢间格扇的绦环板，pitch ≈ −0.15）：
  **带子在画面里 ≥ 100 px 高**（写进回报，与台矶那 32 px 对照）；正面读得出叶面与主脉，斜看（复用 `cu_lattice` 机位）读得出浮起；
- 几何版 vs 贴图版：`cu_tiaohuan` 换 `?tiaohuan=tex` 拍一张，`pixel-diff --mean` **带区** < 2 色阶算贴图版够用；> 2 也如实报（那说明人眼高度上贴图版不够，AQ-b 的距离档就有存在的理由）；
- **预算**：`gate_approach` ≤ **+2%**（4 扇几何 ≈ 23k + 阴影 ≈ 46k，+1.1%；留余量给贴图版材质桶）；`xiaoxiang` ≤ **+0.5%**（只有贴图版）；
  draw call **每栋 ≤ +1**（贴图版材质桶），四镜合计 ≤ +6；超了归因，不许砍扇数糊弄；
- 旧管 + 球删干净：`gate_approach` 名册里 `SphereGeometry` 叶点消失（回报里贴 `manifest-diff` 的 LOST 行）；
- AO 的 `tests/ornament-scroll.test.mjs` 继续绿；新加 `tests/ornament-tiaohuan.test.mjs`：带长不整除抛错、几何版 ≤ 8k 三角一扇、四张贴图只烤四次；
- 九道门 + `playtest` PASS。

## 回报

带的尺寸与单元数；几何版每扇三角；贴图几张、材质桶几个；`cu_tiaohuan` 带高多少 px；几何 vs 贴图 diff；四镜前后；哪几扇走了几何版。
**规模**：中。**风险**：中——**最容易把 draw call 做爆**（每扇一个材质 / 每扇烤一张图）；**最容易顺手做裙板**（不许，裙板另开）。
