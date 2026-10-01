#!/usr/bin/env node
// 探针(单子 BI3):人为把 B 批贴图 job 的派发推迟 N ms(包一层 window.Worker,只拦 B 批 job 名的 postMessage),
// 全园流式加载到全部建完,报:B 批各 job adopt 时刻、B 段各区开建 / 建完、B 段(A 就绪 → 全部建完)最坏一帧与 >100/>50 ms 帧数、
// 以及 B 段里稻香村几个原型首建的间隔(主线程烤贴图就会在这里冒出 0.8–2.5 s)。
// 用法: node tools/probe-texture-delay.mjs <garden-url> <delayMs>   (例:100000;0 = 不推迟,对照正常情况)
import { chromium } from 'playwright';
const [url, delay = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-frame-rate-limit', '--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript((delayMs) => {
  const BJOBS = new Set(['xiangye-earth', 'xiangye-cottage', 'xiangye-wood', 'dirtpath', 'vermilion']); // = texture-jobs.ts DEFERRED_TEXTURE_JOBS
  // prewarm-textures 给每个 job 45 s 超时(从建 worker 起算);推迟派发超过它会被当成失败回落——探针要的是「晚到」不是「失败」,
  // 所以只把恰好 45000 ms 的计时器放宽到 10 分钟(探针专用,不动源码)。
  if (delayMs > 0) { const ST = window.setTimeout.bind(window); window.setTimeout = (fn, ms, ...a) => ST(fn, ms === 45000 ? 600000 : ms, ...a); }
  const W = window.Worker;
  window.__DELAYED__ = [];
  window.Worker = class extends W {
    postMessage(msg, ...rest) {
      if (delayMs > 0 && BJOBS.has(msg)) { window.__DELAYED__.push([msg, performance.now()]); setTimeout(() => super.postMessage(msg, ...rest), delayMs); }
      else super.postMessage(msg, ...rest);
    }
  };
  const marks = (window.__M__ = []); const info = console.info.bind(console);
  console.info = (...a) => { const s = String(a[0] ?? ''); marks.push([performance.now(), s.slice(0, 90)]); info(...a); };
  const fr = (window.__F__ = []); const loop = () => { fr.push(performance.now()); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
}, Number(delay));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GAME__ && window.__GAME__.world.streaming.allLoadedAt !== null, null, { timeout: 540000, polling: 500 });
const r = await page.evaluate(() => ({ M: window.__M__, F: window.__F__, D: window.__DELAYED__, W: window.__GAME__.world.root.userData.textureWarmup, S: window.__GAME__.world.streaming, ready: window.__GAME__.bootTimings }));
const readyAt = (r.M.find(([, s]) => s.startsWith('[boot] timings')) ?? [0])[0];
const allAt = r.S.allLoadedAt;
console.log(`delay ${delay} ms;A 就绪(boot timings) @${readyAt.toFixed(0)},全部建完 @${allAt.toFixed(0)},B 段墙钟 ${(allAt - readyAt).toFixed(0)} ms`);
console.log('B 批推迟派发:', r.D.map(([j, t]) => `${j}@${t.toFixed(0)}`).join(', ') || '(无)');
console.log('B 批 adopt:', (r.W?.deferred ?? []).map((j) => `${j.job} @${j.at.toFixed(0)}`).join(', '), r.W?.fallback ?? '');
for (const j of r.S.jobs) console.log(`  区 ${j.unit.padEnd(18)} 墙钟 ${j.wallMs.toFixed(0).padStart(6)} ms  建 ${j.buildMs.toFixed(0).padStart(5)}  最长一片 ${j.longestSliceMs.toFixed(0).padStart(4)}  挂上 @${j.committedAt.toFixed(0)}`);
const gaps = []; let prev = null;
for (const [t, s] of r.M) { if (t < readyAt) continue; if (prev && /daoxiangcun|red-railing|daoxiang-creek/.test(s)) gaps.push(`${(t - prev).toFixed(0)}ms ${s.replace('[garden] ', '').split(' ')[0]}`); prev = t; }
console.log('稻香村原型间隔:', gaps.join(' | '));
const fr = r.F.filter((t) => t >= readyAt && t <= allAt + 50); const d = []; for (let i = 1; i < fr.length; i++) d.push(fr[i] - fr[i - 1]);
d.sort((a, b) => b - a);
console.log(`B 段帧 ${d.length},最坏 ${d[0]?.toFixed(0)} ms,前五 ${d.slice(0, 5).map((x) => x.toFixed(0)).join('/')},>100 ms ${d.filter((x) => x > 100).length},>50 ms ${d.filter((x) => x > 50).length}`);
await browser.close();
