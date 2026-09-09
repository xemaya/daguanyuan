/**
 * 大木作推导器:把一栋屋的输入契约(材等、间架、铺作、屋类)推成
 * 一张以米计的骨架表,供 src/cn/parts/building.ts 出几何。
 *
 * 这里只做"数",不碰 three.js。每个字段的来源规则号见各子模块。
 */
import { makeCai, type Cai, type CaiSpec } from './cai';
import { derivePuzuo, type Puzuo, type PuzuoSpec } from './puzuo';
import { deriveZhu, type Zhu, type Hall } from './zhu';
import { deriveJuzhe, type Juzhe, type RoofClass, type Era } from './juzhe';
import { deriveYanchu, type Yanchu } from './yanchu';

export type RoofType = '歇山' | '硬山' | '悬山' | '攒尖';

export interface BuildingSpec {
  cai: CaiSpec;
  hall: Hall;
  /** 面阔各间(分)。 */
  bayWidthsFen: number[];
  /** 进深总椽架数(偶数)。 */
  rafters: number;
  /** 每架平长(分)[04-11],缺省 110。 */
  jiaFen?: number;
  /** 铺作;不出跳者传 null(柱头作)。 */
  puzuo?: PuzuoSpec | null;
  roofType: RoofType;
  roofClass?: RoofClass;
  era?: Era;
  /** 椽径(分)[05-02];缺省按屋类。 */
  rafterDiaFen?: number;
  /** 飞子 [05-05];缺省 true。 */
  feizi?: boolean;
  /** 翼角起翘(分),原文无定量 [05-13];缺省 0。 */
  qiqiaoFen?: number;
  /** 檐柱高覆盖(分)。 */
  columnHeightFen?: number;
  columnDiameterFen?: number;
}

export interface Frame {
  cai: Cai;
  puzuo: Puzuo | null;
  zhu: Zhu;
  juzhe: Juzhe;
  yanchu: Yanchu;
  /** 以下全部为米。 */
  m: {
    /** 面阔柱位 x(自西向东,原点在中),z 前后檐柱位(±)。 */
    columnX: number[];
    depthHalf: number;
    columnH: number;
    columnD: number;
    /** 各柱生起。 */
    rise: number[];
    /** 檐柱头到橑檐枋下皮(铺作高),不出跳时为 0。 */
    puzuoH: number;
    /** 橑檐枋心离檐柱心的外伸。 */
    puzuoOut: number;
    /** 橑檐枋背的高度(地面起)= 柱高 + 铺作高 + 枋高。 */
    eaveY: number;
    /** 橑檐枋心离屋中心的距离(进深方向)。 */
    eaveHalf: number;
    /** 屋面剖面:自脊到橑檐枋背,(x 离脊, y 离橑檐枋背)。 */
    purlins: { x: number; y: number; name: string }[];
    ridgeY: number;
    /** 檐出:椽出 + 飞子出。 */
    yanchu: number;
    /** 檐口最外点相对橑檐枋心的水平外伸与下垂(按下架坡度)。 */
    eaveTip: { out: number; drop: number };
    qiqiao: number;
    shengchu: number;
    rafterDia: number;
    rafterPitch: number;
    lan: { w: number; t: number };
    base: number;
    /** 总面阔 / 总进深(柱心)。 */
    width: number;
    depth: number;
  };
}

export function deriveBuilding(spec: BuildingSpec): Frame {
  const cai = makeCai(spec.cai);
  const f = cai.fenM;
  const puzuo = spec.puzuo ? derivePuzuo(spec.puzuo) : null;
  const zhu = deriveZhu({
    hall: spec.hall,
    bayWidthsFen: spec.bayWidthsFen,
    fenCun: cai.fenCm / (cai.chiCm / 10),
    columnHeightFen: spec.columnHeightFen,
    columnDiameterFen: spec.columnDiameterFen,
    cejiao: spec.era !== 'tang',
  });

  if (spec.rafters % 2 !== 0 || spec.rafters < 2) throw new Error('椽架数须为 ≥2 的偶数');
  const jia = spec.jiaFen ?? 110;
  const depthFen = jia * spec.rafters; // 前后檐柱心距
  const outFen = puzuo ? puzuo.outFen : 0;
  // [04-02] 殿阁取前后橑檐枋心距;不出跳者取檐柱心距。
  const spanL = depthFen + 2 * outFen;
  const juzhe = deriveJuzhe({
    spanL,
    halfRafters: spec.rafters / 2,
    cls: spec.roofClass ?? (spec.hall === '殿阁' ? '殿阁' : '筒瓦厅堂'),
    era: spec.era,
  });

  const width = zhu.xFen[zhu.xFen.length - 1];
  const columnX = zhu.xFen.map((x) => (x - width / 2) * f);
  const columnH = zhu.columnHeightFen * f;
  const puzuoH = puzuo ? puzuo.heightFen * f : 0;
  // 橑檐枋 30 分高 [04-26];不出跳者用替木+槫,近似 21 分。
  const fangH = (puzuo ? 30 : 21) * f;
  const eaveY = columnH + puzuoH + fangH;

  const fenCun = cai.fenCm / (cai.chiCm / 10);
  const yc = deriveYanchu({
    rafterDiaFen: spec.rafterDiaFen ?? (spec.hall === '殿阁' ? 9.5 : spec.hall === '厅堂' ? 7.5 : 6.5),
    fenCun,
    bays: spec.bayWidthsFen.length,
    feizi: spec.feizi,
    qiqiaoFen: spec.qiqiaoFen,
    xieshanTurn: spec.hall === '厅堂' || spec.hall === '殿阁' ? 2 : 1,
  });
  const yanchu = yc.totalFen * f;
  const lastSlope = juzhe.slopes[juzhe.slopes.length - 1];

  return {
    cai,
    puzuo,
    zhu,
    juzhe,
    yanchu: yc,
    m: {
      columnX,
      depthHalf: (depthFen / 2) * f,
      columnH,
      columnD: zhu.columnDiameterFen * f,
      rise: zhu.riseFen.map((r) => r * f),
      puzuoH,
      puzuoOut: outFen * f,
      eaveY,
      eaveHalf: (spanL / 2) * f,
      purlins: juzhe.purlins.map((p) => ({ x: p.x * f, y: p.y * f, name: p.name })),
      ridgeY: eaveY + juzhe.H * f,
      yanchu,
      eaveTip: { out: yanchu, drop: yanchu * lastSlope * 0.85 },
      qiqiao: yc.qiqiaoFen * f,
      shengchu: yc.shengchuFen * f,
      rafterDia: (spec.rafterDiaFen ?? 7.5) * f,
      rafterPitch: yc.rafterPitchFen * f,
      lan: { w: zhu.lan.w * f, t: zhu.lan.t * f },
      base: zhu.baseFen * f,
      width: width * f,
      depth: depthFen * f,
    },
  };
}
