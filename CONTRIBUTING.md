# 协作规矩

这个项目大部分工作由并行的 agent 完成。下面这些规矩存在的唯一理由，是让多个人同时改同一个仓库而不互相拆台。

```bash
npm install
npm run dev            # http://127.0.0.1:5173
npm run check          # 类型检查 —— 必须过
npm test               # 单元测试 —— 必须过
npm run check:layers   # 分层依赖门 —— 必须过
npm run check:rules    # 规则一致性门 —— 必须过
```

## 开工前

按 [README 的阅读顺序](README.md#先读什么) 读前三份：决策记录、架构 spec、坑点记录。第三份尤其别跳，里面每一条都是花真代价换来的。

做几何或材质的，`ART_DIRECTION.md` 是硬约束，它压过个人品味。

## 不可协商的几条

**分层依赖只能自上而下。** `engine/` 不许 import `builder/` `knowledge/` `projects/`；`builder/` 不许 import `projects/`；`builder/derive/` 不许 import `three`，它只产数。跨层一律走别名 `@engine/ @builder/ @knowledge/ @project/`，不写 `../..` 爬出去。`npm run check:layers` 执行这条。

**零二进制美术资产。** 贴图现烤、模型程序生成、音效合成。仓库里出现 png、glb、wav 是设计变更，不是实现细节，要单独讨论。唯一的例外是中文字体（匾额要用）。

**禁用 `Math.random()`。** 一切随机走 `engine/core/Noise.ts` 的种子生成器。同一份构建必须产出同一个园子，否则截图评审毫无意义。

**大木作的数字只从 `builder/derive/` 出。** 柱高、柱径、举折、出檐、翼角，不许在构件里手拍一个数。参数集按 tier 选，见 `knowledge/docs/qingshi/tiers.md`。

**规则的状态要尊重。** 被驳倒的规则不许用，存疑的规则用更正值，有多个并存口径的必须显式选一个，缺失的规则让它抛错——不要为了让代码跑起来填一个编出来的数。这是知识库存在的意义，见 `docs/DECISIONS.md` D-08。

**艺术圣经的硬规则。** 无锐边、无平色面、无纯黑纯白、接地必有裙脚、无 z-fighting、剪影优先。见 `ART_DIRECTION.md` §2。

## 并行时的纪律

**只碰自己任务列出的文件。** 多个 agent 同时在跑，碰别人的文件会互相覆盖。分派单里会写清你能碰哪些。

**不确定就停下来问，不要猜。** 尤其是剥离重构剥不干净、几何断言写不出来、规则誊写遇到研究稿自相矛盾这几类。猜出来的东西后面要花十倍时间拆。

**加新构件门类目录，记得回 `builder/parts/index.ts` 补 glob。** 不补的症状是运行时"未登记构件"，编译期毫无报错。见 `docs/PITFALLS.md` P-02。

## 改动要带证据

改观感的，附**左右对照图**：

```bash
node tools/side-by-side.mjs shots/before/x.png shots/after/x.png shots/compare/x.png
```

改结构的（重构、搬家、抽层），附**结构数字不变**的证明：

```bash
node tools/manifest-diff.mjs shots/after shots/baseline
```

**不要用逐像素当门**。场景里水面竹叶云一直在动，同一份构建连拍两次就差 97% 的像素。原因与实测数字见 `docs/PITFALLS.md` P-03。

改碰撞或布局的，跑试玩：

```bash
node tools/playtest.mjs --url http://127.0.0.1:4801/
```

它不用 teleport 作弊，逐航点转身按 W，三秒没进展算卡住。静态截图看不出的问题只有它能抓。

改构件的，棚拍：

```bash
node tools/shoot-part.mjs --url http://127.0.0.1:4801/viewer.html --subject building:ting --angles front,three_quarter
```

## 起服务

一律带 `--strictPort`。端口被占时 Vite 会静默换一个，而截图工具还按原端口访问，会截到别人的网站上去。

```bash
npx vite preview --host 127.0.0.1 --port 4801 --strictPort
```

## 注释写什么

写**为什么**，不写做了什么。尤其是：这里为什么反直觉、上游那个坑长什么样、换成显然的写法会怎么崩。

这个项目的代码注释是设计史的一部分，很多决定的唯一记录就在注释里。写得像给三个月后的自己看。

## 提交

一次提交做一件事。提交信息说清这个改动带来什么可见的差别，以及为什么，不只是代码现在长什么样。

末尾附：

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
```

`shots/` 是 gitignore 的，它是产物不是源码，永远不要提交。
