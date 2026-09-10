/**
 * fayuan 参数集(《营造法原》界与提栈)——江南园林的主干推导链。
 *
 * 与 fashi 同一个输出契约:m 段以米计 + provenance 三分。fashi 特有的
 * 材分/铺作子结构这里没有对应物,换成 jie/tizhan/chuyan/qiangjiao 四段。
 *
 * 檐口高程闭合差的主要来源:柱头到檐桁之间的「连机、夹堂、枋子」段高书里
 * 没比例(05-11 只说「柱上架桁,下承连机夹堂枋子」),在 missing 99-04 里,
 * 该查刘敦桢《苏州古典园林》图版与《营造法原》第十三章。这里 eaveY 直接取
 * 柱高(桁坐柱头),是已知的偏低项。
 */
import { RuleBook } from '../rules';
import type { Provenance } from '../provenance';
import { deriveJie, type HallKind, type Jie, type JieInput, type TingShape } from './jie';
import { deriveTizhan, type Tizhan } from './tizhan';
import { deriveChuyan, deriveQiangjiao, type Chuyan, type Qiangjiao } from './qiangjiao';

export interface FayuanSpec extends JieInput {
  /** 各界算数(自檐向脊)显式给,跳过查表/默认值。 */
  suanSeq?: number[];
  /** 界深在 05-09 算例表外时的插值方式;不给就抛(99-08)。 */
  interpolate?: 'linear' | 'nearest';
  /** 厅堂要不要发戗;亭必发戗。 */
  qiangjiao?: boolean;
  /** 嫩戗发戗(缺省)或水戗发戗 [05-19]。 */
  faciang?: 'nen' | 'shui';
}

export interface FayuanFrame {
  jie: Jie;
  tizhan: Tizhan;
  chuyan: Chuyan;
  qiangjiao: Qiangjiao | null;
  /** 这一栋屋每个数字的来路,分证据/推定/艺术三支。 */
  provenance: Provenance;
  /** 以下全部为米,字段与 fashi 的 Frame.m 同义。 */
  m: {
    columnX: number[];
    depthHalf: number;
    columnH: number;
    columnD: number;
    /** 各柱生起;《营造法原》无生起制度,恒 0。 */
    rise: number[];
    /** 牌科仅桁间装饰(一斗三升),不出跳承重,故为 0 [05-11][05-13]。 */
    puzuoH: number;
    puzuoOut: number;
    /** 檐桁背的高度(地面起)= 柱高;连机/夹堂/枋子段高缺失(99-04)。 */
    eaveY: number;
    eaveHalf: number;
    /** 屋面剖面:自脊(攒尖为灯心木)到檐桁背,(x 离脊, y 离檐桁背)。 */
    purlins: { x: number; y: number; name: string }[];
    ridgeY: number;
    /** 檐出水平投影:出檐椽 + 飞椽,按梓桁三算半坡度折 [05-18][05-08]。 */
    yanchu: number;
    eaveTip: { out: number; drop: number };
    qiqiao: number;
    /** 江南无生出,恒 0。 */
    shengchu: number;
    rafterDia: number;
    /** 《营造法原》无椽当条,给 0。 */
    rafterPitch: number;
    lan: { w: number; t: number };
    /** 台明在 qing 01-17 小式档,不在 fayuan 参数集(99-13),给 0。 */
    base: number;
    /** 总面阔 / 总进深(柱心);亭为对边距(08-04 口径)。 */
    width: number;
    depth: number;
  };
}

export function deriveFayuan(book: RuleBook, spec: FayuanSpec): FayuanFrame {
  if (book.paramSet !== 'fayuan') {
    throw new Error(`deriveFayuan 需要 fayuan 参数集的 RuleBook,实际 ${book.paramSet}`);
  }
  const chiM = spec.chiCm / 100;

  const jie = deriveJie(book, spec);
  const isPavilion = (spec.form ?? (spec.tier === 'C' ? 'pavilion' : 'hall')) === 'pavilion';
  const tizhan = deriveTizhan(book, {
    kind: isPavilion ? 'ting' : 'hall',
    shape: spec.shape,
    jieDepthM: jie.jieDepthM,
    jieDepthChi: jie.jieDepthChi,
    halfJie: jie.halfJie,
    suanSeq: spec.suanSeq,
    interpolate: spec.interpolate,
    hallKind: spec.hallKind,
  });
  const chuyan = deriveChuyan(book, { jieDepthChi: jie.jieDepthChi, chiCm: spec.chiCm });

  const qiangjiao =
    isPavilion || spec.qiangjiao
      ? deriveQiangjiao(book, {
          shape: isPavilion ? (spec.shape as TingShape) : 'rect',
          tier: spec.tier,
          jieDepthM: jie.jieDepthM,
          jieDepthChi: jie.jieDepthChi,
          suanEave: tizhan.suan[0],
          chuyan,
          chiCm: spec.chiCm,
          faciang: spec.faciang ?? 'nen',
        })
      : null;

  const eaveY = jie.columnH;
  const ridgeY = eaveY + tizhan.ridgeRiseM;
  // 椽径 [05-22]:椽围 = 0.2×界深,径 = 围/π。
  const rafterDia = (jie.jieDepthChi * book.num('05-22', 'chuanWeiRatio') * chiM) / Math.PI;

  return {
    jie,
    tizhan,
    chuyan,
    qiangjiao,
    provenance: book.provenance(),
    m: {
      columnX: jie.columnX,
      depthHalf: jie.depthHalf,
      columnH: jie.columnH,
      columnD: jie.columnD,
      rise: jie.columnX.map(() => 0),
      puzuoH: 0,
      puzuoOut: 0,
      eaveY,
      eaveHalf: jie.depthHalf,
      purlins: tizhan.purlins,
      ridgeY,
      yanchu: chuyan.yanchuM,
      eaveTip: { out: chuyan.yanchuM, drop: chuyan.dropM },
      qiqiao: qiangjiao?.qiqiaoM ?? 0,
      shengchu: 0,
      rafterDia,
      rafterPitch: 0,
      // 枋 [05-22]:高 = 廊柱高×0.1,厚按斗(四六式 4 寸)。
      lan: {
        w: jie.columnH * book.num('05-22', 'fangGaoRatio'),
        t: (book.num('05-22', 'fangHouCun') / 10) * chiM,
      },
      base: 0,
      width: jie.width,
      depth: jie.depthHalf * 2,
    },
  };
}
