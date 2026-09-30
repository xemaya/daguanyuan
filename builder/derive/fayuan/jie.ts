/**
 * 界:面阔、界深、柱高、柱径。数字全部来自规则表 [05-01][05-02][05-11][05-22]。
 *
 * 界 = 相邻两桁的水平距离,即北方之步架 [05-01]。进深按界累加:
 * 六界 = 前廊 + 内四界 + 后廊,七界 = 前廊 + 内四界 + 后双步。
 *
 * 檐高比例 05-02 是存疑条:0.8×明间只在 W≈3.9~4.9m 区间成立,小型厅轩
 * 系统性偏低 18~32%(斜率错),必须按更正值 clamp 到 [3.2, 3.9]m。
 * 亭不走 05-02(tiers.md Tier C 禁用),柱高走 05-11 的边长比例。
 */
import type { RuleBook } from '../rules';

export type TingShape = 'square' | 'hexagon' | 'octagon' | 'round';
export type HallKind = '民房' | '圆堂' | '厅' | '殿庭';

export interface JieInput {
  tier: 'B' | 'C';
  /** 档次不是平面类型：Tier C 同时包含亭、廊、敞厅。旧调用缺省 B=hall/C=pavilion。 */
  form?: 'hall' | 'pavilion';
  /** 亭的平面形状,pavilion 必填。 */
  shape?: TingShape;
  /** 亭:每面边长(米)。 */
  sideM?: number;
  /** 厅堂:各间面阔(米),自西向东。 */
  bayWidthsM?: number[];
  /** 厅堂界深(尺)。亭不给——界深由半跨与界数反推 [05-10 界深约三尺是校核不是输入]。 */
  jieDepthChi?: number;
  /** 全剖面总界数(六界 = 6;两界/坡的亭 = 4)。 */
  jieCount: number;
  /** 廊柱/亭柱高(米);不给按比例推。 */
  columnHeightM?: number;
  /** 营造尺长(厘米)。05 章数字全是营造尺,尺值必须显式声明(05 open_q 8)。 */
  chiCm: number;
  hallKind?: HallKind;
}

export interface Jie {
  /** 总面阔;亭为对边距(内切圆直径口径,与 08-04 实测口径一致)。 */
  width: number;
  depthHalf: number;
  /** 每坡界深。 */
  jieDepthM: number;
  jieDepthChi: number;
  /** 每坡界数。 */
  halfJie: number;
  /** 面阔柱位 x(原点在中);亭无开间轴,给空。 */
  columnX: number[];
  columnH: number;
  columnD: number;
}

/** 正多边形内切半径 / 边长——纯几何常数,不是营造数字。 */
function apothemRatio(shape: TingShape): number {
  switch (shape) {
    case 'square': return 0.5;
    case 'hexagon': return Math.sqrt(3) / 2;
    // 圆亭按八角亭做法 [05-11]。
    case 'octagon':
    case 'round': return (1 + Math.SQRT2) / 2;
  }
}

function deriveTingJie(book: RuleBook, spec: JieInput): Jie {
  const shape = spec.shape;
  if (!shape || spec.sideM === undefined) throw new Error('tier C 亭必须给 shape 与 sideM');
  const side = spec.sideM;
  const apothem = side * apothemRatio(shape);
  const chiM = spec.chiCm / 100;

  const halfJie = spec.jieCount / 2;
  if (!Number.isInteger(halfJie) || halfJie < 1) throw new Error('界数须为 ≥2 的偶数');
  const jieDepthM = apothem / halfJie;
  const jieDepthChi = jieDepthM / chiM;

  // 柱高 [05-11]:方亭 0.8×面阔,六角 1.5×边长,八角 1.5~1.6×边长(区间内取点记 art)。
  let ratio: number;
  if (shape === 'square') ratio = book.num('05-11', 'fangtingColRatio');
  else if (shape === 'hexagon') ratio = book.num('05-11', 'liujiaoColRatio');
  else ratio = book.pickInRange('05-11', 'bajiaoColRatio', 'lo');
  const columnH = spec.columnHeightM ?? ratio * side;
  // 柱径 [05-11] = 柱高×0.1。注意与 05-22 围径法差约 60%(05 open_q 10),
  // 书中无调和条;Tier C 已选 05-11 这一路(verify-suzhou A.1.6)。
  const columnD = columnH * book.num('05-11', 'colDiaRatio');

  return {
    width: 2 * apothem,
    depthHalf: apothem,
    jieDepthM,
    jieDepthChi,
    halfJie,
    columnX: [],
    columnH,
    columnD,
  };
}

function deriveHallJie(book: RuleBook, spec: JieInput): Jie {
  const bays = spec.bayWidthsM;
  if (!bays?.length) throw new Error('厅堂必须给 bayWidthsM');
  if (spec.jieDepthChi === undefined) throw new Error('厅堂必须给 jieDepthChi(界深,尺)');
  if (spec.tier === 'C' && spec.columnHeightM === undefined)
    throw new Error('Tier C 厅/廊须显式给 columnHeightM，不能套用05-02住宅檐高或05-11亭柱比例');
  const chiM = spec.chiCm / 100;
  const halfJie = spec.jieCount / 2;
  if (!Number.isInteger(halfJie) || halfJie < 1) throw new Error('界数须为 ≥2 的偶数');

  const width = bays.reduce((a, b) => a + b, 0);
  const columnX: number[] = [];
  let x = -width / 2;
  columnX.push(x);
  for (const w of bays) {
    x += w;
    columnX.push(x);
  }
  const mainBay = bays[Math.floor(bays.length / 2)];

  // 檐高 [05-02,存疑]:0.8×明间,clamp 到 [3.2, 3.9]m——实测檐高近似常数,
  // 不 clamp 小轩会矮得不成人形尺度。用更正值这一事实由 use() 记进 inference。
  let columnH: number;
  if (spec.columnHeightM !== undefined) {
    columnH = spec.columnHeightM;
  } else {
    const raw = mainBay * book.num('05-02', 'eaveRatio');
    const lo = book.num('05-02', 'clampLoM');
    const hi = book.num('05-02', 'clampHiM');
    columnH = Math.min(hi, Math.max(lo, raw));
    if (columnH !== raw) {
      book.artChoice(
        '05-02',
        `0.8×明间 = ${raw.toFixed(2)}m 超出实测 clamp 区间 [${lo}, ${hi}],取 ${columnH.toFixed(2)}m`,
        columnH,
      );
    }
  }

  // 柱径 [05-22] 围径歌诀:正间步柱围 = 0.2×明间面阔,廊柱 = 步柱×0.8,径 = 围/π。
  const buzhuWei = mainBay * book.num('05-22', 'buzhuWeiRatio');
  const columnD = (buzhuWei * book.num('05-22', 'langzhuWeiRatio')) / Math.PI;

  return {
    width,
    depthHalf: (spec.jieCount * spec.jieDepthChi * chiM) / 2,
    jieDepthM: spec.jieDepthChi * chiM,
    jieDepthChi: spec.jieDepthChi,
    halfJie,
    columnX,
    columnH,
    columnD,
  };
}

export function deriveJie(book: RuleBook, spec: JieInput): Jie {
  if (spec.tier !== 'B' && spec.tier !== 'C') throw new Error('法原界推导只接受 Tier B/C');
  if (spec.form !== undefined && spec.form !== 'hall' && spec.form !== 'pavilion') throw new Error('未知法原平面类型');
  const positive = (v: number | undefined, label: string) => {
    if (v !== undefined && (!Number.isFinite(v) || v <= 0)) throw new Error(`${label} 须为有限正数`);
  };
  positive(spec.chiCm, 'chiCm');
  if (spec.chiCm === undefined) throw new Error('必须显式给 chiCm');
  positive(spec.sideM, 'sideM');
  positive(spec.jieDepthChi, 'jieDepthChi');
  positive(spec.columnHeightM, 'columnHeightM');
  for (const width of spec.bayWidthsM ?? []) positive(width, 'bayWidthsM');
  const form = spec.form ?? (spec.tier === 'C' ? 'pavilion' : 'hall');
  if (form === 'pavilion' && spec.tier !== 'C') throw new Error('亭柱比例只用于 Tier C pavilion');
  return form === 'pavilion' ? deriveTingJie(book, spec) : deriveHallJie(book, spec);
}
