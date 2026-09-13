# WG：渲染层迁移到 WebGPU + TSL

> **一张单子，分五阶段，一个 agent 从头拿到尾。**
> 不拆成五张，因为渲染文件必须单人独占——中途换手会把"哪一处是迁移引入的"这个
> 唯一能定位问题的线索弄丢。

**方案**：`docs/reviews/2026-09-11-webgpu-migration-plan.md`（codex 出，我核过它的五条
关键事实全属实，见 `docs/ROADMAP.md §WG`）。**本单子是它的施工形式，不重复它的内容——
开工前先把方案通读一遍。**

**为什么现在做**：用户 2026-09-11 定「WebGPU 也先切过来」。PQ 拆两半就是为它让路——
**几何半（N/O/P/Q）已全部合入**，着色半（草的分层着色、水的流动、地面混合、体积云）
在等 WG，先用 GLSL 写一遍再翻成 TSL 是做两遍。

## 迁移面（2026-09-13 复核）

七个文件带自定义 shader，共 4346 行：

| 文件 | 行数 | 方案里的风险评级 |
|---|---|---|
| `builder/parts/zhiwu/foliage-materials.ts` | 1357 | 高 |
| `builder/parts/zhiwu/bamboo.ts` | 628 | 高 |
| `engine/render/Clouds.ts` | 589 | 中 |
| `engine/core/PostFX.ts` | 587 | 高 |
| `builder/compose/terrain.ts` | 555 | 高 |
| `engine/render/Water.ts` | 452 | 高 |
| `engine/render/SkyShader.ts` | 178 | 中 |

另需改：`engine/core/Engine.ts`、`projects/daguanyuan/main.ts`（异步初始化）、
`engine/render/Atmosphere.ts`（PMREM）、`engine/scatter/instancing.ts`（视锥坐标系）、
`projects/daguanyuan/viewer.ts`、`projects/daguanyuan/fashi.ts`（棚拍/图解页也用渲染器）、
`tools/capture.mjs`（统计字段）。

## 基线（`shots/opq`，2026-09-13）

**这是 WG4 要对照的那一份，别用更早的。**

```
三角数   2.55 – 3.61 M
draw calls 131 – 246
帧率      79 – 186 fps
世界构建  13.4 s
playtest  PASS（/garden.html 全线）
六道门    全过；139/139 测试
```

## 全局约束

- 工作目录 `~/Workspace/games/daguanyuan`，分支 `editor`。
- **单子 R 与你并行跑**（试玩反馈里的立即项）。它占：`builder/parts/pudi/`、
  `builder/compose/composer.ts`、`builder/compose/terrain-from-plan.ts`、
  `builder/parts/qiangyuan/`、`builder/parts/xiaomu/plaque.ts`。**一个都不许碰。**
  除它以外**不再派别的并行任务**，渲染层是你独占的。
- **唯一的接触面**：`luya.ts` 与 `vegetation.ts` 都只读 `import { TERRAIN } from '@builder/compose/terrain'`。
  你拥有 `terrain.ts`,但**不要改 `TERRAIN` 的形状**——真要改,停下来回报,别让 R 在半路上崩。
- R 会用 4821 端口,**你用 4801**。
- 提交只按路径 `git add`，**不许 `git add -A`**（PITFALLS **P-19**）。
- **不许 `git stash`**——要隔离量自己的改动，用 `git worktree add --detach /tmp/<名> <commit>`。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**（**P-15**）。
- preview 带 `--strictPort`；园子在 **`/garden.html`**。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

---

## 单子 WG

> 在 `~/Workspace/games/daguanyuan` 做**渲染层迁移到 WebGPU + TSL**。
> **开工前通读 `docs/reviews/2026-09-11-webgpu-migration-plan.md`**，本单子只讲施工与验收。
>
> **你独占渲染层，没有并行任务。** 但请**每个阶段单独提交**，让进度可见、可回退。
>
> ### 已核到的五条事实（别再花时间验，也别与之相反）
>
> 1. `three` **0.185.1**，`./webgpu` 与 `./tsl` 两个导出入口都在。**版本锁死，迁移期间不升级。**
> 2. 新 `Info` 里 **`render.calls` 与 `render.drawCalls` 是两个不同字段**。
>    `tools/capture.mjs:263` 现在取的是 `info.render.calls`——**照抄过去口径就变了**，
>    历史 manifest 会失去可比性。改口径时**在 manifest 里加渲染器与统计版本标签**。
> 3. `ShadowNode.js` 里 **VSM 与 `onBeforeShadow`/`onAfterShadow` 都在**（33 处命中）。
>    **不要为迁移换阴影算法。** 要验的是"阴影前恢复全部实例、阴影后恢复可见前缀"
>    这套在新渲染器上还灵不灵，以及主视锥外的树能否向画面内投影。
> 4. `Frustum.setFromProjectionMatrix(m, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false)`
>    ——而 `engine/scatter/instancing.ts:290` **只传了第一个参数**。
>    WebGPU backend 下会**静默剔错**：不报错，只是剔掉不该剔的。**首次剔除前就要对齐，
>    不能等第一次 render 才更新。**
> 5. 七个自定义 shader 注入点确实在（清单见上表）。
>
> ### 五个阶段，各自一个提交
>
> **WG0 · 冻结基线与兼容策略**
> 记下固定相机、seed、时间、viewport、质量档与分辨率；性能比较时关自适应分辨率。
> 保存旧 build 可独立打开。确定目标浏览器矩阵：**默认 WebGPU，兼容测试用同一渲染器的
> `forceWebGL`**——不是保留旧 GLSL 材质做回退。
>
> **WG1 · 棚拍端先通一条最小链**
> 先让 `viewer.html` 用 `WebGPURenderer`：标准木石材质、一个建筑、一块太湖石，
> 保留中性灯光、阴影与输出转换。它们不依赖整园那七组自定义 shader，
> 可以快速验上传、色彩、PMREM、尺寸与截图工具。
> **完成条件**：实际 WebGPU 与强制 WebGL2 两个 backend 都显示正确；刷新、缩放、首帧无错。
> **此阶段不许宣称整园已迁移。**
>
> **WG2 · 七组 shader 接通整园**
> 建议顺序：天空/云与环境 → 地形 → 水 → 通用植被 → 竹。每组先做独立样板再进全园，
> 共同的风动与坐标输入先约定好。同时接好剔除、阴影形变、树冠阴影镂空。
> **暂用简单节点后期**，优先看清材质与空间问题。每组过了棚拍再进下一组。
>
> **两条要点**：
> - **风动做成可复用的节点函数**：共享局部位置、实例变换、世界风向、相位、柔软度、时间；
>   各植物保留自己的形变函数。**明确每步在哪个坐标空间**，避免 `instanceMatrix` 重复乘、
>   风从世界方向变成各树局部方向。**最终形变必须同时用于主画面、阴影与深度/法线输出**
>   ——不能出现叶在动而阴影或 AO 停在原地。
> - **树冠靠 `customDepthMaterial` 镂空阴影，不能假设这条旧入口自动接通。**
>   用节点阴影裁切/位置接口表达并验证。普通透明叶与只镂空阴影的树冠是**两种需求**。
>
> **WG3 · 恢复后期与质量档**
> 在已正确显示的整园上接 AO、bloom、景深、调色、抗锯齿。
>
> **三条写死**：
> - **ACES 只能有一次。** 新 `RenderPipeline` 默认自带输出颜色变换，直接叠旧 ACES 会重复。
>   先固定工作色域、tone mapping 的唯一位置，以及哪些效果在 HDR、哪些在 LDR。
> - **深度与法线优先从一个场景节点输出 / MRT 取得，AO 与 DOF 共享。**
>   半透明水、云与 alpha 裁切叶片的深度分别验证——**避免水成实心墙、云污染 AO、
>   叶片留矩形遮挡**。
> - **雾、AO、景深这三个数是刚按新世界尺度标定过的**（PITFALLS **P-17**）：
>   `FogExp2(0.0017)` + 雾色 `lerp 0.08 ×0.68`、GTAO `radius 2.4` / `thickness 1.4` / 半分辨率、
>   `dofFar 220`。**迁移要保住它们的效果，不是照搬它们的数字**——节点实现下同样的观感
>   可能对应不同的参数。**并入一件待决**：用户 2026-09-13 反馈"远处失焦、有点晕 3D"，
>   `dofFar 220` 意味着 **99 米就开始虚**，第一人称漫游里偏早。**WG3 重建后期时一并重定，
>   并出对照图交人眼**（现在不动它，动完 WG 还要再动一遍）。
>
> **WG4 · 实景验收，切默认**
> 见下"验收"。通过后新程序切默认，旧版本作为独立回退产物保留一段时间，
> **不长期同时维护两套业务 shader**。
>
> **WG5（可选，先量再做）**：GPU compute（大规模实例可见性/LOD、重复噪声烘焙）。
> **现有 shader 风动本来就在 GPU 上，不要把它重写成 compute 再宣称迁移收益。**
> CPU 地形与碰撞仍需稳定数据源，**不要每帧从 GPU 读回高度**。
>
> ### 顺带做掉（都在你独占的文件里，别人碰不了）
>
> - **帧率封顶。** 用户反馈"走 5 分钟电脑发烫"，现在 14 镜 79–186 fps，**没有上限，
>   满帧跑就一直烧 GPU**。在 `Engine.ts` 加一个上限（60 或跟随显示器刷新率）。
>   **这与 WebGPU 无关，但它在你的文件里。**
> - **地图开着时不许抢指针锁。** `projects/daguanyuan/main.ts:124` 的 container click
>   监听**无条件** `requestLock()`，地图开着时点它光标当场消失；Esc 释放锁又触发
>   "失锁弹开始卡"。**这是派单人写的 bug**，修法：地图可见时跳过该监听，
>   并抑制"失锁即弹开始卡"。
>
> ### 三条最容易搞错的
>
> 1. **确认 WebGPU 真的生效了，别被表象骗。** 存在 `navigator.gpu`、对象叫
>    `WebGPURenderer`、GL 报 ANGLE Metal——**这三样都不能证明没有回退到 WebGL**。
>    要检查**初始化之后的实际 backend**，并把它打进 manifest。
> 2. **不要顺手修观感。** 迁移期唯一的判据是"和旧的一样"。看到什么难看的记下来，
>    别在这一期改——**否则 WG4 的对照图里分不清哪一处是迁移引入的**。
>    已知会难看但**本期不修**的：树冠"假发片"（卡片树冠，归 PQ 着色半）。
> 3. **世界构建时间不许退。** 现在 13.4 秒（P-17 那一轮砍下来的）。
>    异步初始化很容易把它变长，**每阶段都量一次**。
>
> ### 验收（WG4）
>
> - **构件**：建筑、独峰/假山、竹丛的同机位棚拍对照。
> - **场景**：`node tools/capture.mjs --url http://127.0.0.1:4801/garden.html --out shots/wg`，
>   与 **`shots/opq`** 逐镜 `side-by-side`。14 镜全出，另加快速转身、跨块边界、画面外投影者。
> - **确定性**：固定 seed 与时间，**几何数量与位置不因换渲染器而改变**。
>   画面按人眼审查，**不要求两个 backend 逐像素相等**。
> - **交互**：`node tools/playtest.mjs --url http://127.0.0.1:4801/garden.html` 仍 `PLAYTEST PASS`
>   ——**证明不是只有静态截图成功**。
> - **性能**：同设备、同分辨率、同质量档、同时钟，对比**预热后稳定段**的 p50/p95 帧时、
>   CPU 更新耗时、可取得的 GPU 时间；冷启动与预热分别记。
>   **不许靠降分辨率或回退 WebGL2 得出"WebGPU 已提速"。**
> - **生命周期**：重新加载、质量切换、隐藏后恢复；捕捉设备错误并给出可恢复路径。
> - **六道门全过**、139/139 测试、`npm run build` 通过。
>
> ### 回报
>
> 每阶段一段：改了什么、量到什么、遇到什么与方案预期不符。
> 最后给：实际 backend 的检测结果、三角数/draw call/帧时前后（**注明统计口径已变**）、
> 世界构建时间前后、对照图路径、还剩哪些没迁完。

**规模**：**很大**，是目前为止最大的一张。**风险**：高。
**最可能的失败**：(a) 以为切了 WebGPU 其实回退了 WebGL；(b) 顺手改观感，
导致 WG4 对照时分不清是迁移问题还是审美改动；(c) 后期链重建时叠了两次 ACES。

---

## 之后

WG 合入后是 **PQ 着色半 + PX**：草的分层着色与露土、水的流动、地面四档混合、
体积云，以及树冠"假发片"。再之后 P3 → PE → P4 → P5。
