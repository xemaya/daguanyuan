# 单子 AL：潇湘馆——竹夹路 · 苍苔布满 · 石子漫羊肠路 · 路边收拾

> **2026-09-21 按诊断重写。** 原稿（2026-09-15）的数全部过期：竹「现约 200 竿」实测 **2518**、
> 「撤野花」瞄错靶（镜头里抢戏的是花池不是通用野花）、「芭蕉没有构件」现已有 2 株、路牙 `luya` 当时还不存在。
> **依据换成 `knowledge/docs/scenes/xiaoxiangguan.md`（景需求文档，`D-29`）——§5 是病，§7 是判据，开工前全篇读完。**
> 考据背景仍见 `knowledge/docs/qingshi/xiaoxiangguan.md`。
>
> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md` 全部 15 条，本单不再内联。**
> 三角预算按 **`D-25`**（相对基线 ±3% 当门、fps ≥ 45 当目标）。
> **用户拍板**：2026-09-15 E1 甬路铺石子漫、E2 甬路做成曲的；2026-09-21 `D-30` 花池减量改素色小花、路牙留但压低压窄。
>
> **文件域**：
> `projects/daguanyuan/plan.json`（**只许改三处**：`paths[] xiaoxiangguan.court-path` 的 `points`/`basis`、
> 两个 `path-bed-{west,east}` 的 `bed.density`/`tints`/`basis`）、
> `projects/daguanyuan/scenes/xiaoxiangguan.json`（`scatters[]`）、
> `builder/parts/zhiwu/bamboo.ts`、`builder/parts/pudi/luya.ts`、
> `builder/parts/zhiwu/vegetation.ts`（**只许**改野花 `density` 那一段 + 在 `REGION_TREES` 旁加一张区系数表 + 花池花冠尺寸）、
> `builder/compose/terrain-from-plan.ts`（**只许**改 `moss` / `grassOut` 那几行）、
> `engine/core/TextureLab.ts`（**只许**改 `cobbleMaps()`）、
> `builder/compose/composer.ts`（**只许新增** `scatters` 的消费函数，不改现有落位）、
> `tools/playtest.mjs`（只许改潇湘馆院内那几行航点）。
> **不碰**：`tools/shot-list.mjs` 与任何机位（归验收人）、`perf-baseline.json` / `coverage-baseline.json`（归验收人）、
> `slab` 贴图、正门与翠嶂的任何文件、`vegetation.ts` 里 `green`/`skirt` 两项的 pallet-town 遗留坐标（标准动作 #13，记进回报即可）。

---

## 第 0 件 · 5d：翠嶂土台南脚露土（一行，AV-b2 补）

**不属于潇湘馆，是上一轮留的尾账，顺手带掉。**

`builder/compose/terrain-from-plan.ts:946`：

```ts
bareSoilAmount(grassCover.gapN(x, z)) * fallback * (1 - Math.min(1, moss * 1.2)) * (1 - smoothstep(0.15, 0.4, hillMoss)) * 0.9
```

土台南脚（z≈211–217）那一带是翠嶂主体多边形的南沿，`hillMask` 只有 0.3–0.4、`hillMoss ≈ 0.13–0.22`，
正好落在 `smoothstep(0.15, 0.4)` 的起点以下，露土几乎没被压，`gate_face` 里正对门那片 **splat 网格状红棕斑**就是它。

- 阈值改成 **`smoothstep(0.03, 0.12, hillMoss)`**（或用 `hillMask × (mossCover > 0)` 当开关，凡带 `mossCover` 的山体多边形内露土一律让位——两条都行，选哪条写进回报）。
- **判据**：`gate_face` 与临时机位 `patch_close` (55,219) 俯视，**正对门那片红棕斑消失**；`grass_close`（苔 ≈0.7，本来就干净）不变。
- **别的地方不许被波及**：`mound_block`、`crest_on` 前后同机位对照。

一个 commit，先做，先验。

---

## AL1 · 石子漫（E1，2026-09-15 用户拍板）

**数据没错，错的是贴图。** `plan.json` 这条路已经是 `paving: "cobble"`，`terrain-from-plan.ts` 已把它喂进 splat 的 G 通道，
`surfaceAt` 沿 x=−105 从 z=124 到 z=98.5 全程回 `stone`——验过了。问题在 `engine/core/TextureLab.ts:539` 的 `cobbleMaps()`：
它读成**大块龟背纹乱石板**，贴脸实测石块 **0.25–0.4 m**，1.0 m 净宽里横着只数得出 **3–4 块**。

要的是清代园路的「石子漫」：**卵石 3–6 cm 密铺**，石间是灰浆/泥缝不是黑线，法线要有每颗石子的圆凸。

- 改 `cobbleMaps()`：`cu_xx_path` 里**横着数得出 ≥15 颗**。
- **别用单一格子频率**（`TerrainMaterials.ts` 头注那段「单层 Worley 读成格子」的教训适用），否则密铺卵石会读成网格。
- `cobble` 这张贴图**只有潇湘馆甬路在用**（`splat.ts`：G < 0.5 是 cobble，现只落这一条），近门大路走 `slab`——**别动 slab**。

**判据**：`cu_xx_path` 横向计数 ≥15；`grass_close` 那种低头距离下不闪不糊；`gate_approach` 三角与 calls 在 ±3% 内（不该被波及）。

## AL2 · 羊肠曲路（E2，2026-09-15 用户拍板）

现状：五点纯直线 (−105,124)(−105,120)(−105,112)(−105,104)(−105,99)。

- **两端不许动**：(−105,124) 与 (−105,99)。月洞门锚点 (−105,120) 也不动（`X-03` 框景以它为孔）。
- z∈[99,119] 之间改成 **至少两道弯**的折线，**离直轴最大偏 ≥1.5 m 且 ≤2.5 m**（院子 41 m 宽，别弯成盘山道），折线点距 ≤3 m，`feather_m` 0.5 保持。
- **`basis` 重写**：羊肠有原文（07-41），折线具体走向是艺术选择；记 2026-09-15 用户拍板。
  **顺带**：`rock-01` (−105,112) 的名义是「石子漫成甬路」不是石头（已在 `accountedFor` 销账），路弯了之后它的位置语义要在 basis 里写清楚（景需求文档 §6 未决 2）。
- `tools/playtest.mjs` 院内航点沿新折线改，**脚下序列月洞门→阶前必须连续 `stone`**，不许出现 grass/moss/dirt。
- `X-03` / `X-05` 的 `status` 不许变。

**判据**：`xx_court_gaze`（院内回望月洞门）里**看得出路在拐**；`moon_gate` 里看得见路拐进竹间、看不见尽头。

## AL3 · 竹夹路（本单重头）

### 病不是数量，是位置

院内已有 **2518 竿**，但：竹的 z 范围只有 **86.1–110.3**，甬路是 z 99–124——**门内 z>110.3 的那 14 m 路，两侧一根竹都没有**。
按距路轴分箱：**0–1.5 m 只有 6 竿**、1.5–3 m 154、3–5 m 40、5–8 m 217、**>8 m 有 2101**。
**这一单不加总量，只把竹挪到/补到路两边。**现有七丛点名竹**不动**（各有 basis，`X-05` 的遮映比按它们算）。

### 怎么落地——接缝②，`scatters[]` 的第一个消费者

`projects/daguanyuan/scenes/xiaoxiangguan.json` 的 `scatters: []` 在契约里（`builder/compose/scenes.ts`，`check:scenes` 校验它「只写条件不写坐标」），
**但全仓没有任何代码消费它**。本单让它第一次被消费：

```jsonc
"scatters": [
  {
    "part": "bamboo",
    "rule": "along-path",
    "path": "xiaoxiangguan.court-path",
    "offset_m": 1.1,
    "pitch_m": 1.8,
    "sides": "both",
    "jitter_m": 0.35,
    "basis": "07-41「兩邊翠竹夾路」。夹多近、丛距多少原文没给，是艺术选择(provenance.art)。"
  }
]
```

- **消费者写在 `composer.ts`**：一个函数，**只认 `rule: "along-path"`**。读 plan 里同 id 的路，沿折线按弧长取样，
  两侧各偏 `offset_m`，过一遍 `occupancy.ts`（**不许进墙、不许进房子 footprint、不许压到路面**），剩下的点交给竹子。
  **不要做通用散布 DSL**（`D-18`）。一种 rule，一个函数，够用为止。
- `check:scenes` 加一行，能列出「这条 scatter 会落多少个点」。

### draw call 是这一件的死穴

`bamboo.ts` 每个 part = 4 个 InstancedMesh（竿/枝/叶/土丘），`assembleStatic` **不合并 InstancedMesh**。
沿 20 m 路两侧按 1.8 m 丛距 = 22 丛 → **88 个 draw call**，直接把这一镜的 251 calls 顶到 340。**不许这么做。**

正解：`bamboo.ts` 导出 **`buildBambooRow(seeds: {x,z,culms,spread}[]): PartBuild`**，
把整列竹子所有丛塞进**同一组四个 InstancedMesh**（`grove` 变体已经这么干——五丛塞同四个 mesh 仍是 4 call），
消费者把 along-path 算出的所有点**一次**交给它。**整条竹夹路 = 4 个 draw call。**

### 判据

- 沿新折线 **z∈[100,119] 每 3 m 一段，两侧各至少 1 丛**（这一段现在是全空的）。
- 距路轴分箱：**0–1.5 m ≥120 竿**（现 6）、**1.5–3 m ≥300 竿**（现 154）。用与诊断同一把尺子数（按 mesh 名解 `bamboo.culm` 的世界矩阵，`@格号` 归并），数字写进回报。
- 每丛 8–14 竿、高 4–6 m、`spread` 0.4–0.55，**竹稍向路心微倾**（「夹」字的来处）。
- **整条竹夹路 ≤4 draw call**；`xiaoxiang` 镜 draw call 相对开工前 **≤ +6**。
- **`AF` 门 0 条**——上一轮就是竹子穿墙被用户抓的。
- **`X-05` 比例落在 [0.1,0.5]**（现 0.21–0.25）。**超了不许调 ratio，停下来回报**——那说明夹路竹把「遮映」做成了「遮挡」，是密度题不是门的题。
- **判据机位**：`xiaoxiang` 与 `xx_court_gaze`，两侧是竹、路在竹间。

## AL4 · 苍苔布满 + 路边收拾

### 苔压草

`terrain-from-plan.ts` 现在：`moss = clamp(moss)·(1−path.w·0.85)·(1−max(cobble,slab))·0.85`，`grassOut = grass·(1−moss·0.55)−soil`。
草只让了 55%，所以院内还是草坪；实例层 `Moss_patches` 院内只有 11 片。

- 改成院内苔为主：`0.85` 抬一档、草让苔的 `0.55` 抬一档。**具体数是观感标定**（考据 §6 第 4 条说了这不是考据题），
  **调到 `xx_court_gaze` 与 `moon_gate` 两镜里院内地面读成「苔地」而不是「草坪」为止**，最终数写进注释与回报。
- **苔要「成斑」不要「刷漆」**——整院一块暗绿地毯是做过头了（本单最大的风险）。
- 露土在苔上要退（第 0 件改完的那一行同理，看图定）。
- **只影响带 `mossInside` 的墙围出来的地**（全园只有 `xiaoxiangguan.courtyard-wall` 一条）。
  收工用 `pond_reveal` / `gate_approach` 两镜确认没波及。

### 花池减量改素（`D-30`，用户 2026-09-21 拍板）

现状：`path-bed-west` 46 + `path-bed-east` 42 = **88 株，全部在甬路 3 m 内**，贴脸看花冠偏大，读成「草地雏菊」。
**用户裁的是「减量 + 改素色小花」，不是撤。**

- `bed.density` 0.85 → **≤0.5**；花冠尺寸改小（`vegetation.ts` 花池那一段）。
- `tints` 三色 → 只留**素白 / 淡黄**（去掉淡粉），`basis` 补一句用户拍板日期。
- **判据**：甬路 3 m 内花实例 **≤50 株**；`cu_xx_path` 贴脸里花不再是画面主角。

### 路牙压低压窄（`D-30`，用户 2026-09-21 拍板）

`builder/parts/pudi/luya.ts`：`CURB_W` 0.13 → **0.08**、`CURB_UP` 0.07 → **0.03–0.04**（读成「石压边」不是道牙）。

- **这是全园通用构件**：改之前先列出所有带 `paving` 的 `plan.paths` 与它们的 `width_m`，确认**没有别的窄路被连坐**（现在只有这一条 1.2 m），列进回报。
- **判据**：`cu_xx_path` 里牙不再像混凝土道牙；近门大路那一镜（`gate_approach`）的牙**看得出变化但不突兀**，如果觉得大路的牙不该跟着变，停下来回报（那就得按 `width_m` 加阈值）。

### 通用野花加区系数

`vegetation.ts` 野花散布的 `density` 函数**完全不认区**。

- 在 `REGION_TREES` 旁加 **`REGION_GROUND_FLOWERS: Record<string, number>`**（0–1），野花 `density` 乘 `regionOf(x,z)` 查到的系数；**没写的区默认 1（行为不变）**。
- `xiaoxiangguan: 0`，basis 写「07-41 只有竹、苔、石子三样；07-07 加梨、蕉；没有草甸野花」。
- **`green`/`skirt` 那两项 pallet-town 遗留坐标不要顺手改**（标准动作 #13），点名进回报。
- **判据**：院内通用野花（`Flowers_0..3`）实例数 **= 0**（现 142）；院外（东墙外）照旧；**花池不受影响**（它不走这条散布器）。

---

## 开工基线（施工 agent 自己量三次取中位数，写在这里）

2026-09-21 验收人在 5181 量到的（`ad999467`，与 `perf-baseline.json` 逐位相同）：

```
xiaoxiang       251 calls  3145172 tris  45 fps
moon_gate       269 calls  3238k   tris  45 fps
cu_xx_path      255 calls  2949k   tris  45 fps
xx_court_gaze   277 calls  4019k   tris  44 fps
grass_close     303 calls  4563365 tris  47 fps
gate_approach   310 calls  4540551 tris  45 fps（基线）
mound_block     293 calls  4430711 tris  46 fps（基线）
```

**before 图**：`shots/AL-diag/before/`（验收人已拍：`moon_gate` / `xiaoxiang` / `cu_xx_path` / `xx_court_gaze` / `grass_close`）。
施工 agent 在自己的 worktree 里**重拍一份 before**（同机位同参数），after 与它对照。

**预算**（`D-25`）：
- `xiaoxiang` / `moon_gate`：本单买细节的地方，**上限 +8%**（`xiaoxiang` ≤ 3.40M），draw call **≤ +6**；
- `gate_approach` / `mound_block` / `grass_close`：**±3% 内**（第 0 件动翠嶂露土，`gate_face` 会变，那一镜不在四镜里，但四镜仍要在限内）；
- fps ≥ 45（三次中位数）。
- **AV 那一轮把四镜余量吃光了**（`perf-baseline.json` history 第 11 行）。超了如实报并**按视锥逐类数三角**归因（是竿、是叶、还是苔的 splat），**不许砍竹糊弄**。

## 顺序与提交

`5d` → `AL1+AL2`（都只动路，可合一个）→ `AL3` → `AL4`。**AL3 要沿 AL2 定的折线种，所以路先定。**
**每件一个 commit**，`git add` 只按路径。

## 验收（验收人自己跑，`docs/WORKFLOW.md` §3）

- `npm run check:all` exit 0（九门 + 241 tests）、`playtest` PASS、脚下序列月洞门→阶前连续 `stone`；
- 四镜 `manifest-diff --baseline`，`xiaoxiang`/`moon_gate` 按上面的 +8% 档；
- `X-03` / `X-05` status 不变，`X-05` 比例落区间；`AF` 门 0 条；对账门不降；
- 判据逐行量：竹分箱、花池株数、院内野花数、卵石横向计数、路偏离量、苔草系数；
- 图：`cu_xx_path` / `xx_court_gaze` / `moon_gate` / `xiaoxiang` 前后同机位，拷到主检出 `shots/AL/`；
- **收工必须改 `knowledge/docs/scenes/xiaoxiangguan.md`** 的 §4 / §5 现状列与 §6 台账（只许写量过的数）。
  **平面不归你**：`knowledge/docs/scenes/xiaoxiangguan.svg` 已经画好（2026-09-21），路弯了、竹补了之后由**验收人**重画——
  `make-sketch.mjs` 在 `knowledge/docs/scenes/` 下，不在你的文件域里，别碰。

## 回报

第 0 件选了哪条改法；`along-path` 消费者怎么写的、落了几个点、被 occupancy 挡掉几个；`buildBambooRow` 的接口；
路折线最终几个点、最大偏离；`cobbleMaps` 改了哪几个频率、横向计数几颗；苔草系数最终定在多少、图上怎么看出来；
竹的距轴分箱前后；花池株数与花冠尺寸前后；路牙断面前后 + 带 `paving` 的路清单；`X-05` 跑出来的比例；六镜三角/calls/fps 前后。

**规模**：中。**风险**：
**AL3 最容易把 draw call 做爆**（每丛一个 part 那条路不许走）；
**AL4 最容易调过头**（整院变暗绿地毯，苔要成斑不要刷漆）；
**AL2 最容易弯成盘山道**（偏 1.5–2.5 m 就是羊肠）；
**路牙是全园通用构件**，改之前先看清楚谁在用。
