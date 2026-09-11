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
  whiteStoneMaterial,
  paperMaterial,
} from '@builder/parts/materials';
import { roundedBox } from '@builder/parts/sculpt';
import { makeRng, smoothstep, lerp, clamp } from '@engine/core/Noise';
import { mergeByMaterial } from '@builder/parts/merge';
import { makePlaque } from '@builder/parts/xiaomu/plaque';
import { gexinGeometry } from '@builder/parts/qiangyuan/wall';
import { plaqueFromPlan } from '@builder/plan/objects';
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
  /** 门屋(中柱造):门装在中柱缝而不在檐柱缝,前后檐到中柱是两段门道;
   *  前檐当心间敞开,中柱缝当心间装板门、其余间砌墙,后檐只留当心间通行。 */
  gatehouse?: boolean;
  /** 台基石作:青石(缺省)/白石(07-01「白石台磯」)。 */
  plinthMaterial?: 'stone' | 'whiteStone';
  /** 格扇/槛窗的格心纹样:给了就换用墙垣的格心生成器(PQ-2);缺省保留步步锦。 */
  lattice?: 'ice' | 'wan' | 'haitang';
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
/* 格扇                                                                */
/* ------------------------------------------------------------------ */

/** 一扇格扇:上部花格(万字/冰裂/步步锦)、下部裙板。 */
function makeGeshan(w: number, h: number, mat: THREE.Material, paper: THREE.Material, seed: number, pattern?: 'ice' | 'wan' | 'haitang'): THREE.Group {
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
  // 花格:窗纸打底。给了纹样就用墙垣的格心生成器(PQ-2,直箱棂条),
  // 没给保留带错位的"步步锦"方格。
  const gy0 = split + bar * 2.2;
  const gy1 = h / 2 - bar;
  const gh = gy1 - gy0;
  const gw = w - bar * 2;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), paper);
  p.position.set(0, (gy0 + gy1) / 2, 0);
  g.add(p);
  if (pattern) {
    const lattice = new THREE.Mesh(gexinGeometry(pattern, gw, gh, 0.02, seed, true), mat);
    lattice.position.set(0, (gy0 + gy1) / 2, 0);
    lattice.castShadow = true;
    lattice.receiveShadow = true;
    g.add(lattice);
    return g;
  }
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
  // 台基石作:缺省青石;正门按第十七回「下面白石台磯」用白石(07-01)。
  const plinth = opts.plinthMaterial === 'whiteStone' ? whiteStoneMaterial(1) : stone;
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
  // 07-01「鑿成西番草花樣」是台基边缘的浅浮雕,不是贴图;程序化浮雕本期做不出,
  // 先留素面台基,不用噪声贴图冒充雕花(待 P3 石作专件)。
  const plat = new THREE.Mesh(roundedBox(platHX * 2, platH, platHZ * 2, 0.03, 3), plinth);
  plat.position.y = platH / 2;
  plat.receiveShadow = true;
  plat.castShadow = true;
  root.add(plat);
  // 阶条石一圈略凸。
  const rim = new THREE.Mesh(roundedBox(platHX * 2 + 0.08, 0.1, platHZ * 2 + 0.08, 0.02, 2), plinth);
  rim.position.y = platH - 0.05;
  rim.receiveShadow = true;
  root.add(rim);
  if (opts.plinthMaterial === 'whiteStone') {
    fr.provenance.art.push({
      id: 'project:gate-plinth-white-stone',
      name: '正门白石台基与台基高',
      method: 'artistic_choice',
      note: `第十七回「下面白石台磯,鑿成西番草花樣」(07-01):材质按原文取白石非青石;规则表无门屋台基高,${platH}m 为观感取值;西番草是浅浮雕不是贴图,本期留素面待 P3 石作专件。`,
    });
  }
  // 正面踏步。
  const stepW = isTing ? m.width * 0.5 : Math.max(1.2, m.width * 0.3);
  const nSteps = Math.max(2, Math.round(platH / 0.15));
  for (let i = 0; i < (opts.steps?.front?0:nSteps); i++) {
    const h = platH / nSteps;
    const d = 0.3;
    const st = new THREE.Mesh(roundedBox(stepW, h, d, 0.015, 2), plinth);
    st.position.set(0, h * (nSteps - i) - h / 2, platHZ + d / 2 + d * i);
    st.receiveShadow = true;
    st.castShadow = true;
    root.add(st);
  }
  for(const side of ['front','back'] as const) {
    const spec=opts.steps?.[side];if(!spec)continue;
    const surfaces=compileExteriorSteps(platH,platHX,platHZ,side,spec,side==='back'?(opts.backDoor?.centerXM??0):0);
    for(const p of surfaces) {
      const st=new THREE.Mesh(roundedBox(p.hx*2,p.y,p.hz*2,.015,2),plinth);
      st.position.set(p.cx,p.y/2,p.cz);st.receiveShadow=true;st.castShadow=true;root.add(st);
    }
    walkSurfaces.push(...surfaces);
    if(opts.gatehouse) {
      // 踏跺垂带:踏跺两侧各一条顺坡而下的条石。规则表无门屋踏跺垂带条目,
      // 带宽 0.24m 为观感取值。
      const sign=side==='front'?1:-1;
      const run=surfaces.length*spec.treadM;
      const slope=Math.hypot(platH,run);
      const ang=Math.atan2(platH,run);
      for(const sx of [-1,1]) {
        const cd=new THREE.Mesh(roundedBox(0.24,0.14,slope+0.12,0.02,2),plinth);
        cd.position.set(sx*(spec.widthM/2+0.10),platH/2+0.04,sign*(platHZ+run/2));
        cd.rotation.x=sign*ang;
        cd.castShadow=true;cd.receiveShadow=true;root.add(cd);
      }
    }
  }
  if(opts.gatehouse&&(opts.steps?.front||opts.steps?.back))fr.provenance.art.push({
    id:'project:gate-steps-chuidai',name:'正门踏跺与垂带',method:'artistic_choice',
    note:'规则表无门屋踏跺/垂带条目;踏跺宽与垂带宽 0.24m 均为观感取值。'});

  /* ---- 柱网 ------------------------------------------------------- */
  const colXs = m.columnX;
  const rowsZ = [m.depthHalf, -m.depthHalf];
  const colH = m.columnH;
  const colR = m.columnD / 2;
  const columns: { x: number; z: number; h: number }[] = [];
  // 柱础线脚:方礅之上车一圈覆盆轮廓。覆盆高 = 0.1×础方、盆唇厚 = 0.01×础方,
  // 是法式卷三 [03-23] 的比例(derive 层只消费了 03-21 的础方,这里在构件层落地);
  // 鼓镜的弧线书里无形制,为观感取值,收工时记进 provenance.art。
  const fupenH = Math.max(0.05, m.base * 0.1);
  const lipT = Math.max(0.006, m.base * 0.01);
  const baseLathe = new THREE.LatheGeometry(
    [
      new THREE.Vector2(m.base * 0.47, 0),
      new THREE.Vector2(m.base * 0.47, lipT * 1.6),
      new THREE.Vector2(colR * 1.34, fupenH * 0.58),
      new THREE.Vector2(colR * 1.2, fupenH - lipT),
      new THREE.Vector2(colR * 1.26, fupenH - lipT),
      new THREE.Vector2(colR * 1.26, fupenH),
      new THREE.Vector2(colR * 0.98, fupenH + 0.004),
    ],
    18,
  );
  fr.provenance.art.push({
    id: 'project:column-base-molding',
    name: '柱础覆盆线脚轮廓',
    method: 'artistic_choice',
    note: '覆盆高 0.1×础方、盆唇厚 0.01×础方按法式卷三 [03-23](该条由构件层消费,derive 层只取了 03-21 的础方);鼓镜弧线无形制依据,为观感取值。',
  });
  const addColumn = (x: number, z: number, rise: number) => {
    const h = colH + rise;
    // 梭柱:上三分之一微收 [03-06]。
    const geo = new THREE.CylinderGeometry(colR * 0.92, colR, h, 18, 1);
    const c = new THREE.Mesh(geo, column);
    c.position.set(x, platH + h / 2, z);
    c.castShadow = true;
    c.receiveShadow = true;
    root.add(c);
    // 柱础:方 2D,上承车削覆盆。
    const base = new THREE.Mesh(roundedBox(m.base, 0.1, m.base, 0.02, 2), stone);
    base.position.set(x, platH + 0.05, z);
    base.receiveShadow = true;
    root.add(base);
    const bowl = new THREE.Mesh(baseLathe, stone);
    bowl.position.set(x, platH + 0.1, z);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
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

  /* ---- 中柱(门屋分心造) ------------------------------------------ */
  // 门屋通例:门装在中柱缝上,不在檐柱缝上——前后檐柱到中柱各隔一段门道,
  // 穿门是"走过一段进深",不是"掀开一张纸"。两椽门屋里中柱一缝正在中脊下,
  // 直抵脊枋底(分心造)。规则表无门屋条目,中柱高按"顶住脊枋"从推导脊高扣。
  const gatehouse = opts.gatehouse ?? false;
  const centerBay = Math.floor((colXs.length - 1) / 2);
  const midColTop = platH + m.ridgeY - 0.45; // 柱顶让出脊枋与望板的位
  if (gatehouse) {
    // 山面两柱由硬山山墙取代,中柱只立内四缝。
    for (let i = 1; i < colXs.length - 1; i++) addColumn(colXs[i], 0, midColTop - platH - colH);
    // 脊枋:一缝横梁把中柱顶串起来。
    addBeam(colXs[0], 0, colXs[colXs.length - 1], 0, m.lan.w, m.lan.t, midColTop + m.lan.w, wood);
    fr.provenance.art.push({
      id: 'project:gatehouse-zhongzhu',
      name: '中柱造与板门门口',
      method: 'artistic_choice',
      note: '门屋通例:门装中柱缝。规则表(fashi/qing/fayuan/missing 已查)无门屋条目;门洞宽取当心间柱间净空减边梃、门高 2.55m、板门厚 0.055m,均为观感取值。',
    });
    fr.provenance.art.push({
      id: 'project:gate-shallow-depth',
      name: '门屋压浅进深',
      method: 'artistic_choice',
      note: '门屋进深远小于面阔:取两椽(220 分)对五间面阔(1260 分)。椽架数是 spec 输入,不走规则表;压浅是"门屋不读成厅堂"的艺术判断。',
    });
  }

  /* ---- 雀替 --------------------------------------------------------- */
  // 柱梁交接处的托脚:轮廓在交接处断一下,"木构"的信息就给足了。
  // 规则表没有雀替条目(fashi/qing/fayuan/missing 已查):长取净跨 1/4、
  // 高同阑额,是清式江南小式的常见比例,不是条文——收工时记 provenance.art。
  {
    const qH = Math.max(0.12, m.lan.w);
    const qT = Math.min(0.08, colR * 0.5);
    const beamBottom = lanTop - m.lan.w - 0.003; // 顶面比阑额底低 3mm,不共面
    const qCache = new Map<number, THREE.BufferGeometry>();
    const quetieGeo = (L: number) => {
      const key = Math.round(L * 200) / 200;
      let g = qCache.get(key);
      if (!g) {
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.lineTo(L, 0);
        s.quadraticCurveTo(L * 0.92, -qH * 0.42, L * 0.45, -qH * 0.82);
        s.quadraticCurveTo(L * 0.16, -qH, 0, -qH);
        s.closePath();
        g = new THREE.ExtrudeGeometry(s, { depth: qT, bevelEnabled: false, curveSegments: 6 });
        g.translate(0, 0, -qT / 2);
        qCache.set(key, g);
      }
      return g;
    };
    const addQuetie = (x: number, z: number, L: number, rotY: number) => {
      const q = new THREE.Mesh(quetieGeo(L), wood);
      q.position.set(x, beamBottom, z);
      q.rotation.y = rotY;
      q.castShadow = true;
      q.receiveShadow = true;
      root.add(q);
    };
    for (const z of rowsZ) {
      for (let i = 0; i < colXs.length; i++) {
        for (const dir of [-1, 1]) {
          const j = i + dir;
          if (j < 0 || j >= colXs.length) continue;
          const span = Math.abs(colXs[j] - colXs[i]) - colR * 2;
          const L = clamp(span * 0.25, 0.2, 0.9);
          addQuetie(colXs[i] + dir * colR * 0.8, z, L, dir > 0 ? 0 : Math.PI);
        }
      }
    }
    // 山面(两山顺梁)的角柱也各带一只。
    for (const x of [colXs[0], colXs[colXs.length - 1]]) {
      const span = rowsZ[0] - rowsZ[1] - colR * 2;
      const L = clamp(span * 0.25, 0.2, 0.9);
      addQuetie(x, rowsZ[0] - colR * 0.8, L, Math.PI / 2);
      addQuetie(x, rowsZ[1] + colR * 0.8, L, -Math.PI / 2);
    }
    fr.provenance.art.push({
      id: 'project:quetie-proportions',
      name: '雀替比例',
      method: 'artistic_choice',
      note: '规则表无雀替条目;长取净跨 1/4、高同阑额,为清式江南小式常见比例的观感取值。',
    });
  }

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
  // 屋面各面的剖面参数,椽与连檐共用。
  const faces: { halfWidth: (s: number) => number; zTip: number; sMax: number; rotY: number }[] = [];
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
    faces.push({ halfWidth, zTip, sMax, rotY });
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

  /* ---- 椽(望板下那排) ---------------------------------------------- */
  // 椽径、椽心距出自推导链([04-12]/[05-02] → m.rafterDia,[05-03] → m.rafterPitch),
  // 布椽令一间当间心 [05-03]:椽位对中线对称布。角部不做辐射扇形角椽,
  // 直椽按各面 halfWidth 的收进裁短——从廊下仰视读的是"一排椽",不是角部做法。
  {
    const rd = m.rafterDia;
    const rh = rd * 1.15;
    const s0 = 0.07; // 让开连檐封边
    for (const face of faces) {
      const hwEave = face.halfWidth(0);
      const n = Math.max(2, Math.round((hwEave * 2 - 0.1) / m.rafterPitch));
      for (let i = 0; i <= n; i++) {
        const x0 = lerp(-hwEave + 0.05, hwEave - 0.05, i / n);
        // 这根椽能走到的最里 s:歇山角部 45° 收进与攒尖收尖会把角椽裁短。
        let sEnd = Math.min(prof.sEave + 0.15, face.sMax);
        while (sEnd > s0 + 0.15 && face.halfWidth(sEnd) < Math.abs(x0) + rd) sEnd -= 0.04;
        if (sEnd <= s0 + 0.15) continue;
        const y0 = profileY(pts, s0) + lift(x0, s0, face.halfWidth(s0)) - thick;
        const y1 = profileY(pts, sEnd) + lift(x0, sEnd, face.halfWidth(sEnd)) - thick;
        const sMid = (s0 + sEnd) / 2;
        const len = Math.hypot(sEnd - s0, y1 - y0);
        const theta = Math.atan2(y1 - y0, sEnd - s0);
        const geo = roundedBox(rd, rh, len, Math.min(0.012, rd * 0.18), 1);
        geo.rotateX(Math.PI + theta);
        const r = new THREE.Mesh(geo, wood);
        // 位置也要绕屋中心转 rotY——各坡面的局部坐标系不一致,直接塞局部坐标
        // 会把背坡的椽翻到前坡上方。
        const lx = x0 + push(x0, sMid, face.halfWidth(sMid));
        const lz = face.zTip - sMid;
        const ca = Math.cos(face.rotY);
        const sa = Math.sin(face.rotY);
        r.position.set(lx * ca + lz * sa, (y0 + y1) / 2 - rh / 2 + 0.03, -lx * sa + lz * ca);
        r.rotation.y = face.rotY;
        r.castShadow = true;
        r.receiveShadow = true;
        roofGroup.add(r);
      }
    }
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
      const g = makeGeshan(len/panels-.015,wallH-sillH-.08,wood,paper,seed+80+k,opts.lattice);
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
    if (gatehouse) {
      // 门屋后檐:次梢间砌墙封死(正门是「一色水磨群墙」,随 wallMaterial),
      // 只留当心间与中柱缝门洞对位通行。
      for (let i = 1; i < colXs.length; i++) {
        if (i - 1 === centerBay) continue;
        addWall(colXs[i - 1], rowsZ[1], colXs[i], rowsZ[1], wallH, platH);
      }
    } else {
    const span = colXs[colXs.length - 1] - colXs[0] - 2 * colR;
    const gw = span / 4;
    const bx0 = colXs[0] + colR;
    const by = platH + (wallH - 0.1) / 2 + 0.05;
    for (let k = 0; k < 4; k++) {
      const g = makeGeshan(gw - 0.01, wallH - 0.1, wood, paper, seed + 40 + k, opts.lattice);
      if (k === 0 || k === 3) {
        g.position.set(bx0 + gw * (k + 0.5), by, rowsZ[1]);
        root.add(g);
      } else if (k === 1) hingedPanel(g, gw - 0.01, bx0 + gw, 1, by, rowsZ[1], -(doorOpen ? 1.62 : 0.3));
      else hingedPanel(g, gw - 0.01, bx0 + gw * 3, -1, by, rowsZ[1], -(doorOpen ? 1.62 : 0.3));
    }
    blockers.push({ cx: colXs[0] + colR + gw * 0.5, cz: rowsZ[1], hx: gw * 0.5, hz: 0.06, h: platH + wallH });
    blockers.push({ cx: colXs[colXs.length - 1] - colR - gw * 0.5, cz: rowsZ[1], hx: gw * 0.5, hz: 0.06, h: platH + wallH });
    }
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
    // 门屋(gatehouse):前檐当心间敞开,门退到中柱缝——这里只装次梢间的槛窗。
    for (let i = 1; i < colXs.length; i++) {
      const x0 = colXs[i - 1] + colR;
      const x1 = colXs[i] - colR;
      const span = x1 - x0;
      const isCenter = i - 1 === centerBay;
      const n = 4;
      const gw = span / n;
      const z = rowsZ[0];
      if (isCenter && gatehouse) continue;
      if (isCenter) {
        const py = platH + (wallH - 0.1) / 2 + 0.05;
        for (let k = 0; k < n; k++) {
          const g = makeGeshan(gw - 0.01, wallH - 0.1, wood, paper, seed + k + i * 10, opts.lattice);
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
          const g = makeGeshan(gw - 0.01, wallH - sillH - 0.16, wood, paper, seed + k + i * 10, opts.lattice);
          g.position.set(x0 + gw * (k + 0.5), platH + sillH + 0.08 + (wallH - sillH - 0.16) / 2, z);
          root.add(g);
        }
        blockers.push({ cx: (x0 + x1) / 2, cz: z, hx: span / 2, hz: 0.1, h: platH + wallH });
      }
    }
  }

  /* ---- 门屋:中柱缝的墙与板门 -------------------------------------- */
  if (gatehouse) {
    // 中柱缝(z=0)次梢间砌墙封死,只留当心间门洞——从门外看进去,
    // 读到的是一堵横墙上的门口,不是一间屋的内景。
    for (let i = 1; i < colXs.length; i++) {
      if (i - 1 === centerBay) continue;
      addWall(colXs[i - 1], 0, colXs[i], 0, wallH, platH);
    }
    // 板门门口:边梃、上槛、走马板、门槛,两扇板门向外全开、贴立门道两侧。
    // 尺寸无出处(见 project:gatehouse-zhongzhu 的 provenance 注)。
    const jambW = 0.09;
    const doorH = 2.55;
    const sillH2 = 0.08;
    const cx0 = colXs[centerBay] + colR; // 门洞西界(柱内侧)
    const cx1 = colXs[centerBay + 1] - colR; // 门洞东界
    const openW = cx1 - cx0 - jambW * 2;
    const headTop = platH + sillH2 + doorH + 0.12; // 上槛顶
    for (const x of [cx0 + jambW / 2, cx1 - jambW / 2]) {
      const jamb = new THREE.Mesh(roundedBox(jambW, headTop - platH, wallT + 0.04, 0.008, 2), wood);
      jamb.position.set(x, (platH + headTop) / 2, 0);
      jamb.castShadow = true;
      jamb.receiveShadow = true;
      root.add(jamb);
      blockers.push({ cx: x, cz: 0, hx: jambW / 2, hz: (wallT + 0.04) / 2, minY: platH, h: headTop });
    }
    const lintel = new THREE.Mesh(roundedBox(openW + jambW * 2, 0.12, wallT + 0.04, 0.008, 2), wood);
    lintel.position.set(0, headTop - 0.06, 0);
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    root.add(lintel);
    // 走马板:上槛以上填到脊枋底。
    const fillH = midColTop - headTop;
    if (fillH > 0.05) {
      const fill = new THREE.Mesh(roundedBox(openW + jambW * 2, fillH, 0.05, 0.008, 2), wood);
      fill.position.set(0, headTop + fillH / 2, 0);
      fill.castShadow = true;
      fill.receiveShadow = true;
      root.add(fill);
    }
    blockers.push({ cx: 0, cz: 0, hx: (openW + jambW * 2) / 2, hz: (wallT + 0.04) / 2, minY: platH + sillH2 + doorH, h: midColTop });
    // 门槛:低矮,只作视觉(不进碰撞,不绊脚)。
    const sill2 = new THREE.Mesh(roundedBox(openW, sillH2, 0.16, 0.01, 2), wood);
    sill2.position.set(0, platH + sillH2 / 2, 0);
    sill2.receiveShadow = true;
    root.add(sill2);
    // 两扇板门:素板加三条穿带,不上朱漆不装门钉(「並無朱粉塗飾」)。
    const gw2 = openW / 2 - 0.01;
    const mkLeaf = () => {
      const leaf = new THREE.Group();
      const panel = new THREE.Mesh(roundedBox(gw2, doorH, 0.055, 0.008, 2), wood);
      leaf.add(panel);
      for (const ty of [-0.3, 0, 0.3]) {
        const batten = new THREE.Mesh(roundedBox(gw2 - 0.06, 0.1, 0.03, 0.006, 1), wood);
        batten.position.set(0, ty * doorH, -0.04);
        leaf.add(batten);
      }
      leaf.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      return leaf;
    };
    const openAng = doorOpen ? Math.PI / 2 - 0.06 : 0.04;
    hingedPanel(mkLeaf(), gw2, cx0 + jambW, 1, platH + sillH2 + doorH / 2, 0, openAng);
    hingedPanel(mkLeaf(), gw2, cx1 - jambW, -1, platH + sillH2 + doorH / 2, 0, openAng);
    if (doorOpen) {
      // 全开的门扇贴立在门道两侧,各是一条顺 Z 的薄阻挡,不占中路。
      for (const sx of [-1, 1]) {
        blockers.push({ cx: sx * (Math.abs(cx0) - jambW), cz: gw2 / 2, hx: 0.04, hz: gw2 / 2, minY: platH + sillH2, h: platH + sillH2 + doorH });
      }
    } else {
      blockers.push({ cx: 0, cz: 0, hx: openW / 2, hz: 0.04, minY: platH + sillH2, h: platH + sillH2 + doorH });
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
    // 匾额文字只从 plan.json 读(missing 99-26):预设不写字面量。
    plaque: plaqueFromPlan('qinfang_ting_qiao.pavilion'),
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
    lattice: 'ice', // 格心冰裂纹(墙垣生成器,PQ-2);纹样选择无原文依据,是清幽向的艺术选择
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
 * 一色水磨群墙"。五间硬山门屋(中柱造):前后檐当心间敞开,板门装在中柱缝;
 * 进深压到两椽(门屋进深远小于面阔),白石高台基前后各出垂带踏跺。
 * 不上朱粉;金只许在匾额字上(ART_DIRECTION §9)。
 */
export function menSpec(): BuildingOptions {
  return {
    spec: {
      cai: { grade: 7 },
      hall: '厅堂',
      bayWidthsFen: [230, 250, 300, 250, 230],
      // 压浅进深:两椽 220 分 ≈ 2.4m,对五间面阔 1260 分 ≈ 13.8m。
      // 椽架数是 spec 输入不走规则表;此值是"门屋"的艺术判断,记 provenance.art。
      rafters: 2,
      jiaFen: 110,
      puzuo: { puzuo: 4, jumpFen: 26 },
      roofType: '硬山',
      roofClass: '筒瓦厅堂',
      columnHeightFen: 300,
      columnDiameterFen: 28,
      rafterDiaFen: 7,
    },
    // 匾额文字只从 plan.json 读(missing 99-26):正门挂「大观园」(07-37 园之总名;
    // 挂正门是艺术摆放,见 ROADMAP §PQ-7)。
    plaque: plaqueFromPlan('zhengmen.main-gate'),
    front: 'door',
    back: 'door',
    sides: 'wall',
    gatehouse: true,
    lattice: 'wan', // 第十七回「门栏窗槅皆是细雕新鲜花样」:万字不到头
    wallMaterial: 'stone',
    plinthMaterial: 'whiteStone', // 「下面白石台磯」——白石,不是青石
    platformH: 0.75, // 规则表无门屋台基高,观感取值(记 provenance.art)
    platformMarginM: 0.9,
    steps: {
      front: { widthM: 3.0, treadM: 0.3, maxRiserM: 0.15 },
      back: { widthM: 3.0, treadM: 0.3, maxRiserM: 0.15 },
    },
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
