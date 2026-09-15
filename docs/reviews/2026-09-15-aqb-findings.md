# 单子 AQ-b 的发现清单

> 标准动作第 13 条：发现新问题记下来，不顺手改。这一份是 AQ-b 三步里
> **量出来、但不属于本单文件域或本单判据**的东西，交验收人与后面的单子。

---

## 1. `gate_approach 33–36 fps` 是尺子的毛病，不是那个机位的毛病（AQ-b0 的正题，已修）

单子 AQ-b0 的前提是「四镜里只有 `gate_approach` 低于目标（33–36），其余 45–48，
而三角与 `mound_block` 相当，所以不是三角的锅」。前半句复现了，后半句也对，
**但结论要往前再推一步：它也不是任何一层渲染的锅。**

### 量到的

同一次世界构建、同一台机、逐帧记 `postfx.render` 的停顿与 `renderer.info.memory.programs`：

| 段 | 帧数 | 帧间隔 p50 | 帧间隔 max | `programs` |
|---|---|---|---|---|
| `warm:gate_approach` | 4 | 18 ms | 19 ms | → 390 |
| `warm:mound_block` | 4 | 19 ms | **148 ms** | → 445 |
| `warm:xiaoxiang` | 5 | 18 ms | **270 ms** | → 548 |
| `warm:grass_close` | 4 | 19 ms | **41 ms** | → 568 |
| `shot:gate_approach` | 28 | 18 ms | **19 ms** | 568 |
| `shot:mound_block` | 26 | 19 ms | **19 ms** | 568 |
| `shot:xiaoxiang` | 28 | 19 ms | **19 ms** | 568 |
| `shot:grass_close` | 25 | 18 ms | **19 ms** | 568 |

四个 `shot:` 段一次都没抖过；全部停顿都在 `warm:` 段，
对应的是 `programs` 从 390 涨到 568——**WebGPU 的 render pipeline 首次用到才编译**，
一次 130~400 ms 的同步停顿（`postfx.render` 自身耗时 166 / 312 / 393 / 132 ms）。

`capture.mjs` 读的 `engine.fps` 是 **0.5 s 的滑动平均**，而预热只有十几帧、
不到 0.4 s，**编译停顿于是溢出到第一个真正拍摄的机位**。
`gate_approach` 在 `SHOTS` 里永远排第一，所以它永远背这口锅。
换个顺序（`mound_block` 先拍）当场复现：`mound_block` 读 48、`gate_approach` 读 45。

### 第二层：45 fps 这个上限也是量出来的闸，不是机器的能力

把 `Engine.frameLimit` 临时从 60 抬开之后，四镜的真实帧成本中位数：

| 镜 | 限帧在位（现在 manifest 的 `fps`） | 抬开限帧的真实帧成本 |
|---|---|---|
| `gate_approach` | 45 fps | **3.6 ms**（≈ 280 fps） |
| `mound_block` | 45 fps | **3.8 ms** |
| `xiaoxiang` | 43 fps | **3.8 ms** |
| `grass_close` | 45 fps | **5.7 ms** |

headless 下 `--disable-frame-rate-limit` 让 rAF 自由跑（约 3.7 ms 一次），
`Engine.frame()` 里 `timestamp - lastFrame < interval - 0.5` 这道 60 帧闸
于是把节奏量化到约 22 ms——**四镜一律 45~46，量的是闸不是画面**。
这在真机上（vsync 16.7 ms）不会发生，是 harness 的 artifact。

### 结论与已做的修

「只修剖析出来的第一名」——第一名是**尺子**。修法全在 `tools/capture.mjs`，
不改一个像素、不改任何渲染设置：

1. 预热走完机位之后**等到编译真的停下来**（连续 20 帧无 > 40 ms 停顿，上限 4 s，超时只警告）；
2. 帧率在**干净窗口**里现量（限帧在位，90 帧取中位），不读滑动平均；
3. manifest 多一栏 `frameCostMs`（抬开限帧的真实帧成本）——**只有它在四镜之间有分辨力**；
   旧口径 `engine.fps` 留作 `fpsRolling`，好让两套数字能对上账。

### ⚠️ 留给验收人的判断题

`perf-baseline.json` 的 `fps` 一栏（`gate_approach: 36`）是旧口径量出来的，
修完之后同一份代码读 **45**。`D-25` 说 fps「只进回报不进门」，所以它没有让任何门变色，
**但基线里那四个数现在是过期的**。要不要把 `fpsTarget` 那条判据从 `fps` 换成
`frameCostMs`（真正有分辨力的那一栏），是形制之外的工程判断，本单不自己拍板。

---

## 2. 三个嫌疑全部被量测否掉（AQ-b0 的消融表）

单子列的三个嫌疑（① 阴影级联在这个机位翻倍 ② 地形+台面的 splat fill ③ DOF 远景覆盖面大），
用同一次世界构建、逐层拆掉再量整帧 GPU 的做法，三个都不成立：

| 拆掉 | gate_approach | mound_block | xiaoxiang | grass_close |
|---|---|---|---|---|
| GTAO | −42.7 % | −43.6 % | −52.2 % | −37.7 % |
| bloom | −37.8 % | −36.9 % | −38.9 % | −36.5 % |
| 阴影 pass | −11.4 % | −9.7 % | −8.9 % | −6.9 % |
| skyfx（W1/W2） | −1.2 % | −0.2 % | −0.7 % | −0.9 % |
| DOF | −0.3 % | +0.5 % | −0.1 % | +0.1 % |

- **阴影不在这个机位翻倍**：`gate_approach` 40 draw call / 1180k 三角，
  `xiaoxiang` 105 / 1558k——`gate_approach` 反而是四镜里阴影提交**最少**的。
- **DOF 在四镜都是零**：`dofFar` 已经是 400 m（`P-17` 重标定后），四镜几乎没有像素落进 CoC。
- **最贵的两层是 GTAO 与 bloom，且四镜一样贵**——它们是全屏后期，与机位无关。

⚠️ **这张表的读法**：`?profile` 给的 pass 级 timestamp 之和（20~40 ms）
明显大于同一台机上量到的真实帧成本（3.6~5.7 ms），说明 Metal/Dawn 的 pass 级
timestamp 里含着排队与等待。**所以这张表只当排序用，不当预算用**；
`tools/profile-passes.mjs` 的文件头把这条写死了。
另外「拆掉 scene（把 `Garden` 整棵藏掉）」量出来是**变慢**（−58 %～+0.8 %），
同一个原因：帧变快之后排队模式变了，整帧 timestamp 之和反而涨。

---

## 3. 顺手发现，未改

### 3.1 `Engine.frame()` 的 fps 窗口用未夹的 `raw`

```js
const raw = this.clock.getDelta();
const dt = Math.min(raw, 1 / 20);   // 位移用夹过的
this.fpsWindow += raw;              // 帧率用没夹的
```

夹 `dt` 是对的（防止 GC 停顿把玩家穿过碰撞体）。但 `fpsWindow += raw` 让
**一次停顿把整个 0.5 s 窗口污染成一个几乎没有帧的窗口**——上面第 1 条的放大器就是它。
真机上标签页切回来、一次着色器编译、一次 GC，玩家都会看到 HUD 帧率瞬间掉到个位数，
而画面其实没卡那么久。改不改是观感判断（有人就想看到真实的卡顿），本单不动。

### 3.2 `tools/capture.mjs` 的机位表已抽成 `tools/shot-list.mjs`

不是为了整洁，是为了真源：`profile-passes.mjs` 必须量 `capture.mjs` 拍的**同一个**机位，
抄一份迟早漂。`capture.mjs` 改成 `import { SHOTS } from './shot-list.mjs'`，机位与注释一字未动。
