import { chromium } from 'playwright';
const url = 'http://127.0.0.1:4801/';
const pts = JSON.parse(process.argv[2]);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 150000 });
const out = await page.evaluate((pts) => {
  const g = window.__GAME__; const col = g.world.collision; const T = g.THREE;
  const res = [];
  for (const [x, z] of pts) {
    const gh = col.groundHeight(x, z);
    const v = col.resolve(x, z, gh + 0.12, gh + 1.7, 0.3, new T.Vector2());
    const push = Math.hypot(v.x - x, v.y - z);
    let who = '';
    for (const k of col.colliders) {
      const r = col.resolve.call({ colliders: [k] }, x, z, gh + 0.12, gh + 1.7, 0.3, new T.Vector2());
      if (Math.hypot(r.x - x, r.y - z) > 1e-3) who += `${k.tag ?? k.kind}@(${k.cx.toFixed(2)},${k.cz.toFixed(2)} r/hx ${(k.r ?? k.hx).toFixed(2)} hz ${(k.hz ?? 0).toFixed(2)} rot ${(k.rot ?? 0).toFixed(2)} y ${k.minY.toFixed(2)}..${k.maxY.toFixed(2)}) `;
    }
    res.push(`(${x},${z}) ground ${gh.toFixed(2)} blocked ${col.blockedAt(x, z)} push ${push.toFixed(2)} ${who}`);
  }
  return res.join('\n');
}, pts);
console.log(out);
await browser.close();
