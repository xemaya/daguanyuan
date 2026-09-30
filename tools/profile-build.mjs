#!/usr/bin/env node
/**
 * profile-build.mjs — 建时按步 / 子步 / 构件原型拆账，多次独立跑取中位数。单子 BH1（BH0 剖析插桩转正）。
 *
 * **为什么需要它**：`profile-world.mjs` 只读一次、不记负载、不拆起屋。BH0 量出来「起屋叠石」17 s 里几乎全是
 * 构件原型第一次建（泥墙 2.5 s、白石 group9 2.1 s……），不拆到原型就答不了「省的是哪一件」；而机器上常有别的
 * agent 在跑，建时读数随 load 漂 1–2 s，**一次读数不能当结论**（`D-40`）。
 *
 * 口径（每一行都来自页面自报，工具不改任何源码）：
 *   - `步 <名>`：`world.buildTimings`（`world.ts` 每步的墙钟，步间让一帧不计入）。
 *   - `理地/…`、`植树/…`：`Terrain` / `Vegetation` 的 `userData.buildTimings`（各自文件里的 mark）。
 *   - `起屋/<part:variant>`：**原型首建**的近似耗时。`composer.ts` 每建完一个新原型就 `console.info('[garden] <key> …k tris')`；
 *     本工具用 `addInitScript` 给页面的 `console.info` 包一层、记 `performance.now()`，取相邻两条的间隔。
 *     第一条从「起屋叠石」开始算起（= `[world] built` 那一刻 − 起屋步长）。间隔里含夹在中间的落位 / clone（整步合计 < 0.1 s）。
 *     共享材质 / 贴图的首次初始化记在第一个用到它的原型头上。
 *   - `主线程等 worker(合计)`：名字以「调色」开头的各步之和——这几步主线程什么都不干，只 await 贴图 worker
 *     （BH1 之前只有一步「调色」；BH1 起拆成「调色·地面」与「调色」，中间夹着不要预热贴图的理地 / 圈地 / 引水）。
 *   - `开页→就绪`：从 `page.goto` 到 `window.__GAME__` 出现（含着色器编译，headless 下失真，见 `P-38`）。
 *   - 每次跑前记 `uptime` 的 load average（`D-40`：比较时记负载）。
 *
 * 用法：
 *   node tools/profile-build.mjs --url http://127.0.0.1:5195/garden.html [--runs 3] [--out shots/BH1/build-before.json] [--top 12]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';

const opt = (n, f) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : f);
const url = opt('--url', 'http://127.0.0.1:5173/garden.html');
const runs = Number(opt('--runs', '3'));
const out = opt('--out', null);
const top = Number(opt('--top', '12'));
const loadAvg = () => { try { return execSync('uptime').toString().replace(/.*load averages?: /, '').trim(); } catch { return '?'; } };

async function once() {
  const load = loadAvg();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-frame-rate-limit', '--force-device-scale-factor=1'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
      const marks = (window.__BUILD_MARKS__ = []);
      const info = console.info.bind(console);
      console.info = (...a) => { const s = String(a[0] ?? ''); if (s.startsWith('[garden] ') || s.startsWith('[world] ')) marks.push([performance.now(), s]); info(...a); };
    });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__GAME__ || document.querySelector('#app pre'), null, { timeout: 540000 });
    const wallReadyMs = Date.now() - t0;
    if (await page.locator('#app pre').count()) throw new Error(await page.locator('#app pre').textContent());
    const r = await page.evaluate(() => {
      const g = window.__GAME__, root = g.world.root, by = (n) => root.getObjectByName(n);
      return { boot: g.bootTimings, steps: g.world.buildTimings, total: g.world.buildDurationMs,
        terrain: by('Terrain')?.userData.buildTimings ?? [], vegetation: by('Vegetation')?.userData.buildTimings ?? [],
        warmup: root.userData.textureWarmup, marks: window.__BUILD_MARKS__ };
    });
    const rows = [['开页→就绪(墙钟)', wallReadyMs], ['boot.compileMs', r.boot?.compileMs], ['world 建时合计', r.total]];
    for (const [k, ms] of r.steps) rows.push([`步 ${k}`, ms]);
    rows.push(['主线程等 worker(合计)', r.steps.filter(([k]) => k.startsWith('调色')).reduce((a, [, ms]) => a + ms, 0)]);
    for (const [k, ms] of r.terrain) rows.push([`  理地/${k}`, ms]);
    for (const [k, ms] of r.vegetation) rows.push([`  植树/${k}`, ms]);
    // 原型首建:相邻 [garden] 原型行的间隔。
    const worldAt = r.marks.find(([, s]) => s.startsWith('[world] '))?.[0];
    const gardenMs = r.steps.find(([k]) => k === '起屋叠石')?.[1];
    const protos = [];
    if (worldAt != null && gardenMs != null) {
      let prev = worldAt - gardenMs;
      for (const [t, s] of r.marks) {
        const m = /^\[garden\] (\S+) [\d.]+k tris$/.exec(s);
        if (m) { protos.push([m[1], t - prev]); prev = t; }
      }
    }
    return { load, rows, protos, warmup: r.warmup };
  } finally { await browser.close(); }
}

const med = (a) => { const v = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const results = [];
for (let i = 0; i < runs; i++) { const r = await once(); results.push(r); console.error(`run ${i + 1}/${runs}  load ${r.load}  build ${(r.rows.find(([k]) => k === 'world 建时合计')[1] / 1000).toFixed(2)} s`); }
const keys = [...new Set(results.flatMap((r) => r.rows.map(([k]) => k)))];
const table = keys.map((k) => { const vals = results.map((r) => r.rows.find(([x]) => x === k)?.[1]); return { key: k, medianMs: med(vals), runsMs: vals }; });
const pkeys = [...new Set(results.flatMap((r) => r.protos.map(([k]) => k)))];
const protoTable = pkeys.map((k) => ({ key: k, medianMs: med(results.map((r) => r.protos.find(([x]) => x === k)?.[1])) })).sort((a, b) => b.medianMs - a.medianMs);
console.log(`load: ${results.map((r) => r.load).join(' | ')}`);
for (const row of table) console.log(`${row.key.padEnd(40)} ${row.medianMs == null ? '-' : (row.medianMs / 1000).toFixed(2).padStart(8)} s   [${row.runsMs.map((v) => (v == null ? '-' : (v / 1000).toFixed(2))).join(' / ')}]`);
console.log(`\n起屋 原型首建 前 ${top}(中位,s):`);
for (const p of protoTable.slice(0, top)) console.log(`  ${(p.medianMs / 1000).toFixed(2).padStart(6)}  ${p.key}`);
console.log(`  (原型 ${protoTable.length} 个,合计 ${(protoTable.reduce((s, p) => s + p.medianMs, 0) / 1000).toFixed(2)} s)`);
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ url, runs: results, table, protoTable }, null, 1)); console.log(`wrote ${out}`); }
