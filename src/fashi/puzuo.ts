/**
 * 铺作(斗拱)推导。规则出处见 docs/fashi/02-puzuo.md。
 *
 * 下游只要两个量:出跳总长(橑檐枋心离柱心多远)和铺作总高(柱头到橑檐枋下皮)。
 * 其余分值尺寸给建模用。
 */
import { CAI } from './cai';

export interface PuzuoSpec {
  /** 铺作数 P ∈ [4, 8];P = T + 3,T 为出跳数 [02-02]。 */
  puzuo: 4 | 5 | 6 | 7 | 8;
  /**
   * 每跳心距(分)。法式上限 30 [02-03];唐辽实物 22~27,默认 30。
   * 可传数组逐跳覆盖 [02-04 乙注][02-05 乙注]。
   */
  jumpFen?: number | number[];
  /** 单栱造 / 重栱造 [02-24]。 */
  chonggong?: boolean;
  /** 六铺作以上昂上斗下降(分),2~5 [02-18];默认 3。 */
  angDropFen?: number;
  /** 补间朵数模式:法式当心间 2 朵 / 唐辽每间 1 朵 [02-25 存疑]。 */
  bujian?: 'fashi' | 'tangliao';
}

export interface Puzuo {
  P: number;
  T: number;
  jumpsFen: number[];
  /** 出跳总长(分),柱心到橑檐枋心 [02-05]。 */
  outFen: number;
  /** 铺作总高(分),栌斗底至橑檐枋下皮 [02-29]。 */
  heightFen: number;
  /** 每跳层高(分):单栱 36 / 重栱 57 [02-24]。 */
  perJumpHeightFen: number;
  /** 栌斗 [02-12]。 */
  ludou: { w: number; h: number };
  /** 当心间/次间/梢间补间朵数 [02-25]。 */
  bujianDuo: { center: number; side: number };
}

export function derivePuzuo(spec: PuzuoSpec): Puzuo {
  const P = spec.puzuo;
  if (P < 4 || P > 8) throw new Error(`铺作数 ${P} 超出 [4,8]`);
  const T = P - 3; // [02-02]

  let jumps: number[];
  if (Array.isArray(spec.jumpFen)) {
    jumps = spec.jumpFen.slice(0, T);
    while (jumps.length < T) jumps.push(jumps[jumps.length - 1] ?? 30);
  } else {
    const d = Math.min(30, spec.jumpFen ?? 30); // [02-03] 心不过三十分
    jumps = Array.from({ length: T }, () => d);
    // [02-04] 七铺作以上第二跳里外各减四分。
    if (P >= 7 && T >= 2) jumps[1] = d - 4;
  }
  const outFen = Math.min(150, jumps.reduce((a, b) => a + b, 0)); // [02-03] 不过一百五十分

  // [02-29] Hp = 33 + 21T;六铺作以上再降 2~5 分 [02-18]。
  const drop = P >= 6 ? (spec.angDropFen ?? 3) : 0;
  const heightFen = 12 + CAI.zuCai * T + CAI.zuCai - drop;

  const perJumpHeightFen = spec.chonggong ? 3 * CAI.guang + 2 * CAI.qiGuang : 2 * CAI.guang + CAI.qiGuang;

  const bujianDuo = spec.bujian === 'tangliao' ? { center: 1, side: 1 } : { center: 2, side: 1 };

  return {
    P,
    T,
    jumpsFen: jumps,
    outFen,
    heightFen,
    perJumpHeightFen,
    ludou: { w: 32, h: 20 },
    bujianDuo,
  };
}
