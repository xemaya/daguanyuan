# 单子 AL-c：潇湘馆收口——X-05 的 3D 尺子 · 路牙在画面上贴住 · 院内读成苔地

> **依据**：`docs/reviews/2026-09-15-detail-review-response.md` §23（AL-b 验收）、`docs/DECISIONS.md` **`D-33`**、
> `knowledge/docs/scenes/xiaoxiangguan.md` §6 未决 1 / 6 / 10。开工前这三处全读。
>
> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md` 全部 15 条，本单不再内联。** 三角预算按 `D-25`（基线 = `perf-baseline.json`，本单不该动三角）。
>
> **文件域**：
> 新建 tools/visibility-probe.mjs（新文件）（c1）；`tools/experience-audit.mjs` 与 `tools/check-experience.mjs` 里 filtered_view 的 3D 验法（c1）；
> 新建 projects/daguanyuan/experience-measured.json（新文件）（c1 的量值落盘）；`tests/experience-audit.test.mjs`（c1 的测试）；
> `builder/compose/nodes/terrain.ts`（c2 的 warp 缩放、c3 的苔色 / 院内草皮权重，**只许**动这两处）；
> `builder/compose/terrain-from-plan.ts`（c3，**只许**动 `mossInside` 那一路的定标）；
> `builder/parts/zhiwu/vegetation.ts`（c3，**只许**在 `REGION_COURT_GROUND` 里加项——如果诊断指向草丛实例层）。
> **不碰**：`plan.json`（**X-05 的 `hold` 归验收人摘**，你只回报数）、`tools/shot-list.mjs` 与机位、基线文件、`bamboo.ts`、竹的任何落位、
> `luya.ts`（b1 已在场层贴住，c2 只改着色器）。

---

## c1 · filtered_view 的 3D 可见性尺子（`D-33` ①）

**病**：X-05 的平面尺子拿 1.1 m 实体盘挡 24 条平面视线，不认墙、不认高度；登记视点 (−94,124) 在院墙外，读 0.79，眼睛看是半遮半露。

**做法**：
1. tools/visibility-probe.mjs（新文件）：在活世界里，把相机放在条目的 `from` 视点、人眼高 1.6 m，**朝向目标建筑的包围盒中心**，拍两遍 ID / 掩码渲染：
   - A：目标建筑的像素（竹子隐藏，其余一切照常——墙、别的房子、树都照样挡）；
   - B：目标建筑的像素（竹子显示）。
   - `ratio = 1 − B/A`。**墙挡掉的不计**，因为它在 A、B 里都被挡。A 小于某个像素下限（比如 < 800 px）就报「视点看不见目标」，不给比例。
   - 输出每个视点的 A、B、ratio，外加 A/B 两张掩码图存 shots/AL-c/probe/。
2. 量值落盘 projects/daguanyuan/experience-measured.json（新文件）：`{ "X-05": { ratio, A, B, from, measuredAt, commit, inputsHash } }`。
   `inputsHash` = `plan.json` 的 experience / 建筑 / 墙段 + `projects/daguanyuan/scenes/xiaoxiangguan.json` 的哈希。
3. `experience-audit.mjs` 给 filtered_view 加 `assert: "occlusion-ratio-3d"`：读落盘值比 `ratio` 区间；**inputsHash 对不上就红**，报「输入变了，先跑 visibility-probe 重量」。
   平面那把（`occlusion-ratio`）**保留**，给别的条目用。**X-05 的 `assert` 改不改归验收人**，你把两把尺子的数都报上来。

**判据**：
- 同一世界跑三次，A / B 逐位相同（掩码渲染不受动画相位影响——竹叶在风里动，要冻住，或者只数竿不数叶，回报写清选的哪条）。
- **突变**：竹全部隐藏 → ratio = 0；目标建筑隐藏 → 报「看不见目标」。
- 在 X-05 登记视点 (−94,124)、月洞门 (−105,122)、院内回望的反向 (−105,103→朝北) 三处各报一组 A / B / ratio。
- ⚠️ **不许**为了让 X-05 过去改 `from`、改 `ratio`、动竹。量出来多少报多少——超了是用户的裁量（`D-33` 推翻条件：不许再换第三把尺子）。

## c2 · 路牙在画面上贴住（`§6` 未决 10）

**病**：AL-b b1 之后，地形场里石面边缘在两侧都是 0.68 m、路牙内沿 0.70 m（`tools/xiaoxiang-census.mjs` 的 `cuts`）——场层贴住了；
但着色器查 splat 时 `sUv = tXZ.add(warpOff)`（`builder/compose/nodes/terrain.ts:86`，五层噪声合计可到 ±0.5 m 以上），画面上的石边被这层 warp 再推一次：
`cu_xx_path` 左侧仍有草缝、右侧石越过路牙。AL-b 临时把 warp 置零拍过（`shots/AL-b/b1-nowarp-experiment/cu_xx_path.png`），两侧都贴住。

**做法**：先不 warp 采一次 splat 取铺装权重 `pave0`，再用 `warpOff × (1 − pave0 的膨胀)` 去采正式那一次——铺装及其外缘 ~0.3 m 不 warp，草地照旧 warp。
注意 `uvTa / uvD / uvC / uvS` 也带 warp，只动决定「这一点是不是石面」的那一次采样。

**判据**：`cu_xx_path` 两侧看不到草缝、石不越牙；近门大路（`gate_approach` 与 AL 回报里那两个临时机位 (88,240)/(122,235)）石板边不越牙；
**非铺装区不许变**：`grass_close` / `mound_block` / `patch_close` 前后同机位、同帧冻结（`__freeze`）做 pixel diff，差值 > 8 的像素 < 0.5%。

## c3 · 院内读成苔地（`D-32` ④ 的收尾）

**病**：AL-b b5 把院内三叶草 992→127、杂草 183→41，**画面几乎没变**——`xx_court_gaze` / `moon_gate` 院内仍是亮绿草坪。
AL-b 的判断是亮绿来自地形 splat 本身（草皮贴图与 `mossCol` 混合后仍偏亮），但**没量**。

**做法**：**先诊断，后动手。**
1. 在 `xx_court_gaze` 与 `moon_gate` 上各做一张「院内可见地面」掩码（院墙多边形内、非石面、非竹非房），取掩码内平均颜色（HSL）。
2. 逐项关掉再拍，记平均色的变化：苔混合（`mossAmt` 置 0）/ 草丛实例（`Grass*`）/ 三叶草 / 杂草 / 草皮贴图换成土。
   **哪一项变化最大，病就在哪一项**——写成表进回报，再动手。
3. 按诊断改：可能是 `mossCol` 太亮太饱和、`mossAmt` 被 `bl.x + bl.y×0.6` 限住了上不去、或者草丛实例才是亮绿主体（那就在 `REGION_COURT_GROUND` 里加一项）。

**判据**：
- 院内地面掩码的平均色：明度 ≤ 院外同距离草坪的 **0.8 倍**，色相往橄榄/墨绿偏（数写进回报）；
- 苔要「成斑」不要「刷漆」：掩码内明度的标准差不低于改前的 70%；
- **不秃**（`D-32` ④ 的推翻条件）：土色像素 < 15%；
- 这一件是**观感**：收工拍 `xx_court_gaze` / `moon_gate` / `cu_xx_path` 前后对照，**停下给用户看，不许自己宣布「读成苔地了」**。

---

## 开工基线

`perf-baseline.json` 四镜（2026-09-23）；AL-b 验收的三次连拍在 `shots/ALB-accept/run{1,2,3}/`（`xiaoxiang` 254 / 3312662）。
before 图用 `shots/ALB-accept/run1/`，施工 agent 在自己的 worktree 里重拍一份同机位同参数。

**预算**：四镜三角 / calls ±3%（本单只动着色器和工具，不该动几何——动了要归因）；fps 目标 45（`xiaoxiang` 现 44，竹竿 LOD 另有单子）。

## 顺序与提交

`c1`（工具，先交数）→ `c2` → `c3`（诊断表一个 commit、改动一个 commit）。**每件一个 commit**，`git add` 只按路径。
**收工合回 editor**——这一轮门应该是绿的（X-05 仍挂 hold）；合不回就在回报第一行写「未合回」和原因。

## 回报

c1：三个视点的 A / B / ratio 各三次、冻结动画的办法、突变结果、落盘文件与 inputsHash 的构成；
c2：`pave0` 怎么采、膨胀多宽、pixel diff 三镜的比例、两处临时机位前后；
c3：诊断表（每项关掉前后的平均色）、病在哪一项、改了什么、判据三个数；四镜三次连拍前后。

**规模**：中（c1 是新工具，c2/c3 各小）。**风险**：
**c1 最容易量成「竹子挡住了多少画面」而不是「竹子挡住了多少正房」**——分母是 A（竹子不在时看得见的正房），不是全屏；
**c2 最容易把草地的 warp 一起关了**，草地会读成规则的方格——pixel diff 那条判据就是防这个；
**c3 最容易把整院刷成一块墨绿**——成斑那条判据与「给用户看」那一步都是防这个。
