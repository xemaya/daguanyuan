# public/fonts —— 匾额字体

## 用的是哪一款

**Ma Shan Zheng（马善政毛笔楷书）**

| | |
|---|---|
| 授权 | SIL Open Font License 1.1（全文见同目录 `OFL.txt`） |
| 版权 | Copyright 2018 The Ma Shan Zheng Project Authors |
| 上游仓库 | https://github.com/googlefonts/mashanzheng |
| Google Fonts 页 | https://fonts.google.com/specimen/Ma+Shan+Zheng |
| 取得的原始文件 | https://fonts.gstatic.com/s/mashanzheng/v18/NaPecZTRCLxvwo41b4gvzkXaRMQ.ttf （2026-09-16 下载，5.9 MB TTF） |
| 本目录里的文件 | `MaShanZheng-plaque-subset.woff2`（37 KB） |

OFL 1.1 允许再分发与改动（含子集化），条件是保留版权与授权声明、
不把字体单独出售、不用保留名（Reserved Font Name）命名衍生品。
本目录同时放了 `OFL.txt` 原文；子集文件没有改名字（仍叫 `Ma Shan Zheng`），
按 OFL §3 这属于「未改动的再分发」，合规。

## 为什么是子集，不是整份

整份 5.9 MB TTF / 3.2 MB WOFF2，而全园三十来块匾一共只用得到 **78 个汉字**。
子集后 **37 KB**，小了 86 倍。开一次园子省下 3.2 MB，这笔钱不值得花。

字集不是随手挑的，它是 **`plan.json` 里所有 `regions[].buildings[].plaque` 的字**
（匾额文字的单一真源，见 `missing 99-26` 与 `builder/plan/objects.ts`）。
`regions[].rocks[].plaque`（摩崖题字石「曲徑通幽處」）**不在这一档**——
题字石走 `plaque.ts` 的 `inscriptionTexture`，用的是系统楷体，与匾额是两条路；
而且 Ma Shan Zheng 是 `chinese-simplified` 字体，本来就没有「徑」「處」两个字。

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

# ② 子集化（需要 pip install fonttools brotli）
curl -sL -o /tmp/MaShanZheng-Regular.ttf \
  https://fonts.gstatic.com/s/mashanzheng/v18/NaPecZTRCLxvwo41b4gvzkXaRMQ.ttf
pyftsubset /tmp/MaShanZheng-Regular.ttf \
  --text-file=/tmp/plaque-chars.txt \
  --flavor=woff2 --output-file=public/fonts/MaShanZheng-plaque-subset.woff2 \
  --layout-features='' --no-hinting --desubroutinize
```

## 谁在用它

- `@font-face` 声明：`garden.html` 的 `<style>`（相对 URL，`BASE=/daguanyuan/` 构建时才跟着走）。
- 画字：`builder/parts/xiaomu/plaque.ts` 的 `plaqueTexture()`。字体是异步到位的，
  所以那里先用回落字体画一版、`document.fonts.load()` 完成后再重画一次并 `needsUpdate`。
- ⚠️ **`viewer.html` / `fashi.html` 没有这条 `@font-face`**（单子 AT 的文件域只到 `garden.html`）。
  用 `tools/shoot-part.mjs` 单拍匾额构件时看到的是系统楷体，不是园子里的样子。
