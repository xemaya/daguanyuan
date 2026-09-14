# 单子 AF：散置件不许插进墙体 + 一行仓库卫生

> 两件小事，一起做。**第一件是园子里现在唯一一类「看得见、却没有任何一道门管」的缺陷**；
> 第二件是 `P-19` 的下一次事故正躺在工作区里等着。
>
> **前置**：单子 AD / Y / Z 已合入（本单子完全建立在它们之上）。
> **并行**：单子 W 在跑，只碰 `engine/render/`。本单子不碰那里。

---

## 第一件为什么存在

用户 2026-09-13 报过一次「竹子种到房间里」，单子 R 修了；
2026-09-14 又报「竹子还有**穿墙**而出的问题」。**这一次，四道验场门一道都没抓到。**

验收时当场量的（`tools/manifest-diff.mjs --coverage` 的野生件清单里就有它）：

```
bamboo:grove @ (−93.9, 98.6)        潇湘馆东院墙在 x = −91
→ 净距 2.90 m，而 grove 是五丛塞在 6×6 m 里、竹竿展开半径约 3.0 m
```

图上（`shots/xiaoxiang-closeup/x5_bamboo_wall_out.png`）一根竹竿从压顶穿下来、
**插在白墙中段**（没有偏移阴影，说明在墙体里不是在墙前），墙脚外还漏出一块土丘。

**为什么没门抓得到**（两道门各差一口气）：

- `builder/compose/occupancy.ts` 编译的是**建筑檐口外包络 + scenes 的 `clearances[]`**，
  `Occupant.kind` 只有 `'building' | 'clearance'` 两种——**墙体线性根本不在占位场里**；
- `tools/manifest-diff.mjs` 的 `auditRosterSeams` 只比**成链构件彼此之间**
  （`size[0]/size[2] >= CHAIN_MIN_ASPECT`），管的是墙与墙的接缝，**不管别的东西插进墙**。

---

## ⚠️ 这一件最容易做错的地方，先写在前面

**把墙塞进 occupancy 时，不要给它一圈净空。**

`occupancy.ts` 自己的注释写着：

> 「灌木要贴着墙角长、杂草要长在房子的背阴面——它们要的不是『在不在里面』」

而且原文这边也是同一个要求：`07-07`「一帶粉垣，里面數楹修舍，有千百竿翠竹**遮映**」——
**竹子探出墙头本来就是江南园林的常景，是我们要的，不是要躲的。**

所以判据必须分清两件事：

| | 允许吗 |
|---|---|
| **枝叶**越过墙、探出墙头 | **允许，而且是想要的** |
| **茎干/实体**落在墙体之内 | **不允许，这是缺陷** |

**墙进占位场，占的只有墙体本身那条带（墙厚），不带任何 feather、不带任何 pad。**
做成"墙外一圈不许种"，这一单就砸了——园子会变成每道墙外一条秃边。

---

## 单子 AF

> 在 `~/Workspace/games/daguanyuan` 做 **散置件与墙体的占位冲突门**，外加一行 `.gitignore`。
> **先读 `docs/superpowers/plans/2026-09-14-af-solid-vs-wall.md` 的「⚠️ 最容易做错的地方」一节**，
> 再读 `builder/compose/occupancy.ts` 的头注释、
> `docs/superpowers/specs/2026-09-14-scale-architecture-design.md` §2 接缝 ③ 与 ⑥。
>
> 你碰：`builder/compose/occupancy.ts`、`tools/manifest-diff.mjs`、
> `projects/daguanyuan/scenes/xiaoxiangguan.json`、`tests/occupancy.test.mjs`、`.gitignore`。
> **不许碰 `engine/render/`（单子 W 在跑）。**
>
> ### 标准动作
>
> - 分支 `editor`；收工前 `npm run check:all` 全过、`playtest` PASS。
> - **提交只按路径 `git add`，不许 `git add -A`**（`P-19`）；**不许 `git stash`**。
> - **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**（`P-15`）。
> - **一个阶段一次提交。**
> - 提交信息末尾附：
>   ```
>   Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
>   Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
>   ```
>
> ### 三个阶段
>
> #### AF1 · 墙体线性进占位场
>
> `Occupant.kind` 加一种 `'wall'`，从 `plan.json` 的墙体线性
> （`regions[].linears[]` 里 `kind: 'wall'` 的，以及 `plan.wall[]`）编译成
> **沿折线按墙厚挤出的带**。
>
> **三条**：
> 1. **只占墙体本身，不带 feather、不带 pad**（见上面的「最容易做错」）。
>    墙厚从墙构件的真实尺寸取，**不要拍一个数**——`builder/parts/qiangyuan/wall.ts`
>    里有 `THICK` / `BASE_T` / `PLINTH_T`，墙脚比墙身厚，**取最厚的那层**。
> 2. **不改植被散布器的行为。** 这一阶段只是让占位场多知道一件事，
>    植被读不读它是下一步的判断——**本单子不动 `vegetation.ts`**。
> 3. `occupancyFree()` / `occupancyDistance()` 的现有语义不变，
>    `tests/occupancy.test.mjs` 原有断言必须仍然绿。
>
> #### AF2 · 门：实体不许落在墙体内 ⚠️ **它必须一写出来就是红的**
>
> 在 `tools/manifest-diff.mjs` 的 `--coverage` 里加一段（与 `auditRosterSeams` 并列）：
> **拿世界名册里每条 placement 的实体范围，与墙体占位求交。**
>
> **判据怎么定（这是本阶段的核心，别写成 bounding box 一刀切）**：
>
> - 名册里每条已经有 `position` 与 `size`（`auditRosterSeams` 在用）。
>   但 `size` 是包围盒，**对竹子来说它包含枝叶**——用它会把"竹梢探出墙头"也报成缺陷，
>   那正是我们要的景。
> - 所以需要**实体范围**，不是包围盒。两条可选路子，**你选一条并说明理由**：
>   (a) 构件自报一个 `solidRadius`（竿/干的展开半径，`bamboo.ts` 的 `grove` 是
>       五丛种子点 ±2.15 + `spread` ≈ 3.0 m，`clump` ≈ 1.1 m）；
>   (b) 从几何算——只取名字/材质对得上"茎干"那部分的子网格求包围。
>   **(a) 更简单也更诚实**（它是一次显式声明，不是从几何猜），但**要留 `basis`**。
> - **枝叶越墙不许报。** 写一条测试焊住这一点：一个 `solidRadius` 够小、
>   但包围盒明显越墙的样例，**必须是绿的**。
>
> **⚠️ 三条判据**：
> 1. **门写出来立刻就该报 `bamboo:grove @ (−93.9, 98.6)`**。跑出来是绿的，说明判据写歪了。
> 2. **突变测试**：把那丛挪开之后门要变绿，**再挪回去要重新变红**。只验一头不算。
> 3. **别顺手把别的也报红。** 如果跑出来一片红，先怀疑你的实体范围取大了
>    （多半是拿了包围盒），不要去调松阈值。
>
> #### AF3 · 修数据，让门变绿
>
> 改 `projects/daguanyuan/scenes/xiaoxiangguan.json` 里那一条
> （`part: "bamboo", variant: "grove", anchor: "xiaoxiangguan.main-house", dx: 11.1, dz: 0.6`）。
>
> **⚠️ 往里挪，但别挪多了。** `07-07`「千百竿翠竹**遮映**」要的就是竹贴着墙——
> **挪到竿刚好清出墙体即可，不要挪到院子中间**。挪完在 `basis` 里写清楚
> 「为什么是这个数」（清出墙体所需的最小距离），不要只写「调整位置」。
>
> **这一阶段只挪这一丛。** 别的六丛门是绿的就不要动——
> 用户 2026-09-14 的第 1 条（院子空、要「兩邊翠竹夾路」）是**另一件事**，
> 归接缝 ②，见 `docs/reviews/2026-09-14-mvp-four-regions.md` 的 `D7`。**本单子不做。**
>
> ### 第二件 · 一行 `.gitignore`（随便哪个阶段带上）
>
> `.gitignore` 现在忽略的是 `.tmp-*`（点号开头），而工作区里躺着三个
> `tools/_tmp-*.mjs`（下划线开头）**不在忽略范围内**。
> 任何人一个 `git add -A` 就会把它们提交进去——`P-19` 那次事故的同一个形状。
>
> **加一行把 `_tmp-*` 也忽略掉。** 不要删那三个文件，它们是单子 W 的在用探针。
>
> ### 验收
>
> - **AF2 的门在修之前是红的、修之后是绿的、把那丛挪回去又是红的**（三态都要跑给我看）；
> - 「枝叶越墙不报」那条测试是绿的；
> - `npm run check:all` 全过、`playtest` PASS；
> - `git status --short` 里不再出现 `tools/_tmp-*.mjs`。
>
> ### 回报
>
> 实体范围用了 (a) 还是 (b)、为什么；门第一次跑报了几条（**只该有一条**，多了说明范围取大了）；
> 那丛最后挪了多少、依据是什么；三态测试的实际输出。

---

**规模**：小。**风险**：低——但**最容易犯的错是给墙加一圈净空**，
那会让全园每道墙外多一条秃边，而且正好和原文「翠竹遮映」顶着干。
次可能的错是拿包围盒当实体范围，于是把"竹梢探出墙头"这个正确的景报成缺陷。
