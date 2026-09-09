/**
 * 举折:屋面曲线的真源。规则出处见 docs/fashi/04-jiaozhe.md。
 *
 * 举屋之法定脊槫高 H,折屋之法逐缝下折得每一槫的 (x, y)。
 * 坐标系:x 自脊槫心向檐(一侧),y 自橑檐枋背向上;单位与输入一致(分)。
 */

export type RoofClass = '殿阁' | '筒瓦厅堂' | '筒瓦廊屋' | '板瓦厅堂' | '板瓦廊屋';
export type Era = 'fashi' | 'tang' | 'liao' | 'fayuan';

/**
 * 举高比 H/L [04-03..04-06]。
 * - 法式:殿阁 1/3;筒瓦厅堂 L/4×1.08(梁思成 0.27,陈彤 0.33);筒瓦廊屋/板瓦厅堂 ×1.05;板瓦廊屋 ×1.03。
 * - 唐:≈L/4.4~4.8(佛光寺 0.225)[04-03 乙注];辽:≈L/4。
 * 江南提栈见 fayuan.ts。
 */
export function raiseRatio(cls: RoofClass, era: Era = 'fashi', chenTong = false): number {
  if (era === 'tang') return 0.225;
  if (era === 'liao') return 0.25;
  switch (cls) {
    case '殿阁':
      return 1 / 3;
    case '筒瓦厅堂':
      return chenTong ? 0.25 + 0.08 : 0.25 * 1.08;
    case '筒瓦廊屋':
    case '板瓦厅堂':
      return chenTong ? 0.25 + 0.05 : 0.25 * 1.05;
    case '板瓦廊屋':
      return chenTong ? 0.25 + 0.03 : 0.25 * 1.03;
  }
}

export interface JuzheSpec {
  /** 前后橑檐枋心距(殿阁)或前后檐柱心距(余屋不出跳)[04-02]。 */
  spanL: number;
  /** 半跨内各架平长,自脊向檐 [04-11];缺省等分。 */
  jiaLengths?: number[];
  /** 半跨椽架数(总椽数/2),jiaLengths 缺省时用。 */
  halfRafters?: number;
  /** 举高比;缺省按 raiseRatio(cls, era)。 */
  ratio?: number;
  cls?: RoofClass;
  era?: Era;
}

export interface Purlin {
  /** 离脊槫心的水平距离。 */
  x: number;
  /** 槫背高度(自橑檐枋背)。 */
  y: number;
  name: string;
}

export interface Juzhe {
  H: number;
  ratio: number;
  /** 自脊槫到橑檐枋的槫背坐标 [04-10]。 */
  purlins: Purlin[];
  /** 各架的坡度(dy/dx),自脊向檐。 */
  slopes: number[];
}

const NAMES = ['脊槫', '上平槫', '中平槫', '下平槫'];

/** 折屋之法 [04-08][04-10]。 */
export function deriveJuzhe(spec: JuzheSpec): Juzhe {
  const half = spec.spanL / 2;
  let a: number[];
  if (spec.jiaLengths) a = spec.jiaLengths.slice();
  else {
    const n = spec.halfRafters ?? 2;
    a = Array.from({ length: n }, () => half / n);
  }
  const sum = a.reduce((p, q) => p + q, 0);
  if (Math.abs(sum - half) > 1e-6 * Math.max(1, half)) {
    // 架道不匀时按比例缩到半跨 [04-09]。
    a = a.map((v) => (v * half) / sum);
  }
  const ratio = spec.ratio ?? raiseRatio(spec.cls ?? '殿阁', spec.era ?? 'fashi');
  const H = ratio * spec.spanL;

  const purlins: Purlin[] = [{ x: 0, y: H, name: NAMES[0] }];
  let fold = H / 10;
  let px = 0;
  let py = H;
  for (let k = 1; k < a.length; k++) {
    const x = px + a[k - 1];
    // 从上一缝已折定点向橑檐枋背拉直线,再下折 fold。
    const y = py + (0 - py) * ((x - px) / (half - px)) - fold;
    purlins.push({ x, y, name: k < NAMES.length ? NAMES[k] : `平槫${k}` });
    px = x;
    py = y;
    fold /= 2;
  }
  purlins.push({ x: half, y: 0, name: '橑檐枋' });

  const slopes: number[] = [];
  for (let i = 1; i < purlins.length; i++) {
    slopes.push((purlins[i - 1].y - purlins[i].y) / (purlins[i].x - purlins[i - 1].x));
  }
  return { H, ratio, purlins, slopes };
}

/**
 * 斗尖(攒尖)亭榭 [04-29]:自橑檐枋背至角梁底举 1/5,至上簇角梁举 1/2;
 * 只用板瓦者 4/10。簇角梁三折同折屋之制。这里给出沿角梁方向的剖面。
 * @param D 对角方向橑檐枋心距(四角亭=边长×√2)
 */
export function deriveDoujian(D: number, banwa = false, upperFrac = 0.42): Juzhe {
  const half = D / 2;
  const lower = banwa ? 0.4 * D : D / 5;
  // 下段(橑檐枋→角梁底)举 1/5,上段(→簇角梁顶)按半跨 1/2。
  const xUpper = half * upperFrac;
  const H = banwa ? lower : lower + xUpper * 0.5 * 2 * 0.5; // 上段举高 = 上段水平 × 1/2
  const purlins: Purlin[] = [
    { x: 0, y: H, name: '簇角梁顶' },
    { x: xUpper, y: banwa ? H * 0.55 : lower, name: '角梁底' },
    { x: half, y: 0, name: '橑檐枋' },
  ];
  // 三折同折屋之制:在角梁底与檐之间再折一缝。
  const fold = H / 10;
  const mid = { x: (xUpper + half) / 2, y: purlins[1].y / 2 - fold, name: '折缝' };
  purlins.splice(2, 0, mid);
  const slopes: number[] = [];
  for (let i = 1; i < purlins.length; i++) {
    slopes.push((purlins[i - 1].y - purlins[i].y) / (purlins[i].x - purlins[i - 1].x));
  }
  return { H, ratio: H / D, purlins, slopes };
}
