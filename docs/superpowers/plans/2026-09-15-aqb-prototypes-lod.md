# 单子 AQ-b：构件交原型 + 先实例化再合并 + 雕饰按距离分档 + `gate_approach` 帧率立案

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联。** 预算按 `D-25`。
> 依据：codex 评审 §8（`docs/reviews/2026-09-15-procedural-detail-review.md`）+ 核验稿 §2.2（**构件内先合是 5 处模式，不是一行**）+ AO 验收 §11 + `D-27`。
> **派单时机：单子 AS 合回之后**（距离档要分的就是 AS 做出的两种表示；两单都碰 `building.ts`）。
> **文件域**：`builder/parts/merge.ts`、`builder/parts/static-batches.ts`、`builder/compose/composer.ts`、
> `builder/parts/damu/building.ts`（**只许改 `:1619` 附近那次合并与绦环板两种表示的切换**，不碰 `makeGeshan` 内部）、
> `builder/parts/shishan/baogushi.ts` / `builder/parts/pudi/shiyabian.ts` / `builder/parts/pudi/luya.ts`（各自那一行 `mergeByMaterial`）、
> `engine/scatter/`、`engine/core/PostFX.ts`（只在 AQ-b0 剖析结论指向它时）、`tests/`。

---

## AQ-b0 · 先剖析，再动手（`gate_approach` 33–36 fps）

四镜里只有它低于目标（其余 45–48），三角与 `mound_block` 相当（4.33M vs 4.28M），**所以不是三角的锅**。
先量，不猜：

- `capture.mjs` 已记 `sceneSubmissions`（主场景 + 阴影）与 `frameSubmissions`（整帧含后期）；再用 `?profile`（`renderer.ts` 的 `trackTimestamp`）
  把四镜的 **主场景 / 阴影 pass / GTAO / DOF / grade** 各自的 GPU 时间量出来，一张表；
- 候选嫌疑（按我猜的可能性排，**以量为准**）：① 阴影级联在这个机位覆盖台矶 + 门屋 + 两翼墙 + 翠嶂，阴影 pass 翻倍；② 地形 + 台面大片近距离像素，splat 四档混合的 fill 成本；③ DOF 远景模糊在此机位覆盖面大；
- **只修剖析出来的第一名**，且修法要是"设置级"（级联距离、阴影更新频率、DOF 起点）或"数据级"（剔除范围），不许改观感；
- 判据：`gate_approach` ≥ 42 fps 三次中位（目标 45，允许一次不到位，但要写清剩下的差在哪一层）；其余三镜不掉。修不到就如实报表，这一小节允许"只有报表没有修"。

## AQ-b1 · 构件交原型 + 摆放，合并挪到 compose 末端

现在 5 处在构件内部先 `mergeByMaterial`（`building.ts:1619`、`baogushi.ts:106`、`shiyabian.ts:166`、`luya.ts:217`、`static-batches.ts:67`），
`assembleStatic` 的实例化（≥ 8 个同几何原型 → `InstancedMesh`）在构件层就被打散了。

- 构件的 `PartBuild` 改为输出**未合并**的 `Object3D` 树，重复小件（格扇、瓦当、斗拱分件、鼓钉、雀替）**共享同一个 `BufferGeometry` 与材质引用**；
- `composer` 末端 `assembleStatic(staticGroup)`：先按 `geometry.uuid + material.uuid` 分桶实例化（阈值 8 保持），残余再 `mergeByMaterial`——这一步现在就是这样，**改的是构件不再提前合**；
- **`P-23` 那个坑**（`keep` 路径 `clone()` 再 `applyMatrix4(matrixWorld)` 位移翻倍）在这里必踩，先修它再动构件；
- 碰撞 / 可行走面继续来自 `blockers` 与地形，不随合批变（`playtest` 守着）；
- **合并键纳入阴影策略与 renderOrder**（评审 §8.1），缺属性补默认值不删属性（AQ-a 已做）。

**判据**：四镜三角**不变**（实例化不省三角）、draw call **不升**（应降，报降了多少）、世界构建时间不慢于现在 +10%、`playtest` PASS、`manifest-diff` 名册 LOST = 0。
**回报要有一张表**：5 处各自原来合了多少 mesh、现在有多少原型被实例化、每处 draw call 前后。

## AQ-b2 · 雕饰按距离分档（只做绦环板 + 台矶样件这两处有两种表示的）

> **2026-09-15 AS 验收后改问法（`P-26`、`D-27` 补记）**：正门绦环板 51 px、深檐漫射光下 6 mm 几何版读不过贴图版——
> 所以 b2 **先量再分**：在潇湘馆当心间那 8 扇落地格扇（带心 1.46 m）加一个机位，几何版（4 mm 与 6 mm 各一档）vs 贴图版
> 并排 + `--mean`；**几何版赢不了就不做距离档，贴图版就是终态**，b2 收成"报表 + 决定"。赢了才做下面的滞回切档。

AS 做了"按角色"的静态分档（正门 4 扇几何、其余贴图）。改成**按距离**：

- 每个带子两个 mesh（几何版 / 贴图版）挂同一个父节点，按相机距离切换可见性，**滞回**（进 3.5 m 换几何、退到 5 m 才换回贴图，两个数写成常数并说明）；
- 用 `engine/scatter/` 的簇网格（`ClusterGrid`）做距离查询，不要每帧遍历全部格扇；
- **没有 TAA**，不许用抖动渐变——切换时两版的带区 pixel diff（AS 实测）就是 pop 的上限，写进回报；
- 走动验证：`tools/record.mjs` 或 `timelapse.mjs` 从 8 m 走到 1 m 拍一串帧，**相邻帧 pixel diff 在切档那一帧不高于其他帧的 2 倍**；
- 台矶样件同样接上（它现在靠 `?relief=tex` 手切）。

**判据**：站在 `gate_approach` 机位（6 m 外）时全部绦环板是贴图版 → 四镜三角回到 AS 之前 + 贴图版材质桶；走到门道内 1 m 处几何版亮起；来回走 5 次不闪。

## 顺序与回报

AQ-b0（剖析）→ AQ-b1（原型）→ AQ-b2（距离档）。每步一个提交，各自的表贴回报。
**规模**：大。**风险**：高——**b1 最容易把构件输出契约改成通用系统**（`D-18`：只做"不提前合 + 共享引用"，不做资产管线）；
**b0 最容易先入为主**（我列的三个嫌疑只是猜，量出来是谁就修谁）；**b2 最容易做成每帧遍历**（用簇网格）。
