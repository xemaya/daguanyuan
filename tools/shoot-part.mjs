#!/usr/bin/env node
/**
 * shoot-part.mjs — 构件棚拍。
 *
 *   node tools/shoot-part.mjs --subject roof:xieshan,taihu --angles front,three_quarter --url http://127.0.0.1:4801/viewer.html
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { out: 'shots/parts', width: 1000, height: 1000, url: 'http://127.0.0.1:5173/viewer.html', bg: 'studio' };
let subjects = ['probe'];
let angles = ['front', 'three_quarter', 'side'];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--subject') subjects = process.argv[++i].split(',');
  else if (a === '--url') args.url = process.argv[++i];
  else if (a === '--angles') angles = process.argv[++i].split(',');
  else if (a === '--out') args.out = process.argv[++i];
  else if (a === '--width') args.width = Number(process.argv[++i]);
  else if (a === '--height') args.height = Number(process.argv[++i]);
  else if (a === '--bg') args.bg = process.argv[++i];
}
const outDir = resolve(ROOT, args.out);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--force-device-scale-factor=1'],
});
const page = await browser.newPage({ viewport: { width: args.width, height: args.height }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const manifest = [];
for (const subject of subjects) {
  for (const angle of angles) {
    const url = `${args.url}?subject=${encodeURIComponent(subject)}&angle=${angle}&bg=${args.bg}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const ok = await page.waitForFunction(() => window.__VIEWER__ !== undefined, null, { timeout: 60000 }).then(() => true).catch(() => false);
    if (!ok) { console.error(`  FAILED ${subject}/${angle}`); console.error(errors.slice(-5).join('\n')); continue; }
    await page.waitForTimeout(600);
    await page.evaluate(() => new Promise((res) => { let n = 0; const s = () => (++n >= 20 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }));
    const file = `${subject.replace(':', '_')}_${angle}.png`;
    writeFileSync(resolve(outDir, file), await page.screenshot({ type: 'png' }));
    const st = await page.evaluate(() => ({ tris: window.__VIEWER__.triangles(), calls: window.__VIEWER__.drawCalls(), size: window.__VIEWER__.size() }));
    manifest.push({ subject, angle, file, ...st });
    console.log(`  ${file}`.padEnd(40), `${(st.tris / 1000).toFixed(1)}k tris  ${st.calls} calls  ${st.size.map((v) => v.toFixed(2)).join('×')}m`);
  }
}
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (errors.length) console.log(`\n${errors.length} console error(s):\n` + errors.slice(0, 10).map((e) => '  ' + e).join('\n'));
await browser.close();
console.log(`\nWrote part shots to ${args.out}/`);
