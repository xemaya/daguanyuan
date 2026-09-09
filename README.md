# 大观园

《红楼梦》大观园的纯代码程序化 3D 重建,第一人称在园中走。零美术资产:贴图现烤、
模型程序生成、音效合成。引擎壳取自 [pallet-town-3d](https://github.com/PauliusOS/pallet-town-3d)(MIT),
中式部分全部新写。

一期游线照第十七回贾政题匾的路:**正门 → 翠嶂假山(曲径通幽) → 沁芳亭桥 → 潇湘馆**。

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run check        # 类型检查
npm test             # 法式推导链断言 + 引擎单测
npm run build && npm run preview
BASE=/daguanyuan/ npm run build   # 部署到 hub 子路径
```

点画面锁定鼠标。**WASD** 走 · **Shift** 跑 · **空格** 跳 · **Esc** 放开。

---

## 底座:《营造法式》推导器

这个项目真正的资产不是园子,是 `src/fashi/`:一条以材分制为语法的大木作推导链。
给定材等、间架、铺作数、屋顶类型,推出柱高柱径、生起侧脚、出跳与铺作高、举折后每一槫的坐标、
檐出与翼角。所有数字带规则号,规则来自 `docs/fashi/` 的核验研究稿(155 条,每条两名独立
核验者:一个对原文逐字,一个对佛光寺/保国寺等实测)。存疑的规则做成参数,不伪造公式。

| 模块 | 内容 | 章 |
|---|---|---|
| `cai.ts` | 八等材、分值、尺长参数、材等选择区间 | 01 |
| `puzuo.ts` | P=T+3、跳距、出跳总长、铺作高 33+21T | 02 |
| `zhu.ts` | 柱径按屋类、檐柱高≤间广、生起、侧脚、阑额、柱础 | 03 |
| `juzhe.ts` | 举高比(法式/唐/辽)、折屋之法逐缝下折 → 槫坐标 | 04 |
| `yanchu.ts` | 檐出按椽径、飞子 0.6、生出按间数、起翘自由参数 | 05 |
| `derive.ts` | 组合成一栋屋的骨架表(米) | |

`tests/fashi.test.mjs` 里有 04-10 的 worked example(殿阁八椽 L=60 尺 → 20/13.000/7.667/3.333)
和佛光寺的几处实测断言。`docs/fashi/README.md` 末尾的批评稿列了从这里到"完整三维大木作生成器"
还缺的 17 类规则(柱网分槽、梁架拓扑、转角列栱……),那是二期。

## 构件库 `src/cn/`

- `materials.ts` 一园一色:粉墙/黛瓦/木/青石/太湖石/竹/纸/漆/金。材质实例缓存,装配器靠它把几十件合成几个 draw call。
- `parts/building.ts` 由推导表出几何:台基、柱、阑额普拍枋、简化铺作、举折屋面、翼角起翘生出、脊、山花、格扇、美人靠、匾额。预设 `ting`(攒尖亭)/`tang`(歇山小三间)/`lang`(廊)/`men`(门屋)。
- `parts/taihu.ts` 太湖石:metaball 负球挖透孔 + 褶皱位移 + 场采样 AO;`peak` 独峰、`mound` 带走人缝隙的假山、`edge` 驳石。
- `parts/wall.ts` 粉墙系列:`plain`/`moon` 月洞门/`lattice` 漏窗(冰裂、万字、海棠)/`cloud` 云墙,压顶瓦垄是真几何。
- `parts/bridge.ts` 三折曲桥(石板拼缝、墩、石栏)、驳岸模块、独立石栏。
- `parts/bamboo.ts` 竹丛:竿/枝/叶三组 InstancedMesh,风摆在顶点着色器里。
- `registry.ts` + `parts/` glob 自动登记;`merge.ts` 按材质合并静态件。

每个构件先过棚拍再进园:

```bash
node tools/shoot-part.mjs --url http://127.0.0.1:5173/viewer.html --subject building:ting,taihu:peak --angles front,three_quarter
```

`viewer.html?subject=<name>:<variant>&angle=...&bg=...` 是活的转台。

## 园子 `src/world/`

- `Terrain.ts` 解析高度场:四面林岗围合、沁芳池按 warp 椭圆挖坑、翠嶂土丘、潇湘馆台基、园路脊线。
- `Garden.ts` 装配器:`SCENE` 表按 (part, variant, x, z, yaw) 放构件,登记平台(台基/桥面)与阻挡(柱/墙/栏/石),池岸驳石沿"刚露水"等高线自动摆。
- `Collision.ts` 在真新镇的基础上加了平台层与落水禁行;**旋转约定改成与 three 的 rotation.y 一致**(原版相反,只是没暴露)。

## 验收

```bash
node tools/capture.mjs --url http://127.0.0.1:4173/ --out shots/review   # 镜头清单 + draw calls/tris/fps
node tools/playtest.mjs --url http://127.0.0.1:4173/                      # 键盘走完游线,验门/桥/水/缝
node tools/console-probe.mjs http://127.0.0.1:4173/ garden                 # 每种构件三角数
```

`tools/playtest.mjs` 不用 teleport 作弊:逐航点转身按 W,3 秒没进展算卡住。它抓出过亭子美人靠
横在出口、桥栏旋转反了、落水线太贴水面三处真 bug。

## 已知未做

- 驳岸模块(`bridge:bank`)没沿岸线摆,岸只靠驳石。
- 铺作是块体示意,没有栱枓昂的真分件;转角铺作、梁架、山花做法见 `docs/fashi/README.md` 批评稿。
- 三角数约为真新镇预算的两倍(4~5M 含阴影与 G-buffer 两遍),1600×900 45~60fps;远处竹丛与围墙可加 LOD。
- 荷花、落叶、青苔、石灯、楹联、人物一概没有。

## 艺术圣经

`ART_DIRECTION.md`:色板、硬规则、江南园林的形、验收清单。多 agent 并行时它压过个人品味。
