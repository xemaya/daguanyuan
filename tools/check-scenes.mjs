#!/usr/bin/env node
/**
 * check-scenes.mjs — 落位清单契约门（单子 Y，接缝 ①）。
 *
 * 跑的是 builder/compose/scenes.ts 的 validateScenes——与运行时同一份判据，
 * 命令行与游戏里不许有两套说法。
 *
 *   node tools/check-scenes.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import '../tests/ts-resolver.mjs';
const { validateScenes } = await import('../builder/compose/scenes.ts');

const dir = resolve('projects/daguanyuan/scenes');
const plan = JSON.parse(readFileSync(resolve('projects/daguanyuan/plan.json'), 'utf8'));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
const scenes = files.map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')));

const fails = validateScenes(scenes, plan);
for (const f of fails) console.error(`失败：${f}`);

for (const s of scenes) {
  const n = (s.named ?? []).length, p = (s.placements ?? []).length, sc = (s.scatters ?? []).length;
  console.log(`${s.region.padEnd(20)} 点名绑定 ${String(n).padStart(2)}  散置落位 ${String(p).padStart(2)}  散布规则 ${String(sc).padStart(2)}`);
}
console.log(`\n${files.length} 份落位清单，${fails.length} 项不合契约。`);
process.exit(fails.length ? 1 : 0);
