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

## 链 A · Task 1: 规则加载器、状态机、provenance

这是整个 P1 的脊柱。做完之后，代码里不再有手抄的营造数字，知识库第一次真正开始工作。

**Files:**
- Create: `builder/derive/rules.ts`、`builder/derive/errors.ts`、`builder/derive/provenance.ts`
- Modify: `builder/derive/fashi/cai.ts`、`puzuo.ts`、`zhu.ts`、`juzhe.ts`、`yanchu.ts`、`builder/derive/index.ts`
- Test: `tests/rules.test.mjs`、`tests/fashi.test.mjs`（改造）

**Interfaces:**
- Produces:
  - `class RuleBook`，构造 `new RuleBook('fashi', { choices, overrides })`，或测试用 `RuleBook.fromRules(rules, paramSet, opts)`
  - `book.use(id): Rule` — 判状态、记 provenance、返回可用条目
  - `book.table<T>(id): T[]` · `book.choice<T>(id): T` · `book.provenance(): Provenance`
  - `RefutedRuleError` · `AmbiguousRuleError` · `MissingRuleError`（都带 `ruleId`）
  - `interface Provenance { evidence: Entry[]; inference: Entry[]; art: Entry[] }`，`Entry = { id, name, location?, note? }`
- Consumes: `@knowledge/rules/{fashi,qing,fayuan}.rules.json`

- [ ] **Step 1: 写失败测试**

```javascript
// tests/rules.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleBook } from '@builder/derive/rules.ts';
import { RefutedRuleError, AmbiguousRuleError, MissingRuleError } from '@builder/derive/errors.ts';

const mk = (rules, opts) => RuleBook.fromRules(rules, 'fashi', opts);

test('ok 的规则直接可用，并记进 evidence', () => {
  const book = mk([
    { id: '01-05', name: '八等材尺寸表', status: 'ok', statement: '', paramSet: 'fashi',
      formula: 'table', table: [{ grade: 1, fenCun: 0.6 }], location: '卷四·材' },
  ]);
  assert.equal(book.table('01-05')[0].fenCun, 0.6);
  const p = book.provenance();
  assert.equal(p.evidence.length, 1);
  assert.equal(p.evidence[0].id, '01-05');
  assert.equal(p.inference.length, 0);
  assert.equal(p.art.length, 0);
});

test('driven 驳倒的规则引用即抛，错误里带更正值与出处', () => {
  const book = mk([
    { id: '05-06', name: '递加个数', status: 'refuted', statement: '', paramSet: 'fashi',
      correction: '个 = 级数，总递加 = 个数 − 1', location: '营造法原·提栈' },
  ]);
  assert.throws(() => book.use('05-06'), (e) => {
    assert.ok(e instanceof RefutedRuleError);
    assert.equal(e.ruleId, '05-06');
    assert.match(e.message, /个 = 级数/);
    assert.match(e.message, /营造法原/);
    return true;
  });
});

test('存疑且有多口径时，不指定就抛；指定了记进 inference', () => {
  const rules = [
    { id: '01-09', name: '宋尺换算', status: 'contested', statement: '', paramSet: 'fashi',
      choices: [
        { key: 'chutu', value: 31.2, note: '出土宋尺下限' },
        { key: 'chen', value: 32.0, note: '陈明达，辽代' },
      ] },
  ];
  assert.throws(() => mk(rules).choice('01-09'), (e) => {
    assert.ok(e instanceof AmbiguousRuleError);
    assert.match(e.message, /chutu/);
    assert.match(e.message, /chen/);
    return true;
  });
  const book = mk(rules, { choices: { '01-09': 'chen' } });
  assert.equal(book.choice('01-09'), 32.0);
  assert.equal(book.provenance().inference[0].id, '01-09');
  assert.match(book.provenance().inference[0].note, /chen/);
});

test('存疑但无多口径时，用 correction 并记进 inference', () => {
  const book = mk([
    { id: '03-01', name: '柱径', status: 'contested', statement: '', paramSet: 'fashi',
      formula: 'D = 42', correction: '唐构实测约 29 分，允许覆盖' },
  ]);
  book.use('03-01');
  assert.equal(book.provenance().inference.length, 1);
  assert.match(book.provenance().inference[0].note, /唐构实测/);
});

test('欠定的规则不抛错，按 resolution 走并记进 art', () => {
  const book = mk([
    { id: '90-01', name: '竹丛数', status: 'underdetermined', statement: '', paramSet: 'fashi',
      resolution: { method: 'seeded_variant', note: '原文「千百竿」只约束量级，丛数取 12~20 的种子变体' } },
  ]);
  book.use('90-01');
  assert.equal(book.provenance().art.length, 1);
  assert.equal(book.provenance().art[0].method, 'seeded_variant');
  assert.equal(book.provenance().evidence.length, 0, '欠定项不得记进 evidence');
});

test('缺失的规则抛错并说明该查哪本书；显式覆盖则记进 art', () => {
  const rules = [
    { id: 'ZZ-01', name: '某条书里没有的规则', status: 'missing', statement: '', paramSet: 'fashi',
      whereToLook: { books: ['营造算例·大木'], keywords: ['檐柱高 斗口 反算'] } },
  ];
  assert.throws(() => mk(rules).use('ZZ-01'), (e) => {
    assert.ok(e instanceof MissingRuleError);
    assert.match(e.message, /营造算例/);
    assert.match(e.message, /檐柱高 斗口 反算/);
    return true;
  });
  const book = mk(rules, { overrides: { 'ZZ-01': 52.4 } });
  assert.equal(book.use('ZZ-01').value, 52.4);
  assert.equal(book.provenance().art[0].id, 'ZZ-01');
});

test('缺口条目 paramSet 为 none，但每套参数集都要能看见它', () => {
  const rules = [
    { id: '99-02', name: '由规模反算斗口的正向链', status: 'missing', statement: '', paramSet: 'none',
      whereToLook: { books: ['《营造算例》第一章大木'], keywords: ['檐柱高 斗口 反算'] } },
  ];
  for (const ps of ['fashi', 'qing', 'fayuan']) {
    assert.throws(() => RuleBook.fromRules(rules, ps).use('99-02'), (e) => {
      assert.ok(e instanceof MissingRuleError);
      assert.match(e.message, /营造算例/, `${ps} 参数集应看得见缺口条目并带出 whereToLook`);
      return true;
    });
  }
});

test('按 paramSet 取数，不按文件名：both 的条目两边都收', () => {
  const rules = [
    { id: 'A', name: 'a', status: 'ok', statement: '', paramSet: 'qing' },
    { id: 'B', name: 'b', status: 'ok', statement: '', paramSet: 'both' },
    { id: 'C', name: 'c', status: 'ok', statement: '', paramSet: 'fayuan' },
  ];
  const qing = RuleBook.fromRules(rules, 'qing');
  assert.deepEqual(qing.ids().sort(), ['A', 'B']);
  const fayuan = RuleBook.fromRules(rules, 'fayuan');
  assert.deepEqual(fayuan.ids().sort(), ['B', 'C']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test 2>&1 | grep -A3 rules`
Expected: FAIL，`Cannot find module '@builder/derive/rules.ts'`。

- [ ] **Step 3: 写错误类**

```typescript
// builder/derive/errors.ts
/**
 * 规则状态机的四种拒绝。
 *
 * 设计意图见 docs/DECISIONS.md D-08 与 D-16:让"我们不知道"成为程序能表达的状态。
 * 推导器宁可抛错停下,也不拿一个编出来的中值蒙混——那个数会一路传进几何,
 * 然后没人再知道它是猜的。
 */
export class RuleError extends Error {
  constructor(readonly ruleId: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 两名核验者都驳倒的规则。禁用。 */
export class RefutedRuleError extends RuleError {}

/** 存疑且有多个并存口径，调用方没说用哪个。 */
export class AmbiguousRuleError extends RuleError {}

/** 书里根本没有这条规则。 */
export class MissingRuleError extends RuleError {}
```

- [ ] **Step 4: 写 provenance**

```typescript
// builder/derive/provenance.ts
/**
 * 出处三分。
 *
 * 一栋屋的数字来自三种性质完全不同的东西,混成一条链的后果是**艺术决策被当成史料**:
 *   evidence  原文/古籍/实测——有出处的事实
 *   inference 我们据证据做的裁决——存疑项选了哪个口径、用了哪个更正值
 *   art       为体验主动做的偏离——欠定项怎么定的、显式覆盖了什么
 *
 * 分开之后,点一根柱子可以说清:柱网规则出自《工程做法》(史料)· 此处取三开间(推定)
 * · 柱径视觉增粗 10%(艺术偏离)。见 spec §5。
 */
export interface ProvenanceEntry {
  id: string;
  name: string;
  /** 卷/篇/页，evidence 才有。 */
  location?: string;
  /** 为什么这么定。inference 与 art 必有。 */
  note?: string;
  /** art 分支:artistic_choice | seeded_variant | override */
  method?: string;
}

export interface Provenance {
  evidence: ProvenanceEntry[];
  inference: ProvenanceEntry[];
  art: ProvenanceEntry[];
}

export function emptyProvenance(): Provenance {
  return { evidence: [], inference: [], art: [] };
}

/** 合并多个推导步骤的出处，按 id 去重。 */
export function mergeProvenance(...ps: Provenance[]): Provenance {
  const out = emptyProvenance();
  for (const p of ps) {
    for (const branch of ['evidence', 'inference', 'art'] as const) {
      for (const e of p[branch]) {
        if (!out[branch].some((x) => x.id === e.id)) out[branch].push(e);
      }
    }
  }
  return out;
}
```

- [ ] **Step 5: 写加载器与状态机**

```typescript
// builder/derive/rules.ts
/**
 * 机读规则表的加载器与状态机。
 *
 * 代码只从这里取营造数字,不许写字面量。规则表是真源(docs/DECISIONS.md D-09),
 * 改一条规则不用改代码,改错了手算断言会红。
 *
 * **按 paramSet 取数,不按文件名**:文件按来源章节组织,参数集按消费方组织,
 * 两个轴不平行。清《工程做法》06 章屋顶瓦作官式与苏式并存,整章塞进任何一个
 * 参数集都是错的。见 knowledge/rules/README.md 与 PITFALLS P-14。
 */
import fashiFile from '@knowledge/rules/fashi.rules.json';
import qingFile from '@knowledge/rules/qing.rules.json';
import fayuanFile from '@knowledge/rules/fayuan.rules.json';
import { AmbiguousRuleError, MissingRuleError, RefutedRuleError } from './errors';
import { emptyProvenance, type Provenance } from './provenance';

export type RuleStatus = 'ok' | 'contested' | 'refuted' | 'underdetermined' | 'missing';
export type ParamSet = 'fashi' | 'qing' | 'fayuan';

export interface RuleChoice {
  key: string;
  value: unknown;
  note: string;
}

export interface Rule {
  id: string;
  name: string;
  status: RuleStatus;
  statement: string;
  paramSet: ParamSet | 'both' | 'none';
  formula?: string;
  table?: unknown[];
  params?: Record<string, unknown>;
  correction?: string;
  choices?: RuleChoice[];
  resolution?: { method: string; note: string };
  quote?: string;
  location?: string;
  urls?: string[];
  needs?: string[];
  whereToLook?: { books?: string[]; keywords?: string[] };
  notes?: string;
  /** 调用方显式覆盖后填上，见 use()。 */
  value?: unknown;
}

interface RuleFile {
  source: { book: string; doc: string };
  rules: Rule[];
}

const ALL: Rule[] = [
  ...(fashiFile as RuleFile).rules,
  ...(qingFile as RuleFile).rules,
  ...(fayuanFile as RuleFile).rules,
];

export interface RuleBookOptions {
  /** 存疑且多口径的规则，指定用哪个 key。不指定就抛 AmbiguousRuleError。 */
  choices?: Record<string, string>;
  /** 缺失的规则可以显式给值。会记进 provenance 的 art 分支，留痕。 */
  overrides?: Record<string, unknown>;
}

export class RuleBook {
  private readonly byId = new Map<string, Rule>();
  private readonly prov = emptyProvenance();

  private constructor(
    rules: Rule[],
    readonly paramSet: ParamSet,
    private readonly opts: RuleBookOptions = {},
  ) {
    for (const r of rules) {
      // 缺口条目在 missing.rules.json 里一律 paramSet: 'none'——一个空缺对每条链都是空缺,
      // 按参数集过滤会把它们全滤掉,use() 就只剩一句"不在参数集里",丢掉 whereToLook。
      const keep = r.paramSet === paramSet || r.paramSet === 'both' || r.status === 'missing';
      if (keep) this.byId.set(r.id, r);
    }
  }

  /** 从随仓库打包的规则表建一本。 */
  static create(paramSet: ParamSet, opts: RuleBookOptions = {}): RuleBook {
    return new RuleBook(ALL, paramSet, opts);
  }

  /** 从给定的规则数组建一本。测试用，也让调用方能注入被篡改的表做突变测试。 */
  static fromRules(rules: Rule[], paramSet: ParamSet, opts: RuleBookOptions = {}): RuleBook {
    return new RuleBook(rules, paramSet, opts);
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }

  /** 原始条目，不判状态、不记出处。给需要看 notes 的地方用。 */
  raw(id: string): Rule | undefined {
    return this.byId.get(id);
  }

  /**
   * 取一条可用的规则：判状态、记出处，或者抛错。
   *
   * 这是整个知识库的执法处。每一条营造数字都要从这里过一次。
   */
  use(id: string): Rule {
    const r = this.byId.get(id);
    if (!r) {
      throw new MissingRuleError(id, `规则 ${id} 不在 ${this.paramSet} 参数集里（或根本不存在）。`);
    }

    switch (r.status) {
      case 'ok':
        this.push('evidence', { id: r.id, name: r.name, location: r.location });
        return r;

      case 'refuted':
        throw new RefutedRuleError(
          id,
          `规则 ${id}「${r.name}」已被两名核验者驳倒，禁用。` +
            (r.correction ? ` 更正：${r.correction}` : '') +
            (r.location ? ` 出处：${r.location}` : ''),
        );

      case 'contested': {
        if (r.choices?.length) {
          const key = this.opts.choices?.[id];
          if (!key) {
            const keys = r.choices.map((c) => `${c.key}(${c.note})`).join('、');
            throw new AmbiguousRuleError(
              id,
              `规则 ${id}「${r.name}」有多个并存口径，必须显式选一个：${keys}。` +
                ` 在 RuleBookOptions.choices 里给 { "${id}": "<key>" }。`,
            );
          }
          const hit = r.choices.find((c) => c.key === key);
          if (!hit) {
            throw new AmbiguousRuleError(
              id,
              `规则 ${id} 没有口径 "${key}"，可选：${r.choices.map((c) => c.key).join('、')}。`,
            );
          }
          this.push('inference', { id: r.id, name: r.name, note: `选用口径 ${key}：${hit.note}` });
          return { ...r, value: hit.value };
        }
        this.push('inference', {
          id: r.id,
          name: r.name,
          note: r.correction ?? '存疑，按研究稿的更正值使用',
        });
        return r;
      }

      case 'underdetermined': {
        // 证据在、不冲突，但合法解不唯一。不抛错，但必须记进 art——
        // 不记的话，艺术选择就伪装成考据结论了（DECISIONS D-16）。
        const res = r.resolution;
        this.push('art', {
          id: r.id,
          name: r.name,
          method: res?.method ?? 'artistic_choice',
          note: res?.note ?? '欠定项，未声明解析方式',
        });
        return r;
      }

      case 'missing': {
        const ov = this.opts.overrides?.[id];
        if (ov !== undefined) {
          this.push('art', { id: r.id, name: r.name, method: 'override', note: `显式覆盖为 ${String(ov)}` });
          return { ...r, value: ov };
        }
        const w = r.whereToLook;
        throw new MissingRuleError(
          id,
          `规则 ${id}「${r.name}」在书里没有，无法推导。` +
            (w?.books?.length ? ` 该查：${w.books.join('、')}。` : '') +
            (w?.keywords?.length ? ` 关键词：${w.keywords.join('、')}。` : '') +
            ` 要先用一个值顶着，在 RuleBookOptions.overrides 里显式给 { "${id}": <值> }，会记入 provenance。`,
        );
      }
    }
  }

  /** use() 之后取表。 */
  table<T>(id: string): T[] {
    const r = this.use(id);
    if (!Array.isArray(r.table)) {
      throw new MissingRuleError(id, `规则 ${id}「${r.name}」没有 table 字段。`);
    }
    return r.table as T[];
  }

  /** use() 之后取选中口径的值。 */
  choice<T>(id: string): T {
    const r = this.use(id);
    if (r.value === undefined) {
      throw new AmbiguousRuleError(id, `规则 ${id} 不是多口径条目，用 use() 或 table()。`);
    }
    return r.value as T;
  }

  provenance(): Provenance {
    return {
      evidence: [...this.prov.evidence],
      inference: [...this.prov.inference],
      art: [...this.prov.art],
    };
  }

  private push(branch: keyof Provenance, e: Provenance['evidence'][number]): void {
    if (!this.prov[branch].some((x) => x.id === e.id)) this.prov[branch].push(e);
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: 7 条新测试通过，总数从 23 涨到 30。

- [ ] **Step 7: 把 `cai.ts` 的手抄表换成规则表**

现在 `builder/derive/fashi/cai.ts` 里 `GRADES` 是我手敲的字面量，和研究稿只有"照着抄的"这层人肉关联。改成：

```typescript
import type { RuleBook } from '../rules';

export interface GradeRow {
  grade: number;
  guangCun: number;
  houCun: number;
  fenCun: number;
  use: string;
}

/** 八等材表 [fashi 01-05]。数字来自规则表，不在代码里写死。 */
export function grades(book: RuleBook): GradeRow[] {
  return book.table<GradeRow>('01-05');
}

/** 材/栔/足材的分值 [fashi 01-02][01-03][01-04]。 */
export function caiModule(book: RuleBook): { guang: number; hou: number; qiGuang: number; zuCai: number } {
  const m = book.use('01-02').params as { guang: number; hou: number } | undefined;
  const q = book.use('01-03').params as { qiGuang: number } | undefined;
  const guang = Number(m?.guang ?? 15);
  const hou = Number(m?.hou ?? 10);
  const qiGuang = Number(q?.qiGuang ?? 6);
  return { guang, hou, qiGuang, zuCai: guang + qiGuang };
}
```

`makeCai(spec)` 改成 `makeCai(book, spec)`。**尺长不再有默认值**——`01-09` 是 contested 且带四个 `choices`，调用方必须显式选，这正是我们要的行为。

`puzuo.ts`、`zhu.ts`、`juzhe.ts`、`yanchu.ts` 同样处理：所有字面量数字换成 `book.use(id)` 取值，函数签名首参加 `book: RuleBook`。

`builder/derive/index.ts` 的 `deriveBuilding(spec)` 内部建 book：

```typescript
export interface BuildingSpec {
  // …原有字段…
  /** 用哪套参数集。缺省 fashi。 */
  paramSet?: ParamSet;
  /** 存疑多口径规则的选择，如 { "01-09": "chutu" }。 */
  choices?: Record<string, string>;
  /** 缺失规则的显式覆盖，会记入 provenance.art。 */
  overrides?: Record<string, unknown>;
}

export interface Frame {
  // …原有字段…
  provenance: Provenance;
}
```

- [ ] **Step 8: 改造 `tests/fashi.test.mjs`**

现有断言（佛光寺、折屋 worked example）保持数值不变，但改成经由 `deriveBuilding` 走规则表。另加两条：

```javascript
test('规则表是真源:改坏 JSON 里的数,断言立刻红', () => {
  const good = RuleBook.fromRules(realFashiRules, 'fashi', { choices: { '01-09': 'chutu' } });
  const bad = RuleBook.fromRules(
    realFashiRules.map((r) =>
      r.id === '01-05'
        ? { ...r, table: r.table.map((row) => ({ ...row, fenCun: row.fenCun * 2 })) }
        : r,
    ),
    'fashi',
    { choices: { '01-09': 'chutu' } },
  );
  const g = makeCai(good, { grade: 6 });
  const b = makeCai(bad, { grade: 6 });
  assert.ok(Math.abs(b.fenCm - g.fenCm * 2) < 1e-9, '篡改规则表应当直接改变推导结果');
});

test('尺长必须显式选口径，不选就抛', () => {
  const book = RuleBook.create('fashi');
  assert.throws(() => makeCai(book, { grade: 6 }), /多个并存口径/);
});
```

- [ ] **Step 9: 确认代码里没有残留的手抄数字**

```bash
grep -rnE "guangCun: [0-9]|fenCun: 0\.[0-9]|doukouCun" builder/derive | grep -v "\.d\.ts"
```

Expected: 无输出（除类型声明）。有输出说明还有表没搬。

- [ ] **Step 10: 全门**

```bash
npm run check && npm test && npm run check:layers && npm run check:rules
```

Expected: 全过。分层门尤其要过——`builder/derive/` 仍然不许 import `three`。

- [ ] **Step 11: 结构无变化**

```bash
npm run build
pkill -f "port 4801"; (nohup npx vite preview --host 127.0.0.1 --port 4801 --strictPort > preview.log 2>&1 &)
sleep 3
node tools/capture.mjs --url http://127.0.0.1:4801/ --out shots/p1t1
node tools/manifest-diff.mjs shots/p1t1 shots/baseline
```

Expected: `0 镜结构不一致`。换数据源不该改变任何一栋房子——如果变了，说明规则表里的数与我手抄的不一致，**以规则表为准**，回去查是哪一条，并在提交信息里写明差在哪。

- [ ] **Step 12: 提交**

```bash
git add builder/derive tests/rules.test.mjs tests/fashi.test.mjs
git commit -m "feat(derive): 推导器改读知识库——规则加载器、状态机、出处三分

代码里不再有手抄的营造数字。改一条规则不用改代码,改错了手算断言会红。
状态机四种拒绝:驳倒即抛、多口径不选即抛、缺失即抛并说明该查哪本书、
欠定不抛但强制记进 art 分支(不记的话艺术选择会伪装成考据结论)。
provenance 分 evidence/inference/art 三支,混成一条链会让艺术决策被当史料。"
```

---

## 链 A · Task 2: `qing` 参数集（斗口制）

**Files:**
- Create: `builder/derive/qing/doukou.ts`、`jujia.ts`、`chuyan.ts`、`dougong.ts`、`index.ts`
- Modify: `builder/derive/index.ts`（按 `paramSet` 分派）
- Test: `tests/qing.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `RuleBook`、`Provenance`；规则来自 `paramSet: 'qing' | 'both'`（注意有 9 条在 `fayuan.rules.json` 文件里，**按字段取不按文件取**）。
- Produces: `deriveQing(book, spec): Frame` — 与 `fashi` 同一个 `Frame` 契约，字段对照见 `knowledge/docs/qingshi/qingshi.schema.json` 的 `mapping` 段 24 条概念。

- [ ] **Step 1: 先读，再动手**

必读：`knowledge/docs/qingshi/README.md` 的跨章结论、`01-doukou.md`、`02-jujia.md`、`03-chuyan.md`、`04-dougong.md`、`tiers.md` 的 Tier A 那一节与**禁用 id 白名单**。

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
  const book = RuleBook.create('qing', { choices: { '01-19': 'qing' } });
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
- Consumes: Task 1 的 `RuleBook`；规则 `paramSet: 'fayuan' | 'both'`。
- Produces: `deriveFayuan(book, spec): Frame`，同一契约。

- [ ] **Step 1: 先读**

必读：`knowledge/docs/qingshi/05-fayuan.md`（27 条，篇幅最长）、`06-wuding.md` 里 `paramSet: fayuan` 的那几条、`tiers.md` 的 Tier B 与 Tier C、`verify-suzhou.md` 的 A 部分（月到风来亭手算）。

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
  assert.throws(() => book.use('05-06'), (e) => {
    assert.ok(e instanceof RefutedRuleError);
    assert.match(e.message, /个\s*=\s*级数|个 = 级数/);
    return true;
  });
});

test('网师园月到风来亭：界深对边距 [fayuan 05-*]，误差 10% 内', () => {
  const book = RuleBook.create('fayuan', { choices: { '05-01': 'suzuo' } });
  const fr = deriveFayuan(book, {
    tier: 'C', shape: 'hexagon', sideM: 2.10, columnHeightM: 3.00, jieCount: 4, chiCm: 27.5,
  });
  // verify-suzhou.md A:对边距实测 −1.0%、界深 vs「亭界深约三尺」+5.0%
  within(fr.m.width, 3.64, 0.10, '对边距');
});

test('提栈逐界递加：脊界最陡，檐界最缓', () => {
  const book = RuleBook.create('fayuan', { choices: { '05-01': 'suzuo' } });
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
  const book = RuleBook.create('fayuan', { choices: { '05-01': 'suzuo' } });
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

**Files:**
- Modify: `builder/compose/terrain.ts`（改为调用 Task 5 的生成器）、`builder/compose/composer.ts`（SCENE 坐标改到 plan 空间）、`projects/daguanyuan/main.ts`（出生点）、`tools/playtest.mjs`（航点）、`tools/capture.mjs`（镜头）
- Test: 试玩与截图

**Interfaces:**
- Consumes: Task 5 的 `makeTerrainField`
- Produces: 世界坐标 = `plan.json` 坐标（米，原点园心，x 东 z 南）

- [ ] **Step 1: 把现有五处构件搬到 plan 的区域质心**

现在 `composer.ts` 的 `SCENE` 表里正门在 `z=24.4`、潇湘馆在 `z=-20.6`，都是旧坐标。`plan.json` 里这五个区（`zhengmen`、`cuizhang`、`qinfang_ting_qiao`、`xiaoxiangguan`，加沁芳池）各有 `polygon` 与 `entrances`。

改法：`SCENE` 的每一项加 `region` 字段，坐标改成**相对该区质心的局部偏移**，装配器读 plan 算出世界坐标。这样以后 P4 每个区一份 `scenes/<region>.json` 时格式已经对上。

- [ ] **Step 2: 只开游线沿线的窗口**

500 米见方全量建地形会炸。给 `makeTerrainField` 传 `bounds`，先只覆盖正门到潇湘馆这条游线外扩 40 米的范围。分块在 Task 7。

- [ ] **Step 3: 更新出生点、试玩航点、镜头**

`main.ts` 的 `SPAWN` 改成 plan 里正门南侧的点。`tools/playtest.mjs` 的 `ROUTE` 全部换成 plan 的 `route_ch17` 前几站加 `entrances`。`tools/capture.mjs` 的镜头位置照新坐标重定。

- [ ] **Step 4: 试玩必须全线通过**

```bash
npm run build
pkill -f "port 4801"; (nohup npx vite preview --host 127.0.0.1 --port 4801 --strictPort > preview.log 2>&1 &)
sleep 3
node tools/playtest.mjs --url http://127.0.0.1:4801/
```

Expected: `PLAYTEST PASS`。这一步是这个任务的真验收——坐标搬错了走不通。

- [ ] **Step 5: 出对照图交人眼**

```bash
node tools/capture.mjs --url http://127.0.0.1:4801/ --out shots/p1t6
for s in gate_approach mound_block pond_reveal xiaoxiang; do
  node tools/side-by-side.mjs shots/baseline/$s.png shots/p1t6/$s.png shots/compare/$s.png
done
```

**结构数字这次会变**（世界尺度不同了），所以 `manifest-diff` 不适用。改为人眼判：五处构件都还在、朝向对、接地对、游线走得通。

- [ ] **Step 6: 提交**

```bash
git add builder/compose projects/daguanyuan/main.ts tools/playtest.mjs tools/capture.mjs
git commit -m "feat(compose): 世界切到 plan.json 坐标系

园子从手摆的 64×72 米变成平面真源的 500×500 米(先只开游线沿线的窗口)。
SCENE 表改成「区域 + 局部偏移」,格式与 P4 的 scenes/<region>.json 对上。
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
