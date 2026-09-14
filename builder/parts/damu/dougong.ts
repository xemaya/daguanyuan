/**
 * 清式斗拱分件(paramSet "qing",components.rules.json 的 C-dg-* 十八叶)。
 * 只做清式这一支;宋式 C-pz-* 等清式验完再铺(单子 V「三条最容易搞错的」#2)。
 *
 * 尺寸全部来自规则表,代码里没有营造数字字面量(D-09):
 *   04-03  卷二十八分件斗口倍数(V1 已结构化成扁平键)
 *   01-18  同表的 table 形态(桁碗长随踩制 lengthByCai)
 *   01-09  平板枋宽 3 高 2;01-10 挑檐枋/正心枋/拽枋断面
 *   04-08  桁碗高=桁径/3(hengwanHeightDivisor)
 *   01-04  攒当 11 斗口(单件出库时通长枋的展示长度)
 *   01-19  尺换算(挑檐桁径「正心桁径−2 寸」的 2 寸是绝对尺寸,要折米)
 *
 * 表里没有的数不编,三处缺口各带 missing(取用即抛,几何端用推导值并记 art):
 *   99-27 昂/蚂蚱头/撑头木长度 —— 按踩数装配包络推(每拽架 3 斗口 [01-07])
 *   99-29 清式栱卷杀瓣数瓣长 —— 瓣数借奉先殿论文转述「万三瓜四厢五」旁证,
 *          是旁证不是原文;瓣长与插值方式为艺术选择
 *   99-30 升斗(十八斗/三才升/槽升)耳腰底分段 —— 按大斗分段比例缩
 * 斗底欹、桁碗槽、昂嘴、蚂蚱头的曲线:原文只给分段尺寸,插值是艺术选择,记 art。
 *
 * 几何按 geometry.family 分族(斗/栱/昂/枋,桁碗单给)。每件返回
 * BufferGeometry(米,原点在各件底心,长沿 X),装配端 applyMatrix4 后
 * mergeGeometries;材质走 materials.ts 的 memo(woodMaterial()),全攒同一个
 * 材质实例,才能被 mergeByMaterial 合进一个 draw call(P-04)。
 */
import * as THREE from 'three';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { woodMaterial } from '@builder/parts/materials';
import { RuleBook } from '@builder/derive/rules';
import { qingOptions } from '@builder/derive/qing/profiles';

/** 清式十八叶(components.rules.json 里 paramSet=qing 且带 geometry 的构件)。 */
export const QING_LEAF_IDS = [
  'lu', 'qiao', 'ang', 'shua', 'cheng', 'hengwan',
  'zxg', 'zxw', 'dcg', 'dcw', 'xiang',
  'sbd', 'scs', 'cs',
  'zxf', 'tyf', 'zf', 'pbf',
] as const;
export type QingLeafId = (typeof QING_LEAF_IDS)[number];

const LEAF_COMPONENT: Record<QingLeafId, string> = {
  lu: 'C-dg-lu', qiao: 'C-dg-qiao', ang: 'C-dg-ang', shua: 'C-dg-shua',
  cheng: 'C-dg-cheng', hengwan: 'C-dg-hengwan',
  zxg: 'C-dg-zxg', zxw: 'C-dg-zxw', dcg: 'C-dg-dcg', dcw: 'C-dg-dcw', xiang: 'C-dg-xiang',
  sbd: 'C-dg-sbd', scs: 'C-dg-scs', cs: 'C-dg-cs',
  zxf: 'C-dg-zxf', tyf: 'C-dg-tyf', zf: 'C-dg-zf', pbf: 'C-dg-pbf',
};

const LEAF_NAME: Record<QingLeafId, string> = {
  lu: '大斗(坐斗)', qiao: '单翘', ang: '昂(头昂)', shua: '耍头(蚂蚱头)',
  cheng: '撑头木', hengwan: '桁碗',
  zxg: '正心瓜栱', zxw: '正心万栱', dcg: '单才瓜栱', dcw: '单才万栱', xiang: '厢栱',
  sbd: '十八斗', scs: '三才升', cs: '槽升',
  zxf: '正心枋', tyf: '挑檐枋', zf: '拽枋', pbf: '平板枋',
};

/** 斗拱件的 RuleBook:qing 预设 + 01-19 官式尺(Tier A 是官式大式,尺档显式选,记 inference)。 */
export function qingDougongBook(): RuleBook {
  return RuleBook.create('qing', qingOptions({ choices: { '01-19': 'beifang' } }));
}

/* ------------------------------------------------------------------ */
/* 尺寸包:从规则表一次性取齐(全部斗口)                                  */
/* ------------------------------------------------------------------ */

export interface QingDougongDims {
  zuCaiH: number;
  danCaiGongH: number;
  gongW: number;
  zhengxinGongW: number;
  dadou: { L: number; W: number; H: number; kouH: number; yaoH: number; diH: number; diW: number };
  danqiaoL: number;
  chongqiaoL: number;
  gongL: { zxg: number; zxw: number; dcg: number; dcw: number; xiang: number };
  angQianGao: number;
  angZhongGao: number;
  mazhatouH: number;
  chengshantouH: number;
  sbd: { L: number; W: number; H: number };
  scs: { L: number; W: number; H: number };
  cs: { L: number; W: number; H: number };
  pingbanW: number;
  pingbanH: number;
  /** 正心枋厚 = 1 斗口 + 包掩 0.24 [01-10]。 */
  zhengxinFangH: number;
  zhengxinFangT: number;
  tiaoyanFangH: number;
  tiaoyanFangT: number;
  cuanDang: number;
  zhengxinHengD: number;
  hengwanDiv: number;
  /** 桁碗长随踩制 [01-18 lengthByCai]。 */
  hengwanLByCai: Record<string, number>;
}

export function qingDougongDims(book: RuleBook): QingDougongDims {
  const n = (id: string, k: string) => book.num(id, k);
  const row18 = book.table<{ part: string; lengthByCai?: Record<string, number> }>('01-18')
    .find((r) => r.part === '桁椀');
  if (!row18?.lengthByCai) throw new Error('01-18 桁椀行缺 lengthByCai(V1 结构化产物)');
  return {
    zuCaiH: n('04-03', 'zuCaiHeightDk'),
    danCaiGongH: n('04-03', 'danCaiGongHeightDk'),
    gongW: n('04-03', 'gongWidthDk'),
    zhengxinGongW: n('04-03', 'zhengxinGongWidthDk'),
    dadou: {
      L: n('04-03', 'dadouLengthDk'), W: n('04-03', 'dadouWidthDk'), H: n('04-03', 'dadouHeightDk'),
      kouH: n('04-03', 'dadouKouHeightDk'), yaoH: n('04-03', 'dadouYaoHeightDk'),
      diH: n('04-03', 'dadouDiHeightDk'), diW: n('04-03', 'dadouDiWidthDk'),
    },
    danqiaoL: n('04-03', 'danqiaoLengthDk'),
    chongqiaoL: n('04-03', 'chongqiaoLengthDk'),
    gongL: {
      zxg: n('04-03', 'zhengxinGuagongLengthDk'), zxw: n('04-03', 'zhengxinWangongLengthDk'),
      dcg: n('04-03', 'dancaiGuagongLengthDk'), dcw: n('04-03', 'dancaiWangongLengthDk'),
      xiang: n('04-03', 'xianggongLengthDk'),
    },
    angQianGao: n('04-03', 'angQianGaoDk'),
    angZhongGao: n('04-03', 'angZhongGaoDk'),
    mazhatouH: n('04-03', 'mazhatouHeightDk'),
    chengshantouH: n('04-03', 'chengshantouHeightDk'),
    sbd: { L: n('04-03', 'shibadouLengthDk'), W: n('04-03', 'shibadouWidthDk'), H: n('04-03', 'shibadouHeightDk') },
    scs: { L: n('04-03', 'sancaishengLengthDk'), W: n('04-03', 'sancaishengWidthDk'), H: n('04-03', 'sancaishengHeightDk') },
    cs: { L: n('04-03', 'caoshengLengthDk'), W: n('04-03', 'caoshengWidthDk'), H: n('04-03', 'caoshengHeightDk') },
    pingbanW: n('01-09', 'pingbanFangWDk'),
    pingbanH: n('01-09', 'pingbanFangHDk'),
    zhengxinFangH: n('01-10', 'zhengxinFangHDk'),
    zhengxinFangT: n('01-10', 'zhengxinFangTDk') + n('01-10', 'zhengxinFangBaoyanDk'),
    tiaoyanFangH: n('01-10', 'tiaoyanFangHDk'),
    tiaoyanFangT: n('01-10', 'tiaoyanFangTDk'),
    cuanDang: n('01-04', 'cuanDangDk'),
    zhengxinHengD: n('01-10', 'zhengxinHengDk'),
    hengwanDiv: n('04-08', 'hengwanHeightDivisor'),
    hengwanLByCai: row18.lengthByCai,
  };
}

/**
 * 挑檐桁径(斗口)= 正心桁径 4dk − 2 寸 [04-08]。
 * 「−2 寸」是绝对尺寸,跨等第不自洽(01-09 同病),按 01-19 选中尺档折米再折回斗口。
 */
export function tiaoyanHengDiaDk(book: RuleBook, d: QingDougongDims, dkM: number): number {
  const chiM = book.choice<number>('01-19') / 100;
  return d.zhengxinHengD - (0.2 * chiM) / dkM;
}

/* ------------------------------------------------------------------ */
/* 几何族(斗口单位,原点底心,长沿 X,厚/宽沿 Z)                          */
/* ------------------------------------------------------------------ */

function boxDk(w: number, h: number, d: number, cx: number, cy: number, cz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  return g;
}

/** 四面直线收分的台段(斗底欹;线性收分是插值选择,调用方记 art)。
 *  底欹+腰合一:taperEndY 以下从 bottomScale 收到 1,以上直身——少一圈顶点。 */
function taperedBoxDk(w: number, h: number, d: number, bottomScale: number, cy: number, taperEndY?: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const tEnd = taperEndY === undefined ? h : taperEndY;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + h / 2;
    const s = y >= tEnd ? 1 : bottomScale + (1 - bottomScale) * (y / tEnd);
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i), pos.getZ(i) * s);
  }
  g.computeVertexNormals();
  g.translate(0, cy, 0);
  return g;
}

interface DouProfile {
  L: number; W: number; H: number;
  /** 底高 / 腰高 / 耳(斗口)高,三段之和 = H。 */
  diH: number; yaoH: number; earH: number;
  /** 斗底宽 / 顶宽(大斗 2.2/3)。 */
  diScale: number;
  /** 顶面斗槽:axis 为槽的长轴方向,width 为槽宽。 */
  slots: { axis: 'x' | 'z'; width: number }[];
}

function douGeometryDk(p: DouProfile): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  // 底欹与腰合一(一段完成收分+直身),耳段按斗槽留方块。
  geos.push(taperedBoxDk(p.L, p.diH + p.yaoH, p.W, p.diScale, (p.diH + p.yaoH) / 2, p.diH));
  const earY = p.diH + p.yaoH;
  const sx = p.slots.find((s) => s.axis === 'z')?.width ?? 0; // 顺跳槽(z 向长)占 x 向宽
  const sz = p.slots.find((s) => s.axis === 'x')?.width ?? 0; // 横栱槽(x 向长)占 z 向宽
  const ex = (p.L - sx) / 2; // 槽两侧各剩的 x 向宽
  const ez = (p.W - sz) / 2;
  if (sx > 0 && sz > 0) {
    // 十字槽:剩四角。
    for (const ax of [-1, 1]) for (const az of [-1, 1]) {
      geos.push(boxDk(ex, p.earH, ez, ax * (sx / 2 + ex / 2), earY + p.earH / 2, az * (sz / 2 + ez / 2)));
    }
  } else if (sz > 0) {
    for (const az of [-1, 1]) geos.push(boxDk(p.L, p.earH, ez, 0, earY + p.earH / 2, az * (sz / 2 + ez / 2)));
  } else if (sx > 0) {
    for (const ax of [-1, 1]) geos.push(boxDk(ex, p.earH, p.W, ax * (sx / 2 + ex / 2), earY + p.earH / 2, 0));
  } else {
    geos.push(boxDk(p.L, p.earH, p.W, 0, earY + p.earH / 2, 0));
  }
  return mergeGeos(geos);
}

interface GongProfile {
  L: number; W: number; H: number;
  /** 卷杀瓣数与每瓣长(斗口);清式原文无(missing 99-29),调用方给并记 art。 */
  lobes: number;
  lobeLen: number;
  /** 栱端头剩余高度(斗口)。 */
  tipH: number;
}

/** 栱:侧面轮廓两端分瓣卷杀(台阶式分段,不用曲线方程),沿厚度挤出。 */
function gongGeometryDk(g: GongProfile): THREE.BufferGeometry {
  const half = g.L / 2;
  const region = Math.min(g.lobes * g.lobeLen, half);
  const s = new THREE.Shape();
  s.moveTo(-half, g.H);
  s.lineTo(half, g.H);
  s.lineTo(half, g.tipH);
  // 右端自外向内的下折阶:每瓣先平后折。
  for (let i = 1; i <= g.lobes; i++) {
    const x = half - (region * i) / g.lobes;
    s.lineTo(x, g.tipH * (1 - (i - 1) / g.lobes));
    s.lineTo(x, g.tipH * (1 - i / g.lobes));
  }
  s.lineTo(-half + region, 0);
  // 左端自内向外的上行阶:每瓣先折后平。
  for (let i = g.lobes; i >= 1; i--) {
    const x = -half + (region * i) / g.lobes;
    s.lineTo(x, g.tipH * (1 - (i - 1) / g.lobes));
    s.lineTo(x - region / g.lobes, g.tipH * (1 - (i - 1) / g.lobes));
  }
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: g.W, bevelEnabled: false });
  geo.translate(0, 0, -g.W / 2);
  return geo;
}

interface AngProfile {
  /** 正心到前端(昂嘴根)水平长 / 后尾长 / 昂嘴长(斗口)。 */
  headL: number; tailL: number; beakLen: number;
  W: number;
  /** 中高(正心处断面高)/ 前高(昂嘴根处断面高)[04-03]。 */
  midH: number; frontH: number;
  /** 嘴尖高(艺术选择)。 */
  beakTipH: number;
}

/** 昂(清式假昂):底平,顶面自正心向外出斜升至前高,前端下杀成嘴。 */
function angGeometryDk(a: AngProfile): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-a.tailL, 0);
  s.lineTo(a.headL + a.beakLen, 0);
  s.lineTo(a.headL + a.beakLen, a.beakTipH);
  s.lineTo(a.headL, a.frontH);
  s.lineTo(0, a.midH);
  s.lineTo(-a.tailL, a.midH);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: a.W, bevelEnabled: false });
  geo.translate(0, 0, -a.W / 2);
  return geo;
}

/** 耍头(蚂蚱头):身断面同足材,前端上面两级下杀、下面斜杀成头(头形为艺术选择)。 */
function shuatouGeometryDk(p: { L: number; W: number; H: number; headLen: number }): THREE.BufferGeometry {
  const half = p.L / 2;
  const h0 = p.headLen;
  const s = new THREE.Shape();
  s.moveTo(-half, 0);
  s.lineTo(half - h0 * 0.4, 0);
  s.lineTo(half, p.H * 0.3); // 下棱斜杀
  s.lineTo(half, p.H * 0.55);
  s.lineTo(half - h0 * 0.55, p.H * 0.55); // 蚂蚱头凹阶
  s.lineTo(half - h0 * 0.55, p.H * 0.8);
  s.lineTo(half - h0, p.H * 0.8);
  s.lineTo(half - h0, p.H);
  s.lineTo(-half, p.H);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: p.W, bevelEnabled: false });
  geo.translate(0, 0, -p.W / 2);
  return geo;
}

/** 桁碗:顶面弧槽承桁;槽深=桁径/3 是规则 [04-08],槽弧线插值为艺术选择。seatX=槽心沿长向的位置(装配时对准挑檐桁中)。 */
function hengwanGeometryDk(p: { L: number; W: number; H: number; seatW: number; seatDepth: number; seatX?: number }): THREE.BufferGeometry {
  const half = p.L / 2;
  const seatX = Math.min(p.seatX ?? 0, half - p.seatW / 2);
  const s = new THREE.Shape();
  s.moveTo(-half, 0);
  s.lineTo(half, 0);
  s.lineTo(half, p.H);
  s.lineTo(seatX + p.seatW / 2, p.H);
  s.quadraticCurveTo(seatX, p.H - 2 * p.seatDepth, seatX - p.seatW / 2, p.H);
  s.lineTo(-half, p.H);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: p.W, bevelEnabled: false, curveSegments: 8 });
  geo.translate(0, 0, -p.W / 2);
  return geo;
}

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 1) return geos[0];
  // 手工拼合(都是 Box/Extrude,属性集一致:position/normal/uv)。
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vOff = 0;
  let iOff = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set((g.attributes.position as THREE.BufferAttribute).array as Float32Array, vOff * 3);
    nor.set((g.attributes.normal as THREE.BufferAttribute).array as Float32Array, vOff * 3);
    if (g.attributes.uv) uv.set((g.attributes.uv as THREE.BufferAttribute).array as Float32Array, vOff * 2);
    if (g.index) {
      const arr = g.index.array;
      for (let i = 0; i < arr.length; i++) idx[iOff + i] = arr[i] + vOff;
      iOff += arr.length;
    } else {
      for (let i = 0; i < n; i++) idx[iOff + i] = vOff + i;
      iOff += n;
    }
    vOff += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/* ------------------------------------------------------------------ */
/* 叶件定义:尺寸出处 + 缺口处的推导值(记 art)                           */
/* ------------------------------------------------------------------ */

interface Juansha {
  lobes: number;
  lobeLen: number;
  /** 端头留高占栱高的比例。 */
  tipRatio: number;
}

/** 卷杀参数(清式原文无,missing 99-29):瓣数借「万三瓜四厢五」旁证,瓣长/端头高为艺术选择。 */
function juansha(book: RuleBook, leaf: 'gua' | 'wan' | 'xiang' | 'qiao'): Juansha {
  const lobes = { gua: 4, wan: 3, xiang: 5, qiao: 4 }[leaf];
  return book.artChoice<Juansha>(
    '99-29',
    `清式栱卷杀原文未摘;瓣数取奉先殿论文转述的清式规定「万三瓜四厢五」(旁证非原文,翘按瓜栱档 4 瓣),` +
      `瓣长 0.5 斗口、端头留高为栱高 55%、台阶式线性插值,均为观感取值`,
    { lobes, lobeLen: 0.5, tipRatio: 0.55 },
  );
}

/** 小斗分段(清式原文无,missing 99-30):按大斗分段比例缩。 */
function smallDouProfile(book: RuleBook, L: number, W: number, H: number): Omit<DouProfile, 'slots'> {
  return book.artChoice<Omit<DouProfile, 'slots'>>(
    '99-30',
    '十八斗/三才升/槽升的耳腰底分段原文未摘;按大斗分段比例(底 0.4/腰 0.2/耳 0.4、斗底收 2.2/3)缩',
    { L, W, H, diH: H * 0.4, yaoH: H * 0.2, earH: H * 0.4, diScale: 2.2 / 3 },
  );
}

interface LeafCtx {
  cai: number;
  /** 斗口(米),桁碗高要折「−2 寸」绝对尺寸时用 [04-08][01-19]。 */
  dkM: number;
  /** 昂专用:该昂第几拽架(头昂=2、二昂=3);缺省取本踩制最外一根。 */
  jump?: number;
  /** 通长枋(正心枋/挑檐枋/拽枋/平板枋)的本段长(斗口),缺省取攒当 [01-04]。 */
  beamLen?: number;
  /** 桁碗槽心沿长向位置(斗口),缺省居中;装配时对准挑檐桁中。 */
  hengwanSeatX?: number;
}

/** 清式叶件几何(斗口单位,原点在各件底心,长沿 X)。 */
function leafGeometryDk(book: RuleBook, leaf: QingLeafId, ctx: LeafCtx): THREE.BufferGeometry {
  const d = qingDougongDims(book);
  const jumps = (ctx.cai - 1) / 2; // 单侧拽架数 [04-02]
  const span = jumps * book.num('01-07', 'perZhaijiaDk'); // 单侧出跳(斗口)
  let g: THREE.BufferGeometry;
  switch (leaf) {
    case 'lu': {
      g = douGeometryDk(book.artChoice(
        '04-03',
        '大斗底欹:原文只给斗底宽 2.2 与底高 0.8,四面收分按直线插值(欹颐曲线插值为艺术选择)',
        {
          L: d.dadou.L, W: d.dadou.W, H: d.dadou.H,
          diH: d.dadou.diH, yaoH: d.dadou.yaoH, earH: d.dadou.kouH,
          diScale: d.dadou.diW / d.dadou.W,
          // 十字槽:顺跳槽宽=栱宽 1(安翘),横槽宽=正心栱宽 1.24(安正心瓜栱)。
          slots: [
            { axis: 'z', width: d.gongW },
            { axis: 'x', width: d.zhengxinGongW },
          ],
        },
      ));
      break;
    }
    case 'sbd':
      g = douGeometryDk({ ...smallDouProfile(book, d.sbd.L, d.sbd.W, d.sbd.H), slots: [{ axis: 'x', width: d.gongW }] });
      break;
    case 'scs':
      g = douGeometryDk({ ...smallDouProfile(book, d.scs.L, d.scs.W, d.scs.H), slots: [{ axis: 'x', width: d.gongW }] });
      break;
    case 'cs':
      g = douGeometryDk({ ...smallDouProfile(book, d.cs.L, d.cs.W, d.cs.H), slots: [{ axis: 'x', width: d.zhengxinFangT }] });
      break;
    case 'qiao': {
      const j = juansha(book, 'qiao');
      g = gongGeometryDk({ L: d.danqiaoL, W: d.gongW, H: d.zuCaiH, lobes: j.lobes, lobeLen: j.lobeLen, tipH: d.zuCaiH * j.tipRatio });
      break;
    }
    case 'zxg':
    case 'zxw':
    case 'dcg':
    case 'dcw':
    case 'xiang': {
      const isZhengxin = leaf === 'zxg' || leaf === 'zxw';
      const L = d.gongL[leaf];
      const H = isZhengxin ? d.zuCaiH : d.danCaiGongH;
      const W = isZhengxin ? d.zhengxinGongW : d.gongW;
      const j = juansha(book, leaf === 'zxg' || leaf === 'dcg' ? 'gua' : leaf === 'xiang' ? 'xiang' : 'wan');
      g = gongGeometryDk({ L, W, H, lobes: j.lobes, lobeLen: j.lobeLen, tipH: H * j.tipRatio });
      break;
    }
    case 'ang': {
      // 长度原文未给(missing 99-27):正心→外端 = 该昂所管拽架 × 3 斗口 [01-07],
      // 后尾同跨度里伸,昂嘴另出。嘴形(嘴长、嘴尖高)为艺术选择。
      const j = ctx.jump ?? jumps;
      const reach = j * book.num('01-07', 'perZhaijiaDk');
      const len = book.artChoice(
        '99-27',
        `昂长原文未给;按装配包络推:第 ${j} 拽架的昂自正心向里外各 ${j} 拽架 × 3 斗口 [01-07],嘴尖再出 1.2(观感)`,
        { headL: reach, tailL: reach, beakLen: 1.2, beakTipH: 0.5 },
      );
      g = angGeometryDk({ ...len, W: d.gongW, midH: d.angZhongGao, frontH: d.angQianGao });
      break;
    }
    case 'shua': {
      const len = book.artChoice(
        '99-27',
        `蚂蚱头长原文未给;按${ctx.cai}踩装配包络推:里外各 ${jumps} 拽架 × 3 斗口,头再出 1.5(观感)`,
        { L: span * 2 + 1.5, headLen: 1.5 },
      );
      g = shuatouGeometryDk({ ...len, W: d.gongW, H: d.mazhatouH });
      break;
    }
    case 'cheng': {
      const L = book.artChoice(
        '99-27',
        `撑头木长原文未给;按${ctx.cai}踩装配包络取里外拽架全跨 ${span * 2} 斗口`,
        span * 2,
      );
      g = boxDk(L, d.chengshantouH, d.gongW, 0, d.chengshantouH / 2, 0);
      break;
    }
    case 'hengwan': {
      const L = d.hengwanLByCai[String(ctx.cai)];
      if (!L) throw new Error(`01-18 桁椀 lengthByCai 没有 ${ctx.cai} 踩档`);
      const diaDk = tiaoyanHengDiaDk(book, d, ctx.dkM);
      const H = diaDk / d.hengwanDiv; // 桁碗高=桁径/3 [04-08]
      g = hengwanGeometryDk(book.artChoice(
        '04-08',
        '桁碗槽:原文只给高=桁径/3,槽口宽取桁径、弧线按抛物线插值(艺术选择)',
        { L, W: d.gongW, H, seatW: diaDk, seatDepth: H, seatX: ctx.hengwanSeatX },
      ));
      break;
    }
    case 'zxf': {
      const L = ctx.beamLen ?? d.cuanDang;
      g = boxDk(L, d.zhengxinFangH, d.zhengxinFangT, 0, d.zhengxinFangH / 2, 0);
      break;
    }
    case 'tyf': {
      const L = ctx.beamLen ?? d.cuanDang;
      g = boxDk(L, d.tiaoyanFangH, d.tiaoyanFangT, 0, d.tiaoyanFangH / 2, 0);
      break;
    }
    case 'zf': {
      // 里外拽枋高厚同挑檐枋 [01-10 statement],不重复落数。
      const L = ctx.beamLen ?? d.cuanDang;
      g = boxDk(L, d.tiaoyanFangH, d.tiaoyanFangT, 0, d.tiaoyanFangH / 2, 0);
      break;
    }
    case 'pbf': {
      const L = ctx.beamLen ?? d.cuanDang;
      g = boxDk(L, d.pingbanH, d.pingbanW, 0, d.pingbanH / 2, 0);
      break;
    }
    default:
      throw new Error(`未知清式斗拱叶件 ${leaf}`);
  }
  return g;
}

/**
 * 清式叶件几何(米)。dkM 为斗口(米);返回几何原点在各件底心、长沿 X。
 * 昂/耍头/撑头木/桁碗的长度随踩数(cai,缺省五踩=Tier A 正门档);长度原文
 * 未给(missing 99-27),按装配包络推:里外各 (cai−1)/2 拽架 × 3 斗口 [01-07]。
 */
export function qingLeafGeometry(book: RuleBook, leaf: QingLeafId, dkM: number, cai = 5): THREE.BufferGeometry {
  const g = leafGeometryDk(book, leaf, { cai, dkM });
  g.scale(dkM, dkM, dkM);
  return g;
}

/* ------------------------------------------------------------------ */
/* 装配:平身科一攒(组合件 C-dg-05 五踩 / C-dg-07 七踩)                  */
/* ------------------------------------------------------------------ */

export interface PingshengKeResult {
  /** 整攒合并后的几何(米):原点在大斗底心(正心中线上),+Z 朝外(出跳方向)。 */
  geometry: THREE.BufferGeometry;
  /** 攒顶高(斗口/米):挑檐枋顶,自大斗底。 */
  topDk: number;
  topM: number;
  /** 正心至挑檐桁中(斗口/米)= 3 × 单侧拽架数 [01-07]。 */
  outDk: number;
  outM: number;
  pieces: number;
  tris: number;
}

/**
 * 按组合件的 parts 与 attachTo 装一攒平身科(清式五踩单翘单昂 / 七踩单翘重昂)。
 *
 * 装配尺寸链:顺跳构件(翘/昂/耍头/撑头木)层位按「大斗高 2、翘坐入大斗口 0.8、
 * 每踩高 2 斗口」[04-03][04-04];跳头横栱 stack 的坐入深取承接斗/升的耳高
 * (大斗 0.8 是原文 [04-03],小斗耳 0.4 是 99-30 那笔按比例缩的艺术选择,
 * 坐入深度本身原文未给,一并记入该条 art)。横栱端头升位:瓜栱两端三才升承万栱、
 * 万栱/厢栱两端三才升承枋——与 C-dg-05/07 的分件计数(三才升 12/20、十八斗 4/6)
 * 逐件对得上。转角铺作(列栱)与柱头科本期不做(ROADMAP §P3 下一轮)。
 */
export function assemblePingshengKe(book: RuleBook, cai: 5 | 7, dkM: number, beamLenDk?: number): PingshengKeResult {
  const d = qingDougongDims(book);
  const jumps = (cai - 1) / 2; // 单侧拽架数 [04-02]
  const perJump = book.num('01-07', 'perZhaijiaDk'); // 3 斗口/拽架
  const seatDou = d.dadou.kouH; // 翘坐入大斗口 0.8 [04-04/04-03]
  const earSmall = d.sbd.H * 0.4; // 小斗/升耳高(99-30 比例缩的 art 值),横栱坐入深度取它
  const layer = d.zuCaiH; // 每踩高 2 斗口 [04-03]
  const beam = beamLenDk ?? d.cuanDang;

  const geos: THREE.BufferGeometry[] = [];
  const add = (leaf: QingLeafId, x: number, y: number, z: number, radial = false, ctx: Partial<LeafCtx> = {}) => {
    const g = leafGeometryDk(book, leaf, { cai, dkM, beamLen: beam, ...ctx });
    if (radial) g.rotateY(-Math.PI / 2); // 长轴 x → +z(出跳方向),昂嘴/头朝外
    g.translate(x, y, z);
    geos.push(g);
  };

  // 顺跳第 j 拽架层底:大斗顶 − 坐入 + (j−1) 踩 [04-04 的 0.8 坐入就出自这里]
  const yBase = (j: number) => d.dadou.H - seatDou + layer * (j - 1);
  const zJump = (j: number) => j * perJump;
  /** 昂背(顶面)在 z 处的高:正心中高 2,斜升至外端前高 3 [04-03];里尾平。 */
  const angTop = (j: number, z: number) =>
    yBase(j) + (z > 0 ? d.angZhongGao + (d.angQianGao - d.angZhongGao) * Math.min(z / zJump(j), 1) : d.angZhongGao);

  // 大斗
  add('lu', 0, 0, 0);
  // 顺跳构件:翘(第一拽架)、昂(第二起,七踩有头昂/二昂)、耍头、撑头木、桁碗。
  add('qiao', 0, yBase(1), 0, true);
  for (let j = 2; j <= jumps; j++) add('ang', 0, yBase(j), 0, true, { jump: j });
  add('shua', 0, yBase(jumps + 1), 0, true);
  add('cheng', 0, yBase(jumps + 2), 0, true);
  const hengwanBase = yBase(jumps + 2) + d.chengshantouH;
  add('hengwan', 0, hengwanBase, 0, true, { hengwanSeatX: zJump(jumps) });

  // 正心线横栱与正心枋 [C-dg-05/07 attachTo]
  add('zxg', 0, yBase(1), 0);
  add('zxw', 0, yBase(2), 0);
  const csOff1 = d.gongL.zxg / 2 - d.cs.L / 2;
  const csOff2 = d.gongL.zxw / 2 - d.cs.L / 2;
  const sheng1Top = yBase(1) + d.zuCaiH + d.cs.H;
  const sheng2Top = yBase(2) + d.zuCaiH + d.cs.H;
  for (const sx of [-1, 1]) {
    add('cs', sx * csOff1, yBase(1) + d.zuCaiH, 0);
    add('cs', sx * csOff2, yBase(2) + d.zuCaiH, 0);
  }
  add('zxf', 0, sheng2Top - earSmall, 0);

  // 跳头横栱 stack:非最外跳 瓜栱→瓜端升→万栱→万端升→拽枋;最外/最里跳 厢栱→厢端升(外跳再承挑檐枋)。
  for (let j = 1; j <= jumps; j++) {
    for (const sz of [-1, 1]) {
      const z = sz * zJump(j);
      const douBase = j === 1 ? yBase(1) + d.zuCaiH : angTop(j, z);
      add('sbd', 0, douBase, z);
      const gongBase = douBase + d.sbd.H - earSmall;
      const outermost = j === jumps;
      if (!outermost) {
        add('dcg', 0, gongBase, z);
        const s1Top = gongBase + d.danCaiGongH + d.scs.H;
        const off1 = d.gongL.dcg / 2 - d.scs.L / 2;
        for (const sx of [-1, 1]) add('scs', sx * off1, gongBase + d.danCaiGongH, z);
        const wanBase = s1Top - earSmall;
        add('dcw', 0, wanBase, z);
        const s2Top = wanBase + d.danCaiGongH + d.scs.H;
        const off2 = d.gongL.dcw / 2 - d.scs.L / 2;
        for (const sx of [-1, 1]) add('scs', sx * off2, wanBase + d.danCaiGongH, z);
        add('zf', 0, s2Top - earSmall, z);
      } else {
        add('xiang', 0, gongBase, z);
        const sTop = gongBase + d.danCaiGongH + d.scs.H;
        const off = d.gongL.xiang / 2 - d.scs.L / 2;
        for (const sx of [-1, 1]) add('scs', sx * off, gongBase + d.danCaiGongH, z);
        if (sz > 0) add('tyf', 0, sTop - earSmall, z);
      }
    }
  }

  const merged = mergeGeos(geos);
  merged.scale(dkM, dkM, dkM);
  merged.computeBoundingBox();
  const bb = merged.boundingBox!;
  const topDk = bb.max.y / dkM;
  const outDk = zJump(jumps);
  const tris = (merged.index ? merged.index.count : merged.attributes.position.count) / 3;
  return {
    geometry: merged,
    topDk,
    topM: bb.max.y,
    outDk,
    outM: outDk * dkM,
    pieces: geos.length,
    tris,
  };
}

/* ------------------------------------------------------------------ */
/* 棚拍登记                                                            */
/* ------------------------------------------------------------------ */

/** 棚拍显示档斗口(米):单件/单攒出库的展示尺度,不是营造数;真实斗口由建筑 spec 给。 */
const STUDIO_DK_M = 0.1;
const STUDIO_SET_DK_M = 0.08;

const SET_VARIANTS: Record<string, { cai: 5 | 7; name: string; component: string }> = {
  set5: { cai: 5, name: '五踩单翘单昂平身科(一攒)', component: 'C-dg-05' },
  set7: { cai: 7, name: '七踩单翘重昂平身科(一攒)', component: 'C-dg-07' },
  'C-dg-05': { cai: 5, name: '五踩单翘单昂平身科(一攒)', component: 'C-dg-05' },
  'C-dg-07': { cai: 7, name: '七踩单翘重昂平身科(一攒)', component: 'C-dg-07' },
};

function buildDougongPart(variant: string): PartBuild {
  const book = qingDougongBook();
  const setV = SET_VARIANTS[variant];
  const root = new THREE.Group();
  if (setV) {
    const set = assemblePingshengKe(book, setV.cai, STUDIO_SET_DK_M);
    const mesh = new THREE.Mesh(set.geometry, woodMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    root.name = `dougong:${variant}`;
    root.userData.component = setV.component;
    root.userData.name = setV.name;
    root.userData.set = { pieces: set.pieces, tris: set.tris, topDk: set.topDk, outDk: set.outDk };
    root.userData.provenance = book.provenance();
    return { root };
  }
  const key = variant.replace(/^C-dg-/, '') as QingLeafId;
  if (!(QING_LEAF_IDS as readonly string[]).includes(key)) {
    throw new Error(
      `未做的斗拱分件 "${variant}"。清式叶件: ${QING_LEAF_IDS.join(', ')}(可带 C-dg- 前缀);` +
        `整攒: set5 / set7;宋式 C-pz-* 本期不做(单子 V:先证明清式一支能从数据走到几何)`,
    );
  }
  const geo = qingLeafGeometry(book, key, STUDIO_DK_M);
  const mesh = new THREE.Mesh(geo, woodMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.name = `dougong:${key}`;
  root.add(mesh);
  root.userData.component = LEAF_COMPONENT[key];
  root.userData.name = LEAF_NAME[key];
  root.userData.provenance = book.provenance();
  return { root };
}

registerPart('dougong', buildDougongPart);
