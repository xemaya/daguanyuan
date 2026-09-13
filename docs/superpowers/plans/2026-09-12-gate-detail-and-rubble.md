# 正门的近处，与全园的虎皮石墙基

> 两张单子。**P 只做几何，Q 拿材质**——`memo` 没有导出，材质必须住在
> `builder/parts/materials.ts` 里才能合并 draw call（PITFALLS P-04），
> 所以这个文件只能归一个人。这样分也是对的：**虎皮石本质是材质问题，
> 西番草浅浮雕本质是几何问题**（`menSpec` 里 M 的注释就是这么写的）。

**背景**：2026-09-12 拿第十七回写正门那一段逐句对我们的建造，九个短句里做对六条、
缺三条、另有一条我们自己标着「不知道」。考据分档见 `knowledge/docs/qingshi/07-honglou.md`
的 **07-76**，分层原则见 `ART_DIRECTION.md` **§10 雕饰的三层距离**。

> 「只見正門五間，上面桶瓦泥鰍脊，那門欄窗槅，皆是細雕新鮮花樣，並無朱粉塗飾，
> 一色水磨群牆，下面白石台磯，鑿成西番草花樣。左右一望，皆雪白粉牆，下面虎皮石，
> 隨勢砌去，果然不落富麗俗套。」

**在跑的任务**：单子 O（植物）正占着 `builder/parts/zhiwu/`、`knowledge/rules/plants.rules.json`、
`knowledge/docs/plants/`。**两张单子都不许碰这些。**

## 全局约束

- 工作目录 `~/Workspace/games/daguanyuan`，分支 `editor`。
- 收工前 `npm run check:all` 全过。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**（PITFALLS P-15）。
- preview 带 `--strictPort`；园子在 **`/garden.html`**。
- **全场景三角数 ≤ 400 万**（现在 230–336 万），draw call 增量 ≤ 10。两组数字写进提交信息。
- **`engine/` 一个字都别碰**——WG 排在 N/O/P/Q 之后，要独占它。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

---

## 单子 P — 正门的近处：软脊、三段隔扇、新鲜格心、台基卷草

> 在 `~/Workspace/games/daguanyuan` 做正门的近处细部。考据见
> `knowledge/docs/qingshi/07-honglou.md` 的 **07-76**（**先读它，它把这件事分了三档**），
> 原则见 `ART_DIRECTION.md` **§10**。
>
> 你碰：`builder/parts/damu/building.ts`、`builder/derive/`（只在给 `fashi` 加 `ridgeStyle`
> 自由度时）、`builder/parts/shishan/`（台基卷草若做成独立石作件）。
>
> **`builder/parts/materials.ts` 一个字都别碰**——单子 Q 占着它（`memo` 没导出，
> 材质必须住在那个文件里才能合并 draw call，P-04）。**你只做几何，不新建材质。**
> 白石已经有了：`whiteStoneMaterial()`。
> **`builder/parts/qiangyuan/` 是 Q 的，`builder/parts/zhiwu/` 与 `knowledge/` 是 O 的。**
>
> ### 四件
>
> **① 屋脊改软。**
>
> 原文自己下了判断「**果然不落富麗俗套**」，而「富丽俗套」在清代屋顶语汇里正是
> **高正脊加正吻**那一套。**这一条是内证，可以直接施工，不依赖任何外部资料。**
>
> 但「泥鳅脊」的**具体做法未核到，两读并存**（07-76 第 2 档）：
> (a) 低而圆的**正脊**，屋面仍有脊线；(b) 即**卷棚**，根本没有正脊。
> 剪影都软，差别在有没有那条线。
>
> **两条已核到的事实**：
> - 卷棚顶「没有明显外露的正脊」「省略了屋顶的大脊」「**可分为悬山卷棚、硬山卷棚**」
>   「**多用于园林建筑**」——我们 `menSpec` 正是硬山，**硬山卷棚成立，等级定位正是园林**。
> - **`ridgeStyle: 'rolled'` 已经实现了，但只在 `fayuan` 参数集里**
>   （`builder/derive/fayuan/building.ts:69`）；`menSpec` 走 `fashi`，其 `Frame` 没有这个字段。
>
> **做法**：给 `fashi` 加 `ridgeStyle` 这个自由度，做**最小改动**。
> **不要**为此把正门改由 `fayuan` 推导——那要先回答「一座五间 Tier A 门屋该不该走江南参数集」，
> 是参数集层的决定，不在本单子范围。（但**把这个问题记成一条 `missing` 规则**：
> 「泥鳅脊」本身就是江南脊名，原著用江南词描述这座门，这是个值得追的证据。）
>
> **选了哪一读，必须 `artChoice` 留痕进 `provenance.art`，不许写成「原文如此」。**
>
> **② 隔扇补成三段。**
>
> 现在 `makeGeshan` **只有两段**：下 38% 裙板 + 上花格，而且裙板是素面 `roundedBox`。
> 补成清式隔扇的标准三段：
>
> | 段 | 做什么 |
> |---|---|
> | 上·**格心** | 棂条拼的纹样（已有，见 ③） |
> | 中·**绦环板** | **新增**。浅浮雕：折枝花卉 / 如意 / 缠枝草 |
> | 下·**裙板** | 现有那块，**加浅浮雕**，别再是素板 |
>
> **③ 格心换掉万字——原文说「新鮮」，我们选了最标准的那个。**
>
> `menSpec` 现在是 `lattice: 'wan'`（万字不到头），注释里还引着
> 「门栏窗槅皆是细雕新鲜花样」——**引了原文却选了最不新鲜的花样**。
> 换成步步锦 / 灯笼锦 / 变体几何棂花一类。
> **纹样的具体选择无原文依据（曹雪芹没写死），要 `artChoice` 留痕。**
>
> **④ 白石台基的西番草卷草。**
>
> 「西番草」比「新鲜花样」明确：清代流行的**卷曲植物纹样，缠枝、卷叶**特征。
> **做成浅浮雕几何，不是贴图**——M 的注释已经写死这一条：
> 「西番草是浅浮雕不是贴图，本期留素面待 P3 石作专件」，本单子就是来还这笔的。
> 材质用现成的 `whiteStoneMaterial()`。
>
> ### 两条铁律
>
> 1. **别五间全做满雕**（`ART_DIRECTION` §10）。原文的层级是
>    **远看五间、中看灰瓦白墙深色木作、走近才见雕工**。满雕会让门读成家具展厅，
>    正撞原文自己那句「不落富丽俗套」。**具象雕刻集中在白石台基一处**，木作更克制。
> 2. **不许上朱红**。原文明写「**並無朱粉塗飾**」。§9 放开的用金**只给匾额与楹联的字**，
>    梁枋彩画、柱、斗拱仍然不许。
>
> ### 验收
>
> - `node tools/capture.mjs --url http://127.0.0.1:4801/garden.html --out shots/gate-p --shots gate_approach,gate_plaque`，
>   与 `shots/pq3/` 同名镜头 `side-by-side`。
>   **判据一（远）**：屋顶剪影是软的，没有高正脊压在上面。
>   **判据二（近）**：`gate_plaque` 那一镜能看清隔扇三段与台基卷草，且**不是满雕**。
> - 三角数 ≤ 400 万、draw call 增量 ≤ 10。
> - `node tools/playtest.mjs --url http://127.0.0.1:4801/garden.html` 仍 `PLAYTEST PASS`。
> - `npm run check:all` 全过。
>
> 回报：屋脊选了哪一读、怎么留痕的；三段隔扇各做了什么；格心换成了什么；
> 卷草多少三角面；记了哪条 `missing`；三角数与 draw call 前后。

**规模**：大。**风险**：中——**最容易犯的错是雕过头**（§10 的反面），
其次是为了上软脊去动参数集（那是另一期的决定）。

---

## 单子 Q — 虎皮石墙基：全园粉墙都受益

> 在 `~/Workspace/games/daguanyuan` 做**虎皮石墙基**。
>
> 你碰：`builder/parts/materials.ts`、`builder/parts/qiangyuan/wall.ts`、
> `builder/parts/qiangyuan/wall-style.ts`。
>
> **`builder/parts/damu/` 是单子 P 的，`builder/parts/zhiwu/` 与 `knowledge/` 是单子 O 的。**
> **`engine/` 一个字都别碰。**
>
> **开工前必读**：`knowledge/docs/qingshi/07-honglou.md` 的 **07-02**（已核验通过）、
> `ART_DIRECTION.md` §3 色板与 **§10**、`docs/PITFALLS.md` 的 **P-04**（材质不缓存实例
> 就合不了 draw call——新材质必须走 `materials.ts` 里同样的 memo 模式）、**P-07**、P-06。
>
> ### 现状（已核实）
>
> 原文**两次**点名虎皮石：
>
> > 「左右一望，皆雪白粉牆，**下面虎皮石，隨勢砌去**，果然不落富麗俗套。」（07-02）
> > 而 `plan.json` 的 `zhengmen.buildings` 里也确实有一项叫「雪白粉墙·下面虎皮石(随势砌去)」。
>
> 全仓搜 `虎皮` / `rubble` / `tigerSkin`：**只有 `composer.ts` 一句注释提到它，代码里没有实现。**
>
> 墙基**是有的**（`wall.ts` 的 `BASE_H` + `PLINTH_H`，用 `stoneMaterial(1)`），
> 但那是**均匀青石**——放大看就是一条平整的灰带。
>
> ### 两件
>
> **① 虎皮石材质。** 虎皮石是**不规则杂色毛石乱砌**：石块大小不一、形状不规则、
> 颜色深浅斑驳（这正是"虎皮"二字的来处），缝是灰浆的浅色网。
> 按 `materials.ts` 现有的 `stoneMaps` / `whiteStoneMaps` 的做法写一个 `tigerSkinMaps` /
> `tigerSkinMaterial`，**走同样的 memo 模式**（P-04：不缓存实例就合不了 draw call）。
>
> **`P-07` 是这里最容易踩的坑**：石块的尺度要先算它在屏幕上占几个像素。
> 瓦垄那次因为 UV 周期算错，一个周期不到一像素，被 mipmap 平均成一块灰板——
> **虎皮石整成灰板就等于没做**。
>
> **② 「隨勢砌去」——墙基跟着地形起伏，不取平直。**
>
> 这半句比材质更难，**也更值钱**：它正是「不落富丽俗套」的注脚。
> 现在墙基是水平的一条。让它沿墙线采地形高程起伏，
> 石块随之错动（乱砌本来就不讲皮数对齐）。
>
> ### 两条不要搞错
>
> 1. **这是全园粉墙的墙基，不只正门。** 一次做完处处受益——潇湘馆的粉垣、
>    园子外围墙都该有。**别只改正门那几段。**
> 2. **虎皮石在"中景"层**（`ART_DIRECTION` §10）：它负责**材质与色的分区**，
>    不负责雕工。别把石块做得太碎太具象，走近了看是石头就够了。
>
> ### 验收
>
> - `node tools/capture.mjs --url http://127.0.0.1:4801/garden.html --out shots/wall-q --shots gate_approach,moon_gate,xiaoxiang`，
>   与 `shots/pq3/` 同名镜头 `side-by-side`。
>   **判据一**：粉墙下面那条是杂色毛石，不是均匀灰带；**放大到实际游戏距离仍读得出是石头**（P-07）。
>   **判据二**：墙基随地形起伏，不是水平一条直线。
> - 三角数 ≤ 400 万、draw call 增量 ≤ 10——**材质走 memo，别让墙分裂成很多桶**（P-04）。
> - `node tools/playtest.mjs --url http://127.0.0.1:4801/garden.html` 仍 `PLAYTEST PASS`。
> - `npm run check:all` 全过。
>
> 回报：虎皮石材质怎么生成的、石块尺度按什么定的、"随势"怎么实现的、
> 全园有多少段墙吃到了、三角数与 draw call 前后。

**规模**：中。**风险**：中——**最容易犯的错是石块尺度算错读成灰板**（P-07），
其次是只改了正门那几段没照顾全园。

---

## 之后

N（已合入 `1a17b251`）、O（在跑）、P、Q 都合入后进 **WG**（WebGPU + TSL 迁移）。
**WG 期间渲染文件单人独占，不派任何并行任务。**
