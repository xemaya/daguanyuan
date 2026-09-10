# P1 底层补齐 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让推导器真正读知识库（而不是读手抄进代码的表），接上 `qing` 与 `fayuan` 两套参数集，把地形改成由 `plan.json` 驱动，并让世界撑得住 500 米见方。

**Architecture:** 三条互不依赖的链并行。规则链（加载器 → 状态机 → provenance → 两套参数集）是脊柱，它落地的那一刻知识库才开始工作。地形链（生成器 → 切换坐标系 → 分块与分簇）负责规模。构件本体链只产数据，独立。

**Tech Stack:** TypeScript 5.9 · three r185 · Vite 7 · Node test runner（`--experimental-strip-types`）· Playwright

**Spec:** `docs/superpowers/specs/2026-09-10-layered-architecture-design.md`（尤其 §3 数据契约、§5 规则状态机）

## Global Constraints

- 单位米；构件原点在地面中心，`+Z` 朝正面。
- 禁用 `Math.random()`，随机走 `@engine/core/Noise` 的种子生成器。
- **`builder/derive/` 不许 import `three`**。它只产数。分层门查这条。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器。** `tsc` 认，`npm test` 的 strip-only 模式不认，而且不报编译错——整个模块直接挂。见 PITFALLS P-15。
- **规则号只在规则集内唯一**（273 个里 115 个跨文件重号）。开工先跑一次 `book.collisions()`，撞了的写限定形式 `use('fayuan:06-01')`。见 PITFALLS P-16。
- `engine/` 不许 import `builder/` `knowledge/` `projects/`；`builder/` 不许 import `projects/`。
- 跨层走别名 `@engine/ @builder/ @knowledge/ @project/`，不写 `../..`。
- 大木作的数字只从规则表出，不许在代码里写字面量。
- **每处抽象过一问：能不能让下一个区域更快、更准、更美？** 不能就先不做（`docs/DECISIONS.md` D-18）。
- 收工前 `npm run check`、`npm test`、`npm run check:layers`、`npm run check:rules` 全过。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

## 三条链

```
链 A（规则）  Task 1 加载器+状态机+provenance ─┬→ Task 2 qing 参数集
                                              └→ Task 3 fayuan 参数集
链 B（地形）  Task 5 生成器读 plan.json → Task 6 世界切到 plan 坐标系 → Task 7 分块与分簇
链 C（本体）  Task 4 构件级本体数据层
```

**Task 1、4、5 可立即同时派。** Task 2、3 等 Task 1；Task 6 等 Task 5；Task 7 等 Task 6。

链 A 与链 B 都改 `builder/`，但文件不重叠：链 A 只碰 `builder/derive/`，链 B 只碰 `builder/compose/` 与 `engine/`。Task 6 会碰 `builder/compose/composer.ts`，那时链 A 已经不动它了。

## 本期不做（按 D-18 记账）

- **区域流式装载卸载**。要等 P4 真有好几个区域建起来才有意义，现在做是为通用性而通用性。
- **imposter 远景**。分簇剔除落地后先量一遍帧时，不够再说。
- **约束求解器**。`underdetermined` 的解析用 `seeded_variant` 就够（D-16）。
- **真斗拱分件几何**。Task 4 只做数据层，几何在 P3。

---

## 链 A · Task 1: 规则加载器、状态机、provenance ✅ 已完成

**交付于** 2026-09-10，commit `3dd33f54`。Task 2 与 Task 3 照着下面的**实际接口**写，不要照计划最初的草稿——写实现时暴露了三处设计错误，都已更正。

**已落地的文件**：`builder/derive/{rules,errors,provenance,profiles}.ts`；`fashi/{cai,puzuo,zhu,juzhe,yanchu}.ts` 与 `index.ts` 全部改成从 `RuleBook` 取数；`tests/rules.test.mjs`（13 条）与 `tests/fashi.test.mjs`（19 条，含突变测试）。

**验收结果**：42/42 测试通过 · 四门全过 · 14 镜结构逐项一致 · 键盘试玩 PASS · `grep` 手抄数字无输出。

### 实际接口（Task 2/3 的依赖契约）

```typescript
// builder/derive/rules.ts
type RuleStatus = 'ok' | 'contested' | 'refuted' | 'underdetermined' | 'missing';
type ParamSet   = 'fashi' | 'qing' | 'fayuan';
type RuleSet    = 'fashi' | 'qing' | 'fayuan' | 'missing';   // = 来源文件

interface RuleBookOptions {
  choices?:   Record<string, string>;   // 多口径规则选哪一档
  overrides?: Record<string, unknown>;  // 给 missing 规则显式值,记进 art
}

class RuleBook {
  static create(paramSet: ParamSet, opts?: RuleBookOptions): RuleBook;
  static fromRules(rules: Rule[], paramSet: ParamSet, opts?: RuleBookOptions): RuleBook;
  static allRules(): readonly Rule[];          // 突变测试取原始表

  use(id: string): Rule;                       // 执法处:判状态、记出处,或抛
  table<T>(id: string): T[];                   // 取 table 字段
  num(id: string, key: string): number;        // 取 params.<key>,取不到就抛
  nums(id: string, key: string): number[];     // 同上,值是数组
  param(id: string, key: string): unknown;
  choice<T>(id: string): T;                    // 取选中口径的值

  pickInRange(id, key, at: 'lo'|'mid'|'hi'): number;   // 区间取点,自动记进 art
  artChoice<T>(id: string, note: string, value: T): T; // 显式登记一次艺术决策

  provenance(): Provenance;                    // { evidence, inference, art }
  collisions(): Record<string, string[]>;      // 本参数集里的重号
  raw(id: string): Rule | undefined;           // 不判状态、不记出处
  ids(): string[];
}
```

```typescript
// builder/derive/profiles.ts
type Era = 'song' | 'tang' | 'liao';
function eraOptions(era: Era, extra?: RuleBookOptions): RuleBookOptions;
```

```typescript
// builder/derive/index.ts
function deriveBuilding(spec: BuildingSpec): Frame;                        // 内部按 spec.era 建 book
function deriveWithBook(book: RuleBook, spec: BuildingSpec, era?: Era): Frame;
// Frame 多了一个字段:provenance: { evidence[], inference[], art[] }
// BuildingSpec 多了:era?: Era · rules?: RuleBookOptions · raiseRatio?: number
```

### 三处更正——Task 2/3 必须知道

**① 要不要选口径，由 `choices` 在不在决定，不由状态决定。**

计划最初把口径选择放在 `case 'contested'` 里，是错的。`04-03` 殿阁举高状态是 `ok`——条文本身没问题——但法式 L/3、唐构实测、辽构 L/4 三档并存，差 32%。状态说的是"这条读得对不对"，口径说的是"这栋屋按谁的读法造"，两个正交的轴。

现在 `use()` 的顺序是：**驳倒 → 口径 → 状态**。一条 `ok` 带 `choices` 的规则不选就抛，选了记进 `inference`（选口径永远是推定，哪怕规则本身通过）。

`qing` 与 `fayuan` 里带 `choices` 的规则，都按这条处理，别再看状态。

**② 规则号只在规则集内唯一，重号必须限定。**

273 个 id 里 **115 个跨文件重号**。其中两个真撞在 `fashi` 参数集里：

| | id | 状态 | 名 | paramSet |
|---|---|---|---|---|
| fashi | 06-01 | ok | 界深与提栈起算 | fashi |
| fayuan | 06-01 | **refuted** | 清式屋顶形制等级序列 | **both** |

后加载的静默覆盖先加载的，于是 `use('06-01')` 把一条**通过**的规则判成**驳倒**——错误信息说得头头是道，只是说错了规则。

加载器现在给每条规则打 `set` 标；同一 id 在同一参数集里来自多个集时不覆盖，记成歧义，`use()` 抛错并列出限定形式。**要用就写 `use('fayuan:06-01')`。** `book.collisions()` 列出本参数集全部重号。

> **Task 2、Task 3 开工第一件事**：把 `console.log(RuleBook.create('qing').collisions())` 和 `'fayuan'` 那份跑一遍，看清自己这套参数集里哪些号是撞的。撞了的一律写限定形式。

**③ 时代口径做成预设（`profiles.ts`）。**

`fashi` 一套就有 8 条多口径规则，每栋屋逐条选一遍太吵，而它们本是同一个决定的不同面。预设把"时代"翻译成一张口径表。

**预设里只有口径的名字，没有营造数字。** 数值仍只在规则表里，选中哪档也逐条记进 `provenance.inference`。`qing` 与 `fayuan` 如果也需要（例如官式 vs 苏式的分档），照这个形状加，别在代码里写数。

### 另加一条环境坑

**Node 的 strip-only 模式不支持 TypeScript 参数属性。** `constructor(readonly ruleId: string)` 这种写法 `tsc --noEmit` 完全不报，但 `npm test` 会整个模块挂掉，报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。字段显式声明 + 构造函数里赋值。`enum`、`namespace`、装饰器同理。见 `docs/PITFALLS.md` P-15。

**推论**：`npm run check` 过了不等于 `npm test` 跑得起来。新建模块后先跑一次测试，别攒到最后。

### 知识库这一步补了什么

17 条规则补了 `params` / `choices`，**数全部从各条自己的 `formula`、`statement`、`correction` 原文里抬出来结构化，一个都没新造**。唯一的数值改动是 `04-03` 法式档由 `0.3333` 补足成 1/3 的双精度展开（条文是 `L/3`，原表存的是四舍五入，把 20 尺算成 19.998）。

`qing` 与 `fayuan` 大概率也要补 `params`——很多条的数只写在 `formula` 字符串里。`book.num()` 取不到会抛，错误信息带上 `formula` 原文告诉你该结构化哪个数。**补进规则表，不要写回代码。**

### 一处几何变化（已接受）

四个预设的骨架表逐字段比对，只有一处变了：**廊（两间）的生出 15.6cm → 12.5cm**。`05-08` 只给 1/3/5 间三档，两间不在表上；旧代码向上取三间档（5 寸），新代码按台阶函数向下取一间档（4 寸）。两个读法都不在书里，取后者。

---

## 链 A · Task 2: `qing` 参数集（斗口制）

**Files:**
- Create: `builder/derive/qing/doukou.ts`、`jujia.ts`、`chuyan.ts`、`dougong.ts`、`index.ts`
- Modify: `builder/derive/index.ts`（按 `paramSet` 分派）
- Test: `tests/qing.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `RuleBook`（接口见上一节，**照那份写，不要照本节最初的草稿**）、`Provenance`；规则来自 `paramSet: 'qing' | 'both'`（注意有 9 条在 `fayuan.rules.json` 文件里，**按字段取不按文件取**）。
- Produces: `deriveQing(book, spec): Frame` — 与 `fashi` 同一个 `Frame` 契约（含 `provenance` 字段），字段对照见 `knowledge/docs/qingshi/qingshi.schema.json` 的 `mapping` 段 24 条概念。

- [ ] **Step 0: 先看清自己这套参数集里哪些规则号是撞的**

```bash
node --experimental-strip-types --import ./tests/ts-resolver.mjs -e "
import('@builder/derive/rules.ts').then(({RuleBook}) => {
  console.log('重号:', RuleBook.create('qing').collisions());
});"
```

撞了的一律写限定形式 `use('qing:01-05')`，不写会抛 `AmbiguousRuleError`。理由见上一节更正②。

- [ ] **Step 1: 先读，再动手**

必读：`knowledge/docs/qingshi/README.md` 的跨章结论、`01-doukou.md`、`02-jujia.md`、`03-chuyan.md`、`04-dougong.md`、`tiers.md` 的 Tier A 那一节与**禁用 id 白名单**。另外 `docs/PITFALLS.md` 的 P-14、P-15、P-16 三条是这条链上刚踩过的。

三件要记住的事：

1. **斗口不由查表定，要由柱高反算**——而这条反函数**书里没有**（`missing.rules.json` 的 `99-02`，六个口径互差 8%~21%，选哪个决定斗口差一等以上）。所以 Tier A 的建筑现在会抛 `MissingRuleError`。**这是设计意图，不要为了让它跑起来编一个除数。** `99-02` 的 `statement` 已经写明该补什么：clamp 区间（檐柱净高 52~88 斗口，长春宫 0.66×明间）加 ±10% 容差，并用 `08-13` 慈宁宫、`08-15` 智化寺两个锚点校核。补齐是 P3 的事，P1 只要它诚实地抛。
2. `tiers.md` 的禁用白名单（01-05 攒数推面阔、02-02 步架定尺、04-06、04-07、04-11 等）里的规则**引用即抛**，因为它们在规则表里是 `refuted`。碰到就说明推导路径选错了，换一条。
3. 举架系数在 `02-jujia.md` 里可用，但**步架长不可用**（02-02 被驳倒，均分法实测偏差 −33% 到 +34%）。步架长要走 `choices` 或由调用方给。

- [ ] **Step 2: 写失败测试**

```javascript
// tests/qing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleBook } from '@builder/derive/rules.ts';
import { MissingRuleError, RefutedRuleError } from '@builder/derive/errors.ts';
import { deriveQing } from '@builder/derive/qing/index.ts';

const within = (a, e, pct, label) => {
  const err = Math.abs(a - e) / e;
  assert.ok(err <= pct, `${label}: ${a.toFixed(2)} vs ${e} (${(err * 100).toFixed(1)}% > ${pct * 100}%)`);
};

test('斗口十一等表：一等 6.0 寸，逐等减 0.5 [qing 01-01]', () => {
  const book = RuleBook.create('qing');
  // 若 collisions() 里有 01-01，就写 book.table('qing:01-01')。
  const t = book.table('01-01');
  assert.equal(t[0].doukouCun, 6.0);
  assert.equal(t[1].doukouCun, 5.5);
  assert.equal(t.length, 11);
});

test('由柱高反算斗口是缺失规则，必须抛错并说明该查哪本书 [missing 99-02]', () => {
  const book = RuleBook.create('qing');
  assert.throws(
    () => deriveQing(book, { tier: 'A', columnHeightM: 3.67, bays: 5, rafters: 6, roofType: '歇山' }),
    (e) => {
      assert.ok(e instanceof MissingRuleError, `应抛 MissingRuleError，实际 ${e.name}`);
      assert.match(e.message, /斗口|反算/);
      return true;
    },
  );
});

test('显式给了斗口就能推下去：长春宫，斗口 70mm', () => {
  // 带 choices 的规则不选就抛,**跟状态无关**——ok 的规则一样要选(更正①)。
  // 这套参数集的口径如果不止一两条，照 profiles.ts 的形状加一份预设，别逐条塞。
  const book = RuleBook.create('qing', { choices: { /* 逐条按 collisions/choices 实况填 */ } });
  const fr = deriveQing(book, {
    tier: 'A', doukouMm: 70, bays: 5, rafters: 6, roofType: '歇山',
    bayWidthsM: [6.34, 4.60, 3.60], puzuo: { cai: 7 },
  });
  // 故宫院刊精测:檐柱净高 3.67 m。规则档 56.8 斗口 → 3.976 m,偏 +8.3%,在 10% 内。
  within(fr.m.columnH, 3.67, 0.10, '檐柱净高');
});

test('被 tiers.md 禁用的规则引用即抛 [qing 01-05 攒数推面阔]', () => {
  const book = RuleBook.create('qing');
  assert.throws(() => book.use('01-05'), RefutedRuleError);
});

test('举架逐步累加，坡度自下而上变陡（与宋式举折自上而下相反）', () => {
  const book = RuleBook.create('qing');
  const fr = deriveQing(book, {
    tier: 'A', doukouMm: 70, bays: 5, rafters: 6, roofType: '歇山',
    bayWidthsM: [6.34, 4.60, 3.60], puzuo: { cai: 7 },
    stepsM: [1.20, 1.10, 1.10],
  });
  const s = fr.m.purlins;
  for (let i = 1; i < s.length - 1; i++) {
    const k0 = (s[i - 1].y - s[i].y) / (s[i].x - s[i - 1].x);
    const k1 = (s[i].y - s[i + 1].y) / (s[i + 1].x - s[i].x);
    assert.ok(k0 > k1, `第 ${i} 架应比外一架陡：${k0.toFixed(3)} vs ${k1.toFixed(3)}`);
  }
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test 2>&1 | grep -A3 qing`
Expected: FAIL，找不到 `@builder/derive/qing/index.ts`。

- [ ] **Step 4: 实现四个模块**

每个函数首参 `book: RuleBook`，所有数字 `book.use(id)` 取，**不写字面量**。

- `doukou.ts`：斗口十一等表 [01-01]、攒当 11 斗口 [01-04]、拽架与踩高 [01-07]、柱径 6 斗口。柱高由调用方给或 `overrides['99-01']`。
- `jujia.ts`：举架系数按建筑等级与步数配 [02-*]，自下而上逐步累加出檩坐标。**步架长必须由调用方给**（02-02 驳倒）。
- `chuyan.ts`：上檐出按檐柱高 3/10 加拽架 [03-*]，飞椽出按比例，冲三翘四。
- `dougong.ts`：踩数与拽架 [04-*]，斗拱高每踩 2 斗口，平身科攒数由攒当算。
- `index.ts`：`deriveQing(book, spec): Frame`，组装成与 `fashi` 相同的 `Frame` 契约。

- [ ] **Step 5: 跑测试与门**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)"
npm run check && npm run check:layers
```

Expected: 5 条新测试通过；分层门过（`qing/` 同样不许 import three）。

- [ ] **Step 6: 提交**

```bash
git add builder/derive/qing tests/qing.test.mjs builder/derive/index.ts
git commit -m "feat(derive): qing 参数集——斗口制推导链

Tier A 的建筑现在会抛 MissingRuleError:由柱高反算斗口这条反函数书里没有,
六个口径互差 8%~21%。这是设计意图不是 bug——要跑先显式给斗口或 override,
会记进 provenance.art 留痕。"
```

---

## 链 A · Task 3: `fayuan` 参数集（界与提栈）

**Files:**
- Create: `builder/derive/fayuan/jie.ts`、`tizhan.ts`、`qiangjiao.ts`、`index.ts`
- Modify: `builder/derive/index.ts`（分派）
- Test: `tests/fayuan.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `RuleBook`（接口见 Task 1 一节，**照那份写**）；规则 `paramSet: 'fayuan' | 'both'`。
- Produces: `deriveFayuan(book, spec): Frame`，同一契约（含 `provenance`）。

- [ ] **Step 0: 先看清重号——这套是重灾区**

```bash
node --experimental-strip-types --import ./tests/ts-resolver.mjs -e "
import('@builder/derive/rules.ts').then(({RuleBook}) => {
  console.log('重号:', RuleBook.create('fayuan').collisions());
});"
```

已知 `fayuan` 的 `06-01`（清式屋顶形制等级序列，**已驳倒**）与 `fashi` 的 `06-01`（界深与提栈起算，**通过**）同号，且前者 `paramSet: both`。`06-07` 同理。撞了的一律写 `use('fayuan:06-01')`——不限定的话你会拿到另一条规则，而错误信息说得头头是道。理由见 Task 1 一节的更正②。

- [ ] **Step 1: 先读**

必读：`knowledge/docs/qingshi/05-fayuan.md`（27 条，篇幅最长）、`06-wuding.md` 里 `paramSet: fayuan` 的那几条、`tiers.md` 的 Tier B 与 Tier C、`verify-suzhou.md` 的 A 部分（月到风来亭手算）。另外 `docs/PITFALLS.md` 的 P-14、P-15、P-16。

三件要记住的事：

1. **05-06「个」的读法被两人共同驳倒**，照抄会把屋面抬高一倍。规则表里它是 `refuted`，引用即抛。正确读法在 `correction`：个等于级数，总递加等于个数减一。
2. **提栈逐界插值法是空的**（`missing` 的 `99-08`）。`05-09` 只有四行算例（界深 3.5/4/4.5/5 尺），界深落在 3.7 或 4.2 这类值上要么插值要么报错。**插值方式必须显式声明**，不能默默线性插。
3. **连机、夹堂、枋子那一段高度书里没比例**，是檐口高程闭合差的主要来源。它在 `missing` 的 `99-04`（江南多边形亭几何补充条）里，同条还带着转角斜长与宝顶高。抛错时该说的是「查刘敦桢《苏州古典园林》图版与《营造法原》第十三章」——这些字 `whereToLook` 里已经有了，别自己另编一套。

- [ ] **Step 2: 写失败测试**

```javascript
// tests/fayuan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleBook } from '@builder/derive/rules.ts';
import { RefutedRuleError } from '@builder/derive/errors.ts';
import { deriveFayuan } from '@builder/derive/fayuan/index.ts';

const within = (a, e, pct, label) => {
  const err = Math.abs(a - e) / e;
  assert.ok(err <= pct, `${label}: ${a.toFixed(3)} vs ${e} (${(err * 100).toFixed(1)}% > ${pct * 100}%)`);
};

test('05-06 递加「个」的读法已被驳倒，引用即抛，错误里带正确读法', () => {
  const book = RuleBook.create('fayuan');
  // 若 collisions() 里有 05-06，写 book.use('fayuan:05-06')。
  assert.throws(() => book.use('fayuan:05-06'), (e) => {
    assert.ok(e instanceof RefutedRuleError);
    assert.match(e.message, /个\s*=\s*级数|个 = 级数/);
    return true;
  });
});

test('网师园月到风来亭：界深对边距 [fayuan 05-*]，误差 10% 内', () => {
  // choices 逐条按规则表实况填:带 choices 的都要选,跟状态无关(更正①)。
  const book = RuleBook.create('fayuan', { choices: { /* 按实况填 */ } });
  const fr = deriveFayuan(book, {
    tier: 'C', shape: 'hexagon', sideM: 2.10, columnHeightM: 3.00, jieCount: 4, chiCm: 27.5,
  });
  // verify-suzhou.md A:对边距实测 −1.0%、界深 vs「亭界深约三尺」+5.0%
  within(fr.m.width, 3.64, 0.10, '对边距');
});

test('提栈逐界递加：脊界最陡，檐界最缓', () => {
  const book = RuleBook.create('fayuan', { choices: { /* 按实况填 */ } });
  const fr = deriveFayuan(book, {
    tier: 'B', bayWidthsM: [3.2, 3.8, 3.2], jieDepthChi: 4.0, jieCount: 6,
    columnHeightM: 3.04, chiCm: 27.5,
  });
  const p = fr.m.purlins;
  const slope = (i) => (p[i - 1].y - p[i].y) / (p[i].x - p[i - 1].x);
  for (let i = 2; i < p.length; i++) {
    assert.ok(slope(i - 1) > slope(i), `第 ${i} 界应比外一界缓`);
  }
});

test('界深落在算例表之外时，插值方式必须显式声明，否则抛', () => {
  const book = RuleBook.create('fayuan', { choices: { /* 按实况填 */ } });
  assert.throws(
    () => deriveFayuan(book, {
      tier: 'B', bayWidthsM: [3.2, 3.8, 3.2], jieDepthChi: 4.2, jieCount: 6,
      columnHeightM: 3.04, chiCm: 27.5,
    }),
    /插值|interpolat/i,
  );
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test 2>&1 | grep -A3 fayuan`

- [ ] **Step 4: 实现三个模块**

- `jie.ts`：界深与柱高、明间面阔的比例；檐高 0.8 乘明间并按 08-09 clamp。
- `tizhan.ts`：提栈算数按界查 `05-09` 的算例表；**表外的界深必须由 spec 显式给 `interpolate: 'linear' | 'nearest'`，不给就抛**。
- `qiangjiao.ts`：戗角，嫩戗发戗与水戗发戗，泼水角，起翘。
- `index.ts`：`deriveFayuan(book, spec): Frame`。

- [ ] **Step 5: 门与提交**

```bash
npm test && npm run check && npm run check:layers
git add builder/derive/fayuan tests/fayuan.test.mjs builder/derive/index.ts
git commit -m "feat(derive): fayuan 参数集——界与提栈

05-06「个」的读法引用即抛(照抄会把屋面抬高一倍)。
提栈表外的界深必须显式声明插值方式,不许默默线性插——
书里只有四行算例,插值是我们加的,得留痕。"
```

---

## 链 C · Task 4: 构件级本体（数据层）

只做数据，不做几何。几何在 P3。

**Files:**
- Create: `knowledge/rules/components.rules.json`
- Modify: `knowledge/rules/schema.json`、`tools/check-rules.mjs`、`knowledge/rules/README.md`

**Interfaces:**
- Produces: 构件本体表。P3 的 `builder/parts/damu/dougong.ts` 消费它出真分件几何。
- Consumes: `knowledge/docs/qingshi/04-dougong.md`、`knowledge/docs/fashi/02-puzuo.md`

- [ ] **Step 1: 先读设计约束**

`docs/ROADMAP.md` 的「P1 增补：构件级本体」一节，尤其这一条：

> **本体只存"是什么、怎么装"，绝不存几何。** 不许出现顶点、网格、贴图路径这类字段——
> 一旦存了，这套东西就从可执行的语法退化成一个巨大的古建资产库。

以及 `docs/kg-paper-borrowing.md` §4：同题论文的 3505 个构件实体**只能当候选清单，不能取尺寸**。

- [ ] **Step 2: 定字段并写进 schema**

`knowledge/rules/schema.json` 加一个 `components` 定义：

```json
{
  "id": "C-dg-01",
  "name": "五踩单翘单昂平身科",
  "category": "斗拱",
  "status": "ok",
  "paramSet": "qing",
  "parts": [
    { "ref": "C-dg-lu", "name": "栌斗", "count": 1 },
    { "ref": "C-dg-qiao", "name": "翘", "count": 1 },
    { "ref": "C-dg-ang", "name": "昂", "count": 1 },
    { "ref": "C-dg-shua", "name": "耍头", "count": 1 },
    { "ref": "C-dg-cheng", "name": "撑头木", "count": 1 }
  ],
  "attachTo": { "parent": "阑额上普拍枋", "position": "柱头之间按攒当均布" },
  "geometry": { "family": "斗", "shapeParams": ["长", "宽", "高", "耳", "平", "欹"] },
  "dimensions": ["01-07", "04-03"],
  "source": { "book": "工程做法则例", "location": "卷一", "quote": "…" },
  "urls": []
}
```

字段含义：

- `parts`：下级分件的 id 与数量。**只写组成，不写坐标。**
- `attachTo`：装在哪个父件的什么位置，用词描述不用数。
- `geometry.family`：形状族（斗/栱/昂/枋/替木/椽），`shapeParams` 只列参数**名**。
- `dimensions`：给尺寸的规则 id 列表，**不在这里重复数值**。悬空的 id 门会报。

- [ ] **Step 3: 只做斗拱一类，跑通链路**

清式五踩、七踩两种平身科，加它们的分件（栌斗、翘、昂、耍头、撑头木、各式升斗、正心枋、拽枋）。**先不碰梁架和小木**——证明"本体加规则出真分件"成立再铺开。

宋式 `02-puzuo.md` 的铺作同样加两种（五铺作、六铺作），`paramSet: 'fashi'`。

- [ ] **Step 4: 把新集合登记进门，并加两条专用校验**

`tools/check-rules.mjs` 的 `SETS` 加：

```js
'components.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^$/ },
```

（跨章汇编，不做条目对齐。）再加两条只对本体生效的检查：

```js
// 构件本体专用:parts 的 ref 必须存在,dimensions 的 id 必须能在规则表里找到,
// 且绝不许出现几何数据——存了几何,这套东西就退化成资产库了(ROADMAP P1 增补)。
const FORBIDDEN_GEOM = ['vertices', 'mesh', 'positions', 'indices', 'texture', 'obj', 'gltf'];
```

- [ ] **Step 5: 跑门**

```bash
npm run check:rules
```

Expected: 七行全零，新增的 `components.rules.json` 一行 `缺 0 / 多 0 / 悬空 ref 0 / 悬空 dimensions 0 / 含几何字段 0`。

- [ ] **Step 6: 提交**

```bash
git add knowledge/rules tools/check-rules.mjs
git commit -m "feat(knowledge): 构件级本体数据层——先做斗拱一类跑通

本体只存「由什么组成、怎么装」,尺寸引规则表 id 不重复数值,绝不存几何。
门加三条专用校验:parts 的 ref 不悬空、dimensions 的 id 在规则表里存在、
不许出现顶点网格贴图这类字段——存了就从可执行语法退化成古建资产库。"
```

---

## 链 B · Task 5: 地形生成器读 `plan.json`

纯函数，先不接进游戏。

**Files:**
- Create: `builder/compose/terrain-from-plan.ts`
- Test: `tests/terrain-plan.test.mjs`

**Interfaces:**
- Produces: `makeTerrainField(plan, opts): { height(x,z): number; surface(x,z): string; masks(x,z): SurfaceMasks }`
  - `opts: { seed: number; bounds?: { minX, maxX, minZ, maxZ } }`
- Consumes: `@project/plan.json` 的 `wall` `water` `hills` `paths` `regions`

- [ ] **Step 1: 写失败测试**

```javascript
// tests/terrain-plan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTerrainField } from '@builder/compose/terrain-from-plan.ts';

const plan = JSON.parse(readFileSync('projects/daguanyuan/plan.json', 'utf8'));
const field = makeTerrainField(plan, { seed: 17910000 });

const centroid = (poly) => {
  let x = 0, z = 0;
  const n = poly.length - 1;
  for (let i = 0; i < n; i++) { x += poly[i][0]; z += poly[i][1]; }
  return [x / n, z / n];
};

test('水体多边形内部低于水面，外部高于水面', () => {
  for (const w of plan.water) {
    const [cx, cz] = centroid(w.polygon);
    assert.ok(field.height(cx, cz) < 0, `${w.name} 中心应在水下，实际 ${field.height(cx, cz).toFixed(2)}`);
  }
});

test('堆山中心高于其标称高程的一半', () => {
  for (const h of plan.hills) {
    const [cx, cz] = centroid(h.polygon);
    assert.ok(field.height(cx, cz) > h.height_m * 0.5,
      `${h.name} 中心应接近 ${h.height_m}m，实际 ${field.height(cx, cz).toFixed(2)}`);
  }
});

test('园路沿线平缓：相邻采样点高差不超过 12%', () => {
  for (const p of plan.paths) {
    for (let i = 1; i < p.points.length; i++) {
      const [ax, az] = p.points[i - 1];
      const [bx, bz] = p.points[i];
      const d = Math.hypot(bx - ax, bz - az);
      if (d < 1) continue;
      const grade = Math.abs(field.height(bx, bz) - field.height(ax, az)) / d;
      assert.ok(grade < 0.12, `${p.name} 第 ${i} 段坡度 ${(grade * 100).toFixed(1)}%`);
    }
  }
});

test('区域台基处平坦：区域中心 3 米见方内高差小于 8 厘米', () => {
  for (const r of plan.regions) {
    if (!r.buildings?.length) continue;
    const [cx, cz] = centroid(r.polygon);
    const hs = [[0,0],[3,0],[0,3],[3,3],[-3,0],[0,-3]].map(([dx,dz]) => field.height(cx+dx, cz+dz));
    assert.ok(Math.max(...hs) - Math.min(...hs) < 0.08, `${r.id} 台基不平：${(Math.max(...hs)-Math.min(...hs)).toFixed(3)}m`);
  }
});

test('确定性：同一 seed 两次采样完全一致', () => {
  const a = makeTerrainField(plan, { seed: 42 });
  const b = makeTerrainField(plan, { seed: 42 });
  for (const [x, z] of [[0,0],[100,-80],[-200,150]]) {
    assert.equal(a.height(x, z), b.height(x, z));
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现生成器**

沿用现有 `builder/compose/terrain.ts` 里已验证的手法（解析场、`rrMask` 圆角矩形遮罩、双 warp 让边界不规则、路径 `polyDist` 影响），但**输入全部来自 `plan.json`，代码里不写任何坐标**：

- 外墙 `wall` → 墙外抬成林岗，天际线用噪声起伏
- `water[].polygon` → 挖到 `depth_m`，岸坡先缓后陡
- `hills[].polygon` → 抬到 `height_m`
- `paths[].points` → 压平成路，两侧渐变
- `regions[].buildings` → 各自一块死平的台基，`elevation_m` 定高

删掉旧 `terrain.ts` 里所有硬编码的 `POND` `MOUND` `PADS` `MAIN_PATH` `BRANCH_*`。

- [ ] **Step 4: 跑测试与门**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)"
npm run check && npm run check:layers
```

Expected: 5 条新测试通过。**若"区域台基处平坦"红了**，多半是 plan.json 里那 4 个越界的建筑锚点（P2 已知缺陷），把那几个 region 跳过并在测试里注明。

- [ ] **Step 5: 提交**

```bash
git add builder/compose/terrain-from-plan.ts tests/terrain-plan.test.mjs
git commit -m "feat(compose): 地形生成器改由 plan.json 驱动

代码里不再有任何园子坐标。水挖到 depth_m、山抬到 height_m、路压平、台基死平,
全部从平面真源读。五条断言:水在水下、山够高、路够缓、台基够平、同种子确定。"
```

---

## 链 B · Task 6: 世界切到 `plan.json` 坐标系

**这一步会改变你看到的园子。** 现在的世界是 64×72 米、手摆的；`plan.json` 是 500×500 米、19 个区。两套坐标系互不相干，要接上。

> **2026-09-10 更正 ④——锚点用 plan 的 `buildings[].x/z`，不是「质心 + 局部偏移」。**
> 本节最初写的是「SCENE 每项加 `region`，坐标改成相对该区质心的偏移」。写单子 E 时实测 `plan.json`，
> 发现每个区的 `buildings[]` 与 `rocks[]` **已经带绝对 `x` / `z` 锚点**（正门 (55,236)、沁芳亭 (0,148)、
> 石桥三港 (0,152)、潇湘馆正房 (-105,98)、游廊 (-126,104)、月洞门 (-105,120)、翠嶂白石群 (8,202)）。
> 质心是我们算出来的派生量，锚点是平面真源写下的，**派生量不能盖过真源**。
> 而且质心兜底这条路本身就被驳过：`missing` 的 `99-24` 说的正是「区域中心即台基位置」这个默认不成立，
> 修法写的就是"给这三个区显式标出台基锚点"——潇湘馆的锚点已经在那儿了。
> 所以：**plan 点了名的构件按锚点摆；plan 没点名的（墙段、竹丛、驳石）才用「区域 + 局部偏移」兜底。**
> 后者的格式仍然是给 P4 `scenes/<region>.json` 铺路的那一套，不变。

**Files:**
- Modify: `builder/compose/terrain.ts`（改为调用 Task 5 的生成器）、`builder/compose/composer.ts`（SCENE 改成锚点驱动）、`builder/parts/zhiwu/vegetation.ts`（散布盒与建筑禁区全是旧坐标）、`projects/daguanyuan/main.ts`（出生点）、`tools/playtest.mjs`（航点）、`tools/capture.mjs`（镜头）
- Test: 试玩与截图

**Interfaces:**
- Consumes: Task 5 的 `makeTerrainField(plan: GardenPlan, opts: TerrainFieldOptions): TerrainField`
- Produces: 世界坐标 = `plan.json` 坐标（米，原点园心，x 东 z 南）

- [ ] **Step 0: 先认清三件实测事实**

开工前这三条都已经量过了，数字在这儿，不要重新发明，也不要以为能绕开。

**① `bounds` 不裁剪任何东西。** `TerrainFieldOptions.bounds` 在 Task 5 的源码注释里写得很清楚：
「场本身是全局解析式，bounds 不改变任何函数值；它留给 Task 6/7 的网格与分块代码声明『只采这一片』。」
也就是说**开窗口这件事得由 `terrain.ts` 的网格生成代码执行**，传个 `bounds` 进去不会有任何效果。

**② 三角数与构建时间会炸。** 现在的地形是 64×72 m / 36 cm 格 = 176×198 格 ≈ 7 万三角。
MVP 四区（`zhengmen`/`cuizhang`/`qinfang_ting_qiao`/`xiaoxiangguan`）的包围盒是 **240×186 m**，
外扩 40 m 是 **320×266 m**。同样 36 cm 格 = 889×739 格 ≈ **130 万三角，19 倍**，
而且地形是 VSM 阴影接收体，一帧要在阴影 pass、主 pass、透射 pass、G-buffer 里各画一遍。
`makeTerrainField` 的每次求值都要走一遍多边形与 fbm，65 万个顶点会让世界构建从 20 秒变成几分钟（PITFALLS P-12 的下游）。

预算：**地形三角数 ≤ 60 万，世界构建 ≤ 30 秒。** 两个旋钮，先动第一个：
格边（36 cm → 50 cm 就降到 60 万）与窗口（外扩 40 m → 20 m）。**不要在这一步做分块，那是 Task 7。**

**③ 游线上有一段 68.6 米的水面，现有的桥总长只有约 25 米。**
沿 `plan.paths` 的「十七回游线」前 14 点（正门 → 潇湘馆，全长 **310.6 m**，最陡 8.2%，坡度没问题），
里程 156.5 m 到 225.1 m 是水下，从 (-3,171) 到 (-40,128)，**连续 68.6 m**。
现在 SCENE 里是两段 9.4 m 的曲桥夹一座亭，加起来约 25 m。**这个缺口是这个任务最可能翻车的地方。**

允许的两条修法：**(a)** 在 SCENE 里加曲桥段（`bridge:zigzag` 是现成构件，不需要新几何）；
**(b)** 改游线的走法——沿池岸绕到窄处再过。
**不许改 `plan.json`** 去把池子改小或把路挪开。选哪条、为什么，写进提交信息。

- [ ] **Step 1: SCENE 改成锚点驱动**

`Placement` 加两个字段，二选一：

```typescript
interface Placement {
  part: string;
  variant?: string;
  /** plan.json 的区域 id。给了 anchor 或 x/z 是局部偏移时必填。 */
  region?: string;
  /** plan.json 里该区 buildings[].name 或 rocks[].name 的前缀,按它的 x/z 落位。 */
  anchor?: string;
  /** 有 region 无 anchor 时,x/z 是相对该区质心的局部偏移;都没有时是世界坐标。 */
  x: number;
  z: number;
  yaw?: number;
  dy?: number;
  y?: number;
  pier?: boolean;
  tag?: string;
}
```

解析顺序：`anchor` → 该建筑/石头的 `x`/`z` 再加上 `x`/`z` 当微调；只有 `region` → 质心加偏移；都没有 → 世界坐标。
`anchor` 找不到匹配的名字**要抛**，不要静默退回质心——静默退回正是 P-16 那类"错得头头是道"的失败。

五处已有构件的落点（实测高程一并给出，`seed: 20260910`）：

| 构件 | region | anchor | 世界 (x,z) | 地面高 |
|---|---|---|---|---|
| 正门（五间） | `zhengmen` | 正门 | (55, 236) | 0.80 |
| 翠嶂 | `cuizhang` | 白石峻嶒群 | (8, 202) | 11.71 |
| 沁芳亭 | `qinfang_ting_qiao` | 沁芳亭 | (0, 148) | **−1.34（水下）** |
| 沁芳桥 | `qinfang_ting_qiao` | 石桥三港 | (0, 152) | **−1.34（水下）** |
| 潇湘馆正房 | `xiaoxiangguan` | 正房 | (−105, 98) | 0.96 |

亭与桥在水下**是对的**——原文「此亭壓水而成」、「石橋三港，獸面銜吐」。它们要靠 `pier: true` 与显式 `y` 立在水面上，
不许按地面高吸附。水面在 `y = 0`。

- [ ] **Step 2: 三处已知的地形冲突，报告不修**

都实测过，都在 MVP 游线上，**都不许改 `plan.json`**：

1. **潇湘馆正房锚点脚下有一条沟。** (−105,98) 6 m 见方内高差 **1.30 m**，来源是 `plan.water` 的
   「潇湘馆穿院引泉沟」（depth 0.3，原文「開溝僅尺許，灌入牆內，繞階緣屋至前院」）。这就是 `99-24` 说的那半。
   P1 允许的做法是**给建筑垫台基**（composer 里给一块平台加踏跺），不是挪 plan 的沟。
2. **翠嶂有两块石头的锚点落在溪里。** 「镜面白石(迎面留题处)」(−34,200) 与「西山口·羊肠小径(入园口)」(−52,206)
   都在「沁芳溪·南段」多边形内，高程 −1.00。这是新发现的缺陷，`99-23`/`99-24` 都没覆盖。
   **绕开摆，并在回报里点名**，会补进 `missing.rules.json`。
3. **翠嶂是一座 11 m 的山，不是一堆 3 m 的太湖石。** `plan.hills` 里「翠嶂」标称 11 m，
   两个入口 (−40,196) 与 (74,202) 的地面高差 **6.6 m**。现在的 `taihu:mound` 构件只有 3 米高。
   P1 不做新几何——**把石组摆在山口两侧当门框**，山体交给地形，别试图用石头堆出 11 米。

- [ ] **Step 3: 植被跟着搬（计划最初漏了这个文件）**

`builder/parts/zhiwu/vegetation.ts` 里两处全是旧坐标：

- `VEG.scatterMinX/MaxX/MinZ/MaxZ`（−25…25 / −25…31）——散布盒。不改的话植被还长在老园子那 50 米见方里。
- `FOOTPRINTS`——建筑禁区，手抄的旧坐标。不改的话草会从正门屋里长出来。

散布盒换成 Task 6 的窗口后，面积涨了十几倍，**实例数会跟着涨十几倍**（现在全场景已经 525 万三角）。
`VEG.cullRadius`（41 m）与 `InstanceCuller` 已经在剔了，所以帧率未必炸，但内存与构建时间会。
先量再调：`shots/*/manifest.json` 里的 `triangles`。**全场景三角数不许超过现在的 1.5 倍（约 790 万）。**

`FOOTPRINTS` 是 SCENE 的手抄副本，这次搬完更容易漂。可以改成由 composer 把落位后的建筑轮廓
发布到 `ctx`，vegetation 读它——`vegetation.ts` 已经 import 了 `@builder/compose/terrain`，层门认这条边。
不想动结构就照旧手抄，但要在注释里写明它是 SCENE 的副本。

- [ ] **Step 4: 更新出生点、试玩航点、镜头**

`main.ts` 的 `SPAWN` 从 `(0, 0, 29.5)` 改成正门南侧——`plan.gates` 的正门在 (55, 250)，
`zhengmen` 的 `entrances` 是 [[55, 244]]，出生点取门外一点，朝北（`SPAWN_YAW` 让人面向 −Z）。

`tools/playtest.mjs` 的 `ROUTE` 换成「十七回游线」前 14 点加各区 `entrances`。
注意 `bridgeWaypoints()` 里的桥面局部坐标是写死的，桥在 SCENE 里挪了、加了段，**这里要同步**，
否则试玩会走到桥外面掉水里。游线全长 310.6 m，比现在的 50 米长六倍，试玩会跑得久，这是正常的。

`tools/capture.mjs` 的 14 个镜头位置照新坐标重定。**镜头 id 不要改名**——`manifest-diff` 与 `side-by-side` 按 id 配对。

- [ ] **Step 5: 试玩必须全线通过**

```bash
npm run build
pkill -f "port 4801"; (nohup npx vite preview --host 127.0.0.1 --port 4801 --strictPort > preview.log 2>&1 &)
sleep 3
node tools/playtest.mjs --url http://127.0.0.1:4801/
```

Expected: `PLAYTEST PASS`。这一步是这个任务的真验收——坐标搬错了走不通。

- [ ] **Step 6: 出对照图交人眼**

```bash
node tools/capture.mjs --url http://127.0.0.1:4801/ --out shots/p1t6
for s in gate_approach mound_block pond_reveal xiaoxiang; do
  node tools/side-by-side.mjs shots/p1abcd/$s.png shots/p1t6/$s.png shots/compare/$s.png
done
```

**结构数字这次会变**（世界尺度不同了），所以 `manifest-diff` 不适用于判等；但它的 `triangles` 仍要看，
用来对 Step 3 的 790 万上限。观感改判人眼：五处构件都还在、朝向对、接地对、游线走得通。

- [ ] **Step 7: 提交**

```bash
git add builder/compose builder/parts/zhiwu/vegetation.ts projects/daguanyuan/main.ts tools/playtest.mjs tools/capture.mjs
git commit -m "feat(compose): 世界切到 plan.json 坐标系

园子从手摆的 64×72 米变成平面真源的 500×500 米(先只开游线沿线的窗口)。
SCENE 改成锚点驱动:plan 点了名的构件按 buildings[].x/z 摆,没点名的用
「区域 + 局部偏移」兜底——派生的质心不盖过真源写下的锚点(见 99-24)。
验收靠试玩全线通过——坐标搬错了走不通。"
```

---

## 链 B · Task 7: 地形分块与分簇剔除

**Files:**
- Create: `engine/scatter/cluster.ts`、`engine/render/TerrainChunks.ts`
- Modify: `engine/scatter/instancing.ts`、`builder/parts/zhiwu/vegetation.ts`、`builder/compose/terrain.ts`
- Test: `tests/cluster.test.mjs`

**Interfaces:**
- Produces:
  - `class ClusterGrid { constructor(cellSize: number); add(x, z, payload): void; cells(): Cluster[] }`
  - `Cluster = { center: Vector3; radius: number; items: T[] }`
  - `class ClusteredInstancePool` — 按簇建 `InstancedMesh`，每簇一个包围球做视锥剔除
  - `buildTerrainChunks(field, bounds, chunkSize): THREE.Mesh[]`

- [ ] **Step 1: 先读，避免重复踩坑**

`docs/tellux-borrowing.md` 第 4、5 条。两个要点：

1. 实例按固定网格分簇，每簇一个包围球做视锥剔除。现在整片植被是一个大 `InstancedMesh`，摄像机转过去也剔不掉。
2. **shader 注入要做成有序 stage**。风摆、实例偏移、LOD 形变都要改 `project_vertex`，三方会打架。现在只有风摆一个所以没暴露。

- [ ] **Step 2: 写失败测试**

```javascript
// tests/cluster.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClusterGrid } from '@engine/scatter/cluster.ts';

test('按网格分簇：同格的落进同一簇，跨格的分开', () => {
  const g = new ClusterGrid(64);
  g.add(10, 10, 'a');
  g.add(20, 20, 'b');
  g.add(200, 10, 'c');
  const cells = g.cells();
  assert.equal(cells.length, 2);
  const big = cells.find((c) => c.items.length === 2);
  assert.deepEqual(big.items.sort(), ['a', 'b']);
});

test('簇的包围球真的包住所有成员', () => {
  const g = new ClusterGrid(64);
  const pts = [[5, 5], [60, 60], [30, 10]];
  for (const [x, z] of pts) g.add(x, z, { x, z });
  const c = g.cells()[0];
  for (const p of c.items) {
    const d = Math.hypot(p.x - c.center.x, p.z - c.center.z);
    assert.ok(d <= c.radius + 1e-6, `点 (${p.x},${p.z}) 在包围球外`);
  }
});

test('空网格不产簇', () => {
  assert.equal(new ClusterGrid(64).cells().length, 0);
});
```

- [ ] **Step 3: 实现分簇与分块**

- `cluster.ts`：固定网格分簇，算每簇包围球。
- `instancing.ts`：`ClusteredInstancePool` 每簇一个 `InstancedMesh`，`update(camera)` 时按簇球做视锥剔除，整簇 `visible = false`。
- `TerrainChunks.ts`：地形按 `chunkSize`（建议 64 米）切成多块 `Mesh`，各自有包围盒，让 three 自己剔除。
- `vegetation.ts`：把散布结果喂进 `ClusteredInstancePool` 而不是单个大池。

**shader 注入改成有序 stage**：给注入点排个序（`rtc` → `wind` → `lod`），每段追加而不是各自覆盖 `project_vertex`。

- [ ] **Step 4: 量一遍，证明剔除真的生效**

```bash
npm run build
pkill -f "port 4801"; (nohup npx vite preview --host 127.0.0.1 --port 4801 --strictPort > preview.log 2>&1 &)
sleep 3
node tools/capture.mjs --url http://127.0.0.1:4801/ --out shots/p1t7
```

对比 `shots/p1t6`：**朝向园子的镜头三角数应大致不变，背对园子的镜头应显著下降**。把两组数字写进提交信息。若背对的镜头也没降，说明剔除没生效——检查包围球半径是不是算大了，或者 `frustumCulled` 被关掉了。

- [ ] **Step 5: 人眼确认没剔错**

```bash
for s in pond_reveal treeline xiaoxiang; do
  node tools/side-by-side.mjs shots/p1t6/$s.png shots/p1t7/$s.png shots/compare/$s.png
done
```

Expected: 看不出差别。**看得出差别就是剔多了**——视野边缘的簇被误剔，扩大包围球或加一点余量。

- [ ] **Step 6: 提交**

```bash
git add engine/scatter engine/render/TerrainChunks.ts builder/parts/zhiwu/vegetation.ts builder/compose/terrain.ts tests/cluster.test.mjs
git commit -m "perf(engine): 网格分簇 + 簇级视锥剔除 + 地形分块

画布 500 米见方后,单个大 InstancedMesh 剔不掉:摄像机背对园子也在提交全部实例。
按 64 米网格分簇,每簇一个包围球。shader 注入改成有序 stage(rtc → wind → lod),
免得后面加实例偏移和 LOD 形变时三方争抢 project_vertex。"
```

---

## 完成判据

```bash
npm run check && npm test && npm run check:layers && npm run check:rules && node tools/check-plan.mjs
node tools/playtest.mjs --url http://127.0.0.1:4801/
```

且：

- `builder/derive/` 里搜不到手抄的营造数字（`grep -rnE "guangCun: [0-9]|doukouCun" builder/derive` 无输出）。
- Tier A 的建筑抛 `MissingRuleError` 并说明该查哪本书——**这是通过条件不是失败**。
- `Frame.provenance` 三支都有内容，棚拍 manifest 能回溯到规则 id。
- 世界坐标系是 `plan.json` 的，试玩全线通过。
- 背对园子的镜头三角数显著低于朝向园子的。

## 下一份计划

P2 几何层补真（区域轮廓、建筑 spec、游线数据模型、远景、线性构件），与 PE 园林体验层。
两者都要等 P1 的 Task 6（世界切到 plan 坐标系）落地。
