# 大观园

《红楼梦》大观园的纯代码程序化 3D 重建，第一人称在园中走。零美术资产：贴图现烤、模型程序生成、音效合成。

这个项目真正的资产不是园子，是**一条从古籍到几何的编译链**：《营造法式》《工程做法则例》《营造法原》的规则被核验成机读数据，推导器按模数语法把它们算成骨架，构件库把骨架变成面，装配器按平面图把构件摆成园子。换一栋建筑是填表，换一座园子是换数据。

```bash
npm install
npm run dev            # http://127.0.0.1:5173
npm run check          # 类型检查
npm test               # 单元测试
npm run check:layers   # 分层依赖门
npm run check:rules    # 规则一致性门
npm run build && npm run preview
BASE=/daguanyuan/ npm run build   # 部署到 hub 子路径
```

点画面锁定鼠标。**WASD** 走 · **Shift** 跑 · **空格** 跳 · **Esc** 放开。

---

## 先读什么

按这个顺序，读完就能动手：

| 顺序 | 文档 | 回答什么 |
|---|---|---|
| 1 | [docs/DECISIONS.md](docs/DECISIONS.md) | 为什么是现在这样。每条决定带理由和代价 |
| 2 | [docs/superpowers/specs/2026-09-10-layered-architecture-design.md](docs/superpowers/specs/2026-09-10-layered-architecture-design.md) | 四层怎么分、数据契约长什么样、规则状态机怎么工作 |
| 3 | [docs/PITFALLS.md](docs/PITFALLS.md) | 已经踩过的坑。改代码前扫一眼，能省几个小时 |
| 4 | [ART_DIRECTION.md](ART_DIRECTION.md) | 艺术圣经。做几何或材质的必读，它压过个人品味 |
| 5 | [docs/ROADMAP.md](docs/ROADMAP.md) | 下一步做什么，怎么分期 |
| 6 | [CONTRIBUTING.md](CONTRIBUTING.md) | 协作规矩：碰哪些文件、过哪些门、怎么提交 |

外部调研（要用先看它们各自的使用说明）：

- [docs/kg-paper-borrowing.md](docs/kg-paper-borrowing.md) — 同题论文（知识图谱驱动的大观园重塑）对照：该抄什么、不该抄什么
- [docs/tellux-borrowing.md](docs/tellux-borrowing.md) — tellux 开源 Earth Engine 的规模基建模式

要动某一块时再读对应的：

- 改建筑推导 → `knowledge/docs/fashi/README.md`、`knowledge/docs/qingshi/README.md`、`knowledge/docs/qingshi/tiers.md`
- 改园子布局 → `knowledge/docs/plan/README.md`、`knowledge/docs/plan/04-conflicts.md`（下游只读这篇判决书）
- 执行 P0 剩余任务 → `docs/superpowers/plans/2026-09-10-p0-skeleton-migration.md`
- 执行 P1 → `docs/superpowers/plans/2026-09-10-p1-foundation.md`（计划）与 `-p1-task-orders.md`（分派单）

## 四层

```
engine/      与内容无关的壳:渲染、输入、后期、散布机制、玩家、UI、音频
knowledge/   书 → 机读:研究稿(人读,带出处与裁决) + rules/*.json(机读,代码只读它)
builder/     生产引擎:derive(数)→ parts(面)→ compose(装配)。不认识大观园
projects/    一个园子一份数据:plan.json + scenes/*.json + 特有构件
```

依赖只能自上而下。`engine/` 不许 import `builder/`，`builder/` 不许 import `projects/`，`builder/derive/` 不许 import `three`（它只产数）。这三条由 `npm run check:layers` 执行。

跨层一律走别名 `@engine/ @builder/ @knowledge/ @project/`，不写 `../..`。

## 数据流

```
书 → 研究稿 md → rules/*.json
                     ↓
plan.json + scenes/*.json → derive(按 tier 选参数集) → Frame(骨架表,米)
                     ↓
                   parts(几何生成器) → Object3D + 碰撞/平台元数据
                     ↓
                 compose(装配 + 分块) → 场景
```

## 规则有状态

知识库的核心价值不是它记住了什么，是它能说出**自己不知道什么**。每条规则带状态：

| 状态 | 推导器的行为 |
|---|---|
| 通过 | 直接用 |
| 存疑 | 用更正值；有多个并存口径的，调用方必须显式选一个，不选就报错 |
| 驳倒 | 禁用，引用即抛，错误信息带更正值与出处 |
| 缺失 | 抛错，说明缺什么、该查哪本书；要覆盖必须显式传值并留痕 |

第一个"缺失"的案例：Tier A 若要求由柱高反算斗口，两本书都没给反函数，六个口径互差 8% 到 21%。清式推导器在未显式给斗口时会抛错，不拿中值蒙混过去。现有沁芳亭和潇湘馆已消费 plan 中的 fayuan 施工参数；正门仍用旧 fashi 预设，清式及复合建筑接入尚未完成。**缺失规则拒绝静默猜值，是设计意图。**

**要不要选口径，由这条规则有没有并存口径决定，不由状态决定。** 殿阁举高 `04-03` 状态是"通过"——条文本身没问题——但法式 L/3、唐构实测、辽构 L/4 三档并存，差到 32%。状态说的是"这条读得对不对"，口径说的是"这栋屋按谁的读法造"。逐条选太吵，所以 `builder/derive/profiles.ts` 把时代翻译成一张口径表（`song`/`tang`/`liao`）——里面只有口径的名字，没有营造数字。

推导完还会带回一份 `provenance`，分三支：`evidence` 有出处的事实、`inference` 我们在存疑口径里做的裁决、`art` 为体验主动做的偏离（区间里取哪一点、贴不贴上界）。混成一条链的后果是艺术决策被当成史料。

## 验收门

| 门 | 查什么 |
|---|---|
| `npm run check` | 类型 |
| `npm test` | 单元测试，含推导链的手算断言（佛光寺、长春宫、月到风来亭） |
| `npm run check:layers` | 分层依赖 |
| `npm run check:rules` | 研究稿与机读规则表的条目与状态是否对齐 |
| `node tools/check-plan.mjs` | 平面几何及七条约束的覆盖报告；最终使用 `--strict` 拒绝待完成项 |
| `node tools/manifest-diff.mjs A B` | 两次截图的结构数字（draw calls / 三角数 / 几何数 / 材质数） |
| `node tools/playtest.mjs` | 键盘走完游线，验门、桥、水、假山缝 |
| `node tools/shoot-part.mjs` | 构件棚拍，施工模型记录尺寸与出处；缺图或错误退出失败 |
| `node tools/verify-building-catalog.mjs` | 逐个核验已声明施工spec的建筑网格与柱碰撞 |
| `node tools/side-by-side.mjs` | 出左右对照图交人眼判观感 |

**观感回归不用逐像素**。场景里水面、竹叶、云一直在动，同一份构建连拍两次平均每像素就差 7 到 17 个色阶，噪声底比任何有意义的阈值都高。结构数字是确定性的，人眼判观感。详见 `docs/PITFALLS.md`。

## 现在到哪了

一条游线可走通：正门（五间）→ 翠嶂假山 → 沁芳亭桥 → 潇湘馆，键盘试玩全线通过。

知识库有三份研究稿共 362 条核验规则（法式 155、清式与法原与红楼 207），一份 19 区的平面真源，全部经过两名独立核验者（一个对原文逐字，一个对实测建筑）裁决。

P0 与 P1 已完成：分块/实例化、世界坐标与环境收尾已通过72个测试、14镜和完整游线。P2已补稳定对象身份与几何检查，并将20项江南建筑施工参数接入构件棚拍，其中沁芳亭、潇湘馆已进入实景；全部32项建筑规格已可执行推导并进入平面图，其中12项清式/复合/乡野细部几何仍待P3；19区轮廓与16处显式落脚面也已修订，地形、水深及植被共用动态采样范围；潇湘馆190m路径院墙、真实月洞门、54m曲廊及翠嶂西口10m跨溪石栈桥也已接入，29节点规划路线及五组未入远景观察位已落图，门桥洞连接、远景构件与其他专用/线性构件仍在推进。本次任务完成P2并验收后停止；后续阶段保留在 `docs/ROADMAP.md`。

## 授权

Apache 2.0(见 [LICENSE](LICENSE))。引擎壳取自 [pallet-town-3d](https://github.com/PauliusOS/pallet-town-3d)(MIT),上游许可全文与版权行见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md);中式部分全部新写。

《红楼梦》原文属公有领域。本项目是同人性质的技术实验。
