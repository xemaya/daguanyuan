# 单子 BE：composer 通走 `plan.connections`——纸上的桥建出来

> **依据**：`docs/PITFALLS.md` `P-37`（composer 只遍历各区 `linears[]`，`plan.connections` 一条都不建）；验收记录 §25 发现 ②；用户 2026-09-29 拍板「桥：要做」。
> **标准动作见 `STANDARD-ACTIONS.md`。**
>
> **现状**（验收人 2026-09-29 查）：`plan.connections` 四座桥——
> `connection.daoxiang-creek`（稻香村，BB2 板桥，现由 `projects/daguanyuan/scenes/daoxiangcun.json` 一条落位**借道**挂出来）；
> `connection.red-railing`（(−35,−101)…(−50,−106)，朱栏木桥，**在当前建成窗口内，从没建过**）；
> `connection.qinfang-sluice`（(192,−211)，石闸桥）、`connection.yihong-return`（(170,175)，木桥）——都在当前地形窗口外。
>
> **文件域**：`builder/compose/composer.ts`（只许加「遍历 `plan.connections`」那一段与对应登记）；`builder/parts/shuigong/bridge-path.ts`（只许接口适配，四座桥的几何不许变）；
> `projects/daguanyuan/scenes/daoxiangcun.json`（**只许**删掉借道挂桥那一条）；`tools/manifest-diff.mjs` 的 `--coverage`（**只许**加一栏：建成窗口内的 connections 建没建）；相关测试。
> **不碰**：`plan.json`、vegetation / scatter、xiangye 构件、机位、基线、单子、正门（冻结，`D-28`）。
> 并行：施工甲在做 BC（vegetation / xiangye 远景档），施工乙在做 BD（土材质 / e09 / splat）。你们三路文件域不重叠，**合回前 rebase，冲突停下回报**。

## BE1 · composer 遍历 connections

- 规则：一座桥的**全部端点都在当前地形窗口内**才建；否则跳过，并在构建日志里记一行「未建：窗口外」（随区入建成自动出现）。
- 稻香村那座改走这条正路，删掉 scenes 里的借道条目；**它的几何必须与改前逐位相同**（sha256 前后比）。
- `red-railing` 第一次建出来：拍它所在位置的人眼图两张（桥头、桥上），外加 `mound_block` / `grass_close` 前后并排（看它是否入这两镜）。它能不能从现有路走上去、playtest 有没有撞到它，都要报。
- 窗口外两座：写一个测试，把窗口临时扩到覆盖它们，断言 composer 会建且几何与棚拍 `bridge-path` 相同；**不改真窗口**。

## BE2 · 对账门认 connections

`manifest-diff --coverage` 加一栏「连接（桥）」：建成窗口内的 connections 建了几座 / 应建几座，缺的列名。
**P-37 的教训**：plan 里有数据不等于世界里有东西，门要数到它。

## 判据

- 稻香村桥 sha 前后相同；`red-railing` 建出且带碰撞，playtest PASS（走得过去就报走过的脚下序列，走不到就报为什么）；
- `--coverage` 新栏：窗口内 2/2；
- `check:all` 全过；四镜三次连拍 ±3%（相对 `perf-baseline.json` 2026-09-29 版），超了按视锥归因；
- `tree-census --dump` 与改前逐字节相同（桥不许改散布；若桥的占位让开了某株，报出来，不许自己改散布规则）。

## 回报

每件 sha；red-railing 的图（桥头、桥上、两镜前后）；稻香村桥 sha 证明；coverage 新栏输出；playtest 与四镜读数；census 证明；你没做的与判断题。
