import * as THREE from 'three';
import { bakeColorMap, bakeNormalMap, cached, recipeKey, mixHex, hexToRgb, NOISE } from '@engine/core/TextureLab';
import { Simplex, makeRng, clamp, smoothstep, lerp, worley } from '@engine/core/Noise';
import { woodMaps } from '../materials';
import { dirtPathMaps } from '@engine/core/TextureLab';

/**
 * 乡野(稻香村)材质:茅苫、草茬、苫底、黄泥版筑、粗木、稻茎草檐、青篱。
 *
 * 规矩同 `materials.ts`:同一种材质全园一个实例(`P-04`,否则合不了 draw call);
 * 贴图走 `cached(recipeKey(...))` 现烤。茅草的纤维纹用画布逐根描笔——
 * 各向同性的 fbm 在这个尺度上读成布纹或瓦垄(`P-07` 的另一面),草要的是
 * **一根一根顺坡的笔触**,方向感只能画出来。
 *
 * 色值是「园中光下屏幕上该看到的」那一档(`P-08`:照色卡填会读成黑)。
 */

/* ------------------------------------------------------------------ */
/* 色板(本文件私有;稻香村以外不用)                                    */
/* ------------------------------------------------------------------ */

export const XY = {
  /** 陈稻草:黄里带灰。新苫偏金,日晒雨淋后发灰——园里「新搭的村」取偏新的一档。 */
  strawLight: 0xcdb27a,
  strawMid: 0xa48a5c,
  strawDark: 0x5c4a31,
  strawGrey: 0x8e8676,
  strawGap: 0x2f2519,
  /** 黄泥:赭黄泥色。D-36 ②:第一轮与茅草同一个浅草黄,房子读成一整块稻草色 → 压深到 0x8a6036;
   *  BB1(验收人裁定取偏黄版):0x8a6036 在园中光下读成深红褐木板;偏黄版 0xa3844f 色相对了,但棚拍茅顶−墙亮度差
   *  只剩 11(判据 ≥ 25)、dx_court 东厢 −0.5——又回到「一整块稻草色」。取同一色相压暗 18%:0x866c41,
   *  棚拍差 33.6、矮墙 1.6 m 人眼差 29.9(量法见 shots/BB/bb1/)。 */
  earth: 0x866c41,
  earthDark: 0x665130,
  earthDamp: 0x4a321d,
  /** 粗木:不施彩画、日晒发灰的松杉。 */
  roughWood: 0x7d644a,
  /** 新条:嫩皮青绿到赭红。 */
  shootGreen: 0x7d8a45,
  shootRed: 0x8a5a3c,
} as const;

const MAT_CACHE = new Map<string, THREE.Material>();
function memo<T extends THREE.Material>(key: string, make: () => T): T {
  let m = MAT_CACHE.get(key) as T | undefined;
  if (!m) {
    m = make();
    MAT_CACHE.set(key, m);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* 画布笔触工具                                                         */
/* ------------------------------------------------------------------ */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
function canvas(size: number): { cv: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx } {
  const cv = typeof document === 'undefined' ? new OffscreenCanvas(size, size) : document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  return { cv, ctx: cv.getContext('2d', { willReadFrequently: true }) as Ctx };
}
function rgb(c: [number, number, number], k = 1, a = 1): string {
  return `rgba(${(clamp(c[0] * k, 0, 1) * 255) | 0},${(clamp(c[1] * k, 0, 1) * 255) | 0},${(clamp(c[2] * k, 0, 1) * 255) | 0},${a})`;
}
/** 把一笔在四周各画一份,贴图四方连续。 */
function wrapped(size: number, x0: number, y0: number, x1: number, y1: number, draw: (dx: number, dy: number) => void): void {
  const xs = [0], ys = [0];
  if (Math.min(x0, x1) < 0) xs.push(size);
  if (Math.max(x0, x1) > size) xs.push(-size);
  if (Math.min(y0, y1) < 0) ys.push(size);
  if (Math.max(y0, y1) > size) ys.push(-size);
  for (const dx of xs) for (const dy of ys) draw(dx, dy);
}
function texFrom(cv: HTMLCanvasElement | OffscreenCanvas, srgb: boolean, wrap = true): THREE.Texture {
  const t = new THREE.CanvasTexture(cv as HTMLCanvasElement);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
/** 灰度画布 → 高度数组(0..1)。 */
function heightsOf(ctx: Ctx, size: number): Float32Array {
  const d = ctx.getImageData(0, 0, size, size).data, h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}
function normalFrom(key: string, size: number, h: Float32Array, strength: number): THREE.Texture {
  return cached(recipeKey(key, size, strength), () =>
    bakeNormalMap({ size, height: (u, v) => h[Math.min(size - 1, Math.round(v * size)) * size + Math.min(size - 1, Math.round(u * size))] }, strength));
}

/* ------------------------------------------------------------------ */
/* 茅苫表面:顺坡的草束                                                 */
/* ------------------------------------------------------------------ */

/**
 * 一张贴图 = 1 m × 1 m 苫面;v 顺坡(草秆方向),u 沿檐。
 * 四层:草把(2.5–7 cm 宽、沿坡 15–50 cm 一把,各自色调,截面中鼓)→ 逐根草秆笔触
 * → 秆缝暗线 → 顺坡的淡雨沟。
 * 第一版在面上加过横向的「层茬」暗条,棚拍读成**布纹/席纹**(横竖交叉),已去掉:
 * 苫面上的横向结构一概不要,横向成行就往瓦垄、席子那边读。
 */
let thatchHeights: Float32Array | undefined;
function thatchSurfaceMaps(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const size = 1024;
  const map = cached(recipeKey('xiangye.thatch.albedo', size), () => {
    const rng = makeRng(0x7a7c4);
    const col = canvas(size), hgt = canvas(size);
    const c = col.ctx, h = hgt.ctx;
    c.fillStyle = rgb(hexToRgb(XY.strawMid), 0.9);
    c.fillRect(0, 0, size, size);
    h.fillStyle = 'rgb(100,100,100)';
    h.fillRect(0, 0, size, size);
    // 草把:沿 u 一列列(宽 2.5–7 cm),每列再沿坡断成 15–50 cm 的一把,各把一个色调、
    // 截面中间鼓两边低。断点逐列随机——不成行、不成格(成行成格就读成瓦或席)。
    for (let x = 0; x < size; ) {
      const w = 26 + rng() * 46;
      for (let y = rng() * size, run = 0; run < size; ) {
        const len = 150 + rng() * 360, tone = 0.8 + rng() * 0.32, grey = rng() * 0.55;
        const cc = mixHex(XY.strawMid, XY.strawGrey, grey);
        wrapped(size, x, y, x + w, y + len, (dx, dy) => {
          c.fillStyle = rgb(cc, tone, 0.6);
          c.fillRect(x + dx, y + dy, w, len);
          const g = h.createLinearGradient(x + dx, 0, x + dx + w, 0);
          const hv = (90 + rng() * 60) | 0;
          g.addColorStop(0, 'rgba(40,40,40,0.9)');
          g.addColorStop(0.5, `rgba(${hv + 60},${hv + 60},${hv + 60},0.9)`);
          g.addColorStop(1, 'rgba(40,40,40,0.9)');
          h.fillStyle = g;
          h.fillRect(x + dx, y + dy, w, len);
        });
        y += len; run += len;
      }
      x += w;
    }
    // 秆:逐根笔触,顺 v,微斜微弯。
    const palette = [XY.strawLight, XY.strawLight, XY.strawMid, XY.strawGrey, XY.strawDark];
    const stroke = (n: number, wMin: number, wMax: number, dark: boolean) => {
      for (let i = 0; i < n; i++) {
        const x0 = rng() * size, y0 = rng() * size, len = 60 + rng() * 280, ang = (rng() - 0.5) * 0.1;
        const x1 = x0 + Math.sin(ang) * len, y1 = y0 + Math.cos(ang) * len, bow = (rng() - 0.5) * 8;
        const w = wMin + rng() * (wMax - wMin);
        const cc = dark ? hexToRgb(XY.strawGap) : hexToRgb(palette[(rng() * palette.length) | 0]);
        const k = dark ? 1 : 0.85 + rng() * 0.3, a = dark ? 0.5 + rng() * 0.35 : 0.45 + rng() * 0.5;
        const hv = dark ? 10 + rng() * 30 : 150 + rng() * 100;
        wrapped(size, x0, y0, x1, y1, (dx, dy) => {
          for (const [ctx, style] of [[c, rgb(cc, k, a)], [h, `rgba(${hv | 0},${hv | 0},${hv | 0},${a})`]] as const) {
            ctx.strokeStyle = style;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(x0 + dx, y0 + dy);
            ctx.quadraticCurveTo((x0 + x1) / 2 + bow + dx, (y0 + y1) / 2 + dy, x1 + dx, y1 + dy);
            ctx.stroke();
          }
        });
      }
    };
    stroke(6500, 1.0, 2.6, false);
    stroke(2600, 0.8, 1.8, true);
    stroke(2200, 1.2, 3.0, false);
    // 雨沟:长而淡的暗笔,顺坡。
    for (let i = 0; i < 45; i++) {
      const x0 = rng() * size, y0 = rng() * size, len = 250 + rng() * 600, w = 5 + rng() * 9;
      wrapped(size, x0, y0, x0, y0 + len, (dx, dy) => {
        c.strokeStyle = rgb(hexToRgb(XY.strawGap), 1, 0.22);
        c.lineWidth = w;
        c.beginPath(); c.moveTo(x0 + dx, y0 + dy); c.lineTo(x0 + dx + (rng() - 0.5) * 12, y0 + dy + len); c.stroke();
      });
    }
    thatchHeights = heightsOf(h, size);
    return texFrom(col.cv, true);
  });
  const normalMap = normalFrom('xiangye.thatch.normal', size, thatchHeights ?? new Float32Array(size * size).fill(0.5), 3.2);
  return { map, normalMap };
}

/** 茅苫顶面(含两山草卷)。顶点色承载沿坡的旧色与斑驳。 */
export function thatchMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.thatch', () => {
    const m = thatchSurfaceMaps();
    return new THREE.MeshStandardMaterial({ map: m.map, normalMap: m.normalMap, normalScale: new THREE.Vector2(1, 1), roughness: 0.96, metalness: 0, vertexColors: true });
  });
}

/* ------------------------------------------------------------------ */
/* 檐口草茬:一刀齐的秆口                                               */
/* ------------------------------------------------------------------ */

/**
 * 一张 = 0.25 m 见方的檐口切面。秆斜着被竖刀切,切口是竖长的椭圆:亮的秆壁 + 暗的秆芯,
 * 秆间是深缝。这是「厚边读得出」的主力——切面要比苫面**亮**、颗粒比苫面**粗**。
 */
let stubbleHeights: Float32Array | undefined;
export function thatchEndMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.thatch-end', () => {
    const size = 512;
    const map = cached(recipeKey('xiangye.stubble.albedo', size), () => {
      const rng = makeRng(0x57bb1e);
      const tone = new Simplex(0x57bb);
      const col = canvas(size), hgt = canvas(size);
      const c = col.ctx, h = hgt.ctx;
      c.fillStyle = rgb(hexToRgb(XY.strawGap), 0.8);
      c.fillRect(0, 0, size, size);
      h.fillStyle = 'rgb(10,10,10)';
      h.fillRect(0, 0, size, size);
      // 秆口:苫草顺坡斜出,竖刀切齐,正看是一根根向下斜出的短秆头——亮的秆端、暗的秆缝;
      // 按 4–9 cm 的草把成团明暗(团与团之间是深缝),不是均匀的海绵颗粒。
      for (let i = 0; i < 14000; i++) {
        const x = rng() * size, y = rng() * size;
        const clump = 0.5 + 0.5 * tone.noise2D(x / 70, y / 55);
        if (rng() > 0.55 + clump * 0.6) continue;
        const len = 12 + rng() * 30, w = 1.8 + rng() * 2.4, ang = (rng() - 0.5) * 0.35;
        const x1 = x + Math.sin(ang) * len, y1 = y + Math.cos(ang) * len;
        const cc = mixHex(XY.strawMid, XY.strawLight, rng()), k = 0.72 + clump * 0.38;
        wrapped(size, x - 4, y - 4, x1 + 4, y1 + 4, (dx, dy) => {
          const g = c.createLinearGradient(x + dx, y + dy, x1 + dx, y1 + dy);
          g.addColorStop(0, rgb(cc, k * 0.55));
          g.addColorStop(1, rgb(cc, k * 1.1));
          c.strokeStyle = g; c.lineWidth = w; c.lineCap = 'round';
          c.beginPath(); c.moveTo(x + dx, y + dy); c.lineTo(x1 + dx, y1 + dy); c.stroke();
          const hv = (120 + clump * 120) | 0;
          h.strokeStyle = `rgb(${hv},${hv},${hv})`; h.lineWidth = w; h.lineCap = 'round';
          h.beginPath(); h.moveTo(x + dx, y + dy); h.lineTo(x1 + dx, y1 + dy); h.stroke();
        });
      }
      stubbleHeights = heightsOf(h, size);
      return texFrom(col.cv, true);
    });
    const normalMap = normalFrom('xiangye.stubble.normal', size, stubbleHeights ?? new Float32Array(size * size).fill(0.5), 2.6);
    return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.94, metalness: 0, vertexColors: true });
  });
}

/* ------------------------------------------------------------------ */
/* 苫底:椽上铺的苇箔                                                   */
/* ------------------------------------------------------------------ */

export function thatchUnderMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.thatch-under', () => {
    const size = 512;
    // 一张 = 0.5 m:苇秆横铺(沿 u),每根 1–1.5 cm。
    const s = new Simplex(0x5a6e);
    const reed = (u: number, v: number) => {
      const row = v * 40 + 0.35 * Math.sin(u * Math.PI * 2 * 3 + v * 11);
      const f = row - Math.floor(row);
      return smoothstep(0.0, 0.18, f) * smoothstep(1.0, 0.8, f);
    };
    const map = cached(recipeKey('xiangye.reedmat.albedo', size), () =>
      bakeColorMap({ size, color: (u, v) => {
        const r = reed(u, v), n = 0.5 + 0.5 * s.noise3D(u * 9, v * 3, 0.5);
        const c = mixHex(XY.strawDark, XY.strawMid, 0.25 + r * 0.45 + n * 0.15);
        return [c[0] * 0.85, c[1] * 0.85, c[2] * 0.85];
      } }));
    const normalMap = cached(recipeKey('xiangye.reedmat.normal', size, 1.4), () => bakeNormalMap({ size, height: reed }, 1.4));
    return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.95, metalness: 0 });
  });
}

/* ------------------------------------------------------------------ */
/* 黄泥版筑                                                             */
/* ------------------------------------------------------------------ */

/** 贴图一张覆盖的墙面边长(米)。 */
export const EARTH_TILE_M = 1.28;
function aniso(s: Simplex, u: number, v: number, fu: number, fv: number): number {
  const a = u * Math.PI * 2, b = v * Math.PI * 2, ru = fu / (Math.PI * 2), rv = fv / (Math.PI * 2);
  const nx = Math.cos(a) * ru, ny = Math.sin(a) * ru, nz = Math.cos(b) * rv, nw = Math.sin(b) * rv;
  return 0.5 * (s.noise3D(nx, ny, nz) + s.noise3D(ny + 7.1, nz, nw));
}
/**
 * 一张 = 1.28 m 见方的版筑墙面(单子 BD1:D-36 推翻条件触发——几何层线在园中光下读成木板墙)。
 * 层线、夯窝、泥抹补丁、裂缝**全在贴图里**(颜色 + 法线),几何只留微起伏与塌角:
 *   层线 —— 一张四版、版高不等(0.30/0.36/0.28/0.34 m);线**断续**(约三成断开)、上下摆 1 cm,
 *           线上一道泥浆溢出的**软边**(浅、微鼓)并往下挂几道短流痕——夹板缝里挤出来的泥,不是刻出来的直槽;
 *   夯窝 —— 每版里一排排浅圆窝(径 5–7 cm,杵头印),深浅不一;
 *   补丁 —— 大块抹过的泥(更平、更浅),盖住层线;
 *   裂缝 —— 稀疏的细裂(多为竖向),深色;
 *   返潮 —— 仍走顶点色(墙脚,按构件局部高度),贴图四方连续给不了「只在墙脚」。
 * v 向上(uv.v = 离墙脚高 / 1.28);bakeColorMap 的 v 是画布行号(向下),下面统一换成 up = 1 − v。
 */
const LIFTS = [0, 0.3 / 1.28, 0.66 / 1.28, 0.94 / 1.28, 1];
function earthFeatures(s: Simplex, u: number, v: number) {
  const up = 1 - v;
  // 层线:找最近一条(含周期接缝 0/1)。
  let line = 0, lip = 0, drip = 0;
  for (let k = 0; k < LIFTS.length; k++) {
    const b = LIFTS[k] + 0.008 * aniso(s, u, k * 0.21, 7, 3);
    const d = up - b; // >0 在线上方
    const show = smoothstep(-0.25, 0.05, aniso(s, u, 0.13 + k * 0.17, 9, 2)); // 断续
    line = Math.max(line, show * (1 - smoothstep(0.0, 0.006, Math.abs(d))));
    lip = Math.max(lip, show * smoothstep(0.004, 0.009, d) * (1 - smoothstep(0.011, 0.022, d)));
    // 流痕:线下方 0–7 cm,竖向细条,各条长短不一。
    if (d < 0 && d > -0.06) {
      const col = 0.5 + 0.5 * aniso(s, u * 1 + k * 0.37, 0.5, 80, 1);
      const len = 0.015 + 0.045 * (0.5 + 0.5 * aniso(s, u + 0.11, k * 0.29, 40, 2));
      drip = Math.max(drip, show * smoothstep(0.86, 0.96, col) * (1 - smoothstep(len * 0.6, len, -d)) * 0.7);
    }
  }
  // 夯窝:worley 细胞,只有约三成细胞留窝,窝心浅凹。
  const w = worley(u, up, 18, 13), pit = (w.id % 100 < 30 ? 1 : 0) * smoothstep(0.34, 0.14, w.f1) * (0.4 + 0.6 * (((w.id >>> 8) & 255) / 255));
  // 补丁:低频大块,抹平处盖掉层线与夯窝。
  const patch = smoothstep(0.35, 0.55, 0.5 + 0.5 * aniso(s, u + 0.3, up, 3, 3));
  // 裂缝:竖向为主的细线,稀疏。
  // 裂缝:高频在 u、低频在 v 的噪声等值线 → 竖向细缝;只在稀疏的低频斑里出现。
  const cr = Math.abs(aniso(s, u * 1 + 0.7, up, 34, 3)), crackMask = smoothstep(0.72, 0.86, 0.5 + 0.5 * aniso(s, u + 0.5, up + 0.2, 3, 3));
  const crack = (1 - smoothstep(0.0, 0.015, cr)) * crackMask;
  const grit = worley(u, up, 90, 31).f1;
  const keep = 1 - patch * 0.85;
  return { line: line * keep, lip: lip * keep, drip: drip * keep, pit: pit * keep, patch, crack: crack * (1 - patch * 0.6), grit };
}
function earthHeight(s: Simplex, u: number, v: number): number {
  const f = earthFeatures(s, u, v);
  return clamp(0.55 + 0.04 * smoothstep(0.35, 0.0, f.grit) + 0.06 * aniso(s, u, v, 3, 3) + 0.05 * aniso(s, u, v, 12, 5)
    - 0.1 * f.line + 0.12 * f.lip + 0.04 * f.drip - 0.16 * f.pit - 0.35 * f.crack + 0.05 * f.patch, 0, 1);
}
export function earthWallMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.earth', () => {
    const size = 1024;
    const s = new Simplex(0xea27);
    const map = cached(recipeKey('xiangye.earth.albedo', size, 4), () =>
      bakeColorMap({ size, color: (u, v) => {
        const f = earthFeatures(s, u, v);
        const rain = smoothstep(0.2, 0.8, aniso(s, u, v, 14, 3) * 0.5 + 0.5) * 0.18;
        const blot = 0.5 + 0.5 * aniso(s, u, v, 5, 6);
        const c = mixHex(XY.earthDark, XY.earth, clamp(0.25 + blot * 0.45 + f.patch * 0.2 - rain, 0, 1));
        const speck = smoothstep(0.2, 0.05, worley(u, v, 150, 7).f1);
        const k = (1 - speck * 0.18) * (1 - 0.22 * f.line) * (1 + 0.14 * f.lip) * (1 + 0.08 * f.drip) * (1 - 0.14 * f.pit) * (1 - 0.45 * f.crack);
        return [c[0] * k, c[1] * k, c[2] * k];
      } }));
    const normalMap = cached(recipeKey('xiangye.earth.normal', size, 2.4, 4), () => bakeNormalMap({ size, height: (u, v) => earthHeight(s, u, v) }, 2.4));
    return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.97, metalness: 0, vertexColors: true });
  });
}

 /** 夯土台面/台帮:借引擎的土路贴图(压实的土、碎石),不带版筑层线。 */
export function tampedEarthMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.tamped-earth', () => {
    const m = dirtPathMaps();
    return new THREE.MeshStandardMaterial({ map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, roughness: 1, metalness: 0, color: 0x98958c });
  });
}

/* ------------------------------------------------------------------ */
/* 粗木                                                                 */
/* ------------------------------------------------------------------ */

/** 不施彩画、无漆的粗木(C-r 乡野子档):用木纹贴图,换灰褐色调,去掉清漆。 */
export function roughWoodMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.rough-wood', () => {
    const m = woodMaps('xiangye-rough', XY.roughWood);
    return new THREE.MeshStandardMaterial({ map: m.map, normalMap: m.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.9, metalness: 0 });
  });
}

/* ------------------------------------------------------------------ */
/* 稻茎垂草(墙头草檐、茅檐乱茬)                                        */
/* ------------------------------------------------------------------ */

/** alpha 卡:上沿密、向下参差垂落的稻茎。u 沿檐,v=0 在上。 */
export function strawFringeMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.straw-fringe', () => {
    const size = 512;
    const map = cached(recipeKey('xiangye.fringe.albedo', size, 2), () => {
      const rng = makeRng(0xf12e);
      const { cv, ctx: c } = canvas(size);
      c.clearRect(0, 0, size, size);
      const palette = [XY.strawMid, XY.strawMid, XY.strawGrey, XY.strawDark, XY.strawLight];
      for (let i = 0; i < 900; i++) {
        const x0 = rng() * size, len = size * (0.18 + Math.pow(rng(), 1.6) * 0.8), ang = (rng() - 0.5) * 0.35;
        const x1 = x0 + Math.sin(ang) * len, y1 = Math.cos(ang) * len, bow = (rng() - 0.5) * 18;
        const cc = hexToRgb(palette[(rng() * palette.length) | 0]), k = 0.62 + rng() * 0.3;
        wrapped(size, x0, 0, x1, 0, (dx) => {
          c.strokeStyle = rgb(cc, k);
          c.lineWidth = 1.6 + rng() * 2.6;
          c.beginPath(); c.moveTo(x0 + dx, -2); c.quadraticCurveTo((x0 + x1) / 2 + bow + dx, y1 / 2, x1 + dx, y1); c.stroke();
        });
      }
      const t = texFrom(cv, true);
      t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
    return new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
  });
}

/* ------------------------------------------------------------------ */
/* 青篱:新条与叶                                                       */
/* ------------------------------------------------------------------ */

/** 新条(桩与编条)。颜色走顶点色(青绿↔赭红),贴图只给纵向细纹。 */
export function shootMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.shoot', () => {
    const size = 256, s = new Simplex(0x5400);
    const map = cached(recipeKey('xiangye.shoot.albedo', size), () =>
      bakeColorMap({ size, color: (u, v) => {
        const k = 0.86 + 0.14 * aniso(s, u, v, 24, 2) + 0.06 * smoothstep(0.93, 1, 0.5 + 0.5 * aniso(s, u, v, 6, 30));
        return [k, k, k];
      } }));
    return new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0, vertexColors: true });
  });
}

/**
 * 叶卡图集 2×2:桑(阔卵、心形基)、榆(小椭圆、偏基)、槿(菱状卵、三浅裂)、柘(卵形全缘)。
 * 每格一小枝:一根嫩枝挂 7–13 片叶,嫩叶偏黄绿、老叶偏深——「稚新條」,要**活的**绿。
 */
export function hedgeLeafMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.hedge-leaf', () => {
    const size = 1024;
    const map = cached(recipeKey('xiangye.hedge-leaf.albedo', size, 2), () => {
      const rng = makeRng(0x1ea7);
      const { cv, ctx: c } = canvas(size);
      c.clearRect(0, 0, size, size);
      const cell = size / 2;
      const species: { lw: number; ll: number; n: [number, number]; lobe: number; heart: number }[] = [
        { lw: 0.5, ll: 0.2, n: [7, 9], lobe: 0, heart: 0.35 }, // 桑
        { lw: 0.36, ll: 0.12, n: [11, 14], lobe: 0, heart: 0.05 }, // 榆
        { lw: 0.46, ll: 0.16, n: [8, 11], lobe: 0.18, heart: 0 }, // 槿
        { lw: 0.42, ll: 0.14, n: [9, 12], lobe: 0, heart: 0 }, // 柘
      ];
      species.forEach((sp, idx) => {
        const ox = (idx % 2) * cell, oy = Math.floor(idx / 2) * cell;
        c.save();
        c.beginPath(); c.rect(ox, oy, cell, cell); c.clip();
        // 嫩枝:自格底中部斜向上。
        const bx = ox + cell * (0.45 + rng() * 0.1), by = oy + cell * 0.98;
        const tx = ox + cell * (0.4 + rng() * 0.2), ty = oy + cell * 0.08;
        c.strokeStyle = rgb(mixHex(XY.shootGreen, XY.shootRed, rng() * 0.6), 1);
        c.lineWidth = 5;
        c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(ox + cell * (0.3 + rng() * 0.4), oy + cell * 0.5, tx, ty); c.stroke();
        const n = sp.n[0] + ((rng() * (sp.n[1] - sp.n[0] + 1)) | 0);
        for (let i = 0; i < n; i++) {
          const t = 0.1 + (i / n) * 0.9;
          // 枝上一点(与上面二次曲线同形,近似)。
          const px = lerp(bx, tx, t) + Math.sin(t * Math.PI) * cell * 0.04 * (idx % 2 ? 1 : -1);
          const py = lerp(by, ty, t);
          const side = i % 2 ? 1 : -1;
          const ang = side * (0.7 + rng() * 0.6) - 0.15 + (rng() - 0.5) * 0.3;
          const young = t > 0.72 ? 1 : rng() * 0.4;
          const L = cell * sp.ll * (1.35 - 0.45 * t) * (0.8 + rng() * 0.4) * 1.6, W = L * sp.lw;
          const base = mixHex(0x3d6a26, 0x5a8a31, rng());
          const tip = mixHex(0x6f9c3a, 0x9cc052, young);
          c.save();
          c.translate(px, py); c.rotate(ang);
          const g = c.createLinearGradient(0, 0, 0, -L);
          g.addColorStop(0, rgb(base)); g.addColorStop(1, rgb(tip));
          c.fillStyle = g;
          c.beginPath();
          c.moveTo(0, 0);
          c.bezierCurveTo(W * (0.9 + sp.heart), -L * 0.05, W * (1 + sp.lobe), -L * 0.55, 0, -L);
          c.bezierCurveTo(-W * (1 + sp.lobe), -L * 0.55, -W * (0.9 + sp.heart), -L * 0.05, 0, 0);
          c.fill();
          c.strokeStyle = 'rgba(210,235,160,0.45)';
          c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -L * 0.92); c.stroke();
          c.restore();
        }
        c.restore();
      });
      return texFrom(cv, true, false);
    });
    return new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.78, metalness: 0, vertexColors: true });
  });
}
