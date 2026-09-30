# 单子 AX：扩区性能统一优化（地形 LOD + 建时 + 远处小件剔除）

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联。** 预算按 `D-25`。
> 依据：扩区复测 `docs/reviews/2026-09-23-scale-remeasure.md`（验收人 2026-09-23 实测，HEAD `380e8e14`）+
> 接缝④ `docs/superpowers/specs/2026-09-14-scale-architecture-design.md` §2 + 单子 AA 判据二（`docs/superpowers/plans/2026-09-14-aa-ground-resolution.md`，「明说没做」）。
> **派单时机：AL 验收完、`xiaoxiang` 基线抬过之后**（AL 让这一镜三角比基线高了 19%，没归因前叠上本单，前后对照就分不清是谁的账）。
> **不碰任何景的观感**，所以没有景需求文档；标准动作第 15 条本单不适用，回报写进复测稿的续节。

**这一单解决什么**：园子从 4 区开到 19 区时，建时 29.5 s → 57.0 s、`gate_approach` 视锥三角 4.54M → 7.04M、fps 46 → 42。
复测按类别拆开以后，病根是三个**与区里建了什么无关、只与园子面积有关**的成本：

| 病 | 数（19 区，`gate_approach`） | 件 |
|---|---|---|
| 远处地形和脚下一样密（全场一个格距 0.48 m） | 地形 1913k 三角，其中 **1734k 在 120 m 外** | AX1 |
| 建时里「植树」「理地」随窗口面积线性涨 | 植树 8.8 → **24.6 s**，理地 4.8 → **13.5 s**；起屋只 10.2 → 10.9 s | AX2 |
| 远处的小构件还在逐个画 | 建筑与构件 2965k，其中 **2039k 在 120 m 外** | AX3 |

**不在本单**（写清楚，免得做着做着滑进去）：区级流式装载与卸载、区级 HLOD 远景代理、遮挡剔除。
理由：它们要**真建好的区**才能验收。空桩区只有 plan 自动生成的房子，会低估「起屋叠石」那一行，
代理做得对不对也没有东西可比。触发条件写在文末「之后」一节。

---

## 文件域

| 件 | 可以改 | 说明 |
|---|---|---|
| AX1 | `engine/render/TerrainChunks.ts`、`builder/compose/terrain.ts`（只限 `:268` 附近建网格那一步和 `userData.resolution` 自报）、`tests/` | 每帧选档挂在 `engine/core/Engine.ts` 已有的 `add()` / `update(dt)` 上，不许另起调度框架 |
| AX2 | `builder/compose/world.ts`、`builder/parts/zhiwu/vegetation.ts`（**只限调度与缓存，不碰规则**）、`engine/scatter/`、`builder/compose/splat.ts`、`builder/compose/texture-jobs.ts`、`builder/compose/texture-bake.worker.ts`、`builder/compose/terrain.ts`、新 worker 文件、`tests/` | |
| AX3 | `builder/parts/static-batches.ts`、`engine/scatter/instancing.ts`、`tests/` | |

**不碰**：`projects/daguanyuan/plan.json`、`projects/daguanyuan/scenes/` 下所有清单、`builder/compose/scatter-rules.ts`（密度与规则）、
材质、`engine/core/PostFX.ts`、观感参数、`tools/shot-list.mjs`、`projects/daguanyuan/perf-baseline.json`、`projects/daguanyuan/coverage-baseline.json`。
**这一单一个像素的观感都不许买**：它只省钱，不花钱。

## 尺子（验收人 2026-09-23 转正，两件都实跑过）

- `tools/frustum-census.mjs`：按「顶层类别 × 远近」数视锥三角。每件的前后对照都用它。
- `tools/stub-all-regions.mjs`：在临时 worktree 里给 15 个没建的区补空清单，把世界按 19 区建起来。**只许对 worktree 跑**，主检出它会拒绝。
- 19 区对照的做法：
  ```
  git worktree add --detach /private/tmp/dgy-ax19 <你的提交>
  ln -s ~/Workspace/games/daguanyuan/node_modules /private/tmp/dgy-ax19/daguanyuan/node_modules
  node tools/stub-all-regions.mjs --dir /private/tmp/dgy-ax19/daguanyuan
  (cd /private/tmp/dgy-ax19/daguanyuan && npx vite --host 127.0.0.1 --port <端口> --strictPort)
  node tools/frustum-census.mjs --url http://127.0.0.1:<端口>/garden.html --out shots/AX/<件>-19.json
  ```
  桩文件**绝不许进任何提交**：量完就删掉这个 worktree。
- `tools/profile-passes.mjs` 在 19 区会撞上它自己 180 s 的超时（建时 57 s 加上 `?profile` 更慢）。
  要量就临时复制一份把超时放宽，**不许改原文件**，发现记进回报。

---

## AX1 · 地形按距离分档（LOD）

**病**：`buildTerrainChunks(field, TERRAIN, 64, …)` 按 64 m 一块切，每块都是 0.48 m 格距，一块大约 3.5 万三角，
200 m 外也一样。19 区 `gate_approach` 视锥里有 56 块，地形 1913k 三角，其中 1734k 在 120 m 外；4 区是 429k，其中 291k 在 120 m 外。

**做法**：

1. **每块建四档**：在同一张全局格点上取步长 1 / 2 / 4 / 8（0.48 / 0.96 / 1.92 / 3.84 m）。**粗档的顶点是细档格点的子集，不重新采样**，
   高度直接取现有的 `heights` 数组，所以相邻两块在同一档上的接边天然一致。
   法线也取这些格点上已经按细格算好的值（`TerrainChunks.ts` 的注释说过：高度过早量化会放大法线误差）。
2. **不同档之间的接缝用裙边**：沿块边向下垂一圈，深度 ≥ 这一档相对 L0 的最大高度误差（建网格时顺手算出来）。
   想改用边缘缝合（stitching）也行，但回报里要说清为什么不用裙边。
3. **选档按屏幕误差，不拍脑袋定距离**：建网格时把每档相对 L0 的最大垂直误差记下来；每帧按相机到这一块 AABB 的距离，
   取投影误差 < **1 px**（1600×900、当前 FOV）的最粗一档。距离阈值是算出来的，不是手填的常数。
   加**滞回**，防止在阈值上来回跳（比例写成常数并说明来历）。每帧不许有分配。
4. **阴影 pass 跟主相机用同一档**，不单独选。
5. **碰撞不动**：`Collision.groundHeight` 采的是解析场（`engine/player/Collision.ts:79`），不读网格。**保持这样**，谁都不许让它去读网格。
6. `CELL = 0.48` 仍然是 L0 的精度，`tests/terrain-resolution.test.mjs` 不许改断言。
   `userData.resolution` 再自报一行各档格距和切档阈值，写进 manifest。
7. 新测试两条：粗档每个顶点的高度与 L0 同位置的格点**逐位相同**；裙边深度 ≥ 这一档的最大误差。

**判据**：

| 项 | 目标 | 用什么量 |
|---|---|---|
| 19 区 `gate_approach` 地形三角 | 1913k → **≤ 350k**，其中 120 m 外 **≤ 150k** | `frustum-census`（19 区 worktree） |
| 4 区四镜地形三角 | 每镜 **≥ −40%** | `frustum-census` |
| 近处不变 | `grass_close`、`bridge_head`、`cu_xx_path` 前后 `pixel-diff --mean` **< 0.5 色阶** | `capture` + `pixel-diff` |
| 远处不走样 | `gate_approach`、`mound_block`、`treeline` 前后 `pixel-diff --mean` **< 1 色阶** | 同上 |
| 不裂、不跳 | 从正门走到潇湘馆（`record.mjs` 或 `timelapse.mjs`）：切档那一帧的相邻帧 pixel diff **不超过其余帧中位数的 2 倍**；另外拍三张低俯角远景（pitch −0.1），验收人看有没有裂缝或露出裙边 | `timelapse` / `record` |
| 门 | `check:all` 全过、`playtest` PASS，脚下序列前几段贴进回报 | |

⚠️ **要人判**：远处山脊（翠嶂土台、东侧林带）的剪影如果看得出变化，**并排拍给用户，不许自己放宽 1 px**。

## AX2 · 建时（先剖析，再动手）

**病**：4 区 → 19 区，建时 29.5 s → 57.0 s。按步拆开：

| 步 | 4 区 | 19 区 | 备注 |
|---|---|---|---|
| 植树 | 8.8 s | **24.6 s** | 簇 1118 → 3245（有东西的 828 → 1826），**实例只 86k → 96k**：钱花在簇的数量上，不在树的数量上 |
| 理地 | 4.8 s | **13.5 s** | 其中 splat 1.9 → 5.1 s（主线程），建网格 0.9 → 3.2 s |
| 起屋叠石 | 10.2 s | 10.9 s | 空桩区几乎不加房子，这一行会被低估 |
| 调色 / 引水 / 开天 | 3.8 / 1.4 / 0.4 s | 3.9 / 3.7 / 0.4 s | |

**AX2-0 剖析**：把「植树」「理地」各拆到子步骤（`world.buildTimings` 已有一层，往下再拆一层），出一张表。
我按可能性猜的嫌疑，**以量出来的为准**：

- ① 空簇也要付固定成本：3245 个簇里 1419 个最后没东西，但可能照样把采样和规则过了一遍；
- ② splat 两张（主 + ext）在主线程烘焙。`texture-bake.worker.ts` 那套 worker 池现成可用；
- ③ AX1 做完以后，远处的块只需要粗档，L0 可以等相机走近才建。这就是接缝④「没走到的不烘焙」在地形这一层的最小版本。
  如果做它，**切档那一帧不许卡**：建 L0 放进 worker 或者分帧做，回报里写清最坏的一帧多少毫秒。

**只修剖析出来的前两名**。**输出必须逐位一致**：`tree-census --json` 的计数、manifest 的名册与几何校验、四镜 `pixel-diff --mean` < 0.5 色阶。
改调度可以，改结果不行。**确定性是这个项目的底线**：进 worker 以后，随机数种子和遍历顺序最容易悄悄变掉。

**判据**：19 区建时 **≤ 35 s**，4 区 **≤ 22 s**（三次取中位数）。修不到就如实出表，写清剩下的差在哪一步，这一件允许只有表没有修（同 AQ-b0）。

## AX3 · 远处小件按屏幕尺寸剔除

**病**：19 区 `gate_approach` 建筑与构件 2965k 三角，其中 2039k 在 120 m 外；4 区是 1952k，其中 1027k 在 120 m 外。
`assembleStatic` 已经把重复小件（≥ 8 个同原型）按 `cellSize` 簇实例化了。瓦当、斗拱分件、鼓钉这类东西
在 150 m 外投影不到一个像素，却还在逐个提交。

**做法**：

- 只针对**实例化的原型**，而且原型包围半径 < 0.5 m 的。合并后的残余件（128 m 簇）不动，墙、屋面这类大件不动；
- 按簇判断：原型包围半径在这一簇最近点处的投影小于 **N px**，就把这一簇的这个 InstancedMesh 隐藏。N 由实测定，先试 1.5 px，要滞回；
- 阴影 pass 同样隐藏（亚像素的东西，阴影也看不见）；
- 不许每帧遍历全部实例：用现有的簇网格，每簇一个判断。

**判据**：`gate_approach`、`mound_block`、`treeline` 前后 `pixel-diff --mean` **< 0.5 色阶**；
4 区和 19 区 `gate_approach` 的「建筑与构件」三角、以及 120 m 外那部分，各降多少报出来（不设下限，这一件是量它值不值）；
相邻帧不闪（同 AX1 那一条走动判据）。⚠️ 某一类小件在远处消失看得出来的，**拍给用户，不许自己加大 N**。

---

## 开工基线（验收人 2026-09-23 单次读数，HEAD `380e8e14`；施工方开工再测三次取中位数）

**4 区** `capture`：

| 镜 | draw call | 三角 | fps |
|---|---|---|---|
| gate_approach | 317 | 4,542,753 | 46 |
| mound_block | 291 | 4,437,927 | 47 |
| grass_close | 305 | 4,570,349 | 46 |
| xiaoxiang | 247 | 3,753,984 | 44 |

**19 区**（空桩）`capture`：503 / 7,044,360 / 42 · 464 / 6,871,275 / 43 · 366 / 6,142,694 / 43 · 401 / 6,008,834 / 41。

`frustum-census` 分类（千三角，括号里是 120 m 外那部分）：

| | 4 区 gate | 19 区 gate | 4 区 xiaoxiang | 19 区 xiaoxiang |
|---|---|---|---|---|
| Terrain | 429 (291) | **1913 (1734)** | 221 (44) | **1486 (1274)** |
| Garden | 1952 (1027) | 2965 (2039) | 719 (0) | 1516 (666) |
| Vegetation | 888 (568) | 962 (721) | 351 (173) | 508 (414) |
| Sea | 29 | 129 | 29 | 129 |

建时：4 区 29.5 s，19 区 57.0 s（逐步见 AX2 表）。

## 总验收表

| # | 判据 | 目标 |
|---|---|---|
| 1 | 19 区 `gate_approach` 地形三角 | ≤ 350k（120 m 外 ≤ 150k） |
| 2 | 19 区四镜 fps（参考，不进门） | 每镜 ≥ 45 |
| 3 | 19 区建时 / 4 区建时 | ≤ 35 s / ≤ 22 s，或者给出剖析表 |
| 4 | 近处像素不变 | 近景三镜 `--mean` < 0.5 |
| 5 | 远处像素 | AX1 < 1 色阶，AX3 < 0.5 色阶 |
| 6 | 确定性 | `tree-census` 计数、名册、几何校验逐位一致 |
| 7 | 不裂、不跳、不闪 | 走动序列里切档帧 ≤ 其余帧中位数的 2 倍 |
| 8 | 门 | `check:all` 全过、`playtest` PASS，名册 LOST = 0 |

四镜三角会**降**，降得会超出 ±3%。这不是违规，但要逐件归因（哪一件降了多少），验收人核过以后抬线。

## 顺序、提交与回报

AX1 → AX2-0（表）→ AX2 → AX3。**每件一个提交**；AX2 的每一处修改各一个提交。每件做完都跑一遍 4 区和 19 区的尺子。

**回报**：

1. 每件前后的 `frustum-census`，4 区和 19 区两份，放在 `shots/AX/`；
2. AX1：各档格距与三角、算出来的切档距离、裙边深度，以及走动序列的相邻帧 diff 曲线；
3. AX2-0 剖析表；AX2 每处修改前后的建时，以及确定性三项的比对结果；
4. AX3：选的 N、被剔掉的原型清单、每类省了多少；
5. 四镜 `capture` 三次中位数，外加 19 区四镜；
6. 所有 ⚠️ 项的并排图；
7. 合回 `editor` 以后的 commit hash，和 `git worktree list`。

**规模**：大。**风险**：
- AX1 最容易出**裂缝**和**选档来回跳**。裙边要深过误差，选档要有滞回，而且都要拿走动序列量出来，不能靠推理；
- AX2 最容易**丢确定性**（进 worker 以后随机数种子和遍历顺序变了），也最容易顺手去改散布规则。规则一行都不许动；
- AX3 最容易做成**每帧遍历全部实例**，或者**悄悄把 N 调大去凑三角数**。

## 之后（不在本单，写下触发条件）

- **区级流式与 HLOD**：等第一个新区真建完（P4 开工），用 `frustum-census` 复测。如果 19 区 `gate_approach` 的 Garden 120 m 外那部分超过 2M，或者建时超过 40 s，就写单子 AY。
- 本单做完，`D-25` 的四镜外面再补一个「19 区四镜」作参考读数。**不加门**：观感迭代期不焊门。
