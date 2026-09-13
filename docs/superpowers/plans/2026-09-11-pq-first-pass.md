# PQ 第一轮：木作细部与光色纪律

> 两张单子，**文件完全不重叠，可同时派**。

**背景**：用户 2026-09-11 走完游线后的判断——「走近了看还挺差」。
诊断与条目在 `docs/ROADMAP.md §PQ`（PQ-0 光与色、PQ-1 廊下四件、PQ-2 门户格心、PQ-7 正门与匾额）。
对照参考图在 `docs/reviews/refs/`。

**已经先做掉的**（`c5fe2787`）：摘掉潇湘馆正房的「有凤来仪」（时代错误，见 `07-75`），
`plan.json` 的匾额真源改对，并记下 `99-26`——匾额文字有三份副本，几何只读写死在代码里的那份。

## 全局约束

- 工作目录 `~/Workspace/games/daguanyuan`，分支 `editor`。
- 收工前 `npm run check:all` 全过。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**（PITFALLS P-15）。
- preview 一律带 `--strictPort`；园子在 **`/garden.html`**，不是 `/`（PITFALLS P-11）。
- **大木作的数字只从规则表出**，取不到就补规则表不补代码；书里没有的用 `book.artChoice()` 留痕进 `provenance.art`。
- **全场景三角数不许超过现在的 1.2 倍**。现在 14 镜是 227–330 万（`shots/p1done/manifest.json`），
  上限 **400 万**。
- **多单并行时不许 `git stash`。** 工作区里同时有别人的半成品,stash 会把它们一起卷走
  (2026-09-12 我与单子 P 各犯过一次)。要单独量自己的改动,用
  `git worktree add --detach /tmp/<名> <commit>` 开隔离检出,自带独立端口跑。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

---

## 单子 J — 木作细部与小木作开张（PQ-1 + PQ-2）

> 在 `~/Workspace/games/daguanyuan` 做 PQ 的木作细部。条目见 `docs/ROADMAP.md` 的 **PQ-1 与 PQ-2**。
>
> 你碰：`builder/parts/damu/building.ts`、`builder/parts/qiangyuan/wall.ts`、
> `builder/parts/xiaomu/`（新建构件）、`builder/compose/composer.ts`（只加灯笼的摆放）。
>
> **`engine/` 一个字都别碰**——单子 L 正在改 `engine/render/Atmosphere.ts` 与 `engine/core/PostFX.ts`。
> **`builder/parts/index.ts` 不用改**：它的 glob 已经包含 `xiaomu`（PITFALLS P-02 就是这么埋的，现在已预防）。
>
> **开工前必读**：`ART_DIRECTION.md` §3 色板、§9 界面（**只为搞清楚界面用金、构件不用金这条分界**）、
> `docs/reviews/refs/2026-09-11-xiaoxiangguan-reference.jpg`（参照图，**只借信息密度不借形制**，
> 它偏清官式，我们是江南）、`docs/PITFALLS.md` 的 P-04、**P-05**、P-06、P-15。
>
> ### 六件
>
> | 件 | 要点 |
> |---|---|
> | **椽（望板下那排）** | **这是与参照图差距最大的一处**。现在檐下是一块平板，占画面上部三分之一。重复长方体，**必须实例化或合并**，别每根一个 draw call |
> | **雀替** | 柱梁交接处的带曲线挤出件。轮廓在交接处断一下，"木构"这个信息就给足了 |
> | **柱础线脚** | 柱础方块已经有了，加一圈车削轮廓。柱子占画面最大面积 |
> | **灯笼** | 新建 `builder/parts/xiaomu/`。六棱柱 + 纸 + 细框 + 吊索 |
> | **月洞门的门额** | `wall:moon` 现在不支持挂匾。加门额，题「潇湘馆」 |
> | **门户格心** | `qiangyuan/` 已有 `lattice`/`cloud`/万字纹生成器，搬到建筑的隔扇门窗上 |
>
> ### 五条不要搞错
>
> 1. **灯笼不许每盏配 `PointLight`。** 全场景现在只有三盏光（`Atmosphere.ts` 的平行光 3.2、
>    半球光 0.9、平行光 bounce 0.25）。前向渲染里每个点光都进所有材质的着色循环，十盏就明显掉帧。
>    **灯笼纸用 `emissive`**——与 PITFALLS **P-05** 窗纸那次同一招（`transmission` 会让整个场景多渲一遍，
>    当时的解法就是 emissive 假装透光），已有的 bloom 会自然晕开。
> 2. **灯有原文依据，但别按十种做。** 第五十三回「大觀園正門上也挑著大明角燈，兩溜高照，各處皆有路燈」
>    （`07-70`）。那条核验状态是"存疑"，**驳的是把十种灯的材质与工艺混计成十类**
>    （羊角/玻璃/戳纱/料丝是材质，绣/画/堆/抠/绢/纸是做法），**不是驳"正门挂灯"**。做一两种就够。
> 3. **门额的字必须从 `plan.json` 读，不许再写字面量。** `plan.json` 的
>    `regions[].buildings[]` 里粉垣月洞门的 `plaque` 已经是「潇湘馆」。
>    **这是把 `99-26` 那三份副本收成一份的第一步**——建筑预设里剩下的 `plaque` 字面量
>    （`menSpec` 的「大观园」、`tingSpec` 的「沁芳」）**也一并改成从 plan 读**。
> 4. **柱色不动。** 栗色 `#6e4230`，不上朱红——参照图偏官式，我们是江南（`ART_DIRECTION` §1.5、§3）。
>    **泥金只在门厅和加载界面**，构件上不用（§9）。
> 5. **数字从规则表出。** 椽径 `Frame.m.rafterDia` 已经有了。雀替、柱础线脚的比例先去规则表找；
>    找不到就 `book.artChoice()` 留痕，**不要在代码里写一个书里没有的数当作理所当然**。
>
> ### 验收
>
> - 棚拍：`node tools/shoot-part.mjs --subject building:tang,building:lang,wall:moon --url http://127.0.0.1:4801/viewer.html`，
>   与 `docs/reviews/refs/2026-09-11-xiaoxiangguan-reference.jpg` **并排交人眼**。
>   判据：**廊的交接处不再有"柱子直接插进平板"的地方。**
> - `node tools/capture.mjs --url http://127.0.0.1:4801/garden.html --out shots/pq-j`，
>   **全场景三角数 ≤ 400 万**，draw call 增量 ≤ 15。两组数字写进提交信息。
> - `node tools/playtest.mjs --url http://127.0.0.1:4801/garden.html` 仍 `PLAYTEST PASS`
>   （灯笼与门额别挡住通路）。
> - `npm run check:all` 全过。
>
> 回报：六件各落在哪个文件、三角数与 draw call 前后、规则表补了哪几条、`artChoice` 留痕了几处。

**规模**：大。**风险**：中——最容易犯的错是给灯笼配真光源，其次是椽没合并导致 draw call 爆掉。

---

## 单子 L — 光与色的纪律（PQ-0）

> 在 `~/Workspace/games/daguanyuan` 做 PQ-0。条目见 `docs/ROADMAP.md §PQ` 的 PQ-0 一节。
>
> 你只碰：`engine/render/Atmosphere.ts`、`engine/core/PostFX.ts`。
>
> **`builder/` 一个字都别碰**——单子 J 正在改 `builder/parts/` 与 `builder/compose/composer.ts`。
>
> **开工前必读**：`ART_DIRECTION.md` §4 灯光与后期、§3 色板、
> `docs/reviews/refs/`（两张对照图）、`docs/PITFALLS.md` 的 P-03、**P-08**、P-11、P-12。
>
> ### 两处，都是"按小园子调的参数没跟着世界变大"
>
> **① 雾的密度。** `Atmosphere.ts:169` 是 `FogExp2(0.0031)`。指数雾遮蔽率 `1 − exp(−(d·ρ)²)`：
>
> | 距离 | 50 m | 100 m | 200 m | 300 m |
> |---|---|---|---|---|
> | 现在 | 2% | 9% | **32%** | **58%** |
>
> 老园子最远视距约 80 米，雾只有 6%，等于不存在。现在院墙与山在 200–300 米上，
> 被 32%–58% 的白雾吃掉，远景糊成一片亮白、地平线发青。
> **参照图的远景也有空气透视，但那是有颜色的渐变，我们是一堵白墙。**
>
> 两个旋钮：**密度**与**雾色**。雾色现在是 `horizonColor.lerp(hazeColor, 0.18) × SKY_INTENSITY × 0.84`
> ——**别只调密度**，一堵稍淡的白墙还是白墙。
>
> **② AO 的半径。** `PostFX.ts:445` 的 GTAO `radius: 0.42`。0.42 米能压暗石缝、叶根，
> **压不暗一个三米高的廊下空间**。参照图的廊靠"越往里越暗"读出进深；
> 我们的廊顶是一块从近到远同一亮度的灰板，所以读不出体积。
> **不是算法问题，是只有一档 AO。** 要么加大半径，要么补一档大尺度的天空遮蔽。
>
> ### 三条不要搞错
>
> 1. **色调映射的位置不许动。** ACES 在链路里**只能有一次**，`ART_DIRECTION` §4 有明确目的。
>    WG（WebGPU 迁移）之后会重建整条后期链，**你这一轮只调雾与 AO，不重排 pass**。
> 2. **必须出对照图交人眼，不许只报数字。** 用 `tools/side-by-side.mjs`。
>    这一类改动逐像素比较没有判别力（PITFALLS **P-03**：水、竹、云一直在动，噪声底比任何阈值都高）。
> 3. **别为了让远景清楚就把雾关掉。** 空气透视是深度线索，去掉会让 280 米的园子变成一张平面图。
>    目标是**有颜色的渐变**，不是没有雾。
>
> ### 验收
>
> - `node tools/capture.mjs --url http://127.0.0.1:4801/garden.html --out shots/pq-l`，
>   再 `node tools/side-by-side.mjs shots/p1done/<id>.png shots/pq-l/<id>.png shots/compare/<id>.png`，
>   至少出 `gate_approach` / `pond_reveal` / `xiaoxiang` / `treeline` 四张。
> - 判据一：**200 米处的物体仍能分辨轮廓与固有色，远山与天不是同一个白。**
> - 判据二：**廊下截图，檐口内侧到廊子深处有可见的亮度梯度；柱础与地面交界处有接触暗。**
> - 帧率不许掉：14 镜与 `shots/p1done/manifest.json` 对比，**同一镜头的 fps 下降不超过 10%**。
> - `npm run check:all` 全过。
>
> 回报：雾的密度与颜色改成了什么、AO 怎么做的（加大半径还是加第二档）、四张对照图路径、帧率前后。

**规模**：中。**风险**：中——观感改动，容易调过头。**改过头的症状是园子变"干净"了但没有纵深**，
那比现在的白墙更糟。

---

## 之后

**正门形制**（PQ-7 的另一半：抱鼓石、中柱板门、台基踏跺、门嵌进墙、压浅进深）**等单子 J 落地再派**
——它也改 `builder/parts/damu/building.ts`，与 J 冲突。

---

## 单子 M — 正门要像门（PQ-7 的形制那半）

**前置：单子 J 已合入（`cf9c7c00`），`builder/parts/damu/building.ts` 空出来了。**
J 已经把格心、雀替、柱础线脚、灯笼做在正门上了——**本单子只管"它还是读成一间房"这件事**。

> 在 `~/Workspace/games/daguanyuan` 做 `docs/ROADMAP.md §PQ-7` 的**正门形制**那半。
>
> 你碰：`builder/parts/damu/building.ts`（只改 `menSpec` 与门屋相关的分支）、
> `builder/parts/shishan/`（新建抱鼓石构件）、`builder/compose/composer.ts`（摆抱鼓石、让粉墙接上门）、
> `builder/parts/qiangyuan/wall-path.ts`（只在墙要接到门时改）。
>
> **`builder/parts/index.ts` 不用改**——glob 已含 `shishan`（PITFALLS P-02）。
> **匾额的真源刚修好，别再动**：`plaqueFromPlan` 读 `plan.json`，正门是「大观园」。
> `engine/` 与 `projects/` 一个字都别碰。
>
> **开工前必读**：`knowledge/docs/qingshi/07-honglou.md` 的 **07-01**（正门，已核验通过）与
> **07-02**（外围墙）、`ART_DIRECTION.md` §1.5、§3、**§9 的「不上金」分界**（2026-09-11 刚更正）、
> `docs/PITFALLS.md` 的 P-04、P-06、P-15。
>
> ### 问题
>
> `menSpec()` 现在写着 `hall: '厅堂'`，只把前后檐换成 `front:'door'` / `back:'door'`。
> **所以它读成房间不是错觉——它就是一间加了门的厅堂。**
> 现值：`bayWidthsFen: [230,250,300,250,230]`、`rafters: 4`、`platformH: 0.5`、`chuji: 0.45`。
>
> ### 五件
>
> | 件 | 原文依据（07-01 / 07-02，均已核验通过） | 备注 |
> |---|---|---|
> | **抱鼓石 / 门枕石** | 原文无。**属艺术选择，须 `artChoice` 留痕** | **"门"最强的符号**，先做这件 |
> | **中柱造 + 板门** | 门屋通例：门装在中柱缝上而非檐柱缝上 | 门洞有进深，穿过去是一段而不是一张纸 |
> | **台基抬高 + 踏跺垂带** | 「下面**白石**台磯，**鑿成西番草花樣**」 | 现在 0.5 m 太矮太素；**白石**不是青石 |
> | **门嵌在墙里** | 「左右一望，皆**雪白粉牆**，下面**虎皮石**，隨勢砌去」 | **墙要从两边真的接上来**，门才读成墙上的开口 |
> | 压浅进深 | 门屋进深远小于面阔 | 现在 `rafters: 4` 体量偏方 |
>
> ### 四条不要搞错
>
> 1. **不许上朱红。** 原文明写「**並無朱粉塗飾**」。**这是原文禁令，不是风格偏好。**
>    §9 刚更正的"可以用金"**只放给匾额与楹联的字**，梁枋彩画、柱、斗拱**仍然不许**。
> 2. **园门五间不可反推清代规制。** 07-01 乙方核验注：同书荣国府正门只有「三间兽头大门」，
>    园门五间**反高于府门**，是小说给省亲别墅的礼制越格。**当小说给定值用，别拿它去推则例。**
> 3. **「西番草花样」是雕花，不是贴图。** 台基边缘的程序化浅浮雕，做不出就**先留素白石台基
>    并在注释里写明待做**——不要拿一张噪声贴图假装雕花。
> 4. **抱鼓石的尺寸书里没有。** 去规则表找，找不到就 `book.artChoice()` 留痕进 `provenance.art`，
>    **不要在代码里写一个书里没有的数当作理所当然**。
>
> ### 验收
>
> - **主判据（人眼）**：`node tools/capture.mjs --url http://127.0.0.1:4801/garden.html --out shots/pq-m --shots gate_approach,gate_plaque`，
>   与 `shots/pq1/` 同名镜头 `side-by-side`。
>   **判据一句话：能一眼读成"墙上的门"，而不是"一栋带门的房子"。**
>   具体看三点：粉墙从两侧接上来、抱鼓石在门口、台基有明确的踏跺。
> - 全场景三角数 ≤ **400 万**（现在 231–336 万），draw call 增量 ≤ 10。两组数字写进提交信息。
> - `node tools/playtest.mjs --url http://127.0.0.1:4801/garden.html` 仍 `PLAYTEST PASS`
>   ——**抱鼓石和中柱别把门堵死**（PITFALLS P-09 就是被自己的美人靠堵死那次）。
> - `npm run check:all` 全过。
>
> 回报：五件各怎么做的、`artChoice` 留痕了几处、三角数与 draw call 前后、对照图路径。

**规模**：中。**风险**：中——**最可能的失败是把门堵死**（P-09 的复发），其次是为了"气派"往上加朱红或彩画，那是原文禁令。
