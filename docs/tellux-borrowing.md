# tellux 调研:可借鉴点与落地建议

> 调研对象:[cyanfish-x/tellux](https://github.com/cyanfish-x/tellux)(MIT,0.3.0)
> 调研日期:2026-09-10。结论面向本工程 ROADMAP §1.5 规模基建(地形分块流式 / LOD / 实例化 / 滚动阴影)与后续工程债。

> **两条使用说明(2026-09-10 审阅时加)**
>
> 1. **文中的文件路径与行号未经核验。** 仓库没在本地,这些引用是单 agent 调研的产物。
>    按 `docs/DECISIONS.md` D-04 的教训:架构层面的观察可以当设计模式用,精确的行号与
>    数值别当事实引——真要照抄某段代码(比如第 7 节说"可直接抄"的那 96 行缓存),先把
>    仓库拉下来核。
> 2. **第 9 节的落地次序不采纳。** 它把 Clock 单一时间源与 ResourceScope 排在前两位:
>    前者服务的昼夜晨昏是我们还没承诺的功能,后者解决的构建回滚对单页游戏价值很低。
>    真正卡住我们的是第 4 条(网格分簇 + 簇级视锥剔除)与第 3 条(屏幕误差 LOD):画布
>    从 60 米见方涨到 500 米见方是 48 倍面积,现在整片植被是一个大 InstancedMesh,不分簇
>    一定跑不动。重排后的次序:分簇剔除与屏幕误差 LOD(P1)→ shader 注入的有序 stage
>    (P1,加风摆加实例偏移加 LOD 形变时必撞)→ 异步缓存(P1 分块真异步了才需要)→ 其余按需。
>
> 本文最有价值的是第 8 节两个"不要",两条都对。

## 0. tellux 是什么

基于 Three.js(`three ^0.184`)的开源 3D Earth Engine,面向数字地球 / 数字孪生 / 三维地图。核心策略是**重活全部委托上游库**:

- 地形/瓦片:`3d-tiles-renderer`(含 QuantizedMeshPlugin、TilesFadePlugin、UpdateOnChangePlugin)
- 大气:`@takram/three-atmosphere 0.19.1`
- 体积云:`@takram/three-clouds 0.7.6`
- 后处理:`postprocessing 6.39.1`

自身代码集中在四件事:**组合、门面(facade)、对上游的补丁层、资源生命周期**。这对我们的启示是方法论级的——它的价值不在地球/GIS 功能(我们几乎都用不上),而在规模化基础设施的设计模式。

## 1. 架构观察

- 公开 barrel `src/index.ts`,组合根 `src/Viewer.ts`(1341 行)。公开 API 按领域门面分组:`viewer.overlays / tilesets / models / terrain / globe / renderer / postProcess / controls / camera / clock / scene`。
- **门面 + `.raw` 逃生舱**:每个门面暴露 `.raw` 返回底层对象,文档明确"越过此线自负"(`src/Camera.ts:182`)。
- **初始化与运行时同构**:`ViewerOptions.scene.clouds.quality` 与运行时 `viewer.scene.clouds.quality` 走同一套 Settings 类,Settings 持回调把变更推给 runtime manager,避免双状态漂移。
- **装配事务 ResourceScope**(`src/lifecycle/ResourceLifecycle.ts`):构造函数里每创建一个可释放资源就 `scope.defer(disposer)`,中途抛错逆序回滚,成功 commit;`Viewer.create()` 静态工厂包住异步初始化失败自动销毁。`destroy()` 幂等 + 固定释放顺序(`src/Viewer.ts:1168`)。
- 每帧调度顺序(`src/Viewer.ts:1205`):清帧缓冲 → Clock.tick → resize/controls → fallback 光照 → tilesetManager.update() → 大气光源/自动曝光 → 模型/HISM/高亮 → renderer → 后合成。采样任务"帧后再挂一个 rAF"推进,不抢占主循环。

## 2. 地形与 LOD(对应 ROADMAP §1.5)

- 地形复用 3d-tiles-renderer 的 QuantizedMeshPlugin,**LOD 选择 = 屏幕空间几何误差**(`tileset.errorTarget`,地形默认 1,`src/tiles/TerrainTilesetFactory.ts:44,176`);切换用 **TilesFadePlugin 抖动淡入**(dither 而非 opacity);UpdateOnChangePlugin 按需渲染(`src/tiles/TilesetManager.ts:449-450`)。
- **热切换分级**(`src/tiles/TilesetManager.ts:179-211`):结构变化才重建 surface/terrain tileset(保留 Viewer/camera/renderer);排序只调 `setOverlayOrder`;显隐/样式只 sync 单层。
- `src/sampling/AsyncLruCache.ts`(96 行):容量边界 + 同 key 并发去重(共享 promise)+ 失败立即淘汰 + pending 带 AbortController。**可直接抄**。
- `src/sampling/HeightSampler.ts`(1064 行):批量异步采样,整批共享 LoadRegion 与离屏相机、跨帧等待稳定;注释量化"逐点 await 慢 1~2 个数量级"(`src/Viewer.ts:1088`)。
- 高度采样用**可复用隐藏 tileset 池**(`src/tiles/HeightSamplingTilesetPool.ts`),优先在主场景 tileset 上加临时 LoadRegion,采完瓦片留在主缓存。

## 3. 相机与时间

- `src/Camera.ts`(523 行):`setView / flyTo / getState`;椭球来源用注入回调而非 `camera.userData` 隐式挂载;`flyTo` 缓动 easeInOutCubic、高度走"过顶弧线"双段 lerp(`Camera.ts:487-491`),时长按球面距离自适应 clamp 1~6s,角度插值走最短角。
- 补丁式 controls(`src/controls/TelluxGlobeControls.ts`):低俯仰禁左键拖拽(根治射线切球面"光速退远")、松手 pitch 弹簧回弹(`1-exp(-rate·dt)` 帧率无关衰减)。补丁注释全部写明"上游为什么坏、这里为什么安全"。
- **Clock 单一时间源**(`src/Clock.ts`,263 行):只有 currentTime/shouldAnimate/multiplier 三态 + change/tick 事件;Timeline 只是消费者(`notes/decisions/Clock统一场景时钟.md`)。
- **拖时间用弹簧**(`src/SpringControl.ts`):UI 读设定值、光照读弹簧中间值,时间跳转变成平滑日出日落。纯函数逻辑抽到 `src/widgets/Timeline/logic.ts` 可单测,DOM 层只做渲染。
- 交互细节:拖动中不回写正在操作的 input;seek 才暂停播放;倍率调整不打断播放;`window.blur` 结束控制态。

## 4. 大气 / 云 / 后处理

- 大气全部来自 @takram/three-atmosphere:`AerialPerspectiveEffect`(后处理空气透视)+ `SunDirectionalLight` / `SkyLightProbe` 双轨,光照模式分 post-process / light-source 可混用(`src/rendering/AtmosphereManager.ts`,821 行)。预计算 LUT 由 `PrecomputedTexturesGenerator` 生成。
- 昼夜:Clock 时间 → `getSunDirectionECEF/getMoonDirectionECEF` → 按太阳高度角 smoothstep 出 `nightFactor` → 派生月光(含月相)、夜间环境光、星空亮度、云夜光;自动曝光随 nightFactor damp(`src/Viewer.ts:895-910`)。所有定制走 uniform 注入补丁(`AtmosphereShaderPatches.ts`),不改上游源码。
- 体积云(@takram/three-clouds CloudsEffect):局部天气图 + shape/shapeDetail 3D 纹理 + STBN 蓝噪声 + 2 级联云影。tellux 侧只做:参数映射、相机高度淡出(**乘在 coverage 上而不是改写用户值**)、云成图结果回喂空气透视合成。
- 后处理不用 EffectComposer,而是 patch `WebGLRenderer.setEffects`,链序(`src/rendering/PostProcessingManager.ts:212-258`):NormalPass(HalfFloat)→ LightingMask → GroundClamp → Clouds+AerialPerspective → EDL → Weighted-OIT → Bloom(mipmapBlur)→ SymbolOcclusion → LensFlare → Outline → SMAA → Dithering。**`effectsKey` 字符串做变更检测,不变不重排**(`:192-207`);每个 pass 的排序理由写注释。文字 symbol 在 tone mapping 之后以 display 空间合成,避免被 AgX 压扁(`src/Viewer.ts:1240`)。
- 两个实战坑(EffectPassAdapter,`src/effects.ts`):深度纹理要每帧检查重绑;postprocessing 的 pass 需关 autoClear 否则清掉深度。
- WebGPU 是单一后处理图(多 effect 抢 renderer delegate 会冲突),决策见 `notes/decisions/0003`。

## 5. 实例化与性能(HISM)

`src/hism/` 分层实例化:

- 实例按 512m 网格 cell 分簇(`spatial/clusterGrid.ts`),每簇一个 boundingSphere 做视锥剔除(`spatial/frustumCull.ts`)。
- 簇内按 archetype × LOD × part 建 InstancedMesh,LOD 按距离切换(`core/HismCluster.ts:259-265`)。
- 拾取先按簇球体排序再 raycast,配 three-mesh-bvh;有专门 benchmark 脚本(`scripts/hism-benchmark.mjs`)。
- **RTC high/low 拆分**(`src/rendering/applyRTCInstancing.ts`):实例平移拆 high/low 两个 InstancedBufferAttribute(Cesium EncodedCartesian3 同款),instanceMatrix 只留旋转缩放。
- **PositionPipeline**(`hism/pipeline/PositionPipeline.ts`):RTC、风摆等 shader 注入做成**有序 stage**,解决多个注入争抢 `project_vertex` 的问题。

## 6. 工程实践

- 测试:vitest(node 环境),约 60 个测试文件。特色:`publicApiSurface` / `publicApiContract` / `apiStabilityRegression`(公开 API 面回归)、`distApiSurface`(build 后验证 dist 导出,挂在 build 脚本)、`resourceLifecycle`(装配回滚)、`asyncLruCache`。
- 无 CI workflow;质量门 = `pnpm type-check` + `pnpm build`(含 dist API 测试)+ commitlint + husky。
- 文档三层分离:用户文档 `docs/`(VitePress)、维护者知识 `notes/`(架构/ADR/调研/**坑点记录**)、示例 `examples/`。`notes/engineering/项目坑点记录.md` 每个非显然 bug 一篇根因记录。
- Sandcastle:Monaco + iframe runner,示例用 `import.meta.glob` 扫描自动注册,示例直接从 `../src` 引入库本身,使示例成为源码的实时反馈面(与我们 viewer.html 棚拍台同思路)。
- 代码风格:面向用户的 API 中英双语 JSDoc;注释解释"为什么"和"上游坑";严格 readonly;配置用 resolver 集中规范化。

## 7. 对本工程最值得借鉴的 10 点(按价值排序)

| # | 借鉴点 | tellux 出处 | 对应本工程需求 |
|---|---|---|---|
| 1 | **AsyncLruCache**(96 行可直接抄):容量+并发去重+失败淘汰+中止 | `src/sampling/AsyncLruCache.ts` | 地形分块流式加载的缓存核(ROADMAP §1.5) |
| 2 | 瓦片热切换分级:结构重建 / 排序 / 显隐走不同通道 | `src/tiles/TilesetManager.ts:179-211` | 地形分块、图层开关避免全量重建 |
| 3 | 屏幕误差 LOD(errorTarget 语义)+ 抖动淡入(dither 非 opacity) | `TerrainTilesetFactory.ts:44` + TilesFadePlugin | ROADMAP 的地形 LOD / imposter |
| 4 | 网格分簇 + 簇级视锥剔除 + 距离 LOD 的实例化模板 | `src/hism/` | 植被扩 25 倍后单个大 InstancedMesh 无法剔除 |
| 5 | PositionPipeline 有序 stage 解决 shader 注入争抢 `project_vertex` | `hism/pipeline/PositionPipeline.ts` | 竹丛风摆等 onBeforeCompile 叠加时会撞上 |
| 6 | Clock 单一时间源 + 弹簧驱动时间切换;天空/音频/UI 全是消费者 | `src/Clock.ts`、`src/SpringControl.ts` | 做昼夜/晨昏氛围的前提基建 |
| 7 | 后处理链 effectsKey 变更检测 + 排序理由注释 + 两个实战坑 | `src/rendering/PostProcessingManager.ts`、`src/effects.ts` | 我们自写 GTAO/Bloom/DOF/SMAA 链的同类问题 |
| 8 | ResourceScope 装配事务 + 幂等 destroy(68 行模式) | `src/lifecycle/ResourceLifecycle.ts` | World 分步构建失败回滚、子系统增多后的销毁顺序 |
| 9 | 批量异步采样:整批共享加载区、跨帧等稳定(逐点 await 慢 1~2 个数量级) | `src/sampling/HeightSampler.ts` | 分块地形上的贴地摆放与碰撞查询 |
| 10 | 坑点根因记录 + 公开面回归测试的工程习惯 | `notes/engineering/`、`publicApiSurface.test.ts` | 与现有"注释即设计史"文化同构,成本为零 |

## 8. 两个不要(泼冷水)

1. **不要直接引入 @takram/three-atmosphere / three-clouds**:它们按地球尺度设计(球体、ECEF、太空视角)。我们的天空穹顶 + FogExp2 对园林尺度是对的;真想升级先看 tellux `examples/atmosphere-local-meadow` 的无球用法再评估。
2. **不要整体采用 3d-tiles-renderer / quantized-mesh 管线**:那是为真实地形数据设计的。我们的地形是解析函数,分块化只需"按 cell 采样函数 → 分块 mesh + LOD",借用屏幕误差语义即可。引入整套瓦片管线是过度工程,也违背项目"零资产、依赖极简"的预算纪律(CONTRIBUTING.md)。

## 9. 建议的落地次序(结合 ROADMAP §1.5)

1. **Clock 收敛**(#6)——先做,因为后续昼夜、风、水面动画都挂在时间上;成本最低。
2. **ResourceScope**(#8)——World 分步构建重构时顺手引入。
3. **AsyncLruCache + 分块调度**(#1、#2)——地形分块的核。
4. **屏幕误差 LOD + dither 淡入**(#3)——分块地形与建筑 LOD 共用语义。
5. **HISM 分簇**(#4、#5)——Vegetation 重构时整体替换现行单 InstancedMesh 方案。
6. **批量采样**(#9)——分块地形落地后再做,届时解析高度场退场才需要。
7. **坑点记录习惯**(#10)——即刻开始,归入 `docs/`。
