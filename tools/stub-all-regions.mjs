#!/usr/bin/env node
/**
 * stub-all-regions.mjs — 在一个**临时 worktree** 里给 plan 里没有落位清单的区补空清单，
 * 让世界按全园 19 区建起来。单子 AX 的尺子之一（扩区代价的前后对照）。
 *
 * 空清单 = 只有 plan 自动生成的东西（规则 2 建筑、linears、地形窗口、散布），
 * 所以它**低估**「起屋叠石」那一类——真建到潇湘馆的密度还会更重。地形、植被、建时里
 * 与面积成正比的那部分它量得准。与单子 AA（2026-09-14）的 19 区实跑是同一种做法。
 *
 * **只许在 worktree 里跑**：主检出里跑会让 `scenes/` 多出 15 个文件，"有落位清单 = 建成"
 * 一下子全园建成，下一个 `git add` 就把它们提交进去了。
 *
 * 用法：
 *   git worktree add --detach /private/tmp/dgy-scale editor
 *   node tools/stub-all-regions.mjs --dir /private/tmp/dgy-scale/daguanyuan
 */
import { readFileSync, readdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const main = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const i = process.argv.indexOf('--dir');
if (i < 0) { console.error('用法：node tools/stub-all-regions.mjs --dir <worktree 里的 daguanyuan 目录>'); process.exit(2); }
const dir = realpathSync(resolve(process.argv[i + 1]));
if (dir === main) { console.error('拒绝：这是主检出。先 git worktree add --detach 一份再对它跑。'); process.exit(2); }

const scenes = resolve(dir, 'projects/daguanyuan/scenes');
const plan = JSON.parse(readFileSync(resolve(dir, 'projects/daguanyuan/plan.json'), 'utf8'));
const have = new Set(readdirSync(scenes).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)));
const added = [];
for (const r of plan.regions) {
  if (have.has(r.id)) continue;
  writeFileSync(resolve(scenes, `${r.id}.json`), JSON.stringify({ region: r.id, $comment: 'stub-all-regions.mjs 临时桩，不许提交' }) + '\n');
  added.push(r.id);
}
console.log(`已有 ${have.size} 区，补桩 ${added.length} 区 → 共 ${have.size + added.length} 区`);
