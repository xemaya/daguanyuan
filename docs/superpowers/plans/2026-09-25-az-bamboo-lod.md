# 单子 AZ：竹子的距离档（竹竿 LOD）——先剖析，再切档

> **依据**：`docs/DECISIONS.md` `D-32` ②（基线抬了，竹 LOD 排在扩区之前）、`D-34` ③（潇湘馆收口，下一步竹竿 LOD → 稻香村）；
> `perf-baseline.json` history 第 12–13 行；`docs/reviews/2026-09-15-detail-review-response.md` §22 的归因（AL3 竹夹路 +620k）。
> **为什么在扩区之前做**：稻香村、蘅芜苑、怡红院都要大量植物；竹是全园唯一没有距离档的主力植被，不先把「远处便宜」的路打通，每加一个区都要再吃一次预算。
>
> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md` 全部 15 条，本单不再内联。** 三角预算按 `D-25`（基线 = `perf-baseline.json`，2026-09-25 第 13 行）。
>
> **文件域**：
> `builder/parts/zhiwu/bamboo.ts`（竿/枝/叶几何的低档版本、`makeInstanced`、`buildBambooRow`）、
> `engine/scatter/instancing.ts`（**只许新增**一个与 `ScreenSizeCull` 同路数的切档节点，不改 `ScreenSizeCull` / `InstanceCuller` / `ClusteredInstancePool` 的现有行为）、
> `builder/compose/composer.ts`（**只许**改竹那一段的挂载与 `CULL_DIST`，`:600` 附近）、`tests/`（新测试）。
> 新文件可以建在 `tools/` 下（剖析脚本，见 z0）。
> **不碰**：竹的任何落位（`scenes/*.json`、`scatter-along-path.ts`、`plan.json`）、`vegetation.ts`、地形、着色器（`builder/compose/nodes/`）、
> `tools/shot-list.mjs` 与机位、基线文件、`experience-measured.json`（**X-05 的 3D 量值是竹的函数**——z3 有专门一条）。

---

## 现状（验收人 2026-09-25 量，HEAD `e222a92f`）

- 全园竹是 3 个 InstancedMesh 类（外加每组一个土丘合并网格）：

  | mesh | 单实例三角 | 实例数 | 合计 | 几何 |
  |---|---|---|---|---|
  | `bamboo.culm` | 48 | 3 638 | 174 624 | 一段节间，8 棱 × 3 段环（`bamboo.ts:67`） |
  | `bamboo.branch` | 20 | 2 526 | 50 520 | 预弯细锥管（`:114`） |
  | `bamboo.leaf` | 4 | 56 310 | 225 240 | 披针叶卡，alpha 裁剪 0.5（`:158`、`:266`） |

  **全部 `castShadow = true`**（`:537`），阴影 pass 再画一遍，所以主 + 阴影约 90 万。
- 竿径 0.055 m 在屏幕上：10 m 外 ≈ 4 px、20 m ≈ 2 px、40 m ≈ 1 px、80 m ≈ 0.5 px（1600×900，按相机实读 fov）。
- `xiaoxiang` 机位看竹：0–10 m 约 15 万、10–20 m 约 27 万、20–40 m 约 2.6 万（主 pass 上限，不看视锥）。
- **竹夹路那一列有 120 m 硬切（`composer.ts:610`），点名落位的七丛没有**——`gate_approach` / `mound_block` / `grass_close` 离竹都在 80 m 以上，视锥框进院子时全部照画。
- ⚠️ **三角可能不是瓶颈**：`xiaoxiang` 331 万三角 44 fps，比 424 万三角 46 fps 的 `gate_approach` 还慢；fps 在 45 附近又有量化（`P-27`）。5.6 万张 alpha 裁剪叶卡的片元开销（含阴影）是头号嫌疑。**所以先剖析。**

## z0 · 剖析：竹的成本在哪一层（先交数，再动手）

在 `xiaoxiang` / `moon_gate` / `xx_court_gaze` / `gate_approach` 四镜，用 `capture.mjs` 同一套不限帧计时（`frameCostMs`，90 帧中位），逐项关掉再量：
竹叶 / 竹枝 / 竹竿 / 竹的投影（`castShadow = false`）/ 全部竹。写成表：每项关掉后 `frameCostMs` 与三角各降多少。
剖析脚本进 `tools/`（例如 tools/profile-toggle.mjs，按 mesh 名前缀开关，**默认不改世界**），以后别的植被也要用。

**停下回报的条件**：如果关掉全部竹，`xiaoxiang` 的 `frameCostMs` 降不到 0.5 ms，说明瓶颈不在竹——**停下拍表回报，不做 z1–z2**。

## z1 · 距离档

按 z0 的表挑**最贵的那一层先做**，给它两到三档：

- 竿：远档降棱数 / 去掉节环两段 / 把一竿的多段节间合成一段细长管（选哪条写回报）；
- 叶：远档按簇减片（留下的放大补面积，远看叶团体量不变），或换成更少的大卡；
- 枝：远档可以整档不画（20 m 外枝不到 1 px 宽）；
- 最远一档（竿 < 1 px）：整丛只留叶团体量的低模，或按 `ScreenSizeCull` 的路数整丛藏。

**切档机制**：新增一个与 `engine/scatter/instancing.ts` 的 `ScreenSizeCull` 同路数的节点——标 `isLOD`，挂在渲染器每次投影时调用的 `update(camera)` 上，
**按丛（或按簇格）一个距离、一个判断，不许每帧逐实例扫**（全园 5.6 万片叶）；**按屏幕像素切档**（竿径投影像素），不按固定米数；
滞回 10%（与地形分档、`ScreenSizeCull` 同一个比例）；**阴影相机沿用主相机的决定**（`ScreenSizeCull` 已有这条做法，照抄）。
同时把点名落位的竹丛也纳入与竹夹路一致的远处处理（`CULL_DIST` 或最远档，二选一，写理由）。

**判据**：
- `xiaoxiang` / `moon_gate` 三角与 `frameCostMs` 下降（数进回报；目标 `xiaoxiang` 三次中位 **fps ≥ 45** 且 `frameCostMs` 降 ≥ 15%——达不到就如实报，按 z0 的表说原因）；
- 另三镜（`gate_approach` / `mound_block` / `grass_close`）三角 **不升**；
- **近处不许变**：`cu_xx_path`、`xx_court_gaze` 近景冻结帧（`__freeze`）前后 pixel diff，差值 > 8 的像素 < 0.5%；
- **中景切档不许读得出来**：`moon_gate` / `xiaoxiang` 冻结帧 pixel diff 列出来并附 3× 放大裁图；
- **不闪**：在 `xx_court_gaze` → `moon_gate` 之间按 `record.mjs` 同路数录一段 6 s 慢推（走过切档距离），拷到 `shots/AZ/`，验收人看。

## z2 · 阴影

按 z0 的表：如果竹叶的投影是大头，远档的叶**不投影**（近档照投），或整竹远档不投影。**近处竹影不许少**——`xiaoxiang` 冻结帧上院地的竹影区域 pixel diff 列出来。

## z3 · 别碰坏的东西

- **X-05 的 3D 量值是竹的函数**（`tools/visibility-probe.mjs` 在 (−105,146) 看竹梢挡屋脊，26 m 外）。收工跑一次 `node tools/visibility-probe.mjs --url <你的> --entry X-05`（**不带 `--write`**），报 A / B / ratio；
  若与 0.3959 差 > 0.05，**停下回报**——那说明远档把竹梢的剪影改了，是观感回归，不许自己 `--write` 重写量值。
- `check:experience` 的 inputsHash 不该变（你没改落位）；变了就是动了文件域外的东西。
- 竹丛棚拍（`node tools/shoot-part.mjs --sheet`，竹那几格）近档前后不变。

---

## 开工基线

`perf-baseline.json`（2026-09-25，三次中位数）：

```
gate_approach   312 calls  4244033 tris  46 fps  4.2 ms
mound_block     280 calls  4195219 tris  47 fps  3.9 ms
grass_close     290 calls  4395937 tris  47 fps  5.3 ms
xiaoxiang       254 calls  3312662 tris  44 fps  4.7 ms
```

before 图：`shots/ALC-accept/`（四镜）与 `shots/alc-accept/`（标准 14 镜）；判据机位在自己的 worktree 里重拍一份，同机位同参数、冻结帧。

**预算**：本单是**减**预算的单子，四镜三角只许降；draw call 允许因分档 +≤ 6（每档一组 mesh），超了回报。

## 顺序与提交

`z0`（剖析表 + 工具一个 commit）→ **停下看表是否触发停止条件** → `z1`（最贵那层一个 commit，别的层各一个）→ `z2` → z3 核对。每件一个 commit，`git add` 只按路径。
收工合回 `editor`；合不回就在回报第一行写「未合回」和原因。

## 回报

z0 的完整表（四镜 × 六个开关 × 三角/`frameCostMs`）；选了哪几层做档、每档的切点（像素）与三角；切档节点挂在哪、每帧开销（按丛计几次判断）；
阴影怎么处理；X-05 的 3D 复测；四镜三次连拍前后；近景 / 中景 pixel diff；慢推录像路径。

**规模**：中。**风险**：
**最容易「切档切出来看得见」**——竹梢是这一景的剪影，中景一跳全院都看见，慢推录像与 3× 放大就是防这个；
**最容易每帧逐实例扫 5.6 万片叶**——那样 CPU 比省下的 GPU 还贵；
**最容易没剖析就开切**——如果病在叶子的片元开销，降竿子的棱数一个 fps 都回不来。
