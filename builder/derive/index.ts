/**
 * 大木作推导器:把一栋屋的输入契约(材等、间架、铺作、屋类)推成
 * 一张以米计的骨架表,供 builder/parts/damu/building.ts 出几何。
 *
 * 这里只做"数",不碰 three.js——分层门查这条。
 *
 * **所有营造数字来自 knowledge/rules/*.json,代码里没有一个字面量。**
 * 每次推导都会带回一份 provenance:哪些数有出处(evidence)、哪些是我们在
 * 存疑口径里做的裁决(inference)、哪些是为体验主动做的偏离(art)。
 */
import { makeCai, type Cai, type CaiSpec } from '@builder/derive/fashi/cai';
import { derivePuzuo, type Puzuo, type PuzuoSpec } from '@builder/derive/fashi/puzuo';
import { deriveZhu, type Zhu, type Hall } from '@builder/derive/fashi/zhu';
import { deriveJuzhe, type Juzhe, type RoofClass } from '@builder/derive/fashi/juzhe';
import { defaultRafterDiaFen, deriveYanchu, type Yanchu } from '@builder/derive/fashi/yanchu';
import { eraOptions, type Era } from '@builder/derive/profiles';
import { RuleBook, type RuleBookOptions } from '@builder/derive/rules';
import type { Provenance } from '@builder/derive/provenance';

export type RoofType = '歇山' | '硬山' | '悬山' | '攒尖';
export type { Era };

export interface BuildingSpec {
  cai: CaiSpec;
  hall: Hall;
  /** 面阔各间(分)。 */
  bayWidthsFen: number[];
  /** 进深总椽架数(偶数)。 */
  rafters: number;
  /** 每架平长(分)[04-11];不给取该规则的参考区间上限。 */
  jiaFen?: number;
  /** 铺作;不出跳者传 null(柱头作)。 */
  puzuo?: PuzuoSpec | null;
  roofType: RoofType;
  roofClass?: RoofClass;
  /** 时代口径预设,缺省宋(法式本位)。见 builder/derive/profiles.ts。 */
  era?: Era;
  /** 逐条覆盖预设的口径选择,或给缺失规则显式值(会记进 provenance.art)。 */
  rules?: RuleBookOptions;
  /** 举高比。选中口径给的是区间时必须给,是艺术决策。 */
  raiseRatio?: number;
  /** 椽径(分)[05-02];不给按屋类取区间下限。 */
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
  /** 这一栋屋每个数字的来路,分证据/推定/艺术三支。 */
  provenance: Provenance;
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
  const era = spec.era ?? 'song';
  const book = RuleBook.create('fashi', eraOptions(era, spec.rules ?? {}));
  return deriveWithBook(book, spec, era);
}

/** 同 deriveBuilding,但用调用方给的规则本。突变测试与多参数集分派走这条。 */
export function deriveWithBook(book: RuleBook, spec: BuildingSpec, era: Era = 'song'): Frame {
  const cai = makeCai(book, spec.cai);
  const f = cai.fenM;
  const puzuo = spec.puzuo ? derivePuzuo(book, spec.puzuo) : null;

  const zhu = deriveZhu(book, {
    hall: spec.hall,
    bayWidthsFen: spec.bayWidthsFen,
    fenCun: cai.fenCun,
    columnHeightFen: spec.columnHeightFen,
    columnDiameterFen: spec.columnDiameterFen,
    // [03-08 乙注] 唐构无侧脚。
    cejiao: era !== 'tang',
  });

  if (spec.rafters % 2 !== 0 || spec.rafters < 2) throw new Error('椽架数须为 ≥2 的偶数');
  // [04-11] 椽每架平长参考 100~125 分,上限 150。不给取参考区间上限。
  const jia = spec.jiaFen ?? book.pickInRange('04-11', 'fenRange', 'hi');
  const depthFen = jia * spec.rafters; // 前后檐柱心距
  const outFen = puzuo ? puzuo.outFen : 0;
  // [04-02] 殿阁取前后橑檐枋心距;不出跳者取檐柱心距。
  const spanL = depthFen + 2 * outFen;

  const cls = spec.roofClass ?? (spec.hall === '殿阁' ? '殿阁' : '筒瓦厅堂');
  const juzhe = deriveJuzhe(book, {
    spanL,
    halfRafters: spec.rafters / 2,
    cls,
    ratio: spec.raiseRatio,
  });

  const width = zhu.xFen[zhu.xFen.length - 1];
  const columnX = zhu.xFen.map((x) => (x - width / 2) * f);
  const columnH = zhu.columnHeightFen * f;
  const puzuoH = puzuo ? puzuo.heightFen * f : 0;
  // [04-26] 橑檐枋广 30 分;不出跳者用替木 + 槫,近似一足材 [01-04]。
  const fangHFen = puzuo ? book.num('04-26', 'liaoyanFangGuangFen') : cai.mod.zuCai;
  const fangH = fangHFen * f;
  const eaveY = columnH + puzuoH + fangH;

  const yc = deriveYanchu(book, {
    rafterDiaFen: spec.rafterDiaFen ?? defaultRafterDiaFen(book, spec.hall),
    fenCun: cai.fenCun,
    bays: spec.bayWidthsFen.length,
    feizi: spec.feizi,
    qiqiaoFen: spec.qiqiaoFen,
    // [05-11] 厦两头角梁转椽数:厅堂/殿阁 2,亭榭 1。
    xieshanTurn: spec.hall === '余屋' ? 1 : 2,
  });
  const yanchu = yc.totalFen * f;
  const lastSlope = juzhe.slopes[juzhe.slopes.length - 1];

  return {
    cai,
    puzuo,
    zhu,
    juzhe,
    yanchu: yc,
    provenance: book.provenance(),
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
      // 檐口最外点:椽尾沿下架坡度外伸再下垂。0.85 是**几何近似**不是营造数字
      // ——飞子起翘会把实际下垂压小,原文对此无定量 [05-13]。
      eaveTip: { out: yanchu, drop: yanchu * lastSlope * 0.85 },
      qiqiao: yc.qiqiaoFen * f,
      shengchu: yc.shengchuFen * f,
      rafterDia: yc.rafterPitchFen / book.num('05-03', 'rafterPitchToDiaRatio') * f,
      rafterPitch: yc.rafterPitchFen * f,
      lan: { w: zhu.lan.w * f, t: zhu.lan.t * f },
      base: zhu.baseFen * f,
      width: width * f,
      depth: depthFen * f,
    },
  };
}

export { RuleBook, type RuleBookOptions } from '@builder/derive/rules';
export type { Provenance } from '@builder/derive/provenance';
export { AmbiguousRuleError, MissingRuleError, RefutedRuleError, RuleError } from '@builder/derive/errors';

// —— 参数集分派:fashi 是本文件的原生链;qing 与 fayuan 各走自己的推导链 ——
export { deriveQing, type QingFrame, type QingSpec } from '@builder/derive/qing/index';
import { deriveQing, type QingFrame, type QingSpec } from '@builder/derive/qing/index';
export { deriveFayuan, type FayuanFrame, type FayuanSpec } from '@builder/derive/fayuan/index';
import { deriveFayuan, type FayuanFrame, type FayuanSpec } from '@builder/derive/fayuan/index';

/** 按参数集分派到各自的推导链。 */
export function deriveByParamSet(
  book: RuleBook,
  spec: BuildingSpec | QingSpec | FayuanSpec,
): Frame | QingFrame | FayuanFrame {
  if (book.paramSet === 'qing') return deriveQing(book, spec as QingSpec);
  if (book.paramSet === 'fayuan') return deriveFayuan(book, spec as FayuanSpec);
  return deriveWithBook(book, spec as BuildingSpec);
}
