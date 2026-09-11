# 门厅与《营造法式》图解页 实施计划

> **给执行的 agent**：本文件既是计划也是分派单，两张单子在末尾。

**目标**：首页改成两个入口——**营造法式**（构件图解小百科）与**大观园**（现在的园子）；
同时把继承自 pallet-town-3d 的整层界面换成我们自己的。

**为什么放在一起**：两件事共用同一套视觉语言。分开做会出两套。

**前置已完成**：`engine/ui/tokens.css`（设计令牌）与 `ART_DIRECTION.md §9`（隐喻与理由）
已由派单人先建好（`f152a4a2`）。**两张单子都只读它，谁都不要改它**——上一轮 A/B 就是
两个 agent 各改同一个文件互相覆盖的。真要加令牌，回报给派单人。

## 全局约束

- 工作目录 `~/Workspace/games/daguanyuan`，分支 `editor`。
- 收工前 `npm run check:all` 全过（含 `check:docs`）。
- **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器**（PITFALLS P-15）。
- preview 一律带 `--strictPort`（PITFALLS P-11）。
- **界面文字用简体，原文引句保持繁体**，两者用无衬线与衬线分开（`ART_DIRECTION.md §9`）。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

## 路由：园子要搬家

```
/                门厅（纯静态 HTML，秒开）          ← 新
/garden.html     园子（现在的 index.html）          ← 搬
/fashi.html      营造法式图解                       ← 新
/viewer.html     构件棚拍台（工具，不改）
```

**门厅必须是纯静态的。** 世界构建要 13.4 秒，门厅和园子不能是同一个页面——
否则点进来先黑屏十几秒，那正是我们要消灭的第一印象。

**搬家的代价要一次付清**：`tools/capture.mjs`、`tools/playtest.mjs`、`tools/loadshot.mjs`
的默认 URL 都指着 `/`，全部改成 `/garden.html`；`vite.config.ts` 的 `rollupOptions.input`
从两个入口加到四个。漏一个，收工时截图和试玩会截到门厅。

---

## Task 1 · UI 换血（门厅 + 加载 + 按键提示 + 准星 + 光标）

**现状**：`engine/ui/ui.css` 660 行里有 **139 处 `pt-` 前缀**（pallet-town），
`engine/ui/Menu.ts` 加载完还会显示一句字面的 `'Welcome home'`。这不是调样式，是整层换掉。

**Files:**
- Create: `index.html`（改成门厅）、`projects/daguanyuan/frontdoor.ts`（如果门厅需要脚本；能纯 HTML/CSS 就不要建）
- Move: 现在的 `index.html` → `garden.html`
- Modify: `engine/ui/ui.css`、`engine/ui/Menu.ts`、`engine/ui/HUD.ts`、`engine/ui/Dialogue.ts`、
  `vite.config.ts`、`tools/capture.mjs`、`tools/playtest.mjs`、`tools/loadshot.mjs`

**要做的**

1. **前缀换名**：`pt-` → `dgy-`。139 处，机械替换，但要逐个确认没有漏网的字符串拼接。
2. **删掉 `'Welcome home'`**，换成我们自己的收尾文案。加载步骤名已经是中文的
   （开天 / 理地 / 引水 / 植树 / 起屋叠石），这套很好，**保留**。
3. **门厅**：标题、一句副题、两张入口卡（营造法式 / 大观园）。
   纯 HTML + CSS，不引 three，不引任何 CDN。
   - 大观园那张卡要**提前说明"进去要等十几秒"**，并在点击后立刻给反馈，
     不要让人对着白屏猜。
4. **加载界面**：用令牌重做。`pt-mark` 那个圆环徽标是继承来的，**换掉**——
   它现在读起来像个球。
5. **按键提示与准星**：`HUD.ts` 的 `crosshair` / `promptKey` / `hint`。
   按 `ART_DIRECTION.md §9`：**压在场景上的这几样用绢色与一丝石绿，不上金。**
6. **鼠标光标**：现在是浏览器默认。给门厅与图解页一个自定义光标（CSS `cursor: url(...)`，
   内联 data URI，不要外部文件）；**园子里指针锁定后光标本来就隐藏，不要动它**。

**验收**

- `node tools/loadshot.mjs` 出加载界面的静态渲染交人眼（**不要直接截真页面**——
  世界构建占死主线程，截图会超时，见 PITFALLS P-12）。
- `node tools/playtest.mjs --url http://127.0.0.1:4801/garden.html` 仍 `PLAYTEST PASS`。
- `node tools/capture.mjs --url http://127.0.0.1:4801/garden.html --out shots/ui` 14 镜全出。
- `grep -rn "pt-" engine/ projects/ index.html garden.html` **无输出**。
- `grep -rn "Welcome home" .` 无输出。

---

## Task 2 · 《营造法式》图解页

**这一页的价值不在几何，在出处。** 点一件构件，它要能回答
「这个数出自《营造法式》卷四，两名核验者通过」「这一处三个口径差 32%，我们取了法式本」
「这一处史料没有，为观感取了 0.85」。**不接出处的话，它和任何一个古建模型库没有区别。**

**Files:**
- Create: `fashi.html`、`projects/daguanyuan/fashi.ts`、`projects/daguanyuan/fashi.css`（或并进 fashi.ts）
- Create: `projects/daguanyuan/gallery/thumbs/*.png`（预烘焙缩略图，入库）
- Create: `tools/shoot-gallery.mjs`（重烘焙脚本）
- Modify: `vite.config.ts`（加入口）

**结构**

- **格子图自动长。** 从 `builder/parts/registry` 的 `partNames()` 枚举，**不要手维护清单**——
  P3 加构件就自动进柜。现在有 5 族（`bamboo` / `bridge` / `building` / `taihu` / `wall`）各带变体。
- **格子里是预烘焙的 PNG，点开才起 3D。** 一屏几十个实时 3D 会把页面拖死。
  烘焙复用 `tools/shoot-part.mjs` 的做法，产物提交进库（`shots/` 是 gitignore 的，别放那儿）。
- **点开一件**：三维转盘（复用 `projects/daguanyuan/viewer.ts` 的渲染设置，那套棚拍灯光是调好的）
  \+ 右侧出处栏。

**出处栏怎么取数**

- 大木构件（`building` 各变体）走 `deriveBuilding(spec).provenance`，三支分别列出，
  每条给规则 id、名称、原文引句、状态。
- **`components.rules.json` 的 37 个斗拱本体没有几何**（P3 才做）。
  把它们做成**数据卡**：列出分件构成、`dimensions` 引的规则 id，并**明确标注"尚无几何"**。
  这不丢人——它恰好展示了这条流水线走到哪一步了。
- **墙、石、竹、桥没有规则出处**，它们是程序化造型。
  **不许给它们编出处。** 显示"此件为程序化造型，无营造规则来源"，并指向 `ART_DIRECTION.md`。

**三条铁律**

1. **不许伪造出处。** 一个数出现在页面上，就要能点回它的规则 id。
   取不到就说取不到——`RuleBook` 取不到会抛，把错误显示出来，不要 try/catch 吞掉填个默认值。
2. **颜色不要新发明。** 三支出处与规则状态的配色已经在 `tokens.css` 里，
   与规则状态机同一套语义（`ART_DIRECTION.md §9` 有对照表）。
3. **原文引句用衬线体保持繁体**，我们写的说明用无衬线简体。字体的区别就是
   "这是书里说的"与"这是我们说的"的分界，不必再加引号或底色。

**验收**

- 页面能走完：门厅 → 营造法式 → 点开一件 → 看到出处 → 返回。
- **随机抽三件**，页面上显示的规则 id 与 `knowledge/rules/*.json` 对得上，引句一字不差。
- 至少一件展示 `refuted` 或 `missing` 状态（例如 `fayuan:05-06` 或 `99-02`），
  证明"我们不知道"也是可展示的内容。
- 一屏格子图的加载 < 1 秒（缩略图是 PNG，不是实时 3D）。
- `npm run check:all` 全过。

---

## 分派单

### 单子 H — UI 换血

> 在 `~/Workspace/games/daguanyuan` 做本计划的 **Task 1：UI 换血**。
> 完整步骤见 `docs/superpowers/plans/2026-09-11-frontdoor-and-fashi-gallery.md` 的 Task 1。
>
> 你碰：`index.html`（改成门厅）、`garden.html`（由现 index.html 搬来）、
> `engine/ui/ui.css`、`engine/ui/Menu.ts`、`engine/ui/HUD.ts`、`engine/ui/Dialogue.ts`、
> `vite.config.ts`、`tools/capture.mjs`、`tools/playtest.mjs`、`tools/loadshot.mjs`。
>
> **`engine/ui/tokens.css` 只读，不许改。** 单子 I 也在读它。真要加令牌，停下来回报。
> **`fashi.html` / `projects/daguanyuan/fashi.*` 是单子 I 的，不要碰。**
> `vite.config.ts` 两张单子都要加入口——**你只加 `garden` 那一项，`fashi` 留给 I**。
>
> **开工前必读**：`ART_DIRECTION.md §9`（隐喻与理由，以及"压在场景上的 HUD 不上金"这条）、
> `engine/ui/tokens.css` 的头注释、`docs/PITFALLS.md` 的 P-11 与 **P-12**。
>
> **四件事不要搞错**：
> 1. **园子要搬到 `/garden.html`，门厅占 `/`。** 门厅必须纯静态——世界构建 13.4 秒，
>    两者同页就是进来先黑屏十几秒。搬家的代价一次付清：三个 tools 的默认 URL 全改，
>    漏一个收工时截图和试玩会截到门厅。
> 2. **不要直接截真页面看加载界面**——世界构建占死主线程，`page.screenshot()` 会超时
>    （PITFALLS P-12）。用 `tools/loadshot.mjs`，它把 CSS 与 DOM 单独渲染到空白页。
> 3. **`'Welcome home'` 是继承来的字面文案，删掉。** 但加载步骤名（开天/理地/引水/植树/起屋叠石）
>    是我们自己的，**保留**。`pt-mark` 那个圆环徽标也换掉，它现在读起来像个球。
> 4. **HUD 压在场景上，按 §9 用绢色与一丝石绿，不上金。** 泥金只在门厅和加载。
>
> 交付：`grep -rn "pt-"` 无输出、`grep -rn "Welcome home"` 无输出、
> `loadshot` 出图交人眼、`playtest --url .../garden.html` PASS、`capture` 14 镜全出、
> `npm run check:all` 全过、提交。
> 回报：换了多少处前缀、门厅长什么样（附 loadshot 截图路径）。

**规模**：中。**风险**：低偏中——最容易漏的是 tools 的默认 URL。

### 单子 I — 《营造法式》图解页

> 在 `~/Workspace/games/daguanyuan` 做本计划的 **Task 2：营造法式图解页**。
> 完整步骤见 `docs/superpowers/plans/2026-09-11-frontdoor-and-fashi-gallery.md` 的 Task 2。
>
> 你碰：`fashi.html`（新建）、`projects/daguanyuan/fashi.ts`、`projects/daguanyuan/fashi.css`、
> `projects/daguanyuan/gallery/thumbs/`（新建，缩略图入库）、`tools/shoot-gallery.mjs`（新建）、
> `vite.config.ts`（**只加 `fashi` 那一项，`garden` 留给单子 H**）。
>
> **`engine/ui/tokens.css` 只读，不许改。** 单子 H 也在读它。
> **`index.html` / `garden.html` / `engine/ui/*` 是单子 H 的，不要碰。**
> H 会把园子搬到 `/garden.html`——你的门厅返回链接指向 `/` 就行，不用管它什么时候搬完。
>
> **开工前必读**：`ART_DIRECTION.md §9`（三支出处的配色对照表）、`engine/ui/tokens.css`、
> `projects/daguanyuan/viewer.ts`（棚拍灯光已调好，直接复用）、
> `builder/derive/index.ts` 的 `deriveBuilding` 与 `Frame.provenance`、
> `knowledge/rules/components.rules.json`、`docs/PITFALLS.md` 的 P-11。
>
> **这一页的价值不在几何，在出处。** 点一件构件要能回答「这个数出自卷四，两名核验者通过」
> 「这一处三个口径差 32%，我们取了法式本」「这一处史料没有，为观感取了 0.85」。
> **不接出处的话，它和任何一个古建模型库没有区别。**
>
> **三条铁律**：
> 1. **不许伪造出处。** 页面上出现的数要能点回规则 id。`RuleBook` 取不到会抛——
>    **把错误显示出来，不要 try/catch 吞掉填个默认值**。这正是 P1 花了整整一期要消灭的东西。
> 2. **颜色不要新发明。** 三支出处与五种规则状态的配色已在 `tokens.css`，
>    与规则状态机同一套语义，`ART_DIRECTION.md §9` 有对照表。
> 3. **原文引句用衬线体保持繁体，我们写的说明用无衬线简体。** 字体的区别就是
>    "这是书里说的"与"这是我们说的"的分界，不必再加引号或底色。
>
> **三件事不要搞错**：
> - **格子图从 `partNames()` 自动长，不要手维护清单**——P3 加构件要能自动进柜。
> - **格子里放预烘焙 PNG，点开才起 3D。** 一屏几十个实时 3D 会把页面拖死。
>   缩略图**提交进库**，别放 `shots/`（那是 gitignore 的）。
> - **`components.rules.json` 的 37 个斗拱本体没有几何**（P3 才做），做成数据卡并
>   **明确标注"尚无几何"**；墙石竹桥没有规则出处，显示"程序化造型，无营造规则来源"，
>   **不许给它们编一个**。
>
> 交付：门厅 → 图解 → 点开一件 → 看到出处 → 返回，走得通；
> **随机抽三件，页面显示的规则 id 与 `knowledge/rules/*.json` 对得上、引句一字不差**；
> 至少一件展示 `refuted` 或 `missing`（证明"我们不知道"也能展示）；
> 格子图一屏 < 1 秒；`npm run check:all` 全过、提交。
> 回报：柜子里有多少件、其中多少件有真出处、多少件是程序化造型、多少件尚无几何。

**规模**：大。**风险**：中——最容易犯的错是为了让页面好看，给没有出处的构件编一个。

### 并行说明

H 与 I 可同时派。文件不重叠，唯一的交点是 `vite.config.ts` 的 `rollupOptions.input`：
**H 只加 `garden`，I 只加 `fashi`**，各加一行。
`engine/ui/tokens.css` 两边只读。这两条是上一轮 A/B 撞车的直接教训。
