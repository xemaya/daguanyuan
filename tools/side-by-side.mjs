import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [a, b, out, labelA = '搬家前', labelB = '搬家后'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1620, height: 480 } });
const uri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
await page.setContent(`<body style="margin:0;background:#111;font:14px/1.4 -apple-system,sans-serif;color:#eee">
<div style="display:flex">
  <div><div style="padding:4px 8px">${labelA}</div><img src="${uri(a)}" style="width:800px;display:block"></div>
  <div style="border-left:2px solid #f60"><div style="padding:4px 8px">${labelB}</div><img src="${uri(b)}" style="width:800px;display:block"></div>
</div></body>`);
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
