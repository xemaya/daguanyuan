# 单子 AI：正门门前四件——把对账门报的两个缺项造出来

> **文件域：`projects/daguanyuan/plan.json` 的 `zhengmen` 段与 `paths` +
> `projects/daguanyuan/scenes/zhengmen.json` + `builder/plan/wall-path.ts` +
> `builder/parts/qiangyuan/wall-path.ts` + `builder/compose/composer.ts` 的
> `baogushiSpotsFor` + 一个新的台基构件。**
> 与单子 AG、AH 文件不重叠，可并行。
>
> 依据：`docs/reviews/2026-09-14-mvp-four-regions.md` 的 `B1` `B2` `C1` `A3`。
> 用户 2026-09-14 走完正门提的第 1、3、6、8 条。

---

## 这一单为什么存在：**对账门已经把它报出来了**

```
node tools/manifest-diff.mjs --coverage shots/aa-after     → EXIT=1

已建成区覆盖率  17/23
  缺  zhengmen.forecourt-terrace     ← 本单 AI1
  缺  zhengmen.flanking-wall         ← 本单 AI2
  ...

接缝(名册侧，成链构件 4 对)  4 处
  缝  wall cloud→lattice 互相插入 0.22m（@ x≈32.0, z≈236.0）
  缝  wall lattice→plain 互相插入 0.16m（@ x≈39.0）
  缝  wall plain→lattice 互相插入 0.16m（@ x≈65.0）
  缝  wall lattice→cloud 互相插入 0.22m（@ x≈71.0）
```

**本单做完，这两条缺项与这四处接缝都该消失，覆盖率 17/23 → 19/23。**
`projects/daguanyuan/scenes/zhengmen.json` 自己的 `$comment` 已经写了这件事该怎么收：

> 「plan 里其实有 `zhengmen.flanking-wall` 这个对象，但它**没有 layout 折线**，
> 所以现在由六段独立 wall 顶替——**给 flanking-wall 补折线之后，这六条 placements**……」

---

## AI1 · 白石台矶（`B1`，一修解两条用户反馈）

用户第 6 条「大门前侧的平台很窄，很小气」与第 8 条「门前有很多黄土，看起来就是没建好」
**是同一个缺项**：

```
zhengmen.forecourt-terrace  kind=platform  at (55, 241)
名字:「白石台矶(凿西番草花样)」   有 construction: 否   世界里: 没有
```

原文 `07-01`：「……一色水磨群牆，**下面白石台磯，鑿成西番草花樣**。」

现在顶替它的是 `menSpec()` 里的一行 `platformMarginM: 0.9`——台基外扩 0.9 m，那不是月台。

**坐标账（当场量的）**：

```
门中线 z=236 → 台基前缘 ≈238.1 → 踏跺脚 ≈239.6
                                   ↕ 这一段没有任何东西
铺石大路起点 (55,246) ──► 而且立刻向东拐走
playtest 实测脚下序列: 0.0–2.6m stone(台阶) → 2.9–5.6m **dirt** → 5.9–39.6m grass
```

**做法**：给 `zhengmen.forecourt-terrace` 补 `construction`，做成真台矶，落到 `projects/daguanyuan/scenes/zhengmen.json`。

**四条**：
1. **尺寸没有原文依据，是艺术选择**，留 `provenance.art`。有依据的只有**材质（白石）**
   与**纹样（西番草）**。宽度该跟五间门脸（**13.76 m**）讲道理，不是跟 0.9 m 讲道理。
2. **西番草复用现成的**，别新做一套——台基侧面那道卷草已经有了（`C4` 记着它做得太细，
   像一根铁丝，**那是另一单的事，本单不改它的做法，只是别再新造第二套**）。
3. **台矶落地之后，脚下序列那段 `dirt` 要消失。** 收工前跑
   `node tools/playtest.mjs`，把 `shots/playtest-surfaces.json` 的头几段贴进回报——
   **第一段 `stone` 该直接接上铺装，中间不许再有 `dirt` 或 `grass`。**
4. **铺石大路的起点（55,246）也要往门口接。** 它在 `plan.json` 的 `paths` 里
   （「近门大路」，`paving: "slab"`）。**这是本单唯一允许写 `paths` 的地方。**

## AI2 · 侧墙连续生成（`B2` + `C1`）

用户第 3 条：「墙的连接处有明显的错位痕迹。」

**四处成因都量出来了**，接缝门报的 0.16 m 正是其中第一条：

| # | 成因 |
|---|---|
| ① | 六段墙都是 `flushEnds: false`，**墙基向两端各外伸 2 cm、压顶外伸 8 cm** → 每个接缝两个外伸头对撞（**0.16 = 2 × 0.08**） |
| ② | 墙脚「随势砌去」的沉深噪声按**每段自己的局部 x** 取样（`x*0.14 + 41.7`）→ A 段右端与 B 段左端的**墙脚高度不连续** |
| ③ | `cloud` 段墙顶有 ±0.4 m 波浪，直接撞上 `plain`/`lattice` 的平顶 |
| ④ | 贴图 UV 每段重置 → 虎皮石纹样在接缝处断 |

**修法已经在仓里**：`builder/plan/wall-path.ts` 的 `compileWallPath` + `flushEnds: true`，
沿 plan 折线连续生成。**现在只有潇湘馆与栊翠庵的院墙在用。**

**做法**：
1. **给 `zhengmen.flanking-wall` 补 layout 折线**（它现在没有，这就是六段顶替的来源）。
   折线要与正门中脊线同 z（`z=236`），从门两侧咬住山墙面向东西延展——
   `projects/daguanyuan/scenes/zhengmen.json` 的六条 `placements` 里记着现在的落位（`dx ±10/±16/±23`），
   **折线要覆盖同一段，不是另起一条**。
2. **然后删掉那六条 `placements`**，改成走 `wall-path`。
3. **⚠️ 沉深噪声改成按路径弧长取样**，不是段内局部 x——这是成因 ②，
   不改它，换成 wall-path 之后接缝仍然会跳。
   注意 `wall-path` 现在给院墙的是 `groundSteps = 1`（墙脚是平的一条直线），
   **园墙不能这样**：`07-02`「隨勢砌去」要的就是墙脚跟着地起伏。
   **既要连续，又要起伏**——这是本件的真难点。
4. **`zhengmen.rock-01`（「虎皮石墙基」）仍然是 `accountedFor`**，别把它变成一块要摆的石头。
   `projects/daguanyuan/scenes/zhengmen.json` 已经这么记了，沿用。

**判据**：**接缝门那 4 处必须归零**（`manifest-diff --coverage` 的「接缝」段），
且 `--shots cu_wall_seam` 贴脸看不出墙脚跳变、纹样断裂。

## AI3 · 抱鼓石归位（`A3`）

用户第 1 条：「门口两个石当，位置不对。」**已拍板：不加石狮**
（`07-53` 石狮属**府门**；`07-01`「並無朱粉塗飾」「不落富麗俗套」是刻意写素的）。

**量出来了**：

```
现在摆在 lx = ±2.0（相距 4.0 m），立在台基外的地面上
实测当心间 3.276 m（columnX ±1.638）
→ 每块在当心间柱线外 36 cm，而且不在门口，在台阶两侧的草地上
```

**做法**：`composer.ts` 的 `baogushiSpotsFor()` 是一段写死的正门专属代码——
**把它挪进 `projects/daguanyuan/scenes/zhengmen.json` 当一条正常的 `placements`**（它本来就是人写的落位，
正是接缝 ① 说的那一类），然后把位置改对。

**三条**：
1. **门枕石贴着门框、坐在门槛两端，鼓面朝外。** 正门是中柱造、板门装在中柱缝，
   所以它的 z 是中柱那一线，不是台基前缘外 0.42 m 的地面。
   **间距由当心间净宽定，不是拍一个数。**
2. **做大、做精**（用户已拍板）：现在鼓钉是**九颗等距半球，偏大，读成"麻子"**
   （见 `shots/ad-closeup/cu_baogushi.png`）。鼓钉该更小更密、沿鼓面边缘一圈，
   不是均布在整个鼓面上。
3. **尺寸仍然全无出处**（`baogushi.ts` 头注释已写明「原文无据」），
   放大与改钉都要更新 `provenance.art` 的留痕，**不要留着旧说明不改**。

**判据**：`--shots cu_baogushi` 贴脸拍，**鼓钉读成钉不读成麻子**；
正视图（`--shots gate_approach`）里两块石头**在门洞里，不在台阶两边的草地上**。

## AI4 · 顺带（很小）

`plan.json` 的引泉沟那条 `water[]` 没有 `basis` 记「为什么是 0.80 m 而不是原文『開溝僅尺許』的 0.32 m」
——一次没留痕的艺术放宽。**本单是唯一有权写 `plan.json` 的，顺手补上。**
（单子 AH 会在回报里再提一次这件事。）

---

## 标准动作

- 分支 `editor`；收工前 `npm run check:all` 全过（九道门、197 测试）、`playtest` PASS。
- **提交只按路径 `git add`，不许 `git add -A`**（`P-19`）；**不许 `git stash`**。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**（`P-15`）。
- **一件一次提交。**
- **不许碰** `builder/parts/damu/building.ts`、`builder/parts/xiaomu/plaque.ts`、
  `builder/compose/terrain-from-plan.ts`、`builder/parts/pudi/`（单子 AG、AH 在动）。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

## ⚠️ 预算

**开工前实测**：`gate_approach` **4160k tris / 258 calls**。**已经超过 400 万**，
且没有任何一道门管绝对上限（`manifest-diff` 只做 A/B 相对回归）。

- 台矶是一块大石板加一圈线脚，**不该加多少三角**；
- 侧墙改成连续生成**应当减少**三角（六段各自的端头封边合并掉了）——
  **如果反而涨了，先回报**；
- 收工时 `gate_approach` 三角数**不许比开工前高**，draw call 增量 **≤ 3**。
- **量了才算**，回报给前后两组数。

## 验收

- **对账门覆盖率 17/23 → 19/23**，`forecourt-terrace` 与 `flanking-wall` 不再是缺项；
- **接缝门那 4 处归零**；
- **脚下序列第一段 `stone` 直接接上铺装**，中间没有 `dirt`/`grass`；
- 三张贴脸图（`cu_wall_seam` / `cu_baogushi` / 新拍一张台矶）；
- 三角数与 draw call 前后对照；`check:all` 全过、`playtest` PASS。

## 回报

台矶的尺寸与 `provenance.art` 依据；`flanking-wall` 的折线怎么定的；
**「既要连续又要随势起伏」这件事怎么解的**（AI2 的真难点）；
抱鼓石最终位置与间距的推导；对账门与接缝门的前后读数；三角数前后。

**规模**：中大。**风险**：中——**最难的一件是 AI2**（连续生成与墙脚起伏要同时成立）；
最容易犯的错是台矶按 0.9 m 那个旧数放大一点了事，而不是跟 13.76 m 的门脸讲道理。
