# 影像记录：不断构造赛博大观园

这个项目从一开始就在拍照——不是为了好看，是因为**观感回归只能靠人眼**
（`docs/PITFALLS.md` P-03：水、竹、云一直在动，逐像素比较的噪声底比任何阈值都高）。
于是每次验收都在 `shots/<里程碑>/` 留下同样 14 个机位的截图。

**结果是白捡了一份延时素材。** `tools/capture.mjs` 的镜头 id 从 P0 用到现在没改过名
（改名会让 `manifest-diff` 与 `side-by-side` 配不上对，所以一直守着），
所以 `shots/*/gate_approach.png` 天然就是同机位的时间序列。

## 两个工具

```bash
# 同机位延时:把一个镜头在所有里程碑上的截图串成一段,每帧烧上里程碑名与日期
node tools/timelapse.mjs                                  # 全部镜头
node tools/timelapse.mjs --shots gate_approach --hold 1.2

# 园中巡游:12 个机位之间做缓动插值,录一段滑的视频
pkill -f "port 4801"; npx vite preview --host 127.0.0.1 --port 4801 --strictPort &
node tools/record.mjs --tag 2026-09-12-pq3
```

`record.mjs` 与 `playtest.mjs` 的分工：**试玩是验碰撞的**，按住 W 一步步走，画面是颠的，
走不通就是 bug；**运镜可以穿墙飞**，只为好看。两者的坐标来自同一条游线。

## ⚠️ 保全：素材不在 git 里

`shots/` 与本目录的 `*.mp4` / `*.webm` 都在 `.gitignore` 里——**984 MB 的视觉历史只存在于这台机器上**，
一次 `rm -rf shots/` 就没了（2026-09-12 我自己就误删过两组）。

**在 git 里活下来的只有下面这张表。** 真要做纪录片，先把 `shots/` 备份出去。

另有一条退路，而且更符合这个项目的性质：**历史可以重新生成**。
代码、平面真源、规则表全在 git 里，理论上 `git checkout <commit> && npm run build && node tools/record.mjs`
就能把任何一个时刻重新拍一遍——程序化重建的园子，连它自己的历史也是程序化的。
（没验过，依赖与 `plan.json` 跨版本未必对得上。）

## 里程碑（按拍摄时间；提交是按时间戳就近对上的，不保证严格对应）

| 目录 | 张数 | 拍摄时间 | 最近的提交 |
|---|---|---|---|
| `parts-extra` | 7 | 9-10 00:58 | — |
| `parts` | 63 | 9-10 07:04 | — |
| `garden` | 14 | 9-10 07:06 | — |
| `baseline` | 14 | 9-10 14:57 | — |
| `after` | 14 | 9-10 15:02 | — |
| `scatter` | 14 | 9-10 15:26 | — |
| `verify` | 14 | 9-10 15:52 | — |
| `p1t1` | 14 | 9-10 17:52 | `3dd33f54` feat(derive): 推导器改读知识库——规则加载器、状态机、出处三分 |
| `p1abcd` | 14 | 9-10 20:59 | `02203570` docs(knowledge): 把 Task 5 实测发现的两条平面缺陷记进 missing 与 P2 |
| `review-20260910-codex` | 8 | 9-11 00:00 | `1bc588ca` fix(tools): check-docs 认 `file.ts:123` 的行号与绝对路径 |
| `p1t6` | 14 | 9-11 00:57 | `cc1eaa11` docs(daguanyuan): WebGPU + TSL 迁移方案入库并排进 roadmap 为 W |
| `p1f-culling` | 6 | 9-11 01:48 | `1d7cb2c9` feat(compose): 世界切到 plan.json 坐标系 |
| `p1f-culling-all-diagnostic` | 6 | 9-11 01:50 | `1d7cb2c9` feat(compose): 世界切到 plan.json 坐标系 |
| `p1t7` | 14 | 9-11 01:55 | `1d7cb2c9` feat(compose): 世界切到 plan.json 坐标系 |
| `p1-environment-culling` | 6 | 9-11 02:54 | `2bf7420c` perf(daguanyuan): 分块与并行烘焙缩短世界构建并恢复地形细度 |
| `p1-environment-14` | 14 | 9-11 03:01 | `2bf7420c` perf(daguanyuan): 分块与并行烘焙缩短世界构建并恢复地形细度 |
| `p1-complete` | 14 | 9-11 03:34 | `2bf7420c` perf(daguanyuan): 分块与并行烘焙缩短世界构建并恢复地形细度 |
| `p1-complete-culling` | 6 | 9-11 03:44 | `3096e761` fix(daguanyuan): 对齐环境坐标并完成P1实例化与阴影收尾 |
| `p2-contract` | 14 | 9-11 04:08 | `26bb6e53` feat(daguanyuan): 固定地图对象身份并校正空间验收依据 |
| `p2-building-samples` | 6 | 9-11 04:18 | `26bb6e53` feat(daguanyuan): 固定地图对象身份并校正空间验收依据 |
| `p2-building-catalog` | 20 | 9-11 04:23 | `26bb6e53` feat(daguanyuan): 固定地图对象身份并校正空间验收依据 |
| `p2-building-world` | 14 | 9-11 04:24 | `26bb6e53` feat(daguanyuan): 固定地图对象身份并校正空间验收依据 |
| `p2-building-catalog-final` | 20 | 9-11 04:27 | `905ca178` feat(daguanyuan): 接入20项法原施工参数并替换亭馆预设 |
| `p2-building-world-final` | 16 | 9-11 04:29 | `905ca178` feat(daguanyuan): 接入20项法原施工参数并替换亭馆预设 |
| `p2-construction` | 6 | 9-11 14:21 | `33c55097` feat(daguanyuan): 补清式施工骨架并显式区分待生成几何 |
| `p1done` | 14 | 9-11 15:55 | `b53224ba` feat(daguanyuan): 按原文29节点编排步行环线与未入远景 |
| `ui` | 17 | 9-11 17:53 | `83dd015f` feat(daguanyuan): 补公共跨水桥并统一桥面与岸地数据 |
| `pq-l` | 17 | 9-11 20:55 | `c598efd9` docs(daguanyuan): PQ 第一轮两张单子(J 木作细部 / L 光与色),并修 chec |
| `pq-l-before` | 17 | 9-11 20:57 | `c598efd9` docs(daguanyuan): PQ 第一轮两张单子(J 木作细部 / L 光与色),并修 chec |
| `pq-j-parts` | 15 | 9-11 21:38 | `eba9ffe5` feat(daguanyuan): PQ-0 光与色——雾跟世界变大,AO 加到大尺度 |
| `pq-j-low` | 6 | 9-11 21:43 | `eba9ffe5` feat(daguanyuan): PQ-0 光与色——雾跟世界变大,AO 加到大尺度 |
| `pq-j` | 15 | 9-11 21:56 | `eba9ffe5` feat(daguanyuan): PQ-0 光与色——雾跟世界变大,AO 加到大尺度 |
| `compare` | 14 | 9-11 23:48 | `517909de` docs(daguanyuan): PQ-0 补上景深这第三处,条目改名为「雾 / AO / 景深」 |
| `pq3` | 14 | 9-12 00:01 | `82043601` docs(daguanyuan): 99-27 游园图的传送是调试便利,发布前必须收口 |
## 一个断点要知道

**世界在 P1 Task 6（`1d7cb2c9`，09-11 01:20）换过坐标系**——从手摆的 64×72 m
切到 `plan.json` 的 280×226 m 窗口。所以同一个镜头 id 在 `p1t6` 前后**拍的不是同一个地方**。

延时工具不掩盖这件事：它按时间排、把里程碑名烧进画面，**那一跳是真的，也是故事本身**。

## 已录

| 文件 | 时长 | 内容 |
|---|---|---|
| `walk/2026-09-12-pq3.mp4` | 69s | 正门外 → 白石台矶与抱鼓石 → 穿门 → 翠嶂当面 → 豁然开朗 → 沁芳池 → 沁芳亭 → 沿溪向西 → 潇湘馆院外 → 月洞门题「潇湘馆」→ 翠竹夹路 → 正房阶前 |
