#!/usr/bin/env node
/**
 * playtest.mjs — 用键盘走完游线的自动试玩。
 *
 * 不用 teleport 作弊:每个航点先把视线转过去,再按住 W 走,3 秒没进展算卡住。
 * 验的是碰撞层:门能不能穿、桥面能不能上、水会不会掉、假山缝能不能过。
 *
 *   node tools/playtest.mjs --url http://127.0.0.1:4801/garden.html
 *
 * P1 Task 6:世界换到 plan.json 坐标系,航点也跟着换。「十七回游线」前 14
 * 个原始点(正门→潇湘馆,全长 310.6m)里程 156.5→225.1m 是水下(约
 * (-3,171) 到 (-40,128),68.6m),现有的曲桥链(见 composer.ts 的
 * `CAUSEWAY`/`bridgeChain`)沿这段密集铺了航点。
 *
 * 曲桥段的航点不是手推的折线中点,是从实际建好的世界里量出来的:
 * `ctx.collision.platforms`(tag 桥面/台基)里每段桥面/亭台基的真实中心——
 * 桥面半宽只有 0.75m,折线的理论中点和真实桥面中线能差出大半米,窄到
 * 直接把自动试玩带下水(第一版全链 10/10 卡水里)。九个字段以外的每个
 * 路段间距也从旧 50m 的量级涨到几十米,原来 12s/航点的预算不够走完
 * ——这是正常的(游线全长 310.6m,比原来长六倍),不是新卡点,所以长
 * 段改按距离给预算。
 */
import { chromium } from 'playwright';

const args = { url: 'http://127.0.0.1:4801/garden.html' };
for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--url') args.url = process.argv[++i];

/** 通行验收航点（主通路+曲廊支线），不用于计算29节点叙事里程。 */
const ROUTE = [
  [55, 244, '正门台阶前(穿门)'],
  [55, 229, '穿门直行(南墙缺口只在门轴上)'],
  [30, 232, '进园,转向翠嶂'],
  [14, 228, '翠嶂缝中(半程)'],
  [-2, 224, '翠嶂缝中'],
  [-15, 218, '翠嶂缝北段(半程)'],
  [-28, 212, '翠嶂缝北段'],
  // 直线(-28,212)→(-40,196)会斜切翠嶂山体本身(实测山脊高程 9-10m,直线中段
  // 正好爬过山尖而不是绕过);量过地形高程网格后,沿实测的低洼走廊找的这
  // 三个过渡点全程贴着 3.5m 以下的等高线走,不翻山。
  [-34, 206, '翠嶂西口(绕山1)'],
  [-37, 202, '翠嶂西口石栈桥中', 0.3],
  [-40, 198, '翠嶂西口石栈桥北端', 0.3],
  [-40, 196, '翠嶂西口(cuizhang entrance)'],
  [-24, 186, '绕出豁然开朗'],
  [-6, 180, '沁芳池南岸'],
  // ---- 曲桥链:南段引桥 → 石桥三港 → 沁芳亭 → 北段引桥,过 68.6m 水面 ----
  // 下面每个坐标都是活取的桥面/台基中心(见文件头注释),不是折线中点。
  [-1.76, 170.32, '南引桥1'],
  [-2.76, 167.47, '南引桥2'],
  [-0.82, 165.15, '南引桥3'],
  [-0.41, 162.92, '南引桥4'],
  [-1.41, 160.07, '南引桥5'],
  [0.53, 157.75, '南引桥6'],
  [0.75, 154.63, '石桥三港1'],
  [-0.75, 152, '石桥三港2'],
  [0.75, 149.38, '石桥三港3'],
  [0, 148, '沁芳亭中'],
  // 亭子东西各有一道美人靠(railingSides:['e','w'],P-09 同款隐患),第一折
  // 桥面自己 z 形接缝处又有一道短横栏——两者在亭西北角挤在不到 1m² 里,
  // 直线穿过去(不管冲哪个后续目标)都会被弹性势阱一样卡死在同一个点
  // (-1.56,145.9,反复实测 100% 复现,不是随机抖动)。真正打开的走法是先
  // 贴着 z 形桥面自己的折线走:近亭一折的落脚点偏东(0.78,145.58,不是几
  // 何中心 0,148 直接往西南切),再到两折接缝(-0.75,145.2),再下到第二折
  // 的偏移线(-3.0,145.15),全部实测验证过、不在水里。
  [0.78, 145.58, '北引桥1(近亭角)'],
  [-0.75, 145.2, '北引桥1(接缝)'],
  [-3.0, 145.15, '北引桥2'],
  [-3.87, 144.65, '北引桥2b'],
  [-5.41, 142.05, '北引桥3'],
  [-7.85, 140.65, '北引桥4'],
  [-10.87, 140.65, '北引桥5'],
  [-12.41, 138.05, '北引桥6'],
  [-14.53, 136.99, '北引桥7'],
  [-17.52, 137.45, '北引桥8'],
  [-19.43, 135.11, '北引桥9'],
  [-21.03, 134.49, '北引桥10'],
  [-24.02, 134.95, '北引桥11'],
  [-25.93, 132.61, '北引桥12'],
  [-27.53, 131.99, '北引桥13'],
  [-30.52, 132.45, '北引桥14'],
  [-32.43, 130.11, '北引桥15'],
  [-34.03, 129.49, '北引桥16'],
  [-37.02, 129.95, '北引桥17'],
  [-38.93, 127.61, '北引桥18'],
  [-40, 124, '池北岸(对岸)'],
  [-55, 124, '沿溪向潇湘馆(半程)'],
  [-70, 124, '沿溪向潇湘馆'],
  [-94, 124, '从南侧绕过院墙东角'],
  [-100, 122, '潇湘馆院门(entrance)'],
  [-105, 122, '对准plan月洞门'],
  [-105, 120, '穿过plan月洞门'],
  [-105, 118.7, '离开圆门圈再向内院走'],
  [-110, 119, '门内左转向游廊'],
  [-116, 119, '曲廊南入口前'],
  [-116, 117, '走上廊面', 0.3],
  [-116, 108, '曲廊第一转角', 0.3],
  [-126, 108, '曲廊第二转角', 0.3],
  [-126, 104, 'plan西廊锚点', 0.3],
  [-126, 84, '曲廊第三转角', 0.3],
  [-116, 84, '曲廊后院出口', 0.3],
  [-112, 84, '走下廊面'],
  [-113, 104, '绕西侧回前院'],
  [-105, 106, '正房阶前'],
  [-105, 101, '潇湘馆院内'],
  [-105, 98, '潇湘馆阶前(门内)'],
];

/** 长段按距离给预算(至少 12s,每米再加 ~1.1s)——310.6m 的游线本就比旧
 *  50m 的路长六倍,固定 12s/航点会把"还在稳步走"误判成"卡住"。 */
function budgetFor(dist) {
  return Math.max(12000, Math.round(dist * 1100));
}

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
  g.player.teleport(new g.THREE.Vector3(55, 0, 248), 0);
});

const pos = () => page.evaluate(() => { const p = window.__GAME__.player.state.position; return [p.x, p.y, p.z]; });
const setYaw = (yaw) => page.evaluate((y) => { const g = window.__GAME__; const p = g.player.state.position; g.player.teleport(new g.THREE.Vector3(p.x, p.y, p.z), y); }, yaw);

/** 走向一个航点,到 0.9m 内算到达。回放里量过好几段:同一份构建、同一批
 *  桥面航点,哪一站卡住会随机换(headless 按键节流的抖动,不是几何真卡
 *  死——沿途 y 全程停在结构上,没有一次掉到水下),所以卡住先重试一次再
 *  判失败,别把这种抖动当真卡点报。 */
async function walkTo(tx, tz, arrival = 0.9) {
  let [x, y, z] = await pos();
  const budget = budgetFor(Math.hypot(tx - x, tz - z));
  const t0 = Date.now();
  let lastD = Infinity;
  let lastProgress = Date.now();
  while (Date.now() - t0 < budget) {
    [x, y, z] = await pos();
    const d = Math.hypot(tx - x, tz - z);
    if (d < arrival) return { reached: true, x, y, z };
    if (d < lastD - 0.05) { lastD = d; lastProgress = Date.now(); }
    if (Date.now() - lastProgress > 4500) break;
    // 朝向:forward = (-sin yaw, -cos yaw)。
    const yaw = Math.atan2(-(tx - x), -(tz - z));
    await setYaw(yaw);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(120);
    await page.keyboard.up('KeyW');
  }
  return { reached: false, x, y, z };
}

let ok = true;
for (const [tx, tz, label, arrival = 0.9] of ROUTE) {
  let result = await walkTo(tx, tz, arrival);
  let attempts = 1;
  while (!result.reached && attempts < 3) {
    attempts++;
    result = await walkTo(tx, tz, arrival);
  }
  const { reached, x, y, z } = result;
  const status = reached ? (attempts > 1 ? `ok*${attempts}` : 'ok ') : 'STUCK';
  if (!reached) ok = false;
  console.log(`${status} ${label.padEnd(16)} at (${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)})  target (${tx}, ${tz})`);
  if (!reached) {
    // 两次都卡住就跳到航点继续,好把后面的也验完。
    await page.evaluate(([px, pz]) => { const g = window.__GAME__; g.player.teleport(new g.THREE.Vector3(px, 0, pz), 0); }, [tx, tz]);
  }
}
// 落水测试:从池东岸的干地直接往池心走,应该被挡在岸上(或站在桥面上,不会掉进水里)。
await page.evaluate(() => { const g = window.__GAME__; g.player.teleport(new g.THREE.Vector3(34, 0, 148), 0); });
{
  const yaw = Math.atan2(-(-4 - 34), -(148 - 148));
  await setYaw(yaw);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const [x, y, z] = await pos();
  const wet = y < -0.3;
  console.log(`${wet ? 'FAIL' : 'ok  '} 落水禁行 停在 (${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)})`);
  if (wet) ok = false;
}
await browser.close();
console.log(ok ? '\nPLAYTEST PASS' : '\nPLAYTEST FAIL');
process.exit(ok ? 0 : 1);
