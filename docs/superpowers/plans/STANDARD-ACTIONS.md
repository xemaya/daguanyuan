# 标准动作（所有单子的公共前提）

> **这一份是真源。** 2026-09-15 之前，九张单子各自内联一份副本——
> 于是「加一条纪律要改九处」，纪律必然漂。**新单子引用本文件，不要再抄。**
>
> 每条都带「为什么」。**只写结论不写代价的规矩，后来者会以为它是免费的，然后绕过去。**

## 工作区与分支

1. **工作目录 `~/Workspace/games/daguanyuan`，分支 `editor`。**

2. **要隔离可以 `git worktree add --detach`，但收工必须合回 `editor`，
   并在回报里给出合并后的 commit。** ⚠️

   **为什么**：2026-09-14 单子 AI 四件全做完，提交却留在 `/private/tmp/dgy-ai` 的游离 HEAD 上，
   主检出里一个都看不见——**派单的人以为它三十分钟零产出**。要不是去翻 `git worktree list`，
   这四件活会随 `/private/tmp` 被系统清理一起消失。见 `docs/PITFALLS.md` `P-21`。

   同一轮里单子 V 也用了 worktree，但它合回来了，所以没人发现这个口子。
   **"做完了"与"交付了"是两件事，worktree 把它们分开了。**

3. **不许 `git stash`。** 共享检出下它会把别人未提交的活一起卷走。要隔离就用上面的 worktree。

4. **提交只按路径 `git add <具体文件>`，不许 `git add -A` / `-a`。**（`P-19`）
   广撒网会把并行 agent 的半成品卷进你的提交——单子 O 就顺走过单子 Q 的三个文件。

5. **一个阶段/一件一次提交。** 攒着一起提交就没法回退，也看不出是哪一件引入的问题。

6. 提交信息末尾附：
   ```
   Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_011PeksSYynwWg7rdM5qZXcg
   ```

## 收工前必过

7. **`npm run check:all` 全过**（现在九道门 + 测试），**改了几何或观感的还要
   `node tools/playtest.mjs --url <你的URL>/garden.html` PASS。**

8. **动了观感或几何的，回报里要给三角数与 draw call 的前后对照**
   （`node tools/capture.mjs --shots gate_approach,grass_close,mound_block`）。

   **为什么**：400 万这个上限只活在单子的散文里，**没有任何一道门执行它**
   （`manifest-diff` 只做 A/B 相对回归，没有绝对天花板）。历史：单子 V3 收口时确实回到
   400 万内，之后单子 Z 的选料规则加了 17 件散石把它顶回去，**没人发现，因为没人看守**。

   **两个已知坑**：(a) 读数有噪声——同一份代码两次量，`mound_block` 差过 82k（2%），
   **别拿单次读数当基线**；(b) 预算可能写错——单子 AH 的 draw call 超额完全来自
   「沙疤收窄后草重新长出来」，那是这一单**想要的结果**。
   **超了就如实报并说明归因，不要自己降画质糊弄过去，也不要沉默。**

## 写码

9. **不许用 TypeScript 参数属性、`enum`、`namespace`、装饰器。**（`P-15`）
   Node 的 `--experimental-strip-types` 是纯剥离模式，这些语法会直接报错。

10. **书里没有的数用 `provenance.art` 留痕；规则表取不到就补规则表，不补代码。**
    编一个"合理值"填上是这个项目的第一性违规。取不到就抛 `MissingRuleError`、
    就补 `missing.rules.json` 并写清 `whereToLook`。

11. preview 带 `--strictPort`（并行时端口撞了要立刻知道，不要静默换端口）。

## 边界

12. **判断题不许自己拍板。** 单子里标「⚠️ 要人判」的，**做到能给出选项与代价就停下来回报**。
    审美与形制的取舍是用户的，不是你的。

13. **发现新问题记下来，不要顺手改。** 写进 `docs/reviews/` 或 `missing.rules.json`，
    在回报里点名。**顺手改会让验收时分不清是哪一件的锅。**

14. **单子写了文件域的，就守住文件域。** 并行的几张单子是按文件切开的，
    越界改别人的文件会造成合并冲突，也会让预算归因失效。
