/**
 * shot-list.mjs — 机位表的真源。
 *
 * 2026-09-15 单子 AQ-b0：从 `capture.mjs` 里抽出来。原因不是整洁，是**真源**：
 * `profile-passes.mjs` 要量的必须是 `capture.mjs` 拍的同一个机位，抄一份就会漂
 * （同一条教训在 `docs/PITFALLS.md` P-22 的邻居里反复出现：两个地方各存一份数字，
 * 迟早对不上，而对不上的那天没人知道哪一份是对的）。
 *
 * 改机位只改这里。`capture.mjs` 的注释讲的是「为什么是这个取景」，都跟着搬过来了。
 */
/**
 * The shot list.
 *
 * `pos` is the player's feet position; the harness adds eye height. `yaw` is
 * radians, 0 = facing -Z. `pitch` positive looks up. These are chosen to cover
 * every surface a reviewer needs to judge: silhouettes, material response,
 * shadow contact, foliage density, and the two hero moments (town reveal and
 * the starter table).
 */
/*
 * P1 Task 6: coordinates moved to plan.json's coordinate system. Each shot's
 * old position is translated by its cluster's delta (same four constants as
 * `composer.ts`'s D_ZHENGMEN/D_CUIZHANG/D_QINFANG/D_XIAOXIANG) — this is a
 * pure translation, not a re-composition, so yaw/pitch (the framing angle)
 * are kept as-authored; only `grass_close`/`treeline` (which had no single
 * obvious anchor to follow) were re-picked to an equivalent dry spot in the
 * new window rather than mechanically translated.
 *   zhengmen bbox   x[15,95]    z[222,244]
 *   cuizhang bbox   x[-60,76]   z[184,220]
 *   qinfang bbox    x[-55,40]   z[116,178]  (南池 water centred ~(-4,148))
 *   xiaoxiang bbox  x[-145,-65] z[58,125]
 * Yaw convention: forward = (-sin(yaw), 0, -cos(yaw)). yaw 0 faces -Z (north).
 */
export const SHOTS = [
  { id: 'gate_approach', pos: [57.4, 0, 245.1],  yaw: 0.08,  pitch: -0.02, desc: '园外南望正门——入园前的建立镜头。' },
  { id: 'mound_block',   pos: [8, 0, 208.5],  yaw: 0.0,   pitch: 0.04,  desc: '刚进门,翠嶂假山迎面挡住视线(曲径通幽)。' },
  /* 单子 AM-收尾(2026-09-16):`mound_west` 重瞄。**这一镜是 AM4 苔藓的判据机位**
   * (计划 §AM4「判据:`mound_west`(贴着石壁)看得出白石上有苔斑」),AM4 全程误按
   * `mound_block` 判,`mound_west` 这一单子里没人拍过、没人判过。
   *
   * 旧机位 (3.6,201)/yaw −0.9 是对着**旧** `taihu:mound`(锚点上一坨约 6 m 宽的土丘)
   * composed 的;AM2 换成离散的 `baishi:group*` 峰群之后它什么也框不住——前向
   * (−sin,−cos)(−0.9)=(0.783,−0.622) 正指向 (6.17,198.80) 那棵洋槐(trunk 实例 scale 1.70,
   * 25 m 内最粗的一棵),3.2 m 外整幅画面就是一根树干,峰群被挤到右缘的树荫里。
   * 那棵树正是裁定三说的、把 `mound_block` 一起遮进树荫的那一棵(收形前就在,与本单无关)。
   *
   * **新站位是量出来的,不是挪的。** 先把 `Trunk_*` 实例矩阵全解出来,量每一组峰到
   * 最近树干的距离:group1 **3.7 m**(就是那棵洋槐)、group5 **4.0 m**(松,scale 1.74)、
   * group7 **2.0 m**——三组都在树冠底下(棚拍复核:g1/g5 的候选位整幅都是叶子);
   * group3 **11.6 m**、group2 **29.4 m**,只有这两组晒得到太阳。group2 三面是西口那道溪,
   * 实测西、北两侧站位落到 y=−0.66 / −1.00 的溪床里,只剩东南一面能站;
   * **取 group3**(世界 (−18,205) = 锚点 (8,202) + dx −26 / dz +3),它在山的西段,
   * 「绕假山西侧」的原意不变。
   *
   * 站位用极坐标定:离峰组中心 **d=2.6 m**(贴脸档,峰身横向填满画幅)、方位角
   * **55°**(自正南 +Z 起算向东)——`SunKey` 从 +X/+Z 方向、仰角 38° 照过来,东南面才是
   * 受光面(实测正西 `g3_W`、正东 `g3_E` 两个候选整块读成蓝灰剪影)。
   * 得 pos (−18+2.6·sin55°, 205+2.6·cos55°) = **(−15.87, 206.49)**;
   * yaw 按本文件约定 forward=(−sin yaw,−cos yaw) 反算 atan2(2.13,1.4913)=**0.9599 rad**;
   * pitch **0.40**(峰高 8–10 m、脚下地形 4.52 m,眼高 6.14 m,0.40 把峰顶收进画幅上沿)。
   * 复核:`shots/final-mound-west/mound_west.png`——白石是冷灰白不是蓝灰剪影,
   * 苔成斑(上肩、中段左侧、下部石檐几处浓斑 + 散缘),不是纯白也不是刷绿漆。
   * `mound_west` **不在 `perf-baseline.json` 的四镜里**,改取景没有预算/历史后果。 */
  { id: 'mound_west',    pos: [-15.87, 0, 206.49], yaw: 0.9599, pitch: 0.40, desc: '绕到假山西段的 baishi:group3 峰组,贴着石壁近看白石与苔斑(单子 AM4 判据机位)。' },
  { id: 'pond_reveal',   pos: [-3.5, 0, 157.4], yaw: 0.15, pitch: -0.04, desc: '绕出假山豁然开朗:沁芳池与桥,全园第一眼。' },
  { id: 'bridge_mid',    pos: [-0.3, 0, 148.8], yaw: -0.4, pitch: -0.08, desc: '桥中望池面、驳岸、亭。' },
  { id: 'pond_north',    pos: [8, 0, 139.2], yaw: 2.6, pitch: 0.0,   desc: '池北岸(引桥尽头)回望亭桥与假山——反向建立镜头。' },
  { id: 'xiaoxiang',     pos: [-111.2, 0, 104.0], yaw: -0.62, pitch: 0.05, desc: '潇湘馆:进了月洞门,竹院与小三间。' },
  { id: 'moon_gate',     pos: [-105, 0, 122.4], yaw: 0.0,  pitch: 0.02, desc: 'plan月洞门南侧2.4m望内院；P2墙路径接入后跟随真实门位。' },
  { id: 'gate_plaque',   pos: [55, 0, 242.6],   yaw: 0.0,  pitch: 0.12, desc: '门前人视高抬头看「大观园」匾与开着的门。' },
  { id: 'ting_plaque',   pos: [-2.7, 0, 156.8], yaw: -0.30, pitch: 0.10, desc: '桥头人视高看沁芳亭正面匾。' },
  { id: 'bridge_head',   pos: [-4.5, 0, 159.0], yaw: -0.15, pitch: -0.25, desc: '南引桥头:桥阶与地面的接缝。' },
  { id: 'grass_close',   pos: [4.0, 0, 200.0], yaw: 0.35, pitch: -0.58, desc: '低头看地面材质与接地。' },
  { id: 'treeline',      pos: [-45, 0, 170.0], yaw: 1.10, pitch: 0.14, desc: '窗口边缘的林带与天(本窗口不是真墙,见 TERRAIN.playMinX 等阻挡体)。' },
  { id: 'backlit',       pos: [-0.9, 0, 154.4],    yaw: -2.57, pitch: 0.20,  desc: '逆光——bloom 与轮廓光。' },
  { id: 'creek_flow',    pos: [-2, 0, 195],     yaw: -0.38, pitch: -0.15, desc: 'PQ着色半新增：沁芳溪南段岸边顺流望——溪要流、池要静，肉眼一眼能分。' },
  /* 单子 AD · 第四档「贴脸机位」。上面这些机位全是全景，鼓钉、瓦当、格心
   * 纹样在 1600×900 里是两个像素——等于不存在。下面五个各盯一个关键部位，
   * 评审一个回合只看它们加一张联络表(tools/shoot-part.mjs --sheet)，
   * 不看 14 张全景。带 group 的机位默认不拍，用 --group closeup 单独取。 */
  { id: 'cu_gate_eave',    pos: [55, 0, 241.6],   yaw: 0.0,   pitch: 0.60,  group: 'closeup', desc: '贴脸·正门檐口:瓦当滴水与椽望的收头(用户反馈5「瓦与木架分层、无瓦当滴水」;单子 AJ3 重瞄到真檐口)。' },
  /* 单子 AT1(2026-09-16)重瞄。**旧机位拍不到匾**:站位 z=239.4 已经在檐下,
   * 匾心世界高 5.24m、人眼 2.78m、水平只差 1.44m——要 59.6° 才看得到它,而
   * pitch 只有 0.30(17°),十四轮下来这一镜拍的一直是铺作底面和门道,匾一个
   * 像素都没进过画。它是 AT1「匾读不读得成匾」的判据机位,不能是空的。
   * 新站位 z=240.2 / pitch 0.83(47.6°):往外退 0.8m 换来 12° 的正面度,同时
   * 仍在檐口滴水线(z≈238.95,高 4.42m)以内——再退到 241 那条视线就贴着檐口
   * 抹过去、匾被屋檐切掉。两个数是一起定的,单独改一个都会把匾拍没。 */
  { id: 'cu_gate_plaque',  pos: [55, 0, 240.2],   yaw: 0.0,   pitch: 0.83,  group: 'closeup', desc: '贴脸·大观园匾:字体笔锋、匾框起线与角花、前倾与匾托、左下钤印(用户 2026-09-16 反馈「牌匾小气、字体不古朴」;单子 AT1)。' },
  /* 单子 AT2(2026-09-16)重瞄。旧机位 [53.3,238.4]/yaw −0.92 是**站在门道里**
   * 侧身拍那块跨门槛的门枕石——石头挪到踏跺两侧之后,那个位置对着的是空门洞。
   * 新机位站台矶上正对踏跺,一张里同时回答本单的三问:两块鼓在不在台阶两侧、
   * 鼓面是不是相对、门道里干不干净。 */
  { id: 'cu_baogushi',     pos: [55, 0, 241.5],   yaw: 0.0,   pitch: -0.18, group: 'closeup', desc: '贴脸·垂带抱鼓:两块石坐在前踏跺两条垂带外侧的台矶面层上,鼓面相对、门道空净(用户 2026-09-16 反馈「放到台阶两侧」;单子 AT2)。' },
  { id: 'cu_wall_seam',    pos: [68.0, 0, 239.0], yaw: 1.35,  pitch: -0.08, group: 'closeup', desc: '贴脸·南墙接缝:六段粉墙相接处的墙脚与压顶(用户反馈3;名册侧接缝门报这里互插0.16~0.22m)。' },
  { id: 'cu_terrace',      pos: [58.5, 0, 246.8], yaw: 0.28,  pitch: -0.38, group: 'closeup', desc: '贴脸·白石台矶:石作分层(土衬/陡板/阶条/面层)与砌缝(用户反馈「大白平台质感差」;单子 AJ1)。' },
  { id: 'cu_lattice',      pos: [62.0, 0, 238.4], yaw: 1.35,  pitch: 0.06,  group: 'closeup', desc: '贴脸·格心:灯笼锦的纹样构成(用户反馈2「窗花粗糙」)。' },
  // 单子 AP:灯笼锦工艺样板的三视补位——正面看纹样收头与主辅比例,背光看框边对纸面的遮光。
  // 机位校正(2026-09-15):单子原文给 x=62,但东梢间窗中线在 x≈60.65(与 cu_lattice
  // 同一扇),x=62 会把窗甩到画面左缘;背光位 z=236 正卡在中柱缝墙里,前移至 236.5 的门道浅间。
  { id: 'cu_lattice_front',  pos: [60.6, 0, 240.6], yaw: 0.0,   pitch: 0.28,  group: 'closeup', desc: '贴脸·格心正面:正对东梢间窗,看灯笼锦完整纹样、边界收头与留白(单子 AP)。' },
  { id: 'cu_lattice_inside', pos: [60.6, 0, 236.5], yaw: 3.14,  pitch: 0.85,  group: 'closeup', desc: '贴脸·格心背光:门内朝南看同一扇窗,纸面退后后框边对纸面的遮光(单子 AP;不许给窗加私灯)。' },
  /* 单子 AO:西番草浮雕样件的两个贴脸位。样件在台矶前檐、踏跺右侧,
   * 世界坐标 x∈[56.9, 58.7]、带心 y=0.185、陡板外皮 z=243.86。
   * **人眼在 1.62m,浮雕在 0.185m**——"贴脸 0.6m"按字面站会变成近乎俯瞰一条
   * 缝,所以横向站距取 1.1m / 1.9m,斜距 1.8m / 2.4m,俯角由这两个数反推。
   * 正面位顺带把右边那截老圆管卷草收进同一画面,左右就是"铁丝 vs 浮雕"。 */
  { id: 'cu_scroll_front',   pos: [57.8, 0, 244.96], yaw: 0.0,   pitch: -0.92, group: 'closeup', desc: '贴脸·西番草样件正视:读叶面、主脉、主藤起伏与两端落回石面(单子 AO)。' },
  { id: 'cu_scroll_oblique', pos: [59.3, 0, 245.00], yaw: 0.92,  pitch: -0.65, group: 'closeup', desc: '贴脸·西番草样件斜 60°:掠射读浮起——轮廓线有起伏才是刻出来的(单子 AO)。' },
  { id: 'cu_scroll_mid',     pos: [57.8, 0, 249.86], yaw: 0.0,   pitch: -0.22, group: 'closeup', desc: '中景 6m·西番草样件:几何版 vs 贴图版(?relief=tex)在这一档做 pixel diff(单子 AO)。' },
  /* 单子 AS:绦环板浮雕的取证位(正门东次间、门道右侧那两扇几何版)。
   *
   * **站位与俯仰是量出来的,不是从单子上抄的。** 单子原文给 (60.6, 239.6)/pitch −0.15,
   * 那是东梢间——那几扇走贴图版,`?tiaohuan=tex` 换过去两张一模一样,diff 量不出东西。
   * 门道两旁的几何版在世界 x=57.09 / 57.70,绦环板带心 y=2.641m(台基 0.75 + 槛墙
   * 1.17 + 板心),相机眼高约 1.70m——**带子高过人眼,视张角对站距有极值**:
   * px ≈ 832·0.14·d/(d² + 0.94²),d≈0.94m 时最大约 62px。这里取 d=1.04m 换一个不那么
   * 仰的取景,实测带高 51px。**单子预估的「≥100px」在这个构件上做不到**,
   * 谁能做到、代价多少,见 docs/reviews/2026-09-15-as-findings.md。 */
  { id: 'cu_tiaohuan',     pos: [57.4, 0, 238.4],  yaw: 0.0,   pitch: 0.70, group: 'closeup', desc: '贴脸·绦环板:正门门道右侧两扇的西番草浮雕(几何版),与 ?tiaohuan=tex 的贴图版做 pixel diff(单子 AS)。' },
  /* 单子 AQ-b2:潇湘馆当心间的落地格扇——`P-26` 说漫射光下 6mm 几何版读不过贴图版,
   * 但那是在正门量的,带高只有 51px。这里换一个几何版**有机会赢**的位置再问一遍。
   *
   * 站位是算出来、再把带子投影到屏幕上校正过的,不是猜的:
   * 正房在 (−105, 1, 98) yaw 0,前檐柱缝 z = 98 + depthHalf 3.36 = 101.36;
   * 当心间净宽 3.4167m 分 4 扇,最东那扇(不开的那两扇之一)扇心 x = −106.281;
   * 扇高 wallH−0.1 = 3.08m,扇心 y = platH 0.45 + 1.59,绦环板带心在扇心下 0.578m
   * → **台基面上 1.46m**(单子给的数,复算对上),世界 y = 2.46,带高 0.14m。
   *
   * ⚠️ **站在台基上,不是地面上**:台基外沿 z = 101.36 + margin 0.9 = 102.26,
   * 站到它外面眼高才会从 3.07 掉到 2.62。实测扫了 z = 101.76~103.4 六个站位,
   * 带高在 z≈102.0 处见顶 **86~90px**(下了台基退到 103.4 只剩 52px)——
   * 也就是说这条带子**做不到 100px**,但比正门那 51px 大 1.7 倍,
   * 已经是全园绦环板能取到的最好取景。取 z=102.06 / pitch −0.62:带子落在
   * 画面 y 485~571,一扇格扇填满画幅。带区的屏幕坐标由投影算出,写在回报里。 */
  { id: 'cu_xiaoxiang_tiaohuan', pos: [-106.28, 0, 102.06], yaw: 0, pitch: -0.62, group: 'closeup', desc: '贴脸·潇湘馆当心间落地格扇的绦环板(带高 86px):几何版 4mm/6mm 与贴图版在这里做 pixel diff(单子 AQ-b2)。' },
  /* 单子 AM3(裁定回合):题字石「曲徑通幽處」(cuizhang.rock-02,世界 (−34, 200))。
   *
   * 原机位 (−28,210)/pitch 0.35 是单子原文抄来的,没有量:水平距石头 11.66 m,
   * pitch 0.35 在这个距离上把画面中心指到世界 y≈8.2,1600×900 里字心只比
   * 地平线高 120px、上半幅全是天——回报 §9.2 交了裁定,裁定要求照
   * `cu_lattice_front`/`cu_tiaohuan`/`cu_xiaoxiang_tiaohuan` 的先例改成
   * 「站位与俯仰是量出来的」,把机位挪到南岸唇口。
   *
   * 站位改成 (−33,204.5)——南岸干地(实测标高 2.536 m,水面 y=0 以上,不再站在
   * 溪床里),距锚点 4.61 m(`Math.hypot(1,4.5)`)。yaw 用本文件的约定重算:
   * forward=(−sin yaw,0,−cos yaw),解 (−34,200)−(−33,204.5)=(−1,−4.5) 得
   * yaw=atan2(1,4.5)=**0.2187 rad**。pitch 抬到 0.40。
   * 验过没退:字心世界 y 仍是 5.70(字面 mesh 没挪,只挪了机位);该处机位人眼
   * y = 2.536(该点 terrainHeight,`collision.terrainHeight(-33,204.5)`)+
   * EYE_HEIGHT 1.62 = **4.156**,字心仍高过人眼 **1.54 m**,判据「高过视线」不倒。 */
  { id: 'cu_inscription', pos: [-33, 0, 204.5], yaw: 0.2187, pitch: 0.40, group: 'closeup', desc: '贴脸·题字石「曲徑通幽處」:字是否在视线上方、读得出(07-04/07-78;单子 AM3 裁定回合)。' },
];
