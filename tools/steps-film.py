#!/usr/bin/env python3
"""steps-film.py — 把一张单子「逐个提交」拍下的同机位截图做成施工分步片。

延时片(`tools/timelapse.mjs`)的粒度是「一次验收一帧」；这里的粒度是「一个提交一帧」——
验收人给单子的每个提交各开一个 worktree、用 HEAD 的同一份 `shot-list.mjs` 拍同一组镜头，
于是能看到一件件活是怎么叠上去的(赛博工地的施工过程)。

目录约定(`shots/<单子>-steps/`)：每个子目录一步，按名字排序；子目录里是同名镜头 PNG。
每步的字幕从同目录下 `steps.json` 读：{ "<子目录>": "一行说明", ... }。

    python3 tools/steps-film.py shots/AL-steps --shots moon_gate,xx_court_gaze --out docs/film/steps/AL
    python3 tools/steps-film.py shots/AL-steps --grid moon_gate,xx_court_gaze,cu_xx_path,xiaoxiang

出片：每个镜头一段 `<out>-<镜头>.mp4`；带 `--grid` 时另出一段 2×2 四宫格 `<out>-grid.mp4`。
每步停 `--hold` 秒，步与步之间交叉淡入 `--fade` 秒(硬切看不出「长出来」)。
依赖：Pillow、ffmpeg。字体找不到 CJK 就退回默认字体(中文会成方框，先装字体)。
"""
import argparse, json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

CJK_FONTS = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
]

def font(size):
    for f in CJK_FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    print('[steps-film] 找不到 CJK 字体', file=sys.stderr)
    return ImageFont.load_default()

def caption(img, lines, size):
    """左下角烧字：第一行是步名，第二行是说明。底框半透明，与 timelapse 同色。"""
    img = img.convert('RGBA')
    over = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    f1, f2 = font(size), font(int(size * 0.72))
    pad, y = int(size * 0.5), img.size[1] - int(size * 0.5)
    boxes = []
    for i, (t, f) in enumerate(reversed(list(zip(lines, [f1, f2])))):
        if not t:
            continue
        w = d.textlength(t, font=f)
        h = f.size + 8
        y -= h
        boxes.append((t, f, y, w, h))
    top = min(b[2] for b in boxes) - pad // 2
    right = max(b[3] for b in boxes) + pad * 2
    d.rectangle([0, top, right, img.size[1]], fill=(0x16, 0x26, 0x2b, 0xcc))
    for t, f, yy, _, _ in boxes:
        d.text((pad, yy), t, font=f, fill=(0xe8, 0xe2, 0xd2, 255))
    return Image.alpha_composite(img, over).convert('RGB')

def encode(frames_iter, size, fps, out):
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                          '-s', f'{size[0]}x{size[1]}', '-r', str(fps), '-i', '-',
                          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out],
                         stdin=subprocess.PIPE)
    n = 0
    for fr in frames_iter:
        p.stdin.write(fr.tobytes()); n += 1
    p.stdin.close(); p.wait()
    print(f'  -> {out}  {n / fps:.1f}s')

def sequence(stills, fps, hold, fade):
    """stills: [(未烧字的图, 字幕行)] → 逐帧(停 hold 秒,再 fade 秒交叉淡入下一张);末张多停一倍。
    只淡画面不淡字:字幕跟着画面一起淡,两行字叠成重影读不出来(第一版就这样),所以过渡中点硬切字幕。"""
    for i, (im, lines) in enumerate(stills):
        still = caption(im, lines, 34)
        for _ in range(int(hold * fps * (2 if i == len(stills) - 1 else 1))):
            yield still
        if i + 1 < len(stills):
            nxt, nlines = stills[i + 1]
            k = int(fade * fps)
            for j in range(1, k + 1):
                t = j / (k + 1)
                yield caption(Image.blend(im, nxt, t), lines if t < 0.5 else nlines, 34)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir')
    ap.add_argument('--shots', default=None)
    ap.add_argument('--grid', default=None, help='四个镜头拼 2×2')
    ap.add_argument('--out', default=None)
    ap.add_argument('--hold', type=float, default=1.6)
    ap.add_argument('--fade', type=float, default=0.8)
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--title', default='')
    a = ap.parse_args()
    steps = sorted(d for d in os.listdir(a.dir) if os.path.isdir(os.path.join(a.dir, d)))
    notes = {}
    if os.path.exists(os.path.join(a.dir, 'steps.json')):
        notes = json.load(open(os.path.join(a.dir, 'steps.json'), encoding='utf-8'))
    out = a.out or os.path.join('docs/film/steps', os.path.basename(a.dir.rstrip('/')))
    title = a.title or os.path.basename(a.dir.rstrip('/'))

    def still(step, shot, scale=1.0, size=34):
        p = os.path.join(a.dir, step, shot + '.png')
        if not os.path.exists(p):
            return None
        im = Image.open(p).convert('RGB')
        if scale != 1.0:
            im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        return im, p

    shots = a.shots.split(',') if a.shots else sorted({f[:-4] for s in steps for f in os.listdir(os.path.join(a.dir, s)) if f.endswith('.png')})
    for shot in shots:
        ims = []
        for s in steps:
            r = still(s, shot)
            if r:
                ims.append((r[0], [f'{title} · {s}', notes.get(s, '') + f'   [{shot}]']))
        if len(ims) < 2:
            print(f'  skip {shot}: 只有 {len(ims)} 步'); continue
        encode(sequence(ims, a.fps, a.hold, a.fade), ims[0][0].size, a.fps, f'{out}-{shot}.mp4')

    if a.grid:
        g = a.grid.split(',')[:4]
        ims = []
        for s in steps:
            tiles = [still(s, sh, 0.5) for sh in g]
            if any(t is None for t in tiles):
                continue
            w, h = tiles[0][0].size
            canvas = Image.new('RGB', (w * 2, h * 2))
            for i, (t, _) in enumerate(tiles):
                canvas.paste(t, ((i % 2) * w, (i // 2) * h))
            ims.append((canvas, [f'{title} · {s}', notes.get(s, '')]))
        if len(ims) >= 2:
            encode(sequence(ims, a.fps, a.hold, a.fade), ims[0][0].size, a.fps, f'{out}-grid.mp4')

if __name__ == '__main__':
    main()
