# P1 任务分派单 ✅ 全部完成（2026-09-11）

**Task 1–7 已交付**（2026-09-11）。E 提交 `1d7cb2c9`；F 通过64个测试、14镜与完整游线，详见 [F 交付](../../reviews/2026-09-11-p1f-delivery.md)。P1 环境坐标与实例化亦已收尾（[验收](../../reviews/2026-09-11-p1-complete.md)），不重复派 E/F。以下保留各单子的原任务合同。

计划在实现过程中更正过四处（Task 1 撞出三处、写单子 E 时实测撞出第四处）。
**照计划里更正后的正文写，不要照最初的草稿。**

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
- **提交只按路径 `git add`，不许 `git add -A` / `git add .`。** 并行时工作区里有别人的
  半成品,`-A` 会把它们卷进你的提交——后果不是代码错,是署名与可回溯性错
  (2026-09-13 单子 O 就这样把单子 Q 的三个文件带走了,查「虎皮石是谁做的」会查到
  一条讲植物的提交)。派单人自己也踩过:从 `daguanyuan/` 跑 `git add -A` 暂存了整个 monorepo。
- **多单并行时不许 `git stash`。** 工作区里同时有别人的半成品,stash 会把它们一起卷走
  (2026-09-12 我与单子 P 各犯过一次)。要单独量自己的改动,用
  `git worktree add --detach /tmp/<名> <commit>` 开隔离检出,自带独立端口跑。
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

**A / B / C / D 已全部完成并合入**（`d68afe4c` / `7f807bdd` / `de6e26a3` / `168002ca`）。
**当前**：E/F/G 已交付。E/F 原始依赖与独占规则保留供审计；后续按 [执行台账](../../reviews/2026-09-11-roadmap-execution.md) 进入 P2。
**单子 E 必须单跑**——它大改 `composer.ts` 与 `terrain.ts`,与任何**碰几何的**并行任务都冲突。之后是单子 F。

单子 E 还要碰 `builder/parts/zhiwu/vegetation.ts`(散布盒与建筑禁区是旧坐标)——计划最初的文件清单漏了它。

> **A 与 B 撞过一次车**：两者都按单子「只加自己那一行」改 `builder/derive/index.ts`，但后提交的那个是在旧文件上写的，
> 看不见另一个的提交，于是把先落地的分派挤没了（`3f8088b9` 修）。教训：**并发写同一个文件时，壳要由派单人先写好，
> 让两边各填一行**，光靠单子里的警告拦不住。

---

## 已完成

### 单子 C — Task 4 构件级本体（数据层）✅ `de6e26a3`

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

### 单子 D — Task 5 地形生成器读 plan.json ✅ `168002ca`

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

### 单子 A — Task 2 `qing` 参数集（斗口制）✅ `d68afe4c`

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

### 单子 B — Task 3 `fayuan` 参数集（界与提栈）✅ `7f807bdd`

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

## 已完成（续）

### 单子 E — Task 6 世界切到 plan 坐标系 ✅ `1d7cb2c9`

**前置：单子 D 已合入（`168002ca`）。可以派。**

> 在 `~/Workspace/games/daguanyuan` 实现 P1 计划的 **Task 6：世界切到 plan.json 坐标系**。
> 完整步骤在 `docs/superpowers/plans/2026-09-10-p1-foundation.md` 的 Task 6 一节，**那一节 2026-09-10 重写过，
> 带着实测数字，以它为准。** 本单子只是调度信息。
>
> 你碰这六个文件，别的都别动：`builder/compose/terrain.ts`、`builder/compose/composer.ts`、
> `builder/parts/zhiwu/vegetation.ts`、`projects/daguanyuan/main.ts`、`tools/playtest.mjs`、`tools/capture.mjs`。
> 这次没有别的 agent 并行，`index.ts` 那种撞车不会再发生。
>
> **这一步会改变用户看到的园子。** 现在的世界是 64×72 米、手摆的，`plan.json` 是 500×500 米、19 个区。
> 你要把五处已有构件（正门、翠嶂、沁芳亭桥、潇湘馆、沁芳池）搬进 plan 的坐标系。
>
> **开工前必读**：计划的 Task 6 一节（尤其 Step 0 的三条实测事实与 Step 2 的三处已知冲突）、
> `builder/compose/terrain-from-plan.ts` 的头注释与 `TerrainFieldOptions`、`docs/PITFALLS.md` 的 P-01、P-09、P-11、P-12、
> `ART_DIRECTION.md`。
>
> **四件事不要搞错**：
>
> 1. **锚点用 `plan.json` 的 `buildings[].x/z` 与 `rocks[].x/z`，不是区域质心。**
>    正门 (55,236)、翠嶂白石群 (8,202)、沁芳亭 (0,148)、石桥三港 (0,152)、潇湘馆正房 (−105,98)——
>    这些是平面真源写下的，质心是我们算的派生量，**派生量不许盖过真源**。
>    `missing` 的 `99-24` 驳的正是「区域中心即台基位置」这个默认。质心兜底只用于 plan 没点名的东西（墙段、竹丛、驳石）。
>    `anchor` 匹配不到名字**要抛**，不许静默退回质心。
>
> 2. **传 `bounds` 不会裁掉任何东西。** Task 5 的源码注释写明「场本身是全局解析式，bounds 不改变任何函数值」。
>    开窗口这件事得由 `terrain.ts` 的网格代码执行。**别以为传个参数就完事了，那会静默地给你建 500 米见方的地形。**
>
> 3. **三角数会炸，先算再写。** MVP 四区包围盒 240×186 m，外扩 40 m 是 320×266 m；照现在的 36 cm 格是 **130 万三角，19 倍**，
>    而地形是 VSM 阴影接收体，一帧要画三四遍。预算：**地形 ≤ 60 万三角，世界构建 ≤ 30 秒，全场景 ≤ 790 万三角**
>    （现在 525 万，见 `shots/p1abcd/manifest.json`）。旋钮是格边与窗口大小，**不是分块——分块是 Task 7**。
>
> 4. **游线上有一段 68.6 米的水面，现有的桥总共只有约 25 米。** 沿「十七回游线」前 14 点（正门→潇湘馆，全长 310.6 m），
>    里程 156.5→225.1 m 在水下，从 (−3,171) 到 (−40,128)。这是这个任务最可能翻车的地方。
>    允许两条修法：SCENE 里加曲桥段（`bridge:zigzag` 是现成构件，不要造新几何），或者改游线走法沿岸绕到窄处。
>    **不许改 `plan.json`** 把池子改小或把路挪开。选哪条、为什么，写进提交信息。
>
> **三处已知冲突，报告不修**（都实测过，都在 MVP 游线上）：
> 潇湘馆正房锚点 6 m 见方高差 1.30 m（穿院引泉沟，就是 `99-24` 说的那半，P1 用垫台基对付）；
> 翠嶂的「镜面白石」(−34,200) 与「西山口」(−52,206) 两个石锚点落在沁芳溪南段里，高程 −1.00（**新发现的缺陷，
> `99-23`/`99-24` 都没覆盖，绕开摆并在回报里点名**）；翠嶂标称 11 m 高、两个入口高差 6.6 m，
> 而 `taihu:mound` 只有 3 米——**山体交给地形，石组只当山口的门框，别想用石头堆出 11 米**。
>
> **植被必须跟着搬**（计划最初漏了这个文件）：`vegetation.ts` 的 `VEG.scatter*` 散布盒与 `FOOTPRINTS` 建筑禁区
> 全是旧坐标。不改的话草还长在老园子那 50 米见方里，或者从正门屋里长出来。
>
> **验收靠试玩，不靠截图**：`node tools/playtest.mjs` 必须 `PLAYTEST PASS`。坐标搬错了走不通。
> 结构数字这次会变（世界尺度不同了），所以 `manifest-diff` 不用来判等，但它的 `triangles` 要看，对上面 790 万那条线。
> 观感改用 `tools/side-by-side.mjs` 出对照图交人眼：五处构件都在、朝向对、接地对。
> 镜头 **id 不要改名**，`side-by-side` 按 id 配对。
>
> preview 一律带 `--strictPort`（PITFALLS P-11，端口被占会静默截到别人的网站）。
>
> **走不通就停下来报告卡在哪一段，不要硬调，尤其不要为了让试玩变绿去改 `plan.json`。**
>
> 交付：试玩全线 PASS、对照图出好、四门全过、提交。
> 回报：五处构件各落在哪个 region / 哪个 anchor、68.6 米那段水怎么过的、地形最终格边与三角数、
> 全场景三角数变化、还撞上了哪些 plan 缺陷。

**规模**：大。**风险**：高——P1 里最高的一张。**最可能的失败**：地形网格没真开窗口（构建卡死），
或者 68.6 米的水过不去（试玩掉水里）。两者都在 Step 0 里点了名。

---

### 单子 G — 仓库卫生 ✅ `ad8fef4a`

**来源**：2026-09-10 外部 code review。八条里**四条归这张单**，加一条我自己核出来的（G5）。
**三条不做**：公开版 CONTRIBUTING、CI、拆独立仓——用户 2026-09-10 定「不着急共建」，见 D-22。
**一条推到 P4**：builder 认识大观园 / scenes/*.json，同上。

> 在 `~/Workspace/games/daguanyuan` 做一批仓库卫生修补。**这不是功能任务，不要碰任何几何或规则逻辑。**
>
> 你只碰：`LICENSE`、`README.md`、`THIRD_PARTY_NOTICES.md`（新建）、`.gitignore`、`ART_DIRECTION.md`、
> `docs/ROADMAP.md`、`tools/check-docs.mjs`（新建）、`package.json`（只加一个 script）、
> `builder/derive/index.ts`（只改一行，见 G4）、`builder/compose/world.ts`（只改注释，见 G5）。
>
> **单子 E 和 F 正在改 `builder/compose/`、`builder/parts/zhiwu/`、`engine/`、`tools/playtest.mjs`、`tools/capture.mjs`——
> 这些一个都不许碰。** 上一轮 A/B 就是这么互相覆盖的。
>
> **G1 — 许可证矛盾（确认属实）**
> `LICENSE` 是 Apache 2.0，`README.md` 第 115 行写的是 MIT，首个 commit 也写了 Apache 2.0。
> **保留 Apache 2.0**，改 README。同时新建 `THIRD_PARTY_NOTICES.md`，保留上游 MIT attribution：
> 引擎壳取自 [pallet-town-3d](https://github.com/PauliusOS/pallet-town-3d)（MIT），
> 附完整 MIT 许可全文与版权行。README 的 License 一节指向它。
>
> **G2 — 脏文件出仓（比 review 说的多）**
> 进了 Git 的是 **4 个 `.DS_Store`**（根目录、`docs/`、`docs/superpowers/`，用 `git ls-files` 自己核）
> 加 `dev.log`（532 行，198 处本机绝对路径）。
> `git rm --cached` 移出索引，`.gitignore` 补 `.DS_Store`、`*.log`（`preview.log` 也在漏网）。
> **不需要改写历史**——我已经扫过 `dev.log`，`token|secret|password|api_key` 零命中。
> 只有将来真进过密钥才值得动历史，那是另一件事。
>
> **G3 — 文档路径漂移（62 处，不止 ART_DIRECTION）**
> P0 搬家后 markdown 里还写着 `src/cn/`、`src/fashi/`、`src/world/`、`core/Noise.ts`。
> 实际是 `builder/parts/`、`builder/derive/`、`builder/compose/`、`engine/core/Noise`。
> 四个文件有命中：`ART_DIRECTION.md`、`docs/ROADMAP.md`、
> `docs/superpowers/plans/2026-09-10-p0-skeleton-migration.md`、`docs/superpowers/specs/2026-09-10-layered-architecture-design.md`。
>
> **后两个是搬家文档，它们提到旧路径是对的，别改**——那是历史记录不是失效引用。只改前两个。
>
> 然后加一道门 `tools/check-docs.mjs`：扫所有 markdown 里形如 `路径/文件.ts` 的引用，
> 文件不存在就报错。**白名单要能写**（搬家文档、外部 URL、示意性路径），白名单条目要写明为什么豁免。
> 挂进 `package.json` 的 `check:docs`，并加进 `check:all`。
> `ART_DIRECTION.md` 是"每个 agent 必读、违反就退回"的圣经，**最权威的文件给错路径对外部贡献者伤害最大**。
>
> **G4 — 漏网的艺术数字（一行，但很值钱）**
> `builder/derive/index.ts:178` 有 `drop: yanchu * lastSlope * 0.85`，
> 注释自己承认「0.85 是几何近似不是营造数字」——**问题不是它不该存在，是它没进 `provenance.art`**。
> `RuleBook` 已经有现成的 `artChoice(id, note, value)`，照 `deriveZhu` 里 `03-24` 那个用法改。
> 改完 `deriveBuilding()` 的 `provenance.art` 应该多一条，能回答「这里史料没有，我们为观感取了 0.85」。
> **顺手全仓扫一遍还有没有别的**：`grep -rnE "\* 0\.[0-9]{2}|\+ 0\.[0-9]{2}" builder/derive`，
> 找到的每一个要么进 `art`，要么说明它是纯几何（如 `Math.PI/2`）。回报扫出几个、处理了几个。
>
> **G5 — `world.ts` 的注释在说谎（我核出来的，不在 review 的八条里）**
> `builder/compose/world.ts` 的头注释写着「buildings claim their footprints before vegetation scatters so trees
> never grow through a porch」，但实际构建顺序是 `开天 → 理地 → 引水 → 植树 → 起屋叠石`——**植被在建筑之前**。
> 现在没穿帮，只因为 `vegetation.ts` 自己偷偷维护了一份硬编码 `FOOTPRINTS`，等于**有两份 footprint 真源**。
>
> **这一步只改注释，不许调构建顺序。** 把注释改成陈述事实：植被先于建筑散布，靠 `vegetation.ts` 里那份
> 手抄的 `FOOTPRINTS` 副本避让，**这是已知的技术债**。同时在 `knowledge/rules/missing.rules.json` 补一条
> `99-25`（`paramSet: "none"`，`status: "missing"`）记下这笔债：真源应当是一份 occupancy prepass，
> 从 plan + scenes 生成一份 occupancy mask，地形、植被、建筑读同一份；落点 P4。
> `whereToLook` 指向 `builder/compose/world.ts` 与 `docs/ROADMAP.md §P4`。
>
> **为什么只改注释**：真修法要等 `scenes/*.json` 落地（P4），现在调顺序会让 `FOOTPRINTS` 那份副本
> 变成唯一真源，把债做得更深。**注释说谎比债本身更危险——它让下一个人以为这里是对的。**
>
> **交付**：`npm run check:all`（含新的 `check:docs`）全过、`git ls-files` 里没有 `.DS_Store` 与 `.log`、提交。
> 回报：路径漂移改了多少处、白名单豁免了哪几条为什么、G4 扫出几个艺术数字。

**规模**：中。**风险**：低。**唯一的失败模式是手伸进 E/F 正在改的文件。**

**不做的三条**（用户 2026-09-10 定「不着急共建」，记为 D-22）：

- **公开版 `CONTRIBUTING.md` 三条入口** — 为一个还不存在的读者写的。真要开放时再写，那时才知道他们卡在哪。
- **CI** — 建议本身对，但前提不成立：本仓还在 `games` monorepo 里，没有自己的 GitHub 远端。要 CI 得先拆独立仓。
- **拆独立仓** — 产品决定，不着急共建就不着急拆。

**推到 P4 的一条**：`builder/` 还认识大观园（`composer.ts` 硬编码整条 SCENE、`terrain.ts` 硬编码潇湘馆台基与沁芳池、
`vegetation.ts` 硬编码 footprint）。review 把它列为最高工程优先级，理由是"否则外部 builder 领建一个亭子还是要改核心 composer"——
**理由成立，但它买的是外部贡献者，不是更好的园子**。不着急共建，它在 P4 的位置就是对的。
提前做属于为通用性而通用性，正是 D-18 要防的。G5 只把这笔债记明白，不提前还。

---

### 单子 F — Task 7 分簇剔除与地形分块 ✅ 内容已由 `2bf7420c` + `3096e761` 完成，未派发

> **前置：单子 E 必须已合入。** 在 `~/Workspace/games/daguanyuan` 实现 P1 计划的 **Task 7**。
> 完整步骤与三条测试的全部源码在计划的 Task 7 一节。**那一节 2026-09-10 追加了 Step 0 与 Step 0b，先做它们。**
>
> 你碰：`engine/scatter/cluster.ts`（新建）、`engine/render/TerrainChunks.ts`（新建）、`engine/scatter/instancing.ts`、`builder/parts/zhiwu/vegetation.ts`、`builder/compose/terrain.ts`、`builder/compose/terrain-from-plan.ts`。
>
> **这个任务有两半，第一半是修 E 留下的卡顿，不是加功能。**
> E 落地后世界构建从 20 秒涨到 **28 秒以上**，Chrome 弹「页面无响应」。**这不是内存问题**——
> 内存爆掉是「Aw, Snap!」，这个弹窗是主线程被同步计算占死（PITFALLS P-12 复发）。
> 也**不是窗口开大了**——E 的窗口是对的（280×226 m / 0.48 m 格 = 55 万三角，在预算内）。
> 涨的是**每次求值的单价**：新的场每次调用要走 7 个水体多边形、6 座山、9 条路径、19 个区，
> 单价涨了约一个数量级，而调用次数还被 ×5（法线中心差分）与 ×100 万（`bakeSplat` 1024²）放大。
> 实测单价 `height` 11.8 µs、`masks` 9.4 µs；地形网格 138 万次 = 16.3 s，splat 烘焙 105 万次 = 9.9 s。
> **先砍这两处，预算是世界构建 ≤ 15 秒**，量法与三处改法在计划的 Step 0 里。
> 顺带一条：草丛数跟着散布盒涨了 14 倍（2.7 万 → 约 60 万），会顶穿 790 万三角上限，见 Step 0b。
>
> **2026-09-11 收窄:shader 注入的有序 stage 不做了。** 渲染层已定路线迁 WebGPU + TSL
> （[方案](../../reviews/2026-09-11-webgpu-migration-plan.md)，`docs/ROADMAP.md §WG`）。
> 给 GLSL 字符串注入盖一套 stage 框架，迁移时整个作废。**F 只做分块、分簇、空间索引与构建性能**，
> 注入顺序留给 WG2 用节点组合表达。现在只有风摆一个注入点，不盖框架也不会打架。
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

**规模**：大（比原计划涨了一半——多了 Step 0 的构建性能）。
**风险**：中——剔多了会被人眼抓到，剔少了会被数字抓到，两头都有网；构建时间和三角数各有一条硬线。

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
