#!/usr/bin/env node
/**
 * manifest-diff.mjs — 比较两次截图的**结构**数字。
 *
 * 为什么不用逐像素：场景里水面、竹叶、云一直在动，截图采到的动画相位每次都不同。
 * 实测同一份构建连拍两次，平均每像素差 7~17 个色阶、treeline 有 23% 的像素差超过
 * 24 阶——噪声底比任何有意义的阈值都高，逐像素在这里没有判别力。
 *
 * 而 draw calls / 三角数 / 几何数 / 材质数是确定性的：同样的场景图必然给出同样的数。
 * 骨架搬家时 builder/parts/index.ts 的 glob 没跟着改，构件全部登记失败，
 * 正是被 draw calls 从 180 掉到 80 抓出来的，逐像素反而淹没在噪声里。
 *
 * 用法: node tools/manifest-diff.mjs <dirA> <dirB> [--tolerance 0]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [dirA, dirB] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const tolArg = process.argv.indexOf('--tolerance');
const TOL = tolArg > -1 ? Number(process.argv[tolArg + 1]) : 0;
if (!dirA || !dirB) {
  console.error('用法: node tools/manifest-diff.mjs <dirA> <dirB> [--tolerance 0]');
  process.exit(2);
}

const load = (d) => {
  const m = JSON.parse(readFileSync(join(resolve(d), 'manifest.json'), 'utf8'));
  return new Map(m.shots.map((s) => [s.id, s]));
};
const A = load(dirA);
const B = load(dirB);

/** fps 随机器负载浮动，不比。其余四项是场景图的函数，必须一致。 */
const FIELDS = ['drawCalls', 'triangles', 'geometries', 'textures'];

let bad = 0;
for (const [id, a] of A) {
  const b = B.get(id);
  if (!b) {
    console.log(`MISSING ${id}（${dirB} 里没有这一镜）`);
    bad++;
    continue;
  }
  const diffs = FIELDS.filter((f) => {
    const x = a.stats[f];
    const y = b.stats[f];
    return TOL === 0 ? x !== y : Math.abs(x - y) / Math.max(1, y) > TOL;
  });
  if (diffs.length) {
    bad++;
    console.log(`DIFF ${id}`);
    for (const f of diffs) console.log(`       ${f}: ${a.stats[f]} vs ${b.stats[f]}`);
  } else {
    console.log(`ok   ${id.padEnd(16)} ${a.stats.drawCalls} calls  ${(a.stats.triangles / 1000) | 0}k tris`);
  }
}
for (const id of B.keys()) if (!A.has(id)) { console.log(`EXTRA ${id}（只在 ${dirB} 里）`); bad++; }

console.log(`\n${A.size} 镜，${bad} 镜结构不一致`);
process.exit(bad ? 1 : 0);
