# 面向扩展的架构调整(设计稿)

2026-09-14。**这不是重写。** 四层骨架(`engine/` → `builder/` → `knowledge/` → `projects/`)
是对的、门是真的、`plan.json` 这份真源已经很厚。这份稿子只做一件事:
**把几处"最后一节接头"焊上**——它们现在都由人在脑子里跳过去,机器查不回来、也复制不了。

前置调查见本文 §1,每个数都是当场量的,不是回忆。

---

## 0. 三条目标,翻成能验的判据

| # | 用户原话 | 判据(可以拿来验收的那种) |
|---|---|---|
| 1 | 一个个区块建设,能独立扩展,不是堆在一起的代码 | **加一个区,diff 里不许出现 `.ts`**。只动 `plan.json` + `scenes/<region>.json` |
| 2 | 基建提升全局收益,新增基础构件块所有区域都用起来 | **新做一个构件,不去任何一张表里逐区手写,就有区吃到**;`check:scenes` 能当场列出它会出现在哪几个区 |
| 3 | 不同部分独立优化,优化渲染引擎样式就好看 | (a) 观感参数在**一个**文件里;(b) 区从 4 涨到 19,**地面精度与地形网格精度不下降** |

**第 3 条的 (b) 现在不成立,而且是必然不成立**,有实测数字,见 §1.3。
这是最要紧的一条:它意味着**按现在这套代码建完 19 个区,园子会比现在更糊**。

---

## 1. 现在卡在哪(四处,都量过)

### 1.1 加一个区,要改四处代码

| 这一步 | 现在在哪 | 该在哪 |
|---|---|---|
| 区边界 / 建筑清单 / 标高 / tier / style | `plan.json` ✅ | 数据 |
| 构件落位 | `composer.ts` 的 `SCENE` 常量(689 行文件里的手写表) ❌ | `scenes/<region>.json` |
| 地形采样窗口 | `terrain.ts` 的 `MVP_REGIONS = ['zhengmen','cuizhang','qinfang_ting_qiao','xiaoxiangguan']` ❌ | 按区分块,自动 |
| 建筑占位(别让树长进屋) | `vegetation.ts` 的 `FOOTPRINTS` **手抄表** ❌(`99-25`) | occupancy prepass,一份真源 |
| 游园图地点 | `map-places.ts` 从 plan 现算 ✅ | 数据 |

**五步里三步要改代码。** 而且 `FOOTPRINTS` 那一步是手抄的第二份真源——竹子种进潇湘馆屋里
那个 bug 就是它和 `D_XIAOXIANG` 平移量一起造成的,`composer.ts:273` 的注释自己写着
「房子后来被单子 M/P 改过,平移量没跟着更新」。**手抄的真源一定会漂。**

### 1.2 `SCENE` 表里已经有一半是零信息量的

这是最好的消息。看这一条:

```ts
{ part:'garden-wall', variant:'xiaoxiangguan.courtyard-wall', x:0, z:0, tag:'潇湘馆院墙' }
```

`garden-building` / `garden-wall` / `garden-corridor` / `garden-bridge` 这四个 part 是
`projects/daguanyuan/construction.ts` 注册的**计划驱动件**:`variant` 就是 `plan.json` 里
对象的稳定 id,尺寸从该对象的 `construction.spec` 读,坐标从 plan 的锚点读。

> **这条 SCENE 记录没有携带任何 `plan.json` 里没有的信息。它是能被生成的。**

`plan.json` 实测:19 区 / 75 个建筑条目 / **32 个带 `construction.spec`**。
这 32 个全都可以由一次遍历生成,不需要任何人手写落位。

剩下真正需要人写的是**散置件**:竹丛、太湖石散石、灯、驳石。它们没有 plan 锚点。
现在它们是硬编码坐标 + 批量平移常量(`D_ZHENGMEN` / `D_CUIZHANG` / `D_QINFANG` / `D_XIAOXIANG`)。

### 1.3 区数一涨,全局观感就劣化(实测)

同一套代码,只把 `MVP_REGIONS` 从 4 个改成 19 个:

| | 采样窗口 | 地形网格(`CELL=0.48`) | splat 1024² 精度 |
|---|---|---|---|
| **现在(MVP 4 区)** | 270 × 218 m | 562 × 454 = **0.26 M 顶点** | **26.4 cm/texel** |
| **全 19 区** | 500 × 514 m | 1042 × 1071 = **1.12 M 顶点** | **50.2 cm/texel** |

**地面纹理精度直接掉一半,顶点涨 4.3 倍。**

根因是 `terrain.ts` 的设计前提:**一张网格 + 一张 splat 图,覆盖一个窗口**。
窗口一大,两样一起劣化。这不是"以后再优化"的事——**它让目标 3 在结构上不可能达成**:
渲染做得再好,区一多就被摊薄了。

(顺带:`P-17` 记过一次「世界尺度一变,所有米制观感参数都要重标定」,雾/AO/景深三处
是同一个根因。那次是 64×72 → 280×226。下一次是 280×226 → 500×514,**会再来一遍**。)

### 1.4 从原文考据到数值存档这一跳,机器查不回去

`plan.json`:`basis` 字段 **107 条**、`quote` **58 条**、**规则 id 引用 0 条**。

`basis` 全是散文(「P2园林施工侧样:尺长32cm沿用项目尺度口径…」),读得懂,但
`knowledge/docs/qingshi/07-honglou.md` 那 74 条原文事实表改了,**没有任何门会告诉你
哪几栋房子的数该跟着动**。19 区一铺开,这条链就彻底断了。

---

## 2. 目标架构:五条接缝

```
knowledge/rules/*.json ──┐
                         ├──► builder/derive ──► builder/parts ────┐
projects/plan.json ──────┤         (数)              (面)          │
  + scenes/*.json ───────┘                                         ├──► builder/compose
        ▲                                                          │        (按区装配)
        │                                                          │
   ①区清单  ②选料规则  ③占位真源                          ④分块  ⑤观感一张表
                                                                   │
engine/ (与内容无关的壳:渲染 / 输入 / 后期 / 散布机制 / UI) ◄──────┘
```

### 接缝 ① `scenes/<region>.json` —— 一个区一份落位清单

`README.md:53` 早就写了 `projects/ = plan.json + scenes/*.json + 特有构件`,
**`projects/daguanyuan/scenes/` 目录已经存在,是空的**。形状留了,料没填。

契约(草案,最终形状由单子 Y 定):

```jsonc
{
  "region": "xiaoxiangguan",
  "$comment": "潇湘馆。点名件由 plan.json 生成,这里只写 plan 里没有锚点的东西。",
  "placements": [
    { "part": "taihu", "variant": "peak4",
      "anchor": "xiaoxiangguan.main-house", "dx": 5.0, "dz": -17.0, "yaw": 0.4,
      "basis": "07-14 「后院墙下忽开一隙」旁的散石,位置为艺术选择" }
  ],
  "scatters": [
    { "part": "bamboo", "rule": "竹-丛生",
      "area": "region", "density": 0.06, "avoid": ["building", "path", "water"],
      "source": { "chapter": 17, "quote": "千百竿翠竹遮映" } }
  ]
}
```

**三条纪律**:

1. **落位坐标一律相对锚点,不许写世界绝对坐标。** `D_*` 那四个批量平移常量是
   "旧世界补丁",它们存在的每一天都在等着制造下一个"竹子进屋"。
2. **每条 `placements` 要有 `basis`**,和 `plan.json` 同口径。摆一块石头是艺术选择也行,
   **写出来就行,不写不许进**。
3. **`scatters` 不写坐标。** 写条件,让散布器算——这是接缝 ② 的入口。

`composer.ts` 从此不再持有 `SCENE` 常量,它的工作变成三步:
**遍历 plan 生成点名件 → 读 scenes 的 placements → 跑 scatters**。

### 接缝 ② 选料规则 —— 没点名的按区的 `style` 吃

这是目标 2 的机制。**现在新做一个构件(比如单子 V 的斗拱),要被用起来,必须有人去
`SCENE` 表里手写条目。** 4 个区还行,19 个区不行。

但我们已经有一个能用的范本:`vegetation.ts` 的树就是**按地表条件散布**的
(「地表是草且高于 0.2 m」这类门槛)。**把它泛化成所有构件都能用的散置层就行,不用发明。**

而且 `plan.json` 的 19 个区**每一个都带 `style` 五维**:

```json
"tier": "B",
"style": { "official": 0.1, "jiangnan": 0.95, "rustic": 0.15, "enclosure": 0.85, "ornament": 0.3 }
```

这五个数现在**没有任何代码消费**。它们本来就是为这件事准备的。

于是散置规则长这样(住在 `builder/` 里,不认识大观园):

```jsonc
{ "id": "铺地-花街", "part": "paving", "variant": "huajie",
  "appliesTo": { "jiangnan": [0.6, 1.0], "tier": ["B", "C"] },
  "where": { "surface": "pave", "inside": "courtyard" } }
```

**新增一个构件 = 加一条规则。所有匹配的区当场吃到,一行落位都不用写。**

这条接缝顺带解掉 backlog 里的 `D1 · PQ-4 花池`:那条卡死的原因正是散布门槛
(「地表是草且高于 0.2 m」≥ 0.9)**写死在代码里**,铺装院子里永远长不出花。
规则化之后,"花池"就是一条 `where.surface: "pave"` 的规则。

**⚠️ 这条最容易做过头。** 判据只要求 `check:scenes` 能列出"哪条规则会落到哪几个区",
**不要去做一个通用的约束求解器**。`D-18`「别让 compiler 吞掉大观园」。

### 接缝 ③ occupancy prepass —— 占位的唯一真源

`99-25` 已经记了两年账:`vegetation.ts` 的 `FOOTPRINTS` 是手抄的第二份真源。
`world.ts` 的头注释自己写着这笔债,还特意警告"**不要靠调换步骤来修**,那会让手抄的
那份变成唯一真源,债挖得更深"。

正解是一次**占位预计算**:从 plan 的建筑/墙/廊/桥 + scenes 的 placements 算出一张
occupancy 场,**地形、植物、散置三方都读它**。

顺带把 `99-26` 一起收了(匾额文字三处真源,几何读的是硬编码那份)。

### 接缝 ④ 地形 / splat / 散布按区分块

目标 3(b) 的唯一解法。要点:

- 采样窗口不再是"一个大矩形",而是**按区(或固定尺寸的 chunk)各自烘焙**;
- splat 从"一张 1024² 盖全场"变成**每块一张**,于是 **texel 密度与区数无关**;
- 没走到的区不烘焙(游园图的 `reachable` / `visited` 已经有"去没去过"这个概念,
  `99-27` 收口时做的 `visited.ts` 正好是现成的触发源)。

**⚠️ 这是五条里最贵的一条,也是最容易做崩的。** 分块的接缝(高程连续、splat 接缝、
阴影级联、碰撞场)每一处都能出可见的裂纹。**必须最后做,而且要有对照图。**

### 接缝 ⑤ 观感参数一张表 + 节点材质归位

两件小事,一起做:

1. **观感参数集中**。`FogExp2(0.0017)`、雾色 `lerp 0.08 ×0.68`、GTAO `radius 2.4/thickness 1.4`、
   `dofFar 400/dofStrength 0.35`、FOV `62°`、速度 FOV `62→68`、侧滚 `0.026`——
   现在散在 `PostFX.ts` / `Atmosphere.ts` / `PlayerController.ts` / `Engine.ts`。
   `P-17` 已经证明它们是**一组**:世界尺度一变就得一起重标定。收进一张表
   (`engine/core/look.ts` 或 `looks/default.json`),**一处改,全局生效**。
   这也让 backlog 的 `B1 晕 3D`(要给侧滚/横摆/FOV 泵动各一个系数)变成改一个文件。
2. **节点材质归位**。TSL 节点代码现在分在 `engine/render/nodes/`(7 个)与
   `builder/compose/nodes/terrain.ts`(1 个)。**"节点材质归谁管"这条边界现在是模糊的**,
   趁只有一个越界的时候收掉。

---

## 3. 分期与依赖

| 单子 | 内容 | 接缝 | 前置 | 规模 | 风险 |
|---|---|---|---|---|---|
| **Y** | 区清单契约 + `composer` 改读 scenes(点名件由 plan 生成) | ① | V 合入 | 中 | 中 |
| **Z** | occupancy prepass,消 `99-25` / `99-26`;散置规则层(含 PQ-4 花池) | ②③ | Y | 中大 | 中 |
| **AA** | 地形 / splat / 散布按区分块 | ④ | Z | **大** | **高** |
| **AB** | 观感参数一张表 + 节点材质归位(顺带 backlog `B1` 晕 3D 三档) | ⑤ | 无 | 小中 | 低 |
| **AC** | `plan.json` 的 `basis` 挂规则 id + `check:plan` 加一条引用门 | — | 无 | **小** | 低 |

### 排期建议

```
V(在跑) ─► Y ─► Z ─► AA ─► P4 开始建区
   W(已写,纯 engine/render,正交,随时可插)
   AB / AC(正交,随时可插,建议插在 Y 之前当热身)
```

**⚠️ 一处顺序上的发现,值得改已写好的单子 X**:

`ROADMAP §PE-1` 白纸黑字写着「`plan.json` **与 `scenes/<region>.json`** 各加一个
`experience` 段」。**但 `scenes/` 现在是空的。** 单子 X 如果先派,它只能做 plan.json 那半边,
`scenes` 那半边会悬空——而单子 X 自己的核心论点就是"**没有消费者的契约,十有八九写歪**"。

**建议把 Y 插到 X 前面**,X 就有两个真实落点了。

### 每期的验收判据(对应 §0)

- **Y** → 用一个还没建的区(例如稻香村)做**空跑试验**:只写 `plan.json` 一段 +
  `scenes/daoxiangcun.json`,**不改一行 `.ts`**,看它能不能在图上出现、构件能不能落地。
  **这一条不通过,Y 就没做完。**
- **Z** → 突变测试:把潇湘馆正房往北挪 3 m,**竹子和树要自己让开**,不需要改任何表。
- **AA** → 区从 4 开到 19,`splat cm/texel` 与地形 `CELL` **不变**;三角数与建时有上限。
- **AB** → 改一个数(比如雾浓度),`side-by-side` 看得出全局变化;`grep` 得到的该参数
  **只有一处定义**。
- **AC** → `check:plan` 能红:把一条 `basis.rules` 指向不存在的 id,门必须失败。

---

## 4. 明确不做

- **不重写分层。** `check:layers` 的三条禁令是对的,留着。
- **不做通用约束求解器**(接缝 ②)。规则匹配到"列个表看看落到哪些区"为止。
- **不把 `builder/` 里的园子知识一次性清干净。** 8 个文件带园子知识(`composer` /
  `terrain-from-plan` / `splat` / `luya` / `building` / `bamboo` / `vegetation` / `wall`),
  `D-22` 已经把这笔账记了。Y 和 Z 会顺带清掉 `composer` 与 `vegetation` 两处最脏的,
  **其余的等它们真的挡路了再动**。
- **不动 `engine/ui/Menu.ts` 那三处 `'大观园'` 字面量。** 是标题文案,不是结构问题。
- **不做多项目复用。** 现在只有一个园子。接缝 ① ② 的形状要能支持第二个项目,
  但**不为此付任何额外成本**。

---

## 5. 这套做完之后,"加一个区"长什么样

```
1. plan.json  加一段 region:边界折线、entrances、elevation、tier、style、
               buildings[](带 construction.spec 与 basis.rules)
2. scenes/daoxiangcun.json  写点名件的相对落位 + 散置规则的挑选
3. 完
```

- 游园图自动多一个地点(已经是这样了);
- 地形自动多一块(接缝 ④);
- 树、竹、铺地按 `style` 自动配料(接缝 ②),新构件不点名也吃得到;
- 树不会长进屋(接缝 ③);
- 有人改了雾或斗拱,这个区跟着一起变好(接缝 ⑤ + 既有 pipeline)。

**三条目标就是这三行 diff。**
