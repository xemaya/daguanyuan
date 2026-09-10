#!/usr/bin/env node
/**
 * playtest.mjs — 用键盘走完游线的自动试玩。
 *
 * 不用 teleport 作弊:每个航点先把视线转过去,再按住 W 走,3 秒没进展算卡住。
 * 验的是碰撞层:门能不能穿、桥面能不能上、水会不会掉、假山缝能不能过。
 *
 *   node tools/playtest.mjs --url http://127.0.0.1:4801/
 */
import { chromium } from 'playwright';

const args = { url: 'http://127.0.0.1:4801/' };
for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--url') args.url = process.argv[++i];

/** 曲桥的桥面中线航点:局部 (x, z) 按摆放位置/朝向转到世界。 */
function bridgeWaypoints(cx, cz, yaw, label) {
  const local = [[-4.7, 0.75], [-1.5, 0.75], [-1.5, -0.75], [1.5, -0.75], [1.5, 0.75], [4.7, 0.75]];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return local.map(([lx, lz], i) => [cx + lx * c + lz * s, cz - lx * s + lz * c, `${label}${i + 1}`]);
}

/** 十七回游线的航点(x, z, 说明)。桥的摆放要与 src/world/Garden.ts 一致。 */
const ROUTE = [
  [0.0, 27.0, '正门台阶前'],
  [0.0, 24.4, '门屋当中(穿门)'],
  [0.0, 21.5, '进园'],
  [0.0, 16.2, '假山缝南口'],
  [0.0, 13.0, '假山缝中'],
  [0.0, 10.0, '假山缝北口'],
  [-2.4, 6.6, '池南岸桥头'],
  ...bridgeWaypoints(-0.9, 1.9, Math.atan2(6.6, 2.4), '南桥'),
  [0.9, -2.4, '沁芳亭中'],
  ...bridgeWaypoints(5.05, -7.68, 0.79, '北桥'),
  [8.7, -11.4, '池北岸'],
  [8.6, -13.5, '月洞门'],
  [9.4, -15.6, '院内'],
  [9.4, -18.3, '潇湘馆阶前(门内)'],
];

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(args.url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 150000 });
await page.waitForTimeout(800);
// 起始:关掉开始卡,拿到指针锁的等价状态(输入系统按 suspended 判定)。
await page.evaluate(() => {
  const g = window.__GAME__;
  g.hud?.dialogue?.close?.();
  g.engine.input.suspended = false;
  g.player.teleport(new g.THREE.Vector3(0, 0, 29.5), 0);
});

const pos = () => page.evaluate(() => { const p = window.__GAME__.player.state.position; return [p.x, p.y, p.z]; });
const setYaw = (yaw) => page.evaluate((y) => { const g = window.__GAME__; const p = g.player.state.position; g.player.teleport(new g.THREE.Vector3(p.x, p.y, p.z), y); }, yaw);

let ok = true;
for (const [tx, tz, label] of ROUTE) {
  let [x, y, z] = await pos();
  const t0 = Date.now();
  let lastD = Infinity;
  let lastProgress = Date.now();
  let reached = false;
  while (Date.now() - t0 < 12000) {
    [x, y, z] = await pos();
    const d = Math.hypot(tx - x, tz - z);
    if (d < 0.55) { reached = true; break; }
    if (d < lastD - 0.05) { lastD = d; lastProgress = Date.now(); }
    if (Date.now() - lastProgress > 3000) break;
    // 朝向:forward = (-sin yaw, -cos yaw)。
    const yaw = Math.atan2(-(tx - x), -(tz - z));
    await setYaw(yaw);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(120);
    await page.keyboard.up('KeyW');
  }
  const status = reached ? 'ok ' : 'STUCK';
  if (!reached) ok = false;
  console.log(`${status} ${label.padEnd(12)} at (${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)})  target (${tx}, ${tz})`);
  if (!reached) {
    // 卡住就跳到航点继续,好把后面的也验完。
    await page.evaluate(([px, pz]) => { const g = window.__GAME__; g.player.teleport(new g.THREE.Vector3(px, 0, pz), 0); }, [tx, tz]);
  }
}
// 落水测试:从池南岸直接往池心走,应该被挡在岸上。
await page.evaluate(() => { const g = window.__GAME__; g.player.teleport(new g.THREE.Vector3(-5.0, 0, 3.0), 0); });
{
  const yaw = Math.atan2(-(0.6 + 5.0), -(-1.6 - 3.0));
  await setYaw(yaw);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const [x, y, z] = await pos();
  const wet = y < 0.05;
  console.log(`${wet ? 'FAIL' : 'ok  '} 落水禁行 停在 (${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)})`);
  if (wet) ok = false;
}
await browser.close();
console.log(ok ? '\nPLAYTEST PASS' : '\nPLAYTEST FAIL');
process.exit(ok ? 0 : 1);
