# 单子 AL：潇湘馆——竹夹路 · 苍苔布满 · 石子漫羊肠路 · 撤野花

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联。**
> 三角预算按 **`D-25`**（相对回归 ±3% + fps ≥ 45 参考），不再有 400 万那条线。
>
> **依据**：`knowledge/docs/qingshi/xiaoxiangguan.md`（考据，§1 与 §4 是本单的全部题面）+
> 台账 `docs/reviews/2026-09-14-mvp-four-regions.md` 的 **D7 / E1 / E2 / C6**。
> **用户 2026-09-15 拍板**：E1 甬路铺 **石子漫**；E2 甬路做成 **曲的**。
>
> **文件域**：`projects/daguanyuan/plan.json`（**只许改 `paths[]` 里 `xiaoxiangguan.court-path` 这一条**）、
> `projects/daguanyuan/scenes/xiaoxiangguan.json`、`builder/parts/zhiwu/bamboo.ts`、
> `builder/parts/zhiwu/vegetation.ts`（只许改野花密度那一段与 `REGION_TREES` 旁边加一张表）、
> `builder/compose/terrain-from-plan.ts`（只许改 `moss` 权重那几行）、`engine/core/TextureLab.ts`（只许改 `cobbleMaps`）、
> `builder/compose/composer.ts`（**只许新增** `scatters` 的消费函数，不改现有落位）、
> `tools/playtest.mjs`（只许改潇湘馆院内那几行航点）、`tools/capture.mjs`（只许**追加**一个 closeup 机位）。
> **AJ 正在 `forecourt-terrace.ts` / `baogushi.ts` / `building.ts` 里干活，AM 在 `plan.json` 的 `hills[]` 与 `projects/daguanyuan/scenes/cuizhang.json` 里干活——别碰。**
> `plan.json` 三个人都在改，**收工合回 `editor` 时只许 `git add` 自己那一条路径的 hunk**（`git add -p`），合回后重跑 `check:plan`。

---

## 题面（原文说这块地上该有什么）

> 「一進門，只見**兩邊翠竹夾路**，**土地下蒼苔布滿**，中間**羊腸一條石子漫**的路。」（`07-41`，第四十回）
> 「有**千百竿翠竹**遮映。」（`07-07`，第十七回）

**现状**：院墙围合 2110 m²，建筑 99 m²，竹 7 丛约 200 竿散点；甬路两侧是**草坪和大白野花**；
苍苔在渲但被亮绿草皮盖住；甬路是笔直的、贴图读成大块乱石板。

**房子不用动**（原文「小小兩三間房舍」，正房 9.6 m 一明两暗对得上）。
**一句话**：把草坪换成「竹夹路 + 苍苔」，把通用野花从这个区撤掉，把直路弯成羊肠、把石板换成卵石。

**四件的顺序**：AL1 石子漫 → AL2 羊肠曲路 → AL3 竹夹路 → AL4 苍苔与撤野花。
AL3 要沿着 AL2 定的折线种，所以路先定。AL1 与 AL2 都只动路，一起提交也行。

---

## AL1 · 石子漫（E1，用户拍板）

`plan.json` 里这条路 **已经是 `paving: "cobble"`**，`terrain-from-plan.ts` 也已把它喂进 splat 的 G 通道，
`surfaceAt` 回 `stone`。**数据没错，错的是贴图**：`engine/core/TextureLab.ts` 的 `cobbleMaps()` 读成大块乱石板。

**要的是「石子漫」**：小卵石拼出来的路面，清代园路做法——卵石 3–6 cm，密铺，常拼出简单花纹（这里不要求拼花，**密铺的小卵石**就够）。

- 改 `cobbleMaps()`：石子尺寸压到 **1.2 m 路宽里横着数得出 ≥ 15 颗**；石子之间是灰浆/泥缝不是黑线；
  法线要有每颗石子的圆凸（近看、低头时读得出）。
- `cobble` 这张贴图**只有潇湘馆甬路在用**（`splat.ts` 注释：G < 0.5 是 cobble，现只落在这一条），
  近门大路走的是 `slab`——**别动 slab**。
- `TerrainMaterials.ts` 头注里那段「单层 Worley 读成格子」的教训适用：**别用单一格子频率**，
  否则密铺卵石会读成网格。

**判据**：新追加一个 closeup 机位 `cu_xx_path`（`group: 'closeup'`，站在 (-105, 112) 附近低头 pitch −0.55），
**看得出是卵石，不是石板**；`grass_close` 那种低头距离下不闪不糊。

## AL2 · 羊肠曲路（E2，用户拍板）

`xiaoxiangguan.court-path` 现在是 x = −105 上五个点的直线，从月洞门 (−105,120) 到阶前 (−105,99)。

- **两端不许动**：(−105,120) 是月洞门（`X-03` 框景以它为视点），(−105,99) 是阶前。
- 中间改成**至少两道弯**的折线，**离直轴最大偏 ≥ 1.5 m**（羊肠要读得出，但院子只有 41 m 宽，别弯成盘山道）；
  折线点距 ≤ 3 m，`feather_m` 0.5 保持。
- **`basis` 要改写**：把「羊肠有原文；折线的具体走向是艺术选择」写进去，并记 2026-09-15 用户拍板。
- `tools/playtest.mjs` 潇湘馆院内航点（(−105,101)、(−105,98) 等）**沿新折线改**，脚下序列从月洞门到阶前必须**连续是 `stone`**，中间不许出现 `grass`/`moss`/`dirt`。
- `X-03`（框景，`underdetermined`）与 `X-05`（遮映）的 `status` 不许变；`check:experience` 照常绿。

**判据**：`moon_gate` 机位（门外南望）**看得见路在竹间拐进去、看不见尽头**——这就是「羊肠」。

## AL3 · 竹夹路（D7，本单的重头）

### 怎么落地——接缝②，`scatters[]` 的第一个消费者

`projects/daguanyuan/scenes/xiaoxiangguan.json` 的 `scatters: []` 在契约里（`builder/compose/scenes.ts` `SceneScatter`），
`check:scenes` 会校验它「只写条件不写坐标」，**但现在没有任何代码消费它**（`composer.ts` / `vegetation.ts` 里 grep 不到）。
本单让它第一次被消费：

```jsonc
"scatters": [
  {
    "part": "bamboo",
    "rule": "along-path",
    "path": "xiaoxiangguan.court-path",
    "offset_m": 1.1,          // 路牙外沿到竹丛心
    "pitch_m": 1.8,           // 沿路丛距
    "sides": "both",
    "jitter_m": 0.35,
    "basis": "07-41「兩邊翠竹夾路」。夹多近、丛距多少原文没给，是艺术选择(provenance.art)。"
  }
]
```

- **消费者写在 `composer.ts`**，一个函数，只认 `rule: "along-path"`：读 plan 里同 id 的路，
  沿折线按弧长取样，两侧各偏 `offset_m`，交给 `occupancy.ts` 过一遍（**不许进墙、不许进房子 footprint、不许压到路面**），
  剩下的点交给竹子构件。**不要做通用的散布 DSL**（`D-18`：别让 compiler 吞掉大观园）。**一种 rule，一个函数，够用为止。**
- `check:scenes` 要能列出「这条 scatter 会落多少个点」（照它现在列规则落区的样子加一行）。

### draw call 是这一件的死穴

`bamboo.ts` 每个 part = 4 个 InstancedMesh（竿/枝/叶/土丘），**`assembleStatic` 不合并 InstancedMesh**。
沿 21 m 路两侧按 1.8 m 丛距是 **24 丛 → 96 个 draw call**，直接把 `xiaoxiang` 镜的 250 calls 顶到 350。**不许这么做。**

正解：`bamboo.ts` 导出一个 **`buildBambooRow(seeds: {x,z,culms,spread}[]): PartBuild`**，
把整列竹子的所有丛塞进**同一组四个 InstancedMesh**（`grove` 变体已经这么干了——五丛塞同四个 mesh 仍是 4 call），
消费者把 along-path 算出的所有点一次交给它。**整条竹夹路 = 4 个 draw call。**

### 密度

「千百竿」是文学量词，考据 §6 说明不折成密度。**本单的数是艺术选择，留 `provenance.art`**：
院内竹竿总数 **≥ 600**（现约 200）；夹路那两列每丛 8–14 竿、高 4–6 m、`spread` 0.4–0.55，
**竹稍向路心微倾**（`tilt` 朝路，让路顶上合拢——「夹」字的来处）。
现有七丛点名竹**不动**（它们有自己的 basis，`X-05` 的遮映比例也是按它们算的）。

### 不许破的门

- `AF` 门（`occupancy.ts` `auditSolidVsWall`）：新种的竹**一根不许进墙**——上一轮就是竹子穿墙被用户抓的。
- `X-05` 遮映比例 `[0.1, 0.5]` **不许改**。它的视点 (−94,124) 在院墙外东南，看正房；
  夹路竹在院内沿 x≈−105 一线，理论上不进这条视线的 `filters`（它只算 `scene: xiaoxiangguan` 的 `part: bamboo`——**新竹也是 bamboo，会被算进去**）。
  跑完 `check:experience` 看比例落在哪：**若超过 0.5，不许调 ratio，回报**——那说明夹路竹把「遮映」做成了「遮挡」，是密度题不是门的题。

**判据**：`xiaoxiang` 机位（进了月洞门）**两侧是竹、路在竹间**；竹竿计数 ≥ 600（从 roster 或 InstancedMesh.count 统计，写进回报）；
`xiaoxiang` 镜 draw call 相对开工前 **≤ +6**。

## AL4 · 苍苔布满 + 撤野花（D7 的另一半，C6 的潇湘馆那一条）

### 苍苔压草

`terrain-from-plan.ts`：`moss` 来自院墙的 `mossInside: true`（已挂），但最终

```
moss = clamp(moss) * (1 - path.w*0.85) * (1 - max(cobble,slab)) * 0.85
grassOut = grass * (1 - moss*0.55) - soil
```

草只让了 55%，所以院内还是草坪。**改成院内苔为主**：`moss` 的 0.85 抬到 0.95 一档、`grassOut` 里草让给苔的系数抬到 0.9 一档——
具体数是观感标定（考据 §6 第 4 条说了这不是考据题），**调到 `xiaoxiang` 与 `moon_gate` 两镜里院内地面读成「苔地」而不是「草坪」为止**，
然后把最终数写进注释与回报。**露土 `soil` 在苔上要退**（现有 `(1 - min(1, moss*1.2))` 大概够，看图定）。

**只影响带 `mossInside` 的墙围出来的地**——正门、沁芳没有 `mossInside`，不会被波及；收工用 `pond_reveal` / `gate_approach` 两镜确认没变。

### 撤野花

`vegetation.ts` 野花散布的 `density` 函数（`drifts = poissonScatter({... density: (x, z) => ...})`）
**完全不认区**——里面的 `green` / `skirt` 两项还是 pallet-town 的镇中心坐标（`Math.hypot(x, z - 6)`）。

- 在 `REGION_TREES` 旁边加一张 **`REGION_GROUND_FLOWERS: Record<string, number>`**（0–1），
  野花 `density` 乘上 `regionOf(x,z)` 查到的系数；**没写的区默认 1（行为不变）**。
- `xiaoxiangguan: 0`，basis 写「07-41 只有竹、苔、石子三样；07-07 加梨、蕉；没有草甸野花」。
- **`green` / `skirt` 那两项遗留不要顺手改**（标准动作第 13 条）——记进 `docs/reviews/`，回报里点名。
- 梨花、芭蕉不在本单（芭蕉没有构件，归 P3）。

**判据**：院墙内野花实例数 **= 0**（统计写进回报）；院外（东侧墙外）野花照旧。

---

## 本单开工前的基线

按标准动作第 8 条，**开工时自己量三次取中位数写在这里**（AK 落地前用 A/B 模式，`--tolerance 0.03`）。
2026-09-15 派 AJ 时的读数供参考：

```
xiaoxiang       250 calls  3251k tris  47 fps
gate_approach   267 calls  4188k tris  47 fps
mound_block     254 calls  4181k tris  48 fps
grass_close     291 calls  4334k tris  48 fps
```

**预算**（按 `D-25`）：
- `xiaoxiang` 镜：竹从 200 竿到 600+ 竿，**三角会涨，这是本单买的**。上限 **3.75M**（约 +15%），draw call **≤ +6**；
  超了如实报并归因（是竿、是叶、还是苔的 splat？），不许自己把竹砍稀糊弄过去。
- 其余三镜：**±3% 内**（本单不该碰它们；`cobbleMaps` 改动不影响 slab，`moss` 改动只在 `mossInside` 围内）。
- fps：`xiaoxiang` 镜 **≥ 45**，三次中位数。

## 验收

- 四件各一个提交（AL1+AL2 可合一个）；每件一张对照图（before 在开工时先拍好：`xiaoxiang` / `moon_gate` / `cu_xx_path`）；
- 九道门 + 198 tests + `playtest` PASS；脚下序列月洞门→阶前连续 `stone`；
- 对账门仍 **21/25**（4 个缺项是翠嶂与沁芳的，不归本单，AM 会动其中两个）；接缝门 0 处；`AF` 门 0 条；
- `X-03` / `X-05` status 不变；
- 竹竿数、野花数、`moss`/`grass` 最终系数、四镜三角与 draw call 前后、fps 中位数——**全写进回报**。

## 回报

along-path 消费者怎么写的、落了几个点、被 occupancy 挡掉几个；`buildBambooRow` 的接口；
路折线最终几个点、最大偏离；`cobbleMaps` 改了哪几个频率；苔草系数最终定在多少、图上怎么看出来的；
`X-05` 跑出来的比例；预算前后。

**规模**：中。**风险**：中——**AL3 最容易把 draw call 做爆**（每丛一个 part 那条路不许走）；
**AL4 最容易调过头**（整个院子变成一块暗绿地毯，苔要「成斑」不要「刷漆」）；
**AL2 最容易弯成盘山道**（41 m 宽的院子，两道弯、偏 1.5–2.5 m 就是羊肠）。
