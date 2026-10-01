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
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* 脚下序列**默认记录**（2026-09-15 改）。原先它在 `--surfaces` 后面，于是
 * 它不是常跑的回归项——**一道要靠人记得加 flag 才会跑的门，等于没有门**。
 * 实际吃过一次亏：验收单子 AI 时忘了加，读到的是上一轮的 `shots/
 * playtest-surfaces.json`，差点把旧数字当新结论。它本来就零额外成本
 * （playtest 已经在走那条线，只是多采一串 `surfaceAt`）。
 * 保留 `--no-surfaces` 给只想验通行、不想写盘的场合。 */
const args = { url: 'http://127.0.0.1:4801/garden.html', surfaces: true };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--url') args.url = process.argv[++i];
  else if (process.argv[i] === '--surfaces') args.surfaces = true; // 兼容旧命令行
  else if (process.argv[i] === '--no-surfaces') args.surfaces = false;
}

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
  /* ---- 潇湘馆院内(单子 AL2/AL3 重排) ----------------------------------
   * 甬路从五点直线改成羊肠曲路(plan 的 xiaoxiangguan.court-path),院内航点
   * 逐点落在新折线的顶点上。
   *
   * **顺序换了**:原来过了月洞门先折去西侧游廊、最后才回正房阶前,于是
   * 「月洞门→阶前」这一段在脚下序列里被游廊那一大段草地劈成两截,
   * 根本看不出甬路连不连续。单子 AL2 的判据是「脚下序列月洞门→阶前**连续
   * stone**」,所以改成:进门先把甬路一口气走完到阶下,再折去游廊支线。
   *
   * 到达半径收到 0.4m(缺省 0.9m):石子漫净宽只有 1.0m,0.9m 的到达半径允许
   * 人在拐点上抄近道踩到路外的苔地,脚下序列当场就断了——这不是几何缺陷,
   * 是尺子太松。
   *
   * 游廊支线**反向走**(从后院南口上廊面、北口下廊面):AL3 的竹夹路沿甬路
   * 两侧各偏 1.1m 一直种到月洞门口,门内往西那条缝只剩半米出头,人过不去。
   * 竹就该夹到门口——07-41「一進門,只見兩邊翠竹夾路」——不为试玩让路;
   * 改走后院这一头,廊面是 addPolygonPlatform,两头都能上。
   */
  [-105.35, 119.5, '门内,踏上石子漫', 0.4],
  [-106.414, 118, '甬路第一弯(向西)', 0.4],
  [-107, 116, '甬路西弯顶', 0.4],
  [-106.414, 114, '甬路西弯收', 0.4],
  [-105, 112, '甬路过轴(cu_xx_path 机位)', 0.4],
  [-103.824, 109.4, '甬路第二弯(向东)', 0.4],
  [-103.098, 106.8, '甬路东弯顶(北)', 0.4],
  [-103.098, 104.2, '甬路东弯顶(南)', 0.4],
  [-103.824, 101.6, '甬路东弯收', 0.4],
  [-105, 99, '甬路南端(正房阶下)', 0.4],
  [-105, 98, '潇湘馆阶前(门内)'],
  [-105, 101, '退回阶下'],
  // 西折要从 z≈105 这一档绕:直接从 z≈101 往西会正对后院墙下那块散石
  // (taihu:peak4 @ -109.4,101.6),实测顶在 (-108.5,100.9) 过不去。
  [-107.5, 105, '阶下西折(绕开竹夹路)'],
  [-111.5, 105, '绕过散石 taihu:peak4'],
  [-113, 96, '正房西山墙外南下'],
  [-113, 86, '后院西侧'],
  [-116, 84, '曲廊后院口(上廊面)', 0.3],
  [-126, 84, '曲廊第三转角', 0.3],
  [-126, 104, 'plan西廊锚点', 0.3],
  [-126, 108, '曲廊第二转角', 0.3],
  [-116, 108, '曲廊第一转角', 0.3],
  [-116, 117, '曲廊北端廊面', 0.3],
  [-116, 119, '走下廊面'],
  /* ---- e08 潇湘馆 → 稻香村(单子 BA4,2026-09-28 追加)-----------------------
   * 廊北端下廊后门内往东是竹夹路(见上),出不去:沿曲廊原路退回后院口,绕正房西山墙、
   * 走甬路出月洞门,照 plan ch17.e07 出院。
   * 出院后**不照 e08 折线直线走**:直线 (-148,66)→(-172,40)→(-186,18) 翻青山山尖(实测 7.8 m 高)、
   * (-186,18)→(-192,-12) 翻篱外山坡(4.6 m)。改走地形场量出来的低走廊——沿青山北麓西行、
   * 转过山怀西口、下到篱外山坡东脚——才是「青山斜阻、转过山怀」的走法,全程地面 ≤ 1.7 m。
   * 坡东脚 (-181.2,0.5)~(-181.4,2.4) 一带地面 0.04–0.06 低于水线被判落水(实测 blockedAt=true),贴坡走 x=-186 一线(0.35–1.65 m)。
   * 过溪木桥 connection.daoxiang-creek(BA4 起才建进世界)→ 村口 → 泥墙 3 m 开口 → 茆堂前。 */
  [-116, 117, '廊面北端(回)', 0.3],
  [-116, 108, '曲廊第一转角(回)', 0.3],
  [-126, 108, '曲廊第二转角(回)', 0.3],
  [-126, 84, '曲廊第三转角(回)', 0.3],
  [-116, 84, '曲廊后院口(回)', 0.3],
  [-113, 86, '下廊面(后院)'],
  [-113, 96, '西山墙外北上'],
  [-111.5, 105, '绕回散石北'],
  [-107.5, 105, '阶下西'],
  [-105, 106.5, '上甬路', 0.4],
  [-105, 112, '甬路过轴(北行)', 0.4],
  [-105, 120, '月洞门内', 0.4],
  [-105, 122, '月洞门中'],
  [-105, 125, '出月洞门'],
  [-124, 124, '院墙外西行(e07)'],
  [-136, 116, 'e07 西南折'],
  [-140, 90, 'e07 南下'],
  [-148, 66, '青山斜阻(n08)'],
  [-168, 57, '沿青山北麓西行'],
  [-184, 44, '转过山怀'],
  [-189, 30, '山怀西口'],
  [-189, 20, '下向篱外山坡'],
  [-184, 8, '篱外山坡东'],
  [-186, 3, '贴坡脚南行'],
  [-186, -3, '坡脚南'],
  [-190.6, -5, '过溪木桥北头', 0.6],
  [-192, -12, '木桥上', 0.5],
  [-196, -18, '村口(桥南头)'],
  [-196, -27, '泥墙开口前', 0.6],
  [-196, -31, '穿泥墙开口', 0.6],
  [-196, -35, '墙内'],
  [-202, -46, '茆堂前(n09)'],
  /* ---- e09 出村(单子 BD2,2026-09-29 追加)-------------------------------
   * e09 叙事折线已改绕茆堂西山(原折线直穿屋身)。沿新折线走:茆堂前西行 → 西山外北上 → 屋后回到折线 →
   * 菜畦间(畦按 e09 两侧各让 1.6 m)→ 北口 (−196,−98)。**不 teleport**。 */
  [-208.8, -47.5, '茆堂前西折(e09)'],
  [-208.8, -58.5, '绕茆堂西山北上'],
  [-202, -62, '屋后回到 e09'],
  [-201, -73, '菜畦间(e09)'],
  // 下畦一步:e09 两侧各让 1.6 m 是路,脚下是草;踩进畦里才验得到「菜畦」地类(BD3 判据)。
  [-197.5, -74.5, '下畦(菜畦地类)'],
  [-200.8, -78, '回到 e09'],
  [-200, -84, '菜畦间北段(e09)'],
  [-196, -98, '北口(entrance)'],
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
// 单子 BH2:自动化下 `__GAME__` 要等后台把其余区建完才发(不读半成品),比以前多等 B 段;超时放宽到 540 s(同 P-38 的思路)。
await page.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 540000 });
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

/* 单子 AD · 第二档「脚下序列」：沿游线记录每一步脚下的材质，按里程做游程
 * 压缩。走一趟不多花一秒，抓的是「路走一半变土」「桥面材质不对」「院内该
 * 石子漫却是土」这一类人眼要正好走到那一步才看得见的缺陷。
 * 里程只累加走出来的距离；卡住后的 teleport 不计(那不是走过去的)。 */
const surfaceRuns = [];
let mileage = 0;
let lastXZ = null;
const sampleSurface = async () => {
  if (!args.surfaces) return;
  const [x, z, s] = await page.evaluate(() => {
    const g = window.__GAME__;
    const p = g.player.state.position;
    return [p.x, p.z, g.world.ctx.collision.surfaceAt(p.x, p.z)];
  });
  const step = lastXZ ? Math.hypot(x - lastXZ[0], z - lastXZ[1]) : 0;
  lastXZ = [x, z];
  if (step > 3) return; // teleport，不是走过去的,断开这一段
  mileage += step;
  const tail = surfaceRuns[surfaceRuns.length - 1];
  if (tail && tail.surface === s) tail.to = mileage;
  else surfaceRuns.push({ from: mileage, to: mileage, surface: s });
};

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
    await sampleSurface();
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
/* 单子 BH2:游园图点到还没在后台建好的区——插队首、挡幕、建好再落地,落地不许掉(碰撞随区一起挂上)。
 * 另开一页 `?phaseA&streamHold`:A 段就接手,B 段不自己出队,只建点名的区,于是这几个区在点之前一定没建。
 * 走的是与游园图点地点同一条路(`__GAME__.gotoRegion`)。 */
{
  const holdUrl = args.url + (args.url.includes('?') ? '&' : '?') + 'phaseA&streamHold';
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p2.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p2.goto(holdUrl, { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 540000 });
  const targets = await p2.evaluate(() => Object.entries(window.__GAME__.world.streaming.units).filter(([, s]) => s !== 'built').map(([u]) => u));
  if (!targets.length) console.log('ok   传送到未建区 (流式关着或全部已建,跳过)');
  for (const id of targets) {
    const r = await p2.evaluate(async (id) => {
      const g = window.__GAME__, col = g.world.ctx.collision;
      const before = { state: g.world.streaming.units[id], colliders: col.colliders.length, platforms: col.platforms.length };
      const p = g.gotoRegion(id);
      const veilUp = g.hud.veil.visible;
      await p;
      const after = { state: g.world.streaming.units[id], colliders: col.colliders.length, platforms: col.platforms.length, veil: g.hud.veil.visible };
      for (let i = 0; i < 90; i++) g.player.update(1 / 60);
      const q = g.player.state.position;
      return { before, veilUp, after, x: q.x, y: q.y, z: q.z, ground: col.groundHeight(q.x, q.z), terrain: col.terrainHeight(q.x, q.z) };
    }, id);
    const fell = !(r.y > -0.3) || Math.abs(r.y - r.ground) > 0.3;
    const good = r.before.state === 'queued' && r.veilUp && r.after.state === 'built' && !r.after.veil && !fell && r.after.colliders > r.before.colliders;
    if (!good) ok = false;
    console.log(`${good ? 'ok  ' : 'FAIL'} 传送到未建区 ${id.padEnd(18)} 点前 ${r.before.state}/幕 ${r.veilUp ? '起' : '没起'} → ${r.after.state}` +
      `  碰撞体 ${r.before.colliders}→${r.after.colliders} 平台 ${r.before.platforms}→${r.after.platforms}` +
      `  落在 (${r.x.toFixed(1)}, ${r.y.toFixed(2)}, ${r.z.toFixed(1)}) 地面 ${r.ground.toFixed(2)}`);
  }
  await p2.close();
}
if (args.surfaces) {
  console.log('\n脚下序列（里程 / 材质）');
  for (const r of surfaceRuns) {
    if (r.to - r.from < 0.3) continue; // 采样抖动,不到 0.3m 的游程不报
    console.log(`  ${r.from.toFixed(1)}-${r.to.toFixed(1)} m`.padEnd(22) + r.surface);
  }
  mkdirSync(resolve('shots'), { recursive: true });
  writeFileSync(resolve('shots/playtest-surfaces.json'), JSON.stringify(surfaceRuns, null, 2));
  console.log(`  → shots/playtest-surfaces.json（${surfaceRuns.length} 段）`);
}
await browser.close();
console.log(ok ? '\nPLAYTEST PASS' : '\nPLAYTEST FAIL');
process.exit(ok ? 0 : 1);
