/**
 * 出檐:带斗拱大式上檐出 = 挑檐桁中起 21 斗口 [03-02 存疑,甲更正:起点
 * 只能是挑檐桁中];檐椽出:飞椽出 = 2:1 [03-03——北方《工程做法》与江南
 * 《营造法原》独立给出同一比值,误差 0%,是 03 章最硬的一条];
 * 冲三翘四 [03-09][03-10]。
 *
 * 椽径选定卷一口径 0.35 × 桁径 [03-06 存疑:则例权衡表作 1.5 斗口,
 * 桁径 4 斗口(卷一)与 4.5 斗口(则例)不混用,差 12.5%]。
 */
import type { RuleBook } from '../rules';

export interface Chuyan {
  /** 上檐出(米):挑檐桁中 → 飞椽头外皮,21 斗口 [03-02]。 */
  shangyanchuM: number;
  /** 檐椽平出(米)= 14 斗口 [03-03]。 */
  yanchuanChuM: number;
  /** 飞椽平出(米)= 7 斗口 [03-03]。 */
  feichuanChuM: number;
  /** 正心桁径(米)= 4 斗口 [01-10]。 */
  hengDiaM: number;
  /** 檐椽径(米)= 0.35 × 桁径 [03-06]。 */
  rafterDiaM: number;
  /** 椽中距(米)= 2 × 椽径(椽当随椽径一份)[03-07]。 */
  rafterPitchM: number;
  /** 冲三(米)= 3 × 椽径 [03-09 存疑,两套口径不可通约,必须显式选]。 */
  chongM: number;
  /** 翘四(米)= 4 × 椽径 [03-10;无清代实测,unverifiable]。 */
  qiaoM: number;
}

export function deriveChuyan(book: RuleBook, dkM: number): Chuyan {
  const hengDiaM = book.num('01-10', 'zhengxinHengDk') * dkM;
  const rafterDiaM = book.num('03-06', 'rafterPerHengDia') * hengDiaM;
  return {
    shangyanchuM: book.num('03-02', 'tiaoyanToFeichuanDk') * dkM,
    yanchuanChuM: book.num('03-03', 'yanchuanChuDk') * dkM,
    feichuanChuM: book.num('03-03', 'feichuanChuDk') * dkM,
    hengDiaM,
    rafterDiaM,
    rafterPitchM: book.num('03-07', 'pitchToDiaRatio') * rafterDiaM,
    chongM: book.num('03-09', 'chongRafterDia') * rafterDiaM,
    qiaoM: book.num('03-10', 'qiaoRafterDia') * rafterDiaM,
  };
}
