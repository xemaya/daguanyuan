# 单子 AK：三角预算落成一道门（perf-baseline）

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联。**
> 判据形式已由用户拍板，见 `docs/DECISIONS.md` **`D-25`**——本单只是把它焊成工具，**不许改判据本身**。
>
> **文件域**：`tools/manifest-diff.mjs`、`tests/`（新增一个测试文件）、
> `projects/daguanyuan/perf-baseline.json`（新建）。**不碰任何几何、着色、plan、scenes。**
> 与并行中的 AJ / AL / AM 零重叠。

---

## 要做什么

`manifest-diff` 现在只做 A/B 相对比对（`--tolerance` 默认 0），fps 明确不比。
缺的是**一份落盘的基线**和**对基线比**——没有这两样，「相对回归」就只能靠每张单子自己
记得拍 before 图，而 `shots/` 是 `.gitignore` 的，before 图随时会没。

### AK1 · `perf-baseline.json`

新建 `projects/daguanyuan/perf-baseline.json`，照 `coverage-baseline.json` 的做法（顶部 `$comment` 说明用途、数字是量的不是估的）：

```jsonc
{
  "$comment": "...",
  "decision": "D-25",
  "tolerance": 0.03,
  "fpsTarget": 45,
  "shots": {
    "gate_approach": { "drawCalls": 267, "triangles": 4188000, "fps": 47 },
    "mound_block":   { ... },
    "grass_close":   { ... },
    "xiaoxiang":     { ... }
  },
  "measuredAt": "2026-09-15",
  "commit": "<editor HEAD>",
  "history": []
}
```

- **四镜**：`gate_approach` / `mound_block` / `grass_close` / `xiaoxiang`（单子 AJ 用的就是这四镜）。
- **数字由三次连拍取中位数**，三次都写进回报（这是顺手把噪声量清楚，见 AK3）。
- `fps` 只是参考值，写在旁边，**不进比对**。
- `history` 是给验收人抬基线用的数组，每行 `{ "order": "AJ", "shot": "gate_approach", "from": ..., "to": ..., "bought": "瓦当放大到垄距" , "date": ... }`。本单留空。

### AK2 · `manifest-diff --baseline <dir>`

- 读 `<dir>/manifest.json`，对 `perf-baseline.json` 里有的镜逐镜比 `drawCalls` 与 `triangles`，
  用文件里的 `tolerance`（**不许命令行覆盖容差**——容差是 D-25 定的，改它要回 DECISIONS）。
- 输出格式与现在的 `ok / DIFF` 一致，DIFF 行要打出**百分比**与方向（`+4.1%`），
  并在旁边打 fps（`47 fps, 目标 45`），fps 低于目标只**警告**不置红。
- `<dir>` 里有基线没有的镜：忽略；基线有 `<dir>` 没有的镜：`MISSING`，置红。
- 加 `--write-baseline <dirA> <dirB> <dirC>`：三份 manifest 取中位数写 `perf-baseline.json`
  （保留已有 `history`），打印三次原始读数。**写基线必须给三个目录，给一个就拒绝。**
- 退出码：红 → 1，绿 → 0（与现在一致）。
- 现有 A/B 模式、`--coverage`、名册 LOST/GAIN 一行不动。

### AK3 · 顺手把噪声量清楚

标准动作第 8 条记着「同一份代码两次量 `mound_block` 差过 82k（2%）」，但**没人查过是什么在动**。
三次连拍的时候把每镜的 `sceneSubmissions` / `frameSubmissions`（`capture.mjs` 已经在记）一起比一下：

- 是三角数在跳，还是 draw call 也跳？
- 跳的是主场景提交还是阴影提交？

**不用修**，把观察写进回报和 `docs/PITFALLS.md`（新开一条 `P-22`，标题写清「噪声来自哪一层」）。
如果三次都一样、噪声根本不存在，也照实写——那说明 82k 那次另有原因。

### AK4 · 测试

`tests/perf-baseline.test.mjs`：

1. 造一份基线与一份超 3.5% 的 manifest → 必须红；超 2.5% → 必须绿；缺镜 → 红；
2. `--write-baseline` 对三份 `[a, b, c]` 取中位数（用 1/100/2 这种能分出中位与平均的数）；
3. **突变复验**：把容差改成 0.10 再跑 1，红的那条必须变绿——证明门真的读的是文件里的容差。

---

## 判据

- `node tools/manifest-diff.mjs --baseline shots/ak-check` 在 HEAD 上跑**绿**（自己对自己）；
- 手改一份 manifest 把 `gate_approach` 三角 +4% → **红**，并打出 `+4.0%`；
- `npm run check:all` 全过（198 tests + 新增）；
- `perf-baseline.json` 四镜齐、三次读数在回报里；
- `docs/superpowers/plans/STANDARD-ACTIONS.md` 第 8 条里那句「单子 AK 落地前先用 A/B」**由验收人删**，不归本单。

## 回报

三次读数原样贴；中位数；噪声观察（AK3）；`P-22` 写了什么；测试跑了几条。

**规模**：小。**风险**：低。最容易跑偏的地方：**顺手给容差加命令行开关**——不许，D-25 说了容差改动要回 DECISIONS。
