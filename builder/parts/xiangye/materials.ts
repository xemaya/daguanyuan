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
  /** 黄泥:偏暖的赭黄,比粉墙暗、比木作亮。 */
  earth: 0xa8844f,
  earthDark: 0x8a6a40,
  earthDamp: 0x584430,
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

/** 贴图一张覆盖的墙面边长(米):4 版 × 一尺。 */
export const EARTH_TILE_M = 1.28;
function aniso(s: Simplex, u: number, v: number, fu: number, fv: number): number {
  const a = u * Math.PI * 2, b = v * Math.PI * 2, ru = fu / (Math.PI * 2), rv = fv / (Math.PI * 2);
  const nx = Math.cos(a) * ru, ny = Math.sin(a) * ru, nz = Math.cos(b) * rv, nw = Math.sin(b) * rv;
  return 0.5 * (s.noise3D(nx, ny, nz) + s.noise3D(ny + 7.1, nz, nw));
}
/**
 * 一张 = 1.28 m 见方、四版。每版一个色调;版内有细的夯层纹;版线是一道浅槽,
 * 线上隔一段一个穿棍孔(版筑拆模后留下的);另有顺墙流下的雨痕与砂粒。
 * 层线的**几何**槽由 `wall.ts` 的逐版挤出给,贴图这道只补色,不单独扛读法。
 */
function earthHeight(s: Simplex, u: number, v: number): number {
  const lift = v * 4, f = lift - Math.floor(lift);
  const wob = 0.012 * aniso(s, u, v, 9, 2);
  const groove = 1 - smoothstep(0.0, 0.03, Math.min(Math.abs(f - wob), Math.abs(1 - f + wob)));
  const tamp = 0.5 + 0.5 * Math.sin((f * 9 + 0.3 * aniso(s, u, v, 5, 3)) * Math.PI * 2);
  const grit = worley(u, v, 90, 31).f1;
  const hole = holes(u, v);
  return clamp(0.55 + 0.012 * tamp - 0.2 * groove + 0.12 * smoothstep(0.35, 0.0, grit) - 0.5 * hole + 0.08 * aniso(s, u, v, 3, 3) + 0.06 * aniso(s, u, v, 12, 5) + 0.06 * aniso(s, u, v, 60, 60), 0, 1);
}
function holes(u: number, v: number): number {
  // 穿棍孔:每条版线两孔,相邻版线错开半格。
  let best = 0;
  for (let k = 0; k <= 4; k++) {
    const y = k / 4, off = (k % 2) * 0.25;
    for (const x0 of [0.125 + off, 0.625 + off]) {
      let dx = Math.abs(u - (x0 % 1)); dx = Math.min(dx, 1 - dx);
      const dy = Math.abs(v - y);
      const d = Math.hypot(dx / 0.011, dy / 0.008);
      best = Math.max(best, smoothstep(1.2, 0.7, d));
    }
  }
  return best;
}
export function earthWallMaterial(): THREE.MeshStandardMaterial {
  return memo('xiangye.earth', () => {
    const size = 1024;
    const s = new Simplex(0xea27);
    const tones = [1.0, 0.95, 1.04, 0.97];
    const map = cached(recipeKey('xiangye.earth.albedo', size), () =>
      bakeColorMap({ size, color: (u, v) => {
        const lift = Math.min(3, Math.floor(v * 4));
        const hgt = earthHeight(s, u, v);
        const rain = smoothstep(0.2, 0.8, aniso(s, u, v, 14, 3) * 0.5 + 0.5) * 0.2;
        const blot = 0.5 + 0.5 * aniso(s, u, v, 5, 6);
        const c = mixHex(XY.earthDark, XY.earth, clamp(0.2 + hgt * 0.7 + blot * 0.3 - rain, 0, 1));
        const grain = worley(u, v, 150, 7).f1, speck = smoothstep(0.2, 0.05, grain);
        const pale = smoothstep(0.16, 0.04, worley(u + 0.37, v, 70, 9).f1);
        const k = tones[lift] * (1 - speck * 0.22) * (1 + pale * 0.18) * (1 - holes(u, v) * 0.6);
        return [c[0] * k, c[1] * k, c[2] * k];
      } }));
    const normalMap = cached(recipeKey('xiangye.earth.normal', size, 3.2), () => bakeNormalMap({ size, height: (u, v) => earthHeight(s, u, v) }, 3.2));
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
    const map = cached(recipeKey('xiangye.hedge-leaf.albedo', size), () => {
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
          const base = mixHex(0x4f7d2e, 0x6f9a3a, rng());
          const tip = mixHex(0x8fbd4e, 0xb9d86a, young);
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
