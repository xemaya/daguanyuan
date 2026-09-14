# 单子 Y · 区清单契约 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]` 勾。

**Goal:** 让「加一个区」的 diff 里不出现 `.ts`——只动 `plan.json` + `scenes/<region>.json`。

**Architecture:** `composer.ts` 不再持有 `SCENE` 常量。落位来源变成两处：
**① 点名件由 plan 遍历生成**（位置读 plan 的锚点，构件按 `kind` 推导，推不出来的在
`scenes` 的 `named[]` 里绑定）；**② plan 里没有锚点的东西写在 `scenes/<region>.json`
的 `placements[]`，坐标一律相对锚点**。`scatters[]` 只占位，实现归单子 Z。
`scenes/*.json` 与 `plan.json` 同路数：`builder/` 不许 import `@project/`，由 `main.ts`
注入（`setScenes()`）。

**Spec:** `docs/superpowers/specs/2026-09-14-scale-architecture-design.md`（§1.1 §1.2 §2 ①）

## Global Constraints

- **分层禁令**：`builder/` 不许 `import @project/`。scenes 走 `setScenes()/getScenes()` 注入。
- **迁移必须数值精确**：把 `SCENE` 搬进 `scenes/*.json` 是**换表达方式，不是重新摆**。
  每条的世界坐标由「锚点 + dx/dz」算出来必须与迁移前**逐位相同**。
- **`D_ZHENGMEN`/`D_CUIZHANG`/`D_QINFANG`/`D_XIAOXIANG` 四个批量平移常量必须删掉**。
  它们是旧世界补丁，存在的每一天都在等着制造下一个「竹子进屋」（spec §2 ① 纪律 1）。
- **每条 `placements` 必须有 `basis`**，`check:scenes` 拦着，不写不许进。
- **`scatters` 不写坐标**（Y 只定形状、不实现；实现归 Z）。
- **不做通用约束求解器**（spec §4）。

**迁移前的基线（2026-09-14 当场量，`shots/ad-baseline`）：**

| | |
|---|---|
| `geometry.geometryAndTransformsSha256` | `9400e0cca1f705e7d43b422d304b0b4caf25c294cefc82e3591d2cd9208216cc` |
| meshes / uniqueGeometries | 941 / 902 |
| 名册条目 | 52 |
| 对账覆盖率 | 10/23，野生件 44 |
| `playtest` | PASS（418.3 m） |

**这个 hash 是本单子最硬的验收工具**：只做「换表达方式」的那几步，它必须**一位不差**；
只有明确要新增构件的那一步（Task 3 的 plan 遍历会把滴翠亭与潇湘馆后房建出来）才允许它变，
而且要说清变了什么。

---

### Task 1: scenes 契约与注入

**Files:**
- Create: `builder/compose/scenes.ts`
- Create: `projects/daguanyuan/scenes/zhengmen.json`（先只放一个最小合法文件）
- Modify: `projects/daguanyuan/main.ts`
- Create: `tools/check-scenes.mjs`、`package.json` 加 `check:scenes`
- Test: `tests/scenes-contract.test.mjs`

**Interfaces:**
- Produces（`builder/compose/scenes.ts`）：
  ```ts
  export interface ScenePlacement {
    part: string; variant?: string;
    /** 本区 plan 对象的稳定 id。落位一律相对它，不许写世界绝对坐标。 */
    anchor: string;
    dx: number; dz: number; yaw?: number; dy?: number;
    basis: string;            // 必填
    tag?: string;
  }
  export interface SceneNamed {
    /** plan 对象的稳定 id；位置从 plan 读，这里只绑构件。 */
    object: string;
    part: string; variant?: string;
    yaw?: number; dy?: number; y?: number; pier?: boolean;
    basis: string;            // 必填
    tag?: string;
  }
  export interface SceneScatter { part: string; rule: string; [k: string]: unknown }
  export interface RegionScene {
    region: string; $comment?: string;
    named?: SceneNamed[]; placements?: ScenePlacement[]; scatters?: SceneScatter[];
  }
  export function setScenes(list: RegionScene[]): void;
  export function getScenes(): RegionScene[];
  export function validateScenes(scenes: RegionScene[], plan: unknown): string[];
  ```

- [ ] **Step 1: 写失败的测试** —— `tests/scenes-contract.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateScenes} from '@builder/compose/scenes.ts';
const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));

test('placements 缺 basis 不许进',()=>{
 const bad=[{region:'zhengmen',placements:[{part:'wall',variant:'plain',anchor:'zhengmen.main-gate',dx:10,dz:0}]}];
 assert.ok(validateScenes(bad,plan).some(f=>f.includes('basis')));
});

test('anchor 必须是本区真实存在的 plan 对象',()=>{
 const bad=[{region:'zhengmen',placements:[{part:'wall',anchor:'xiaoxiangguan.main-house',dx:0,dz:0,basis:'x'}]}];
 assert.ok(validateScenes(bad,plan).some(f=>f.includes('锚点')));
});

test('placements 不许出现世界绝对坐标字段',()=>{
 const bad=[{region:'zhengmen',placements:[{part:'wall',anchor:'zhengmen.main-gate',x:65,z:236,dx:0,dz:0,basis:'x'}]}];
 assert.ok(validateScenes(bad,plan).some(f=>f.includes('绝对坐标')));
});

test('named 绑定的 object 必须在本区',()=>{
 const bad=[{region:'zhengmen',named:[{object:'xiaoxiangguan.main-house',part:'building',variant:'men',basis:'x'}]}];
 assert.ok(validateScenes(bad,plan).some(f=>f.includes('不在本区')));
});

test('region 必须是 plan 里真实存在的区',()=>{
 assert.ok(validateScenes([{region:'nowhere'}],plan).some(f=>f.includes('plan 里没有')));
});
```

- [ ] **Step 2: 跑，确认红**

Run: `node --experimental-strip-types --import ./tests/ts-resolver.mjs --test tests/scenes-contract.test.mjs`
Expected: FAIL —— `builder/compose/scenes.ts` 不存在。

- [ ] **Step 3: 写 `builder/compose/scenes.ts`**（类型 + 注入 + `validateScenes`，代码见执行时提交）

- [ ] **Step 4: 跑，确认绿**

- [ ] **Step 5: `main.ts` 注入 + `check:scenes` 工具 + npm script**

`main.ts` 用 `import.meta.glob('@project/scenes/*.json', { eager: true })` 收齐再 `setScenes()`。

- [ ] **Step 6: 提交**

---

### Task 2: 迁移——`SCENE` 搬进 `scenes/*.json`，删掉四个平移常量

**Files:**
- Modify: `builder/compose/composer.ts`（删 `SCENE`、`D_*`、`shift`、`pt`）
- Create: `projects/daguanyuan/scenes/{zhengmen,cuizhang,qinfang_ting_qiao,xiaoxiangguan}.json`

**dx/dz 必须由当前真实世界坐标反算**（脚本从 AD 的基线名册里取），不是照抄旧局部数。
反算结果全是整数或一位小数偏移：六段粉墙 ±10/±16/±23、翠嶂伴石 −6.2/+2.5 与 +4.4/−2.8、
潇湘馆散石 −4.4/+3.6、七丛竹见 `projects/daguanyuan/scenes/xiaoxiangguan.json`。

- [ ] **Step 1..N**：反算 → 写 JSON → composer 改读 → 重拍 → **hash 必须一位不差**
- [ ] **验收**：`geometryAndTransformsSha256` 仍是 `9400e0cc…`；`playtest` PASS

---

### Task 3: 点名件由 plan 遍历生成

**Files:** `builder/compose/composer.ts`

规则（推导顺序，先命中先算）：
1. `scenes[region].named[]` 里绑定了构件的 → 用它，位置读 plan 对象的 `x/z`；
2. `kind === 'building'` 且有 `construction.spec` 且 `status !== 'frame-ready'` → `garden-building`，`variant = 对象 id`；
3. `region.linears[]` 的 `kind` 为 `wall`/`corridor`/`bridge` → `garden-wall`/`garden-corridor`/`garden-bridge`，`variant = linear id`；
4. 其余 → 不生成（对账门会把它报成缺项，那是**对的**）。

**⚠️ 这一步会改变世界**：规则 2 会把 `qinfang_ting_qiao.dicui-pavilion`（滴翠亭）与
`xiaoxiangguan.rear-house`（潇湘馆后房）**建出来**——它们在 plan 里有完整 spec，
只是从来没人在 `SCENE` 表里手写条目。这正是目标 1 要的效果，也是 AD 对账门报的
13 个缺项里的 2 个。

- [ ] 验收：对账覆盖率从 **10/23 升到 12/23**；`playtest` 仍 PASS；hash 变化要能解释成
  「多了两栋房子」（`meshes` 上升、其余机位三角数上升）。

---

### Task 4: 空跑试验——稻香村

只写 `plan.json` 已有的 `daoxiangcun` 段 + 往 `scenes/` 里丢一份该区的落位清单，
**不改一行 `.ts`**，看它能不能出现。

**⚠️ 执行时发现判据一开始不成立**：`MVP_REGIONS` 本身是 `terrain.ts` 里的常量，
所以「加一个区」仍然要改一行 `.ts`。已把「哪些区建成了」整个搬进数据——
**一个区有落位清单，就算建成**（`projects/daguanyuan/scenes.ts` 的 eager glob）。

- [ ] 验收（spec §3）：构件能落地；**AD 的对账门要把这个新区的对象全部记账**
  （`builtRegions` 多一个、`built.total` 上升、`knownGaps` 下降）。
- [ ] 试完**回滚 `MVP_REGIONS`**（把区真建进来是单子 P4 的事，不是 Y 的）——
  但把试验读数记进本单子。

---

## 跑出来的结果（2026-09-14 执行完，全是实际读数）

### 迁移（Task 1-3）

| | 迁移前 | 迁移后 |
|---|---|---|
| 名册条目 | 52 | **54** |
| 名册里消失的构件 | — | **零** |
| 名册里新增的构件 | — | `qinfang_ting_qiao.dicui-pavilion`、`xiaoxiangguan.rear-house` |
| 对账覆盖率 | 10/23 | **12/23** |
| 野生件 / known-gap | 44 / 80 | 44 / 80（不变） |
| `playtest` | PASS | PASS |

比对是逐件按 `part:variant@x,y,z`（两位小数）做的：除了新增那两栋，**每一件都在
分毫不差的老位置上**。滴翠亭与潇湘馆后房在 plan 里本来就有完整 `construction.spec`，
只是从来没人在 `SCENE` 表里手写条目——规则 2 一接管，它们自己就建出来了。
这两个正是 AD 对账门报的 13 个缺项里的 2 个。

**途中修掉一个自己引入的缺陷**：`planId` 一度从 `anchor` 推，于是竹丛冒充正房、
六段粉墙冒充正门，野生件假降到 28。**相对谁摆不等于就是谁**——`planId` 改由生成方
显式给，并加了一条测试焊住。

### 空跑试验（Task 4）

往 `scenes/` 丢一份稻香村落位清单（3 条 `named` + 1 条 `placements`），**零 `.ts` 改动**：

```
建成区 cuizhang, daoxiangcun, qinfang_ting_qiao, xiaoxiangguan, zhengmen
已建成区覆盖率  15/30          ← 分母自己从 23 长到 30
  缺  daoxiangcun.mud-wall / fence / wine-banner / rock-01   ← 没绑构件的，门报得对
known-gap  80 → 73             ← 只许降不许升，降了
野生件     44 → 45             ← 多的那一丛是 placements 里的竹
稻香村落地的件：
  building:tang  @ -202.0, 1.2, -52.0     ← plan 锚点 (-202,-52)
  building:tang  @ -215.0, 1.2, -40.0     ← plan 锚点 (-215,-40)
  taihu:edge1    @ -200.0, 1.2,  -8.0     ← plan 锚点 (-200,-8)
```

**三件都精确落在 plan 的锚点上，AD 的对账门把这个新区的对象全部记了账。**
spec §3 的两条验收判据都过了。

（稻香村两栋草舍的 `construction.status` 是 `frame-ready`，规则 2 按约定拒绝生成，
所以走 `named` 绑通用堂屋顶替——路子与正门同。这恰好证明契约的两条路都通。）

### 顺带量到的一笔账，直接归单子 AA

空跑把 spec §1.3 的推算坐实了，并补了一个它没有的中间点：

| | 采样窗口 | 地形网格(`CELL=0.48`) | splat 1024² |
|---|---|---|---|
| 现在 4 区 | 270 × 218 m | 563 × 454 = **0.26 M 顶点** | **26.4 cm/texel** |
| **+稻香村，只多一个区** | 357 × 376 m | 744 × 783 = **0.58 M 顶点** | **36.7 cm/texel** |
| 全 19 区 | 500 × 514 m | 1042 × 1071 = **1.12 M 顶点** | **50.2 cm/texel** |

**只加一个区，地面精度就掉 39%、顶点翻 2.2 倍、世界建时 20.1 秒、三角数 3.86M→5.13M。**
spec 说这不是「以后再优化」的事，是**目标 3 在结构上不可能达成**——现在这句话有实测数字了。

按计划回滚了空跑（删掉那份落位清单），读数留在这里。要重做这个试验，
照 §「空跑试验」那三条 `named` 的形状重建一份即可。

### 留给后续单子

- **Z（接缝 ②③）**：`scatters[]` 的形状已经在契约里占好位，`check:scenes` 能校验，
  但**没有实现**。曲桥链与池岸驳石现在仍由 `composer` 程序生成（沿折线铺、沿池边找
  刚露出水的位置）——它们不写坐标，正是 ② 的入口。竹丛那七条的 `basis` 里也记着
  `99-25`（原坐标落进正房 footprint），真修法是 occupancy prepass。
- **AA（接缝 ④）**：上面那张表就是它的立项书。
- 仍缺的 11 个 plan 对象里，`zhengmen.forecourt-terrace`（台矶）与
  `zhengmen.flanking-wall`（粉墙）要靠**给 plan 补 layout 折线**来解，不是靠再写
  一条 `placements`——补了折线，规则 3 自动接管，六段野生粉墙和它们那四处
  0.16~0.22 m 的互插一起消失。
