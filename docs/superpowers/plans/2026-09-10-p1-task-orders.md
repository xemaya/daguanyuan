# P1 任务分派单

**Task 1 已完成**（2026-09-10，commit `3dd33f54`）。42/42 测试通过、四门全过、14 镜结构一致、试玩 PASS。其余六个可分派。

写实现时暴露了三处设计错误，计划已更正。**单子 A 与单子 B 照计划 Task 1 一节的「实际接口」写，不要照本节最初的草稿。**

**每个 agent 开工前必读**（按顺序）：

1. `docs/superpowers/plans/2026-09-10-p1-foundation.md` — 完整计划，你的任务在里面有逐步的代码。**以计划里的步骤为准，本单子只是调度信息。**
2. `docs/superpowers/specs/2026-09-10-layered-architecture-design.md` — §2 import 规则、§3 数据契约、§5 规则状态机。
3. `docs/PITFALLS.md` — 已经踩过的坑，改代码前扫一眼标题。
4. `ART_DIRECTION.md` — 只有碰几何或材质的任务需要（单子 E、F）。

**全局约束**（每个任务都适用）：

- 工作目录 `~/Workspace/games/daguanyuan`，分支 `editor`。
- 收工前 `npm run check`、`npm test`、`npm run check:layers`、`npm run check:rules` 必须全过。
- `builder/derive/` 不许 import `three`。它只产数。
- 大木作的数字只从规则表出，不许在代码里写字面量。规则表里缺就补规则表，**不要补代码**——`book.num()` 取不到会抛，错误信息里带着 `formula` 原文告诉你该结构化哪个数。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**：`tsc --noEmit` 认，`npm test` 的 strip-only 模式不认，而且不报编译错，整个模块直接挂（PITFALLS P-15）。
- **规则号只在规则集内唯一**，273 个里 115 个跨文件重号。开工先跑 `book.collisions()`，撞了的写限定形式 `use('fayuan:06-01')`（PITFALLS P-16）。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```
- **只碰自己任务列出的文件**。多个 agent 同时在跑，碰别人的文件会互相覆盖。
- 拿不准就停下来问，不要猜。**尤其不要为了让测试变绿去编一个书里没有的数**——那正是 P1 要消灭的东西。

---

## 调度

```
✅ Task 1 规则加载器+状态机+provenance  (commit 3dd33f54)
             ↓
        ┌────┴────┐
     单子 A      单子 B
     Task 2      Task 3
     qing        fayuan

单子 C   Task 4 构件级本体          （无前置，可立即派）
单子 D   Task 5 地形生成器读 plan   （无前置，可立即派）
             ↓
单子 E   Task 6 世界切到 plan 坐标系
             ↓
单子 F   Task 7 分簇剔除 + 地形分块
```

**现在可并行派 4 个**：单子 A、单子 B（Task 1 已落地）、单子 C、单子 D
**之后（单子 D 合入后）**：单子 E，然后单子 F

单子 A/B 与单子 D/E 都改 `builder/`，但文件不重叠：A/B 只碰 `builder/derive/`，D/E 只碰 `builder/compose/` 与 `engine/`。

---

## 现在可派

### 单子 C — Task 4 构件级本体（数据层）

> 在 `~/Workspace/games/daguanyuan` 实现 P1 计划的 **Task 4: 构件级本体**。
> 完整步骤在 `docs/superpowers/plans/2026-09-10-p1-foundation.md` 的 Task 4 一节。
>
> 你只碰：`knowledge/rules/components.rules.json`（新建）、`knowledge/rules/schema.json`、`tools/check-rules.mjs`、`knowledge/rules/README.md`。
>
> **开工前必读 `docs/kg-paper-borrowing.md` §3.1 与 §4**：同题论文有 3505 个构件实体，我们要抄的正是这一层粒度，但**他们的尺寸不能取**——他们没有核验层，那 3505 条只能当候选本体清单。
>
> **最重要的一条约束**：本体只存「由什么组成、怎么装」，**绝不存几何**。不许出现顶点、网格、贴图路径这类字段。一旦存了，这套东西就从可执行的语法退化成一个巨大的古建资产库，那不是我们要的。尺寸引规则表的 id（`dimensions: ["01-07", "04-03"]`），不在本体里重复数值。
>
> **只做斗拱一类**：清式五踩、七踩两种平身科加它们的分件，宋式五铺作、六铺作两种。梁架和小木不碰——先证明「本体 + 规则能出真分件」成立，P3 再铺开。
>
> 门要加三条专用校验：`parts` 的 `ref` 不悬空、`dimensions` 的 id 在规则表里存在、不含几何字段。
>
> 交付：`check:rules` 七行全零、提交。回报做了多少个构件实体、多少条分件。

**规模**：中。**风险**：低。**唯一的失败模式是往里面塞几何。**

---

### 单子 D — Task 5 地形生成器读 plan.json

> 在 `~/Workspace/games/daguanyuan` 实现 P1 计划的 **Task 5: 地形生成器读 plan.json**。
> 完整步骤与五条测试的全部源码在计划的 Task 5 一节。
>
> 你只碰：`builder/compose/terrain-from-plan.ts`（新建）、`tests/terrain-plan.test.mjs`（新建）。**不要改 `builder/compose/terrain.ts`**——接线是下一个任务（单子 E）的事，你这一步产的是纯函数，先不接进游戏。
>
> 现在的 `terrain.ts` 里 `POND`、`MOUND`、`PADS`、`MAIN_PATH`、`BRANCH_W/E` 全是硬编码的坐标。**你的新模块里不许出现任何园子坐标**，全部从 `projects/daguanyuan/plan.json` 的 `wall`/`water`/`hills`/`paths`/`regions` 读。解析场、圆角矩形遮罩、双 warp 这些手法照抄现有 `terrain.ts`，那部分是验证过的。
>
> 五条断言：水在水下、山够高、路够缓（坡度 <12%）、台基够平（3 米内高差 <8cm）、同种子确定。
>
> **若「区域台基处平坦」红了**，多半撞上 plan.json 已知的 4 个越界建筑锚点（`missing` 的 `99-20`，P2 待修）。把那几个 region 跳过并在测试里注明是哪几个，**不要为了让它变绿去改 plan.json**。
>
> 交付：五条测试通过、提交。回报跳过了哪些 region、为什么。

**规模**：中偏大。**风险**：中——解析场的参数要试。

---

### 单子 A — Task 2 `qing` 参数集（斗口制）

> 在 `~/Workspace/games/daguanyuan` 实现 P1 计划的 **Task 2: qing 参数集**。
> 完整步骤与五条测试的全部源码在计划的 Task 2 一节。
>
> 你只碰：`builder/derive/qing/*.ts`（新建目录）、`tests/qing.test.mjs`（新建）、`builder/derive/index.ts`（只加分派的那几行）。
>
> **开工前必读**：计划的 **Task 1 一节「实际接口」与「三处更正」**（这是你的依赖契约，最初草稿里的 `RuleBook` 形状是错的）；然后 `knowledge/docs/qingshi/README.md` 的跨章结论、`01-doukou.md`、`02-jujia.md`、`03-chuyan.md`、`04-dougong.md`、`tiers.md` 的 Tier A 一节与**禁用 id 白名单**；最后 `docs/PITFALLS.md` 的 P-14、P-15、P-16。
>
> **开工第一条命令**是跑 `RuleBook.create('qing').collisions()`（计划 Task 2 的 Step 0 有现成的），看清自己这套里哪些规则号跟别的集撞了。撞了的一律写 `use('qing:01-05')` 这种限定形式。
>
> **三件事不要搞错**：
> 1. **斗口不由查表定，要由柱高反算，而这条反函数书里没有**（`missing.rules.json` 的 `99-02`，六个口径互差 8%~21%，选哪个决定斗口差一等以上）。所以 Tier A 的建筑现在会抛 `MissingRuleError`。**这是设计意图，不是 bug，有一条测试专门断言它会抛。绝对不要为了让它跑起来编一个除数。**
> 2. `tiers.md` 白名单里的规则（01-05 攒数推面阔、02-02 步架定尺、04-06、04-07、04-11 等）在规则表里是 `refuted`，引用即抛。碰到就说明推导路径选错了，换一条。
> 3. 举架系数可用，但**步架长不可用**（02-02 被驳倒，均分法实测偏差 −33% 到 +34%）。步架长由调用方给。
>
>
> **还有两条 Task 1 撞出来的**：
> - **要不要选口径，由 `choices` 在不在决定，不由状态决定。** `04-03` 状态是"通过"却有三个并存口径，差 32%。`qing` 里带 `choices` 的一律要选，别看状态。口径超过一两条就照 `profiles.ts` 的形状加一份预设——**预设里只放口径的名字，不放数**。
> - `qing.rules.json` 大概率有不少条的数只写在 `formula` 字符串里没结构化。`book.num()` 取不到会抛并把 `formula` 原文带给你。**补进规则表，别写回代码。** 补的时候只把原文里已有的数抬出来，一个都不新造——Task 1 补了 17 条，可作范本。
>
> 长春宫那条断言的容差是 10%：规则档 56.8 斗口算出 3.976 m，实测 3.67 m，偏 +8.3%。**别去调容差凑，也别去改规则凑。**
>
> 交付：五条测试通过、四门全过、提交。回报哪些规则 id 在推导链上被用到了。

**规模**：大。**风险**：中——最容易犯的错是把 `missing` 那条填上一个编的值。

---

### 单子 B — Task 3 `fayuan` 参数集（界与提栈）

> 在 `~/Workspace/games/daguanyuan` 实现 P1 计划的 **Task 3: fayuan 参数集**。
> 完整步骤与四条测试的全部源码在计划的 Task 3 一节。
>
> 你只碰：`builder/derive/fayuan/*.ts`（新建目录）、`tests/fayuan.test.mjs`（新建）、`builder/derive/index.ts`（只加分派的那几行）。**注意单子 A 也会碰 `index.ts`，只加你自己那一行分派，别动别人的。**
>
> **开工前必读**：计划的 **Task 1 一节「实际接口」与「三处更正」**（这是你的依赖契约）；然后 `knowledge/docs/qingshi/05-fayuan.md`（27 条，篇幅最长）、`06-wuding.md` 里 `paramSet: fayuan` 的那几条、`tiers.md` 的 Tier B 与 Tier C、`verify-suzhou.md` 的 A 部分（月到风来亭手算）；最后 `docs/PITFALLS.md` 的 P-14、P-15、P-16。
>
> **你这套是重号重灾区。** 已知 `fayuan` 的 `06-01`（清式屋顶形制等级序列，**已驳倒**，`paramSet: both`）与 `fashi` 的 `06-01`（界深与提栈起算，**通过**）同号，`06-07` 同理。不写限定形式的话你会拿到另一条规则，而错误信息说得头头是道——只是说错了规则。开工第一条命令跑 `RuleBook.create('fayuan').collisions()`，撞了的一律写 `use('fayuan:06-01')`。
>
> **三件事不要搞错**：
> 1. **05-06「个」的读法被两名核验者共同驳倒**，照抄会把屋面抬高一倍。规则表里它是 `refuted`，引用即抛，有测试断言。正确读法在 `correction` 字段：个等于级数，总递加等于个数减一。
> 2. **提栈逐界插值法是空的**（`missing` 的 `99-08`）。`05-09` 只有四行算例（界深 3.5/4/4.5/5 尺）。界深落在 3.7 或 4.2 这类值上，**必须由 spec 显式声明 `interpolate`，不声明就抛**。书里只有四个点，插值是我们加的，得留痕。
> 3. **连机、夹堂、枋子那段高度书里没比例**，是檐口高程闭合差的主要来源。它在 `missing` 的 `99-04` 里，`whereToLook` 已经写好该查刘敦桢《苏州古典园林》图版与《营造法原》第十三章，**别自己另编一套出处**。
>
>
> **还有两条 Task 1 撞出来的**：
> - **要不要选口径，由 `choices` 在不在决定，不由状态决定**（`04-03` 状态"通过"却三档并存差 32%）。`fayuan` 里带 `choices` 的一律要选。
> - 很多条的数只写在 `formula` 字符串里没结构化，`book.num()` 取不到会抛并带上 `formula` 原文。**补进规则表，别写回代码**，且只把原文里已有的数抬出来，一个都不新造。
>
> 月到风来亭对边距断言容差 10%（`verify-suzhou.md` 记录实测 −1.0%）。**别调容差凑。**
>
> 交付：四条测试通过、四门全过、提交。回报有哪些 fayuan 规则因为 refuted 被绕开、绕开走的是哪条路。

**规模**：大。**风险**：中高——05 章 27 条里驳倒 6 条，路要绕。

---

## 之后

### 单子 E — Task 6 世界切到 plan 坐标系

> **前置：单子 D 必须已合入。** 在 `~/Workspace/games/daguanyuan` 实现 P1 计划的 **Task 6**。
> 完整步骤在计划的 Task 6 一节。
>
> 你碰：`builder/compose/terrain.ts`、`builder/compose/composer.ts`、`projects/daguanyuan/main.ts`、`tools/playtest.mjs`、`tools/capture.mjs`。
>
> **这一步会改变用户看到的园子。** 现在的世界是 64×72 米、手摆的，`plan.json` 是 500×500 米、19 个区，两套坐标系互不相干。你要把五处已有构件（正门、翠嶂、沁芳亭桥、潇湘馆、沁芳池）搬到 plan 里对应区的位置。
>
> `SCENE` 表的每一项加 `region` 字段，坐标改成**相对该区质心的局部偏移**，装配器读 plan 算世界坐标。这个格式是给 P4 每区一份 `scenes/<region>.json` 铺路的，别自己另发明一套。
>
> 500 米见方全量建地形会炸，给 `makeTerrainField` 传 `bounds`，**先只开正门到潇湘馆这条游线外扩 40 米的窗口**。分块是下一个任务。
>
> **验收靠试玩，不靠截图**：`node tools/playtest.mjs` 必须 `PLAYTEST PASS`。坐标搬错了走不通。
> 结构数字这次会变（世界尺度不同了），所以 **`manifest-diff` 不适用**，改用 `tools/side-by-side.mjs` 出对照图交人眼判：五处构件都在、朝向对、接地对。
>
> preview 一律带 `--strictPort`（见 PITFALLS P-11，端口被占会静默截到别人的网站）。
>
> 交付：试玩全线 PASS、对照图出好、提交。回报五处构件搬到了哪个 region、局部偏移各是多少。

**规模**：大。**风险**：高——最容易走不通。走不通就停下来报告卡在哪一段，不要硬调。

---

### 单子 F — Task 7 分簇剔除与地形分块

> **前置：单子 E 必须已合入。** 在 `~/Workspace/games/daguanyuan` 实现 P1 计划的 **Task 7**。
> 完整步骤与三条测试的全部源码在计划的 Task 7 一节。
>
> 你碰：`engine/scatter/cluster.ts`（新建）、`engine/render/TerrainChunks.ts`（新建）、`engine/scatter/instancing.ts`、`builder/parts/zhiwu/vegetation.ts`、`builder/compose/terrain.ts`。
>
> **开工前读 `docs/tellux-borrowing.md` 第 4、5 条。** 两个要点：实例按固定网格分簇每簇一个包围球做视锥剔除；shader 注入要做成**有序 stage**（`rtc` → `wind` → `lod`），现在只有风摆一个所以没暴露，后面加实例偏移和 LOD 形变时三方会争抢 `project_vertex`。
>
> `engine/` 不许 import `builder/`——`cluster.ts` 和 `TerrainChunks.ts` 都是内容无关的机制，别把园子的知识漏进去。
>
> **必须量出证据**：对比 `shots/p1t6` 与 `shots/p1t7` 的三角数，**朝向园子的镜头应大致不变，背对园子的镜头应显著下降**。两组数字写进提交信息。若背对的也没降，说明剔除没生效（检查包围球半径是不是算大了，或 `frustumCulled` 被关掉了），**不要报告"完成"**。
>
> 再出一次 `side-by-side` 人眼确认：**看得出差别就是剔多了**，视野边缘的簇被误剔，扩大包围球或加余量。
>
> 交付：三条测试通过、三角数证据、对照图无差别、提交。回报两组三角数。

**规模**：中偏大。**风险**：中——剔多了会被人眼抓到，剔少了会被数字抓到，两头都有网。

---

## 全部完成后的判据

```bash
npm run check && npm test && npm run check:layers && npm run check:rules && node tools/check-plan.mjs
node tools/playtest.mjs --url http://127.0.0.1:4801/
grep -rnE "guangCun: [0-9]|doukouCun" builder/derive
```

且：

- 最后那条 grep 无输出——`builder/derive/` 里再没有手抄的营造数字。
- Tier A 的建筑抛 `MissingRuleError` 并说明该查哪本书。**这是通过条件不是失败。**
- `Frame.provenance` 三支都有内容，能从一根柱子回溯到规则 id。
- 世界坐标系是 `plan.json` 的，试玩全线通过。
- 背对园子的镜头三角数显著低于朝向园子的。

之后开 P2（几何层补真）与 PE（园林体验层）。两者都要等单子 E 落地。
