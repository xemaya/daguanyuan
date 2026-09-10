#!/usr/bin/env node
/**
 * pixel-diff.mjs — 比较两个目录里的同名 PNG。
 *
 * 纯重构（挪文件、改 import）不该改变任何一个像素，这把尺子就是那条断言。
 * Node 没有 PNG 解码，所以借已装的 Playwright 在页面里用 canvas 解，零新依赖。
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
