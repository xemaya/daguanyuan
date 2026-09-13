# P0 剩余任务分派单

Task 1、2 已由主会话完成（commit `3a2c13eb`、`ff72ddd8`、`c2d42766`）。以下七个任务可分派。

**每个 agent 开工前必读**（按顺序）：

1. `docs/superpowers/specs/2026-09-10-layered-architecture-design.md` — 分层架构 spec，尤其 §2 import 规则、§3 数据契约、§5 规则状态机。
2. `docs/superpowers/plans/2026-09-10-p0-skeleton-migration.md` — 完整计划，你的任务在里面有逐步的代码。**以计划里的步骤为准，本单子只是调度信息。**
3. `ART_DIRECTION.md` — 艺术圣经（只有改几何/材质的任务需要）。

**全局约束**（每个任务都适用）：

- 工作目录 `~/Workspace/games/daguanyuan`，分支 `editor`。
- 收工前 `npm run check` 和 `npm test` 必须过。
- **多单并行时不许 `git stash`。** 工作区里同时有别人的半成品,stash 会把它们一起卷走
  (2026-09-12 我与单子 P 各犯过一次)。要单独量自己的改动,用
  `git worktree add --detach /tmp/<名> <commit>` 开隔离检出,自带独立端口跑。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```
- **只碰自己任务列出的文件**。多个 agent 同时在跑，碰别人的文件会互相覆盖。
- 拿不准就停下来问，不要猜。

---

## 调度

```
已完成: Task 1 基线 → Task 2 搬家
                          ↓
         ┌────────────────┼────────────────┬──────────────┐
      Task 3          Task 4           Task 8         Task 9
      分层门          规则门           plan 几何门     scatter 抽取
                          ↓
              ┌───────────┼───────────┐
           Task 5      Task 6      Task 7
           fashi      qing+fayuan  红楼+花木+缺口
```

**第一批（可立即并行派 4 个）**：Task 3、Task 4、Task 8、Task 9
**第二批（Task 4 完成后并行派 3 个）**：Task 5、Task 6、Task 7

---

## 第一批

### 单子 A — Task 3 分层门

> 在 `~/Workspace/games/daguanyuan` 实现 P0 计划的 **Task 3: 分层门**。
>
> 完整步骤和 `tools/check-layers.mjs` 的全部源码在 `docs/superpowers/plans/2026-09-10-p0-skeleton-migration.md` 的 Task 3 一节，照着做。开工前先读 spec 的 §2「import 规则」理解这道门在防什么。
>
> 你只碰这两个文件：`tools/check-layers.mjs`（新建）、`package.json`（加一条 script）。
>
> 计划里的 Step 4 是反向验证——故意往 `engine/core/Noise.ts` 里塞一条违规 import，确认门抓得到，然后 `git checkout` 还原。**这步不能跳**，一道从没红过的门等于没有。
>
> 交付：门跑通、反向验证抓得到、提交。回报门当前报告的违规数（应为 0）。

**规模**：小，约 100 行。**风险**：低。

---

### 单子 B — Task 4 规则一致性门

> 在 `~/Workspace/games/daguanyuan` 实现 P0 计划的 **Task 4: 规则一致性门**。
>
> 完整步骤、`tools/check-rules.mjs` 的全部源码、`knowledge/rules/schema.json` 的全部内容，都在 `docs/superpowers/plans/2026-09-10-p0-skeleton-migration.md` 的 Task 4 一节。开工前读 spec §3.1 和 §5 理解规则状态机——这道门存在的理由是让「我们不知道」成为程序能表达的状态。
>
> 你只碰：`tools/check-rules.mjs`、`knowledge/rules/schema.json`、`knowledge/rules/fashi.rules.json`（先建成空 rules 数组）、`package.json`。
>
> **注意计划里 Step 4 的预期是门失败**（json 空、md 有 155 条 → 报缺 155 条并 exit 1）。这是对的，它证明门能读懂研究稿。把每个规则集从 md 数出来的条数记下来回报，那是 Task 5/6/7 的靶子。
>
> 交付：门能正确解析四个规则集的 md、schema 写好、提交。回报每个集合的 md 条数。

**规模**：中，约 200 行。**风险**：低。**它是 Task 5/6/7 的前置，优先派。**

---

### 单子 C — Task 8 plan.json 搬家与几何门

> 在 `~/Workspace/games/daguanyuan` 实现 P0 计划的 **Task 8**。
>
> 完整步骤和 `tools/check-plan.mjs` 的全部源码在 `docs/superpowers/plans/2026-09-10-p0-skeleton-migration.md` 的 Task 8 一节。门里的断言来自 `knowledge/docs/plan/04-conflicts.md` §四「七条不可违约束」，开工前读那一节。
>
> 你只碰：`knowledge/docs/plan/garden.plan.json`（`git mv` 到 `projects/daguanyuan/plan.json`）、`knowledge/docs/plan/make-plan.py`（改读取路径）、`knowledge/docs/plan/README.md`（改索引路径）、`tools/check-plan.mjs`（新建）、`package.json`。
>
> **一个已知情况**：平面批评稿指出有 3 个 entrance 落在自己的多边形外、4 个建筑锚点越界。这些是真缺陷，属于 P2 要修的内容。**不要为了让门变绿去改数据**——把这几条断言暂时降成 `console.warn`，并在门的注释里写明「P2 修复后升回 error」。
>
> 交付：plan.json 就位、门跑通、提交。回报门报出的 warn 条数与具体是哪几个区域。

**规模**：中，约 250 行。**风险**：中——几何断言容易写错，写完自己拿几个手算例子验一下。

---

### 单子 D — Task 9 抽出散布机制层

> 在 `~/Workspace/games/daguanyuan` 实现 P0 计划的 **Task 9: 抽出散布机制层**。
>
> 完整步骤、要抽的行号表、三条测试的全部代码，在 `docs/superpowers/plans/2026-09-10-p0-skeleton-migration.md` 的 Task 9 一节。
>
> 你只碰：`engine/scatter/`（新建 4 个文件）、`builder/parts/zhiwu/vegetation.ts`（改为 import 机制层）、`builder/parts/zhiwu/foliage-materials.ts`（只加一段顶部注释）、`tests/scatter.test.mjs`（新建）。
>
> **这是纯重构，不许改任何行为**。判据不是逐像素（场景里竹叶水面在动，逐像素没有判别力），而是：
> ```bash
> node tools/manifest-diff.mjs shots/scatter shots/baseline
> ```
> 要求 `0 镜结构不一致`。三角数或 drawCalls 一变，多半是 `rng()` 的调用次数或顺序被改了。再用 `tools/side-by-side.mjs` 出一张 treeline 的左右对照交人眼看。
>
> **不要删那六个温带树种**。spec 说最终要删，但删了园子就秃到 P3。这次只抽机制。
>
> **一个前瞻**：抽出来的 `InstancePool` 是个扁平池，P1 会用「网格分簇 + 簇级视锥剔除」替换它（画布要涨到 500 米见方，单个大 InstancedMesh 剔除不掉）。所以 API 做够用就行，别在扁平方案上过度投入。
>
> 交付：三条测试过、结构无变化、人眼对照无差异、提交。回报 `vegetation.ts` 从 2804 行降到多少。

**规模**：大，2804 行里剥离机制。**风险**：高——最容易在剥离时把内容层的依赖带出来，导致分层门红。剥不干净就停下来问，不要硬改签名。

---

## 第二批（Task 4 完成后）

三个单子形状相同，只有源和目标不同。**三个 agent 各写各的 JSON，互不碰同一文件。**

共同要求：

> 在 `~/Workspace/games/daguanyuan` 把研究稿誊成机读规则表。
>
> 先读 `docs/superpowers/specs/2026-09-10-layered-architecture-design.md` §3.1（规则表字段）和 §5（状态机），再读 `knowledge/rules/schema.json`，再读 `docs/superpowers/plans/2026-09-10-p0-skeleton-migration.md` 里你那个任务的 Step 2（有完整的誊写规则和两个示例条目，照着结构抄）。
>
> 誊写要点：
> - `status` 从 md 的 `**核验状态**:**通过|存疑|驳倒**` 映射到 `ok|contested|refuted`。
> - **驳倒的条目必须保留**，不能因为不用就不写。代码引用它时要抛错，门也要对得上。
> - 研究稿里明写「两种读法并存」「口径二选一」的，写成 `choices` 数组，**不要私自选一个**。
> - `needs` 填依赖的规则 id。
>
> 验证：`npm run check:rules` 你那一行要报 `缺 0 / 多 0 / 状态不符 0 / 悬空依赖 0`。**门不校验数值**（研究稿里公式是散文，自动抽取只会给虚假的安全感），所以另外随机抽三条 `status=ok` 的，把 json 的 `table`/`params` 与研究稿正文逐字比一遍，这是唯一的防线。
>
> 交付：JSON 写好、门那一行全零、抽样核对做过、提交。回报条数与状态分布。

### 单子 E — Task 5 材分制

> 源：`knowledge/docs/fashi/0[1-7]-*.md`（七章）
> 目标：`knowledge/rules/fashi.rules.json`
> 只碰这一个文件。
> 参考统计：研究稿 155 条，通过 114 / 存疑 39 / 驳倒 2。

### 单子 F — Task 6 斗口制与界提栈

> 源：`knowledge/docs/qingshi/0[1-4]-*.md` → `knowledge/rules/qing.rules.json`
> 　　`knowledge/docs/qingshi/0[56]-*.md` → `knowledge/rules/fayuan.rules.json`
> 只碰这两个文件。
> 参考统计：01–04 共 70 条（驳倒 9），05–06 共 43 条（驳倒 6）。
>
> **这两套驳倒条特别多，格外注意**：
> - 06 章通过率只有 25%，屋顶等级序列、王府规制、苏式脊高全被驳倒。
> - 05-06「个」的读法被两人共同驳倒，照抄会把屋面抬高一倍，`correction` 必须写清「个=级数，总递加=个数−1」。
> - `knowledge/docs/qingshi/tiers.md` 里有一张**禁用 id 白名单**（01-05、02-02、04-06、04-07、04-11、06-01、06-15、06-16 等），在对应条目的 `notes` 里注明「tiers.md 禁用」。

### 单子 G — Task 7 原文事实、花木、缺口

> 源与目标：
> - `knowledge/docs/qingshi/07-honglou.md`（74 条）→ `knowledge/rules/honglou.rules.json`
> - 07 章 + `tiers.md` §2 → `knowledge/rules/plants.rules.json`
> - 两份批评稿（`knowledge/docs/qingshi/README.md` 与平面批评稿）→ `knowledge/rules/missing.rules.json`
> - 还要改 `tools/check-rules.mjs` 的 `SETS` 常量（登记后两个集合）
>
> 这三份与前两个单子形状不同，**详细规则看计划的 Task 7 Step 1–4**，尤其：
> - `honglou` 是**事实**不是公式，`formula` 写 `"fact"`，属性放 `params`。
> - `plants` 只放**有出处**的（学名、俗名、季相、哪个景点、原文引文）。竿多高、叶卡多大是美术参数，进 `builder/parts/zhiwu/`，不进知识库。
> - `plants` 和 `missing` 是跨章汇编，研究稿里没有对应的 `###` 标题，所以在 `SETS` 里 `chapters` 写 `/^$/`，门只校验 JSON 合法与依赖不悬空。
> - `missing` 是整个知识库最有价值的一份：它让「我们不知道」变成程序能表达的状态。清式批评稿的 A1–A6 与平面批评稿的几何缺口都要进来，每条带 `whereToLook`（该查哪本书、哪些关键词）。

---

## 全部完成后的判据

```bash
npm run check:all && node tools/manifest-diff.mjs shots/after shots/baseline
```

且：

- `knowledge/rules/` 下六份 JSON，`check:rules` 六行全零。
- `projects/daguanyuan/plan.json` 就位，`check:plan` 通过（已知 3 处入口越界可为 warn）。
- `engine/scatter/` 存在，`vegetation.ts` 通过它散布。

之后开 P1：`qing` 参数集、`fayuan` 参数集、规则状态机与 `Frame.provenance`、地形从 `plan.json` 生成、分块流式与 LOD。
