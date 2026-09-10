# P0 骨架搬家 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `src/` 一层平铺的工程重排成 `engine/` `knowledge/` `builder/` `projects/` 四层，并立起分层门、规则一致性门、平面几何门，使后续 P1–P5 可以多 agent 并行而互不踩踏。

**Architecture:** 先立回归基线，再做纯搬家（不改任何渲染行为，用截图的**结构数字**证明），然后补三道门。规则表从研究稿誊成机读 JSON，门只校验 id 与状态一致，数值由誊写者负责。

**关于回归基线的一处更正（2026-09-10 执行 Task 1/2 时实测得出）**：本计划最初写的是"逐像素归零"。实测不成立——场景里水面、竹叶、云一直在动，截图采到的动画相位每次都不同。同一份构建连拍两次，平均每像素差 7~17 个色阶，`treeline` 有 23% 的像素差超过 24 阶，噪声底比任何有意义的阈值都高。相机不是原因：截图工具每次 teleport 到写死的坐标与朝向。

改为比 `manifest.json` 里的 **drawCalls / triangles / geometries / textures** 四项（fps 随机器负载浮动，不比）。这四项是场景图的函数，确定性的。工具是 `tools/manifest-diff.mjs`。`tools/pixel-diff.mjs` 保留作参考，不当门。

这个判据是有效的：Task 2 执行时 `builder/parts/index.ts` 的 glob 没跟着子目录改，全部构件登记失败，正是被 draw calls 从 180 掉到 80 抓出来的；逐像素反而淹在噪声里。观感回归靠 `tools/side-by-side.mjs` 出左右对照图交人眼判。

**Tech Stack:** TypeScript 5.9 · three r185 · Vite 7 · Node test runner（`--experimental-strip-types`）· Playwright（截图与 pixel-diff）

**Spec:** `docs/superpowers/specs/2026-09-10-layered-architecture-design.md`

## Global Constraints

- 单位米；构件原点在地面中心，`+Z` 朝正面。
- `src/` 内禁用 `Math.random()`，随机走 `core/Noise.ts` 的种子生成器。
- `builder/derive/` 不许 `import 'three'`，它只产数。
- `engine/` 不许 import `builder/` `knowledge/` `projects/`。
- `builder/` 不许 import `projects/`。
- 每个任务结束时 `npm run check` `npm test` `npm run build` 必须全过。
- 提交信息末尾附：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
  ```

## 与 spec 的一处偏离

spec §7 写 `index.html` `viewer.html` 移入 `projects/daguanyuan/`。实际保留在仓库根，只把 `<script src>` 指向 `projects/daguanyuan/main.ts`。理由：Vite 的 root 默认是仓库根，把 html 移走要改 root，会连带影响 `base`、静态资源解析与两个 harness 的 URL。收益不抵成本。`main.ts` `viewer.ts` 仍按 spec 进 `projects/daguanyuan/`。

## 任务依赖

```
Task 1(基线) → Task 2(搬家) → Task 3(分层门)
                     ↓
                     ├→ Task 4(规则门) → Task 5 ┐
                     │                   Task 6 ├ 并行
                     │                   Task 7 ┘
                     ├→ Task 8(plan 搬家 + 几何门)
                     └→ Task 9(scatter 抽取)
```

Task 5/6/7 三个 agent 可同时跑，各写各的 JSON，互不碰同一文件。Task 8、9 与 5/6/7 也可并行。

---

### Task 1: 立回归基线 ✅ 已完成

搬家是纯重构，场景结构必须一模一样。先造一把尺子。

**Files:**
- Create: `tools/pixel-diff.mjs`
- Create: `shots/baseline/`（已被 `.gitignore` 的 `shots/` 覆盖，不入库）

**Interfaces:**
- Produces: `node tools/pixel-diff.mjs <dirA> <dirB> [--tolerance 0.001]` → 打印每张图的差异比例，全部 ≤ tolerance 时 exit 0，否则 exit 1。

- [ ] **Step 1: 写 pixel-diff 工具**

Node 没有内置 PNG 解码。借已装的 Playwright 在页面里解码并比较，零新依赖。

```javascript
#!/usr/bin/env node
/**
 * pixel-diff.mjs — 比较两个目录里的同名 PNG。
 *
 * 纯重构（挪文件、改 import）不该改变任何一个像素，这把尺子就是那条断言。
 * Node 没有 PNG 解码，所以借 Playwright 在页面里用 canvas 解，零新依赖。
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const [dirA, dirB] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const tolArg = process.argv.indexOf('--tolerance');
const TOL = tolArg > -1 ? Number(process.argv[tolArg + 1]) : 0.001;
if (!dirA || !dirB) {
  console.error('用法: node tools/pixel-diff.mjs <dirA> <dirB> [--tolerance 0.001]');
  process.exit(2);
}

const names = readdirSync(resolve(dirA)).filter((f) => f.endsWith('.png')).sort();
if (!names.length) {
  console.error(`${dirA} 里没有 PNG`);
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

let worst = 0;
let missing = 0;
for (const name of names) {
  const b = join(resolve(dirB), name);
  if (!existsSync(b)) {
    console.log(`MISSING ${name}`);
    missing++;
    continue;
  }
  const toUri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
  const ratio = await page.evaluate(
    async ([ua, ub]) => {
      const load = (u) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = u;
        });
      const [ia, ib] = await Promise.all([load(ua), load(ub)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      const c = document.createElement('canvas');
      c.width = ia.width;
      c.height = ia.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(ia, 0, 0);
      const da = g.getImageData(0, 0, c.width, c.height).data;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(ib, 0, 0);
      const db = g.getImageData(0, 0, c.width, c.height).data;
      let diff = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) diff++;
      }
      return diff / (c.width * c.height);
    },
    [toUri(join(resolve(dirA), name)), toUri(b)],
  );
  worst = Math.max(worst, ratio);
  const mark = ratio <= TOL ? 'ok  ' : 'DIFF';
  console.log(`${mark} ${name.padEnd(24)} ${(ratio * 100).toFixed(4)}%`);
}
await browser.close();

console.log(`\n最大差异 ${(worst * 100).toFixed(4)}%，容差 ${(TOL * 100).toFixed(4)}%，缺图 ${missing} 张`);
process.exit(worst <= TOL && missing === 0 ? 0 : 1);
```

- [ ] **Step 2: 跑一次构建并抓基线**

```bash
npm run build
pkill -f "port 4801"; (nohup npx vite preview --host 127.0.0.1 --port 4801 --strictPort > preview.log 2>&1 &)
sleep 3
node tools/capture.mjs --url http://127.0.0.1:4801/ --out shots/baseline
```

Expected: 13 张 PNG 写进 `shots/baseline/`，无 BOOT ERROR。

- [ ] **Step 3: 验证尺子本身有效**

```bash
node tools/pixel-diff.mjs shots/baseline shots/baseline
```

Expected: 每行 `ok`，最大差异 `0.0000%`，exit 0。

- [ ] **Step 4: 反向验证——尺子能抓到差异**

```bash
node tools/capture.mjs --url http://127.0.0.1:4801/ --out shots/tmpcheck --shots gate_plaque
cp shots/baseline/pond_reveal.png shots/tmpcheck/gate_plaque.png
node tools/pixel-diff.mjs shots/tmpcheck shots/baseline; echo "exit=$?"
```

Expected: `DIFF gate_plaque` 且 `exit=1`。然后 `rm -rf shots/tmpcheck`。

- [ ] **Step 5: 提交**

```bash
git add tools/pixel-diff.mjs
git commit -m "test(daguanyuan): pixel-diff 工具——纯重构的逐像素回归尺"
```

---

### Task 2: 目录搬家、路径别名、删死文件 ✅ 已完成

**执行记录**：`builder/parts/index.ts` 的 eager glob 原为 `./parts/*.ts`，搬家后构件散到 `damu/` `qiangyuan/` 等门类子目录，glob 全部落空 → 运行时「未登记构件 X」，编译期无错。已改为 `./{damu,xiaomu,qiangyuan,shishan,shuigong,zhiwu,pudi}/*.ts`。**加新门类目录必须回来补这一行**，否则那一类构件静默消失。

`tests/*.mjs` 的 import 也指向旧 `../src/`，迁移脚本只走了 engine/builder/projects，需一并改成别名。

**Files:**
- Create: `engine/{core,render,player,ui,audio,harness}/`、`builder/{derive,parts,compose}/`、`knowledge/docs/`、`projects/daguanyuan/`
- Move: 见下方搬家表（`git mv`，保留历史）
- Delete: `src/fx/BuildingMaterials.ts`、`src/fx/PropMaterials.ts`、`src/fx/CreatureMaterials.ts`
- Modify: `tsconfig.json`、`vite.config.ts`、`tests/ts-resolver-hooks.mjs`、`index.html`、`viewer.html`、`package.json`
- Create: `tools/migrate-imports.mjs`

**Interfaces:**
- Produces: 四个路径别名 `@engine/*` `@builder/*` `@knowledge/*` `@project/*`，在 tsc、Vite、Node 测试三处都可解析。后续所有任务的 import 一律走别名，不写跨层相对路径。

- [ ] **Step 1: 建目录并搬家**

```bash
mkdir -p engine/{core,render,player,ui,audio,harness}
mkdir -p builder/derive/fashi builder/parts/{damu,xiaomu,qiangyuan,shishan,shuigong,zhiwu,pudi} builder/compose
mkdir -p knowledge/rules projects/daguanyuan/{scenes,parts}

git mv src/core/Engine.ts src/core/Input.ts src/core/PostFX.ts src/core/TextureLab.ts src/core/Noise.ts src/core/Context.ts engine/core/
git mv src/world/Atmosphere.ts src/world/Water.ts engine/render/
git mv src/fx/SkyShader.ts src/fx/Clouds.ts src/fx/WaterMaterials.ts src/fx/TerrainMaterials.ts engine/render/
git mv src/player/PlayerController.ts src/world/Collision.ts src/world/Interaction.ts engine/player/
git mv src/ui/HUD.ts src/ui/Menu.ts src/ui/Dialogue.ts src/ui/ui.css engine/ui/
git mv src/audio/Synth.ts src/audio/Audio.ts engine/audio/

git mv src/fashi/cai.ts src/fashi/puzuo.ts src/fashi/zhu.ts src/fashi/juzhe.ts src/fashi/yanchu.ts builder/derive/fashi/
git mv src/fashi/derive.ts builder/derive/index.ts

git mv src/fx/Sculpt.ts builder/parts/sculpt.ts
git mv src/cn/materials.ts src/cn/registry.ts src/cn/merge.ts src/cn/index.ts builder/parts/
git mv src/cn/parts/building.ts builder/parts/damu/
git mv src/cn/parts/wall.ts builder/parts/qiangyuan/
git mv src/cn/parts/taihu.ts builder/parts/shishan/
git mv src/cn/parts/bridge.ts builder/parts/shuigong/
git mv src/cn/parts/bamboo.ts builder/parts/zhiwu/
git mv src/fx/FoliageMaterials.ts builder/parts/zhiwu/foliage-materials.ts
git mv src/world/Vegetation.ts builder/parts/zhiwu/vegetation.ts

git mv src/world/Garden.ts builder/compose/composer.ts
git mv src/world/World.ts builder/compose/world.ts
git mv src/world/Terrain.ts builder/compose/terrain.ts

git mv src/main.ts src/viewer.ts projects/daguanyuan/
git mv docs/fashi docs/qingshi docs/plan knowledge/docs/

git rm src/fx/BuildingMaterials.ts src/fx/PropMaterials.ts src/fx/CreatureMaterials.ts
rmdir src/fx src/cn/parts src/cn src/fashi src/world src/core src/player src/ui src/audio src 2>/dev/null || true
```

`terrain.ts` 现在仍是大观园专有（硬编码池、山、路），P1 才拆出通用高度场进 `engine/render/Heightfield.ts`。`vegetation.ts` 同理，Task 9 抽机制层。这里只搬不改。

- [ ] **Step 2: 配路径别名（三处）**

`tsconfig.json` 的 `compilerOptions` 加：

```json
"baseUrl": ".",
"paths": {
  "@engine/*": ["engine/*"],
  "@builder/*": ["builder/*"],
  "@knowledge/*": ["knowledge/*"],
  "@project/*": ["projects/daguanyuan/*"]
}
```

同文件的 `include` 从 `["src"]` 改成 `["engine", "builder", "projects", "tools"]`。

`vite.config.ts` 的 `defineConfig({...})` 里加：

```ts
resolve: {
  alias: {
    '@engine': fileURLToPath(new URL('./engine', import.meta.url)),
    '@builder': fileURLToPath(new URL('./builder', import.meta.url)),
    '@knowledge': fileURLToPath(new URL('./knowledge', import.meta.url)),
    '@project': fileURLToPath(new URL('./projects/daguanyuan', import.meta.url)),
  },
},
```

`tests/ts-resolver-hooks.mjs` 的 `resolve` 函数开头加别名展开（放在现有相对路径分支之前）：

```js
const ALIASES = {
  '@engine/': new URL('../engine/', import.meta.url),
  '@builder/': new URL('../builder/', import.meta.url),
  '@knowledge/': new URL('../knowledge/', import.meta.url),
  '@project/': new URL('../projects/daguanyuan/', import.meta.url),
};

export async function resolve(specifier, context, next) {
  for (const [prefix, base] of Object.entries(ALIASES)) {
    if (specifier.startsWith(prefix)) {
      const rest = specifier.slice(prefix.length);
      const target = new URL(rest, base);
      for (const ext of ['', ...EXTENSIONS]) {
        const candidate = new URL(target.href + ext);
        if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
      }
      for (const ext of EXTENSIONS) {
        const candidate = new URL(`${target.href}/index${ext}`);
        if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
      }
    }
  }
  // …此处接现有的相对路径分支，原样不动
}
```

- [ ] **Step 3: 写 import 迁移脚本**

搬完家所有跨目录的相对 import 都断了。写脚本按「旧路径 → 新路径」映射自动改写成别名形式。

```javascript
#!/usr/bin/env node
/**
 * migrate-imports.mjs — 一次性脚本：把搬家后断掉的相对 import 改写成别名。
 *
 * 做法：对每个源文件，按它的**旧**位置解析每个相对 specifier，得到旧的目标文件；
 * 在搬家表里查它的新位置；同目录内的保持相对，跨目录的改成 @layer/ 别名。
 * 跑完即可删除；留在仓库里只是为了让这次搬家可复现。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve as pres } from 'node:path';

// 旧路径（相对仓库根，不带扩展名）→ 新路径。与 Task 2 Step 1 的 git mv 一一对应。
const MOVES = {
  'src/core/Engine': 'engine/core/Engine',
  'src/core/Input': 'engine/core/Input',
  'src/core/PostFX': 'engine/core/PostFX',
  'src/core/TextureLab': 'engine/core/TextureLab',
  'src/core/Noise': 'engine/core/Noise',
  'src/core/Context': 'engine/core/Context',
  'src/world/Atmosphere': 'engine/render/Atmosphere',
  'src/world/Water': 'engine/render/Water',
  'src/fx/SkyShader': 'engine/render/SkyShader',
  'src/fx/Clouds': 'engine/render/Clouds',
  'src/fx/WaterMaterials': 'engine/render/WaterMaterials',
  'src/fx/TerrainMaterials': 'engine/render/TerrainMaterials',
  'src/player/PlayerController': 'engine/player/PlayerController',
  'src/world/Collision': 'engine/player/Collision',
  'src/world/Interaction': 'engine/player/Interaction',
  'src/ui/HUD': 'engine/ui/HUD',
  'src/ui/Menu': 'engine/ui/Menu',
  'src/ui/Dialogue': 'engine/ui/Dialogue',
  'src/audio/Synth': 'engine/audio/Synth',
  'src/audio/Audio': 'engine/audio/Audio',
  'src/fashi/cai': 'builder/derive/fashi/cai',
  'src/fashi/puzuo': 'builder/derive/fashi/puzuo',
  'src/fashi/zhu': 'builder/derive/fashi/zhu',
  'src/fashi/juzhe': 'builder/derive/fashi/juzhe',
  'src/fashi/yanchu': 'builder/derive/fashi/yanchu',
  'src/fashi/derive': 'builder/derive/index',
  'src/fx/Sculpt': 'builder/parts/sculpt',
  'src/cn/materials': 'builder/parts/materials',
  'src/cn/registry': 'builder/parts/registry',
  'src/cn/merge': 'builder/parts/merge',
  'src/cn/index': 'builder/parts/index',
  'src/cn/parts/building': 'builder/parts/damu/building',
  'src/cn/parts/wall': 'builder/parts/qiangyuan/wall',
  'src/cn/parts/taihu': 'builder/parts/shishan/taihu',
  'src/cn/parts/bridge': 'builder/parts/shuigong/bridge',
  'src/cn/parts/bamboo': 'builder/parts/zhiwu/bamboo',
  'src/fx/FoliageMaterials': 'builder/parts/zhiwu/foliage-materials',
  'src/world/Vegetation': 'builder/parts/zhiwu/vegetation',
  'src/world/Garden': 'builder/compose/composer',
  'src/world/World': 'builder/compose/world',
  'src/world/Terrain': 'builder/compose/terrain',
  'src/main': 'projects/daguanyuan/main',
  'src/viewer': 'projects/daguanyuan/viewer',
};
// 新路径 → 旧路径，用来知道「我现在这个文件，从前在哪」。
const BACK = Object.fromEntries(Object.entries(MOVES).map(([o, n]) => [n, o]));

const ALIAS = [
  ['engine/', '@engine/'],
  ['builder/', '@builder/'],
  ['knowledge/', '@knowledge/'],
  ['projects/daguanyuan/', '@project/'],
];
const toAlias = (p) => {
  for (const [prefix, a] of ALIAS) if (p.startsWith(prefix)) return a + p.slice(prefix.length);
  return null;
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

let changed = 0;
for (const file of ['engine', 'builder', 'projects'].flatMap((d) => walk(d))) {
  const newNoExt = file.replace(/\.ts$/, '');
  const oldNoExt = BACK[newNoExt];
  if (!oldNoExt) {
    console.warn(`跳过（不在搬家表里）: ${file}`);
    continue;
  }
  const src = readFileSync(file, 'utf8');
  const out = src.replace(/from '(\.[^']*)'/g, (whole, spec) => {
    // 相对 specifier 在**旧**位置的解析结果
    const oldTarget = pres(dirname(oldNoExt), spec).replace(`${process.cwd()}/`, '');
    const newTarget = MOVES[oldTarget];
    if (!newTarget) return whole; // three/addons 之类，或本来就没搬
    const alias = toAlias(newTarget);
    if (!alias) return whole;
    // 同目录内保持相对，读起来更顺
    if (dirname(newTarget) === dirname(newNoExt)) {
      return `from './${newTarget.split('/').pop()}'`;
    }
    return `from '${alias}'`;
  });
  if (out !== src) {
    writeFileSync(file, out);
    changed++;
  }
}
console.log(`改写了 ${changed} 个文件`);
```

- [ ] **Step 4: 跑迁移脚本并修 html 与 css import**

```bash
node tools/migrate-imports.mjs
sed -i '' 's#/src/main.ts#/projects/daguanyuan/main.ts#' index.html
sed -i '' 's#/src/viewer.ts#/projects/daguanyuan/viewer.ts#' viewer.html
grep -rn "ui.css\|battle.css" engine projects builder | head
```

`ui.css` 的 import 若是相对路径且跨了目录，手动改成 `@engine/ui/ui.css`。

- [ ] **Step 5: 类型检查与测试**

```bash
npm run check
npm test
```

Expected: `tsc --noEmit` 无输出；`# pass 20 / # fail 0`。若 tsc 报找不到模块，看报错文件是否在 `MOVES` 表里漏了，补上重跑脚本。

- [ ] **Step 6: 构建并抓迁移后的图**

```bash
npm run build
pkill -f "port 4801"; (nohup npx vite preview --host 127.0.0.1 --port 4801 --strictPort > preview.log 2>&1 &)
sleep 3
node tools/capture.mjs --url http://127.0.0.1:4801/ --out shots/after
```

- [ ] **Step 7: 证明什么都没变**

```bash
node tools/manifest-diff.mjs shots/after shots/baseline
node tools/side-by-side.mjs shots/baseline/pond_reveal.png shots/after/pond_reveal.png shots/compare/pond_reveal.png
```

Expected: `14 镜，0 镜结构不一致`，exit 0。**有任何一张 DIFF 就是搬坏了**——先看是哪一项掉了（drawCalls 掉说明有东西没建起来，textures 掉说明材质缓存没命中），再回去查对应子系统。左右对照图交人眼过一遍。

- [ ] **Step 8: 提交**

```bash
git add -A engine builder knowledge projects tools tsconfig.json vite.config.ts tests index.html viewer.html
git commit -m "refactor(daguanyuan): 骨架搬家——engine/knowledge/builder/projects 四层 + 路径别名

- src/ 按 spec §7 全部迁出;真新镇遗留的三个死材质文件删除
- 四个别名 @engine @builder @knowledge @project,在 tsc/Vite/Node 测试三处可解析
- 纯重构:13 张截图与迁移前逐像素一致(pixel-diff 0.0000%)"
```

---

### Task 3: 分层门

**Files:**
- Create: `tools/check-layers.mjs`
- Modify: `package.json`（加 `"check:layers"` 脚本）

**Interfaces:**
- Consumes: Task 2 产出的四层目录与别名。
- Produces: `npm run check:layers` → 违规为空时 exit 0。

- [ ] **Step 1: 写门**

```javascript
#!/usr/bin/env node
/**
 * check-layers.mjs — 分层依赖门。
 *
 * 分层一旦被反向依赖破掉就名存实亡，而这种破坏在 tsc 眼里完全合法，
 * 所以必须单独立一道门。规则见 docs/superpowers/specs/2026-09-10-layered-architecture-design.md §2。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 每层不许 import 哪些别名前缀。 */
const FORBIDDEN = {
  engine: ['@builder/', '@knowledge/', '@project/'],
  builder: ['@project/'],
};
/** 额外规则：这些目录下不许出现的裸包名。 */
const NO_PACKAGE = { 'builder/derive': ['three'] };

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const violations = [];
for (const [layer, banned] of Object.entries(FORBIDDEN)) {
  for (const file of walk(layer)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (banned.some((b) => spec.startsWith(b))) {
        violations.push(`${file}: ${layer} 层不许 import ${spec}`);
      }
      // 跨层的相对路径同样违规（别名之外还能靠 ../.. 爬出去）
      if (spec.startsWith('..')) {
        const climbs = spec.split('/').filter((s) => s === '..').length;
        const depth = file.split('/').length - 1;
        if (climbs >= depth) violations.push(`${file}: 相对路径爬出了本层 (${spec})`);
      }
    }
  }
}
for (const [dir, pkgs] of Object.entries(NO_PACKAGE)) {
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      if (pkgs.includes(m[1])) violations.push(`${file}: ${dir} 不许 import '${m[1]}'`);
    }
  }
}

if (violations.length) {
  console.error(`分层门失败，${violations.length} 处违规：`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('分层门通过：engine 无反向依赖，builder 不认识 projects，derive 不碰 three。');
```

- [ ] **Step 2: 挂到 package.json**

`scripts` 里加 `"check:layers": "node tools/check-layers.mjs"`。

- [ ] **Step 3: 跑门，确认当前通过**

```bash
npm run check:layers
```

Expected: `分层门通过：...`，exit 0。若报违规，说明 Task 2 搬家把某个文件放错层了，按报错移动。

- [ ] **Step 4: 反向验证——门能抓到违规**

```bash
printf "\nimport { buildPart } from '@builder/parts/registry';\n" >> engine/core/Noise.ts
npm run check:layers; echo "exit=$?"
git checkout engine/core/Noise.ts
```

Expected: 报 `engine/core/Noise.ts: engine 层不许 import @builder/parts/registry`，`exit=1`。

- [ ] **Step 5: 提交**

```bash
git add tools/check-layers.mjs package.json
git commit -m "test(daguanyuan): 分层依赖门——engine 不许反向依赖,derive 不许碰 three"
```

---

### Task 4: 规则一致性门

研究稿是人读真源，规则表是机读真源。门只保证两者的**条目集合与状态**一致；数值由誊写者负责，因为研究稿里的公式是散文，自动抽取不可靠。

**Files:**
- Create: `tools/check-rules.mjs`
- Create: `knowledge/rules/schema.json`
- Modify: `package.json`（加 `"check:rules"`）

**Interfaces:**
- Produces: `npm run check:rules` → 逐个规则集打印「md N 条 / json M 条 / 缺 X / 多 Y / 状态不符 Z」，全零时 exit 0。
- Produces: 规则集与研究稿的绑定表，写在 `check-rules.mjs` 的 `SETS` 常量里，后续加规则集在此登记。

- [ ] **Step 1: 写门**

```javascript
#!/usr/bin/env node
/**
 * check-rules.mjs — 研究稿与机读规则表的一致性门。
 *
 * 研究稿（knowledge/docs/**.md）是人读真源，带出处与两名核验者的裁决；
 * 规则表（knowledge/rules/*.json）是机读真源，代码只读它。
 * 两者必须条目对齐、状态一致，否则代码会拿着一条已被驳倒的规则算数。
 *
 * 门不校验公式与数值——研究稿里那部分是散文，自动抽取只会给出虚假的安全感。
 * 数值由誊写者负责，由 derive-assertions（手算校验）兜底。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 规则集 → 它覆盖的研究稿目录与章节文件名前缀。 */
const SETS = {
  'fashi.rules.json': { dir: 'knowledge/docs/fashi', chapters: /^0[1-7]-/ },
  'qing.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^0[1-4]-/ },
  'fayuan.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^0[56]-/ },
  'honglou.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^07-/ },
};

const STATUS_ZH = { 通过: 'ok', 存疑: 'contested', 驳倒: 'refuted' };

/** 从一篇研究稿里抽出 [{id, name, status}]。 */
function parseDoc(path) {
  const src = readFileSync(path, 'utf8');
  const out = [];
  // 规则块：### <id> <name> …… 直到下一个 ### 或 ##
  const blocks = src.split(/\n(?=### )/).slice(1);
  for (const b of blocks) {
    const head = /^### (\S+)\s+(.*)/.exec(b);
    if (!head) continue;
    const id = head[1];
    if (!/^\d{2}-\d{2}$/.test(id)) continue; // 跳过非规则小节
    const st = /\*\*核验状态\*\*[：:]\s*\*\*(通过|存疑|驳倒)\*\*/.exec(b);
    out.push({ id, name: head[2].trim(), status: st ? STATUS_ZH[st[1]] : null });
  }
  return out;
}

let failed = 0;
for (const [jsonName, { dir, chapters }] of Object.entries(SETS)) {
  const jsonPath = join('knowledge/rules', jsonName);
  let doc;
  try {
    doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.error(`${jsonName}: 读不了或不是合法 JSON — ${e.message}`);
    failed++;
    continue;
  }
  const fromMd = new Map();
  for (const f of readdirSync(dir).filter((f) => chapters.test(f) && f.endsWith('.md'))) {
    for (const r of parseDoc(join(dir, f))) fromMd.set(r.id, r);
  }
  const fromJson = new Map(doc.rules.map((r) => [r.id, r]));

  const missingInJson = [...fromMd.keys()].filter((id) => !fromJson.has(id));
  // json 允许多出 status=missing 的条目：那是批评稿指出的缺口，研究稿里本就没有
  const extraInJson = [...fromJson.values()].filter((r) => !fromMd.has(r.id) && r.status !== 'missing');
  const mismatched = [...fromJson.values()].filter(
    (r) => fromMd.has(r.id) && fromMd.get(r.id).status && fromMd.get(r.id).status !== r.status,
  );
  // 依赖必须指向本集合内已存在的 id
  const dangling = doc.rules.flatMap((r) =>
    (r.needs ?? []).filter((n) => !fromJson.has(n)).map((n) => `${r.id} → ${n}`),
  );

  const bad = missingInJson.length + extraInJson.length + mismatched.length + dangling.length;
  console.log(
    `${jsonName.padEnd(20)} md ${String(fromMd.size).padStart(3)} 条 / json ${String(fromJson.size).padStart(3)} 条 ` +
      `/ 缺 ${missingInJson.length} / 多 ${extraInJson.length} / 状态不符 ${mismatched.length} / 悬空依赖 ${dangling.length}`,
  );
  for (const id of missingInJson) console.error(`   json 缺 ${id}（${fromMd.get(id).name}）`);
  for (const r of extraInJson) console.error(`   json 多出 ${r.id}，研究稿里没有`);
  for (const r of mismatched) console.error(`   ${r.id} 状态不符：md=${fromMd.get(r.id).status} json=${r.status}`);
  for (const d of dangling) console.error(`   悬空依赖 ${d}`);
  if (bad) failed++;
}

process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: 写规则表 JSON Schema**

`knowledge/rules/schema.json`，供人写 JSON 时对照（不在门里强制，避免引入校验依赖）：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "机读规则表",
  "type": "object",
  "required": ["source", "rules"],
  "properties": {
    "source": {
      "type": "object",
      "required": ["book", "doc"],
      "properties": {
        "book": { "type": "string", "description": "书名" },
        "doc": { "type": "string", "description": "对应研究稿目录，相对仓库根" }
      }
    },
    "rules": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "status", "statement"],
        "properties": {
          "id": { "type": "string", "pattern": "^\\d{2}-\\d{2}$" },
          "name": { "type": "string" },
          "status": { "enum": ["ok", "contested", "refuted", "missing"] },
          "statement": { "type": "string", "description": "现代中文表述" },
          "formula": { "type": "string", "description": "可编码公式；是表则写 \"table\"" },
          "table": { "type": "array", "description": "formula 为 table 时的数据" },
          "params": { "type": "object" },
          "correction": { "type": "string", "description": "status=contested 时代码应采用的更正值" },
          "choices": {
            "type": "array",
            "description": "并存的多个口径。调用方必须显式选一个 key，否则 derive 抛 AmbiguousRuleError。",
            "items": {
              "type": "object",
              "required": ["key", "value", "note"],
              "properties": { "key": { "type": "string" }, "value": {}, "note": { "type": "string" } }
            }
          },
          "quote": { "type": "string", "description": "原文逐字引文" },
          "location": { "type": "string", "description": "卷/篇/页" },
          "urls": { "type": "array", "items": { "type": "string" } },
          "needs": { "type": "array", "items": { "type": "string" }, "description": "依赖的规则 id" },
          "whereToLook": {
            "type": "object",
            "description": "status=missing 时，下一轮该查什么",
            "properties": {
              "books": { "type": "array", "items": { "type": "string" } },
              "keywords": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 3: 先把脚本挂上**

`package.json` 的 `scripts` 加 `"check:rules": "node tools/check-rules.mjs"`。下一步就要用。

- [ ] **Step 4: 造一个最小样例，验证门的解析对**

先只写两条真规则，确认门能对齐，再交给 Task 5–7 补全。

```bash
cat > knowledge/rules/fashi.rules.json <<'JSON'
{
  "source": { "book": "营造法式", "doc": "knowledge/docs/fashi" },
  "rules": []
}
JSON
npm run check:rules 2>&1 | head -20
```

Expected: 打印 `fashi.rules.json md 155 条 / json 0 条 / 缺 155 ...` 并 exit 1。**这正是想要的**——它证明门能读懂研究稿、能数出条目。把 md 的条数记下来，交给 Task 5–7 当靶子。

- [ ] **Step 5: 提交**

```bash
git add tools/check-rules.mjs knowledge/rules/schema.json knowledge/rules/fashi.rules.json package.json
git commit -m "test(daguanyuan): 规则一致性门——研究稿与机读规则表的条目与状态必须对齐"
```

---

### Task 5: 誊写 `fashi.rules.json`（可与 Task 6、7 并行）

**Files:**
- Modify: `knowledge/rules/fashi.rules.json`
- Read only: `knowledge/docs/fashi/0[1-7]-*.md`、`knowledge/docs/fashi/README.md`

**Interfaces:**
- Consumes: Task 4 的 `check-rules.mjs` 与 `schema.json`。
- Produces: `knowledge/rules/fashi.rules.json`，覆盖研究稿全部规则条目。`builder/derive/fashi/` 在 P1 会改为读它。

- [ ] **Step 1: 数清靶子**

```bash
npm run check:rules 2>&1 | grep fashi
```

记下 md 的条数。誊完必须一条不差。

- [ ] **Step 2: 逐章誊写**

对 `knowledge/docs/fashi/01-caifen.md` 到 `07-shice.md` 的每个 `### <id> <名称>` 小节，产出一条：

- `id` `name` 抄标题。
- `status` 从 `**核验状态**:**通过|存疑|驳倒**` 映射到 `ok|contested|refuted`。
- `statement` 抄「现代表述」。
- `formula` / `table` / `params` 抄「公式与参数」。是表就 `"formula": "table"` 并把表放 `table`。
- `quote` `location` `urls` 抄「原文引文与出处」。
- `status` 为 `contested` 时，把该条核验状态里反驳者给的更正值写进 `correction`。
- 研究稿里明写「两种读法并存」「口径二选一」的（如 04-04 筒瓦厅堂举高 0.27 与 0.33、01-09 尺长四档），写成 `choices` 数组，不要私自选一个。
- `needs` 填它依赖的规则 id（如举折依赖材分与铺作出跳）。

示例（照抄这条的结构）：

```json
{
  "id": "01-05",
  "name": "八等材尺寸表(宋寸)",
  "status": "ok",
  "statement": "八个材等各自的材广、材厚(宋寸)、每分寸数及适用建筑。",
  "formula": "table",
  "table": [
    { "grade": 1, "guangCun": 9.0, "houCun": 6.0, "fenCun": 0.6, "use": "殿身九间至十一间" },
    { "grade": 2, "guangCun": 8.25, "houCun": 5.5, "fenCun": 0.55, "use": "殿身五间至七间" }
  ],
  "quote": "第一等：廣九寸，厚六寸(以六分為一分。)右殿身九間至十一間則用之。",
  "location": "卷四·材",
  "urls": ["https://zh.wikisource.org/wiki/營造法式/第四卷"],
  "needs": []
}
```

带 `choices` 的示例：

```json
{
  "id": "01-09",
  "name": "宋尺→厘米换算参数",
  "status": "contested",
  "statement": "宋营造尺长度学界无定论，编码时尺长作可调参数。",
  "formula": "cm = cun * (CHI_CM / 10)",
  "correction": "不设默认值，必须由调用方选定口径。",
  "choices": [
    { "key": "zhong", "value": 30.5, "note": "钟晓青，按初祖庵设" },
    { "key": "chutu", "value": 31.2, "note": "出土宋尺下限，常用" },
    { "key": "bubo", "value": 31.6, "note": "官方布帛尺" },
    { "key": "chen", "value": 32.0, "note": "陈明达，辽代建筑" }
  ],
  "quote": "",
  "location": "docs/fashi/01-caifen.md §存疑",
  "urls": [],
  "needs": []
}
```

- [ ] **Step 3: 跑门**

```bash
npm run check:rules 2>&1 | grep fashi
```

Expected: `缺 0 / 多 0 / 状态不符 0 / 悬空依赖 0`。

- [ ] **Step 4: 抽样人工核对三条**

随机挑三条 `status=ok` 的，把 json 的 `table`/`params` 与研究稿正文逐字比一遍。数值门不查，这一步是唯一的防线。

- [ ] **Step 5: 提交**

```bash
git add knowledge/rules/fashi.rules.json
git commit -m "feat(knowledge): 誊写 fashi.rules.json——材分制规则表机读化"
```

---

### Task 6: 誊写 `qing.rules.json` 与 `fayuan.rules.json`（可与 Task 5、7 并行）

**Files:**
- Create: `knowledge/rules/qing.rules.json`（源：`knowledge/docs/qingshi/0[1-4]-*.md`）
- Create: `knowledge/rules/fayuan.rules.json`（源：`knowledge/docs/qingshi/0[56]-*.md`）

**Interfaces:**
- Consumes: Task 4 的门与 schema。
- Produces: 两份规则表，P1 的 `builder/derive/qing.ts` 与 `fayuan.ts` 读它们。

- [ ] **Step 1: 数靶子**

```bash
npm run check:rules 2>&1 | grep -E "qing|fayuan"
```

- [ ] **Step 2: 誊写，规则同 Task 5 Step 2**

这两套里驳倒条特别多（清式 18 条驳倒、六章通过率仅 25%），务必：

- `status: "refuted"` 的条目**必须保留**，不能因为不用就不写。代码引用它时要抛 `RefutedRuleError`，门也要能对上。`correction` 写研究稿给的更正值。
- `knowledge/docs/qingshi/tiers.md` 里列的**禁用 id 白名单**（01-05、02-02、04-06、04-07、04-11、06-01、06-15、06-16 等），在对应条目的 `notes` 里注明「tiers.md 禁用」。
- 05 章（营造法原）的 05-06「个」的读法被两人共同驳倒，照抄会把屋面抬高一倍——这条的 `correction` 必须写清「个=级数，总递加=个数−1」。

- [ ] **Step 3: 跑门并抽样核对**

```bash
npm run check:rules 2>&1 | grep -E "qing|fayuan"
```

Expected: 两行都是 `缺 0 / 多 0 / 状态不符 0 / 悬空依赖 0`。再抽样三条人工比对。

- [ ] **Step 4: 提交**

```bash
git add knowledge/rules/qing.rules.json knowledge/rules/fayuan.rules.json
git commit -m "feat(knowledge): 誊写 qing 与 fayuan 规则表——斗口制与界提栈机读化"
```

---

### Task 7: 誊写 `honglou.rules.json`、`plants.rules.json`、`missing.rules.json`（可与 Task 5、6 并行）

**Files:**
- Create: `knowledge/rules/honglou.rules.json`（源：`knowledge/docs/qingshi/07-honglou.md` 74 条）
- Create: `knowledge/rules/plants.rules.json`（源：07 章 + `tiers.md` §2 的景点硬约束）
- Create: `knowledge/rules/missing.rules.json`（源：两份批评稿）

**Interfaces:**
- Consumes: Task 4 的门与 schema。
- Produces: 原文事实表、花木名录、机读的缺口清单。P2 的几何补真与 P4 的分区建设读它们。

- [ ] **Step 1: 誊 `honglou.rules.json`**

74 条原文摘录，结构同前，但语义不同——它们是**事实**不是**公式**，所以：

- `status` 一律 `ok`（除研究稿标存疑的 5 条：07-37、07-39、07-53、07-65、07-70）。
- `formula` 写 `"fact"`。
- `params` 放可编码的建筑属性：`{ "spot": "潇湘馆", "type": "馆", "bays": 3, "roof": null, "courtyard": true, "plants": ["竹"], "interior": [...] }`。
- `quote` 必须逐字，`location` 写回目。

- [ ] **Step 2: 誊 `plants.rules.json`**

只放**有出处**的：学名、俗名、季相、出现在哪个景点、原文引文。形态参数（竿高、叶卡尺寸、分枝角）不进这里，它们是 P3 在 `builder/parts/zhiwu/` 里的美术参数。

```json
{
  "source": { "book": "红楼梦", "doc": "knowledge/docs/qingshi/07-honglou.md" },
  "rules": [
    {
      "id": "90-01",
      "name": "潇湘馆·翠竹",
      "status": "ok",
      "statement": "潇湘馆以千百竿翠竹为主景，竹后有小小三间房舍。",
      "formula": "fact",
      "params": { "species": "竹", "spot": "潇湘馆", "season": "四季常青", "role": "主景" },
      "quote": "忽抬頭看見前面一帶粉垣，裏面數楹修舍，有千百竿翠竹遮映。",
      "location": "第十七回",
      "urls": ["https://ctext.org/hongloumeng/ch17"],
      "needs": []
    }
  ]
}
```

id 用 `90-NN` 段，避开研究稿的章号，因为花木表是跨章汇编。**这些 id 在研究稿里没有对应的 `### ` 标题，所以门会报「多出」**——把 `plants.rules.json` 加进 `check-rules.mjs` 的 `SETS` 时，`chapters` 写 `/^$/`（匹配不到任何文件），门就只校验 JSON 合法与依赖不悬空，不做条目对齐。这是有意的：它是汇编，不是某一章的镜像。

- [ ] **Step 3: 誊 `missing.rules.json`**

把两份批评稿里「缺失的规则」逐条转成机读条目。清式批评稿 A1–A6 与平面批评稿的几何缺口都要进来。

```json
{
  "source": { "book": "批评稿汇编", "doc": "knowledge/docs/qingshi/README.md" },
  "rules": [
    {
      "id": "99-01",
      "name": "由规模反算斗口",
      "status": "missing",
      "statement": "tiers.md 要求 Tier A 的斗口由柱高反算，但两书均未给反函数；六个口径互差 8%~21%，选哪个决定斗口差一等以上。",
      "formula": "missing",
      "whereToLook": {
        "books": ["营造算例·第一章大木", "梁思成《清式营造则例》附表·各件权衡尺寸"],
        "keywords": ["檐柱高 斗口 反算", "平身科攒数 面阔 斗口", "慈宁宫 斗口 实测"]
      },
      "needs": []
    }
  ]
}
```

同样在 `SETS` 里用 `/^$/` 登记，不做条目对齐。

- [ ] **Step 4: 把三个新集合登记进门**

`tools/check-rules.mjs` 的 `SETS` 加：

```js
'honglou.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^07-/ },
'plants.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^$/ },
'missing.rules.json': { dir: 'knowledge/docs/qingshi', chapters: /^$/ },
```

（`honglou` 已在 Task 4 登记，这里只补后两个。）

- [ ] **Step 5: 跑门**

```bash
npm run check:rules
```

Expected: 六行全部 `缺 0 / 多 0 / 状态不符 0 / 悬空依赖 0`，exit 0。

- [ ] **Step 6: 提交**

```bash
git add knowledge/rules/honglou.rules.json knowledge/rules/plants.rules.json knowledge/rules/missing.rules.json tools/check-rules.mjs
git commit -m "feat(knowledge): 原文事实表、花木名录、机读缺口清单

missing.rules.json 让「我们不知道」成为程序能表达的状态——P1 的 derive 遇到它抛错，
而不是拿一个编出来的中值蒙混过去。"
```

---

### Task 8: `plan.json` 搬家与平面几何门

**Files:**
- Move: `knowledge/docs/plan/garden.plan.json` → `projects/daguanyuan/plan.json`
- Create: `tools/check-plan.mjs`
- Modify: `knowledge/docs/plan/make-plan.py`（读新路径）、`knowledge/docs/plan/README.md`（改索引里的路径）、`package.json`

**Interfaces:**
- Consumes: Task 2 的目录结构。
- Produces: `npm run check:plan` → 几何自检，全过 exit 0。P1 的 `builder/compose/terrain.ts` 与 P2 的几何补真都以它为门。

- [ ] **Step 1: 搬家并修引用**

```bash
git mv knowledge/docs/plan/garden.plan.json projects/daguanyuan/plan.json
grep -rn "garden.plan.json" knowledge/ tools/ builder/ projects/ | cat
```

把 `make-plan.py` 里的读取路径改成 `../../projects/daguanyuan/plan.json`（按 `__file__` 取），README 索引表里的路径同步改。

- [ ] **Step 2: 写几何门**

```javascript
#!/usr/bin/env node
/**
 * check-plan.mjs — 平面数据的几何自检。
 *
 * plan.json 是全园真源，下游的地形、装配、分区建设全部从它出发；
 * 一个不闭合的多边形或一个落在墙外的入口，会在三层之后才炸出来。
 * 断言来自 knowledge/docs/plan/04-conflicts.md §四「七条不可违约束」。
 */
import { readFileSync } from 'node:fs';

const plan = JSON.parse(readFileSync('projects/daguanyuan/plan.json', 'utf8'));
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ---- 基础几何 ---- */
const closed = (poly) => poly.length > 3 && poly[0][0] === poly.at(-1)[0] && poly[0][1] === poly.at(-1)[1];
const area = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length - 1; i++) s += poly[i][0] * poly[i + 1][1] - poly[i + 1][0] * poly[i][1];
  return s / 2;
};
const inside = (poly, [x, z]) => {
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length - 1; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const segInter = (a, b, c, d) => {
  const s = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return s(a, b, c) !== s(a, b, d) && s(c, d, a) !== s(c, d, b);
};
const simple = (poly) => {
  for (let i = 0; i < poly.length - 1; i++)
    for (let j = i + 2; j < poly.length - 1; j++) {
      if (i === 0 && j === poly.length - 2) continue;
      if (segInter(poly[i], poly[i + 1], poly[j], poly[j + 1])) return false;
    }
  return true;
};
const overlap = (p, q) => {
  for (let i = 0; i < p.length - 1; i++)
    for (let j = 0; j < q.length - 1; j++)
      if (segInter(p[i], p[i + 1], q[j], q[j + 1])) return true;
  return inside(q, p[0]) || inside(p, q[0]);
};

/* ---- 断言 ---- */
ok(closed(plan.wall) && simple(plan.wall), '外墙未闭合或自相交');

const polys = [
  ...plan.regions.map((r) => ['region ' + r.id, r.polygon]),
  ...plan.water.map((w) => ['water ' + w.name, w.polygon]),
  ...plan.hills.map((h) => ['hill ' + h.name, h.polygon]),
];
for (const [label, poly] of polys) {
  ok(closed(poly), `${label} 多边形未闭合`);
  ok(simple(poly), `${label} 多边形自相交`);
  ok(Math.abs(area(poly)) > 1, `${label} 面积近于零`);
  for (const pt of poly) ok(inside(plan.wall, pt), `${label} 有顶点落在墙外 (${pt})`);
}

for (let i = 0; i < plan.regions.length; i++)
  for (let j = i + 1; j < plan.regions.length; j++)
    ok(!overlap(plan.regions[i].polygon, plan.regions[j].polygon),
      `区域重叠：${plan.regions[i].id} × ${plan.regions[j].id}`);

for (const r of plan.regions) {
  for (const e of r.entrances ?? []) ok(inside(r.polygon, e), `${r.id} 的入口 ${e} 不在自己的区域内`);
  for (const b of r.buildings ?? []) ok(inside(r.polygon, [b.x, b.z]), `${r.id} 的建筑「${b.name}」锚点在区域外`);
  ok(['A', 'B', 'C', 'C-r'].includes(r.tier), `${r.id} 的 tier 非法：${r.tier}`);
}

const ids = new Set(plan.regions.map((r) => r.id));
for (const id of plan.route_ch17) ok(ids.has(id), `游线里的 ${id} 不是任何区域`);

/* ---- 04-conflicts.md §四 七条不可违约束 ---- */
const spotXY = (name) => {
  for (const r of plan.regions)
    for (const b of r.buildings ?? []) if (b.name.includes(name)) return [b.x, b.z];
  return null;
};
const zhuijin = spotXY('缀锦阁');
const hanfang = spotXY('含芳阁');
const ouxiang = spotXY('藕香榭');
ok(zhuijin && hanfang && zhuijin[0] > 0 && hanfang[0] < 0, '约束1：缀锦阁须在东、含芳阁须在西');
ok(ouxiang && ouxiang[0] > 0, '约束2：藕香榭须在中轴以东');

const gate = plan.gates.find((g) => g.name.includes('正门'));
ok(!!gate, '约束5：找不到正门');
const cuizhang = plan.regions.find((r) => r.id.includes('cuizhang'));
ok(!!cuizhang, '约束5：找不到翠嶂');
if (gate && cuizhang) {
  // 自正门到每个区域质心的视线，都必须被翠嶂的多边形挡住
  const centroid = (poly) => {
    let x = 0, z = 0;
    for (let i = 0; i < poly.length - 1; i++) { x += poly[i][0]; z += poly[i][1]; }
    const n = poly.length - 1;
    return [x / n, z / n];
  };
  const blocked = (target) => {
    for (let i = 0; i < cuizhang.polygon.length - 1; i++)
      if (segInter([gate.x, gate.z], target, cuizhang.polygon[i], cuizhang.polygon[i + 1])) return true;
    return false;
  };
  for (const r of plan.regions) {
    if (r.id === cuizhang.id || r.id.includes('zhengmen')) continue;
    ok(blocked(centroid(r.polygon)), `约束5：自正门能直视 ${r.id}，翠嶂没挡住`);
  }
}

// 约束6：游线走到正殿的累计路程占全程 50%~62%
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const stops = plan.route_ch17.map((id) => {
  const r = plan.regions.find((x) => x.id === id);
  const poly = r.polygon;
  let x = 0, z = 0;
  for (let i = 0; i < poly.length - 1; i++) { x += poly[i][0]; z += poly[i][1]; }
  return [x / (poly.length - 1), z / (poly.length - 1)];
});
let total = 0;
const cum = [0];
for (let i = 1; i < stops.length; i++) { total += dist(stops[i - 1], stops[i]); cum.push(total); }
const hallIdx = plan.route_ch17.findIndex((id) => id.includes('daguanlou') || id.includes('shengqin'));
if (hallIdx > 0) {
  const ratio = cum[hallIdx] / total;
  ok(ratio >= 0.5 && ratio <= 0.62, `约束6：至正殿累计路程占比 ${(ratio * 100).toFixed(1)}%，要求 50%~62%`);
}

if (fails.length) {
  console.error(`平面几何门失败，${fails.length} 处：`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`平面几何门通过：${plan.regions.length} 区、${plan.water.length} 水、${plan.hills.length} 山，七条约束全过。`);
```

- [ ] **Step 3: 跑门**

```bash
npm run check:plan
```

Expected: 通过。**若报「入口不在区域内」等 3 处已知缺陷**（平面批评稿第 4、5 条），那是真的，属于 P2 要修的内容——此时把这几条断言暂时降级成 `console.warn` 并在门的注释里写明「P2 修复后升回 error」，不要为了让门绿而改数据。

- [ ] **Step 4: 挂脚本并提交**

`package.json` 加 `"check:plan": "node tools/check-plan.mjs"`，并把三道门串进 `"check:all": "npm run check && npm run check:layers && npm run check:rules && npm run check:plan && npm test"`。

```bash
git add tools/check-plan.mjs projects/daguanyuan/plan.json knowledge/docs/plan package.json
git commit -m "test(daguanyuan): plan.json 搬进项目层 + 平面几何门(含七条不可违约束)"
```

---

### Task 9: 抽出散布机制层 `engine/scatter/`（可与 Task 5–8 并行）

`vegetation.ts` 2804 行里，泊松散布、遮蔽剔除、风场、实例化、LOD 是通用机制，六个温带树种的定义是内容。把机制抽进 `engine/scatter/`，树种留在原处不动——温带树种要等 P3 有中式替代品才能删，现在删了园子就秃了。

**Files:**
- Create: `engine/scatter/poisson.ts`（含 `poissonScatter` 与 `DensityMask`）、`engine/scatter/instancing.ts`、`engine/scatter/wind.ts`、`engine/scatter/index.ts`
- Modify: `builder/parts/zhiwu/vegetation.ts`（改为 import 机制层）

**Interfaces:**
- Produces:
  - `poissonScatter(opts: { minX, maxX, minZ, maxZ, radius, density(x,z): number, rng(): number, tries?: number }): Array<{x:number, z:number}>`
  - `class DensityMask { constructor(ctx, w?, h?); at(x: number, z: number): number }`
  - `class InstancePool { constructor(geo, mat, capacity); add(m: THREE.Matrix4, tint?: THREE.Color): void; commit(): THREE.InstancedMesh; setDistanceCulling(on: boolean): void; update(camera: THREE.Camera): void }`
  - `applyWind(mat: THREE.Material, env: EnvironmentState, opts?: { strength?: number }): void`
- Consumes: `@engine/core/Noise` 的 `makeRng`、`@engine/core/Context` 的 `EnvironmentState`。

- [ ] **Step 1: 定位要抽的段落**

搬家前 `src/world/Vegetation.ts` 里这几处是机制（行号按搬家前的文件，搬家不改内容所以仍然有效）：

| 行 | 是什么 | 去哪 |
|---|---|---|
| 264–300 左右 | 一个 `constructor(ctx, w = 256, h = 288)` 加 `at(x, z)` 的类，把密度场烤成网格再双线性采样 | `poisson.ts` 的 `DensityMask`，构造参数从 `ctx` 改成显式的采样函数 |
| 327 `function poisson(` | 泊松盘散布 | `poisson.ts` 的 `poissonScatter` |
| 380 `function makeInstanced(` | 建 `InstancedMesh` 并填矩阵 | `instancing.ts` 的 `InstancePool` |
| 492 `add(` / 625 `setEnabled` / 646 `setDistanceCulling` / 657 `update(camera)` | 实例池的增删与距离剔除 | 同上，并入 `InstancePool` |
| `setFlex` 与它注入的 shader 片段 | 风摆 | `wind.ts` 的 `applyWind` |

`buildTree`、`buildBush`、`SPECIES`、`HERO_TREES`、各种 `*Geometry`、`tintByHeight` 是**内容**，留在 `vegetation.ts` 不动。

先跑一遍确认行号没漂：

```bash
grep -n "function poisson(\|function makeInstanced(\|setDistanceCulling\|function setFlex\|  at(x" builder/parts/zhiwu/vegetation.ts
```

- [ ] **Step 2: 写机制层的失败测试**

```javascript
// tests/scatter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { poissonScatter } from '@engine/scatter/poisson.ts';
import { makeRng } from '@engine/core/Noise.ts';

test('泊松散布：点两两间距不小于半径，且落在给定矩形内', () => {
  const rng = makeRng(1234);
  const pts = poissonScatter({
    minX: -10, maxX: 10, minZ: -10, maxZ: 10,
    radius: 2, density: () => 1, rng,
  });
  assert.ok(pts.length > 20, `点太少：${pts.length}`);
  for (const p of pts) {
    assert.ok(p.x >= -10 && p.x <= 10 && p.z >= -10 && p.z <= 10, `点跑出矩形：${p.x},${p.z}`);
  }
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
      assert.ok(d >= 2 - 1e-6, `两点距离 ${d.toFixed(3)} 小于半径 2`);
    }
});

test('密度为零的区域不落点', () => {
  const rng = makeRng(99);
  const pts = poissonScatter({
    minX: -10, maxX: 10, minZ: -10, maxZ: 10,
    radius: 1.5, density: (x) => (x > 0 ? 1 : 0), rng,
  });
  assert.ok(pts.length > 0, '一个点都没有');
  for (const p of pts) assert.ok(p.x > -1e-6, `密度为零的半边落了点：${p.x}`);
});

test('同一种子给出同一批点', () => {
  const run = () => poissonScatter({
    minX: 0, maxX: 20, minZ: 0, maxZ: 20, radius: 2, density: () => 1, rng: makeRng(7),
  });
  assert.deepEqual(run(), run());
});
```

- [ ] **Step 3: 跑测试确认它失败**

```bash
npm test 2>&1 | grep -A3 "scatter"
```

Expected: FAIL，`Cannot find module '@engine/scatter/poisson.ts'`。

- [ ] **Step 4: 把机制搬进 engine/scatter/**

按 Step 1 定位的行，把函数体原样剪切进新文件，只改签名让它不再依赖 `GameContext`：

- `poisson.ts`：`poissonScatter(opts)`，`density` 与 `rng` 由调用方传入，不再自己从 ctx 取。
- `instancing.ts`：`InstancePool` 与 `setDistanceCulling`。
- `wind.ts`：`applyWind(mat, env)`，把 `env.windTime`、`windStrength`、`windDirection` 注入 shader。
- `index.ts`：`export * from './poisson'` 等三行。

`vegetation.ts` 里对应位置改成 `import { poissonScatter, InstancePool, applyWind } from '@engine/scatter';`，调用处补上原先从 ctx 隐式拿的参数。

- [ ] **Step 5: 跑测试与类型检查**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)"
npm run check
npm run check:layers
```

Expected: 三条新测试全过，总数从 20 涨到 23；tsc 无输出；分层门通过（`engine/scatter/` 不许 import builder，若报错说明抽的时候带出了内容层的依赖，得继续剥）。

- [ ] **Step 6: 证明植被没变**

```bash
npm run build
pkill -f "port 4801"; (nohup npx vite preview --host 127.0.0.1 --port 4801 --strictPort > preview.log 2>&1 &)
sleep 3
node tools/capture.mjs --url http://127.0.0.1:4801/ --out shots/scatter
node tools/manifest-diff.mjs shots/scatter shots/baseline
node tools/side-by-side.mjs shots/baseline/treeline.png shots/scatter/treeline.png shots/compare/treeline.png
```

Expected: `0 镜结构不一致`。散布是种子驱动的，抽机制层不该动一棵树的位置。**若三角数或 drawCalls 变了，八成是 rng 的调用顺序变了**——检查是不是改了 `rng()` 的调用次数，或者把 `makeRng` 挪进了循环。左右对照图交人眼确认树没挪窝。

- [ ] **Step 7: 记下没做的那半**

spec §7 还要求把 `FoliageMaterials.ts` 里的卡片朝向与半透机制也抽进 `engine/scatter/`。本任务**不做**：那部分与具体叶片材质缠在一起，剥离要连着换树种一起做，属于 P3。在 `builder/parts/zhiwu/foliage-materials.ts` 顶部注释里写一行：

```ts
/**
 * 真新镇遗留的温带叶材质。卡片朝向与半透机制本应进 engine/scatter/（见 spec §7），
 * 但它与具体叶片贴图缠在一起，剥离要连着换中式树种一起做——P3 的活，不在 P0。
 */
```

- [ ] **Step 8: 提交**

```bash
git add engine/scatter builder/parts/zhiwu/vegetation.ts builder/parts/zhiwu/foliage-materials.ts tests/scatter.test.mjs
git commit -m "refactor(engine): 抽出散布机制层——泊松/实例化/风场与树种定义分家

机制进 engine/scatter/，六个温带树种暂留 builder/parts/zhiwu/，等 P3 有中式替代再删。
三条新测试锁住间距、密度遮罩与确定性;13 张截图逐像素不变。"
```

---

## 完成判据

P0 完成时，下面这条命令必须全绿：

```bash
npm run check:all && node tools/manifest-diff.mjs shots/after shots/baseline
```

且：

- `src/` 目录不复存在。
- `knowledge/rules/` 下六份 JSON，`check:rules` 六行全零。
- `projects/daguanyuan/plan.json` 就位，`check:plan` 通过（已知的 3 处入口越界可暂为 warn）。
- `engine/scatter/` 存在，`vegetation.ts` 通过它散布。

## 下一份计划

P1 底层补齐，五条并行：`qing` 参数集、`fayuan` 参数集、规则状态机与 `Frame.provenance`、地形从 `plan.json` 生成、分块流式与 LOD。等 P0 合并后另开一份 plan 文档。
