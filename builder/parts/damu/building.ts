import * as THREE from 'three';
import { registerPart, type PartBuild } from '@builder/parts/registry';
import { deriveBuilding, type BuildingSpec, type Frame } from '@builder/derive/index';
import { deriveFayuanBuilding, type FayuanBuildingSpec, type FayuanBuildingFrame } from '@builder/derive/fayuan/building';
import {
  CN,
  TILE_UV,
  woodMaterial,
  tileMaterial,
  plasterMaterial,
  stoneMaterial,
  paperMaterial,
  lacquerMaterial,
  goldMaterial,
} from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { makeRng, smoothstep, lerp, clamp } from '@engine/core/Noise';
import { mergeByMaterial } from '@builder/parts/merge';
import {compileRearDoor,compileExteriorSteps,type RearDoorSpec,type StairSpec,type WalkSurface} from '@builder/plan/building-access';

/**
 * 大木作建筑:结构尺寸来自推导表，原型支持法式及法原，不以材分字段伪装江南构造。
 *
 * 局部坐标:原点在台基中心地面,+X 沿面阔向东,+Z 朝正面(南)。
 * 屋面 = 举折剖面(自橑檐枋背到脊)+ 檐出,沿面阔放样;歇山在角部以 45° 收进
 * 到"转过 n 椽"处起山花;翼角在角部把檐口抬起(起翘)并外推(生出)。
 */

export interface BuildingOptions {
  spec: BuildingSpec | FayuanBuildingSpec;
  /** 匾额文字;空则不挂。 */
  plaque?: string;
  /** 前檐处理:格扇门/敞开/粉墙。 */
  front?: 'door' | 'open' | 'wall' | 'window';
  /** 两山:粉墙/敞开。 */
  sides?: 'wall' | 'open' | 'window';
  /** 后檐:粉墙/敞开/格扇门;缺省同 sides。 */
  back?: 'wall' | 'open' | 'door' | 'window';
  /** A small rear door within one bay; absent keeps the legacy full facade. */
  backDoor?:RearDoorSpec;
  steps?:{front?:StairSpec;back?:StairSpec};
  /** 亭/廊的美人靠。 */
  railing?: boolean;
  /** 美人靠装在哪几面(亭):e 东 w 西 n 北(后) s 南(前);缺省东西北。 */
  railingSides?: ('e' | 'w' | 'n' | 's')[];
  /** 台基高(米)。 */
  platformH?: number;
  platformMarginM?:number;
  /** 出际(米),硬山/悬山两山悬出。 */
  chuji?: number;
  /** 江南提栈覆盖举高比。 */
  ratio?: number;
  /** 墙体材质:粉墙 / 水磨砖(青石)。 */
  wallMaterial?: 'plaster' | 'stone';
  /** 当心间中间两扇门开着(默认开)。 */
  doorOpen?: boolean;
  seed?: number;
}

export interface BuildingResult extends PartBuild {
  frame: Frame | FayuanBuildingFrame;
  /** 台基平台(局部坐标),装配器登记用。 */
  platform: { hx: number; hz: number; y: number };
  walkSurfaces:WalkSurface[];
  /** 需要阻挡的柱与墙(局部坐标)。 */
  blockers: { cx: number; cz: number; hx: number; hz: number; h: number; minY?:number; rot?: number }[];
}

/* ------------------------------------------------------------------ */
/* 剖面                                                                */
/* ------------------------------------------------------------------ */

interface ProfilePt {
  /** 平面上离檐口尖端的距离(向屋中心为正)。 */
  s: number;
  /** 绝对高度。 */
  y: number;
}

/** 从推导表取一侧的屋面剖面:檐尖 → 橑檐枋背 → 各槫 → 脊。 */
function roofProfile(fr: Frame | FayuanBuildingFrame): { pts: ProfilePt[]; sEave: number; sRidge: number } {
  const m = fr.m;
  const tipX = m.eaveHalf + m.yanchu;
  if ('roofSection' in fr) return { pts: fr.roofSection, sEave: m.yanchu, sRidge: tipX };
  const pts: ProfilePt[] = [{ s: 0, y: m.eaveY - m.eaveTip.drop }];
  // 槫自脊向檐排列,反过来自檐向脊。
  const purl = m.purlins.slice().reverse();
  for (const p of purl) pts.push({ s: tipX - p.x, y: m.eaveY + p.y });
  return { pts, sEave: m.yanchu, sRidge: tipX };
}

/** 在剖面上按 s 插值高度(线性,槫间是直椽)。 */
function profileY(pts: ProfilePt[], s: number): number {
  if (s <= pts[0].s) return pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    if (s <= pts[i].s) {
      const t = (s - pts[i - 1].s) / (pts[i].s - pts[i - 1].s);
      return lerp(pts[i - 1].y, pts[i].y, t);
    }
  }
  return pts[pts.length - 1].y;
}

/** 把剖面细分成等 s 步的采样,让曲面顺滑(每架至少 4 段)。 */
function subdivide(pts: ProfilePt[], sMax: number, perJia = 5): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].s;
    const b = Math.min(pts[i].s, sMax);
    if (b <= a) break;
    for (let k = 0; k < perJia; k++) out.push(lerp(a, b, k / perJia));
    if (b < pts[i].s) break;
  }
  out.push(Math.min(sMax, pts[pts.length - 1].s));
  return out;
}

/* ------------------------------------------------------------------ */
/* 坡面网格                                                            */
/* ------------------------------------------------------------------ */

interface SlopeOpts {
  /** 剖面(局部:s 向 −Z 为屋内,+Z 为檐外)。 */
  pts: ProfilePt[];
  /** 采样到的 s 上限(歇山撒头只到转过点)。 */
  sMax: number;
  /** 檐口处 z(尖端)。 */
  zTip: number;
  /** 半宽函数:该 s 处坡面沿 X 的半宽。 */
  halfWidth: (s: number) => number;
  /** 角部抬升:输入 (x, s) 返回 dy。 */
  lift: (x: number, s: number, hw: number) => number;
  /** 角部外推:输入 (x, s, hw) 返回 dx(符号沿 x)。 */
  push: (x: number, s: number, hw: number) => number;
  cols: number;
  /** 顶面/底面偏移。 */
  offset: number;
  flip?: boolean;
  /** UV 比例:u 每米几垄,v 每米几步。 */
  uScale: number;
  vScale: number;
}

function buildSlope(o: SlopeOpts): THREE.BufferGeometry {
  const sRows = subdivide(o.pts, o.sMax);
  const rows = sRows.length;
  const cols = o.cols;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const s = sRows[r];
    const hw = o.halfWidth(s);
    const y0 = profileY(o.pts, s);
    for (let c = 0; c <= cols; c++) {
      const t = c / cols;
      let x = lerp(-hw, hw, t);
      x += o.push(x, s, hw);
      const y = y0 + o.lift(x, s, hw) + o.offset;
      const z = o.zTip - s;
      pos.push(x, y, z);
      uv.push(x * o.uScale, s * o.vScale);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      if (o.flip) idx.push(a, d, b, b, d, e);
      else idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 沿一条折线拉一根圆管(脊)。 */
function ridgeTube(points: THREE.Vector3[], r: number, mat: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2);
  const geo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), r, 8, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* 匾额                                                                */
/* ------------------------------------------------------------------ */

function plaqueTexture(text: string, w = 512, h = 192): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1c1a18';
  g.fillRect(0, 0, w, h);
  // 金字:楷体优先,系统缺字体时退到衬线。
  g.fillStyle = '#c9a84c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const n = Math.max(1, text.length);
  const size = Math.min(h * 0.7, (w * 0.86) / n);
  g.font = `bold ${size}px "STKaiti","KaiTi","Kaiti SC","Noto Serif SC","Songti SC",serif`;
  const gap = size * 1.06;
  const x0 = w / 2 - ((n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) g.fillText(text[i], x0 + i * gap, h / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makePlaque(text: string, width: number): THREE.Group {
  const g = new THREE.Group();
  const h = width * 0.36;
  const board = new THREE.Mesh(roundedBox(width, h, 0.06, 0.012, 3), lacquerMaterial());
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.94, h * 0.84),
    new THREE.MeshStandardMaterial({ map: plaqueTexture(text), roughness: 0.4, metalness: 0.2 }),
  );
  face.position.z = 0.032;
  board.castShadow = true;
  g.add(board, face);
  // 金边:四条细条。
  const edge = goldMaterial();
  const t = 0.02;
  for (const [x, y, sx, sy] of [
    [0, h / 2 - t / 2, width, t],
    [0, -h / 2 + t / 2, width, t],
    [-width / 2 + t / 2, 0, t, h],
    [width / 2 - t / 2, 0, t, h],
  ]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.012), edge);
    e.position.set(x, y, 0.036);
    g.add(e);
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* 格扇                                                                */
/* ------------------------------------------------------------------ */

/** 一扇格扇:上部花格(万字/方格)、下部裙板。 */
function makeGeshan(w: number, h: number, mat: THREE.Material, paper: THREE.Material, seed: number): THREE.Group {
  const g = new THREE.Group();
  const bar = 0.035;
  const frameD = 0.05;
  // 外框。
  const add = (x: number, y: number, sx: number, sy: number, d = frameD) => {
    // 细于 4cm 的棂条倒角看不见,用直箱省 15 倍三角。
    const thinBar = Math.min(sx, sy) < 0.04;
    const m = new THREE.Mesh(thinBar ? new THREE.BoxGeometry(sx, sy, d) : roundedBox(sx, sy, d, 0.006, 1), mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  add(0, h / 2 - bar / 2, w, bar);
  add(0, -h / 2 + bar / 2, w, bar);
  add(-w / 2 + bar / 2, 0, bar, h);
  add(w / 2 - bar / 2, 0, bar, h);
  // 抹头:裙板与花格的分界在 0.38h。
  const split = -h / 2 + h * 0.38;
  add(0, split, w, bar);
  add(0, split + bar * 1.6, w, bar * 0.6, frameD * 0.8);
  // 裙板。
  const skirt = new THREE.Mesh(roundedBox(w - bar * 2, h * 0.38 - bar * 1.5, 0.03, 0.005, 2), mat);
  skirt.position.set(0, (-h / 2 + split) / 2, 0);
  skirt.receiveShadow = true;
  g.add(skirt);
  // 花格:窗纸打底,上面方格棂条(带一点错位的"步步锦")。
  const gy0 = split + bar * 2.2;
  const gy1 = h / 2 - bar;
  const gh = gy1 - gy0;
  const gw = w - bar * 2;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), paper);
  p.position.set(0, (gy0 + gy1) / 2, 0);
  g.add(p);
  const rng = makeRng(seed);
  const nx = Math.max(2, Math.round(gw / 0.14));
  const ny = Math.max(3, Math.round(gh / 0.14));
  const thin = 0.018;
  for (let i = 1; i < nx; i++) {
    const x = -gw / 2 + (gw * i) / nx;
    const segs = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < segs; k++) {
      const y0 = gy0 + (gh * k) / segs + (k > 0 ? 0.03 : 0);
      const y1 = gy0 + (gh * (k + 1)) / segs - (k < segs - 1 ? 0.03 : 0);
      add(x, (y0 + y1) / 2, thin, y1 - y0, 0.03);
    }
  }
  for (let j = 1; j < ny; j++) {
    const y = gy0 + (gh * j) / ny;
    const segs = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < segs; k++) {
      const x0 = -gw / 2 + (gw * k) / segs + (k > 0 ? 0.03 : 0);
      const x1 = -gw / 2 + (gw * (k + 1)) / segs - (k < segs - 1 ? 0.03 : 0);
      add((x0 + x1) / 2, y, x1 - x0, thin, 0.03);
    }
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* 主体                                                                */
/* ------------------------------------------------------------------ */

export function buildBuilding(opts: BuildingOptions): BuildingResult {
  if((opts.backDoor||opts.steps?.back)&&opts.back!=='door')throw new Error('后门与后踏步须对应back:door');
  if(opts.steps&&(!Number.isFinite(opts.platformMarginM)||opts.platformMarginM!<=0))throw new Error('显式踏步须声明台基出边');
  const fr = 'paramSet' in opts.spec ? deriveFayuanBuilding(opts.spec) : deriveBuilding(opts.spec);
  const legacy = 'cai' in fr ? fr : null;
  const rolled = 'ridgeStyle' in fr && fr.ridgeStyle === 'rolled';
  const m = fr.m;
  const seed = opts.seed ?? 7;
  const root = new THREE.Group();
  root.name = 'Building';
  const blockers: BuildingResult['blockers'] = [];
  const walkSurfaces:WalkSurface[]=[];
  let rearDoor:ReturnType<typeof compileRearDoor>|null=null;

  const wood = woodMaterial(CN.wood, 1);
  const column = woodMaterial(CN.column, 1);
  const tile = tileMaterial(1, 1);
  const stone = stoneMaterial(1);
  const plaster = opts.wallMaterial === 'stone' ? stoneMaterial(2) : plasterMaterial(1);
  const paper = paperMaterial();
  const ridgeMat = new THREE.MeshStandardMaterial({ color: CN.tile, roughness: 0.85 });
  const underside = new THREE.MeshStandardMaterial({ color: 0x4a3226, roughness: 0.9, side: THREE.DoubleSide });

  const isTing = opts.spec.roofType === '攒尖';
  const isXieshan = opts.spec.roofType === '歇山';
  const isYingshan = opts.spec.roofType === '硬山' || opts.spec.roofType === '悬山';
  if (isYingshan && opts.sides === 'window')
    throw new Error('硬山窗墙尚需上部山墙独立构造，不得省掉山墙');

  const wallT0 = 0.26;

  /* ---- 台基 ------------------------------------------------------- */
  const platH = opts.platformH ?? 0.45;
  const margin = opts.platformMarginM ?? (isTing ? 0.55 : 0.9);
  const platHX = m.width / 2 + margin;
  const platHZ = m.depthHalf + margin;
  const plat = new THREE.Mesh(roundedBox(platHX * 2, platH, platHZ * 2, 0.03, 3), stone);
  plat.position.y = platH / 2;
  plat.receiveShadow = true;
  plat.castShadow = true;
  root.add(plat);
  // 阶条石一圈略凸。
  const rim = new THREE.Mesh(roundedBox(platHX * 2 + 0.08, 0.1, platHZ * 2 + 0.08, 0.02, 2), stone);
  rim.position.y = platH - 0.05;
  rim.receiveShadow = true;
  root.add(rim);
  // 正面踏步。
  const stepW = isTing ? m.width * 0.5 : Math.max(1.2, m.width * 0.3);
  const nSteps = Math.max(2, Math.round(platH / 0.15));
  for (let i = 0; i < (opts.steps?.front?0:nSteps); i++) {
    const h = platH / nSteps;
    const d = 0.3;
    const st = new THREE.Mesh(roundedBox(stepW, h, d, 0.015, 2), stone);
    st.position.set(0, h * (nSteps - i) - h / 2, platHZ + d / 2 + d * i);
    st.receiveShadow = true;
    st.castShadow = true;
    root.add(st);
  }
  for(const side of ['front','back'] as const) {
    const spec=opts.steps?.[side];if(!spec)continue;
    const surfaces=compileExteriorSteps(platH,platHX,platHZ,side,spec,side==='back'?(opts.backDoor?.centerXM??0):0);
    for(const p of surfaces) {
      const st=new THREE.Mesh(roundedBox(p.hx*2,p.y,p.hz*2,.015,2),stone);
      st.position.set(p.cx,p.y/2,p.cz);st.receiveShadow=true;st.castShadow=true;root.add(st);
    }
    walkSurfaces.push(...surfaces);
  }

  /* ---- 柱网 ------------------------------------------------------- */
  const colXs = m.columnX;
  const rowsZ = [m.depthHalf, -m.depthHalf];
  const colH = m.columnH;
  const colR = m.columnD / 2;
  const columns: { x: number; z: number; h: number }[] = [];
  const addColumn = (x: number, z: number, rise: number) => {
    const h = colH + rise;
    // 梭柱:上三分之一微收 [03-06]。
    const geo = new THREE.CylinderGeometry(colR * 0.92, colR, h, 18, 1);
    const c = new THREE.Mesh(geo, column);
    c.position.set(x, platH + h / 2, z);
    c.castShadow = true;
    c.receiveShadow = true;
    root.add(c);
    // 柱础:方 2D,覆盆。
    const base = new THREE.Mesh(roundedBox(m.base, 0.1, m.base, 0.02, 2), stone);
    base.position.set(x, platH + 0.05, z);
    base.receiveShadow = true;
    root.add(base);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(colR * 1.25, m.base * 0.48, 0.07, 18), stone);
    bowl.position.set(x, platH + 0.135, z);
    root.add(bowl);
    columns.push({ x, z, h });
    blockers.push({ cx: x, cz: z, hx: colR + 0.02, hz: colR + 0.02, h: platH + h });
  };
  for (let i = 0; i < colXs.length; i++) {
    for (const z of rowsZ) addColumn(colXs[i], z, m.rise[i]);
  }
  // 两山中柱(硬山/歇山的山面在多椽时加一根;四椽以内不加)。

  /* ---- 阑额 / 普拍枋 ----------------------------------------------- */
  const lanTop = platH + colH;
  const addBeam = (x0: number, z0: number, x1: number, z1: number, w: number, t: number, yTop: number, mat: THREE.Material) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const b = new THREE.Mesh(roundedBox(len, w, t, 0.012, 2), mat);
    b.position.set((x0 + x1) / 2, yTop - w / 2, (z0 + z1) / 2);
    b.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    b.castShadow = true;
    b.receiveShadow = true;
    root.add(b);
  };
  for (const z of rowsZ) {
    for (let i = 1; i < colXs.length; i++) addBeam(colXs[i - 1], z, colXs[i], z, m.lan.w, m.lan.t, lanTop, wood);
  }
  for (const x of [colXs[0], colXs[colXs.length - 1]]) addBeam(x, rowsZ[0], x, rowsZ[1], m.lan.w, m.lan.t, lanTop, wood);
  // 普拍枋:一圈扁枋压在阑额上 [03-19]。
  // 法原连机/夹堂高度已在推导的檐高里计入，不再叠加宋式普拍枋。
  const pupai = legacy ? 0.09 : 0;
  const ring = new THREE.Group();
  if (pupai > 0) {
    for (const z of rowsZ) addBeam(colXs[0] - 0.15, z, colXs[colXs.length - 1] + 0.15, z, pupai, m.lan.t * 1.3, lanTop + pupai, wood);
    for (const x of [colXs[0], colXs[colXs.length - 1]]) addBeam(x, rowsZ[0] + 0.15, x, rowsZ[1] - 0.15, pupai, m.lan.t * 1.3, lanTop + pupai, wood);
  }
  root.add(ring);

  /* ---- 铺作(简化) -------------------------------------------------- */
  const puzuoTop = lanTop + pupai + m.puzuoH;
  if (legacy?.puzuo) {
    const f = legacy.cai.fenM;
    const ludou = new THREE.Mesh(roundedBox(32 * f, 20 * f, 32 * f, 0.01, 1), wood);
    const gong = new THREE.Mesh(roundedBox(72 * f, 21 * f, 10 * f, 0.01, 1), wood);
    const linggong = new THREE.Mesh(roundedBox(72 * f, 15 * f, 10 * f, 0.01, 1), wood);
    const placeSet = (x: number, z: number, outward: THREE.Vector2) => {
      const g = new THREE.Group();
      const l = ludou.clone();
      l.position.y = 10 * f;
      g.add(l);
      const out = legacy.puzuo!.outFen * f;
      // 华栱沿出跳方向,令栱横向,叠到铺作高。
      let y = 20 * f;
      for (let j = 0; j < legacy.puzuo!.T; j++) {
        const h = gong.clone();
        h.position.set(outward.x * out * 0.5 * (j + 1) / legacy.puzuo!.T, y + 10.5 * f, outward.y * out * 0.5 * (j + 1) / legacy.puzuo!.T);
        h.rotation.y = Math.abs(outward.x) > 0.5 ? 0 : Math.PI / 2;
        g.add(h);
        y += 21 * f;
      }
      const lg = linggong.clone();
      lg.position.set(outward.x * out, y + 7.5 * f, outward.y * out);
      lg.rotation.y = Math.abs(outward.x) > 0.5 ? Math.PI / 2 : 0;
      g.add(lg);
      g.position.set(x, lanTop + pupai, z);
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      root.add(g);
    };
    for (let i = 0; i < colXs.length; i++) {
      placeSet(colXs[i], rowsZ[0], new THREE.Vector2(0, 1));
      placeSet(colXs[i], rowsZ[1], new THREE.Vector2(0, -1));
    }
    // 补间:每间一朵(江南亭榭)。
    for (let i = 1; i < colXs.length; i++) {
      const x = (colXs[i - 1] + colXs[i]) / 2;
      placeSet(x, rowsZ[0], new THREE.Vector2(0, 1));
      placeSet(x, rowsZ[1], new THREE.Vector2(0, -1));
    }
    if (isTing || isXieshan) {
      for (const x of [colXs[0], colXs[colXs.length - 1]]) {
        const sgn = Math.sign(x) || 1;
        placeSet(x, 0, new THREE.Vector2(sgn, 0));
      }
    }
  }

  /* ---- 橑檐枋 ----------------------------------------------------- */
  // 枋高 = 推导表里 eaveY(柱脚起) 减去柱高与铺作高;普拍枋是本文件加的,不计入。
  const fangH = m.eaveY - m.columnH - m.puzuoH;
  const fangY = puzuoTop + fangH - platH; // 枋背(自台基面)
  const eaveHalfX = m.width / 2 + (isYingshan ? 0 : m.puzuoOut);
  const eaveHalfZ = m.eaveHalf;
  const fh = Math.max(0.12, fangH);
  // 枋背贴着屋面板底:屋面在橑檐枋位的表面高 = platH + pupai + eaveY,板厚 thick。
  const fangTop = platH + pupai + m.eaveY - 0.14;
  addBeam(-eaveHalfX - 0.1, eaveHalfZ, eaveHalfX + 0.1, eaveHalfZ, fh, 0.12, fangTop, wood);
  addBeam(-eaveHalfX - 0.1, -eaveHalfZ, eaveHalfX + 0.1, -eaveHalfZ, fh, 0.12, fangTop, wood);
  if (!isYingshan) {
    addBeam(eaveHalfX, eaveHalfZ, eaveHalfX, -eaveHalfZ, fh, 0.12, fangTop, wood);
    addBeam(-eaveHalfX, eaveHalfZ, -eaveHalfX, -eaveHalfZ, fh, 0.12, fangTop, wood);
  }

  /* ---- 屋面 ------------------------------------------------------- */
  const prof = roofProfile(fr);
  // 剖面高度以地面为 0:推导表里 eaveY 自柱脚起,加台基。
  const pts = prof.pts.map((p) => ({ s: p.s, y: p.y + platH + pupai }));
  const sRidge = prof.sRidge; // 檐尖到脊的平面距离
  const tipZ = eaveHalfZ + m.yanchu;
  const tipX = eaveHalfX + m.yanchu;
  const qiqiao = m.qiqiao;
  const shengchu = m.shengchu;
  // 法式转椽与法原显式侧样是两条尺寸来源，不借用材分或屋顶预设互相冒充。
  const legacyTurn = legacy && !('paramSet' in opts.spec)
    ? Math.min(sRidge - 0.05, m.yanchu + m.puzuoOut + legacy.yanchu.xieshanTurn * m.depth / opts.spec.rafters) : 0;
  const sTurn = isTing ? sRidge : isXieshan ? ('hipSetbackM' in fr ? fr.hipSetbackM : legacyTurn) : 0;
  const cornerLen = Math.max(0.8, sTurn * 0.9);

  const cornerT = (x: number, hw: number) => clamp((Math.abs(x) - (hw - cornerLen)) / cornerLen, 0, 1);
  const lift = (x: number, s: number, hw: number) => {
    if (qiqiao <= 0 || isYingshan) return 0;
    const t = cornerT(x, hw);
    const up = 1 - smoothstep(0, sTurn, s);
    // 嫩戗发戗:近角急起。
    return qiqiao * Math.pow(t, 2.2) * up;
  };
  const push = (x: number, s: number, hw: number) => {
    if (isYingshan) return 0;
    const t = cornerT(x, hw);
    const up = 1 - smoothstep(0, sTurn, s);
    return Math.sign(x) * shengchu * Math.pow(t, 1.6) * up;
  };
  // 贴图一个周期 12 垄 × ~19 排:垄宽 0.2m、排距 0.26m。
  const uScale = TILE_UV.u;
  const vScale = TILE_UV.v;
  const thick = 0.16;

  const roofGroup = new THREE.Group();
  roofGroup.name = 'Roof';
  const addSurface = (geoTop: THREE.BufferGeometry, geoBot: THREE.BufferGeometry, rotY: number) => {
    const top = new THREE.Mesh(geoTop, tile);
    const bot = new THREE.Mesh(geoBot, underside);
    top.rotation.y = rotY;
    bot.rotation.y = rotY;
    top.castShadow = true;
    top.receiveShadow = true;
    bot.receiveShadow = true;
    roofGroup.add(top, bot);
  };

  const mkPair = (halfWidth: (s: number) => number, zTip: number, sMax: number, rotY: number) => {
    const common = { pts, sMax, zTip, halfWidth, lift, push, cols: 40, uScale, vScale };
    addSurface(
      buildSlope({ ...common, offset: 0 }),
      buildSlope({ ...common, offset: -thick, flip: true }),
      rotY,
    );
  };

  if (isYingshan) {
    const chuji = opts.chuji ?? 0.35;
    const hw = () => m.width / 2 + chuji;
    mkPair(hw, tipZ, sRidge, 0);
    mkPair(hw, tipZ, sRidge, Math.PI);
  } else if (isXieshan) {
    // 前后坡:角部 45° 收进到转过点,之后等宽(山花面)。
    const hwFB = (s: number) => tipX - Math.min(s, sTurn);
    mkPair(hwFB, tipZ, sRidge, 0);
    mkPair(hwFB, tipZ, sRidge, Math.PI);
    // 撒头(两山下坡):只到转过点,宽度按同样收进。
    const hwSide = (s: number) => tipZ - Math.min(s, sTurn);
    mkPair(hwSide, tipX, sTurn, Math.PI / 2);
    mkPair(hwSide, tipX, sTurn, -Math.PI / 2);
  } else {
    // 攒尖:四坡收到尖。
    const hw = (s: number) => Math.max(0.001, tipX - s * (tipX / sRidge));
    const hwZ = (s: number) => Math.max(0.001, tipZ - s * (tipZ / sRidge));
    mkPair(hw, tipZ, sRidge, 0);
    mkPair(hw, tipZ, sRidge, Math.PI);
    mkPair(hwZ, tipX, sRidge, Math.PI / 2);
    mkPair(hwZ, tipX, sRidge, -Math.PI / 2);
  }
  root.add(roofGroup);

  /* ---- 连檐(檐口封边) --------------------------------------------- */
  const eaveEdge = (halfWidth: (s: number) => number, zTip: number, rotY: number) => {
    const n = 40;
    const pos: number[] = [];
    const idx: number[] = [];
    const hw = halfWidth(0);
    for (let i = 0; i <= n; i++) {
      let x = lerp(-hw, hw, i / n);
      x += push(x, 0, hw);
      const y = pts[0].y + lift(x, 0, hw);
      pos.push(x, y + 0.01, zTip, x, y - thick, zTip);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, wood);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    root.add(mesh);
  };
  if (isYingshan) {
    const hw = () => m.width / 2 + (opts.chuji ?? 0.35);
    eaveEdge(hw, tipZ, 0);
    eaveEdge(hw, tipZ, Math.PI);
  } else if (isXieshan) {
    eaveEdge((s) => tipX - Math.min(s, sTurn), tipZ, 0);
    eaveEdge((s) => tipX - Math.min(s, sTurn), tipZ, Math.PI);
    eaveEdge((s) => tipZ - Math.min(s, sTurn), tipX, Math.PI / 2);
    eaveEdge((s) => tipZ - Math.min(s, sTurn), tipX, -Math.PI / 2);
  } else {
    eaveEdge(() => tipX, tipZ, 0);
    eaveEdge(() => tipX, tipZ, Math.PI);
    eaveEdge(() => tipZ, tipX, Math.PI / 2);
    eaveEdge(() => tipZ, tipX, -Math.PI / 2);
  }

  /* ---- 脊 --------------------------------------------------------- */
  const ridgeY = pts[pts.length - 1].y;
  if ((isYingshan || isXieshan) && !rolled) {
    const hwRidge = isYingshan ? m.width / 2 + (opts.chuji ?? 0.35) : tipX - sTurn;
    const ends = 0.16; // 纹头脊:两端微翘。
    const p: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = lerp(-hwRidge, hwRidge, t);
      const e = Math.pow(Math.abs(t - 0.5) * 2, 4) * ends;
      p.push(new THREE.Vector3(x, ridgeY + 0.1 + e, 0));
    }
    root.add(ridgeTube(p, 0.11, ridgeMat));
    // 端头小翘(哺鸡脊的意思)。
    for (const sx of [-1, 1]) {
      const k = new THREE.Mesh(roundedBox(0.22, 0.34, 0.22, 0.04, 3), ridgeMat);
      k.position.set(sx * hwRidge, ridgeY + 0.22 + ends, 0);
      k.rotation.z = -sx * 0.25;
      k.castShadow = true;
      root.add(k);
    }
  }
  if (isXieshan) {
    // 戗脊(角部 45°)四条 + 垂脊(山花边)四条。
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const p: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const s = (sTurn * i) / 8;
        const hw = tipX - s;
        const x = sx * hw;
        p.push(new THREE.Vector3(x + push(x, s, hw), profileY(pts, s) + lift(x, s, hw) + 0.06, sz * (tipZ - s)));
      }
      root.add(ridgeTube(p, 0.07, ridgeMat));
      const q: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const s = lerp(sTurn, sRidge, i / 8);
        q.push(new THREE.Vector3(sx * (tipX - sTurn), profileY(pts, s) + 0.07, sz * (tipZ - s)));
      }
      root.add(ridgeTube(q, 0.07, ridgeMat));
    }
    // 山花:垂直三角面,粉墙。
    for (const sx of [-1, 1]) {
      const shape = new THREE.Shape();
      const xg = tipX - sTurn;
      const zTop = 0;
      shape.moveTo(-(tipZ - sTurn), profileY(pts, sTurn) - 0.02);
      const N = 10;
      for (let i = 1; i <= N; i++) {
        const s = lerp(sTurn, sRidge, i / N);
        shape.lineTo(-(tipZ - s), profileY(pts, s) - 0.02);
      }
      for (let i = N - 1; i >= 0; i--) {
        const s = lerp(sTurn, sRidge, i / N);
        shape.lineTo(tipZ - s, profileY(pts, s) - 0.02);
      }
      shape.lineTo(tipZ - sTurn, profileY(pts, sTurn) - 0.02);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, plaster);
      mesh.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh.position.set(sx * (xg - 0.06), 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      void zTop;
    }
  }
  if (isTing) {
    // 四条戗脊到尖 + 宝顶。
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const p: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const s = (sRidge * i) / 10;
        const hw = Math.max(0.001, tipX - s * (tipX / sRidge));
        const hz = Math.max(0.001, tipZ - s * (tipZ / sRidge));
        const x = sx * hw;
        p.push(new THREE.Vector3(x + push(x, s, hw), profileY(pts, s) + lift(x, s, hw) + 0.06, sz * hz));
      }
      root.add(ridgeTube(p, 0.07, ridgeMat));
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), ridgeMat);
    top.position.y = ridgeY + 0.25;
    top.castShadow = true;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.3, 14), ridgeMat);
    neck.position.y = ridgeY + 0.05;
    root.add(top, neck);
  }

  /* ---- 硬山山墙:从台基一直砌到屋面下 ------------------------------ */
  if (isYingshan && (opts.sides ?? 'wall') === 'wall') {
    for (const sx of [-1, 1]) {
      const shape = new THREE.Shape();
      const zEdge = m.depthHalf + wallT0 / 2;
      shape.moveTo(-zEdge, platH);
      shape.lineTo(zEdge, platH);
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const z = lerp(zEdge, -zEdge, i / N);
        shape.lineTo(z, profileY(pts, tipZ - Math.abs(z)) - 0.05);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: wallT0, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, plaster);
      mesh.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh.position.set(sx * (m.width / 2 + wallT0 / 2), 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      blockers.push({ cx: sx * (m.width / 2), cz: 0, hx: wallT0 / 2, hz: zEdge, h: platH + colH });
    }
  }

  /* ---- 墙与格扇 --------------------------------------------------- */
  const wallT = 0.26;
  const wallH = colH - 0.02;
  const addWall = (x0: number, z0: number, x1: number, z1: number, h: number, yBase: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const w = new THREE.Mesh(roundedBox(len, h, wallT, 0.01, 2), plaster);
    w.position.set((x0 + x1) / 2, yBase + h / 2, (z0 + z1) / 2);
    w.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    w.castShadow = true;
    w.receiveShadow = true;
    root.add(w);
    blockers.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: len / 2, hz: wallT / 2, h: yBase + h, rot: -Math.atan2(z1 - z0, x1 - x0) });
  };
  /**
   * 按铰链放一扇格扇:hinge 是转轴所在的 x(局部),side=+1 表示门扇在转轴右边。
   * open 为开启角(弧度),正值向外(+Z)推开。
   */
  const hingedPanel = (g: THREE.Group, gw: number, hingeX: number, side: 1 | -1, y: number, z: number, open: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, y, z);
    g.position.set((side * gw) / 2, 0, 0);
    pivot.add(g);
    pivot.rotation.y = -side * open;
    root.add(pivot);
  };
  const doorOpen = opts.doorOpen ?? true;
  const front = opts.front ?? (isTing ? 'open' : 'door');
  const sides = opts.sides ?? (isTing ? 'open' : 'wall');
  const back = opts.back ?? sides;
  const addWindowWall = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1-x0,z1-z0), sillH = wallH * 0.36;
    const rotation = -Math.atan2(z1-z0,x1-x0);
    addWall(x0,z0,x1,z1,sillH,platH);
    const panels = Math.max(2, Math.ceil(len / 0.85));
    for (let k=0;k<panels;k++) {
      const g = makeGeshan(len/panels-.015,wallH-sillH-.08,wood,paper,seed+80+k);
      const t = (k+.5)/panels;
      g.position.set(lerp(x0,x1,t),platH+sillH+(wallH-sillH)/2,lerp(z0,z1,t));
      g.rotation.y=rotation;
      root.add(g);
    }
    blockers.push({cx:(x0+x1)/2,cz:(z0+z1)/2,hx:len/2,hz:wallT/2,h:platH+wallH,rot:rotation});
  };
  if (back === 'wall') addWall(colXs[0], rowsZ[1], colXs[colXs.length - 1], rowsZ[1], wallH, platH);
  if (back === 'window') addWindowWall(colXs[0],rowsZ[1],colXs[colXs.length-1],rowsZ[1]);
  if (sides === 'window') {
    addWindowWall(colXs[0],rowsZ[0],colXs[0],rowsZ[1]);
    addWindowWall(colXs[colXs.length-1],rowsZ[0],colXs[colXs.length-1],rowsZ[1]);
  }
  if (back === 'door' && opts.backDoor) {
    const s=opts.backDoor,d=compileRearDoor(m,platH,wallH,s);rearDoor=d;
    // One notched plaster panel avoids bevel/UV seams from three adjacent
    // boxes. The three collision spans retain the actual opening below lintel.
    const left=colXs[0],right=colXs.at(-1)!,dl=d.left-s.jambM,dr=d.right+s.jambM;
    const outline=new THREE.Shape();
    outline.moveTo(left,platH);outline.lineTo(dl,platH);outline.lineTo(dl,d.headerTop);
    outline.lineTo(dr,d.headerTop);outline.lineTo(dr,platH);outline.lineTo(right,platH);
    outline.lineTo(right,platH+wallH);outline.lineTo(left,platH+wallH);outline.closePath();
    const rearWall=new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:wallT,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:2,steps:1}),plaster);
    rearWall.position.z=d.z-wallT/2;rearWall.castShadow=true;rearWall.receiveShadow=true;root.add(rearWall);
    blockers.push({cx:(left+dl)/2,cz:d.z,hx:(dl-left)/2,hz:wallT/2,h:platH+wallH});
    blockers.push({cx:(dr+right)/2,cz:d.z,hx:(right-dr)/2,hz:wallT/2,h:platH+wallH});
    blockers.push({cx:(dl+dr)/2,cz:d.z,hx:(dr-dl)/2,hz:wallT/2,minY:d.headerTop,h:platH+wallH});
    for(const x of [d.left-s.jambM/2,d.right+s.jambM/2]) {
      const jamb=new THREE.Mesh(roundedBox(s.jambM,d.headerTop-platH,wallT+.04,.008,2),wood);
      jamb.position.set(x,(platH+d.headerTop)/2,d.z);jamb.castShadow=true;jamb.receiveShadow=true;root.add(jamb);
      blockers.push({cx:x,cz:d.z,hx:s.jambM/2,hz:(wallT+.04)/2,minY:platH,h:d.headerTop});
    }
    const lintel=new THREE.Mesh(roundedBox(s.widthM,s.lintelM,wallT+.04,.008,2),wood);
    lintel.position.set(s.centerXM,d.top+s.lintelM/2,d.z);lintel.castShadow=true;lintel.receiveShadow=true;root.add(lintel);
    blockers.push({cx:s.centerXM,cz:d.z,hx:s.widthM/2,hz:(wallT+.04)/2,minY:d.top,h:d.headerTop});
    if(s.sillM>0) {
      const sill=new THREE.Mesh(roundedBox(s.widthM,s.sillM,d.surface.hz*2,.008,2),wood);
      sill.position.set(s.centerXM,platH+s.sillM/2,d.z);sill.receiveShadow=true;root.add(sill);walkSurfaces.push(d.surface);
    }
    const pivot=new THREE.Group(),leaf=new THREE.Mesh(roundedBox(d.leafWidth,s.heightM,s.leafThicknessM,.01,2),wood);
    leaf.position.set(d.leafWidth/2,s.heightM/2,0);leaf.castShadow=true;leaf.receiveShadow=true;pivot.add(leaf);
    pivot.position.set(d.hingeX,d.bottom,d.z);pivot.rotation.y=doorOpen?Math.PI/2:0;root.add(pivot);
    blockers.push({cx:doorOpen?d.hingeX:s.centerXM,cz:doorOpen?d.z-d.leafWidth/2:d.z,hx:d.leafWidth/2,hz:s.leafThicknessM/2,
      minY:d.bottom,h:d.top,rot:doorOpen?Math.PI/2:0});
  } else if (back === 'door') {
    const span = colXs[colXs.length - 1] - colXs[0] - 2 * colR;
    const gw = span / 4;
    const bx0 = colXs[0] + colR;
    const by = platH + (wallH - 0.1) / 2 + 0.05;
    for (let k = 0; k < 4; k++) {
      const g = makeGeshan(gw - 0.01, wallH - 0.1, wood, paper, seed + 40 + k);
      if (k === 0 || k === 3) {
        g.position.set(bx0 + gw * (k + 0.5), by, rowsZ[1]);
        root.add(g);
      } else if (k === 1) hingedPanel(g, gw - 0.01, bx0 + gw, 1, by, rowsZ[1], -(doorOpen ? 1.62 : 0.3));
      else hingedPanel(g, gw - 0.01, bx0 + gw * 3, -1, by, rowsZ[1], -(doorOpen ? 1.62 : 0.3));
    }
    blockers.push({ cx: colXs[0] + colR + gw * 0.5, cz: rowsZ[1], hx: gw * 0.5, hz: 0.06, h: platH + wallH });
    blockers.push({ cx: colXs[colXs.length - 1] - colR - gw * 0.5, cz: rowsZ[1], hx: gw * 0.5, hz: 0.06, h: platH + wallH });
  }
  if (sides === 'wall') {
    if (!isYingshan) {
      addWall(colXs[0], rowsZ[0], colXs[0], rowsZ[1], wallH, platH);
      addWall(colXs[colXs.length - 1], rowsZ[0], colXs[colXs.length - 1], rowsZ[1], wallH, platH);
    }
  }
  if (front === 'wall') {
    addWall(colXs[0], rowsZ[0], colXs[colXs.length - 1], rowsZ[0], wallH, platH);
  } else if (front === 'window') {
    addWindowWall(colXs[0],rowsZ[0],colXs[colXs.length-1],rowsZ[0]);
  } else if (front === 'door') {
    // 每间四扇格扇;当心间为门(可开),次间为槛窗(下半粉墙)。
    const center = Math.floor((colXs.length - 1) / 2);
    for (let i = 1; i < colXs.length; i++) {
      const x0 = colXs[i - 1] + colR;
      const x1 = colXs[i] - colR;
      const span = x1 - x0;
      const isCenter = i - 1 === center;
      const n = 4;
      const gw = span / n;
      const z = rowsZ[0];
      if (isCenter) {
        const py = platH + (wallH - 0.1) / 2 + 0.05;
        for (let k = 0; k < n; k++) {
          const g = makeGeshan(gw - 0.01, wallH - 0.1, wood, paper, seed + k + i * 10);
          if (k === 0 || k === 3) {
            g.position.set(x0 + gw * (k + 0.5), py, z);
            root.add(g);
          } else if (k === 1) {
            // 左内扇:铰链在左邻扇的分界,向外推开贴到左扇上。
            hingedPanel(g, gw - 0.01, x0 + gw, 1, py, z, doorOpen ? 1.62 : 0.3);
          } else {
            hingedPanel(g, gw - 0.01, x0 + gw * 3, -1, py, z, doorOpen ? 1.62 : 0.3);
          }
        }
        // 门槛。
        const sill = new THREE.Mesh(roundedBox(span, 0.1, 0.16, 0.01, 2), wood);
        sill.position.set((x0 + x1) / 2, platH + 0.05, z);
        root.add(sill);
        // 门洞两侧留碰撞,中间可过。
        blockers.push({ cx: x0 + gw * 0.5, cz: z, hx: gw * 0.5, hz: 0.06, h: platH + wallH });
        blockers.push({ cx: x1 - gw * 0.5, cz: z, hx: gw * 0.5, hz: 0.06, h: platH + wallH });
      } else {
        const sillH = wallH * 0.36;
        const w = new THREE.Mesh(roundedBox(span, sillH, wallT, 0.01, 2), plaster);
        w.position.set((x0 + x1) / 2, platH + sillH / 2, z);
        w.castShadow = true;
        w.receiveShadow = true;
        root.add(w);
        const cap = new THREE.Mesh(roundedBox(span, 0.08, wallT + 0.06, 0.01, 2), wood);
        cap.position.set((x0 + x1) / 2, platH + sillH + 0.04, z);
        root.add(cap);
        for (let k = 0; k < n; k++) {
          const g = makeGeshan(gw - 0.01, wallH - sillH - 0.16, wood, paper, seed + k + i * 10);
          g.position.set(x0 + gw * (k + 0.5), platH + sillH + 0.08 + (wallH - sillH - 0.16) / 2, z);
          root.add(g);
        }
        blockers.push({ cx: (x0 + x1) / 2, cz: z, hx: span / 2, hz: 0.1, h: platH + wallH });
      }
    }
  }

  /* ---- 美人靠 ------------------------------------------------------ */
  if (opts.railing) {
    const railH = 0.48;
    const seatH = 0.42;
    const addRail = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.Group();
      const seat = new THREE.Mesh(roundedBox(len, 0.05, 0.36, 0.01, 2), wood);
      seat.position.y = platH + seatH;
      const back = new THREE.Mesh(roundedBox(len, 0.05, 0.05, 0.01, 2), wood);
      back.position.set(0, platH + seatH + railH, -0.16);
      back.rotation.x = -0.18;
      g.add(seat, back);
      const n = Math.max(3, Math.round(len / 0.32));
      for (let i = 0; i <= n; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, railH, 0.035), wood);
        b.position.set(-len / 2 + (len * i) / n, platH + seatH + railH / 2, -0.12);
        b.rotation.x = -0.18;
        g.add(b);
      }
      g.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      g.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      root.add(g);
      blockers.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: len / 2, hz: 0.18, h: platH + seatH + railH, rot: -Math.atan2(z1 - z0, x1 - x0) });
    };
    // 亭:三面靠,正面留门;廊:后面一条。
    if (isTing) {
      const sides = opts.railingSides ?? ['e', 'w', 'n'];
      if (sides.includes('e')) addRail(colXs[colXs.length - 1], rowsZ[0], colXs[colXs.length - 1], rowsZ[1]);
      if (sides.includes('w')) addRail(colXs[0], rowsZ[1], colXs[0], rowsZ[0]);
      if (sides.includes('n')) addRail(colXs[0], rowsZ[1], colXs[colXs.length - 1], rowsZ[1]);
      if (sides.includes('s')) addRail(colXs[colXs.length - 1], rowsZ[0], colXs[0], rowsZ[0]);
    } else {
      addRail(colXs[0], rowsZ[1], colXs[colXs.length - 1], rowsZ[1]);
    }
  }

  /* ---- 匾额 ------------------------------------------------------- */
  if (opts.plaque) {
    const pw = Math.min(2.0, Math.max(1.0, opts.plaque.length * 0.45));
    const pl = makePlaque(opts.plaque, pw);
    // 挂在铺作外皮之前、橑檐枋之下,人从院子里一眼看到;略向前俯 8°。
    const ph = pw * 0.36;
    const zFront = rowsZ[0] + (m.puzuoH > 0 ? m.puzuoOut + 0.22 : 0.16);
    // 竖向落在铺作层的中段(没铺作就贴阑额下),别钻进屋面板。
    const yMid = m.puzuoH > 0 ? platH + colH + pupai + m.puzuoH * 0.5 : platH + colH - m.lan.w - ph / 2 - 0.05;
    pl.position.set(0, yMid, zFront);
    pl.rotation.x = 0.14;
    root.add(pl);
  }

  const merged = mergeByMaterial(root);
  merged.name = 'Building';
  if(opts.backDoor||opts.steps)fr.provenance.art.push({id:'project:building-access',name:'小门与踏步施工输入',method:'artistic_choice',
    note:JSON.stringify({backDoor:opts.backDoor,steps:opts.steps,platformMarginM:opts.platformMarginM})});
  merged.userData.construction = { paramSet: 'paramSet' in fr ? fr.paramSet : 'fashi',
    spec: opts.spec, dimensions: fr.m, provenance: fr.provenance, surfaces: {front,sides,back},access:{rearDoor,walkSurfaces,options:{backDoor:opts.backDoor,steps:opts.steps}} };

  return {
    kind: 'building',
    root: merged,
    frame: fr,
    platform: { hx: platHX, hz: platHZ, y: platH },
    walkSurfaces,
    blockers,
    groundRadius: Math.max(platHX, platHZ) * 2.4,
  };
}

/* ------------------------------------------------------------------ */
/* 预设与登记                                                          */
/* ------------------------------------------------------------------ */

/** 沁芳亭:四角攒尖,六等材,一间见方。 */
export function tingSpec(): BuildingOptions {
  return {
    spec: {
      cai: { grade: 7 },
      hall: '余屋',
      bayWidthsFen: [300],
      rafters: 2,
      jiaFen: 150,
      puzuo: { puzuo: 4, jumpFen: 26 },
      roofType: '攒尖',
      roofClass: '筒瓦厅堂',
      qiqiaoFen: 45,
      columnHeightFen: 270,
      columnDiameterFen: 22,
      rafterDiaFen: 6.5,
    },
    plaque: '沁芳',
    railing: true,
    railingSides: ['e', 'w'],
    platformH: 0.4,
  };
}

/** 潇湘馆正房:小三间歇山,六等材。 */
export function tangSpec(): BuildingOptions {
  return {
    spec: {
      cai: { grade: 6 },
      hall: '厅堂',
      bayWidthsFen: [230, 270, 230],
      rafters: 4,
      jiaFen: 120,
      puzuo: { puzuo: 4, jumpFen: 26 },
      roofType: '歇山',
      roofClass: '筒瓦厅堂',
      qiqiaoFen: 40,
      columnHeightFen: 250,
      columnDiameterFen: 26,
      rafterDiaFen: 7,
    },
    // 匾额有意留空。第十八回元春「『有鳳來儀』賜名曰『瀟湘館』」——「有凤来仪」是
    // 第十七回试才的拟稿,已被替换;而正门上挂着的「大观园」出自同一句话,即园子已
    // 站在赐名之后,此处再挂拟稿就是同一园子里两个时刻并存。院名匾应挂院门(月洞门)
    // 上,见 knowledge/docs/qingshi/07-honglou.md 07-71 与 docs/ROADMAP.md §PQ-7。
    front: 'door',
    sides: 'wall',
    platformH: 0.45,
  };
}

/** 廊:一间宽两椽,硬山无墙,后有美人靠。 */
export function langSpec(): BuildingOptions {
  return {
    spec: {
      cai: { grade: 8 },
      hall: '余屋',
      bayWidthsFen: [280, 280],
      rafters: 2,
      jiaFen: 110,
      puzuo: null,
      roofType: '硬山',
      roofClass: '筒瓦廊屋',
      columnHeightFen: 260,
      columnDiameterFen: 20,
      rafterDiaFen: 6,
    },
    front: 'open',
    sides: 'open',
    railing: true,
    platformH: 0.3,
    chuji: 0.3,
  };
}

/**
 * 正门:第十七回"正门五间,上面桶瓦泥鳅脊;那门栏窗槅皆是细雕新鲜花样,并无朱粉涂饰;
 * 一色水磨群墙"。五间硬山,当心间开门,两侧槛窗,山墙与后檐水磨砖,不上朱粉。
 */
export function menSpec(): BuildingOptions {
  return {
    spec: {
      cai: { grade: 7 },
      hall: '厅堂',
      bayWidthsFen: [230, 250, 300, 250, 230],
      rafters: 4,
      jiaFen: 110,
      puzuo: { puzuo: 4, jumpFen: 26 },
      roofType: '硬山',
      roofClass: '筒瓦厅堂',
      columnHeightFen: 300,
      columnDiameterFen: 28,
      rafterDiaFen: 7,
    },
    plaque: '大观园',
    front: 'door',
    back: 'door',
    sides: 'wall',
    wallMaterial: 'stone',
    platformH: 0.5,
    chuji: 0.45,
  };
}

const PRESETS: Record<string, () => BuildingOptions> = {
  default: tangSpec,
  ting: tingSpec,
  tang: tangSpec,
  lang: langSpec,
  men: menSpec,
};

registerPart('building', (variant) => {
  const mk = PRESETS[variant];
  if (!mk) throw new Error(`未登记建筑预设 ${variant}，不可静默替换为潇湘馆`);
  return buildBuilding(mk());
});
