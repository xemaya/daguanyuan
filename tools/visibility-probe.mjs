#!/usr/bin/env node
/**
 * visibility-probe.mjs — filtered_view 的 3D 可见性尺子（单子 AL-c c1，`D-33` ①）。
 *
 *   node tools/visibility-probe.mjs --url http://127.0.0.1:5192/garden.html [--entry X-05]
 *        [--view -105,122 --view -105,103] [--out shots/AL-c/probe] [--write]
 *        [--mutate hide-bamboo|hide-target]
 *
 * 平面那把（`experience-audit.mjs` 的 `occlusion-ratio`）拿 1.1 m 实体盘挡 24 条平面视线：
 * 不认墙、不认高度。X-05 登记视点 (−94,124) 在院墙外，正房本来就被粉墙挡住，它照样算竹挡。
 * 这一把在**活世界**里人眼高渲染，按像素数：
 *
 *   A = 竹子隐藏时看得见的正房像素（墙、别的房子、树、地形照样挡）
 *   B = 竹子显示时看得见的正房像素
 *   ratio = 1 − B / A        ——分母是「竹子不在时看得见的正房」，不是全屏；墙挡掉的在 A、B 里都没有。
 *
 * **正房的像素怎么认**：构件进世界后被 `assembleStatic` 跨构件合批/实例化，正房已经没有自己的
 * Object3D（P-? 同一个坑：清单是合并后唯一的身份）。所以按**片元的世界坐标**认——世界自报清单
 * （`Garden.userData.constructions`）里目标的 position / size / yaw 给出一只包围盒，`GardenStatic`
 * 的片元落在盒里就涂品红、盒外涂黑；盒里别的登记件（`taihu:peak4` 这种有 size 的）挖掉。
 * 盒底抬到构件基准面上 5 cm，路牙（出露 3.5 cm）与地面不算正房；檐下灯笼没有 size、算正房。
 * 只有 `GardenStatic` 换材质：竹、树、灌木、地形、天都用**原材质**渲染，竹叶按 alpha 裁形挡，
 * 不会被当成实心方片。
 *
 * **动画冻结**：与 `capture.mjs` 同一个 `freezeGame`（`fixedTime = 10`、风时钟钉死），
 * 竹竿竹叶停在同一姿态；数叶不数竿之外不做别的取舍——叶子本来就是遮映的主体。
 *
 * 渲染不走后处理：直接 `renderer.render` 进一只 RGBA8 RenderTarget 再读回，品红是无光照、
 * 不走色调映射的 (255,0,255)，自然渲染的像素不会恰好等于它。
 *
 * `--write` 把 `from` 视点那组量值写进 `projects/daguanyuan/experience-measured.json`，
 * 带 `inputsHash`（见 `experience-audit.mjs` 的 `experienceInputsHash`）。
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { experienceInputsHash, MEASURED_PATH } from './experience-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = { url: 'http://127.0.0.1:5173/garden.html', entry: 'X-05', views: [], out: 'shots/AL-c/probe', write: false, mutate: null, width: 1600, height: 900, eye: 1.6, minPx: 800 };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--url') args.url = process.argv[++i];
  else if (a === '--entry') args.entry = process.argv[++i];
  else if (a === '--view') args.views.push(process.argv[++i].split(',').map(Number));
  else if (a === '--out') args.out = process.argv[++i];
  else if (a === '--write') args.write = true;
  else if (a === '--mutate') args.mutate = process.argv[++i];
}
if (args.mutate && !['hide-bamboo', 'hide-target'].includes(args.mutate)) { console.error(`--mutate 只认 hide-bamboo / hide-target`); process.exit(2); }
if (args.write && args.mutate) { console.error('--write 与 --mutate 不许同用:突变的数不许落盘'); process.exit(2); }

const plan = JSON.parse(readFileSync(resolve(ROOT, 'projects/daguanyuan/plan.json'), 'utf8'));
const entry = plan.experience.find((e) => e.id === args.entry);
if (!entry || entry.type !== 'filtered_view') { console.error(`${args.entry} 不存在或不是 filtered_view`); process.exit(2); }
const target = entry.targets[0];
const views = [...(entry.from ?? []).map((f) => ({ at: f, registered: true })), ...args.views.map((v) => ({ at: v, registered: false }))];

const outDir = resolve(ROOT, args.out);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-webgl', '--force-device-scale-factor=1'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__GAME__ !== undefined, null, { timeout: 200000 });
// 与 capture.mjs 的 freezeGame 同一段:时间与风钉死,竹子停在同一姿态。
await page.evaluate(() => {
  const e = window.__GAME__.engine;
  e.adaptiveResolution = false;
  e.fixedTime = 10;
  e.governResolution = () => {};
  const world = window.__GAME__.world;
  const update = world.update.bind(world);
  world.update = (dt) => { world.ctx.env.windTime.value = 10 - dt; update(dt, 10); };
});
await page.evaluate(() => new Promise((res) => { let n = 0; const s = () => (++n >= 20 ? res() : requestAnimationFrame(s)); requestAnimationFrame(s); }));

const results = [];
for (const view of views) {
  const r = await page.evaluate(async ({ at, target, W, H, eye, mutate }) => {
    const g = window.__GAME__, T = g.THREE, renderer = g.engine.renderer, scene = g.engine.scene;
    const tslUrl = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/three_tsl\.js/.test(n));
    if (!tslUrl) return { error: '页面里找不到 three/tsl 模块' };
    const TSL = await import(tslUrl);
    // g.THREE 是 'three' 核心,节点材质在 'three/webgpu'——同一个 vite 预构建模块,取页面已加载的那一份。
    const gpuUrl = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/three_webgpu\.js/.test(n));
    if (!gpuUrl) return { error: '页面里找不到 three/webgpu 模块' };
    const W3 = await import(gpuUrl);
    const garden = g.world.root.children.find((c) => c.name === 'Garden');
    const recs = garden?.userData.constructions ?? [];
    const tr = recs.find((x) => x.planId === target || x.id === target);
    if (!tr || !tr.size) return { error: `世界清单里没有 ${target} 或它没有 size` };
    const MARGIN = 0.3;
    const box = { c: [tr.position[0], tr.position[2]], h: [tr.size[0] / 2 + MARGIN, tr.size[2] / 2 + MARGIN], yaw: tr.yaw ?? 0, y0: tr.position[1] + 0.05, y1: tr.position[1] + tr.size[1] + MARGIN };
    const inBox2 = (x, z, b) => { const dx = x - b.c[0], dz = z - b.c[1], c = Math.cos(b.yaw), s = Math.sin(b.yaw); return Math.abs(dx * c - dz * s) <= b.h[0] && Math.abs(dx * s + dz * c) <= b.h[1]; };
    const excl = recs.filter((x) => x !== tr && x.size && inBox2(x.position[0], x.position[2], box))
      .map((x) => ({ id: x.id, c: [x.position[0], x.position[2]], h: [x.size[0] / 2 + 0.1, x.size[2] / 2 + 0.1], yaw: x.yaw ?? 0, y0: x.position[1] - 0.5, y1: x.position[1] + x.size[1] + 0.1 }));
    // 片元世界坐标在盒里 → 1。R_y(yaw) 的逆:lx = dx·cos − dz·sin,lz = dx·sin + dz·cos。
    const { positionWorld, float, vec3, abs, step, mix, cos, sin } = TSL;
    const inside = (b) => {
      const dx = positionWorld.x.sub(float(b.c[0])), dz = positionWorld.z.sub(float(b.c[1]));
      const c = float(Math.cos(b.yaw)), s = float(Math.sin(b.yaw));
      const lx = dx.mul(c).sub(dz.mul(s)), lz = dx.mul(s).add(dz.mul(c));
      return step(abs(lx), float(b.h[0])).mul(step(abs(lz), float(b.h[1])))
        .mul(step(float(b.y0), positionWorld.y)).mul(step(positionWorld.y, float(b.y1)));
    };
    let m = mutate === 'hide-target' ? float(0) : inside(box);
    for (const e of excl) m = m.mul(float(1).sub(inside(e)));
    const maskCache = new Map();
    const maskFor = (orig) => {
      if (maskCache.has(orig)) return maskCache.get(orig);
      const mat = new W3.MeshBasicNodeMaterial({ fog: false, toneMapped: false, side: orig.side });
      mat.colorNode = mix(vec3(0, 0, 0), vec3(1, 0, 1), m);
      // 保留裁形:原材质的 alpha 裁剪/顶点位移原样带过来,镂空处照旧透。
      for (const k of ['opacityNode', 'alphaTestNode', 'maskNode', 'positionNode']) if (orig[k]) mat[k] = orig[k];
      if (orig.alphaTest) { mat.alphaTest = orig.alphaTest; if (orig.map && !orig.opacityNode) mat.opacityNode = TSL.texture(orig.map).a; }
      maskCache.set(orig, mat);
      return mat;
    };
    const statics = garden.children.find((c) => c.name === 'GardenStatic');
    const swapped = [];
    statics.traverse((o) => { if (!o.isMesh) return; swapped.push([o, o.material]); o.material = Array.isArray(o.material) ? o.material.map(maskFor) : maskFor(o.material); });
    const bamboo = garden.children.filter((c) => /^bamboo:|^竹夹路/.test(c.name));

    // 相机:人眼高、朝目标包围盒中心。
    const gy = g.world.collision.groundHeight ? g.world.collision.groundHeight(at[0], at[1]) : null;
    const groundY = Number.isFinite(gy) ? gy : null;
    if (groundY === null) return { error: 'collision.groundHeight 不可用' };
    const cam = g.engine.camera.clone();
    cam.aspect = W / H; cam.near = 0.05; cam.far = 2000; cam.updateProjectionMatrix();
    cam.position.set(at[0], groundY + eye, at[1]);
    cam.lookAt(box.c[0], (box.y0 + box.y1) / 2, box.c[1]);
    cam.updateMatrixWorld(true);

    const rt = new W3.RenderTarget(W, H, { depthBuffer: true });
    const shoot = async (showBamboo) => {
      for (const b of bamboo) b.visible = showBamboo;
      await renderer.compileAsync(scene, cam);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H);
      let n = 0;
      const img = new Uint8ClampedArray(W * H * 4), raw = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const hit = px[i * 4] > 250 && px[i * 4 + 1] < 5 && px[i * 4 + 2] > 250;
        if (hit) n++;
        const v = hit ? 255 : 0;
        img[i * 4] = v; img[i * 4 + 1] = v; img[i * 4 + 2] = v; img[i * 4 + 3] = 255;
        raw[i * 4] = px[i * 4]; raw[i * 4 + 1] = px[i * 4 + 1]; raw[i * 4 + 2] = px[i * 4 + 2]; raw[i * 4 + 3] = 255;
      }
      const toPng = async (data) => {
        const cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d');
        ctx.putImageData(new ImageData(data, W, H), 0, 0);
        const blob = await cv.convertToBlob({ type: 'image/png' });
        return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      };
      return { n, png: await toPng(img), raw: await toPng(raw) };
    };
    try {
      // 预热:两种状态各渲一遍不计数。WebGPU 管线是懒编译的,第一遍会漏画
      // (实测第一个视点的 A 读成 0、B 却有 3207——B 不可能大于 A)。
      await shoot(false); await shoot(true);
      const A = await shoot(false);
      const B = await shoot(mutate === 'hide-bamboo' ? false : true);
      return { A: A.n, B: B.n, pngA: A.png, pngB: B.png, rawA: A.raw, rawB: B.raw, box, excluded: excl.map((e) => e.id), camY: +(groundY + eye).toFixed(3) };
    } finally {
      for (const b of bamboo) b.visible = true;
      for (const [o, mat] of swapped) o.material = mat;
      rt.dispose();
    }
  }, { at: view.at, target, W: args.width, H: args.height, eye: args.eye, mutate: args.mutate });
  if (r.error) { console.error(`视点 (${view.at}):${r.error}`); await browser.close(); process.exit(3); }
  const tag = `${view.at.join('_')}${args.mutate ? `-${args.mutate}` : ''}`;
  writeFileSync(resolve(outDir, `${tag}-A.png`), Buffer.from(r.pngA, 'base64'));
  writeFileSync(resolve(outDir, `${tag}-B.png`), Buffer.from(r.pngB, 'base64'));
  // 掩码渲染的原图(品红 = 认作正房的片元,其余照原材质):看掩码认得对不对。
  writeFileSync(resolve(outDir, `${tag}-A-render.png`), Buffer.from(r.rawA, 'base64'));
  writeFileSync(resolve(outDir, `${tag}-B-render.png`), Buffer.from(r.rawB, 'base64'));
  const visible = r.A >= args.minPx;
  const ratio = visible ? +(1 - r.B / r.A).toFixed(4) : null;
  results.push({ from: view.at, registered: view.registered, A: r.A, B: r.B, ratio, visible, excluded: r.excluded, camY: r.camY });
  console.log(`  (${view.at})${view.registered ? ' 登记视点' : ''}  A ${r.A}  B ${r.B}  ` + (visible ? `ratio ${ratio}` : `看不见目标(A < ${args.minPx} px)`) + (r.excluded.length ? `  挖掉:${r.excluded.join(',')}` : ''));
}
await browser.close();

if (args.write) {
  const reg = results.filter((r) => r.registered);
  if (!reg.length) { console.error('条目没有登记视点,没有可落盘的数'); process.exit(2); }
  const path = resolve(ROOT, MEASURED_PATH);
  const all = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch {}
  const scene = JSON.parse(readFileSync(resolve(ROOT, `projects/daguanyuan/scenes/${entry.filters.scene}.json`), 'utf8'));
  all[entry.id] = {
    ratio: reg.length === 1 ? reg[0].ratio : Math.max(...reg.map((r) => r.ratio ?? 1)),
    views: reg.map(({ from, A, B, ratio, visible }) => ({ from, A, B, ratio, visible })),
    visible: reg.every((r) => r.visible),
    measuredAt: new Date().toISOString(),
    commit,
    inputsHash: experienceInputsHash(plan, entry, scene),
    tool: 'tools/visibility-probe.mjs',
  };
  writeFileSync(path, JSON.stringify(all, null, 2) + '\n');
  console.log(`已写 ${MEASURED_PATH} 的 ${entry.id}`);
}
