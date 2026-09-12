#!/usr/bin/env node
/**
 * timelapse.mjs — 把同一机位在各个里程碑上的截图串成一段延时，看园子怎么长出来的。
 *
 * 这套素材是白捡的：`tools/capture.mjs` 的 14 个镜头 id 从 P0 用到现在没改过名
 * （改名会让 `manifest-diff` 与 `side-by-side` 配不上对，所以一直守着），
 * 于是每次验收留下的 `shots/<里程碑>/<id>.png` 天然就是同机位的时间序列。
 *
 *   node tools/timelapse.mjs                      # 全部镜头,各出一段
 *   node tools/timelapse.mjs --shots gate_approach,xiaoxiang
 *   node tools/timelapse.mjs --hold 1.2 --out docs/film/timelapse
 *
 * **世界在 P1 Task 6 换过坐标系**（64×72 m 手摆 → plan.json 的 280×226 m 窗口），
 * 所以同一个镜头 id 在 `p1t6` 前后拍的不是同一个地方。工具不掩盖这件事：
 * 它按时间排、把每帧的里程碑名烧进画面，那一跳是真的，也是故事本身。
 */
import { readdirSync, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'shots');

/**
 * ffmpeg 的 drawtext 不带字体表:不显式给 CJK 字体,中文一律画成方框。
 * 第一次跑就栽在这——「9月10日」成了「99□10□」。
 */
const CJK_FONTS = [
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  '/System/Library/Fonts/STHeiti Medium.ttc',
  '/System/Library/Fonts/Supplemental/Songti.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
];
const FONT = CJK_FONTS.find((f) => existsSync(f));
if (!FONT) console.warn('[timelapse] 找不到 CJK 字体,字幕里的中文会画成方框');

const args = { out: 'docs/film/timelapse', hold: 1.0, shots: null, fps: 30 };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--out') args.out = process.argv[++i];
  else if (a === '--hold') args.hold = Number(process.argv[++i]);
  else if (a === '--fps') args.fps = Number(process.argv[++i]);
  else if (a === '--shots') args.shots = process.argv[++i].split(',').map((s) => s.trim());
}

/** 里程碑目录按修改时间排序——拍摄顺序就是时间顺序。 */
function milestones() {
  const out = [];
  for (const name of readdirSync(SHOTS)) {
    const dir = join(SHOTS, name);
    if (!statSync(dir).isDirectory()) continue;
    const pngs = readdirSync(dir).filter((f) => f.endsWith('.png'));
    if (pngs.length === 0) continue;
    out.push({ name, dir, at: statSync(dir).mtime, ids: new Set(pngs.map((f) => f.slice(0, -4))) });
  }
  return out.sort((a, b) => a.at - b.at);
}

const all = milestones();
if (all.length === 0) {
  console.error('[timelapse] shots/ 下没有截图。先跑 tools/capture.mjs。');
  process.exit(1);
}

// 出现在最多里程碑里的那些 id 才值得做延时。
const tally = new Map();
for (const m of all) for (const id of m.ids) tally.set(id, (tally.get(id) ?? 0) + 1);
const ids = (args.shots ?? [...tally.keys()].filter((id) => tally.get(id) >= 4)).sort();

const outDir = resolve(ROOT, args.out);
mkdirSync(outDir, { recursive: true });
const index = [];

for (const id of ids) {
  const frames = all.filter((m) => m.ids.has(id));
  if (frames.length < 2) {
    console.log(`  ${id.padEnd(16)} 只有 ${frames.length} 个里程碑,跳过`);
    continue;
  }
  // ffmpeg 的 concat demuxer 要一份清单;每帧停 `hold` 秒。
  const listPath = join(outDir, `.${id}.txt`);
  const lines = [];
  for (const f of frames) {
    lines.push(`file '${join(f.dir, `${id}.png`)}'`);
    lines.push(`duration ${args.hold}`);
  }
  // concat demuxer 会吃掉最后一帧的 duration,重复一次才显示得出来。
  lines.push(`file '${join(frames[frames.length - 1].dir, `${id}.png`)}'`);
  writeFileSync(listPath, lines.join('\n'));

  // 每帧左下角烧上里程碑名与日期——没有字幕的延时看不出是哪一步。
  const label = frames
    .map((f, i) => {
      const t0 = i * args.hold;
      const t1 = (i + 1) * args.hold;
      const when = `${f.at.getMonth() + 1}月${f.at.getDate()}日`;
      const text = `${f.name}  ${when}`.replace(/[:']/g, '');
      const font = FONT ? `fontfile='${FONT.replace(/'/g, "\\'")}':` : '';
      return `drawtext=${font}text='${text}':x=40:y=h-70:fontsize=28:fontcolor=0xe8e2d2:box=1:boxcolor=0x16262bcc:boxborderw=12:enable='between(t,${t0},${t1})'`;
    })
    .join(',');

  const mp4 = join(outDir, `${id}.mp4`);
  execFileSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', `scale=1600:-2,${label}`,
    '-r', String(args.fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
    mp4,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  rmSync(listPath);

  const secs = (frames.length * args.hold).toFixed(1);
  console.log(`  ${id.padEnd(16)} ${String(frames.length).padStart(2)} 个里程碑  ${secs}s  → ${args.out}/${id}.mp4`);
  index.push({ id, frames: frames.map((f) => ({ milestone: f.name, at: f.at.toISOString() })) });
}

// 带 --shots 单跑时只更新这几段,**不要把整份索引覆盖掉**——
// 第一次就是这么把 22 段的索引冲成 1 段的。
const indexPath = join(outDir, 'index.json');
let merged = index;
if (args.shots && existsSync(indexPath)) {
  const prev = JSON.parse(readFileSync(indexPath, 'utf8'));
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of index) byId.set(e.id, e);
  merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
writeFileSync(indexPath, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`\n[timelapse] 本次 ${index.length} 段,索引共 ${merged.length} 段 → ${args.out}/index.json`);
