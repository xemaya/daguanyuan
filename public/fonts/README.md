# public/fonts —— 匾额字体

## 用的是哪一款

**AR PL UKai（文鼎 PL 中楷，取 `ukai.ttc` 第 0 个字面 "AR PL UKai CN"）**

| | |
|---|---|
| 授权 | Arphic Public License（全文见同目录 `ARPHICPL.TXT`） |
| 版权 | Copyright (C) 1999 Arphic Technology Co., Ltd. |
| 上游来源 | Debian 源包 `fonts-arphic-ukai_0.2.20080216.2.orig.tar.bz2`（http://deb.debian.org/debian/pool/main/f/fonts-arphic-ukai/ ，2026-09-17 下载，9.7 MB，内含 `ukai.ttc` 与全部语言的许可证文本） |
| 本目录里的文件 | `ARPLUKai-plaque-subset.woff2`（31 KB，90 个字面） |

Arphic Public License 允许再分发与改动（含子集化），条件是保留 `ARPHICPL.TXT`
原文、改动处标注「改了什么、什么时候」（本 README 即改动标注）。许可证里
「Font」的定义含 GB 字集各款，UKai CN 字面在其 GB 系列内。

## 为什么是它（单子 AW2 裁定，2026-09-17 用户选定）

旧字体 **Ma Shan Zheng 是简体字集**：全园 31 块匾繁体化后需要的 83 个繁体字
里它缺 32 个（觀 園 瀟 館 簾 蕪 …），繁体化因此不是改字符串而是换字体。
候选覆盖核验：LXGW WenKai TC 缺 0、AR PL UKai 缺 0、Yuji Syuku/Boku 缺 5
（榭 櫳 漵 荇 蘅）。用户选 UKai：楷書有顿笔、结构像真匾、83 字全有；
字重偏细由 `plaque.ts` 的双层描边补。对照图 `shots/plaque-font/compare.png`。

## 为什么是子集，不是整份

`ukai.ttc` 整份约 19 MB（四个字面），取第 0 个字面也有 4.5 MB，而全园
31 块匾 + 数字一共只用得到 **90 个字面**。子集后 **31 KB**。

字集不是随手挑的，它是 **`plan.json` 里所有 `regions[].buildings[].plaque` 的字**
（匾额文字的单一真源，见 `missing 99-26` 与 `builder/plan/objects.ts`）。
`regions[].rocks[].plaque`（摩崖题字石「曲徑通幽處」）**不在这一档**——
题字石走 `plaque.ts` 的 `inscriptionTexture`，用的是系统楷体，与匾额是两条路。

## plan.json 加了新匾额怎么办

**跑一次下面这条命令重新子集化。** 漏了不会崩，但那块匾会**静默回落**到系统楷体，
同一园子里两种字。`plaque.ts` 的 `warnPlaqueGlyphGaps()` 会在控制台喊
「不在字体子集里」——看到那行就是该重跑这条命令了。

```sh
# ① 取出 plan 里所有匾额用到的字
python3 - <<'PY' > /tmp/plaque-chars.txt
import json
d = json.load(open('projects/daguanyuan/plan.json'))
chars = set()
for r in d.get('regions', []):
    for b in r.get('buildings', []):
        if b.get('plaque'): chars.update(b['plaque'])
print(''.join(sorted(chars)) + ' 0123456789')
PY

# ② 取 ukai.ttc 第 0 个字面（需要 pip install fonttools brotli）
curl -sL -o /tmp/ukai.tar.bz2 \
  http://deb.debian.org/debian/pool/main/f/fonts-arphic-ukai/fonts-arphic-ukai_0.2.20080216.2.orig.tar.bz2
tar xjf /tmp/ukai.tar.bz2 -C /tmp
python3 -c "
from fontTools.ttLib import TTCollection
TTCollection('/tmp/fonts-arphic-ukai-0.2.20080216.2/ukai.ttc').fonts[0].save('/tmp/ukai-face0.ttf')
"

# ③ 子集化
pyftsubset /tmp/ukai-face0.ttf \
  --text-file=/tmp/plaque-chars.txt \
  --flavor=woff2 --output-file=public/fonts/ARPLUKai-plaque-subset.woff2 \
  --layout-features='' --no-hinting --desubroutinize
```

## 谁在用它

- `@font-face` 声明：`garden.html` / `viewer.html` / `fashi.html` 三处同一条
  （相对 URL，`BASE=/daguanyuan/` 构建时才跟着走）。单子 AT 时发现只有
  garden.html 有这条声明、棚拍（viewer.html）就回落成系统楷体——三处必须一起改。
- 画字：`builder/parts/xiaomu/plaque.ts` 的 `plaqueTexture()`。字体是异步到位的，
  所以那里先用回落字体画一版、`document.fonts.load()` 完成后再重画一次并 `needsUpdate`。
