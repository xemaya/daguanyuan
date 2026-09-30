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
let subjects = ['building:ting'];
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
  else if (a === '--sheet') args.sheet = true;
}
const outDir = resolve(ROOT, args.out);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--force-device-scale-factor=1'],
});
const page = await browser.newPage({ viewport: { width: args.width, height: args.height }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const manifest = [];
let failures = 0;
for (const subject of subjects) {
  for (const angle of angles) {
    const url = new URL(args.url);
    url.searchParams.set('subject', subject); url.searchParams.set('angle', angle); url.searchParams.set('bg', args.bg);
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    const ok = await page.waitForFunction(() => window.__VIEWER__ !== undefined, null, { timeout: 60000 }).then(() => true).catch(() => false);
    if (!ok) { failures++; console.error(`  FAILED ${subject}/${angle}`); console.error(errors.slice(-5).join('\n')); continue; }
    await page.evaluate(()=>{const part=window.__VIEWER__.part;if(part.update){const update=part.update.bind(part);part.update=()=>update(0,10)}});
    await page.waitForTimeout(600);
    await page.evaluate(() => new Promise((res) => { let n = 0; const s = () => (++n >= 20 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }));
    const file = `${subject.replace(':', '_')}_${angle}.png`;
    writeFileSync(resolve(outDir, file), await page.screenshot({ type: 'png' }));
    const st = await page.evaluate(() => ({ backend: window.__VIEWER__.backend ?? 'webgl-legacy', statisticsVersion: window.__VIEWER__.statisticsVersion ?? 1, statisticsScope: 'all-frame-submissions', fixedTime: 10, tris: window.__VIEWER__.triangles(), calls: window.__VIEWER__.drawCalls(), size: window.__VIEWER__.size(),
      construction: window.__VIEWER__.part.root.userData.construction,
      linear: window.__VIEWER__.part.root.userData.linear,
      planObject: window.__VIEWER__.part.root.userData.planObject }));
    manifest.push({ subject, angle, file, ...st });
    const expected = url.searchParams.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
    if (st.statisticsVersion >= 2 && st.backend !== expected) { failures++; console.error(`Expected ${expected}, got ${st.backend}`); }
    console.log(`  ${file}`.padEnd(40), `${(st.tris / 1000).toFixed(1)}k tris  ${st.calls} calls  ${st.size.map((v) => v.toFixed(2)).join('×')}m`);
  }
}
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

/* 单子 AD · 第四档：把这一轮棚拍拼成一张联络表。
 * capture 的机位全是全景，鼓钉、瓦当、格心纹样在里面是两个像素——
 * 它们在现有产出里根本不存在。改的是投喂方式，不是判据：一个回合交
 * 1 张联络表 + 1 组贴脸图，不是 14 张全景。
 * 拼图用 playwright 自己渲 HTML 再截图,不为此引入图像库(spec §4)。 */
if (args.sheet && manifest.length) {
  const cols = Math.min(4, Math.ceil(Math.sqrt(manifest.length)));
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const cells = manifest.map((m) => `<figure><img src="${esc(m.file)}"><figcaption>${esc(m.subject)} · ${esc(m.angle)}<br><small>${(m.tris / 1000).toFixed(1)}k tris · ${m.size.map((v) => v.toFixed(2)).join('×')}m</small></figcaption></figure>`).join('');
  const html = `<meta charset="utf-8"><style>
    body{margin:0;background:#141414;color:#ddd;font:13px/1.5 -apple-system,"PingFang SC",sans-serif}
    .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;padding:16px}
    figure{margin:0}img{width:100%;display:block;background:#000}
    figcaption{padding:6px 2px;color:#bbb}small{color:#7a7a7a}
  </style><div class="grid">${cells}</div>`;
  writeFileSync(resolve(outDir, 'contact-sheet.html'), html);
  const sheet = await browser.newPage({ viewport: { width: cols * 340 + 32, height: 800 } });
  await sheet.goto('file://' + resolve(outDir, 'contact-sheet.html'), { waitUntil: 'load' });
  await sheet.waitForTimeout(500);
  writeFileSync(resolve(outDir, 'contact-sheet.png'), await sheet.screenshot({ type: 'png', fullPage: true }));
  await sheet.close();
  console.log(`  联络表 → ${args.out}/contact-sheet.png（${manifest.length} 格，${cols} 列）`);
}
if (errors.length) console.log(`\n${errors.length} console error(s):\n` + errors.slice(0, 10).map((e) => '  ' + e).join('\n'));
await browser.close();
console.log(`\nWrote part shots to ${args.out}/`);
if (failures || errors.length || manifest.length !== subjects.length * angles.length) process.exitCode = 1;
