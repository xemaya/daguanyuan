# 单子 AW：匾文繁体化 + 换一款覆盖繁体的楷书字体

> **标准动作见 `docs/superpowers/plans/STANDARD-ACTIONS.md`，本单不再内联；#15 适用：收工改 `knowledge/docs/scenes/zhengmen.md` §4 匾那一行与 §6 台账。** 预算按 `D-25`（本单只动贴图，三角应为零变化）。
> 依据：用户 2026-09-17 点头「匾文『大观园』改繁体『大觀園』，要」；`D-05` 原文最高（第十七回题额全是繁体）；`D-28` 冻结例外项之一。
> **前提事实（验收人 2026-09-17 量的）**：现用字体 Ma Shan Zheng 是简体字集，**全园 31 块匾的繁体 83 字里缺 32 字**（`觀 園 瀟 館 簾 蕪 …`），
> 所以繁体化不是改一个字符串，是换字体。候选覆盖核验：LXGW WenKai TC 缺 0、AR PL UKai 缺 0、Yuji Syuku/Boku 缺 5（`榭 櫳 漵 荇 蘅`，拼不出 5 块匾）。对照图 `shots/plaque-font/compare.png`。
>
> **文件域**：`projects/daguanyuan/plan.json`（只许改 `regions[].buildings[].plaque` 的字符串与对应 basis）、`public/fonts/`（字体文件、许可证、README）、
> `garden.html` / `viewer.html` / `fashi.html`（只许改 `@font-face`）、`builder/parts/xiaomu/plaque.ts`（只许改 `PLAQUE_FONT` 与回落链）、`tests/`（匾文相关断言）。
> **不碰**：匾的几何 / 匾框 / 钤印 / 前倾（AT1）、题字石的 `inscriptionTexture`（AM3，系统楷体那一路，本单不动）。

## 裁定（派单前填）

- **字体**：**用户 2026-09-17 选定 C = AR PL UKai（文鼎 PL 中楷）**。来源：Debian 源包 `fonts-arphic-ukai_0.2.20080216.2.orig.tar.bz2`（http://deb.debian.org/debian/pool/main/f/fonts-arphic-ukai/ ），取 `ukai.ttc` 第 0 个字面；许可证 Arphic Public License 原文随包附带，抄进 `public/fonts/`。
- **与 AV-b 合派**（用户 2026-09-17）：同一个 agent 先做 AW（小、独立、先见效），再做 AV-b1 / AV-b2；两张单子各自的文件域与判据不变，回报分开写。
  验收人建议 **C**：楷書有顿笔、结构像真匾，83 字全有，Arphic Public License 允许再分发与子集化（要附许可证原文）；字重偏细，`plaque.ts` 的双层描边会补回来，收工用 `cu_gate_plaque` 判。
  B 是最稳的备选（OFL、Medium 字重），但笔味最弱；D 笔味最强，代价是五块匾里各有一个字换了另一款字体的写法。

## AW1 · 匾文繁体化（31 块，全园一次改完）

不许只改正门——一园两种字体两种写法比简体更糟。按维基文库程乙本底本逐块核对，`basis` 里写引文回目。**下面这张表是验收人查的，施工照抄，遇到底本异文停下来问：**

| 建筑 | 现 | 改 | 注 |
|---|---|---|---|
| zhengmen.main-gate | 大观园 | 大觀園 | 第十八回「大觀園」 |
| qinfang_ting_qiao.pavilion / dicui-pavilion | 沁芳 / 滴翠亭 | 沁芳 / 滴翠亭 | 不变 |
| xiaoxiangguan.moon-gate | 潇湘馆 | 瀟湘館 | |
| daoxiangcun.main-cottage / wine-banner | 稻香村 / 杏帘在望 | 稻香村 / 杏簾在望 | |
| hengwuyuan.main-house | 蘅芜苑 | 蘅蕪苑 | |
| shengqin_biesu.stone-archway / main-hall / daguan-tower / zhuijin-pavilion / hanfang-pavilion | 省亲别墅 / 顾恩思义 / 大观楼 / 缀锦阁 / 含芳阁 | 省親別墅 / 顧恩思義 / 大觀樓 / 綴錦閣 / 含芳閣 | |
| yihongyuan.main-house | 怡红快绿 | 怡紅快綠 | |
| ouxiangxie.waterside-hall | 藕香榭 | 藕香榭 | 不变 |
| zilingzhou.zhuijin-tower / landing | 缀锦楼 / 荇叶渚 | 綴錦樓 / 荇葉渚 | |
| qiushuangzhai.main-house / xiaocui-hall | 秋爽斋 / 晓翠堂 | 秋爽齋 / 曉翠堂 | |
| longcuian.mountain-gate | 栊翠庵 | 櫳翠庵 | |
| tubi_aojing.tubi-hall / aojing-hall | 凸碧山庄 / 凹晶溪馆 | 凸碧山莊 / 凹晶溪館 | |
| nuanxiangwu.liaofeng-house / nuanxiang-house / west-street-gate | 蓼风轩 / 暖香坞 / 穿云/度月 | 蓼風軒 / 暖香塢 / 穿雲/度月 | |
| qinfangzha.sluice-bridge | 沁芳闸 | 沁芳閘 | |
| liaoting_huaxu.water-cave | 蓼汀花溆 | 蓼汀花漵 | ⚠️ 「漵」底本用字核一下 |
| luxueguang.reed-hall | 芦雪广 | 蘆雪廣 | ⚠️ 底本「蘆雪廣」，另有「蘆雪庵」异文，停下来问 |
| jiayintang.main-hall | 嘉荫堂 | 嘉蔭堂 | |
| huajia_huapu.mudan-pavilion / hongxiang-hall | 牡丹亭 / 红香圃 | 牡丹亭 / 紅香圃 | |

`cuizhang.rock-02` 的「曲徑通幽處」已是繁体，不动。凡是消费 `plaque` 字符串的测试（`tests/` 里 grep「大观园」）跟着改期望值。

## AW2 · 换字体

1. 字体文件放 `public/fonts/<字体名>-plaque-subset.woff2`，子集字集 = plan 里全部 `buildings[].plaque` 的字 + 数字（沿用 `public/fonts/README.md` 的两步命令，把 TTF 来源换掉）；**子集后 ≤ 80 KB**。
2. 许可证原文放同目录（UKai → Arphic Public License 全文；WenKai / Yuji → OFL），README 重写「用的是哪一款 / 为什么 / 怎么重做子集」，旧的 Ma Shan Zheng 文件与说明删掉（OFL 文件若不再用也删）。
3. `garden.html` `@font-face` 换 family 与文件名；**`viewer.html` / `fashi.html` 补同一条**（单子 AT 的发现：棚拍匾额回落成系统楷体）。
4. `builder/parts/xiaomu/plaque.ts` 的 `PLAQUE_FONT` 换 family；`warnPlaqueGlyphGaps()` 对 31 块匾一个都不许喊。
5. 若裁定为 D（合成字体）：用 fonttools 把 Yuji 子集与 WenKai 的 5 个字合成一个文件，**改名**（OFL 保留字体名不许用于衍生品），README 写清哪 5 个字来自哪一款。

## 验收

- 九门 + `playtest` PASS；四镜 `--baseline` **三角零变化**（只动贴图），draw call 不变；
- `cu_gate_plaque`：「大觀園」三字是新字体真渲染，不是回落（照 AT1 的判法：同一字用「新字体 + 回落链」与「只回落链」各画一版比像素，差 > 阈值才算装上）；
- 控制台 `warnPlaqueGlyphGaps` 对已建成四区的匾（大觀園 / 沁芳 / 滴翠亭 / 瀟湘館）零警告，其余 27 块用 `tools/shoot-part.mjs` 或 node 脚本逐块跑一遍字集检查；
- 子集文件大小、许可证文件在；`viewer.html` 棚拍匾额与园中一致；
- `knowledge/docs/scenes/zhengmen.md` 匾那一行与台账改掉。

## 回报

字体选了哪款、子集字数与 KB、31 块匾改前改后（表）、两处底本异文怎么定的、`cu_gate_plaque` 前后图拷到 `shots/AW/`、四镜前后。**规模**：小。**风险**：底本异文（蘆雪廣 / 漵）别自己拍板；字体许可证文件别漏。
