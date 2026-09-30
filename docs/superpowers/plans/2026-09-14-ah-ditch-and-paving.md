# 单子 AH：引泉沟两件（先收沙带，再描石边）

> **文件域：`builder/compose/terrain-from-plan.ts` + `builder/parts/pudi/`。**
> 与单子 AG、AI 文件不重叠，可并行。
> **不许碰 `projects/daguanyuan/plan.json`**（单子 AI 在动它）——本单只读它，不写。
>
> 依据：`docs/reviews/2026-09-14-mvp-four-regions.md` 的 `A1` `C7`；`docs/PITFALLS.md` `P-20`；
> `knowledge/docs/qingshi/xiaoxiangguan.md` §3。

用户 2026-09-14 走完潇湘馆提的第 3 条：「**排水渠的问题，这个之前已经说过，但没有修。**」

属实。`docs/ROADMAP.md` §PQ-3 两周前就写了：

> 现在是一条沙色生坑，**读感是地形坏了，不是没做完**——这是整张图里最像 bug 的一处。

**从来没有派过单。**

---

## ⚠️ 顺序不能反，这是本单的全部形状

**先收沙带（AH1），再描石边（AH2）。**

只做石压边的话，一条硬直线石边会**浮在一条 4.8 m 宽的沙槽正中间**——
`ROADMAP §PQ-3` 自己警告过：

> 真正的风险不在构件，在对齐……**两者必须由同一份数据生成**。

但它没看出**宽度本身就是错的**。

---

## AH1 · 沙带按水体尺度收放（纯 bug，三行，模式现成）

**实测**：引泉沟的 polygon **宽 0.80 m**（原文「開溝僅尺許」≈ 0.32 m，已经放宽了 2.5 倍）。

`builder/compose/terrain-from-plan.ts` 的浅滩沙带：

```js
// 水线一圈浅滩沙。园子里没有海滩,这只是池岸的湿脚。
const band = smoothstep(2.0, 0.2, sd) * smoothstep(-2.8, -0.6, sd);
//                      ↑ 固定常数        ↑ 固定常数
```

注释自己写明它是按**池岸**标定的。可它对 `plan.water[]` 里**每一个**水体都生效，
而那张表里既有 72 m 宽的南池，也有 0.80 m 宽的引泉沟：

```
0.8 m 的沟 + 两侧各 2.0 m 沙 = 4.8 m 宽的沙疤
```

**同一个教训在同一个文件里已经学过一次**，就在往上 40 行：

```js
// warp 振幅随水面宽度收放：尺许宽的引泉沟经不起米级的扭动。
warpA: Math.min(1.1, inradius * 0.2),
warpB: Math.min(0.35, inradius * 0.06),
```

**`warp` 按 `inradius` 收放了，`sand` 与同一趟算的 `wetBand`（±1.2 m）没有。**

**做法**：照 `warpA`/`warpB` 的同一个模式，把沙带与湿痕的米制常数按 `inradius` 收放。
`inradius` 在 `Water` 接口里已经算好了。

**三条**：
1. **南池不许变。** 收放只该让**小水体**的带变窄，**大水体维持现状**——
   现在池岸的沙带是调过的，不要顺手重调。收工前 `side-by-side` 比一次池岸，证明它没动。
2. **`wetBand` 一起改**（单子 T 的湿痕，同一趟距离计算），别只改 `sand` 留下另一半错的。
3. **记进 `P-20`**：那条 pitfall 已经写好了，本单落地后在它末尾补一行"已修于单子 AH"。

**判据**：引泉沟那条**沙带宽度收到与沟同量级**（不是四米八）。
`node tools/capture.mjs --shots xiaoxiang` 以及新拍一张贴脸沟面的机位。

## AH2 · 引泉沟石压边（`PQ-3`）

`builder/parts/pudi/` 现在**只有 `luya.ts`**（铺地收边的路牙）。石压边是这个门类的第二件，
也是路线图 `P3` **驳岸**门类的最小版。

**做法**：沿 `plan.json` 的「潇湘馆穿院引泉沟」折线挤一圈石压边。

**四条**：
1. **与沟由同一份数据生成**（见上面的「顺序不能反」）。`luya.ts` 已经是"沿 plan 折线在世界空间
   直接挤出、几何自带世界坐标、零变换落位"的范本，**照它的路子做**。
2. **尺许宽的沟配什么石**：原文只说「開溝僅尺許」，石边的宽厚**没有出处，是艺术选择**，
   留 `provenance.art`。参照物是江南园林的**石板压沿**，不是驳岸乱石——
   一条尺许的引泉沟砌成假山驳岸就荒谬了。
3. **不许把沟拓宽来迁就石边。** 沟宽是 plan 的数（而且 plan 那条已经比原文宽了 2.5 倍），
   石边要迁就沟，不是反过来。**本单不写 `plan.json`。**
4. **必须能合并**（`P-04`）：材质走 `materials.ts` 的 memo，draw call 增量 **≤ 2**。

**判据**：走到潇湘馆院内低头看，**读成"一条砌了石边的引泉沟"，不是"地形坏了"**。

---

## 顺带（很便宜，做完 AH2 再动）

`plan.json` 的引泉沟那条 `water[]` 记录**没有 `basis` 字段**记「为什么是 0.80 m 而不是原文的 0.32 m」。
这是一次没留痕的艺术放宽（见 `knowledge/docs/qingshi/xiaoxiangguan.md` §6 open_question 1）。

**但本单不许写 `plan.json`**（单子 AI 在动它）。**把这条写进回报**，交给 AI 或下一单补。

---

## 标准动作

- 分支 `editor`；收工前 `npm run check:all` 全过（九道门、197 测试）、`playtest` PASS。
- **提交只按路径 `git add`，不许 `git add -A`**（`P-19`）；**不许 `git stash`**。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**（`P-15`）。
- **一件一次提交。**
- **不许碰** `builder/parts/damu/`、`projects/daguanyuan/plan.json`、
  `projects/daguanyuan/scenes/`（单子 AG、AI 在动）。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

## ⚠️ 预算

**当场量到的现状（2026-09-14，本单开工前）**：`grass_close` **4226k tris / 273 calls**。
**已经超过 400 万**，而且没有任何一道门管绝对上限。

本单的 AH2 是沿一条几十米的折线挤石边，**不该加多少三角**：
收工时 `xiaoxiang` 与 `grass_close` 两镜三角数**不许比开工前高出 2%**，draw call 增量 **≤ 2**。
**量了才算**，回报里给前后两组数。

## 验收

- **AH1 之后**：沙带宽度与沟同量级；**南池岸边 `side-by-side` 证明没动**；
- **AH2 之后**：石边贴着沟沿，没有浮在沙槽中间，也没有陷进去；
- 三角数与 draw call 前后对照；`check:all` 全过、`playtest` PASS。

## 回报

AH1 用了什么收放式、南池那组对照图路径；AH2 的石边尺寸与它的 `provenance.art` 依据；
三角数前后；**以及那条 `basis` 缺口**（见「顺带」）。

**规模**：小中。**风险**：低——**最容易犯的错是只做石压边不收沙带**（那样石边会浮在沙槽中间），
其次是顺手把南池的岸也重调了。
