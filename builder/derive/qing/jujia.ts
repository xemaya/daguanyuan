/**
 * 举架:清式屋面曲线的真源。自下而上 y_i = y_{i-1} + k_i·s_i,
 * 脊高是累举的输出,不是预定的输入 [02-06]——与宋式举折自上而下相反 [02-11]。
 *
 * 步架长必须由调用方给:02-02(步架 22 斗口)已驳倒,均分法实测偏差
 * −33%~+34%。举架系数可用:按檩数在 02-05 配,原文实例与通行表两档
 * 必须显式选(带 choices 不选就抛,跟状态无关)。
 */
import type { RuleBook } from '../rules';
import { AmbiguousRuleError, MissingRuleError } from '../errors';

/** 02-05 表的一行;通行档里「0.7 或 0.65」这种并列值是字符串。 */
export interface JujiaRow {
  source: string;
  k: (number | string)[];
}

export interface JujiaSpec {
  /** 各步架长(米),自檐步向脊步;长度 = 半坡步数。 */
  stepsM: number[];
  /** 拽架总长(米)。带斗科大式原点在挑檐桁中,檐步含拽架 [02-06]。 */
  zhaijiaM: number;
}

export interface Purlin {
  /** 离脊桁中的水平距离(向檐)。 */
  x: number;
  /** 桁背高度(自挑檐桁背起算)。 */
  y: number;
  name: string;
}

export interface Jujia {
  /** 举架系数,自檐步向脊步 [02-05]。 */
  coeffs: number[];
  /** 总举高(米)= Σ k·s,挑檐桁背 → 脊桁背。 */
  H: number;
  /** 自脊桁到挑檐桁的桁背坐标。 */
  purlins: Purlin[];
  /** 各段坡度(dy/dx),自脊向檐。 */
  slopes: number[];
}

/** 檩数 → 02-05 表 source 的前缀用字(名称,不是营造数字)。 */
const LIN_PREFIX: Record<number, string> = { 5: '五檩', 6: '六檩', 7: '七檩', 9: '九檩', 11: '十一檩' };

/** 金桁命名 [02-01]:金步多于一步时分下/中/上。自檐向脊,按半坡步数−1 根。 */
const MIDDLE_NAMES: Record<number, string[]> = {
  1: ['金桁'],
  2: ['下金桁', '上金桁'],
  3: ['下金桁', '中金桁', '上金桁'],
};

/**
 * 按半坡步数在 02-05 配举架系数。选原文实例档还是通行表档由 RuleBook 的
 * choices 定;选中档里若檩数缺档或系数是「0.7 或 0.65」这种并列值,抛——
 * 取哪个原文没裁,不替它选。
 */
export function jujiaCoeffs(book: RuleBook, steps: number): number[] {
  const dang = book.choice<string>('02-05');
  const rows = book
    .table<JujiaRow>('02-05')
    .filter((r) => r.source.includes('原文') === dang.includes('原文'))
    .filter((r) => r.k.length === steps);
  const lin = LIN_PREFIX[2 * steps + 1];
  const row = (lin ? rows.find((r) => r.source.startsWith(lin)) : undefined) ?? rows[0];
  if (!row) {
    throw new MissingRuleError('02-05', `02-05 的${dang}里没有 ${2 * steps + 1} 檩(每坡 ${steps} 步)这一档。`);
  }
  if (row.k.some((v) => typeof v !== 'number')) {
    throw new AmbiguousRuleError(
      '02-05',
      `02-05「${row.source}」的系数是并列值 ${JSON.stringify(row.k)},取哪个须先裁定并结构化进规则表。`,
    );
  }
  return row.k as number[];
}

/** 檩位递推 [02-06]:x 累步架,y 累步架×举架。 */
export function deriveJujia(book: RuleBook, spec: JujiaSpec): Jujia {
  const k = jujiaCoeffs(book, spec.stepsM.length);
  book.use('02-06');
  // 带斗科大式檐步含拽架 [02-06;卷一算例 7.75 尺 = 廊 5.5 尺 + 拽架 2.25 尺,五举]。
  const s = spec.stepsM.slice();
  s[0] += spec.zhaijiaM;

  const n = s.length;
  const xE: number[] = [0];
  const yE: number[] = [0];
  for (let i = 0; i < n; i++) {
    xE.push(xE[i] + s[i]);
    yE.push(yE[i] + k[i] * s[i]);
  }
  const X = xE[n];
  const H = yE[n];

  const middle = MIDDLE_NAMES[n - 1] ?? Array.from({ length: n - 1 }, (_, i) => `金桁${i + 1}`);
  const namesEave = ['挑檐桁', ...middle, '脊桁'];
  const purlins: Purlin[] = [];
  for (let j = 0; j <= n; j++) {
    purlins.push({ x: X - xE[n - j], y: yE[n - j], name: namesEave[n - j] });
  }
  const slopes: number[] = [];
  for (let i = 1; i < purlins.length; i++) {
    slopes.push((purlins[i - 1].y - purlins[i].y) / (purlins[i].x - purlins[i - 1].x));
  }
  return { coeffs: k, H, purlins, slopes };
}
