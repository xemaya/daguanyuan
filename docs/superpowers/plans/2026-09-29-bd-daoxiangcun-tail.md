# 单子 BD：稻香村尾账——土壁版筑贴图 · e09 出村路 · 菜畦地类

> **依据**：`docs/reviews/2026-09-15-detail-review-response.md` §25 发现 ④ 与判据表 `cu_dx_eave` ⚠️；`D-36`「什么情况下推翻」（进世界后土壁仍读成木板 → 改版筑贴图，不再加几何层线）；
> `knowledge/docs/scenes/daoxiangcun.md` 未决 5、6。**标准动作见 `STANDARD-ACTIONS.md`。**
>
> **文件域**：`builder/parts/xiangye/earth.ts` 与 `materials.ts`（土材质）；`builder/parts/xiangye/thatch-cottage.ts`、`builder/parts/qiangyuan/wall.ts` 的 mud 支（只许为贴图改 UV / 去掉几何层线）；
> `plan.json` **只许**动 `ch17.e09` 叙事折线在稻香村区内的点；`tools/playtest.mjs`（只追加出村航点）；地面 splat 的地类表（**只许新增**「菜畦」地类，别的地类判定逐位不变）。
> **不碰**：vegetation.ts、engine/scatter、机位、基线、单子、其余区。

## BD1 · 土壁改版筑贴图

**病**：`cu_dx_eave` 贴脸看，土壁的版筑层线是几何凹槽 + 深色，园中光下读成木板墙。
**做法**：版筑层线、夯窝、泥抹补丁、裂缝、返潮改由贴图（颜色 + 法线）给，几何只留微起伏与塌角；层线在贴图里是**不连续、带泥浆溢出的软边**，不是刻出来的直槽。茆堂、东厢、黄泥矮墙同一套。
**判据**：`cu_dx_eave`、`dx_court` 前后并排；墙与茅顶亮度差仍 ≥ 25（同取样框）；三角不涨。

## BD2 · e09 出村路

**病**：`ch17.e09` 折线 (−202,−46)→(−202,−52)→(−202,−62) 直穿茆堂屋身；playtest 止于茆堂前，出村段没人走过。
**做法**：e09 在区内的点改成绕茆堂西山（或东山，看菜畦留的路），与菜畦 BB6 留出的 1.6 m 路对齐；playtest 追加出村航点到 (−196,−98) 北口，**不许 teleport**。
**判据**：playtest PASS，脚下序列列出出村段；`check:plan`、`check:experience` 过。

## BD3 · 菜畦地类

**病**：脚下序列在畦里报 grass。
**做法**：splat 新增「菜畦」地类（深褐熟土），只在 `daoxiangcun.vegetable-plots` 范围内生效。
**判据**：出村段脚下序列里出现菜畦地类；其余四区四镜像素与改前同量级（不许别的地类被带动）。

## 收工

check:all、playtest、四镜三次连拍 ±3%（相对 `perf-baseline.json` 2026-09-29 那版）、`tree-census --dump` 与改前逐字节相同；
改景需求文档 §4/§5/§6 与未决；图拷 `shots/BD/`；每件一个 commit，rebase 到最新 editor 后 ff 合回；回报全部数字。
