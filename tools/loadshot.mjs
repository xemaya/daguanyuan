import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/**
 * 把载入页的 UI 单独渲染出来看。
 *
 * 不能直接截真页面:世界构建占着主线程二十秒,playwright 等不到页面静止。
 * 这里只把 tokens.css + ui.css 与载入页的 DOM 结构搭出来,评徽标与排版足够了。
 *   node tools/loadshot.mjs <整页.png> [徽标放大.png]
 */
const css =
  readFileSync('engine/ui/tokens.css', 'utf8') + '\n' + readFileSync('engine/ui/ui.css', 'utf8');
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });

await p.setContent(`<style>${css}</style>
<div class="dgy-overlay dgy-loading">
  <div class="dgy-loading__inner">
    <div class="dgy-mark"></div>
    <h1 class="dgy-title">大观园</h1>
    <p class="dgy-subtitle">红楼梦 · 程序化重建</p>
    <div class="dgy-bar"><div class="dgy-bar__fill" style="width:62%"></div></div>
    <div class="dgy-loading__row">
      <div class="dgy-loading__step">起屋叠石…</div>
      <div class="dgy-loading__pct">62%</div>
    </div>
  </div>
</div>`);
await p.waitForTimeout(600);
await p.screenshot({ path: process.argv[2] ?? '/tmp/loading.png', animations: 'disabled' });

if (process.argv[3]) {
  await p.setViewportSize({ width: 480, height: 480 });
  await p.setContent(`<style>${css}</style>
    <div style="width:480px;height:480px;display:grid;place-items:center;background:#16262b">
      <div style="transform:scale(4);transform-origin:center"><div class="dgy-mark" style="margin:0"></div></div>
    </div>`);
  await p.waitForTimeout(400);
  await p.screenshot({ path: process.argv[3], animations: 'disabled' });
}
await b.close();
