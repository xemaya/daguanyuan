import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { taihuMaterial } from '@builder/parts/materials';
import { metaSurface, noiseDisplace, type Ball } from '@builder/parts/sculpt';
import { makeRng, rangeOf, Simplex, clamp, lerp, smoothstep } from '@engine/core/Noise';

/**
 * 太湖石 — 零资产程序化。
 *
 * 瘦:纵向拉长的椭球沿一条微弯的脊线堆成柱,腰细、顶略大于腰。
 * 皱:两层沿法线的位移——纵向拉伸的 ridged 噪声出竖褶,细 fbm 出皮。
 * 漏/透:负球贯穿雕出真孔(front 看穿 Z 向孔、side 看穿 X 向孔),
 *        浅负球在表面留坑。孔位存在 `root.userData.holes` 里给检验脚本打光线。
 *
 * variant:
 *   peak   独峰 2.4–2.8m,主景石
 *   mound  假山组 ~6×4×3m,中间一条 1.2m 曲径从 +Z 进 -Z 出
 *   edge   驳岸小石 0.5–0.8m,矮胖
 * 带数字换种子:`peak2` / `peak:2` / `peak-2`。
 *
 * 顶点色:用球场本身当占据函数烤 cavity AO(孔洞、褶皱内发暗),脚下泛青潮湿,
 * 再叠一层低频明度变化——材质 `taihuMaterial()` 开了 vertexColors,相乘生效。
 */

const ISO = 0.35;

/* ------------------------------------------------------------------ */
/* 球场                                                                */
/* ------------------------------------------------------------------ */

/** 与 Sculpt.metaSurface 同一套 Wyvill 场,用来做 AO 采样与走廊净空校验。
 *  (导出给 `baishi.ts`:负球强度要跟着这一点的实心场走,不然胖处挖不穿。) */
export function fieldAt(balls: Ball[], px: number, py: number, pz: number): number {
  let sum = 0;
  for (const b of balls) {
    const s = b.strength ?? 1;
    const ex = (px - b.x) / (b.sx ?? 1);
    const ey = (py - b.y) / (b.sy ?? 1);
    const ez = (pz - b.z) / (b.sz ?? 1);
    const d2 = ex * ex + ey * ey + ez * ez;
    const r2 = b.r * b.r;
    if (d2 > r2 * 4) continue;
    const q = clamp(d2 / (r2 * 4), 0, 1);
    const f = 1 - q;
    sum += s * f * f * f;
  }
  return sum;
}

/* ------------------------------------------------------------------ */
/* 石头描述                                                            */
/* ------------------------------------------------------------------ */

export interface HoleLine {
  /** 孔轴线的两个端点(构件局部坐标,已含摆放变换)。 */
  a: [number, number, number];
  b: [number, number, number];
  /** 期望在哪个棚拍角度看穿。 */
  view: 'front' | 'side';
}

/**
 * **磨平一块正面**(摩崖题字的那一刀;单子 AM3)。
 *
 * 做法与 `clipToGround` 同一路数——后者把 y<0 的点压到 y=0 这个**水平面**上,
 * 这里把正面(+Z 半球)一扇窗口里的点压到 z=plane 这个**竖直面**上。
 *
 * 三条不得不讲的:
 *   ① **双向投影,但两个方向的判据不一样**。凸出平面的点一律压回去(不看法线);
 *      凹进平面的点只提法线朝前的那些。理由见 `flattenFace` 里的两段注释——
 *      压回去压不塌石头(平面在 z>0 一侧),提上来却会把背面与侧壁拽穿。
 *      只压凸的也不行:窗口里原有的凿沟会留成坑,字面就不是一个平面。
 *   ② 平面位置不是外部写死的数,是**从这块石头自己量出来的**:取窗口内正面
 *      顶点 z 的 `q` 分位数。石头是噪声长出来的,正面在哪一层每颗种子都不同,
 *      写死 z 会要么切掉半块石头、要么悬在皮外面什么也没磨到。q<0.5 让平面
 *      落在皮下一点——磨面**凹进去**、四周的石头凸在外边,读作「刻出来的」
 *      而不是「削掉的」;q 大一点则更像「磨掉一层」。
 *   ③ 窗口是**椭圆**、边缘 `feather` 一段内按 smoothstep 过渡:矩形硬边会在
 *      剪影上留一道刀切的直棱(台面感),椭圆软边给出一圈斜坡,像凿子收口。
 */
export interface FlattenSpec {
  /** 椭圆窗口的中心与两个半轴(局部坐标,y 自石脚起算)。 */
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  /** 边缘过渡带,按归一化半径算:0.2 = 最外 20% 是斜坡。 */
  feather: number;
  /** 平面取窗口内正面顶点 z 的第几分位,缺省 0.3(磨面略凹)。 */
  q?: number;
}

/**
 * **石上的苔**(单子 AM4)。07-03 那个「翠」字的来处是石上的绿,不是树,
 * 所以它必须长在**白石本身**上——顶点色里多混一路,**零三角、零 draw call**。
 *
 * 两条参数都是冲着「成斑、不是刷绿漆」去的:
 *   ① **朝上才长**:`up`/`upSoft` 在光滑法线的 y 上做 smoothstep。为什么不是硬阈值
 *      ——硬切会沿等高法线画出一条边界,整块峰读成「戴了顶绿帽子」;软过渡让
 *      苔从朝天面顺着肩往侧面淡出去,像淋上去的。
 *   ② **低频噪声决定哪一块长**:两层 simplex(`patch` m 为特征尺度的主斑 +
 *      一半尺度的破边),再经 `coverage` 的 smoothstep 切出斑块边界。只有 ①
 *      没有 ② 就是「所有朝天面一律染绿」= 刷绿漆,判据直接判死。
 *
 * 苔色偏暗:白石的顶点色基线是 0.5 灰,苔要压到它下面一档才像「石头上长了东西」,
 * 提亮的绿会读作**上了色的石头**。
 */
export interface MossSpec {
  /** 苔色(线性 RGB,与 0.5 灰的基线同一把尺子)。 */
  color?: [number, number, number];
  /**
   * 朝上判据:**光滑法线**(`snormal`,皱之前的那一份)的 y 从 `up - upSoft`
   * 到 `up + upSoft` 之间 smoothstep 抬起来。为什么不是真法线见 `bakeColors`。
   */
  up?: number;
  upSoft?: number;
  /** 一块苔斑的特征尺度(m)。 */
  patch?: number;
  /** 覆盖率旋钮:噪声要超过它才算长苔,越小苔越多(噪声域约 [-1,1])。 */
  coverage?: number;
  /** 斑块边界的软硬:0 = 刀切,大 = 渐隐。 */
  edge?: number;
  /** 最浓处混进去多少(0–1)。1 = 完全盖成苔色。 */
  strength?: number;
}

/**
 * 一块石头的参数化描述。`baishi.ts` 复用同一套字段(它自己排球场,`waist`/`plate`/
 * `holes`/`pits` 由它自己的剖面函数解读),所以这里导出。
 */
export interface StoneSpec {
  /** 脊线顶高(m),有效顶再高一点。 */
  height: number;
  /** 底宽(m)。 */
  width: number;
  /** 瘦的程度:腰宽/底宽。 */
  waist: number;
  /** 穿透孔的数量。 */
  holes: number;
  /** 浅坑数量。 */
  pits: number;
  /** 矮胖(驳岸石)。 */
  squat?: boolean;
  /** 网格单元边长(m),控制三角数。 */
  cell: number;
  /** 褶皱幅度倍率。 */
  wrinkle: number;
  /** 板状程度:X 放大、Z 缩小的倍率,1 = 圆柱。 */
  plate?: number;
  /** 磨平正面的一块(单子 AM3 的题字石用),缺省不磨——太湖石三个 variant 逐位不变。 */
  flatten?: FlattenSpec;
  /**
   * 皱与细皮的**频率**倍率(不动幅度),缺省 1。
   *
   * 两层位移的频率都按 `scale = height/2.6` 反比给,于是"石头越高,纹路越粗"——
   * 2.6m 的湖石正好,5m 的白石峰就把竖沟拉成了从顶流到底的一条,读作**蜡烛**。
   * 高石头传 >1 把纹路收回人眼尺度。缺省 1 保证太湖石三个 variant 逐位不变。
   */
  wrinkleFreq?: number;
  /** 石上长苔(单子 AM4 的白石峰用),缺省不长——太湖石三个 variant 逐位不变。 */
  moss?: MossSpec;
  seed: number;
}

export interface StoneResult {
  geo: THREE.BufferGeometry;
  balls: Ball[];
  holes: HoleLine[];
  /** 有效顶高。 */
  top: number;
  /** 磨平面实际落在的 z(局部坐标);没磨就没有。字面要贴在它前面。 */
  flatZ?: number;
}

/** 剖面半径:t∈[0,1] 自下而上。 */
function profile(t: number, spec: StoneSpec): number {
  const W = spec.width * 0.5;
  if (spec.squat) {
    // 矮胖:上宽下略收,像半埋的卵石。
    const pts: [number, number][] = [
      [0, 0.92],
      [0.3, 1.0],
      [0.7, 0.9],
      [1, 0.55],
    ];
    return W * piecewise(t, pts);
  }
  const w = spec.waist;
  const pts: [number, number][] = [
    [0, 1.0],
    [0.1, 0.82],
    [0.34, w],
    [0.56, w + 0.06],
    [0.78, w + 0.16],
    [0.92, w + 0.1],
    [1, w - 0.06],
  ];
  return W * piecewise(t, pts);
}

/** 折线插值(smoothstep 缓和),剖面控制点用。导出给 `baishi.ts` 的峰剖面。 */
export function piecewise(t: number, pts: [number, number][]): number {
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const u = (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return lerp(pts[i - 1][1], pts[i][1], smoothstep(0, 1, u));
    }
  }
  return pts[pts.length - 1][1];
}

/** 沿脊线堆球 + 侧瘤 + 贯穿负球 + 浅坑。 */
function buildBalls(spec: StoneSpec): { balls: Ball[]; holes: HoleLine[] } {
  const rng = makeRng(spec.seed);
  const H = spec.height;
  const balls: Ball[] = [];
  const holes: HoleLine[] = [];

  // 脊线:微弯、微倾,不是一根直棍。
  const leanX = rangeOf(rng, -0.05, 0.05);
  const leanZ = rangeOf(rng, -0.04, 0.04);
  const ph1 = rangeOf(rng, 0, Math.PI * 2);
  const ph2 = rangeOf(rng, 0, Math.PI * 2);
  const spine = (y: number): [number, number] => [
    leanX * y + 0.055 * H * Math.sin((y / H) * 2.4 + ph1) * (spec.squat ? 0.3 : 1),
    leanZ * y + 0.045 * H * Math.sin((y / H) * 1.9 + ph2) * (spec.squat ? 0.3 : 1),
  ];

  // 裙脚:一颗压扁的大球贴地,最宽圈落在地面。
  {
    const r = profile(0, spec) / 1.09;
    balls.push({ x: 0, y: 0.02, z: 0, r: r * 0.98, sx: rangeOf(rng, 1.0, 1.1), sy: 0.5, sz: rangeOf(rng, 1.0, 1.1) });
  }

  // 主体:等距堆叠的竖向椭球,半径按剖面。重叠会互相加厚,所以半径打八折。
  const step = spec.squat ? H * 0.34 : Math.max(0.24, H / 8.5);
  const n = Math.max(2, Math.round(H / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = t * H;
    const [sx0, sz0] = spine(y);
    const pr = profile(t, spec) / 1.09;
    const shrink = spec.squat ? 0.9 : 0.8;
    const sy = spec.squat ? 0.75 : rangeOf(rng, 1.25, 1.5);
    // 板状:太湖石立着看的是"面",X 宽 Z 薄,Z 向的孔才容易看穿。
    const plate = spec.squat ? 1 : spec.plate ?? 1.2;
    balls.push({
      x: sx0 + rangeOf(rng, -0.03, 0.03) * spec.width,
      y,
      z: sz0 + rangeOf(rng, -0.02, 0.02) * spec.width,
      r: pr * shrink,
      sx: rangeOf(rng, 0.95, 1.15) * plate,
      sy,
      sz: rangeOf(rng, 0.95, 1.15) / plate,
    });
  }

  // 侧瘤:打破对称,给剪影一点"头大/肩歪"。
  const lobes = spec.squat ? 2 : 3;
  for (let i = 0; i < lobes; i++) {
    const t = spec.squat ? rangeOf(rng, 0.15, 0.5) : rangeOf(rng, 0.45, 0.95);
    const y = t * H;
    const [sx0, sz0] = spine(y);
    const pr = profile(t, spec);
    const a = rangeOf(rng, 0, Math.PI * 2);
    const off = pr * rangeOf(rng, 0.55, 0.8);
    balls.push({
      x: sx0 + Math.cos(a) * off,
      y,
      z: sz0 + Math.sin(a) * off,
      r: pr * (spec.squat ? rangeOf(rng, 0.4, 0.55) : rangeOf(rng, 0.5, 0.68)),
      sx: rangeOf(rng, 0.85, 1.2),
      sy: spec.squat ? 0.7 : rangeOf(rng, 1.1, 1.6),
      sz: rangeOf(rng, 0.85, 1.2),
    });
  }

  // 贯穿孔:front 看的沿 Z,side 看的沿 X,交替。负球沿轴拉长到盖过整块石头。
  const span = spec.width * 1.6;
  for (let i = 0; i < spec.holes; i++) {
    const alongZ = i % 2 === 0;
    const t = spec.squat ? rangeOf(rng, 0.45, 0.7) : lerp(0.44, 0.9, (i + rangeOf(rng, 0.25, 0.75)) / spec.holes);
    const y = t * H;
    const [sx0, sz0] = spine(y);
    const pr = profile(t, spec);
    const r = clamp(pr * (spec.squat ? rangeOf(rng, 0.24, 0.3) : rangeOf(rng, 0.3, 0.4)), 0.06, 0.2);
    // 孔轴偏离脊线,留一侧厚壁,不然把石头切成两半。
    const side = rng() < 0.5 ? -1 : 1;
    const off = pr * rangeOf(rng, 0.25, 0.45) * side;
    const x = alongZ ? sx0 + off : sx0;
    const z = alongZ ? sz0 : sz0 + off;
    const axisScale = span / (2 * r);
    // 负球强度跟着这一点的实心场走:胖石头里球叠得厚,固定强度挖不穿。
    const f0 = fieldAt(balls, x, y, z);
    balls.push({
      x,
      y,
      z,
      r,
      strength: spec.squat ? -(f0 * 1.2 + 0.5) : -(f0 * 1.6 + 0.8),
      sx: alongZ ? rangeOf(rng, 0.85, 1.1) : axisScale,
      sy: spec.squat ? rangeOf(rng, 0.9, 1.1) : rangeOf(rng, 1.2, 1.6),
      sz: alongZ ? axisScale : rangeOf(rng, 0.85, 1.1),
    });
    holes.push(
      alongZ
        ? { a: [x, y, span], b: [x, y, -span], view: 'front' }
        : { a: [span, y, z], b: [-span, y, z], view: 'side' },
    );
  }

  // 浅坑:不穿透的负球,贴在表面上,"漏"的碎口。
  for (let i = 0; i < spec.pits; i++) {
    const t = rangeOf(rng, 0.15, 0.95);
    const y = t * H;
    const [sx0, sz0] = spine(y);
    const pr = profile(t, spec);
    const a = rangeOf(rng, 0, Math.PI * 2);
    const d = pr * rangeOf(rng, 0.95, 1.15);
    balls.push({
      x: sx0 + Math.cos(a) * d,
      y,
      z: sz0 + Math.sin(a) * d,
      r: pr * rangeOf(rng, 0.28, 0.42),
      strength: rangeOf(rng, -0.7, -1.1),
      sy: rangeOf(rng, 1.2, 1.8),
    });
  }

  return { balls, holes };
}

/* ------------------------------------------------------------------ */
/* 变形与烘焙                                                          */
/* ------------------------------------------------------------------ */

/**
 * 皱:竖向拉伸的 ridged 噪声沿法线位移。y 方向频率压到 1/3,褶子就竖着走。
 * 返回每顶点的位移量,后面烤色用(褶皱谷底发暗)。
 */
function wrinkle(geo: THREE.BufferGeometry, seed: number, amp: number, freq: number): Float32Array {
  const s1 = new Simplex(seed);
  const s2 = new Simplex(seed + 31);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeVertexNormals();
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const out = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // 两个八度的 ridged:1-|n| 出尖脊,平方出深谷。
    // 两个八度的 groove:噪声过零处是细而深的沟,沟间是宽脊——太湖石的"皱"是沟不是棱。
    let groove = 0;
    let a = 1;
    let f = freq;
    let norm = 0;
    for (let o = 0; o < 2; o++) {
      const nn = 1 - Math.abs(s1.noise3D(x * f, y * f * 0.3, z * f));
      groove += a * nn * nn * nn;
      norm += a;
      a *= 0.6;
      f *= 2.2;
    }
    groove /= norm;
    // 低频起伏,免得柱身太"车出来"。
    const bulge = s2.noise3D(x * freq * 0.5, y * freq * 0.35, z * freq * 0.5);
    const d = -(groove - 0.25) * 1.5 * amp + bulge * amp * 0.9;
    out[i] = d;
    pos.setXYZ(i, x + nor.getX(i) * d, y + nor.getY(i) * d, z + nor.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return out;
}

/**
 * 磨面:见 `FlattenSpec`。返回平面实际落在的 z(局部),没磨到东西返回 undefined。
 * 在皱与细皮之后、落地裁切之前调用——裁切末尾会重算法线,磨面自然跟着更新。
 */
function flattenFace(geo: THREE.BufferGeometry, f: FlattenSpec): number | undefined {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  // 窗口权重:椭圆,不是矩形。矩形的四角会切在石头的侧棱上留下两条直缝;
  // 椭圆在上下两头自己收细,顶上那截脖子只被蹭到一点点,碎顶留得住。
  const window = (i: number): number => {
    const dx = (pos.getX(i) - f.cx) / f.hx;
    const dy = (pos.getY(i) - f.cy) / f.hy;
    return smoothstep(1, 1 - f.feather, Math.hypot(dx, dy));
  };
  // 平面从「正面那层皮」上取分位:只拿窗口核心里法线朝前的点。
  // 拿整块石头的 z 取分位会把背面与侧壁算进去,平面直接落到石心里。
  const front: number[] = [];
  for (let i = 0; i < pos.count; i++)
    if (window(i) > 0.5 && nor.getZ(i) > 0.45 && pos.getZ(i) > 0) front.push(pos.getZ(i));
  if (front.length < 12) return undefined;
  front.sort((a, b) => a - b);
  const plane = front[Math.min(front.length - 1, Math.floor(front.length * (f.q ?? 0.3)))];
  for (let i = 0; i < pos.count; i++) {
    const w = window(i);
    if (w <= 0) continue;
    const z = pos.getZ(i);
    if (z > plane) {
      // 凸出平面的一律压回去,**不看法线**。看法线是第一版的错:一个鼓包的
      // 正脸(nz≈1)被压回去了、它的侧壁(nz≈0)留在原地,于是鼓包被削成一圈
      // 立在字面前头的尖刺——量出来窗口里还有 1393 个点凸出平面 0.41 m。
      // 压回去不可能把石头压塌:平面在 z>0 这一侧,背面的点 z<0,够不着。
      pos.setZ(i, lerp(z, plane, w));
    } else if (z > 0) {
      // 凹进去的只提**正面**的点:侧壁与背面提上来会把石身拽穿。
      pos.setZ(i, lerp(z, plane, w * smoothstep(0.1, 0.45, nor.getZ(i))));
    }
  }
  geo.computeVertexNormals();
  return plane;
}

/** 地面裁切:y<0 的点压到 0,整片贴地的三角删掉(在地下,看不见,省三角)。 */
function clipToGround(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0) pos.setY(i, 0);
  }
  const index = geo.getIndex();
  if (!index) return geo;
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (pos.getY(a) <= 0 && pos.getY(b) <= 0 && pos.getY(c) <= 0) continue;
    kept.push(a, b, c);
  }
  geo.setIndex(kept);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 顶点色:用球场当占据函数,沿法线半球打 9 根短线,被"实心"挡住的比例就是 cavity。
 * 孔洞内壁、石缝、褶皱谷底都会暗下去;脚下泛青;`spec.moss` 在的话再叠一路苔斑。
 *
 * 四路是**叠**不是**换**(顺序即层序):AO×折痕×低频明度 → 孔内泛青 → 脚下潮湿
 * → 苔斑。苔在最外一层,因为它是长在石头表面上的东西——底下那三路的暗谷/亮脊
 * 会透过 `lerp` 的剩余权重继续起作用,苔斑里还看得见石头的褶。
 */
function bakeColors(
  geo: THREE.BufferGeometry,
  balls: Ball[],
  disp: Float32Array,
  scale: number,
  seed: number,
  moss?: MossSpec,
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const s = new Simplex(seed + 77);
  // 苔用**另一颗**种子,不从 `s` 上取:`s` 是明度起伏,两者共用一条噪声会让
  // "苔斑"与"亮斑"严丝合缝地重合,读作贴图而不是长出来的东西。
  const sm = moss ? new Simplex(seed + 313) : null;
  /**
   * 朝上判据读的是**皱之前的光滑法线** `snormal`,不是 `normal`。
   * 这条是实拍改出来的:用真法线时,峰身上密布的褶皱让 `normal.y` 在相邻顶点
   * 之间来回跳 ±0.4,苔就碎成了**椒盐噪点**——远看是一层绿霉斑,近看是脏,
   * 完全不成"斑"。`snormal` 跟着瘤的真实朝向走、不带褶皱的抖动(`faceProjectedUV`
   * 选投影轴也是为同一个理由用它),于是"哪一片面朝天"是低频的,
   * 斑的形状就交给低频噪声去定——这正是单子要的那两个因子各司其职。
   */
  const snor = geo.attributes.snormal as THREE.BufferAttribute | undefined;
  const mossColor = moss ? new THREE.Color(...(moss.color ?? [0.23, 0.36, 0.17])) : null;
  const mossUp = moss?.up ?? 0.3;
  const mossUpSoft = moss?.upSoft ?? 0.45;
  const mossPatch = moss?.patch ?? 0.9;
  const mossCoverage = moss?.coverage ?? 0.05;
  const mossEdge = moss?.edge ?? 0.34;
  const mossStrength = moss?.strength ?? 0.88;
  const n = new THREE.Vector3();
  const t = new THREE.Vector3();
  const bt = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const dists = [0.1, 0.22, 0.45, 0.8].map((d) => d * scale);
  const weights = [1.0, 0.85, 0.6, 0.35];
  const wet = new THREE.Color(0.5, 0.68, 0.64);
  const pitTint = new THREE.Color(0.8, 0.86, 0.9);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize();
    // 切空间基
    t.set(1, 0, 0);
    if (Math.abs(n.x) > 0.8) t.set(0, 0, 1);
    t.cross(n).normalize();
    bt.crossVectors(n, t);

    let occ = 0;
    let total = 0;
    // 法线 + 两圈锥(40°、70°),共 17 根。每根线取第一次被挡处的权重(近挡重、远挡轻),
    // 没挡到记 0;按余弦加权平均——不是把没挡到的距离也堆进分母,那样孔壁只能算出 0.16。
    for (let k = 0; k < 17; k++) {
      const ringW = k === 0 ? 1 : k <= 8 ? 0.85 : 0.45;
      if (k === 0) dir.copy(n);
      else {
        const ring = k <= 8 ? 0 : 1;
        const a = (((k - 1) % 8) / 8) * Math.PI * 2 + ring * 0.39;
        const cone = ring === 0 ? 0.698 : 1.222;
        const cn = Math.cos(cone);
        const sn = Math.sin(cone);
        dir.copy(n).multiplyScalar(cn).addScaledVector(t, Math.cos(a) * sn).addScaledVector(bt, Math.sin(a) * sn);
      }
      total += ringW;
      for (let di = 0; di < dists.length; di++) {
        const d = dists[di];
        if (fieldAt(balls, px + dir.x * d, py + dir.y * d, pz + dir.z * d) > ISO) {
          occ += weights[di] * ringW;
          break; // 这根线已经被挡,再远不算
        }
      }
    }
    const cavity = occ / total; // 0 露天 … 1 全包
    const ao = 1 - cavity * 0.85;

    // 褶皱谷底暗一点、脊亮一点。
    const crease = lerp(0.86, 1.04, smoothstep(-0.03 * scale, 0.03 * scale, disp[i]));
    // 低频明度起伏,一个面里也有变化。
    const tone = 1 + 0.07 * s.noise3D(px * 1.3, py * 1.3, pz * 1.3) + 0.04 * s.noise3D(px * 4.5, py * 4.5, pz * 4.5);

    c.setRGB(0.5, 0.5, 0.5).multiplyScalar(ao * crease * tone);
    // 孔洞内泛青
    c.lerp(pitTint, smoothstep(0.35, 0.8, cavity) * 0.6);
    // 脚下潮湿
    const wetT = smoothstep(0.34 * scale, 0.02, py);
    c.lerp(wet, wetT * 0.85);
    // 石上的苔(单子 AM4):朝上 × 低频噪声 —— 成斑,不是均匀染。
    if (sm && mossColor) {
      // 朝上的偏好。软过渡,不是台阶:硬阈值会切出一条绿帽檐。
      const uy = snor ? snor.getY(i) / (Math.hypot(snor.getX(i), snor.getY(i), snor.getZ(i)) || 1) : n.y;
      const up = smoothstep(mossUp - mossUpSoft, mossUp + mossUpSoft, uy);
      // 低频噪声决定**哪一块**长苔。主斑 `mossPatch` m 一个,再叠半尺度的一层
      // 把斑的边缘啃碎——单频噪声的等值线太圆,读作一摊一摊的水渍。
      const f = 1 / mossPatch;
      const blotch =
        sm.noise3D(px * f, py * f * 0.8, pz * f) * 0.72 +
        sm.noise3D(px * f * 2.1, py * f * 1.7, pz * f * 2.1) * 0.28;
      const patch = smoothstep(mossCoverage, mossCoverage + mossEdge, blotch);
      c.lerp(mossColor, up * patch * mossStrength);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * 按三角面选投影轴的三平面 UV。逐顶点选轴会在轴切换处把贴图拉成长条(边角一片
 * 抹痕),逐面选轴只留一条硬缝,被石头本身的坑纹吃掉。要拆 index,顶点数翻三倍,
 * 三角数不变;光滑法线在拆之前算好一起带过去。
 */
function faceProjectedUV(geo: THREE.BufferGeometry, scale: number, seed: number): THREE.BufferGeometry {
  geo.computeVertexNormals();
  const ni = geo.toNonIndexed();
  // 选轴用的是皱之前的光滑法线(snormal)。用真面法线选轴会在 45° 边界上来回跳,
  // 法线贴图的切线跟着翻,表面就碎成一片片小面;用球场梯度又太"圆",瘤的侧面会被
  // 判错轴拉成横条。
  const sn = ni.attributes.snormal as THREE.BufferAttribute;
  const pos = ni.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const rng = makeRng(seed);
  const ox = rng() * 7;
  const oy = rng() * 7;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    fn.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    let gx = sn.getX(i) + sn.getX(i + 1) + sn.getX(i + 2);
    let gy = sn.getY(i) + sn.getY(i + 1) + sn.getY(i + 2);
    let gz = sn.getZ(i) + sn.getZ(i + 1) + sn.getZ(i + 2);
    if (Math.hypot(gx, gy, gz) < 1e-6) {
      gx = fn.x;
      gy = fn.y;
      gz = fn.z;
    }
    const nx = Math.abs(gx);
    // 顶投影只留给真正朝天/朝地的面(按真面法线把关):侧壁一旦被判成朝天,贴图就在竖面上拉成横条。
    const ny = Math.abs(fn.y) < 0.55 ? 0 : Math.abs(gy) * 0.8;
    const nz = Math.abs(gz);
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k);
      const y = pos.getY(i + k);
      const z = pos.getZ(i + k);
      let u: number;
      let v: number;
      if (nx >= ny && nx >= nz) {
        u = z;
        v = y;
      } else if (ny >= nx && ny >= nz) {
        u = x;
        v = z;
      } else {
        u = x;
        v = y;
      }
      uv[(i + k) * 2] = u * scale + ox;
      uv[(i + k) * 2 + 1] = v * scale + oy;
    }
  }
  ni.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  ni.deleteAttribute('snormal');
  return ni;
}

/**
 * 一块石头:球 → 表面 → 皱 → 细皮 → 落地 → 烤色 → UV。
 *
 * `made` 缺省就是太湖石的球场。`baishi.ts` 传自己排的球场进来——石种不同的是
 * **形**(剖面、瘤的走向、孔的多少),而不是后面这条噪声/AO/UV 流水线,那条
 * 一字不改地复用。默认参数保证太湖石三个 variant 的输出逐位不变。
 */
export function buildStone(
  spec: StoneSpec,
  made: { balls: Ball[]; holes: HoleLine[] } = buildBalls(spec),
): StoneResult {
  const { balls, holes } = made;
  const extentY = spec.height + spec.width * 0.4 + 0.56;
  const extentXZ = spec.width * 1.35 + 0.56;
  const resolution = Math.ceil(Math.max(extentY, extentXZ) / spec.cell);
  let geo = metaSurface(balls, { resolution, isoLevel: 1, padding: 0.28 });
  // 皱之前的光滑法线留一份,给贴图选投影轴用:跟着瘤的真实朝向走,又不带褶皱的抖动。
  geo.computeVertexNormals();
  geo.setAttribute('snormal', (geo.attributes.normal as THREE.BufferAttribute).clone());

  const scale = spec.squat ? spec.width : spec.height / 2.6;
  const coarse = 0.055 * spec.wrinkle * Math.max(0.5, scale);
  const detail = spec.wrinkleFreq ?? 1;
  const disp = wrinkle(geo, spec.seed + 5, coarse, (3.0 / Math.max(0.6, scale)) * detail);
  geo = noiseDisplace(
    geo,
    0.008 * spec.wrinkle * Math.max(0.5, scale),
    (9 / Math.max(0.6, scale)) * detail,
    spec.seed + 9,
    2,
  );
  const flatZ = spec.flatten ? flattenFace(geo, spec.flatten) : undefined;
  geo = clipToGround(geo);
  bakeColors(geo, balls, disp, Math.max(0.5, scale), spec.seed, spec.moss);
  geo = faceProjectedUV(geo, 0.7, spec.seed + 3);
  geo.computeBoundingBox();
  return { geo, balls, holes, top: geo.boundingBox!.max.y, flatZ };
}

/* ------------------------------------------------------------------ */
/* 三个 variant                                                        */
/* ------------------------------------------------------------------ */

function parseVariant(variant: string): { kind: 'peak' | 'mound' | 'edge'; n: number } {
  const m = /^(peak|mound|edge)/.exec(variant);
  const kind = (m?.[1] as 'peak' | 'mound' | 'edge' | undefined) ?? 'peak';
  const d = /(\d+)/.exec(variant);
  return { kind, n: d ? Number(d[1]) : 0 };
}

export interface TaihuGeometry {
  geo: THREE.BufferGeometry;
  holes: HoleLine[];
  /** 每块石头自己的几何+孔(mound 用:孔只对自己那块石头校验,邻石挡住不算)。 */
  stones: { geo: THREE.BufferGeometry; holes: HoleLine[] }[];
  /** mound 的曲径中线(y=0),给校验用。 */
  path?: [number, number][];
  groundRadius: number;
}

/**
 * 摆一块石头:绕 Y 转 `rotY`,再平移到 (x,y,z)。孔的轴线跟着同一个矩阵走——
 * 分两条路算会立刻让 `holeHits` 打空,这是唯一的真源。
 *
 * `lean`(单子 AM1 加,白石峰成组"拱立"用):竖向**错切** x += kx·y、z += kz·y。
 * 用错切而不是绕底边旋转,是因为错切**不动 y**——石头是 `clipToGround` 削平底面
 * 后摆上去的,真旋转会把一侧的底边抬离地面几厘米(棚拍地盘贴着最低点,那道缝
 * 看得见),而错切让底面原样贴地,顶自然歪出去。5–12° 这一档的形变肉眼读不出。
 * 顶点色里"脚下泛青"按局部 y 烤,错切保持 y 不变,那条青带也不会跑位。
 */
export function transformStone(
  r: StoneResult,
  x: number,
  y: number,
  z: number,
  rotY: number,
  lean?: { kx: number; kz: number },
): StoneResult {
  const m = new THREE.Matrix4().makeRotationY(rotY);
  if (lean) {
    // prettier-ignore
    m.premultiply(new THREE.Matrix4().set(
      1, lean.kx, 0, 0,
      0, 1,       0, 0,
      0, lean.kz, 1, 0,
      0, 0,       0, 1,
    ));
  }
  m.setPosition(x, y, z);
  if (lean) {
    r.geo.applyMatrix4(m);
  } else {
    // 无倾斜时走原路径,保证太湖石既有产出逐位不变。
    r.geo.rotateY(rotY);
    r.geo.translate(x, y, z);
  }
  const v = new THREE.Vector3();
  const holes = r.holes.map((h) => {
    v.set(...h.a).applyMatrix4(m);
    const a: [number, number, number] = [v.x, v.y, v.z];
    v.set(...h.b).applyMatrix4(m);
    const b: [number, number, number] = [v.x, v.y, v.z];
    return { a, b, view: h.view };
  });
  return { ...r, holes };
}

function buildPeak(n: number): TaihuGeometry {
  const seed = 7101 + n * 97;
  const rng = makeRng(seed);
  const spec: StoneSpec = {
    height: rangeOf(rng, 2.15, 2.5), // 有效顶高 2.4–2.8
    width: rangeOf(rng, 0.98, 1.06),
    waist: rangeOf(rng, 0.56, 0.64),
    holes: 3,
    pits: 5,
    cell: 0.036,
    wrinkle: 1,
    plate: 1.22,
    seed: seed + 1,
  };
  const r = buildStone(spec);
  return { geo: r.geo, holes: r.holes, stones: [r], groundRadius: 2.4 };
}

function buildEdge(n: number): TaihuGeometry {
  const seed = 7501 + n * 97;
  const rng = makeRng(seed);
  const w = rangeOf(rng, 0.55, 0.7);
  const spec: StoneSpec = {
    height: w * rangeOf(rng, 0.62, 0.78),
    width: w,
    waist: 0.8,
    holes: 1,
    pits: 2,
    squat: true,
    cell: 0.042,
    wrinkle: 0.75,
    seed: seed + 1,
  };
  const r = buildStone(spec);
  return { geo: r.geo, holes: r.holes, stones: [r], groundRadius: 1.2 };
}

/** 曲径中线:从 +Z 正面进,蛇形穿到 -Z。深 4m 的山体里拐两道。 */
function corridorPath(rng: () => number): [number, number][] {
  // 拐弯幅度必须大过走廊宽度,不然从正面一眼望穿。
  return [
    [rangeOf(rng, -0.9, -0.7), 2.1],
    [rangeOf(rng, 0.8, 1.0), 0.7],
    [rangeOf(rng, -1.0, -0.8), -0.5],
    [rangeOf(rng, 0.4, 0.6), -2.1],
  ];
}

/** 折线上按弧长比例取点与左法线。 */
function samplePath(path: [number, number][], s: number): { x: number; z: number; nx: number; nz: number } {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let d = clamp(s, 0, 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const u = clamp(d / lens[i], 0, 1);
      const x = lerp(path[i][0], path[i + 1][0], u);
      const z = lerp(path[i][1], path[i + 1][1], u);
      const tx = (path[i + 1][0] - path[i][0]) / lens[i];
      const tz = (path[i + 1][1] - path[i][1]) / lens[i];
      return { x, z, nx: tz, nz: -tx };
    }
    d -= lens[i];
  }
  const last = path[path.length - 1];
  return { x: last[0], z: last[1], nx: 1, nz: 0 };
}

/**
 * 点到折线的最近距离、最近点,以及在有向折线的哪一侧(`left`)。
 * 侧别按最近那一段的叉积判,拐弯处才不会把"左壁"误判成越线——之前用一个全局
 * 方向判侧,弯后面的石头被整块推出去两米。
 */
export function distToPath(
  path: [number, number][],
  x: number,
  z: number,
): { d: number; px: number; pz: number; left: boolean; nx: number; nz: number } {
  let best = { d: Infinity, px: 0, pz: 0, left: false, nx: 1, nz: 0 };
  let bi = 1;
  let bu = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][0];
    const az = path[i - 1][1];
    const bx = path[i][0];
    const bz = path[i][1];
    const vx = bx - ax;
    const vz = bz - az;
    const l2 = vx * vx + vz * vz;
    const u = clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1);
    const px = ax + vx * u;
    const pz = az + vz * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) {
      const l = Math.sqrt(l2);
      // 指向 left(叉积>0)那一侧的法线。
      best = { d, px, pz, left: false, nx: -vz / l, nz: vx / l };
      bi = i;
      bu = u;
    }
  }
  // 判侧用的切向:最近点落在内角顶点上时,取两段的平分切向,不然拐角外侧的楔形区会判反。
  let tx = path[bi][0] - path[bi - 1][0];
  let tz = path[bi][1] - path[bi - 1][1];
  if (bu <= 0 && bi > 1) {
    tx += path[bi - 1][0] - path[bi - 2][0];
    tz += path[bi - 1][1] - path[bi - 2][1];
  } else if (bu >= 1 && bi < path.length - 1) {
    tx += path[bi + 1][0] - path[bi][0];
    tz += path[bi + 1][1] - path[bi][1];
  }
  best.left = tx * (z - best.pz) - tz * (x - best.px) > 0;
  return best;
}

const HALF_CORRIDOR = 0.6;
/** 走廊净空高度:这以下的石头不许伸进走廊,这以上允许探出来压顶。 */
const CORRIDOR_HEADROOM = 1.95;

/**
 * 把一块石头沿"离开走廊中线"的方向推,直到 1.95m 以下的所有顶点离中线 ≥ 半宽+余量。
 * 用真实顶点算,不信球的理论半径——褶皱和侧瘤都算在内。
 */
function pushClear(geo: THREE.BufferGeometry, path: [number, number][], left: boolean): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const want = HALF_CORRIDOR + 0.04;
  for (let iter = 0; iter < 8; iter++) {
    let worst = Infinity;
    let wx = 0;
    let wz = 0;
    let wpx = 0;
    let wpz = 0;
    let wnx = 0;
    let wnz = 0;
    let crossed = false;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > CORRIDOR_HEADROOM) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = distToPath(path, x, z);
      // 顶点跑到中线另一侧去了:按负距离算。
      const signed = r.left === left ? r.d : -r.d;
      if (signed < worst) {
        worst = signed;
        wx = x;
        wz = z;
        wpx = r.px;
        wpz = r.pz;
        wnx = r.nx;
        wnz = r.nz;
        crossed = r.left !== left;
      }
    }
    if (worst >= want) return;
    // 推的方向:最近点指向该顶点;若顶点越线则用该段本侧的法线。
    let dx = wx - wpx;
    let dz = wz - wpz;
    if (crossed || Math.hypot(dx, dz) < 1e-6) {
      dx = left ? wnx : -wnx;
      dz = left ? wnz : -wnz;
    }
    const l = Math.hypot(dx, dz);
    const push = Math.min(0.6, want - worst + 0.01);
    geo.translate((dx / l) * push, 0, (dz / l) * push);
  }
}

function buildMound(n: number): TaihuGeometry {
  const seed = 7301 + n * 97;
  const rng = makeRng(seed);
  const path = corridorPath(rng);
  const results: StoneResult[] = [];
  let k = 0;

  interface Placed {
    r: StoneResult;
    x: number;
    z: number;
  }

  /** 按 (x,z) 落一块,再推离走廊。 */
  const place = (
    x: number,
    z: number,
    height: number,
    width: number,
    holes: number,
    opts: { cell?: number; stretchZ?: number; plate?: number } = {},
  ): Placed => {
    const spec: StoneSpec = {
      height,
      width,
      waist: rangeOf(rng, 0.64, 0.74),
      holes,
      pits: 3,
      cell: opts.cell ?? 0.05,
      wrinkle: 1,
      plate: opts.plate ?? rangeOf(rng, 1.05, 1.2),
      seed: seed + 11 + k++ * 13,
    };
    const built = buildStone(spec);
    if (opts.stretchZ) built.geo.scale(1, 1, opts.stretchZ);
    // 板面大致朝走廊(±35° 抖动),孔才对着游线。
    const near0 = distToPath(path, x, z);
    const face = Math.atan2(x - near0.px, z - near0.pz) + Math.PI / 2 + rangeOf(rng, -0.6, 0.6);
    const r = transformStone(built, x, 0, z, face);
    const before = new THREE.Vector3();
    r.geo.computeBoundingBox();
    r.geo.boundingBox!.getCenter(before);
    pushClear(r.geo, path, near0.left);
    r.geo.computeBoundingBox();
    const after = r.geo.boundingBox!.getCenter(new THREE.Vector3());
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    for (const h of r.holes) {
      h.a[0] += dx; h.a[2] += dz;
      h.b[0] += dx; h.b[2] += dz;
    }
    results.push(r);
    return { r, x: x + dx, z: z + dz };
  };

  // 底层山体:走廊两侧各三块矮胖的"堆",裙脚互相咬住。
  const j = (a: number) => rangeOf(rng, -a, a);
  place(1.3 + j(0.08), 1.45 + j(0.1), rangeOf(rng, 1.5, 1.65), 1.4, 1, { cell: 0.055 });
  place(1.85 + j(0.08), 0.1 + j(0.1), rangeOf(rng, 1.4, 1.55), 1.35, 1, { cell: 0.055 });
  place(1.4 + j(0.08), -1.1 + j(0.1), rangeOf(rng, 1.55, 1.7), 1.35, 1, { cell: 0.055 });
  place(-1.8 + j(0.08), 1.2 + j(0.1), rangeOf(rng, 1.35, 1.5), 1.3, 1, { cell: 0.055 });
  place(-1.9 + j(0.08), -1.05 + j(0.1), rangeOf(rng, 1.5, 1.65), 1.35, 1, { cell: 0.055 });
  // 外圈:每侧一块矮而长的靠山,把轮廓拉到 6m,两肩低下去。
  place(2.3 + j(0.1), 0.3 + j(0.2), rangeOf(rng, 1.0, 1.15), 1.4, 1, { stretchZ: 1.3, plate: 1, cell: 0.06 });
  place(-2.4 + j(0.1), 0.0 + j(0.2), rangeOf(rng, 1.05, 1.2), 1.4, 1, { stretchZ: 1.3, plate: 1, cell: 0.06 });
  // 两座峰从堆里拔起来:左峰压在第一道弯后面,进门正对着它——"先被石挡";右峰在出口那头呼应。
  place(-1.25 + j(0.08), 0.25 + j(0.1), rangeOf(rng, 2.5, 2.65), 1.05, 2, { cell: 0.045, plate: 1.3 });
  place(1.2 + j(0.08), -0.8 + j(0.1), rangeOf(rng, 2.1, 2.25), 1.0, 2, { cell: 0.045, plate: 1.25 });

  const geo = mergeGeometries(results.map((r) => r.geo), false)!;
  geo.computeBoundingBox();
  const holes = results.flatMap((r) => r.holes);
  return { geo, holes, stones: results, path, groundRadius: 5.2 };
}

/** 纯几何入口(可在 node 里跑校验,不碰材质)。 */
export function buildTaihuGeometry(variant: string): TaihuGeometry {
  const { kind, n } = parseVariant(variant);
  if (kind === 'mound') return buildMound(n);
  if (kind === 'edge') return buildEdge(n);
  return buildPeak(n);
}

/** 走廊净空校验:沿中线取样,离中线 ±0.5m、离地 0.3–1.6m 的点都得在石头外。 */
export function corridorClearance(g: TaihuGeometry): { ok: boolean; worst: number } {
  if (!g.path) return { ok: true, worst: Infinity };
  const ray = new THREE.Raycaster();
  const mesh = new THREE.Mesh(g.geo);
  let worst = Infinity;
  for (let i = 0; i <= 24; i++) {
    const p = samplePath(g.path, i / 24);
    for (const y of [0.3, 0.9, 1.6]) {
      // 从中线向左右各打一根横线,最近命中距离就是半宽。
      for (const side of [-1, 1]) {
        ray.set(new THREE.Vector3(p.x, y, p.z), new THREE.Vector3(p.nx * side, 0, p.nz * side));
        const hit = ray.intersectObject(mesh, false)[0];
        const d = hit ? hit.distance : Infinity;
        worst = Math.min(worst, d);
      }
    }
  }
  return { ok: worst >= HALF_CORRIDOR - 0.05, worst };
}

/** 透孔校验:沿孔轴线打光线,一个都不该打中。返回每个孔的命中数。 */
export function holeHits(g: TaihuGeometry): number[] {
  const ray = new THREE.Raycaster();
  return g.stones.flatMap((st) => {
    const mesh = new THREE.Mesh(st.geo);
    return st.holes.map((h) => {
      const a = new THREE.Vector3(...h.a);
      const b = new THREE.Vector3(...h.b);
      const dir = b.clone().sub(a);
      const len = dir.length();
      ray.set(a, dir.normalize());
      ray.far = len;
      return ray.intersectObject(mesh, false).length;
    });
  });
}

registerPart('taihu', (variant): PartBuild => {
  const g = buildTaihuGeometry(variant);
  const mesh = new THREE.Mesh(g.geo, taihuMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const root = new THREE.Group();
  root.add(mesh);
  root.userData.holes = g.holes;
  if (g.path) root.userData.path = g.path;
  return { root, groundRadius: g.groundRadius };
});
