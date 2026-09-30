# 单子 AD · 验场门第一批 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给「建出来的世界」装上四道能红的门——对账、脚下序列、接缝连续性、近景联络表——
让「数据说有、世界没有」这类缺陷由机器报出来，而不是靠人走到跟前才发现。

**Architecture:** 不新起 harness。四道门全部落在既有工具上：
`composer.ts` 让**每个** placement 都登记进世界清单（现在只有 `kind==='building'` 登记，
六段墙/竹丛/太湖石/桥/游廊/院墙/灯笼一条都没有）；`capture.mjs` 把清单与建成区名单写进 manifest；
`manifest-diff.mjs` 拿 `plan.json` 的对象全集减去这份清单，输出**双向覆盖率表**；
`playtest.mjs` 沿既有游线顺带记 `collision.surfaceAt`，输出带里程的材质序列；
`connection-audit.mjs`（已接在 `check:plan` 上）加接缝连续性断言；
`shoot-part.mjs` 把棚拍图拼成联络表，`capture.mjs` 加一组贴脸机位。

**Tech Stack:** Node 22 (`--experimental-strip-types`)、playwright、three.js 0.185、TypeScript 5.9。
测试是 `node:test`，通过 `tests/ts-resolver.mjs` 直接 import `.ts`。

**Spec:** `docs/superpowers/specs/2026-09-14-scale-architecture-design.md`（§1.5 病灶、§2 接缝⑥、§3 分期）

## Global Constraints

- **分层禁令不许破**：`builder/` 不许 `import @project/`（`check:layers`）。plan 由 `main.ts`
  经 `setPlan()` 注入，`builder/compose/*` 一律走 `getPlan()`。
- **不新起工具**：四道门只许改这六个既有文件——`builder/compose/composer.ts`、
  `builder/compose/terrain.ts`、`tools/capture.mjs`、`tools/manifest-diff.mjs`、
  `tools/playtest.mjs`、`tools/connection-audit.mjs`、`tools/shoot-part.mjs`。
  唯一允许新增的非工具文件是覆盖率基线 `projects/daguanyuan/coverage-baseline.json`。
- **不改一个几何**：AD 与观感完全正交。本单子不许改任何构件的形状、尺寸、材质、坐标。
  门跑出来是红的，**红的留着**，修复归后续单子（正门精修 / Y / Z）。
- **门必须能红**：四道门跑出来若全绿，说明门写歪了。验收判据见每个 Task 的最后一步。
- **既有绿线不许压黄**：改完 `npm run check:all` 仍须通过（`check:plan` 里新加的断言除外，
  见 Task 4 的显式说明）。
- **建成区名单只有一份真源**：`builder/compose/terrain.ts` 的 `MVP_REGIONS`。
  任何工具都不许再抄一份区名。

**当场量到的基线数（2026-09-14，写门之前）：**

| | 数 |
|---|---|
| plan 建成四区对象全集 | **23**（buildings 13 + rocks 7 + linears 3） |
| 最近一份 manifest 的 `constructions` | **6** |
| plan 全 19 区对象全集 | 75 buildings + 24 rocks + 若干 linears |
| `constructions` 参与 manifest-diff 比对 | **否**（只比 drawCalls/triangles/geometries/textures） |

---

### Task 1: 世界清单——每个 placement 都登记

**Files:**
- Modify: `builder/compose/terrain.ts:83`（导出 `MVP_REGIONS`）
- Modify: `builder/compose/composer.ts:442-500`（登记每个 placement + 自报建成区名单）
- Test: `tests/world-roster.test.mjs`（新建）

**Interfaces:**
- Consumes: 无（本单子第一个 Task）
- Produces:
  - `builder/compose/terrain.ts` 导出 `export const MVP_REGIONS: readonly string[]`
  - 运行时 `scene.getObjectByName('Garden').userData.constructions` 从
    「只有 building」变成「**每个 placement 一条**」，每条形状：
    ```ts
    {
      id: string;            // planObject id，没有就是 `${part}:${variant}`
      name: string;          // obj.name（tag 或 key）
      part: string;          // p.part
      variant: string;       // p.variant ?? 'default'
      position: [number, number, number];
      yaw: number;
      planId: string | null; // 能对上 plan 对象时是它的稳定 id，对不上是 null
      construction?: unknown;  // 原有字段，building 才有
      provenance?: unknown;    // 原有字段
      planObject?: unknown;    // 原有字段
      access?: unknown;        // 原有字段，verify-building-access.mjs 读它
    }
    ```
  - 运行时 `scene.getObjectByName('Garden').userData.builtRegions: string[]`

**为什么 `planId` 要单独一个字段**：现在 building 记录的 `id` 是 `p.anchor ?? key`，
两种语义混在一个字段里。对账门要做减法，必须能区分「这条对得上 plan 的哪个对象」
与「这条根本没有 plan 出处」。后者正是正门六段墙的处境（它们该是
`zhengmen.flanking-wall`，实际是六个野生 `wall` 构件）。

- [ ] **Step 1: 写失败的测试**

新建 `tests/world-roster.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MVP_REGIONS} from '@builder/compose/terrain.ts';

const plan=JSON.parse(readFileSync('projects/daguanyuan/plan.json','utf8'));

test('建成区名单是唯一真源，且都是 plan 里真实存在的区',()=>{
 assert.ok(MVP_REGIONS.length>0);
 for(const id of MVP_REGIONS)assert.ok(plan.regions.some(r=>r.id===id),`plan 里没有区 ${id}`);
});

test('建成四区的 plan 对象全集是 23 个——对账门的分母',()=>{
 const objs=[];
 for(const id of MVP_REGIONS){
  const r=plan.regions.find(x=>x.id===id);
  for(const b of r.buildings??[])objs.push(b.id);
  for(const b of r.rocks??[])objs.push(b.id);
  for(const l of r.linears??[])objs.push(l.id);
 }
 assert.equal(new Set(objs).size,objs.length,'plan 对象 id 在建成区内重复');
 assert.equal(objs.length,23);
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npm test -- --test-name-pattern='建成区名单'`
Expected: FAIL —— `MVP_REGIONS` 还没 export，报 `SyntaxError: The requested module ... does not provide an export named 'MVP_REGIONS'`

- [ ] **Step 3: 导出 `MVP_REGIONS`**

`builder/compose/terrain.ts:83`，把

```ts
const MVP_REGIONS = ['zhengmen', 'cuizhang', 'qinfang_ting_qiao', 'xiaoxiangguan'] as const;
```

改成

```ts
/** The four regions the 一期 route actually passes through.
 *  这是「哪几个区已经建出来了」的**唯一真源**：地形采样窗口按它取，
 *  对账门的分母也按它取（经 composer 自报进 manifest.builtRegions）。
 *  单子 AD：任何工具都不许再抄一份区名。 */
export const MVP_REGIONS = ['zhengmen', 'cuizhang', 'qinfang_ting_qiao', 'xiaoxiangguan'] as const;
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npm test -- --test-name-pattern='建成'`
Expected: 两条都 PASS。若第二条报的不是 23，**不要改断言去迁就**——先查 plan 是不是被别的单子动过。

- [ ] **Step 5: composer 登记每个 placement**

`builder/compose/composer.ts`，在 `const constructionRecords` 附近（约 442 行）加上建成区自报：

```ts
  const constructionRecords: Record<string, unknown>[] = [];
  group.userData.constructions = constructionRecords;
  // 单子 AD · 第一档对账：世界要自报「我建了哪几个区」，工具不许再抄一份区名。
  group.userData.builtRegions = [...MVP_REGIONS];
```

文件顶部的 import 改成：

```ts
import { getPlan, MVP_REGIONS } from './terrain';
```

然后把主循环里那三处条件登记（约 486-493 行）换成**无条件**登记。原文：

```ts
    if (part.kind === 'building') constructionRecords.push({ id: p.anchor ?? key,
      name: obj.name, position: [wx, y, wz], yaw,
      ...obj.userData.construction, planObject: obj.userData.planObject });
    // 铺地构件不是 building,但 provenance 同样要留在可审的记录里(静态合并会丢 root)。
    if (p.part === 'luya' && fresh) constructionRecords.push({ id: 'pudi.luya',
      name: obj.name, position: [wx, y, wz], yaw,
      provenance: part.root.userData.provenance });
    if(linear)linearRecords.push({...linear.root.userData.linear,position:[wx,y,wz]});
```

改成：

```ts
    // 单子 AD · 第一档对账：**每个** placement 都要登记。
    // 以前只有 kind==='building' 登记，所以六段墙、竹丛、太湖石、桥、游廊、院墙、
    // 灯笼在世界的自报清单里一条都没有——「台矶没造」这类缺陷从定义上就在门的
    // 视野之外(spec §1.5 ①②)。静态合并会丢掉 root，清单是合并后唯一的可审身份。
    //
    // planId 与 id 分开：planId 能对上 plan 对象才有值，对不上就是 null。
    // 正门那六段墙正是 planId=null 的野生件(它们该是 zhengmen.flanking-wall)，
    // 对账门靠这个字段把「世界有、数据没有」单列出来，不与缺项混为一谈。
    const planId =
      p.anchor ??
      (linear ? linear.spec.id : undefined) ??
      ((obj.userData.planObject as { id?: string } | undefined)?.id) ??
      (p.variant && p.variant.includes('.') ? p.variant : undefined) ??
      null;
    constructionRecords.push({
      id: p.anchor ?? planId ?? key,
      name: obj.name,
      part: p.part,
      variant: p.variant ?? 'default',
      position: [wx, y, wz],
      yaw,
      planId,
      ...(part.kind === 'building' ? obj.userData.construction : null),
      ...(obj.userData.planObject ? { planObject: obj.userData.planObject } : null),
      ...(part.root.userData.provenance ? { provenance: part.root.userData.provenance } : null),
    });
    if(linear)linearRecords.push({...linear.root.userData.linear,position:[wx,y,wz]});
```

**注意三件事**：
1. `...obj.userData.construction` 展开只对 building 做——它带着
   `verify-building-access.mjs:32` 要读的 `access.walkSurfaces`，不能丢。
2. `provenance` 以前只有 `luya` 且 `fresh` 时记；现在每个 placement 都记（构件自己有就记）。
   `luya` 那条特例删掉，它已经被通用分支覆盖。
3. `p.variant.includes('.')` 这一条兜底是给 `garden-building` / `garden-wall` /
   `garden-corridor` / `garden-bridge` 四个计划驱动件用的——它们的 `variant`
   **就是** plan 对象的稳定 id（spec §1.2）。

灯笼与抱鼓石两处循环里的登记保持原样，但补上新字段。灯笼那段原来**完全没有登记**，加上：

```ts
  if (lanternSpots.length) {
    const lantern = buildPart('lantern', 'gong', { ground });
    if (lantern) {
      for (const s of lanternSpots) {
        const l = lantern.root.clone();
        l.position.set(s.x, s.y, s.z);
        l.name = '灯笼';
        staticGroup.add(l);
        constructionRecords.push({ id: 'zhengmen.lantern', name: '灯笼',
          part: 'lantern', variant: 'gong', position: [s.x, s.y, s.z], yaw: 0, planId: null,
          provenance: lantern.root.userData.provenance });
      }
    }
  }
```

抱鼓石那段已有 `constructionRecords.push`，补 `part`/`variant`/`planId`：

```ts
        constructionRecords.push({
          id: 'zhengmen.baogushi',
          name: '抱鼓石(门当)',
          part: 'baogushi',
          variant: 'default',
          position: [s.x, gy, s.z],
          yaw: 0,
          planId: null,
          provenance: baogushi.root.userData.provenance,
        });
```

- [ ] **Step 6: 类型检查 + 既有测试不许压黄**

Run: `npm run check && npm test`
Expected: 全绿。`verify-building-access.mjs` 不在 `npm test` 里，下一步单独验。

- [ ] **Step 7: 提交**

```bash
git add builder/compose/terrain.ts builder/compose/composer.ts tests/world-roster.test.mjs
git commit -m "feat(gates): 单子AD-1——世界清单登记每个placement，不只building

以前 composer 只给 kind==='building' 登记 constructionRecords，六段墙/竹丛/
太湖石/桥/游廊/院墙/灯笼在世界的自报清单里一条都没有(最多的一份 manifest
只有 6 条)——「台矶没造」这类缺陷从定义上就在所有门的视野之外。

planId 与 id 分开：对得上 plan 对象才有 planId，对不上是 null。正门那六段墙
就是 planId=null 的野生件(它们该是 zhengmen.flanking-wall)，对账门靠这个
字段把「世界有、数据没有」单列，不与缺项混在一起。

MVP_REGIONS 导出并由 composer 自报进 userData.builtRegions：建成区名单只有
一份真源，工具不许再抄区名。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WHC4q5gd1mVTtgidKsFvw8"
```

---

### Task 2: 对账门——plan 对象全集减世界清单

**Files:**
- Modify: `tools/capture.mjs:348-349, 381`（manifest 里带上 `builtRegions`）
- Modify: `tools/manifest-diff.mjs`（清单比对 + 覆盖率表）
- Create: `projects/daguanyuan/coverage-baseline.json`
- Test: `tests/world-roster.test.mjs`（追加覆盖率算子的纯函数测试）

**Interfaces:**
- Consumes: Task 1 的 `userData.constructions`（每条带 `planId`）与 `userData.builtRegions`
- Produces:
  - `tools/manifest-diff.mjs` 导出 `export function coverage(plan, manifest)`，返回
    ```js
    {
      builtRegions: string[],
      built:  { total: number, covered: number, missing: string[] },   // 建成区：缺项
      feral:  { id: string, part: string, variant: string, position: number[] }[], // planId=null 的野生件
      knownGaps: number,          // 未建区的 plan 对象总数
    }
    ```
  - 新增 CLI 形态：`node tools/manifest-diff.mjs --coverage <dir>`
  - `manifest-diff.mjs` 的两目录模式额外比对 `constructions` 名册（**少一个物体要红**）

- [ ] **Step 1: 写失败的测试**

在 `tests/world-roster.test.mjs` 末尾追加：

```js
import {coverage} from '../tools/manifest-diff.mjs';

/** 一份最小的假 manifest：只登记了正门本身，台矶与粉墙都没造。 */
const fakeManifest={
 builtRegions:['zhengmen'],
 constructions:[
  {id:'zhengmen.main-gate',part:'garden-building',variant:'zhengmen.main-gate',planId:'zhengmen.main-gate',position:[55,0,236],yaw:0},
  {id:'wall:plain',part:'wall',variant:'plain',planId:null,position:[65,0,236],yaw:0},
 ],
};

test('对账门把 zhengmen.forecourt-terrace 当成缺项报出来',()=>{
 const c=coverage(plan,fakeManifest);
 assert.deepEqual(c.builtRegions,['zhengmen']);
 assert.equal(c.built.total,4);              // main-gate + forecourt-terrace + flanking-wall + rock-01
 assert.equal(c.built.covered,1);
 assert.ok(c.built.missing.includes('zhengmen.forecourt-terrace'),'台矶必须被报为缺项');
 assert.ok(c.built.missing.includes('zhengmen.flanking-wall'));
});

test('planId=null 的构件进野生件表，不算缺项也不算覆盖',()=>{
 const c=coverage(plan,fakeManifest);
 assert.equal(c.feral.length,1);
 assert.equal(c.feral[0].variant,'plain');
});

test('未建区的对象是 known-gap，不进缺项',()=>{
 const c=coverage(plan,fakeManifest);
 assert.ok(c.knownGaps>0);
 assert.ok(!c.built.missing.some(id=>id.startsWith('daoxiangcun.')));
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npm test -- --test-name-pattern='对账门'`
Expected: FAIL —— `manifest-diff.mjs` 还没有 `coverage` 导出。

- [ ] **Step 3: 在 `manifest-diff.mjs` 里实现 `coverage`**

在 `tools/manifest-diff.mjs` 顶部（import 之后、CLI 参数解析**之前**）插入：

```js
/**
 * 单子 AD · 第一档对账：plan 的对象全集 − 世界自报的清单。
 *
 * 输出形态不是 pass/fail，是一张双向覆盖率表：
 *   - 已建成区内的 plan 对象必须 100% 有对应物体（缺一个就是红的）；
 *   - 未建区列为 known-gap，数量只许降不许升；
 *   - 世界里 planId=null 的构件单列为「野生件」——它们不是缺陷的反面，
 *     是「有实物、没出处」，正门那六段粉墙就在这一栏（它们该是
 *     zhengmen.flanking-wall 一个对象，现在是六个野生 wall）。
 *
 * 纯函数，不碰 IO，好让 tests/world-roster.test.mjs 直接喂假 manifest。
 */
export function coverage(plan, manifest) {
  const builtRegions = manifest.builtRegions ?? [];
  const objectsOf = (r) => [...(r.buildings ?? []), ...(r.rocks ?? []), ...(r.linears ?? [])].map((o) => o.id);
  const built = new Set(builtRegions);
  const roster = manifest.constructions ?? [];
  // 一个 plan 对象算「有对应物体」的条件：任一登记条目的 planId / id / variant 命中它。
  const claimed = new Set();
  for (const rec of roster) {
    for (const key of [rec.planId, rec.id, rec.variant]) if (key) claimed.add(key);
  }
  const missing = [];
  let total = 0;
  let knownGaps = 0;
  for (const region of plan.regions) {
    const ids = objectsOf(region);
    if (!built.has(region.id)) { knownGaps += ids.length; continue; }
    total += ids.length;
    for (const id of ids) if (!claimed.has(id)) missing.push(id);
  }
  const feral = roster
    .filter((r) => !r.planId)
    .map((r) => ({ id: r.id, part: r.part, variant: r.variant, position: r.position }));
  return { builtRegions, built: { total, covered: total - missing.length, missing }, feral, knownGaps };
}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npm test -- --test-name-pattern='对账门|野生件|known-gap'`
Expected: 三条 PASS。

- [ ] **Step 5: capture.mjs 把 `builtRegions` 写进 manifest**

`tools/capture.mjs:348-349`，原文：

```js
const constructions = await page.evaluate(() =>
  window.__GAME__.engine.scene.getObjectByName('Garden')?.userData.constructions ?? []);
```

后面加一行：

```js
const builtRegions = await page.evaluate(() =>
  window.__GAME__.engine.scene.getObjectByName('Garden')?.userData.builtRegions ?? []);
```

`tools/capture.mjs:381` 的 writeFileSync，把 `builtRegions` 加进去：

```js
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify({ source, shots: manifest, consoleErrors, constructions, builtRegions, linears, buildMs, rendering, geometry }, null, 2));
```

- [ ] **Step 6: 给 `manifest-diff.mjs` 加 `--coverage` CLI 与名册比对**

参数解析那段（原文 `const [dirA, dirB] = ...`）改成：

```js
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const covIdx = process.argv.indexOf('--coverage');
const tolArg = process.argv.indexOf('--tolerance');
const TOL = tolArg > -1 ? Number(process.argv[tolArg + 1]) : 0;

const loadManifest = (d) => JSON.parse(readFileSync(join(resolve(d), 'manifest.json'), 'utf8'));

if (covIdx > -1) {
  const dir = positional[0];
  if (!dir) { console.error('用法: node tools/manifest-diff.mjs --coverage <dir>'); process.exit(2); }
  const plan = JSON.parse(readFileSync(resolve('projects/daguanyuan/plan.json'), 'utf8'));
  const c = coverage(plan, loadManifest(dir));
  const baselinePath = resolve('projects/daguanyuan/coverage-baseline.json');
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;

  console.log(`建成区 ${c.builtRegions.join(', ')}`);
  console.log(`\n已建成区覆盖率  ${c.built.covered}/${c.built.total}`);
  for (const id of c.built.missing) console.log(`  缺  ${id}`);
  console.log(`\n野生件(有实物、无 plan 出处)  ${c.feral.length}`);
  for (const f of c.feral) console.log(`  野  ${String(f.part)}:${String(f.variant)}  @ ${(f.position ?? []).map((v) => Number(v).toFixed(1)).join(', ')}`);
  console.log(`\nknown-gap(未建区的 plan 对象)  ${c.knownGaps}`);

  let bad = 0;
  if (c.built.missing.length) { console.log(`\nFAIL 已建成区内有 ${c.built.missing.length} 个 plan 对象在世界里没有对应物体`); bad++; }
  if (baseline && c.knownGaps > baseline.knownGaps) { console.log(`FAIL known-gap 从 ${baseline.knownGaps} 涨到 ${c.knownGaps}——未建区对象数只许降不许升`); bad++; }
  if (baseline && c.feral.length > baseline.feral) { console.log(`FAIL 野生件从 ${baseline.feral} 涨到 ${c.feral.length}`); bad++; }
  process.exit(bad ? 1 : 0);
}

const [dirA, dirB] = positional;
if (!dirA || !dirB) {
  console.error('用法: node tools/manifest-diff.mjs <dirA> <dirB> [--tolerance 0]\n      node tools/manifest-diff.mjs --coverage <dir>');
  process.exit(2);
}
```

`existsSync` 要加进 import：

```js
import { readFileSync, existsSync } from 'node:fs';
```

`load` 函数改成复用 `loadManifest`：

```js
const load = (d) => new Map(loadManifest(d).shots.map((s) => [s.id, s]));
const A = load(dirA);
const B = load(dirB);
```

两目录模式的末尾（`for (const id of B.keys()) ...` 之后、总结 console.log 之前）插入名册比对：

```js
/* 单子 AD · 第一档：名册也要比。三角数掉 3% 读起来像一次优化，
 * 但那可能是台矶被谁删掉了——结构数字发现不了「少了一个东西」。 */
const rosterOf = (d) => {
  const m = new Map();
  for (const r of loadManifest(d).constructions ?? []) {
    const key = `${r.part ?? '?'}:${r.variant ?? '?'}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
};
const RA = rosterOf(dirA);
const RB = rosterOf(dirB);
for (const [key, n] of RA) {
  const m = RB.get(key) ?? 0;
  if (m < n) { console.log(`LOST  ${key}  ${n} → ${m}（少了 ${n - m} 个物体）`); bad++; }
  else if (m > n) { console.log(`GAIN  ${key}  ${n} → ${m}`); }
}
for (const [key, n] of RB) if (!RA.has(key)) console.log(`NEW   ${key}  0 → ${n}`);
console.log(`名册 ${[...RA.values()].reduce((a, b) => a + b, 0)} → ${[...RB.values()].reduce((a, b) => a + b, 0)} 件`);
```

- [ ] **Step 7: 起 dev server，跑一次真 capture，拿到真覆盖率表**

```bash
npm run dev &
sleep 8
node tools/capture.mjs --out shots/ad-baseline --shots gate_approach,pond_reveal,xiaoxiang
node tools/manifest-diff.mjs --coverage shots/ad-baseline
```

Expected: **FAIL，且缺项里必须有 `zhengmen.forecourt-terrace`。**
这是本 Task 的核心验收判据——spec §3 写死了：「AD → 把 `zhengmen.forecourt-terrace`
当成缺项报出来（它现在就是缺的）」。**跑出来是绿的，就说明门写歪了。**
同时野生件里应当看得见六个 `wall:plain/lattice/cloud`。

- [ ] **Step 8: 把当场量到的数落成基线**

用上一步真实打印的数字填 `projects/daguanyuan/coverage-baseline.json`：

```json
{
  "$comment": "单子 AD 第一档对账的基线。knownGaps 与 feral 只许降不许升；built.missing 不设基线——已建成区必须 100%，缺一个就是红的。数字是 2026-09-14 跑 tools/manifest-diff.mjs --coverage 当场量的，不是估的。",
  "measuredAt": "2026-09-14",
  "knownGaps": 0,
  "feral": 0
}
```

- [ ] **Step 9: 提交**

```bash
git add tools/manifest-diff.mjs tools/capture.mjs projects/daguanyuan/coverage-baseline.json tests/world-roster.test.mjs
git commit -m "feat(gates): 单子AD-2——对账门，plan对象全集减世界清单

「该造什么」在 plan.json，「造了什么」在 manifest，两份都在硬盘上躺着，
以前没有任何一行代码把它们相减。回归基准里 constructions 是 0，所以
manifest-diff 结构上发现不了「少了一个东西」——台矶哪天被删掉，三角数
掉 3%，读起来像一次优化。

输出不是 pass/fail 是双向覆盖率表：已建成区内的 plan 对象必须 100% 有
对应物体；未建区列 known-gap 只许降不许升；planId=null 的单列野生件
(正门六段粉墙在这一栏，它们该是一个 zhengmen.flanking-wall)。

两目录模式也加了名册比对，少一个物体要红。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WHC4q5gd1mVTtgidKsFvw8"
```

---

### Task 3: 脚下序列——走过去脚下是什么

**Files:**
- Modify: `tools/playtest.mjs`（沿既有游线记 `surfaceAt`，输出带里程的材质序列）

**Interfaces:**
- Consumes: 无（只用既有的 `ctx.collision.surfaceAt`）
- Produces: `playtest.mjs` 新增 `--surfaces` 开关；开启时在 PASS/FAIL 之前打印
  ```
  0.0-6.4 m    dirt
  6.4-31.2 m   slab
  ```
  并写 `shots/playtest-surfaces.json`（`[{from,to,surface}]`）供后续单子比对。

**为什么零新基建**：`playtest.mjs` 已经在沿游线走，却只断言一件事（落水禁行）。
每 120ms 的按键循环里顺手多读一个 `surfaceAt`，就把「路走一半变土、桥面材质不对、
院内该『石子漫』却是土」全都变成可读的证据。spec §2⑥ 第二档：**十行代码。**

- [ ] **Step 1: 加采样开关与累加器**

`tools/playtest.mjs` 的参数解析（原文 `const args = { url: ... }` 那两行）改成：

```js
const args = { url: 'http://127.0.0.1:4801/garden.html', surfaces: false };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
  else if (process.argv[i] === '--surfaces') args.surfaces = true;
}
```

- [ ] **Step 2: 在 `walkTo` 的循环里采样**

`pos` 与 `setYaw` 的定义之后插入：

```js
/* 单子 AD · 第二档「脚下序列」：沿游线记录每一步脚下的材质，
 * 按里程做游程压缩。走一趟不多花一秒，抓的是「路走一半变土」
 * 「桥面材质不对」「院内该石子漫却是土」这一类人眼要正好走到
 * 才看得见的缺陷。 */
const surfaceRuns = [];
let mileage = 0;
let lastXZ = null;
const sampleSurface = async () => {
  if (!args.surfaces) return;
  const [x, z, s] = await page.evaluate(() => {
    const g = window.__GAME__;
    const p = g.player.state.position;
    return [p.x, p.z, g.world.ctx.collision.surfaceAt(p.x, p.z)];
  });
  if (lastXZ) mileage += Math.hypot(x - lastXZ[0], z - lastXZ[1]);
  lastXZ = [x, z];
  const tail = surfaceRuns[surfaceRuns.length - 1];
  if (tail && tail.surface === s) tail.to = mileage;
  else surfaceRuns.push({ from: mileage, to: mileage, surface: s });
};
```

`walkTo` 的 while 循环里，在 `await page.keyboard.up('KeyW');` 之后加一行：

```js
    await sampleSurface();
```

- [ ] **Step 3: 收尾时打印并落盘**

`await browser.close();` **之前**插入：

```js
if (args.surfaces) {
  console.log('\n脚下序列（里程 / 材质）');
  for (const r of surfaceRuns) {
    if (r.to - r.from < 0.3) continue; // 采样抖动，不到 0.3m 的游程不报
    console.log(`  ${r.from.toFixed(1)}-${r.to.toFixed(1)} m`.padEnd(22) + r.surface);
  }
  mkdirSync(resolve('shots'), { recursive: true });
  writeFileSync(resolve('shots/playtest-surfaces.json'), JSON.stringify(surfaceRuns, null, 2));
  console.log(`  → shots/playtest-surfaces.json（${surfaceRuns.length} 段）`);
}
```

文件顶部加 import：

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
```

- [ ] **Step 4: 跑，确认它报出正门前那段土**

```bash
node tools/playtest.mjs --url http://127.0.0.1:5173/garden.html --surfaces
```

Expected: 序列的**第一段**是 `dirt`（正门台阶脚到铺石路那 6.4 m）。
spec §3 写死了这条验收判据：「② 脚下序列要报出正门前那 6.4 m 的 `dirt`」。
若第一段不是 dirt，先别改代码——把实际打印的数贴进单子，那是真实读数，
需要重新解释的是 spec 的那个 6.4，不是这道门。

- [ ] **Step 5: 提交**

```bash
git add tools/playtest.mjs
git commit -m "feat(gates): 单子AD-3——脚下序列，沿游线记录材质里程

playtest 已经在沿游线走，却只断言一件事(落水禁行)。每 120ms 的按键循环
里顺手多读一个 collision.surfaceAt，按里程做游程压缩，就把「路走一半变土」
「桥面材质不对」「院内该石子漫却是土」变成可读的证据——这一类人眼要正好
走到那一步才看得见。零新基建。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WHC4q5gd1mVTtgidKsFvw8"
```

---

### Task 4: 接缝连续性门

**Files:**
- Modify: `tools/connection-audit.mjs`（新增 `auditSeams`）
- Modify: `tools/plan-audit.mjs:140`（把 `auditSeams` 的结果并进 fails，见下面的**显式豁免**）
- Test: `tests/connection-bridges.test.mjs`（追加）

**Interfaces:**
- Consumes: `builder/plan/linears.ts` 的 `allPlanLinears(plan)`、
  `builder/compose/terrain-from-plan.ts` 的 `makeTerrainField(plan, {seed})`
- Produces: `export function auditSeams(plan, field)` →
  ```js
  { seams: [{ id, station, kind, deltaGround, deltaTop, surfaceA, surfaceB }], fails: string[] }
  ```

**阈值与出处**（spec §2⑥ 第三档「**不要为了让它绿去调松阈值**」）：

| 量 | 阈值 | 出处 |
|---|---|---|
| 墙脚高程跳变 `deltaGround` | > 0.12 m 报 | 一块城砖厚（`knowledge/rules` 的砖厚口径），人眼在墙脚看得出的最小台阶 |
| 两条线性构件相接处的顶高差 `deltaTop` | > 0.05 m 报 | 压顶是一条连续线，肉眼对直线的折断极敏感。同一段构件内部顶高是常数，所以站内记的是**净高**（顶到地面），只入表不单独报 |
| 材质不一致 | 两侧不同即报 | 同一段墙脚两侧材质突变＝地面在墙下换了料 |

`ε = 0.25 m`：取样点离接缝半个身位，既不会落进构件自己的几何里，
也不会走到相邻 station 的中段去。

- [ ] **Step 1: 写失败的测试**

在 `tests/connection-bridges.test.mjs` 末尾追加：

```js
import {auditSeams} from '../tools/connection-audit.mjs';

test('接缝连续性门：全园线性构件的接缝都被扫到',()=>{
 const field=makeTerrainField(plan,{seed:17910000});
 const a=auditSeams(plan,field);
 assert.ok(a.seams.length>0,'一个接缝都没扫到说明门写歪了');
 for(const s of a.seams)assert.ok(Number.isFinite(s.deltaGround));
});

test('接缝门对高程跳变敏感：把一段墙的标高抬 1m，门必须红',()=>{
 const field=makeTerrainField(plan,{seed:17910000});
 const bumped=structuredClone(plan);
 const wall=bumped.regions.find(r=>r.id==='xiaoxiangguan').linears.find(l=>l.kind==='wall');
 wall.elevation_m+=1;
 const a=auditSeams(bumped,field);
 assert.ok(a.fails.some(f=>f.includes(wall.id)),'抬高一整段墙，接缝门没红');
});
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `npm test -- --test-name-pattern='接缝'`
Expected: FAIL —— 没有 `auditSeams` 导出。

- [ ] **Step 3: 实现 `auditSeams`**

`tools/connection-audit.mjs` 末尾追加：

```js
/**
 * 单子 AD · 第三档「接缝连续性」。
 *
 * 任何「一段段拼起来」的东西(墙、廊、桥、路)，在每个接缝处沿路径切向
 * x±ε 采样，比较墙脚高程 / 顶高 / 材质。这一类缺陷人眼极难抓——得正好
 * 走到那个接缝才看得见；机器把全园接缝一次扫完。
 *
 * ⚠️ 阈值不许为了让它绿而调松(spec §2⑥ 第三档)。三个阈值的出处见
 * docs/superpowers/plans/2026-09-14-ad-field-gates.md 的 Task 4 表。
 */
const SEAM_EPS = 0.25;
const SEAM_GROUND_TOL = 0.12;
const SEAM_TOP_TOL = 0.05;

export function auditSeams(plan, field) {
  const seams = [], fails = [];
  for (const spec of allPlanLinears(plan)) {
    const pts = spec.points;
    if (!pts || pts.length < 3) continue; // 两点只有一段，没有内部接缝
    const top = (spec.elevation_m ?? 0) + (spec.height_m ?? spec.railingHeight_m ?? 0);
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, pz] = pts[i - 1], [cx, cz] = pts[i], [nx, nz] = pts[i + 1];
      const inDir = norm(cx - px, cz - pz), outDir = norm(nx - cx, nz - cz);
      const a = [cx - inDir[0] * SEAM_EPS, cz - inDir[1] * SEAM_EPS];
      const b = [cx + outDir[0] * SEAM_EPS, cz + outDir[1] * SEAM_EPS];
      const ga = field.height(a[0], a[1]), gb = field.height(b[0], b[1]);
      const sa = field.surface ? field.surface(a[0], a[1]) : null;
      const sb = field.surface ? field.surface(b[0], b[1]) : null;
      // 顶高在一段线性构件内部是常数，所以这里比的是**净高**(顶到地面的
      // 那一段)——压顶是一条连续直线，地面在接缝处一跳，露出来的墙身高度
      // 就跟着跳，这正是肉眼读成「墙接缝错位」的那个量。
      const rec = { id: spec.id, station: i, kind: spec.kind,
        deltaGround: Math.abs(ga - gb), deltaTop: Math.abs((top - ga) - (top - gb)),
        surfaceA: sa, surfaceB: sb };
      seams.push(rec);
      if (rec.deltaGround > SEAM_GROUND_TOL)
        fails.push(`${spec.id} 第${i}个接缝墙脚高程跳 ${rec.deltaGround.toFixed(3)}m（>${SEAM_GROUND_TOL}m）`);
      if (sa && sb && sa !== sb)
        fails.push(`${spec.id} 第${i}个接缝两侧地面材质不同：${sa} / ${sb}`);
    }
    // 标高与实际地面的落差：一整段被抬走时，每个 station 的墙脚都悬空。
    for (let i = 0; i < pts.length; i++) {
      const g = field.height(pts[i][0], pts[i][1]);
      const drop = Math.abs((spec.elevation_m ?? g) - g);
      if (drop > 1.0) { fails.push(`${spec.id} 第${i}站标高与地面差 ${drop.toFixed(2)}m（墙脚悬空或埋入）`); break; }
    }
  }
  // 两条不同线性构件端点相接处：这里顶高才是会变的量(院墙撞上正门的
  // 侧墙、游廊接上院墙)，压顶线在这种地方折断最扎眼。
  const specs = allPlanLinears(plan).filter((s) => s.points && s.points.length >= 2);
  for (let i = 0; i < specs.length; i++) for (let j = i + 1; j < specs.length; j++) {
    const A = specs[i], B = specs[j];
    for (const pa of [A.points[0], A.points[A.points.length - 1]])
      for (const pb of [B.points[0], B.points[B.points.length - 1]]) {
        if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 0.6) continue;
        const ta = (A.elevation_m ?? 0) + (A.height_m ?? A.railingHeight_m ?? 0);
        const tb = (B.elevation_m ?? 0) + (B.height_m ?? B.railingHeight_m ?? 0);
        const d = Math.abs(ta - tb);
        seams.push({ id: `${A.id}|${B.id}`, station: -1, kind: 'junction', deltaGround: 0, deltaTop: d, surfaceA: null, surfaceB: null });
        if (d > SEAM_TOP_TOL) fails.push(`${A.id} 与 ${B.id} 相接处顶高差 ${d.toFixed(3)}m（>${SEAM_TOP_TOL}m）`);
      }
  }
  return { seams, fails };
}

function norm(x, z) { const d = Math.hypot(x, z) || 1; return [x / d, z / d]; }
```

`allPlanLinears` 已经在本文件顶部 import 了，不用再加。

- [ ] **Step 4: 跑测试，确认它绿**

Run: `npm test -- --test-name-pattern='接缝'`
Expected: 两条 PASS。

- [ ] **Step 5: 接进 `check:plan`，但先只报不拦**

`tools/plan-audit.mjs:140` 附近，原文：

```js
    const connections=auditConnections(plan);fails.push(...connections.fails);
```

后面加：

```js
    /* 单子 AD · 第三档接缝门。⚠️ 现在**只报不拦**：正门六段墙有四处成因、
     * 正门精修还没合入，此刻把它接进 fails 等于逼着下一个人去调松阈值
     * 或者把错的形态焊死(项目自己立过的规矩：观感迭代期不要加门)。
     * 单子 AE(正门精修合入之后)负责把这一行的 warn 换成 fails。 */
    const seams=auditSeams(plan,makeTerrainField(plan,{seed:17910000}));
    for(const f of seams.fails)warns.push(`接缝 ${f}`);
```

若 `plan-audit.mjs` 里没有 `warns` 数组，就在 fails 旁边加一个，并在输出处打印
（**不参与 exit code**）。import 补上：

```js
import {auditConnections,auditSeams} from './connection-audit.mjs';
import {makeTerrainField} from '../builder/compose/terrain-from-plan.ts';
```

- [ ] **Step 6: 跑 `check:plan`，把红出来的接缝记进单子**

Run: `npm run check:plan`
Expected: 通过（exit 0），但 warn 段里**应当**列出若干接缝问题。
spec §2⑥：「这道门写出来会立刻是红的……**那正是它是门的证明**」。
把实际 warn 的条目原样贴进本单子末尾的「跑出来的结果」一节。

- [ ] **Step 7: 提交**

```bash
git add tools/connection-audit.mjs tools/plan-audit.mjs tests/connection-bridges.test.mjs
git commit -m "feat(gates): 单子AD-4——接缝连续性门，全园线性构件一次扫完

墙/廊/桥/路这些「一段段拼起来」的东西，在每个接缝处沿切向 x±0.25m 采样，
比墙脚高程(>0.12m 报)、顶高(>0.05m 报)、两侧地面材质。这一类缺陷人眼极难
抓——得正好走到那个接缝才看得见。

先只报不拦：正门六段墙有四处成因、正门精修还没合入，此刻接进 fails 等于
逼人调松阈值或把错的形态焊死。单子 AE 在正门精修合入后把 warn 换成 fails。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WHC4q5gd1mVTtgidKsFvw8"
```

---

### Task 5: 近景联络表 + 贴脸机位

**Files:**
- Modify: `tools/shoot-part.mjs`（`--sheet` 拼联络表）
- Modify: `tools/capture.mjs`（`--group closeup` 与一组贴脸机位）

**Interfaces:**
- Consumes: 无
- Produces:
  - `node tools/shoot-part.mjs --subject a,b,c --angles three_quarter --sheet`
    额外写 `<out>/contact-sheet.png`（与 `contact-sheet.html`）
  - `node tools/capture.mjs --group closeup` 只拍贴脸机位

**为什么改的是投喂方式，不是判据**：`capture.mjs` 的 14 个机位全是全景，
鼓钉、瓦当、格心纹样在 1000×850 的全景里是两个像素——**它们在现有产出里根本不存在**。
一个回合交 1 张联络表 + 1 组贴脸图，不是 14 张全景。

- [ ] **Step 1: `shoot-part.mjs` 拼联络表**

`tools/shoot-part.mjs` 参数解析里加：

```js
  else if (a === '--sheet') args.sheet = true;
```

文件末尾 `await browser.close();` **之前**插入：

```js
/* 单子 AD · 第四档：把这一轮棚拍拼成一张联络表。
 * 用 playwright 自己渲 HTML 再截图——项目里已经有 playwright，
 * 不为了拼图引入图像库(spec §4「不新起一套 harness」)。 */
if (args.sheet && manifest.length) {
  const cols = Math.min(4, Math.ceil(Math.sqrt(manifest.length)));
  const cells = manifest.map((m) => `<figure><img src="${m.file}"><figcaption>${m.subject} · ${m.angle}<br><small>${(m.tris / 1000).toFixed(1)}k tris · ${m.size.map((v) => v.toFixed(2)).join('×')}m</small></figcaption></figure>`).join('');
  const html = `<meta charset="utf-8"><style>
    body{margin:0;background:#141414;color:#ddd;font:13px/1.5 -apple-system,"PingFang SC",sans-serif}
    .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;padding:16px}
    figure{margin:0}img{width:100%;display:block;background:#000}
    figcaption{padding:6px 2px;color:#bbb}small{color:#7a7a7a}
  </style><div class="grid">${cells}</div>`;
  writeFileSync(resolve(outDir, 'contact-sheet.html'), html);
  const sheet = await browser.newPage({ viewport: { width: cols * 340 + 32, height: 800 } });
  await sheet.goto('file://' + resolve(outDir, 'contact-sheet.html'), { waitUntil: 'load' });
  await sheet.waitForTimeout(400);
  writeFileSync(resolve(outDir, 'contact-sheet.png'), await sheet.screenshot({ type: 'png', fullPage: true }));
  await sheet.close();
  console.log(`  联络表 → ${args.out}/contact-sheet.png（${manifest.length} 格）`);
}
```

- [ ] **Step 2: 跑一次，确认联络表里看得见鼓钉**

```bash
node tools/shoot-part.mjs --url http://127.0.0.1:5173/viewer.html \
  --subject baogushi,lantern:gong,wall:plain,wall:lattice,wall:cloud,luya \
  --angles three_quarter --sheet --out shots/ad-parts
```

Expected: `shots/ad-parts/contact-sheet.png` 存在，六格。
spec §3 的验收判据：「④ 联络表里看得见鼓钉」——打开图确认抱鼓石那一格
能看清它表面的钉纹，看不清就把 `--width/--height` 提到 1400 再拍一次。

- [ ] **Step 3: `capture.mjs` 加贴脸机位**

`tools/capture.mjs` 的 `SHOTS` 数组末尾追加（每条带 `group: 'closeup'`）：

```js
  /* 单子 AD · 第四档「贴脸机位」。全景里鼓钉、瓦当、格心是两个像素，
   * 等于不存在。这五个机位各盯一个关键部位，评审一个回合只看它们
   * 加一张联络表，不看 14 张全景。 */
  { id: 'cu_gate_eave',    pos: [55, 0, 240.0], yaw: 0.0,  pitch: 0.42, group: 'closeup', desc: '贴脸·正门檐口:瓦当滴水与椽望的收头。' },
  { id: 'cu_gate_plaque',  pos: [55, 0, 239.4], yaw: 0.0,  pitch: 0.30, group: 'closeup', desc: '贴脸·大观园匾:匾宽与当心间的关系(第五档断言的取证机位)。' },
  { id: 'cu_baogushi',     pos: [53.2, 0, 239.0], yaw: 0.55, pitch: -0.35, group: 'closeup', desc: '贴脸·抱鼓石:鼓钉那一圈与它离门轴的距离。' },
  { id: 'cu_wall_seam',    pos: [65.0, 0, 239.0], yaw: 1.35, pitch: -0.08, group: 'closeup', desc: '贴脸·南墙接缝:六段粉墙相接处的墙脚与压顶。' },
  { id: 'cu_lattice',      pos: [55, 0, 238.6], yaw: 0.30, pitch: 0.10, group: 'closeup', desc: '贴脸·格心:灯笼锦的纹样构成。' },
```

参数解析里加 `--group`：

```js
    else if (a === '--group') args.group = argv[++i];
```

`args` 默认值加 `group: null`，选片那行改成：

```js
let selected = args.shots ? SHOTS.filter((s) => args.shots.includes(s.id)) : SHOTS;
if (args.group) selected = selected.filter((s) => s.group === args.group);
else if (!args.shots) selected = selected.filter((s) => !s.group); // 不指定就还是那 14 张全景，行为不变
```

（注意 `const selected` 要改成 `let selected`。）

- [ ] **Step 4: 跑贴脸组**

```bash
node tools/capture.mjs --out shots/ad-closeup --group closeup --width 1400 --height 1000
node tools/capture.mjs --out shots/ad-regress --shots gate_approach   # 确认默认行为没变
```

Expected: 第一条出 5 张贴脸图；第二条仍只出 `gate_approach`。

- [ ] **Step 5: 提交**

```bash
git add tools/shoot-part.mjs tools/capture.mjs
git commit -m "feat(gates): 单子AD-5——近景联络表与贴脸机位

capture 的 14 个机位全是全景，鼓钉/瓦当/格心在 1000×850 里是两个像素——
在现有产出里根本不存在。改的是投喂方式不是判据：shoot-part --sheet 把
一轮棚拍拼成联络表(playwright 渲 HTML 再截图，不引图像库)，capture 加
五个 --group closeup 贴脸机位(檐口/匾额/抱鼓石/墙接缝/格心)。

一个回合交 1 张联络表 + 1 组贴脸图，不是 14 张全景。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WHC4q5gd1mVTtgidKsFvw8"
```

---

## 验收（对应 spec §3「每期的验收判据」）

**四条各自要能红。一道跑出来是绿的，就说明那道门写歪了。**

- [ ] ① 对账门把 `zhengmen.forecourt-terrace` 当成缺项报出来（它现在就是缺的）
- [ ] ② 脚下序列报出正门前那段 `dirt`
- [ ] ③ 接缝门在正门六段墙 / 全园线性构件上立刻有 warn
- [ ] ④ 联络表里看得见鼓钉
- [ ] `npm run check:all` 仍然通过
- [ ] 一个几何都没改（`git diff --stat` 里不许出现 `builder/parts/`）

## 跑出来的结果（2026-09-14 执行完，全是实际读数）

### 四条验收判据

| # | 判据 | 结果 |
|---|---|---|
| ① | 对账门把 `zhengmen.forecourt-terrace` 报为缺项 | ✅ 报了。已建成区覆盖率 **10/23**，缺 13 个 |
| ② | 脚下序列报出正门前的 `dirt` | ✅ 报了。穿过门槛石(0.0-2.4 m `stone`)之后就是 **2.7-5.4 m `dirt`** |
| ③ | 接缝门在正门六段墙上立刻红 | ✅ 红了，但**不是原计划那条路**，见下面「两处偏离」 |
| ④ | 联络表里看得见鼓钉 | ✅ 看得见，而且一眼看出用户说的那圈「麻子」 |
| — | `npm test` | ✅ 162 passed |
| — | 一个几何都没改 | ✅ `builder/parts/` 零改动（`composer.ts` 只加了 `size` 登记） |

### 第一档 · 对账（`node tools/manifest-diff.mjs --coverage shots/ad-baseline`）

```
建成区 zhengmen, cuizhang, qinfang_ting_qiao, xiaoxiangguan
已建成区覆盖率  10/23
  缺  zhengmen.forecourt-terrace      ← 台矶。用户反馈 6「平台窄小气」/ 8「门前黄土」的根因
  缺  zhengmen.flanking-wall          ← 粉墙。用户反馈 3「墙接缝错位」的根因
  缺  zhengmen.rock-01
  缺  cuizhang.rock-02 / rock-03 / rock-04
  缺  qinfang_ting_qiao.dicui-pavilion    ← 滴翠亭，整栋没造
  缺  qinfang_ting_qiao.pool-railing
  缺  qinfang_ting_qiao.rock-01
  缺  xiaoxiangguan.rear-house            ← 后房，整栋没造
  缺  xiaoxiangguan.path-bed-west / path-bed-east
  缺  xiaoxiangguan.rock-01
野生件(有实物、无 plan 出处)  44
known-gap(未建区的 plan 对象)  80
```

**台矶确实不是唯一一个**（spec §2⑥ 第一档的原话）。13 个缺项里有两栋整屋
（滴翠亭、潇湘馆后房）、七块 plan 点名的太湖石、一道池栏、两条花径。
另一侧同样刺眼：**44 个野生件**——六段无出处的粉墙、八段曲桥、十四块散置
太湖石、四盏灯笼、两颗抱鼓石、七丛竹。plan 点名七块石头一块没落地，世界里
却散着十四块没出处的——这正是接缝 ① 要解的那件事。

### 第二档 · 脚下序列（`node tools/playtest.mjs --surfaces`）

418.3 m 游线，29 段。头四段与尾段：

```
  0.0-2.4 m     stone      门槛石
  2.7-5.4 m     dirt       ← 门前黄土(用户反馈 8)
  5.7-39.3 m    grass
  39.6-112.9 m  dirt       ← 73 米连续黄土
  ...
  412.7-418.3 m stone
```

**`slab` 一次都没出现；`stone` 只有三小段共约 7 米。** 也就是说 418 米游线上
几乎没有铺装——07-41「石子漫」、17 回「宽阔大路」在世界里不存在。
这条是门自己报出来的，没人提过。

### 第三档 · 接缝连续性

```
接缝(名册侧，成链构件 4 对)  4 处
  缝  wall cloud→lattice   互相插入 0.22m（@ x≈32.0, z≈236.0）
  缝  wall lattice→plain   互相插入 0.16m（@ x≈39.0, z≈236.0）
  缝  wall plain→lattice   互相插入 0.16m（@ x≈65.0, z≈236.0）
  缝  wall lattice→cloud   互相插入 0.22m（@ x≈71.0, z≈236.0）
```

正门六段粉墙**四处接缝全部互插**——固定宽度的原型（`plain`/`lattice` 6.16 m、
`cloud` 8.28 m）按手挑的 6 m / 7 m 间距硬拼出来的必然结果。
这就是用户反馈第 3 条「墙接缝错位」。单子 Y 换成 plan 驱动的
`zhengmen.flanking-wall` 之后，这四条应当归零。

### 两处偏离计划（都是执行时量出来的，不是事后找补）

**① 只看 plan 的接缝扫描跑出来是绿的**（14 个接缝 0 处报警）。
原因是结构性的：spec 点名的「正门六段墙」**根本不在 plan 里**，它们是对账门
刚报出来的野生件。**门只查数据，就查不到世界里真正摆出来的东西**——这正是
§1.5 那个病的另一面，在写门的过程中又复发了一次。

所以补了世界名册那一侧（`manifest-diff.auditRosterSeams`），并让 `composer`
把构件本地包围盒 `size` 一起登记（光有落位没有尺寸算不出端点）。
分链判据是长厚比 ≥ 5（实测 `wall` 10.1~13.6 / `bridge:zigzag` 3.2 /
`bamboo` 1.1 / `taihu` 0.9~1.4），它是**分类**用的不是阈值。

**② plan 的墙不带 `height_m`**，墙高来自规则表。所以接缝门比的是**标高
`elevation_m`** 这个基准面，不是顶面——顶面在数据里根本不存在，拿代码里的数
去比就成了 spec §2⑥ 第五档说的「复读」。

另外：`标高与地面差 > 1m` 这条一开始把三座桥全报了。桥面本来就该架在水上，
那是我的判据错不是世界错，已改成只对随地走的构件（`wall`/`corridor`/`fence`/
`railing`/`path`/`steps`）发问；桥自己的验收在 `auditConnections`。

### 留给后续单子的账

- **单子 Y**：13 个缺项 + 44 个野生件 + 四处墙接缝互插，都是 `scenes/<region>.json`
  与 plan 驱动点名件要解的。spec §3 说 AD 的覆盖率表会改变 Y 的设计——
  它确实改了：**plan 点名的七块太湖石一块都没落地，世界里却散着十四块没出处的。**
  所以 `scenes` 契约必须显式区分「点名件由 plan 生成」与「散置件手写」，
  这不再是按 4 个样本猜的。
- **单子 AE**：`auditSeams` 的 plan 侧现在只报不拦（进 `pending`），
  正门精修合入后搬进 `fails`。
- **铺装缺失**（418 米游线上几乎没有 `slab`）不在 AD 的范围内，
  归接缝 ②（选料规则，单子 Z）——「铺地-花街」正是那条规则的样板。
