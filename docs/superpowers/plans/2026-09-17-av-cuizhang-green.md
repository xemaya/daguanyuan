# 单子 AV：翠嶂第二轮——主组上轴、石脚、树改种的、三层绿

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联；#15 适用：开工先读 `knowledge/docs/scenes/cuizhang.md`，收工必须改它。** 预算按 `D-25`。
> 依据：用户 2026-09-17 复走翠嶂「山很秃、没有翠的感觉、绿植杂乱无章；石头和树木凌乱穿插」；诊断与需求在 `knowledge/docs/scenes/cuizhang.md` §6 / §7（`D-29`）。
> 用户已拍板（2026-09-17）：① 山上树按十棵量级；② 山体地表从草坪改成偏暗的苔地。
>
> **文件域**：
> AV1 = `projects/daguanyuan/plan.json`（只许改 `cuizhang.screen-rocks` 的 x/z、`hills[]` 加一条土台、`experience` X-04 的 `note`）、`projects/daguanyuan/scenes/cuizhang.json`；
> AV2 = `builder/parts/zhiwu/vegetation.ts`（`treeDensity` / `HERO_TREES` / 新增读 scenes 的树）、`projects/daguanyuan/scenes/cuizhang.json`（`clearances` / 新 `trees[]`）、`builder/compose/scenes.ts`（只许加 `trees[]` 的类型与校验）；
> AV3 = `builder/compose/terrain-from-plan.ts`（只许改苔权重那几行）、`builder/parts/zhiwu/vegetation.ts`（`bushDensity`、藤萝锚点、峰脚蕨簇）、`builder/parts/shishan/baishi.ts`（只许加导出峰顶 / 肩顶点的函数）；
> AV4 = `builder/parts/shishan/baishi.ts`（新变体 `skirt*`）、`projects/daguanyuan/scenes/cuizhang.json`（placements）；
> AV5 = `tools/tree-census.mjs`、`tools/experience-audit.mjs`（只许加「白石组」参照点的**量法**，不加门）。
> **不碰**：题字石（AM3）、石栈桥、山高 4 m（AM2 反算成立）、石洞（07-79 另开单）、正门任何文件（`D-28` 冻结）。

---

## 结论先放

翠嶂现在是「五组白石柱插在一片黄绿果岭上，三十六棵撒出来的树盖在柱顶」。四个病：门轴 x=55 上没有石头；树是背景散布落的，山越高树越密；灌木 0、藤萝 0；峰立在草皮上没有山脚。
这一单按「先立骨、再穿衣」的顺序做：**AV1 主组上轴 → AV4 石脚 → AV2 树改种的 → AV3 三层绿 → AV5 判据**。每一步都有可量的数，数在 `knowledge/docs/scenes/cuizhang.md` §7 的判据表里。

## AV1 · 主组上轴 + 土台

**病**：五组峰在 x = −40 / −18 / 8 / 38 / 70，门轴 x=55 正穿 38 与 70 之间 32 m 的最宽空档。`gate_face`（门内北望）是秃丘加一排槐。

**做法**：
1. `plan.json` `cuizhang.screen-rocks` 锚点从 (8,202) 改到 **(53,200)**——偏轴 2 m，最高峰再向东偏 1 m 左右，让羊肠径从西侧溜过去（园林忌正对；恭王府独乐峰在轴上但那是府第）。`projects/daguanyuan/scenes/cuizhang.json` `named[0]` 不动（它读锚点），`basis` 改写：不许再说「group1 是进门第一眼正对的那一组」是因为它在 (8,202)。
2. 主组换 **5 块、最高一组**（`baishi.ts` 现有 `group*` 轮换里挑 5 块的，或加 `group9`），峰顶实测高度写回报。
3. 其余四组按 `dx` 相对新锚点重排，保持「相邻间距递变、dz 一北一南」：建议世界 x ≈ −40 / −16 / 10 / 32 / 74，dz 交替 +5 / +2 / −3 / +3 / −2。**相邻组间距不许有两段相等。**
4. `plan.json` `hills[]` 加一条 **`hill.cuizhang.zhutai`**：绕 (53,200) 半径约 10 m 的八边形，`height_m: 2`，basis 写「主组土台，让正对门那段坡从 12° 抬到 25° 左右」。`terrain-from-plan.ts` 的 `hillSum` 是叠加的，不用改代码；**做完量一下 (53,200) 的地面标高与 (53,212) 到 (53,200) 的坡度写回报。**
5. X-01 / X-02 / X-04 三条断言重跑必须仍绿（`npm run check:experience`）。

**⚠️ 判断题**：主组挪走后，(8,202) 那一带只剩 g3 (−16) 与新 g1' (10) 两组，`mound_block` 机位 (8,208.5) 朝北看到的是什么——**拍出来放回报，不许自己改机位**；机位归验收人。

## AV4 · 石脚：峰从石壁里长出来

**病**：峰直接从草皮冒出来，像石柱阵；两块太湖石 `peak2` / `edge3` 整块搁在草上。

**做法**：
1. `baishi.ts` 加低矮变体 **`skirt3` / `skirt4` / `skirt5`**（3–5 块，高 0.8–1.6 m，宽 1.2–2.5 m，`clipToGround` 半埋 30–40%，顶点色带同一路苔）。
2. 每组峰**前方**（朝门那一侧，世界 +Z）摆 1–2 件 skirt，与峰脚搭接、缝隙留 0.2–0.5 m 给蕨簇；主组前方 2 件、东西两端各 1 件。写进 `projects/daguanyuan/scenes/cuizhang.json` `placements`，每条带 basis。
3. `taihu:peak2` / `taihu:edge3` 两条 placements：改 `dy` 埋下四成，并挪到主组石脚里。
4. 三角预算：每件 skirt ≤ 2 k 三角，总增量写回报。

## AV2 · 树：撒的改成种的

**病**：山体多边形内 36 棵（槐 22 / 松 13 / 柏 1），全园 180 棵的 20%；21 棵在山脊南侧挡在门与峰之间；散布只认 g1 的占地登记；`treeDensity` 的 `land` 项随标高从 0.045 升到 0.595，山越高树越密。

**做法**：
1. `vegetation.ts` `treeDensity`：落在任一 `plan.hills[]` 多边形内（含羽化带 3 m）的点返回 0。**不是**只对翠嶂——山上的树以后一律点名种。
2. `scenes.ts` 加 `trees?: SceneTree[]`：`{ x, z, species, scale?, tilt?, tiltAz?, tag, basis }`，校验 species 在 `SPECIES_INDEX` 里、坐标在区多边形内、必须有 basis。`vegetation.ts` 读 `getScenes()` 把它们与 `HERO_TREES` 同一路 `placeTree`。
3. `HERO_TREES` 里翠嶂那 5 棵删掉，搬进 `projects/daguanyuan/scenes/cuizhang.json` `trees[]` 重排。**总数 8–12 棵**，规则：
   - 每组峰至多一棵**松**，落峰的东侧或西侧 4–6 m（不落南侧），`tilt` 0.14–0.21 rad（8–12°）、`tiltAz` 指向峰——「松探石」；
   - **峰南侧 6 m 内 0 棵**；
   - **槐**只放东西两端收山脚（x < −30 或 x > 72），共 2–3 棵；
   - 从 `gate_face` / `mound_block` 看，任一组峰顶要么衬天、要么衬后面的树冠，**不许压在冠下**——用图判。
4. `projects/daguanyuan/scenes/cuizhang.json` `clearances`：五组峰 + 题字石全部登记（现在只有 g1）。`hx/hz` 用 `buildBaishiGeometry(variant)` 量，不估。

## AV3 · 三层绿：苔地、灌丛、藤萝

**病**：「翠」在原文是石上的苔与藤，现在灌木全园 0 株、藤萝 0 根、苔只有峰身顶点色，山体地表是草皮。

**做法**：
1. **苔地**（用户已拍板）：`terrain-from-plan.ts` 苔权重加一项：`hills[]` 条目带 `mossCover`（翠嶂主体 0.55、土台 0.7）时，`moss = max(moss, hillMask × mossCover × shade)`，`shade` = 峰组 6 m 内 1.0 → 12 m 外 0.6 的平滑衰减（峰位读 scenes）。现成 splat B≥0.5 苔通道，苔多草稀那几行已有。**不动铺装、不动土路。**
2. **峰脚蕨簇**：现有 `fern` 杂草几何按峰位加一路密度：峰脚 0.5–4 m 环带密、4 m 外归零；每组 15–30 簇。
3. **灌木**：`bushDensity` 里老镇子常量（`nearWood` |x| 11.5–21、`nearSouth` z 18.5–28）删掉，换成三项：贴石（peak 位 2–7 m 环带、背阴半圆权重 1.0、向阳 0.4）、贴建筑角（现有 `corner` 项不动）、贴林缘（`treeDensity` 低频 clump 的边界带）。翠嶂目标 **40–60 株**，成丛 3–7 株。全园其余区跟着受益，回报里写各区灌木数。
4. **藤萝**：`baishi.ts` 导出 `baishiCrownPoints(variant)`（每块峰顶 + 两肩的局部坐标）；`vegetation.ts` 藤萝那段改为读 scenes 的 baishi 件（named + placements，锚点 + dx/dz + yaw）算世界锚点，删掉写死的四个旧坐标。每组 2–4 条、长 1.5–3 m、挂**背阴面**（北 / 西北）。现有 `wisteriaDrapeGeometry` 直接用。**实例数写回报（判据 ≥ 8）。**
5. 峰身苔斑参数（`BAISHI_MOSS`）不动——AM4 已按 `mound_west` 调过。

## AV5 · 判据接进流程

1. `tools/tree-census.mjs` 加 `--json` 输出与 `--ridge` 参数；输出已含 `treesOnHill / bushesOnHill / peakSouth6m / wisteria`。
2. `tools/experience-audit.mjs`：给 approach_axis 加一种**只量不判**的参照点 `rocks`（scenes 里 baishi 件的世界 bbox），打印射线到最近白石组的夹角。**不改 X-04 的 status 判法、不加门**（「观感迭代期不加门」）。

## 本单开工前的基线

- `node tools/tree-census.mjs --url …`：36 / 0 / 5 / 0（树 / 灌 / 峰南侧 6 m / 藤）。
- 四镜 `--baseline` 现值见 `projects/daguanyuan/perf-baseline.json`。
- 先拍 before：`gate_face`、`mound_block`、`mound_west`、`cu_inscription`、`gate_approach`、`xiaoxiang`。

## 验收（判据表抄自 `knowledge/docs/scenes/cuizhang.md` §7）

| 判据 | 目标 |
|---|---|
| 山体多边形内树 | ≤ 12 |
| 任一组峰南侧 6 m 内的树 | 0 |
| 山上灌木 | ≥ 40 |
| 藤萝实例 | ≥ 8 |
| `gate_face` | 画幅中央 40% 内有一组峰，峰顶衬天 |
| X-04 射线到白石组 | 夹角 ≤ 15°（量，不判） |
| 四镜 `--baseline` | ±3%；`mound_block` 站位不动 |
| 九门 + `playtest` | 全过，航点不变 |
| X-01 / X-02 / X-04 | 仍绿 |
| 对账门 | ≥ 23/25 |
| `knowledge/docs/scenes/cuizhang.md` | §4 / §5 现状列与 §6 台账改成做完之后的样子；`make-sketch.mjs` 重画 |

## 回报

主组新锚点与峰顶高；土台处地面标高与坡度；五组新坐标与相邻间距；skirt 件数与三角增量；树的清单（种 / 坐标 / 倾角）与普查四个数前后；各区灌木数；藤萝实例数；X-04 到白石组的夹角；四镜前后；六张前后图拷到 `shots/AV/`。
**规模**：大。**风险**：AV1 挪主组会牵动 X-01 / X-02（射线穿的是土山多边形，多边形没动，应当仍绿，但要跑）；AV3 的苔地一旦权重过头会把翠嶂读成一片墨绿——`mossCover` 上限 0.7，超过要人判。
