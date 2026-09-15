#!/usr/bin/env node
/**
 * 文档引用门:扫描仓库内所有 markdown 里形如 `路径/文件.扩展名` 的引用
 * (行内代码与 markdown 链接),文件不存在就报错。
 *
 * 自动跳过:
 * - http(s) 外部 URL,以及省略协议头的域名路径(如 book.newdu.com/a/…)
 * - @scope/pkg 形式的 npm 包名
 * - 含 <占位符> 的示意性路径(如 scenes/<region>.json)
 * - 含 * 的 glob 模式
 * - 不含 / 的裸文件名速写(如 `plan.json`,真源见上下文)
 *
 * 其余豁免必须写进 ALLOW 并说明理由——白名单是账,不是后门。
 * 条目三态:{file} 整文豁免;{path} 全局路径豁免;{file, path} 只豁免某文件里的某条。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOW = [
  {
    file: 'docs/superpowers/plans/2026-09-10-p0-skeleton-migration.md',
    why: 'P0 搬家文档:src/cn/、src/fashi/ 等旧路径是搬家前状态的历史记录,不是失效引用',
  },
  {
    file: 'docs/superpowers/specs/2026-09-10-layered-architecture-design.md',
    why: 'P0 架构 spec:记录的目录布局是搬家前状态,属历史设计稿',
  },
  ...[
    'src/renderers/common/RenderPipeline.js',
    'src/renderers/common/Info.js',
    'extras/PMREMGenerator.js',
    'src/nodes/lighting/ShadowNode.js',
    'src/math/Frustum.js',
  ].map((path) => ({
    file: 'docs/reviews/2026-09-11-webgpu-migration-plan.md',
    path,
    why: '核对来源:指向 node_modules/three 0.185.1 的源码树,不是本仓文件(本仓引用仍逐条校验)',
  })),
  {
    file: 'docs/superpowers/plans/2026-09-11-frontdoor-and-fashi-gallery.md',
    why: '实施计划描述的待建文件(门厅、图解页、缩略图烘焙脚本),由单子 H 与 I 落地',
  },
  ...[
    { f: 'docs/superpowers/plans/2026-09-14-w-sky.md', p: 'docs/reviews/2026-09-14-clouds.md' },
    { f: 'docs/superpowers/plans/2026-09-14-x-experience.md', p: 'tools/check-experience.mjs' },
  ].map(({ f, p }) => ({ file: f, path: p, why: '单子 W / X 的待建产物,落地前不存在' })),
  {
    file: 'docs/superpowers/plans/2026-09-14-p3-dougong.md',
    path: 'builder/parts/damu/dougong.ts',
    why: '单子 V 的 V2 产物,落地前不存在',
  },
  ...[
    'docs/DECISIONS.md',
    'docs/ROADMAP.md',
    'docs/superpowers/plans/2026-09-15-ak-perf-baseline.md',
    'docs/superpowers/plans/STANDARD-ACTIONS.md',
  ].map((f) => ({ file: f, path: 'projects/daguanyuan/perf-baseline.json', why: 'D-25 定的三角预算基线,由单子 AK 落地,落地前不存在' })),
  {
    file: 'docs/superpowers/plans/2026-09-15-ak-perf-baseline.md',
    path: 'tests/perf-baseline.test.mjs',
    why: '单子 AK 的待建测试,落地前不存在',
  },
  {
    file: 'docs/superpowers/plans/2026-09-15-am-cuizhang-rebuild.md',
    path: 'builder/parts/shishan/baishi.ts',
    why: '单子 AM 提议的白石峰构件落点(也可能落在 taihu.ts 里),落地前不存在',
  },
  ...['engine/core/look.ts', 'looks/default.json', 'scenes/daoxiangcun.json'].map((p) => ({
    file: 'docs/superpowers/specs/2026-09-14-scale-architecture-design.md',
    path: p,
    why: '面向扩展的架构设计稿里提议的落点(观感参数表 / 区清单),由单子 Y 与 AB 落地,现在不存在',
  })),
  {
    file: 'docs/superpowers/plans/2026-09-14-u-clear-before-p4.md',
    path: 'docs/reviews/2026-09-14-choices.md',
    why: '单子 U 的 B 组交付物,做完才存在',
  },
  {
    file: 'docs/tellux-borrowing.md',
    why: '外部调研笔记:src/Viewer.ts、hism/pipeline/ 等路径指向 tellux 项目的源码树,不是本仓文件',
  },
  {
    path: 'tools/check-experience.mjs',
    why: 'PE-2 规划中的体验门,docs/ROADMAP.md §PE-2 落地前不存在',
  },
  {
    path: 'knowledge/rules/yuanye.rules.json',
    why: 'PE-3 规划产物:《园冶》规则表尚未核验入库,docs/ROADMAP.md §PE-3',
  },
  {
    file: 'knowledge/docs/plan/README.md',
    path: 'docs/plan/make-plan.py',
    why: '知识库内部速写,省略 knowledge/ 前缀;真源 knowledge/docs/plan/make-plan.py。改写属知识库任务范围;已记在 docs/ROADMAP.md §P5 杂项账',
  },
  {
    file: 'knowledge/docs/qingshi/01-doukou.md',
    path: 'docs/fashi/01-caifen.md',
    why: '同上,真源 knowledge/docs/fashi/01-caifen.md',
  },
  {
    file: 'knowledge/docs/qingshi/README.md',
    path: 'docs/fashi/README.md',
    why: '同上,真源 knowledge/docs/fashi/README.md',
  },
  {
    file: 'knowledge/docs/qingshi/tiers.md',
    path: 'docs/plan/04-conflicts.md',
    why: '同上,真源 knowledge/docs/plan/04-conflicts.md',
  },
  {
    file: 'knowledge/docs/qingshi/tiers.md',
    path: 'docs/plan/03-scale.md',
    why: '同上,真源 knowledge/docs/plan/03-scale.md',
  },
  {
    file: 'knowledge/docs/qingshi/tiers.md',
    path: 'docs/qingshi/01-doukou.md',
    why: '同上,真源 knowledge/docs/qingshi/01-doukou.md',
  },
  {
    file: 'knowledge/rules/README.md',
    path: 'builder/parts/damu/dougong.ts',
    why: '规划中的斗拱分件构件(docs/ROADMAP.md §P3 真斗拱分件),落地前不存在',
  },
  {
    file: 'docs/superpowers/plans/2026-09-10-p1-foundation.md',
    path: 'engine/scatter/cluster.ts',
    why: 'P1 计划描述的待建文件,由在跑的 P1 任务落地;分派单不在仓库卫生单范围内改',
  },
  {
    file: 'docs/superpowers/plans/2026-09-10-p1-foundation.md',
    path: 'engine/render/TerrainChunks.ts',
    why: '同上,P1 待建文件',
  },
  {
    file: 'docs/superpowers/plans/2026-09-10-p1-foundation.md',
    path: 'tests/cluster.test.mjs',
    why: '同上,P1 待建测试',
  },
  {
    file: 'docs/superpowers/plans/2026-09-10-p1-foundation.md',
    path: 'shots/p1t7/manifest.json',
    why: '同上,P1 任务的产出物,跑完才存在',
  },
  {
    file: 'docs/superpowers/plans/2026-09-10-p1-foundation.md',
    path: 'builder/parts/damu/dougong.ts',
    why: '规划中的斗拱分件构件(docs/ROADMAP.md §P3),落地前不存在',
  },
  {
    file: 'docs/superpowers/plans/2026-09-10-p1-task-orders.md',
    path: 'engine/scatter/cluster.ts',
    why: '分派单描述的 P1 待建文件,由在跑的 P1 任务落地',
  },
  {
    file: 'docs/superpowers/plans/2026-09-10-p1-task-orders.md',
    path: 'engine/render/TerrainChunks.ts',
    why: '同上,P1 待建文件',
  },
  {
    file: 'docs/superpowers/plans/2026-09-10-p1-task-orders.md',
    path: 'core/Noise.ts',
    why: 'P0 搬家前的速写,真源 engine/core/Noise.ts;分派单由 P1 任务持有,不在卫生单范围改',
  },
  {
    file: 'docs/superpowers/plans/2026-09-10-p0-task-orders.md',
    path: 'knowledge/docs/plan/garden.plan.json',
    why: 'P0 分派单里的旧名,garden.plan.json 即现在的 projects/daguanyuan/plan.json;历史记录不改',
  },
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vercel']);
const EXT = '(?:ts|tsx|js|jsx|mjs|cjs|json|md|svg|html|css|py|sh)';
const PATH_RE = new RegExp(`[\\w.@~-][\\w./@-]*\\.${EXT}\\b`, 'g');
const CODE_RE = /`([^`\n]+)`/g;
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

function collectMd(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectMd(p, out);
    else if (p.endsWith('.md')) out.push(p);
  }
  return out;
}

const fileAllow = new Map();
const pathAllow = new Map();
for (const a of ALLOW) {
  const key = a.file ? `${a.file}${a.path ? `\0${a.path}` : ''}` : `\0${a.path}`;
  (a.file && !a.path ? fileAllow : pathAllow).set(key, a.why);
}

const violations = [];
const exempted = new Set();

function exempt(rel, token, why) {
  exempted.add(`${rel}: ${token} — ${why}`);
}

function checkToken(raw, mdFile) {
  // `path/file.ts:123` 与 `path/file.ts:123:45` 是本仓引用代码位置的标准写法
  // (README 与各 review 都这么写),行号不是路径的一部分,先剥掉。
  const token = raw.replace(/:\d+(?::\d+)?$/, '');
  if (token.includes('://') || token.startsWith('@')) return;
  if (token.includes('<') || token.includes('>') || token.includes('*')) return;
  if (!token.includes('/')) return;
  // 省略协议头的域名路径:首段含点(如 book.newdu.com/a/…)。
  if (token.split('/')[0].includes('.')) return;
  // URL 的端口段:`http://127.0.0.1:4801/garden.html` 会被切出 `4801/garden.html`
  // ——首段纯数字的从来不是仓库路径。(这是 1bc588ca 剥行号时留的洞,当时被
  // 整文件白名单盖住,2026-09-11 写 PQ 计划时门自己报出来。)
  if (/^\d{2,5}$/.test(token.split('/')[0])) return;
  // 构建产物目录:`shots/` 是 gitignore 的验收截图,`dist/` 是构建输出。
  // 它们在**新克隆的仓库里根本不存在**,所以拿它们当"失效引用"是假阳性
  // ——2026-09-12 在隔离 worktree 里验单子 N 时当场撞到:六道门只有这一道红,
  // 红的却不是被验的那个提交,是门自己。
  // artifacts/ 是 WG 那条线的构建产物(artifacts/wg-current/dist/),主检出里有、新 clone 与 worktree 里没有
  // ——2026-09-15 单子 AS 在 /private/tmp/dgy-as 里九道门只有这一道红,红的是门自己(as-findings §3)。
  if (/^(shots|dist|node_modules|artifacts)\//.test(token)) return;
  const rel = relative(ROOT, mdFile);
  const fileWhy = fileAllow.get(rel);
  if (fileWhy) return exempt(rel, token, fileWhy);
  const pairWhy = pathAllow.get(`${rel}\0${token}`) ?? pathAllow.get(`\0${token}`);
  if (pairWhy) return exempt(rel, token, pairWhy);
  // 链接按 md 所在目录解析;行内代码按仓库根解析。两种都试,有一个存在即算通过。
  // 绝对路径(review 工具常这么产)按其字面解析;其余两解:仓库根与 md 所在目录。
  const candidates = token.startsWith('/')
    ? [token]
    : [resolve(ROOT, token), resolve(dirname(mdFile), token)];
  if (candidates.some((c) => existsSync(c))) return;
  violations.push(`${rel}: \`${raw}\` 不存在`);
}

const mdFiles = collectMd(ROOT);
for (const md of mdFiles) {
  const text = readFileSync(md, 'utf8');
  for (const m of text.matchAll(CODE_RE)) {
    for (const t of m[1].matchAll(PATH_RE)) checkToken(t[0], md);
  }
  for (const m of text.matchAll(LINK_RE)) {
    const dest = m[1].split('#')[0];
    if (dest) checkToken(dest, md);
  }
}

console.log(`[check-docs] 扫描 ${mdFiles.length} 份 markdown`);
if (exempted.size) {
  console.log(`[check-docs] 白名单豁免 ${exempted.size} 条:`);
  for (const e of [...exempted].sort()) console.log(`  - ${e}`);
}
if (violations.length) {
  console.error(`[check-docs] ${violations.length} 处失效引用:`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  process.exit(1);
}
console.log('[check-docs] PASS');
