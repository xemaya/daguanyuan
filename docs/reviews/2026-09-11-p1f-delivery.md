# P1 F：分块、按需植被与构建提速

任务 E 的交付基线为 1d7cb2c9。本任务落实 F 的空间索引、高度复用、地形分块、实例分簇、草远近分档和构建预算；没有实现已取消的 GLSL 注入框架。

## 结果

- 生产构建世界生成约 **12.7–12.8 秒**，含 Worker 烘焙及传回后的主线程预热，低于15秒目标。E 基线约29.5秒。
- 地形由 E 的1.1m恢复为 **0.48m**；地表遮罩由768²恢复为 **1024²**。实际270×216m窗口，563×450网格，共 **506,700三角**，分为20块，低于地形60万预算。
- 全部64个测试与类型/分层/规则/平面硬断言/文档门通过。原P2的10个平面降级问题仍保留，不声称已修复。
- 最终14镜控制台零错误；峰值 **3,898,244三角、240 draw calls**，低于P1约790万三角上限。三角统计沿用阴影加主场景口径。
- 完整键盘游线 **PLAYTEST PASS**，包括翠嶂山口、沁芳亭北桥衔接、潇湘馆绕沟入院和落水禁行。
- 固定相机、时间和像素比后，三个关键机位只切换视锥剔除，画面 **零像素差异**，提交量下降。
- 31张贴图的同步/Worker结果：像素SHA-256、尺寸、颜色空间、过滤、重复和翻转参数全部一致；拆分任务前后也一致。模拟一个Worker失败时，4个已建Worker全部终止，零张半成品写入缓存，同步路径可继续使用。

## 实现

1. 区域与路径段按网格建立候选索引，保持原叠加顺序。离路径足够远的点不再计算无贡献的路径扰动；零边界权重不计算无贡献的草舌噪声。与事先保存的3,916点逐值对照，height、surface和masks零差异。
2. 地形先采完整格点加一圈边带，再从缓存求法线并切块。相邻块共享相同格点与法线；余下不整块也覆盖完整窗口。
3. 实例按空间簇组织，矩阵、颜色和风相位同步复制。使用Three每个相机自己的视锥测试，避免用主相机的可见性把画面外投影者提前删掉。
4. 草只为接近的簇生成实例矩阵与GPU缓冲，提前一簇准备；远簇只保留布点数据。路线可见范围维持0.32m，远离路线采用0.96m档位，仍消耗同样的随机数序列，避免重排近景随机结果。当前实际地形路曲线与控制折线的最大偏离约2.51m，小于密度判定额外留出的8m余量。
5. 共用程序化贴图在最多4个Worker中按十个任务预烘焙，再交回主线程原缓存。没有降低贴图分辨率，没有新增二进制美术源资产；无Worker/OffscreenCanvas时回到原同步生成路径。
6. camera在world.build前对准实际spawn，附近植被预热仍计入构建时间。加载提示为“调色”，内部具体计时保存在运行时数据与报告中。

## 为什么扩大了F的文件范围

原F清单集中于terrain和scatter。空间索引与分块完成后，实测仍为20.9秒；细分发现地形网格只约0.17秒、splat约0.78秒，而四类地表贴图约6.8秒。仅继续改高度场无法达到15秒，降低画质也不符合目标。

因此增加了共用TextureLab的Worker像素传输、builder侧烘焙任务、world预热步骤及浏览器验收与性能工具；main仅增加spawn相机预置。所有线程工作仍在world.build内等待，不把耗时挪到计时器之外。Worker像素传回后继续使用CanvasTexture，保留后续WG迁移的材质数据兼容性。

## 证据与重跑

- [性能报告](/Users/huanghaibin/Workspace/games/daguanyuan/shots/p1f-profile/report.json)
- [最终14镜](/Users/huanghaibin/Workspace/games/daguanyuan/shots/p1t7/manifest.json)
- [完整游线](/Users/huanghaibin/Workspace/games/daguanyuan/shots/p1t7/playtest.log)
- [Worker像素与失败回退](/Users/huanghaibin/Workspace/games/daguanyuan/shots/p1f-textures/report.json)
- [视锥剔除对照](/Users/huanghaibin/Workspace/games/daguanyuan/shots/p1f-culling/report.json)
- [E/F林带画面对照](/Users/huanghaibin/Workspace/games/daguanyuan/shots/p1f-compare/treeline.png)

生产预览使用独立4817端口；Worker像素验证用Vite开发入口4818，因它直接导入源码模块。

```bash
npm run check:all
node tools/verify-texture-workers.mjs
node tools/verify-culling.mjs --url http://127.0.0.1:4817/
node tools/profile-world.mjs --url http://127.0.0.1:4817/ --no-shots
node tools/capture.mjs --url http://127.0.0.1:4817/ --out shots/p1t7
node tools/playtest.mjs --url http://127.0.0.1:4817/
```

第一次剔除诊断同时关闭了距离档位与视锥，看到远处地被差异；原始结果保存在shots/p1f-culling-all-diagnostic。正式的视锥正确性对照保持距离档位相同，只切换视锥，三个机位均为零像素差。距离档位另由路线余量、布点确定性与完整行走确认，不能把这两类测试混为一个指标。

截图工具的即时FPS读数不作为稳定交互帧率承诺。本任务证明的是构建时间、分块/剔除正确性、阶段几何预算和通行回归；完整项目的稳定帧时仍须后续总验收。

## 未在本任务完成的范围

P1的水深窗口、自动林丛/树碰撞范围、玩家附近阴影还需收尾。P2的平面缺陷、完整建筑规格与29节点，以及PE/P3/P4/WG/PX/P5均未完成。F交付不等于P1整体完成，更不等于全roadmap完成。
