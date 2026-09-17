# 正门（zhengmen）——景需求文档

> 状态：**观感冻结**（`docs/DECISIONS.md` D-28，2026-09-16 用户拍板）。冻结后只收 bug、形制断言门（AE）、匾文繁体化。
> 单子 AU 三件（两溜高照 / 铺首门环 / 门前青草）已合回并验收（`docs/reviews/2026-09-15-detail-review-response.md` §18，2026-09-17）；**冻结日期 2026-09-17**。
> 平面：[zhengmen.svg](zhengmen.svg)。考据：`knowledge/docs/qingshi/tiers.md` §1、`07-honglou.md` 07-01 / 07-02 / 07-70。

## 1 一句话

全园唯一的礼制大式（Tier A）门屋，但原文刻意写**素**：五间、桶瓦泥鳅脊、细雕不施朱粉、白石台矶。
它的任务是「不落富丽俗套」地把人放进园子，一穿门就撞上翠嶂（07-03）。

## 2 原文与定死项

**原文定死**（07-01 / 07-02，甲乙均通过）

| 项 | 原文 | 落成 |
|---|---|---|
| 面阔 | 正門五間 | 5 间，3.6 / 3.2 / 2.8 m（当心 / 次 / 梢） |
| 屋面 | 桶瓦泥鰍脊 | 灰陶筒瓦；`nqiu_ridge` 低平圆脊无翘头（R-02，L4 自造脊型，不可复用） |
| 门栏窗槅 | 細雕新鮮花樣，並無朱粉塗飾 | 格心灯笼锦、绦环板西番草；木作本色油饰、不彩画、**不装门钉**（D-28） |
| 墙 | 一色水磨群牆 | 门屋两山砖墙 |
| 台基 | 白石台磯，鑿成西番草花樣 | `forecourt-terrace`，四层石作，陡板凿西番草 |
| 园墙 | 雪白粉牆，下面虎皮石，隨勢砌去 | 两条 wall 线性，粉墙 + 虎皮石脚 + 小青瓦压顶 |
| 灯 | 正門上也挑著大明角燈，兩溜高照（07-70，存疑）；兩邊階下一色朱紅大高照（07-69） | 檐下每间一盏，阶下两溜高照；明角灯是元宵夜的，不挂 |

**参数集补**（tiers.md §1）：柱高 4.2 / 柱径 0.42 / 斗口 72 mm / 六椽 / 台明 0.6 m。
**艺术选择**：硬山（tiers 预设单檐歇山，plan 沿用硬山，见 building 的 `source.note`）；匾宽取当心间 ×0.72（AT1，用户选）；
门钉不装（D-28）；灯笼纸色不朱粉；高照杆位对齐台矶墁缝。
**原文没有、须留白**：门簪数、走兽数、瓦号。

## 3 视点、轴线、动线

- **轴线** x=55，门屋中脊 z=236，朝南。园外大路从 (55,260) 直行到台阶前 (55,244)，这是 X-04「迎面」的路径。
- **眼高**：区标高 0.8 + 台明 0.6 + `EYE_HEIGHT` 1.62 ≈ **3.0 m**（站在门洞里）。
- **门外第一眼**（`gate_approach`，(57.4,245.1) 朝北）：五间门屋、匾、台矶、两株古松、两翼粉墙。
- **门内第一眼**（`gate_face`，(55,237) 朝北，2026-09-17 新机位）：应当是翠嶂白石峰群迎面拱立。**现状是黄绿秃丘加一排槐树**，见 [cuizhang.md](cuizhang.md) §6。
- **动线**：穿门后不直行，向西北 (30,232) 沿翠嶂南脚走到西山口 (−34,206)（十七回 n01→n02→n03；`tools/playtest.mjs` 航点）。
- **门外净空**：甬道 4.5 m × 5 m（scenes clearance「门外甬道净空」），plan `plants` 写「门外净空，不作密植」；两株古松在 (40.5,244.2) 与 (69.5,244.2)，离轴线各 14.5 m。

## 4 构件清单与落位

| 构件 | 要求 | 现状 | 数据在哪 | 状态 |
|---|---|---|---|---|
| 门屋 | 五间硬山，桶瓦泥鳅脊，前后檐装门，两山砖墙 | 如要求；柱高 4.2、六椽、五踩斗科高 0.72 | `plan.json` `zhengmen.main-gate`；`builder/parts/damu/building.ts` `men` 档 | ✅ AJ 起三轮精修 |
| 匾「大观园」 | 有匾框、角花、前倾匾托、钤印；真毛笔字 | 宽 = 当心间 × 0.72 = 2.59 m；马善政楷子集字体 | `builder/parts/xiaomu/plaque.ts`；`public/fonts/MaShanZheng-plaque-subset.woff2` | ✅ AT1；**繁体「大觀園」待用户点头** |
| 门板 | 素板门，不装门钉，一对素面铺首门环，熟铜色 | 每扇一副：板 0.15 × 0.17 m、环 Ø 0.15 m | `builder/parts/xiaomu/pushou.ts`；`building.ts` `mkLeaf` | ✅ AU2 |
| 檐下灯笼 | 每间一盏共五盏，直径 ≥0.55 m，纸色 | 直径 0.56 m、灯身高 0.60、`LANTERN_DROP` 1.04（天花板 1.12）；五盏同一 `hangY` | `builder/parts/xiaomu/lantern.ts`；`builder/compose/scatter-rules.ts` | ✅ AU1；当心间那盏与匾争位，用户裁定保持（§6） |
| 阶下高照 | 两溜落地灯杆，踏跺两侧对称，对齐台矶墁缝 | 4 根：x = 50.0 / 51.5 / 58.5 / 60.0，z = 240.2，杆脚在台矶面层，总高 3.54 m | `projects/daguanyuan/scenes/zhengmen.json` placements `gaozhao` ×4；`builder/parts/xiaomu/gaozhao.ts` | ✅ AU1 |
| 白石台矶 | 四层石作（土衬 / 陡板 / 阶条 / 面层）有砌缝；陡板西番草 | 宽 13.76 m，锚 (55,241)；浮雕 4 mm（D-27：台矶 32 px 视张角，几何浮雕留着当尺子） | `builder/parts/qiangyuan/forecourt-terrace.ts`；`builder/parts/ornament/` | ✅ AJ1 / AO |
| 垂带抱鼓 | 一对，坐在前踏跺两条垂带外侧的台矶面层上，鼓面相对 | `chuidai` 档 | `builder/parts/shishan/baogushi.ts` | ✅ AT2 |
| 格扇 | 格心灯笼锦，截面分级、节点、收头、纸面退后 | 梢间窗 | `building.ts` 格扇；AP | ✅ AP；bug：门内两扇之间漏天光蓝缝 |
| 绦环板 | 西番草，贴图档为终稿 | `GATE_TIAOHUAN_GEO = false` | `builder/parts/ornament/tiaohuan-band.ts`；D-27 补记 | ✅ AS |
| 两翼粉墙 | 粉墙 + 虎皮石脚随势 + 小青瓦压顶，与门屋两山合缝 | 西段 (48→28,236)、东段 (62→82,236)，区标高 0.8，基础 0.4 | `plan.json` `zhengmen.linears`；`builder/parts/qiangyuan/wall-path.ts` | ✅ AI；F1：占位场不认线性墙 |
| 虎皮石墙基 | 随势砌 | plan 岩石锚点 (20,241)，无独立构件 | `plan.json` `zhengmen.rock-01` | 由墙线性的 `gardenFoot` 代 |

## 5 植物与地面

| 项 | 要求 | 现状 | 状态 |
|---|---|---|---|
| 门前古松 | 两株，门外净空不密植 | HERO_TREES (40.5,244.2) / (69.5,244.2)，`REGION_TREES.zhengmen` 密度 0.18 只出松 | ✅ |
| 门前地面 | 大路铺装两侧是青草，无黄土肩；台矶两翼无裸土 | AU3：铺装路不留土肩、官式区（`style.rustic === 0`）不刷路土；脚下序列 grass 到 56.4 m（AU 前 39.4） | ✅ AU3；门外大路读不出路（§6） |
| 甬道 | 4.4 m 宽大路直抵台阶 | 旧路基 `legacy-ch17-roadwork` 末段 | ✅ |

## 6 判据、机位、台账

**机位**（`tools/shot-list.mjs`）

| id | 站位 | 看什么 |
|---|---|---|
| `gate_approach` | (57.4,245.1) yaw 0.08 | 园外南望，建立镜头；四镜基线之一 |
| `gate_face` | (55,237) yaw 0 | 门内北望翠嶂（2026-09-17 加） |
| `cu_gate_eave` / `cu_gate_plaque` / `cu_baogushi` / `cu_terrace` | 门前 1–6 m | 檐口瓦当 / 匾 / 抱鼓 / 台矶石作 |
| `cu_lattice` `cu_lattice_front` `cu_lattice_inside` | 梢间窗 | 格心纹样、正面收头、门内背光 |
| `cu_scroll_front` `cu_scroll_oblique` `cu_scroll_mid` `cu_tiaohuan` | 台矶 / 门道 | 西番草浮雕几何版 vs 贴图版 |
| `cu_wall_seam` | (68,239) yaw 1.35 | 粉墙接缝与压顶 |

**可量的判据**

- 九门 `npm run check:all` 全过；`node tools/playtest.mjs` PASS，出生点到踏跺 dirt 段 = 0。
- 四镜 `--baseline`：`gate_approach` drawCalls / triangles 在基线 ±3%（`projects/daguanyuan/perf-baseline.json`）。
- X-04「迎面」：从 (55,244) 沿 +北 射线打到 `hill.cuizhang` 夹角 0°（现行判法只到土山，**AV 单子改为打到白石组**）。
- 名册（`manifest-diff --coverage`）正门件无 LOST。
- 灯：五盏檐灯直径 ≥0.55 m，高照 4 根杆脚落在台矶面层，杆位对齐墁缝（2026-09-17 复核通过）。
- 对账门 `manifest-diff --coverage`：23/25，野生件 ≤ 43。

**未决与 bug**

| 编号 | 事 | 归谁 |
|---|---|---|
| 当心间灯 | 五盏同高，当心间那盏挂在匾正下方被匾遮半截 | ✅ 用户 2026-09-17 裁定保持五盏，销 |
| 门外大路 | 台矶前只有一小片铺装舌头，往南全是草，读不出路；做园外甬道（E 档）时给铺装 | E 档 |
| 对账门计法 | 带 basis 的 scenes placements 仍记作野生件，feral 基线已抬 40 → 43 | AD 系单 |
| 匾文 | 「大观园」→「大觀園」：用户已点头；现字体缺 觀 園，须换字体并全园 31 块一起改 | AW 可派（字体待选） |
| AE | 形制断言门第二批（五间 / 桶瓦 / 无朱粉 / 台矶层数），冻结后可焊 | 可写单 |
| F-AJ-1 | 台矶前缘深色斜坡 | 下次动近门大路的单 |
| 蓝缝 | 门内两扇格扇之间漏天光 | 下次动格扇的单 |
| AP 副作用 | 门内看不见卡子花、背阴窗纸偏灰 | 同上 |
| F1 | 占位场不认线性墙体，散置件可插墙 | occupancy 单 |

**履历**：AI（墙线性化）→ AJ（台矶 / 抱鼓 / 檐口）→ AK / AN1 / AQ-a（浮雕管线、颗粒）→ AN2 / AP（格扇）→ AO（AO 与颗粒档位，D-26）→ AS（绦环板贴图档，D-27）→ AT（匾五件、垂带抱鼓）→ AU（灯 / 门环 / 青草，D-28 冻结，2026-09-17 验收）。
验收记录在 `docs/reviews/2026-09-15-detail-review-response.md` §6–§17。
