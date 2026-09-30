# 单子 BA：稻香村第一轮——平面纠错 · 扩窗空跑 · 茅屋近景 · 泥墙青篱 · 入建成与游线

> **依据**：`knowledge/docs/scenes/daoxiangcun.md`（景需求文档，`D-29`）——**全篇读完再动手**，§4/§5 是病、§6 是机位与台账；
> 考据 `knowledge/docs/qingshi/tiers.md` §5 / C-r 乡野子档 / R-03；`docs/DECISIONS.md` `D-34` ③（潇湘馆收口、开建稻香村）。
> 空跑先例：`docs/superpowers/plans/2026-09-14-y-scene-contract.md`（「一个区有落位清单 = 建成」）。
>
> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md` 全部 15 条，本单不再内联。** 三角预算按 `D-25`。
> **这是 P4 第一个新区**，本单也是「加一个区要花多少」的第一次实测——数字比完成度重要。
>
> **本单有三个停下点**（⏸）：BA0 出方案后、BA1 触发 AY 时、BA2 棚拍后。停下 = 拍图 + 写回报 + 等裁，不许自己往下走。
>
> **文件域**：
> `projects/daguanyuan/plan.json`（**只许**动 `daoxiangcun` 区内的 buildings / linears / pads / plants 与 `connection.daoxiang-*`，以及 BA0 裁定后必须跟着挪的 `creek.west` 那一段——动 creek 要先停下问）；
> 新建 projects/daguanyuan/scenes/daoxiangcun.json；
> `builder/derive/rustic/`、`builder/derive/construction.ts`（**只许**动乡野参数集那一支与 `pendingGeometry`）；
> 茅屋近景几何（新文件放 `builder/parts/` 下合适的类目，如 `builder/parts/xiangye/`，并用 `builder/parts/registry.ts` 的 `registerPart` 登记）；
> `builder/parts/qiangyuan/wall.ts`（**只许新增**黄泥墙变体，不改粉墙）；新建青篱构件；
> `builder/parts/zhiwu/vegetation.ts`（**只许**：杏的花色变体、`REGION_TREES.daoxiangcun`）；
> `builder/compose/composer.ts`（**只许**改 frame-ready 的放行条件，让乡野建筑能建）；
> `tools/playtest.mjs`（**只许追加**潇湘馆之后的航点）、`tools/record.mjs`（**只许追加**稻香村那几站）。
> **不碰**：`tools/shot-list.mjs` 与任何机位（`dx_*` / `cu_dx_eave` 已由验收人加好；挪了建筑就回报，验收人改机位）、`perf-baseline.json` / `coverage-baseline.json`、
> 其余四区的任何构件与落位、`experience-measured.json`、着色器。
> **R-03 反目标**：不补远山、邻村、塔、市桥，水不给源头——07-14 的「六无」是原文批评的对象，必须留着。

---

## BA0 · 平面纠错 ⏸

**病**（验收人 2026-09-25 画平面量的，`knowledge/docs/scenes/daoxiangcun.svg`）：
西溪 `creek.west`（干溪宽 10 m，中线 (−178,−52)(−198,−38)(−208,−18)(−208,6)）斜穿村口。
① 黄泥矮墙 (−227,−30)→(−178,−30) **横穿西溪**，锚点 (−198,−30) 在水里；② 西溜青篱 x=−207、z −18~−33 离中线约 2.5 m，**在水里**；
③ 土井 (−200,−8) 落在「篱外山坡」多边形**内**，原文是「山坡之下」；④「东厢田舍」(−215,−40) 在主屋**西侧**；⑤ 酒幌 (−190,−22) 贴水边。

**做法**：出**两档**方案，每档一张平面（照 `make-sketch.mjs` 的画法，另存 `shots/BA/ba0-plan-{a,b}.svg`），写清每档挪了什么、依据：
- **甲：溪不动，村让溪**——泥墙在溪两岸断开（或溪上留水口）、西篱退到溪西岸以外、井挪到坡脚、厢房改名或挪到东侧；
- **乙：溪改道，绕村南**——`creek.west` 这一段改走村外（07-30「引到那村莊里」要求水进村，乙档要说明怎么还算「引到村里」）。
每档列出：动了哪些 plan 字段、`check:plan` / `check:p2` 过不过、潇湘馆 / 沁芳的水系受不受牵连。**停下，等用户选**。

## BA1 · 扩窗空跑与性能复测 ⏸

在 BA0 裁定的平面上，**先只做「入建成」这一件**：建 scenes/daoxiangcun.json（新文件）（`named` 只挂 plan 对象、茅屋先用 Y 空跑的 `building:tang` 顶替、墙篱井先空着），让世界把稻香村算进建成区。

**量**（前后各三次连拍中位数，`tools/frustum-census.mjs` 按类别 × 远近）：
- 地形窗口前后（验收人按区多边形估：270×218 → **357×376 m，2.28 倍**）；
- 建时（`profile-world` 或 capture 的就绪时间，分项：地形 / 植树 / 理地 / 构件）；
- 四镜三角 / calls / fps / `frameCostMs`，以及 `dx_approach` 的读数；
- `gate_approach` 的 Garden 120 m 外三角。

**触发 AY 的条件**（AX 单子末节）：`gate_approach` 的 Garden 120 m 外 > 2M，或建时 > 40 s——**任一触发就停下回报**，不往下做（那要先写区级流式 / HLOD 的单子）。
没触发就把这一步留作一个 commit（顶替件照样在，BA3 换掉）。

## BA2 · 茅屋近景几何 ⏸

**病**：两栋茅屋 `status: frame-ready`，composer 不建（`builder/compose/composer.ts:446`）；乡野参数集挂着 `rustic-timber-joints` / `thatch` / `earth-walls` 三项未做几何（`builder/derive/construction.ts:35`）。
`builder/parts/distant/scene.ts` 的 `rustic` 远景茅舍（土墙块、纸窗、茅顶挤出）可以借思路，**不能**直接拿来当近景。

**做法**：按推导器出的框架尺寸（`builder/derive/rustic/building.ts`：开间 2.6/3/2.6、进深 6、柱高 2.7、坡 0.4、茅厚 0.2）出三件几何：
- **茅苫**：悬山，厚 0.2 m 的**厚边**要读得出（檐口一刀齐的草茬、两山出际的草边），不是一张有厚度的板；表面是草束的方向纹，不是瓦垄；屋脊压一道草脊；
- **土壁**：黄泥版筑墙面，带版筑层线与底部返潮；纸窗（窗纸照 `P-05`：emissive 假透光，**不许 transmission**）；
- **木构**：粗木、不施彩画、柱头不出斗栱（C-r 乡野子档），檐下露椽头。
新件用 `builder/parts/registry.ts` 的 `registerPart` 登记，**先 `node tools/shoot-part.mjs` 棚拍**：正面、45°、檐口贴脸三张 + 联络表，拷到 `shots/BA/ba2-*`。
**停下给用户看棚拍**。用户点头后再改 composer 的放行条件、把两栋的 status 从 frame-ready 推进（写清推进成什么），进世界。

**判据**（棚拍 + 进世界后 `cu_dx_eave`）：茅苫厚边与草茬读得出；远看（`dx_approach` 距离）读成茅草不是瓦；三角：单栋 ≤ 正门门屋的一半（量了写进回报）；进世界后 `AF` 门 0 条。

## BA3 · 围合：黄泥矮墙 + 稻茎墙头 · 两溜青篱

- **黄泥矮墙**：`wall.ts` 新增一个变体（不改粉墙）：版筑泥墙、高 1.4 m、宽 0.55 m、**墙头覆稻茎**（一道蓬松的草檐，不是瓦压顶）；按 BA0 裁定的走线与开口生成。
- **两溜青篱**：新构件。原文「桑,榆,槿,柘,各色樹稚新條,隨其曲折,編就兩溜青篱」——**活的新条编的篱**，带叶、高低参差、随地形曲折；
  不是竹篱笆、不是木栅栏（plan 里的 `material: "green-bamboo"` 改掉，basis 写明依据 07-11）。高 1.2 m，走线按 BA0。
- 两件都先棚拍（`shoot-part --sheet`），再进世界。

**判据**：`dx_approach` 里矮墙能挡住院地、挡不住墙后屋顶（人眼 1.6 m）；墙头读得出稻茎；`dx_court` 里两溜篱读成**绿的、活的**；`AF` 门 0 条；墙与篱**一段都不许在水里**（`check:scenes` 或自写检查，报每段到西溪边的最小距离）。

## BA4 · 落位、杏林、游线

- scenes/daoxiangcun.json（新文件）：换掉 BA1 的顶替件，落茆堂、厢舍、泥墙、青篱、井台（**只做井台**，桔槔辘轳第二轮）、匾「稻香村」；每条带 basis。
- **杏林**：`vegetation.ts` 给桃树加一个**杏花花色**变体（杏花比桃更红，含苞近胭脂，「如噴火蒸霞」），`REGION_TREES.daoxiangcun` 的 mix 改成以杏为主；
  范围在泥墙外沿到茅屋之间成片（「幾百株」——按全园树预算给一个数，回报写怎么定的）；**别用 Bridson 带密度撒**（`P-28` / `P-33`），走先撒后筛。
- **游线**：`tools/playtest.mjs` 从潇湘馆之后追加 e08 航点：(−148,66) 青山斜阻 → 绕篱外山坡 → 村口 (−196,−18) → 过溪木桥 → 茆堂前 (−202,−46)。**不许 teleport**，走不通就是 bug。
  `tools/record.mjs` 追加三站：转过山怀（≈`dx_approach`）/ 村口 / 茆堂前。

**判据**：
- `npm run check:all` 全过、`playtest` PASS，脚下序列列出村内段；对账门 `--coverage`：稻香村 plan 对象里**本轮该有的**（两栋、泥墙、青篱、井台）全有，其余进 known-gap 并在回报列名；
- 四镜三次连拍：相对 BA1 之后的读数 ±3%（BA1 的涨幅单独报，那是扩窗的账，不是本单构件的账）；
- 四个 `dx_*` / `cu_dx_eave` 机位前后图；`dx_approach` 那一眼读得出「黃泥矮牆、牆頭稻莖、杏花如霞、牆里茅屋」四样。

---

## 开工基线

`perf-baseline.json`（2026-09-25，三次中位数）：

```
gate_approach   312 calls  4244033 tris  46 fps  4.2 ms
mound_block     280 calls  4195219 tris  47 fps  3.9 ms
grass_close     290 calls  4395937 tris  47 fps  5.3 ms
xiaoxiang       254 calls  3312662 tris  44 fps  4.7 ms
```

before 图：四个稻香村机位在开工前拍一次（区不在建成里，拍到的是空地或窗口外——**那张就是「开工前」**，纪录片要用），拷到 `shots/BA/before/`。
**与单子 AZ（竹 LOD）并行**：AZ 只动 `bamboo.ts` / `instancing.ts` / `composer.ts` 竹那一段；本单也动 `composer.ts`（放行条件）——**合回时各自只 `git add -p` 自己的 hunk**，
先合回的那张把基线变化报清楚，后合回的那张以它为准。

## 顺序与提交

`BA0`（方案，⏸）→ `BA1`（入建成空跑 + 复测，可能 ⏸）→ `BA2`（茅屋棚拍，⏸）→ `BA3` → `BA4`。每件一个 commit，`git add` 只按路径。
**每个 ⏸ 都要合回 editor 之后再停**（方案图与空跑读数进主检出 `shots/BA/`），别让成果只躺在 worktree 里。
收工必须改 `knowledge/docs/scenes/daoxiangcun.md` 的 §4/§5 现状列与 §6 台账（只许写量过的数），平面由验收人重画。

## 回报

BA0 两档方案图与字段清单；BA1 窗口、建时分项、四镜 + `dx_approach` 读数、Garden 120 m 外、是否触发 AY；
BA2 棚拍三张、三角、放行条件改了什么、status 推进成什么；BA3 两件的棚拍、每段到西溪的最小距离；
BA4 落位清单、杏林株数与怎么定的、playtest 村内脚下序列、对账门、四镜前后、四机位前后。

**规模**：**大**（本项目第一个从零建的区）。**风险**：
**BA0 最容易自己挑一档就往下做**——两档都要画出来给人看；
**BA1 最容易把性能账和构件账混在一起**——扩窗的涨幅必须单独拍一次，否则后面分不清是窗口贵还是茅屋贵；
**BA2 最容易把茅顶做成「绿色瓦」或「有厚度的板」**——茅的读法在厚边、草茬、草束方向，棚拍贴脸那张就是看这个；
**BA4 最容易用 Bridson 撒杏林**，把全园的树又洗一遍（`P-28`）。
