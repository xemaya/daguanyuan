/**
 * 出檐与戗角:出檐椽/飞椽 [05-18],老戗 [05-16],嫩戗与泼水角 [05-17],
 * 水戗发戗 [05-19,存疑]。
 *
 * 转角斜长系数只有方五斜七加四(1.4,90° 转角)一档 [05-16];多边形亭的
 * 转角系数书里没有(99-04)——六角照抄 1.4 会把老戗放长 21.2%
 * (verify-suzhou A.4.1)。所以老戗长度只对矩形平面算,多边形亭的戗角
 * 只出嫩戗起翘(嫩戗全长 = 3×飞椽,泼水角,都不需要转角系数)。
 */
import type { RuleBook } from '../rules';
import type { TingShape } from './jie';

export interface ChuyanInput {
  jieDepthChi: number;
  /** 营造尺长(厘米)。 */
  chiCm: number;
}

export interface Chuyan {
  /** 出檐椽斜长(尺/米),已按 [1.6, 2.4] 尺、二寸一级取整。 */
  chuyanChi: number;
  chuyanM: number;
  feichuanM: number;
  /** 檐出水平投影(米),按下架坡度(梓桁三算半)折。 */
  yanchuM: number;
  /** 檐口下垂(米),同坡度。 */
  dropM: number;
}

/** 出檐椽与飞椽 [05-18];檐部坡度按梓桁提栈三算半 [05-08,存疑]。 */
export function deriveChuyan(book: RuleBook, spec: ChuyanInput): Chuyan {
  const lo = book.num('05-18', 'chuyanLoChi');
  const hi = book.num('05-18', 'chuyanHiChi');
  const step = book.num('05-18', 'chuyanStepChi');
  const raw = spec.jieDepthChi * book.num('05-18', 'chuyanJieRatio');
  const clamped = Math.min(hi, Math.max(lo, raw));
  // 「每进级以二寸为递加」「约为界深之半」——「约」给取整留了口子,取最近一级并记痕。
  const snapped = lo + Math.round((clamped - lo) / step) * step;
  const chuyanChi = book.artChoice(
    '05-18',
    `出檐椽 ≈0.5×界深 = ${raw.toFixed(3)} 尺,按二寸一级取最近一级 ${snapped.toFixed(1)} 尺(区间 [${lo}, ${hi}])`,
    snapped,
  );
  const chiM = spec.chiCm / 100;
  const chuyanM = chuyanChi * chiM;
  const feichuanM = chuyanM * book.num('05-18', 'feichuanRatio');

  // 檐部坡度:梓桁提栈三算半 [05-08],与清式飞檐三五举一致(跨体系互证 0% 误差)。
  const k = book.num('05-08', 'suanZiheng') / book.num('05-04', 'perSuan');
  const cos = 1 / Math.sqrt(1 + k * k);
  return {
    chuyanChi,
    chuyanM,
    feichuanM,
    yanchuM: (chuyanM + feichuanM) * cos,
    dropM: (chuyanM + feichuanM) * cos * k,
  };
}

export interface QiangjiaoInput {
  /** 'rect' 为厅堂矩形平面;多边形亭给具体形状。 */
  shape: 'rect' | TingShape;
  tier: 'B' | 'C';
  jieDepthM: number;
  jieDepthChi: number;
  /** 檐界算数(起算)。 */
  suanEave: number;
  chuyan: Chuyan;
  chiCm: number;
  faciang: 'nen' | 'shui';
}

export interface Qiangjiao {
  faciang: 'nen' | 'shui';
  /** 嫩戗泼水角(度,与水平)。水戗发戗无嫩戗,为 0。 */
  poshuiDeg: number;
  /** 嫩戗全长(米)= 3×飞椽长 [05-17]。 */
  nenLenM: number;
  /** 起翘竖高(米),自老戗端起。 */
  qiqiaoM: number;
  /** 老戗长度(米);仅矩形平面可算——多边形转角系数书里没有(99-04)。 */
  laoqiang?: { planInnerM: number; trueInnerM: number; materialM: number };
  /** 水戗砖脊参数 [05-19,存疑,出处与归类按更正值]。 */
  shuiqiang?: { shuidaiChi: number[]; angleDeg: number };
}

export function deriveQiangjiao(book: RuleBook, spec: QiangjiaoInput): Qiangjiao {
  const chiM = spec.chiCm / 100;

  let poshuiDeg = 0;
  let nenLenM = 0;
  let qiqiaoM = 0;
  let shuiqiang: Qiangjiao['shuiqiang'];

  if (spec.faciang === 'shui') {
    // 水戗发戗 [05-19]:老戗 + 角飞椽,无嫩戗。木骨起翘量书中无独立数值
    // (05 open_q 5);砖脊参数按更正值归「砖筑水戗」栏。戗座垫高 6~7 寸取中值,记 art。
    shuiqiang = {
      shuidaiChi: book.nums('05-19', 'shuidaiChi'),
      angleDeg: book.num('05-19', 'shuiqiangAngleDeg'),
    };
    qiqiaoM = (book.pickInRange('05-19', 'qiangzuoCun', 'mid') / 10) * chiM;
  } else {
    // 嫩戗发戗 [05-17]:全长 = 3×飞椽;泼水殿庭泼足 39°48′、亭阁酌收至少 32°。
    // 注意两处泼水的 atan 参数顺序相反(05-17 注),这里一律按「垂直 1 寸对水平 X 寸」取。
    nenLenM = book.num('05-17', 'nenLenRatio') * spec.chuyan.feichuanM;
    const degLo = (Math.atan(1 / book.num('05-17', 'poshuiTinggeRun')) * 180) / Math.PI;
    const degHi = (Math.atan(1 / book.num('05-17', 'poshuiDiantingRun')) * 180) / Math.PI;
    poshuiDeg =
      spec.tier === 'C'
        ? book.artChoice('05-17', `亭阁酌收,泼水取下限 ${degLo.toFixed(1)}°(至少 1 寸对 1 寸 6 分)`, degLo)
        : book.artChoice(
            '05-17',
            `厅堂泼水在亭阁下限 ${degLo.toFixed(1)}° 与殿庭泼足 ${degHi.toFixed(1)}° 之间,按 tiers.md Tier B 取中值`,
            (degLo + degHi) / 2,
          );
    qiqiaoM = nenLenM * Math.sin((poshuiDeg * Math.PI) / 180);
  }

  // 老戗 [05-16]:转角斜长系数只有方五斜七加四(1.4)一档,限 90° 转角。
  // 多边形亭的系数在 99-04(缺)——那里把六角 2/√3、八角 1/cos22.5° 与宝顶高、
  // 连机/夹堂/枋子高列在一起,该查刘敦桢《苏州古典园林》图版与《营造法原》第十三章。
  let laoqiang: Qiangjiao['laoqiang'];
  if (spec.shape === 'rect') {
    const factor = book.num('05-16', 'cornerFactor');
    const planInner = spec.jieDepthM * factor;
    const riseInner = (spec.jieDepthM * spec.suanEave) / book.num('05-04', 'perSuan');
    const trueInner = Math.sqrt(planInner * planInner + riseInner * riseInner);
    const planOuter = (spec.chuyan.chuyanM + book.num('05-16', 'fangchaChi') * chiM) * factor;
    const riseOuter = (planOuter * spec.suanEave) / book.num('05-04', 'perSuan');
    const trueOuter = Math.sqrt(planOuter * planOuter + riseOuter * riseOuter);
    const materialM = trueInner + trueOuter + 2 * ((book.num('05-16', 'endExtraCun') / 10) * chiM);
    laoqiang = { planInnerM: planInner, trueInnerM: trueInner, materialM };
  }

  return { faciang: spec.faciang, poshuiDeg, nenLenM, qiqiaoM, laoqiang, shuiqiang };
}
