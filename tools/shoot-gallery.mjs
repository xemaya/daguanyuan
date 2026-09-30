#!/usr/bin/env node
/**
 * shoot-gallery.mjs — 重烘焙《营造法式》图解页的格子缩略图。
 *
 *   node tools/shoot-gallery.mjs --url http://127.0.0.1:5173
 *
 * 要烘哪些件、落在哪个文件名,以图解页自己报出的目录为准
 * (fashi.ts 的 window.__FASHI__.thumbs)——清单只有一份,加构件不用回来改这里。
 * 每件只烘 three_quarter 一镜,产物提交进库(projects/daguanyuan/gallery/thumbs/)。
 *
 * 需要先起 dev server;截图驱动的是 /viewer.html 棚拍台,做法同 shoot-part.mjs。
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { url: 'http://127.0.0.1:5173', out: 'projects/daguanyuan/gallery/thumbs', size: 640, angle: 'three_quarter', bg: 'studio' };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--url') args.url = process.argv[++i];
  else if (a === '--out') args.out = process.argv[++i];
  else if (a === '--size') args.size = Number(process.argv[++i]);
  else if (a === '--angle') args.angle = process.argv[++i];
  else if (a === '--bg') args.bg = process.argv[++i];
}
const outDir = resolve(ROOT, args.out);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-device-scale-factor=1'],
});
const page = await browser.newPage({ viewport: { width: args.size, height: args.size }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

/* 目录从图解页拿:页面上有什么,就烘什么。 */
await page.goto(`${args.url}/fashi.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
const ok = await page.waitForFunction(() => window.__FASHI__ !== undefined, null, { timeout: 60000 }).then(() => true).catch(() => false);
if (!ok) {
  console.error('fashi.html 没有报出 __FASHI__ 目录,最后几条控制台错误:');
  console.error(errors.slice(-5).join('\n'));
  await browser.close();
  process.exit(1);
}
const thumbs = await page.evaluate(() => window.__FASHI__.thumbs);
console.log(`目录:${thumbs.length} 件待烘`);

const manifest = [];
let failures = 0;
for (const { subject, file } of thumbs) {
  const url = `${args.url}/viewer.html?subject=${encodeURIComponent(subject)}&angle=${args.angle}&bg=${args.bg}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const ready = await page.waitForFunction(() => window.__VIEWER__ !== undefined, null, { timeout: 60000 }).then(() => true).catch(() => false);
  if (!ready) { failures++; console.error(`  FAILED ${subject}`); console.error(errors.slice(-5).join('\n')); continue; }
  await page.waitForTimeout(600);
  await page.evaluate(() => new Promise((res) => { let n = 0; const s = () => (++n >= 20 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }));
  writeFileSync(resolve(outDir, file), await page.screenshot({ type: 'png' }));
  const st = await page.evaluate(() => ({ tris: window.__VIEWER__.triangles(), size: window.__VIEWER__.size() }));
  manifest.push({ subject, file, ...st });
  console.log(`  ${file}`.padEnd(28), `${(st.tris / 1000).toFixed(1)}k tris  ${st.size.map((v) => v.toFixed(2)).join('×')}m`);
}
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify({ angle: args.angle, size: args.size, bg: args.bg, entries: manifest }, null, 2));
if (errors.length) console.log(`\n${errors.length} console error(s):\n` + errors.slice(0, 10).map((e) => '  ' + e).join('\n'));
await browser.close();
console.log(`\nWrote gallery thumbs to ${args.out}/`);
if (failures || errors.length || manifest.length !== thumbs.length) process.exitCode = 1;
