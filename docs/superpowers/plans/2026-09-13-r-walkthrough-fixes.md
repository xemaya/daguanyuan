# 单子 R：试玩反馈里的立即项

> 与**单子 WG**（渲染层迁移）**并行**。两张的文件完全不重叠，见末尾的对照表。

**来源**：2026-09-13 用户走完游线提的七条，逐条核过的记录在
[`docs/reviews/2026-09-13-walkthrough-bugs.md`](../../reviews/2026-09-13-walkthrough-bugs.md)。
**七条里四条归本单子**，另三条归 WG（帧率封顶、地图指针锁）或等 WG 之后（树冠、远处失焦）。

## 全局约束

- 工作目录 `~/Workspace/games/daguanyuan`，分支 `editor`。
- **单子 WG 正在并行跑，它独占**：`engine/**`、`builder/compose/terrain.ts`、
  `builder/parts/zhiwu/foliage-materials.ts`、`builder/parts/zhiwu/bamboo.ts`、
  `projects/daguanyuan/main.ts`、`viewer.ts`、`fashi.ts`、`tools/capture.mjs`。
  **一个都不许碰。** 你可以 `import` 它们（只读），不能改。
- 提交只按路径 `git add`，**不许 `git add -A`**（PITFALLS **P-19**：单子 O 就这样把
  单子 Q 的三个文件卷走了）。
- **不许 `git stash`**——要隔离量自己的改动，用 `git worktree add --detach /tmp/<名> <commit>`。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**（**P-15**）。
- preview 带 `--strictPort`；园子在 **`/garden.html`**。**WG 多半占着 4801，你换个端口。**
- 全场景三角数 ≤ 400 万（现在 2.55–3.61 M），draw call 增量 ≤ 5。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

---

## 单子 R

> 在 `~/Workspace/games/daguanyuan` 修 2026-09-13 试玩反馈里的四条。
> 逐条的核查记录在 `docs/reviews/2026-09-13-walkthrough-bugs.md`，**先读它**。
>
> 你碰：`builder/parts/pudi/luya.ts`、`builder/compose/composer.ts`、
> `builder/compose/terrain-from-plan.ts`、`builder/parts/qiangyuan/wall.ts`、
> `builder/parts/qiangyuan/wall-style.ts`、`builder/parts/xiaomu/plaque.ts`。
>
> **单子 WG 并行跑着，上面「全局约束」里列的那批文件一个都不许碰。**
>
> ### ① 路牙跑出地形，读成「地铁轨道通向天际」
>
> 截图：`shots/bug/spawn_right.png`。两条平行深色路牙夹一条铺装带一直伸到地平线。
>
> **根因已定位，而且是同一个陷阱第二次咬人**：`builder/parts/pudi/luya.ts:137` 给
> `makeTerrainField` 传了 `bounds`，**以为那样就裁剪了**。但 Task 5 的源码注释写着：
>
> > 场本身是全局解析式，**`bounds` 不改变任何函数值**；它留给 Task 6/7 的网格与分块代码
> > 声明「只采这一片」。
>
> 而 `pavedRuns()` 返回的是 `plan.json` 里**整条路径**（覆盖 500 m 园子），
> **一点没裁**。地形只有 280×226 m 的窗口，出了窗口路牙就飘在空里一路延伸。
>
> **这条我在单子 E 里就写死警告过，它换个地方又咬了一次。**
>
> **修法**：把 `pavedRuns()` 按 `TERRAIN` 的窗口裁段。**边缘要淡出不能硬切**——
> 一条路牙在半空中被切平，和它伸到天边一样出戏。
> 顺带看一眼铺装遮罩有没有同样问题（`cobble` 是全局解析的，但窗口外没有地形网格，
> 所以大概率只有路牙这一处露馅——**确认一下再说**）。
>
> ### ② 潇湘馆不该用虎皮石
>
> **这是我的单子写错了，不是执行错。** 单子 Q 被我写死了「全园每一段粉墙都吃到，
> **不分 kind**」，Q 照做了。
>
> 但原文 `07-02` 是「**左右一望**，皆雪白粉牆，下面虎皮石，隨勢砌去」——
> 「左右一望」说的是**正门左右的园墙**。潇湘馆是「忽抬頭看見前面**一帶粉垣**」（`07-07`），
> **只说粉垣，没说虎皮石**。
>
> **修法**：虎皮石按**墙的种类**分——园墙（外围墙、正门左右）用，院墙（潇湘馆粉垣）不用。
> 院墙的墙脚回到原来的做法。**「随势砌去」也跟着走**：那半句同属「左右一望」那一句，
> 院墙不该有。
>
> ### ③ 匾额的字要从右到左
>
> `builder/parts/xiaomu/plaque.ts:27` 是 `g.fillText(text[i], x0 + i * gap, ...)`——
> **从左到右**。古代横额是**从右到左**。
>
> ### ④ 匾额字体没命中，落到了兜底
>
> `plaque.ts:24` 声明的是
> `bold ${size}px "STKaiti","KaiTi","Kaiti SC","Noto Serif SC","Songti SC",serif`
> ——**已经是楷体串了**，但渲染出来是黑体感。
>
> **别直接换一个字体名了事**，否则换一个还是不命中。**先确认命中与否**：
> canvas 的 `measureText` 在字体命中与否时宽度不同，可以用它探测；
> 或者列一组候选逐个试，取第一个真正生效的。
> **命中不了就得换路**（例如内嵌一个子集化的字形，或改用几何画字），
> **但那超出本单子——查清楚原因、回报，不要顺手扩大范围。**
>
> ### 顺带（同一批文件里，很便宜）
>
> **竹子种到房间里了。** `composer.ts` 摆的七丛竹有两丛落在正房 footprint 内：
>
> ```
> grove (-100.2, 101.0)     正房 footprint 中心 (-105, 99),半宽 6.8 / 半深 4.8
> clump (-109.8, 103.0)
> ```
>
> 根因：竹子坐标是**旧世界坐标整体平移**（`D_XIAOXIANG = [-114.4, 118.6]`，
> 按旧正房 (9.4, −20.6) → 新锚点 (−105, 98) 标定），而房子后来被单子 M 与 P 改过。
>
> **这正是 `missing` 的 `99-25` 应验**：footprint 有两份真源，
> **composer 摆的构件根本不过 `FOOTPRINTS` 检查**（那张表只管散布器）。
>
> **本单子只做短期修**：把这七丛按现在的几何重摆，**并在注释里指回 `99-25`**。
> **不要顺手做 occupancy prepass**——那是 P4 的事，会把这张小单子撑成大工程。
>
> ### 三条不要搞错
>
> 1. **别顺手改观感。** 单子 WG 正在并行迁移渲染层，它的 WG4 验收要跟 `shots/opq`
>    逐镜对照。**你改了观感，它就分不清哪一处是迁移引入的。**
>    只修上面点名的，看到别的难看的**记下来回报，不要改**。
> 2. **虎皮石那条是"分种类"不是"全删"。** 正门左右的园墙要留着——原文点名了。
> 3. **别扩大范围。** 匾额"太素"（要边框线脚、要落款）是判断题，归 P5，本单子不做。
>
> ### 验收
>
> - preview 用**你自己的端口**（WG 多半占着 4801）：
>   `npx vite preview --host 127.0.0.1 --port 4821 --strictPort`
> - `node tools/capture.mjs --url http://127.0.0.1:4821/garden.html --out shots/r
>   --shots gate_approach,gate_plaque,moon_gate,xiaoxiang`，与 `shots/opq` 同名镜头
>   `side-by-side`。
>   **判据一**：正门外没有伸向天际的路牙。
>   **判据二**：潇湘馆粉垣的墙脚不是虎皮石；正门左右的园墙**仍然是**。
>   **判据三**：匾额从右到左读作「大观园」「潇湘馆」。
>   **判据四**：正房里没有竹子。
> - 三角数 ≤ 400 万、draw call 增量 ≤ 5。
> - `node tools/playtest.mjs --url http://127.0.0.1:4821/garden.html` 仍 `PLAYTEST PASS`。
> - `npm run check:all` 全过。
>
> 回报：路牙怎么裁的、边缘怎么淡出；虎皮石按什么区分墙种；**字体到底命中没有、
> 你是怎么测出来的**；竹子重摆到哪儿；三角数与 draw call 前后。

**规模**：中。**风险**：中——**最容易犯的错是顺手改观感**（会污染 WG 的对照验收），
其次是字体那条直接换名字了事而没查命中。

---

## R 与 WG 的文件对照

| | R | WG |
|---|---|---|
| `builder/parts/pudi/` | ✅ | — |
| `builder/compose/composer.ts` | ✅ | — |
| `builder/compose/terrain-from-plan.ts` | ✅ | — |
| `builder/parts/qiangyuan/` | ✅ | — |
| `builder/parts/xiaomu/plaque.ts` | ✅ | — |
| `builder/compose/terrain.ts` | — | ✅（地形材质） |
| `builder/parts/zhiwu/foliage-materials.ts`、`bamboo.ts` | — | ✅ |
| `engine/**` | — | ✅ |
| `projects/daguanyuan/main.ts`、`viewer.ts`、`fashi.ts` | — | ✅ |
| `tools/capture.mjs` | — | ✅ |

**唯一的接触面**：`luya.ts` 与 `vegetation.ts` 都 `import { TERRAIN } from '@builder/compose/terrain'`。
那是**只读 import**，WG 不该改 `TERRAIN` 的形状；真要改，**WG 停下来回报**。
