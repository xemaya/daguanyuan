#!/usr/bin/env node
/**
 * record.mjs — 录一段园中巡游，给纪录片留素材。
 *
 *   node tools/record.mjs --url http://127.0.0.1:4801/garden.html
 *   node tools/record.mjs --out docs/film/walk --tag pq3
 *
 * 与 `tools/playtest.mjs` 的分工：**试玩是验碰撞的，它按住 W 一步步走，画面是颠的；
 * 这里是运镜**，在关键机位之间做缓动插值，画面是滑的。两者的坐标都来自同一条游线，
 * 但试玩不许作弊（走不通就是 bug），运镜可以穿墙飞。
 *
 * 用 Playwright 的 `recordVideo` 而不是逐帧截图：截图循环的时间步长不均匀，
 * 水、竹、云这些一直在动的东西会抖（同 PITFALLS P-03 的病根）；录像取的是合成器
 * 的真实输出，是滑的。产物是 webm，再用 ffmpeg 转 mp4。
 */
import { chromium } from 'playwright';
import { mkdirSync, renameSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = {
  url: 'http://127.0.0.1:4801/garden.html',
  out: 'docs/film/walk',
  tag: new Date().toISOString().slice(0, 10),
  width: 1600,
  height: 900,
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--url') args.url = process.argv[++i];
  else if (a === '--out') args.out = process.argv[++i];
  else if (a === '--tag') args.tag = process.argv[++i];
  else if (a === '--width') args.width = Number(process.argv[++i]);
  else if (a === '--height') args.height = Number(process.argv[++i]);
}

/**
 * 机位。坐标是 plan.json 的世界坐标（米，原点园心，+x 东 +z 南）；
 * 取自 `tools/playtest.mjs` 的游线航点与 `plan.json` 的 `buildings[].x/z`。
 * yaw 约定同 PlayerController：forward = (−sin yaw, 0, −cos yaw)，yaw 0 朝北（−Z）。
 *
 * `hold` 是在该机位停几秒（给观众看清），`travel` 是从上一机位飞过来用几秒。
 */
const SHOTS = [
  { at: [55, 2.6, 258], yaw: 0, pitch: 0.02, hold: 2.0, travel: 0, say: '正门外' },
  { at: [55, 2.0, 246], yaw: 0, pitch: 0.10, hold: 1.2, travel: 3.0, say: '白石台矶与抱鼓石' },
  { at: [55, 1.7, 233], yaw: 0, pitch: 0.0, hold: 1.0, travel: 2.2, say: '穿门' },
  { at: [40, 3.0, 214], yaw: 0.6, pitch: 0.04, hold: 1.4, travel: 3.2, say: '翠嶂当面——曲径通幽' },
  { at: [-6, 2.2, 180], yaw: 0.1, pitch: -0.03, hold: 1.6, travel: 4.0, say: '绕出山口,豁然开朗' },
  { at: [-3, 1.8, 166], yaw: 0.05, pitch: -0.06, hold: 1.4, travel: 2.6, say: '沁芳池' },
  { at: [0, 2.2, 153], yaw: 0.0, pitch: 0.06, hold: 1.6, travel: 2.4, say: '沁芳亭' },
  { at: [-40, 2.0, 126], yaw: 1.25, pitch: 0.0, hold: 1.2, travel: 4.2, say: '沿溪向西' },
  { at: [-100, 1.9, 126], yaw: 1.55, pitch: 0.02, hold: 1.2, travel: 3.6, say: '潇湘馆院外' },
  { at: [-105, 1.9, 124], yaw: 3.14, pitch: 0.10, hold: 1.8, travel: 1.6, say: '粉垣月洞门·题「潇湘馆」' },
  { at: [-105, 1.8, 112], yaw: 3.14, pitch: 0.0, hold: 1.4, travel: 2.6, say: '翠竹夹路' },
  { at: [-105, 1.8, 103], yaw: 3.14, pitch: 0.06, hold: 2.2, travel: 2.0, say: '正房阶前' },
];

const lerp = (a, b, t) => a + (b - a) * t;
/** 平滑起停:两端导数为零,飞过去不会一顿一顿。 */
const ease = (t) => t * t * (3 - 2 * t);
/** yaw 走最短弧,免得为了 0.1 弧度绕一整圈。 */
const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

const outDir = resolve(ROOT, args.out);
mkdirSync(outDir, { recursive: true });
const tmpDir = join(outDir, '.raw');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: args.width, height: args.height },
  recordVideo: { dir: tmpDir, size: { width: args.width, height: args.height } },
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

console.log(`[record] ${args.url}`);
await page.goto(args.url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 240000 });
// 让首帧与材质编译落定,否则开头几秒在跳。
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const g = window.__GAME__;
  g.hud?.dialogue?.close?.();
  g.hud?.hideLoading?.();
  g.engine.input.suspended = true; // 运镜期间不许键盘插手
});

/** 把相机放到一个机位。pitch 由玩家控制器的 pitch 字段承担。 */
const place = (pos, yaw, pitch) =>
  page.evaluate(
    ([x, y, z, ya, pi]) => {
      const g = window.__GAME__;
      g.player.teleport(new g.THREE.Vector3(x, y, z), ya);
      if (g.player.state && 'pitch' in g.player.state) g.player.state.pitch = pi;
      g.player.applyCamera?.();
    },
    [pos[0], pos[1], pos[2], yaw, pitch],
  );

const STEP = 1000 / 30; // 运镜按 30 步/秒下发,录像自己按合成器的节奏取帧
let prev = SHOTS[0];
await place(prev.at, prev.yaw, prev.pitch);

for (let i = 0; i < SHOTS.length; i++) {
  const s = SHOTS[i];
  if (s.travel > 0) {
    const steps = Math.max(1, Math.round((s.travel * 1000) / STEP));
    for (let k = 1; k <= steps; k++) {
      const t = ease(k / steps);
      await place(
        [lerp(prev.at[0], s.at[0], t), lerp(prev.at[1], s.at[1], t), lerp(prev.at[2], s.at[2], t)],
        lerpAngle(prev.yaw, s.yaw, t),
        lerp(prev.pitch, s.pitch, t),
      );
      await page.waitForTimeout(STEP);
    }
  }
  await place(s.at, s.yaw, s.pitch);
  console.log(`  ${String(i + 1).padStart(2)}/${SHOTS.length}  ${s.say}`);
  await page.waitForTimeout(s.hold * 1000);
  prev = s;
}

await page.close();
await context.close();
await browser.close();

// Playwright 的文件名是随机 hash,取最新那个改名。
const webm = readdirSync(tmpDir).filter((f) => f.endsWith('.webm')).map((f) => join(tmpDir, f))[0];
if (!webm) {
  console.error('[record] 没拿到录像文件');
  process.exit(1);
}
const finalWebm = join(outDir, `${args.tag}.webm`);
renameSync(webm, finalWebm);
rmSync(tmpDir, { recursive: true, force: true });

const mp4 = join(outDir, `${args.tag}.mp4`);
try {
  execFileSync('ffmpeg', ['-y', '-i', finalWebm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  console.log(`[record] → ${args.out}/${args.tag}.mp4`);
} catch {
  console.log(`[record] ffmpeg 转码失败,webm 留在 ${args.out}/${args.tag}.webm`);
}
if (existsSync(mp4)) rmSync(finalWebm);
