# 单子 AL-b：潇湘馆尾账——灌木稳定化 · 路牙贴石面 · 框景透视缝 · 院内压草 · 土丘 · 5d 余斑

> **依据**：`docs/reviews/2026-09-15-detail-review-response.md` §22（AL 验收）、`docs/DECISIONS.md` **`D-32`**（用户 2026-09-23 四条拍板）、
> `docs/PITFALLS.md` **`P-33`**、`knowledge/docs/scenes/xiaoxiangguan.md` §6 未决 1 / 6 / 8 / 9。开工前这四处全读。
>
> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md` 全部 15 条，本单不再内联。**
> 三角预算按 `D-25`；基线已于 2026-09-23 按 HEAD `93765e80` 重写（`perf-baseline.json` history 第 12 行）。
>
> **文件域**：
> `builder/parts/zhiwu/vegetation.ts`（**只许**改：灌木散布段 `bushSpots` / `bushBuckets`；三叶草段与 `Weeds_*` 段的 `density`；在 `REGION_GROUND_FLOWERS` 旁加区系数表）、
> `builder/parts/zhiwu/bamboo.ts`（**只许**改 `moundGeometry` 与土丘的材质色）、
> `builder/parts/pudi/luya.ts` **或** `builder/compose/terrain-from-plan.ts` 里路面 splat 的半宽 / 羽化那几行（二选一，见 b1）、
> `builder/compose/terrain-from-plan.ts:946` 那一行露土阈值（b3）、
> `builder/compose/scatter-along-path.ts` + `projects/daguanyuan/scenes/xiaoxiangguan.json` 的 `scatters[]`（b4 的轴线让位）、
> `tools/experience-audit.mjs` 的 `auditFilteredView`（b4：让它数到 `scatters[]` 的落点）。
> **不碰**：`engine/scatter/poisson.ts`（稳定档已经有了，只许调用；要改就停下回报）、`plan.json`、`tools/shot-list.mjs` 与任何机位、
> `perf-baseline.json` / `coverage-baseline.json`、正门与翠嶂的任何构件文件、`X-05` 的 `ratio` 与 `from`（`D-32` ①：不抬上界、不换视点）。

---

## b0 · 灌木走稳定散布（`P-33`，`D-32` ③）——**先做**

**病**：`vegetation.ts` 灌木丛心是带 `density` 的 Bridson，丛内株位与分桶又吃同一条顺序 `rng`。AL2 改了潇湘馆的路，
全园 355 丛灌木里 293 丛换了位置，正门 60 m 内 61 丛（正门 `D-28` 已冻结）。

**做法**：丛心改走 `poissonScatter` 的先撒后筛档（与树的 `copse` 同一档，见 `vegetation.ts:1871` 附近 AV-b1 的写法）；
丛内株数 / 散开半径 / 株位 / 分桶**全部用丛心坐标哈希派生的局部 rng**，不再碰全局 `rng`。筛后总量按「筛后 ≈ 现在的 354」定撒的密度，回报写清怎么定的。

**这一改本身会把全园灌木再洗一次，这是用户认了的**（`D-32` ③：冻结态以本单合回后为准）。

**判据**：
- **稳定性实验**（这是本件的真判据）：在自己的 worktree 里**临时**把 `plan.json` 的 `xiaoxiangguan.court-path` 中间一点挪 0.5 m，
  前后各 `node tools/tree-census.mjs --dump <file>` 一份，diff 灌木：**潇湘馆院墙 10 m 以外逐株为 0 差异**。实验改动不许提交。
- 同一实验下树仍逐株不变（AV-b1 不许被带坏）。
- 全园灌木 330–380 丛；翠嶂山上灌木 35–50 株（AV 的判据区间，`tree-census --json` 的 `bushesOnHill`）。
- 拍 `gate_face` / `gate_approach` / `mound_block` 存进 `shots/AL-b/`——**这就是正门新的冻结态**。

## b1 · 路牙贴住石面

**病**（验收人 2026-09-23 量）：路牙固定落在中线外 0.74 m（`halfWidth 0.6 + 肩 0.10 + 半宽 0.04`），
`surfaceAt` 横切 9 段量到的石面边缘却是 **0.36–0.78 m**，弯外侧顶到 0.72–0.78，弯内侧只到 0.36–0.44。
每道弯内侧都有一条 0.24–0.38 m 宽的草缝，`cu_xx_path` 左侧那条路牙从草里斜穿过去。

**做法**：二选一，选哪条写进回报——
(甲) 路牙偏距改成沿线**跟 splat 实际石面边缘**（按 `surfaceAt` 或 splat 的同一个距离场取）；
(乙) splat 石面按路牙内沿收，**弯内外对称**（先查清为什么现在不对称：是 splat 用了重采样 / 平滑后的折线，还是羽化的距离场不同）。

**判据**：9 段横切（`node tools/xiaoxiang-census.mjs <url>` 的 `cuts`：沿 `court-path` 每段中点取法向，±1.5 m、步长 0.02 m 采 `surfaceAt`；路牙内沿在中线外 0.70 m），
两侧**石面边缘与路牙内沿之差 ≤ 0.05 m**；`cu_xx_path` 两侧看不到草缝；近门大路（slab，`width_m` 4.4）的路牙在 `gate_approach` 里不变或更贴。

## b2 · 竹丛土丘

**病**：竹夹路 18 丛下的落叶土丘在 `cu_xx_path` / `xx_court_gaze` 里是 18 块近黑的深褐斑，比竹子本身还抢眼，读成坑。

**做法**：土丘色改成苔 / 落箨的暗橄榄到灰褐（在苔地上要隐进去，不是另一种地），半径 `c.spread + 0.5` → 收到 `c.spread + 0.2` 量级，
边缘淡出加宽。**不许删土丘**（竿脚要埋住，`bamboo.ts:424` 的理由）。

**判据**：`cu_xx_path` 贴脸图里，土丘区像素的平均亮度与周边苔地之差 **≤ 15%**（回报写怎么取的区）；`xx_court_gaze` 里看不出 18 块黑斑。

## b3 · 5d 余斑

**病**：`patch_close` 右下（翠嶂山体多边形南缘，`hillMoss < 0.03` 那一带）仍有一块网格状红棕露土；`gate_face` 中央剩一抹淡红。

**做法**：`terrain-from-plan.ts:946`，要么把阈值下沿再压，要么改用 `hillMask × (mossCover > 0)` 当开关（AL 单子第 0 件给过的第二条路）。

**判据**：`patch_close` / `gate_face` 无红棕斑；`crest_on`、`mound_block`、`grass_close` 前后同机位对照不变。

## b4 · 框景透视缝（`D-32` ①）

**病**：AL3 之后月洞门框里正房几乎被竹墙整片挡住，`xx_court_gaze` 回望连月洞门也看不见——竹列恰好压在门轴上。
原文「千百竿翠竹**遮映**」是半遮半露。

**做法**：
1. **先修尺子**：`tools/experience-audit.mjs` 的 `auditFilteredView` 现在只数 `scene.placements`，`scatters[]` 落的竹一丛都数不到，
   所以 `check:experience` 报 0.25、门是绿的。让它也吃 `alongPathScatter` 的落点（`tools/check-scenes.mjs` 已经会当场算落点，照抄那套调用）。
   **修完先跑一次，不改任何竹子，记下 X-05 的真值**（AL 回报是 0.79）。
2. 在 `along-path` 规则里加一条**轴线让位**：丛心到「月洞门中心 (−105,120) → 正房明间 (−105,98)」这条线段的距离 < **1.0 m** 的丛不种
   （透视缝净宽约 2 m）。写成规则的条件，不写坐标黑名单。

**判据**：
- `moon_gate` 里正房明间的门窗**看得见一段**（前后对照图）；`xx_court_gaze` 里月洞门看得见。
- 竹分箱仍达 AL 判据：距路轴 0–1.5 m **≥ 120**、1.5–3 m **≥ 300**（`tools/xiaoxiang-census.mjs` 的 `bins`，`bamboo.culm` 实例）。
  「每 3 m 两侧各至少 1 丛」在透视缝经过的那几段**允许单侧**，回报列出是哪几段。
- `X-05`（修好尺子之后）落到 **[0.1, 0.5]**。
  ⚠️ **已知风险**：X-05 登记的视点是 **(−94,124)**，不在月洞门轴上；AL 的 agent 量过从这个视点看，竹子疏到 6 丛比例也还有 0.71。
  透视缝照做，**X-05 还超就停下拍图回报，不许调 `ratio`、不许动 `from`、不许为了凑数继续砍竹**——那是用户的裁量（`D-32` 的推翻条件）。

## b5 · 院内按区压草（`D-32` ④）

**病**：院内 `Clover` 992、`Weeds_*` 183，密度来自 `surfaceAt === "grass"`，与地形 `moss` 无关，所以院子读成亮绿草坪。

**做法**：照 AL4 野花那张 `REGION_GROUND_FLOWERS` 的写法，加 `REGION_CLOVER` / `REGION_WEEDS`（或一张两列的表），
系数落在**撒完点之后的坐标哈希筛子**上，不乘进 `density`、不动 `rng`（`P-28` / `P-33`）。`xiaoxiangguan` 的值自己调，写进注释与回报。

**判据**：
- 院内 `Clover` ≤ **150**、`Weeds_*` ≤ **60**（院墙多边形内按 mesh 名前缀累加，`@格号` 归并）。
- **院外逐株不变**：前后 dump 院墙外的三叶草 / 杂草实例位置，diff 为空。
- `xx_court_gaze` / `moon_gate` 院内地面读成**苔地**（splat 的苔色成主调），不是秃土——秃了就停下回报（`D-32` 的推翻条件）。

---

## 开工基线

`perf-baseline.json`（2026-09-23，HEAD `93765e80`，三次中位数）：

```
gate_approach   313 calls  4241509 tris  45 fps
mound_block     287 calls  4200307 tris  46 fps
grass_close     302 calls  4405081 tris  45 fps
xiaoxiang       247 calls  3653018 tris  44 fps
```

判据机位与 before 图：验收人的 `shots/AL-accept/run1/`（`moon_gate` / `xx_court_gaze` / `cu_xx_path` / `patch_close` / `gate_face` 等 10 镜）。
施工 agent 在自己的 worktree 里重拍一份 before，同机位同参数。

**预算**：四镜 ±3%。例外两个：**b0 重洗灌木会让远处三镜的 calls/三角跳**（AL2 那次是 draw call +7），如实报、按类归因；
b4 减竹会让 `xiaoxiang` 下降，降多少报多少。fps ≥ 45 是目标（`xiaoxiang` 现 44，竹竿 LOD 另有单子，本单不追）。

## 顺序与提交

`b0`（先定灌木，之后的图才有可比性）→ `b1` → `b2` → `b3` → `b4`（先修尺子、记真值，再让位）→ `b5`。**每件一个 commit**，`git add` 只按路径。
**合回前的最后一步**：拍 `gate_face` / `gate_approach` 存档（正门新冻结态），图拷到主检出 `shots/AL-b/`。

## 回报

b0 用了哪一档、筛后总量、稳定性实验的 diff 行数（院墙 10 m 内外分开报）、山上灌木数；b1 选甲还是乙、为什么原来不对称、9 段横切前后；
b2 色值与半径前后、亮度差怎么取的区；b3 选哪条；b4 修尺子后的 X-05 真值、让位后的值、分箱前后、哪几段变单侧；
b5 两个系数、院内株数前后、院外 diff；四镜三次连拍前后。

**规模**：小中，六件都小，b0 与 b4 各有一个坑。**风险**：
**b0 最容易写成「只换了 rng 种子」**——那样仍是 Bridson，下一次改路照样洗，稳定性实验一跑就红；
**b4 最容易为了凑 X-05 一路砍竹**，砍到「夹路」散掉——超了就停，不许砍；
**b5 最容易把院子压秃**——苔地不是秃地。
