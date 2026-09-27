import type {Provenance} from '../provenance';
import type {deriveRusticBuilding} from './building';

/**
 * 乡野子档(C-r)近景细部尺寸——单子 BA2。
 *
 * 框架尺寸(开间、进深、柱高、坡、茅厚、出檐)一律来自 `deriveRusticBuilding`,这里不重给。
 * 这里只收**框架之外、近景要画出来**的那些数:墙厚、版筑层高、椽径椽距、檩径、出际、门窗洞。
 * R-03:C-r 不接任何模数链,两套书里都没有茅屋——所以下面**每一个数都是艺术选择**,
 * 逐条进 `provenance.art`,不冒充史料。能挂到原文的只有「黄泥版筑」「纸窗」「茅苫」三个名目本身。
 *
 * 取数习惯:能取整尺(营造尺 0.32 m,`tiers.md` 元规则 3)的取整尺,方便日后有据时整体替换。
 */
type Frame=ReturnType<typeof deriveRusticBuilding>;
export interface RusticDetail {
  /** 土壁厚(版筑墙体)。 */
  wallThicknessM:number;
  /** 土壁外皮相对柱中线外移——柱子半露在土壁外。 */
  wallOutsetM:number;
  /** 版筑一版的高(层线间距)。门窗洞上下口对齐层线。 */
  liftM:number;
  /** 椽径、椽中距;椽头缩进茅檐的距离。 */
  rafterDM:number;rafterPitchM:number;rafterTipSetbackM:number;
  /** 檩径(脊檩、金檩);檐檩由额枋兼。 */
  purlinDM:number;
  /** 悬山两山出际(茅苫挑出山墙的距离)。 */
  gableOverhangM:number;
  /** 茅苫山边(出际草边)卷边的半径;檐口草茬面向内斜收的量。 */
  vergeRollM:number;eaveUndercutM:number;
  /** 草脊(压脊草把)半宽、半高、捆扎间距。 */
  ridgeRollHalfWidthM:number;ridgeRollHalfHeightM:number;ridgeTiePitchM:number;
  /** 台基四面出边。 */
  platformMarginM:number;
  /** 门洞:宽、高(层数)。窗洞:宽、下口层数、高层数。 */
  doorWidthM:number;doorLifts:number;
  windowWidthM:number;windowSillLifts:number;windowLifts:number;
  /** 直棂窗棂条宽、棂距。 */
  mullionM:number;mullionPitchM:number;
  provenance:Provenance;
}

export function deriveRusticDetail(frame:Frame):RusticDetail {
  const m=frame.m;
  if(frame.paramSet!=='rustic')throw new Error('乡野细部只接C-r框架');
  const chi=.32;
  const d={
    wallThicknessM:chi,wallOutsetM:+(m.columnD*.2).toFixed(4),liftM:chi,
    rafterDM:.09,rafterPitchM:.42,rafterTipSetbackM:.08,
    purlinDM:.16,
    // 出际与出檐同取推导器的 yanchu:两山挑出与前后檐一样深,悬山读得出。
    gableOverhangM:m.yanchu,
    vergeRollM:.13,eaveUndercutM:.04,
    ridgeRollHalfWidthM:.2,ridgeRollHalfHeightM:.13,ridgeTiePitchM:.72,
    platformMarginM:.45,
    doorWidthM:1.28,doorLifts:6,
    windowWidthM:.96,windowSillLifts:3,windowLifts:3,
    mullionM:.035,mullionPitchM:.11,
  };
  const clear=Math.min(...m.columnX.slice(1).map((x,i)=>x-m.columnX[i]))-m.columnD;
  if(d.doorWidthM>=clear||d.windowWidthM>=clear)throw new Error('乡野门窗洞宽过开间净宽');
  if((d.doorLifts)*d.liftM>=m.columnH-m.lan.w)throw new Error('乡野门洞高过额枋下皮');
  if((d.windowSillLifts+d.windowLifts)*d.liftM>=m.columnH-m.lan.w)throw new Error('乡野窗洞高过额枋下皮');
  const art=(id:string,name:string,note:string)=>({id:`project:rustic-${id}`,name,method:'artistic_choice',note});
  return {...d,provenance:{evidence:[],inference:[],art:[
    art('earth-wall','黄泥版筑土壁厚与层高',`07-11「黃泥筑就」只给名目不给尺寸；墙厚与一版层高均取一尺(${chi} m)，土壁外皮外移柱径的两成，使柱半露于壁外。门窗洞上下口对齐层线。`),
    art('rafter','椽径椽距与椽头缩进','乡野茅檐「由苫厚与椽出直接给，不算飞椽」(tiers §1.4)，椽径 0.09 m、中距 0.42 m、椽头缩进茅檐 0.08 m 为近景观感取值。'),
    art('purlin','檩径','脊檩与金檩径 0.16 m；檐檩由额枋兼，不另设。穿斗山面：中柱落地通脊，金檩下立瓜柱于穿枋上。'),
    art('gable-overhang','悬山出际',`两山出际取与出檐同(${m.yanchu} m，推导器 yanchu)；书无茅屋出际条文。`),
    art('thatch-edge','茅苫草边与檐口草茬','出际草边卷作半径 0.13 m 的草卷(下垂出苫底 0.02 m、上鼓出苫面)；檐口一刀齐的草茬面自顶向下内收 0.04 m，使厚边迎光。'),
    art('ridge-roll','草脊','屋脊压一道草把(半宽 0.2 m、半高 0.13 m)，每 0.72 m 一道草绳捆扎；C-r 无脊件(R-03)，草把不是脊件。'),
    art('platform','土台出边','台基四面出边 0.45 m；台高沿用规格 platformH。'),
    art('openings','门窗洞','门洞宽四尺(1.28 m)、高六版；纸窗洞宽三尺、下口三版、高三版；直棂宽 0.035 m、中距 0.11 m。07-13「紙窗」只给名目。'),
  ]}};
}
