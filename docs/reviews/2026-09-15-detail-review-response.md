# 对《程序化细节深化评审》的核验与执行顺序

> 2026-09-15。被评稿：`docs/reviews/2026-09-15-procedural-detail-review.md`（codex 出，用户交来）。
> **用户定调：这条线优先于单子 AL / AM。**
> 本篇做三件事：①它说的对不对（逐条核到代码与截图）；②哪几处我不同意或要改口径；③怎么拆成单子、按什么顺序、谁能与 AJ 并行。

---

## 1. 核验：它引的事实全部站得住

我不采信评审自报，逐条回仓库核了。

| 评审说 | 核到的 | 判 |
|---|---|---|
| `baogushi.ts:32` 用 LatheGeometry 直接沿用旋转体 UV，叠方向性凿痕 → 鼓面放射纹 | `LatheGeometry(pts, 22)` 在第 32 行；`whiteStoneMaps` 的凿痕是 `tileableFbm(u*5, v*0.4)`，各向异性；`shots/detail-review-2026-09-15/cu_baogushi.png` 鼓面**就是一圈辐条** | ✅ |
| 白石与青石共用一套凿痕逻辑 | `materials.ts:290` 注释自己写着「与青石同一套凿痕高度场，色换成暖白」 | ✅ |
| `PostFX.settings.grain=0.016`，颗粒加在 sRGB 之前 | `grade.ts:33` 在 ACES 之后、`encodeOutputNode` 的 sRGB 编码之前 `addAssign(hash(...)*grain)`；线性域加噪，gamma 会把暗部放大。截图暗部整片蓝颗粒 | ✅ |
| 绦环板用管 + 压扁球；台基卷草 TubeGeometry 在 `forecourt-terrace.ts` 复制了一份 | `building.ts:202` TubeGeometry、`:404` SphereGeometry 叶；`forecourt-terrace.ts:50` 同一算法，注释自认「不新造第二套纹样」 | ✅ |
| 棂条 2 cm，风格圣经「最小 1.5 cm 倒角」与之冲突 | `building.ts:420` `lanternLatticeGeometry(gw, gh, 0.02)`；`:327` 注释「细于 4cm 的棂条倒角看不见，用直箱」；`ART_DIRECTION.md` §2 第 46 行「最小倒角 1.5cm」 | ✅ 冲突是真的，而且代码已自行开了例外，只是没写进圣经 |
| `buildBuilding()` 在 `building.ts:1619` 先 `mergeByMaterial`，之后 composer 才 `assembleStatic` | 属实。**而且不止建筑**：`baogushi.ts:106`、`shiyabian.ts:166`、`luya.ts:217` 都在构件内部先合。`assembleStatic` 的实例化（≥8 重复原型）在构件层就被打散了 | ✅ 比评审说的更普遍 |
| `merge.ts:23–25` 只留 position/normal/uv/color | 属实，其余属性 `deleteAttribute` | ✅ |
| `plasterMaps()` 把潮痕烘在可重复的 v 里 | `materials.ts` 第 91 行「v=0 是墙脚：潮渍从下往上淡出」，随 repeat 循环 | ✅ 潇湘馆白墙横色带的嫌疑成立，评审自己也说要分项排查 |
| 纹理缓存键不含 size | `cached('turf.albedo', …)` 等 55 处调用键里都没有尺寸 | ✅ |
| `intentional_void` 没有 builder 消费者 | 只在 `experience-audit.mjs:22` 的类型表里，注释「本期明确不做」 | ✅ |
| fps 读数不作基准（拍摄时开着别的预览） | 与 `D-25` 一致：fps 当目标不当门，三次中位数、独占 GPU | ✅ |

**结论：这份评审的事实层可信，可以直接当开单依据。**

## 2. 我要改口径的四处

1. **颗粒不是 bug，是拍过板的 look**（`D-02` 动森式、`ART_DIRECTION` §4）。评审建议的「单变量对照」是对的，
   **但对照出来之后由用户选**，不由 agent 定——同 AJ2 的两档对照一个规矩。
2. **「先实例化再合并」不是改一行**。构件内部先合是 5 个文件的共同模式，不是 `building.ts:1619` 一处。
   动它等于改构件输出契约（构件交出「原型 + 摆放」而不是「合好的大网格」），这是 `AQ-b`，要等 AJ 合回、
   并且**只在样件证明「近中远三档」值得之后**再做——否则是为通用性而通用性（`D-18`）。
3. **评审把「管线两处」排在样件之后**。我把其中两个**小**的提前：缓存键补 size、合并按属性布局分桶。
   它们半天的活，而样件一做就会踩上（第二套 UV 被删、多分辨率贴图撞同一缓存）。**大的**（实例化顺序、LOD 三档、滞回）仍按评审排在样件之后。
4. **西番草铺满台矶周长会炸预算**。`forecourt-terrace.ts:45` 自己的注释就警告过（周长 13.76×5.6 远大于门屋台基）。
   所以 `AO` 的近景几何**只许出一段样件**，铺开必须等 `AQ-b` 的距离档——评审说了「先证明质量与预算」，这里把它写成硬门。

**评审没说但要补的**：这条线的每一单都要 **before/after 同机位四张**（近正、近斜、中景、走近片段），
以及 `D-25` 的预算逐件归因。预算基线由 **AK** 落地——**AK 变成这条线的第 0 步**。

## 3. 怎么做：按文件域排，不按评审的章节排

AJ 正在 `forecourt-terrace.ts`（AJ1 已合回 `6b931477`）、`baogushi.ts`（AJ2）、`building.ts`（AJ3）里干活。
评审的前四步恰好全落在这三个文件里。**能并行的只有不碰这三个文件的活。**

```
现在（与 AJ 并行）：
  AK   perf-baseline 门                       tools/manifest-diff.mjs, 新基线文件
  AN1  后期单变量对照（颗粒/AO/法线）           engine/core/PostFX.ts 加开关 + 出对照图 → 用户选
  AQ-a 缓存键补 size + 合并按属性布局分桶       engine/core/TextureLab.ts, builder/parts/merge.ts + 测试
  AJ2 补充：鼓面 UV 平面投影、鼓帮周向展开       并进 AJ2（同一个 agent、同一个文件）

AJ 合回之后（AJ2 / AJ3 落地）：
  AN2  材质加工尺度（白石细磨各向同性、鼓帮/座脚粗档、粉墙潮痕与墙脚高度解耦）   materials.ts, wall.ts
  AO   一段西番草：二维纹样描述 → 近景浮雕几何 + 中景法线（只出样件，不铺开）      新 builder/parts/ornament/, forecourt-terrace.ts
  AP   一扇灯笼锦：截面分级、节点整理、收头、纸面退后（保留花样与洞口尺寸）        building.ts makeGeshan/lanternLattice, wall.ts 格心
       AO ‖ AP 可并行：AP 第一件不用二维纹样工具，绦环板那根管归 AO

AO/AP 过了之后：
  AQ-b 构件交原型+摆放、先实例化再合并；近中远三档 + 按屏幕尺寸切档 + 滞回      5 个构件文件 + static-batches.ts + composer.ts
  AR   接触区样板：潇湘馆墙脚—石基—竹丛（潮痕/苔/落叶同一场）                    与 AL4 合并考虑，AL 之后

再往后：AL / AM（AM1 的白石峰**要吃 AN2 的白石配方**，AL1 的石子漫**属于 AN2 说的「材质三档信息」**——先有配方再做它们，正是评审的意思）
水面反射、植物枝序：评审自己排在最后，照办。
```

**并行上限仍是三条**（我验收带宽）：现在是 AJ ‖ AN1 ‖ AQ-a（AK 很小，夹在里面）。

## 4. 单子索引

| 单 | 文件 | 状态 |
|---|---|---|
| AK | `docs/superpowers/plans/2026-09-15-ak-perf-baseline.md` | 已写 |
| AJ2 补充 | 已并进 `docs/superpowers/plans/2026-09-15-aj-gate-refine.md` AJ2 节 | 已写 |
| AN | `docs/superpowers/plans/2026-09-15-an-see-detail-first.md` | 已写（AN1 现在可派，AN2 等 AJ） |
| AQ-a | `docs/superpowers/plans/2026-09-15-aq-pipeline-small-fixes.md` | 已写 |
| AO / AP / AQ-b / AR | 等 AJ 合回后按落地的代码写，避免对着正在变的文件开单 | 未写 |

## 5. 记进坑与规矩的

- `docs/PITFALLS.md` 待记：**在线性域加均匀噪声，gamma 会把暗部噪声放大**（AN1 出数后记，带对照图）。
- `ART_DIRECTION.md` §2 待补**小木例外**：棂条细于 4 cm 不倒角（代码已这么做，圣经没写）。归 AP 收工时补。
