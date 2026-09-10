# 分层架构设计：知识库 / 生产引擎 / 项目层

日期：2026-09-10 · 状态：已批准（用户 2026-09-10 同意分层）

## 1. 目标

把现在这个"为大观园写的 three.js 工程"重构成三层，使得：

1. **知识库可核验、可增长**。书里的规则以机读形式存在，每条带出处与状态；"我们不知道"是一个程序能表达的状态，不会被编造的数字盖住。
2. **生产引擎不认识大观园**。给它一份平面数据和施工图，它就能造园；换成圆明园只换数据。
3. **项目层只有数据**。大观园 = `plan.json` + `scenes/*.json` + 少量特有构件。
4. **多 agent 可并行**。区域之间、构件之间、参数集之间互不阻塞，各有独立验收。

### 非目标

多人、存档、场景编辑器、移动端、真实光照物理。这些不在本设计范围内，提出即拒。

## 2. 目录分层

```
daguanyuan/                       仓库根（暂不拆包，靠目录与 import 规则卡边界）
  engine/                         与内容无关的壳
    core/       Engine Input PostFX TextureLab Noise Context
    render/     Atmosphere(天光/后期) Water Heightfield(高度场机制)
    scatter/    散布机制：泊松盘、遮蔽剔除、风场、LOD、实例化
    player/     PlayerController Collision
    ui/         HUD Menu Dialogue
    audio/      Synth Audio
    harness/    页面内的 hook：__GAME__ 句柄、冻帧、stats 采样

  knowledge/                      书 → 机读
    docs/fashi/                   宋《营造法式》研究稿（人读，带出处与裁决）
    docs/qingshi/                 清《工程做法》+《营造法原》+ 红楼原文 研究稿
    docs/plan/                    大观园平面复原研究稿（考据；数据本身在 projects/）
    rules/
      fashi.rules.json            材分制
      qing.rules.json             斗口制
      fayuan.rules.json           界与提栈
      honglou.rules.json          红楼梦建筑原文属性（74 条）
      plants.rules.json           花木名录与用法（学名/俗名/季相/哪个景点有/原文出处）
      missing.rules.json          已知缺口（从批评稿转来，机读的 TODO）
    check.mjs                     一致性门

  builder/                        生产引擎：数据 → 几何（不认识大观园）
    derive/
      grammar.ts                  推导链骨架：BuildingSpec → Frame
      fashi.ts qing.ts fayuan.ts  三套参数集
      status.ts                   规则状态处理（见 §5）
      types.ts                    BuildingSpec / Frame 契约
    parts/
      materials.ts registry.ts merge.ts
      damu/       大木：建筑本体（屋面、柱网、铺作、翼角、脊）
      xiaomu/     小木：格扇、栏杆、美人靠、匾额、对联、槛窗
      qiangyuan/  墙垣：粉墙、云墙、漏窗、月洞门、黄泥矮墙、篱笆
      shishan/    石山：太湖石、叠山、驳岸石
      shuigong/   水工：桥、驳岸、闸、汀步
      zhiwu/      植物：竹、柳、梅、桃、芭蕉、松、海棠、藤萝、荷、菜畦
      pudi/       铺地：冰裂、卵石、花街、青砖、石板
    compose/
      terrain.ts                  plan.json → 解析高度场（墙/水/山/路）
      composer.ts                 实例化 + 登记碰撞与平台
      stream.ts                   按区域分块装载卸载

  projects/
    daguanyuan/
      plan.json                   总图（真源）
      scenes/<region>.json        区域施工图，一区一份
      parts/                      本项目特有构件（如省亲牌坊）
      main.ts viewer.ts index.html
    （yuanmingyuan/ 将来）

  tools/                          harness 的 Node 入口（跑 playwright、跑校验）
  docs/superpowers/specs/         本文件
```

### import 规则（由 lint 门执行）

- `engine/` 不许 import `builder/` `knowledge/` `projects/`。
- `builder/` 不许 import `projects/`；可以 import `engine/` 与 `knowledge/rules/`。
- `builder/derive/` 不许 import `three`。它只产数。
- `projects/` 可以 import 任何层。
- `knowledge/` 是纯数据加校验脚本，不 import 任何运行时代码。

## 3. 数据契约

### 3.1 规则表 `knowledge/rules/*.json`

```json
{
  "source": { "book": "营造法式", "doc": "knowledge/docs/fashi/01-caifen.md" },
  "rules": [
    {
      "id": "01-05",
      "name": "八等材尺寸表",
      "status": "ok",
      "statement": "八个材等各自的材广、材厚（宋寸）、每分寸数及适用建筑。",
      "formula": "table",
      "table": [{ "grade": 1, "guangCun": 9.0, "houCun": 6.0, "fenCun": 0.6 }],
      "quote": "第一等：廣九寸，厚六寸……",
      "location": "卷四·材",
      "urls": ["https://zh.wikisource.org/wiki/營造法式/第四卷"],
      "needs": []
    }
  ]
}
```

字段：

- `status`：`ok` | `contested` | `refuted` | `missing`。
- `correction`：`contested` 时给更正值，代码用它而不是 `table`/`formula`。
- `choices`：有多个并存口径时给数组，每项 `{ key, value, note }`。**调用方必须显式选一个**，见 §5。
- `needs`：依赖的其他规则 id，供拓扑校验。
- `missing.rules.json` 的条目额外带 `whereToLook: { books: [...], keywords: [...] }`，直接来自批评稿。

**知识库与构件层的分工线：有出处的进知识库，调出来的进构件层。**
"潇湘馆有竹、怡红院有海棠芭蕉"是原文事实，进 `plants.rules.json`；竹竿多高、叶卡多大、分枝角度多少是美术参数，进 `builder/parts/zhiwu/`。同理，材等表进知识库，倒角半径进构件层。

### 3.2 建筑契约 `BuildingSpec` → `Frame`

`BuildingSpec` 是施工图里写的东西（材等或斗口或界深、间架、铺作、屋顶、tier）。
`Frame` 是推导器的输出：一张以米为单位的骨架表（柱位、柱高柱径、生起侧脚、铺作高与出跳、每一檩槫的坐标、檐出、翼角冲翘、脊位）。

现有 `src/fashi/derive.ts` 的 `Frame` 是这个契约的雏形，迁移时保留结构、补齐三套参数集共有的字段（对照 `knowledge/docs/qingshi/qingshi.schema.json` 的 `mapping` 段 24 条概念）。

### 3.3 总图 `projects/<name>/plan.json`

现有 `docs/plan/garden.plan.json` 即此文件，原样搬家。结构见其自身与 `knowledge/docs/plan/README.md`。

**已知缺陷（迁移后第一批要修）**：19 个区域的多边形都是同一个椭圆抖出来的七顶点 blob，不表达院墙、轴线、进深；73 个建筑里 56% 缺间数或屋顶；十七回 29 个节点只落了 14 站；五处"不及进去"的远景缺失；线性构件（墙、篱、夹道）用点坐标表达不了。

### 3.4 施工图 `projects/<name>/scenes/<region>.json`

```json
{
  "region": "xiaoxiangguan",
  "buildings": [
    { "id": "zhengfang", "x": 0, "z": 0, "yaw": 0, "spec": { "...BuildingSpec" }, "options": { "plaque": "有凤来仪" } }
  ],
  "walls": [{ "variant": "moon", "points": [[x, z], [x, z]], "height": 2.6 }],
  "rocks": [{ "part": "taihu", "variant": "peak", "x": 0, "z": 0, "yaw": 0 }],
  "plants": [{ "species": "bamboo", "cluster": "grove", "x": 0, "z": 0 }],
  "paving": [{ "pattern": "bingLie", "polygon": [[x, z]] }],
  "props": []
}
```

**线性构件用折线，不用点**。墙、篱、廊、夹道、驳岸都是 `points`。这条直接来自平面批评稿第 5 条。

坐标是区域局部坐标，原点在 `plan.json` 里该区域的多边形质心，装配器负责转到世界。

## 4. 数据流

```
书 → 研究稿 md → rules/*.json
                     ↓
plan.json + scenes/*.json → derive（按 tier 选参数集）→ Frame
                     ↓
                   parts（几何生成器）→ Object3D + 碰撞/平台元数据
                     ↓
                 compose（装配 + 分块）→ 场景
```

`plan.json` 也驱动地形：`compose/terrain.ts` 读 `wall`/`water`/`hills`/`paths` 生成解析高度场。现在 `Terrain.ts` 里硬编码的 `POND`、`MOUND`、`PADS`、`MAIN_PATH` 全部删除。

## 5. 规则状态机

这是知识库的核心价值：让"我们不知道"成为一个程序能表达的状态。

| 状态 | `derive` 的行为 |
|---|---|
| `ok` | 直接用 |
| `contested` | 用 `correction`；若该规则有 `choices`，调用方必须在 spec 里显式指定 key，未指定则抛 `AmbiguousRuleError` |
| `refuted` | 禁用。引用即抛 `RefutedRuleError`，错误信息带更正值与出处 |
| `missing` | 抛 `MissingRuleError(id, 缺什么, whereToLook)`；调用方可传 `overrides[id]` 显式覆盖，覆盖会记入 `Frame.provenance` |

`Frame` 带 `provenance` 字段：这次推导用了哪些规则、哪些走了覆盖、哪些是存疑的更正值。棚拍与截图 harness 把它写进 manifest，这样任何一张图都能回溯到规则。

**第一个案例**：Tier A 的"由柱高反算斗口"在书里不存在（清式批评稿 A1，六个口径互差 8% 到 21%）。迁移后正门与大观楼会抛 `MissingRuleError`，直到有人补规则或显式传覆盖。这是设计意图，不是 bug。

## 6. 验收门

| 门 | 查什么 | 何时跑 |
|---|---|---|
| `rules-consistency` | json 每条 id 在对应 md 里存在，状态一致；`needs` 无环、无悬空 | 每次改 rules 或 docs |
| `derive-assertions` | 手算校验当测试：佛光寺（材分）、长春宫（斗口）、月到风来亭（提栈） | 每次改 derive |
| `import-layers` | §2 的 import 规则 | CI |
| `plan-geometry` | 多边形闭合、不自交、不重叠、在墙内；入口在区域内；游线连通；七条不可违约束 | 每次改 plan.json |
| `part-shoot` | 构件棚拍（尺寸、三角数、draw call、剪影） | 每次改构件 |
| `scene-capture` | 区域截图合同（固定机位、固定 seed） | 每次改 scenes |
| `playtest` | 键盘走游线，验门/桥/水/缝 | 每次改碰撞或布局 |

门分两半：页面内的 hook 在 `engine/harness/`（暴露 `__GAME__`、冻帧、读 stats），Node 侧的入口在 `tools/`（起 playwright、算 diff、判通过）。现有 `tools/{capture,shoot-part,playtest,console-probe}.mjs` 原地保留，迁移时只改它们 import 的路径；新增 `tools/check-rules.mjs`、`tools/check-plan.mjs`、`tools/check-layers.mjs`。

## 7. 迁移映射

| 现在 | 去处 |
|---|---|
| `src/core/*` | `engine/core/` |
| `src/fx/SkyShader Clouds WaterMaterials TerrainMaterials` | `engine/render/` |
| `src/fx/Sculpt.ts` | `builder/parts/sculpt.ts`（几何工具，构件层用） |
| `src/fx/BuildingMaterials PropMaterials CreatureMaterials` | **删**（无人引用，真新镇遗留） |
| `src/fx/FoliageMaterials.ts` | 拆：卡片/风/半透机制 → `engine/scatter/`；树种材质 → `builder/parts/zhiwu/` |
| `src/world/Vegetation.ts` (2804 行) | 拆：散布/遮蔽/LOD/实例化 → `engine/scatter/`；六个温带树种 → 删；`builder/parts/zhiwu/` 按树种表新建 |
| `src/world/Terrain.ts` | 机制 → `engine/render/Heightfield.ts`；园子专有的池山路 → 删，改由 `builder/compose/terrain.ts` 读 plan |
| `src/world/Water.ts Atmosphere.ts` | `engine/render/` |
| `src/world/Collision.ts` | `engine/player/` |
| `src/world/Garden.ts World.ts` | `builder/compose/composer.ts` |
| `src/world/Interaction.ts` | `engine/player/` |
| `src/player/ src/ui/ src/audio/` | `engine/` 同名子目录 |
| `src/fashi/*` | `builder/derive/`，`fashi.ts` 成为三套参数集之一 |
| `src/cn/materials merge registry` | `builder/parts/` |
| `src/cn/parts/building.ts` | `builder/parts/damu/`（并拆出 `xiaomu/` 的格扇、匾额、美人靠） |
| `src/cn/parts/{taihu,wall,bridge,bamboo}.ts` | `builder/parts/{shishan,qiangyuan,shuigong,zhiwu}/` |
| `src/main.ts viewer.ts index.html viewer.html` | `projects/daguanyuan/` |
| `docs/{fashi,qingshi,plan}/` | `knowledge/docs/` |
| `docs/plan/garden.plan.json` | `projects/daguanyuan/plan.json` |

迁移在一个提交里做完，不留双份。迁移完成的判据：`npm run check`、`npm test`、`npm run build` 全过，截图合同与试玩与迁移前一致。

## 8. 分期与并行边界

**P0 骨架搬家**（一个人做，不并行，其余全部阻塞在它后面）
目录重排、删死文件、拆 Vegetation、rules 抽取与一致性门、import 门。

**P1 底层补齐**（可并行，五条互不依赖）
qing 参数集 / fayuan 参数集 / 规则状态机与 provenance / 地形从 plan 生成 / 分块流式与 LOD。

**P2 几何层补真**（一个人做，跨区一致性要求高）
19 区多边形改真院落轮廓、73 栋建筑补 spec、游线数据模型（站/节点/景三类）、五处远景、线性构件改折线。

**P3 构件库扩充**（高度并行，每类一个 agent）
植物按树种表、叠山成组、驳岸沿岸线、铺地四式、小木（对联/槛窗/美人靠）、乡野（黄泥墙/茅顶/篱笆/桔槔）。

**P4 分区建设**（高度并行，按游线顺序推进）
一区一个 agent，产出 `scenes/<region>.json`，过区域截图合同与试玩。

**P5 细节**
室内陈设、家具、灯笼、题字石、季相。

依赖：P1 与 P2 都要等 P0；P3 要等 P1 的参数集；P4 要等 P2 的几何与 P3 的构件；P5 最后。
