/**
 * 铺作(斗拱)推导。数字全部来自规则表,方括号里是规则号。
 *
 * 下游只要两个量:出跳总长(橑檐枋心离柱心多远)和铺作总高(柱头到橑檐枋下皮)。
 * 其余分值尺寸给建模用。
 */
import type { RuleBook } from '../rules';
import { caiModule } from './cai';

export interface PuzuoSpec {
  /** 铺作数 P ∈ [4, 8];P = T + 3,T 为出跳数 [02-02]。 */
  puzuo: 4 | 5 | 6 | 7 | 8;
  /**
   * 每跳心距(分)。法式上限 30 [02-03];唐辽实物 22~27。
   * 不给就取 [02-03] 的上限;可传数组逐跳覆盖 [02-04 乙注][02-05 乙注]。
   */
  jumpFen?: number | number[];
  /** 单栱造 / 重栱造 [02-24]。 */
  chonggong?: boolean;
  /** 六铺作以上昂上斗下降(分)[02-18];不给取该区间下限。 */
  angDropFen?: number;
}

// 补间朵数 [02-25 存疑] 有法式与唐辽两个口径,由 RuleBook 的 choices 选定
// (见 builder/derive/profiles.ts),不在这里开第二个入口——同一件事两个开关必然打架。

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

export function derivePuzuo(book: RuleBook, spec: PuzuoSpec): Puzuo {
  const P = spec.puzuo;
  const pMinusT = book.num('02-02', 'pMinusT');
  const tMin = book.num('02-02', 'tMin');
  const tMax = book.num('02-02', 'tMax');
  const T = P - pMinusT; // [02-02] 出一跳谓之四铺作
  if (T < tMin || T > tMax) throw new Error(`铺作数 ${P} 超出 [${tMin + pMinusT}, ${tMax + pMinusT}] [02-02]`);

  const maxJump = book.num('02-03', 'maxJumpFen'); // [02-03] 心不过三十分
  const maxTotal = book.num('02-03', 'maxTotalChutiaoFen'); // 传跳虽多,不过一百五十分

  let jumps: number[];
  if (Array.isArray(spec.jumpFen)) {
    jumps = spec.jumpFen.slice(0, T);
    while (jumps.length < T) jumps.push(jumps[jumps.length - 1] ?? maxJump);
  } else {
    const d = Math.min(maxJump, spec.jumpFen ?? maxJump);
    jumps = Array.from({ length: T }, () => d);
    // [02-04] 七铺作以上第二跳里外各减四分。
    const cut = book.raw('02-04');
    if (P >= 7 && T >= 2 && cut) jumps[1] = d - 4;
  }
  const outFen = Math.min(maxTotal, jumps.reduce((a, b) => a + b, 0));

  // [02-29] Hp = 33 + 21T;[02-18] 六铺作以上再降 2~5 分。
  const dropFromP = book.num('02-18', 'dropFromP');
  const drop =
    P >= dropFromP
      ? (spec.angDropFen ??
        book.artChoice('02-18', '六铺作以上昂上斗降 2~5 分,未指定时取下限', book.num('02-18', 'angDropFenMin')))
      : 0;
  const heightFen = book.num('02-29', 'hpBaseFen') + book.num('02-29', 'hpPerJumpFen') * T - drop;

  const perJumpHeightFen = spec.chonggong
    ? book.num('02-24', 'chongGongPerJumpFen')
    : book.num('02-24', 'danGongPerJumpFen');

  // [02-25 存疑] 两个读法都有出处,调用方必须显式选,不许代码里默认。
  const duo = book.choice<{ center: number; side: number }>('02-25');

  return {
    P,
    T,
    jumpsFen: jumps,
    outFen,
    heightFen,
    perJumpHeightFen,
    ludou: { w: book.num('02-12', 'ludouWFen'), h: book.num('02-12', 'ludouHFen') },
    bujianDuo: { ...duo },
  };
}

/** 足材广,给 puzuo 之外的地方引用(不出跳时橑檐枋近似高)[01-04]。 */
export function zuCaiFen(book: RuleBook): number {
  return caiModule(book).zuCai;
}
