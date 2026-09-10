import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:4801/';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 150000 });
const out = await page.evaluate(() => {
  const g = window.__GAME__; const col = g.world.collision; const T = g.THREE;
  const yaw = Math.atan2(6.6, 2.4), cx = -0.9, cz = 1.9;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const res = [];
  for (let lx = -4.7; lx <= 4.7; lx += 0.5) {
    const lz = lx < -1.5 ? 0.75 : lx < 1.5 ? -0.75 : 0.75;
    const x = cx + lx * c + lz * s, z = cz - lx * s + lz * c;
    const gh = col.groundHeight(x, z), th = col.terrainHeight(x, z);
    const v = col.resolve(x, z, gh + 0.12, gh + 1.7, 0.3, new T.Vector2());
    const push = Math.hypot(v.x - x, v.y - z);
    let who = '';
    if (push > 1e-3) {
      for (const k of col.colliders) {
        const v2 = { colliders: [k], resolve: col.resolve }; 
        const r = col.resolve.call({ colliders: [k] }, x, z, gh + 0.12, gh + 1.7, 0.3, new T.Vector2());
        if (Math.hypot(r.x - x, r.y - z) > 1e-3) who += (k.tag ?? k.kind) + `@(${k.cx.toFixed(1)},${k.cz.toFixed(1)} rot ${(k.rot ?? 0).toFixed(2)} hx ${k.hx?.toFixed(2)} hz ${k.hz?.toFixed(2)}) `;
      }
    }
    res.push(`lx ${lx.toFixed(1)} lz ${lz} world (${x.toFixed(2)},${z.toFixed(2)}) ground ${gh.toFixed(2)} terrain ${th.toFixed(2)} blocked ${col.blockedAt(x, z)} push ${push.toFixed(2)} ${who}`);
  }
  res.push('platforms: ' + col.platforms.map(p => `${p.tag}@(${p.cx.toFixed(1)},${p.cz.toFixed(1)}) hx ${p.hx.toFixed(2)} hz ${p.hz.toFixed(2)} rot ${p.rot.toFixed(2)} y ${p.y.toFixed(2)}`).join(' | '));
  return res.join('\n');
});
console.log(out);
await browser.close();
