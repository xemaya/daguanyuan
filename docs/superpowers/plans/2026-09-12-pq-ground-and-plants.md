# PQ 几何半：地面与植物

> 两张单子，**文件不重叠，可同时派**。做完这两张就进 **WG**（WebGPU 迁移）。

**背景**：用户 2026-09-11 定调——不急着扩区域，先把正门、翠嶂、沁芳亭桥、潇湘馆这四处打磨好。
`docs/ROADMAP.md §PQ` 拆成了几何半与着色半：**几何半先做（TSL 迁移不动几何，现在做的不用重做），
WG 插在中间，草的分层着色与水的流动留到 WG 之后**，否则要用 GLSL 写一遍再翻成 TSL。

**已完成的 PQ 部分**：PQ-0 雾/AO/景深（`eba9ffe5`、`89fd8139`）、PQ-1+2 木作细部与小木作开张（`cf9c7c00`）、
PQ-7 正门形制（`7f1f31cf`）、匾额真源（`c5fe2787`、`1669cac6`）。

## 全局约束

- 工作目录 `~/Workspace/games/daguanyuan`，分支 `editor`。
- 收工前 `npm run check:all` 全过。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**（PITFALLS P-15）。
- preview 带 `--strictPort`；园子在 **`/garden.html`**。
- **书里没有的数用 `provenance.art` 留痕**，照 `builder/parts/shishan/baogushi.ts` 的做法
  （它把整件声明为艺术选择并写明规则表四份全查过）。
- **全场景三角数 ≤ 400 万**（现在 230–336 万，见 `shots/pq3/manifest.json`），
  draw call 增量 ≤ 15。两组数字写进提交信息。
- **不要碰 `engine/`**——WG 马上要独占它。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

---

## 单子 N — 地面：路要窄、要有铺装、要有边

> 在 `~/Workspace/games/daguanyuan` 做 PQ 几何半的**地面**。
>
> 你碰：`builder/parts/pudi/`（新建，现在是空目录）、`builder/compose/terrain-from-plan.ts`、
> `builder/compose/terrain.ts`、`builder/compose/composer.ts`。
>
> **`builder/parts/zhiwu/vegetation.ts` 一个字都别碰**——单子 O 正在改它。
> **`engine/` 一个字都别碰**——WG 马上独占。
> `builder/parts/index.ts` **不用改**，glob 已含 `pudi`（PITFALLS P-02）。
>
> **开工前必读**：`knowledge/docs/qingshi/07-honglou.md` 的 **07-08**、**07-41**（都已核验通过）、
> `ART_DIRECTION.md` §3 色板、`docs/PITFALLS.md` 的 **P-07**（瓦垄贴图 UV 周期算错读成灰板——
> 铺地的拼花周期同理）、P-04、P-06。
>
> ### 现状（都已核实）
>
> 1. **路宽是一个常数**：`terrain-from-plan.ts:286` 的 `PATH_HALF_WIDTH = 1.35`，
>    加 `PATH_FEATHER = 1.1`，可见土带约 **4.9 米宽**。**所有路一个宽度。**
> 2. **铺装通道早就留好了**：`terrain-from-plan.ts:716` 是
>    `const cobble = 0; // 铺地等 scenes 数据，地形层不猜。`
>    而 `surface()` 已经认 `m.cobble > 0.45 → 'stone'`。**钩子在那儿，没人喂数据。**
> 3. `builder/parts/pudi/` 是空目录。
>
> ### 三件
>
> **① 路宽按路分档。原文明确有两种，我们只有一种。**
>
> | 路 | 原文 | 该多宽 |
> |---|---|---|
> | 潇湘馆院内甬路 | 第四十回「中間**羊腸一條**石子漫的路」（07-41） | 窄。羊肠 |
> | 近门大路 | 第十七回「便是**平坦寬闊**大路」（`plan.json` 的 `paths` 里这条就叫「近门大路(平坦宽阔…)」） | 宽 |
>
> `plan.json` 的 `paths[]` **已经按名字分开了**，给每条路一个宽度字段，
> 或在代码里按路名分档——**取哪一种你定，但必须能指回原文**，并把没有原文依据的
> 具体米数用 `provenance.art` 留痕。
>
> **② 喂 `cobble` 通道，把路铺起来。** 石子漫（潇湘馆院内）、砖或石板（正门甬道）。
> **`P-07` 是这里最容易踩的坑**：瓦垄那次因为 UV 周期算错，屏幕上一个周期不到一像素，
> 被 mipmap 平均成一块灰板。**铺地的拼花周期先算它在屏幕上占几个像素，再调强度。**
>
> **③ 路要有边。** `builder/parts/pudi/` 做路牙 / 侧石，沿路的折线挤出。
> 参照图里地面之所以读得出来，一半靠的是**缝与边**，不是贴图本身。
>
> ### 顺带（便宜且有原文）
>
> **苍苔。** 第四十回同一句：「土地下**蒼苔布滿**」（07-41）。潇湘馆院内地面该有苔色——
> 这是 `wear` 或一档地表混合的事，不是新几何。
>
> ### 三条不要搞错
>
> 1. **别把所有路都铺起来。** 园林里土路、石子路、砖路各有其地；全铺成石板就成了公园。
>    原文点名的先铺，没点名的留土路。
> 2. **别动 `vegetation.ts`。** 草不长在石板上是靠运行时查 `ctx.collision.surfaceAt`，
>    你把 `cobble` 喂对了草自己就退开——**不需要也不许改散布器**（那是单子 O 的文件）。
> 3. **世界尺度的米制参数要按 280×226 m 的园子想**，不是 64×72 m（PITFALLS **P-17**：
>    雾、AO、景深都在这上面栽过）。
>
> ### 验收
>
> - `node tools/capture.mjs --url http://127.0.0.1:4801/garden.html --out shots/pq-n`，
>   与 `shots/pq3/` 同名镜头 `side-by-side`，至少 `moon_gate` / `gate_approach` / `xiaoxiang` / `grass_close` 四张。
>   **判据：潇湘馆院里那条路是「羊肠一条」且看得出是石子漫的；正门前那条读得出是宽路。**
> - 三角数 ≤ 400 万、draw call 增量 ≤ 15。
> - `node tools/playtest.mjs --url http://127.0.0.1:4801/garden.html` 仍 `PLAYTEST PASS`
>   ——**路牙别把人绊住**（碰撞体只给该挡的东西，路牙不该挡）。
> - `npm run check:all` 全过。
>
> 回报：几条路各多宽、宽度的依据、铺了哪几段、`provenance.art` 留痕几处、三角数与 draw call 前后。

**规模**：中偏大。**风险**：中——最容易犯的错是全园一铺到底，其次是拼花周期算错读成灰板（P-07）。

---

## 单子 O — 植物：把橡树白桦换成原著的树

> 在 `~/Workspace/games/daguanyuan` 做 PQ 几何半的**植物**。条目见 `docs/ROADMAP.md §PQ-5b/c/d`。
>
> 你碰：`builder/parts/zhiwu/vegetation.ts`、`builder/parts/zhiwu/` 下新建的构件、
> `knowledge/`（植物清单）。
>
> **`builder/compose/` 一个字都别碰**——单子 N 正在改 `terrain-from-plan.ts` / `terrain.ts` / `composer.ts`。
> **`engine/` 一个字都别碰**——WG 马上独占。
> **`builder/parts/zhiwu/foliage-materials.ts` 与 `bamboo.ts` 的 shader 注入段不要动**——
> 那是 WG2 要转成 TSL 的，动了要做两遍。**你只改几何、品种、散布，不改着色。**
>
> **开工前必读**：`docs/ROADMAP.md §PQ-5`、`docs/DECISIONS.md` **D-01**（"温带森林的六个树种"
> 就是当初记下的代价）、`docs/PITFALLS.md` 的 P-04、P-06、**P-17**。
>
> ### 现状（都已核实）
>
> 1. **园子里长的是橡树、白桦、梣、松。** `vegetation.ts` 的 `SPECIES` 是
>    `oak-broad` / `ash` / `birch` / `pine`，`BarkSet` 是 `'oak' | 'ash' | 'pale'`
>    ——继承自 pallet-town-3d 的温带森林。**大观园里不该长白桦。**
> 2. **原著的植物清单早就在仓库里，只是没人读**：`plan.json` 的 `regions[].plants`
>    有 **63 条、57 种**，每条带原文出处的 note。
> 3. **规则表里一条植物都没有**（`fashi`/`qing`/`fayuan`/`missing`/`components` 全查过）。
> 4. **花只有一种花型**（`vegetation.ts:1217` 的 `flowerGeometry`，五瓣加圆心）。
> 5. **草按 `VEG.grassCell = 0.32` 的抖动网格撒**，俯视看得见网格周期（`shots/pq3/grass_close.png`）。
>
> ### 三件
>
> **① 树种换血——只做游线上点名的那几种。**
>
> 不必 57 种都做。MVP 四区 `plan.json` 点名的是：
>
> | 区 | 原文点名的植物 |
> |---|---|
> | `zhengmen` | 门前古松 |
> | `cuizhang` | 藤萝（掩映白石）、苔藓（上面苔藓成斑） |
> | `qinfang_ting_qiao` | 堤柳（绕堤柳借三篙翠）、隔岸花 |
> | `xiaoxiangguan` | 翠竹（已有）、梨花、芭蕉、苍苔 |
>
> **`SPECIES` 的参数化骨架是好的**——脊线、枝条张开度、树冠卡片、树皮色——
> **换的是参数不是框架**。松、柳、梨、芭蕉各有极不同的剪影（松是横展、柳是垂、芭蕉是大叶丛生），
> 现在的参数表够不够表达它们，够就填参数，不够就说明缺哪个自由度。
>
> **② 花不止一种。** 按上表补：梨花、隔岸花。**花的位置问题另见 PQ-4**——
> 现在花的门槛卡死在「地表是草且高于 0.2 m」≥ 0.9，铺装院子里永远不长花；
> 参照图的花全在花池里，是人种的。**本单子只做花型，花池留给 PQ-4。**
>
> **③ 草的分布与斑块（只改分布，不改着色）。**
>
> - **方格**：0.32 m 抖动网格的周期俯视可见。换蓝噪声或多尺度叠加。
> - **均匀**：真草是斑块状的疏密，用低频噪声调密度，别一个密度铺满。
> - **露土**：植物之间要看得见土。**这一条如果需要改着色就停手留给 WG 之后**——
>   能靠"少撒几丛让地表露出来"做到的部分才是本单子的。
>
> ### 知识半：把植物清单抽成可机读
>
> 57 种散在 `plan.json` 的 region 注释里，不是可查询的真源。抽成一份清单
> （树/灌/藤/草/水生/苔各归类，带回目、原文引句、所属区域），走和营造规则同一套核验流程。
>
> **注意这与 `docs/ROADMAP.md §PE-3「从原文抽造景关系」是同一趟活**——
> 都要通读原文抽取并核验。**合并做，别开两次工。**
>
> **核验诚实**：你只有一个人，**不许把单人核验写成"两名核验者通过"**。
> 照 `07-71` 的写法标「甲已核、乙待核」，并把需要第二人裁的点列进 `open_questions`。
>
> ### 三条不要搞错
>
> 1. **不改着色。** `foliage-materials.ts` 与 `bamboo.ts` 的 shader 注入段是 WG2 的移植目标，
>    动了就是做两遍。你改几何、品种、散布。
> 2. **别一次把 57 种都做。** 先做游线上点名的六七种，**证明参数骨架够用**再铺开。
>    这也是 D-18「别让 compiler 吞掉大观园」那条纪律。
> 3. **三角数是硬线。** 现在 230–336 万，上限 400 万。**换树种不该涨多少**
>    （同样的卡片数、不同的参数），要是涨了说明形体做重了。
>
> ### 验收
>
> - `node tools/capture.mjs --url http://127.0.0.1:4801/garden.html --out shots/pq-o`，
>   与 `shots/pq3/` 同名镜头 `side-by-side`，至少 `xiaoxiang` / `treeline` / `grass_close` / `pond_reveal` 四张。
>   **判据一：潇湘馆院里长的是竹、梨、芭蕉，不是橡树。**
>   **判据二：低头看地面，看不出网格周期，能看见土。**
> - **随机抽三个区，园子里长的植物与 `plan.json` 的 `plants` 对得上。**
> - 三角数 ≤ 400 万、draw call 增量 ≤ 15。
> - `npm run check:all` 全过（含 `check:rules`，新的植物清单要过一致性门）。
>
> 回报：做了哪几种、参数骨架够不够用（不够缺哪个自由度）、知识清单抽了多少条、
> 哪些标了「乙待核」、三角数与 draw call 前后。

**规模**：大。**风险**：中高——**最容易越界的是去改着色**（那是 WG 的地盘），
其次是知识半贪多，57 种一次抽完然后核不动。

---

## 之后

N、O 合入后进 **WG**（WebGPU + TSL 迁移，方案见 `docs/reviews/2026-09-11-webgpu-migration-plan.md`）。
**WG 期间渲染文件必须单人独占**，不派任何并行任务。
WG 之后才是 **PQ 着色半 + PX**：草的分层着色与露土、水的流动、地面四档混合、体积云。
