/**
 * qing 参数集(斗口制)——清官式 Tier A 的主干推导链。
 *
 * 与 fashi 同一个输出契约:m 段以米计 + provenance 三分。fashi 的材分/铺作
 * 子结构这里换成 doukou/dougong/jujia/chuyan 四段。
 *
 * **生成方向是反的**:斗口→构件断面在实物上成立,斗口→柱高/面阔全线被实测
 * 推翻(04 章结论,偏差 +26%~+82%)。Tier A 建筑不显式给斗口、只给柱高时,
 * 该走的反算函数书里没有(missing 99-02,六个口径互差 8%~21%)——诚实地抛,
 * 不编除数(见 doukou.ts)。
 */
import { RuleBook } from '../rules';
import type { Provenance } from '../provenance';
import { resolveDoukou, deriveDoukou, type DoukouSpec, type Doukou } from './doukou';
import { deriveDougong, type DougongSpec, type Dougong } from './dougong';
import { deriveJujia, type JujiaSpec, type Jujia } from './jujia';
import { deriveChuyan, type Chuyan } from './chuyan';

export type Tier = 'A' | 'B' | 'C';
export type RoofType = '庑殿' | '歇山' | '悬山' | '硬山' | '攒尖';

export interface QingSpec extends DoukouSpec {
  /** 建筑分档(tiers.md);qing 参数集只服务 Tier A 礼制大式。 */
  tier: Tier;
  /** 面阔间数,须为奇数(南北向对称)。 */
  bays: number;
  /** 进深总椽架数(偶数),与 fashi 同义。 */
  rafters: number;
  /** 屋顶形制;收山/推山等形制专属几何不在 Task 2 范围,先只记录。 */
  roofType: RoofType;
  /** 各间面阔(米),自明间向梢间,长度 = (bays+1)/2(左右镜像对称)。 */
  bayWidthsM?: number[];
  /** 斗科;不给按柱头科(无出跳,斗科总高按 0 计)。 */
  puzuo?: DougongSpec | null;
  /** 各步架长(米),自檐步向脊步,长度 = rafters/2。02-02 步架均分法已驳倒,
   * 必须由调用方给;不给就不出举架断面(purlins 为空)。 */
  stepsM?: number[];
}

export interface QingFrame {
  doukou: Doukou;
  dougong: Dougong | null;
  jujia: Jujia | null;
  chuyan: Chuyan;
  /** 这一栋屋每个数字的来路,分证据/推定/艺术三支。 */
  provenance: Provenance;
  /** 以下全部为米,字段与 fashi 的 Frame.m 同义(对照见 qingshi.schema.json §mapping)。 */
  m: {
    columnX: number[];
    depthHalf: number;
    columnH: number;
    columnD: number;
    /** 清式无生起制度,恒 0(tiers.md §1.1;侧脚/收分另见 doukou.shoufenM)。 */
    rise: number[];
    puzuoH: number;
    puzuoOut: number;
    /** 挑檐桁背的高度(地面起)= 柱净高 + 平板枋 + 斗科高。 */
    eaveY: number;
    eaveHalf: number;
    /** 屋面剖面:自脊桁到挑檐桁背,(x 离脊, y 离挑檐桁背)。无步架输入时为空。 */
    purlins: { x: number; y: number; name: string }[];
    ridgeY: number;
    /** 檐出水平投影 = 上檐出(挑檐桁中 → 飞椽头外皮)。 */
    yanchu: number;
    eaveTip: { out: number; drop: number };
    /** 翘四(米),对应 fashi 的起翘概念。 */
    qiqiao: number;
    /** 冲三(米),对应 fashi 的生出/翼角平面外推概念。 */
    shengchu: number;
    rafterDia: number;
    rafterPitch: number;
    lan: { w: number; t: number };
    /** 柱础/台明未在 Task 2 四段范围内,给 0(留待 P2/P3)。 */
    base: number;
    width: number;
    depth: number;
  };
}

/** 面阔柱位:half 自明间向梢间,长度 = (bays+1)/2,左右镜像出全部 bays 间。 */
function buildColumnX(bays: number, half: number[]): number[] {
  if (bays < 1 || bays % 2 === 0) {
    throw new Error(`清式大式面阔须为 ≥1 的奇数间(南北向对称),实际 ${bays}`);
  }
  const halfCount = (bays + 1) / 2;
  if (half.length !== halfCount) {
    throw new Error(
      `bayWidthsM 长度须为 ${halfCount}(明间 + 次/梢间,由中向外),实际 ${half.length}`,
    );
  }
  const widths: number[] = [half[0]];
  for (let i = 1; i < half.length; i++) {
    widths.unshift(half[i]);
    widths.push(half[i]);
  }
  const xs = [0];
  for (const w of widths) xs.push(xs[xs.length - 1] + w);
  const total = xs[xs.length - 1];
  return xs.map((x) => x - total / 2);
}

export function deriveQing(book: RuleBook, spec: QingSpec): QingFrame {
  if (book.paramSet !== 'qing') {
    throw new Error(`deriveQing 需要 qing 参数集的 RuleBook,实际 ${book.paramSet}`);
  }
  if (spec.rafters % 2 !== 0 || spec.rafters < 2) throw new Error('椽架数须为 ≥2 的偶数');

  // 斗口未给来源就走 99-02 反算——书里没有,诚实地抛(不 catch,让它冒出去)。
  const dkM = resolveDoukou(book, spec);

  const dougong = spec.puzuo ? deriveDougong(book, spec.puzuo, dkM) : null;
  const doukou = deriveDoukou(book, spec, dkM, dougong?.heightDk ?? 0);
  const chuyan = deriveChuyan(book, dkM);

  let jujia: Jujia | null = null;
  if (spec.stepsM) {
    const halfSteps = spec.rafters / 2;
    if (spec.stepsM.length !== halfSteps) {
      throw new Error(`stepsM 长度须为 rafters/2 = ${halfSteps},实际 ${spec.stepsM.length}`);
    }
    const jujiaSpec: JujiaSpec = { stepsM: spec.stepsM, zhaijiaM: dougong?.zhaijiaTotalM ?? 0 };
    jujia = deriveJujia(book, jujiaSpec);
  }

  // 挑檐桁背标高 = 柱净高 + 平板枋 + 斗科高,三段相加把 04-04 拆掉的 70 斗口立法值
  // 原样加回来——无论 columnHM 是走公式算出还是调用方直接覆盖,这里都自洽。
  const pingbanM = (dougong?.pingbanDk ?? 0) * dkM;
  const dougongHM = (dougong?.heightDk ?? 0) * dkM;
  const eaveY = doukou.columnHM + pingbanM + dougongHM;
  const ridgeY = eaveY + (jujia?.H ?? 0);

  // 大额枋广厚 [01-09]:清代阑额概念下 fashi 有单值,清式大/小额枋两档,
  // 骨架层用大额枋(承重主枋)近似;厚 = 高 − 0.8 斗口(01-09 的乙折算建议)。
  const lanWDk = book.num('01-09', 'daEfangHDk');
  const lanW = lanWDk * dkM;
  const lanT = (lanWDk - book.num('01-09', 'efangThicknessDeductDk')) * dkM;

  if (!spec.bayWidthsM) {
    throw new Error('bayWidthsM 未给:面阔柱位没有可用来源,不编造一个宽度。');
  }
  const columnX = buildColumnX(spec.bays, spec.bayWidthsM);
  const width = columnX[columnX.length - 1] - columnX[0];

  const eaveHalf = jujia ? jujia.purlins[jujia.purlins.length - 1].x : 0;
  const depthHalf = eaveHalf - (dougong?.zhaijiaTotalM ?? 0);
  const lastSlope = jujia && jujia.slopes.length ? jujia.slopes[jujia.slopes.length - 1] : 0;

  return {
    doukou,
    dougong,
    jujia,
    chuyan,
    provenance: book.provenance(),
    m: {
      columnX,
      depthHalf,
      columnH: doukou.columnHM,
      columnD: doukou.columnDM,
      rise: columnX.map(() => 0),
      puzuoH: dougongHM,
      puzuoOut: dougong?.zhaijiaTotalM ?? 0,
      eaveY,
      eaveHalf,
      purlins: jujia?.purlins ?? [],
      ridgeY,
      yanchu: chuyan.shangyanchuM,
      eaveTip: { out: chuyan.shangyanchuM, drop: chuyan.shangyanchuM * lastSlope * 0.85 },
      qiqiao: chuyan.qiaoM,
      shengchu: chuyan.chongM,
      rafterDia: chuyan.rafterDiaM,
      rafterPitch: chuyan.rafterPitchM,
      lan: { w: lanW, t: lanT },
      base: 0,
      width,
      depth: depthHalf * 2,
    },
  };
}

export type { DoukouSpec, Doukou, DougongSpec, Dougong, JujiaSpec, Jujia, Chuyan };
