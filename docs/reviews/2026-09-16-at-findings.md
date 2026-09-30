# 单子 AT 顺手发现（不在本单修，按 STANDARD-ACTIONS §13 只记不改）

> 本单做的是 AT1（匾额五件）与 AT2（抱鼓石挪到踏跺两侧）。下面六条是施工时撞见的、
> **不属于本单文件域或不属于本单范围**的问题。每条都写清「怎么发现的」与「不修的代价」，
> 免得下一个人只看到结论、以为它是免费的。

## F-AT-1 ⚠️ `cu_gate_plaque` 这个机位十四轮以来一张匾都没拍到（本单已修，但病根没修）

**现象**：`tools/shot-list.mjs` 的 `cu_gate_plaque` 原是 `pos [55,0,239.4] / pitch 0.30`。
匾心在世界高 **5.24 m**，人眼 **2.78 m**，水平只差 **1.44 m** —— 要 **59.6°** 才看得到它，
而 pitch 0.30 rad = **17.2°**。这一镜拍到的一直是铺作底面与门道，**匾一个像素都没进过画**
（取证：`shots/AT/before-cu_gate_plaque.png`，那是本单开工前用旧机位拍的）。

**代价**：它是「匾读不读得成匾」的唯一贴脸判据机位。十四轮里凡是引用过这张图说
「匾没问题」的结论，**都不是从这张图看出来的**。

**本单做了什么**：只把这一个机位重瞄到 `[55,0,240.2] / pitch 0.83`。

**没修的病根**：**没有任何一道门检查「机位拍到的是不是它说要拍的东西」**。
机位表的 `desc` 是散文，没人能对它做断言。同一类失效对 `gate_plaque`（非 closeup 的那个，
`[55,0,242.6] / pitch 0.12`）很可能同样存在——它更远、更平，按同一笔账算更拍不到匾，
**本单没有去改它**（不在文件域，且它不是本单判据）。建议：给贴脸机位加一条「目标点必须落在
视锥内且不被遮挡」的门，目标点从构件落位算，不靠人记。

## F-AT-2 白石台矶的墁缝网格没有导出，抱鼓石对缝靠的是注释不是代码

**现象**：AT2 要求「须弥座别骑缝」。台矶面层的墁缝格距在
`builder/parts/qiangyuan/forecourt-terrace.ts` 里由 `gridPitch()` / `BLOCK_L` 私有算出
（Z 向 5.6 m ÷ 7 = **0.80 m**），**没有 export**。而该文件不在单子 AT 的文件域内。

**结果**：`composer.ts` 的 `baogushiSpotsFor` 里写着 `PAVING_PITCH_Z_M = 0.8` 这个**抄来的常量**。
台矶尺寸或 `BLOCK_L` 一改，这里不会报错，只会**悄悄骑缝**——正是 `STANDARD-ACTIONS` 序言里
「两个地方各存一份数字，迟早对不上」的那一种。

**建议**：`forecourt-terrace.ts` 导出一个 `forecourtPavingGrid()`（返回 `{pitchX, pitchZ, gridX0, gridZ0}`），
让落位方调用。改动很小，但要动那个文件，留给下一张单子。

**附带记一笔**：圭角 Z 向 0.84 m > 格距 0.80 m，所以单子写的「整块内」在这套网格下**无解**，
本单取的是「压在一行墁石的正中、前后各出 0.02 m」——0.84/0.80 下唯一对称的解。
X 向是真的落在一格以内（0.56 m 的圭角坐在 0.771 m 的格里）。

## F-AT-3 踏跺垂带的两个常量同样被抄了一份

`building.ts` 踏跺垂带那一段里，垂带中线离踏跺边 `0.10`、垂带半宽 `0.12` 是行内字面量。
AT2 的落位要从垂带外皮起算，而那一段本单不许改，所以 `composer.ts` 里又抄了一份
（`CHUIDAI_OFFSET_M` / `CHUIDAI_HALF_W_M`，已留痕指回出处）。与 F-AT-2 同一个病。
`baogushiSpotsFor` 里本来就有先例（`jambW` / `leafHalfT` 也是这么抄的），说明这不是孤例。

## F-AT-4 `viewer.html` / `fashi.html` 没有匾额字体，单拍构件看到的不是园子里的样子

`@font-face`（Ma Shan Zheng）只加在 `garden.html`——单子 AT1 的文件域只到这一个入口。
用 `tools/shoot-part.mjs`（走 `viewer.html`）单拍匾额构件时，`plaqueTexture` 会**静默回落**
到系统楷体。图看着"没问题"，但那不是园子里那块匾。三个入口各写一份 `@font-face` 也是抄，
更好的做法是把它抽到一份共享 css 或由 `main.ts` 注入，留给下一张单子。

## F-AT-5 门当档抱鼓石（`baogushi:default` / `beast`）从此没有消费者

AT2 把正门换成 `baogushi:chuidai` 之后，**跨门槛的门枕石在世界里一份都不剩**。
`default` / `beast` 两档仍然登记在 `registerPart` 里、代码仍在维护范围内，但**没有任何
截图或门在看它们**——它会以谁都发现不了的方式腐烂。

保留它们是**有意的**：`07-honglou.md` open_questions 第 15/16 条的乙核还没做，
若乙核下来垂带抱鼓不成立，回退路径就是把 `baogushiSpotsFor` 换回门当落位、构件不必重做。
但这条"保险"的保质期应该有人盯——乙核有了结论之后，要么给它找个消费者（别处的院门？），
要么删掉。

## F-AT-6 匾额字体子集与 `plan.json` 之间是一条没有门看守的耦合

`public/fonts/MaShanZheng-plaque-subset.woff2` 只含 `plan.json` 现有 78 个匾额用字。
plan 加了新匾额而没重跑 `pyftsubset`，那块匾会**逐字回落**到系统楷体，同一园子两种字。

本单加了一道**运行时**的软门：`plaque.ts` 的 `warnPlaqueGlyphGaps()` 在字体 ready 之后，
把每个字分别用「子集 + 回落链」和「只有回落链」画进 40×40 离屏画布比像素，一样就 `console.warn`
（CJK 全是 1em 全角，`measureText` 比宽度量不出来，只能比像素）。

**它只是 warn，不是门**：`npm run check:all` 里没有跑到 `makePlaque` 的地方，
`tools/console-probe.mjs` 也没有把这条 warn 列进必查项。真要焊死，得在
`check:*` 里加一条「plan 的匾额用字全在子集的 cmap 里」的静态检查（读 woff2 的 cmap 即可，
不需要跑浏览器）。留给下一张单子。
