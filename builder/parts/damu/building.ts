import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { deriveBuilding, type BuildingSpec, type Frame } from '@builder/derive/index';
import { deriveFayuanBuilding, type FayuanBuildingSpec, type FayuanBuildingFrame } from '@builder/derive/fayuan/building';
import {
  CN,
  TILE_UV,
  woodMaterial,
  tileMaterial,
  plasterMaterial,
  stoneMaterial,
  whiteStoneMaterial,
  paperMaterial,
} from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { assemblePingshengKe, qingDougongBook } from '@builder/parts/damu/dougong';
import { makeRng, smoothstep, lerp, clamp } from '@engine/core/Noise';
import { mergeByMaterial } from '@builder/parts/merge';
import {
  buildTiaohuanRelief, tiaohuanOverride, TIAOHUAN_BAND_H, TIAOHUAN_LIFT, TIAOHUAN_MIN_W,
  type TiaohuanMode,
} from '@builder/parts/ornament/tiaohuan-band';
import { makePlaque } from '@builder/parts/xiaomu/plaque';
import { gexinGeometry } from '@builder/parts/qiangyuan/wall';
import { plaqueFromPlan } from '@builder/plan/objects';
import {compileRearDoor,compileExteriorSteps,type RearDoorSpec,type StairSpec,type WalkSurface} from '@builder/plan/building-access';

/**
 * 大木作建筑:结构尺寸来自推导表，原型支持法式及法原，不以材分字段伪装江南构造。
 *
 * 局部坐标:原点在台基中心地面,+X 沿面阔向东,+Z 朝正面(南)。
 * 屋面 = 举折剖面(自橑檐枋背到脊)+ 檐出,沿面阔放样;歇山在角部以 45° 收进
 * 到"转过 n 椽"处起山花;翼角在角部把檐口抬起(起翘)并外推(生出)。
 */

export interface BuildingOptions {
  spec: BuildingSpec | FayuanBuildingSpec;
  /** 匾额文字;空则不挂。 */
  plaque?: string;
  /** 前檐处理:格扇门/敞开/粉墙。 */
  front?: 'door' | 'open' | 'wall' | 'window';
  /** 两山:粉墙/敞开。 */
  sides?: 'wall' | 'open' | 'window';
  /** 后檐:粉墙/敞开/格扇门;缺省同 sides。 */
  back?: 'wall' | 'open' | 'door' | 'window';
  /** A small rear door within one bay; absent keeps the legacy full facade. */
  backDoor?:RearDoorSpec;
  steps?:{front?:StairSpec;back?:StairSpec};
  /** 亭/廊的美人靠。 */
  railing?: boolean;
  /** 美人靠装在哪几面(亭):e 东 w 西 n 北(后) s 南(前);缺省东西北。 */
  railingSides?: ('e' | 'w' | 'n' | 's')[];
  /** 台基高(米)。 */
  platformH?: number;
  platformMarginM?:number;
  /** 出际(米),硬山/悬山两山悬出。 */
  chuji?: number;
  /** 江南提栈覆盖举高比。 */
  ratio?: number;
  /** 墙体材质:粉墙 / 水磨砖(青石)。 */
  wallMaterial?: 'plaster' | 'stone';
  /** 当心间中间两扇门开着(默认开)。 */
  doorOpen?: boolean;
  /** 门屋(中柱造):门装在中柱缝而不在檐柱缝,前后檐到中柱是两段门道;
   *  前檐当心间敞开,中柱缝当心间装板门、其余间砌墙,后檐只留当心间通行。 */
  gatehouse?: boolean;
  /** Tier A 清式斗拱:装真分件平身科攒(五踩/七踩),替换三箱占位(单子 V-V3)。
   *  缺省保留占位箱体;Tier B/C 江南建筑本来就少斗拱或不用(tiers.md),不设此字段。 */
  bracketSet?: { cai: 5 | 7 };
  /** 台基石作:青石(缺省)/白石(07-01「白石台磯」)。 */
  plinthMaterial?: 'stone' | 'whiteStone';
  /** 格扇/槛窗的格心纹样:ice/wan/haitang 走墙垣的格心生成器(PQ-2),
   *  lantern(灯笼锦,07-76③)是本文件自己的生成器——gexinGeometry 不认这个名字;
   *  缺省保留步步锦。 */
  lattice?: 'ice' | 'wan' | 'haitang' | 'lantern';
  seed?: number;
}

export interface BuildingResult extends PartBuild {
  frame: Frame | FayuanBuildingFrame;
  /** 台基平台(局部坐标),装配器登记用。 */
  platform: { hx: number; hz: number; y: number };
  walkSurfaces:WalkSurface[];
  /** 需要阻挡的柱与墙(局部坐标)。 */
  blockers: { cx: number; cz: number; hx: number; hz: number; h: number; minY?:number; rot?: number }[];
}

/* ------------------------------------------------------------------ */
/* 剖面                                                                */
/* ------------------------------------------------------------------ */

interface ProfilePt {
  /** 平面上离檐口尖端的距离(向屋中心为正)。 */
  s: number;
  /** 绝对高度。 */
  y: number;
}

/** 从推导表取一侧的屋面剖面:檐尖 → 橑檐枋背 → 各槫 → 脊。 */
function roofProfile(fr: Frame | FayuanBuildingFrame): { pts: ProfilePt[]; sEave: number; sRidge: number } {
  const m = fr.m;
  const tipX = m.eaveHalf + m.yanchu;
  if ('roofSection' in fr) return { pts: fr.roofSection, sEave: m.yanchu, sRidge: tipX };
  const pts: ProfilePt[] = [{ s: 0, y: m.eaveY - m.eaveTip.drop }];
  // 槫自脊向檐排列,反过来自檐向脊。
  const purl = m.purlins.slice().reverse();
  for (const p of purl) pts.push({ s: tipX - p.x, y: m.eaveY + p.y });
  return { pts, sEave: m.yanchu, sRidge: tipX };
}

/** 在剖面上按 s 插值高度(线性,槫间是直椽)。 */
function profileY(pts: ProfilePt[], s: number): number {
  if (s <= pts[0].s) return pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    if (s <= pts[i].s) {
      const t = (s - pts[i - 1].s) / (pts[i].s - pts[i - 1].s);
      return lerp(pts[i - 1].y, pts[i].y, t);
    }
  }
  return pts[pts.length - 1].y;
}

/** 把剖面细分成等 s 步的采样,让曲面顺滑(每架至少 4 段)。 */
function subdivide(pts: ProfilePt[], sMax: number, perJia = 5): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].s;
    const b = Math.min(pts[i].s, sMax);
    if (b <= a) break;
    for (let k = 0; k < perJia; k++) out.push(lerp(a, b, k / perJia));
    if (b < pts[i].s) break;
  }
  out.push(Math.min(sMax, pts[pts.length - 1].s));
  return out;
}

/* ------------------------------------------------------------------ */
/* 坡面网格                                                            */
/* ------------------------------------------------------------------ */

interface SlopeOpts {
  /** 剖面(局部:s 向 −Z 为屋内,+Z 为檐外)。 */
  pts: ProfilePt[];
  /** 采样到的 s 上限(歇山撒头只到转过点)。 */
  sMax: number;
  /** 檐口处 z(尖端)。 */
  zTip: number;
  /** 半宽函数:该 s 处坡面沿 X 的半宽。 */
  halfWidth: (s: number) => number;
  /** 角部抬升:输入 (x, s) 返回 dy。 */
  lift: (x: number, s: number, hw: number) => number;
  /** 角部外推:输入 (x, s, hw) 返回 dx(符号沿 x)。 */
  push: (x: number, s: number, hw: number) => number;
  cols: number;
  /** 顶面/底面偏移。 */
  offset: number;
  flip?: boolean;
  /** UV 比例:u 每米几垄,v 每米几步。 */
  uScale: number;
  vScale: number;
}

function buildSlope(o: SlopeOpts): THREE.BufferGeometry {
  const sRows = subdivide(o.pts, o.sMax);
  const rows = sRows.length;
  const cols = o.cols;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const s = sRows[r];
    const hw = o.halfWidth(s);
    const y0 = profileY(o.pts, s);
    for (let c = 0; c <= cols; c++) {
      const t = c / cols;
      let x = lerp(-hw, hw, t);
      x += o.push(x, s, hw);
      const y = y0 + o.lift(x, s, hw) + o.offset;
      const z = o.zTip - s;
      pos.push(x, y, z);
      uv.push(x * o.uScale, s * o.vScale);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      if (o.flip) idx.push(a, d, b, b, d, e);
      else idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 沿一条折线拉一根圆管(脊)。 */
function ridgeTube(points: THREE.Vector3[], r: number, mat: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2);
  const geo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), r, 8, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** 垂带石(单子 AG3):两端竖直切的梯形棱柱,不是整体绕 X 轴旋转的方盒——
 *  旧做法端面跟着转斜,上端翘出台基面成一个三角形楔子,下端悬空。顶面(可见
 *  坡面)精确贴合 (topZ,topY)→(botZ,botY) 两点,不加余量;底面沿厚度方向
 *  往下收(vshift = thick/cos(ang)),两端各自在世界 Z 上竖直切断——台基端
 *  与台基边缘齐平,地面端天然埋入地下,不留悬空的三角形空隙("象眼填实",
 *  见 shots/zhengmen-closeup 的复算)。hw 为半宽(沿局部 X,与旧方盒的
 *  0.24m 宽一致);flip 在 side==='back' 时整体翻绕向,front/back 互为镜像。 */
function chuidaiGeometry(hw: number, topY: number, botY: number, topZ: number, botZ: number, vshift: number, flip: boolean): THREE.BufferGeometry {
  const T0 = new THREE.Vector3(-hw, topY, topZ);
  const T1 = new THREE.Vector3(hw, topY, topZ);
  const T2 = new THREE.Vector3(hw, botY, botZ);
  const T3 = new THREE.Vector3(-hw, botY, botZ);
  const B0 = new THREE.Vector3(-hw, topY - vshift, topZ);
  const B1 = new THREE.Vector3(hw, topY - vshift, topZ);
  const B2 = new THREE.Vector3(hw, botY - vshift, botZ);
  const B3 = new THREE.Vector3(-hw, botY - vshift, botZ);
  const pos: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const t = flip ? [a, c, b] : [a, b, c];
    pos.push(t[0].x, t[0].y, t[0].z, t[1].x, t[1].y, t[1].z, t[2].x, t[2].y, t[2].z);
  };
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    pushTri(a, b, c);
    pushTri(a, c, d);
  };
  quad(T0, T3, T2, T1); // 顶面:可见坡面,贴合踏跺鼻线。
  quad(B0, B1, B2, B3); // 底面:厚度下方,多埋进台基/地面。
  quad(T0, B0, B3, T3); // 左侧(-hw)。
  quad(T1, T2, B2, B1); // 右侧(+hw)。
  quad(T0, T1, B1, B0); // 台基端:竖直切,与台基边缘齐平。
  quad(T3, B3, B2, T2); // 地面端:竖直切,埋入地下——象眼在此填实。
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 棂条截面(单子 AP,ART_DIRECTION §2 小木例外):8 顶点倒角截面;外框/抹头
 *  在内侧(宽度方向一侧)再加一道 3mm 凹线,12 顶点。
 *  截面定义在 (x=深, y=宽) 平面,逆时针一圈;配 extrudeBar 沿长度挤出。
 *  细于 4cm 的棂条不走 roundedBox(倒角看不见、三角 15 倍),走这份截面挤出
 *  (三角只多一倍)——这是圣经 §2 登记的小木例外,不是代码自行破例。 */
function barProfile(d: number, w: number, c: number, groove?: { w: number; d: number; side: 1 | -1 }): [number, number][] {
  const hd = d / 2;
  const hw = w / 2;
  const cc = Math.max(1e-4, Math.min(c, hd - 1e-4, hw - 1e-4));
  if (!groove) {
    return [
      [hd - cc, hw], [-(hd - cc), hw],
      [-hd, hw - cc], [-hd, -(hw - cc)],
      [-(hd - cc), -hw], [hd - cc, -hw],
      [hd, -(hw - cc)], [hd, hw - cc],
    ];
  }
  const gw = groove.w / 2;
  const gd = groove.d;
  const top: [number, number][] = groove.side === 1
    ? [[hd - cc, hw], [gw, hw], [gw, hw - gd], [-gw, hw - gd], [-gw, hw], [-(hd - cc), hw]]
    : [[hd - cc, hw], [-(hd - cc), hw]];
  const bot: [number, number][] = groove.side === -1
    ? [[-(hd - cc), -hw], [-gw, -hw], [-gw, -(hw - gd)], [gw, -(hw - gd)], [gw, -hw], [hd - cc, -hw]]
    : [[-(hd - cc), -hw], [hd - cc, -hw]];
  return [
    ...top,
    [-hd, hw - cc], [-hd, -(hw - cc)],
    ...bot,
    [hd, -(hw - cc)], [hd, hw - cc],
  ];
}

/** 截面沿线段挤出:挤出后长度沿 +X、宽度沿 Y、深度沿 Z,与旧 addBar 的方盒同约定。 */
function extrudeBar(profile: [number, number][], len: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

/** 灯笼锦格心(单子 AG2 返工;AP 工艺样板):大格(灯笼框,粗棂条)与小格(棋盘格一半
 *  嵌一个斜插小方框,细棂条)相间,内部节点缀卡子花——这才是"灯笼"的大小相间读法,
 *  不是方格纸上每格打一个叉(旧实现,加密解决不了,要改构成)。
 *  与 wan(万字不到头)、ice(冰裂)同层但另起一支——qiangyuan/wall.ts 的
 *  gexinGeometry 不认这个纹样名(未知 sub 会被它当 ice 处理),所以另写,不复用。
 *  单子 AP(只改工艺,花样与洞口尺寸不变):
 *  - AP1 截面分级:框棂 2.4cm / 细棂 1.4cm,都走 8 顶点截面挤出,2mm 倒角;
 *  - AP2 节点整理:先求线网(横竖中线+交点),框棂拆成节点间的段、每个节点一个
 *    小方块,交叉处不再两根整棂互穿;
 *  - AP3 收头:单元保持 cell=0.38m,nx/ny 取整后余量分到两侧边框内侧的留白,
 *    不摊进单元、不在边界切半个花样。
 *  返回 depth 供调用方把窗纸退到棂条背面(AP4)。 */
export function lanternLatticeGeometry(w: number, h: number, bar: number): { geo: THREE.BufferGeometry; depth: number } {
  const cell = 0.38;
  const nx = Math.max(2, Math.round(w / cell));
  const ny = Math.max(2, Math.round(h / cell));
  // AP3 收头:单元不许超过 cell;取整后的余量分到两侧边框内侧的留白,不摊进单元。
  // 洞口凑不满整数个 cell 时单元只能收窄(cw<cell,与旧行为一致),超出的余量
  // (w−nx·cell)落成两侧留白——边界永远是完整花样,不出现随意切断的半个。
  const cw = Math.min(cell, w / nx);
  const ch = Math.min(cell, h / ny);
  const pw = nx * cw;
  const ph = ny * ch;
  const depth = bar * 0.9;
  const chamfer = 0.002;
  // 灯笼框棂条比小格插框粗一档,主辅比例才读得出(细棂 1.4cm,框棂 2.4cm)。
  const frameBar = Math.max(bar * 1.7, 0.024);
  const frameProf = barProfile(depth, frameBar, chamfer);
  const thinProf = barProfile(depth, bar, chamfer);
  const geos: THREE.BufferGeometry[] = [];
  const addSeg = (x0: number, y0: number, x1: number, y1: number, prof: [number, number][]) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-4) return;
    const geo = extrudeBar(prof, len);
    geo.rotateZ(Math.atan2(y1 - y0, x1 - x0));
    geo.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    geos.push(geo);
  };
  // 线网:横竖棂条中线按单元居中,纹样范围 pw×ph,两侧留白 (w−pw)/2。
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= nx; i++) xs.push(-pw / 2 + i * cw);
  for (let j = 0; j <= ny; j++) ys.push(-ph / 2 + j * ch);
  // 节点整理:框棂拆成节点间的段,段端顶到节点方块边,不互穿。
  const nh = frameBar / 2;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j < ny; j++) addSeg(xs[i], ys[j] + nh, xs[i], ys[j + 1] - nh, frameProf);
  }
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) addSeg(xs[i] + nh, ys[j], xs[i + 1] - nh, ys[j], frameProf);
  }
  // 每个节点一个小方块(一次),段与节点端面齐平,转角连续。
  for (const x of xs) {
    for (const y of ys) {
      const node = new THREE.BoxGeometry(frameBar, frameBar, depth);
      node.translate(x, y, 0);
      geos.push(node);
    }
  }
  // 卡子花:内部节点(框的交叉点)钉一颗小菱花(压扁八面体,略凸出画面),
  // 节点上有装饰是灯笼锦区别于素方格的第二个标志;现在坐在真节点方块上。
  const kaziR = Math.min(cw, ch) * 0.1;
  for (let i = 1; i < nx; i++) {
    for (let j = 1; j < ny; j++) {
      const geo = new THREE.OctahedronGeometry(kaziR, 0);
      geo.scale(1, 1, 0.45);
      geo.rotateZ(Math.PI / 4);
      geo.translate(xs[i], ys[j], depth * 0.5 + kaziR * 0.22);
      geos.push(geo);
    }
  }
  // 大小格相间:棋盘格取一半的大格,格心斜插一个更小的方框(细棂条)——
  // 另一半大格留空,大小相邻并置才读成"灯笼",不是把所有格子一起加密。
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if ((i + j) % 2 !== 0) continue;
      const cx = -pw / 2 + (i + 0.5) * cw;
      const cy = -ph / 2 + (j + 0.5) * ch;
      const hx = cw * 0.3;
      const hy = ch * 0.3;
      addSeg(cx - hx, cy, cx, cy - hy, thinProf);
      addSeg(cx, cy - hy, cx + hx, cy, thinProf);
      addSeg(cx + hx, cy, cx, cy + hy, thinProf);
      addSeg(cx, cy + hy, cx - hx, cy, thinProf);
    }
  }
  const merged = mergeGeometries(geos.map((g) => g.toNonIndexed()), false);
  if (!merged) throw new Error('lantern lattice merge failed');
  return { geo: merged, depth };
}

/* ------------------------------------------------------------------ */
/* 格扇                                                                */
/* ------------------------------------------------------------------ */

/** 一扇格扇,清式标准三段:下裙板(浅浮雕)、中绦环板(浅浮雕缠枝)、上格心(纹样)。
 *  07-76③:纹样原著未写死(「细雕新鲜花样」不是具体名字),这里 artChoice 换掉万字。 */
function makeGeshan(w: number, h: number, mat: THREE.Material, paper: THREE.Material, seed: number, pattern?: 'ice' | 'wan' | 'haitang' | 'lantern', tiaohuan: TiaohuanMode = 'tex'): THREE.Group {
  const g = new THREE.Group();
  // 截面分级(单子 AP1):外框 3.5cm 起线,抹头(内框) 2.8cm 起线,
  // 格心棂条由灯笼锦生成器自己分级(框棂 2.4cm / 细棂 1.4cm)。
  const bar = 0.035;
  const railBar = 0.028;
  const frameD = 0.05;
  // 外框与抹头:0.6mm 倒角 + 内侧一道 3mm 凹线(起线),截面挤出。
  // side 指凹线开在宽度方向哪一侧(+1 = 挤出后的 +Y 侧;竖放旋转后转到 −X)。
  const addMolded = (x: number, y: number, sx: number, sy: number, side: 1 | -1, d = frameD) => {
    const len = Math.max(sx, sy);
    const t = Math.min(sx, sy);
    const geo = extrudeBar(barProfile(d, t, 0.0006, { w: 0.003, d: 0.0016, side }), len);
    if (sy > sx) geo.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  const add = (x: number, y: number, sx: number, sy: number, d = frameD) => {
    // 小木例外(ART_DIRECTION §2,单子 AP):细于 4cm 的棂条不走 roundedBox
    // (倒角看不见、三角 15 倍),走 8 顶点倒角截面挤出(三角只多一倍)。
    const thinBar = Math.min(sx, sy) < 0.04;
    let geo: THREE.BufferGeometry;
    if (thinBar) {
      geo = extrudeBar(barProfile(d, Math.min(sx, sy), 0.002), Math.max(sx, sy));
      if (sy > sx) geo.rotateZ(Math.PI / 2);
    } else {
      geo = roundedBox(sx, sy, d, 0.006, 1);
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  // 外框:凹线朝扇内。
  addMolded(0, h / 2 - bar / 2, w, bar, -1);
  addMolded(0, -h / 2 + bar / 2, w, bar, 1);
  addMolded(-w / 2 + bar / 2, 0, bar, h, -1);
  addMolded(w / 2 - bar / 2, 0, bar, h, 1);
  // 抹头:下·裙板 0~28%h,中·绦环板一条窄带(clamp,矮格扇也不挤没),上·格心余下。
  const skirtTop = -h / 2 + h * 0.28;
  const tiaoH = clamp(h * 0.12, 0.07, 0.2);
  const tiaoTop = skirtTop + tiaoH;
  const addRail = (y: number, side: 1 | -1) => {
    addMolded(0, y, w, railBar, side);
    add(0, y + bar * 1.6, w, bar * 0.6, frameD * 0.8);
  };
  addRail(skirtTop, -1); // 凹线朝裙板
  addRail(tiaoTop, 1); // 凹线朝格心
  // 下·裙板:素板 + 浅浮雕(起线边框 + 中心团花),按 §10"木作更克制"从简。
  // 上端插进抹头背面、下端叠进下框——AP1 抹头收窄到 2.8cm 后,旧余量(板顶距抹头
  // 底 8.5mm→12mm)会在背光面漏光成通缝,板要咬住抹头。
  const skirtW = w - bar * 2;
  const skirtH = skirtTop - railBar / 2 + 0.004 - (-h / 2 + bar * 0.75);
  const skirtCY = (-h / 2 + bar * 0.75 + skirtTop - railBar / 2 + 0.004) / 2;
  const skirt = new THREE.Mesh(roundedBox(skirtW, skirtH, 0.03, 0.005, 2), mat);
  skirt.position.set(0, skirtCY, 0);
  skirt.receiveShadow = true;
  g.add(skirt);
  {
    const inset = Math.min(skirtW, skirtH) * 0.16;
    const fb = 0.012;
    const rz = 0.03 / 2 + fb / 2;
    const bw = skirtW - inset * 2;
    const bh = skirtH - inset * 2;
    if (bw > 0.05 && bh > 0.05) {
      const frameBar = (x: number, y: number, sx: number, sy: number) => {
        const bm = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, fb), mat);
        bm.position.set(x, skirtCY + y, rz);
        bm.castShadow = true;
        g.add(bm);
      };
      frameBar(0, bh / 2, bw, fb);
      frameBar(0, -bh / 2, bw, fb);
      frameBar(-bw / 2, 0, fb, bh);
      frameBar(bw / 2, 0, fb, bh);
      const medallion = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(bw, bh) * 0.22, Math.min(bw, bh) * 0.22, fb, 10), mat);
      medallion.rotation.x = Math.PI / 2;
      medallion.position.set(0, skirtCY, rz + fb * 0.4);
      medallion.castShadow = true;
      g.add(medallion);
    }
  }
  // 中·绦环板:浅浮雕缠枝卷草——复用脊那根 ridgeTube,一条波形藤蔓 + 几个卷叶点。
  // 板两端同样咬进上下抹头(通缝同上)。
  const tiaoW = w - bar * 2;
  const tiaoCY = (skirtTop + tiaoTop) / 2;
  const tiaoBoardH = tiaoH - railBar + 0.008;
  const tiaoBoard = new THREE.Mesh(roundedBox(tiaoW, tiaoBoardH, 0.025, 0.004, 2), mat);
  tiaoBoard.position.set(0, tiaoCY, 0);
  tiaoBoard.receiveShadow = true;
  g.add(tiaoBoard);
  /* 单子 AS2:西番草浮雕带(`ornament/tiaohuan-band.ts`)。`D-27` 的落点就是这条带
   * ——带心在 1.3m 上下,人眼 1.62m,站 1m 就占满一条;台矶那条 0.185m 的怎么站
   * 都只有 32px。带高钉在 0.14m,上下各留 1.6cm 素板;板窄到塞不下一格纹样
   * (净宽 ≤ 0.2m)或抹头挤得只剩一线时不上纹样,留素板。
   *
   * z:板面在 +12.5mm,带子再抬 0.6mm 免得 h=0 的平地与板面打架。浮雕峰高 4mm,
   * 即 +17.1mm,而外框/抹头的面在 +25mm——带子整条坐在框子退进去的那个浅槽里,
   * 两端的断口被框边挡住。这是「带长 = 板净宽、两端不淡出」能成立的前提。 */
  const tiaoBandH = Math.min(TIAOHUAN_BAND_H, tiaoBoardH - 0.04);
  if (tiaoW > TIAOHUAN_MIN_W && tiaoBandH >= 0.06) {
    const relief = buildTiaohuanRelief(tiaohuanOverride() ?? tiaohuan, tiaoW, mat, seed, tiaoBandH);
    relief.position.set(0, tiaoCY, 0.025 / 2 + TIAOHUAN_LIFT);
    g.add(relief);
  }
  if (tiaoW > 0.2) {
    const reliefZ = 0.025 / 2 + 0.012;
    const halfSpan = tiaoW / 2 - 0.06;
    const amp = Math.min(tiaoH, 0.16) * 0.24;
    const vinePts: THREE.Vector3[] = [];
    const nSeg = 6;
    for (let i = 0; i <= nSeg; i++) {
      const t = i / nSeg;
      const x = lerp(-halfSpan, halfSpan, t);
      const y = tiaoCY + Math.sin(t * Math.PI * 2.2) * amp;
      vinePts.push(new THREE.Vector3(x, y, reliefZ));
    }
    g.add(ridgeTube(vinePts, Math.min(0.012, tiaoH * 0.12), mat));
    for (const t of [0.18, 0.5, 0.82]) {
      const x = lerp(-halfSpan, halfSpan, t);
      const y = tiaoCY + Math.sin(t * Math.PI * 2.2) * amp;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(Math.min(0.022, tiaoH * 0.2), 6, 4), mat);
      leaf.scale.set(1, 0.55, 0.5);
      leaf.position.set(x, y + amp * 0.55, reliefZ + 0.014);
      leaf.castShadow = true;
      g.add(leaf);
    }
  }
  // 格心:窗纸退到棂条背面(AP4:z = −棂厚/2 − 3mm),框边对纸面产生遮光;
  // paperMaterial 的 emissive 假透光是 D-14 定的,不动。纹样按 pattern 生成
  // (见下方 gexinGeometry / lanternLatticeGeometry)。
  const gy0 = tiaoTop + bar * 2.2;
  const gy1 = h / 2 - bar;
  const gh = gy1 - gy0;
  const gw = w - bar * 2;
  // 纸面比格心洞口大一圈:四边插进外框/抹头背面各 4mm——棂条退后后,
  // 抹头与格心之间的窄带不能漏成通缝(背光面实测漏光,见单子 AP 回报)。
  const paperY0 = tiaoTop + railBar / 2 - 0.004;
  const paperY1 = gy1 + 0.004;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(gw + 0.008, paperY1 - paperY0), paper);
  p.receiveShadow = true; // 框边/棂条的影子要落在纸面上,遮光才读得出
  if (pattern) {
    // gexinGeometry 的棂条截面是 bar×bar(wall.ts 不在本单文件域,深度按 bar 计)。
    const { geo, depth } = pattern === 'lantern'
      ? lanternLatticeGeometry(gw, gh, 0.014)
      : { geo: gexinGeometry(pattern, gw, gh, 0.02, seed, true), depth: 0.02 };
    p.position.set(0, (paperY0 + paperY1) / 2, -(depth / 2 + 0.003));
    g.add(p);
    const lattice = new THREE.Mesh(geo, mat);
    lattice.position.set(0, (gy0 + gy1) / 2, 0);
    lattice.castShadow = true;
    lattice.receiveShadow = true;
    g.add(lattice);
    return g;
  }
  p.position.set(0, (paperY0 + paperY1) / 2, -(0.03 / 2 + 0.003));
  g.add(p);
  const rng = makeRng(seed);
  const nx = Math.max(2, Math.round(gw / 0.14));
  const ny = Math.max(3, Math.round(gh / 0.14));
  const thin = 0.018;
  for (let i = 1; i < nx; i++) {
    const x = -gw / 2 + (gw * i) / nx;
    const segs = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < segs; k++) {
      const y0 = gy0 + (gh * k) / segs + (k > 0 ? 0.03 : 0);
      const y1 = gy0 + (gh * (k + 1)) / segs - (k < segs - 1 ? 0.03 : 0);
      add(x, (y0 + y1) / 2, thin, y1 - y0, 0.03);
    }
  }
  for (let j = 1; j < ny; j++) {
    const y = gy0 + (gh * j) / ny;
    const segs = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < segs; k++) {
      const x0 = -gw / 2 + (gw * k) / segs + (k > 0 ? 0.03 : 0);
      const x1 = -gw / 2 + (gw * (k + 1)) / segs - (k < segs - 1 ? 0.03 : 0);
      add((x0 + x1) / 2, y, x1 - x0, thin, 0.03);
    }
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* 主体                                                                */
/* ------------------------------------------------------------------ */

export function buildBuilding(opts: BuildingOptions): BuildingResult {
  if((opts.backDoor||opts.steps?.back)&&opts.back!=='door')throw new Error('后门与后踏步须对应back:door');
  if(opts.steps&&(!Number.isFinite(opts.platformMarginM)||opts.platformMarginM!<=0))throw new Error('显式踏步须声明台基出边');
  const fr = 'paramSet' in opts.spec ? deriveFayuanBuilding(opts.spec) : deriveBuilding(opts.spec);
  const legacy = 'cai' in fr ? fr : null;
  const rolled = 'ridgeStyle' in fr && fr.ridgeStyle === 'rolled';
  if (legacy && rolled) {
    fr.provenance.art.push({
      id: 'project:gate-ridge-style',
      name: '正门屋脊做法(泥鳅脊)',
      method: 'artistic_choice',
      note: '07-76①方向内证可定:原文自判「不落富丽俗套」,而高正脊加正吻正是「富丽俗套」——正门屋脊须软。' +
        '07-76②「泥鳅脊」具体做法未核到,两读并存:(a)低而圆的正脊,仍有脊线;(b)卷棚,省正脊。' +
        '这里选 (b):省去起脊/哺鸡脊那组高出屋面的装饰体,让两坡瓦面直接相接——复用 fayuan 卷棚已用的同一个' +
        'ridgeStyle 语义(此前只在 fashi.BuildingSpec 缺这个自由度),不是「原文如此」。' +
        '未选 (a) 是因为它要求给正脊一个新的低矮圆润造型,这里没做,留給下一轮再核。' +
        '「泥鳅脊」本身是江南脊名,而正门在这里走 fashi(官式材分)推导——这处口径错位没有解决,只是绕开' +
        '(未把正门整体改判给 fayuan 参数集,那是参数集层的决定,不在本单子范围),记为待补 missing:' +
        '「一座五间 Tier A 门屋该不该走江南参数集」，本单子未写入 knowledge/rules/missing.rules.json(该文件属单子 O)。',
    });
  }
  const m = fr.m;
  const seed = opts.seed ?? 7;
  const root = new THREE.Group();
  root.name = 'Building';
  const blockers: BuildingResult['blockers'] = [];
  const walkSurfaces:WalkSurface[]=[];
  let rearDoor:ReturnType<typeof compileRearDoor>|null=null;

  const wood = woodMaterial(CN.wood, 1);
  const column = woodMaterial(CN.column, 1);
  const tile = tileMaterial(1, 1);
  const stone = stoneMaterial(1);
  // 台基石作:缺省青石;正门按第十七回「下面白石台磯」用白石(07-01)。
  const plinth = opts.plinthMaterial === 'whiteStone' ? whiteStoneMaterial(1) : stone;
  const plaster = opts.wallMaterial === 'stone' ? stoneMaterial(2) : plasterMaterial(1);
  const paper = paperMaterial();
  const ridgeMat = new THREE.MeshStandardMaterial({ color: CN.tile, roughness: 0.85 });
  const underside = new THREE.MeshStandardMaterial({ color: 0x4a3226, roughness: 0.9, side: THREE.DoubleSide });

  const isTing = opts.spec.roofType === '攒尖';
  const isXieshan = opts.spec.roofType === '歇山';
  const isYingshan = opts.spec.roofType === '硬山' || opts.spec.roofType === '悬山';
  if (isYingshan && opts.sides === 'window')
    throw new Error('硬山窗墙尚需上部山墙独立构造，不得省掉山墙');

  const wallT0 = 0.26;

  /* ---- 台基 ------------------------------------------------------- */
  const platH = opts.platformH ?? 0.45;
  const margin = opts.platformMarginM ?? (isTing ? 0.55 : 0.9);
  const platHX = m.width / 2 + margin;
  const platHZ = m.depthHalf + margin;
  // 07-01「鑿成西番草花樣」是台基边缘的浅浮雕,不是贴图——见下方 plinthMaterial
  // === 'whiteStone' 分支(07-76④,只在白石台基上做,别处台基仍素面)。
  const plat = new THREE.Mesh(roundedBox(platHX * 2, platH, platHZ * 2, 0.03, 3), plinth);
  plat.position.y = platH / 2;
  plat.receiveShadow = true;
  plat.castShadow = true;
  root.add(plat);
  // 阶条石一圈略凸。
  const rim = new THREE.Mesh(roundedBox(platHX * 2 + 0.08, 0.1, platHZ * 2 + 0.08, 0.02, 2), plinth);
  rim.position.y = platH - 0.05;
  rim.receiveShadow = true;
  root.add(rim);
  if (opts.plinthMaterial === 'whiteStone') {
    fr.provenance.art.push({
      id: 'project:gate-plinth-white-stone',
      name: '正门白石台基与台基高',
      method: 'artistic_choice',
      note: `第十七回「下面白石台磯,鑿成西番草花樣」(07-01):材质按原文取白石非青石;规则表无门屋台基高,${platH}m 为观感取值;西番草是浅浮雕几何,见台基边缘卷草(07-76④),不是贴图。`,
    });
    // 07-76④:西番草(缠枝卷叶)浅浮雕,几何不是贴图,材质用现成的 whiteStoneMaterial()
    // (plinth 已经是它)。§10 的具象雕刻只集中在这一处——沿台基一圈做一条卷草带,
    // 别处(木作)只到"有工"的程度,不在这里叠加更多。
    //
    // C3(2026-09-14 backlog)返工:原实现每个波峰只放一个压扁的球,主藤是纯正弦波——
    // 正弦波不管多平滑都是"过一个尖",从没真正卷起来过,读成一道带小结点的锯齿细线。
    // 「卷草」的卷字要求真闭合的螺旋/C形/S形回转。现在每个波峰处让藤蔓绕一整圈再继续
    // (loopSteps),圆心比波峰更往外顶一个 curlR,曲线才有真闭合的卷;藤蔓本身也加粗
    // (bandR)、振幅加大(bandAmp),不然浅浮雕在正常观距下还是读不出明暗。叶片从压扁的
    // 球改成尖头的四棱锥压扁件,贴着卷心外沿,指向卷心离藤的那一侧——读成叶尖而不是芽点。
    {
      const bandY = platH * 0.55;
      // 卷心是这条带的主角:半径要比藤蔓粗细大好几倍,中心才镂空、读成"卷"而不是
      // 一颗珠子;主藤起伏只是把卷心托起来的引子,振幅比卷心小。
      const curlR = Math.min(0.052, platH * 0.135);
      const bandAmp = curlR * 0.55;
      const bandR = Math.min(0.016, platH * 0.042);
      const inMargin = 0.16; // 让开转角,免得四条带在角部穿插
      type Side = { x0: number; z0: number; x1: number; z1: number; nx: number; nz: number };
      const sides: Side[] = [
        { x0: -platHX + inMargin, z0: platHZ, x1: platHX - inMargin, z1: platHZ, nx: 0, nz: 1 },
        { x0: -platHX + inMargin, z0: -platHZ, x1: platHX - inMargin, z1: -platHZ, nx: 0, nz: -1 },
        { x0: -platHX, z0: -platHZ + inMargin, x1: -platHX, z1: platHZ - inMargin, nx: -1, nz: 0 },
        { x0: platHX, z0: -platHZ + inMargin, x1: platHX, z1: platHZ - inMargin, nx: 1, nz: 0 },
      ];
      for (const s of sides) {
        const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
        if (len < 0.3) continue;
        const ux = (s.x1 - s.x0) / len;
        const uz = (s.z1 - s.z0) / len;
        const wavelength = Math.max(0.5, curlR * 4.4); // 给整圆卷心留够位置,不挤邻居
        const nPeriods = Math.max(2, Math.round(len / wavelength));
        const pts: THREE.Vector3[] = [];
        const leafSpots: { pos: THREE.Vector3; out: THREE.Vector3 }[] = [];
        const along = (t: number): [number, number] => [
          lerp(s.x0, s.x1, t) + s.nx * 0.015,
          lerp(s.z0, s.z1, t) + s.nz * 0.015,
        ];
        {
          const [x0, z0] = along(0);
          pts.push(new THREE.Vector3(x0, bandY, z0));
        }
        for (let i = 0; i < nPeriods; i++) {
          const sign = i % 2 === 0 ? 1 : -1;
          const t0 = i / nPeriods;
          const t1 = (i + 1) / nPeriods;
          const tPeak = t0 + (t1 - t0) * 0.5;
          // 上升段:基线爬到波峰,缓入缓出。
          const riseSteps = 5;
          for (let k = 1; k <= riseSteps; k++) {
            const lt = k / riseSteps;
            const t = lerp(t0, tPeak, lt);
            const [x, z] = along(t);
            const y = bandY + sign * bandAmp * Math.sin((lt * Math.PI) / 2);
            pts.push(new THREE.Vector3(x, y, z));
          }
          // 卷心:圆心比波峰再往外顶 curlR,从波峰位置绕整整一圈回到波峰——这一圈就是"卷"。
          const [px, pz] = along(tPeak);
          const peakY = bandY + sign * bandAmp;
          const centerY = peakY + sign * curlR;
          const loopSteps = 14;
          for (let k = 1; k <= loopSteps; k++) {
            const ang = -Math.PI / 2 + (k / loopSteps) * Math.PI * 2 * -sign;
            const alongOff = Math.cos(ang) * curlR; // 正圆卷心,中间才镂空读成"卷"
            const y = centerY + Math.sin(ang) * curlR * sign;
            pts.push(new THREE.Vector3(px + ux * alongOff, y, pz + uz * alongOff));
            // 卷心转到离藤最远的一点(4/loopSteps 附近)时在外沿钉一片叶。
            if (k === Math.round(loopSteps * 0.32)) {
              const outX = px + ux * alongOff * 1.3;
              const outZ = pz + uz * alongOff * 1.3;
              leafSpots.push({
                pos: new THREE.Vector3(outX, y, outZ),
                out: new THREE.Vector3(ux * alongOff, Math.sin(ang) * curlR * sign, uz * alongOff).normalize(),
              });
            }
          }
          // 下降段:卷心绕回后落回基线,衔接下一个波峰。
          const fallSteps = 5;
          for (let k = 1; k <= fallSteps; k++) {
            const lt = k / fallSteps;
            const t = lerp(tPeak, t1, lt);
            const [x, z] = along(t);
            const y = bandY + sign * bandAmp * Math.sin(((1 - lt) * Math.PI) / 2);
            pts.push(new THREE.Vector3(x, y, z));
          }
        }
        root.add(ridgeTube(pts, bandR, plinth));
        for (const leaf of leafSpots) {
          const geo = new THREE.ConeGeometry(bandR * 2.1, bandR * 5.2, 4, 1);
          geo.scale(1, 1, 0.42); // 压扁成叶片而不是立体的锥
          const mesh = new THREE.Mesh(geo, plinth);
          mesh.position.copy(leaf.pos).addScaledVector(leaf.out, 0.012);
          // 锥尖原朝局部 +Y;转到朝 leaf.out(卷心甩出去的方向),叶尖就指向外沿。
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), leaf.out);
          mesh.castShadow = true;
          root.add(mesh);
        }
      }
    }
  }
  if (opts.lattice === 'lantern') {
    fr.provenance.art.push({
      id: 'project:gate-lattice-lantern',
      name: '格心纹样(灯笼锦)',
      method: 'artistic_choice',
      note: '07-76③:「门栏窗槅皆是细雕新鲜花样」原著没写死具体纹样(曹雪芹没写死),之前用的万字不到头' +
        '恰恰是最标准的样式,与「新鲜」相反。改用灯笼锦(方格骨架+每格内接菱花):qiangyuan/wall.ts 的' +
        'gexinGeometry 不认这个纹样名(未知 sub 会被它当冰裂处理),所以在本文件另写了' +
        'lanternLatticeGeometry,不是复用/魔改 gexinGeometry。',
    });
  }
  // 正面踏步。
  const stepW = isTing ? m.width * 0.5 : Math.max(1.2, m.width * 0.3);
  const nSteps = Math.max(2, Math.round(platH / 0.15));
  for (let i = 0; i < (opts.steps?.front?0:nSteps); i++) {
    const h = platH / nSteps;
    const d = 0.3;
    const st = new THREE.Mesh(roundedBox(stepW, h, d, 0.015, 2), plinth);
    st.position.set(0, h * (nSteps - i) - h / 2, platHZ + d / 2 + d * i);
    st.receiveShadow = true;
    st.castShadow = true;
    root.add(st);
  }
  for(const side of ['front','back'] as const) {
    const spec=opts.steps?.[side];if(!spec)continue;
    const surfaces=compileExteriorSteps(platH,platHX,platHZ,side,spec,side==='back'?(opts.backDoor?.centerXM??0):0);
    for(const p of surfaces) {
      const st=new THREE.Mesh(roundedBox(p.hx*2,p.y,p.hz*2,.015,2),plinth);
      st.position.set(p.cx,p.y/2,p.cz);st.receiveShadow=true;st.castShadow=true;root.add(st);
    }
    walkSurfaces.push(...surfaces);
    if(opts.gatehouse) {
      // 踏跺垂带(单子 AG3 返工,见上方 chuidaiGeometry):踏跺两侧各一条顺坡
      // 而下的条石。规则表无门屋踏跺垂带条目,带宽 0.24m 为观感取值——
      // slope+0.12 的余量已去掉,顶面直接贴合台基边到地面两点,不再多留。
      const sign=side==='front'?1:-1;
      const run=surfaces.length*spec.treadM;
      const ang=Math.atan2(platH,run);
      const thick=0.14;
      const vshift=thick/Math.cos(ang);
      const topZ=sign*platHZ,topY=platH,botZ=sign*(platHZ+run),botY=0;
      for(const sx of [-1,1]) {
        const geo=chuidaiGeometry(0.12,topY,botY,topZ,botZ,vshift,sign<0);
        const cd=new THREE.Mesh(geo,plinth);
        cd.position.x=sx*(spec.widthM/2+0.10);
        cd.castShadow=true;cd.receiveShadow=true;root.add(cd);
      }
    }
  }
  if(opts.gatehouse&&(opts.steps?.front||opts.steps?.back))fr.provenance.art.push({
    id:'project:gate-steps-chuidai',name:'正门踏跺与垂带',method:'artistic_choice',
    note:'规则表无门屋踏跺/垂带条目;踏跺宽与垂带宽 0.24m 均为观感取值。'});

  /* ---- 柱网 ------------------------------------------------------- */
  const colXs = m.columnX;
  const rowsZ = [m.depthHalf, -m.depthHalf];
  const colH = m.columnH;
  const colR = m.columnD / 2;
  const columns: { x: number; z: number; h: number }[] = [];
  // 柱础线脚:方礅之上车一圈覆盆轮廓。覆盆高 = 0.1×础方、盆唇厚 = 0.01×础方,
  // 是法式卷三 [03-23] 的比例(derive 层只消费了 03-21 的础方,这里在构件层落地);
  // 鼓镜的弧线书里无形制,为观感取值,收工时记进 provenance.art。
  const fupenH = Math.max(0.05, m.base * 0.1);
  const lipT = Math.max(0.006, m.base * 0.01);
  const baseLathe = new THREE.LatheGeometry(
    [
      new THREE.Vector2(m.base * 0.47, 0),
      new THREE.Vector2(m.base * 0.47, lipT * 1.6),
      new THREE.Vector2(colR * 1.34, fupenH * 0.58),
      new THREE.Vector2(colR * 1.2, fupenH - lipT),
      new THREE.Vector2(colR * 1.26, fupenH - lipT),
      new THREE.Vector2(colR * 1.26, fupenH),
      new THREE.Vector2(colR * 0.98, fupenH + 0.004),
    ],
    18,
  );
  fr.provenance.art.push({
    id: 'project:column-base-molding',
    name: '柱础覆盆线脚轮廓',
    method: 'artistic_choice',
    note: '覆盆高 0.1×础方、盆唇厚 0.01×础方按法式卷三 [03-23](该条由构件层消费,derive 层只取了 03-21 的础方);鼓镜弧线无形制依据,为观感取值。',
  });
  const addColumn = (x: number, z: number, rise: number) => {
    const h = colH + rise;
    // 梭柱:上三分之一微收 [03-06]。
    const geo = new THREE.CylinderGeometry(colR * 0.92, colR, h, 18, 1);
    const c = new THREE.Mesh(geo, column);
    c.position.set(x, platH + h / 2, z);
    c.castShadow = true;
    c.receiveShadow = true;
    root.add(c);
    // 柱础:方 2D,上承车削覆盆。
    const base = new THREE.Mesh(roundedBox(m.base, 0.1, m.base, 0.02, 2), stone);
    base.position.set(x, platH + 0.05, z);
    base.receiveShadow = true;
    root.add(base);
    const bowl = new THREE.Mesh(baseLathe, stone);
    bowl.position.set(x, platH + 0.1, z);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    root.add(bowl);
    columns.push({ x, z, h });
    blockers.push({ cx: x, cz: z, hx: colR + 0.02, hz: colR + 0.02, h: platH + h });
  };
  for (let i = 0; i < colXs.length; i++) {
    for (const z of rowsZ) addColumn(colXs[i], z, m.rise[i]);
  }
  // 两山中柱(硬山/歇山的山面在多椽时加一根;四椽以内不加)。

  /* ---- 阑额 / 普拍枋 ----------------------------------------------- */
  const lanTop = platH + colH;
  const addBeam = (x0: number, z0: number, x1: number, z1: number, w: number, t: number, yTop: number, mat: THREE.Material) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const b = new THREE.Mesh(roundedBox(len, w, t, 0.012, 2), mat);
    b.position.set((x0 + x1) / 2, yTop - w / 2, (z0 + z1) / 2);
    b.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    b.castShadow = true;
    b.receiveShadow = true;
    root.add(b);
  };
  for (const z of rowsZ) {
    for (let i = 1; i < colXs.length; i++) addBeam(colXs[i - 1], z, colXs[i], z, m.lan.w, m.lan.t, lanTop, wood);
  }
  for (const x of [colXs[0], colXs[colXs.length - 1]]) addBeam(x, rowsZ[0], x, rowsZ[1], m.lan.w, m.lan.t, lanTop, wood);
  // 普拍枋:一圈扁枋压在阑额上 [03-19]。
  // 法原连机/夹堂高度已在推导的檐高里计入，不再叠加宋式普拍枋。
  const pupai = legacy ? 0.09 : 0;
  const ring = new THREE.Group();
  if (pupai > 0) {
    for (const z of rowsZ) addBeam(colXs[0] - 0.15, z, colXs[colXs.length - 1] + 0.15, z, pupai, m.lan.t * 1.3, lanTop + pupai, wood);
    for (const x of [colXs[0], colXs[colXs.length - 1]]) addBeam(x, rowsZ[0] + 0.15, x, rowsZ[1] - 0.15, pupai, m.lan.t * 1.3, lanTop + pupai, wood);
  }
  root.add(ring);

  /* ---- 中柱(门屋分心造) ------------------------------------------ */
  // 门屋通例:门装在中柱缝上,不在檐柱缝上——前后檐柱到中柱各隔一段门道,
  // 穿门是"走过一段进深",不是"掀开一张纸"。两椽门屋里中柱一缝正在中脊下,
  // 直抵脊枋底(分心造)。规则表无门屋条目,中柱高按"顶住脊枋"从推导脊高扣。
  const gatehouse = opts.gatehouse ?? false;
  const centerBay = Math.floor((colXs.length - 1) / 2);
  const midColTop = platH + m.ridgeY - 0.45; // 柱顶让出脊枋与望板的位
  if (gatehouse) {
    // 山面两柱由硬山山墙取代,中柱只立内四缝。
    for (let i = 1; i < colXs.length - 1; i++) addColumn(colXs[i], 0, midColTop - platH - colH);
    // 脊枋:一缝横梁把中柱顶串起来。
    addBeam(colXs[0], 0, colXs[colXs.length - 1], 0, m.lan.w, m.lan.t, midColTop + m.lan.w, wood);
    fr.provenance.art.push({
      id: 'project:gatehouse-zhongzhu',
      name: '中柱造与板门门口',
      method: 'artistic_choice',
      note: '门屋通例:门装中柱缝。规则表(fashi/qing/fayuan/missing 已查)无门屋条目;门洞宽取当心间柱间净空减边梃、门高 2.55m、板门厚 0.055m,均为观感取值。',
    });
    fr.provenance.art.push({
      id: 'project:gate-shallow-depth',
      name: '门屋压浅进深',
      method: 'artistic_choice',
      note: '门屋进深远小于面阔:取两椽(220 分)对五间面阔(1260 分)。椽架数是 spec 输入,不走规则表;压浅是"门屋不读成厅堂"的艺术判断。',
    });
  }

  /* ---- 雀替 --------------------------------------------------------- */
  // 柱梁交接处的托脚:轮廓在交接处断一下,"木构"的信息就给足了。
  // 规则表没有雀替条目(fashi/qing/fayuan/missing 已查):长取净跨 1/4、
  // 高同阑额,是清式江南小式的常见比例,不是条文——收工时记 provenance.art。
  {
    const qH = Math.max(0.12, m.lan.w);
    const qT = Math.min(0.08, colR * 0.5);
    const beamBottom = lanTop - m.lan.w - 0.003; // 顶面比阑额底低 3mm,不共面
    const qCache = new Map<number, THREE.BufferGeometry>();
    const quetieGeo = (L: number) => {
      const key = Math.round(L * 200) / 200;
      let g = qCache.get(key);
      if (!g) {
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.lineTo(L, 0);
        s.quadraticCurveTo(L * 0.92, -qH * 0.42, L * 0.45, -qH * 0.82);
        s.quadraticCurveTo(L * 0.16, -qH, 0, -qH);
        s.closePath();
        g = new THREE.ExtrudeGeometry(s, { depth: qT, bevelEnabled: false, curveSegments: 6 });
        g.translate(0, 0, -qT / 2);
        qCache.set(key, g);
      }
      return g;
    };
    const addQuetie = (x: number, z: number, L: number, rotY: number) => {
      const q = new THREE.Mesh(quetieGeo(L), wood);
      q.position.set(x, beamBottom, z);
      q.rotation.y = rotY;
      q.castShadow = true;
      q.receiveShadow = true;
      root.add(q);
    };
    for (const z of rowsZ) {
      for (let i = 0; i < colXs.length; i++) {
        for (const dir of [-1, 1]) {
          const j = i + dir;
          if (j < 0 || j >= colXs.length) continue;
          const span = Math.abs(colXs[j] - colXs[i]) - colR * 2;
          const L = clamp(span * 0.25, 0.2, 0.9);
          addQuetie(colXs[i] + dir * colR * 0.8, z, L, dir > 0 ? 0 : Math.PI);
        }
      }
    }
    // 山面(两山顺梁)的角柱也各带一只。
    for (const x of [colXs[0], colXs[colXs.length - 1]]) {
      const span = rowsZ[0] - rowsZ[1] - colR * 2;
      const L = clamp(span * 0.25, 0.2, 0.9);
      addQuetie(x, rowsZ[0] - colR * 0.8, L, Math.PI / 2);
      addQuetie(x, rowsZ[1] + colR * 0.8, L, -Math.PI / 2);
    }
    fr.provenance.art.push({
      id: 'project:quetie-proportions',
      name: '雀替比例',
      method: 'artistic_choice',
      note: '规则表无雀替条目;长取净跨 1/4、高同阑额,为清式江南小式常见比例的观感取值。',
    });
  }

  /* ---- 铺作 ---------------------------------------------------------- */
  const puzuoTop = lanTop + pupai + m.puzuoH;
  if (legacy?.puzuo && opts.bracketSet) {
    /* Tier A 真分件攒(单子 V-V3):清式平身科整攒,替换下面的三箱占位。
     * 接在 derivePuzuo() 之后——铺作总高与出跳距离用它的结果,不另起一套:
     * 攒的挑檐桁中(3 斗口/拽架 × 拽架数 [01-07])对齐 puzuoOut,攒顶抵 puzuoH。 */
    const dbook = qingDougongBook();
    const f = legacy.cai.fenM;
    const outM = legacy.puzuo.outFen * f;
    const heightM = legacy.puzuo.heightFen * f;
    const cai = opts.bracketSet.cai;
    const jumps = (cai - 1) / 2;
    const dkM = outM / (3 * jumps);
    const set = assemblePingshengKe(dbook, cai, dkM);
    // 攒当 11 斗口 [01-04] 均布;实物 10.0~11.4(04-05 乙注:攒当是开间除出来的余数,
    // 不是模数),这里按开间取整反摊。柱头科未分件(与转角铺作同属下一轮),
    // 柱头位空出不装——不拿平身科冒充柱头科。
    const cuanDangM = dbook.num('01-04', 'cuanDangDk') * dkM;
    const positions: { x: number; z: number; rot: number }[] = [];
    for (const z of rowsZ) {
      const rot = z > 0 ? 0 : Math.PI;
      for (let i = 1; i < colXs.length; i++) {
        const bayLen = colXs[i] - colXs[i - 1];
        const n = Math.max(1, Math.round(bayLen / cuanDangM));
        for (let k = 1; k <= n; k++) {
          positions.push({ x: colXs[i - 1] + (bayLen * k) / (n + 1), z, rot });
        }
      }
    }
    for (const p of positions) {
      const mesh = new THREE.Mesh(set.geometry, wood);
      mesh.position.set(p.x, lanTop + pupai, p.z);
      mesh.rotation.y = p.rot;
      // 攒在檐口阴影区内,关闭投影换一半渲染量(阴影 pass 会把 3.8k/攒再画一遍);
      // 单件棚拍仍投影。全场景三角数预算见单子 V(≤400 万)。
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    fr.provenance.art.push({
      id: 'project:bracket-set-fit',
      name: '清式平身科攒装上法式包络',
      method: 'artistic_choice',
      note:
        `${cai} 踩平身科 ${positions.length} 攒:斗口 ${(dkM * 1000).toFixed(1)}mm 由 puzuoOut ${outM.toFixed(3)}m ÷ ${3 * jumps} 斗口定(出跳用 derivePuzuo 结果);` +
        `攒顶 ${set.topM.toFixed(3)}m 对铺作总高 ${heightM.toFixed(3)}m 差 ${((set.topM / heightM - 1) * 100).toFixed(1)}%(由 spec 跳距配比吸收);` +
        `攒当 11 斗口 [01-04] 立法值均布,实物区间 10.0~11.4(04-05 乙注);柱头科/转角铺作未分件,柱头位空出不装。`,
    });
  } else if (legacy?.puzuo) {
    const f = legacy.cai.fenM;
    const ludou = new THREE.Mesh(roundedBox(32 * f, 20 * f, 32 * f, 0.01, 1), wood);
    const gong = new THREE.Mesh(roundedBox(72 * f, 21 * f, 10 * f, 0.01, 1), wood);
    const linggong = new THREE.Mesh(roundedBox(72 * f, 15 * f, 10 * f, 0.01, 1), wood);
    const placeSet = (x: number, z: number, outward: THREE.Vector2) => {
      const g = new THREE.Group();
      const l = ludou.clone();
      l.position.y = 10 * f;
      g.add(l);
      const out = legacy.puzuo!.outFen * f;
      // 华栱沿出跳方向,令栱横向,叠到铺作高。
      let y = 20 * f;
      for (let j = 0; j < legacy.puzuo!.T; j++) {
        const h = gong.clone();
        h.position.set(outward.x * out * 0.5 * (j + 1) / legacy.puzuo!.T, y + 10.5 * f, outward.y * out * 0.5 * (j + 1) / legacy.puzuo!.T);
        h.rotation.y = Math.abs(outward.x) > 0.5 ? 0 : Math.PI / 2;
        g.add(h);
        y += 21 * f;
      }
      const lg = linggong.clone();
      lg.position.set(outward.x * out, y + 7.5 * f, outward.y * out);
      lg.rotation.y = Math.abs(outward.x) > 0.5 ? Math.PI / 2 : 0;
      g.add(lg);
      g.position.set(x, lanTop + pupai, z);
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      root.add(g);
    };
    for (let i = 0; i < colXs.length; i++) {
      placeSet(colXs[i], rowsZ[0], new THREE.Vector2(0, 1));
      placeSet(colXs[i], rowsZ[1], new THREE.Vector2(0, -1));
    }
    // 补间:每间一朵(江南亭榭)。
    for (let i = 1; i < colXs.length; i++) {
      const x = (colXs[i - 1] + colXs[i]) / 2;
      placeSet(x, rowsZ[0], new THREE.Vector2(0, 1));
      placeSet(x, rowsZ[1], new THREE.Vector2(0, -1));
    }
    if (isTing || isXieshan) {
      for (const x of [colXs[0], colXs[colXs.length - 1]]) {
        const sgn = Math.sign(x) || 1;
        placeSet(x, 0, new THREE.Vector2(sgn, 0));
      }
    }
  }

  /* ---- 橑檐枋 ----------------------------------------------------- */
  // 枋高 = 推导表里 eaveY(柱脚起) 减去柱高与铺作高;普拍枋是本文件加的,不计入。
  const fangH = m.eaveY - m.columnH - m.puzuoH;
  const fangY = puzuoTop + fangH - platH; // 枋背(自台基面)
  const eaveHalfX = m.width / 2 + (isYingshan ? 0 : m.puzuoOut);
  const eaveHalfZ = m.eaveHalf;
  const fh = Math.max(0.12, fangH);
  // 枋背贴着屋面板底:屋面在橑檐枋位的表面高 = platH + pupai + eaveY,板厚 thick。
  const fangTop = platH + pupai + m.eaveY - 0.14;
  addBeam(-eaveHalfX - 0.1, eaveHalfZ, eaveHalfX + 0.1, eaveHalfZ, fh, 0.12, fangTop, wood);
  addBeam(-eaveHalfX - 0.1, -eaveHalfZ, eaveHalfX + 0.1, -eaveHalfZ, fh, 0.12, fangTop, wood);
  if (!isYingshan) {
    addBeam(eaveHalfX, eaveHalfZ, eaveHalfX, -eaveHalfZ, fh, 0.12, fangTop, wood);
    addBeam(-eaveHalfX, eaveHalfZ, -eaveHalfX, -eaveHalfZ, fh, 0.12, fangTop, wood);
  }

  /* ---- 屋面 ------------------------------------------------------- */
  const prof = roofProfile(fr);
  // 剖面高度以地面为 0:推导表里 eaveY 自柱脚起,加台基。
  const pts = prof.pts.map((p) => ({ s: p.s, y: p.y + platH + pupai }));
  const sRidge = prof.sRidge; // 檐尖到脊的平面距离
  const tipZ = eaveHalfZ + m.yanchu;
  const tipX = eaveHalfX + m.yanchu;
  const qiqiao = m.qiqiao;
  const shengchu = m.shengchu;
  // 法式转椽与法原显式侧样是两条尺寸来源，不借用材分或屋顶预设互相冒充。
  const legacyTurn = legacy && !('paramSet' in opts.spec)
    ? Math.min(sRidge - 0.05, m.yanchu + m.puzuoOut + legacy.yanchu.xieshanTurn * m.depth / opts.spec.rafters) : 0;
  const sTurn = isTing ? sRidge : isXieshan ? ('hipSetbackM' in fr ? fr.hipSetbackM : legacyTurn) : 0;
  const cornerLen = Math.max(0.8, sTurn * 0.9);

  const cornerT = (x: number, hw: number) => clamp((Math.abs(x) - (hw - cornerLen)) / cornerLen, 0, 1);
  const lift = (x: number, s: number, hw: number) => {
    if (qiqiao <= 0 || isYingshan) return 0;
    const t = cornerT(x, hw);
    const up = 1 - smoothstep(0, sTurn, s);
    // 嫩戗发戗:近角急起。
    return qiqiao * Math.pow(t, 2.2) * up;
  };
  const push = (x: number, s: number, hw: number) => {
    if (isYingshan) return 0;
    const t = cornerT(x, hw);
    const up = 1 - smoothstep(0, sTurn, s);
    return Math.sign(x) * shengchu * Math.pow(t, 1.6) * up;
  };
  // 贴图一个周期 12 垄 × ~19 排:垄宽 0.2m、排距 0.26m。
  const uScale = TILE_UV.u;
  const vScale = TILE_UV.v;
  const thick = 0.16;

  const roofGroup = new THREE.Group();
  roofGroup.name = 'Roof';
  // 屋面各面的剖面参数,椽与连檐共用。
  const faces: { halfWidth: (s: number) => number; zTip: number; sMax: number; rotY: number }[] = [];
  const addSurface = (geoTop: THREE.BufferGeometry, geoBot: THREE.BufferGeometry, rotY: number) => {
    const top = new THREE.Mesh(geoTop, tile);
    const bot = new THREE.Mesh(geoBot, underside);
    top.rotation.y = rotY;
    bot.rotation.y = rotY;
    top.castShadow = true;
    top.receiveShadow = true;
    bot.receiveShadow = true;
    roofGroup.add(top, bot);
  };

  const mkPair = (halfWidth: (s: number) => number, zTip: number, sMax: number, rotY: number) => {
    faces.push({ halfWidth, zTip, sMax, rotY });
    const common = { pts, sMax, zTip, halfWidth, lift, push, cols: 40, uScale, vScale };
    addSurface(
      buildSlope({ ...common, offset: 0 }),
      buildSlope({ ...common, offset: -thick, flip: true }),
      rotY,
    );
  };

  if (isYingshan) {
    const chuji = opts.chuji ?? 0.35;
    const hw = () => m.width / 2 + chuji;
    mkPair(hw, tipZ, sRidge, 0);
    mkPair(hw, tipZ, sRidge, Math.PI);
  } else if (isXieshan) {
    // 前后坡:角部 45° 收进到转过点,之后等宽(山花面)。
    const hwFB = (s: number) => tipX - Math.min(s, sTurn);
    mkPair(hwFB, tipZ, sRidge, 0);
    mkPair(hwFB, tipZ, sRidge, Math.PI);
    // 撒头(两山下坡):只到转过点,宽度按同样收进。
    const hwSide = (s: number) => tipZ - Math.min(s, sTurn);
    mkPair(hwSide, tipX, sTurn, Math.PI / 2);
    mkPair(hwSide, tipX, sTurn, -Math.PI / 2);
  } else {
    // 攒尖:四坡收到尖。
    const hw = (s: number) => Math.max(0.001, tipX - s * (tipX / sRidge));
    const hwZ = (s: number) => Math.max(0.001, tipZ - s * (tipZ / sRidge));
    mkPair(hw, tipZ, sRidge, 0);
    mkPair(hw, tipZ, sRidge, Math.PI);
    mkPair(hwZ, tipX, sRidge, Math.PI / 2);
    mkPair(hwZ, tipX, sRidge, -Math.PI / 2);
  }
  root.add(roofGroup);

  /* ---- 连檐(檐口封边) --------------------------------------------- */
  const eaveEdge = (halfWidth: (s: number) => number, zTip: number, rotY: number) => {
    const n = 40;
    const pos: number[] = [];
    const idx: number[] = [];
    const hw = halfWidth(0);
    for (let i = 0; i <= n; i++) {
      let x = lerp(-hw, hw, i / n);
      x += push(x, 0, hw);
      const y = pts[0].y + lift(x, 0, hw);
      pos.push(x, y + 0.01, zTip, x, y - thick, zTip);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, wood);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    root.add(mesh);
  };
  // 四条檐口线的数据(halfWidth/zTip/rotY):连檐与瓦当滴水(单子 AG1)共用同一份,
  // 不另起一套——见下方 eaveDrip。
  const eaveLines: { halfWidth: (s: number) => number; zTip: number; rotY: number }[] = isYingshan
    ? (() => {
        const hw = () => m.width / 2 + (opts.chuji ?? 0.35);
        return [
          { halfWidth: hw, zTip: tipZ, rotY: 0 },
          { halfWidth: hw, zTip: tipZ, rotY: Math.PI },
        ];
      })()
    : isXieshan
      ? [
          { halfWidth: (s: number) => tipX - Math.min(s, sTurn), zTip: tipZ, rotY: 0 },
          { halfWidth: (s: number) => tipX - Math.min(s, sTurn), zTip: tipZ, rotY: Math.PI },
          { halfWidth: (s: number) => tipZ - Math.min(s, sTurn), zTip: tipX, rotY: Math.PI / 2 },
          { halfWidth: (s: number) => tipZ - Math.min(s, sTurn), zTip: tipX, rotY: -Math.PI / 2 },
        ]
      : [
          { halfWidth: () => tipX, zTip: tipZ, rotY: 0 },
          { halfWidth: () => tipX, zTip: tipZ, rotY: Math.PI },
          { halfWidth: () => tipZ, zTip: tipX, rotY: Math.PI / 2 },
          { halfWidth: () => tipZ, zTip: tipX, rotY: -Math.PI / 2 },
        ];
  for (const e of eaveLines) eaveEdge(e.halfWidth, e.zTip, e.rotY);

  /* ---- 瓦当 + 滴水(檐口收头,单子 AG1;AJ3 放大盖缝) ------------------- */
  // 分层明显与没有瓦当滴水是同一条缝的两面:筒瓦垄头(圆瓦当)与板瓦垄间
  // (尖滴水)沿檐口相间,盖住"屋面板压在连檐/椽上"那条缝。落位复用
  // eaveLines(同一份 halfWidth/zTip/rotY)。
  //
  // 单子 AJ3(用户 2026-09-15 反馈第 2 条「瓦当太小,挡不住瓦这层和木格
  // 中间的缝,正面看差」),两处改:
  //  ① 尺寸跟着垄距走:垄距 = 屋面贴图一个周期的 12 垄(materials.ts
  //    TILE_UV,垄宽 0.2m)——瓦当间距与贴图的垄一一对上、坐在垄头上;
  //    不再用 m.rafterPitch(0.153m,和贴图垄距 0.2m 对不上,瓦当落在
  //    垄间),也不再有 min(0.09,…) 硬顶。直径 = 0.92×垄距,相邻瓦当
  //    几乎相接,是真实檐口的读法。
  //  ② 盖缝是本职:那条缝量出来高 coverTo = 板厚(0.16) + 椽高
  //    (rafterDia×1.15) + 一线余量,从连檐上口一直到椽头底。瓦当下加
  //    一截垄头舌、滴水舌片拉长,两样都垂过缝底;厚度 0.05→0.09、
  //    出挑 z 外加 0.03,整排站在连檐正面以外,正面平视那条缝被这排
  //    围裙整个压住。
  // 纹样从简(ART_DIRECTION §10):只做圆形的形 + 一圈唇,不刻兽面。
  // 全部烘焙进一份合并几何,整栋楼只加 1 个 draw call。
  {
    const dripGeos: THREE.BufferGeometry[] = [];
    const ridgePitch = 1 / (12 * TILE_UV.u); // 筒瓦垄距 = 贴图垄宽(0.2m)
    const wadangR = ridgePitch * 0.46;
    const wadangT = 0.09;
    const lipT = wadangT * 0.4;
    const coverTo = thick + m.rafterDia * 1.15 + 0.02; // 缝底:板厚 + 椽高 + 余量
    const heelW = wadangR * 1.2;
    const dripR = ridgePitch * 0.33;
    const dripH = coverTo + 0.02;
    for (const e of eaveLines) {
      const hw = e.halfWidth(0);
      const n = Math.max(2, Math.round((hw * 2) / ridgePitch));
      if (n < 2) continue;
      for (let i = 0; i < n; i++) {
        // 从檐口一端起,每半垄一个位:偶数位瓦当(对垄)、奇数位滴水(对垄间)。
        let x = lerp(-hw + ridgePitch / 2, hw - ridgePitch / 2, i / (n - 1));
        x += push(x, 0, hw);
        const y = pts[0].y + lift(x, 0, hw);
        const z = e.zTip + 0.03;
        let geo: THREE.BufferGeometry;
        if (i % 2 === 0) {
          // 瓦当:筒瓦垄头,圆饼 + 略大的唇(一圈边) + 下垂垄头舌(盖连檐)。
          const drum = new THREE.CylinderGeometry(wadangR * 0.82, wadangR * 0.82, wadangT, 10, 1, true);
          drum.rotateX(Math.PI / 2);
          drum.translate(0, 0, -wadangT * 0.3);
          const lip = new THREE.CylinderGeometry(wadangR, wadangR, lipT, 10, 1);
          lip.rotateX(Math.PI / 2);
          lip.translate(0, 0, lipT * 0.5);
          const heel = new THREE.BoxGeometry(heelW, coverTo, wadangT * 0.6);
          heel.translate(0, 0.02 - coverTo / 2, -wadangT * 0.15);
          const merged = mergeGeometries([drum.toNonIndexed(), lip.toNonIndexed(), heel.toNonIndexed()], false);
          geo = merged ?? lip;
        } else {
          // 滴水:板瓦垄间,尖头下垂的舌片(四棱锥压扁),拉长到垂过缝底。
          geo = new THREE.ConeGeometry(dripR, dripH, 4, 1);
          geo.rotateZ(Math.PI); // 尖朝下
          geo.rotateY(Math.PI / 4); // 平面对外
          geo.scale(1, 1, 0.5);
          geo.translate(0, 0.02 - dripH / 2, 0.01);
        }
        geo.translate(x, y, z);
        geo.rotateY(e.rotY);
        dripGeos.push(geo.toNonIndexed());
      }
    }
    if (dripGeos.length) {
      const merged = mergeGeometries(dripGeos, false);
      if (merged) {
        merged.computeVertexNormals();
        const drip = new THREE.Mesh(merged, tile);
        drip.castShadow = true;
        drip.receiveShadow = true;
        roofGroup.add(drip);
      }
    }
  }

  /* ---- 椽(望板下那排) ---------------------------------------------- */
  // 椽径、椽心距出自推导链([04-12]/[05-02] → m.rafterDia,[05-03] → m.rafterPitch),
  // 布椽令一间当间心 [05-03]:椽位对中线对称布。角部不做辐射扇形角椽,
  // 直椽按各面 halfWidth 的收进裁短——从廊下仰视读的是"一排椽",不是角部做法。
  {
    const rd = m.rafterDia;
    const rh = rd * 1.15;
    const s0 = 0.07; // 让开连檐封边
    for (const face of faces) {
      const hwEave = face.halfWidth(0);
      const n = Math.max(2, Math.round((hwEave * 2 - 0.1) / m.rafterPitch));
      for (let i = 0; i <= n; i++) {
        const x0 = lerp(-hwEave + 0.05, hwEave - 0.05, i / n);
        // 这根椽能走到的最里 s:歇山角部 45° 收进与攒尖收尖会把角椽裁短。
        let sEnd = Math.min(prof.sEave + 0.15, face.sMax);
        while (sEnd > s0 + 0.15 && face.halfWidth(sEnd) < Math.abs(x0) + rd) sEnd -= 0.04;
        if (sEnd <= s0 + 0.15) continue;
        const y0 = profileY(pts, s0) + lift(x0, s0, face.halfWidth(s0)) - thick;
        const y1 = profileY(pts, sEnd) + lift(x0, sEnd, face.halfWidth(sEnd)) - thick;
        const sMid = (s0 + sEnd) / 2;
        const len = Math.hypot(sEnd - s0, y1 - y0);
        const theta = Math.atan2(y1 - y0, sEnd - s0);
        const geo = roundedBox(rd, rh, len, Math.min(0.012, rd * 0.18), 1);
        geo.rotateX(Math.PI + theta);
        const r = new THREE.Mesh(geo, wood);
        // 位置也要绕屋中心转 rotY——各坡面的局部坐标系不一致,直接塞局部坐标
        // 会把背坡的椽翻到前坡上方。
        const lx = x0 + push(x0, sMid, face.halfWidth(sMid));
        const lz = face.zTip - sMid;
        const ca = Math.cos(face.rotY);
        const sa = Math.sin(face.rotY);
        r.position.set(lx * ca + lz * sa, (y0 + y1) / 2 - rh / 2 + 0.03, -lx * sa + lz * ca);
        r.rotation.y = face.rotY;
        r.castShadow = true;
        r.receiveShadow = true;
        roofGroup.add(r);
      }
    }
  }

  /* ---- 脊 --------------------------------------------------------- */
  const ridgeY = pts[pts.length - 1].y;
  if ((isYingshan || isXieshan) && !rolled) {
    const hwRidge = isYingshan ? m.width / 2 + (opts.chuji ?? 0.35) : tipX - sTurn;
    const ends = 0.16; // 纹头脊:两端微翘。
    const p: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = lerp(-hwRidge, hwRidge, t);
      const e = Math.pow(Math.abs(t - 0.5) * 2, 4) * ends;
      p.push(new THREE.Vector3(x, ridgeY + 0.1 + e, 0));
    }
    root.add(ridgeTube(p, 0.11, ridgeMat));
    // 端头小翘(哺鸡脊的意思)。
    for (const sx of [-1, 1]) {
      const k = new THREE.Mesh(roundedBox(0.22, 0.34, 0.22, 0.04, 3), ridgeMat);
      k.position.set(sx * hwRidge, ridgeY + 0.22 + ends, 0);
      k.rotation.z = -sx * 0.25;
      k.castShadow = true;
      root.add(k);
    }
  }
  if (isXieshan) {
    // 戗脊(角部 45°)四条 + 垂脊(山花边)四条。
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const p: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const s = (sTurn * i) / 8;
        const hw = tipX - s;
        const x = sx * hw;
        p.push(new THREE.Vector3(x + push(x, s, hw), profileY(pts, s) + lift(x, s, hw) + 0.06, sz * (tipZ - s)));
      }
      root.add(ridgeTube(p, 0.07, ridgeMat));
      const q: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const s = lerp(sTurn, sRidge, i / 8);
        q.push(new THREE.Vector3(sx * (tipX - sTurn), profileY(pts, s) + 0.07, sz * (tipZ - s)));
      }
      root.add(ridgeTube(q, 0.07, ridgeMat));
    }
    // 山花:垂直三角面,粉墙。
    for (const sx of [-1, 1]) {
      const shape = new THREE.Shape();
      const xg = tipX - sTurn;
      const zTop = 0;
      shape.moveTo(-(tipZ - sTurn), profileY(pts, sTurn) - 0.02);
      const N = 10;
      for (let i = 1; i <= N; i++) {
        const s = lerp(sTurn, sRidge, i / N);
        shape.lineTo(-(tipZ - s), profileY(pts, s) - 0.02);
      }
      for (let i = N - 1; i >= 0; i--) {
        const s = lerp(sTurn, sRidge, i / N);
        shape.lineTo(tipZ - s, profileY(pts, s) - 0.02);
      }
      shape.lineTo(tipZ - sTurn, profileY(pts, sTurn) - 0.02);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, plaster);
      mesh.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh.position.set(sx * (xg - 0.06), 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      void zTop;
    }
  }
  if (isTing) {
    // 四条戗脊到尖 + 宝顶。
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const p: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const s = (sRidge * i) / 10;
        const hw = Math.max(0.001, tipX - s * (tipX / sRidge));
        const hz = Math.max(0.001, tipZ - s * (tipZ / sRidge));
        const x = sx * hw;
        p.push(new THREE.Vector3(x + push(x, s, hw), profileY(pts, s) + lift(x, s, hw) + 0.06, sz * hz));
      }
      root.add(ridgeTube(p, 0.07, ridgeMat));
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), ridgeMat);
    top.position.y = ridgeY + 0.25;
    top.castShadow = true;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.3, 14), ridgeMat);
    neck.position.y = ridgeY + 0.05;
    root.add(top, neck);
  }

  /* ---- 硬山山墙:从台基一直砌到屋面下 ------------------------------ */
  if (isYingshan && (opts.sides ?? 'wall') === 'wall') {
    for (const sx of [-1, 1]) {
      const shape = new THREE.Shape();
      const zEdge = m.depthHalf + wallT0 / 2;
      shape.moveTo(-zEdge, platH);
      shape.lineTo(zEdge, platH);
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const z = lerp(zEdge, -zEdge, i / N);
        shape.lineTo(z, profileY(pts, tipZ - Math.abs(z)) - 0.05);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: wallT0, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, plaster);
      mesh.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh.position.set(sx * (m.width / 2 + wallT0 / 2), 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      blockers.push({ cx: sx * (m.width / 2), cz: 0, hx: wallT0 / 2, hz: zEdge, h: platH + colH });
    }
  }

  /* ---- 墙与格扇 --------------------------------------------------- */
  const wallT = 0.26;
  const wallH = colH - 0.02;
  const addWall = (x0: number, z0: number, x1: number, z1: number, h: number, yBase: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const w = new THREE.Mesh(roundedBox(len, h, wallT, 0.01, 2), plaster);
    w.position.set((x0 + x1) / 2, yBase + h / 2, (z0 + z1) / 2);
    w.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    w.castShadow = true;
    w.receiveShadow = true;
    root.add(w);
    blockers.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: len / 2, hz: wallT / 2, h: yBase + h, rot: -Math.atan2(z1 - z0, x1 - x0) });
  };
  /**
   * 按铰链放一扇格扇:hinge 是转轴所在的 x(局部),side=+1 表示门扇在转轴右边。
   * open 为开启角(弧度),正值向外(+Z)推开。
   */
  const hingedPanel = (g: THREE.Group, gw: number, hingeX: number, side: 1 | -1, y: number, z: number, open: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, y, z);
    g.position.set((side * gw) / 2, 0, 0);
    pivot.add(g);
    pivot.rotation.y = -side * open;
    root.add(pivot);
  };
  const doorOpen = opts.doorOpen ?? true;
  const front = opts.front ?? (isTing ? 'open' : 'door');
  const sides = opts.sides ?? (isTing ? 'open' : 'wall');
  const back = opts.back ?? sides;
  const addWindowWall = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1-x0,z1-z0), sillH = wallH * 0.36;
    const rotation = -Math.atan2(z1-z0,x1-x0);
    addWall(x0,z0,x1,z1,sillH,platH);
    const panels = Math.max(2, Math.ceil(len / 0.85));
    for (let k=0;k<panels;k++) {
      const g = makeGeshan(len/panels-.015,wallH-sillH-.08,wood,paper,seed+80+k,opts.lattice);
      const t = (k+.5)/panels;
      g.position.set(lerp(x0,x1,t),platH+sillH+(wallH-sillH)/2,lerp(z0,z1,t));
      g.rotation.y=rotation;
      root.add(g);
    }
    blockers.push({cx:(x0+x1)/2,cz:(z0+z1)/2,hx:len/2,hz:wallT/2,h:platH+wallH,rot:rotation});
  };
  if (back === 'wall') addWall(colXs[0], rowsZ[1], colXs[colXs.length - 1], rowsZ[1], wallH, platH);
  if (back === 'window') addWindowWall(colXs[0],rowsZ[1],colXs[colXs.length-1],rowsZ[1]);
  if (sides === 'window') {
    addWindowWall(colXs[0],rowsZ[0],colXs[0],rowsZ[1]);
    addWindowWall(colXs[colXs.length-1],rowsZ[0],colXs[colXs.length-1],rowsZ[1]);
  }
  if (back === 'door' && opts.backDoor) {
    const s=opts.backDoor,d=compileRearDoor(m,platH,wallH,s);rearDoor=d;
    // One notched plaster panel avoids bevel/UV seams from three adjacent
    // boxes. The three collision spans retain the actual opening below lintel.
    const left=colXs[0],right=colXs.at(-1)!,dl=d.left-s.jambM,dr=d.right+s.jambM;
    const outline=new THREE.Shape();
    outline.moveTo(left,platH);outline.lineTo(dl,platH);outline.lineTo(dl,d.headerTop);
    outline.lineTo(dr,d.headerTop);outline.lineTo(dr,platH);outline.lineTo(right,platH);
    outline.lineTo(right,platH+wallH);outline.lineTo(left,platH+wallH);outline.closePath();
    const rearWall=new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:wallT,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:2,steps:1}),plaster);
    rearWall.position.z=d.z-wallT/2;rearWall.castShadow=true;rearWall.receiveShadow=true;root.add(rearWall);
    blockers.push({cx:(left+dl)/2,cz:d.z,hx:(dl-left)/2,hz:wallT/2,h:platH+wallH});
    blockers.push({cx:(dr+right)/2,cz:d.z,hx:(right-dr)/2,hz:wallT/2,h:platH+wallH});
    blockers.push({cx:(dl+dr)/2,cz:d.z,hx:(dr-dl)/2,hz:wallT/2,minY:d.headerTop,h:platH+wallH});
    for(const x of [d.left-s.jambM/2,d.right+s.jambM/2]) {
      const jamb=new THREE.Mesh(roundedBox(s.jambM,d.headerTop-platH,wallT+.04,.008,2),wood);
      jamb.position.set(x,(platH+d.headerTop)/2,d.z);jamb.castShadow=true;jamb.receiveShadow=true;root.add(jamb);
      blockers.push({cx:x,cz:d.z,hx:s.jambM/2,hz:(wallT+.04)/2,minY:platH,h:d.headerTop});
    }
    const lintel=new THREE.Mesh(roundedBox(s.widthM,s.lintelM,wallT+.04,.008,2),wood);
    lintel.position.set(s.centerXM,d.top+s.lintelM/2,d.z);lintel.castShadow=true;lintel.receiveShadow=true;root.add(lintel);
    blockers.push({cx:s.centerXM,cz:d.z,hx:s.widthM/2,hz:(wallT+.04)/2,minY:d.top,h:d.headerTop});
    if(s.sillM>0) {
      const sill=new THREE.Mesh(roundedBox(s.widthM,s.sillM,d.surface.hz*2,.008,2),wood);
      sill.position.set(s.centerXM,platH+s.sillM/2,d.z);sill.receiveShadow=true;root.add(sill);walkSurfaces.push(d.surface);
    }
    const pivot=new THREE.Group(),leaf=new THREE.Mesh(roundedBox(d.leafWidth,s.heightM,s.leafThicknessM,.01,2),wood);
    leaf.position.set(d.leafWidth/2,s.heightM/2,0);leaf.castShadow=true;leaf.receiveShadow=true;pivot.add(leaf);
    pivot.position.set(d.hingeX,d.bottom,d.z);pivot.rotation.y=doorOpen?Math.PI/2:0;root.add(pivot);
    blockers.push({cx:doorOpen?d.hingeX:s.centerXM,cz:doorOpen?d.z-d.leafWidth/2:d.z,hx:d.leafWidth/2,hz:s.leafThicknessM/2,
      minY:d.bottom,h:d.top,rot:doorOpen?Math.PI/2:0});
  } else if (back === 'door') {
    if (gatehouse) {
      // 门屋后檐:次梢间砌墙封死(正门是「一色水磨群墙」,随 wallMaterial),
      // 只留当心间与中柱缝门洞对位通行。
      for (let i = 1; i < colXs.length; i++) {
        if (i - 1 === centerBay) continue;
        addWall(colXs[i - 1], rowsZ[1], colXs[i], rowsZ[1], wallH, platH);
      }
    } else {
    const span = colXs[colXs.length - 1] - colXs[0] - 2 * colR;
    const gw = span / 4;
    const bx0 = colXs[0] + colR;
    const by = platH + (wallH - 0.1) / 2 + 0.05;
    for (let k = 0; k < 4; k++) {
      const g = makeGeshan(gw - 0.01, wallH - 0.1, wood, paper, seed + 40 + k, opts.lattice);
      if (k === 0 || k === 3) {
        g.position.set(bx0 + gw * (k + 0.5), by, rowsZ[1]);
        root.add(g);
      } else if (k === 1) hingedPanel(g, gw - 0.01, bx0 + gw, 1, by, rowsZ[1], -(doorOpen ? 1.62 : 0.3));
      else hingedPanel(g, gw - 0.01, bx0 + gw * 3, -1, by, rowsZ[1], -(doorOpen ? 1.62 : 0.3));
    }
    blockers.push({ cx: colXs[0] + colR + gw * 0.5, cz: rowsZ[1], hx: gw * 0.5, hz: 0.06, h: platH + wallH });
    blockers.push({ cx: colXs[colXs.length - 1] - colR - gw * 0.5, cz: rowsZ[1], hx: gw * 0.5, hz: 0.06, h: platH + wallH });
    }
  }
  if (sides === 'wall') {
    if (!isYingshan) {
      addWall(colXs[0], rowsZ[0], colXs[0], rowsZ[1], wallH, platH);
      addWall(colXs[colXs.length - 1], rowsZ[0], colXs[colXs.length - 1], rowsZ[1], wallH, platH);
    }
  }
  if (front === 'wall') {
    addWall(colXs[0], rowsZ[0], colXs[colXs.length - 1], rowsZ[0], wallH, platH);
  } else if (front === 'window') {
    addWindowWall(colXs[0],rowsZ[0],colXs[colXs.length-1],rowsZ[0]);
  } else if (front === 'door') {
    // 每间四扇格扇;当心间为门(可开),次间为槛窗(下半粉墙)。
    // 门屋(gatehouse):前檐当心间敞开,门退到中柱缝——这里只装次梢间的槛窗。
    for (let i = 1; i < colXs.length; i++) {
      const x0 = colXs[i - 1] + colR;
      const x1 = colXs[i] - colR;
      const span = x1 - x0;
      const isCenter = i - 1 === centerBay;
      const n = 4;
      const gw = span / n;
      const z = rowsZ[0];
      if (isCenter && gatehouse) continue;
      if (isCenter) {
        const py = platH + (wallH - 0.1) / 2 + 0.05;
        for (let k = 0; k < n; k++) {
          const g = makeGeshan(gw - 0.01, wallH - 0.1, wood, paper, seed + k + i * 10, opts.lattice);
          if (k === 0 || k === 3) {
            g.position.set(x0 + gw * (k + 0.5), py, z);
            root.add(g);
          } else if (k === 1) {
            // 左内扇:铰链在左邻扇的分界,向外推开贴到左扇上。
            hingedPanel(g, gw - 0.01, x0 + gw, 1, py, z, doorOpen ? 1.62 : 0.3);
          } else {
            hingedPanel(g, gw - 0.01, x0 + gw * 3, -1, py, z, doorOpen ? 1.62 : 0.3);
          }
        }
        // 门槛。
        const sill = new THREE.Mesh(roundedBox(span, 0.1, 0.16, 0.01, 2), wood);
        sill.position.set((x0 + x1) / 2, platH + 0.05, z);
        root.add(sill);
        // 门洞两侧留碰撞,中间可过。
        blockers.push({ cx: x0 + gw * 0.5, cz: z, hx: gw * 0.5, hz: 0.06, h: platH + wallH });
        blockers.push({ cx: x1 - gw * 0.5, cz: z, hx: gw * 0.5, hz: 0.06, h: platH + wallH });
      } else {
        const sillH = wallH * 0.36;
        const w = new THREE.Mesh(roundedBox(span, sillH, wallT, 0.01, 2), plaster);
        w.position.set((x0 + x1) / 2, platH + sillH / 2, z);
        w.castShadow = true;
        w.receiveShadow = true;
        root.add(w);
        const cap = new THREE.Mesh(roundedBox(span, 0.08, wallT + 0.06, 0.01, 2), wood);
        cap.position.set((x0 + x1) / 2, platH + sillH + 0.04, z);
        root.add(cap);
        /* 单子 AS2 · 按角色分档(AQ-b 之前的静态分配)。
         *
         * 门屋的当心间是空的门道,玩家进园必从那儿穿过去,**贴着走的是门道两旁
         * 这两间的内侧各两扇**——站距 0.5~1m,绦环板在画面里 ≥100px。这 4 扇给
         * 顶点位移的几何版(一扇 ≈4k 三角);其余 32 扇(含本间外侧两扇、全园其他
         * 建筑)给贴图版,共用那一张四格图集。
         *
         * 分档条件写成"离门道最近的两扇",不是写死扇号:开间数或每间扇数一改,
         * 分到的仍然是门道旁边那几扇。**AQ-b 会把它换成按距离分档**,所以两种
         * 表示除了 mesh 以外完全同构(同一条带、同一个落位)。 */
        const nearGate: TiaohuanMode[] = [];
        for (let k = 0; k < n; k++) {
          const nearDoor = gatehouse
            && ((i - 1 === centerBay - 1 && k >= n - 2) || (i - 1 === centerBay + 1 && k <= 1));
          nearGate.push(nearDoor ? 'geo' : 'tex');
        }
        for (let k = 0; k < n; k++) {
          const g = makeGeshan(gw - 0.01, wallH - sillH - 0.16, wood, paper, seed + k + i * 10, opts.lattice, nearGate[k]);
          g.position.set(x0 + gw * (k + 0.5), platH + sillH + 0.08 + (wallH - sillH - 0.16) / 2, z);
          root.add(g);
        }
        blockers.push({ cx: (x0 + x1) / 2, cz: z, hx: span / 2, hz: 0.1, h: platH + wallH });
      }
    }
  }

  /* ---- 门屋:中柱缝的墙与板门 -------------------------------------- */
  if (gatehouse) {
    // 中柱缝(z=0)次梢间砌墙封死,只留当心间门洞——从门外看进去,
    // 读到的是一堵横墙上的门口,不是一间屋的内景。
    for (let i = 1; i < colXs.length; i++) {
      if (i - 1 === centerBay) continue;
      addWall(colXs[i - 1], 0, colXs[i], 0, wallH, platH);
    }
    // 板门门口:边梃、上槛、走马板、门槛,两扇板门向外全开、贴立门道两侧。
    // 尺寸无出处(见 project:gatehouse-zhongzhu 的 provenance 注)。
    const jambW = 0.09;
    const doorH = 2.55;
    const sillH2 = 0.08;
    const cx0 = colXs[centerBay] + colR; // 门洞西界(柱内侧)
    const cx1 = colXs[centerBay + 1] - colR; // 门洞东界
    const openW = cx1 - cx0 - jambW * 2;
    const headTop = platH + sillH2 + doorH + 0.12; // 上槛顶
    for (const x of [cx0 + jambW / 2, cx1 - jambW / 2]) {
      const jamb = new THREE.Mesh(roundedBox(jambW, headTop - platH, wallT + 0.04, 0.008, 2), wood);
      jamb.position.set(x, (platH + headTop) / 2, 0);
      jamb.castShadow = true;
      jamb.receiveShadow = true;
      root.add(jamb);
      blockers.push({ cx: x, cz: 0, hx: jambW / 2, hz: (wallT + 0.04) / 2, minY: platH, h: headTop });
    }
    const lintel = new THREE.Mesh(roundedBox(openW + jambW * 2, 0.12, wallT + 0.04, 0.008, 2), wood);
    lintel.position.set(0, headTop - 0.06, 0);
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    root.add(lintel);
    // 走马板:上槛以上填到脊枋底。
    const fillH = midColTop - headTop;
    if (fillH > 0.05) {
      const fill = new THREE.Mesh(roundedBox(openW + jambW * 2, fillH, 0.05, 0.008, 2), wood);
      fill.position.set(0, headTop + fillH / 2, 0);
      fill.castShadow = true;
      fill.receiveShadow = true;
      root.add(fill);
    }
    blockers.push({ cx: 0, cz: 0, hx: (openW + jambW * 2) / 2, hz: (wallT + 0.04) / 2, minY: platH + sillH2 + doorH, h: midColTop });
    // 门槛:低矮,只作视觉(不进碰撞,不绊脚)。
    const sill2 = new THREE.Mesh(roundedBox(openW, sillH2, 0.16, 0.01, 2), wood);
    sill2.position.set(0, platH + sillH2 / 2, 0);
    sill2.receiveShadow = true;
    root.add(sill2);
    // 两扇板门:素板加三条穿带,不上朱漆不装门钉(「並無朱粉塗飾」)。
    const gw2 = openW / 2 - 0.01;
    const mkLeaf = () => {
      const leaf = new THREE.Group();
      const panel = new THREE.Mesh(roundedBox(gw2, doorH, 0.055, 0.008, 2), wood);
      leaf.add(panel);
      for (const ty of [-0.3, 0, 0.3]) {
        const batten = new THREE.Mesh(roundedBox(gw2 - 0.06, 0.1, 0.03, 0.006, 1), wood);
        batten.position.set(0, ty * doorH, -0.04);
        leaf.add(batten);
      }
      leaf.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      return leaf;
    };
    const openAng = doorOpen ? Math.PI / 2 - 0.06 : 0.04;
    hingedPanel(mkLeaf(), gw2, cx0 + jambW, 1, platH + sillH2 + doorH / 2, 0, openAng);
    hingedPanel(mkLeaf(), gw2, cx1 - jambW, -1, platH + sillH2 + doorH / 2, 0, openAng);
    if (doorOpen) {
      // 全开的门扇贴立在门道两侧,各是一条顺 Z 的薄阻挡,不占中路。
      for (const sx of [-1, 1]) {
        blockers.push({ cx: sx * (Math.abs(cx0) - jambW), cz: gw2 / 2, hx: 0.04, hz: gw2 / 2, minY: platH + sillH2, h: platH + sillH2 + doorH });
      }
    } else {
      blockers.push({ cx: 0, cz: 0, hx: openW / 2, hz: 0.04, minY: platH + sillH2, h: platH + sillH2 + doorH });
    }
  }

  /* ---- 美人靠 ------------------------------------------------------ */
  if (opts.railing) {
    const railH = 0.48;
    const seatH = 0.42;
    const addRail = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.Group();
      const seat = new THREE.Mesh(roundedBox(len, 0.05, 0.36, 0.01, 2), wood);
      seat.position.y = platH + seatH;
      const back = new THREE.Mesh(roundedBox(len, 0.05, 0.05, 0.01, 2), wood);
      back.position.set(0, platH + seatH + railH, -0.16);
      back.rotation.x = -0.18;
      g.add(seat, back);
      const n = Math.max(3, Math.round(len / 0.32));
      for (let i = 0; i <= n; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, railH, 0.035), wood);
        b.position.set(-len / 2 + (len * i) / n, platH + seatH + railH / 2, -0.12);
        b.rotation.x = -0.18;
        g.add(b);
      }
      g.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      g.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      root.add(g);
      blockers.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: len / 2, hz: 0.18, h: platH + seatH + railH, rot: -Math.atan2(z1 - z0, x1 - x0) });
    };
    // 亭:三面靠,正面留门;廊:后面一条。
    if (isTing) {
      const sides = opts.railingSides ?? ['e', 'w', 'n'];
      if (sides.includes('e')) addRail(colXs[colXs.length - 1], rowsZ[0], colXs[colXs.length - 1], rowsZ[1]);
      if (sides.includes('w')) addRail(colXs[0], rowsZ[1], colXs[0], rowsZ[0]);
      if (sides.includes('n')) addRail(colXs[0], rowsZ[1], colXs[colXs.length - 1], rowsZ[1]);
      if (sides.includes('s')) addRail(colXs[colXs.length - 1], rowsZ[0], colXs[0], rowsZ[0]);
    } else {
      addRail(colXs[0], rowsZ[1], colXs[colXs.length - 1], rowsZ[1]);
    }
  }

  /* ---- 匾额 ------------------------------------------------------- */
  if (opts.plaque) {
    // 匾宽按当心间净宽算(单子 AG4 返工),不是字数的函数——旧公式
    // opts.plaque.length*0.45 让「大观园」与「潇湘馆」(都三字)都算出 1.35m,
    // 与开间大小无关,用户看得分毫不差。当心间净宽用 centerBay/centerBay+1
    // 这对跨零的柱缝(门屋分心造那段已算过的同一对索引);比例 0.62 落在
    // 常规 0.6~0.75 区间(取证见 shots/zhengmen-closeup),记 provenance.art。
    const bayW = colXs[centerBay + 1] - colXs[centerBay];
    const pw = bayW * 0.62;
    fr.provenance.art.push({
      id: 'project:plaque-width-bay',
      name: '匾额宽度按开间',
      method: 'artistic_choice',
      note: `旧公式 pw=字数×0.45,「大观园」「潇湘馆」都三字→都是 1.35m,不随开间变;` +
        `改成当心间净宽 ${bayW.toFixed(3)}m × 0.62 = ${pw.toFixed(3)}m,0.62 落在常规` +
        `0.6~0.75 区间(实测:当心间 3.276m 时旧值 1.35m ÷ 3.276 = 0.41,明显偏窄)。` +
        `字数只决定字有多大,不决定板有多宽(makePlaque(text,width) 签名不变)。`,
    });
    const pl = makePlaque(opts.plaque, pw);
    // 挂在铺作外皮之前、橑檐枋之下,人从院子里一眼看到;略向前俯 8°。
    const ph = pw * 0.36;
    const zFront = rowsZ[0] + (m.puzuoH > 0 ? m.puzuoOut + 0.22 : 0.16);
    // 竖向落在铺作层的中段(没铺作就贴阑额下),别钻进屋面板。
    const yMid = m.puzuoH > 0 ? platH + colH + pupai + m.puzuoH * 0.5 : platH + colH - m.lan.w - ph / 2 - 0.05;
    pl.position.set(0, yMid, zFront);
    pl.rotation.x = 0.14;
    root.add(pl);
  }

  const merged = mergeByMaterial(root);
  merged.name = 'Building';
  if(opts.backDoor||opts.steps)fr.provenance.art.push({id:'project:building-access',name:'小门与踏步施工输入',method:'artistic_choice',
    note:JSON.stringify({backDoor:opts.backDoor,steps:opts.steps,platformMarginM:opts.platformMarginM})});
  merged.userData.construction = { paramSet: 'paramSet' in fr ? fr.paramSet : 'fashi',
    spec: opts.spec, dimensions: fr.m, provenance: fr.provenance, surfaces: {front,sides,back},access:{rearDoor,walkSurfaces,options:{backDoor:opts.backDoor,steps:opts.steps}} };

  return {
    kind: 'building',
    root: merged,
    frame: fr,
    platform: { hx: platHX, hz: platHZ, y: platH },
    walkSurfaces,
    blockers,
    groundRadius: Math.max(platHX, platHZ) * 2.4,
  };
}

/* ------------------------------------------------------------------ */
/* 预设与登记                                                          */
/* ------------------------------------------------------------------ */

/** 沁芳亭:四角攒尖,六等材,一间见方。 */
export function tingSpec(): BuildingOptions {
  return {
    spec: {
      cai: { grade: 7 },
      hall: '余屋',
      bayWidthsFen: [300],
      rafters: 2,
      jiaFen: 150,
      puzuo: { puzuo: 4, jumpFen: 26 },
      roofType: '攒尖',
      roofClass: '筒瓦厅堂',
      qiqiaoFen: 45,
      columnHeightFen: 270,
      columnDiameterFen: 22,
      rafterDiaFen: 6.5,
    },
    // 匾额文字只从 plan.json 读(missing 99-26):预设不写字面量。
    plaque: plaqueFromPlan('qinfang_ting_qiao.pavilion'),
    railing: true,
    railingSides: ['e', 'w'],
    platformH: 0.4,
  };
}

/** 潇湘馆正房:小三间歇山,六等材。 */
export function tangSpec(): BuildingOptions {
  return {
    spec: {
      cai: { grade: 6 },
      hall: '厅堂',
      bayWidthsFen: [230, 270, 230],
      rafters: 4,
      jiaFen: 120,
      puzuo: { puzuo: 4, jumpFen: 26 },
      roofType: '歇山',
      roofClass: '筒瓦厅堂',
      qiqiaoFen: 40,
      columnHeightFen: 250,
      columnDiameterFen: 26,
      rafterDiaFen: 7,
    },
    // 匾额有意留空。第十八回元春「『有鳳來儀』賜名曰『瀟湘館』」——「有凤来仪」是
    // 第十七回试才的拟稿,已被替换;而正门上挂着的「大观园」出自同一句话,即园子已
    // 站在赐名之后,此处再挂拟稿就是同一园子里两个时刻并存。院名匾应挂院门(月洞门)
    // 上,见 knowledge/docs/qingshi/07-honglou.md 07-71 与 docs/ROADMAP.md §PQ-7。
    front: 'door',
    sides: 'wall',
    lattice: 'ice', // 格心冰裂纹(墙垣生成器,PQ-2);纹样选择无原文依据,是清幽向的艺术选择
    platformH: 0.45,
  };
}

/** 廊:一间宽两椽,硬山无墙,后有美人靠。 */
export function langSpec(): BuildingOptions {
  return {
    spec: {
      cai: { grade: 8 },
      hall: '余屋',
      bayWidthsFen: [280, 280],
      rafters: 2,
      jiaFen: 110,
      puzuo: null,
      roofType: '硬山',
      roofClass: '筒瓦廊屋',
      columnHeightFen: 260,
      columnDiameterFen: 20,
      rafterDiaFen: 6,
    },
    front: 'open',
    sides: 'open',
    railing: true,
    platformH: 0.3,
    chuji: 0.3,
  };
}

/**
 * 正门:第十七回"正门五间,上面桶瓦泥鳅脊;那门栏窗槅皆是细雕新鲜花样,并无朱粉涂饰;
 * 一色水磨群墙"。五间硬山门屋(中柱造):前后檐当心间敞开,板门装在中柱缝;
 * 进深压到两椽(门屋进深远小于面阔),白石高台基前后各出垂带踏跺。
 * 不上朱粉;金只许在匾额字上(ART_DIRECTION §9)。
 */
export function menSpec(): BuildingOptions {
  return {
    spec: {
      cai: { grade: 7 },
      hall: '厅堂',
      bayWidthsFen: [230, 250, 300, 250, 230],
      // 压浅进深:两椽 220 分 ≈ 2.4m,对五间面阔 1260 分 ≈ 13.8m。
      // 椽架数是 spec 输入不走规则表;此值是"门屋"的艺术判断,记 provenance.art。
      rafters: 2,
      jiaFen: 110,
      // 单子 V-V3:正门走清式五踩单翘单昂平身科(tiers.md:正门/牌坊五踩)。
      // 攒的高宽比由规则链定死(攒顶=挑檐枋顶 10.8 斗口 / 挑檐桁中 6 斗口=1.8),
      // 跳距配合它取 20.8 分,使 derivePuzuo 的包络(75/2j)与攒同比例——
      // 装配端按 puzuoOut 定斗口,高度即自动吻合(留痕见 provenance 的
      // project:bracket-set-fit)。跳距本身是 spec 输入,不走规则表。
      puzuo: { puzuo: 5, jumpFen: 20.8 },
      roofType: '硬山',
      roofClass: '筒瓦厅堂',
      columnHeightFen: 300,
      columnDiameterFen: 28,
      rafterDiaFen: 7,
      // 「上面桶瓦泥鰍脊」:方向内证可定(07-76①)——「不落富丽俗套」排除高正脊
      // 加正吻。具体做法两读并存(07-76②),这里选卷棚(省正脊),artChoice 见下。
      ridgeStyle: 'rolled',
    },
    // 匾额文字只从 plan.json 读(missing 99-26):正门挂「大观园」(07-37 园之总名;
    // 挂正门是艺术摆放,见 ROADMAP §PQ-7)。
    plaque: plaqueFromPlan('zhengmen.main-gate'),
    front: 'door',
    back: 'door',
    sides: 'wall',
    gatehouse: true,
    bracketSet: { cai: 5 }, // Tier A 真斗拱(单子 V);五踩单翘单昂平身科
    // 07-76③:「细雕新鲜花样」原著没写死具体纹样;万字不到头是最标准的那个,
    // 与「新鲜」相反,换成灯笼锦(artChoice,见 buildBuilding 的 provenance.art)。
    lattice: 'lantern',
    wallMaterial: 'stone',
    plinthMaterial: 'whiteStone', // 「下面白石台磯」——白石,不是青石
    platformH: 0.75, // 规则表无门屋台基高,观感取值(记 provenance.art)
    platformMarginM: 0.9,
    steps: {
      front: { widthM: 3.0, treadM: 0.3, maxRiserM: 0.15 },
      back: { widthM: 3.0, treadM: 0.3, maxRiserM: 0.15 },
    },
    chuji: 0.45,
  };
}

const PRESETS: Record<string, () => BuildingOptions> = {
  default: tangSpec,
  ting: tingSpec,
  tang: tangSpec,
  lang: langSpec,
  men: menSpec,
};

registerPart('building', (variant) => {
  const mk = PRESETS[variant];
  if (!mk) throw new Error(`未登记建筑预设 ${variant}，不可静默替换为潇湘馆`);
  return buildBuilding(mk());
});
