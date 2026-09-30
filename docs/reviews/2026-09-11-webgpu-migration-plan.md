# Three.js + WebGPU 迁移方案

状态：方案，未实施。基于本机实际安装的 Three.js 0.185.1 与当前工作区代码核对。原 P1–P5/PE/PX 保留，以下 WG 编号仅供迁移任务分拆，不擅自修改原 roadmap。

## 目标与边界

目标结构：Three.js `WebGPURenderer` + TSL 节点材质 + `RenderPipeline`；优先 WebGPU，保留同一套节点代码在 WebGL2 backend 下的兼容能力。

这是一轮渲染层迁移。知识规则、建筑尺寸推导、plan 数据、程序化网格生成、地形解析函数、输入、音频及 UI 逻辑继续复用。P1 的分块、空间索引与高度采样复用继续做，WebGPU 不会自动消除 CPU 生成成本。

旧 WebGLRenderer 构建在迁移期作为冻结的对照与回退版本保存。新路线验收后不长期维护两份业务 shader；兼容路径是新渲染器的 WebGL2 backend，不是把旧 GLSL 材质作为回退。

## 必改清单

| 范围 | 当前入口 | 改造内容 | 风险 |
|---|---|---|---|
| 初始化与生命周期 | `engine/core/Engine.ts`、`projects/daguanyuan/main.ts` | 改用 WebGPURenderer，显式异步初始化；后端就绪后才烘焙环境图；适配尺寸/质量切换/设备丢失；就绪事件涵盖首帧与必要管线编译 | 中 |
| 地形材质 | `builder/compose/terrain.ts` | 四层地表混合、粗糙度、法线转 TSL；保留高度场、splat 数据及纹理打包 | 高 |
| 水 | `engine/render/Water.ts` | 深度/岸距采样、颜色/透明度、波纹位移、法线、Fresnel 和反光转节点表达 | 高 |
| 通用植被 | `builder/parts/zhiwu/foliage-materials.ts` | 风动、三平面贴图、包裹漫反射、透叶、轮廓光迁移；透叶属于光照响应，不能全部塞进 emissive 糊过去 | 高 |
| 竹 | `builder/parts/zhiwu/bamboo.ts` | 实例风参数、竿枝叶位移、alpha 裁切转 TSL，保留现有生成与实例数据 | 高 |
| 天空与云 | `engine/render/SkyShader.ts`、`Clouds.ts` | 两组 ShaderMaterial 改节点材质；保留天空色板与云图集生成，迁移 billboard、雾化与透明排序 | 中 |
| 天光与环境 | `engine/render/Atmosphere.ts` | 使用新渲染器匹配的 PMREMGenerator；适配节点天空的环境烘焙和阴影配置 | 中 |
| 后期 | `engine/core/PostFX.ts` | EffectComposer/Pass 链迁到 RenderPipeline；重建深度、法线、AO、bloom、DOF、调色与抗锯齿 | 高 |
| 剔除与阴影实例集合 | `engine/scatter/instancing.ts`、`builder/parts/zhiwu/vegetation.ts` | 投影坐标约定、阴影钩子、实例重排、树冠阴影镂空路径逐项适配 | 高 |
| 构件棚拍 | `projects/daguanyuan/viewer.ts` | 同步迁移 renderer、后期、环境贴图和统计；继续保留中性棚拍灯光 | 中 |
| 验收工具 | `tools/capture.mjs`、`shoot-part.mjs`、`manifest-diff.mjs` 等 | 后端检测、异步就绪、统计字段、确定性时间与正式帧时采集 | 中 |

木、石、墙、瓦等没有 shader 注入的标准材质不必机械重写成 TSL。先验证新渲染器的标准材质映射；需要自定义时再显式使用 MeshStandardNodeMaterial / MeshPhysicalNodeMaterial。CanvasTexture、DataTexture 的生成算法继续复用。

## 六个容易漏掉的工程点

### 1. 等 renderer 初始化后才能建环境

现有顺序是 new Engine → initPost → world.build；world 的第一个步骤便用 PMREM 烘焙天空。新流程须先完成 `renderer.init()`，再建立与 GPU 有关的资源。普通场景初始化后可预编译材质；后期与阴影也要经过实际首帧预热，不能用“对象已经创建”冒充渲染就绪。

版本先锁住当前核对过的 0.185.1，保持 three、类型与 addons 匹配。迁移期间不顺便升级最新版本。渲染相关入口使用 `three/webgpu` 与 `three/tsl`，保证单一 three 包实例；纯数据推导层仍不引入 three。

### 2. 风动要成为可复用的节点函数

当前有通用植被与竹两套 shader 字符串修改。迁移时共享统一的输入：局部位置、实例变换、世界风向、相位、柔软度与时间，各植物保留自己的形变函数。

明确每步在哪个坐标空间执行，避免 instanceMatrix 重复乘、风从世界方向变成各树局部方向。最终形变必须用于主画面、阴影及深度/法线输出；不能出现叶在动、阴影或 AO 停在原地。

P1 Task 7 已计划 shader 注入的有序 stage。既然技术路线已选 TSL，这部分建议直接定义节点组合顺序和坐标契约，避免再投入一套复杂的 GLSL 字符串注入框架。分块与空间索引等其余步骤保留。

### 3. 深度约定会影响自己的剔除代码

当前 InstanceCuller 调用 `frustum.setFromProjectionMatrix(matrix)`，默认为 WebGLCoordinateSystem。WebGPU backend 的相机投影必须使用匹配的 coordinateSystem；以后若开启 reversed depth，也要传递对应标志。

在首次剔除前就使相机投影与 backend 对齐，不能依赖第一次 render 才更新。自写 DOF 里把 depth 乘二减一的线性化公式也要重新核对，优先用节点深度转换功能，避免照搬旧 GLSL。

### 4. 阴影能力不能按过时印象判断

本机 0.185.1 的节点 ShadowNode 已包含 VSM 及 onBeforeShadow/onAfterShadow 调用。因此方案不以“WebGPU 不支持 VSM/这些回调”为前提，也不要求为了迁移立刻换阴影算法。

需要实际验证的是：旧的阴影前恢复全部实例、阴影后恢复可见前缀，在新 renderer 是否仍按预期工作；主视锥外的树能否向画面内投影。

当前树冠借助 `customDepthMaterial` 镂空阴影，不能假设这条旧入口自动接通。用节点阴影裁切/位置接口表达并验证。普通透明叶与只镂空阴影的树冠是不同需求。

### 5. 后期重建时保住一次色调映射

当前 HDR → AO/bloom/景深/调色 → ACES → sRGB/抗锯齿有明确艺术目的。新 RenderPipeline 默认包含输出颜色变换，直接叠上旧 ACES 会重复转换。

先固定工作色域、tone mapping 的唯一位置，以及哪些效果在 HDR、哪些在 LDR。当前包已有 GTAONode、BloomNode、DepthOfFieldNode、SMAANode 等实现，可以复用，但效果和成本不能假定逐像素等价。

深度和法线优先统一从一个场景节点输出/MRT 获得，AO 与 DOF 共享；若个别材质或目标后端需要额外 pass，须单独说明。半透明水、云与 alpha 裁切叶片的深度处理分别验证，避免水成为实心墙、云污染 AO、叶片留下矩形遮挡。

检查 CanvasTexture 的颜色空间与翻转、数据贴图的非颜色语义、normalMap 方向和环境光强度。色偏先查颜色链路，不调一遍全部材质来补偿。

### 6. 统计字段不能照抄

当前截图取 `renderer.info.render.calls` 当 draw calls。新 renderer 的 Info 中，draw calls 是 `render.drawCalls`，`render.calls` 的含义不同；programs 统计也不再按旧数组长度取。

定义项目自己的统计输出，分别记录唯一几何、主画面/阴影/全帧提交和后期/compute 开销；无法可靠取得的分项记不可用，不把不同口径混成“性能提升”。历史 manifest 保留 renderer 与统计版本标签。

确认 WebGPU 生效须检查初始化后的实际 backend。存在 navigator.gpu 或对象叫 WebGPURenderer 都不能证明未回退；GL 的 ANGLE Metal 信息也不能证明使用了 WebGPU。

## 实施顺序

### WG0：冻结基线与兼容策略

以 P1 空间/性能任务收尾后的构建为基线，记录固定相机、seed、时间、viewport、质量和分辨率；性能比较时关闭自适应分辨率。保存旧 build，可随时独立打开对照。

确定目标浏览器矩阵。建议新程序默认 WebGPU，兼容测试使用同一渲染器的 forceWebGL；WebGPU 必选的性能测试遇到回退直接报告“未测试到 WebGPU”。纯 CPU 数据与地图工作可以继续推进，避免多人同时修改迁移的渲染文件。

### WG1：棚拍端先通一条最小链

先让 viewer 使用 WebGPURenderer：标准木石材质、一个建筑、一块太湖石，保留中性灯光、阴影与基本输出转换。它们不依赖整园六组自定义 shader，可以快速验证上传、色彩、PMREM、尺寸和截图工具。

完成条件：实际 WebGPU 与强制 WebGL2 backend 都显示正确；刷新、窗口缩放和首帧没有错误。此阶段不宣称整园已迁移。

### WG2：完成六组自定义 shader，接通整园

建议顺序：天空/云与环境 → 地形 → 水 → 通用植被 → 竹。对每组先做独立样板，再进全园；共同的风动和坐标输入先约定。

同时接好剔除、阴影形变、树冠阴影镂空。暂用简单节点后期，优先看清材质与空间问题。每组通过棚拍/局部场景后再进入下一组。

### WG3：恢复后期与质量档

在已正确显示的整园上接 AO、bloom、景深、调色和抗锯齿；保住唯一 ACES 与输出转换。重接 high/medium/low 及自适应分辨率，让离屏缓冲尺寸与实际渲染尺寸一起变化。

完成条件：各档位无黑屏、亮度突变、叶片矩形或水面深度错误；减少某项效果后相应 pass 确实不再执行。

### WG4：实景验收与切换默认

- 构件：建筑、独峰/假山、竹丛的同机位对照。
- 场景：正门、假山、沁芳亭、潇湘馆、逆光、近岸、树冠边缘；额外看快速转身、跨块边界和画面外投影者。
- 确定性：固定 seed 与时间，几何数量/位置不因 renderer 改变。画面按局部截图与人眼审查，不要求两个 backend 每个像素相等。
- 交互：现有键盘游线完整跑通，证明不是只有静态截图成功。
- 性能：同设备、分辨率、质量与时钟，对比预热后稳定段的 p50/p95 帧时、CPU 更新耗时和可取得的 GPU 时间；分别记录冷启动与预热耗时。不能靠降分辨率或回退到 WebGL2 获得“WebGPU 已提速”的结论。
- 生命周期：重新加载、质量切换、隐藏后恢复；捕捉设备错误并给出可恢复路径。

通过后新程序切为默认。旧版本作为独立回退产物保留一段时间，避免两套实现长期一起修改。

### WG5：按实测投入 WebGPU 特有优化（可选）

先量再选 GPU compute：如大规模实例可见性/LOD 或重复噪声烘焙。现有 shader 风动本来就在 GPU 上，不应把它重新写成 compute 并宣称迁移收益。

CPU 地形与碰撞仍需稳定数据源，避免每帧从 GPU 读回高度。若某优化依赖 WebGPU 独有能力，为 WebGL2 backend 明确保留较低成本路径。水反射与体积云仍分别归 P3/PX，不与兼容迁移捆绑验收。

## 与原 roadmap 的衔接

建议将 WG0–WG4 作为 **P1 收尾后、P3 大量扩充材质前的一段迁移**。P2 的纯布局/建筑尺寸和知识规则工作可继续；涉及同一 terrain、vegetation、PostFX 文件的改动需安排单一修改窗口。这样可以避免先新增一批旧 GLSL 效果，再全数翻译成 TSL。

改地图关系、桥廊样条、占地接口不是 WebGPU 接入的前置条件，按 P2/PE/P4 原计划实施。TSL 负责视觉形变和材质，plan/derive 继续负责真实空间与尺寸。

## 核对来源

- 本机 `node_modules/three/package.json`：0.185.1。
- 本机 `src/renderers/common/RenderPipeline.js`、`Info.js`、`extras/PMREMGenerator.js`；`src/nodes/lighting/ShadowNode.js`；`src/math/Frustum.js`。
- [WebGPURenderer：后端与回退](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Material：onBeforeCompile 的 renderer 边界](https://threejs.org/docs/pages/Material.html)
- [NodeMaterial：材质与阴影节点](https://threejs.org/docs/pages/NodeMaterial.html)
- [RenderPipeline：后期与输出颜色转换](https://threejs.org/docs/pages/RenderPipeline.html)
- [Frustum：coordinateSystem 与 reversedDepth](https://threejs.org/docs/pages/Frustum.html)

本文件列的是改造与验收方案；本轮没有实现 WebGPU 后端，没有跑迁移后的性能测试，也不承诺固定倍数的帧率提升。
