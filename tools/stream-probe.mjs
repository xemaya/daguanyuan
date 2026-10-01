#!/usr/bin/env node
/**
 * stream-probe.mjs — 两段就绪的 B 段量什么:开页到 A 段就绪、到全部建完各多久,B 段里主线程被建造占住的最坏一帧。单子 BH2 的尺子。
 *
 * 为什么要单独一把:`D-44` 定了「后台建完、卡顿先量不修」——量的就是这把。capture / playtest 这些工具在自动化下默认等全部建完
 * 才拿到 `__GAME__`(main.ts),看不见 B 段;这里用 `?phaseA` 在 A 段就接手,从 `game:ready` 一直记到 `world:all-loaded`。
 *
 * 口径:
 *   - `readyWallMs` / `allLoadedWallMs`:从 `page.goto` 起算的墙钟(含着色器编译,headless 下失真,`P-38`)。
 *   - `boot.readyMs` / `boot.allLoadedMs`:页面自己从 boot 开始量的。
 *   - 帧间隔:`requestAnimationFrame` 相邻两次的间隔,从 `game:ready` 到 `world:all-loaded`。headless 下 rAF 不限帧(工具不节流,BG),
 *     所以这里的「最坏一帧」就是主线程最长一次被占住(建一件原型 / 合批 / 编管线的同步段)。报最坏、> 100 ms 的帧数、> 50 ms 的帧数。
 *   - `jobs`:每个区的片数、最长一片、编管线、墙钟(`world.streaming.jobs`)。
 *   - `--paused`:把 `navigator.webdriver` 伪装成假——引擎按真浏览器节流,开场卡挂着(BG 的「暂停档:画完当前帧就停」)。
 *     不点任何东西,看后台是不是照样建完、`world:all-loaded` 到没到、这期间引擎画了几帧。
 *   - `--idle`:同样按真浏览器节流,但开场卡一出来就替玩家点开(`hud.beginPlay`),然后站着不动——量 B 段里引擎画了几帧 / 秒
 *     (BG:静止档 20 帧),以及像素比有没有被 governor 降下去(建造期间 `governHold`)。
 *
 * 用法:
 *   node tools/stream-probe.mjs --url http://127.0.0.1:5195/garden.html [--paused] [--out shots/BH2/stream.json] [--timeout 400000]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';

const opt = (n, f) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : f);
const base = opt('--url', 'http://127.0.0.1:5173/garden.html');
const out = opt('--out', null);
const idle = process.argv.includes('--idle');
const paused = process.argv.includes('--paused') || idle;
const timeout = Number(opt('--timeout', '400000'));
const url = base + (base.includes('?') ? '&' : '?') + 'phaseA';
const load = () => { try { return execSync('uptime').toString().replace(/.*load averages?: /, '').trim(); } catch { return '?'; } };

const report = { url, paused, idle, load: load() };
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-frame-rate-limit', '--force-device-scale-factor=1'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.addInitScript((paused) => {
    if (paused) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    const s = (window.__STREAM_PROBE__ = { gaps: [], readyAt: null, allAt: null, renders: 0 });
    window.addEventListener('game:ready', () => {
      s.readyAt = performance.now();
      const g = window.__GAME__, pr = g.engine.postfx.render.bind(g.engine.postfx);
      g.engine.postfx.render = (dt) => { s.renders++; pr(dt); };
      let last = performance.now();
      const tick = () => { const now = performance.now(); s.gaps.push(now - last); last = now; if (s.allAt === null) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    window.addEventListener('world:all-loaded', () => { s.allAt = performance.now(); });
  }, paused);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__GAME__ || document.querySelector('#app pre'), null, { timeout });
  report.readyWallMs = Date.now() - t0;
  if (await page.locator('#app pre').count()) throw new Error(await page.locator('#app pre').textContent());
  report.startCardShown = await page.evaluate(() => window.__GAME__.hud.menuOpen);
  report.throttle = await page.evaluate(() => window.__GAME__.engine.throttle);
  report.pixelRatioAtReady = await page.evaluate(() => window.__GAME__.engine.renderer.getPixelRatio());
  if (idle) {
    await page.waitForFunction(() => window.__GAME__.hud.menuOpen, null, { timeout: 30000 });
    report.idleFrom = await page.evaluate(() => { const g = window.__GAME__; g.hud.beginPlay(); const s = window.__STREAM_PROBE__; s.idleAt = performance.now(); s.idleRenders0 = s.renders; s.states = []; const t = setInterval(() => { s.states.push(g.engine.renderState()); if (s.allAt !== null) clearInterval(t); }, 250); return { pending: g.world.streaming.pending, menuOpen: g.hud.menuOpen }; });
  }
  const done = await page.waitForFunction(() => window.__STREAM_PROBE__.allAt !== null, null, { timeout }).then(() => true).catch(() => false);
  report.allLoadedWallMs = done ? Date.now() - t0 : null;
  report.allLoaded = done;
  Object.assign(report, await page.evaluate(() => {
    const g = window.__GAME__, s = window.__STREAM_PROBE__;
    const gaps = s.gaps.slice(1), sorted = [...gaps].sort((a, b) => b - a);
    return {
      boot: g.bootTimings, stillPaused: g.hud.menuOpen, renderState: g.engine.renderState(), rendersDuringB: s.renders,
      allCommittedAfterReadyMs: g.world.streaming.allCommittedAt !== null ? g.world.streaming.allCommittedAt - s.readyAt : null,
      pixelRatioAtAllLoaded: g.engine.renderer.getPixelRatio(),
      idle: s.idleAt ? { seconds: (s.allAt - s.idleAt) / 1000, renders: s.renders - s.idleRenders0, fps: (s.renders - s.idleRenders0) / ((s.allAt - s.idleAt) / 1000),
        states: Object.entries(s.states.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})) } : null,
      bWallMs: s.allAt !== null ? s.allAt - s.readyAt : null,
      frames: gaps.length, worstFrameMs: sorted[0] ?? null, top5: sorted.slice(0, 5).map((v) => Math.round(v)),
      over100: gaps.filter((v) => v > 100).length, over50: gaps.filter((v) => v > 50).length,
      streaming: { order: g.world.streaming.order, units: g.world.streaming.units, jobs: g.world.streaming.jobs.map((j) => ({ ...j,
        buildMs: Math.round(j.buildMs), longestSliceMs: Math.round(j.longestSliceMs), compileMs: Math.round(j.compileMs), wallMs: Math.round(j.wallMs), committedAt: Math.round(j.committedAt) })) },
    };
  }));
  report.errors = errors;
} finally {
  await browser.close();
}
report.loadEnd = load();
console.log(JSON.stringify({ ...report, streaming: undefined }, null, 1));
console.log('jobs:', JSON.stringify(report.streaming?.jobs.map((j) => [j.unit, j.slices, j.longestSliceMs, j.compileMs, j.wallMs])));
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 1)); }
process.exit(report.allLoaded ? 0 : 1);
