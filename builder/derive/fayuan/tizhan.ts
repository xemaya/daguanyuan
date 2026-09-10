/**
 * 提栈:每界高差 = 界深 × 算/10 [05-04],自廊(檐)桁推算至脊桁。
 *
 * 两条 legit 的来路,都不许碰 05-06(「个」的读法两人共同驳倒,引用即抛):
 *
 * 1. 厅堂走 05-09 算例表——六界、廊柱一丈的四行算例(界深 3.5/4/4.5/5 尺),
 *    逐界提栈高从表列柱高差出,含书中「囊金」取整。脊柱高只有用取整值才等于
 *    表列数(05-09 注:二选一必须明示),这里取**书中表列值**并记进 art。
 *    界深落在四行之间时**必须由 spec 显式声明 interpolate**——逐界插值法
 *    书里是空的(missing 99-08),不声明就抛,声明了记进 art 留痕。
 *
 * 2. 亭走 05-10:方亭五算起、六角/八角六算起;再往上「须先绘侧样」原文无
 *    定量,由 spec.suanSeq 显式给,缺省按 tiers.md Tier C(本项目取 6~7 算,
 *    脊部不做对算)取方亭递加序列 {7,8,9} 里的下一级,记进 art。
 */
import type { RuleBook } from '../rules';
import { MissingRuleError } from '../errors';
import type { HallKind, TingShape } from './jie';

export interface Purlin {
  /** 离脊(攒尖亭为灯心木)的水平距离。 */
  x: number;
  /** 桁背高度,自廊(檐)桁背起算。 */
  y: number;
  name: string;
}

export interface TizhanInput {
  kind: 'hall' | 'ting';
  shape?: TingShape;
  jieDepthM: number;
  jieDepthChi: number;
  /** 每坡界数。 */
  halfJie: number;
  /** 各界算数,自檐向脊;给了就不查表不取默认。 */
  suanSeq?: number[];
  /** 界深在 05-09 表外时的插值方式;不给就抛(99-08)。 */
  interpolate?: 'linear' | 'nearest';
  hallKind?: HallKind;
}

export interface Tizhan {
  /** 各界算数,自檐向脊。 */
  suan: number[];
  /** 各界提栈高(米),自檐向脊。 */
  risesM: number[];
  /** 自脊向檐的桁背坐标,y 自廊(檐)桁背。 */
  purlins: Purlin[];
  /** 总举高(米)。 */
  ridgeRiseM: number;
}

interface SuanliRow {
  界深尺: number;
  步柱: number;
  金童: number;
  脊柱: number;
}

const EPS = 1e-9;

/** 05-09 表的一行 → 每坡各界提栈高(尺),自檐向脊 [廊界, 金界, 脊界]。 */
function rowToRises(book: RuleBook, row: SuanliRow): number[] {
  const langzhu = book.num('05-09', 'langzhuGaoChi');
  return [row.步柱 - langzhu, row.金童, row.脊柱 - row.步柱 - row.金童];
}

function interpRow(a: SuanliRow, b: SuanliRow, at: number): SuanliRow {
  const t = (at - a.界深尺) / (b.界深尺 - a.界深尺);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return { 界深尺: at, 步柱: lerp(a.步柱, b.步柱), 金童: lerp(a.金童, b.金童), 脊柱: lerp(a.脊柱, b.脊柱) };
}

/** 厅堂:各界提栈高(尺),自檐向脊。 */
function hallRisesChi(book: RuleBook, spec: TizhanInput): number[] {
  // Explicitly authored side sections are allowed, but never masquerade as
  // another row from the six-jie historical table (including short corridors).
  if (spec.suanSeq) {
    book.artChoice('99-08', '由施工spec显式给各界算数；不是05-09六界算例表的史料值', spec.suanSeq);
    const perSuan = book.num('05-04', 'perSuan');
    return spec.suanSeq.map(s => spec.jieDepthChi * s / perSuan);
  }
  if (spec.halfJie !== 3) {
    // 05-09 算例表只覆盖六界(每坡 3 界)。七界的逐界递加只在 05-06 的更正值里,
    // 而 05-06 整条是 refuted——更正值待重写回「通过」档前,这里只能诚实地抛。
    throw new MissingRuleError(
      '99-08',
      `05-09 算例表只有六界(每坡 3 界);每坡 ${spec.halfJie} 界的逐界递加书里没有可编码规则` +
        '(05-06 歌诀的「个」读法已驳倒,其更正值尚未落回规则表)。该查:《营造法原》提栈章(建工 1986 影印本)。',
    );
  }
  const rows = book.table<SuanliRow>('05-09');
  const d = spec.jieDepthChi;

  const exact = rows.find((r) => Math.abs(r.界深尺 - d) < EPS);
  if (exact) {
    // 取书中「囊金」取整后的表列值,不取纯公式精确值(05-09 注:必须二选一并明示)。
    book.artChoice(
      '05-09',
      '脊柱/金童取书中囊金取整后的表列值,不取纯公式 Σd×算/10(后者在金童一项偏高 7~9%)',
      exact.脊柱,
    );
    return rowToRises(book, exact);
  }

  // 表外:插值方式必须显式声明。书里只有四行算例,插值是我们加的,得留痕。
  if (!spec.interpolate) {
    throw new MissingRuleError(
      '99-08',
      `界深 ${d} 尺落在 05-09 算例表(3.5/4/4.5/5 尺)之外,提栈逐界插值法书里没有(99-08)。` +
        '必须在 spec 里显式声明 interpolate: "linear" | "nearest";不许默默线性插。' +
        '该查:《营造法原》提栈章(建工 1986 影印本)。',
    );
  }
  const sorted = [...rows].sort((a, b) => a.界深尺 - b.界深尺);
  let row: SuanliRow;
  if (spec.interpolate === 'nearest') {
    row = sorted.reduce((p, q) => (Math.abs(q.界深尺 - d) < Math.abs(p.界深尺 - d) ? q : p));
  } else {
    const hi = sorted.find((r) => r.界深尺 > d);
    const lo = [...sorted].reverse().find((r) => r.界深尺 < d);
    if (!lo || !hi) {
      throw new MissingRuleError(
        '99-08',
        `界深 ${d} 尺在 05-09 算例表区间 [3.5, 5] 之外,linear 不能外推;` +
          '改用 interpolate: "nearest" 取端点行,或显式给 suanSeq。',
      );
    }
    row = interpRow(lo, hi, d);
  }
  book.artChoice(
    '99-08',
    `界深 ${d} 尺在 05-09 四行算例之外,按 spec 声明的 ${spec.interpolate} 在算例行间取——书里只有四个点,插值是我们加的`,
    spec.interpolate,
  );
  return rowToRises(book, row);
}

/** 亭:各界算数,自檐向脊 [05-10]。 */
function tingSuan(book: RuleBook, spec: TizhanInput): number[] {
  if (spec.suanSeq) {
    book.artChoice('05-10', '顶界算数原文「须先绘侧样定灯心木之高低长短」,无定量;由 spec.suanSeq 显式给', spec.suanSeq);
    return spec.suanSeq;
  }
  const suan1 =
    spec.shape === 'square' ? book.num('05-10', 'suan1Fangting') : book.num('05-10', 'suan1Duobian');
  const seq = book.nums('05-10', 'suanSeqFangting');
  const out = [suan1];
  for (let k = 2; k <= spec.halfJie; k++) {
    const next = seq[k - 2];
    if (next === undefined) {
      // 攒尖亭顶界算数原文无定量(99-04),use() 抛 MissingRuleError 并带 whereToLook;
      // 调用方可用 overrides['99-04'] 显式给顶界算数顶着(记进 art)。
      const r = book.use('99-04');
      if (typeof r.value !== 'number') {
        throw new MissingRuleError('99-04', '99-04 的覆盖值须为顶界算数(数字)。');
      }
      out.push(r.value);
      continue;
    }
    out.push(
      book.artChoice(
        '05-10',
        `第 ${k} 界算数原文须绘侧样酌定(无定量);按 tiers.md Tier C「本项目取 6~7 算,脊部不做对算」,` +
          `取方亭递加序列 {7,8,9} 的第 ${k - 1} 级 ${next} 算`,
        next,
      ),
    );
  }
  return out;
}

/** 脊桁提栈上限校核 [05-07]——约数式限度不是硬顶,超了记痕不抛。 */
function checkRidgeCap(book: RuleBook, spec: TizhanInput, suan: number[]): void {
  const capKey =
    spec.kind === 'ting'
      ? 'capTingzi'
      : spec.hallKind === '民房'
        ? 'capMinfang'
        : spec.hallKind === '圆堂'
          ? 'capYuantang'
          : spec.hallKind === '殿庭'
            ? 'capDianting'
            : 'capTing';
  const cap = book.num('05-07', capKey);
  const ridgeSuan = suan[suan.length - 1];
  if (ridgeSuan > cap) {
    book.artChoice(
      '05-07',
      `脊算 ${ridgeSuan} 超过歌诀上限 ${cap} 算;05-07 是约数式限度(吴中实测例亦不硬守),超出记痕`,
      ridgeSuan,
    );
  }
}

export function deriveTizhan(book: RuleBook, spec: TizhanInput): Tizhan {
  if (!Number.isInteger(spec.halfJie) || spec.halfJie < 1) throw new Error('halfJie 须为正整数');
  if (spec.suanSeq && (spec.suanSeq.length !== spec.halfJie ||
    spec.suanSeq.some(s => !Number.isFinite(s) || s <= 0)))
    throw new Error('suanSeq 须为每界一个有限正算数，长度等于 halfJie');
  const perSuan = book.num('05-04', 'perSuan');
  const dM = spec.jieDepthM;
  const dChi = spec.jieDepthChi;

  let suan: number[];
  let risesM: number[];
  if (spec.kind === 'hall') {
    const risesChi = hallRisesChi(book, spec);
    risesM = risesChi.map((r) => r * (dM / dChi));
    suan = risesChi.map((r) => (r / dChi) * perSuan);
  } else {
    suan = tingSuan(book, spec);
    if (suan.length !== spec.halfJie) throw new Error(`suanSeq 长度 ${suan.length} ≠ 每坡界数 ${spec.halfJie}`);
    risesM = suan.map((s) => (dM * s) / perSuan);
  }
  checkRidgeCap(book, spec, suan);

  // 自脊向檐拼桁坐标;y 自廊(檐)桁背 [05-04 自廊桁推算至脊桁]。
  const names = [spec.kind === 'hall' ? '脊桁' : '灯心木',
    ...Array.from({ length: spec.halfJie - 1 }, (_, i) => i === spec.halfJie - 2 ? '步桁' : '金桁'),
    spec.kind === 'hall' ? '廊桁' : '檐桁'];
  const purlins: Purlin[] = [];
  let x = 0;
  let y = risesM.reduce((a, b) => a + b, 0);
  purlins.push({ x, y, name: names[0] });
  for (let k = 0; k < spec.halfJie; k++) {
    y -= risesM[spec.halfJie - 1 - k];
    x += dM;
    purlins.push({ x, y, name: names[k + 1] });
  }
  return { suan, risesM, purlins, ridgeRiseM: risesM.reduce((a, b) => a + b, 0) };
}
